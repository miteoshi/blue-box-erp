begin;

create table public.units (
    id uuid primary key default extensions.uuid_generate_v4(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    code text not null,
    name text not null,
    description text,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint units_org_code_unique
        unique (org_id, code),

    constraint units_org_name_unique
        unique (org_id, name),

    constraint units_org_id_unique
        unique (org_id, id)
);

create index idx_units_org
    on public.units (org_id);

create index idx_units_active
    on public.units (org_id, is_active);

create trigger set_units_updated_at
before update on public.units
for each row
execute function public.set_updated_at();

alter table public.units enable row level security;

create policy "org members can view units"
on public.units
for select
using (org_id = public.my_org());

create policy "org admins and managers can insert units"
on public.units
for insert
with check (
    org_id = public.my_org()
    and public.my_role() = any (
        array['admin', 'manager']::public.user_role[]
    )
);

create policy "org admins and managers can update units"
on public.units
for update
using (
    org_id = public.my_org()
    and public.my_role() = any (
        array['admin', 'manager']::public.user_role[]
    )
)
with check (
    org_id = public.my_org()
    and public.my_role() = any (
        array['admin', 'manager']::public.user_role[]
    )
);

create policy "org admins and managers can delete units"
on public.units
for delete
using (
    org_id = public.my_org()
    and public.my_role() = any (
        array['admin', 'manager']::public.user_role[]
    )
);

commit;