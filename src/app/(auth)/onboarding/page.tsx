"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Zap, Building2, LogOut } from "lucide-react";

type OrganizationTemplate = {
  id: string;
  name: string;
};

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [orgName, setOrgName] = useState("");

  const [template, setTemplate] = useState("");
  const [templates, setTemplates] = useState<OrganizationTemplate[]>([]);

  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const [includeSapDefaults, setIncludeSapDefaults] = useState(false);

  // Verify auth state on mount
  useEffect(() => {
    async function checkAuth() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      if (user.user_metadata?.full_name) {
        setFullName(user.user_metadata.full_name);
      }

      // Check if user already has an org_id
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("org_id, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        toast.error("Unable to load your account");
        setChecking(false);
        return;
      }

      if (profile?.full_name && !user.user_metadata?.full_name) {
        setFullName(profile.full_name);
      }

      if (profile?.org_id) {
        router.push("/");
        return;
      }

      setChecking(false);
    }

    checkAuth();
  }, [router, supabase]);

  useEffect(() => {
    async function loadTemplates() {
      try {
        const response = await fetch("/api/organizations/create");

        if (!response.ok) {
          throw new Error("Failed to load organization templates");
        }

        const data = await response.json();
        setTemplates(data.templates ?? []);
      } catch (error) {
        console.error("Could not load organization templates:", error);
      }
    }

    loadTemplates();
  }, []);

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();

    if (!orgName.trim()) {
      toast.error("Organization name is required");
      return;
    }

    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const response = await fetch("/api/organizations/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orgName: orgName.trim(),
          template: template || null,
          includeSapDefaults,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create organization");
      }

      const orgId = result.orgId;

      if (user && fullName.trim()) {
        try {
          await supabase.auth.updateUser({
            data: { full_name: fullName.trim() },
          });

          await supabase
            .from("profiles")
            .update({ full_name: fullName.trim() })
            .eq("id", user.id);
        } catch (nameErr) {
          console.error("Could not update display name:", nameErr);
        }
      }

      toast.success("Organization created successfully!");

      // Await refetch before navigating so the fresh organization is ready in cache
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["tenant-context"] }),
        queryClient.refetchQueries({ queryKey: ["profile"] }),
      ]);

      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create organization";

      toast.error(message);
      setLoading(false);
    }
  }

  async function handleSignOut() {
    try {
      queryClient.setQueryData(["tenant-context"], {
        user: null,
        profile: null,
        organization: null,
        orgId: null,
      });

      await supabase.auth.signOut();
      queryClient.clear();
      router.push("/login");
    } catch {
      router.push("/login");
    }
  }

  if (checking) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07111f",
        }}
      >
        <Loader2
          style={{
            width: 24,
            height: 24,
            color: "#2563eb",
            animation: "spin 1s linear infinite",
          }}
        />
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        .onboarding-root {
          min-height: 100vh;
          display: flex;
          background: #07111f;
        }

        .onboarding-left {
          width: 45%;
          flex-shrink: 0;
          background: linear-gradient(160deg, #0c1f3f 0%, #0a1628 40%, #07111f 100%);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 36px 40px;
          position: relative;
          overflow: hidden;
          border-right: 0.5px solid rgba(255,255,255,0.06);
        }

        .onboarding-left::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(37,99,235,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(37,99,235,0.04) 1px, transparent 1px);
          background-size: 40px 40px;
          pointer-events: none;
        }

        .onboarding-left::after {
          content: '';
          position: absolute;
          width: 400px;
          height: 400px;
          border-radius: 50%;
          background: rgba(37,99,235,0.12);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          filter: blur(80px);
          pointer-events: none;
        }

        .left-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          position: relative;
          z-index: 1;
        }

        .left-icon {
          width: 36px;
          height: 36px;
          background: #2563eb;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 0 20px rgba(37,99,235,0.4);
        }

        .left-copy {
          position: relative;
          z-index: 1;
          padding-bottom: 8px;
        }

        .left-tagline {
          font-size: 26px;
          font-weight: 600;
          color: #f1f5f9;
          line-height: 1.3;
          letter-spacing: -0.02em;
          margin: 0 0 12px;
          margin-top: 10px;
        }

        .left-sub {
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.6;
          margin: 0;
          max-width: 320px;
        }

        .onboarding-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 32px;
        }

        .onboarding-form-wrap {
          width: 100%;
          max-width: 380px;
        }

        .form-title {
          font-size: 22px;
          font-weight: 600;
          color: #f1f5f9;
          margin: 0 0 6px;
          letter-spacing: -0.01em;
        }

        .form-subtitle {
          font-size: 13px;
          color: #94a3b8;
          margin: 0 0 32px;
          line-height: 1.5;
        }

        .field-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: #94a3b8;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          margin-bottom: 7px;
        }

        .field-input {
          width: 100%;
          box-sizing: border-box;
          padding: 11px 14px;
          background: rgba(255,255,255,0.04);
          border: 0.5px solid rgba(255,255,255,0.12);
          border-radius: 8px;
          color: #e2e8f0;
          font-size: 14px;
          outline: none;
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }

        .field-input::placeholder { color: #475569; }

        .field-input:focus {
          border-color: rgba(37,99,235,0.6);
          box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
        }

        .submit-btn {
          width: 100%;
          padding: 11px;
          background: #2563eb;
          border: none;
          border-radius: 8px;
          color: #fff;
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 150ms ease;
          margin-top: 24px;
        }

        .submit-btn:hover:not(:disabled) { background: #1d4ed8; }
        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .signout-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #64748b;
          font-size: 12px;
          background: none;
          border: none;
          cursor: pointer;
          margin-top: 24px;
          padding: 0;
          transition: color 150ms ease;
        }

        .signout-link:hover { color: #94a3b8; }

        @media (max-width: 640px) {
          .onboarding-root { flex-direction: column; }
          .onboarding-left {
            width: 100%;
            padding: 28px 24px 32px;
            border-right: none;
            border-bottom: 0.5px solid rgba(255,255,255,0.06);
          }
          .left-tagline { font-size: 20px; }
          .left-sub { display: none; }
          .onboarding-right { padding: 32px 24px; }
        }
      `}</style>

      <div className="onboarding-root">
        {/* Left panel */}
        <div className="onboarding-left">
          <div className="left-brand">
            <div className="left-icon">
              <Zap style={{ width: 16, height: 16, color: "#fff" }} />
            </div>

            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#f1f5f9",
                  letterSpacing: "0.01em",
                  lineHeight: 1.2,
                }}
              >
                Blue Box
              </div>

              <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
                ERP System
              </div>
            </div>
          </div>

          <div className="left-copy">
            <h2 className="left-tagline">Welcome to Blue Box</h2>

            <p className="left-sub">
              Let&apos;s set up your dedicated workspace. All your inventory,
              sales, and manufacturing data will stay strictly isolated inside
              your organization.
            </p>
          </div>
        </div>

        {/* Right panel */}
        <div className="onboarding-right">
          <div className="onboarding-form-wrap">
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "rgba(37,99,235,0.12)",
                border: "1px solid rgba(37,99,235,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
              }}
            >
              <Building2 style={{ width: 20, height: 20, color: "#60a5fa" }} />
            </div>

            <h1 className="form-title">Create your organization</h1>

            <p className="form-subtitle">
              Enter the legal or business name of your company. You will be
              assigned as the administrator.
            </p>

            <form onSubmit={handleCreateOrg}>
              <div style={{ marginBottom: 16 }}>
                <label className="field-label">Your Full Name</label>

                <input
                  className="field-input"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Piyush Joshi"
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label className="field-label">Organization Name</label>

                <input
                  className="field-input"
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  required
                  placeholder="e.g. Apex Electrical Industries"
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    color: "#cbd5e1",
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeSapDefaults}
                    onChange={(e) => setIncludeSapDefaults(e.target.checked)}
                    style={{
                      width: 16,
                      height: 16,
                      accentColor: "#2563eb",
                    }}
                  />
                  Include SAP global defaults
                </label>

                <p
                  style={{
                    margin: "6px 0 0 26px",
                    fontSize: 12,
                    color: "#64748b",
                  }}
                >
                  Add standard SAP material types and units to your
                  organization.
                </p>
              </div>

              <div>
                <label
                  htmlFor="template"
                  style={{
                    display: "block",
                    marginBottom: 8,
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#cbd5e1",
                  }}
                >
                  Template <span style={{ color: "#64748b" }}>(optional)</span>
                </label>

                <select
                  id="template"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "#0f1b2d",
                    color: "#e2e8f0",
                    outline: "none",
                  }}
                >
                  <option value="">No template</option>

                  {templates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>

              <button type="submit" disabled={loading} className="submit-btn">
                {loading ? (
                  <>
                    <Loader2
                      style={{
                        width: 15,
                        height: 15,
                        animation: "spin 1s linear infinite",
                      }}
                    />
                    Creating workspace…
                  </>
                ) : (
                  "Create Organization"
                )}
              </button>
            </form>

            <div>
              <button onClick={handleSignOut} className="signout-link">
                <LogOut style={{ width: 13, height: 13 }} />
                Sign in with another account
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
