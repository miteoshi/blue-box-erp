// No 'use client' needed — this is a Server Component
// Next.js shows this file automatically while any page inside
// (dashboard) is fetching data (Suspense boundary)

function Skeleton({ className }: { className?: string }) {
    return (
      <div className={`animate-pulse bg-slate-100 rounded-lg ${className ?? ''}`} />
    )
  }
  
  export default function DashboardLoading() {
    return (
      <div>
        {/* Page header skeleton */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Skeleton className="h-7 w-40 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
  
        {/* Stat cards skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-24 mb-3" />
                  <Skeleton className="h-8 w-12 mb-1" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
              </div>
            </div>
          ))}
        </div>
  
        {/* Main content skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
  
          {/* Table skeleton */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Table header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-14" />
            </div>
            {/* Table rows */}
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-44" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right space-y-1">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-md" />
                </div>
              </div>
            ))}
          </div>
  
          {/* Sidebar skeleton */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3.5 w-14" />
            </div>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="px-5 py-3 border-b border-slate-50">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-36" />
                  </div>
                  <div className="text-right space-y-1">
                    <Skeleton className="h-4 w-14" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              </div>
            ))}
          </div>
  
        </div>
      </div>
    )
  }