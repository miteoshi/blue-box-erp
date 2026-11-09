// app/api/admin/create-worker/route.ts
// ─────────────────────────────────────────────────────────────
// Server-side only — uses SUPABASE_SERVICE_ROLE_KEY which must
// NEVER be exposed to the browser. This route is protected by
// checking the caller's session role server-side.
// ─────────────────────────────────────────────────────────────

import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Admin client — has full DB access, only used server-side
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // never expose this
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// ── Email generator ────────────────────────────────────────────
// "Ramesh Kumar"  → "ramesh.kumar@bluebox.com"
// "Ram Kumar Sharma" → "ram.kumar.sharma@bluebox.com"
// Strips special chars, lowercases, joins with dots
function generateEmail(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // remove special chars
    .replace(/\s+/g, "."); // spaces → dots
  return `${slug}@bluebox.com`;
}

// ── Initial password ───────────────────────────────────────────
// Random and shown to the admin exactly once (returned below).
// The old pattern ("bluebox@<first 6 letters of name>123") could be
// guessed by anyone who knew a worker's name.
// No look-alike characters (0/O, 1/l/I) so it can be read out or written down.
const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generatePassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

function isEmailTakenError(message: string | undefined): boolean {
  return !!message && /already (been )?registered|already exists/i.test(message);
}

export async function POST(req: NextRequest) {
  try {
    // ── 1. Verify caller is admin or manager ───────────────
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await serverSupabase
      .from("profiles")
      .select("role, org_id")
      .eq("id", user.id)
      .single();

    if (!profile || !["admin", "manager"].includes(profile.role)) {
      return NextResponse.json({ error: "Forbidden — admin or manager only" }, {
        status: 403,
      });
    }

    if (!profile.org_id) {
      return NextResponse.json({ error: "Caller must belong to an organization" }, {
        status: 400,
      });
    }

    const callerOrgId = profile.org_id;
    const admin = adminClient();

    // ── 2. Parse body ──────────────────────────────────────
    const { name, skill, phone } = await req.json();

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // ── 3. Find a free email (handle duplicates) ──────────────
    // Tries ramesh.kumar@bluebox.com, then ramesh.kumar2@bluebox.com,
    // ramesh.kumar3@bluebox.com etc. until one is free.
    const baseEmail = generateEmail(name);
    const baseSlug = baseEmail.replace("@bluebox.com", "");

    if (!baseSlug) {
      return NextResponse.json(
        { error: "Name must contain at least one letter or number" },
        { status: 400 },
      );
    }

    let finalEmail = baseEmail;
    let suffix = 2;

    while (true) {
      // Check workers table
      const { data: workerExists } = await admin
        .from("workers")
        .select("id")
        .eq("email", finalEmail)
        .maybeSingle();

      if (!workerExists) break; // email is free

      finalEmail = `${baseSlug}${suffix}@bluebox.com`;
      suffix++;

      if (suffix > 99) {
        return NextResponse.json(
          {
            error:
              `Could not find a free email for "${name}" after 99 attempts`,
          },
          { status: 500 },
        );
      }
    }

    const password = generatePassword();

    // ── 4. Create Supabase Auth user ───────────────────────
    // org_id goes in app_metadata: only the service role can write it, and
    // it is the only place the signup trigger reads it from.
    // If the email already exists in Auth (e.g. a worker row was deleted
    // but the login was not), move on to the next free suffix.
    let authData: Awaited<ReturnType<typeof admin.auth.admin.createUser>>["data"] | null = null;

    while (true) {
      const { data, error: authErr } = await admin.auth.admin.createUser({
        email: finalEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: name.trim(),
        },
        app_metadata: {
          org_id: callerOrgId,
        },
      });

      if (!authErr) {
        authData = data;
        break;
      }

      if (!isEmailTakenError(authErr.message) || suffix > 99) {
        return NextResponse.json({ error: authErr.message }, { status: 400 });
      }

      finalEmail = `${baseSlug}${suffix}@bluebox.com`;
      suffix++;
    }

    if (!authData?.user) {
      return NextResponse.json({ error: "Could not create login" }, { status: 500 });
    }

    const userId = authData.user.id;

    // ── 5. Upsert profiles row with production role and caller's org_id ────────
    const { error: profileErr } = await admin
      .from("profiles")
      .upsert({
        id: userId,
        full_name: name.trim(),
        role: "production",
        org_id: callerOrgId,
        is_active: true,
      }, { onConflict: "id" });

    if (profileErr) {
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    // ── 6. Insert into workers table with caller's org_id ───────────────────────
    const { data: worker, error: workerErr } = await admin
      .from("workers")
      .insert({
        org_id: callerOrgId,
        name: name.trim(),
        email: finalEmail,
        skill: skill || null,
        phone: phone || null,
        is_active: true,
      })
      .select("id")
      .single();

    if (workerErr) {
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: workerErr.message }, { status: 500 });
    }

    // ── 7. Return created account details ──────────────────
    return NextResponse.json({
      workerId: worker.id,
      userId,
      email: finalEmail,
      password,
      generatedFrom: name,
      // Let the client know if a suffix was added
      emailSuffixed: finalEmail !== baseEmail,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
