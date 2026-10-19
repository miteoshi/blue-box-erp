'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { TableLoader } from '@/components/ui/spinner'
import { formatCurrency } from '@/lib/utils/format'
import { toast } from 'sonner'
import { Plus, Search, X, Users } from 'lucide-react'
import { useOrgId } from '@/lib/hooks/use-tenant'

function useClients(search: string, orgId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["clients", orgId, search],

    queryFn: async () => {
      if (!orgId) {
        throw new Error("Organization context is not available");
      }

      let query = supabase
        .from("clients")
        .select(
          `
          id,
          name,
          contact_person,
          phone,
          email,
          address,
          city,
          state,
          gst_number,
          credit_limit,
          credit_days,
          notes,
          is_active
          `
        )
        .order("name");

      if (search) {
        query = query.or(
          `name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
        );
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return data;
    },

    enabled: !!orgId,
    staleTime: 2 * 60 * 1000,
  });
}

interface ClientForm {
  name:           string
  contact_person: string
  phone:          string
  email:          string
  address:        string
  city:           string
  state:          string
  gst_number:     string
  credit_limit:   string
  credit_days:    string
  notes:          string
}

const EMPTY_FORM: ClientForm = {
  name: '', contact_person: '', phone: '', email: '',
  address: '', city: '', state: 'Gujarat',
  gst_number: '', credit_limit: '0', credit_days: '0', notes: '',
}

export default function ClientsPage() {
  const supabase = createClient()
  const qc       = useQueryClient()
  const orgId    = useOrgId()

  const [search,     setSearch]     = useState('')
  const [showForm,   setShowForm]   = useState(false)
  const [editId,     setEditId]     = useState<string | null>(null)
  const [form,       setForm]       = useState<ClientForm>(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)

  const { data: clients, isLoading } = useClients(search, orgId)

  function setField(field: keyof ClientForm, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function openNew() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setShowForm(true)
  }

  function openEdit(client: any) {
    setForm({
      name:           client.name           ?? '',
      contact_person: client.contact_person ?? '',
      phone:          client.phone          ?? '',
      email:          client.email          ?? '',
      address:        client.address        ?? '',
      city:           client.city           ?? '',
      state:          client.state          ?? 'Gujarat',
      gst_number:     client.gst_number     ?? '',
      credit_limit:   String(client.credit_limit ?? 0),
      credit_days:    String(client.credit_days  ?? 0),
      notes:          client.notes          ?? '',
    })
    setEditId(client.id)
    setShowForm(true)
  }

async function handleSave() {
  if (!form.name.trim()) {
    toast.error("Client name is required");
    return;
  }

  if (!orgId) {
    toast.error("Organization context is not available");
    return;
  }

  setSaving(true);

  try {
    const payload = {
      name: form.name.trim(),
      contact_person: form.contact_person || null,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
      gst_number: form.gst_number || null,
      credit_limit: Number(form.credit_limit) || 0,
      credit_days: Number(form.credit_days) || 0,
      notes: form.notes || null,
    };

    if (editId) {
      const { error } = await supabase
        .from("clients")
        .update(payload)
        .eq("id", editId);

      if (error) throw error;

      toast.success("Client updated");
    } else {
      const { error } = await supabase.from("clients").insert({
        ...payload,
        org_id: orgId,
      });

      if (error) throw error;

      toast.success("Client added");
    }

    await qc.invalidateQueries({ queryKey: ["clients"] });
    setShowForm(false);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to save client";

    toast.error(message);
  } finally {
    setSaving(false);
  }
}

  async function handleToggleActive(id: string, current: boolean) {
    const { error } = await supabase
      .from('clients')
      .update({ is_active: !current })
      .eq('id', id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['clients'] })
    toast.success(current ? 'Client deactivated' : 'Client activated')
  }

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Customer master — all companies and individuals you sell to"
      >
        <Button size="sm" onClick={openNew}>
          <Plus className="w-4 h-4" />
          New Client
        </Button>
      </PageHeader>

      {/* Slide-in form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">
                {editId ? 'Edit Client' : 'New Client'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <Input
                label="Company / Client Name"
                required
                value={form.name}
                onChange={e => setField('name', e.target.value)}
                placeholder="e.g. Gujarat State Electricity Corp."
              />
              <Input
                label="Contact Person"
                value={form.contact_person}
                onChange={e => setField('contact_person', e.target.value)}
                placeholder="Primary contact name"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Phone"
                  value={form.phone}
                  onChange={e => setField('phone', e.target.value)}
                  placeholder="Mobile number"
                />
                <Input
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={e => setField('email', e.target.value)}
                />
              </div>
              <Input
                label="GST Number"
                value={form.gst_number}
                onChange={e => setField('gst_number', e.target.value)}
                placeholder="22XXXXX1234X1ZX"
              />
              <Textarea
                label="Address"
                value={form.address}
                onChange={e => setField('address', e.target.value)}
                placeholder="Street address"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="City"
                  value={form.city}
                  onChange={e => setField('city', e.target.value)}
                />
                <Input
                  label="State"
                  value={form.state}
                  onChange={e => setField('state', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Credit Limit (₹)"
                  type="number"
                  min="0"
                  value={form.credit_limit}
                  onChange={e => setField('credit_limit', e.target.value)}
                  hint="0 = no credit"
                />
                <Input
                  label="Credit Days"
                  type="number"
                  min="0"
                  value={form.credit_days}
                  onChange={e => setField('credit_days', e.target.value)}
                  hint="Days to pay invoice"
                />
              </div>
              <Textarea
                label="Notes"
                value={form.notes}
                onChange={e => setField('notes', e.target.value)}
                placeholder="Internal notes about this client…"
              />
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button className="flex-1" loading={saving} onClick={handleSave}>
                {editId ? 'Save Changes' : 'Add Client'}
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
          <span className="text-xs text-slate-400 ml-auto">
            {clients?.length ?? 0} clients
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? <TableLoader /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Location</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">GST No.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Credit Limit</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Credit Days</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {clients?.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No clients found</td></tr>
                )}
                {clients?.map((client: any) => (
                  <tr key={client.id} className={`hover:bg-slate-50 transition-colors ${!client.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{client.name}</div>
                      {client.contact_person && (
                        <div className="text-xs text-slate-400">{client.contact_person}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-700">{client.phone ?? '—'}</div>
                      {client.email && (
                        <div className="text-xs text-slate-400">{client.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {[client.city, client.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {client.gst_number
                        ? <span className="font-mono text-xs text-slate-600">{client.gst_number}</span>
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {client.credit_limit > 0
                        ? <span className="font-medium text-slate-900">{formatCurrency(client.credit_limit)}</span>
                        : <span className="text-slate-300 text-xs">No credit</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">
                      {client.credit_days > 0
                        ? `${client.credit_days} days`
                        : <span className="text-slate-300 text-xs">Advance</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={client.is_active ? 'success' : 'default'}>
                        {client.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(client)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(client.id, client.is_active)}
                          className={client.is_active ? 'text-red-500 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}
                        >
                          {client.is_active ? 'Deactivate' : 'Activate'}
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