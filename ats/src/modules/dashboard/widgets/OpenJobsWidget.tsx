// ============================================================
// OPEN JOBS WIDGET
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { Briefcase } from 'lucide-react'

export function OpenJobsWidget() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['widget', 'open-jobs'],
    queryFn: async () => {
      const { count } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open')
      return count ?? 0
    },
  })

  return (
    <WidgetBase title="Open Jobs" loading={isLoading} error={error?.message}>
      <div className="flex items-end gap-3">
        <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
          <Briefcase className="w-5 h-5 text-green-600" />
        </div>
        <div>
          <p className="text-3xl font-bold text-gray-900">{data ?? '—'}</p>
          <p className="text-xs text-gray-400">Active positions</p>
        </div>
      </div>
    </WidgetBase>
  )
}
