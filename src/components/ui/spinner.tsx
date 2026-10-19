import { cn } from '@/lib/utils/cn'
import { Loader2 } from 'lucide-react'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }
  return (
    <Loader2 className={cn('animate-spin text-blue-600', sizes[size], className)} />
  )
}

// Full page loading state
export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-64">
      <div className="text-center">
        <Spinner size="lg" className="mx-auto mb-3" />
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    </div>
  )
}

// Inline loading row for tables
export function TableLoader() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner />
    </div>
  )
}