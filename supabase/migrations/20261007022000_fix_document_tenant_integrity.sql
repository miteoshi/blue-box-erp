begin;

create or replace function public.validate_challan_so_line_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_challan_org_id uuid;
    v_so_org_id uuid;
begin
    select org_id
    into v_challan_org_id
    from public.delivery_challans
    where id = new.challan_id;

    if v_challan_org_id is null then
        raise exception 'Challan not found or has no organization';
    end if;

    if new.so_line_id is null then
        return new;
    end if;

    select so.org_id
    into v_so_org_id
    from public.sales_order_lines sol
    join public.sales_orders so
        on so.id = sol.so_id
    where sol.id = new.so_line_id;

    if v_so_org_id is null then
        raise exception 'Sales order line not found';
    end if;

    if v_so_org_id <> v_challan_org_id then
        raise exception
            'Sales order line does not belong to the same organization as the challan';
    end if;

    return new;
end;
$function$;

drop trigger if exists trg_validate_challan_so_line_org
    on public.delivery_challan_lines;

create trigger trg_validate_challan_so_line_org
before insert or update of so_line_id, challan_id
on public.delivery_challan_lines
for each row
execute function public.validate_challan_so_line_org();

revoke all on function public.validate_challan_so_line_org() from public;

commit;