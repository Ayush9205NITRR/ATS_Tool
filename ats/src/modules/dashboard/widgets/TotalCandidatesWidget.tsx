// ============================================================
// TOTAL CANDIDATES WIDGET
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { Users } from 'lucide-react'

export function TotalCandidatesWidget() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['widget', 'total-candidates'],
    queryFn: async () => {
      const { count } = await supabase
        .from('candidates')
        .select('*', { count: 'exact', head: true })
      return count ?? 0
    },
  })

  return (
    <WidgetBase title="Total Candidates" loading={isLoading} error={error?.message}>
      <div className="flex items-end gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
          <Users className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <p className="text-3xl font-bold text-gray-900">{data ?? '—'}</p>
          <p className="text-xs text-gray-400">All time</p>
        </div>
      </div>
    </WidgetBase>
  )
}
