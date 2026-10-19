begin;

alter table public.items
    drop column unit;

commit;