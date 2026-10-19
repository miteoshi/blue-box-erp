begin;

alter table public.sales_order_lines
    add column unit_id uuid;

alter table public.sales_order_lines
    add constraint sales_order_lines_unit_fk
    foreign key (unit_id)
    references public.units (id);

create index idx_sales_order_lines_unit
    on public.sales_order_lines (unit_id);

alter table public.sales_order_lines
    alter column unit_id set not null;

commit;