import { AlertTriangle, Mail } from 'lucide-react'

export const metadata = { title: 'Access Suspended' }

export default function SuspendedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-5">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 mb-2">
          Access temporarily suspended
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          Your organization&apos;s access to Blue Box ERP has been paused. This is
          usually related to your subscription — please get in touch and we&apos;ll
          sort it out.
        </p>
        <a
          href="mailto:mitetoshi@gmail.com"
          className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium text-sm"
        >
          <Mail className="w-4 h-4" />
          mitetoshi@gmail.com
        </a>
      </div>
    </div>
  )
}