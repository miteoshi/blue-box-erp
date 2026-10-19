-- =========================================================================
-- Blue Box ERP — Manual org access switch
-- Simple, no Razorpay/plans dependency. Toggle organizations.access_status
-- directly in the Supabase Table Editor, or via the SQL commands below.
-- =========================================================================

begin;

alter table "public"."organizations"
    add column "access_status" text not null default 'active'
        check ("access_status" in ('active', 'suspended')),
    add column "suspended_reason" text,
    add column "suspended_at" timestamp with time zone;

-- Fast org-scoped check, used in the dashboard layout gate below.
create or replace function "public"."org_is_active"() returns boolean
    language sql stable security definer set search_path to public as
$$
  select access_status = 'active'
  from public.organizations
  where id = public.my_org()
$$;
alter function "public"."org_is_active"() owner to "postgres";
grant execute on function "public"."org_is_active"() to authenticated;

commit;

-- =========================================================================
-- Usage — run these directly in the Supabase SQL Editor whenever you need to
-- cut off or restore an org's access. No app redeploy needed.
-- =========================================================================

-- Suspend an org (replace the id and reason):
-- update public.organizations
-- set access_status = 'suspended', suspended_reason = 'Payment overdue', suspended_at = now()
-- where id = '<org-id>';

-- Restore an org:
-- update public.organizations
-- set access_status = 'active', suspended_reason = null, suspended_at = null
-- where id = '<org-id>';

-- Or just toggle it visually: Supabase Dashboard → Table Editor → organizations
-- → find the row → click the access_status cell → pick 'active' or 'suspended'.