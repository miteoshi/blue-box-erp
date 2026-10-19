-- 3. RLS is enabled
select
    relname,
    relrowsecurity
from pg_class
where oid = 'public.item_categories'::regclass;