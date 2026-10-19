-- What does the raw ledger say?
select
  movement_type,
  qty,
  created_at,
  case
    when movement_type in ('inbound','produced','adjustment_in','returned_client')
    then qty
    else -qty
  end as delta
from stock_movements
where item_id = 'dcb40665-6af5-4ce4-803b-eb306cf0e108'
order by created_at;

select * from reconcile_inventory_balance();