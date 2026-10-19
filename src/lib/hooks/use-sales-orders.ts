'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useOrgId } from '@/lib/hooks/use-tenant'
import { toast } from 'sonner'

import type { Enums } from '@/lib/types/database'

type OrderStatus = Enums<'order_status'>
// ── All sales orders ──────────────────────────────────────────
export function useSalesOrders(filters?: {
  status?: OrderStatus
  clientId?: string
  search?: string
}) {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['sales-orders', orgId, filters],
    queryFn: async () => {
    if (!orgId) return []

    let query = supabase
        .from('sales_orders')
        .select(`
          *,
          client:clients ( id, name, phone ),
          quotation:quotations ( quotation_no ),
          creator:profiles!sales_orders_created_by_fkey ( full_name )
        `)
        .order('created_at', { ascending: false })

      if (filters?.status)   query = query.eq('status', filters.status)
      if (filters?.clientId) query = query.eq('client_id', filters.clientId)
      if (filters?.search) {
        query = query.ilike('so_number', `%${filters.search}%`)
      }

      const { data, error } = await query
      if (error) throw error
      return data
    },
    staleTime: 30 * 1000,
    enabled: !!orgId,
  })
}

// ── Single sales order with full detail ───────────────────────
export function useSalesOrder(id: string | null) {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['sales-orders', orgId, id],
    queryFn: async () => {
      if (!id || !orgId) return null
      const { data, error } = await supabase
        .from('sales_orders')
        .select(`
          *,
          client:clients ( id, name, phone, gst_number, address, city ),
          quotation:quotations ( id, quotation_no ),
          creator:profiles!sales_orders_created_by_fkey ( id, full_name ),
          approver:profiles!sales_orders_approved_by_fkey ( id, full_name ),
          sales_order_lines (
            *,
            item:items (
            id,
            item_code,
            name,
            unit_id,
            hsn_code,
            unit:units (
              id,
              name
            )
          )
          ),
          production_orders ( id, po_number, status ),
          delivery_challans ( id, challan_no, challan_date, status, total_amount )
        `)
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id && !!orgId,
    staleTime: 30 * 1000,
  })
}

// ── Update SO status ──────────────────────────────────────────
export function useUpdateSOStatus() {
  const supabase = createClient()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string
      status: OrderStatus
    }) => {
      const { error } = await supabase
        .from('sales_orders')
        .update({ status })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] })
      toast.success('Order status updated')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Record advance payment ────────────────────────────────────
export function useRecordPayment() {
  const supabase = createClient()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      amount,
      currentAdvance,
      totalAmount,
    }: {
      id: string
      amount: number
      currentAdvance: number
      totalAmount: number
    }) => {
      const newAdvance = currentAdvance + amount
      const { error } = await supabase
        .from('sales_orders')
        .update({
          advance_paid: newAdvance,
          balance_due: totalAmount - newAdvance,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] })
      toast.success('Payment recorded')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}