// ============================================================
// SOURCE FUNNEL WIDGET — source wise candidates received
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'

const SOURCE_COLOURS: Record<string, { bg: string; text: string; bar: string }> = {
  platform: { bg: 'bg-blue-50',   text: 'text-blue-700',   bar: 'bg-blue-500' },
  agency:   { bg: 'bg-purple-50', text: 'text-purple-700', bar: 'bg-purple-500' },
  college:  { bg: 'bg-amber-50',  text: 'text-amber-700',  bar: 'bg-amber-500' },
}

export function SourceFunnelWidget() {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['widget', 'source-funnel'],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('source_category, source_name, current_stage, status')
        .eq('status', 'active')

      if (!data) return []

      // Group by source_category → source_name
      const groups: Record<string, Record<string, number>> = {}
      const categoryTotals: Record<string, number> = {}

      data.forEach(c => {
        if (!groups[c.source_category]) groups[c.source_category] = {}
        groups[c.source_category][c.source_name] = (groups[c.source_category][c.source_name] ?? 0) + 1
        categoryTotals[c.source_category] = (categoryTotals[c.source_category] ?? 0) + 1
      })

      const total = data.length || 1
      return Object.entries(groups).map(([category, sources]) => ({
        category,
        total: categoryTotals[category],
        pct: Math.round((categoryTotals[category] / total) * 100),
        sources: Object.entries(sources).sort((a, b) => b[1] - a[1]),
      }))
    },
  })

  return (
    <WidgetBase title="Source-wise Candidates" loading={isLoading} error={error?.message}>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No data yet</p>
      ) : (
        <div className="space-y-4">
          {data.map((group: any) => {
            const colours = SOURCE_COLOURS[group.category] ?? { bg: 'bg-gray-50', text: 'text-gray-700', bar: 'bg-gray-400' }
            return (
              <div key={group.category} className={`${colours.bg} rounded-lg p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${colours.text} capitalize`}>{group.category}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-white/60 ${colours.text}`}>
                      {group.total} candidates
                    </span>
                  </div>
                  <span className={`text-xs font-bold ${colours.text}`}>{group.pct}%</span>
                </div>
                {/* Progress bar */}
                <div className="bg-white/50 rounded-full h-1.5 mb-2">
                  <div className={`h-1.5 rounded-full ${colours.bar}`} style={{ width: `${group.pct}%` }} />
                </div>
                {/* Sub-sources */}
                <div className="flex flex-wrap gap-1.5">
                  {group.sources.map(([name, count]: [string, number]) => (
                    <span key={name} className="inline-flex items-center gap-1 bg-white/70 rounded-full px-2 py-0.5 text-xs text-gray-600">
                      {name} <span className="font-medium text-gray-900">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </WidgetBase>
  )
}
