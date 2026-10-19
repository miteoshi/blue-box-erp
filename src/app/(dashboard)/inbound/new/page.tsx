'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useOrgId } from '@/lib/hooks/use-tenant'
import { receiveInventory } from '@/lib/utils/inventory'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils/format'
import { toast } from 'sonner'
import { Plus, Trash2, Save } from 'lucide-react'
import type {
    Enums
  } from '@/lib/types/database'

type GstRate = Enums<'gst_rate'>

type TransportMode = Enums<'transport_mode'>
  


interface GrnLine {
  item_id: string;
  item_name: string;
  item_code: string;
  qty_ordered: number;
  qty_received: number;
  unit_id: string;
  unit_name: string;
  rate: number;
  gst_percent: GstRate;
}

const EMPTY_LINE: GrnLine = {
  item_id: "",
  item_name: "",
  item_code: "",
  qty_ordered: 0,
  qty_received: 1,
  unit_id: "",
  unit_name: "",
  rate: 0,
  gst_percent: "18",
};

function useSuppliers(orgId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["suppliers-list", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, payment_terms")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}

function useItemsForGrn(orgId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["items-for-grn", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("items")
        .select(
          `
          id,
          item_code,
          name,
          unit_id,
          hsn_code,
          unit:units (
            id,
            name
          )
        `
        )
        .eq("is_active", true)
        .or("is_traded.eq.true,is_raw_material.eq.true")
        .order("name");

      if (error) throw error;

      // Get current purchase prices
      const { data: prices, error: pricesError } = await supabase
        .from("v_current_prices")
        .select("item_id, purchase_rate, gst_percent");

      if (pricesError) throw pricesError;

      const priceMap = new Map(prices?.map((p) => [p.item_id, p]) ?? []);

      return (
        data?.map((i) => ({
          ...i,
          price: priceMap.get(i.id) ?? null,
        })) ?? []
      );
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}

export default function NewGrnPage() {
  const router   = useRouter()
  const supabase = createClient()
  const orgId    = useOrgId()

const { data: suppliers } = useSuppliers(orgId);
const { data: items } = useItemsForGrn(orgId);

  const [supplierId,    setSupplierId]    = useState('')
  const [receiptDate,   setReceiptDate]   = useState(new Date().toISOString().split('T')[0])
  const [transportMode, setTransportMode] = useState<TransportMode>('supplier_truck')
  const [vehicleNo,     setVehicleNo]     = useState('')
  const [driverName,    setDriverName]    = useState('')
  const [challanNo,     setChallanNo]     = useState('')
  const [invoiceNo,     setInvoiceNo]     = useState('')
  const [notes,         setNotes]         = useState('')
  const [lines,         setLines]         = useState<GrnLine[]>([{ ...EMPTY_LINE }])
  const [saving,        setSaving]        = useState(false)

  const lineSubtotal  = (l: GrnLine) => l.qty_received * l.rate
  const lineGst       = (l: GrnLine) => lineSubtotal(l) * Number(l.gst_percent) / 100
  const subtotal      = lines.reduce((s, l) => s + lineSubtotal(l), 0)
  const gstAmount     = lines.reduce((s, l) => s + lineGst(l), 0)
  const totalAmount   = subtotal + gstAmount

  function addLine() {
    setLines(prev => [...prev, { ...EMPTY_LINE }])
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateLine(i: number, field: keyof GrnLine, value: string | number) {
    setLines(prev => prev.map((l, idx) => idx !== i ? l : { ...l, [field]: value }))
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
        unit_id: item.unit_id ?? "",
        unit_name: item.unit?.name ?? "",
        rate: item.price?.purchase_rate ?? 0,
        gst_percent: (item.price?.gst_percent ?? "18") as GstRate,
      };
    }))
  }

  async function handleSave() {
    if (!supplierId)              { toast.error('Select a supplier');               return }
    if (lines.some(l => !l.item_id)) { toast.error('All lines need an item');      return }
    if (lines.some((l) => !l.unit_id)) {
      toast.error("All items need a unit assigned");
      return;
    }
    if (lines.some(l => l.qty_received <= 0)) { toast.error('All quantities must be > 0'); return }
    if (lines.some(l => l.rate <= 0))         { toast.error('All rates must be > 0');       return }

    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }

    setSaving(true)
    try {
      // Generate GRN number with tenant org_id
      const { data: grnNo, error: rpcErr } = await supabase.rpc("next_grn_no", {
        p_org_id: orgId,
      });
      if (rpcErr) throw rpcErr;

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Create GRN header with org_id
      const { data: grn, error: grnErr } = await supabase
        .from("inbound_receipts")
        .insert({
          org_id: orgId,
          receipt_no: grnNo as string,
          supplier_id: supplierId,
          receipt_date: receiptDate,
          transport_mode: transportMode,
          vehicle_no: vehicleNo || null,
          driver_name: driverName || null,
          challan_no: challanNo || null,
          invoice_no: invoiceNo || null,
          total_amount: subtotal,
          gst_amount: gstAmount,
          status: "received",
          notes: notes || null,
          received_by: user?.id ?? null,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();

      if (grnErr) throw grnErr;

      // Insert GRN lines. Note: there is no DB trigger on inbound_receipt_lines that
      // syncs stock — the receiveInventory() calls below are what create the
      // stock_movements rows and update inventory_balance for each line.
      const { error: linesErr } = await supabase
        .from("inbound_receipt_lines")
        .insert(
          lines.map((l) => ({
            receipt_id: grn.id,
            item_id: l.item_id,
            qty_ordered: l.qty_ordered > 0 ? l.qty_ordered : null,
            qty_received: l.qty_received,
            unit_id: l.unit_id,
            rate: l.rate,
            gst_percent: l.gst_percent,
          }))
        );

      if (linesErr) throw linesErr;

      // ── Create stock movements manually ─────────────────────
      for (const line of lines) {
        await receiveInventory({
          itemId: line.item_id,
          qty: line.qty_received,
          rate: line.rate,
          refId: grn.id,
        });
      }

      toast.success(`GRN ${grnNo} created — stock updated`);
      router.push("/inbound");
    } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to create GRN')
} finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="New GRN"
        description="Record goods received from supplier"
      >
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button size="sm" loading={saving} onClick={handleSave}>
          <Save className="w-4 h-4" />
          Save GRN
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: Header ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-slate-900 text-sm">
                Receipt Details
              </h3>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Supplier <span className="text-red-500">*</span>
                </label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select supplier…</option>
                  {suppliers?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <Input
                label="Receipt Date"
                type="date"
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
              />

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Transport Mode
                </label>
                <select
                  value={transportMode}
                  onChange={(e) =>
                    setTransportMode(e.target.value as TransportMode)
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="supplier_truck">Supplier Truck</option>
                  <option value="own_truck">Our Truck</option>
                  <option value="client_truck">Client Truck</option>
                  <option value="courier">Courier</option>
                  <option value="hand_delivery">Hand Delivery</option>
                </select>
              </div>

              <Input
                label="Vehicle No."
                placeholder="e.g. GJ01AB1234"
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
              />

              <Input
                label="Driver Name"
                placeholder="Driver's name"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              />

              <Input
                label="Supplier Challan No."
                placeholder="Supplier's delivery challan ref"
                value={challanNo}
                onChange={(e) => setChallanNo(e.target.value)}
              />

              <Input
                label="Invoice No."
                placeholder="Supplier's invoice number"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
              />

              <Textarea
                label="Notes"
                placeholder="Any notes about this delivery…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </CardBody>
          </Card>

          {/* Summary */}
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
                <span className="text-teal-600">
                  {formatCurrency(totalAmount)}
                </span>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ── Right: Lines ── */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-900 text-sm">
                  Items Received
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {lines.length} line{lines.length !== 1 ? "s" : ""}
                  </span>
                </h3>
                <Button variant="outline" size="sm" onClick={addLine}>
                  <Plus className="w-3.5 h-3.5" />
                  Add Item
                </Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">
                        Item
                      </th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 w-24">
                        Ordered
                      </th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 w-24">
                        Received
                      </th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 w-16">
                        Unit
                      </th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 w-28">
                        Rate (₹)
                      </th>
                      <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 w-16">
                        GST%
                      </th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 w-28">
                        Line Total
                      </th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {lines.map((line, i) => (
                      <tr key={i} className="group">
                        <td className="px-3 py-2">
                          <select
                            value={line.item_id}
                            onChange={(e) => selectItem(i, e.target.value)}
                            className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500 min-w-[200px]"
                          >
                            <option value="">Select item…</option>
                            {items?.map((item) => (
                              <option key={item.id} value={item.id}>
                                [{item.item_code}] {item.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={line.qty_ordered || ""}
                            placeholder="—"
                            onChange={(e) =>
                              updateLine(
                                i,
                                "qty_ordered",
                                Number(e.target.value)
                              )
                            }
                            className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0.0001"
                            step="any"
                            value={line.qty_received}
                            onChange={(e) =>
                              updateLine(
                                i,
                                "qty_received",
                                Number(e.target.value)
                              )
                            }
                            className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={line.unit_name || "—"}
                            readOnly
                            className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 bg-slate-50 text-center text-slate-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={line.rate}
                            onChange={(e) =>
                              updateLine(i, "rate", Number(e.target.value))
                            }
                            className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={line.gst_percent}
                            onChange={(e) =>
                              updateLine(
                                i,
                                "gst_percent",
                                e.target.value as GstRate
                              )
                            }
                            className="w-full px-1.5 py-1.5 text-xs rounded border border-slate-200 text-center focus:outline-none focus:ring-1 focus:ring-teal-500"
                          >
                            {["0", "5", "12", "18", "28"].map((r) => (
                              <option key={r} value={r}>
                                {r}%
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <div className="font-semibold text-xs text-slate-900">
                            {formatCurrency(lineSubtotal(line))}
                          </div>
                          <div className="text-xs text-slate-400">
                            +{formatCurrency(lineGst(line))}
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
                  <tfoot>
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td
                        colSpan={6}
                        className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase"
                      >
                        Subtotal
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-xs">
                        {formatCurrency(subtotal)}
                      </td>
                      <td></td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td
                        colSpan={6}
                        className="px-3 py-1.5 text-right text-xs text-slate-500"
                      >
                        GST
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs text-slate-600">
                        {formatCurrency(gstAmount)}
                      </td>
                      <td></td>
                    </tr>
                    <tr className="bg-teal-50 border-t border-teal-100">
                      <td
                        colSpan={6}
                        className="px-3 py-2.5 text-right font-bold text-slate-700 text-sm"
                      >
                        Total
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-teal-600">
                        {formatCurrency(totalAmount)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-slate-100">
                <button
                  onClick={addLine}
                  className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  Add another item
                </button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}