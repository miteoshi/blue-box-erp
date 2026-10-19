'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useOrgId } from '@/lib/hooks/use-tenant'
import { toast } from 'sonner'
import type { Enums, TablesUpdate } from '@/lib/types/database'

type ProductionStatus = Enums<'production_status'>

// ── All production orders ─────────────────────────────────────
export function useProductionOrders(filters?: {
  status?: ProductionStatus
}) {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['production-orders', orgId, filters],
    queryFn: async () => {
      if (!orgId) return []

      let query = supabase
        .from('production_orders')
        .select(`
          *,
          creator:profiles!production_orders_created_by_fkey ( full_name ),
          production_order_items (
                id,
                qty_required,
                qty_produced,
                unit_id,
                unit:units (
                  id,
                  name
                ),
                item:items (
                  id,
                  item_code,
                  name,
                  unit_id
                )
              ),
          production_assignments (
            id, hours_worked,
            worker:workers ( id, name )
          )
        `)
        .order('created_at', { ascending: false })

      if (filters?.status) query = query.eq('status', filters.status)

      const { data, error } = await query
      if (error) throw error
      return data
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    enabled: !!orgId,
  })
}

// ── Single production order ───────────────────────────────────
export function useProductionOrder(id: string | null) {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['production-orders', orgId, id],
    queryFn: async () => {
      if (!id || !orgId) return null

      const { data, error } = await supabase
        .from('production_orders')
        .select(`
          *,
          creator:profiles!production_orders_created_by_fkey ( id, full_name ),
            production_order_items (
              id,
              qty_required,
              qty_produced,
              unit_id,
              unit:units (
                id,
                name
              ),
              item:items (
                id,
                item_code,
                name,
                unit_id
              )
            ),
          production_assignments (
            id, assigned_date, hours_worked, notes,
            worker:workers ( id, name, skill )
          )
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

// ── BOM for a finished item ───────────────────────────────────
export function useBom(finishedItemId: string | null) {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['bom', orgId, finishedItemId],
    queryFn: async () => {
      if (!finishedItemId || !orgId) return []

      const { data, error } = await supabase
        .from('bom')
        .select(`
          id,
          qty_per_unit,
          unit_id,
          notes,

          unit:units (
            id,
            name
          ),

          component:items!bom_component_id_fkey (
            id,
            item_code,
            name,
            unit_id
          )
        `)
        .eq('finished_item_id', finishedItemId)
        .eq('is_active', true)

      if (error) throw error
      return data ?? []
    },
    enabled: !!finishedItemId && !!orgId,
    staleTime: 5 * 60 * 1000,
  })
}

// ── All manufactured items (for new production dropdown) ──────
export function useManufacturedItems() {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['manufactured-items', orgId],
    queryFn: async () => {
      if (!orgId) return []

      const { data, error } = await supabase
        .from('items')
        .select(`
              id,
              item_code,
              name,
              unit_id,
              unit:units (
                id,
                name
              )
            `)
        .eq('is_manufactured', true)
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  })
}

// ── All raw material items (for manual BOM input) ─────────────
export function useRawMaterialItems() {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['raw-material-items', orgId],
    queryFn: async () => {
      if (!orgId) return []

      const { data, error } = await supabase
        .from('items')
        .select(`
              id,
              item_code,
              name,
              unit_id,
              unit:units (
                id,
                name
              )
            `)
        .eq('is_raw_material', true)
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  })
}

// ── Update production status ──────────────────────────────────
export function useUpdateProductionStatus() {
  const supabase = createClient()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string
      status: ProductionStatus
    }) => {
      const updates: TablesUpdate<'production_orders'> = { status }
      if (status === 'in_progress') {
        updates.start_date = new Date().toISOString().split('T')[0]
      }
      if (status === 'completed') {
        updates.completed_date = new Date().toISOString().split('T')[0]
      }

      const { error } = await supabase
        .from('production_orders')
        .update(updates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] })
      toast.success('Production status updated')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Assign worker ─────────────────────────────────────────────
export function useAssignWorker() {
  const supabase = createClient()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      productionOrderId,
      workerId,
    }: {
      productionOrderId: string
      workerId: string
    }) => {
      const { error } = await supabase
        .from('production_assignments')
        .insert({
          production_order_id: productionOrderId,
          worker_id: workerId,
        })

      if (error) {
        if (error.code === '23505') {
          throw new Error('Worker already assigned')
        }
        throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] })
      toast.success('Worker assigned')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Update qty produced ───────────────────────────────────────
export function useUpdateQtyProduced() {
  const supabase = createClient()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      lineId,
      qtyProduced,
    }: {
      lineId: string
      qtyProduced: number
    }) => {
      const { error } = await supabase
        .from('production_order_items')
        .update({ qty_produced: qtyProduced })
        .eq('id', lineId)

      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-orders'] }),
    onError: (err: Error) => toast.error(err.message),
  })
}