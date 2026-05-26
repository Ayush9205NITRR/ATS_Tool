import { Loader2, AlertCircle } from 'lucide-react'

interface Props {
  title: string
  children: React.ReactNode
  loading?: boolean
  error?: string | null
  action?: React.ReactNode
}

export function WidgetBase({ title, children, loading, error, action }: Props) {
  return (
    <div className="bg-white rounded-2xl shadow-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700">{title}</h3>
        {action}
      </div>

      {loading && (
        <div className="space-y-3 py-2">
          <div className="h-7 w-20 bg-zinc-100 rounded-lg animate-pulse" />
          <div className="h-3 w-28 bg-zinc-100 rounded animate-pulse" />
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-2 text-red-500 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && children}
    </div>
  )
}
