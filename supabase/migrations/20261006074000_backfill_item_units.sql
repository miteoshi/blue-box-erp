begin;

update public.items i
set unit_id = u.id
from public.units u
where i.org_id = u.org_id
  and i.unit_id is null
  and (
        (i.unit = 'No.'  and u.code = 'NO')
     or (i.unit = 'Mtr'  and u.code = 'MTR')
     or (i.unit = 'Kg'   and u.code = 'KG')
     or (i.unit = 'Set'  and u.code = 'SET')
     or (i.unit = 'Pair' and u.code = 'PAIR')
  );

commit;