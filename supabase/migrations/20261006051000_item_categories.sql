begin;

-- ============================================================
-- Item Categories — Per Organization
-- ============================================================

create table public.item_categories (
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

    constraint item_categories_org_code_key
        unique (org_id, code),

    constraint item_categories_org_name_key
        unique (org_id, name),

    constraint item_categories_org_id_id_key
        unique (org_id, id)
);

create index idx_item_categories_org
    on public.item_categories (org_id);

create trigger trg_upd_item_categories
    before update on public.item_categories
    for each row
    execute function public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================

alter table public.item_categories enable row level security;

create policy "members read own item categories"
    on public.item_categories
    for select
    using (
        org_id = public.my_org()
    );

create policy "managers insert own item categories"
    on public.item_categories
    for insert
    with check (
        org_id = public.my_org()
        and public.my_role() in ('admin', 'manager')
    );

create policy "managers update own item categories"
    on public.item_categories
    for update
    using (
        org_id = public.my_org()
        and public.my_role() in ('admin', 'manager')
    )
    with check (
        org_id = public.my_org()
        and public.my_role() in ('admin', 'manager')
    );

create policy "managers delete own item categories"
    on public.item_categories
    for delete
    using (
        org_id = public.my_org()
        and public.my_role() in ('admin', 'manager')
    );

commit;