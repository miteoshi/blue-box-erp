import { createClient } from '@/lib/supabase/client'

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