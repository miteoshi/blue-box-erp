'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { useProfile } from '@/lib/hooks/use-profile'
import { useTenant } from '@/lib/hooks/use-tenant'
import { cn } from '@/lib/utils/cn'
import { toast } from 'sonner'
import { useState } from 'react'
import {
  LayoutDashboard,
  Package,
  Truck,
  Send,
  Users,
  Building2,
  HardHat,
  Settings,
  LogOut,
  Zap,
  ChevronDown,
  Factory,
  FileText,
  ShoppingCart,
  BarChart3,
  ClipboardList,
  PackageOpen,
  Layers,
  Plus,
  List,
} from 'lucide-react'
import type { Enums } from '@/lib/types/database'
import { Route } from 'next'

type UserRole = Enums<'user_role'>

const roleBadgeStyle: Record<UserRole, React.CSSProperties> = {
  admin:      { background: 'rgba(239,68,68,0.15)',    color: '#f87171' },
  manager:    { background: 'rgba(245,158,11,0.15)',   color: '#fbbf24' },
  sales:      { background: 'rgba(59,130,246,0.15)',   color: '#60a5fa' },
  store:      { background: 'rgba(20,184,166,0.15)',   color: '#2dd4bf' },
  production: { background: 'rgba(168,85,247,0.15)',   color: '#c084fc' },
  viewer:     { background: 'rgba(100,116,139,0.15)',  color: '#94a3b8' },
}

function getInitials(name?: string | null) {
  if (!name || !name.trim()) return 'U'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return ((parts[0][0] ?? '') + (parts[1][0] ?? '')).toUpperCase()
  }
  return name.trim().slice(0, 2).toUpperCase()
}

interface NavItem {
  label: string
  href:  string
  icon:  React.ElementType
  roles: UserRole[]
}
interface NavGroup {
  label: string
  icon:  React.ElementType
  items: NavItem[]
  roles: UserRole[]
}

const NAV: (NavItem | NavGroup)[] = [
  // ── Dashboard — everyone ──────────────────────────────────
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    roles: ["admin", "manager", "sales", "store", "production", "viewer"],
  },

  // ── My Tasks — admin, manager, production workers ─────────
  {
    label: "My Tasks",
    href: "/tasks",
    icon: ClipboardList,
    roles: ["admin", "manager", "production"],
  },

  // ── Production — admin, manager, production workers ───────
  {
    label: "Production",
    href: "/production",
    icon: Factory,
    roles: ["admin", "manager", "production"],
  },

  // ── Inbound — admin, manager, store ──────────────────────
  {
    label: "Inbound",
    icon: Truck,
    roles: ["admin", "manager", "store"],
    items: [
      {
        label: "GRN List",
        href: "/inbound",
        icon: List,
        roles: ["admin", "manager", "store"],
      },
      {
        label: "New GRN",
        href: "/inbound/new",
        icon: Plus,
        roles: ["admin", "manager", "store"],
      },
    ],
  },

  // ── Outbound ──────────────────────────────────────────────
  // Group visible to admin, manager, sales, store, viewer
  // Each sub-item scoped independently
  {
    label: "Outbound",
    icon: Send,
    roles: ["admin", "manager", "sales", "store", "viewer"],
    items: [
      // Quotations — admin, manager, sales, viewer (read)
      {
        label: "Quotations",
        href: "/quotations",
        icon: FileText,
        roles: ["admin", "manager", "sales", "viewer"],
      },
      // Sales Orders — admin, manager, sales, viewer (read)
      {
        label: "Sales Orders",
        href: "/sales-orders",
        icon: ShoppingCart,
        roles: ["admin", "manager", "sales", "viewer"],
      },
      // Dispatch — admin, manager, store only
      {
        label: "Dispatch",
        href: "/dispatch",
        icon: PackageOpen,
        roles: ["admin", "manager", "store"],
      },
    ],
  },

  // ── Master Data ───────────────────────────────────────────
  {
    label: "Master Data",
    icon: BarChart3,
    roles: ["admin", "manager", "sales", "store", "production", "viewer"],
    items: [
      // Items — everyone
      {
        label: "Items",
        href: "/items",
        icon: Package,
        roles: ["admin", "manager", "sales", "store", "production", "viewer"],
      },
      {
        label: "Categories",
        href: "/items/categories",
        icon: Layers,
        roles: ["admin", "manager", "store", "production", "viewer"],
      },

      {
        label: "Material Types",
        href: "/items/material-types",
        icon: Layers,
        roles: ["admin", "manager", "store", "production", "viewer"],
      },

      // Inventory — everyone except sales (they see pricing, not stock ops)
      {
        label: "Inventory",
        href: "/inventory",
        icon: Layers,
        roles: ["admin", "manager", "store", "production", "viewer"],
      },
      // Clients — admin, manager, sales, viewer
      {
        label: "Clients",
        href: "/clients",
        icon: Users,
        roles: ["admin", "manager", "sales", "viewer"],
      },
      // Suppliers — admin, manager, store
      {
        label: "Suppliers",
        href: "/suppliers",
        icon: Building2,
        roles: ["admin", "manager", "store"],
      },
      // Workers — admin, manager only
      {
        label: "Workers",
        href: "/workers",
        icon: HardHat,
        roles: ["admin", "manager"],
      },
    ],
  },

  // ── Settings — admin only ─────────────────────────────────
  { label: "Settings", href: "/settings", icon: Settings, roles: ["admin"] },
];

const DIVIDER_BEFORE = new Set(['Settings'])

function isGroup(item: NavItem | NavGroup): item is NavGroup {
  return 'items' in item
}

const S = {
  sidebar:          { background: '#0f172a', borderRight: '1px solid rgba(255,255,255,0.06)' } as React.CSSProperties,
  logoBorder:       { borderBottom: '1px solid rgba(255,255,255,0.06)' } as React.CSSProperties,
  logoIcon:         { background: '#2563eb', borderRadius: 10, boxShadow: '0 2px 10px rgba(37,99,235,0.45)', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  divider:          { height: 1, background: 'rgba(255,255,255,0.06)', margin: '10px 4px' } as React.CSSProperties,

  rowBase:          { borderRadius: 10, transition: 'background 120ms ease' } as React.CSSProperties,
  rowActive:        { background: 'rgba(37,99,235,0.13)' } as React.CSSProperties,
  rowHover:         { background: 'rgba(255,255,255,0.05)' } as React.CSSProperties,

  iconBoxBase:      { width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 120ms ease, box-shadow 120ms ease' } as React.CSSProperties,
  iconBoxActive:    { background: '#1d4ed8', boxShadow: '0 2px 10px rgba(29,78,216,0.55)' } as React.CSSProperties,
  iconBoxIdle:      { background: 'rgba(255,255,255,0.055)' } as React.CSSProperties,
  iconBoxGrpActive: { background: 'rgba(37,99,235,0.15)' } as React.CSSProperties,

  subRow:           { borderRadius: 8, transition: 'background 120ms ease' } as React.CSSProperties,
  subRowActive:     { background: 'rgba(37,99,235,0.1)' } as React.CSSProperties,
  subIconBase:      { width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 120ms ease' } as React.CSSProperties,
  subIconActive:    { background: 'rgba(37,99,235,0.22)' } as React.CSSProperties,
  subBorderLine:    { borderLeft: '1px solid rgba(255,255,255,0.07)', marginLeft: 17, paddingLeft: 10, marginTop: 3 } as React.CSSProperties,

  footerBorder:     { borderTop: '1px solid rgba(255,255,255,0.06)' } as React.CSSProperties,
  profileCard:      { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 } as React.CSSProperties,
  avatar:           { width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#2563eb,#7c3aed)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.03em' } as React.CSSProperties,
  roleBadge:        { fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase' as const, letterSpacing: '0.05em', flexShrink: 0 } as React.CSSProperties,
  signoutBtn:       { borderRadius: 9, transition: 'background 120ms ease', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px' } as React.CSSProperties,
}

export function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { user, profile, organization } = useTenant()

  const role = profile?.role

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    NAV.forEach((item) => {
      if (isGroup(item)) {
        initial[item.label] = item.items.some((i) => pathname.startsWith(i.href))
      }
    })
    return initial
  })

  const [hovered, setHovered] = useState<string | null>(null)

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  function hasRole(roles: UserRole[]) {
    return role ? roles.includes(role) : false
  }

  async function handleSignOut() {
    try {
      queryClient.setQueryData(["tenant-context"], {
        user: null,
        profile: null,
        organization: null,
        orgId: null,
      })
      await supabase.auth.signOut()
      queryClient.clear()
      toast.success('Signed out')
      router.push('/login')
    } catch (err) {
      console.error('Sign out error:', err)
      router.push('/login')
    }
  }

  return (
    // KEY FIX: sidebar itself is a flex column with height:100vh so it never
    // grows taller than the viewport — the nav section can then scroll internally.
    <aside
      style={{ ...S.sidebar, height: '100vh' }}
      className="flex flex-col w-64 fixed left-0 top-0 z-30"
    >

      {/* ── Logo — fixed height, never shrinks ───────────────────────── */}
      <div style={{ ...S.logoBorder, flexShrink: 0 }} className="flex items-center gap-3 px-5 py-5">
        <div style={S.logoIcon}>
          <Zap style={{ width: 17, height: 17, color: '#fff' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.01em', lineHeight: 1.2 }} className="truncate" title={organization?.name || 'Blue Box'}>
            {organization?.name || 'Blue Box'}
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
            ERP System
          </div>
        </div>
      </div>

      {/* ── Nav — takes remaining space, scrolls when content overflows ── */}
      {/*                                                                    */}
      {/*  The THREE properties that make scrolling work:                    */}
      {/*    flex: '1 1 0'  → grows to fill space but starts at 0 height     */}
      {/*    minHeight: 0   → overrides the default minHeight:auto that       */}
      {/*                     prevents flex children from shrinking           */}
      {/*    overflowY: auto → shows scrollbar only when needed              */}
      <nav style={{
        flex: '1 1 0',
        minHeight: 0,
        overflowY: 'auto',
        padding: '14px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        // thin custom scrollbar
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.08) transparent',
      }}>
        {NAV.map((item) => {
          if (!hasRole(item.roles)) return null
          const showDivider = DIVIDER_BEFORE.has(item.label)

          // ── Flat item ─────────────────────────────────────────────
          if (!isGroup(item)) {
            const active = isActive(item.href)
            const isHov  = hovered === item.href
            return (
              <div key={item.href}>
                {showDivider && <div style={S.divider} />}
                <Link
                  href={item.href as Route}
                  style={{
                    ...S.rowBase,
                    ...(active ? S.rowActive : isHov ? S.rowHover : {}),
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '9px 11px', textDecoration: 'none',
                  }}
                  onMouseEnter={() => setHovered(item.href)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div style={{ ...S.iconBoxBase, ...(active ? S.iconBoxActive : S.iconBoxIdle) }}>
                    <item.icon style={{ width: 16, height: 16, color: active ? '#fff' : isHov ? '#94a3b8' : '#64748b', transition: 'color 120ms ease' }} />
                  </div>
                  <span style={{
                    fontSize: 13.5, fontWeight: active ? 600 : 500,
                    color: active ? '#e2e8f0' : isHov ? '#94a3b8' : '#64748b',
                    transition: 'color 120ms ease', flex: 1,
                  }}>
                    {item.label}
                  </span>
                </Link>
              </div>
            )
          }

          // ── Group ─────────────────────────────────────────────────
          const visibleItems = item.items.filter((i) => hasRole(i.roles))
          if (visibleItems.length === 0) return null

          const groupActive = visibleItems.some((i) => isActive(i.href))
          const isOpen      = openGroups[item.label] ?? groupActive
          const grpKey      = `grp-${item.label}`
          const isHov       = hovered === grpKey

          return (
            <div key={item.label}>
              {showDivider && <div style={S.divider} />}

              <button
                onClick={() => toggleGroup(item.label)}
                onMouseEnter={() => setHovered(grpKey)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  ...S.rowBase,
                  background: isHov ? 'rgba(255,255,255,0.05)' : 'transparent',
                  width: '100%', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '9px 11px',
                }}
              >
                <div style={{ ...S.iconBoxBase, ...(groupActive ? S.iconBoxGrpActive : S.iconBoxIdle) }}>
                  <item.icon style={{ width: 16, height: 16, color: groupActive ? '#60a5fa' : isHov ? '#94a3b8' : '#64748b', transition: 'color 120ms ease' }} />
                </div>
                <span style={{
                  fontSize: 13.5, fontWeight: 500,
                  color: groupActive ? '#cbd5e1' : isHov ? '#94a3b8' : '#64748b',
                  flex: 1, textAlign: 'left', transition: 'color 120ms ease',
                }}>
                  {item.label}
                </span>
                <ChevronDown style={{
                  width: 15, height: 15, color: '#334155', flexShrink: 0,
                  transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 200ms ease',
                }} />
              </button>

              {/* Sub-items — no maxHeight cap so all items render fully */}
              <div style={{
                overflow: 'hidden',
                // Use a large enough maxHeight that no group gets clipped.
                // The nav itself scrolls, so we don't need to cap this.
                maxHeight: isOpen ? 9999 : 0,
                opacity: isOpen ? 1 : 0,
                transition: 'max-height 220ms ease, opacity 180ms ease',
              }}>
                <div style={{ ...S.subBorderLine, display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4, paddingBottom: 4 }}>
                  {visibleItems.map((sub) => {
                    const active   = isActive(sub.href)
                    const isHovSub = hovered === sub.href
                    return (
                      <Link
                        key={sub.href}
                        href={sub.href as Route}
                        style={{
                          ...S.subRow,
                          ...(active ? S.subRowActive : isHovSub ? S.rowHover : {}),
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 10px', textDecoration: 'none',
                        }}
                        onMouseEnter={() => setHovered(sub.href)}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <div style={{ ...S.subIconBase, ...(active ? S.subIconActive : {}) }}>
                          <sub.icon style={{ width: 14, height: 14, color: active ? '#60a5fa' : isHovSub ? '#94a3b8' : '#475569', transition: 'color 120ms ease' }} />
                        </div>
                        <span style={{
                          fontSize: 13, fontWeight: active ? 600 : 400,
                          color: active ? '#93c5fd' : isHovSub ? '#94a3b8' : '#64748b',
                          transition: 'color 120ms ease',
                        }}>
                          {sub.label}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      {/* ── Footer — fixed height, never shrinks ─────────────────────── */}
      <div style={{ ...S.footerBorder, flexShrink: 0, padding: '12px 12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>

        {(profile || user) && (
          <div style={{ ...S.profileCard, display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', marginBottom: 2 }}>
            <div style={S.avatar}>
              {getInitials(profile?.full_name || user?.email?.split('@')[0])}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                {profile?.full_name?.trim() || user?.email?.split('@')[0] || 'User'}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={user?.email || undefined}>
                {user?.email || 'Logged in'}
              </div>
            </div>
            {role && (
              <span style={{ ...S.roleBadge, ...roleBadgeStyle[role] }}>
                {role}
              </span>
            )}
          </div>
        )}

        <button
          onClick={handleSignOut}
          style={S.signoutBtn}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.09)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <LogOut style={{ width: 15, height: 15, color: '#475569', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: '#475569' }}>
            Sign out
          </span>
        </button>

      </div>
    </aside>
  )
}