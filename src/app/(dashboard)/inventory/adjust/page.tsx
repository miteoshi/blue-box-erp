'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useItems } from '@/lib/hooks/use-items'
import { adjustInventory } from '@/lib/utils/inventory'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { toast } from 'sonner'
import { Save, AlertTriangle } from 'lucide-react'
import { useOrgId } from "@/lib/hooks/use-tenant";

export default function AdjustInventoryPage() {
const router = useRouter();
const orgId = useOrgId();
const { data: items, isLoading: itemsLoading } = useItems();

  const [itemId, setItemId] = useState('')
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [refId, setRefId] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!itemId) { toast.error('Please select an item'); return }
    if (!delta || Number(delta) === 0) { toast.error('Delta cannot be zero'); return }
    if (!reason.trim()) { toast.error('A reason is required for manual adjustments'); return }

    if (!orgId) {
      toast.error("Organization not loaded");
      return;
    }

    setSaving(true)
    try {
      await adjustInventory({
        itemId,
        delta: Number(delta),
        reason: reason.trim(),
        refId: refId.trim() || undefined,
      })

      toast.success('Stock adjusted successfully')
      router.push('/inventory')
    } catch (err: unknown) {
        toast.error(
          `Adjustment failed: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      } finally {
      setSaving(false)
    }
  }

  const selectedItem = items?.find(i => i.id === itemId)

  return (
    <div>
      <PageHeader
        title="Manual Stock Adjustment"
        description="Add or remove stock for physical reconciliation or write-offs"
      >
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button size="sm" loading={saving} onClick={handleSave}>
          <Save className="w-4 h-4" />
          Save Adjustment
        </Button>
      </PageHeader>

      <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800 space-y-1">
          <p>
            <strong>Warning:</strong> Manual adjustments bypass the standard
            sales/production workflow.
          </p>
          <p>
            Use a <strong>positive</strong> number to add stock (e.g., found
            extra items during stocktake).
            <br />
            Use a <strong>negative</strong> number to remove stock (e.g.,
            damaged goods, write-offs).
          </p>
        </div>
      </div>

      <div className="max-w-2xl">
        <Card>
          <CardHeader>
            <h3 className="font-semibold text-slate-900 text-sm">
              Adjustment Details
            </h3>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Item <span className="text-red-500">*</span>
              </label>
              <select
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                disabled={itemsLoading}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="">Select item…</option>
                {items?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.item_code} — {item.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedItem && (
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <p className="font-semibold text-slate-900">
                  {selectedItem.name}
                </p>
                <p className="text-slate-500 text-xs mt-0.5">Unit: —</p>
              </div>
            )}

            <Input
              label="Adjustment Quantity (Delta)"
              type="number"
              step="any"
              placeholder="e.g. 5 or -2"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              required
            />

            <Textarea
              label="Reason for Adjustment"
              placeholder="Explain why this adjustment is necessary…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={3}
            />

            <Input
              label="Reference Document ID (Optional)"
              placeholder="UUID of a related document if any"
              value={refId}
              onChange={(e) => setRefId(e.target.value)}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
