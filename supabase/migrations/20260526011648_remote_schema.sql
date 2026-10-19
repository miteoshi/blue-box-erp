


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."document_status" AS ENUM (
    'draft',
    'pending_approval',
    'approved',
    'rejected',
    'cancelled'
);


ALTER TYPE "public"."document_status" OWNER TO "postgres";


CREATE TYPE "public"."gst_rate" AS ENUM (
    '0',
    '5',
    '12',
    '18',
    '28'
);


ALTER TYPE "public"."gst_rate" OWNER TO "postgres";


CREATE TYPE "public"."item_category" AS ENUM (
    'Conductor',
    'Cable',
    'Insulator',
    'Structural',
    'Clamp',
    'Stay Set',
    'TF Belt',
    'Hardware',
    'GOD',
    'LA',
    'Fastener',
    'Earthing',
    'DB',
    'Lug',
    'Accessories'
);


ALTER TYPE "public"."item_category" OWNER TO "postgres";


CREATE TYPE "public"."material_type" AS ENUM (
    'GI',
    'MS',
    'Aluminium',
    'Copper',
    'Polymer',
    'Porcelain',
    'HDPE',
    'Chemical',
    'Concrete',
    'Mixed',
    'Other'
);


ALTER TYPE "public"."material_type" OWNER TO "postgres";


CREATE TYPE "public"."movement_type" AS ENUM (
    'inbound',
    'consumed',
    'produced',
    'sold',
    'adjustment_in',
    'adjustment_out',
    'returned_supplier',
    'returned_client'
);


ALTER TYPE "public"."movement_type" OWNER TO "postgres";


CREATE TYPE "public"."order_status" AS ENUM (
    'draft',
    'confirmed',
    'in_production',
    'ready',
    'dispatched',
    'delivered',
    'cancelled'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."production_status" AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'on_hold',
    'cancelled'
);


ALTER TYPE "public"."production_status" OWNER TO "postgres";


CREATE TYPE "public"."reservation_status" AS ENUM (
    'active',
    'partially_consumed',
    'consumed',
    'released',
    'expired'
);


ALTER TYPE "public"."reservation_status" OWNER TO "postgres";


CREATE TYPE "public"."transport_mode" AS ENUM (
    'own_truck',
    'client_truck',
    'supplier_truck',
    'courier',
    'hand_delivery'
);


ALTER TYPE "public"."transport_mode" OWNER TO "postgres";


CREATE TYPE "public"."unit_of_measure" AS ENUM (
    'No.',
    'Mtr',
    'Kg',
    'Set',
    'Pair',
    'Lot',
    'Km'
);


ALTER TYPE "public"."unit_of_measure" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'admin',
    'manager',
    'sales',
    'store',
    'production',
    'viewer'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_delta" numeric, "p_reason" "text", "p_ref_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cached      jsonb;
  v_balance     public.inventory_balance;
  v_movement_id uuid;
  v_move_type   movement_type;
  v_qty         numeric;
  v_result      jsonb;
  v_user        uuid := auth.uid();
begin
  select result_payload into v_cached
  from public.inventory_ops_log
  where operation_id = p_operation_id;
  if found then return v_cached; end if;

  if p_delta = 0 then
    raise exception 'Adjustment delta cannot be zero' using errcode = 'P0002';
  end if;

  -- Role check: only admin or store may adjust
  if (select role from public.profiles where id = v_user) not in ('admin','store','manager') then
    raise exception 'Unauthorized: only admin/store/manager can adjust inventory'
    using errcode = 'P0005';
  end if;

  -- Lock balance
  v_balance := public.lock_inventory_balance(p_item_id);

  if p_delta > 0 then
    v_move_type := 'adjustment_in';
    v_qty       := p_delta;
  else
    v_move_type := 'adjustment_out';
    v_qty       := abs(p_delta);
    -- Validate sufficient stock for removal
    perform public.validate_stock_sufficiency(p_item_id, v_qty, v_balance);
  end if;

  insert into public.stock_movements(
    item_id, movement_type, qty, ref_type, ref_id, notes, created_by
  )
  values (p_item_id, v_move_type, v_qty, 'manual_adjustment', p_ref_id, p_reason, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'movement_id', v_movement_id,
    'item_id', p_item_id,
    'delta', p_delta,
    'movement_type', v_move_type
  );

  insert into public.inventory_ops_log(
    operation_id, operation_type, item_id, qty,
    ref_type, result_movement_id, result_payload, created_by
  ) values (
    p_operation_id, 'adjust', p_item_id, p_delta,
    'manual_adjustment', v_movement_id, v_result, v_user
  );

  return v_result;
end;
$$;


ALTER FUNCTION "public"."adjust_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_delta" numeric, "p_reason" "text", "p_ref_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_bom_availability"("p_production_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result   jsonb := '[]'::jsonb;
  v_shortages jsonb := '[]'::jsonb;
  v_has_shortage boolean := false;
begin
  -- For each item in the production order, cross-reference BOM qty needed
  -- against inventory_balance.available_qty
  select
    jsonb_agg(
      jsonb_build_object(
        'item_id',       poi.item_id,
        'item_code',     i.item_code,
        'item_name',     i.name,
        'unit',          i.unit,
        'qty_required',  poi.qty_required,
        'qty_available', coalesce(ib.available_qty, 0),
        'shortage',      greatest(0, poi.qty_required - coalesce(ib.available_qty, 0)),
        'sufficient',    coalesce(ib.available_qty, 0) >= poi.qty_required
      )
    )
  into v_result
  from public.production_order_items poi
  join public.items i on i.id = poi.item_id
  left join public.inventory_balance ib on ib.item_id = poi.item_id
  where poi.production_order_id = p_production_order_id;

  return jsonb_build_object(
    'production_order_id', p_production_order_id,
    'checked_at',          now(),
    'can_produce',         not exists(
      select 1 from jsonb_array_elements(coalesce(v_result,'[]'::jsonb)) r
      where (r->>'sufficient')::boolean = false
    ),
    'materials', coalesce(v_result, '[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."check_bom_availability"("p_production_order_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_bom_availability"("p_production_order_id" "uuid") IS 'Returns material availability for a production order. Use before confirming production to detect shortages.';



CREATE OR REPLACE FUNCTION "public"."consume_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_reservation_id" "uuid" DEFAULT NULL::"uuid", "p_ref_type" "text" DEFAULT 'production_order'::"text", "p_ref_id" "uuid" DEFAULT NULL::"uuid", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cached       jsonb;
  v_balance      public.inventory_balance;
  v_res          public.stock_reservations;
  v_movement_id  uuid;
  v_result       jsonb;
  v_user         uuid := auth.uid();
begin
  -- 1. Idempotency
  select result_payload into v_cached
  from public.inventory_ops_log
  where operation_id = p_operation_id;
  if found then return v_cached; end if;

  if p_qty <= 0 then
    raise exception 'qty must be positive for consume_inventory' using errcode = 'P0002';
  end if;

  -- 2. Lock balance
  v_balance := public.lock_inventory_balance(p_item_id);

  -- 3. If reservation provided, lock and validate it
  if p_reservation_id is not null then
    select * into v_res
    from public.stock_reservations
    where id = p_reservation_id
      and item_id = p_item_id
      and status in ('active','partially_consumed')
    for update nowait;

    if not found then
      raise exception 'Reservation % not found or already consumed', p_reservation_id
      using errcode = 'P0003';
    end if;

    declare
      v_remaining numeric;
    begin
      v_remaining := v_res.qty_reserved - v_res.qty_consumed - v_res.qty_released;
      if p_qty > v_remaining then
        raise exception 'Consume qty (%) exceeds remaining reservation (%)',
          p_qty, v_remaining using errcode = 'P0004';
      end if;
    end;

    -- Update reservation
    update public.stock_reservations
    set qty_consumed = qty_consumed + p_qty,
        status = case
          when (qty_consumed + qty_released + p_qty) = qty_reserved
            then 'consumed'::reservation_status
          else 'partially_consumed'::reservation_status
        end,
        updated_at = now()
    where id = p_reservation_id;

    -- Release reserved_qty (moving from reserved → consumed via ledger)
    update public.inventory_balance
    set reserved_qty = greatest(0, reserved_qty - p_qty),
        updated_at   = now()
    where item_id = p_item_id;

  else
    -- No reservation: consume directly from available stock
    perform public.validate_stock_sufficiency(p_item_id, p_qty, v_balance);
  end if;

  -- 4. Insert ledger row (trigger decrements current_qty automatically)
  insert into public.stock_movements(
    item_id, movement_type, qty, ref_type, ref_id, notes, created_by
  )
  values (p_item_id, 'consumed', p_qty, p_ref_type, p_ref_id, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'movement_id', v_movement_id,
    'item_id', p_item_id,
    'qty_consumed', p_qty,
    'reservation_id', p_reservation_id
  );

  insert into public.inventory_ops_log(
    operation_id, operation_type, item_id, qty,
    ref_type, ref_id, result_movement_id, result_payload, created_by
  ) values (
    p_operation_id, 'consume', p_item_id, p_qty,
    p_ref_type, p_ref_id, v_movement_id, v_result, v_user
  );

  return v_result;
end;
$$;


ALTER FUNCTION "public"."consume_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_reservation_id" "uuid", "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dispatch_from_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.stock_movements(
    item_id, movement_type, qty, rate_at_time,
    ref_type, ref_id, movement_date, created_by
  )
  select
    new.item_id, 'sold', new.qty, new.rate,
    'delivery_challan', new.challan_id, d.challan_date, d.created_by
  from public.delivery_challans d
  where d.id = new.challan_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."dispatch_from_stock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dispatch_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_rate" numeric, "p_reservation_id" "uuid" DEFAULT NULL::"uuid", "p_ref_type" "text" DEFAULT 'delivery_challan'::"text", "p_ref_id" "uuid" DEFAULT NULL::"uuid", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cached       jsonb;
  v_balance      public.inventory_balance;
  v_res          public.stock_reservations;
  v_movement_id  uuid;
  v_result       jsonb;
  v_user         uuid := auth.uid();
begin
  select result_payload into v_cached
  from public.inventory_ops_log
  where operation_id = p_operation_id;
  if found then return v_cached; end if;

  if p_qty <= 0 then
    raise exception 'qty must be positive for dispatch_inventory' using errcode = 'P0002';
  end if;

  -- Lock balance
  v_balance := public.lock_inventory_balance(p_item_id);

  if p_reservation_id is not null then
    -- Dispatch against reservation
    select * into v_res
    from public.stock_reservations
    where id = p_reservation_id
      and item_id = p_item_id
      and status in ('active','partially_consumed')
    for update nowait;

    if not found then
      raise exception 'Reservation % not active for dispatch', p_reservation_id
      using errcode = 'P0003';
    end if;

    declare v_remaining numeric;
    begin
      v_remaining := v_res.qty_reserved - v_res.qty_consumed - v_res.qty_released;
      if p_qty > v_remaining then
        raise exception 'Dispatch qty (%) exceeds reservation remaining (%)',
          p_qty, v_remaining using errcode = 'P0004';
      end if;
    end;

    update public.stock_reservations
    set qty_consumed = qty_consumed + p_qty,
        status = case
          when (qty_consumed + qty_released + p_qty) = qty_reserved
            then 'consumed'::reservation_status
          else 'partially_consumed'::reservation_status
        end,
        updated_at = now()
    where id = p_reservation_id;

    update public.inventory_balance
    set reserved_qty = greatest(0, reserved_qty - p_qty),
        updated_at   = now()
    where item_id = p_item_id;

  else
    -- No reservation: validate open stock
    perform public.validate_stock_sufficiency(p_item_id, p_qty, v_balance);
  end if;

  -- Ledger entry (trigger decrements current_qty)
  insert into public.stock_movements(
    item_id, movement_type, qty, rate_at_time,
    ref_type, ref_id, notes, created_by
  )
  values (p_item_id, 'sold', p_qty, p_rate, p_ref_type, p_ref_id, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'movement_id', v_movement_id,
    'item_id', p_item_id,
    'qty_dispatched', p_qty,
    'reservation_id', p_reservation_id
  );

  insert into public.inventory_ops_log(
    operation_id, operation_type, item_id, qty,
    ref_type, ref_id, result_movement_id, result_payload, created_by
  ) values (
    p_operation_id, 'dispatch', p_item_id, p_qty,
    p_ref_type, p_ref_id, v_movement_id, v_result, v_user
  );

  return v_result;
end;
$$;


ALTER FUNCTION "public"."dispatch_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_rate" numeric, "p_reservation_id" "uuid", "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_reservations"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count int := 0;
  v_res   record;
begin
  for v_res in
    select id, item_id,
           qty_reserved - qty_consumed - qty_released as qty_to_release
    from public.stock_reservations
    where status in ('active','partially_consumed')
      and reservation_expiry < now()
  loop
    update public.stock_reservations
    set qty_released = qty_reserved - qty_consumed,
        status       = 'expired',
        updated_at   = now()
    where id = v_res.id;

    update public.inventory_balance
    set reserved_qty = greatest(0, reserved_qty - v_res.qty_to_release),
        updated_at   = now()
    where item_id = v_res.item_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."expire_stale_reservations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."grn_to_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.stock_movements(
    item_id, movement_type, qty, rate_at_time,
    ref_type, ref_id, movement_date, created_by
  )
  select
    new.item_id, 'inbound', new.qty_received, new.rate,
    'inbound_receipt', new.receipt_id, r.receipt_date, r.created_by
  from public.inbound_receipts r
  where r.id = new.receipt_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."grn_to_stock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (
    id,
    full_name,
    role
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'viewer'
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."inventory_balance" (
    "item_id" "uuid" NOT NULL,
    "current_qty" numeric(14,4) DEFAULT 0 NOT NULL,
    "reserved_qty" numeric(14,4) DEFAULT 0 NOT NULL,
    "available_qty" numeric(14,4) GENERATED ALWAYS AS (("current_qty" - "reserved_qty")) STORED,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "available_cannot_exceed_current" CHECK (("current_qty" >= "reserved_qty")),
    CONSTRAINT "current_qty_non_negative" CHECK (("current_qty" >= (0)::numeric)),
    CONSTRAINT "reserved_non_negative" CHECK (("reserved_qty" >= (0)::numeric))
);


ALTER TABLE "public"."inventory_balance" OWNER TO "postgres";


COMMENT ON TABLE "public"."inventory_balance" IS 'Fast-read, row-lockable inventory state cache. current_qty synced from stock_movements via trigger. reserved_qty managed by reservation functions. DO NOT write to this table directly — use RPC functions only.';



COMMENT ON COLUMN "public"."inventory_balance"."current_qty" IS 'Physical quantity on hand. Mirrors ledger sum.';



COMMENT ON COLUMN "public"."inventory_balance"."reserved_qty" IS 'Quantity reserved for pending sales orders / production. Does NOT reduce current_qty — only reduces available_qty.';



COMMENT ON COLUMN "public"."inventory_balance"."available_qty" IS 'current_qty - reserved_qty. What can be freely allocated.';



CREATE OR REPLACE FUNCTION "public"."lock_inventory_balance"("p_item_id" "uuid") RETURNS "public"."inventory_balance"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_balance public.inventory_balance;
begin
  -- Row-level lock: blocks other transactions from modifying this
  -- specific item's balance until our transaction commits/rollbacks.
  -- NOWAIT: fail fast rather than queue up, preventing deadlocks.
  select * into v_balance
  from public.inventory_balance
  where item_id = p_item_id
  for update nowait;

  if not found then
    -- Auto-create balance row if item exists but has no balance entry
    insert into public.inventory_balance (item_id, current_qty, reserved_qty)
    values (p_item_id, 0, 0)
    on conflict (item_id) do nothing
    returning * into v_balance;

    -- Try lock again after creation
    select * into v_balance
    from public.inventory_balance
    where item_id = p_item_id
    for update nowait;
  end if;

  return v_balance;
end;
$$;


ALTER FUNCTION "public"."lock_inventory_balance"("p_item_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."lock_inventory_balance"("p_item_id" "uuid") IS 'Acquires row-level lock on inventory_balance for a single item. Uses NOWAIT to fail fast and prevent deadlock queuing. Call inside a transaction before any inventory mutation.';



CREATE OR REPLACE FUNCTION "public"."my_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_dc_no"() RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  select 'DC-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('seq_dc')::text, 4,'0')
$$;


ALTER FUNCTION "public"."next_dc_no"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_grn_no"() RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  select 'GRN-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('seq_grn')::text, 4,'0')
$$;


ALTER FUNCTION "public"."next_grn_no"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_prd_no"() RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  select 'PRD-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('seq_prd')::text, 4,'0')
$$;


ALTER FUNCTION "public"."next_prd_no"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_qt_no"() RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  select 'QT-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('seq_qt')::text, 4,'0')
$$;


ALTER FUNCTION "public"."next_qt_no"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_so_no"() RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  select 'SO-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('seq_so')::text, 4,'0')
$$;


ALTER FUNCTION "public"."next_so_no"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."produce_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_ref_type" "text" DEFAULT 'production_order'::"text", "p_ref_id" "uuid" DEFAULT NULL::"uuid", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cached      jsonb;
  v_movement_id uuid;
  v_result      jsonb;
  v_user        uuid := auth.uid();
begin
  select result_payload into v_cached
  from public.inventory_ops_log
  where operation_id = p_operation_id;
  if found then return v_cached; end if;

  if p_qty <= 0 then
    raise exception 'qty must be positive for produce_inventory' using errcode = 'P0002';
  end if;

  -- Lock balance (good practice even for additions — prevents race on balance row)
  perform public.lock_inventory_balance(p_item_id);

  insert into public.stock_movements(
    item_id, movement_type, qty, ref_type, ref_id, notes, created_by
  )
  values (p_item_id, 'produced', p_qty, p_ref_type, p_ref_id, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'movement_id', v_movement_id,
    'item_id', p_item_id,
    'qty_produced', p_qty
  );

  insert into public.inventory_ops_log(
    operation_id, operation_type, item_id, qty,
    ref_type, ref_id, result_movement_id, result_payload, created_by
  ) values (
    p_operation_id, 'produce', p_item_id, p_qty,
    p_ref_type, p_ref_id, v_movement_id, v_result, v_user
  );

  return v_result;
end;
$$;


ALTER FUNCTION "public"."produce_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."receive_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_rate" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_batch_no" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cached      jsonb;
  v_movement_id uuid;
  v_result      jsonb;
  v_user        uuid := auth.uid();
begin
  -- 1. Idempotency check
  select result_payload into v_cached
  from public.inventory_ops_log
  where operation_id = p_operation_id;
  if found then return v_cached; end if;

  -- 2. Validate inputs
  if p_qty <= 0 then
    raise exception 'qty must be positive for receive_inventory' using errcode = 'P0002';
  end if;

  -- 3. Lock balance row (no stock validation needed for inbound)
  perform public.lock_inventory_balance(p_item_id);

  -- 4. Insert ledger row
  insert into public.stock_movements(
    item_id, movement_type, qty, rate_at_time,
    ref_type, ref_id, batch_no, notes, created_by
  )
  values (
    p_item_id, 'inbound', p_qty, p_rate,
    p_ref_type, p_ref_id, p_batch_no, p_notes, v_user
  )
  returning id into v_movement_id;
  -- Trigger trg_sync_balance fires here automatically

  -- 5. Build result
  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'movement_id', v_movement_id,
    'item_id', p_item_id,
    'qty_received', p_qty
  );

  -- 6. Log idempotency
  insert into public.inventory_ops_log(
    operation_id, operation_type, item_id, qty,
    ref_type, ref_id, result_movement_id, result_payload, created_by
  ) values (
    p_operation_id, 'receive', p_item_id, p_qty,
    p_ref_type, p_ref_id, v_movement_id, v_result, v_user
  );

  return v_result;
end;
$$;


ALTER FUNCTION "public"."receive_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_rate" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_batch_no" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_inventory_balance"() RETURNS TABLE("item_id" "uuid", "old_qty" numeric, "new_qty" numeric, "diff" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Role check: admin only
  if (select role from public.profiles where id = auth.uid()) != 'admin' then
    raise exception 'Only admin can run reconciliation' using errcode = 'P0005';
  end if;

  return query
  with ledger_totals as (
    select
      m.item_id,
      sum(case
        when m.movement_type in ('inbound','produced','adjustment_in','returned_client')
          then m.qty
        else -m.qty
      end) as true_qty
    from public.stock_movements m
    group by m.item_id
  ),
  updates as (
    update public.inventory_balance ib
    set current_qty = greatest(0, coalesce(lt.true_qty, 0)),
        updated_at  = now()
    from ledger_totals lt
    where ib.item_id = lt.item_id
    returning ib.item_id,
              ib.current_qty as old_qty,
              greatest(0, coalesce(lt.true_qty, 0)) as new_qty
  )
  select
    u.item_id,
    u.old_qty,
    u.new_qty,
    u.new_qty - u.old_qty as diff
  from updates u
  where abs(u.new_qty - u.old_qty) > 0.0001;
end;
$$;


ALTER FUNCTION "public"."reconcile_inventory_balance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_inventory"("p_operation_id" "uuid", "p_reservation_id" "uuid", "p_qty_to_release" numeric DEFAULT NULL::numeric, "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cached      jsonb;
  v_res         public.stock_reservations;
  v_qty_release numeric;
  v_remaining   numeric;
  v_result      jsonb;
  v_user        uuid := auth.uid();
begin
  -- 1. Idempotency
  select result_payload into v_cached
  from public.inventory_ops_log
  where operation_id = p_operation_id;
  if found then return v_cached; end if;

  -- 2. Fetch + lock reservation row
  select * into v_res
  from public.stock_reservations
  where id = p_reservation_id
    and status in ('active','partially_consumed')
  for update nowait;

  if not found then
    raise exception 'Reservation % not found or not in releasable status', p_reservation_id
    using errcode = 'P0003';
  end if;

  -- 3. Lock balance
  perform public.lock_inventory_balance(v_res.item_id);

  -- 4. Calculate release qty
  v_remaining   := v_res.qty_reserved - v_res.qty_consumed - v_res.qty_released;
  v_qty_release := coalesce(p_qty_to_release, v_remaining);

  if v_qty_release > v_remaining then
    raise exception 'Release qty (%) exceeds remaining reservation (%)',
      v_qty_release, v_remaining
    using errcode = 'P0004';
  end if;

  -- 5. Update reservation
  update public.stock_reservations
  set qty_released = qty_released + v_qty_release,
      status = case
        when (qty_consumed + qty_released + v_qty_release) = qty_reserved
          then 'released'::reservation_status
        else 'partially_consumed'::reservation_status
      end,
      updated_at = now()
  where id = p_reservation_id;

  -- 6. Return qty to available (reduce reserved_qty on balance)
  update public.inventory_balance
  set reserved_qty = greatest(0, reserved_qty - v_qty_release),
      updated_at   = now()
  where item_id = v_res.item_id;

  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'reservation_id', p_reservation_id,
    'qty_released', v_qty_release,
    'item_id', v_res.item_id
  );

  insert into public.inventory_ops_log(
    operation_id, operation_type, item_id, qty,
    ref_type, ref_id, result_payload, created_by
  ) values (
    p_operation_id, 'release', v_res.item_id, v_qty_release,
    v_res.ref_type, v_res.ref_id, v_result, v_user
  );

  return v_result;
end;
$$;


ALTER FUNCTION "public"."release_inventory"("p_operation_id" "uuid", "p_reservation_id" "uuid", "p_qty_to_release" numeric, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_expiry_hours" integer DEFAULT 72, "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cached       jsonb;
  v_balance      public.inventory_balance;
  v_reservation_id uuid;
  v_result       jsonb;
  v_user         uuid := auth.uid();
begin
  -- 1. Idempotency
  select result_payload into v_cached
  from public.inventory_ops_log
  where operation_id = p_operation_id;
  if found then return v_cached; end if;

  if p_qty <= 0 then
    raise exception 'qty must be positive for reserve_inventory' using errcode = 'P0002';
  end if;

  -- 2. Lock balance row — prevents concurrent over-reservation
  v_balance := public.lock_inventory_balance(p_item_id);

  -- 3. Validate available stock (available = current - reserved)
  perform public.validate_stock_sufficiency(p_item_id, p_qty, v_balance);

  -- 4. Create reservation
  insert into public.stock_reservations(
    item_id, qty_reserved, ref_type, ref_id,
    reservation_expiry, notes, created_by
  )
  values (
    p_item_id, p_qty, p_ref_type, p_ref_id,
    now() + (p_expiry_hours || ' hours')::interval,
    p_notes, v_user
  )
  returning id into v_reservation_id;

  -- 5. Update reserved_qty on balance (the only manual balance write)
  update public.inventory_balance
  set reserved_qty = reserved_qty + p_qty,
      updated_at   = now()
  where item_id = p_item_id;

  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'reservation_id', v_reservation_id,
    'item_id', p_item_id,
    'qty_reserved', p_qty,
    'expires_at', now() + (p_expiry_hours || ' hours')::interval
  );

  -- 6. Log
  insert into public.inventory_ops_log(
    operation_id, operation_type, item_id, qty,
    ref_type, ref_id, result_payload, created_by
  ) values (
    p_operation_id, 'reserve', p_item_id, p_qty,
    p_ref_type, p_ref_id, v_result, v_user
  );

  return v_result;
end;
$$;


ALTER FUNCTION "public"."reserve_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_expiry_hours" integer, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_inventory_balance"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_delta numeric(14,4);
begin
  -- Determine direction from movement type
  -- Positive movements: inbound, produced, adjustment_in, returned_client
  -- Negative movements: consumed, sold, adjustment_out, returned_supplier
  v_delta := case new.movement_type
    when 'inbound'            then  new.qty
    when 'produced'           then  new.qty
    when 'adjustment_in'      then  new.qty
    when 'returned_client'    then  new.qty
    when 'consumed'           then -new.qty
    when 'sold'               then -new.qty
    when 'adjustment_out'     then -new.qty
    when 'returned_supplier'  then -new.qty
    else 0
  end;

  -- Upsert balance row (creates if missing for new items)
  insert into public.inventory_balance (item_id, current_qty, reserved_qty, updated_at)
  values (new.item_id, greatest(0, v_delta), 0, now())
  on conflict (item_id) do update
    set current_qty = greatest(0, inventory_balance.current_qty + v_delta),
        updated_at  = now();

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_inventory_balance"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_inventory_balance"() IS 'Keeps inventory_balance.current_qty in sync with stock_movements. Fires after every ledger insert. Never update/delete stock_movements.';



CREATE OR REPLACE FUNCTION "public"."validate_stock_sufficiency"("p_item_id" "uuid", "p_qty_needed" numeric, "p_balance" "public"."inventory_balance" DEFAULT NULL::"public"."inventory_balance") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_balance  public.inventory_balance;
  v_name     text;
begin
  -- Use passed balance (already locked) or fetch fresh
  if p_balance is null then
    select * into v_balance from public.inventory_balance where item_id = p_item_id;
  else
    v_balance := p_balance;
  end if;

  select name into v_name from public.items where id = p_item_id;

  if v_balance is null or v_balance.available_qty < p_qty_needed then
    raise exception
      'Insufficient stock for item "%". Available: %, Requested: %',
      v_name,
      coalesce(v_balance.available_qty, 0),
      p_qty_needed
    using errcode = 'P0001';
  end if;
end;
$$;


ALTER FUNCTION "public"."validate_stock_sufficiency"("p_item_id" "uuid", "p_qty_needed" numeric, "p_balance" "public"."inventory_balance") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."write_audit_log"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id  uuid;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if tg_op = 'DELETE' then
    v_id := old.id;
    insert into public.audit_logs(table_name, record_id, action, old_values, changed_by)
    values(tg_table_name, v_id, 'DELETE', to_jsonb(old), v_uid);
  elsif tg_op = 'UPDATE' then
    v_id := new.id;
    insert into public.audit_logs(table_name, record_id, action, old_values, new_values, changed_by)
    values(tg_table_name, v_id, 'UPDATE', to_jsonb(old), to_jsonb(new), v_uid);
  else
    v_id := new.id;
    insert into public.audit_logs(table_name, record_id, action, new_values, changed_by)
    values(tg_table_name, v_id, 'INSERT', to_jsonb(new), v_uid);
  end if;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."write_audit_log"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."approvals" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "ref_type" "text" NOT NULL,
    "ref_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "actioned_by" "uuid" NOT NULL,
    "actioned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "comments" "text",
    CONSTRAINT "approvals_action_check" CHECK (("action" = ANY (ARRAY['approved'::"text", 'rejected'::"text", 'sent_for_approval'::"text", 'revision_requested'::"text"])))
);


ALTER TABLE "public"."approvals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "old_values" "jsonb",
    "new_values" "jsonb",
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_logs_action_check" CHECK (("action" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"])))
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bom" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "finished_item_id" "uuid" NOT NULL,
    "component_id" "uuid" NOT NULL,
    "qty_per_unit" numeric(10,4) NOT NULL,
    "unit" "public"."unit_of_measure" DEFAULT 'No.'::"public"."unit_of_measure" NOT NULL,
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bom_no_self_reference" CHECK (("finished_item_id" <> "component_id"))
);


ALTER TABLE "public"."bom" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "contact_person" "text",
    "phone" "text",
    "email" "text",
    "address" "text",
    "city" "text",
    "state" "text",
    "gst_number" "text",
    "credit_limit" numeric(12,2) DEFAULT 0,
    "credit_days" integer DEFAULT 0,
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_challan_lines" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "challan_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "so_line_id" "uuid",
    "qty" numeric(12,4) NOT NULL,
    "unit" "public"."unit_of_measure" NOT NULL,
    "rate" numeric(12,2),
    "line_total" numeric(12,2) GENERATED ALWAYS AS (("qty" * "rate")) STORED
);


ALTER TABLE "public"."delivery_challan_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_challans" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "challan_no" "text" NOT NULL,
    "so_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "challan_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "transport_mode" "public"."transport_mode" NOT NULL,
    "vehicle_no" "text",
    "driver_name" "text",
    "total_amount" numeric(12,2),
    "status" "text" DEFAULT 'dispatched'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "delivery_challans_status_check" CHECK (("status" = ANY (ARRAY['dispatched'::"text", 'delivered'::"text", 'returned'::"text"])))
);


ALTER TABLE "public"."delivery_challans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inbound_receipt_lines" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "receipt_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "qty_ordered" numeric(12,4),
    "qty_received" numeric(12,4) NOT NULL,
    "unit" "public"."unit_of_measure" NOT NULL,
    "rate" numeric(12,2) NOT NULL,
    "gst_percent" "public"."gst_rate" DEFAULT '18'::"public"."gst_rate" NOT NULL,
    "line_total" numeric(12,2) GENERATED ALWAYS AS (("qty_received" * "rate")) STORED,
    "notes" "text",
    CONSTRAINT "inbound_receipt_lines_qty_received_check" CHECK (("qty_received" > (0)::numeric))
);


ALTER TABLE "public"."inbound_receipt_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inbound_receipts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "receipt_no" "text" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "receipt_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "transport_mode" "public"."transport_mode" DEFAULT 'supplier_truck'::"public"."transport_mode" NOT NULL,
    "vehicle_no" "text",
    "driver_name" "text",
    "challan_no" "text",
    "invoice_no" "text",
    "total_amount" numeric(12,2),
    "gst_amount" numeric(12,2),
    "status" "text" DEFAULT 'received'::"text" NOT NULL,
    "notes" "text",
    "received_by" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbound_receipts_status_check" CHECK (("status" = ANY (ARRAY['received'::"text", 'partial'::"text", 'pending'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."inbound_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_ops_log" (
    "operation_id" "uuid" NOT NULL,
    "operation_type" "text" NOT NULL,
    "item_id" "uuid",
    "qty" numeric(14,4),
    "ref_type" "text",
    "ref_id" "uuid",
    "result_movement_id" "uuid",
    "result_payload" "jsonb",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "valid_op_type" CHECK (("operation_type" = ANY (ARRAY['consume'::"text", 'produce'::"text", 'reserve'::"text", 'release'::"text", 'dispatch'::"text", 'receive'::"text", 'adjust'::"text"])))
);


ALTER TABLE "public"."inventory_ops_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."inventory_ops_log" IS 'Idempotency log. If operation_id already exists, return cached result without re-executing.';



CREATE TABLE IF NOT EXISTS "public"."item_prices" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "supplier_id" "uuid",
    "purchase_rate" numeric(12,2),
    "selling_rate" numeric(12,2),
    "rate_unit" "public"."unit_of_measure" DEFAULT 'No.'::"public"."unit_of_measure" NOT NULL,
    "gst_percent" "public"."gst_rate" DEFAULT '18'::"public"."gst_rate" NOT NULL,
    "effective_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "effective_to" "date",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."item_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "item_code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "category" "public"."item_category" NOT NULL,
    "sub_category" "text",
    "material_type" "public"."material_type" DEFAULT 'Other'::"public"."material_type",
    "size_spec" "text",
    "unit" "public"."unit_of_measure" DEFAULT 'No.'::"public"."unit_of_measure" NOT NULL,
    "hsn_code" "text",
    "is_traded" boolean DEFAULT false NOT NULL,
    "is_manufactured" boolean DEFAULT false NOT NULL,
    "is_raw_material" boolean DEFAULT false NOT NULL,
    "reorder_level" numeric(10,2) DEFAULT 0,
    "reorder_qty" numeric(10,2) DEFAULT 0,
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "item_must_have_purpose" CHECK (("is_traded" OR "is_manufactured" OR "is_raw_material"))
);


ALTER TABLE "public"."items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."production_assignments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "production_order_id" "uuid" NOT NULL,
    "worker_id" "uuid" NOT NULL,
    "assigned_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "hours_worked" numeric(6,2),
    "notes" "text"
);


ALTER TABLE "public"."production_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."production_order_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "production_order_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "qty_required" numeric(12,4) NOT NULL,
    "qty_produced" numeric(12,4) DEFAULT 0 NOT NULL,
    "unit" "public"."unit_of_measure" NOT NULL
);


ALTER TABLE "public"."production_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."production_orders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "po_number" "text" NOT NULL,
    "so_id" "uuid",
    "status" "public"."production_status" DEFAULT 'pending'::"public"."production_status" NOT NULL,
    "start_date" "date",
    "target_date" "date",
    "completed_date" "date",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."production_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "role" "public"."user_role" DEFAULT 'viewer'::"public"."user_role" NOT NULL,
    "phone" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotation_lines" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "quotation_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "description" "text",
    "qty" numeric(12,4) NOT NULL,
    "unit" "public"."unit_of_measure" NOT NULL,
    "unit_rate" numeric(12,2) NOT NULL,
    "gst_percent" "public"."gst_rate" DEFAULT '18'::"public"."gst_rate" NOT NULL,
    "line_total" numeric(12,2) GENERATED ALWAYS AS (("qty" * "unit_rate")) STORED,
    "sort_order" integer DEFAULT 0
);


ALTER TABLE "public"."quotation_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "quotation_no" "text" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "quotation_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_until" "date",
    "status" "public"."document_status" DEFAULT 'draft'::"public"."document_status" NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "gst_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "delivery_days" integer,
    "transport_note" "text",
    "payment_terms" "text",
    "notes" "text",
    "created_by" "uuid",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quotations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_order_lines" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "so_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "description" "text",
    "qty" numeric(12,4) NOT NULL,
    "unit" "public"."unit_of_measure" NOT NULL,
    "unit_rate" numeric(12,2) NOT NULL,
    "gst_percent" "public"."gst_rate" DEFAULT '18'::"public"."gst_rate" NOT NULL,
    "line_total" numeric(12,2) GENERATED ALWAYS AS (("qty" * "unit_rate")) STORED,
    "qty_produced" numeric(12,4) DEFAULT 0,
    "qty_dispatched" numeric(12,4) DEFAULT 0,
    "sort_order" integer DEFAULT 0
);


ALTER TABLE "public"."sales_order_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_orders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "so_number" "text" NOT NULL,
    "quotation_id" "uuid",
    "client_id" "uuid" NOT NULL,
    "order_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "delivery_date" "date",
    "status" "public"."order_status" DEFAULT 'draft'::"public"."order_status" NOT NULL,
    "transport_mode" "public"."transport_mode",
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "gst_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "advance_paid" numeric(12,2) DEFAULT 0,
    "balance_due" numeric(12,2) DEFAULT 0,
    "payment_terms" "text",
    "notes" "text",
    "created_by" "uuid",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sales_orders" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_dc"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_dc" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_grn"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_grn" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_prd"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_prd" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_qt"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_qt" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_so"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_so" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "movement_type" "public"."movement_type" NOT NULL,
    "qty" numeric(12,4) NOT NULL,
    "rate_at_time" numeric(12,2),
    "batch_no" "text",
    "ref_type" "text",
    "ref_id" "uuid",
    "movement_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_movements_qty_check" CHECK (("qty" > (0)::numeric))
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_reservations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "qty_reserved" numeric(14,4) NOT NULL,
    "qty_consumed" numeric(14,4) DEFAULT 0 NOT NULL,
    "qty_released" numeric(14,4) DEFAULT 0 NOT NULL,
    "ref_type" "text" NOT NULL,
    "ref_id" "uuid" NOT NULL,
    "status" "public"."reservation_status" DEFAULT 'active'::"public"."reservation_status" NOT NULL,
    "reservation_expiry" timestamp with time zone,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "consumed_status_valid" CHECK ((("status" <> 'consumed'::"public"."reservation_status") OR (("qty_consumed" + "qty_released") = "qty_reserved"))),
    CONSTRAINT "reservation_totals_valid" CHECK ((("qty_consumed" + "qty_released") <= "qty_reserved")),
    CONSTRAINT "stock_reservations_qty_consumed_check" CHECK (("qty_consumed" >= (0)::numeric)),
    CONSTRAINT "stock_reservations_qty_released_check" CHECK (("qty_released" >= (0)::numeric)),
    CONSTRAINT "stock_reservations_qty_reserved_check" CHECK (("qty_reserved" > (0)::numeric))
);


ALTER TABLE "public"."stock_reservations" OWNER TO "postgres";


COMMENT ON TABLE "public"."stock_reservations" IS 'Stock reservations. Reduce available_qty only — not current_qty. Converted to actual stock_movements via consume/dispatch functions.';



CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "contact_person" "text",
    "phone" "text",
    "email" "text",
    "address" "text",
    "city" "text",
    "state" "text" DEFAULT 'Gujarat'::"text",
    "gst_number" "text",
    "payment_terms" "text",
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_current_prices" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("p"."item_id") "p"."item_id",
    "i"."item_code",
    "i"."name",
    "p"."purchase_rate",
    "p"."selling_rate",
    ("p"."gst_percent")::"text" AS "gst_percent",
    ("p"."rate_unit")::"text" AS "rate_unit",
    "p"."effective_from",
    "p"."notes" AS "price_notes"
   FROM ("public"."item_prices" "p"
     JOIN "public"."items" "i" ON (("i"."id" = "p"."item_id")))
  WHERE (("p"."effective_to" IS NULL) OR ("p"."effective_to" >= CURRENT_DATE))
  ORDER BY "p"."item_id", "p"."effective_from" DESC;


ALTER VIEW "public"."v_current_prices" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_stock_levels" WITH ("security_invoker"='true') AS
 SELECT "i"."id" AS "item_id",
    "i"."item_code",
    "i"."name",
    ("i"."category")::"text" AS "category",
    ("i"."unit")::"text" AS "unit",
    "i"."reorder_level",
    COALESCE("ib"."current_qty", (0)::numeric) AS "qty_on_hand",
    COALESCE("ib"."reserved_qty", (0)::numeric) AS "qty_reserved",
    COALESCE("ib"."available_qty", (0)::numeric) AS "qty_available",
        CASE
            WHEN (COALESCE("ib"."available_qty", (0)::numeric) <= "i"."reorder_level") THEN true
            ELSE false
        END AS "below_reorder",
    "ib"."updated_at" AS "balance_updated_at"
   FROM ("public"."items" "i"
     LEFT JOIN "public"."inventory_balance" "ib" ON (("ib"."item_id" = "i"."id")))
  WHERE ("i"."is_active" = true);


ALTER VIEW "public"."v_stock_levels" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_reorder_alerts" WITH ("security_invoker"='true') AS
 SELECT "item_id",
    "item_code",
    "name",
    "category",
    "unit",
    "reorder_level",
    "qty_on_hand",
    "qty_reserved",
    "qty_available",
    "below_reorder",
    "balance_updated_at"
   FROM "public"."v_stock_levels"
  WHERE ("below_reorder" = true)
  ORDER BY "qty_on_hand";


ALTER VIEW "public"."v_reorder_alerts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_so_pipeline" WITH ("security_invoker"='true') AS
 SELECT "so"."id",
    "so"."so_number",
    "c"."name" AS "client_name",
    "c"."phone" AS "client_phone",
    "so"."order_date",
    "so"."delivery_date",
    ("so"."status")::"text" AS "status",
    "so"."total_amount",
    "so"."advance_paid",
    "so"."balance_due",
    "q"."quotation_no",
    "p"."full_name" AS "created_by_name"
   FROM ((("public"."sales_orders" "so"
     JOIN "public"."clients" "c" ON (("c"."id" = "so"."client_id")))
     LEFT JOIN "public"."quotations" "q" ON (("q"."id" = "so"."quotation_id")))
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "so"."created_by")));


ALTER VIEW "public"."v_so_pipeline" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workers" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "skill" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workers" OWNER TO "postgres";


ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bom"
    ADD CONSTRAINT "bom_finished_item_id_component_id_key" UNIQUE ("finished_item_id", "component_id");



ALTER TABLE ONLY "public"."bom"
    ADD CONSTRAINT "bom_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_challan_lines"
    ADD CONSTRAINT "delivery_challan_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_challans"
    ADD CONSTRAINT "delivery_challans_challan_no_key" UNIQUE ("challan_no");



ALTER TABLE ONLY "public"."delivery_challans"
    ADD CONSTRAINT "delivery_challans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inbound_receipt_lines"
    ADD CONSTRAINT "inbound_receipt_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inbound_receipts"
    ADD CONSTRAINT "inbound_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inbound_receipts"
    ADD CONSTRAINT "inbound_receipts_receipt_no_key" UNIQUE ("receipt_no");



ALTER TABLE ONLY "public"."inventory_balance"
    ADD CONSTRAINT "inventory_balance_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."inventory_ops_log"
    ADD CONSTRAINT "inventory_ops_log_pkey" PRIMARY KEY ("operation_id");



ALTER TABLE ONLY "public"."item_prices"
    ADD CONSTRAINT "item_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_item_code_key" UNIQUE ("item_code");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."item_prices"
    ADD CONSTRAINT "no_overlapping_prices" UNIQUE ("item_id", "supplier_id", "effective_from");



ALTER TABLE ONLY "public"."production_assignments"
    ADD CONSTRAINT "production_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."production_assignments"
    ADD CONSTRAINT "production_assignments_production_order_id_worker_id_key" UNIQUE ("production_order_id", "worker_id");



ALTER TABLE ONLY "public"."production_order_items"
    ADD CONSTRAINT "production_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."production_orders"
    ADD CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."production_orders"
    ADD CONSTRAINT "production_orders_po_number_key" UNIQUE ("po_number");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_lines"
    ADD CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_quotation_no_key" UNIQUE ("quotation_no");



ALTER TABLE ONLY "public"."sales_order_lines"
    ADD CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_so_number_key" UNIQUE ("so_number");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_reservations"
    ADD CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workers"
    ADD CONSTRAINT "workers_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_approvals_ref" ON "public"."approvals" USING "btree" ("ref_type", "ref_id");



CREATE INDEX "idx_audit_changed" ON "public"."audit_logs" USING "btree" ("changed_at");



CREATE INDEX "idx_audit_record" ON "public"."audit_logs" USING "btree" ("record_id");



CREATE INDEX "idx_audit_table" ON "public"."audit_logs" USING "btree" ("table_name");



CREATE INDEX "idx_audit_who" ON "public"."audit_logs" USING "btree" ("changed_by");



CREATE INDEX "idx_invbal_available" ON "public"."inventory_balance" USING "btree" ("available_qty");



CREATE INDEX "idx_invbal_updated" ON "public"."inventory_balance" USING "btree" ("updated_at");



CREATE INDEX "idx_ops_created" ON "public"."inventory_ops_log" USING "btree" ("created_at");



CREATE INDEX "idx_ops_item" ON "public"."inventory_ops_log" USING "btree" ("item_id");



CREATE INDEX "idx_ops_ref" ON "public"."inventory_ops_log" USING "btree" ("ref_type", "ref_id");



CREATE INDEX "idx_ops_type_item" ON "public"."inventory_ops_log" USING "btree" ("operation_type", "item_id");



CREATE INDEX "idx_res_expiry" ON "public"."stock_reservations" USING "btree" ("reservation_expiry") WHERE ("reservation_expiry" IS NOT NULL);



CREATE INDEX "idx_res_item" ON "public"."stock_reservations" USING "btree" ("item_id");



CREATE INDEX "idx_res_ref" ON "public"."stock_reservations" USING "btree" ("ref_type", "ref_id");



CREATE INDEX "idx_res_status" ON "public"."stock_reservations" USING "btree" ("status");



CREATE INDEX "idx_sm_item_date" ON "public"."stock_movements" USING "btree" ("item_id", "movement_date" DESC);



CREATE INDEX "idx_sm_item_type" ON "public"."stock_movements" USING "btree" ("item_id", "movement_type");



CREATE INDEX "idx_sm_ref" ON "public"."stock_movements" USING "btree" ("ref_type", "ref_id") WHERE ("ref_type" IS NOT NULL);



CREATE INDEX "idx_sr_item_status" ON "public"."stock_reservations" USING "btree" ("item_id", "status") WHERE ("status" = ANY (ARRAY['active'::"public"."reservation_status", 'partially_consumed'::"public"."reservation_status"]));



CREATE INDEX "idx_stock_date" ON "public"."stock_movements" USING "btree" ("movement_date");



CREATE INDEX "idx_stock_item" ON "public"."stock_movements" USING "btree" ("item_id");



CREATE INDEX "idx_stock_ref" ON "public"."stock_movements" USING "btree" ("ref_type", "ref_id");



CREATE INDEX "idx_stock_type" ON "public"."stock_movements" USING "btree" ("movement_type");



CREATE OR REPLACE TRIGGER "trg_aud_dc" AFTER INSERT OR UPDATE ON "public"."delivery_challans" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit_log"();



CREATE OR REPLACE TRIGGER "trg_aud_grn" AFTER INSERT OR UPDATE ON "public"."inbound_receipts" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit_log"();



CREATE OR REPLACE TRIGGER "trg_aud_items" AFTER INSERT OR DELETE OR UPDATE ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit_log"();



CREATE OR REPLACE TRIGGER "trg_aud_prd" AFTER INSERT OR DELETE OR UPDATE ON "public"."production_orders" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit_log"();



CREATE OR REPLACE TRIGGER "trg_aud_quotations" AFTER INSERT OR DELETE OR UPDATE ON "public"."quotations" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit_log"();



CREATE OR REPLACE TRIGGER "trg_aud_so" AFTER INSERT OR DELETE OR UPDATE ON "public"."sales_orders" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit_log"();



CREATE OR REPLACE TRIGGER "trg_aud_stock" AFTER INSERT ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."write_audit_log"();



CREATE OR REPLACE TRIGGER "trg_dispatch_from_stock" AFTER INSERT ON "public"."delivery_challan_lines" FOR EACH ROW EXECUTE FUNCTION "public"."dispatch_from_stock"();



CREATE OR REPLACE TRIGGER "trg_grn_to_stock" AFTER INSERT ON "public"."inbound_receipt_lines" FOR EACH ROW EXECUTE FUNCTION "public"."grn_to_stock"();



CREATE OR REPLACE TRIGGER "trg_sync_balance" AFTER INSERT ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."sync_inventory_balance"();



CREATE OR REPLACE TRIGGER "trg_upd_clients" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_upd_inbound" BEFORE UPDATE ON "public"."inbound_receipts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_upd_items" BEFORE UPDATE ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_upd_prd" BEFORE UPDATE ON "public"."production_orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_upd_profiles" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_upd_quotations" BEFORE UPDATE ON "public"."quotations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_upd_so" BEFORE UPDATE ON "public"."sales_orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_upd_suppliers" BEFORE UPDATE ON "public"."suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_actioned_by_fkey" FOREIGN KEY ("actioned_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bom"
    ADD CONSTRAINT "bom_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."bom"
    ADD CONSTRAINT "bom_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bom"
    ADD CONSTRAINT "bom_finished_item_id_fkey" FOREIGN KEY ("finished_item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_challan_lines"
    ADD CONSTRAINT "delivery_challan_lines_challan_id_fkey" FOREIGN KEY ("challan_id") REFERENCES "public"."delivery_challans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_challan_lines"
    ADD CONSTRAINT "delivery_challan_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."delivery_challan_lines"
    ADD CONSTRAINT "delivery_challan_lines_so_line_id_fkey" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_lines"("id");



ALTER TABLE ONLY "public"."delivery_challans"
    ADD CONSTRAINT "delivery_challans_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."delivery_challans"
    ADD CONSTRAINT "delivery_challans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."delivery_challans"
    ADD CONSTRAINT "delivery_challans_so_id_fkey" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id");



ALTER TABLE ONLY "public"."inbound_receipt_lines"
    ADD CONSTRAINT "inbound_receipt_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."inbound_receipt_lines"
    ADD CONSTRAINT "inbound_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."inbound_receipts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inbound_receipts"
    ADD CONSTRAINT "inbound_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."inbound_receipts"
    ADD CONSTRAINT "inbound_receipts_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."inbound_receipts"
    ADD CONSTRAINT "inbound_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE ONLY "public"."inventory_balance"
    ADD CONSTRAINT "inventory_balance_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_ops_log"
    ADD CONSTRAINT "inventory_ops_log_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."inventory_ops_log"
    ADD CONSTRAINT "inventory_ops_log_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."item_prices"
    ADD CONSTRAINT "item_prices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."item_prices"
    ADD CONSTRAINT "item_prices_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."item_prices"
    ADD CONSTRAINT "item_prices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."production_assignments"
    ADD CONSTRAINT "production_assignments_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."production_assignments"
    ADD CONSTRAINT "production_assignments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id");



ALTER TABLE ONLY "public"."production_order_items"
    ADD CONSTRAINT "production_order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."production_order_items"
    ADD CONSTRAINT "production_order_items_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."production_orders"
    ADD CONSTRAINT "production_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."production_orders"
    ADD CONSTRAINT "production_orders_so_id_fkey" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotation_lines"
    ADD CONSTRAINT "quotation_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."quotation_lines"
    ADD CONSTRAINT "quotation_lines_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales_order_lines"
    ADD CONSTRAINT "sales_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."sales_order_lines"
    ADD CONSTRAINT "sales_order_lines_so_id_fkey" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."stock_reservations"
    ADD CONSTRAINT "stock_reservations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stock_reservations"
    ADD CONSTRAINT "stock_reservations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



CREATE POLICY "admin manages" ON "public"."profiles" USING (("public"."my_role"() = 'admin'::"public"."user_role"));



CREATE POLICY "admin manages sup" ON "public"."suppliers" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'store'::"public"."user_role"])));



CREATE POLICY "admin manages workers" ON "public"."workers" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"])));



CREATE POLICY "admin reads all" ON "public"."profiles" FOR SELECT USING (("public"."my_role"() = 'admin'::"public"."user_role"));



ALTER TABLE "public"."approvals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auth reads approvals" ON "public"."approvals" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads audit" ON "public"."audit_logs" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads balance" ON "public"."inventory_balance" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads bom" ON "public"."bom" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads clients" ON "public"."clients" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads dc" ON "public"."delivery_challans" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads dc lines" ON "public"."delivery_challan_lines" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads grn" ON "public"."inbound_receipts" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads grn lines" ON "public"."inbound_receipt_lines" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads items" ON "public"."items" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads prd" ON "public"."production_orders" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads prd asgn" ON "public"."production_assignments" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads prd items" ON "public"."production_order_items" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads prices" ON "public"."item_prices" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads qt" ON "public"."quotations" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads qt lines" ON "public"."quotation_lines" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads reservations" ON "public"."stock_reservations" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads so" ON "public"."sales_orders" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads so lines" ON "public"."sales_order_lines" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads stock" ON "public"."stock_movements" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads suppliers" ON "public"."suppliers" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth reads workers" ON "public"."workers" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."bom" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_challan_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_challans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inbound_receipt_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inbound_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_balance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_ops_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."item_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mgr creates approval" ON "public"."approvals" FOR INSERT WITH CHECK (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"])));



CREATE POLICY "own profile" ON "public"."profiles" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "prod manages bom" ON "public"."bom" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'production'::"public"."user_role"])));



CREATE POLICY "prod manages prd" ON "public"."production_orders" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'production'::"public"."user_role"])));



CREATE POLICY "prod manages prd asgn" ON "public"."production_assignments" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'production'::"public"."user_role"])));



CREATE POLICY "prod manages prd itm" ON "public"."production_order_items" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'production'::"public"."user_role"])));



ALTER TABLE "public"."production_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."production_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."production_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotation_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales manages cli" ON "public"."clients" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'sales'::"public"."user_role", 'manager'::"public"."user_role"])));



CREATE POLICY "sales manages qt" ON "public"."quotations" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'sales'::"public"."user_role"])));



CREATE POLICY "sales manages qt ln" ON "public"."quotation_lines" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'sales'::"public"."user_role"])));



CREATE POLICY "sales manages so" ON "public"."sales_orders" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'sales'::"public"."user_role"])));



CREATE POLICY "sales manages so ln" ON "public"."sales_order_lines" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'sales'::"public"."user_role"])));



ALTER TABLE "public"."sales_order_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_reservations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "store inserts stock" ON "public"."stock_movements" FOR INSERT WITH CHECK (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'store'::"public"."user_role", 'production'::"public"."user_role"])));



CREATE POLICY "store manages dc" ON "public"."delivery_challans" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'store'::"public"."user_role"])));



CREATE POLICY "store manages dc ln" ON "public"."delivery_challan_lines" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'store'::"public"."user_role"])));



CREATE POLICY "store manages grn" ON "public"."inbound_receipts" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'store'::"public"."user_role"])));



CREATE POLICY "store manages grn ln" ON "public"."inbound_receipt_lines" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'store'::"public"."user_role"])));



CREATE POLICY "store manages items" ON "public"."items" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'store'::"public"."user_role"])));



CREATE POLICY "store manages prices" ON "public"."item_prices" USING (("public"."my_role"() = ANY (ARRAY['admin'::"public"."user_role", 'store'::"public"."user_role", 'manager'::"public"."user_role"])));



ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user reads own ops" ON "public"."inventory_ops_log" FOR SELECT USING ((("created_by" = "auth"."uid"()) OR ("public"."my_role"() = 'admin'::"public"."user_role")));



ALTER TABLE "public"."workers" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."inbound_receipts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."inventory_balance";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."production_orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."quotations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sales_orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."stock_movements";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."stock_reservations";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."adjust_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_delta" numeric, "p_reason" "text", "p_ref_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."adjust_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_delta" numeric, "p_reason" "text", "p_ref_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_delta" numeric, "p_reason" "text", "p_ref_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_bom_availability"("p_production_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_bom_availability"("p_production_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_bom_availability"("p_production_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_reservation_id" "uuid", "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_reservation_id" "uuid", "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_reservation_id" "uuid", "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."dispatch_from_stock"() TO "anon";
GRANT ALL ON FUNCTION "public"."dispatch_from_stock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."dispatch_from_stock"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."dispatch_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_rate" numeric, "p_reservation_id" "uuid", "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dispatch_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_rate" numeric, "p_reservation_id" "uuid", "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dispatch_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_rate" numeric, "p_reservation_id" "uuid", "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_reservations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_reservations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."grn_to_stock"() TO "anon";
GRANT ALL ON FUNCTION "public"."grn_to_stock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."grn_to_stock"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON TABLE "public"."inventory_balance" TO "anon";
GRANT ALL ON TABLE "public"."inventory_balance" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_balance" TO "service_role";



REVOKE ALL ON FUNCTION "public"."lock_inventory_balance"("p_item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lock_inventory_balance"("p_item_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_role"() TO "service_role";
GRANT ALL ON FUNCTION "public"."my_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."next_dc_no"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_dc_no"() TO "service_role";
GRANT ALL ON FUNCTION "public"."next_dc_no"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."next_grn_no"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_grn_no"() TO "service_role";
GRANT ALL ON FUNCTION "public"."next_grn_no"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."next_prd_no"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_prd_no"() TO "service_role";
GRANT ALL ON FUNCTION "public"."next_prd_no"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."next_qt_no"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_qt_no"() TO "service_role";
GRANT ALL ON FUNCTION "public"."next_qt_no"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."next_so_no"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_so_no"() TO "service_role";
GRANT ALL ON FUNCTION "public"."next_so_no"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."produce_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."produce_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."produce_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."receive_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_rate" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_batch_no" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."receive_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_rate" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_batch_no" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."receive_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_rate" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_batch_no" "text", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_inventory_balance"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_inventory_balance"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_inventory"("p_operation_id" "uuid", "p_reservation_id" "uuid", "p_qty_to_release" numeric, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_inventory"("p_operation_id" "uuid", "p_reservation_id" "uuid", "p_qty_to_release" numeric, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_inventory"("p_operation_id" "uuid", "p_reservation_id" "uuid", "p_qty_to_release" numeric, "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_expiry_hours" integer, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_expiry_hours" integer, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_inventory"("p_operation_id" "uuid", "p_item_id" "uuid", "p_qty" numeric, "p_ref_type" "text", "p_ref_id" "uuid", "p_expiry_hours" integer, "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_inventory_balance"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_inventory_balance"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_stock_sufficiency"("p_item_id" "uuid", "p_qty_needed" numeric, "p_balance" "public"."inventory_balance") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_stock_sufficiency"("p_item_id" "uuid", "p_qty_needed" numeric, "p_balance" "public"."inventory_balance") TO "service_role";



REVOKE ALL ON FUNCTION "public"."write_audit_log"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."write_audit_log"() TO "service_role";


















GRANT ALL ON TABLE "public"."approvals" TO "anon";
GRANT ALL ON TABLE "public"."approvals" TO "authenticated";
GRANT ALL ON TABLE "public"."approvals" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."bom" TO "anon";
GRANT ALL ON TABLE "public"."bom" TO "authenticated";
GRANT ALL ON TABLE "public"."bom" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."delivery_challan_lines" TO "anon";
GRANT ALL ON TABLE "public"."delivery_challan_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."delivery_challan_lines" TO "service_role";



GRANT ALL ON TABLE "public"."delivery_challans" TO "anon";
GRANT ALL ON TABLE "public"."delivery_challans" TO "authenticated";
GRANT ALL ON TABLE "public"."delivery_challans" TO "service_role";



GRANT ALL ON TABLE "public"."inbound_receipt_lines" TO "anon";
GRANT ALL ON TABLE "public"."inbound_receipt_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."inbound_receipt_lines" TO "service_role";



GRANT ALL ON TABLE "public"."inbound_receipts" TO "anon";
GRANT ALL ON TABLE "public"."inbound_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."inbound_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_ops_log" TO "anon";
GRANT ALL ON TABLE "public"."inventory_ops_log" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_ops_log" TO "service_role";



GRANT ALL ON TABLE "public"."item_prices" TO "anon";
GRANT ALL ON TABLE "public"."item_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."item_prices" TO "service_role";



GRANT ALL ON TABLE "public"."items" TO "anon";
GRANT ALL ON TABLE "public"."items" TO "authenticated";
GRANT ALL ON TABLE "public"."items" TO "service_role";



GRANT ALL ON TABLE "public"."production_assignments" TO "anon";
GRANT ALL ON TABLE "public"."production_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."production_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."production_order_items" TO "anon";
GRANT ALL ON TABLE "public"."production_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."production_order_items" TO "service_role";



GRANT ALL ON TABLE "public"."production_orders" TO "anon";
GRANT ALL ON TABLE "public"."production_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."production_orders" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_lines" TO "anon";
GRANT ALL ON TABLE "public"."quotation_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."quotation_lines" TO "service_role";



GRANT ALL ON TABLE "public"."quotations" TO "anon";
GRANT ALL ON TABLE "public"."quotations" TO "authenticated";
GRANT ALL ON TABLE "public"."quotations" TO "service_role";



GRANT ALL ON TABLE "public"."sales_order_lines" TO "anon";
GRANT ALL ON TABLE "public"."sales_order_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_order_lines" TO "service_role";



GRANT ALL ON TABLE "public"."sales_orders" TO "anon";
GRANT ALL ON TABLE "public"."sales_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_orders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seq_dc" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_dc" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_dc" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seq_grn" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_grn" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_grn" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seq_prd" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_prd" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_prd" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seq_qt" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_qt" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_qt" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seq_so" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_so" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_so" TO "service_role";



GRANT ALL ON TABLE "public"."stock_movements" TO "anon";
GRANT ALL ON TABLE "public"."stock_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."stock_reservations" TO "anon";
GRANT ALL ON TABLE "public"."stock_reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_reservations" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";



GRANT ALL ON TABLE "public"."v_current_prices" TO "anon";
GRANT ALL ON TABLE "public"."v_current_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."v_current_prices" TO "service_role";



GRANT ALL ON TABLE "public"."v_stock_levels" TO "anon";
GRANT ALL ON TABLE "public"."v_stock_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."v_stock_levels" TO "service_role";



GRANT ALL ON TABLE "public"."v_reorder_alerts" TO "anon";
GRANT ALL ON TABLE "public"."v_reorder_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."v_reorder_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."v_so_pipeline" TO "anon";
GRANT ALL ON TABLE "public"."v_so_pipeline" TO "authenticated";
GRANT ALL ON TABLE "public"."v_so_pipeline" TO "service_role";



GRANT ALL ON TABLE "public"."workers" TO "anon";
GRANT ALL ON TABLE "public"."workers" TO "authenticated";
GRANT ALL ON TABLE "public"."workers" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


