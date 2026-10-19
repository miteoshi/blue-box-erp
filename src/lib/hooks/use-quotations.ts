'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useOrgId } from '@/lib/hooks/use-tenant'
import { toast } from 'sonner'
import type { Enums, Tables } from '@/lib/types/database'

export type Quotation = Tables<'quotations'>
export type DocumentStatus = Enums<'document_status'>

// ── All quotations ────────────────────────────────────────────
export function useQuotations(filters?: {
  status?: DocumentStatus
  clientId?: string
  search?: string
}) {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['quotations', orgId, filters],
    queryFn: async () => {
      if (!orgId) return []

      let query = supabase
        .from('quotations')
        .select(`
          *,
          client:clients ( id, name, phone ),
          creator:profiles!quotations_created_by_fkey ( full_name )
        `)
        .order('created_at', { ascending: false })

      if (filters?.status) {
        query = query.eq('status', filters.status)
      }
      if (filters?.clientId) {
        query = query.eq('client_id', filters.clientId)
      }
      if (filters?.search) {
        query = query.ilike('quotation_no', `%${filters.search}%`)
      }

      const { data, error } = await query
      if (error) throw error
      return data
    },
    enabled: !!orgId,
    staleTime: 30 * 1000,
  })
}

// ── Single quotation with lines ───────────────────────────────
export function useQuotation(id: string | null) {
  const supabase = createClient()
  const orgId = useOrgId()

  return useQuery({
    queryKey: ['quotations', orgId, id],
    queryFn: async () => {
      if (!id || !orgId) return null

      const { data, error } = await supabase
        .from('quotations')
        .select(`
          *,
          client:clients ( id, name, phone, gst_number, address, city ),
          creator:profiles!quotations_created_by_fkey ( id, full_name ),
          approver:profiles!quotations_approved_by_fkey ( id, full_name ),
          quotation_lines (
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

// ── Update quotation status ───────────────────────────────────
export function useUpdateQuotationStatus() {
  const supabase = createClient()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      status,
      comments,
    }: {
      id: string
      status: DocumentStatus
      comments?: string
    }) => {
      // Update quotation status
      const updates: Partial<Quotation> = { status }

      if (status === 'approved') {
        updates.approved_at = new Date().toISOString()

        // approved_by is set by the DB via auth.uid() in audit log
        // We set it here manually for the UI
        const { data: { user } } = await supabase.auth.getUser()

        if (user) {
          updates.approved_by = user.id
        }
      }

      const { error: qError } = await supabase
        .from('quotations')
        .update(updates)
        .eq('id', id)

      if (qError) throw qError

      // Log the approval action
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: qData } = await supabase
          .from('quotations')
          .select('org_id')
          .eq('id', id)
          .single()

        if (qData?.org_id) {
          await supabase.from('approvals').insert({
            org_id: qData.org_id,
            ref_type: 'quotation',
            ref_id: id,
            action: status === 'approved'
              ? 'approved'
              : status === 'rejected'
              ? 'rejected'
              : 'revision_requested',
            actioned_by: user.id,
            comments: comments ?? null,
          })
        }
      }
    },

    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['quotations'] })

      toast.success(
        vars.status === 'approved'
          ? 'Quotation approved'
          : vars.status === 'rejected'
          ? 'Quotation rejected'
          : 'Status updated'
      )
    },

    onError: (err: Error) => toast.error(err.message),
  })
}