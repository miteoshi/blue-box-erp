begin;

drop view if exists public.v_reorder_alerts;

drop view if exists public.v_stock_levels;

create view public.v_stock_levels
with (security_invoker = true)
as
select
    i.id as item_id,
    i.item_code,
    i.name,
    i.category_id,
    ic.name as category,
    i.unit,
    i.reorder_level,
    coalesce(ib.current_qty, 0) as qty_on_hand,
    coalesce(ib.reserved_qty, 0) as qty_reserved,
    coalesce(ib.available_qty, 0) as qty_available,
    case
        when coalesce(ib.available_qty, 0) <= i.reorder_level
        then true
        else false
    end as below_reorder,
    ib.updated_at as balance_updated_at
from public.items i
left join public.item_categories ic
    on ic.id = i.category_id
   and ic.org_id = i.org_id
left join public.inventory_balance ib
    on ib.item_id = i.id
   and ib.org_id = i.org_id
where i.is_active = true;

alter view public.v_stock_levels owner to postgres;

create view public.v_reorder_alerts
with (security_invoker = true)
as
select
    item_id,
    item_code,
    name,
    category_id,
    category,
    unit,
    reorder_level,
    qty_on_hand,
    qty_reserved,
    qty_available,
    below_reorder,
    balance_updated_at
from public.v_stock_levels
where below_reorder = true
order by qty_on_hand;

alter view public.v_reorder_alerts owner to postgres;

commit;