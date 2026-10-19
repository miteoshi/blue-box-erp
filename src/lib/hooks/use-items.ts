'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useOrgId } from '@/lib/hooks/use-tenant'
import { toast } from 'sonner'
import type { Tables} from '@/lib/types/database'

type Item = Tables<'items'>


// ── Item categories ──────────────────────────────────────────
export function useItemCategories() {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['item-categories', orgId],
    queryFn: async () => {
      if (!orgId) return []

      const { data, error } = await supabase
        .from('item_categories')
        .select('id, code, name, description, is_active')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return data
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  })
}




// ── All items ─────────────────────────────────────────────────
export function useItems(filters?: {
  categoryId?: string
  search?: string
  isActive?: boolean
}) {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['items', orgId, filters],
    queryFn: async () => {
      if (!orgId) return []

      let query = supabase
        .from('items')
        .select('*')
        .order('category_id')
        .order('item_code')

      if (filters?.isActive !== undefined) {
        query = query.eq('is_active', filters.isActive)
      } else {
        query = query.eq('is_active', true) // default: only active
      }

      if (filters?.categoryId) {
        query = query.eq('category_id', filters.categoryId)
      }

      if (filters?.search) {
        query = query.or(
          `name.ilike.%${filters.search}%,item_code.ilike.%${filters.search}%,sub_category.ilike.%${filters.search}%`
        )
      }

      const { data, error } = await query
      if (error) throw error
      return data as Item[]
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000, // items change infrequently
  })
}

// ── Single item ───────────────────────────────────────────────
export function useItem(id: string | null) {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['items', orgId, id],
    queryFn: async () => {
      if (!id || !orgId) return null
      const { data, error } = await supabase
        .from('items')
        .select(`
          *,
          item_prices (
            id, purchase_rate, selling_rate, gst_percent,
            effective_from, effective_to, notes
          ),

          bom!bom_finished_item_id_fkey (
            id, qty_per_unit, unit_id, notes, is_active,
            unit:units (
              id, name
            ),
            component:items!bom_component_id_fkey (
              id, item_code, name, unit_id
            )
          )
        `)
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id && !!orgId,
    staleTime: 5 * 60 * 1000,
  })
}

// ── Update item ───────────────────────────────────────────────
export function useUpdateItem() {
  const supabase = createClient()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<Item>
    }) => {
      const { data, error } = await supabase
        .from('items')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['items'] })
      toast.success(`${data.name} updated`)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}