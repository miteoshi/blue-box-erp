'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Textarea } from '@/components/ui/input'
import { TableLoader } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { Plus, Search, X } from 'lucide-react'
import { useOrgId } from '@/lib/hooks/use-tenant'

function useSuppliers(search: string, orgId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: ["suppliers", orgId, search],
    queryFn: async () => {
      if (!orgId) return [];
      let query = supabase.from("suppliers").select("*").order("name");
      if (search) {
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!orgId,
  });
}

interface SupplierForm {
  name:           string
  contact_person: string
  phone:          string
  email:          string
  address:        string
  city:           string
  state:          string
  gst_number:     string
  payment_terms:  string
  notes:          string
}

const EMPTY: SupplierForm = {
  name: '', contact_person: '', phone: '', email: '',
  address: '', city: '', state: 'Gujarat',
  gst_number: '', payment_terms: '', notes: '',
}

export default function SuppliersPage() {
  const supabase = createClient()
  const qc       = useQueryClient()
  const orgId    = useOrgId()

  const [search,   setSearch]   = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState<string | null>(null)
  const [form,     setForm]     = useState<SupplierForm>(EMPTY)
  const [saving,   setSaving]   = useState(false)

  const { data: suppliers, isLoading } = useSuppliers(search, orgId)

  const f = (field: keyof SupplierForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  function openNew() { setForm(EMPTY); setEditId(null); setShowForm(true) }
  function openEdit(s: any) {
    setForm({
      name:           s.name           ?? '',
      contact_person: s.contact_person ?? '',
      phone:          s.phone          ?? '',
      email:          s.email          ?? '',
      address:        s.address        ?? '',
      city:           s.city           ?? '',
      state:          s.state          ?? 'Gujarat',
      gst_number:     s.gst_number     ?? '',
      payment_terms:  s.payment_terms  ?? '',
      notes:          s.notes          ?? '',
    })
    setEditId(s.id)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Supplier name is required'); return }
    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }
    setSaving(true)
    try {
      const payload = {
        name:           form.name.trim(),
        contact_person: form.contact_person || null,
        phone:          form.phone          || null,
        email:          form.email          || null,
        address:        form.address        || null,
        city:           form.city           || null,
        state:          form.state          || null,
        gst_number:     form.gst_number     || null,
        payment_terms:  form.payment_terms  || null,
        notes:          form.notes          || null,
      }

      if (editId) {
        const { error } = await supabase.from('suppliers').update(payload).eq('id', editId)
        if (error) throw error
        toast.success('Supplier updated')
      } else {
        const { error } = await supabase.from('suppliers').insert({
          ...payload,
          org_id: orgId,
        })
        if (error) throw error
        toast.success('Supplier added')
      }

      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setShowForm(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save supplier')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(id: string, current: boolean) {
    const { error } = await supabase.from('suppliers').update({ is_active: !current }).eq('id', id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['suppliers'] })
    toast.success(current ? 'Supplier deactivated' : 'Supplier activated')
  }

  return (
    <div>
      <PageHeader title="Suppliers" description="Vendor master — all raw material and trading goods suppliers">
        <Button size="sm" onClick={openNew}>
          <Plus className="w-4 h-4" />
          New Supplier
        </Button>
      </PageHeader>

      {/* Slide-in form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">{editId ? 'Edit Supplier' : 'New Supplier'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Input label="Supplier Name" required value={form.name} onChange={f('name')} placeholder="e.g. Sun Insulators Pvt Ltd" />
              <Input label="Contact Person" value={form.contact_person} onChange={f('contact_person')} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Phone" value={form.phone} onChange={f('phone')} />
                <Input label="Email" type="email" value={form.email} onChange={f('email')} />
              </div>
              <Input label="GST Number" value={form.gst_number} onChange={f('gst_number')} placeholder="24XXXXX1234X1ZX" />
              <Textarea label="Address" value={form.address} onChange={f('address')} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="City" value={form.city} onChange={f('city')} />
                <Input label="State" value={form.state} onChange={f('state')} />
              </div>
              <Input label="Payment Terms" value={form.payment_terms} onChange={f('payment_terms')} placeholder="e.g. 100% advance before delivery" />
              <Textarea label="Notes" value={form.notes} onChange={f('notes')} placeholder="Specialities, lead times, notes…" />
            </div>
            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1" loading={saving} onClick={handleSave}>
                {editId ? 'Save Changes' : 'Add Supplier'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="px-5 py-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or phone…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <span className="text-xs text-slate-400 ml-auto">{suppliers?.length ?? 0} suppliers</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? <TableLoader /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Supplier</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Location</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">GST No.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Payment Terms</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {suppliers?.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">No suppliers found</td></tr>
                )}
                {suppliers?.map((s: any) => (
                  <tr key={s.id} className={`hover:bg-slate-50 transition-colors ${!s.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{s.name}</div>
                      {s.contact_person && <div className="text-xs text-slate-400">{s.contact_person}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-700">{s.phone ?? '—'}</div>
                      {s.email && <div className="text-xs text-slate-400">{s.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {[s.city, s.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {s.gst_number
                        ? <span className="font-mono text-xs text-slate-600">{s.gst_number}</span>
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs max-w-[200px]">
                      {s.payment_terms ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={s.is_active ? 'success' : 'default'}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>Edit</Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggle(s.id, s.is_active)}
                          className={s.is_active ? 'text-red-500 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}
                        >
                          {s.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}