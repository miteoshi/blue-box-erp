'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useOrgId } from '@/lib/hooks/use-tenant'
import { createDeliveryChallan } from '@/lib/utils/inventory'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { formatCurrency, formatQty } from '@/lib/utils/format'
import { toast } from 'sonner'
import { Trash2, Save, AlertTriangle } from 'lucide-react'
import type { Enums } from '@/lib/types/database'

type TransportMode = Enums<'transport_mode'>

interface ChallanLine {
  item_id: string;
  item_name: string;
  item_code: string;
  so_line_id: string;
  qty: number;
  unit_id: string;
  unit: string;
  rate: number;
  max_qty: number;
  reservation_id: string | null;
}

function useSalesOrdersForDispatch(orgId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["so-for-dispatch", orgId],

    queryFn: async () => {
      if (!orgId) {
        throw new Error("Organization context is not available");
      }

      const { data, error } = await supabase
        .from("sales_orders")
        .select(
                    `
            id,
            so_number,

            client:clients (
              id,
              name
            ),

            sales_order_lines (
              id,
              qty,
              qty_dispatched,
              unit_rate,
              unit_id,

              unit:units (
                id,
                name
              ),

              item:items (
                id,
                item_code,
                name
              )
            )
            `
        )
        .in("status", ["confirmed", "in_production", "ready"])
        .order("so_number");

      if (error) throw error;

      return data;
    },

    enabled: !!orgId,
    staleTime: 30 * 1000,
  });
}

// ── NEW: fetch active reservations for the selected SO ────────
// Returns a map of item_id → reservation_id so dispatch can
// consume against the reservation rather than raw available stock.
function useSOReservations(soId: string, orgId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["so-reservations-for-dispatch", orgId, soId],

    enabled: !!orgId && !!soId,

    queryFn: async () => {
      if (!orgId) {
        throw new Error("Organization context is not available");
      }

      const { data, error } = await supabase
        .from("stock_reservations")
        .select("id, item_id, qty_reserved, qty_consumed, status")
        .eq("ref_type", "sales_order")
        .eq("ref_id", soId)
        .in("status", ["active", "partially_consumed"]);

      if (error) throw error;

      return new Map((data ?? []).map((r) => [r.item_id, r.id]));
    },

    staleTime: 30 * 1000,
  });
}

export default function NewChallanPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const qc           = useQueryClient()
  const orgId        = useOrgId()

const { data: salesOrders } = useSalesOrdersForDispatch(orgId);

  const [selectedSoId,  setSelectedSoId]  = useState(searchParams.get('so') ?? '')
  const [challanDate,   setChallanDate]   = useState(new Date().toISOString().split('T')[0])
  const [transportMode, setTransportMode] = useState<TransportMode>('client_truck')
  const [vehicleNo,     setVehicleNo]     = useState('')
  const [driverName,    setDriverName]    = useState('')
  const [notes,         setNotes]         = useState('')
  const [lines,         setLines]         = useState<ChallanLine[]>([])
  const [saving,        setSaving]        = useState(false)

  // ── Fetch reservations for the selected SO ────────────────
const { data: reservationMap } = useSOReservations(selectedSoId, orgId);

  // Pre-fill lines from SO when selected
  // Now also attaches reservation_id per item from reservationMap
  useEffect(() => {
    if (!selectedSoId || !salesOrders) return;
    const so = salesOrders.find((s) => s.id === selectedSoId);
    if (!so) return;

    const soLines = (so.sales_order_lines as any[]) ?? [];
    const remaining = soLines
      .filter((l) => l.qty - (l.qty_dispatched ?? 0) > 0)
      .map((l) => ({
        item_id: l.item?.id ?? "",
        item_name: l.item?.name ?? "",
        item_code: l.item?.item_code ?? "",
        so_line_id: l.id,
        qty: l.qty - (l.qty_dispatched ?? 0),
        unit_id: l.unit_id,
        unit: l.unit?.name ?? "",
        rate: l.unit_rate,
        max_qty: l.qty - (l.qty_dispatched ?? 0),
        reservation_id: reservationMap?.get(l.item?.id) ?? null,
      }));

    setLines(remaining);
  }, [selectedSoId, salesOrders, reservationMap]);

  // ── Re-attach reservation_ids once reservationMap loads ───
  // The SO lines effect runs before reservationMap is ready on
  // first render, so we patch them in as soon as the map arrives.
  useEffect(() => {
    if (!reservationMap || lines.length === 0) return
    setLines(prev => prev.map(l => ({
      ...l,
      reservation_id: reservationMap.get(l.item_id) ?? null,
    })))
  }, [reservationMap])

  const selectedSo     = salesOrders?.find(s => s.id === selectedSoId)
  const selectedClient = selectedSo?.client as any
  const totalAmount    = lines.reduce((s, l) => s + l.qty * l.rate, 0)

  // Warn if any line has no reservation (stock not reserved for this SO)
  const missingReservations = lines.filter(l => !l.reservation_id)

  function updateLine(i: number, field: keyof ChallanLine, value: string | number) {
    setLines(prev => prev.map((l, idx) => {
      if (idx !== i) return l
      if (field === 'qty') return { ...l, qty: Math.min(Number(value), l.max_qty) }
      return { ...l, [field]: value }
    }))
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleSave() {


    if (!selectedSoId)               { toast.error('Select a sales order');        return }
    if (lines.length === 0)          { toast.error('Add at least one item');       return }
    if (lines.some(l => l.qty <= 0)) { toast.error('All quantities must be > 0'); return }
    if (lines.some(l => l.rate <= 0)){ toast.error('All rates must be > 0');      return }

    if (!orgId) {
        toast.error("Organization context is not available");
        return;
    }

    // ── Warn but allow if reservation missing ─────────────
    // This handles edge cases where SO was confirmed without reserving
    if (missingReservations.length > 0) {
      const names = missingReservations.map(l => l.item_name).join(', ')
      toast.warning(
        `No reservation found for: ${names}. Dispatching from available stock directly.`,
        { duration: 5000 }
      )
    }

    setSaving(true)

    try {
      // One transaction in the database: challan header + lines + stock
      // dispatch (consuming this SO's reservations first) + qty_dispatched
      // + SO status. If anything fails, nothing is written.
      const result = await createDeliveryChallan({
        soId:          selectedSoId,
        lines:         lines.map((l) => ({ soLineId: l.so_line_id, qty: l.qty, rate: l.rate })),
        challanDate,
        transportMode,
        vehicleNo:     vehicleNo  || undefined,
        driverName:    driverName || undefined,
        notes:         notes      || undefined,
      })

      await Promise.all([
        qc.invalidateQueries({ queryKey: ['delivery-challans'] }),
        qc.invalidateQueries({ queryKey: ['sales-orders'] }),
        qc.invalidateQueries({ queryKey: ['so-for-dispatch'] }),
        qc.invalidateQueries({ queryKey: ['so-reservations'] }),
        qc.invalidateQueries({ queryKey: ['stock-levels'] }),
      ])

      toast.success(
        result.unreserved_qty > 0
          ? `Challan ${result.challan_no} created — ${result.lines} line(s) dispatched (${formatQty(result.unreserved_qty)} taken from unreserved stock)`
          : `Challan ${result.challan_no} created — ${result.lines} line(s) dispatched from reserved stock`
      )
      router.push('/dispatch')

    } catch (err: unknown) {
      toast.error(`Failed: ${err instanceof Error ? err.message : 'Could not create challan'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="New Delivery Challan"
        description="Create dispatch document for outgoing goods"
      >
        <Button variant="outline" size="sm" onClick={() => router.back()}>Cancel</Button>
        <Button size="sm" loading={saving} onClick={handleSave}>
          <Save className="w-4 h-4" />
          Create Challan
        </Button>
      </PageHeader>

      {/* Reservation status notice */}
      {selectedSoId && lines.length > 0 && (
        missingReservations.length === 0 ? (
          <div className="mb-6 flex items-start gap-3 bg-teal-50 border border-teal-200 rounded-xl px-5 py-3">
            <AlertTriangle className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-teal-800">
              All items have active reservations. Dispatch will consume from reserved stock —
              reservation will be marked as consumed automatically.
            </p>
          </div>
        ) : (
          <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              Some items have no active reservation. Go back and Reserve Stock on the
              Sales Order first, or dispatch will deduct directly from available stock.
            </p>
          </div>
        )
      )}

      {!selectedSoId && (
        <div className="mb-6 flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-5 py-3">
          <AlertTriangle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-800">
            Select a sales order. Dispatch will consume from the reserved stock for that order.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left: Header ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-slate-900 text-sm">Dispatch Details</h3>
            </CardHeader>
            <CardBody className="space-y-4">

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Sales Order <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedSoId}
                  onChange={e => setSelectedSoId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select sales order…</option>
                  {salesOrders?.map(so => (
                    <option key={so.id} value={so.id}>
                      {so.so_number} — {(so.client as any)?.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedClient && (
                <div className="bg-slate-50 rounded-lg p-3 text-sm">
                  <p className="font-semibold text-slate-900">{selectedClient.name}</p>
                  {selectedClient.phone && (
                    <p className="text-slate-500 text-xs mt-0.5">{selectedClient.phone}</p>
                  )}
                </div>
              )}

              <Input
                label="Challan Date"
                type="date"
                value={challanDate}
                onChange={e => setChallanDate(e.target.value)}
              />

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Transport Mode
                </label>
                <select
                  value={transportMode}
                  onChange={e => setTransportMode(e.target.value as TransportMode)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="client_truck">Client Truck</option>
                  <option value="own_truck">Our Truck</option>
                  <option value="courier">Courier</option>
                  <option value="hand_delivery">Hand Delivery</option>
                  <option value="supplier_truck">Supplier Truck</option>
                </select>
              </div>

              <Input label="Vehicle No." placeholder="e.g. GJ01AB1234" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} />
              <Input label="Driver Name" value={driverName} onChange={e => setDriverName(e.target.value)} />
              <Textarea label="Notes" placeholder="Any special instructions…" value={notes} onChange={e => setNotes(e.target.value)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="font-semibold text-slate-900 text-sm">Summary</h3>
            </CardHeader>
            <CardBody className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Lines</span>
                <span className="font-medium">{lines.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Reserved lines</span>
                <span className={lines.length - missingReservations.length > 0 ? 'font-medium text-teal-600' : 'text-slate-400'}>
                  {lines.length - missingReservations.length} of {lines.length}
                </span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-slate-100 pt-2">
                <span>Challan Value</span>
                <span className="text-blue-600">{formatCurrency(totalAmount)}</span>
              </div>
              <p className="text-xs text-slate-400">GST invoice raised separately.</p>
            </CardBody>
          </Card>
        </div>

        {/* ── Right: Lines ── */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-slate-900 text-sm">
                Items to Dispatch
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {lines.length} line{lines.length !== 1 ? 's' : ''}
                </span>
              </h3>
            </CardHeader>

            {!selectedSoId ? (
              <CardBody>
                <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                  <AlertTriangle className="w-4 h-4" />
                  Select a sales order to load items
                </div>
              </CardBody>
            ) : lines.length === 0 ? (
              <CardBody>
                <p className="text-slate-400 text-sm py-4 text-center">
                  All items on this order have already been dispatched
                </p>
              </CardBody>
            ) : (
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Item</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 w-28">Remaining</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 w-28">Dispatch Qty</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 w-16">Unit</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 w-28">Rate (₹)</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 w-28">Line Total</th>
                        {/* ── NEW: reservation indicator column ── */}
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 w-20">Stock</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {lines.map((line, i) => (
                        <tr key={i} className="group">
                          <td className="px-3 py-2.5">
                            <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mr-2">
                              {line.item_code}
                            </span>
                            <span className="font-medium text-slate-900 text-sm">{line.item_name}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-400 text-xs">
                            {formatQty(line.max_qty, line.unit)}
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="number" min="0.0001" max={line.max_qty} step="any"
                              value={line.qty}
                              onChange={e => updateLine(i, 'qty', Number(e.target.value))}
                              className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-slate-500 text-center">{line.unit}</td>
                          <td className="px-3 py-2.5">
                            <input
                              type="number" min="0" step="any"
                              value={line.rate}
                              onChange={e => updateLine(i, 'rate', Number(e.target.value))}
                              className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900 text-xs">
                            {formatCurrency(line.qty * line.rate)}
                          </td>
                          {/* ── Reserved / Available indicator ── */}
                          <td className="px-3 py-2.5 text-center">
                            {line.reservation_id ? (
                              <span style={{ fontSize: 10, fontWeight: 600, background: 'rgba(20,184,166,0.12)', color: '#0d9488', padding: '2px 7px', borderRadius: 5 }}>
                                Reserved
                              </span>
                            ) : (
                              <span style={{ fontSize: 10, fontWeight: 600, background: 'rgba(245,158,11,0.12)', color: '#b45309', padding: '2px 7px', borderRadius: 5 }}>
                                Available
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              onClick={() => removeLine(i)}
                              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-blue-50 border-t border-blue-100">
                        <td colSpan={6} className="px-3 py-2.5 text-right font-bold text-slate-700 text-sm">
                          Total Challan Value
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold text-blue-600">
                          {formatCurrency(totalAmount)}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardBody>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}