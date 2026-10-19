begin;

alter table public.item_prices
    drop constraint if exists item_prices_unit_fk;

alter table public.item_prices
    add constraint item_prices_org_unit_fk
    foreign key (org_id, unit_id)
    references public.units (org_id, id);

create or replace function public.validate_line_unit_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_org_id uuid;
    v_unit_org_id uuid;
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
        raise exception 'Unsupported table for unit organization validation: %', tg_table_name;
    end if;

    if v_org_id is null then
        raise exception 'Parent document not found or has no organization';
    end if;

    select org_id into v_unit_org_id
    from public.units
    where id = new.unit_id;

    if v_unit_org_id is null then
        raise exception 'Unit not found';
    end if;

    if v_unit_org_id <> v_org_id then
        raise exception 'Unit does not belong to the same organization as the parent document';
    end if;

    return new;
end;
$function$;

drop trigger if exists trg_validate_inbound_receipt_line_unit
    on public.inbound_receipt_lines;
create trigger trg_validate_inbound_receipt_line_unit
before insert or update of unit_id, receipt_id
on public.inbound_receipt_lines
for each row
execute function public.validate_line_unit_org();

drop trigger if exists trg_validate_delivery_challan_line_unit
    on public.delivery_challan_lines;
create trigger trg_validate_delivery_challan_line_unit
before insert or update of unit_id, challan_id
on public.delivery_challan_lines
for each row
execute function public.validate_line_unit_org();

drop trigger if exists trg_validate_quotation_line_unit
    on public.quotation_lines;
create trigger trg_validate_quotation_line_unit
before insert or update of unit_id, quotation_id
on public.quotation_lines
for each row
execute function public.validate_line_unit_org();

drop trigger if exists trg_validate_sales_order_line_unit
    on public.sales_order_lines;
create trigger trg_validate_sales_order_line_unit
before insert or update of unit_id, so_id
on public.sales_order_lines
for each row
execute function public.validate_line_unit_org();

drop trigger if exists trg_validate_production_order_item_unit
    on public.production_order_items;
create trigger trg_validate_production_order_item_unit
before insert or update of unit_id, production_order_id
on public.production_order_items
for each row
when (new.unit_id is not null)
execute function public.validate_line_unit_org();

revoke all on function public.validate_line_unit_org() from public;

commit;
