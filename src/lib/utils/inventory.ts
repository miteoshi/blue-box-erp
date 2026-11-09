import { createClient } from '@/lib/supabase/client'
import type { Enums } from '@/lib/types/database'

// ─────────────────────────────────────────────────────────────
// Inventory RPC Wrappers
// Every function generates a unique operation_id for idempotency.
// Args match the generated database.ts exactly — no 'as any' casts.
// ─────────────────────────────────────────────────────────────

function opId() {
  return crypto.randomUUID()
}

// ── receive_inventory ─────────────────────────────────────────
// Args (from generated types):
// p_batch_no, p_item_id, p_notes, p_operation_id, p_qty, p_rate, p_ref_id, p_ref_type
export async function receiveInventory(params: {
  itemId:   string
  qty:      number
  rate:     number
  refId:    string       // inbound_receipt id
  batchNo?: string
  notes?:   string
}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('receive_inventory', {
    p_operation_id: opId(),
    p_item_id:      params.itemId,
    p_qty:          params.qty,
    p_rate:         params.rate,
    p_ref_type:     'inbound_receipt',
    p_ref_id:       params.refId,
    p_batch_no:     params.batchNo,
    p_notes:        params.notes,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── reserve_inventory ─────────────────────────────────────────
// Args (from generated types):
// p_expiry_hours, p_item_id, p_notes, p_operation_id, p_qty, p_ref_id, p_ref_type
export async function reserveInventory(params: {
  itemId:       string
  qty:          number
  refType:      'sales_order' | 'production_order'
  refId:        string
  expiryHours?: number
  notes?:       string
}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('reserve_inventory', {
    p_operation_id: opId(),
    p_item_id:      params.itemId,
    p_qty:          params.qty,
    p_ref_type:     params.refType,
    p_ref_id:       params.refId,
    p_expiry_hours: params.expiryHours ?? 72,
    p_notes:        params.notes,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── release_inventory ─────────────────────────────────────────
// Args (from generated types):
// p_notes, p_operation_id, p_qty_to_release, p_reservation_id
export async function releaseInventory(params: {
  reservationId:  string
  qtyToRelease?:  number   // undefined = release all remaining
  notes?:         string
}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('release_inventory', {
    p_operation_id:   opId(),
    p_reservation_id: params.reservationId,
    p_qty_to_release: params.qtyToRelease,
    p_notes:          params.notes,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── consume_inventory ─────────────────────────────────────────
// Args (from generated types):
// p_item_id, p_notes, p_operation_id, p_qty, p_ref_id, p_ref_type, p_reservation_id
export async function consumeInventory(params: {
  itemId:          string
  qty:             number
  reservationId?:  string
  refId?:          string   // production_order id
  notes?:          string
}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('consume_inventory', {
    p_operation_id:   opId(),
    p_item_id:        params.itemId,
    p_qty:            params.qty,
    p_reservation_id: params.reservationId,
    p_ref_type:       'production_order',
    p_ref_id:         params.refId,
    p_notes:          params.notes,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── produce_inventory ─────────────────────────────────────────
// Args (from generated types):
// p_item_id, p_notes, p_operation_id, p_qty, p_ref_id, p_ref_type
export async function produceInventory(params: {
  itemId:  string
  qty:     number
  refId?:  string   // production_order id
  notes?:  string
}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('produce_inventory', {
    p_operation_id: opId(),
    p_item_id:      params.itemId,
    p_qty:          params.qty,
    p_ref_type:     'production_order',
    p_ref_id:       params.refId,
    p_notes:        params.notes,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── dispatch_inventory ────────────────────────────────────────
// Args (from generated types):
// p_item_id, p_notes, p_operation_id, p_qty, p_rate, p_ref_id, p_ref_type, p_reservation_id
export async function dispatchInventory(params: {
  itemId:          string
  qty:             number
  rate:            number
  reservationId?:  string
  refId?:          string   // delivery_challan id
  notes?:          string
}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('dispatch_inventory', {
    p_operation_id:   opId(),
    p_item_id:        params.itemId,
    p_qty:            params.qty,
    p_rate:           params.rate,
    p_reservation_id: params.reservationId,
    p_ref_type:       'delivery_challan',
    p_ref_id:         params.refId,
    p_notes:          params.notes,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── adjust_inventory ──────────────────────────────────────────
// Args (from generated types):
// p_delta, p_item_id, p_operation_id, p_reason, p_ref_id
// Note: args are alphabetical in generated types but passed as object so order doesn't matter
export async function adjustInventory(params: {
  itemId:  string
  delta:   number
  reason:  string
  refId?:  string
}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('adjust_inventory', {
    p_operation_id: opId(),
    p_item_id:      params.itemId,
    p_delta:        params.delta,
    p_reason:       params.reason,
    p_ref_id:       params.refId,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── check_bom_availability ────────────────────────────────────
// Args (from generated types):
// p_production_order_id
export async function checkBomAvailability(productionOrderId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('check_bom_availability', {
    p_production_order_id: productionOrderId,
  })
  if (error) throw new Error(error.message)
  return data as {
    production_order_id: string
    checked_at:          string
    can_produce:         boolean
    materials: Array<{
      item_id:       string
      item_code:     string
      item_name:     string
      unit:          string
      qty_required:  number
      qty_available: number
      shortage:      number
      sufficient:    boolean
    }>
  }
}
// ─────────────────────────────────────────────────────────────
// Document workflow RPCs
// Each one runs in a single database transaction: it either fully
// succeeds or changes nothing (no orphan headers, no stock moved
// without document lines, no half-reserved orders).
// ─────────────────────────────────────────────────────────────

// ── reserve_sales_order ───────────────────────────────────────
// Reserves whatever is still missing for every line of the SO and
// moves it to 'ready'. Safe to call again (tops up only).
export async function reserveSalesOrder(soId: string, expiryHours = 72) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('reserve_sales_order', {
    p_so_id:        soId,
    p_expiry_hours: expiryHours,
  })
  if (error) throw new Error(error.message)
  return data as { success: boolean; so_id: string; reservations_created: number }
}

// ── cancel_sales_order ────────────────────────────────────────
// Releases all live reservations and cancels. Refused once anything
// has been dispatched.
export async function cancelSalesOrder(soId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('cancel_sales_order', {
    p_so_id: soId,
  })
  if (error) throw new Error(error.message)
  return data as { success: boolean; so_id: string; reservations_released: number }
}

// ── create_delivery_challan ───────────────────────────────────
// Header + lines + stock dispatch (consuming the SO's reservations
// first) + qty_dispatched + SO status, all in one transaction.
export async function createDeliveryChallan(params: {
  soId:           string
  lines:          Array<{ soLineId: string; qty: number; rate: number }>
  challanDate?:   string
  transportMode?: Enums<'transport_mode'>
  vehicleNo?:     string
  driverName?:    string
  notes?:         string
}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('create_delivery_challan', {
    p_so_id:          params.soId,
    p_lines:          params.lines.map((l) => ({
      so_line_id: l.soLineId,
      qty:        l.qty,
      rate:       l.rate,
    })),
    p_challan_date:   params.challanDate,
    p_transport_mode: params.transportMode,
    p_vehicle_no:     params.vehicleNo,
    p_driver_name:    params.driverName,
    p_notes:          params.notes,
  })
  if (error) throw new Error(error.message)
  return data as {
    success:        boolean
    id:             string
    challan_no:     string
    total_amount:   number
    lines:          number
    unreserved_qty: number
  }
}

// ── mark_challan_delivered ────────────────────────────────────
// The SO only becomes 'delivered' once it is fully dispatched and
// every challan against it is delivered.
export async function markChallanDelivered(challanId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('mark_challan_delivered', {
    p_challan_id: challanId,
  })
  if (error) throw new Error(error.message)
  return data as { success: boolean; challan_id: string; so_delivered: boolean }
}

// ── create_inbound_receipt ────────────────────────────────────
// GRN header + lines + stock receipt in one transaction.
export async function createInboundReceipt(params: {
  supplierId:     string
  lines: Array<{
    itemId:       string
    unitId:       string
    qtyReceived:  number
    qtyOrdered?:  number
    rate:         number
    gstPercent:   Enums<'gst_rate'>
  }>
  receiptDate?:   string
  transportMode?: Enums<'transport_mode'>
  vehicleNo?:     string
  driverName?:    string
  challanNo?:     string
  invoiceNo?:     string
  notes?:         string
}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('create_inbound_receipt', {
    p_supplier_id:    params.supplierId,
    p_lines:          params.lines.map((l) => ({
      item_id:      l.itemId,
      unit_id:      l.unitId,
      qty_received: l.qtyReceived,
      qty_ordered:  l.qtyOrdered && l.qtyOrdered > 0 ? l.qtyOrdered : null,
      rate:         l.rate,
      gst_percent:  l.gstPercent,
    })),
    p_receipt_date:   params.receiptDate,
    p_transport_mode: params.transportMode,
    p_vehicle_no:     params.vehicleNo,
    p_driver_name:    params.driverName,
    p_challan_no:     params.challanNo,
    p_invoice_no:     params.invoiceNo,
    p_notes:          params.notes,
  })
  if (error) throw new Error(error.message)
  return data as {
    success:      boolean
    id:           string
    receipt_no:   string
    total_amount: number
    gst_amount:   number
    lines:        number
  }
}

// ── convert_quotation_to_sales_order ──────────────────────────
// Creates the SO + lines and marks the quotation 'converted'.
// Refuses double conversion.
export async function convertQuotationToSalesOrder(quotationId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('convert_quotation_to_sales_order', {
    p_quotation_id: quotationId,
  })
  if (error) throw new Error(error.message)
  return data as { success: boolean; id: string; so_number: string }
}

// ─────────────────────────────────────────────────────────────
// Production workflow RPCs (one transaction each, order row locked)
// ─────────────────────────────────────────────────────────────

// ── create_production_order ───────────────────────────────────
// Order + finished-goods line + raw-material reservations.
// materials[].qty is the TOTAL needed for this order.
export async function createProductionOrder(params: {
  finishedItemId: string
  qty:            number
  materials:      Array<{ itemId: string; qty: number }>
  targetDate?:    string
  notes?:         string
  expiryHours?:   number
}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('create_production_order', {
    p_finished_item_id: params.finishedItemId,
    p_qty:              params.qty,
    p_materials:        params.materials.map((m) => ({ item_id: m.itemId, qty: m.qty })),
    p_target_date:      params.targetDate,
    p_notes:            params.notes,
    p_expiry_hours:     params.expiryHours ?? 168,
  })
  if (error) throw new Error(error.message)
  return data as { success: boolean; id: string; po_number: string; materials_reserved: number }
}

// ── start_production_order ────────────────────────────────────
// Consumes every planned raw material and moves the order to
// in_progress. Lapsed reservations are taken from available stock.
export async function startProductionOrder(productionOrderId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('start_production_order', {
    p_production_order_id: productionOrderId,
  })
  if (error) throw new Error(error.message)
  return data as { success: boolean; id: string; po_number: string; materials_consumed: number }
}

// ── complete_production_order ─────────────────────────────────
// Adds only the not-yet-produced finished goods to stock and marks
// the order completed — a retry can never double-count.
export async function completeProductionOrder(productionOrderId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('complete_production_order', {
    p_production_order_id: productionOrderId,
  })
  if (error) throw new Error(error.message)
  return data as { success: boolean; id: string; po_number: string; qty_produced: number }
}

// ── cancel_production_order ───────────────────────────────────
// Pending / on-hold orders only: releases reserved raw materials.
export async function cancelProductionOrder(productionOrderId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('cancel_production_order', {
    p_production_order_id: productionOrderId,
  })
  if (error) throw new Error(error.message)
  return data as { success: boolean; id: string; po_number: string; reservations_released: number }
}
