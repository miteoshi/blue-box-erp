'use client'

import { useState } from 'react'
import { useOrgId } from "@/lib/hooks/use-tenant";
import { useParams, useRouter } from 'next/navigation'
import { useSalesOrder, useUpdateSOStatus, useRecordPayment } from '@/lib/hooks/use-sales-orders'
import { useCanApprove, useCanSell } from '@/lib/hooks/use-profile'
import { reserveInventory, releaseInventory } from '@/lib/utils/inventory'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, OrderStatusBadge } from '@/components/ui/badge'
import { PageLoader } from '@/components/ui/spinner'
import { formatCurrency, formatDate, formatQty } from '@/lib/utils/format'
import { toast } from 'sonner'
import {
  ArrowLeft, Send, CreditCard,
  Package, Truck, CheckCircle,
  User, FileText, AlertTriangle, XCircle
} from 'lucide-react'
import Link from 'next/link'

export default function SalesOrderDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const supabase = createClient()
  const qc       = useQueryClient()
  const orgId = useOrgId();

  const canApprove = useCanApprove()
  const canSell    = useCanSell()

  const { data: so, isLoading, refetch } = useSalesOrder(id)
  const { mutate: updateStatus, isPending: updatingStatus } = useUpdateSOStatus()
  const { mutate: recordPayment, isPending: recordingPayment } = useRecordPayment()

  const [paymentAmount,   setPaymentAmount]   = useState('')
  const [showPaymentBox,  setShowPaymentBox]  = useState(false)
  const [reservingStock,  setReservingStock]  = useState(false)
  const [cancelling,      setCancelling]      = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  // ── All reservations for this SO (active + partially_consumed) ─
const { data: reservations } = useQuery({
  queryKey: ["so-reservations", orgId, id],
  queryFn: async () => {
    if (!orgId || !id) return [];

    const { data, error } = await supabase
      .from("stock_reservations")
      .select("id, item_id, qty_reserved, qty_consumed, status")
      .eq("ref_type", "sales_order")
      .eq("ref_id", id)
      .in("status", ["active", "partially_consumed"]);

    if (error) throw error;
    return data ?? [];
  },
  enabled: !!orgId && !!id,
  staleTime: 30 * 1000,
});

  const hasReservations = (reservations?.length ?? 0) > 0

  if (isLoading) return <PageLoader />
  if (!so)       return <div className="text-slate-500 text-sm p-6">Sales order not found</div>

  const salesOrder = so
  const client     = so.client as any
  const lines      = (so.sales_order_lines as any[]) ?? []
  const challans   = (so.delivery_challans as any[]) ?? []

  const isConfirmed  = so.status === 'confirmed'
  const isReserved   = so.status === 'ready'
  const isDispatched = so.status === 'dispatched'
  const isDelivered  = so.status === 'delivered'
  const isCancelled  = so.status === 'cancelled'

  // ── Reserve stock ─────────────────────────────────────────
  async function handleReserveStock() {

    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }

    setReservingStock(true)
    try {
      let allSucceeded = true
      for (const line of lines) {
        try {
          await reserveInventory({
            itemId:  line.item_id,
            qty:     line.qty,
            refType: 'sales_order',
            refId:   salesOrder.id,
          })
        } catch (err: unknown) {
          toast.error(
            `${line.item?.name}: ${
              err instanceof Error ? err.message : "Failed to reserve stock"
            }`
          );
          allSucceeded = false
          break
        }
      }
      if (allSucceeded) {
        updateStatus({ id, status: 'ready' })
        toast.success('Stock reserved — order is now ready to dispatch')
        qc.invalidateQueries({ queryKey: ["so-reservations", orgId, id] });
        refetch()
      }
    } finally {
      setReservingStock(false)
    }
  }

  // ── Cancel SO + release all reservations ──────────────────
  // Flow:
  //   1. Release every active/partially_consumed reservation
  //      → DB marks them as 'released', restores available_qty
  //   2. Mark SO as 'cancelled'
  //   3. Invalidate queries so UI reflects the freed stock
  async function handleCancel() {

    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }
    
    setCancelling(true)
    try {
      // Release each reservation individually
      // releaseInventory with no qtyToRelease = release all remaining
      const activeReservations = reservations ?? [];

      for (const reservation of activeReservations) {
        await releaseInventory({
          reservationId: reservation.id,
          notes: `SO cancelled — ${salesOrder.so_number}`,
        });
      }

      // Mark SO as cancelled
      updateStatus({ id, status: "cancelled" });

      if (activeReservations.length > 0) {
        toast.success(
          `SO ${salesOrder.so_number} cancelled — ${activeReservations.length} reservation(s) released back to available stock`
        );
      } else {
        toast.success(`SO ${salesOrder.so_number} cancelled`);
      }

      qc.invalidateQueries({ queryKey: ["so-reservations", orgId, id] });
      qc.invalidateQueries({ queryKey: ["stock-levels"] });
      setShowCancelConfirm(false);
      refetch();
    } catch (err: unknown) {
      toast.error(
        `Cancel failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setCancelling(false);
    }
  }

  // ── Record payment ────────────────────────────────────────
  function handleRecordPayment() {
    const amount = Number(paymentAmount)
    if (!amount || amount <= 0) { toast.error('Enter a valid payment amount'); return }
    if (amount > (salesOrder.balance_due ?? 0)) {
      toast.error(`Amount exceeds balance due (${formatCurrency(salesOrder.balance_due ?? 0)})`)
      return
    }
    recordPayment(
      {
        id,
        amount,
        currentAdvance: salesOrder.advance_paid ?? 0,
        totalAmount:    salesOrder.total_amount,
      },
      {
        onSuccess: () => {
          setPaymentAmount('')
          setShowPaymentBox(false)
        },
      }
    )
  }

  return (
    <div>
      <PageHeader
        title={salesOrder.so_number}
        description={`${client?.name} · ${formatDate(so.order_date)}`}
      >
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>

        {/* Reserve Stock */}
        {isConfirmed && !hasReservations && canSell && (
          <Button variant="secondary" size="sm" loading={reservingStock} onClick={handleReserveStock}>
            <Package className="w-4 h-4" />
            Reserve Stock
          </Button>
        )}

        {/* Already reserved badge */}
        {isConfirmed && hasReservations && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-50 border border-teal-200 rounded-lg">
            <CheckCircle className="w-4 h-4 text-teal-600" />
            <span className="text-sm font-medium text-teal-700">Stock Reserved</span>
          </div>
        )}

        {/* Create challan */}
        {isReserved && canSell && (
          <Link href={`/dispatch/new?so=${so.id}`}>
            <Button size="sm">
              <Send className="w-4 h-4" />
              Create Challan
            </Button>
          </Link>
        )}

        {/* Record payment */}
        {(salesOrder.balance_due ?? 0) > 0 && canSell && !isCancelled && (
          <Button variant="outline" size="sm" onClick={() => setShowPaymentBox(v => !v)}>
            <CreditCard className="w-4 h-4" />
            Record Payment
          </Button>
        )}

        {/* Cancel — only available when not already dispatched/delivered/cancelled */}
        {!isDispatched && !isDelivered && !isCancelled && canSell && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCancelConfirm(true)}
            style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#ef4444' }}
          >
            <XCircle className="w-4 h-4" />
            Cancel Order
          </Button>
        )}
      </PageHeader>

      {/* ── Cancel confirmation banner ──────────────────────── */}
      {showCancelConfirm && (
        <div className="mb-6 flex items-start gap-4 bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-800 mb-1">
              Cancel {salesOrder.so_number}?
            </p>
            <p className="text-sm text-red-700">
              {hasReservations
                ? `This will release ${reservations?.length} reservation(s) back to available stock. This cannot be undone.`
                : 'This will cancel the order. This cannot be undone.'
              }
            </p>
            <div className="flex gap-3 mt-3">
              <Button
                size="sm"
                loading={cancelling}
                onClick={handleCancel}
                style={{ background: '#ef4444', color: '#fff' }}
              >
                Yes, Cancel Order
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep Order
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reservation warning */}
      {isConfirmed && !hasReservations && (
        <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Stock has not been reserved yet. Reserve stock before creating a delivery challan —
            dispatch only works from reserved stock.
          </p>
        </div>
      )}

      {/* Payment box */}
      {showPaymentBox && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm font-medium text-blue-800 mb-3">
            Record payment — Balance due: {formatCurrency(salesOrder.balance_due ?? 0)}
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={paymentAmount}
              onChange={e => setPaymentAmount(e.target.value)}
              placeholder="Amount received (₹)"
              className="flex-1 max-w-xs px-3 py-2 text-sm rounded-lg border border-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <Button size="sm" loading={recordingPayment} onClick={handleRecordPayment}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowPaymentBox(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left column ── */}
        <div className="space-y-4">

          {/* Status */}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Status</span>
                {salesOrder.status === 'ready' ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-teal-100 text-teal-700">
                    Reserved
                  </span>
                ) : (
                  <OrderStatusBadge status={salesOrder.status} />
                )}
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">SO Number</span>
                <span className="font-mono font-bold text-slate-900">{salesOrder.so_number}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Order Date</span>
                <span className="text-slate-700">{formatDate(salesOrder.order_date)}</span>
              </div>
              {salesOrder.delivery_date && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Delivery By</span>
                  <span className={
                    new Date(salesOrder.delivery_date) < new Date() &&
                    !['delivered', 'cancelled'].includes(salesOrder.status)
                      ? 'text-red-500 font-medium'
                      : 'text-slate-700'
                  }>
                    {formatDate(salesOrder.delivery_date)}
                  </span>
                </div>
              )}
              {salesOrder.payment_terms && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Payment</span>
                  <span className="text-slate-700 text-right text-xs max-w-[160px]">
                    {salesOrder.payment_terms}
                  </span>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Client */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                Client
              </h3>
            </CardHeader>
            <CardBody className="space-y-1.5 text-sm">
              <div className="font-semibold text-slate-900">{client?.name}</div>
              {client?.phone && <div className="text-slate-500">{client.phone}</div>}
              {client?.gst_number && (
                <div className="font-mono text-xs text-slate-400">GST: {client.gst_number}</div>
              )}
              {client?.address && (
                <div className="text-slate-500 text-xs">{client.address}, {client.city}</div>
              )}
            </CardBody>
          </Card>

          {/* Financials */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-green-600" />
                Financials
              </h3>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Subtotal</span>
                <span>{formatCurrency(salesOrder.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">GST</span>
                <span>{formatCurrency(salesOrder.gst_amount)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-slate-100 pt-2">
                <span>Total</span>
                <span>{formatCurrency(salesOrder.total_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Advance Paid</span>
                <span className="text-green-600 font-medium">
                  {formatCurrency(salesOrder.advance_paid ?? 0)}
                </span>
              </div>
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                <span>Balance Due</span>
                <span className={(salesOrder.balance_due ?? 0) > 0 ? 'text-amber-600' : 'text-green-600'}>
                  {(salesOrder.balance_due ?? 0) > 0 ? formatCurrency(salesOrder.balance_due) : 'Paid ✓'}
                </span>
              </div>
            </CardBody>
          </Card>

          {/* Source quotation */}
          {salesOrder.quotation_id && (
            <Card>
              <CardBody className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    Source Quotation
                  </span>
                  <Link
                    href={`/quotations/${salesOrder.quotation_id as string}`}
                    className="font-mono text-blue-600 hover:underline text-xs"
                  >
                    {(salesOrder.quotation as any)?.quotation_no}
                  </Link>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Active reservations */}
          {hasReservations && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Package className="w-4 h-4 text-teal-600" />
                  Reserved Stock
                  <Badge variant="teal">{reservations?.length}</Badge>
                </h3>
              </CardHeader>
              <CardBody className="space-y-2 text-sm">
                {reservations?.map((r: any) => (
                  <div key={r.id} className="flex justify-between items-center">
                    <span className="text-slate-600 text-xs truncate max-w-[140px]">{r.item_id}</span>
                    <span className="font-medium text-teal-700">{r.qty_reserved} reserved</span>
                  </div>
                ))}
                <p className="text-xs text-slate-400 pt-1 border-t border-slate-100">
                  These quantities are committed for this order only.
                  {!isCancelled && ' Cancelling the order will release them back to available stock.'}
                </p>
              </CardBody>
            </Card>
          )}

          {/* Deliveries */}
          {challans.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Truck className="w-4 h-4 text-blue-600" />
                  Deliveries
                </h3>
              </CardHeader>
              <CardBody className="space-y-2">
                {challans.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between text-sm">
                    <Link href={`/dispatch/${c.id}`} className="font-mono text-blue-600 hover:underline">
                      {c.challan_no}
                    </Link>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs">{formatDate(c.challan_date)}</span>
                      <Badge variant={c.status === 'delivered' ? 'success' : 'warning'}>{c.status}</Badge>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        {/* ── Right: Line items ── */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900">
                Line Items
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {lines.length} item{lines.length !== 1 ? 's' : ''}
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
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Dispatched</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Rate</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {lines.map((line: any, i: number) => {
                    const subtotal      = line.qty * line.unit_rate
                    const gst           = subtotal * Number(line.gst_percent) / 100
                    const allDispatched = (line.qty_dispatched ?? 0) >= line.qty
                    return (
                      <tr key={line.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mr-2">
                            {line.item?.item_code}
                          </span>
                          <span className="font-medium text-slate-900">
                            {line.description || line.item?.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">
                          {formatQty(line.qty, line.unit)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={allDispatched ? 'text-green-600 font-medium' : 'text-amber-600'}>
                            {formatQty(line.qty_dispatched ?? 0, line.unit)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                          {formatCurrency(line.unit_rate)}
                          <div className="text-xs text-slate-400">/{line.unit}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <div className="font-semibold text-slate-900">{formatCurrency(subtotal + gst)}</div>
                          <div className="text-xs text-slate-400">incl. {line.gst_percent}% GST</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td colSpan={5} className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">Subtotal</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatCurrency(salesOrder.subtotal ?? 0)}</td>
                  </tr>
                  <tr className="bg-slate-50">
                    <td colSpan={5} className="px-4 py-1.5 text-right text-xs text-slate-500">GST</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-600">{formatCurrency(salesOrder.gst_amount ?? 0)}</td>
                  </tr>
                  <tr className="bg-blue-50 border-t border-blue-100">
                    <td colSpan={5} className="px-4 py-3 text-right font-bold text-slate-800">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-blue-600 text-base tabular-nums">{formatCurrency(salesOrder.total_amount ?? 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}