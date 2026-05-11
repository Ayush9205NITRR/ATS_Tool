// ============================================================
// FUNNEL STAGES WIDGET — horizontal bar per stage
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'

const STAGES = ['Applied','Screening','Interview','Offer','Hired','Rejected']

const STAGE_COLOR: Record<string, string> = {
  Applied:   'bg-gray-400',
  Screening: 'bg-blue-500',
  Interview: 'bg-amber-500',
  Offer:     'bg-purple-500',
  Hired:     'bg-green-500',
  Rejected:  'bg-red-400',
}

export function FunnelStagesWidget() {
  const { data = {}, isLoading, error } = useQuery({
    queryKey: ['widget', 'funnel-stages'],
    queryFn: async () => {
      const { data } = await supabase.from('candidates').select('current_stage')
      if (!data) return {}
      const counts: Record<string, number> = {}
      data.forEach((c) => {
        counts[c.current_stage] = (counts[c.current_stage] ?? 0) + 1
      })
      return counts
    },
  })

  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1

  return (
    <WidgetBase title="Pipeline Funnel" loading={isLoading} error={error?.message}>
      <div className="space-y-2.5">
        {STAGES.map((stage) => {
          const count = data[stage] ?? 0
          const pct = Math.round((count / total) * 100)
          return (
            <div key={stage} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-20 flex-shrink-0">{stage}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${STAGE_COLOR[stage]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs font-medium text-gray-700 w-6 text-right">{count}</span>
            </div>
          )
        })}
      </div>
    </WidgetBase>
  )
}
