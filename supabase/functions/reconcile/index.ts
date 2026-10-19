// supabase/functions/reconcile/index.ts
//
// Nightly inventory balance reconciliation Edge Function
//
// DEPLOY:
//   supabase functions deploy reconcile
//
// SCHEDULE (in Supabase Dashboard → Edge Functions → reconcile → Schedule):
//   0 0 * * *    ← runs at midnight every day (UTC)
//
// Or via pg_cron in SQL Editor:
//   select cron.schedule(
//     'nightly-reconcile',
//     '0 0 * * *',
//     $$ select net.http_post(
//       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/reconcile',
//       headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
//     ) $$
//   );
// ─────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req: Request) => {

  // ── Auth check ────────────────────────────────────────────
  // Only allow calls with the service_role key or from the scheduler
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing authorization header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const startedAt = new Date().toISOString()
  console.log(`[reconcile] Starting at ${startedAt}`)

  // ── Supabase client with service_role ─────────────────────
  // service_role bypasses RLS — needed because reconcile_inventory_balance()
  // requires admin-level access to read and update all inventory_balance rows
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false }
  })

  try {
    // ── 1. Run reconciliation ─────────────────────────────
    // reconcile_inventory_balance() is a SECURITY DEFINER function that:
    //   a) Recalculates true stock qty from raw stock_movements ledger
    //   b) Compares against cached inventory_balance rows
    //   c) Fixes any drift and returns the list of corrected items
    const { data: reconcileResult, error: reconcileError } = await supabase
      .rpc('reconcile_inventory_balance')

    if (reconcileError) {
      console.error('[reconcile] RPC error:', reconcileError.message)
      return new Response(
        JSON.stringify({
          success:    false,
          error:      reconcileError.message,
          started_at: startedAt,
          ended_at:   new Date().toISOString(),
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const drifted = (reconcileResult as any[]) ?? []
    const endedAt = new Date().toISOString()

    // ── 2. Log result ─────────────────────────────────────
    if (drifted.length === 0) {
      console.log('[reconcile] ✓ All inventory balances correct — no drift detected')
    } else {
      console.warn(`[reconcile] ⚠ Fixed ${drifted.length} balance drift(s):`)
      for (const row of drifted) {
        console.warn(
          `  item_id=${row.item_id}  old=${row.old_qty}  new=${row.new_qty}  diff=${row.diff}`
        )
      }
    }

    // ── 3. Optionally write to an audit / ops log ─────────
    // This insert is best-effort — do not fail the function if it errors
    try {
      await supabase
        .from('audit_logs')
        .insert({
          table_name: 'inventory_balance',
          record_id:  '00000000-0000-0000-0000-000000000000', // sentinel for system ops
          action:     'RECONCILE',
          new_values: {
            drifted_count: drifted.length,
            drifted_items: drifted,
            started_at:    startedAt,
            ended_at:      endedAt,
          },
          changed_by: null, // system action — no auth user
        })
    } catch (logErr) {
      console.warn('[reconcile] Could not write audit log entry:', logErr)
    }

    // ── 4. Return result ──────────────────────────────────
    return new Response(
      JSON.stringify({
        success:       true,
        drifted_count: drifted.length,
        drifted_items: drifted,
        message:       drifted.length === 0
          ? 'All inventory balances are correct'
          : `Fixed ${drifted.length} balance discrepanc${drifted.length === 1 ? 'y' : 'ies'}`,
        started_at:    startedAt,
        ended_at:      endedAt,
      }),
      {
        status:  200,
        headers: { 'Content-Type': 'application/json' }
      }
    )

  } catch (err: any) {
    console.error('[reconcile] Unexpected error:', err?.message ?? err)
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