begin;

alter table public.items
    alter column category drop not null;

commit;