'use client'


import { useOrgId } from "@/lib/hooks/use-tenant";
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TableLoader } from '@/components/ui/spinner'
import { formatCurrency, formatDate } from '@/lib/utils/format'
import { Plus, Search, Eye } from 'lucide-react'
import Link from 'next/link'
import { Route } from 'next'

function useDeliveryChallans(search: string, orgId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["delivery-challans", orgId, search],

    queryFn: async () => {
      if (!orgId) {
        throw new Error("Organization context is not available");
      }

      let query = supabase
        .from("delivery_challans")
        .select(
          `
          id, so_id, challan_no, challan_date, transport_mode,
          vehicle_no, driver_name, total_amount, status, created_at,
          client:clients ( id, name ),
          sales_order:sales_orders ( so_number ),
          delivery_challan_lines ( id )
        `
        )
        .order("created_at", { ascending: false });

      if (search) {
        query = query.ilike("challan_no", `%${search}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      return data;
    },

    enabled: !!orgId,
    staleTime: 30 * 1000,
  });
}

const STATUS_COLORS: Record<string, 'warning' | 'success' | 'danger'> = {
  dispatched: 'warning',
  delivered:  'success',
  returned:   'danger',
}

const TRANSPORT_LABELS: Record<string, string> = {
  own_truck:      '🚛 Own Truck',
  supplier_truck: '🚚 Supplier Truck',
  client_truck:   '🚐 Client Truck',
  courier:        '📦 Courier',
  hand_delivery:  '🤝 Hand Delivery',
}

export default function DispatchPage() {
  const [search, setSearch] = useState("");
  const orgId = useOrgId();

  const { data: challans, isLoading } = useDeliveryChallans(search, orgId);

  const totalDispatched =
    challans?.filter((c) => c.status === "dispatched").length ?? 0;
  const totalDelivered =
    challans?.filter((c) => c.status === "delivered").length ?? 0;
  const totalValue =
    challans?.reduce((s, c) => s + (c.total_amount ?? 0), 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="Dispatch"
        description="Delivery challans for outgoing goods"
      >
        <Link href={"/dispatch/new" as Route}>
          <Button size="sm">
            <Plus className="w-4 h-4" />
            New Challan
          </Button>
        </Link>
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <p className="text-sm text-slate-500">In Transit</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">
            {totalDispatched}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <p className="text-sm text-slate-500">Delivered</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {totalDelivered}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <p className="text-sm text-slate-500">Total Value Dispatched</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {formatCurrency(totalValue)}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="px-5 py-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by challan number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <span className="text-xs text-slate-400 ml-auto">
            {challans?.length ?? 0} challans
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Challan No.
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Client
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Sales Order
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Transport
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Vehicle
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Lines
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Value
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Status
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    View
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {challans?.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="text-center py-12 text-slate-400 text-sm"
                    >
                      No challans found
                    </td>
                  </tr>
                )}
                {challans?.map((c: any) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/dispatch/${c.id}` as Route}
                        className="font-mono text-sm font-semibold text-blue-600 hover:underline"
                      >
                        {c.challan_no}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {c.client?.name}
                    </td>
                    <td className="px-4 py-3">
                      {c.sales_order && (
                        <Link
                          href={`/sales-orders/${c.so_id}`}
                          className="font-mono text-xs text-blue-500 hover:underline"
                        >
                          {c.sales_order.so_number}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(c.challan_date)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {TRANSPORT_LABELS[c.transport_mode] ?? c.transport_mode}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {c.vehicle_no ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-center font-medium text-slate-700">
                      {c.delivery_challan_lines?.length ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                      {formatCurrency(c.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={STATUS_COLORS[c.status] ?? "default"}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link href={`/dispatch/${c.id}` as Route}>
                        <button className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                          <Eye className="w-4 h-4" />
                        </button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}