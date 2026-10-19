begin;

create table public.material_types (
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

    constraint material_types_org_code_unique
        unique (org_id, code),

    constraint material_types_org_name_unique
        unique (org_id, name),

    constraint material_types_org_id_unique
        unique (org_id, id)
);

create index idx_material_types_org
    on public.material_types (org_id);

create index idx_material_types_active
    on public.material_types (org_id, is_active);

create trigger set_material_types_updated_at
before update on public.material_types
for each row
execute function public.set_updated_at();

alter table public.material_types enable row level security;

create policy "org members can view material types"
on public.material_types
for select
using (
    org_id = public.my_org()
);

create policy "org admins and managers can insert material types"
on public.material_types
for insert
with check (
    org_id = public.my_org()
    and public.my_role() = any (
        array['admin', 'manager']::public.user_role[]
    )
);

create policy "org admins and managers can update material types"
on public.material_types
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

create policy "org admins and managers can delete material types"
on public.material_types
for delete
using (
    org_id = public.my_org()
    and public.my_role() = any (
        array['admin', 'manager']::public.user_role[]
    )
);

commit;