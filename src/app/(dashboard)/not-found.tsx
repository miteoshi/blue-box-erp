import Link from 'next/link'
import { Home, ArrowLeft, Zap } from 'lucide-react'

// This file is used by Next.js for all 404 responses —
// when notFound() is called inside a page, or when a route
// simply does not exist.
export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md">

        {/* Logo */}
        <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-8 shadow-lg shadow-blue-500/20">
          <Zap className="w-7 h-7 text-white" />
        </div>

        {/* 404 */}
        <div className="text-8xl font-black text-slate-200 leading-none mb-4 select-none">
          404
        </div>

        {/* Message */}
        <h1 className="text-2xl font-bold text-slate-900 mb-3">
          Page not found
        </h1>
        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
          The page you're looking for doesn't exist, was moved,
          or you may not have permission to view it.
        </p>

        {/* Actions */}
        <div className="flex items-center justify-center gap-3">
          <Link
            href="javascript:history.back()"
            className="
              inline-flex items-center gap-2 px-4 py-2 text-sm font-medium
              rounded-lg border border-slate-300 text-slate-700
              hover:bg-slate-100 transition-colors
            "
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </Link>
          <Link
            href="/"
            className="
              inline-flex items-center gap-2 px-4 py-2 text-sm font-medium
              rounded-lg bg-blue-600 text-white
              hover:bg-blue-700 transition-colors shadow-sm
            "
          >
            <Home className="w-4 h-4" />
            Dashboard
          </Link>
        </div>

        {/* Brand */}
        <p className="text-xs text-slate-400 mt-12">
          Project Blue Box · Electrical Hardware ERP
        </p>

      </div>
    </div>
  )
}