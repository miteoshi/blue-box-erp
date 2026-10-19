-- 2. Constraints
select
    constraint_name,
    constraint_type
from information_schema.table_constraints
where table_schema = 'public'
  and table_name = 'item_categories'
order by constraint_name;