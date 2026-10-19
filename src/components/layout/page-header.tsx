import { cn } from '@/lib/utils/cn'

interface PageHeaderProps {
  title: string
  description?: string
  children?: React.ReactNode  // action buttons go here
  className?: string
}

// Use at the top of every page:
// <PageHeader title="Quotations" description="Manage customer price offers">
//   <Button>New Quotation</Button>
// </PageHeader>
export function PageHeader({
  title,
  description,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn(
      'flex items-start justify-between gap-4 mb-6',
      className
    )}>
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        {description && (
          <p className="text-sm text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {children}
        </div>
      )}
    </div>
  )
}