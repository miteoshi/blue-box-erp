'use client'



import { useState, useEffect } from 'react'

import { useRouter } from 'next/navigation'

import { useQuery } from '@tanstack/react-query'

import { createClient } from '@/lib/supabase/client'

import { useOrgId } from '@/lib/hooks/use-tenant'

import { reserveInventory } from '@/lib/utils/inventory'

import { PageHeader } from '@/components/layout/page-header'

import { Button } from '@/components/ui/button'

import { Input } from '@/components/ui/input'

import { Card, CardBody, CardHeader } from '@/components/ui/card'

import { Badge } from '@/components/ui/badge'

import { formatQty } from '@/lib/utils/format'

import { toast } from 'sonner'

import { Trash2, Save, AlertTriangle, CheckCircle, Package } from 'lucide-react'



interface RawMaterialLine {

  item_id:       string

  item_name:     string

  item_code:     string

  unit:          string

  qty_per_unit:  number   // from BOM — per single finished unit

  qty_needed:    number   // qty_per_unit × finishQty — total needed

  qty_available: number

  sufficient:    boolean

  source:        'bom' | 'manual'

}



interface FinishedItem {
  item_id: string;

  item_name: string;

  item_code: string;

  unit_id: string;

  unit: string;
}



function useManufacturedItems(orgId: string | null) {

  const supabase = createClient();



  return useQuery({

    queryKey: ["manufactured-items", orgId],

    queryFn: async () => {

      if (!orgId) return [];



      const { data, error } = await supabase

        .from("items")

        .select(

          `

          id,

          item_code,

          name,

          unit_id,

          category_id,

          unit:units (

            id,

            name

          )

        `

        )

        .eq("is_manufactured", true)

        .eq("is_active", true)

        .order("name");



      if (error) throw error;

      return data ?? [];

    },

    enabled: !!orgId,

    staleTime: 5 * 60 * 1000,

  });

}



function useRawMaterialItems(orgId: string | null) {

  const supabase = createClient();



  return useQuery({

    queryKey: ["raw-material-items", orgId],

    queryFn: async () => {

      if (!orgId) return [];



      const { data, error } = await supabase

        .from("items")

        .select(

                  `

          id,

          item_code,

          name,

          unit_id,

          category_id,

          unit:units (

            id,

            name

          )

        `

        )

        .eq("is_raw_material", true)

        .eq("is_active", true)

        .order("name");



      if (error) throw error;

      return data ?? [];

    },

    enabled: !!orgId,

    staleTime: 5 * 60 * 1000,

  });

}



export default function NewProductionPage() {

  const router   = useRouter()

  const supabase = createClient()

  const orgId    = useOrgId()



const { data: mfgItems } = useManufacturedItems(orgId);

const { data: rawItems } = useRawMaterialItems(orgId);



  const [finishedItem, setFinishedItem] = useState<FinishedItem | null>(null)

  const [finishQty,    setFinishQty]    = useState<number>(1)

  const [targetDate,   setTargetDate]   = useState('')

  const [notes,        setNotes]        = useState('')



  const [rawMaterials, setRawMaterials] = useState<RawMaterialLine[]>([])

  const [loadingBom,   setLoadingBom]   = useState(false)

  const [bomExists,    setBomExists]    = useState<boolean | null>(null)

  const [saving,       setSaving]       = useState(false)



  const canCreate    = rawMaterials.length > 0 && rawMaterials.every(r => r.sufficient)

  const hasShortage  = rawMaterials.some(r => !r.sufficient)



  // ── Re-fetch BOM when item changes ───────────────────────

  useEffect(() => {

    if (!finishedItem || finishQty <= 0) return

    fetchBomAndStock(finishedItem.item_id, finishQty)

  }, [finishedItem?.item_id])



  // ── Re-multiply ALL lines when finishQty changes ─────────

  // Both BOM and manual lines store qty_per_unit.

  // qty_needed is always qty_per_unit × finishQty.

  useEffect(() => {

    if (rawMaterials.length === 0 || finishQty <= 0) return



    setRawMaterials(prev => prev.map(r => {

      const qtyNeeded = r.qty_per_unit * finishQty

      return {

        ...r,

        qty_needed: qtyNeeded,

        sufficient: r.qty_available >= qtyNeeded,

      }

    }))

  }, [finishQty])



  async function fetchBomAndStock(itemId: string, qty: number) {

    setLoadingBom(true)

    setBomExists(null)

    setRawMaterials([])



    try {

      const { data: bom, error: bomErr } = await supabase

        .from("bom")

        .select(
          `

            id,

            qty_per_unit,

            unit_id,

            notes,

            is_active,



            unit:units (

              id,

              name

            ),


          component:items!bom_org_component_fk (
            id,
            item_code,
            name,
            unit_id
          )

          `
        )

        .eq("finished_item_id", itemId)

        .eq("is_active", true);



      if (bomErr) throw bomErr



      if (!bom || bom.length === 0) {

        setBomExists(false)

        setLoadingBom(false)

        return

      }



      setBomExists(true)



      const componentIds = bom.map(b => (b.component as any).id)



      const { data: stock } = await supabase

        .from('inventory_balance')

        .select('item_id, available_qty')

        .in('item_id', componentIds)



      const stockMap = new Map(stock?.map(s => [s.item_id, s.available_qty ?? 0]) ?? [])



      // ── KEY FIX: store qty_per_unit separately so qty changes

      //    can re-multiply without a round trip to Supabase ────

      const lines: RawMaterialLine[] = bom.map(b => { 

        const component    = b.component as any

        const qtyPerUnit   = b.qty_per_unit               // e.g. 2 screws per unit

        const qtyNeeded    = qtyPerUnit * qty              // e.g. 2 × 5 = 10 screws

        const qtyAvailable = stockMap.get(component.id) ?? 0



        return {

          item_id:       component.id,

          item_name:     component.name,

          item_code:     component.item_code,

          unit:          b.unit?.name ?? "",

          qty_per_unit:  qtyPerUnit,

          qty_needed:    qtyNeeded,

          qty_available: qtyAvailable,

          sufficient:    qtyAvailable >= qtyNeeded,

          source:        'bom' as const,

        }

      })



      setRawMaterials(lines)

    } catch (err: any) {

      toast.error(`BOM fetch failed: ${err.message}`)

    } finally {

      setLoadingBom(false)

    }

  }



  async function addManualLine(itemId: string) {

    const item = rawItems?.find(i => i.id === itemId)

    if (!item) return

    if (rawMaterials.find(r => r.item_id === itemId)) {

      toast.error('Item already added')

      return

    }

    const { data: stock } = await supabase

      .from('inventory_balance')

      .select('available_qty')

      .eq('item_id', itemId)

      .single()



    const qtyAvailable = stock?.available_qty ?? 0



    setRawMaterials(prev => [...prev, {

      item_id:       item.id,

      item_name:     item.name,

      item_code:     item.item_code,

      unit:          item.unit?.name ?? '',

      qty_per_unit:  0,   // user will type this — "how many per finished unit"

      qty_needed:    0,   // computed: qty_per_unit × finishQty

      qty_available: qtyAvailable,

      sufficient:    false,

      source:        'manual',

    }])

  }



  // User types how many of this raw material per finished unit

  // qty_needed = qty_per_unit × finishQty

  function updateManualQty(itemId: string, qtyPerUnit: number) {

    setRawMaterials(prev => prev.map(r => {

      if (r.item_id !== itemId) return r

      const qtyNeeded = qtyPerUnit * finishQty

      return {

        ...r,

        qty_per_unit: qtyPerUnit,

        qty_needed:   qtyNeeded,

        sufficient:   r.qty_available >= qtyNeeded,

      }

    }))

  }



  function removeManualLine(itemId: string) {

    setRawMaterials(prev => prev.filter(r => r.item_id !== itemId))

  }



  async function handleCreate() {

    if (!finishedItem)             { toast.error('Select a finished item');                  return }

    if (finishQty <= 0)            { toast.error('Quantity must be greater than 0');         return }

    if (rawMaterials.length === 0) { toast.error('Add raw materials');                       return }

    if (hasShortage)               { toast.error('Insufficient stock for some materials');   return }



    if (!orgId) {

      toast.error("Organization not loaded");

      return;

    }

    setSaving(true)

    try {

      const { data: { user } } = await supabase.auth.getUser()

      const { data: prdNo, error: rpcErr } = await supabase.rpc('next_prd_no', {

        p_org_id: orgId,

      })

      if (rpcErr) throw rpcErr



      const { data: prd, error: prdErr } = await supabase

        .from('production_orders')

        .insert({

          org_id:      orgId,

          po_number:   prdNo as string,

          so_id:       null,

          status:      'pending',

          target_date: targetDate || null,

          notes:       notes      || null,

          created_by:  user?.id   ?? null,

        })

        .select('id, po_number')

        .single()



      if (prdErr) throw prdErr



      const { error: itemsErr } = await supabase

        .from("production_order_items")

        .insert({
          production_order_id: prd.id,
          item_id: finishedItem.item_id,
          qty_required: finishQty,
          unit_id: finishedItem.unit_id,
        });



      if (itemsErr) throw itemsErr



      // ── Reserve raw materials ─────────────────────────────

      // qty_needed is already qty_per_unit × finishQty at this point

      for (const raw of rawMaterials) {

        await reserveInventory({

          itemId:      raw.item_id,

          qty:         raw.qty_needed,   // correctly scaled to finishQty

          refType:     'production_order',

          refId:       prd.id,

          expiryHours: 168,

          notes:       `Reserved for ${prd.po_number} — producing ${finishQty}× ${finishedItem.item_name}`,

        })

      }



      toast.success(`${prd.po_number} created — ${finishQty} units planned, materials reserved`)

      router.push(`/production/${prd.id}`)



    } catch (err: unknown) {

  toast.error(err instanceof Error ? err.message : 'Failed to create production order')

    } finally {

      setSaving(false)

    }

  }



  return (

    <div>

      <PageHeader

        title="New Production Order"

        description="Only manufactured items can be produced"

      >

        <Button variant="outline" size="sm" onClick={() => router.back()}>Cancel</Button>

        <Button

          size="sm"

          loading={saving}

          disabled={!canCreate}

          onClick={handleCreate}

          className={canCreate ? 'bg-purple-600 hover:bg-purple-700' : ''}

        >

          <Save className="w-4 h-4" />

          Create & Reserve Materials

        </Button>

      </PageHeader>



      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">



        {/* ── Left: Finished item + details ── */}

        <div className="space-y-4">

          <Card>

            <CardHeader>

              <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">

                <Package className="w-4 h-4 text-purple-600" />

                What to Produce

              </h3>

            </CardHeader>

            <CardBody className="space-y-4">

              <div>

                <label className="block text-sm font-medium text-slate-700 mb-1.5">

                  Finished Item <span className="text-red-500">*</span>

                </label>

                <select

                  value={finishedItem?.item_id ?? ''}

                  onChange={e => {

                    const item = mfgItems?.find(i => i.id === e.target.value)

                    if (!item) {
                      setFinishedItem(null);
                      setRawMaterials([]);
                      setBomExists(null);
                      return;
                    }

                    if (!item.unit_id) {
                      toast.error("Selected item has no unit");
                      return;
                    }

                    setFinishedItem({
                      item_id: item.id,
                      item_name: item.name,
                      item_code: item.item_code,
                      unit_id: item.unit_id,
                      unit: item.unit?.name ?? "",
                    });

                  }
                }

                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"

                >

                  <option value="">Select manufactured item…</option>

                  {mfgItems?.map(item => (

                    <option key={item.id} value={item.id}>

                      [{item.item_code}] {item.name}

                    </option>

                  ))}

                </select>

                <p className="text-xs text-slate-400 mt-1">Only items marked as "Manufactured" appear here</p>

              </div>



              <div>

                <label className="block text-sm font-medium text-slate-700 mb-1.5">

                  Quantity to Produce <span className="text-red-500">*</span>

                </label>

                <input

                  type="number"

                  min="1"

                  step="any"

                  value={finishQty}

                  onChange={e => setFinishQty(Math.max(1, Number(e.target.value)))}

                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500"

                />

                {finishedItem && (

                  <p className="text-xs text-slate-400 mt-1">

                    Unit: {finishedItem.unit}

                    {bomExists === true && rawMaterials.length > 0 && (

                      <span className="ml-1 text-purple-600">

                        — materials auto-scaled to ×{finishQty}

                      </span>

                    )}

                  </p>

                )}

              </div>



              <Input

                label="Target Completion Date"

                type="date"

                value={targetDate}

                onChange={e => setTargetDate(e.target.value)}

              />



              <div>

                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>

                <textarea

                  rows={3}

                  value={notes}

                  onChange={e => setNotes(e.target.value)}

                  placeholder="Any special instructions…"

                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"

                />

              </div>

            </CardBody>

          </Card>



          {/* Stock summary */}

          {rawMaterials.length > 0 && (

            <Card className={hasShortage ? 'border-red-200' : 'border-green-200'}>

              <CardBody className="space-y-2">

                <div className="flex items-center gap-2">

                  {hasShortage ? (

                    <>

                      <AlertTriangle className="w-4 h-4 text-red-500" />

                      <span className="text-sm font-semibold text-red-700">Insufficient Materials</span>

                    </>

                  ) : (

                    <>

                      <CheckCircle className="w-4 h-4 text-green-600" />

                      <span className="text-sm font-semibold text-green-700">All Materials Available</span>

                    </>

                  )}

                </div>

                <p className="text-xs text-slate-500">

                  {hasShortage

                    ? 'Resolve shortages before creating this production order.'

                    : `Creating this order will reserve all listed materials for ${finishQty}× ${finishedItem?.item_name}.`

                  }

                </p>

              </CardBody>

            </Card>

          )}

        </div>



        {/* ── Right: Raw materials ── */}

        <div className="lg:col-span-2">

          <Card>

            <CardHeader>

              <div className="flex items-center justify-between">

                <h3 className="font-semibold text-slate-900 text-sm">

                  Raw Materials Required

                  {bomExists === true  && <Badge variant="success"  className="ml-2">From BOM</Badge>}

                  {bomExists === false && <Badge variant="warning"  className="ml-2">No BOM — Manual Input</Badge>}

                </h3>

                {/* Show qty context always when an item is selected */}

                {finishedItem && (

                  <span className="text-xs text-slate-400">

                    Quantities for <span className="font-semibold text-purple-600">{finishQty} {finishedItem.unit}</span>

                  </span>

                )}

              </div>

            </CardHeader>



            <CardBody className="p-0">

              {!finishedItem && (

                <div className="px-5 py-10 text-center text-slate-400 text-sm">

                  Select a finished item to see required materials

                </div>

              )}



              {finishedItem && loadingBom && (

                <div className="px-5 py-10 text-center text-slate-400 text-sm">

                  Checking BOM and stock levels…

                </div>

              )}



              {finishedItem && !loadingBom && rawMaterials.length > 0 && (

                <div className="overflow-x-auto">

                  <table className="w-full text-sm">

                    <thead>

                      <tr className="bg-slate-50 border-b border-slate-100">

                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Component</th>

                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Per Unit</th>

                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Total (×{finishQty})</th>

                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Available</th>

                        <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Status</th>

                        {bomExists === false && <th className="w-8"></th>}

                      </tr>

                    </thead>

                    <tbody className="divide-y divide-slate-50">

                      {rawMaterials.map(raw => (

                        <tr

                          key={raw.item_id}

                          className={raw.sufficient ? 'hover:bg-slate-50' : 'bg-red-50/40'}

                        >

                          <td className="px-4 py-3">

                            <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mr-2">

                              {raw.item_code}

                            </span>

                            <span className="font-medium text-slate-900">{raw.item_name}</span>

                          </td>



                          {/* Per-unit column — editable for manual, read-only for BOM */}

                          <td className="px-4 py-3 text-right tabular-nums">

                            {raw.source === 'manual' ? (

                              <input

                                type="number"

                                min="0.0001"

                                step="any"

                                value={raw.qty_per_unit || ''}

                                placeholder="per unit"

                                onChange={e => updateManualQty(raw.item_id, Number(e.target.value))}

                                className="w-24 px-2 py-1 text-xs rounded border border-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-purple-500"

                              />

                            ) : (

                              <span className="text-slate-400 text-xs">

                                {formatQty(raw.qty_per_unit, raw.unit)}

                              </span>

                            )}

                          </td>



                          {/* Total needed = qty_per_unit × finishQty — always computed, never editable */}

                          <td className="px-4 py-3 text-right tabular-nums">

                            <span className="font-semibold text-slate-900">

                              {raw.qty_needed > 0 ? formatQty(raw.qty_needed, raw.unit) : <span className="text-slate-300">—</span>}

                            </span>

                          </td>



                          <td className="px-4 py-3 text-right tabular-nums">

                            <span className={raw.sufficient ? 'text-green-600 font-medium' : 'text-red-600 font-bold'}>

                              {formatQty(raw.qty_available, raw.unit)}

                            </span>

                          </td>

                          <td className="px-4 py-3 text-center">

                            {raw.sufficient ? (

                              <Badge variant="success">OK</Badge>

                            ) : (

                              <Badge variant="danger">

                                Short {formatQty(raw.qty_needed - raw.qty_available, raw.unit)}

                              </Badge>

                            )}

                          </td>

                          {bomExists === false && (

                            <td className="px-2 py-3">

                              <button

                                onClick={() => removeManualLine(raw.item_id)}

                                className="text-slate-300 hover:text-red-500 transition-colors"

                              >

                                <Trash2 className="w-3.5 h-3.5" />

                              </button>

                            </td>

                          )}

                        </tr>

                      ))}

                    </tbody>

                  </table>

                </div>

              )}



              {/* No BOM — manual add */}

              {finishedItem && !loadingBom && bomExists === false && (

                <div className="px-5 py-4 border-t border-slate-100">

                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">

                    No BOM found for this item. Add raw materials manually below,

                    or first add a BOM in the Items page.

                  </p>

                  <select

                    defaultValue=""

                    onChange={e => { if (e.target.value) addManualLine(e.target.value); e.target.value = '' }}

                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"

                  >

                    <option value="">Add raw material…</option>

                    {rawItems?.map(item => (

                      <option key={item.id} value={item.id}>

                        [{item.item_code}] {item.name} ({item.unit?.name})

                      </option>

                    ))}

                  </select>

                </div>

              )}



              {finishedItem && !loadingBom && bomExists === true && rawMaterials.length === 0 && (

                <div className="px-5 py-10 text-center text-slate-400 text-sm">

                  BOM found but no active components. Check the BOM setup for this item.

                </div>

              )}

            </CardBody>

          </Card>

        </div>

      </div>

    </div>

  )

}