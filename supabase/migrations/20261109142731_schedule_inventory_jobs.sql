-- ─────────────────────────────────────────────────────────────
-- Schedule inventory maintenance with pg_cron
--
-- The reconcile and expire-reservations Edge Functions were never
-- scheduled (no invocations in the logs), so expired reservations kept
-- holding stock and balances were never reconciled. These jobs run the
-- same SQL functions directly inside the database instead — no HTTP
-- call, no service-role key stored anywhere.
--
--   bluebox-expire-reservations   hourly at :07 UTC
--   bluebox-reconcile-inventory   daily at 20:30 UTC (02:00 IST)
--
-- reconcile_inventory_balance() treats a call with no JWT at all as a
-- system call. Every request through the Supabase API carries a JWT
-- role (anon / authenticated / service_role), so a missing role only
-- happens on a direct database connection (pg_cron, SQL editor,
-- migrations) — which is already fully privileged.
-- ─────────────────────────────────────────────────────────────

create extension if not exists pg_cron;

create or replace function public.reconcile_inventory_balance()
returns table(item_id uuid, old_qty numeric, new_qty numeric, diff numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- service_role (Edge Function) or no JWT at all (pg_cron / direct DB):
  -- reconcile every organization.
  v_all_orgs boolean := coalesce(auth.role(), 'system') in ('service_role', 'system');
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

-- Re-running this migration replaces the jobs instead of duplicating them.
select cron.unschedule(jobid)
from cron.job
where jobname in ('bluebox-expire-reservations', 'bluebox-reconcile-inventory');

select cron.schedule(
  'bluebox-expire-reservations',
  '7 * * * *',
  $$select public.expire_stale_reservations()$$
);

select cron.schedule(
  'bluebox-reconcile-inventory',
  '30 20 * * *',
  $$select count(*) from public.reconcile_inventory_balance()$$
);
