-- ─────────────────────────────────────────────────────────────
-- Quotations + SO payments
--
-- 1. Approval could be bypassed. quotations RLS lets admin/manager/sales
--    write the row, so a sales user could set status = 'approved' on
--    their own quotation straight through the API (the UI only hides the
--    button). A BEFORE UPDATE guard now enforces the approval rules for
--    every write path, and set_quotation_status() performs the allowed
--    transitions and logs them (the old client-side approvals insert
--    failed silently for sales users and logged a submit as
--    'revision_requested').
-- 2. create_quotation(): header + lines in one transaction; totals are
--    computed from the lines in the database instead of trusted from the
--    browser.
-- 3. record_so_payment(): advance_paid/balance_due were computed in the
--    browser from a possibly stale copy (two payments recorded close
--    together lost one). Now an atomic increment, refused above the
--    balance due.
-- ─────────────────────────────────────────────────────────────

-- ── Guard: who may change a quotation's status, and how ──────
create or replace function public.guard_quotation_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role;
begin
  -- Direct DB access (migrations, SQL editor) has no auth.uid(): trusted.
  if new.status is not distinct from old.status or auth.uid() is null then
    return new;
  end if;

  select role into v_role from public.profiles where id = auth.uid();

  if old.status = 'converted' then
    raise exception 'A converted quotation cannot change status' using errcode = 'P0008';
  end if;

  if new.status in ('approved', 'rejected') then
    if v_role is null or v_role not in ('admin', 'manager') then
      raise exception 'Only admins and managers can approve or reject quotations' using errcode = 'P0005';
    end if;
    if old.status <> 'pending_approval' then
      raise exception 'Only quotations pending approval can be approved or rejected (this one is %)', old.status
        using errcode = 'P0008';
    end if;
  end if;

  if new.status = 'converted' and old.status <> 'approved' then
    raise exception 'Only approved quotations can be converted' using errcode = 'P0008';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_quotation_status on public.quotations;
create trigger trg_guard_quotation_status
  before update of status on public.quotations
  for each row execute function public.guard_quotation_status();

-- ── Create quotation (header + lines, totals from lines) ─────
-- p_lines: [{ "item_id", "unit_id", "qty", "unit_rate", "gst_percent"?, "description"? }]
create or replace function public.create_quotation(
  p_client_id uuid,
  p_lines jsonb,
  p_submit boolean default false,
  p_valid_until date default null,
  p_delivery_days integer default null,
  p_payment_terms text default null,
  p_transport_note text default null,
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
  v_qt_id uuid;
  v_qt_no text;
  v_subtotal numeric := 0;
  v_gst numeric := 0;
  v_count integer := 0;
  v_line record;
begin
  perform public.assert_my_role('admin', 'manager', 'sales');

  if not exists (select 1 from public.clients where id = p_client_id and org_id = v_org) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line is required' using errcode = '22023';
  end if;

  if p_delivery_days is not null and p_delivery_days < 0 then
    raise exception 'Delivery days cannot be negative' using errcode = '22023';
  end if;

  v_qt_no := public.next_qt_no(v_org);

  insert into public.quotations (
    org_id, quotation_no, created_by, client_id, valid_until, delivery_days,
    payment_terms, transport_note, notes, status, subtotal, gst_amount, total_amount
  )
  values (
    v_org, v_qt_no, v_user, p_client_id, p_valid_until, p_delivery_days,
    nullif(trim(p_payment_terms), ''), nullif(trim(p_transport_note), ''), nullif(trim(p_notes), ''),
    case when p_submit then 'pending_approval'::public.document_status else 'draft'::public.document_status end,
    0, 0, 0
  )
  returning id into v_qt_id;

  for v_line in
    select x.item_id, x.unit_id, x.qty, x.unit_rate,
           coalesce(nullif(x.gst_percent, ''), '18') as gst_percent,
           nullif(trim(x.description), '') as description,
           (x.ord - 1)::integer as sort_order
    from rows from (
      jsonb_to_recordset(p_lines)
        as (item_id uuid, unit_id uuid, qty numeric, unit_rate numeric, gst_percent text, description text)
    ) with ordinality as x(item_id, unit_id, qty, unit_rate, gst_percent, description, ord)
    order by x.ord
  loop
    if v_line.item_id is null or v_line.unit_id is null then
      raise exception 'Every line needs an item and a unit' using errcode = '22023';
    end if;
    if v_line.qty is null or v_line.qty <= 0 then
      raise exception 'All quantities must be greater than zero' using errcode = '22023';
    end if;
    if v_line.unit_rate is null or v_line.unit_rate < 0 then
      raise exception 'Rates cannot be negative' using errcode = '22023';
    end if;

    -- Line triggers verify the item and unit belong to this organization.
    insert into public.quotation_lines (
      quotation_id, item_id, description, qty, unit_id, unit_rate, gst_percent, sort_order
    )
    values (
      v_qt_id, v_line.item_id, v_line.description, v_line.qty, v_line.unit_id,
      v_line.unit_rate, v_line.gst_percent::public.gst_rate, v_line.sort_order
    );

    v_subtotal := v_subtotal + v_line.qty * v_line.unit_rate;
    v_gst := v_gst + v_line.qty * v_line.unit_rate * (v_line.gst_percent::numeric) / 100;
    v_count := v_count + 1;
  end loop;

  update public.quotations
  set subtotal = v_subtotal,
      gst_amount = v_gst,
      total_amount = v_subtotal + v_gst
  where id = v_qt_id;

  if p_submit then
    insert into public.approvals (org_id, ref_type, ref_id, action, actioned_by)
    values (v_org, 'quotation', v_qt_id, 'sent_for_approval', v_user);
  end if;

  return jsonb_build_object(
    'success', true,
    'id', v_qt_id,
    'quotation_no', v_qt_no,
    'status', case when p_submit then 'pending_approval' else 'draft' end,
    'lines', v_count,
    'total_amount', round(v_subtotal + v_gst, 2)
  );
end;
$function$;

-- ── Quotation status transitions ─────────────────────────────
--   draft            → pending_approval   admin / manager / sales
--   pending_approval → approved|rejected  admin / manager
create or replace function public.set_quotation_status(
  p_quotation_id uuid,
  p_status public.document_status,
  p_comments text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_user uuid := auth.uid();
  v_qt public.quotations;
  v_action text;
begin
  select * into v_qt
  from public.quotations
  where id = p_quotation_id and org_id = v_org
  for update;

  if not found then
    raise exception 'Quotation not found' using errcode = 'P0002';
  end if;

  if p_status = 'pending_approval' then
    perform public.assert_my_role('admin', 'manager', 'sales');
    if v_qt.status <> 'draft' then
      raise exception 'Only draft quotations can be submitted for approval (this one is %)', v_qt.status
        using errcode = 'P0008';
    end if;
    v_action := 'sent_for_approval';
    update public.quotations set status = 'pending_approval' where id = p_quotation_id;

  elsif p_status in ('approved', 'rejected') then
    perform public.assert_my_role('admin', 'manager');
    if v_qt.status <> 'pending_approval' then
      raise exception 'Only quotations pending approval can be approved or rejected (this one is %)', v_qt.status
        using errcode = 'P0008';
    end if;
    v_action := p_status::text;
    update public.quotations
    set status = p_status,
        approved_by = case when p_status = 'approved' then v_user else approved_by end,
        approved_at = case when p_status = 'approved' then now() else approved_at end
    where id = p_quotation_id;

  else
    raise exception 'Status % cannot be set directly', p_status using errcode = '22023';
  end if;

  insert into public.approvals (org_id, ref_type, ref_id, action, actioned_by, comments)
  values (v_org, 'quotation', p_quotation_id, v_action, v_user, nullif(trim(p_comments), ''));

  return jsonb_build_object('success', true, 'id', p_quotation_id, 'status', p_status);
end;
$function$;

-- ── SO payment (atomic) ──────────────────────────────────────
create or replace function public.record_so_payment(p_so_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.my_org();
  v_so public.sales_orders;
  v_balance numeric;
begin
  perform public.assert_my_role('admin', 'manager', 'sales');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero' using errcode = '22023';
  end if;

  select * into v_so
  from public.sales_orders
  where id = p_so_id and org_id = v_org
  for update;

  if not found then
    raise exception 'Sales order not found' using errcode = 'P0002';
  end if;

  if v_so.status = 'cancelled' then
    raise exception 'Cannot record a payment on a cancelled order' using errcode = 'P0008';
  end if;

  v_balance := v_so.total_amount - coalesce(v_so.advance_paid, 0);

  if p_amount > v_balance + 0.005 then
    raise exception 'Amount % exceeds the balance due (%)', p_amount, round(v_balance, 2) using errcode = 'P0009';
  end if;

  update public.sales_orders
  set advance_paid = coalesce(advance_paid, 0) + p_amount,
      balance_due = total_amount - (coalesce(advance_paid, 0) + p_amount)
  where id = p_so_id;

  return jsonb_build_object(
    'success', true,
    'so_id', p_so_id,
    'advance_paid', coalesce(v_so.advance_paid, 0) + p_amount,
    'balance_due', v_so.total_amount - (coalesce(v_so.advance_paid, 0) + p_amount)
  );
end;
$function$;

-- ── Privileges ───────────────────────────────────────────────
revoke execute on function public.guard_quotation_status() from public, anon, authenticated;
revoke execute on function public.create_quotation(uuid, jsonb, boolean, date, integer, text, text, text) from public, anon;
revoke execute on function public.set_quotation_status(uuid, public.document_status, text) from public, anon;
revoke execute on function public.record_so_payment(uuid, numeric) from public, anon;

grant execute on function public.create_quotation(uuid, jsonb, boolean, date, integer, text, text, text) to authenticated;
grant execute on function public.set_quotation_status(uuid, public.document_status, text) to authenticated;
grant execute on function public.record_so_payment(uuid, numeric) to authenticated;
