'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/lib/hooks/use-profile'
import { produceInventory, consumeInventory } from '@/lib/utils/inventory'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, ProductionStatusBadge } from '@/components/ui/badge'
import { PageLoader, TableLoader } from '@/components/ui/spinner'
import { formatDate, formatQty } from '@/lib/utils/format'
import { toast } from 'sonner'
import { useOrgId } from "@/lib/hooks/use-tenant";

import {
  Play, CheckCircle, ClipboardList,
  Package, HardHat, Calendar, AlertTriangle
} from 'lucide-react'
import Link from 'next/link'

// ── Fetch tasks assigned to the current user's worker profile ─
// Workers are matched by name to profiles.full_name
// OR admin/manager sees ALL pending/in_progress tasks
function useTasks(
  profileId: string | undefined,
  role: string | undefined,
  orgId: string | null
) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["tasks", orgId, profileId, role],
    queryFn: async () => {
      if (!profileId || !orgId) return [];

      // Admin/manager — see all active production orders
      if (role === "admin" || role === "manager") {
        const { data, error } = await supabase
          .from("production_orders")
          .select(
            `
            id, po_number, status,
            start_date, target_date, completed_date, notes,
            created_at,
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
              id,
              worker:workers ( id, name, skill )
            )
          `
          )
          .in("status", ["pending", "in_progress", "on_hold"])
          .order("created_at", { ascending: true });

        if (error) throw error;
        return data ?? [];
      }

      // Production worker — see only their assigned tasks
      // Match worker record by email from auth session (reliable, no name typo issues)
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) return [];

      // Find worker by email match
      const { data: worker } = await supabase
        .from("workers")
        .select("id")
        .ilike("email", user.email)
        .eq("is_active", true)
        .maybeSingle();

      if (!worker) return [];

      // Get production orders assigned to this worker
      const { data: assignments } = await supabase
        .from("production_assignments")
        .select("production_order_id")
        .eq("worker_id", worker.id);

      if (!assignments || assignments.length === 0) return [];

      const orderIds = assignments.map((a) => a.production_order_id);

      const { data, error } = await supabase
        .from("production_orders")
        .select(
          `
          id, po_number, status,
          start_date, target_date, completed_date, notes,
          created_at,
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
            id,
            worker:workers ( id, name, skill )
          )
        `
        )
        .in("id", orderIds)
        .in("status", ["pending", "in_progress", "on_hold"])
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!profileId && !!orgId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

export default function TasksPage() {
  const supabase = createClient()
  const qc       = useQueryClient()

  const { data: profile, isLoading: profileLoading } = useProfile()
  const orgId = useOrgId();

  const { data: tasks, isLoading: tasksLoading } = useTasks(
    profile?.id,
    profile?.role,
    orgId
  );

  const [startingId,    setStartingId]    = useState<string | null>(null)
  const [completingId,  setCompletingId]  = useState<string | null>(null)

  if (profileLoading) return <PageLoader />

  const isWorkerOrProduction = profile?.role === 'production'
  const isAdminOrManager     = profile?.role === 'admin' || profile?.role === 'manager'

  // ── Start production — consumes reserved raw materials ────
  async function handleStart(orderId: string, poNumber: string) {
    setStartingId(orderId)
    try {
      // Get active reservations for this production order
      const { data: reservations, error: resErr } = await supabase
        .from('stock_reservations')
        .select('id, item_id, qty_reserved, qty_consumed')
        .eq('ref_type', 'production_order')
        .eq('ref_id', orderId)
        .eq('status', 'active')

      if (resErr) throw resErr

      if (!reservations || reservations.length === 0) {
        toast.error('No reserved materials found for this order')
        return
      }

      // Consume all reserved raw materials at once
      for (const reservation of reservations) {
        const qtyToConsume = reservation.qty_reserved - reservation.qty_consumed
        if (qtyToConsume <= 0) continue

        await consumeInventory({
          itemId:        reservation.item_id,
          qty:           qtyToConsume,
          reservationId: reservation.id,
          refId:         orderId,
          notes:         `Consumed on start — ${poNumber}`,
        })
      }

      // Update status to in_progress
      const { error } = await supabase
        .from('production_orders')
        .update({
          status:     'in_progress',
          start_date: new Date().toISOString().split('T')[0],
        })
        .eq('id', orderId)

      if (error) throw error

      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['stock-levels'] })
      toast.success(`${poNumber} started — materials consumed`)

    } catch (err: unknown) {
  toast.error(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setStartingId(null)
    }
  }

  // ── Complete production — adds finished goods to stock ────
  async function handleComplete(orderId: string, poNumber: string, items: any[]) {
    setCompletingId(orderId)
    try {
      // Produce finished goods into stock
      for (const item of items) {
        await produceInventory({
          itemId: item.item?.id,
          qty:    item.qty_required,
          refId:  orderId,
          notes:  `Completed — ${poNumber}`,
        })

        // Update qty_produced
        await supabase
          .from('production_order_items')
          .update({ qty_produced: item.qty_required })
          .eq('id', item.id)
      }

      // Mark completed
      const { error } = await supabase
        .from('production_orders')
        .update({
          status:         'completed',
          completed_date: new Date().toISOString().split('T')[0],
        })
        .eq('id', orderId)

      if (error) throw error

      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['production-orders'] })
      qc.invalidateQueries({ queryKey: ['stock-levels'] })
      toast.success(`${poNumber} completed — finished goods added to stock`)

    } catch (err: unknown) {
  toast.error(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setCompletingId(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="My Tasks"
        description={
          isAdminOrManager
            ? 'All active production orders'
            : 'Production orders assigned to you'
        }
      />

      {/* Role context banner */}
      {isWorkerOrProduction && (
        <div className="mb-6 flex items-start gap-3 bg-purple-50 border border-purple-200 rounded-xl px-5 py-3">
          <HardHat className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-purple-800">
            Showing production orders assigned to you.
            You can <strong>start</strong> and <strong>complete</strong> orders —
            but cannot create new production orders.
          </p>
        </div>
      )}

      {tasksLoading ? <TableLoader /> : (
        <>
          {(!tasks || tasks.length === 0) && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ClipboardList className="w-12 h-12 text-slate-200 mb-4" />
                <p className="text-slate-500 font-medium">No tasks assigned</p>
                <p className="text-slate-400 text-sm mt-1">
                  {isWorkerOrProduction
                    ? 'You have no active production orders assigned to you.'
                    : 'No pending or in-progress production orders.'
                  }
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {tasks?.map((task: any) => {
              const items       = task.production_order_items ?? []
              const assignments = task.production_assignments ?? []
              const isPending    = task.status === 'pending'
              const isInProgress = task.status === 'in_progress'
              const isOnHold     = task.status === 'on_hold'
              const isOverdue    = task.target_date &&
                new Date(task.target_date) < new Date()

              return (
                <Card
                  key={task.id}
                  className={isOverdue ? 'border-red-200' : ''}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className={`
                          w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                          ${isPending    ? 'bg-slate-100' : ''}
                          ${isInProgress ? 'bg-purple-100' : ''}
                          ${isOnHold     ? 'bg-amber-100' : ''}
                        `}>
                          <Factory className={`w-5 h-5
                            ${isPending    ? 'text-slate-500' : ''}
                            ${isInProgress ? 'text-purple-600' : ''}
                            ${isOnHold     ? 'text-amber-600' : ''}
                          `} />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 flex items-center gap-2">
                            <Link
                              href={`/production/${task.id}`}
                              className="hover:text-blue-600 font-mono"
                            >
                              {task.po_number}
                            </Link>
                            <ProductionStatusBadge status={task.status} />
                            {isOverdue && (
                              <Badge variant="danger">Overdue</Badge>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-3">
                            {task.target_date && (
                              <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500' : ''}`}>
                                <Calendar className="w-3 h-3" />
                                Target: {formatDate(task.target_date)}
                              </span>
                            )}
                            {assignments.length > 0 && (
                              <span className="flex items-center gap-1">
                                <HardHat className="w-3 h-3" />
                                {assignments.map((a: any) => a.worker?.name).join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Start — pending orders only */}
                        {isPending && (
                          <Button
                            size="sm"
                            loading={startingId === task.id}
                            onClick={() => handleStart(task.id, task.po_number)}
                            className="bg-purple-600 hover:bg-purple-700"
                          >
                            <Play className="w-4 h-4" />
                            Start
                          </Button>
                        )}

                        {/* Complete — in progress orders only */}
                        {isInProgress && (
                          <Button
                            size="sm"
                            loading={completingId === task.id}
                            onClick={() => handleComplete(task.id, task.po_number, items)}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Complete
                          </Button>
                        )}

                        {/* On hold indicator */}
                        {isOnHold && (
                          <span className="text-xs text-amber-600 font-medium bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                            On Hold
                          </span>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardBody className="pt-0">
                    {/* Items to produce */}
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                        Items to Produce
                      </p>
                      {items.map((item: any) => {
                        const pct = item.qty_required > 0
                          ? Math.round((item.qty_produced / item.qty_required) * 100)
                          : 0

                        return (
                          <div key={item.id} className="flex items-center gap-3">
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <div className="text-sm text-slate-700">
                                  <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mr-2">
                                    {item.item?.item_code}
                                  </span>
                                  {item.item?.name}
                                </div>
                                <div className="text-xs text-slate-500 tabular-nums">
                                  {formatQty(item.qty_produced, item.unit)} / {formatQty(item.qty_required, item.unit)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                                  <div
                                    className={`h-1.5 rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : 'bg-purple-500'}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-slate-400 tabular-nums w-8 text-right">
                                  {pct}%
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Pending start warning */}
                    {isPending && (
                      <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700">
                          Starting will automatically consume all reserved raw materials.
                          Make sure materials are physically ready.
                        </p>
                      </div>
                    )}

                    {task.notes && (
                      <p className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                        📝 {task.notes}
                      </p>
                    )}
                  </CardBody>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// Import the Factory icon which is missing from imports above
function Factory({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M17 18h1" />
      <path d="M12 18h1" />
      <path d="M7 18h1" />
    </svg>
  )
}