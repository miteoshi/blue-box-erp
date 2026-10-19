begin;

alter table public.quotation_lines
    add column unit_id uuid;

alter table public.quotation_lines
    add constraint quotation_lines_unit_fk
    foreign key (unit_id)
    references public.units (id);

create index idx_quotation_lines_unit
    on public.quotation_lines (unit_id);

alter table public.quotation_lines
    alter column unit_id set not null;

commit;