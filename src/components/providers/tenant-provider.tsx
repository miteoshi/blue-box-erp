"use client";

import React, { createContext, useContext, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Tables, Enums } from "@/lib/types/database";
import { usePathname, useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/spinner";
import { AlertTriangle, LogOut, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type Profile = Tables<"profiles">;
export type Organization = Tables<"organizations">;
export type UserRole = Enums<"user_role">;

export interface TenantContextType {
  user: User | null;
  profile: Profile | null;
  organization: Organization | null;
  orgId: string | null;
  role: UserRole | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  /*
   * Resolve the authenticated user's tenant.
   *
   * The tenant is NEVER taken from:
   * - URL parameters
   * - localStorage
   * - sessionStorage
   * - form input
   * - client-provided org_id
   *
   * The authoritative chain is:
   *
   * auth.users.id
   *      ↓
   * profiles.id
   *      ↓
   * profiles.org_id
   *      ↓
   * organizations.id
   */
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["tenant-context"],

    queryFn: async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        return {
          user: null,
          profile: null,
          organization: null,
          orgId: null,
        };
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      /*
       * Authenticated user exists but their profile does not.
       * This is different from having a profile with a NULL org_id.
       */
      if (!profile) {
        return {
          user,
          profile: null,
          organization: null,
          orgId: null,
        };
      }

      /*
       * Profile exists but has not been assigned to an organization.
       * This is the onboarding state.
       */
      if (!profile.org_id) {
        return {
          user,
          profile,
          organization: null,
          orgId: null,
        };
      }

      /*
       * Resolve the organization from the org_id stored on the
       * authenticated user's profile.
       */
      const { data: organization, error: organizationError } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", profile.org_id)
        .maybeSingle();

      if (organizationError) {
        throw organizationError;
      }

      return {
        user,
        profile,
        organization: organization ?? null,
        orgId: profile.org_id,
      };
    },

    /*
     * Tenant context should remain reasonably fresh, but we don't
     * need to refetch it on every component mount.
     *
     * Auth events explicitly invalidate this query below.
     */
    staleTime: 5 * 60 * 1000,

    /*
     * Don't repeatedly retry authentication/profile errors.
     */
    retry: false,
  });

  const user = data?.user ?? null;
  const profile = data?.profile ?? null;
  const organization = data?.organization ?? null;
  const orgId = data?.orgId ?? null;
  const role = profile?.role ?? null;

  /*
   * Keep tenant context synchronized with Supabase auth state.
   */
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        queryClient.setQueryData(["tenant-context"], {
          user: null,
          profile: null,
          organization: null,
          orgId: null,
        });
        queryClient.removeQueries({
          queryKey: ["tenant-context"],
        });
        queryClient.removeQueries({
          queryKey: ["profile"],
        });
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        queryClient.invalidateQueries({
          queryKey: ["tenant-context"],
        });

        queryClient.invalidateQueries({
          queryKey: ["profile"],
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, queryClient]);

  /*
   * Redirect guards for unauthenticated or un-onboarded users.
   */
  useEffect(() => {
    if (isLoading) return;

    if (
      !user &&
      !pathname.startsWith("/login") &&
      !pathname.startsWith("/auth")
    ) {
      router.push("/login");
      return;
    }

    if (
      user &&
      profile &&
      !orgId &&
      !pathname.startsWith("/onboarding") &&
      !pathname.startsWith("/login")
    ) {
      router.push("/onboarding");
    }
  }, [isLoading, user, profile, orgId, pathname, router]);

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
    } catch (signOutError) {
      console.error("Failed to sign out:", signOutError);
      router.push("/login");
    }
  }

  /*
   * 1. Tenant context is being resolved.
   */
  if (isLoading || (isFetching && !organization && !!user)) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <PageLoader />
      </div>
    );
  }

  /*
   * 2. Unauthenticated user on a protected route.
   * Render PageLoader while Next.js transitions to /login.
   */
  if (!user) {
    if (pathname.startsWith("/login") || pathname.startsWith("/auth")) {
      return <>{children}</>;
    }

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <PageLoader />
      </div>
    );
  }

  /*
   * 3. Tenant resolution itself failed for an authenticated user.
   *
   * Do not treat a database/network error as "no organization".
   */
  if (isError && !isFetching) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-400">
            <AlertTriangle className="h-6 w-6" />
          </div>

          <h2 className="mb-2 text-xl font-bold text-white">
            Unable to load account
          </h2>

          <p className="mb-6 text-sm text-slate-400">
            We could not load your organization information. Please try again or
            sign in again.
          </p>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => refetch()}
              className="flex-1"
            >
              Try Again
            </Button>

            <Button
              variant="outline"
              onClick={handleSignOut}
              className="flex-1"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /*
   * 3. Authenticated user has no profile.
   */
  if (user && !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-400">
            <AlertTriangle className="h-6 w-6" />
          </div>

          <h2 className="mb-2 text-xl font-bold text-white">Profile Missing</h2>

          <p className="mb-6 text-sm text-slate-400">
            Your user profile has not been initialized. Please contact your
            administrator.
          </p>

          <Button
            variant="outline"
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  /*
   * 4. Authenticated user has a profile but no organization.
   *
   * The route guard above sends them to /onboarding.
   * We allow the onboarding page to render here.
   */
  if (user && profile && !orgId) {
    if (pathname.startsWith("/onboarding") || pathname.startsWith("/login")) {
      return <>{children}</>;
    }

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <PageLoader />
      </div>
    );
  }

  /*
   * 5. Organization ID exists but organization cannot be resolved
   * or is inactive.
   */
  if (user && profile && orgId && (!organization || !organization.is_active)) {
    if (isFetching) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
          <PageLoader />
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-400">
            <Building2 className="h-6 w-6" />
          </div>

          <h2 className="mb-2 text-xl font-bold text-white">
            Organization Inaccessible
          </h2>

          <p className="mb-6 text-sm text-slate-400">
            Your assigned organization is inactive or could not be found. Please
            contact your system administrator.
          </p>

          <Button
            variant="outline"
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  const contextValue: TenantContextType = {
    user,
    profile,
    organization,
    orgId,
    role,
    isLoading,
    isError,
    error: (error as unknown as Error) || null,
    refetch: async () => {
      await refetch();
    },
  };

  return (
    <TenantContext.Provider value={contextValue}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextType {
  const context = useContext(TenantContext);

  if (!context) {
    throw new Error("useTenant must be used within a TenantProvider");
  }

  return context;
}
