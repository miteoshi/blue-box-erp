begin;

alter table public.item_prices
    add column unit_id uuid;

alter table public.item_prices
    add constraint item_prices_unit_fk
    foreign key (unit_id)
    references public.units (id);

create index idx_item_prices_unit
    on public.item_prices (unit_id);

alter table public.item_prices
    alter column unit_id set not null;

commit;