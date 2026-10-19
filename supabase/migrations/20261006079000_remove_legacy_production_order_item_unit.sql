begin;

alter table public.production_order_items
    drop column unit;

commit;