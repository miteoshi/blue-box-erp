'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuotation, useUpdateQuotationStatus } from '@/lib/hooks/use-quotations'
import { useCanApprove, useCanSell } from '@/lib/hooks/use-profile'
import { useOrgId } from '@/lib/hooks/use-tenant'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, DocumentStatusBadge } from '@/components/ui/badge'
import { PageLoader } from '@/components/ui/spinner'
import { formatCurrency, formatDate, formatQty } from '@/lib/utils/format'
import { toast } from 'sonner'
import {
  CheckCircle, XCircle, ShoppingCart,
  Printer, ArrowLeft, Clock, User, Calendar
} from 'lucide-react'

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()
  const supabase = createClient()
  const orgId = useOrgId()

  const canApprove  = useCanApprove()
  const canSell     = useCanSell()

  const { data: qt, isLoading } = useQuotation(id)
  const { mutate: updateStatus, isPending: isUpdatingStatus } = useUpdateQuotationStatus()

  const [convertingToSO, setConvertingToSO] = useState(false)
  const [rejectComment, setRejectComment]   = useState('')
  const [showRejectBox, setShowRejectBox]   = useState(false)

  if (isLoading) return <PageLoader />
  if (!qt) return <div className="text-slate-500 text-sm">Quotation not found</div>

  const client  = qt.client  as any
  const creator = qt.creator as any
  const approver = qt.approver as any
  const lines   = qt.quotation_lines as any[] ?? []

  const isPendingApproval = qt.status === 'pending_approval'
  const isDraft    = qt.status === 'draft'
  const isApproved = qt.status === 'approved'
  const isConverted = qt.status === 'converted'
  const canConvert = isApproved && canSell && !isConverted

  // ── Convert to Sales Order ────────────────────────────────
  async function convertToSO() {
    if (!qt) return;
    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }

    setConvertingToSO(true);
  try {
    //calculating delivery date
    const orderDate = new Date();

    const deliveryDate = qt.delivery_days
      ? new Date(orderDate.getTime() + qt.delivery_days * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0]
      : null;

    // Generate SO number with tenant org_id
    const { data: soNo, error: rpcErr } = await supabase.rpc("next_so_no", {
      p_org_id: orgId,
    });
    if (rpcErr) throw rpcErr;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Create sales order from quotation with org_id
    const { data: so, error: soErr } = await supabase
      .from("sales_orders")
      .insert({
        org_id: orgId,
        so_number: soNo as string,
        created_by: user?.id ?? null,
        quotation_id: qt.id,
        client_id: qt.client_id,
        order_date: new Date().toISOString().split("T")[0],
        status: "confirmed",
        subtotal: qt.subtotal,
        gst_amount: qt.gst_amount,
        total_amount: qt.total_amount,
        balance_due: qt.total_amount,
        payment_terms: qt.payment_terms,
        delivery_date: deliveryDate,
        notes:
          [qt.notes, qt.transport_note && `Transport: ${qt.transport_note}`]
            .filter(Boolean)
            .join("\n\n") || null,
      })
      .select("id")
      .single();

    if (soErr) throw soErr;

    // Copy quotation lines to SO lines
    const { error: linesErr } = await supabase.from("sales_order_lines").insert(
      lines.map((l: any, idx: number) => ({
        so_id: so.id,
        item_id: l.item_id,
        description: l.description,
        qty: l.qty,
        unit_id: l.unit_id,
        unit_rate: l.unit_rate,
        gst_percent: l.gst_percent,
        sort_order: idx,
      }))
    );

    if (linesErr) throw linesErr;

    // ── Mark quotation as converted ───────────────────────
    // Prevents double-conversion and makes the status clear in the list
    await supabase
      .from("quotations")
      .update({ status: "converted" as any }) // add 'converted' to enum — see SQL below
      .eq("id", qt.id);

    toast.success("Sales order created successfully!");
    router.push(`/sales-orders/${so.id}`);
  } catch (err: unknown) {
  toast.error(err instanceof Error ? err.message : 'Failed to convert quotation')
  } finally {
    setConvertingToSO(false);
  }
}

  function handleApprove() {
    updateStatus({ id, status: 'approved' })
    setShowRejectBox(false)
  }

  function handleReject() {
    if (!rejectComment.trim()) {
      toast.error('Please add a reason for rejection')
      return
    }
    updateStatus({ id, status: 'rejected', comments: rejectComment })
    setShowRejectBox(false)
    setRejectComment('')
  }

  return (
    <div>
      <PageHeader
        title={qt.quotation_no}
        description={`Created ${formatDate(qt.created_at)} · ${client?.name}`}
      >
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>

        {/* Submit for approval (draft only, sales role) */}
        {isDraft && canSell && (
          <Button
            size="sm"
            loading={isUpdatingStatus}
            onClick={() => updateStatus({ id, status: 'pending_approval' })}
          >
            <Clock className="w-4 h-4" />
            Submit for Approval
          </Button>
        )}

        {/* Approve/Reject (pending, manager/admin only) */}
        {isPendingApproval && canApprove && (
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={isUpdatingStatus}
              onClick={handleApprove}
              className="text-green-700 bg-green-50 hover:bg-green-100"
            >
              <CheckCircle className="w-4 h-4" />
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowRejectBox(v => !v)}
              className="text-red-600 hover:bg-red-50"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </Button>
          </>
        )}

        {/* Convert to SO (approved only, not yet converted) */}
        {canConvert && (
          <Button
            size="sm"
            loading={convertingToSO}
            onClick={convertToSO}
            className="bg-teal-600 hover:bg-teal-700"
          >
            <ShoppingCart className="w-4 h-4" />
            Convert to Sales Order
          </Button>
        )}

        {/* Already converted — show badge instead of button */}
        {isConverted && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-50 border border-teal-200 rounded-lg">
            <CheckCircle className="w-4 h-4 text-teal-600" />
            <span className="text-sm font-medium text-teal-700">Converted to SO</span>
          </div>
        )}
      </PageHeader>

      {/* Reject comment box */}
      {showRejectBox && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-medium text-red-800 mb-2">
            Reason for rejection
          </p>
          <textarea
            rows={2}
            value={rejectComment}
            onChange={e => setRejectComment(e.target.value)}
            placeholder="Explain why this quotation is being rejected…"
            className="w-full px-3 py-2 text-sm rounded-lg border border-red-200 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
          />
          <div className="flex gap-2 mt-2">
            <Button variant="danger" size="sm" onClick={handleReject}>
              Confirm Rejection
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowRejectBox(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left column ── */}
        <div className="space-y-4">

          {/* Status card */}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Status</span>
                {(qt.status as any) === 'converted' ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 11, fontWeight: 600, padding: '2px 8px',
                    borderRadius: 5, background: 'rgba(20,184,166,0.12)',
                    color: '#0d9488',
                  }}>
                    Converted
                  </span>
                ) : (
                  <DocumentStatusBadge status={qt.status} />
                )}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Quotation No.</span>
                <span className="font-mono font-semibold text-slate-900">{qt.quotation_no}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Date</span>
                <span className="text-slate-700">{formatDate(qt.quotation_date)}</span>
              </div>
              {qt.valid_until && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Valid Until</span>
                  <span className={new Date(qt.valid_until) < new Date() ? 'text-red-500' : 'text-slate-700'}>
                    {formatDate(qt.valid_until)}
                  </span>
                </div>
              )}
              {qt.delivery_days && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Delivery</span>
                  <span className="text-slate-700">{qt.delivery_days} days</span>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Client card */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                Client
              </h3>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
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

          {/* Terms card */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900">Terms & Notes</h3>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              {qt.payment_terms && (
                <div>
                  <span className="text-slate-400 text-xs uppercase tracking-wide">Payment</span>
                  <p className="text-slate-700 mt-0.5">{qt.payment_terms}</p>
                </div>
              )}
              {qt.transport_note && (
                <div>
                  <span className="text-slate-400 text-xs uppercase tracking-wide">Transport</span>
                  <p className="text-slate-700 mt-0.5">{qt.transport_note}</p>
                </div>
              )}
              {qt.notes && (
                <div>
                  <span className="text-slate-400 text-xs uppercase tracking-wide">Notes</span>
                  <p className="text-slate-700 mt-0.5">{qt.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Approval info */}
          {(creator || approver) && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  Workflow
                </h3>
              </CardHeader>
              <CardBody className="space-y-2 text-sm">
                {creator && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Created by</span>
                    <span className="text-slate-700">{creator.full_name}</span>
                  </div>
                )}
                {approver && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Approved by</span>
                    <span className="text-slate-700">{approver.full_name}</span>
                  </div>
                )}
                {qt.approved_at && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Approved at</span>
                    <span className="text-slate-700">{formatDate(qt.approved_at)}</span>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        {/* ── Right column: Line items ── */}
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
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Qty</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Rate</th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">GST</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Subtotal</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {lines.map((line: any, i: number) => {
                    const lineSubtotal = line.qty * line.unit_rate
                    const lineGst = lineSubtotal * Number(line.gst_percent) / 100
                    const lineTotal = lineSubtotal + lineGst
                    return (
                      <tr key={line.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                              {line.item?.item_code}
                            </span>
                            <div>
                              <div className="font-medium text-slate-900">
                                {line.description || line.item?.name}
                              </div>
                              {line.description && line.description !== line.item?.name && (
                                <div className="text-xs text-slate-400">{line.item?.name}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatQty(line.qty, line.unit)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatCurrency(line.unit_rate)}
                          <div className="text-xs text-slate-400">/{line.unit}</div>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-600">
                          {line.gst_percent}%
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {formatCurrency(lineSubtotal)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                          {formatCurrency(lineTotal)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td colSpan={6} className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">
                      Subtotal
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      {formatCurrency(qt.subtotal)}
                    </td>
                  </tr>
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="px-4 py-1.5 text-right text-xs text-slate-500">
                      GST
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-600">
                      {formatCurrency(qt.gst_amount)}
                    </td>
                  </tr>
                  <tr className="bg-blue-50 border-t border-blue-100">
                    <td colSpan={6} className="px-4 py-3 text-right font-bold text-slate-800">
                      Total Amount
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-blue-600 text-base">
                      {formatCurrency(qt.total_amount)}
                    </td>
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