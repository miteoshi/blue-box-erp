-- 4. Policies
select
    policyname,
    cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'item_categories'
order by policyname;