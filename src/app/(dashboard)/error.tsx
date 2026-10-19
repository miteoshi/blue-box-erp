'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import Link from 'next/link'

interface ErrorProps {
  error:  Error & { digest?: string }
  reset:  () => void
}

// This file is automatically used by Next.js when any page
// inside (dashboard) throws an unhandled error.
// It catches both Server Component errors and client-side errors.
export default function DashboardError({ error, reset }: ErrorProps) {

  useEffect(() => {
    // Log to console in dev — in production you'd send to Sentry etc.
    console.error('[Dashboard Error]', error)
  }, [error])

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">

        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>

        {/* Heading */}
        <h2 className="text-xl font-semibold text-slate-900 mb-2">
          Something went wrong
        </h2>

        {/* Message */}
        <p className="text-sm text-slate-500 mb-2">
          An unexpected error occurred while loading this page.
        </p>

        {/* Error detail in dev */}
        {process.env.NODE_ENV === 'development' && error?.message && (
          <div className="mb-6 px-4 py-3 bg-slate-900 rounded-lg text-left">
            <p className="text-xs font-mono text-red-400 break-all">
              {error.message}
            </p>
            {error.digest && (
              <p className="text-xs font-mono text-slate-500 mt-1">
                Digest: {error.digest}
              </p>
            )}
          </div>
        )}

        {!error?.message && <div className="mb-6" />}

        {/* Actions */}
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={reset}
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </Button>
          <Link href="/">
            <Button size="sm">
              <Home className="w-4 h-4" />
              Go to Dashboard
            </Button>
          </Link>
        </div>

      </div>
    </div>
  )
}