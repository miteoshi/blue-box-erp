begin;

create or replace function public.check_bom_availability(
    p_production_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_result jsonb := '[]'::jsonb;
begin
    perform 1
    from public.production_orders
    where id = p_production_order_id
      and org_id = public.my_org();

    if not found then
        raise exception 'Production order not found or access denied';
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'item_id', poi.item_id,
                'item_code', i.item_code,
                'item_name', i.name,
                'unit', u.name,
                'qty_required', poi.qty_required,
                'qty_available', coalesce(ib.available_qty, 0),
                'shortage',
                    greatest(
                        0,
                        poi.qty_required - coalesce(ib.available_qty, 0)
                    ),
                'sufficient',
                    coalesce(ib.available_qty, 0) >= poi.qty_required
            )
        ),
        '[]'::jsonb
    )
    into v_result
    from public.production_order_items poi
    join public.items i
        on i.id = poi.item_id
       and i.org_id = public.my_org()
    left join public.units u
        on u.id = poi.unit_id
       and u.org_id = public.my_org()
    left join public.inventory_balance ib
        on ib.item_id = poi.item_id
       and ib.org_id = public.my_org()
    where poi.production_order_id = p_production_order_id;

    return jsonb_build_object(
        'production_order_id', p_production_order_id,
        'checked_at', now(),
        'can_produce',
            not exists (
                select 1
                from jsonb_array_elements(v_result) r
                where (r->>'sufficient')::boolean = false
            ),
        'materials', v_result
    );
end;
$$;

revoke all on function public.check_bom_availability(uuid) from public;

grant execute on function public.check_bom_availability(uuid) to authenticated;

commit;