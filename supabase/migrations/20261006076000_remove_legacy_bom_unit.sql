begin;

alter table public.bom
    drop column unit;

commit;