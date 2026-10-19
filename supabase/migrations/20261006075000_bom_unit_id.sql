begin;

alter table public.bom
    add column unit_id uuid;

alter table public.bom
    add constraint bom_org_unit_fk
    foreign key (org_id, unit_id)
    references public.units (org_id, id);

create index idx_bom_unit
    on public.bom (org_id, unit_id);

commit;