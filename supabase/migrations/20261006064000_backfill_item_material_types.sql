begin;

update public.items i
set material_type_id = mt.id
from public.material_types mt
where i.org_id = mt.org_id
  and lower(i.material_type::text) = lower(mt.name)
  and i.material_type_id is null;

commit;