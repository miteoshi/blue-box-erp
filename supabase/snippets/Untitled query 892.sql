-- 1. Table exists and columns are correct
select
    column_name,
    data_type,
    is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'item_categories'
order by ordinal_position;