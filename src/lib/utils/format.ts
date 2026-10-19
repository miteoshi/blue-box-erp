import { format, formatDistanceToNow, parseISO } from 'date-fns'

// ── Currency ──────────────────────────────────────────────────
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

// Short version: ₹1,23,456 (no decimals for large amounts)
export function formatCurrencyShort(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// ── Quantity ──────────────────────────────────────────────────
export function formatQty(
  qty: number | null | undefined,
  unit?: string
): string {
  if (qty === null || qty === undefined) return '—'
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(qty)
  return unit ? `${formatted} ${unit}` : formatted
}

// ── Date ──────────────────────────────────────────────────────
export function formatDate(
  date: string | null | undefined,
  fmt = 'dd MMM yyyy'
): string {
  if (!date) return '—'
  try {
    return format(parseISO(date), fmt)
  } catch {
    return '—'
  }
}

export function formatDateTime(date: string | null | undefined): string {
  return formatDate(date, 'dd MMM yyyy, hh:mm a')
}

export function formatRelative(date: string | null | undefined): string {
  if (!date) return '—'
  try {
    return formatDistanceToNow(parseISO(date), { addSuffix: true })
  } catch {
    return '—'
  }
}

// ── GST ───────────────────────────────────────────────────────
export function calculateGst(amount: number, gstPercent: string): number {
  return (amount * Number(gstPercent)) / 100
}

export function calculateTotal(
  subtotal: number,
  gstPercent: string
): { gst: number; total: number } {
  const gst = calculateGst(subtotal, gstPercent)
  return { gst, total: subtotal + gst }
}

// ── Document numbers ──────────────────────────────────────────
export function isQuotationNo(no: string) { return no.startsWith('QT-') }
export function isSalesOrderNo(no: string) { return no.startsWith('SO-') }
export function isGrnNo(no: string)        { return no.startsWith('GRN-') }
export function isPrdNo(no: string)        { return no.startsWith('PRD-') }
export function isDcNo(no: string)         { return no.startsWith('DC-') }