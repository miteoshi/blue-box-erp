'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Loader2, Zap } from 'lucide-react'

export default function LoginPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }
    toast.success('Welcome back!')
    router.refresh()
  }

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        .login-root {
          min-height: 100vh;
          display: flex;
          background: #07111f;
        }

        /* ── Left panel ── */
        .login-left {
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

        /* subtle grid texture on left */
        .login-left::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(37,99,235,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(37,99,235,0.04) 1px, transparent 1px);
          background-size: 40px 40px;
          pointer-events: none;
        }

        /* blue glow orb */
        .login-left::after {
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
          color: #334155;
          line-height: 1.6;
          margin: 0;
          max-width: 280px;
        }

        .left-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 20px;
        }

        .left-pill {
          font-size: 11px;
          color: #1e40af;
          background: rgba(37,99,235,0.12);
          border: 0.5px solid rgba(37,99,235,0.2);
          padding: 4px 10px;
          border-radius: 20px;
        }

        /* ── Right panel ── */
        .login-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 32px;
        }

        .login-form-wrap {
          width: 100%;
          max-width: 360px;
        }

        .form-title {
          font-size: 22px;
          font-weight: 500;
          color: #f1f5f9;
          margin: 0 0 6px;
          letter-spacing: -0.01em;
        }

        .form-subtitle {
          font-size: 13px;
          color: #334155;
          margin: 0 0 32px;
        }

        .field-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: #334155;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          margin-bottom: 7px;
        }

        .field-input {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 14px;
          background: rgba(255,255,255,0.04);
          border: 0.5px solid rgba(255,255,255,0.09);
          border-radius: 8px;
          color: #e2e8f0;
          font-size: 13.5px;
          outline: none;
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }

        .field-input::placeholder { color: #1e3a5f; }

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
          letter-spacing: 0.01em;
          margin-top: 24px;
        }

        .submit-btn:hover:not(:disabled) { background: #1d4ed8; }
        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .form-footer {
          margin-top: 28px;
          padding-top: 20px;
          border-top: 0.5px solid rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .footer-note { font-size: 11px; color: #1e3a5f; }

        .env-badge {
          font-size: 10px;
          font-family: monospace;
          color: #1e293b;
          background: rgba(255,255,255,0.03);
          border: 0.5px solid rgba(255,255,255,0.06);
          padding: 3px 7px;
          border-radius: 4px;
        }

        /* ── Mobile: stack vertically ── */
        @media (max-width: 640px) {
          .login-root { flex-direction: column; }
          .login-left {
            width: 100%;
            padding: 28px 24px 32px;
            border-right: none;
            border-bottom: 0.5px solid rgba(255,255,255,0.06);
          }
          .left-tagline { font-size: 20px; }
          .left-sub { display: none; }
          .left-copy { padding-bottom: 0; }
          .login-right { padding: 32px 24px; }
        }
      `}</style>

      <div className="login-root">
        {/* ── Left panel ── */}
        <div className="login-left">
          {/* Brand */}
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
              <div style={{ fontSize: 10, color: "#1e3a5f", marginTop: 1 }}>
                ERP System
              </div>
            </div>
          </div>

          {/* Copy */}
          <div className="left-copy">
            <h2 className="left-tagline">Blue Box ERP</h2>
            <p className="left-sub">
              Get your personal, ERP system, which is not clumsy like SAP
            </p>
            <div className="left-pills">
              <span className="left-pill">Fast</span>
              <span className="left-pill">Reliable</span>
              <span className="left-pill">NOT Clumsy</span>
              <span className="left-pill">Easy to learn</span>
            </div>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="login-right">
          <div className="login-form-wrap">
            <h1 className="form-title">Sign in</h1>
            <p className="form-subtitle">Internal access only</p>

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 16 }}>
                <label className="field-label">Email address</label>
                <input
                  className="field-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                />
              </div>

              <div>
                <label className="field-label">Password</label>
                <input
                  className="field-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
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
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>

            <div className="form-footer">
              <span className="footer-note">
                Beta access is invitation only
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}