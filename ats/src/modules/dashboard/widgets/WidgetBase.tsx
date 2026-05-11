// ============================================================
// WIDGET BASE — card shell every widget renders inside
// Handles loading, error, and empty states consistently.
// ============================================================
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
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {action}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-2 text-red-600 py-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && children}
    </div>
  )
}
