-- ─────────────────────────────────────────────────────────────
-- Security hardening
--
-- 1. handle_new_user: org_id is taken ONLY from app_metadata (server
--    controlled). Previously it came from user_metadata, which any
--    signUp() caller can set → anyone could join any organization.
-- 2. create_organization: requires a signed-in user, locks the caller's
--    profile row (no double-create race) and fails if no profile exists.
-- 3. next_org_seq: signed-in callers can only advance their own org's
--    document sequences.
-- 4. assert_my_role(): shared role guard. Every stock-mutating RPC now
--    checks the caller's role (viewers could previously create stock).
-- 5. Idempotency cache lookups are scoped to the caller's org so a
--    cached result can never be returned across tenants.
-- 6. reconcile_inventory_balance: service_role reconciles every org
--    (the nightly Edge Function previously did nothing), admins reconcile
--    their own org, and old_qty / diff are now reported correctly.
-- 7. EXECUTE privileges: nothing is callable by anon except the
--    harmless my_org / my_role / org_is_active helpers used in RLS;
--    internal helpers and trigger functions are not callable over the API.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Signup trigger ────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name, role, org_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'viewer',
    -- app_metadata can only be written with the service role key
    nullif(new.raw_app_meta_data->>'org_id', '')::uuid
  );
  return new;
end;
$function$;

-- ── 2. Organization creation ─────────────────────────────────
create or replace function public.create_organization(
  p_name text,
  p_template text default null::text,
  p_categories jsonb default '[]'::jsonb,
  p_material_types jsonb default '[]'::jsonb,
  p_units jsonb default '[]'::jsonb,
  p_include_sap_defaults boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_org_id uuid;
    v_existing uuid;
    v_uid uuid := auth.uid();
begin
    if v_uid is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    if nullif(trim(p_name), '') is null then
        raise exception 'Organization name is required' using errcode = '22023';
    end if;

    -- Lock the caller's profile so two concurrent calls cannot both
    -- create an organization for the same user.
    select org_id
    into v_existing
    from public.profiles
    where id = v_uid
    for update;

    if not found then
        raise exception 'Profile not found for current user' using errcode = 'P0002';
    end if;

    if v_existing is not null then
        raise exception 'User already belongs to an organization'
            using errcode = 'P0006';
    end if;

    insert into public.organizations (name)
    values (trim(p_name))
    returning id into v_org_id;

    update public.profiles
    set org_id = v_org_id,
        role = 'admin'
    where id = v_uid;

    -- Categories supplied by the selected template / SAP defaults
    if jsonb_array_length(coalesce(p_categories, '[]'::jsonb)) > 0 then
        insert into public.item_categories (org_id, code, name, description)
        select
            v_org_id,
            nullif(trim(x->>'code'), ''),
            nullif(trim(x->>'name'), ''),
            nullif(trim(x->>'description'), '')
        from jsonb_array_elements(p_categories) x
        where nullif(trim(x->>'code'), '') is not null
          and nullif(trim(x->>'name'), '') is not null
        on conflict (org_id, code) do nothing;
    end if;

    -- Material types supplied by the selected template / SAP defaults
    if jsonb_array_length(coalesce(p_material_types, '[]'::jsonb)) > 0 then
        insert into public.material_types (org_id, code, name, description)
        select
            v_org_id,
            nullif(trim(x->>'code'), ''),
            nullif(trim(x->>'name'), ''),
            nullif(trim(x->>'description'), '')
        from jsonb_array_elements(p_material_types) x
        where nullif(trim(x->>'code'), '') is not null
          and nullif(trim(x->>'name'), '') is not null
        on conflict (org_id, code) do nothing;
    end if;

    -- Units supplied by SAP global defaults
    if jsonb_array_length(coalesce(p_units, '[]'::jsonb)) > 0 then
        insert into public.units (org_id, code, name, description)
        select
            v_org_id,
            nullif(trim(x->>'code'), ''),
            nullif(trim(x->>'name'), ''),
            nullif(trim(x->>'description'), '')
        from jsonb_array_elements(p_units) x
        where nullif(trim(x->>'code'), '') is not null
          and nullif(trim(x->>'name'), '') is not null
        on conflict (org_id, code) do nothing;
    end if;

    return v_org_id;
end;
$function$;

-- ── 3. Document sequences ────────────────────────────────────
create or replace function public.next_org_seq(p_org_id uuid, p_seq_name text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_val bigint;
begin
  -- Signed-in users may only advance their own organization's sequences.
  -- (service_role / direct DB access has no auth.uid() and is trusted.)
  if auth.uid() is not null and p_org_id is distinct from public.my_org() then
    raise exception 'Cannot allocate document numbers for another organization'
      using errcode = '42501';
  end if;

  insert into public.org_sequences (org_id, seq_name, current_value)
  values (p_org_id, p_seq_name, 1)
  on conflict (org_id, seq_name)
  do update set current_value = public.org_sequences.current_value + 1
  returning current_value into v_val;
  return v_val;
end;
$function$;

-- ── 4. Role guard ────────────────────────────────────────────
create or replace function public.assert_my_role(variadic p_roles public.user_role[])
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and is_active;

  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'Unauthorized: your role (%) cannot perform this action',
      coalesce(v_role::text, 'none')
      using errcode = 'P0005';
  end if;
end;
$function$;

-- ── 5. Inventory RPCs: org-scoped idempotency + role checks ──

create or replace function public.adjust_inventory(p_operation_id uuid, p_item_id uuid, p_delta numeric, p_reason text, p_ref_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cached jsonb; v_balance public.inventory_balance; v_movement_id uuid;
  v_move_type movement_type; v_qty numeric; v_result jsonb; v_user uuid := auth.uid();
  v_org uuid := public.my_org();
begin
  select result_payload into v_cached from public.inventory_ops_log
  where operation_id = p_operation_id and org_id = v_org;
  if found then return v_cached; end if;

  if p_delta is null or p_delta = 0 then raise exception 'Adjustment delta cannot be zero' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  perform public.assert_my_role('admin', 'store', 'manager');

  v_balance := public.lock_inventory_balance(p_item_id);

  if p_delta > 0 then
    v_move_type := 'adjustment_in'; v_qty := p_delta;
  else
    v_move_type := 'adjustment_out'; v_qty := abs(p_delta);
    perform public.validate_stock_sufficiency(p_item_id, v_qty, v_balance);
  end if;

  insert into public.stock_movements(item_id, org_id, movement_type, qty, ref_type, ref_id, notes, created_by)
  values (p_item_id, v_org, v_move_type, v_qty, 'manual_adjustment', p_ref_id, p_reason, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'movement_id', v_movement_id,
      'item_id', p_item_id, 'delta', p_delta, 'movement_type', v_move_type);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, result_movement_id, result_payload, created_by)
  values (p_operation_id, v_org, 'adjust', p_item_id, p_delta, 'manual_adjustment', v_movement_id, v_result, v_user);

  return v_result;
end;
$function$;

create or replace function public.receive_inventory(p_operation_id uuid, p_item_id uuid, p_qty numeric, p_rate numeric, p_ref_type text, p_ref_id uuid, p_batch_no text default null::text, p_notes text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cached jsonb; v_movement_id uuid; v_result jsonb; v_user uuid := auth.uid();
  v_org uuid := public.my_org();
begin
  select result_payload into v_cached from public.inventory_ops_log
  where operation_id = p_operation_id and org_id = v_org;
  if found then return v_cached; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be positive for receive_inventory' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  perform public.assert_my_role('admin', 'manager', 'store');
  perform public.lock_inventory_balance(p_item_id);

  insert into public.stock_movements(item_id, org_id, movement_type, qty, rate_at_time, ref_type, ref_id, batch_no, notes, created_by)
  values (p_item_id, v_org, 'inbound', p_qty, p_rate, p_ref_type, p_ref_id, p_batch_no, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'movement_id', v_movement_id,
      'item_id', p_item_id, 'qty_received', p_qty);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_movement_id, result_payload, created_by)
  values (p_operation_id, v_org, 'receive', p_item_id, p_qty, p_ref_type, p_ref_id, v_movement_id, v_result, v_user);

  return v_result;
end;
$function$;

create or replace function public.reserve_inventory(p_operation_id uuid, p_item_id uuid, p_qty numeric, p_ref_type text, p_ref_id uuid, p_expiry_hours integer default 72, p_notes text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cached jsonb; v_balance public.inventory_balance; v_reservation_id uuid; v_result jsonb;
  v_user uuid := auth.uid(); v_org uuid := public.my_org();
  v_expires_at timestamptz;
begin
  select result_payload into v_cached from public.inventory_ops_log
  where operation_id = p_operation_id and org_id = v_org;
  if found then return v_cached; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be positive for reserve_inventory' using errcode = 'P0002'; end if;
  if p_expiry_hours is null or p_expiry_hours <= 0 then raise exception 'expiry hours must be positive' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  perform public.assert_my_role('admin', 'manager', 'sales', 'store', 'production');

  v_balance := public.lock_inventory_balance(p_item_id);
  perform public.validate_stock_sufficiency(p_item_id, p_qty, v_balance);

  v_expires_at := now() + make_interval(hours => p_expiry_hours);

  insert into public.stock_reservations(item_id, org_id, qty_reserved, ref_type, ref_id, reservation_expiry, notes, created_by)
  values (p_item_id, v_org, p_qty, p_ref_type, p_ref_id, v_expires_at, p_notes, v_user)
  returning id into v_reservation_id;

  update public.inventory_balance set reserved_qty = reserved_qty + p_qty, updated_at = now() where item_id = p_item_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'reservation_id', v_reservation_id,
      'item_id', p_item_id, 'qty_reserved', p_qty, 'expires_at', v_expires_at);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_payload, created_by)
  values (p_operation_id, v_org, 'reserve', p_item_id, p_qty, p_ref_type, p_ref_id, v_result, v_user);

  return v_result;
end;
$function$;

create or replace function public.release_inventory(p_operation_id uuid, p_reservation_id uuid, p_qty_to_release numeric default null::numeric, p_notes text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cached jsonb; v_res public.stock_reservations; v_qty_release numeric; v_remaining numeric;
  v_result jsonb; v_user uuid := auth.uid(); v_org uuid := public.my_org();
begin
  select result_payload into v_cached from public.inventory_ops_log
  where operation_id = p_operation_id and org_id = v_org;
  if found then return v_cached; end if;

  perform public.assert_my_role('admin', 'manager', 'sales', 'store', 'production');

  select * into v_res from public.stock_reservations
  where id = p_reservation_id and org_id = v_org and status in ('active','partially_consumed')
  for update nowait;

  if not found then
    raise exception 'Reservation % not found or not in releasable status', p_reservation_id using errcode = 'P0003';
  end if;

  perform public.lock_inventory_balance(v_res.item_id);

  v_remaining := v_res.qty_reserved - v_res.qty_consumed - v_res.qty_released;
  v_qty_release := coalesce(p_qty_to_release, v_remaining);

  if v_qty_release <= 0 then
    raise exception 'Release qty must be positive' using errcode = 'P0002';
  end if;

  if v_qty_release > v_remaining then
    raise exception 'Release qty (%) exceeds remaining reservation (%)', v_qty_release, v_remaining using errcode = 'P0004';
  end if;

  update public.stock_reservations
  set qty_released = qty_released + v_qty_release,
      status = case when (qty_consumed + qty_released + v_qty_release) = qty_reserved then 'released'::reservation_status else 'partially_consumed'::reservation_status end,
      updated_at = now()
  where id = p_reservation_id;

  update public.inventory_balance set reserved_qty = greatest(0, reserved_qty - v_qty_release), updated_at = now() where item_id = v_res.item_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'reservation_id', p_reservation_id,
      'qty_released', v_qty_release, 'item_id', v_res.item_id);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_payload, created_by)
  values (p_operation_id, v_res.org_id, 'release', v_res.item_id, v_qty_release, v_res.ref_type, v_res.ref_id, v_result, v_user);

  return v_result;
end;
$function$;

create or replace function public.consume_inventory(p_operation_id uuid, p_item_id uuid, p_qty numeric, p_reservation_id uuid default null::uuid, p_ref_type text default 'production_order'::text, p_ref_id uuid default null::uuid, p_notes text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cached jsonb; v_balance public.inventory_balance; v_res public.stock_reservations;
  v_movement_id uuid; v_result jsonb; v_user uuid := auth.uid(); v_org uuid := public.my_org();
  v_remaining numeric;
begin
  select result_payload into v_cached from public.inventory_ops_log
  where operation_id = p_operation_id and org_id = v_org;
  if found then return v_cached; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be positive for consume_inventory' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  perform public.assert_my_role('admin', 'manager', 'production', 'store');
  v_balance := public.lock_inventory_balance(p_item_id);

  if p_reservation_id is not null then
    select * into v_res from public.stock_reservations
    where id = p_reservation_id and item_id = p_item_id and org_id = v_org and status in ('active','partially_consumed')
    for update nowait;

    if not found then
      raise exception 'Reservation % not found or already consumed', p_reservation_id using errcode = 'P0003';
    end if;

    v_remaining := v_res.qty_reserved - v_res.qty_consumed - v_res.qty_released;
    if p_qty > v_remaining then
      raise exception 'Consume qty (%) exceeds remaining reservation (%)', p_qty, v_remaining using errcode = 'P0004';
    end if;

    update public.stock_reservations
    set qty_consumed = qty_consumed + p_qty,
        status = case when (qty_consumed + qty_released + p_qty) = qty_reserved then 'consumed'::reservation_status else 'partially_consumed'::reservation_status end,
        updated_at = now()
    where id = p_reservation_id;

    update public.inventory_balance set reserved_qty = greatest(0, reserved_qty - p_qty), updated_at = now() where item_id = p_item_id;
  else
    perform public.validate_stock_sufficiency(p_item_id, p_qty, v_balance);
  end if;

  insert into public.stock_movements(item_id, org_id, movement_type, qty, ref_type, ref_id, notes, created_by)
  values (p_item_id, v_org, 'consumed', p_qty, p_ref_type, p_ref_id, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'movement_id', v_movement_id,
      'item_id', p_item_id, 'qty_consumed', p_qty, 'reservation_id', p_reservation_id);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_movement_id, result_payload, created_by)
  values (p_operation_id, v_org, 'consume', p_item_id, p_qty, p_ref_type, p_ref_id, v_movement_id, v_result, v_user);

  return v_result;
end;
$function$;

create or replace function public.produce_inventory(p_operation_id uuid, p_item_id uuid, p_qty numeric, p_ref_type text default 'production_order'::text, p_ref_id uuid default null::uuid, p_notes text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cached jsonb; v_movement_id uuid; v_result jsonb; v_user uuid := auth.uid(); v_org uuid := public.my_org();
begin
  select result_payload into v_cached from public.inventory_ops_log
  where operation_id = p_operation_id and org_id = v_org;
  if found then return v_cached; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be positive for produce_inventory' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  perform public.assert_my_role('admin', 'manager', 'production', 'store');
  perform public.lock_inventory_balance(p_item_id);

  insert into public.stock_movements(item_id, org_id, movement_type, qty, ref_type, ref_id, notes, created_by)
  values (p_item_id, v_org, 'produced', p_qty, p_ref_type, p_ref_id, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'movement_id', v_movement_id,
      'item_id', p_item_id, 'qty_produced', p_qty);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_movement_id, result_payload, created_by)
  values (p_operation_id, v_org, 'produce', p_item_id, p_qty, p_ref_type, p_ref_id, v_movement_id, v_result, v_user);

  return v_result;
end;
$function$;

create or replace function public.dispatch_inventory(p_operation_id uuid, p_item_id uuid, p_qty numeric, p_rate numeric, p_reservation_id uuid default null::uuid, p_ref_type text default 'delivery_challan'::text, p_ref_id uuid default null::uuid, p_notes text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cached jsonb; v_balance public.inventory_balance; v_res public.stock_reservations;
  v_movement_id uuid; v_result jsonb; v_user uuid := auth.uid(); v_org uuid := public.my_org();
  v_remaining numeric;
begin
  select result_payload into v_cached from public.inventory_ops_log
  where operation_id = p_operation_id and org_id = v_org;
  if found then return v_cached; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be positive for dispatch_inventory' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  perform public.assert_my_role('admin', 'manager', 'store');
  v_balance := public.lock_inventory_balance(p_item_id);

  if p_reservation_id is not null then
    select * into v_res from public.stock_reservations
    where id = p_reservation_id and item_id = p_item_id and org_id = v_org and status in ('active','partially_consumed')
    for update nowait;

    if not found then
      raise exception 'Reservation % not active for dispatch', p_reservation_id using errcode = 'P0003';
    end if;

    v_remaining := v_res.qty_reserved - v_res.qty_consumed - v_res.qty_released;
    if p_qty > v_remaining then
      raise exception 'Dispatch qty (%) exceeds reservation remaining (%)', p_qty, v_remaining using errcode = 'P0004';
    end if;

    update public.stock_reservations
    set qty_consumed = qty_consumed + p_qty,
        status = case when (qty_consumed + qty_released + p_qty) = qty_reserved then 'consumed'::reservation_status else 'partially_consumed'::reservation_status end,
        updated_at = now()
    where id = p_reservation_id;

    update public.inventory_balance set reserved_qty = greatest(0, reserved_qty - p_qty), updated_at = now() where item_id = p_item_id;
  else
    perform public.validate_stock_sufficiency(p_item_id, p_qty, v_balance);
  end if;

  insert into public.stock_movements(item_id, org_id, movement_type, qty, rate_at_time, ref_type, ref_id, notes, created_by)
  values (p_item_id, v_org, 'sold', p_qty, p_rate, p_ref_type, p_ref_id, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'movement_id', v_movement_id,
      'item_id', p_item_id, 'qty_dispatched', p_qty, 'reservation_id', p_reservation_id);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_movement_id, result_payload, created_by)
  values (p_operation_id, v_org, 'dispatch', p_item_id, p_qty, p_ref_type, p_ref_id, v_movement_id, v_result, v_user);

  return v_result;
end;
$function$;

-- ── 6. Reconciliation ────────────────────────────────────────
create or replace function public.reconcile_inventory_balance()
returns table(item_id uuid, old_qty numeric, new_qty numeric, diff numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- The scheduled Edge Function calls this with the service role key and
  -- has no auth.uid(); it reconciles every organization.
  v_all_orgs boolean := coalesce(auth.role(), '') = 'service_role';
  v_org uuid := public.my_org();
begin
  if not v_all_orgs then
    perform public.assert_my_role('admin');
  end if;

  return query
  with ledger_totals as (
    select m.item_id as l_item_id,
      greatest(0, sum(case when m.movement_type in ('inbound','produced','adjustment_in','returned_client')
                           then m.qty else -m.qty end)) as true_qty
    from public.stock_movements m
    where v_all_orgs or m.org_id = v_org
    group by m.item_id
  ),
  before_update as (
    -- CTEs see the snapshot taken before the UPDATE below, so this is the
    -- real pre-reconciliation quantity.
    select ib.item_id as b_item_id, ib.current_qty as b_qty
    from public.inventory_balance ib
    join ledger_totals lt on lt.l_item_id = ib.item_id
    where v_all_orgs or ib.org_id = v_org
  ),
  updates as (
    update public.inventory_balance ib
    set current_qty = lt.true_qty, updated_at = now()
    from ledger_totals lt
    where ib.item_id = lt.l_item_id
      and (v_all_orgs or ib.org_id = v_org)
      and abs(ib.current_qty - lt.true_qty) > 0.0001
    returning ib.item_id as u_item_id, ib.current_qty as u_qty
  )
  select u.u_item_id, b.b_qty, u.u_qty, u.u_qty - b.b_qty
  from updates u
  join before_update b on b.b_item_id = u.u_item_id;
end;
$function$;

-- ── 7. EXECUTE privileges ────────────────────────────────────

-- Nothing in public is callable by anon/PUBLIC by default …
revoke execute on all functions in schema public from public, anon;

-- … except the read-only helpers referenced by RLS policies (they return
-- NULL for anon, so table reads by anon keep returning zero rows instead
-- of erroring).
grant execute on function public.my_org()        to anon, authenticated, service_role;
grant execute on function public.my_role()       to anon, authenticated, service_role;
grant execute on function public.org_is_active() to anon, authenticated, service_role;

-- Internal helpers and trigger functions: not callable over the API.
-- (Trigger functions do not need EXECUTE to fire; SECURITY DEFINER
-- callers run as the owner.)
revoke execute on function public.assert_item_in_my_org(uuid)                                     from authenticated;
revoke execute on function public.assert_my_role(public.user_role[])                              from authenticated;
revoke execute on function public.lock_inventory_balance(uuid)                                    from authenticated;
revoke execute on function public.validate_stock_sufficiency(uuid, numeric, public.inventory_balance) from authenticated;
revoke execute on function public.expire_stale_reservations()                                     from authenticated;
revoke execute on function public.handle_new_user()                                               from authenticated;
revoke execute on function public.sync_inventory_balance()                                        from authenticated;
revoke execute on function public.write_audit_log()                                               from authenticated;
revoke execute on function public.set_updated_at()                                                from authenticated;
revoke execute on function public.validate_line_item_org()                                        from authenticated;
revoke execute on function public.validate_line_unit_org()                                        from authenticated;
revoke execute on function public.validate_challan_so_line_org()                                  from authenticated;

-- The scheduled Edge Functions use the service role.
grant execute on function public.expire_stale_reservations()   to service_role;
grant execute on function public.reconcile_inventory_balance() to service_role;

-- Future functions created by postgres in public are no longer
-- executable by anon unless explicitly granted.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
