'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from "@/lib/supabase/client";
import { useOrgId } from "@/lib/hooks/use-tenant";
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TableLoader } from '@/components/ui/spinner'
import { formatCurrency, formatDate } from '@/lib/utils/format'
import { Plus, Search, Eye, Truck } from 'lucide-react'
import Link from 'next/link'
import { Route } from 'next'

function useInboundReceipts(search: string, orgId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["inbound-receipts", orgId, search],
    queryFn: async () => {
      if (!orgId) return [];

      let query = supabase
        .from("inbound_receipts")
        .select(
          `
          id, receipt_no, receipt_date, transport_mode,
          vehicle_no, challan_no, invoice_no,
          total_amount, gst_amount, status, created_at,
          supplier:suppliers ( id, name ),
          inbound_receipt_lines ( id )
        `
        )
        .order("created_at", { ascending: false });

      if (search) query = query.ilike("receipt_no", `%${search}%`);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30 * 1000,
  });
}

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  received: 'success',
  partial:  'warning',
  pending:  'default',
  cancelled:'danger',
}

const TRANSPORT_LABELS: Record<string, string> = {
  own_truck:      '🚛 Own Truck',
  supplier_truck: '🚚 Supplier Truck',
  client_truck:   '🚐 Client Truck',
  courier:        '📦 Courier',
  hand_delivery:  '🤝 Hand Delivery',
}

export default function InboundPage() {
  const [search, setSearch] = useState("");
  const orgId = useOrgId();
  const { data: receipts, isLoading } = useInboundReceipts(search, orgId);

  const totalValue = (receipts ?? []).reduce(
    (s, r) => s + (r.total_amount ?? 0),
    0
  );

  return (
    <div>
      <PageHeader
        title="Inbound (GRN)"
        description="Goods received notes from suppliers"
      >
        <Link href="/inbound/new">
          <Button size="sm">
            <Plus className="w-4 h-4" />
            New GRN
          </Button>
        </Link>
      </PageHeader>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <p className="text-sm text-slate-500">Total GRNs</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {receipts?.length ?? 0}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <p className="text-sm text-slate-500">Total Value Received</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {formatCurrency(totalValue)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <p className="text-sm text-slate-500">This Month</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {receipts?.filter((r) => {
              const d = new Date(r.created_at);
              const now = new Date();
              return (
                d.getMonth() === now.getMonth() &&
                d.getFullYear() === now.getFullYear()
              );
            }).length ?? 0}
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
              placeholder="Search by GRN number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <span className="text-xs text-slate-400 ml-auto">
            {receipts?.length ?? 0} receipts
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
                    GRN No.
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Supplier
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Transport
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Challan / Invoice
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
                {receipts?.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="text-center py-12 text-slate-400 text-sm"
                    >
                      No GRNs found
                    </td>
                  </tr>
                )}
                {receipts?.map((r: any) => (
                  <tr
                    key={r.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/inbound/${r.id}` as Route}
                        className="font-mono text-sm font-semibold text-teal-600 hover:underline"
                      >
                        {r.receipt_no}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {r.supplier?.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(r.receipt_date)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {TRANSPORT_LABELS[r.transport_mode] ?? r.transport_mode}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-slate-600">
                        {r.challan_no ?? "—"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {r.invoice_no ?? ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-slate-700 font-medium">
                        {r.inbound_receipt_lines?.length ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <div className="font-semibold text-slate-900">
                        {formatCurrency(r.total_amount)}
                      </div>
                      {r.gst_amount > 0 && (
                        <div className="text-xs text-slate-400">
                          +{formatCurrency(r.gst_amount)} GST
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={STATUS_COLORS[r.status] ?? "default"}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link href={`/inbound/${r.id}` as Route}>
                        <button className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors">
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