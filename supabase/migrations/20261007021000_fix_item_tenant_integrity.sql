begin;

-- Required so (org_id, item_id) can reference items safely.
alter table public.items
    add constraint items_org_id_id_key
    unique (org_id, id);



-- Org-owned tables
alter table public.bom
    drop constraint if exists bom_component_id_fkey,
    drop constraint if exists bom_finished_item_id_fkey;

alter table public.bom
    add constraint bom_org_component_fk
    foreign key (org_id, component_id)
    references public.items (org_id, id);

alter table public.bom
    add constraint bom_org_finished_item_fk
    foreign key (org_id, finished_item_id)
    references public.items (org_id, id);

alter table public.item_prices
    drop constraint if exists item_prices_item_id_fkey;

alter table public.item_prices
    add constraint item_prices_org_item_fk
    foreign key (org_id, item_id)
    references public.items (org_id, id);

alter table public.inventory_balance
    drop constraint if exists inventory_balance_item_id_fkey;

alter table public.inventory_balance
    add constraint inventory_balance_org_item_fk
    foreign key (org_id, item_id)
    references public.items (org_id, id);

alter table public.inventory_ops_log
    drop constraint if exists inventory_ops_log_item_id_fkey;

alter table public.inventory_ops_log
    add constraint inventory_ops_log_org_item_fk
    foreign key (org_id, item_id)
    references public.items (org_id, id);

alter table public.stock_movements
    drop constraint if exists stock_movements_item_id_fkey;

alter table public.stock_movements
    add constraint stock_movements_org_item_fk
    foreign key (org_id, item_id)
    references public.items (org_id, id);

alter table public.stock_reservations
    drop constraint if exists stock_reservations_item_id_fkey;

alter table public.stock_reservations
    add constraint stock_reservations_org_item_fk
    foreign key (org_id, item_id)
    references public.items (org_id, id);


-- Child tables inherit tenancy from their parent.
create or replace function public.validate_line_item_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_org_id uuid;
    v_item_org_id uuid;
begin
    if tg_table_name = 'inbound_receipt_lines' then
        select org_id into v_org_id
        from public.inbound_receipts
        where id = new.receipt_id;

    elsif tg_table_name = 'delivery_challan_lines' then
        select org_id into v_org_id
        from public.delivery_challans
        where id = new.challan_id;

    elsif tg_table_name = 'quotation_lines' then
        select org_id into v_org_id
        from public.quotations
        where id = new.quotation_id;

    elsif tg_table_name = 'sales_order_lines' then
        select org_id into v_org_id
        from public.sales_orders
        where id = new.so_id;

    elsif tg_table_name = 'production_order_items' then
        select org_id into v_org_id
        from public.production_orders
        where id = new.production_order_id;

    else
        raise exception
            'Unsupported table for item organization validation: %',
            tg_table_name;
    end if;

    if v_org_id is null then
        raise exception
            'Parent document not found or has no organization';
    end if;

    select org_id into v_item_org_id
    from public.items
    where id = new.item_id;

    if v_item_org_id is null then
        raise exception 'Item not found';
    end if;

    if v_item_org_id <> v_org_id then
        raise exception
            'Item does not belong to the same organization as the parent document';
    end if;

    return new;
end;
$function$;


drop trigger if exists trg_validate_inbound_receipt_line_item
    on public.inbound_receipt_lines;

create trigger trg_validate_inbound_receipt_line_item
before insert or update of item_id, receipt_id
on public.inbound_receipt_lines
for each row
execute function public.validate_line_item_org();


drop trigger if exists trg_validate_delivery_challan_line_item
    on public.delivery_challan_lines;

create trigger trg_validate_delivery_challan_line_item
before insert or update of item_id, challan_id
on public.delivery_challan_lines
for each row
execute function public.validate_line_item_org();


drop trigger if exists trg_validate_quotation_line_item
    on public.quotation_lines;

create trigger trg_validate_quotation_line_item
before insert or update of item_id, quotation_id
on public.quotation_lines
for each row
execute function public.validate_line_item_org();


drop trigger if exists trg_validate_sales_order_line_item
    on public.sales_order_lines;

create trigger trg_validate_sales_order_line_item
before insert or update of item_id, so_id
on public.sales_order_lines
for each row
execute function public.validate_line_item_org();


drop trigger if exists trg_validate_production_order_item_item
    on public.production_order_items;

create trigger trg_validate_production_order_item_item
before insert or update of item_id, production_order_id
on public.production_order_items
for each row
execute function public.validate_line_item_org();


revoke all on function public.validate_line_item_org() from public;

commit;