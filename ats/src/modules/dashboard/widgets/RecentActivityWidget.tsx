// ============================================================
// RECENT ACTIVITY WIDGET — last 5 added candidates
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { Badge } from '../../../shared/components/Badge'
import { formatRelative, initialsOf } from '../../../shared/utils/helpers'

export function RecentActivityWidget() {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['widget', 'recent-activity'],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, source_name, created_at')
        .order('created_at', { ascending: false })
        .limit(5)
      return data ?? []
    },
  })

  return (
    <WidgetBase title="Recent Candidates" loading={isLoading} error={error?.message}>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No candidates yet</p>
      ) : (
        <div className="space-y-3">
          {data.map((c) => (
            <div key={c.id} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-medium text-gray-600">{initialsOf(c.full_name)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{c.full_name}</p>
                <p className="text-xs text-gray-400">{c.source_name} · {formatRelative(c.created_at)}</p>
              </div>
              <Badge label={c.current_stage} type="stage" />
            </div>
          ))}
        </div>
      )}
    </WidgetBase>
  )
}
