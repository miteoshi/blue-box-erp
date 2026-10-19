begin;

alter table public.items
    add column category_id uuid;

alter table public.items
    add constraint items_org_category_fk
    foreign key (org_id, category_id)
    references public.item_categories (org_id, id);

create index idx_items_category
    on public.items (org_id, category_id);

commit;