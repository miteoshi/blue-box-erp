select
    column_name,
    data_type,
    udt_name,
    is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'item_prices'
order by ordinal_position;