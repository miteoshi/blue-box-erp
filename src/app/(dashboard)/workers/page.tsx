'use client'

import { useState } from 'react'
import { useOrgId } from "@/lib/hooks/use-tenant";
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { TableLoader } from '@/components/ui/spinner'
import { formatDate } from '@/lib/utils/format'
import { toast } from 'sonner'
import { Plus, X, HardHat, Mail, Copy, CheckCircle, Eye, EyeOff } from 'lucide-react'

function useWorkers(orgId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: ["workers", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("workers")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}

// Auto-generate email from name — mirrors the server logic
function generateEmail(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '.')
  return `${slug}@bluebox.com`
}

function defaultPassword(name: string): string {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '').slice(0, 6)
  return `bluebox@${slug}123`
}

interface WorkerForm {
  name:  string
  phone: string
  skill: string
}

interface CreatedAccount {
  email:    string
  password: string
  name:     string
}

const EMPTY: WorkerForm = { name: '', phone: '', skill: '' }

const SKILLS = [
  'Assembly & Welding',
  'Wiring & Testing',
  'GOD Set Assembly',
  'Channel Cutting & Drilling',
  'Quality Check & Packing',
  'General Labour',
]

export default function WorkersPage() {
  const supabase = createClient()
  const qc       = useQueryClient()
  const orgId = useOrgId();

  const [showForm,   setShowForm]   = useState(false)
  const [editId,     setEditId]     = useState<string | null>(null)
  const [form,       setForm]       = useState<WorkerForm>(EMPTY)
  const [saving,     setSaving]     = useState(false)
  // Shown after creation — credentials the admin shares with the worker
  const [created,    setCreated]    = useState<CreatedAccount | null>(null)
  const [showPass,   setShowPass]   = useState(false)
  const [copied,     setCopied]     = useState<string | null>(null)

  const { data: workers, isLoading } = useWorkers(orgId);

  const f = (field: keyof WorkerForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }))

  // Preview the generated email as user types the name
  const previewEmail = form.name.trim() ? generateEmail(form.name) : null
  const previewPass  = form.name.trim() ? defaultPassword(form.name) : null

  function openNew() { setForm(EMPTY); setEditId(null); setCreated(null); setShowForm(true) }

  function openEdit(w: any) {
    setForm({ name: w.name ?? '', phone: w.phone ?? '', skill: w.skill ?? '' })
    setEditId(w.id)
    setCreated(null)
    setShowForm(true)
  }

  async function copyToClipboard(text: string, key: string) {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  // ── Create new worker with auth account ───────────────────
  async function handleCreate() {
    if (!form.name.trim()) { toast.error('Worker name is required'); return }
    setSaving(true)
    try {
      const res = await fetch("/api/admin/create-worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          skill: form.skill || null,
          phone: form.phone || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        // Handle email collision suggestion
        if (res.status === 409 && json.suggestedEmail) {
          toast.error(json.error);
        } else {
          toast.error(json.error ?? "Failed to create worker");
        }
        return;
      }

      // Show the generated credentials to admin
      setCreated({
        email: json.email,
        password: json.password,
        name: form.name.trim(),
      });
      qc.invalidateQueries({ queryKey: ["workers"] });
      setForm(EMPTY);

      if (json.emailSuffixed) {
        toast.success(
          `Worker created — email adjusted to ${json.email} (name already taken)`
        );
      } else {
        toast.success(
          `Worker account created — share credentials with ${json.generatedFrom}`
        );
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setSaving(false);
    }
  }

  // ── Update existing worker (no auth changes) ──────────────
  async function handleUpdate() {
    if (!form.name.trim()) { toast.error('Worker name is required'); return }
    setSaving(true)
    try {
      const { error } = await supabase
        .from("workers")
        .update({
          name: form.name.trim(),
          phone: form.phone || null,
          skill: form.skill || null,
        })
        .eq("id", editId!);
      if (error) throw error;
      toast.success("Worker updated");
      qc.invalidateQueries({ queryKey: ["workers"] });
      setShowForm(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string, current: boolean) {
    const { error } = await supabase
      .from('workers')
      .update({ is_active: !current })
      .eq('id', id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['workers'] })
    toast.success(current ? 'Worker deactivated' : 'Worker activated')
  }

  const active   = workers?.filter(w => w.is_active)  ?? []
  const inactive = workers?.filter(w => !w.is_active) ?? []
  const initials = (name: string) =>
    name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div>
      <PageHeader
        title="Workers"
        description="Shop floor workers — accounts auto-created with @bluebox.com email"
      >
        <Button size="sm" onClick={openNew}>
          <Plus className="w-4 h-4" />
          Add Worker
        </Button>
      </PageHeader>

      {/* ── Credentials shown after creation ────────────────── */}
      {created && (
        <div style={{
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: 12,
          padding: '16px 20px',
          marginBottom: 24,
        }}>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>
              Account created for {created.name}
            </span>
            <span style={{ fontSize: 12, color: '#475569', marginLeft: 4 }}>
              — Share these credentials with the worker
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Email */}
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '0.5px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: '10px 12px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                Login Email
              </div>
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontSize: 13, color: '#e2e8f0', fontFamily: 'monospace' }}>
                  {created.email}
                </span>
                <button
                  onClick={() => copyToClipboard(created.email, 'email')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 2 }}
                >
                  {copied === 'email'
                    ? <CheckCircle style={{ width: 14, height: 14, color: '#4ade80' }} />
                    : <Copy style={{ width: 14, height: 14 }} />
                  }
                </button>
              </div>
            </div>

            {/* Password */}
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '0.5px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: '10px 12px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                Temporary Password
              </div>
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontSize: 13, color: '#e2e8f0', fontFamily: 'monospace' }}>
                  {showPass ? created.password : '••••••••••••'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowPass(v => !v)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 2 }}
                  >
                    {showPass
                      ? <EyeOff style={{ width: 14, height: 14 }} />
                      : <Eye style={{ width: 14, height: 14 }} />
                    }
                  </button>
                  <button
                    onClick={() => copyToClipboard(created.password, 'pass')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 2 }}
                  >
                    {copied === 'pass'
                      ? <CheckCircle style={{ width: 14, height: 14, color: '#4ade80' }} />
                      : <Copy style={{ width: 14, height: 14 }} />
                    }
                  </button>
                </div>
              </div>
            </div>
          </div>

          <p style={{ fontSize: 11, color: '#475569', marginTop: 10 }}>
            Worker can change their password after first login. Store these credentials securely.
          </p>

          <button
            onClick={() => setCreated(null)}
            style={{ marginTop: 8, fontSize: 12, color: '#475569', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Slide-in form ────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative w-full max-w-sm bg-white shadow-2xl flex flex-col">

            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900">
                {editId ? 'Edit Worker' : 'Add Worker'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <Input
                label="Full Name *"
                required
                value={form.name}
                onChange={f('name')}
                placeholder="e.g. Ramesh Kumar"
                hint={!editId && previewEmail ? `Will login as: ${previewEmail}` : undefined}
              />

              <Input
                label="Phone"
                value={form.phone}
                onChange={f('phone')}
                placeholder="Mobile number"
              />

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Primary Skill</label>
                <select
                  value={form.skill}
                  onChange={e => setForm(prev => ({ ...prev, skill: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select skill…</option>
                  {SKILLS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Preview box — only for new workers */}
              {!editId && previewEmail && (
                <div style={{
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  borderRadius: 8,
                  padding: '10px 12px',
                }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#0369a1', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Auto-generated credentials
                  </p>
                  <div style={{ fontSize: 12, color: '#0c4a6e', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div>
                      <span style={{ color: '#64748b' }}>Email: </span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{previewEmail}</span>
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>Password: </span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{previewPass}</span>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                    These will be created automatically. Share with the worker after saving.
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={saving}
                onClick={editId ? handleUpdate : handleCreate}
              >
                {editId ? 'Save Changes' : 'Create Worker & Account'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <HardHat className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Active Workers</p>
            <p className="text-2xl font-bold text-slate-900">{active.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
            <HardHat className="w-5 h-5 text-slate-400" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Inactive</p>
            <p className="text-2xl font-bold text-slate-400">{inactive.length}</p>
          </div>
        </div>
      </div>

      {/* ── Worker cards ─────────────────────────────────────── */}
      {isLoading ? <TableLoader /> : (
        <>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Active Workers ({active.length})</h3>

          {active.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 text-center py-10 text-slate-400 text-sm mb-8">
              No active workers — click Add Worker above
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {active.map((w: any) => (
                <div key={w.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-purple-700 font-bold text-sm">{initials(w.name)}</span>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">{w.name}</div>
                      {w.phone && <div className="text-xs text-slate-500 mt-0.5">{w.phone}</div>}
                      {w.email && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Mail className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          <span className="text-xs text-slate-400 truncate max-w-[160px]">{w.email}</span>
                        </div>
                      )}
                      {w.skill && <div className="mt-2"><Badge variant="purple">{w.skill}</Badge></div>}
                      <div className="text-xs text-slate-400 mt-2">Added {formatDate(w.created_at)}</div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(w)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleToggle(w.id, w.is_active)} className="text-red-500 hover:bg-red-50">
                      Deactivate
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {inactive.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-slate-400 mb-3">Inactive Workers ({inactive.length})</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {inactive.map((w: any) => (
                  <div key={w.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-start justify-between gap-3 opacity-50">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-slate-400 font-bold text-sm">{initials(w.name)}</span>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-600">{w.name}</div>
                        {w.email && <div className="text-xs text-slate-400 mt-0.5">{w.email}</div>}
                        {w.skill && <div className="text-xs text-slate-400 mt-0.5">{w.skill}</div>}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleToggle(w.id, w.is_active)} className="text-green-600 hover:bg-green-50 flex-shrink-0">
                      Activate
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}