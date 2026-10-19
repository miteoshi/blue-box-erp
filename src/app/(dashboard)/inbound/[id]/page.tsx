import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDate, formatQty } from '@/lib/utils/format'
import { Truck, Package, FileText, User } from 'lucide-react'
import Link from 'next/link'

interface Props {
  params: Promise<{ id: string }>
}

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  received:  'success',
  partial:   'warning',
  pending:   'default',
  cancelled: 'danger',
}

const TRANSPORT_LABELS: Record<string, string> = {
  own_truck:      '🚛 Own Truck',
  supplier_truck: '🚚 Supplier Truck',
  client_truck:   '🚐 Client Truck',
  courier:        '📦 Courier',
  hand_delivery:  '🤝 Hand Delivery',
}

export default async function GrnDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: grn }, { data: movements }] = await Promise.all([
    supabase
      .from("inbound_receipts")
      .select(
        `
        *,
        supplier:suppliers ( id, name, phone, gst_number, city ),
        receiver:profiles!inbound_receipts_received_by_fkey ( full_name ),
        creator:profiles!inbound_receipts_created_by_fkey ( full_name ),
        inbound_receipt_lines (
          id, qty_ordered, qty_received, unit_id,
          unit:units (
            id, name
          ),
          rate, gst_percent, line_total, notes,
          item:items (
                      id,
                      item_code,
                      name,
                      unit_id,
                      category_id,
                      unit:units (
                        id,
                        name
                      ),
                  item_category:item_categories (
                    id,
                    name
                  )
                )
              )
      `
      )
      .eq("id", id)
      .single(),

    supabase
      .from("stock_movements")
      .select("id, qty, movement_type, movement_date, rate_at_time")
      .eq("ref_type", "inbound_receipt")
      .eq("ref_id", id),
  ]);

  if (!grn) notFound()

  const supplier = grn.supplier  as any
  const receiver = grn.receiver  as any
  const creator  = grn.creator   as any
  const lines    = (grn.inbound_receipt_lines as any[]) ?? []
  const subtotal   = grn.total_amount ?? 0
  const gstAmount  = grn.gst_amount   ?? 0
  const grandTotal = subtotal + gstAmount

  return (
    <div>
      <PageHeader
        title={grn.receipt_no}
        description={`Goods Received Note · ${supplier?.name} · ${formatDate(grn.receipt_date)}`}
      >
        <a
          href={`/api/pdf?type=grn&id=${grn.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
        >
          <FileText className="w-4 h-4" />
          Print GRN
        </a>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left ── */}
        <div className="space-y-4">

          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-teal-600" />
                Receipt Details
              </h3>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <Row label="GRN No."     value={<span className="font-mono font-bold">{grn.receipt_no}</span>} />
              <Row label="Status"      value={<Badge variant={STATUS_COLORS[grn.status] ?? 'default'}>{grn.status}</Badge>} />
              <Row label="Date"        value={formatDate(grn.receipt_date)} />
              <Row label="Transport"   value={TRANSPORT_LABELS[grn.transport_mode] ?? grn.transport_mode} />
              {grn.vehicle_no  && <Row label="Vehicle"        value={grn.vehicle_no} />}
              {grn.driver_name && <Row label="Driver"         value={grn.driver_name} />}
              {grn.challan_no  && <Row label="Sup. Challan"   value={<span className="font-mono text-xs">{grn.challan_no}</span>} />}
              {grn.invoice_no  && <Row label="Invoice No."    value={<span className="font-mono text-xs">{grn.invoice_no}</span>} />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-600" />
                Supplier
              </h3>
            </CardHeader>
            <CardBody className="space-y-1.5 text-sm">
              <div className="font-semibold text-slate-900">{supplier?.name}</div>
              {supplier?.phone && <div className="text-slate-500">{supplier.phone}</div>}
              {supplier?.gst_number && (
                <div className="font-mono text-xs text-slate-400">GST: {supplier.gst_number}</div>
              )}
              {supplier?.city && <div className="text-slate-500 text-xs">{supplier.city}</div>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                Recorded By
              </h3>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              {receiver && <Row label="Received By" value={receiver.full_name} />}
              {creator  && <Row label="Entered By"  value={creator.full_name} />}
              <Row label="Created At" value={formatDate(grn.created_at)} />
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2 text-sm">
              <Row label="Subtotal" value={formatCurrency(subtotal)} />
              <Row label="GST"      value={formatCurrency(gstAmount)} />
              <div className="flex justify-between font-bold text-base border-t border-slate-100 pt-2">
                <span>Total</span>
                <span className="text-teal-600">{formatCurrency(grandTotal)}</span>
              </div>
            </CardBody>
          </Card>

          {grn.notes && (
            <Card>
              <CardBody>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-slate-700">{grn.notes}</p>
              </CardBody>
            </Card>
          )}
        </div>

        {/* ── Right ── */}
        <div className="lg:col-span-2 space-y-6">

          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900">
                Items Received
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {lines.length} line{lines.length !== 1 ? 's' : ''}
                </span>
              </h3>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">#</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Item</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Ordered</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Received</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Rate</th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">GST</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {lines.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-slate-400 text-xs">No lines</td></tr>
                  )}
                  {lines.map((line: any, i: number) => {
                    const variance = line.qty_ordered
                      ? line.qty_received - line.qty_ordered
                      : null
                    return (
                      <tr key={line.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-400 text-xs">
                          {i + 1}
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/items/${line.item?.id}`}>
                            <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mr-2">
                              {line.item?.item_code}
                            </span>
                            <span className="font-medium text-slate-900 hover:text-blue-600">
                              {line.item?.name}
                            </span>
                          </Link>
                          {line.notes && (
                            <div className="text-xs text-slate-400 mt-0.5">
                              {line.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                          {line.qty_ordered
                            ? formatQty(line.qty_ordered, line.unit?.name)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className="font-semibold text-slate-900">
                            {formatQty(line.qty_received, line.unit?.name)}
                          </span>
                          {variance !== null && variance !== 0 && (
                            <div
                              className={`text-xs ${
                                variance > 0 ? "text-green-600" : "text-red-600"
                              }`}
                            >
                              {variance > 0 ? "+" : ""}
                              {formatQty(variance, line.unit?.name)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                          {formatCurrency(line.rate)}
                          <div className="text-xs text-slate-400">
                            /{line.unit?.name ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-500">
                          {line.gst_percent}%
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                          {formatCurrency(line.line_total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td colSpan={6} className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">Subtotal</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatCurrency(subtotal)}</td>
                  </tr>
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="px-4 py-1.5 text-right text-xs text-slate-500">GST</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-600">{formatCurrency(gstAmount)}</td>
                  </tr>
                  <tr className="bg-teal-50 border-t border-teal-100">
                    <td colSpan={6} className="px-4 py-3 text-right font-bold text-slate-800">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-teal-600 text-base tabular-nums">
                      {formatCurrency(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* Stock movements */}
          {movements && movements.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900">
                  Stock Movements Created
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    Auto-created when lines were saved
                  </span>
                </h3>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Type</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Qty</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Rate</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {movements.map((m: any) => (
                      <tr key={m.id}>
                        <td className="px-4 py-2.5">
                          <Badge variant="success">{m.movement_type}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-green-600">
                          +{m.qty}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                          {m.rate_at_time ? formatCurrency(m.rate_at_time) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {formatDate(m.movement_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-slate-500 flex-shrink-0">{label}</span>
      <span className="text-slate-900 text-right">{value}</span>
    </div>
  )
}