'use client'

import { useState } from 'react'
import { useStockLevels, useReorderAlerts } from '@/lib/hooks/use-stock'
import { PageHeader } from '@/components/layout/page-header'
import { StatCard } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableLoader } from '@/components/ui/spinner'
import { formatQty } from '@/lib/utils/format'
import { useProfile } from '@/lib/hooks/use-profile'
import Link from 'next/link'
import {
  Search, AlertTriangle, Package,
  TrendingDown, CheckCircle2, Filter
} from 'lucide-react'


import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useOrgId } from '@/lib/hooks/use-tenant'
import { useQuery } from "@tanstack/react-query";



export default function InventoryPage() {
  const [search, setSearch]     = useState('')
  const [categoryId, setCategoryId] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false)
  const orgId = useOrgId()

  const { data: profile } = useProfile()
  const canAdjust = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'store'


  const { data: alerts } = useReorderAlerts()
  const { data: stock, isLoading , refetch } = useStockLevels(search)
  const supabase = createClient()


  const { data: categories = [] } = useQuery({
    queryKey: ["item-categories", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("item_categories")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });


  // GRN created
  // ↓
  // Trigger updates inventory_balance
  // ↓
  // Realtime websocket event fires
  // ↓
  // Inventory page receives event
  // ↓
  // refetch() executes
  // ↓
  // UI updates live
useEffect(() => {
  if (!orgId) return
  const channel = supabase
    .channel(`inventory-balance-${orgId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'inventory_balance',
      filter: `org_id=eq.${orgId}`,
    }, () => refetch())
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [orgId, supabase, refetch])



  // Apply filters client-side
  const filtered = (stock ?? []).filter(item => {
    if (categoryId && item.category_id !== categoryId) return false;
    if (showLowOnly && !item.below_reorder) return false
    return true
  })

  const totalItems    = stock?.length ?? 0
  const lowStockCount = alerts?.length ?? 0
  const outOfStock    = (stock ?? []).filter(i => i.qty_available && i.qty_available <= 0).length
  const healthyCount  = totalItems - lowStockCount

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Live stock levels — updated in real time"
      >
        {canAdjust && (
          <Link href="/inventory/adjust">
            <Button size="sm">Adjust Stock</Button>
          </Link>
        )}
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Items"
          value={totalItems}
          icon={<Package className="w-5 h-5" />}
        />
        <StatCard
          label="Healthy Stock"
          value={healthyCount}
          sub="above reorder level"
          icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
          className="border-green-100"
        />
        <StatCard
          label="Low Stock"
          value={lowStockCount}
          sub="at or below reorder level"
          icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
          className={lowStockCount > 0 ? "border-amber-200" : ""}
        />
        <StatCard
          label="Out of Stock"
          value={outOfStock}
          sub="zero available qty"
          icon={<TrendingDown className="w-5 h-5 text-red-600" />}
          className={outOfStock > 0 ? "border-red-200" : ""}
        />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="px-5 py-4 flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="
                w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
              "
            />
          </div>

          {/* Category filter */}
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="
              px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white
              focus:outline-none focus:ring-2 focus:ring-blue-500
            "
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Low stock toggle */}
          <Button
            variant={showLowOnly ? "primary" : "outline"}
            size="sm"
            onClick={() => setShowLowOnly((v) => !v)}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Low Stock Only
            {lowStockCount > 0 && (
              <span
                className={`
                text-xs px-1.5 py-0.5 rounded-full font-bold
                ${showLowOnly ? "bg-white/20" : "bg-amber-100 text-amber-700"}
              `}
              >
                {lowStockCount}
              </span>
            )}
          </Button>

          <span className="text-xs text-slate-400 ml-auto">
            {filtered.length} items
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <TableLoader />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Item Code
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Category
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    On Hand
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Reserved
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Available
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="text-center py-12 text-slate-400 text-sm"
                    >
                      No items found
                    </td>
                  </tr>
                )}
                {filtered.map((item) => {
                  const isLow = item.below_reorder;
                  const isZero = item.qty_available && item.qty_available <= 0;

                  return (
                    <tr
                      key={item.item_id}
                      className={`
                        hover:bg-slate-50 transition-colors
                        ${
                          isZero
                            ? "bg-red-50/30"
                            : isLow
                            ? "bg-amber-50/30"
                            : ""
                        }
                      `}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                          {item.item_code}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-900">
                          {item.name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="default">{item.category ?? "—"}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                        {formatQty(item.qty_on_hand, item.unit ?? undefined)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {item.qty_reserved && item.qty_reserved > 0 ? (
                          <span className="text-amber-600 font-medium">
                            {formatQty(
                              item.qty_reserved,
                              item.unit ?? undefined
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        <span
                          className={
                            isZero
                              ? "text-red-600"
                              : isLow
                              ? "text-amber-600"
                              : "text-slate-900"
                          }
                        >
                          {formatQty(
                            item.qty_available,
                            item.unit ?? undefined
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isZero ? (
                          <Badge variant="danger">Out of Stock</Badge>
                        ) : isLow ? (
                          <Badge variant="warning">Low Stock</Badge>
                        ) : (
                          <Badge variant="success">Healthy</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}