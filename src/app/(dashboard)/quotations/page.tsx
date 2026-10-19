'use client'

import { useState } from 'react'
import { useQuotations, useUpdateQuotationStatus } from '@/lib/hooks/use-quotations'
import { useCanApprove } from '@/lib/hooks/use-profile'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { DocumentStatusBadge } from '@/components/ui/badge'
import { TableLoader } from '@/components/ui/spinner'
import { formatCurrency, formatDate } from '@/lib/utils/format'
import { Plus, Search, CheckCircle, XCircle, Eye } from 'lucide-react'
import Link from 'next/link'
import type { Enums } from '@/lib/types/database'

type DocumentStatus = Enums<'document_status'>

// ── Add 'converted' as a UI-only filter value ─────────────────
// Once the DB enum is updated, remove the `as any` casts
const STATUS_TABS: { label: string; value: DocumentStatus | 'converted' | '' }[] = [
  { label: 'All',              value: '' },
  { label: 'Draft',            value: 'draft' },
  { label: 'Pending Approval', value: 'pending_approval' },
  { label: 'Approved',         value: 'approved' },
  { label: 'Converted',        value: 'converted' },
  { label: 'Rejected',         value: 'rejected' },
]

export default function QuotationsPage() {
  const [status, setStatus] = useState<DocumentStatus | 'converted' | ''>('')
  const [search, setSearch] = useState('')
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const canApprove = useCanApprove()
  const { data: quotations, isLoading } = useQuotations({
    status: (status || undefined) as DocumentStatus | undefined,
    search,
  })
  const { mutate: updateStatus, isPending } = useUpdateQuotationStatus()

  function handleApprove(id: string) {
    setApprovingId(id)
    updateStatus({ id, status: 'approved' }, { onSettled: () => setApprovingId(null) })
  }

  function handleReject(id: string) {
    setApprovingId(id)
    updateStatus({ id, status: 'rejected' }, { onSettled: () => setApprovingId(null) })
  }

  return (
    <div>
      <PageHeader
        title="Quotations"
        description="Customer price offers and approval workflow"
      >
        <Link href="/quotations/new">
          <Button size="sm">
            <Plus className="w-4 h-4" />
            New Quotation
          </Button>
        </Link>
      </PageHeader>

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg w-fit">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatus(tab.value)}
            className={`
              px-3 py-1.5 rounded-md text-sm font-medium transition-all
              ${status === tab.value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="px-5 py-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by quotation number…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <span className="text-xs text-slate-400 ml-auto">
            {quotations?.length ?? 0} quotations
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <TableLoader />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Quotation No.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Valid Until</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Created By</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {quotations?.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                      No quotations found
                    </td>
                  </tr>
                )}
                {quotations?.map(q => {
                  const isExpired   = q.valid_until && new Date(q.valid_until) < new Date()
                  const isPendingQ  = q.status === 'pending_approval'
                  const isConverted = (q.status as any) === 'converted'

                  return (
                    <tr key={q.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          href={`/quotations/${q.id}`}
                          className="font-mono text-sm font-semibold text-blue-600 hover:underline"
                        >
                          {q.quotation_no}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{(q.client as any)?.name}</div>
                        <div className="text-xs text-slate-400">{(q.client as any)?.phone}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(q.quotation_date)}</td>
                      <td className="px-4 py-3">
                        <span className={isExpired && q.status === 'draft' ? 'text-red-500' : 'text-slate-600'}>
                          {q.valid_until ? formatDate(q.valid_until) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div className="font-semibold text-slate-900">{formatCurrency(q.total_amount)}</div>
                        <div className="text-xs text-slate-400">+GST {formatCurrency(q.gst_amount)}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {/* Converted gets its own inline badge since DocumentStatusBadge
                            won't know about it until the DB enum is updated */}
                        {isConverted ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 11, fontWeight: 600, padding: '2px 8px',
                            borderRadius: 5, background: 'rgba(20,184,166,0.12)',
                            color: '#0d9488',
                          }}>
                            Converted
                          </span>
                        ) : (
                          <DocumentStatusBadge status={q.status} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {(q.creator as any)?.full_name ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <Link href={`/quotations/${q.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                          {/* Approve/Reject only for pending, non-converted */}
                          {canApprove && isPendingQ && !isConverted && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={isPending && approvingId === q.id}
                                onClick={() => handleApprove(q.id)}
                                className="text-green-700 bg-green-50 hover:bg-green-100"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleReject(q.id)}
                                className="text-red-600 hover:bg-red-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}