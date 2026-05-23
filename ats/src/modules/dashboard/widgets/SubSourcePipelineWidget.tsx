// Sub-source pipeline split — for each source_name shows stage breakdown
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { ChevronDown, ChevronRight } from 'lucide-react'

const STAGE_COLOURS: Record<string, string> = {
  Applied:          'bg-gray-300',
  Screening:        'bg-blue-400',
  R1:               'bg-indigo-400',
  'Case Study':     'bg-amber-400',
  R2:               'bg-orange-400',
  R3:               'bg-orange-500',
  'CF (Virtual)':   'bg-purple-400',
  'CF (In-Person)': 'bg-purple-500',
  Offer:            'bg-violet-500',
  Hired:            'bg-green-500',
  Rejected:         'bg-red-400',
}

const STAGE_ORDER = [
  'Applied','Screening','R1','Case Study','R2','R3',
  'CF (Virtual)','CF (In-Person)','Offer','Hired','Rejected',
]

export function SubSourcePipelineWidget() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data = [], isLoading, error } = useQuery({
    queryKey: ['widget', 'subsource-pipeline'],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('source_name, source_category, current_stage')
        .eq('status', 'active')
      if (!data) return []

      // Group by source_name
      const map = new Map<string, { category: string; stages: Record<string, number>; total: number }>()
      data.forEach(c => {
        if (!map.has(c.source_name)) {
          map.set(c.source_name, { category: c.source_category, stages: {}, total: 0 })
        }
        const row = map.get(c.source_name)!
        row.stages[c.current_stage] = (row.stages[c.current_stage] ?? 0) + 1
        row.total += 1
      })

      return Array.from(map.entries())
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.total - a.total)
    },
  })

  const toggle = (name: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  const SOURCE_TAG: Record<string, string> = {
    agency:   'bg-purple-100 text-purple-700',
    college:  'bg-green-100 text-green-700',
    platform: 'bg-blue-100 text-blue-700',
  }

  return (
    <WidgetBase title="Sub-Source Pipeline" loading={isLoading} error={error?.message}>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No data yet</p>
      ) : (
        <div className="space-y-1">
          {data.map(src => {
            const isOpen = expanded.has(src.name)
            const hiredCount   = src.stages['Hired']    ?? 0
            const rejectedCount = src.stages['Rejected'] ?? 0
            const inProgress   = src.total - hiredCount - rejectedCount

            // Mini stage bar
            const stagesOrdered = STAGE_ORDER
              .filter(s => src.stages[s])
              .map(s => ({ stage: s, count: src.stages[s] }))

            return (
              <div key={src.name} className="border border-gray-100 rounded-xl overflow-hidden">
                {/* Header row */}
                <button
                  onClick={() => toggle(src.name)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 text-left"
                >
                  {isOpen
                    ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
                    : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{src.name}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${SOURCE_TAG[src.category] ?? 'bg-gray-100 text-gray-600'}`}>
                        {src.category}
                      </span>
                    </div>
                    {/* Mini stage bar */}
                    <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
                      {stagesOrdered.map(({ stage, count }) => (
                        <div
                          key={stage}
                          className={STAGE_COLOURS[stage] ?? 'bg-gray-300'}
                          style={{ width: `${(count / src.total) * 100}%` }}
                          title={`${stage}: ${count}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 text-right">
                    <span className="text-xs text-gray-500">{src.total} total</span>
                    {hiredCount > 0 && <span className="text-xs text-green-600 font-medium">{hiredCount} hired</span>}
                    {inProgress > 0 && <span className="text-xs text-amber-600">{inProgress} active</span>}
                  </div>
                </button>

                {/* Expanded stage detail */}
                {isOpen && (
                  <div className="px-4 pb-3 pt-1 bg-gray-50/50 border-t border-gray-100">
                    <div className="space-y-1.5">
                      {stagesOrdered.map(({ stage, count }) => {
                        const pct = Math.round((count / src.total) * 100)
                        return (
                          <div key={stage} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-28 flex-shrink-0 truncate">{stage}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                              <div className={`h-full rounded-full ${STAGE_COLOURS[stage] ?? 'bg-gray-300'}`}
                                style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-600 w-12 text-right flex-shrink-0">
                              {count} · {pct}%
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </WidgetBase>
  )
}
