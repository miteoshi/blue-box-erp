-- ─────────────────────────────────────────────────────────────
-- Atomic document workflows
--
-- Each of these used to be 3–6 separate requests from the browser.
-- A failure half-way left orphan headers, stock moved without document
-- lines, or a sales order stuck with partial reservations. Every function
-- below runs in ONE transaction: it either fully succeeds or changes
-- nothing.
--
--   reserve_sales_order(so)           all-or-nothing stock reservation,
--                                     tops up only what is missing (also
--                                     repairs orders left half-reserved)
--   cancel_sales_order(so)            releases reservations + cancels
--   create_delivery_challan(...)      header + lines + stock dispatch
--                                     (FIFO over the SO's reservations)
--                                     + qty_dispatched + SO status
--   mark_challan_delivered(challan)   SO becomes 'delivered' only when it
--                                     is fully dispatched and every
--                                     challan is delivered
--   create_inbound_receipt(...)       GRN header + lines + stock receipt
--   convert_quotation_to_sales_order  SO + lines + quotation 'converted',
--                                     guarded against double conversion
--
-- Roles mirror the existing RLS policies on each document table.
-- ─────────────────────────────────────────────────────────────

-- ── Sales order: reserve stock ───────────────────────────────
create or replace function public.reserve_sales_order(
  p_so_id uuid,
  p_expiry_hours integer default 72
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_so public.sales_orders;
  v_need record;
  v_count integer := 0;
begin
  perform public.assert_my_role('admin', 'manager', 'sales');

  select * into v_so
  from public.sales_orders
  where id = p_so_id and org_id = v_org
  for update;

  if not found then
    raise exception 'Sales order not found' using errcode = 'P0002';
  end if;

  if v_so.status not in ('confirmed', 'ready') then
    raise exception 'Stock can only be reserved for confirmed orders (this order is %)', v_so.status
      using errcode = 'P0008';
  end if;

  -- Per item: what is still to be dispatched vs. what is already held by
  -- live reservations for this SO. Ordered by item_id for a stable lock order.
  for v_need in
    with need as (
      select l.item_id,
             sum(greatest(l.qty - coalesce(l.qty_dispatched, 0), 0)) as qty_needed
      from public.sales_order_lines l
      where l.so_id = p_so_id
      group by l.item_id
    ),
    held as (
      select r.item_id,
             sum(r.qty_reserved - r.qty_consumed - r.qty_released) as qty_held
      from public.stock_reservations r
      where r.org_id = v_org
        and r.ref_type = 'sales_order'
        and r.ref_id = p_so_id
        and r.status in ('active', 'partially_consumed')
      group by r.item_id
    )
    select n.item_id, n.qty_needed - coalesce(h.qty_held, 0) as qty_missing
    from need n
    left join held h on h.item_id = n.item_id
    where n.qty_needed - coalesce(h.qty_held, 0) > 0
    order by n.item_id
  loop
    -- Raises (and rolls everything back) if stock is insufficient.
    perform public.reserve_inventory(
      gen_random_uuid(), v_need.item_id, v_need.qty_missing,
      'sales_order', p_so_id, p_expiry_hours, 'SO ' || v_so.so_number
    );
    v_count := v_count + 1;
  end loop;

  update public.sales_orders
  set status = 'ready'
  where id = p_so_id and status = 'confirmed';

  return jsonb_build_object(
    'success', true,
    'so_id', p_so_id,
    'reservations_created', v_count
  );
end;
$function$;

-- ── Sales order: cancel ──────────────────────────────────────
create or replace function public.cancel_sales_order(p_so_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_so public.sales_orders;
  v_res record;
  v_count integer := 0;
begin
  perform public.assert_my_role('admin', 'manager', 'sales');

  select * into v_so
  from public.sales_orders
  where id = p_so_id and org_id = v_org
  for update;

  if not found then
    raise exception 'Sales order not found' using errcode = 'P0002';
  end if;

  if v_so.status in ('dispatched', 'delivered', 'cancelled') then
    raise exception 'Order is already %', v_so.status using errcode = 'P0008';
  end if;

  if exists (select 1 from public.delivery_challans where so_id = p_so_id)
     or exists (select 1 from public.sales_order_lines
                where so_id = p_so_id and coalesce(qty_dispatched, 0) > 0) then
    raise exception 'Goods have already been dispatched against this order; it cannot be cancelled'
      using errcode = 'P0008';
  end if;

  for v_res in
    select id
    from public.stock_reservations
    where org_id = v_org
      and ref_type = 'sales_order'
      and ref_id = p_so_id
      and status in ('active', 'partially_consumed')
    order by item_id, created_at
  loop
    perform public.release_inventory(gen_random_uuid(), v_res.id, null, 'SO cancelled — ' || v_so.so_number);
    v_count := v_count + 1;
  end loop;

  update public.sales_orders set status = 'cancelled' where id = p_so_id;

  return jsonb_build_object(
    'success', true,
    'so_id', p_so_id,
    'reservations_released', v_count
  );
end;
$function$;

-- ── Delivery challan: create + dispatch ──────────────────────
-- p_lines: [{ "so_line_id": uuid, "qty": number, "rate": number }, ...]
create or replace function public.create_delivery_challan(
  p_so_id uuid,
  p_lines jsonb,
  p_challan_date date default current_date,
  p_transport_mode public.transport_mode default 'client_truck',
  p_vehicle_no text default null,
  p_driver_name text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_user uuid := auth.uid();
  v_so public.sales_orders;
  v_dc_id uuid;
  v_dc_no text;
  v_line record;
  v_res record;
  v_remaining numeric;
  v_left numeric;
  v_take numeric;
  v_total numeric := 0;
  v_unreserved numeric := 0;
  v_line_count integer := 0;
  v_note text;
begin
  perform public.assert_my_role('admin', 'manager', 'store');

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line is required' using errcode = '22023';
  end if;

  select * into v_so
  from public.sales_orders
  where id = p_so_id and org_id = v_org
  for update;

  if not found then
    raise exception 'Sales order not found' using errcode = 'P0002';
  end if;

  if v_so.status not in ('confirmed', 'in_production', 'ready') then
    raise exception 'Cannot dispatch against an order that is %', v_so.status using errcode = 'P0008';
  end if;

  v_dc_no := public.next_dc_no(v_org);
  v_note  := 'Challan ' || v_dc_no || ' — SO ' || v_so.so_number;

  insert into public.delivery_challans (
    org_id, challan_no, so_id, client_id, challan_date, transport_mode,
    vehicle_no, driver_name, total_amount, status, notes, created_by
  )
  values (
    v_org, v_dc_no, p_so_id, v_so.client_id, coalesce(p_challan_date, current_date),
    coalesce(p_transport_mode, 'client_truck'),
    nullif(trim(p_vehicle_no), ''), nullif(trim(p_driver_name), ''),
    0, 'dispatched', nullif(trim(p_notes), ''), v_user
  )
  returning id into v_dc_id;

  for v_line in
    select x.so_line_id, x.qty, x.rate,
           sol.id as sol_id, sol.item_id, sol.unit_id
    from jsonb_to_recordset(p_lines) as x(so_line_id uuid, qty numeric, rate numeric)
    left join public.sales_order_lines sol
      on sol.id = x.so_line_id and sol.so_id = p_so_id
    order by sol.item_id nulls first, x.so_line_id
  loop
    if v_line.sol_id is null then
      raise exception 'Line % does not belong to this sales order', v_line.so_line_id using errcode = '22023';
    end if;
    if v_line.qty is null or v_line.qty <= 0 then
      raise exception 'Dispatch quantities must be greater than zero' using errcode = '22023';
    end if;
    if v_line.rate is null or v_line.rate < 0 then
      raise exception 'Rates cannot be negative' using errcode = '22023';
    end if;

    -- Re-read under lock: also correct if the same line appears twice.
    select qty - coalesce(qty_dispatched, 0) into v_remaining
    from public.sales_order_lines
    where id = v_line.sol_id
    for update;

    if v_line.qty > v_remaining then
      raise exception 'Dispatch qty % exceeds the % still to be dispatched for this line',
        v_line.qty, v_remaining using errcode = 'P0009';
    end if;

    -- Consume this SO's reservations for the item first (oldest first),
    -- then fall back to available stock for anything not reserved.
    v_left := v_line.qty;
    for v_res in
      select id, qty_reserved - qty_consumed - qty_released as rem
      from public.stock_reservations
      where org_id = v_org
        and ref_type = 'sales_order'
        and ref_id = p_so_id
        and item_id = v_line.item_id
        and status in ('active', 'partially_consumed')
      order by created_at, id
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_res.rem);
      if v_take > 0 then
        perform public.dispatch_inventory(
          gen_random_uuid(), v_line.item_id, v_take, v_line.rate,
          v_res.id, 'delivery_challan', v_dc_id, v_note
        );
        v_left := v_left - v_take;
      end if;
    end loop;

    if v_left > 0 then
      perform public.dispatch_inventory(
        gen_random_uuid(), v_line.item_id, v_left, v_line.rate,
        null, 'delivery_challan', v_dc_id, v_note
      );
      v_unreserved := v_unreserved + v_left;
    end if;

    insert into public.delivery_challan_lines (challan_id, item_id, so_line_id, qty, unit_id, rate)
    values (v_dc_id, v_line.item_id, v_line.sol_id, v_line.qty, v_line.unit_id, v_line.rate);

    update public.sales_order_lines
    set qty_dispatched = coalesce(qty_dispatched, 0) + v_line.qty
    where id = v_line.sol_id;

    v_total := v_total + v_line.qty * v_line.rate;
    v_line_count := v_line_count + 1;
  end loop;

  update public.delivery_challans set total_amount = v_total where id = v_dc_id;

  -- Fully dispatched → SO is 'dispatched' and any leftover reservation
  -- for it is returned to available stock.
  if not exists (
    select 1 from public.sales_order_lines
    where so_id = p_so_id and qty - coalesce(qty_dispatched, 0) > 0
  ) then
    update public.sales_orders set status = 'dispatched' where id = p_so_id;

    for v_res in
      select id from public.stock_reservations
      where org_id = v_org
        and ref_type = 'sales_order'
        and ref_id = p_so_id
        and status in ('active', 'partially_consumed')
      order by item_id, created_at
    loop
      perform public.release_inventory(gen_random_uuid(), v_res.id, null, 'SO fully dispatched — ' || v_so.so_number);
    end loop;
  end if;

  return jsonb_build_object(
    'success', true,
    'id', v_dc_id,
    'challan_no', v_dc_no,
    'total_amount', v_total,
    'lines', v_line_count,
    'unreserved_qty', v_unreserved
  );
end;
$function$;

-- ── Delivery challan: mark delivered ─────────────────────────
create or replace function public.mark_challan_delivered(p_challan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_dc public.delivery_challans;
  v_so_status public.order_status;
  v_so_delivered boolean := false;
begin
  perform public.assert_my_role('admin', 'manager', 'store');

  select * into v_dc
  from public.delivery_challans
  where id = p_challan_id and org_id = v_org
  for update;

  if not found then
    raise exception 'Challan not found' using errcode = 'P0002';
  end if;

  if v_dc.status <> 'delivered' then
    if v_dc.status <> 'dispatched' then
      raise exception 'Only dispatched challans can be marked delivered (this one is %)', v_dc.status
        using errcode = 'P0008';
    end if;
    update public.delivery_challans set status = 'delivered' where id = p_challan_id;
  end if;

  select status into v_so_status
  from public.sales_orders
  where id = v_dc.so_id and org_id = v_org
  for update;

  -- Only a fully dispatched order (status 'dispatched') can become delivered.
  if v_so_status = 'dispatched' and not exists (
    select 1 from public.delivery_challans
    where so_id = v_dc.so_id and status = 'dispatched'
  ) then
    update public.sales_orders set status = 'delivered' where id = v_dc.so_id;
    v_so_delivered := true;
  end if;

  return jsonb_build_object(
    'success', true,
    'challan_id', p_challan_id,
    'so_delivered', v_so_delivered or v_so_status = 'delivered'
  );
end;
$function$;

-- ── Inbound GRN: create + receive ────────────────────────────
-- p_lines: [{ "item_id", "unit_id", "qty_received", "qty_ordered"?, "rate", "gst_percent"?, "notes"? }]
create or replace function public.create_inbound_receipt(
  p_supplier_id uuid,
  p_lines jsonb,
  p_receipt_date date default current_date,
  p_transport_mode public.transport_mode default 'supplier_truck',
  p_vehicle_no text default null,
  p_driver_name text default null,
  p_challan_no text default null,
  p_invoice_no text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_user uuid := auth.uid();
  v_grn_id uuid;
  v_grn_no text;
  v_line record;
  v_subtotal numeric := 0;
  v_gst numeric := 0;
  v_line_count integer := 0;
begin
  perform public.assert_my_role('admin', 'store');

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.suppliers where id = p_supplier_id and org_id = v_org) then
    raise exception 'Supplier not found' using errcode = 'P0002';
  end if;

  v_grn_no := public.next_grn_no(v_org);

  insert into public.inbound_receipts (
    org_id, receipt_no, supplier_id, receipt_date, transport_mode, vehicle_no,
    driver_name, challan_no, invoice_no, total_amount, gst_amount, status,
    notes, received_by, created_by
  )
  values (
    v_org, v_grn_no, p_supplier_id, coalesce(p_receipt_date, current_date),
    coalesce(p_transport_mode, 'supplier_truck'),
    nullif(trim(p_vehicle_no), ''), nullif(trim(p_driver_name), ''),
    nullif(trim(p_challan_no), ''), nullif(trim(p_invoice_no), ''),
    0, 0, 'received', nullif(trim(p_notes), ''), v_user, v_user
  )
  returning id into v_grn_id;

  for v_line in
    select x.item_id, x.unit_id, x.qty_received, x.qty_ordered, x.rate,
           coalesce(nullif(x.gst_percent, ''), '18') as gst_percent,
           nullif(trim(x.notes), '') as notes
    from jsonb_to_recordset(p_lines) as x(
      item_id uuid, unit_id uuid, qty_received numeric, qty_ordered numeric,
      rate numeric, gst_percent text, notes text
    )
    order by x.item_id
  loop
    if v_line.item_id is null or v_line.unit_id is null then
      raise exception 'Every line needs an item and a unit' using errcode = '22023';
    end if;
    if v_line.qty_received is null or v_line.qty_received <= 0 then
      raise exception 'Received quantities must be greater than zero' using errcode = '22023';
    end if;
    if v_line.rate is null or v_line.rate < 0 then
      raise exception 'Rates cannot be negative' using errcode = '22023';
    end if;

    -- Line triggers verify the item and unit belong to this organization.
    insert into public.inbound_receipt_lines (
      receipt_id, item_id, qty_ordered, qty_received, unit_id, rate, gst_percent, notes
    )
    values (
      v_grn_id, v_line.item_id,
      case when v_line.qty_ordered > 0 then v_line.qty_ordered end,
      v_line.qty_received, v_line.unit_id, v_line.rate,
      v_line.gst_percent::public.gst_rate, v_line.notes
    );

    perform public.receive_inventory(
      gen_random_uuid(), v_line.item_id, v_line.qty_received, v_line.rate,
      'inbound_receipt', v_grn_id, null, 'GRN ' || v_grn_no
    );

    v_subtotal := v_subtotal + v_line.qty_received * v_line.rate;
    v_gst := v_gst + v_line.qty_received * v_line.rate * (v_line.gst_percent::numeric) / 100;
    v_line_count := v_line_count + 1;
  end loop;

  update public.inbound_receipts
  set total_amount = v_subtotal, gst_amount = v_gst
  where id = v_grn_id;

  return jsonb_build_object(
    'success', true,
    'id', v_grn_id,
    'receipt_no', v_grn_no,
    'total_amount', v_subtotal,
    'gst_amount', v_gst,
    'lines', v_line_count
  );
end;
$function$;

-- ── Quotation → sales order ──────────────────────────────────
create or replace function public.convert_quotation_to_sales_order(p_quotation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_user uuid := auth.uid();
  v_qt public.quotations;
  v_so_id uuid;
  v_so_no text;
begin
  perform public.assert_my_role('admin', 'manager', 'sales');

  select * into v_qt
  from public.quotations
  where id = p_quotation_id and org_id = v_org
  for update;

  if not found then
    raise exception 'Quotation not found' using errcode = 'P0002';
  end if;

  if v_qt.status = 'converted' then
    raise exception 'Quotation % has already been converted', v_qt.quotation_no using errcode = 'P0008';
  end if;

  if v_qt.status <> 'approved' then
    raise exception 'Only approved quotations can be converted (this one is %)', v_qt.status
      using errcode = 'P0008';
  end if;

  if not exists (select 1 from public.quotation_lines where quotation_id = p_quotation_id) then
    raise exception 'Quotation has no lines' using errcode = '22023';
  end if;

  v_so_no := public.next_so_no(v_org);

  insert into public.sales_orders (
    org_id, so_number, created_by, quotation_id, client_id, order_date, status,
    subtotal, gst_amount, total_amount, advance_paid, balance_due,
    payment_terms, delivery_date, notes
  )
  values (
    v_org, v_so_no, v_user, v_qt.id, v_qt.client_id, current_date, 'confirmed',
    v_qt.subtotal, v_qt.gst_amount, v_qt.total_amount, 0, v_qt.total_amount,
    v_qt.payment_terms,
    case when v_qt.delivery_days is not null then current_date + v_qt.delivery_days end,
    nullif(concat_ws(
      E'\n\n',
      nullif(v_qt.notes, ''),
      case when nullif(v_qt.transport_note, '') is not null
           then 'Transport: ' || v_qt.transport_note end
    ), '')
  )
  returning id into v_so_id;

  insert into public.sales_order_lines (
    so_id, item_id, description, qty, unit_id, unit_rate, gst_percent, sort_order
  )
  select v_so_id, ql.item_id, ql.description, ql.qty, ql.unit_id, ql.unit_rate, ql.gst_percent,
         (row_number() over (order by ql.sort_order nulls last, ql.id) - 1)::integer
  from public.quotation_lines ql
  where ql.quotation_id = p_quotation_id;

  update public.quotations set status = 'converted' where id = p_quotation_id;

  return jsonb_build_object(
    'success', true,
    'id', v_so_id,
    'so_number', v_so_no
  );
end;
$function$;

-- ── Privileges ───────────────────────────────────────────────
revoke execute on function public.reserve_sales_order(uuid, integer) from public, anon;
revoke execute on function public.cancel_sales_order(uuid) from public, anon;
revoke execute on function public.create_delivery_challan(uuid, jsonb, date, public.transport_mode, text, text, text) from public, anon;
revoke execute on function public.mark_challan_delivered(uuid) from public, anon;
revoke execute on function public.create_inbound_receipt(uuid, jsonb, date, public.transport_mode, text, text, text, text, text) from public, anon;
revoke execute on function public.convert_quotation_to_sales_order(uuid) from public, anon;

grant execute on function public.reserve_sales_order(uuid, integer) to authenticated;
grant execute on function public.cancel_sales_order(uuid) to authenticated;
grant execute on function public.create_delivery_challan(uuid, jsonb, date, public.transport_mode, text, text, text) to authenticated;
grant execute on function public.mark_challan_delivered(uuid) to authenticated;
grant execute on function public.create_inbound_receipt(uuid, jsonb, date, public.transport_mode, text, text, text, text, text) to authenticated;
grant execute on function public.convert_quotation_to_sales_order(uuid) to authenticated;
