begin;

alter table public.production_order_items
    add column unit_id uuid;

alter table public.production_order_items
    add constraint production_order_items_unit_fk
    foreign key (unit_id)
    references public.units (id);

create index idx_production_order_items_unit
    on public.production_order_items (unit_id);

commit;