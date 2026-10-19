begin;

alter table public.delivery_challan_lines
    add column unit_id uuid;

alter table public.delivery_challan_lines
    add constraint delivery_challan_lines_unit_fk
    foreign key (unit_id)
    references public.units (id);

create index idx_delivery_challan_lines_unit
    on public.delivery_challan_lines (unit_id);

alter table public.delivery_challan_lines
    alter column unit_id set not null;

commit;