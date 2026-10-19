import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatQty } from "@/lib/utils/format";
import { Package, TrendingUp, Layers, History } from "lucide-react";
import ItemActions from "@/components/items/item-actions";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ItemDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch item + prices + BOM + stock in parallel
  const [
    { data: item },
    { data: prices },
    { data: bom },
    { data: stock },
    { data: recentMovements },
  ] = await Promise.all([
    supabase
      .from("items")
      .select(
        `
        *,
        item_category:item_categories (
          id,
          name
        ),
        material_type:material_types (
          id,
          name
        ),
        unit:units (
          id,
          name
        )
        `
      )
      .eq("id", id)
      .single(),

    supabase
      .from("item_prices")
      .select("*, supplier:suppliers(name)")
      .eq("item_id", id)
      .order("effective_from", { ascending: false })
      .limit(10),

    supabase
      .from("bom")
      .select(
        `
          id, qty_per_unit, unit_id, notes, is_active,

          unit:units (
            id,
            name
          ),

          component:items!bom_component_id_fkey(
            id,
            item_code,
            name,
            unit_id
          )
      `
      )
      .eq("finished_item_id", id)
      .eq("is_active", true),

    supabase.from("v_stock_levels").select("*").eq("item_id", id).single(),

    supabase
      .from("stock_movements")
      .select(
        "id, movement_type, qty, rate_at_time, movement_date, notes, ref_type"
      )
      .eq("item_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (!item) notFound();

  return (
    <div>
      <PageHeader
        title={item.name}
        description={`${item.item_code} · ${
          item.item_category?.name ?? "—"
        } · ${item.unit?.name ?? "—"}`}
      >
        <ItemActions item={item} stockQty={Number(stock?.qty_on_hand ?? 0)} />
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left column: Details + Stock ── */}
        <div className="space-y-6">
          {/* Item details */}
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-600" />
                Item Details
              </h3>
            </CardHeader>
            <CardBody className="space-y-3">
              <Row
                label="Item Code"
                value={
                  <code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">
                    {item.item_code}
                  </code>
                }
              />
              <Row
                label="Category"
                value={
                  <Badge variant="default">
                    {item.item_category?.name ?? "—"}
                  </Badge>
                }
              />
              <Row label="Sub-Category" value={item.sub_category ?? "—"} />
              <Row label="Material" value={item.material_type?.name ?? "—"} />
              <Row label="Unit" value={item.unit?.name ?? "—"} />
              <Row label="HSN Code" value={item.hsn_code ?? "—"} />
              <Row label="Size / Spec" value={item.size_spec ?? "—"} />
              <Row
                label="Type"
                value={
                  <div className="flex gap-1">
                    {item.is_traded && <Badge variant="info">Traded</Badge>}
                    {item.is_manufactured && (
                      <Badge variant="purple">Manufactured</Badge>
                    )}
                    {item.is_raw_material && (
                      <Badge variant="teal">Raw Material</Badge>
                    )}
                  </div>
                }
              />
              {item.notes && (
                <div className="pt-2 border-t border-slate-100">
                  <p className="text-xs text-slate-500">{item.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Stock levels */}
          {stock && (
            <Card>
              <CardHeader>
                <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-teal-600" />
                  Stock Levels
                </h3>
              </CardHeader>
              <CardBody className="space-y-3">
                <Row
                  label="On Hand"
                  value={
                    <span className="font-semibold">
                      {formatQty(stock.qty_on_hand, stock.unit ?? undefined)}
                    </span>
                  }
                />
                <Row
                  label="Reserved"
                  value={
                    stock.qty_reserved && stock.qty_reserved > 0 ? (
                      <span className="text-amber-600 font-medium">
                        {formatQty(stock.qty_reserved, stock.unit ?? undefined)}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <Row
                  label="Available"
                  value={
                    <span
                      className={`font-bold text-base ${
                        stock.below_reorder
                          ? "text-amber-600"
                          : "text-green-600"
                      }`}
                    >
                      {formatQty(stock.qty_available, stock.unit ?? undefined)}
                    </span>
                  }
                />
                <Row
                  label="Reorder At"
                  value={formatQty(
                    stock.reorder_level,
                    stock.unit ?? undefined
                  )}
                />
                {stock.below_reorder && (
                  <div className="pt-2">
                    <Badge variant="warning">⚠ Below reorder level</Badge>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        {/* ── Right column: Prices + BOM + Movements ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Price history */}
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                <History className="w-4 h-4 text-blue-600" />
                Price History
              </h3>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      Supplier
                    </th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      Purchase Rate
                    </th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      Selling Rate
                    </th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      GST
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      Effective From
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {prices?.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center py-6 text-slate-400 text-xs"
                      >
                        No price records
                      </td>
                    </tr>
                  )}
                  {prices?.map((price) => {
                    const isActive =
                      !price.effective_to ||
                      new Date(price.effective_to) >= new Date();
                    return (
                      <tr
                        key={price.id}
                        className={isActive ? "bg-green-50/40" : ""}
                      >
                        <td className="px-4 py-2.5 text-slate-600">
                          {(price.supplier as any)?.name ?? (
                            <span className="text-slate-400">General</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatCurrency(price.selling_rate)}
                          <span className="text-xs text-slate-400 font-normal ml-1">
                            /{item.unit?.name ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                          {formatCurrency(price.selling_rate)}
                          <span className="text-xs text-slate-400 font-normal ml-1">
                            /{item.unit?.name ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-slate-600">
                          {price.gst_percent}%
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {formatDate(price.effective_from)}
                        </td>
                        <td className="px-4 py-2.5">
                          {isActive ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <Badge variant="default">
                              Expired {formatDate(price.effective_to)}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* BOM */}
          {item.is_manufactured && (
            <Card>
              <CardHeader>
                <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-purple-600" />
                  Bill of Materials
                  <Badge variant="purple">{bom?.length ?? 0} components</Badge>
                </h3>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                        Component
                      </th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                        Qty per Unit
                      </th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {bom?.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="text-center py-6 text-slate-400 text-xs"
                        >
                          No BOM defined
                        </td>
                      </tr>
                    )}
                    {bom?.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2.5">
                          <span className="font-mono text-xs text-slate-400 mr-2">
                            {(line.component as any)?.item_code}
                          </span>
                          <span className="font-medium text-slate-900">
                            {(line.component as any)?.name}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                          {formatQty(line.qty_per_unit, line.unit?.name)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">
                          {line.notes ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Recent stock movements */}
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-slate-900 text-sm">
                Recent Stock Movements
              </h3>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      Date
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      Type
                    </th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      Qty
                    </th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      Rate
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                      Source
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recentMovements?.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-6 text-slate-400 text-xs"
                      >
                        No movements recorded
                      </td>
                    </tr>
                  )}
                  {recentMovements?.map((m) => {
                    const isPositive = [
                      "inbound",
                      "produced",
                      "adjustment_in",
                      "returned_client",
                    ].includes(m.movement_type);
                    return (
                      <tr key={m.id}>
                        <td className="px-4 py-2.5 text-slate-500">
                          {formatDate(m.movement_date)}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={isPositive ? "success" : "danger"}>
                            {m.movement_type.replace("_", " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                          <span
                            className={
                              isPositive ? "text-green-600" : "text-red-600"
                            }
                          >
                            {isPositive ? "+" : "-"}
                            {formatQty(m.qty, item.unit?.name)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                          {m.rate_at_time
                            ? formatCurrency(m.rate_at_time)
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">
                          {m.ref_type?.replace("_", " ") ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Simple label-value row helper
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-slate-500 flex-shrink-0">{label}</span>
      <span className="text-slate-900 text-right">{value}</span>
    </div>
  );
}
