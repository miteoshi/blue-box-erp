begin;

alter table public.delivery_challan_lines
    drop column unit;

alter table public.inbound_receipt_lines
    drop column unit;

alter table public.quotation_lines
    drop column unit;

alter table public.sales_order_lines
    drop column unit;

alter table public.item_prices
    drop column rate_unit;

commit;