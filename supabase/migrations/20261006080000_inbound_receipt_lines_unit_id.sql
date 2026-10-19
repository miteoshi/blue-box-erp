begin;

alter table public.inbound_receipt_lines
    add column unit_id uuid;

alter table public.inbound_receipt_lines
    add constraint inbound_receipt_lines_unit_fk
    foreign key (unit_id)
    references public.units (id);

create index idx_inbound_receipt_lines_unit
    on public.inbound_receipt_lines (unit_id);

alter table public.inbound_receipt_lines
    alter column unit_id set not null;

commit;