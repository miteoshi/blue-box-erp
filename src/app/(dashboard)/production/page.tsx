'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useProductionOrders } from '@/lib/hooks/use-production'
import { PageHeader } from '@/components/layout/page-header'
import { ProductionStatusBadge } from '@/components/ui/badge'
import { TableLoader } from '@/components/ui/spinner'
import { formatDate, formatQty } from '@/lib/utils/format'
import { Search, Eye, Plus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { Enums } from '@/lib/types/database'
import type { Route } from 'next'
import { useProfile } from '@/lib/hooks/use-profile'

type ProductionStatus = Enums<'production_status'>

const STATUS_TABS: { label: string; value: ProductionStatus | '' }[] = [
  { label: 'All',         value: '' },
  { label: 'Pending',     value: 'pending' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Completed',   value: 'completed' },
]

import { useOrgId } from '@/lib/hooks/use-tenant'

export default function ProductionPage() {
  const [status, setStatus] = useState<ProductionStatus | ''>('')
  const [search, setSearch] = useState('')
  const { data: profile } = useProfile()
  const orgId = useOrgId()

  const canCreate    = profile?.role === 'admin' || profile?.role === 'manager'
  const isProduction = profile?.role === 'production'

  const { data: orders, isLoading, refetch } = useProductionOrders({
    status: status || undefined,
  })

  const supabase = createClient()

  useEffect(() => {
    if (!orgId) return
    const channel = supabase
      .channel(`production-realtime-${orgId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'production_orders',
        filter: `org_id=eq.${orgId}`,
      }, () => refetch())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [orgId, supabase, refetch])

  const filtered = (orders ?? []).filter(o => {
    if (!search) return true
    return o.po_number.toLowerCase().includes(search.toLowerCase())
  })

  return (
    <div>
      <PageHeader
        title="Production"
        description="Shop floor orders — view what is being manufactured"
      >
        {canCreate && (
          <Link href="/production/new">
            <Button className="bg-purple-600 hover:bg-purple-700" size="sm">
              <Plus className="w-4 h-4" />
              Create Production Order
            </Button>
          </Link>
        )}
      </PageHeader>

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg w-fit">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatus(tab.value)}
            className={`
              px-3 py-1.5 rounded-md text-sm font-medium transition-all
              ${status === tab.value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="px-5 py-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by PRD no…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
          <span className="text-xs text-slate-400 ml-auto">{filtered.length} orders</span>
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">PRD Number</th>
                  {/* Sales Order + Client — hidden for production role (commercial data) */}
                  {!isProduction && (
                    <>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Sales Order</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Client</th>
                    </>
                  )}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Items to Produce</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Workers</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Target Date</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={isProduction ? 6 : 8} className="text-center py-12 text-slate-400 text-sm">
                      No production orders found
                    </td>
                  </tr>
                )}
                {filtered.map((order: any) => {
                  const items       = order.production_order_items ?? []
                  const assignments = order.production_assignments ?? []
                  const isOverdue   = order.target_date &&
                    new Date(order.target_date) < new Date() &&
                    !['completed', 'cancelled'].includes(order.status)

                  return (
                    <tr
                      key={order.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        isOverdue ? "bg-red-50/30" : ""
                      }`}
                    >
                      {/* PRD number — plain text for production, link for others */}
                      <td className="px-4 py-3">
                        {isProduction ? (
                          <span className="font-mono text-sm font-semibold text-purple-600">
                            {order.po_number}
                          </span>
                        ) : (
                          <Link
                            href={`/production/${order.id}` as Route}
                            className="font-mono text-sm font-semibold text-purple-600 hover:underline"
                          >
                            {order.po_number}
                          </Link>
                        )}
                      </td>

                      {/* Sales Order + Client — hidden for production role */}
                      {!isProduction && (
                        <>
                          <td className="px-4 py-3">
                            {order.so ? (
                              <Link
                                href={`/sales-orders/${order.so.id}` as Route}
                                className="font-mono text-xs text-blue-600 hover:underline"
                              >
                                {order.so.so_number}
                              </Link>
                            ) : (
                              <span className="text-slate-400 text-xs">
                                Stock build
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {order.so?.client?.name ?? "—"}
                          </td>
                        </>
                      )}

                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          {items.slice(0, 2).map((item: any) => (
                            <div
                              key={item.id}
                              className="text-xs text-slate-600"
                            >
                              <span className="font-mono text-slate-400 mr-1">
                                {item.item?.item_code}
                              </span>
                              {formatQty(item.qty_required, item.unit?.name)}
                              {item.qty_produced > 0 && (
                                <span className="text-green-600 ml-1">
                                  ({formatQty(item.qty_produced)} done)
                                </span>
                              )}
                            </div>
                          ))}
                          {items.length > 2 && (
                            <div className="text-xs text-slate-400">
                              +{items.length - 2} more
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        {assignments.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {assignments.slice(0, 3).map((a: any) => (
                              <span
                                key={a.id}
                                className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded"
                              >
                                {a.worker?.name?.split(" ")[0]}
                              </span>
                            ))}
                            {assignments.length > 3 && (
                              <span className="text-xs text-slate-400">
                                +{assignments.length - 3}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">
                            Unassigned
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={
                            isOverdue
                              ? "text-red-600 font-medium"
                              : "text-slate-600"
                          }
                        >
                          {order.target_date
                            ? formatDate(order.target_date)
                            : "—"}
                          {isOverdue && " ⚠"}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-center">
                        <ProductionStatusBadge status={order.status} />
                      </td>

                      {/* Eye button — only way to navigate for production role */}
                      <td className="px-4 py-3 text-center">
                        <Link href={`/production/${order.id}` as Route}>
                          <Button variant="ghost" size="sm">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </Link>
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
  )
}