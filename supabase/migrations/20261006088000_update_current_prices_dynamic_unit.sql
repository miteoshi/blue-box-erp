begin;

drop view if exists public.v_current_prices;

create view public.v_current_prices
with (security_invoker = true)
as
select distinct on (p.item_id)
    p.item_id,
    i.item_code,
    i.name,
    p.purchase_rate,
    p.selling_rate,
    p.gst_percent::text as gst_percent,
    u.name as rate_unit,
    p.effective_from,
    p.notes as price_notes
from public.item_prices p
join public.items i
    on i.id = p.item_id
left join public.units u
    on u.id = p.unit_id
order by p.item_id, p.effective_from desc;

alter view public.v_current_prices owner to postgres;

commit;