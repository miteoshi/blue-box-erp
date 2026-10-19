

select movement_type, qty, created_at
from stock_movements
where item_id = '00813bc9-ebdf-4123-abdd-13ddc863a07b'
order by created_at;


-- Removes auto dispatch trigger
drop trigger if exists trg_dispatch_from_stock
on public.delivery_challan_lines;

drop function if exists public.dispatch_from_stock();

-- Removes auto GRN trigger
drop trigger if exists trg_grn_to_stock
on public.inbound_receipt_lines;

drop function if exists public.grn_to_stock();

-- Recalculate balances
select * from reconcile_inventory_balance();



select
  item_id,
  sum(
    case
      when movement_type in (
        'inbound',
        'produced',
        'returned_client'
      )
      then qty

      else -qty
    end
  ) as ledger_qty

from stock_movements
group by item_id;


select unnest(enum_range(null::movement_type));