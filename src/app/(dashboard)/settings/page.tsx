'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useIsAdmin, useProfile } from '@/lib/hooks/use-profile'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TableLoader } from '@/components/ui/spinner'
import { formatDate, formatCurrency } from '@/lib/utils/format'
import { toast } from 'sonner'
import {
  Shield, RefreshCw, Tag,
  Check, X, AlertTriangle, Users,
} from 'lucide-react'
import type { Enums } from '@/lib/types/database'
import { useOrgId } from '@/lib/hooks/use-tenant'


type UserRole = Enums<"user_role">
// ── Tabs ──────────────────────────────────────────────────────
const TABS = ['Users', 'Price Update', 'Reconcile'] as const
type Tab = typeof TABS[number]

// ── Role badge colors ─────────────────────────────────────────
const ROLE_COLORS: Record<UserRole, 'danger' | 'warning' | 'info' | 'teal' | 'purple' | 'default'> = {
  admin:      'danger',
  manager:    'warning',
  sales:      'info',
  store:      'teal',
  production: 'purple',
  viewer:     'default',
}

// ── Fetch all profiles ────────────────────────────────────────
function useAllProfiles(orgId: string | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["all-profiles", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role, is_active, created_at")
        .eq("org_id", orgId)
        .order("full_name");

      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
  });
}

// ── Fetch items with current prices ──────────────────────────
function useItemsWithPrices(search: string, orgId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: ["items-for-price-update", orgId, search],
    queryFn: async () => {
      if (!orgId) return [];

      let query = supabase
        .from("items")
        .select(
          `
              id,
              item_code,
              name,
              unit_id,
              category_id,
              item_category:item_categories (
                id,
                name
              ),
              unit:units (
                id,
                name
              )
            `
        )
        .eq("is_active", true)
        .order("category_id");

      if (search) {
        query = query.or(`name.ilike.%${search}%,item_code.ilike.%${search}%`);
      }

      const { data: items, error } = await query;
      if (error) throw error;

      const { data: prices } = await supabase
        .from("v_current_prices")
        .select(
          "item_id, purchase_rate, selling_rate, gst_percent, rate_unit, effective_from"
        );

      const priceMap = new Map(prices?.map((p) => [p.item_id, p]) ?? []);
      return (
        items?.map((i) => ({
          ...i,
          currentPrice: priceMap.get(i.id) ?? null,
        })) ?? []
      );  
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!orgId,
  });
}

export default function SettingsPage() {
  const supabase     = createClient()
  const qc           = useQueryClient()
  const isAdmin      = useIsAdmin()
  const orgId        = useOrgId()
  const { data: me } = useProfile()

  const [activeTab, setActiveTab] = useState<Tab>('Users')

  // ── Users state ───────────────────────────────────────────
  const { data: profiles, isLoading: loadingProfiles } = useAllProfiles(orgId)
  const [updatingRole, setUpdatingRole] = useState<string | null>(null)

  // ── Price update state ────────────────────────────────────
  const [priceSearch,  setPriceSearch]  = useState('')
  const [editingPrice, setEditingPrice] = useState<string | null>(null)
  const [newPurchase,  setNewPurchase]  = useState('')
  const [newSelling,   setNewSelling]   = useState('')
  const [savingPrice,  setSavingPrice]  = useState(false)

  const { data: items, isLoading: loadingItems } = useItemsWithPrices(priceSearch, orgId)

  // ── Reconcile state ───────────────────────────────────────
  const [reconciling,     setReconciling]     = useState(false)
  const [reconcileResult, setReconcileResult] = useState<any[] | null>(null)

  // ── Update role ───────────────────────────────────────────
  async function handleRoleChange(userId: string, newRole: UserRole) {
    if (userId === me?.id) { toast.error("You can't change your own role"); return }
    setUpdatingRole(userId)
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ role: newRole })
        .eq("id", userId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["all-profiles"] });
      toast.success("Role updated");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setUpdatingRole(null);
    }
  }

  // ── Toggle active ─────────────────────────────────────────
  async function handleToggleUser(userId: string, current: boolean) {
    if (userId === me?.id) { toast.error("You can't deactivate yourself"); return }
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: !current })
      .eq('id', userId)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['all-profiles'] })
    toast.success(current ? 'User deactivated' : 'User activated')
  }

  // ── Save new price ────────────────────────────────────────
  async function handleSavePrice(itemId: string) {
    if (!newSelling && !newPurchase) {
      toast.error('Enter at least a purchase or selling rate')
      return
    }

    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }

    setSavingPrice(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const today = new Date().toISOString().split('T')[0]

      // Close the current active price
      await supabase
        .from('item_prices')
        .update({ effective_to: today })
        .eq('item_id', itemId)
        .is('effective_to', null)

      // Insert new price row
      ///LATEST CHANGE
      const currentPrice = items?.find((i) => i.id === itemId)?.currentPrice;

      const selectedItem = items?.find((i) => i.id === itemId);

      if (!selectedItem?.unit_id) {
        toast.error("Item has no unit assigned");
        return;
      }

      const { error } = await supabase.from("item_prices").insert({
        org_id: orgId,
        item_id: itemId,
        purchase_rate: newPurchase ? Number(newPurchase) : null,
        selling_rate: newSelling ? Number(newSelling) : null,
        gst_percent: (currentPrice?.gst_percent ?? "18") as any,
        unit_id: selectedItem.unit_id,
        effective_from: today,
        created_by: user?.id ?? null,
      });

      if (error) throw error

      qc.invalidateQueries({ queryKey: ['items-for-price-update'] })
      setEditingPrice(null)
      setNewPurchase('')
      setNewSelling('')
      toast.success('Price updated — effective from today')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setSavingPrice(false)
    }
  }

  function cancelPriceEdit() {
    setEditingPrice(null)
    setNewPurchase('')
    setNewSelling('')
  }

  // ── Reconcile ─────────────────────────────────────────────
  async function handleReconcile() {
    setReconciling(true)
    setReconcileResult(null)
    try {
      const { data, error } = await supabase.rpc("reconcile_inventory_balance");
      if (error) throw error;
      const result = (data as any[]) ?? [];
      setReconcileResult(result);
      if (result.length === 0) {
        toast.success("All balances correct — no drift detected");
      } else {
        toast.warning(
          `Fixed ${result.length} balance discrepanc${
            result.length === 1 ? "y" : "ies"
          }`
        );
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setReconciling(false);
    }
  }

  // ── Guard: admin only ─────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <Shield className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Admin access required</p>
          <p className="text-slate-400 text-sm mt-1">Only administrators can view settings</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="User management, item pricing, and system administration"
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-lg w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`
              px-4 py-2 rounded-md text-sm font-medium transition-all
              ${
                activeTab === tab
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }
            `}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ══ USERS ══════════════════════════════════════════════ */}
      {activeTab === "Users" && (
        <div>
          <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <strong>To add new users:</strong> Go to your Supabase Dashboard →
              Authentication → Users → Add User. Their profile appears here
              automatically with the <strong>viewer</strong> role. Upgrade the
              role below.
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingProfiles ? (
              <TableLoader />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      User
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Current Role
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Change Role
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Status
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Joined
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {profiles?.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center py-10 text-slate-400 text-sm"
                      >
                        No user profiles found
                      </td>
                    </tr>
                  )}
                  {profiles?.map((profile: any) => (
                    <tr
                      key={profile.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        !profile.is_active ? "opacity-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">
                          {profile.full_name}
                        </div>
                        {profile.id === me?.id && (
                          <div className="text-xs text-blue-500 font-medium">
                            You
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={ROLE_COLORS[profile.role as UserRole]}>
                          {profile.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {profile.id !== me?.id ? (
                          <select
                            value={profile.role}
                            disabled={updatingRole === profile.id}
                            onChange={(e) =>
                              handleRoleChange(
                                profile.id,
                                e.target.value as UserRole
                              )
                            }
                            className="
                              px-2 py-1.5 text-xs rounded-lg border border-slate-200
                              bg-white focus:outline-none focus:ring-1 focus:ring-blue-500
                              disabled:opacity-50
                            "
                          >
                            <option value="viewer">viewer</option>
                            <option value="production">production</option>
                            <option value="store">store</option>
                            <option value="sales">sales</option>
                            <option value="manager">manager</option>
                            <option value="admin">admin</option>
                          </select>
                        ) : (
                          <span className="text-xs text-slate-400 italic">
                            Cannot change own role
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge
                          variant={profile.is_active ? "success" : "default"}
                        >
                          {profile.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {formatDate(profile.created_at)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {profile.id !== me?.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              handleToggleUser(profile.id, profile.is_active)
                            }
                            className={
                              profile.is_active
                                ? "text-red-500 hover:bg-red-50"
                                : "text-green-600 hover:bg-green-50"
                            }
                          >
                            {profile.is_active ? "Deactivate" : "Activate"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══ PRICE UPDATE ═══════════════════════════════════════ */}
      {activeTab === "Price Update" && (
        <div>
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 text-sm text-blue-800">
            Updating a price <strong>creates a new record</strong> effective
            from today and closes the previous one. Old quotations and invoices
            are unaffected — they always stored the rate at the time of
            creation.
          </div>

          {/* Search */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-4">
            <div className="px-5 py-4 flex items-center gap-3">
              <input
                type="text"
                placeholder="Search items by name or code…"
                value={priceSearch}
                onChange={(e) => setPriceSearch(e.target.value)}
                className="
                  flex-1 max-w-sm px-3 py-2 text-sm rounded-lg border border-slate-300
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                "
              />
              <span className="text-xs text-slate-400 ml-auto">
                {items?.length ?? 0} items
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingItems ? (
              <TableLoader />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        Item
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        Category
                      </th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        Unit
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        Purchase Rate
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        Selling Rate
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        Since
                      </th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">
                        Update
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {items?.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="text-center py-10 text-slate-400 text-sm"
                        >
                          No items found
                        </td>
                      </tr>
                    )}
                    {items?.map((item: any) => (
                      <tr
                        key={item.id}
                        className="hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mr-2">
                            {item.item_code}
                          </span>
                          <span className="font-medium text-slate-900">
                            {item.name}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="default">
                            {item.item_category?.name ?? "—"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-slate-500">
                          {item.unit?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                          {item.currentPrice?.purchase_rate ? (
                            formatCurrency(item.currentPrice.purchase_rate)
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                          {item.currentPrice?.selling_rate ? (
                            formatCurrency(item.currentPrice.selling_rate)
                          ) : (
                            <span className="text-slate-300 font-normal">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {item.currentPrice?.effective_from
                            ? formatDate(item.currentPrice.effective_from)
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {editingPrice === item.id ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                placeholder="Purchase ₹"
                                value={newPurchase}
                                onChange={(e) => setNewPurchase(e.target.value)}
                                className="w-24 px-2 py-1 text-xs rounded border border-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <input
                                type="number"
                                min="0"
                                step="any"
                                placeholder="Selling ₹"
                                value={newSelling}
                                onChange={(e) => setNewSelling(e.target.value)}
                                className="w-24 px-2 py-1 text-xs rounded border border-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <button
                                onClick={() => handleSavePrice(item.id)}
                                disabled={savingPrice}
                                className="p-1.5 rounded text-green-600 hover:bg-green-50 disabled:opacity-50"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={cancelPriceEdit}
                                className="p-1.5 rounded text-red-500 hover:bg-red-50"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingPrice(item.id);
                                setNewPurchase(
                                  String(item.currentPrice?.purchase_rate ?? "")
                                );
                                setNewSelling(
                                  String(item.currentPrice?.selling_rate ?? "")
                                );
                              }}
                            >
                              <Tag className="w-3.5 h-3.5" />
                              Update
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ RECONCILE ══════════════════════════════════════════ */}
      {activeTab === "Reconcile" && (
        <div className="max-w-2xl">
          <Card>
            <CardHeader>
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-blue-600" />
                Inventory Balance Reconciliation
              </h3>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                This function recalculates every item's inventory balance from
                scratch using the raw <strong>stock_movements</strong> ledger as
                the source of truth. It compares the recalculated values against
                the cached
                <strong> inventory_balance</strong> table and corrects any
                discrepancies.
              </p>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-600">
                In normal operation this should report{" "}
                <strong>zero discrepancies.</strong> Run it if inventory numbers
                appear incorrect after investigation, after a manual database
                edit, or after a system migration.
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <strong>Safe to run anytime.</strong> It only corrects the
                cached balance rows — it never touches the immutable
                stock_movements ledger.
              </div>

              <Button
                loading={reconciling}
                onClick={handleReconcile}
                className="bg-slate-800 hover:bg-slate-900"
              >
                <RefreshCw className="w-4 h-4" />
                Run Reconciliation
              </Button>

              {/* Results */}
              {reconcileResult !== null && !reconciling && (
                <div className="mt-2">
                  {reconcileResult.length === 0 ? (
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                      <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                      All inventory balances are correct — no discrepancies
                      found
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold text-amber-700 mb-3">
                        Fixed {reconcileResult.length} discrepanc
                        {reconcileResult.length === 1 ? "y" : "ies"}:
                      </p>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                              <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase">
                                Item ID
                              </th>
                              <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase">
                                Old Qty
                              </th>
                              <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase">
                                New Qty
                              </th>
                              <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase">
                                Difference
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {reconcileResult.map((r: any, i: number) => (
                              <tr key={i} className="hover:bg-slate-50">
                                <td className="px-3 py-2 font-mono text-slate-500 truncate max-w-[200px]">
                                  {r.item_id}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                                  {r.old_qty}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                                  {r.new_qty}
                                </td>
                                <td
                                  className={`px-3 py-2 text-right tabular-nums font-bold ${
                                    r.diff > 0
                                      ? "text-green-600"
                                      : "text-red-600"
                                  }`}
                                >
                                  {r.diff > 0 ? "+" : ""}
                                  {r.diff}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}