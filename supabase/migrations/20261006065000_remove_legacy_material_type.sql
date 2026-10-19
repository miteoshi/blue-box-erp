begin;

alter table public.items
    drop column material_type;

commit;