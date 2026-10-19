begin;

-- Add the new dynamic material type reference
alter table public.items
    add column material_type_id uuid;

-- Tenant-safe foreign key
alter table public.items
    add constraint items_org_material_type_fk
    foreign key (org_id, material_type_id)
    references public.material_types (org_id, id);

create index idx_items_material_type
    on public.items (org_id, material_type_id);

commit;