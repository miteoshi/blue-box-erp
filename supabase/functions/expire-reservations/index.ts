// supabase/functions/expire-reservations/index.ts
//
// Hourly stock reservation expiry Edge Function
//
// DEPLOY:
//   supabase functions deploy expire-reservations
//
// SCHEDULE (in Supabase Dashboard → Edge Functions → expire-reservations → Schedule):
//   0 * * * *    ← runs at the top of every hour (UTC)
//
// Or via pg_cron in SQL Editor:
//   select cron.schedule(
//     'hourly-expire-reservations',
//     '0 * * * *',
//     $$ select net.http_post(
//       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/expire-reservations',
//       headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
//     ) $$
//   );
//
// WHAT IT DOES:
//   Finds stock reservations where:
//     - status IN ('active', 'partially_consumed')
//     - reservation_expiry < now()
//   For each expired reservation:
//     - Sets status = 'expired'
//     - Sets qty_released = qty_reserved - qty_consumed
//     - Decrements reserved_qty on inventory_balance
//   This returns committed stock back to available_qty so it
//   can be allocated to other orders.
// ─────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req: Request) => {

  // ── Auth check ────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing authorization header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const startedAt = new Date().toISOString()
  console.log(`[expire-reservations] Starting at ${startedAt}`)

  // ── Supabase client with service_role ─────────────────────
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false }
  })

  try {
    // ── 1. Run expiry function ────────────────────────────
    // expire_stale_reservations() is a SECURITY DEFINER function that:
    //   a) Finds all active/partially_consumed reservations past expiry
    //   b) For each: sets qty_released, marks status = 'expired'
    //   c) Decrements reserved_qty on inventory_balance
    //   d) Returns count of expired reservations
    const { data: expiredCount, error: expireError } = await supabase
      .rpc('expire_stale_reservations')

    if (expireError) {
      console.error('[expire-reservations] RPC error:', expireError.message)
      return new Response(
        JSON.stringify({
          success:    false,
          error:      expireError.message,
          started_at: startedAt,
          ended_at:   new Date().toISOString(),
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const count   = (expiredCount as number) ?? 0
    const endedAt = new Date().toISOString()

    // ── 2. Log result ─────────────────────────────────────
    if (count === 0) {
      console.log('[expire-reservations] ✓ No stale reservations found')
    } else {
      console.log(`[expire-reservations] Expired ${count} stale reservation(s) — stock returned to available`)
    }

    // ── 3. Check for reservations expiring soon ───────────
    // Warn about reservations expiring in the next 2 hours
    // so the business can take action before stock is released
    const soon = new Date()
    soon.setHours(soon.getHours() + 2)

    const { data: expiringSoon } = await supabase
      .from('stock_reservations')
      .select(`
        id, qty_reserved, qty_consumed, reservation_expiry, ref_type, ref_id,
        item:items ( item_code, name )
      `)
      .in('status', ['active', 'partially_consumed'])
      .lt('reservation_expiry', soon.toISOString())
      .gt('reservation_expiry', new Date().toISOString())
      .order('reservation_expiry', { ascending: true })

    if (expiringSoon && expiringSoon.length > 0) {
      console.warn(
        `[expire-reservations] ⚠ ${expiringSoon.length} reservation(s) expiring in < 2 hours:`
      )
      for (const r of expiringSoon) {
        const item = r.item as any
        console.warn(
          `  ${item?.item_code} — ${item?.name} | ` +
          `qty=${r.qty_reserved} | ` +
          `expires=${r.reservation_expiry} | ` +
          `ref=${r.ref_type}:${r.ref_id}`
        )
      }
    }

    // ── 4. Return result ──────────────────────────────────
    return new Response(
      JSON.stringify({
        success:          true,
        expired_count:    count,
        expiring_soon:    expiringSoon?.length ?? 0,
        message:          count === 0
          ? 'No stale reservations found'
          : `Expired ${count} stale reservation${count === 1 ? '' : 's'} — stock returned to available`,
        started_at:       startedAt,
        ended_at:         endedAt,
      }),
      {
        status:  200,
        headers: { 'Content-Type': 'application/json' }
      }
    )

  } catch (err: any) {
    console.error('[expire-reservations] Unexpected error:', err?.message ?? err)
    return new Response(
      JSON.stringify({
        success:    false,
        error:      err?.message ?? 'Unknown error',
        started_at: startedAt,
        ended_at:   new Date().toISOString(),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})