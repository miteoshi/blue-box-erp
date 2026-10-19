'use client'

import { useTenant } from '@/components/providers/tenant-provider'
import type { Organization, Profile, UserRole } from '@/components/providers/tenant-provider'

export { useTenant }
export type { Organization, Profile, UserRole }

/**
 * Returns the current authenticated tenant's organization object, or null.
 */
export function useOrg(): Organization | null {
  const { organization } = useTenant()
  return organization
}

/**
 * Returns the current authenticated tenant's org_id,
 * or null while the tenant context is not yet available.
 */
export function useOrgId(): string | null {
  const { orgId } = useTenant()
  return orgId
}

/**
 * Returns the name of the current organization.
 */
export function useCurrentOrgName(): string {
  const { organization } = useTenant()
  return organization?.name ?? 'Blue Box ERP'
}
