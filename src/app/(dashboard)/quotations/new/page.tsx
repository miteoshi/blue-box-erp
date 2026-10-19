'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils/format'
import { toast } from 'sonner'
import { Plus, Trash2, Save, Send } from 'lucide-react'
import type { Enums } from '@/lib/types/database'
import { useOrgId } from '@/lib/hooks/use-tenant'

type GstRate = Enums<'gst_rate'>

interface LineItem {
  item_id: string;
  item_name: string;
  item_code: string;
  description: string;
  qty: number;
  unit_id: string | null;
  unit: string;
  unit_rate: number;
  gst_percent: GstRate;
}

const EMPTY_LINE: LineItem = {
  item_id: "",
  item_name: "",
  item_code: "",
  description: "",
  qty: 1,
  unit_id: null,
  unit: "",
  unit_rate: 0,
  gst_percent: "18",
};

// Fetch active clients
function useClients() {
  const supabase = createClient();
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["clients-list", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("clients")
        .select("id, name, phone, gst_number")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: true,
  });
}

// Fetch items with current selling price
function useItemsForQuote() {
  const supabase = createClient();
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["items-for-quote", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data: items, error } = await supabase
        .from("items")
        .select(
          `
          id,
          item_code,
          name,
          unit_id,
          unit:units (
            id,
            name
          ),
          hsn_code,
          category_id
        `
        )
        .eq("is_active", true)
        .order("name");
      if (error) throw error;

      const { data: prices } = await supabase
        .from("v_current_prices")
        .select("item_id, selling_rate, gst_percent, rate_unit");

      const priceMap = new Map(prices?.map((p) => [p.item_id, p]) ?? []);
      return (
        items?.map((i) => ({ ...i, price: priceMap.get(i.id) ?? null })) ?? []
      );
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!orgId,
  });
}

export default function NewQuotationPage() {
  const router = useRouter()
  const supabase = createClient()
  const orgId = useOrgId()

  const { data: clients } = useClients()
  const { data: items }   = useItemsForQuote()

  const [clientId, setClientId]         = useState('')
  const [validUntil, setValidUntil]     = useState('')
  const [deliveryDays, setDeliveryDays] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('50% advance, 50% on delivery')
  const [transportNote, setTransportNote] = useState('')
  const [notes, setNotes]               = useState('')
  const [lines, setLines]               = useState<LineItem[]>([{ ...EMPTY_LINE }])
  const [saving, setSaving]             = useState(false)
  const [submitting, setSubmitting]     = useState(false)

  
  // ── Line calculations ─────────────────────────────────────
  const lineSubtotal  = (l: LineItem) => l.qty * l.unit_rate
  const lineGst       = (l: LineItem) => lineSubtotal(l) * Number(l.gst_percent) / 100
  const lineTotal     = (l: LineItem) => lineSubtotal(l) + lineGst(l)

  const subtotal   = lines.reduce((s, l) => s + lineSubtotal(l), 0)
  const gstAmount  = lines.reduce((s, l) => s + lineGst(l), 0)
  const totalAmount = subtotal + gstAmount

  // ── Line handlers ─────────────────────────────────────────
  function addLine() {
    setLines(prev => [...prev, { ...EMPTY_LINE }])
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateLine(i: number, field: keyof LineItem, value: string | number) {
    setLines(prev => prev.map((l, idx) => {
      if (idx !== i) return l
      const updated = { ...l, [field]: value }
      return updated
    }))
  }


  function selectItem(lineIdx: number, itemId: string) {
    const item = items?.find(i => i.id === itemId)
    if (!item) return
    setLines(prev => prev.map((l, i) => {
      if (i !== lineIdx) return l
      return {
        ...l,
        item_id: item.id,
        item_name: item.name,
        item_code: item.item_code,
        unit_id: item.unit_id,
        unit: item.unit?.name ?? "",
        unit_rate: item.price?.selling_rate ?? 0,
        gst_percent: (item.price?.gst_percent ?? "18") as GstRate,
      };
    }))
  }

  // ── Save / Submit ─────────────────────────────────────────
  async function save(submit: boolean) {
    if (!clientId) { toast.error('Please select a client'); return }
    if (lines.some((l) => !l.item_id)) {
      toast.error("All lines must have an item selected");
      return;
    }

    if (lines.some((l) => !l.unit_id)) {
      toast.error("All items must have a unit");
      return;
    }

    if (lines.some((l) => l.qty <= 0)) {
      toast.error("All quantities must be greater than 0");
      return;
    }
    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }

    submit ? setSubmitting(true) : setSaving(true)

    try {
      // Generate quotation number with tenant org_id
      const { data: qtNo, error: rpcErr } = await supabase.rpc("next_qt_no", {
        p_org_id: orgId,
      });
      if (rpcErr) throw rpcErr;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Insert quotation header with org_id
      const { data: qt, error: qtErr } = await supabase
        .from("quotations")
        .insert({
          org_id: orgId,
          quotation_no: qtNo as string,
          created_by: user?.id ?? null,
          client_id: clientId,
          valid_until: validUntil || null,
          delivery_days: deliveryDays ? Number(deliveryDays) : null,
          payment_terms: paymentTerms || null,
          transport_note: transportNote || null,
          notes: notes || null,
          status: submit ? "pending_approval" : "draft",
          subtotal,
          gst_amount: gstAmount,
          total_amount: totalAmount,
        })
        .select("id")
        .single();

      if (qtErr) throw qtErr;

      // Insert lines
      const { error: linesErr } = await supabase.from("quotation_lines").insert(
        lines.map((l, idx) => ({
          quotation_id: qt.id,
          item_id: l.item_id,
          description: l.description || null,
          qty: l.qty,
          unit_id: l.unit_id!,
          unit_rate: l.unit_rate,
          gst_percent: l.gst_percent,
          sort_order: idx,
        }))
      );

      if (linesErr) throw linesErr;

      toast.success(
        submit ? "Quotation submitted for approval" : "Quotation saved as draft"
      );
      router.push(`/quotations/${qt.id}`);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save quotation"
      );
    } finally {
      setSaving(false);
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="New Quotation"
        description="Create a price offer for a client"
      >
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button variant="secondary" size="sm" loading={saving} onClick={() => save(false)}>
          <Save className="w-4 h-4" />
          Save Draft
        </Button>
        <Button size="sm" loading={submitting} onClick={() => save(true)}>
          <Send className="w-4 h-4" />
          Submit for Approval
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left: Header fields ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-slate-900 text-sm">Client & Terms</h3>
            </CardHeader>
            <CardBody className="space-y-4">

              {/* Client */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Client <span className="text-red-500">*</span>
                </label>
                <select
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select client…</option>
                  {clients?.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <Input
                label="Valid Until"
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                hint="Typically 30–45 days from today"
              />

              <Input
                label="Delivery Days"
                type="number"
                placeholder="e.g. 7"
                value={deliveryDays}
                onChange={e => setDeliveryDays(e.target.value)}
              />

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Payment Terms
                </label>
                <input
                  type="text"
                  value={paymentTerms}
                  onChange={e => setPaymentTerms(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <Input
                label="Transport Note"
                placeholder="e.g. Client will arrange transport"
                value={transportNote}
                onChange={e => setTransportNote(e.target.value)}
              />

              <Textarea
                label="Notes"
                placeholder="Any additional notes for this quotation…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </CardBody>
          </Card>

          {/* Totals */}
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-slate-900 text-sm">Summary</h3>
            </CardHeader>
            <CardBody className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">GST</span>
                <span className="font-medium">{formatCurrency(gstAmount)}</span>
              </div>
              <div className="flex justify-between text-base font-bold border-t border-slate-100 pt-2 mt-2">
                <span>Total</span>
                <span className="text-blue-600">{formatCurrency(totalAmount)}</span>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ── Right: Line items ── */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-900 text-sm">
                  Line Items
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {lines.length} item{lines.length !== 1 ? 's' : ''}
                  </span>
                </h3>
                <Button variant="outline" size="sm" onClick={addLine}>
                  <Plus className="w-3.5 h-3.5" />
                  Add Line
                </Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Item</th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 w-24">Qty</th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 w-20">Unit</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 w-28">Rate (₹)</th>
                      <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 w-16">GST%</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 w-28">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {lines.map((line, i) => (
                      <tr key={i} className="group">
                        <td className="px-3 py-2">
                          <select
                            value={line.item_id}
                            onChange={e => selectItem(i, e.target.value)}
                            className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[200px]"
                          >
                            <option value="">Select item…</option>
                            {items?.map(item => (
                              <option key={item.id} value={item.id}>
                                [{item.item_code}] {item.name}
                              </option>
                            ))}
                          </select>
                          {line.item_id && (
                            <input
                              type="text"
                              placeholder="Description override (optional)"
                              value={line.description}
                              onChange={e => updateLine(i, 'description', e.target.value)}
                              className="mt-1 w-full px-2 py-1 text-xs rounded border border-slate-100 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-slate-300"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0.0001"
                            step="any"
                            value={line.qty}
                            onChange={e => updateLine(i, 'qty', Number(e.target.value))}
                            className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={line.unit}
                            onChange={e => updateLine(i, 'unit', e.target.value)}
                            className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={line.unit_rate}
                            onChange={e => updateLine(i, 'unit_rate', Number(e.target.value))}
                            className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={line.gst_percent}
                            onChange={e => updateLine(i, 'gst_percent', e.target.value as GstRate)}
                            className="w-full px-1.5 py-1.5 text-xs rounded border border-slate-200 text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            {['0','5','12','18','28'].map(r => (
                              <option key={r} value={r}>{r}%</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <div className="font-semibold text-slate-900 text-xs">
                            {formatCurrency(lineSubtotal(line))}
                          </div>
                          <div className="text-xs text-slate-400">
                            +{formatCurrency(lineGst(line))} GST
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          {lines.length > 1 && (
                            <button
                              onClick={() => removeLine(i)}
                              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {/* Footer totals */}
                  <tfoot>
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td colSpan={5} className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500">
                        Subtotal
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900 text-xs">
                        {formatCurrency(subtotal)}
                      </td>
                      <td></td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td colSpan={5} className="px-3 py-1.5 text-right text-xs text-slate-500">
                        GST
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600 text-xs">
                        {formatCurrency(gstAmount)}
                      </td>
                      <td></td>
                    </tr>
                    <tr className="bg-blue-50 border-t border-blue-100">
                      <td colSpan={5} className="px-3 py-2.5 text-right text-sm font-bold text-slate-700">
                        Total
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-blue-600">
                        {formatCurrency(totalAmount)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Add line button bottom */}
              <div className="px-4 py-3 border-t border-slate-100">
                <button
                  onClick={addLine}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  Add another line
                </button>
              </div>
            </CardBody>
          </Card>
        </div>

      </div>
    </div>
  )
}