drop trigger if exists "trg_dispatch_from_stock" on "public"."delivery_challan_lines";

drop trigger if exists "trg_grn_to_stock" on "public"."inbound_receipt_lines";

drop function if exists "public"."dispatch_from_stock"();

drop function if exists "public"."grn_to_stock"();


