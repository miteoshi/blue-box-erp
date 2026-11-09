-- ─────────────────────────────────────────────────────────────
-- Atomic production workflow
--
-- Production orders used to be driven by several separate requests
-- from the browser:
--   create   → header, finished-goods line, then one reserve call per
--              raw material (a failure left a half-reserved order)
--   start    → consume each 'active' reservation, then set status
--              (a failure after consuming left the order 'pending' with
--              its materials gone; retry said "no reserved materials";
--              'partially_consumed' reservations were silently skipped)
--   complete → produce each line, then set status (a retry after a
--              partial failure produced the finished goods twice)
--   cancel   → did not exist; reservations stayed held
--
-- Each function below runs in ONE transaction and locks the order row,
-- so it either fully succeeds or changes nothing, and two clicks can't
-- both act on the same order.
--
-- Roles mirror the production_orders RLS policy
-- (admin / manager / production); cancel is admin / manager only.
-- ─────────────────────────────────────────────────────────────

-- ── Create + reserve raw materials ───────────────────────────
-- p_materials: [{ "item_id": uuid, "qty": number }, ...]  (total qty for the order)
create or replace function public.create_production_order(
  p_finished_item_id uuid,
  p_qty numeric,
  p_materials jsonb,
  p_target_date date default null,
  p_notes text default null,
  p_expiry_hours integer default 168
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_user uuid := auth.uid();
  v_item public.items;
  v_po_id uuid;
  v_po_no text;
  v_mat record;
  v_count integer := 0;
begin
  perform public.assert_my_role('admin', 'manager', 'production');

  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = '22023';
  end if;

  select * into v_item
  from public.items
  where id = p_finished_item_id and org_id = v_org;

  if not found then
    raise exception 'Finished item not found' using errcode = 'P0002';
  end if;

  if not v_item.is_manufactured then
    raise exception 'Item % is not marked as manufactured', v_item.item_code using errcode = '22023';
  end if;

  if p_materials is null or jsonb_typeof(p_materials) <> 'array' or jsonb_array_length(p_materials) = 0 then
    raise exception 'At least one raw material is required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_materials) as x(item_id uuid, qty numeric)
    where x.item_id is null or x.qty is null or x.qty <= 0
  ) then
    raise exception 'Every raw material needs an item and a quantity greater than zero' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_materials) as x(item_id uuid, qty numeric)
    where x.item_id = p_finished_item_id
  ) then
    raise exception 'An item cannot be a raw material of itself' using errcode = '22023';
  end if;

  v_po_no := public.next_prd_no(v_org);

  insert into public.production_orders (org_id, po_number, so_id, status, target_date, notes, created_by)
  values (v_org, v_po_no, null, 'pending', p_target_date, nullif(trim(p_notes), ''), v_user)
  returning id into v_po_id;

  -- Line triggers verify the item and unit belong to this organization.
  insert into public.production_order_items (production_order_id, item_id, qty_required, unit_id)
  values (v_po_id, v_item.id, p_qty, v_item.unit_id);

  -- Same item listed twice → one reservation for the total.
  -- Ordered by item_id for a stable lock order. reserve_inventory()
  -- checks the item belongs to this org and raises (rolling everything
  -- back) if stock is short.
  for v_mat in
    select x.item_id, sum(x.qty) as qty
    from jsonb_to_recordset(p_materials) as x(item_id uuid, qty numeric)
    group by x.item_id
    order by x.item_id
  loop
    perform public.reserve_inventory(
      gen_random_uuid(), v_mat.item_id, v_mat.qty, 'production_order', v_po_id,
      p_expiry_hours,
      'Reserved for ' || v_po_no || ' — producing ' || p_qty || ' × ' || v_item.name
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'id', v_po_id,
    'po_number', v_po_no,
    'materials_reserved', v_count
  );
end;
$function$;

-- ── Start: consume raw materials ─────────────────────────────
create or replace function public.start_production_order(p_production_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_po public.production_orders;
  v_res record;
  v_count integer := 0;
  v_note text;
begin
  perform public.assert_my_role('admin', 'manager', 'production');

  select * into v_po
  from public.production_orders
  where id = p_production_order_id and org_id = v_org
  for update;

  if not found then
    raise exception 'Production order not found' using errcode = 'P0002';
  end if;

  if v_po.status <> 'pending' then
    raise exception 'Only pending orders can be started (% is %)', v_po.po_number, v_po.status
      using errcode = 'P0008';
  end if;

  v_note := 'Consumed on start — ' || v_po.po_number;

  -- Every raw material planned for this order, whatever happened to its
  -- reservation since:
  --   active / partially_consumed → consume what is still reserved
  --   expired                     → reservation lapsed; take the same qty
  --                                 from available stock (fails cleanly if
  --                                 there isn't enough)
  for v_res in
    select id, item_id, status,
           qty_reserved - qty_consumed - qty_released as remaining,
           qty_reserved - qty_consumed as planned_unconsumed
    from public.stock_reservations
    where org_id = v_org
      and ref_type = 'production_order'
      and ref_id = p_production_order_id
      and status in ('active', 'partially_consumed', 'expired')
    order by item_id, created_at
  loop
    if v_res.status in ('active', 'partially_consumed') and v_res.remaining > 0 then
      perform public.consume_inventory(
        gen_random_uuid(), v_res.item_id, v_res.remaining, v_res.id,
        'production_order', p_production_order_id, v_note
      );
      v_count := v_count + 1;
    elsif v_res.status = 'expired' and v_res.planned_unconsumed > 0 then
      perform public.consume_inventory(
        gen_random_uuid(), v_res.item_id, v_res.planned_unconsumed, null,
        'production_order', p_production_order_id, v_note || ' (reservation had expired)'
      );
      v_count := v_count + 1;
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'No raw materials are recorded for %; nothing to consume', v_po.po_number
      using errcode = 'P0008';
  end if;

  update public.production_orders
  set status = 'in_progress',
      start_date = current_date
  where id = p_production_order_id;

  return jsonb_build_object(
    'success', true,
    'id', p_production_order_id,
    'po_number', v_po.po_number,
    'materials_consumed', v_count
  );
end;
$function$;

-- ── Complete: add finished goods to stock ────────────────────
create or replace function public.complete_production_order(p_production_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_po public.production_orders;
  v_line record;
  v_produced numeric := 0;
begin
  perform public.assert_my_role('admin', 'manager', 'production');

  select * into v_po
  from public.production_orders
  where id = p_production_order_id and org_id = v_org
  for update;

  if not found then
    raise exception 'Production order not found' using errcode = 'P0002';
  end if;

  if v_po.status <> 'in_progress' then
    raise exception 'Only in-progress orders can be completed (% is %)', v_po.po_number, v_po.status
      using errcode = 'P0008';
  end if;

  -- Only what has not been produced yet, so this can never double-count.
  for v_line in
    select id, item_id, qty_required - coalesce(qty_produced, 0) as to_produce
    from public.production_order_items
    where production_order_id = p_production_order_id
    order by item_id
    for update
  loop
    if v_line.to_produce > 0 then
      perform public.produce_inventory(
        gen_random_uuid(), v_line.item_id, v_line.to_produce,
        'production_order', p_production_order_id,
        'Completed — ' || v_po.po_number
      );
      v_produced := v_produced + v_line.to_produce;
    end if;

    update public.production_order_items
    set qty_produced = qty_required
    where id = v_line.id;
  end loop;

  update public.production_orders
  set status = 'completed',
      completed_date = current_date
  where id = p_production_order_id;

  return jsonb_build_object(
    'success', true,
    'id', p_production_order_id,
    'po_number', v_po.po_number,
    'qty_produced', v_produced
  );
end;
$function$;

-- ── Cancel: release reserved materials ───────────────────────
create or replace function public.cancel_production_order(p_production_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_po public.production_orders;
  v_res record;
  v_count integer := 0;
begin
  perform public.assert_my_role('admin', 'manager');

  select * into v_po
  from public.production_orders
  where id = p_production_order_id and org_id = v_org
  for update;

  if not found then
    raise exception 'Production order not found' using errcode = 'P0002';
  end if;

  -- Once started, raw materials have been consumed; cancelling would
  -- silently lose them, so that needs a stock adjustment instead.
  if v_po.status not in ('pending', 'on_hold') then
    raise exception 'Only pending or on-hold orders can be cancelled (% is %)', v_po.po_number, v_po.status
      using errcode = 'P0008';
  end if;

  for v_res in
    select id
    from public.stock_reservations
    where org_id = v_org
      and ref_type = 'production_order'
      and ref_id = p_production_order_id
      and status in ('active', 'partially_consumed')
    order by item_id, created_at
  loop
    perform public.release_inventory(gen_random_uuid(), v_res.id, null, 'Production order cancelled — ' || v_po.po_number);
    v_count := v_count + 1;
  end loop;

  update public.production_orders
  set status = 'cancelled'
  where id = p_production_order_id;

  return jsonb_build_object(
    'success', true,
    'id', p_production_order_id,
    'po_number', v_po.po_number,
    'reservations_released', v_count
  );
end;
$function$;

-- ── Privileges ───────────────────────────────────────────────
revoke execute on function public.create_production_order(uuid, numeric, jsonb, date, text, integer) from public, anon;
revoke execute on function public.start_production_order(uuid) from public, anon;
revoke execute on function public.complete_production_order(uuid) from public, anon;
revoke execute on function public.cancel_production_order(uuid) from public, anon;

grant execute on function public.create_production_order(uuid, numeric, jsonb, date, text, integer) to authenticated;
grant execute on function public.start_production_order(uuid) to authenticated;
grant execute on function public.complete_production_order(uuid) to authenticated;
grant execute on function public.cancel_production_order(uuid) to authenticated;
