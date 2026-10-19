begin;

alter table public.items
    add column unit_id uuid;

alter table public.items
    add constraint items_org_unit_fk
    foreign key (org_id, unit_id)
    references public.units (org_id, id);

create index idx_items_unit
    on public.items (org_id, unit_id);

commit;