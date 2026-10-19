import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────
// PDF Generation Route
// GET /api/pdf?type=quotation&id=uuid
// GET /api/pdf?type=challan&id=uuid
// GET /api/pdf?type=grn&id=uuid
//
// Returns printable HTML — browser auto-triggers window.print()
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const id = searchParams.get('id')

  if (!type || !id) {
    return NextResponse.json({ error: 'type and id are required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(`
      org_id,
      organizations:org_id (
        name,
        address,
        city,
        state,
        pincode,
        phone,
        email,
        gst_number
      )
    `)
    .eq("id", user.id)
    .single()

  if (profileError || !profile?.org_id) {
    return NextResponse.json(
      { error: "User is not associated with an organization" },
      { status: 403 }
    )
  }

  const org = profile.organizations as {
    name?: string
    address?: string
    city?: string
    state?: string
    pincode?: string
    phone?: string
    email?: string
    gst_number?: string
  } | null

  try {
    switch (type) {
      case 'quotation':
        return generateQuotationHTML(supabase, id, org)

      case 'challan':
        return generateChallanHTML(supabase, id, org)

      case 'grn':
        return generateGrnHTML(supabase, id, org)

      default:
        return NextResponse.json({ error: 'Unknown document type' }, { status: 400 })
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

// ── Shared print CSS ──────────────────────────────────────────

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; }
  .page { max-width: 210mm; margin: 0 auto; padding: 16mm 20mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #1E3A5F; padding-bottom: 16px; }
  .company-name { font-size: 20px; font-weight: bold; color: #1E3A5F; }
  .company-sub  { font-size: 10px; color: #666; margin-top: 2px; }
  .doc-title    { font-size: 18px; font-weight: bold; color: #2563EB; text-align: right; }
  .doc-no       { font-size: 13px; font-family: monospace; color: #111; text-align: right; margin-top: 4px; }
  .meta-grid    { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  .meta-box     { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 12px; }
  .meta-label   { font-size: 9px; font-weight: bold; color: #64748B; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
  .meta-value   { font-size: 11px; color: #111; line-height: 1.7; }
  table         { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead th      { background: #1E3A5F; color: #fff; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; text-align: left; }
  thead th.r    { text-align: right; }
  thead th.c    { text-align: center; }
  tbody td      { padding: 8px 10px; border-bottom: 1px solid #F1F5F9; font-size: 11px; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #F8FAFC; }
  .r            { text-align: right; }
  .c            { text-align: center; }
  .mono         { font-family: monospace; font-size: 10px; background: #F1F5F9; padding: 1px 5px; border-radius: 3px; }
  .totals       { margin-left: auto; width: 250px; border: 1px solid #E2E8F0; border-radius: 6px; overflow: hidden; }
  .totals-row   { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 11px; border-bottom: 1px solid #F1F5F9; }
  .totals-row.bold { font-weight: bold; font-size: 13px; background: #EFF6FF; color: #1D4ED8; border-bottom: none; }
  .terms        { margin-top: 18px; padding-top: 14px; border-top: 1px solid #E2E8F0; font-size: 10px; color: #555; line-height: 1.7; }
  .footer       { margin-top: 32px; display: flex; justify-content: space-between; padding-top: 16px; border-top: 1px solid #E2E8F0; }
  .sign-box     { text-align: center; }
  .sign-line    { width: 150px; border-bottom: 1px solid #333; margin-bottom: 5px; height: 40px; }
  .sign-label   { font-size: 10px; color: #666; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 8mm 12mm; }
    @page { size: A4; margin: 8mm; }
  }
`

const inr = (n: number | null | undefined) =>
  n != null
    ? new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR'
      }).format(n)
    : '—'

const dt = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    : '—'

type Organization = {
  name?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  phone?: string
  email?: string
  gst_number?: string
}

// ── Organization Header ───────────────────────────────────────

function organizationHeader(org: Organization | null) {
  const address = [
    org?.address,
    org?.city,
    org?.state,
    org?.pincode
  ].filter(Boolean).join(', ')

  const contact = [
    org?.phone,
    org?.email
  ].filter(Boolean).join(' | ')

  return `
    <div class="company-name">${org?.name ?? 'Blue Box ERP'}</div>
    ${address ? `<div class="company-sub">${address}</div>` : ''}
    ${contact ? `<div class="company-sub">${contact}</div>` : ''}
    ${org?.gst_number ? `<div class="company-sub">GST: ${org.gst_number}</div>` : ''}
  `
}

// ── Quotation ─────────────────────────────────────────────────

async function generateQuotationHTML(
  supabase: any,
  id: string,
  org: Organization | null
) {
  const { data: qt, error } = await supabase
    .from('quotations')
    .select(`
      *,
      client:clients ( name, phone, gst_number, address, city ),
      quotation_lines (
        *,
        item:items (
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

  if (error || !qt) throw new Error('Quotation not found')

  const lines = (qt.quotation_lines ?? [])
    .sort((a: any, b: any) => a.sort_order - b.sort_order)

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${qt.quotation_no}</title><style>${CSS}</style></head>
<body><div class="page">

  <div class="header">
    <div>
      ${organizationHeader(org)}
    </div>

    <div>
      <div class="doc-title">QUOTATION</div>
      <div class="doc-no">${qt.quotation_no}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <div class="meta-label">Bill To</div>
      <div class="meta-value">
        <strong>${qt.client?.name ?? '—'}</strong><br>
        ${qt.client?.phone ? qt.client.phone + '<br>' : ''}
        ${qt.client?.gst_number ? 'GST: ' + qt.client.gst_number + '<br>' : ''}
        ${qt.client?.address ? qt.client.address + ', ' + (qt.client.city ?? '') : ''}
      </div>
    </div>

    <div class="meta-box">
      <div class="meta-label">Quotation Details</div>
      <div class="meta-value">
        <strong>Date:</strong> ${dt(qt.quotation_date)}<br>
        ${qt.valid_until ? '<strong>Valid Until:</strong> ' + dt(qt.valid_until) + '<br>' : ''}
        ${qt.delivery_days ? '<strong>Delivery:</strong> ' + qt.delivery_days + ' working days<br>' : ''}
        ${qt.payment_terms ? '<strong>Payment:</strong> ' + qt.payment_terms : ''}
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th>Item Description</th>
        <th class="c" style="width:55px">HSN</th>
        <th class="r" style="width:70px">Qty</th>
        <th class="c" style="width:38px">Unit</th>
        <th class="r" style="width:90px">Rate (₹)</th>
        <th class="c" style="width:38px">GST%</th>
        <th class="r" style="width:95px">Amount (₹)</th>
      </tr>
    </thead>

    <tbody>
      ${lines.map((l: any, i: number) => {
        const sub = l.qty * l.unit_rate
        const gst = sub * Number(l.gst_percent) / 100

        return `<tr>
          <td class="c">${i + 1}</td>
          <td>
            <strong>${l.description || l.item?.name || ''}</strong>
            ${l.item ? '<br><span class="mono">' + l.item.item_code + '</span>' : ''}
          </td>
          <td class="c">${l.item?.hsn_code ?? '—'}</td>
          <td class="r">${l.qty}</td>
          <td class="c">${l.unit?.name ?? '—'}</td>
          <td class="r">${inr(l.unit_rate)}</td>
          <td class="c">${l.gst_percent}%</td>
          <td class="r">${inr(sub + gst)}</td>
        </tr>`
      }).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span>Subtotal</span>
      <span>${inr(qt.subtotal)}</span>
    </div>

    <div class="totals-row">
      <span>GST</span>
      <span>${inr(qt.gst_amount)}</span>
    </div>

    <div class="totals-row bold">
      <span>Total Amount</span>
      <span>${inr(qt.total_amount)}</span>
    </div>
  </div>

  ${qt.notes ? '<div class="terms"><strong>Notes:</strong> ' + qt.notes + '</div>' : ''}
  ${qt.transport_note ? '<div class="terms"><strong>Transport:</strong> ' + qt.transport_note + '</div>' : ''}

  <div class="terms">
    <strong>Terms &amp; Conditions:</strong>
    <ol style="margin-top:4px; padding-left:14px">
      <li>GST as applicable extra on all items</li>
      <li>Freight &amp; insurance extra at actuals unless stated otherwise</li>
      <li>${qt.payment_terms ?? '100% advance before delivery'}</li>
      <li>Validity: ${qt.valid_until ? 'till ' + dt(qt.valid_until) : '30 days from quotation date'}</li>
      <li>Prices subject to change after validity without prior notice</li>
    </ol>
  </div>

  <div class="footer">
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">Client Signature &amp; Stamp</div>
    </div>

    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">For ${org?.name ?? 'Blue Box ERP'}</div>
    </div>
  </div>

</div>

<script>window.onload = () => window.print()</script>
</body></html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}

// ── Delivery Challan ──────────────────────────────────────────

async function generateChallanHTML(
  supabase: any,
  id: string,
  org: Organization | null
) {
  const { data: dc, error } = await supabase
    .from('delivery_challans')
    .select(`
      *,
      client:clients ( name, phone, gst_number, address, city ),
      sales_order:sales_orders ( so_number ),
      delivery_challan_lines (
        *,
        item:items (
          item_code,
          name,
          unit_id,
          unit:units (
            id,
            name
          )
        )
      )
    `)
    .eq('id', id)
    .single()

  if (error || !dc) throw new Error('Challan not found')

  const lines = dc.delivery_challan_lines ?? []
  const totalQty = lines.reduce((s: number, l: any) => s + l.qty, 0)

  const transportLabel: Record<string, string> = {
    own_truck: 'Own Truck',
    client_truck: 'Client Truck',
    supplier_truck: 'Supplier Truck',
    courier: 'Courier',
    hand_delivery: 'Hand Delivery',
  }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${dc.challan_no}</title><style>${CSS}</style></head>
<body><div class="page">

  <div class="header">
    <div>
      ${organizationHeader(org)}
    </div>

    <div>
      <div class="doc-title">DELIVERY CHALLAN</div>
      <div class="doc-no">${dc.challan_no}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <div class="meta-label">Deliver To</div>
      <div class="meta-value">
        <strong>${dc.client?.name ?? '—'}</strong><br>
        ${dc.client?.phone ? dc.client.phone + '<br>' : ''}
        ${dc.client?.gst_number ? 'GST: ' + dc.client.gst_number + '<br>' : ''}
        ${dc.client?.address ? dc.client.address + ', ' + (dc.client.city ?? '') : ''}
      </div>
    </div>

    <div class="meta-box">
      <div class="meta-label">Dispatch Details</div>
      <div class="meta-value">
        <strong>Challan Date:</strong> ${dt(dc.challan_date)}<br>
        ${dc.sales_order ? '<strong>Against SO:</strong> ' + dc.sales_order.so_number + '<br>' : ''}
        <strong>Transport:</strong> ${transportLabel[dc.transport_mode] ?? dc.transport_mode}<br>
        ${dc.vehicle_no ? '<strong>Vehicle No.:</strong> ' + dc.vehicle_no + '<br>' : ''}
        ${dc.driver_name ? '<strong>Driver:</strong> ' + dc.driver_name + '<br>' : ''}
        <strong>Status:</strong> ${dc.status?.toUpperCase()}
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th>Item Description</th>
        <th class="c" style="width:60px">Code</th>
        <th class="r" style="width:70px">Qty</th>
        <th class="c" style="width:45px">Unit</th>
        <th class="r" style="width:95px">Rate (₹)</th>
        <th class="r" style="width:95px">Value (₹)</th>
      </tr>
    </thead>

    <tbody>
      ${lines.map((l: any, i: number) => `<tr>
        <td class="c">${i + 1}</td>
        <td><strong>${l.item?.name ?? '—'}</strong></td>
        <td class="c"><span class="mono">${l.item?.item_code ?? ''}</span></td>
        <td class="r"><strong>${l.qty}</strong></td>
        <td class="c">${l.unit?.name ?? '—'}</td>
        <td class="r">${l.rate ? inr(l.rate) : '—'}</td>
        <td class="r">${l.line_total ? inr(l.line_total) : '—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span>Total Qty</span>
      <span>${totalQty}</span>
    </div>

    <div class="totals-row bold">
      <span>Challan Value</span>
      <span>${inr(dc.total_amount)}</span>
    </div>
  </div>

  <div class="terms">
    <strong>Note:</strong> This is a delivery challan only. GST tax invoice will be raised separately.
    Goods once dispatched will not be accepted back without prior written approval.
    ${dc.notes ? '<br><strong>Notes:</strong> ' + dc.notes : ''}
  </div>

  <div class="footer">
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">Receiver's Signature &amp; Stamp</div>
    </div>

    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">For ${org?.name ?? 'Blue Box ERP'}</div>
    </div>
  </div>

</div>

<script>window.onload = () => window.print()</script>
</body></html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}

// ── GRN ───────────────────────────────────────────────────────

async function generateGrnHTML(
  supabase: any,
  id: string,
  org: Organization | null
) {
  const { data: grn, error } = await supabase
    .from('inbound_receipts')
    .select(`
      *,
      supplier:suppliers ( name, phone, gst_number, city ),
      inbound_receipt_lines (
        *,
        item:items (
          item_code,
          name,
          unit_id,
          unit:units (
            id,
            name
          )
        )
      )
    `)
    .eq('id', id)
    .single()

  if (error || !grn) throw new Error('GRN not found')

  const lines = grn.inbound_receipt_lines ?? []
  const grandTotal = (grn.total_amount ?? 0) + (grn.gst_amount ?? 0)

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${grn.receipt_no}</title><style>${CSS}</style></head>
<body><div class="page">

  <div class="header">
    <div>
      ${organizationHeader(org)}
    </div>

    <div>
      <div class="doc-title">GOODS RECEIVED NOTE</div>
      <div class="doc-no">${grn.receipt_no}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <div class="meta-label">Received From</div>
      <div class="meta-value">
        <strong>${grn.supplier?.name ?? '—'}</strong><br>
        ${grn.supplier?.phone ? grn.supplier.phone + '<br>' : ''}
        ${grn.supplier?.gst_number ? 'GST: ' + grn.supplier.gst_number + '<br>' : ''}
        ${grn.supplier?.city ?? ''}
      </div>
    </div>

    <div class="meta-box">
      <div class="meta-label">Receipt Details</div>
      <div class="meta-value">
        <strong>GRN No.:</strong> ${grn.receipt_no}<br>
        <strong>Date:</strong> ${dt(grn.receipt_date)}<br>
        <strong>Transport:</strong> ${grn.transport_mode?.replace('_', ' ') ?? '—'}<br>
        ${grn.vehicle_no ? '<strong>Vehicle:</strong> ' + grn.vehicle_no + '<br>' : ''}
        ${grn.challan_no ? '<strong>Sup. Challan:</strong> ' + grn.challan_no + '<br>' : ''}
        ${grn.invoice_no ? '<strong>Invoice No.:</strong> ' + grn.invoice_no : ''}
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th>Item</th>
        <th class="r" style="width:70px">Ordered</th>
        <th class="r" style="width:75px">Received</th>
        <th class="c" style="width:40px">Unit</th>
        <th class="r" style="width:90px">Rate (₹)</th>
        <th class="c" style="width:38px">GST%</th>
        <th class="r" style="width:95px">Amount (₹)</th>
      </tr>
    </thead>

    <tbody>
      ${lines.map((l: any, i: number) => `<tr>
        <td class="c">${i + 1}</td>
        <td>
          <strong>${l.item?.name ?? '—'}</strong>
          <br><span class="mono">${l.item?.item_code ?? ''}</span>
        </td>
        <td class="r">${l.qty_ordered ?? '—'}</td>
        <td class="r"><strong>${l.qty_received}</strong></td>
        <td class="c">${l.unit?.name ?? '—'}</td>
        <td class="r">${inr(l.rate)}</td>
        <td class="c">${l.gst_percent}%</td>
        <td class="r">${inr(l.line_total)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span>Subtotal</span>
      <span>${inr(grn.total_amount)}</span>
    </div>

    <div class="totals-row">
      <span>GST</span>
      <span>${inr(grn.gst_amount)}</span>
    </div>

    <div class="totals-row bold">
      <span>Total</span>
      <span>${inr(grandTotal)}</span>
    </div>
  </div>

  ${grn.notes ? '<div class="terms"><strong>Notes:</strong> ' + grn.notes + '</div>' : ''}

  <div class="footer">
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">Received By</div>
    </div>

    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">Store Keeper</div>
    </div>

    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">Authorised Signatory</div>
    </div>
  </div>

</div>

<script>window.onload = () => window.print()</script>
</body></html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}