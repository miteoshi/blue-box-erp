begin;

update public.production_order_items poi
set unit_id = i.unit_id
from public.items i
where poi.item_id = i.id
  and poi.unit_id is null;

commit;