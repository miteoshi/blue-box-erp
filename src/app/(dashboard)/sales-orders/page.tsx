'use client'

import { useState } from 'react'
import { useSalesOrders } from '@/lib/hooks/use-sales-orders'
import { PageHeader } from '@/components/layout/page-header'
import { OrderStatusBadge } from '@/components/ui/badge'
import { TableLoader } from '@/components/ui/spinner'
import { formatCurrency, formatDate } from '@/lib/utils/format'
import { Search, Eye, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import type { Enums } from '@/lib/types/database'

type OrderStatus = Enums<'order_status'>

// Removed in_production. ready → reserved.
const STATUS_TABS: { label: string; value: OrderStatus | '' }[] = [
  { label: 'All',        value: '' },
  { label: 'Confirmed',  value: 'confirmed' },
  { label: 'Reserved',   value: 'ready' },       // 'ready' in DB = 'Reserved' in UI
  { label: 'Dispatched', value: 'dispatched' },
  { label: 'Delivered',  value: 'delivered' },
  { label: 'Cancelled',  value: 'cancelled' },
]

// Maps DB status to friendly display label
function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft:         'Draft',
    confirmed:     'Confirmed',
    in_production: 'In Production', // legacy — keep for display only
    ready:         'Reserved',      // renamed
    dispatched:    'Dispatched',
    delivered:     'Delivered',
    cancelled:     'Cancelled',
  }
  return map[status] ?? status
}

export default function SalesOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | ''>('')
  const [search, setSearch] = useState('')

  const { data: orders, isLoading } = useSalesOrders({
    status: status || undefined,
    search,
  })

  const totalOutstanding = (orders ?? [])
    .filter((o: any) => (o.balance_due ?? 0) > 0)
    .reduce((s: number, o: any) => s + (o.balance_due ?? 0), 0)

  return (
    <div>
      <PageHeader
        title="Sales Orders"
        description="Track orders from confirmation through dispatch and delivery"
      />

      {/* Outstanding balance alert */}
      {totalOutstanding > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-sm text-amber-800">
            Total outstanding balance:{' '}
            <strong>{formatCurrency(totalOutstanding)}</strong>
          </span>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg w-fit overflow-x-auto">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatus(tab.value)}
            className={`
              px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap
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
              placeholder="Search by SO number…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <span className="text-xs text-slate-400 ml-auto">
            {orders?.length ?? 0} orders
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? <TableLoader /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">SO Number</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Order Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Delivery By</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Total</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Balance Due</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Quotation</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {orders?.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                      No sales orders found
                    </td>
                  </tr>
                )}
                {orders?.map((order: any) => {
                  const isOverdue = order.delivery_date &&
                    new Date(order.delivery_date) < new Date() &&
                    !['delivered', 'cancelled'].includes(order.status)

                  // Show "Reserved" label instead of "Ready"
                  const displayStatus = order.status === 'ready' ? 'reserved' : order.status

                  return (
                    <tr
                      key={order.id}
                      className={`hover:bg-slate-50 transition-colors ${isOverdue ? 'bg-red-50/30' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/sales-orders/${order.id}`}
                          className="font-mono text-sm font-semibold text-blue-600 hover:underline"
                        >
                          {order.so_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {order.client?.name}
                        </div>
                        <div className="text-xs text-slate-400">
                          {order.client?.phone}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(order.order_date)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={isOverdue ? 'text-red-600 font-medium' : 'text-slate-600'}>
                          {order.delivery_date ? formatDate(order.delivery_date) : '—'}
                          {isOverdue && ' ⚠'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                        {formatCurrency(order.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {(order.balance_due ?? 0) > 0 ? (
                          <span className="text-amber-600 font-medium">
                            {formatCurrency(order.balance_due)}
                          </span>
                        ) : (
                          <span className="text-green-600 text-xs font-medium">Paid ✓</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {/* Override badge for ready→reserved */}
                        {order.status === 'ready' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-teal-100 text-teal-700">
                            Reserved
                          </span>
                        ) : (
                          <OrderStatusBadge status={order.status} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {order.quotation?.quotation_no ? (
                          <Link
                            href={`/quotations/${order.quotation_id}`}
                            className="font-mono text-xs text-slate-500 hover:text-blue-600 hover:underline"
                          >
                            {order.quotation.quotation_no}
                          </Link>
                        ) : (
                          <span className="text-slate-300 text-xs">Direct</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Link href={`/sales-orders/${order.id}`}>
                          <button className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                            <Eye className="w-4 h-4" />
                          </button>
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}