select
  movement_type,
  qty,
  ref_type,
  ref_id
from stock_movements
where item_id = 'ec730727-3f18-476e-9bfe-1dcb77429b4b'
order by created_at;