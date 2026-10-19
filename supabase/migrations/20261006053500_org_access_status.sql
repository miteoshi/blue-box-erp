begin;

alter table public.organizations
    add column access_status text not null default 'active'
        check (access_status in ('active', 'suspended')),
    add column suspended_reason text,
    add column suspended_at timestamptz;

commit;