import { cn } from '@/lib/utils/cn'
import { Loader2 } from 'lucide-react'
import { forwardRef } from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  children: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1'

    const variants = {
      primary:   'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 shadow-sm',
      secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700 focus:ring-slate-400',
      ghost:     'hover:bg-slate-100 text-slate-600 hover:text-slate-900 focus:ring-slate-400',
      danger:    'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 shadow-sm',
      outline:   'border border-slate-300 hover:bg-slate-50 text-slate-700 focus:ring-slate-400',
    }

    const sizes = {
      sm:  'px-3 py-1.5 text-xs',
      md:  'px-4 py-2 text-sm',
      lg:  'px-5 py-2.5 text-base',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'