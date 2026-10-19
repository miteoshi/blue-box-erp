'use client'

import { useState } from 'react'
import { useOrgId } from "@/lib/hooks/use-tenant";
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import {
  useProductionOrder,
  useAssignWorker,
} from '@/lib/hooks/use-production'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, ProductionStatusBadge } from '@/components/ui/badge'
import { PageLoader } from '@/components/ui/spinner'
import { formatDate, formatQty } from '@/lib/utils/format'
import { toast } from 'sonner'
import { ArrowLeft, Users, Package, Plus, Info } from 'lucide-react'

function useWorkers(orgId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: ["workers", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("workers")
        .select("id, name, skill")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}

export default function ProductionDetailPage() {
const { id } = useParams<{ id: string }>();
const router = useRouter();
const orgId = useOrgId();

const { data: order, isLoading } = useProductionOrder(id);
const { mutate: assignWorker, isPending: assigningWorker } = useAssignWorker();
const { data: workers = [] } = useWorkers(orgId);
  const [selectedWorker, setSelectedWorker] = useState('')

  if (isLoading) return <PageLoader />
  if (!order)    return <div className="text-slate-500 text-sm p-6">Production order not found</div>

  const items       = (order.production_order_items as any[]) ?? []
  const assignments = (order.production_assignments as any[]) ?? []
  const creator     = order.creator as any

  const isPending    = order.status === 'pending'
  const isInProgress = order.status === 'in_progress'
  const isCompleted  = order.status === 'completed'
  // Workers can be assigned as long as order isn't completed
  const canAssign    = isPending || isInProgress

  const assignedWorkerIds = assignments.map((a: any) => a.worker?.id)

  return (
    <div>
      <PageHeader
        title={order.po_number}
        description="Production Order — View Only"
      >
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        {/* ── No Start / Hold / Resume / Complete buttons here ──
            All status transitions happen from My Tasks page only  */}
      </PageHeader>

      {/* Info banner — tells user where to act */}
      {!isCompleted && (
        <div className="mb-6 flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-5 py-3">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-800">
            To start, pause, or complete this production order, go to{" "}
            <a
              href="/tasks"
              className="font-semibold underline underline-offset-2"
            >
              My Tasks
            </a>
            . This page is for viewing order details only.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: Details + Workers ── */}
        <div className="space-y-4">
          {/* Status card */}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Status</span>
                <ProductionStatusBadge status={order.status} />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">PRD Number</span>
                <span className="font-mono font-bold text-slate-900">
                  {order.po_number}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Type</span>
                <Badge variant="purple">Standalone</Badge>
              </div>
              {order.start_date && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Started</span>
                  <span className="text-slate-700">
                    {formatDate(order.start_date)}
                  </span>
                </div>
              )}
              {order.target_date && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Target</span>
                  <span
                    className={
                      !isCompleted && new Date(order.target_date) < new Date()
                        ? "text-red-500 font-medium"
                        : "text-slate-700"
                    }
                  >
                    {formatDate(order.target_date)}
                  </span>
                </div>
              )}
              {order.completed_date && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Completed</span>
                  <span className="text-green-600 font-medium">
                    {formatDate(order.completed_date)}
                  </span>
                </div>
              )}
              {creator && (
                <div className="flex justify-between text-sm pt-2 border-t border-slate-100">
                  <span className="text-slate-500">Created By</span>
                  <span className="text-slate-700">{creator.full_name}</span>
                </div>
              )}
              {order.notes && (
                <div className="pt-2 border-t border-slate-100">
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                    Notes
                  </p>
                  <p className="text-sm text-slate-700">{order.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Workers — assign still allowed from detail view */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-600" />
                Assigned Workers
                <Badge variant="purple">{assignments.length}</Badge>
              </h3>
            </CardHeader>
            <CardBody className="space-y-3">
              {assignments.length === 0 && (
                <p className="text-xs text-slate-400">
                  No workers assigned yet
                </p>
              )}
              {assignments.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {a.worker?.name}
                    </div>
                    <div className="text-xs text-slate-400">
                      {a.worker?.skill}
                    </div>
                  </div>
                  {a.hours_worked && (
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      {a.hours_worked}h
                    </span>
                  )}
                </div>
              ))}

              {canAssign && (
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <select
                    value={selectedWorker}
                    onChange={(e) => setSelectedWorker(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  >
                    <option value="">Select worker…</option>
                    {workers
                      .filter((w) => !assignedWorkerIds.includes(w.id))
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} — {w.skill}
                        </option>
                      ))}
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={assigningWorker}
                    onClick={() => {
                      if (!selectedWorker) {
                        toast.error("Select a worker");
                        return;
                      }
                      assignWorker(
                        { productionOrderId: id, workerId: selectedWorker },
                        { onSuccess: () => setSelectedWorker("") }
                      );
                    }}
                    className="w-full text-purple-700 bg-purple-50 hover:bg-purple-100"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Assign Worker
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ── Right: Items + reserved materials ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Finished items */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-purple-600" />
                Items to Produce
              </h3>
            </CardHeader>
            <div className="divide-y divide-slate-50">
              {items.map((item: any) => {
                const pct =
                  item.qty_required > 0
                    ? Math.min(
                        100,
                        Math.round(
                          (item.qty_produced / item.qty_required) * 100
                        )
                      )
                    : 0;
                const isDone = pct >= 100;

                return (
                  <div key={item.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div>
                        <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mr-2">
                          {item.item?.item_code}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {item.item?.name}
                        </span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div
                          className={`font-bold text-sm ${
                            isDone ? "text-green-600" : "text-slate-900"
                          }`}
                        > 
                          {formatQty(item.qty_produced, item.unit?.name)} /{" "}
                          {formatQty(item.qty_required, item.unit?.name)}
                        </div>
                        {isDone && (
                          <div className="text-xs text-green-600">
                            Complete ✓
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            isDone ? "bg-green-500" : "bg-purple-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 tabular-nums w-10 text-right">
                        {pct}%
                      </span>
                    </div>
                    {isCompleted && isDone && (
                      <p className="text-xs text-green-600 mt-2">
                        ✓ Added to stock on {formatDate(order.completed_date)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Reserved raw materials */}
          <ReservedMaterialsCard
            productionOrderId={id}
            orgId={orgId}
            isPending={isPending}
            isInProgress={isInProgress}
          />
        </div>
      </div>
    </div>
  );
}

// ── Reserved materials sub-component (view only) ─────────────
function ReservedMaterialsCard({
  productionOrderId,
  orgId,
  isPending,
  isInProgress,
}: {
  productionOrderId: string;
  orgId: string | null;
  isPending: boolean;
  isInProgress: boolean;
}) {
  const supabase = createClient();

  const { data: reservations } = useQuery({
    queryKey: ["production-reservations", orgId, productionOrderId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("stock_reservations")
        .select(
          `
          id, qty_reserved, qty_consumed, qty_released, status,
          item:items (
            id,
            item_code,
            name,
            unit_id,
            unit:units (
              id,
              name
            )
          )
        `
        )
        .eq("ref_type", "production_order")
        .eq("ref_id", productionOrderId)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId && !!productionOrderId,
    staleTime: 30 * 1000,
  });

  if (!reservations || reservations.length === 0) return null;

  const statusColors: Record<string, any> = {
    active: "warning",
    consumed: "success",
    partially_consumed: "info",
    released: "default",
    expired: "danger",
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Package className="w-4 h-4 text-amber-600" />
          Reserved Raw Materials
          {isPending && (
            <span className="text-xs font-normal text-slate-400">
              — will be consumed when production is started via My Tasks
            </span>
          )}
          {isInProgress && (
            <span className="text-xs font-normal text-green-600">
              — consumed when production started
            </span>
          )}
        </h3>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                Material
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                Reserved
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                Consumed
              </th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {reservations.map((r: any) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mr-2">
                    {r.item?.item_code}
                  </span>
                  <span className="font-medium text-slate-900">
                    {r.item?.name}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                  {formatQty(r.qty_reserved, r.item?.unit?.name)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span
                    className={
                      r.qty_consumed > 0
                        ? "text-green-600 font-medium"
                        : "text-slate-400"
                    }
                  >
                    {formatQty(r.qty_consumed, r.item?.unit?.name)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Badge variant={statusColors[r.status] ?? "default"}>
                    {r.status.replace("_", " ")}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}