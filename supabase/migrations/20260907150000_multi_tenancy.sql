-- =========================================================================
-- Blue Box ERP — Multi-Tenancy Migration
-- Safe on both an empty database and one with existing data (backfills
-- pre-existing rows into a default organization before enforcing NOT NULL).
-- =========================================================================

begin;

-- -------------------------------------------------------------------------
-- 1. Organizations (tenants)
-- -------------------------------------------------------------------------

create table if not exists "public"."organizations" (
    "id" uuid default extensions.uuid_generate_v4() not null primary key,
    "name" text not null,
    "slug" text unique,
    "is_active" boolean default true not null,
    "created_at" timestamp with time zone default now() not null,
    "updated_at" timestamp with time zone default now() not null
);
alter table "public"."organizations" owner to "postgres";

create trigger "trg_upd_organizations"
    before update on "public"."organizations"
    for each row execute function "public"."set_updated_at"();

alter table "public"."organizations" enable row level security;

-- -------------------------------------------------------------------------
-- 2. org_id on profiles + my_org() helper + onboarding RPC
-- -------------------------------------------------------------------------

alter table "public"."profiles"
    add column "org_id" uuid references "public"."organizations"("id");

create index "idx_profiles_org" on "public"."profiles" ("org_id");

create or replace function "public"."my_org"() returns uuid
    language sql stable security definer set search_path to public as
$$ select org_id from public.profiles where id = auth.uid() $$;

alter function "public"."my_org"() owner to "postgres";
grant execute on function "public"."my_org"() to authenticated, service_role;

create or replace function "public"."handle_new_user"() returns trigger
    language plpgsql security definer set search_path to public as
$$
begin
  insert into public.profiles (id, full_name, role, org_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'viewer',
    nullif(new.raw_user_meta_data->>'org_id','')::uuid
  );
  return new;
end;
$$;

create or replace function "public"."create_organization"("p_name" text) returns uuid
    language plpgsql security definer set search_path to public as
$$
declare
  v_org_id  uuid;
  v_existing uuid;
begin
  select org_id into v_existing from public.profiles where id = auth.uid();
  if v_existing is not null then
    raise exception 'User already belongs to an organization' using errcode = 'P0006';
  end if;

  insert into public.organizations (name) values (p_name) returning id into v_org_id;

  update public.profiles
  set org_id = v_org_id, role = 'admin'
  where id = auth.uid();

  return v_org_id;
end;
$$;
alter function "public"."create_organization"(text) owner to "postgres";
grant execute on function "public"."create_organization"(text) to authenticated;

create policy "member reads own org" on "public"."organizations"
    for select using (id = public.my_org());

create policy "admin updates own org" on "public"."organizations"
    for update using (id = public.my_org() and public.my_role() = 'admin');

-- -------------------------------------------------------------------------
-- 3. Per-organization document counters (replaces the global seq_* sequences)
-- -------------------------------------------------------------------------

create table if not exists "public"."org_sequences" (
    "org_id" uuid not null references "public"."organizations"("id") on delete cascade,
    "seq_name" text not null,
    "current_value" bigint default 0 not null,
    primary key ("org_id", "seq_name")
);
alter table "public"."org_sequences" owner to "postgres";
alter table "public"."org_sequences" enable row level security;

create or replace function "public"."next_org_seq"("p_org_id" uuid, "p_seq_name" text)
returns bigint
language plpgsql security definer set search_path to public
as $$
declare
  v_val bigint;
begin
  insert into public.org_sequences (org_id, seq_name, current_value)
  values (p_org_id, p_seq_name, 1)
  on conflict (org_id, seq_name)
  do update set current_value = public.org_sequences.current_value + 1
  returning current_value into v_val;
  return v_val;
end;
$$;
alter function "public"."next_org_seq"(uuid, text) owner to "postgres";

create or replace function "public"."next_dc_no"("p_org_id" uuid) returns text
    language sql set search_path to public as
$$ select 'DC-' || to_char(current_date,'YYYY') || '-' || lpad(public.next_org_seq(p_org_id,'dc')::text, 4, '0') $$;

create or replace function "public"."next_grn_no"("p_org_id" uuid) returns text
    language sql set search_path to public as
$$ select 'GRN-' || to_char(current_date,'YYYY') || '-' || lpad(public.next_org_seq(p_org_id,'grn')::text, 4, '0') $$;

create or replace function "public"."next_prd_no"("p_org_id" uuid) returns text
    language sql set search_path to public as
$$ select 'PRD-' || to_char(current_date,'YYYY') || '-' || lpad(public.next_org_seq(p_org_id,'prd')::text, 4, '0') $$;

create or replace function "public"."next_qt_no"("p_org_id" uuid) returns text
    language sql set search_path to public as
$$ select 'QT-' || to_char(current_date,'YYYY') || '-' || lpad(public.next_org_seq(p_org_id,'qt')::text, 4, '0') $$;

create or replace function "public"."next_so_no"("p_org_id" uuid) returns text
    language sql set search_path to public as
$$ select 'SO-' || to_char(current_date,'YYYY') || '-' || lpad(public.next_org_seq(p_org_id,'so')::text, 4, '0') $$;

grant execute on function "public"."next_dc_no"(uuid) to authenticated, service_role;
grant execute on function "public"."next_grn_no"(uuid) to authenticated, service_role;
grant execute on function "public"."next_prd_no"(uuid) to authenticated, service_role;
grant execute on function "public"."next_qt_no"(uuid) to authenticated, service_role;
grant execute on function "public"."next_so_no"(uuid) to authenticated, service_role;

drop function if exists public.next_dc_no();
drop function if exists public.next_grn_no();
drop function if exists public.next_prd_no();
drop function if exists public.next_qt_no();
drop function if exists public.next_so_no();

-- -------------------------------------------------------------------------
-- 4. org_id on every top-level business table
--    Nullable first, backfilled into a default org, then NOT NULL — safe
--    whether the database is empty (local) or already has rows (cloud).
-- -------------------------------------------------------------------------

alter table "public"."clients"            add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."suppliers"          add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."items"              add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."bom"                add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."item_prices"        add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."quotations"         add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."sales_orders"       add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."production_orders"  add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."workers"            add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."stock_movements"    add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."stock_reservations" add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."inventory_balance"  add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."inventory_ops_log"  add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."delivery_challans"  add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."inbound_receipts"   add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."approvals"          add column "org_id" uuid references "public"."organizations"("id");
alter table "public"."audit_logs"         add column "org_id" uuid references "public"."organizations"("id"); -- stays nullable

do $$
declare
  v_default_org_id uuid;
  v_needs_backfill boolean;
begin
  select exists (select 1 from public.items limit 1)
      or exists (select 1 from public.profiles where org_id is null limit 1)
      or exists (select 1 from public.inventory_balance limit 1)
      or exists (select 1 from public.clients limit 1)
      or exists (select 1 from public.suppliers limit 1)
      or exists (select 1 from public.quotations limit 1)
      or exists (select 1 from public.sales_orders limit 1)
      or exists (select 1 from public.production_orders limit 1)
      or exists (select 1 from public.workers limit 1)
    into v_needs_backfill;

  if v_needs_backfill then
    insert into public.organizations (name, slug)
    values ('Default Organization', 'default')
    returning id into v_default_org_id;

    update public.items              set org_id = v_default_org_id where org_id is null;
    update public.inventory_balance  set org_id = v_default_org_id where org_id is null;
    update public.clients            set org_id = v_default_org_id where org_id is null;
    update public.suppliers          set org_id = v_default_org_id where org_id is null;
    update public.bom                set org_id = v_default_org_id where org_id is null;
    update public.item_prices        set org_id = v_default_org_id where org_id is null;
    update public.quotations         set org_id = v_default_org_id where org_id is null;
    update public.sales_orders       set org_id = v_default_org_id where org_id is null;
    update public.production_orders  set org_id = v_default_org_id where org_id is null;
    update public.workers            set org_id = v_default_org_id where org_id is null;
    update public.stock_movements    set org_id = v_default_org_id where org_id is null;
    update public.stock_reservations set org_id = v_default_org_id where org_id is null;
    update public.inventory_ops_log  set org_id = v_default_org_id where org_id is null;
    update public.delivery_challans  set org_id = v_default_org_id where org_id is null;
    update public.inbound_receipts   set org_id = v_default_org_id where org_id is null;
    update public.approvals          set org_id = v_default_org_id where org_id is null;
    update public.audit_logs         set org_id = v_default_org_id where org_id is null;

    update public.profiles
    set org_id = v_default_org_id, role = 'admin'
    where org_id is null;
  end if;
end $$;

alter table "public"."clients"            alter column "org_id" set not null;
alter table "public"."suppliers"          alter column "org_id" set not null;
alter table "public"."items"              alter column "org_id" set not null;
alter table "public"."bom"                alter column "org_id" set not null;
alter table "public"."item_prices"        alter column "org_id" set not null;
alter table "public"."quotations"         alter column "org_id" set not null;
alter table "public"."sales_orders"       alter column "org_id" set not null;
alter table "public"."production_orders"  alter column "org_id" set not null;
alter table "public"."workers"            alter column "org_id" set not null;
alter table "public"."stock_movements"    alter column "org_id" set not null;
alter table "public"."stock_reservations" alter column "org_id" set not null;
alter table "public"."inventory_balance"  alter column "org_id" set not null;
alter table "public"."inventory_ops_log"  alter column "org_id" set not null;
alter table "public"."delivery_challans"  alter column "org_id" set not null;
alter table "public"."inbound_receipts"   alter column "org_id" set not null;
alter table "public"."approvals"          alter column "org_id" set not null;

create index "idx_clients_org" on "public"."clients" ("org_id");
create index "idx_suppliers_org" on "public"."suppliers" ("org_id");
create index "idx_items_org" on "public"."items" ("org_id");
create index "idx_bom_org" on "public"."bom" ("org_id");
create index "idx_item_prices_org" on "public"."item_prices" ("org_id");
create index "idx_quotations_org" on "public"."quotations" ("org_id");
create index "idx_sales_orders_org" on "public"."sales_orders" ("org_id");
create index "idx_production_orders_org" on "public"."production_orders" ("org_id");
create index "idx_workers_org" on "public"."workers" ("org_id");
create index "idx_stock_movements_org" on "public"."stock_movements" ("org_id");
create index "idx_stock_reservations_org" on "public"."stock_reservations" ("org_id");
create index "idx_inventory_balance_org" on "public"."inventory_balance" ("org_id");
create index "idx_delivery_challans_org" on "public"."delivery_challans" ("org_id");
create index "idx_inbound_receipts_org" on "public"."inbound_receipts" ("org_id");

alter table "public"."items" drop constraint "items_item_code_key";
alter table "public"."items" add constraint "items_org_item_code_key" unique ("org_id","item_code");

alter table "public"."sales_orders" drop constraint "sales_orders_so_number_key";
alter table "public"."sales_orders" add constraint "sales_orders_org_so_number_key" unique ("org_id","so_number");

alter table "public"."production_orders" drop constraint "production_orders_po_number_key";
alter table "public"."production_orders" add constraint "production_orders_org_po_number_key" unique ("org_id","po_number");

alter table "public"."quotations" drop constraint "quotations_quotation_no_key";
alter table "public"."quotations" add constraint "quotations_org_quotation_no_key" unique ("org_id","quotation_no");

alter table "public"."delivery_challans" drop constraint "delivery_challans_challan_no_key";
alter table "public"."delivery_challans" add constraint "delivery_challans_org_challan_no_key" unique ("org_id","challan_no");

alter table "public"."inbound_receipts" drop constraint "inbound_receipts_receipt_no_key";
alter table "public"."inbound_receipts" add constraint "inbound_receipts_org_receipt_no_key" unique ("org_id","receipt_no");

drop index if exists "public"."workers_email_unique";
create unique index "workers_org_email_unique" on "public"."workers" ("org_id","email") where ("email" is not null);

-- -------------------------------------------------------------------------
-- 5. Update RLS policies: every "auth.uid() IS NOT NULL" read policy and
--    every role-based write policy must also scope to org_id = my_org().
-- -------------------------------------------------------------------------

drop policy if exists "auth reads clients"    on "public"."clients";
drop policy if exists "auth reads suppliers"  on "public"."suppliers";
drop policy if exists "auth reads items"      on "public"."items";
drop policy if exists "auth reads bom"        on "public"."bom";
drop policy if exists "auth reads prices"     on "public"."item_prices";
drop policy if exists "auth reads qt"         on "public"."quotations";
drop policy if exists "auth reads so"         on "public"."sales_orders";
drop policy if exists "auth reads prd"        on "public"."production_orders";
drop policy if exists "auth reads workers"    on "public"."workers";
drop policy if exists "auth reads stock"      on "public"."stock_movements";
drop policy if exists "auth reads reservations" on "public"."stock_reservations";
drop policy if exists "auth reads balance"    on "public"."inventory_balance";
drop policy if exists "auth reads dc"         on "public"."delivery_challans";
drop policy if exists "auth reads grn"        on "public"."inbound_receipts";
drop policy if exists "auth reads approvals"  on "public"."approvals";
drop policy if exists "auth reads audit"      on "public"."audit_logs";

create policy "org reads clients"    on "public"."clients"    for select using (org_id = public.my_org());
create policy "org reads suppliers"  on "public"."suppliers"  for select using (org_id = public.my_org());
create policy "org reads items"      on "public"."items"      for select using (org_id = public.my_org());
create policy "org reads bom"        on "public"."bom"        for select using (org_id = public.my_org());
create policy "org reads prices"     on "public"."item_prices" for select using (org_id = public.my_org());
create policy "org reads qt"         on "public"."quotations" for select using (org_id = public.my_org());
create policy "org reads so"         on "public"."sales_orders" for select using (org_id = public.my_org());
create policy "org reads prd"        on "public"."production_orders" for select using (org_id = public.my_org());
create policy "org reads workers"    on "public"."workers"    for select using (org_id = public.my_org());
create policy "org reads stock"      on "public"."stock_movements" for select using (org_id = public.my_org());
create policy "org reads reservations" on "public"."stock_reservations" for select using (org_id = public.my_org());
create policy "org reads balance"    on "public"."inventory_balance" for select using (org_id = public.my_org());
create policy "org reads dc"         on "public"."delivery_challans" for select using (org_id = public.my_org());
create policy "org reads grn"        on "public"."inbound_receipts" for select using (org_id = public.my_org());
create policy "org reads approvals"  on "public"."approvals" for select using (org_id = public.my_org());
create policy "org reads audit"      on "public"."audit_logs" for select using (org_id = public.my_org());

drop policy if exists "sales manages cli" on "public"."clients";
create policy "org sales manages cli" on "public"."clients"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','sales','manager']::public.user_role[]));

drop policy if exists "admin manages sup" on "public"."suppliers";
create policy "org admin manages sup" on "public"."suppliers"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','store']::public.user_role[]));

drop policy if exists "store manages items" on "public"."items";
create policy "org store manages items" on "public"."items"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','store']::public.user_role[]));

drop policy if exists "prod manages bom" on "public"."bom";
create policy "org prod manages bom" on "public"."bom"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','production']::public.user_role[]));

drop policy if exists "store manages prices" on "public"."item_prices";
create policy "org store manages prices" on "public"."item_prices"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','store','manager']::public.user_role[]));

drop policy if exists "sales manages qt" on "public"."quotations";
create policy "org sales manages qt" on "public"."quotations"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','manager','sales']::public.user_role[]));

drop policy if exists "sales manages so" on "public"."sales_orders";
create policy "org sales manages so" on "public"."sales_orders"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','manager','sales']::public.user_role[]));

drop policy if exists "prod manages prd" on "public"."production_orders";
create policy "org prod manages prd" on "public"."production_orders"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','manager','production']::public.user_role[]));

drop policy if exists "admin manages workers" on "public"."workers";
create policy "org admin manages workers" on "public"."workers"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','manager']::public.user_role[]));

drop policy if exists "store inserts stock" on "public"."stock_movements";
create policy "org store inserts stock" on "public"."stock_movements"
    for insert with check (org_id = public.my_org() and public.my_role() = any (array['admin','store','production']::public.user_role[]));

drop policy if exists "store manages dc" on "public"."delivery_challans";
create policy "org store manages dc" on "public"."delivery_challans"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','manager','store']::public.user_role[]));

drop policy if exists "store manages grn" on "public"."inbound_receipts";
create policy "org store manages grn" on "public"."inbound_receipts"
    using (org_id = public.my_org() and public.my_role() = any (array['admin','store']::public.user_role[]));

drop policy if exists "mgr creates approval" on "public"."approvals";
create policy "org mgr creates approval" on "public"."approvals"
    for insert with check (org_id = public.my_org() and public.my_role() = any (array['admin','manager']::public.user_role[]));

drop policy if exists "admin manages" on "public"."profiles";
create policy "org admin manages profiles" on "public"."profiles"
    using (org_id = public.my_org() and public.my_role() = 'admin');

drop policy if exists "admin reads all" on "public"."profiles";
create policy "org admin reads all" on "public"."profiles"
    for select using (org_id = public.my_org() and public.my_role() = 'admin');

drop policy if exists "user reads own ops" on "public"."inventory_ops_log";
create policy "org user reads own ops" on "public"."inventory_ops_log"
    for select using (
        org_id = public.my_org()
        and (created_by = auth.uid() or public.my_role() = 'admin')
    );

-- -------------------------------------------------------------------------
-- 6. Child/line tables: scope via the parent row's org_id (no duplicate column)
-- -------------------------------------------------------------------------

drop policy if exists "auth reads qt lines" on "public"."quotation_lines";
create policy "org reads qt lines" on "public"."quotation_lines" for select using (
    exists (select 1 from public.quotations q where q.id = quotation_id and q.org_id = public.my_org())
);
drop policy if exists "sales manages qt ln" on "public"."quotation_lines";
create policy "org sales manages qt ln" on "public"."quotation_lines" using (
    exists (select 1 from public.quotations q where q.id = quotation_id and q.org_id = public.my_org())
    and public.my_role() = any (array['admin','manager','sales']::public.user_role[])
);

drop policy if exists "auth reads so lines" on "public"."sales_order_lines";
create policy "org reads so lines" on "public"."sales_order_lines" for select using (
    exists (select 1 from public.sales_orders so where so.id = so_id and so.org_id = public.my_org())
);
drop policy if exists "sales manages so ln" on "public"."sales_order_lines";
create policy "org sales manages so ln" on "public"."sales_order_lines" using (
    exists (select 1 from public.sales_orders so where so.id = so_id and so.org_id = public.my_org())
    and public.my_role() = any (array['admin','manager','sales']::public.user_role[])
);

drop policy if exists "auth reads dc lines" on "public"."delivery_challan_lines";
create policy "org reads dc lines" on "public"."delivery_challan_lines" for select using (
    exists (select 1 from public.delivery_challans dc where dc.id = challan_id and dc.org_id = public.my_org())
);
drop policy if exists "store manages dc ln" on "public"."delivery_challan_lines";
create policy "org store manages dc ln" on "public"."delivery_challan_lines" using (
    exists (select 1 from public.delivery_challans dc where dc.id = challan_id and dc.org_id = public.my_org())
    and public.my_role() = any (array['admin','manager','store']::public.user_role[])
);

drop policy if exists "auth reads grn lines" on "public"."inbound_receipt_lines";
create policy "org reads grn lines" on "public"."inbound_receipt_lines" for select using (
    exists (select 1 from public.inbound_receipts r where r.id = receipt_id and r.org_id = public.my_org())
);
drop policy if exists "store manages grn ln" on "public"."inbound_receipt_lines";
create policy "org store manages grn ln" on "public"."inbound_receipt_lines" using (
    exists (select 1 from public.inbound_receipts r where r.id = receipt_id and r.org_id = public.my_org())
    and public.my_role() = any (array['admin','store']::public.user_role[])
);

drop policy if exists "auth reads prd items" on "public"."production_order_items";
create policy "org reads prd items" on "public"."production_order_items" for select using (
    exists (select 1 from public.production_orders po where po.id = production_order_id and po.org_id = public.my_org())
);
drop policy if exists "prod manages prd itm" on "public"."production_order_items";
create policy "org prod manages prd itm" on "public"."production_order_items" using (
    exists (select 1 from public.production_orders po where po.id = production_order_id and po.org_id = public.my_org())
    and public.my_role() = any (array['admin','manager','production']::public.user_role[])
);

drop policy if exists "auth reads prd asgn" on "public"."production_assignments";
create policy "org reads prd asgn" on "public"."production_assignments" for select using (
    exists (select 1 from public.production_orders po where po.id = production_order_id and po.org_id = public.my_org())
);
drop policy if exists "prod manages prd asgn" on "public"."production_assignments";
create policy "org prod manages prd asgn" on "public"."production_assignments" using (
    exists (select 1 from public.production_orders po where po.id = production_order_id and po.org_id = public.my_org())
    and public.my_role() = any (array['admin','manager','production']::public.user_role[])
);

-- -------------------------------------------------------------------------
-- 7. CRITICAL: the ledger/RPC functions run SECURITY DEFINER owned by
--    "postgres", which bypasses RLS entirely. They need explicit org checks.
-- -------------------------------------------------------------------------

create or replace function "public"."assert_item_in_my_org"("p_item_id" uuid) returns void
    language plpgsql security definer set search_path to public as
$$
begin
  if not exists (
    select 1 from public.items where id = p_item_id and org_id = public.my_org()
  ) then
    raise exception 'Item % not found in your organization', p_item_id using errcode = 'P0007';
  end if;
end;
$$;
alter function "public"."assert_item_in_my_org"(uuid) owner to "postgres";

create or replace function "public"."lock_inventory_balance"("p_item_id" "uuid") returns "public"."inventory_balance"
    language plpgsql security definer set search_path to 'public' as
$$
declare
  v_balance public.inventory_balance;
  v_org     uuid;
begin
  perform public.assert_item_in_my_org(p_item_id);

  select * into v_balance
  from public.inventory_balance
  where item_id = p_item_id
  for update nowait;

  if not found then
    select org_id into v_org from public.items where id = p_item_id;

    insert into public.inventory_balance (item_id, org_id, current_qty, reserved_qty)
    values (p_item_id, v_org, 0, 0)
    on conflict (item_id) do nothing
    returning * into v_balance;

    select * into v_balance
    from public.inventory_balance
    where item_id = p_item_id
    for update nowait;
  end if;

  return v_balance;
end;
$$;

create or replace function "public"."sync_inventory_balance"() returns trigger
    language plpgsql security definer set search_path to 'public' as
$$
declare
  v_delta numeric(14,4);
  v_org   uuid;
begin
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

  select org_id into v_org from public.items where id = new.item_id;

  insert into public.inventory_balance (item_id, org_id, current_qty, reserved_qty, updated_at)
  values (new.item_id, v_org, greatest(0, v_delta), 0, now())
  on conflict (item_id) do update
    set current_qty = greatest(0, public.inventory_balance.current_qty + v_delta),
        updated_at  = now();

  return new;
end;
$$;

create or replace function "public"."adjust_inventory"("p_operation_id" "uuid","p_item_id" "uuid","p_delta" numeric,"p_reason" "text","p_ref_id" "uuid" default null)
returns jsonb language plpgsql security definer set search_path to 'public' as
$$
declare
  v_cached jsonb; v_balance public.inventory_balance; v_movement_id uuid;
  v_move_type movement_type; v_qty numeric; v_result jsonb; v_user uuid := auth.uid();
  v_org uuid;
begin
  select result_payload into v_cached from public.inventory_ops_log where operation_id = p_operation_id;
  if found then return v_cached; end if;

  if p_delta = 0 then raise exception 'Adjustment delta cannot be zero' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  if (select role from public.profiles where id = v_user) not in ('admin','store','manager') then
    raise exception 'Unauthorized: only admin/store/manager can adjust inventory' using errcode = 'P0005';
  end if;

  v_org := public.my_org();
  v_balance := public.lock_inventory_balance(p_item_id);

  if p_delta > 0 then
    v_move_type := 'adjustment_in'; v_qty := p_delta;
  else
    v_move_type := 'adjustment_out'; v_qty := abs(p_delta);
    perform public.validate_stock_sufficiency(p_item_id, v_qty, v_balance);
  end if;

  insert into public.stock_movements(item_id, org_id, movement_type, qty, ref_type, ref_id, notes, created_by)
  values (p_item_id, v_org, v_move_type, v_qty, 'manual_adjustment', p_ref_id, p_reason, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'movement_id', v_movement_id,
      'item_id', p_item_id, 'delta', p_delta, 'movement_type', v_move_type);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, result_movement_id, result_payload, created_by)
  values (p_operation_id, v_org, 'adjust', p_item_id, p_delta, 'manual_adjustment', v_movement_id, v_result, v_user);

  return v_result;
end;
$$;

create or replace function "public"."consume_inventory"("p_operation_id" "uuid","p_item_id" "uuid","p_qty" numeric,"p_reservation_id" "uuid" default null,"p_ref_type" "text" default 'production_order',"p_ref_id" "uuid" default null,"p_notes" "text" default null)
returns jsonb language plpgsql security definer set search_path to 'public' as
$$
declare
  v_cached jsonb; v_balance public.inventory_balance; v_res public.stock_reservations;
  v_movement_id uuid; v_result jsonb; v_user uuid := auth.uid(); v_org uuid;
begin
  select result_payload into v_cached from public.inventory_ops_log where operation_id = p_operation_id;
  if found then return v_cached; end if;
  if p_qty <= 0 then raise exception 'qty must be positive for consume_inventory' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  v_org := public.my_org();
  v_balance := public.lock_inventory_balance(p_item_id);

  if p_reservation_id is not null then
    select * into v_res from public.stock_reservations
    where id = p_reservation_id and item_id = p_item_id and org_id = v_org and status in ('active','partially_consumed')
    for update nowait;

    if not found then
      raise exception 'Reservation % not found or already consumed', p_reservation_id using errcode = 'P0003';
    end if;

    declare v_remaining numeric;
    begin
      v_remaining := v_res.qty_reserved - v_res.qty_consumed - v_res.qty_released;
      if p_qty > v_remaining then
        raise exception 'Consume qty (%) exceeds remaining reservation (%)', p_qty, v_remaining using errcode = 'P0004';
      end if;
    end;

    update public.stock_reservations
    set qty_consumed = qty_consumed + p_qty,
        status = case when (qty_consumed + qty_released + p_qty) = qty_reserved then 'consumed'::reservation_status else 'partially_consumed'::reservation_status end,
        updated_at = now()
    where id = p_reservation_id;

    update public.inventory_balance set reserved_qty = greatest(0, reserved_qty - p_qty), updated_at = now() where item_id = p_item_id;
  else
    perform public.validate_stock_sufficiency(p_item_id, p_qty, v_balance);
  end if;

  insert into public.stock_movements(item_id, org_id, movement_type, qty, ref_type, ref_id, notes, created_by)
  values (p_item_id, v_org, 'consumed', p_qty, p_ref_type, p_ref_id, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'movement_id', v_movement_id,
      'item_id', p_item_id, 'qty_consumed', p_qty, 'reservation_id', p_reservation_id);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_movement_id, result_payload, created_by)
  values (p_operation_id, v_org, 'consume', p_item_id, p_qty, p_ref_type, p_ref_id, v_movement_id, v_result, v_user);

  return v_result;
end;
$$;

create or replace function "public"."dispatch_inventory"("p_operation_id" "uuid","p_item_id" "uuid","p_qty" numeric,"p_rate" numeric,"p_reservation_id" "uuid" default null,"p_ref_type" "text" default 'delivery_challan',"p_ref_id" "uuid" default null,"p_notes" "text" default null)
returns jsonb language plpgsql security definer set search_path to 'public' as
$$
declare
  v_cached jsonb; v_balance public.inventory_balance; v_res public.stock_reservations;
  v_movement_id uuid; v_result jsonb; v_user uuid := auth.uid(); v_org uuid;
begin
  select result_payload into v_cached from public.inventory_ops_log where operation_id = p_operation_id;
  if found then return v_cached; end if;
  if p_qty <= 0 then raise exception 'qty must be positive for dispatch_inventory' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  v_org := public.my_org();
  v_balance := public.lock_inventory_balance(p_item_id);

  if p_reservation_id is not null then
    select * into v_res from public.stock_reservations
    where id = p_reservation_id and item_id = p_item_id and org_id = v_org and status in ('active','partially_consumed')
    for update nowait;

    if not found then
      raise exception 'Reservation % not active for dispatch', p_reservation_id using errcode = 'P0003';
    end if;

    declare v_remaining numeric;
    begin
      v_remaining := v_res.qty_reserved - v_res.qty_consumed - v_res.qty_released;
      if p_qty > v_remaining then
        raise exception 'Dispatch qty (%) exceeds reservation remaining (%)', p_qty, v_remaining using errcode = 'P0004';
      end if;
    end;

    update public.stock_reservations
    set qty_consumed = qty_consumed + p_qty,
        status = case when (qty_consumed + qty_released + p_qty) = qty_reserved then 'consumed'::reservation_status else 'partially_consumed'::reservation_status end,
        updated_at = now()
    where id = p_reservation_id;

    update public.inventory_balance set reserved_qty = greatest(0, reserved_qty - p_qty), updated_at = now() where item_id = p_item_id;
  else
    perform public.validate_stock_sufficiency(p_item_id, p_qty, v_balance);
  end if;

  insert into public.stock_movements(item_id, org_id, movement_type, qty, rate_at_time, ref_type, ref_id, notes, created_by)
  values (p_item_id, v_org, 'sold', p_qty, p_rate, p_ref_type, p_ref_id, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'movement_id', v_movement_id,
      'item_id', p_item_id, 'qty_dispatched', p_qty, 'reservation_id', p_reservation_id);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_movement_id, result_payload, created_by)
  values (p_operation_id, v_org, 'dispatch', p_item_id, p_qty, p_ref_type, p_ref_id, v_movement_id, v_result, v_user);

  return v_result;
end;
$$;

create or replace function "public"."produce_inventory"("p_operation_id" "uuid","p_item_id" "uuid","p_qty" numeric,"p_ref_type" "text" default 'production_order',"p_ref_id" "uuid" default null,"p_notes" "text" default null)
returns jsonb language plpgsql security definer set search_path to 'public' as
$$
declare
  v_cached jsonb; v_movement_id uuid; v_result jsonb; v_user uuid := auth.uid(); v_org uuid;
begin
  select result_payload into v_cached from public.inventory_ops_log where operation_id = p_operation_id;
  if found then return v_cached; end if;
  if p_qty <= 0 then raise exception 'qty must be positive for produce_inventory' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  v_org := public.my_org();
  perform public.lock_inventory_balance(p_item_id);

  insert into public.stock_movements(item_id, org_id, movement_type, qty, ref_type, ref_id, notes, created_by)
  values (p_item_id, v_org, 'produced', p_qty, p_ref_type, p_ref_id, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'movement_id', v_movement_id,
      'item_id', p_item_id, 'qty_produced', p_qty);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_movement_id, result_payload, created_by)
  values (p_operation_id, v_org, 'produce', p_item_id, p_qty, p_ref_type, p_ref_id, v_movement_id, v_result, v_user);

  return v_result;
end;
$$;

create or replace function "public"."receive_inventory"("p_operation_id" "uuid","p_item_id" "uuid","p_qty" numeric,"p_rate" numeric,"p_ref_type" "text","p_ref_id" "uuid","p_batch_no" "text" default null,"p_notes" "text" default null)
returns jsonb language plpgsql security definer set search_path to 'public' as
$$
declare
  v_cached jsonb; v_movement_id uuid; v_result jsonb; v_user uuid := auth.uid(); v_org uuid;
begin
  select result_payload into v_cached from public.inventory_ops_log where operation_id = p_operation_id;
  if found then return v_cached; end if;
  if p_qty <= 0 then raise exception 'qty must be positive for receive_inventory' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  v_org := public.my_org();
  perform public.lock_inventory_balance(p_item_id);

  insert into public.stock_movements(item_id, org_id, movement_type, qty, rate_at_time, ref_type, ref_id, batch_no, notes, created_by)
  values (p_item_id, v_org, 'inbound', p_qty, p_rate, p_ref_type, p_ref_id, p_batch_no, p_notes, v_user)
  returning id into v_movement_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'movement_id', v_movement_id,
      'item_id', p_item_id, 'qty_received', p_qty);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_movement_id, result_payload, created_by)
  values (p_operation_id, v_org, 'receive', p_item_id, p_qty, p_ref_type, p_ref_id, v_movement_id, v_result, v_user);

  return v_result;
end;
$$;

create or replace function "public"."reserve_inventory"("p_operation_id" "uuid","p_item_id" "uuid","p_qty" numeric,"p_ref_type" "text","p_ref_id" "uuid","p_expiry_hours" integer default 72,"p_notes" "text" default null)
returns jsonb language plpgsql security definer set search_path to 'public' as
$$
declare
  v_cached jsonb; v_balance public.inventory_balance; v_reservation_id uuid; v_result jsonb;
  v_user uuid := auth.uid(); v_org uuid;
begin
  select result_payload into v_cached from public.inventory_ops_log where operation_id = p_operation_id;
  if found then return v_cached; end if;
  if p_qty <= 0 then raise exception 'qty must be positive for reserve_inventory' using errcode = 'P0002'; end if;

  perform public.assert_item_in_my_org(p_item_id);
  v_org := public.my_org();
  v_balance := public.lock_inventory_balance(p_item_id);
  perform public.validate_stock_sufficiency(p_item_id, p_qty, v_balance);

  insert into public.stock_reservations(item_id, org_id, qty_reserved, ref_type, ref_id, reservation_expiry, notes, created_by)
  values (p_item_id, v_org, p_qty, p_ref_type, p_ref_id, now() + (p_expiry_hours || ' hours')::interval, p_notes, v_user)
  returning id into v_reservation_id;

  update public.inventory_balance set reserved_qty = reserved_qty + p_qty, updated_at = now() where item_id = p_item_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'reservation_id', v_reservation_id,
      'item_id', p_item_id, 'qty_reserved', p_qty, 'expires_at', now() + (p_expiry_hours || ' hours')::interval);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_payload, created_by)
  values (p_operation_id, v_org, 'reserve', p_item_id, p_qty, p_ref_type, p_ref_id, v_result, v_user);

  return v_result;
end;
$$;

create or replace function "public"."release_inventory"("p_operation_id" "uuid","p_reservation_id" "uuid","p_qty_to_release" numeric default null,"p_notes" "text" default null)
returns jsonb language plpgsql security definer set search_path to 'public' as
$$
declare
  v_cached jsonb; v_res public.stock_reservations; v_qty_release numeric; v_remaining numeric;
  v_result jsonb; v_user uuid := auth.uid();
begin
  select result_payload into v_cached from public.inventory_ops_log where operation_id = p_operation_id;
  if found then return v_cached; end if;

  select * into v_res from public.stock_reservations
  where id = p_reservation_id and org_id = public.my_org() and status in ('active','partially_consumed')
  for update nowait;

  if not found then
    raise exception 'Reservation % not found or not in releasable status', p_reservation_id using errcode = 'P0003';
  end if;

  perform public.lock_inventory_balance(v_res.item_id);

  v_remaining := v_res.qty_reserved - v_res.qty_consumed - v_res.qty_released;
  v_qty_release := coalesce(p_qty_to_release, v_remaining);

  if v_qty_release > v_remaining then
    raise exception 'Release qty (%) exceeds remaining reservation (%)', v_qty_release, v_remaining using errcode = 'P0004';
  end if;

  update public.stock_reservations
  set qty_released = qty_released + v_qty_release,
      status = case when (qty_consumed + qty_released + v_qty_release) = qty_reserved then 'released'::reservation_status else 'partially_consumed'::reservation_status end,
      updated_at = now()
  where id = p_reservation_id;

  update public.inventory_balance set reserved_qty = greatest(0, reserved_qty - v_qty_release), updated_at = now() where item_id = v_res.item_id;

  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'reservation_id', p_reservation_id,
      'qty_released', v_qty_release, 'item_id', v_res.item_id);

  insert into public.inventory_ops_log(operation_id, org_id, operation_type, item_id, qty, ref_type, ref_id, result_payload, created_by)
  values (p_operation_id, v_res.org_id, 'release', v_res.item_id, v_qty_release, v_res.ref_type, v_res.ref_id, v_result, v_user);

  return v_result;
end;
$$;

create or replace function "public"."reconcile_inventory_balance"() returns table("item_id" uuid, "old_qty" numeric, "new_qty" numeric, "diff" numeric)
language plpgsql security definer set search_path to 'public' as
$$
begin
  if (select role from public.profiles where id = auth.uid()) != 'admin' then
    raise exception 'Only admin can run reconciliation' using errcode = 'P0005';
  end if;

  return query
  with ledger_totals as (
    select m.item_id,
      sum(case when m.movement_type in ('inbound','produced','adjustment_in','returned_client') then m.qty else -m.qty end) as true_qty
    from public.stock_movements m
    where m.org_id = public.my_org()
    group by m.item_id
  ),
  updates as (
    update public.inventory_balance ib
    set current_qty = greatest(0, coalesce(lt.true_qty, 0)), updated_at = now()
    from ledger_totals lt
    where ib.item_id = lt.item_id and ib.org_id = public.my_org()
    returning ib.item_id, ib.current_qty as old_qty, greatest(0, coalesce(lt.true_qty, 0)) as new_qty
  )
  select u.item_id, u.old_qty, u.new_qty, u.new_qty - u.old_qty as diff
  from updates u
  where abs(u.new_qty - u.old_qty) > 0.0001;
end;
$$;

commit;