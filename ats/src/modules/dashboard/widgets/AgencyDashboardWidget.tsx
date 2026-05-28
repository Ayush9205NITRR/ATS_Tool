// ============================================================
// AGENCY DASHBOARD WIDGET — redesigned for clarity
// Active pipeline vs rejection funnel, correct rejected count
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { useAuthStore } from '../../auth/authStore'
import { Loader2 } from 'lucide-react'

// Pipeline stages (ordered) — used to sort active bars
const PIPELINE_ORDER = [
  'Applied', 'Screening', 'R1', 'Case Study', 'R2', 'R3',
  'CF (Virtual)', 'CF (In-Person)', 'Cost Approval', 'Offer',
]

const STAGE_BAR: Record<string, string> = {
  Applied:           'bg-slate-300',
  Screening:         'bg-blue-400',
  R1:                'bg-indigo-400',
  'Case Study':      'bg-amber-400',
  R2:                'bg-orange-400',
  R3:                'bg-orange-500',
  'CF (Virtual)':    'bg-purple-400',
  'CF (In-Person)':  'bg-purple-600',
  'Cost Approval':   'bg-yellow-400',
  Offer:             'bg-violet-500',
}
const STAGE_TEXT: Record<string, string> = {
  Applied:           'text-slate-600',
  Screening:         'text-blue-700',
  R1:                'text-indigo-700',
  'Case Study':      'text-amber-700',
  R2:                'text-orange-700',
  R3:                'text-orange-800',
  'CF (Virtual)':    'text-purple-700',
  'CF (In-Person)':  'text-purple-800',
  'Cost Approval':   'text-yellow-700',
  Offer:             'text-violet-700',
}

const isRejected = (stage: string) =>
  stage?.toLowerCase().includes('reject') || stage === 'Rejected'

const isHired = (stage: string) => stage === 'Hired'

export function AgencyDashboardWidget() {
  const { user } = useAuthStore()

  const { data, isLoading, error } = useQuery({
    queryKey: ['agency-dashboard', user?.agency_id],
    queryFn: async () => {
      if (!user?.agency_id) return []
      const { data } = await supabase
        .from('candidates')
        .select('current_stage, status, full_name')
        .eq('agency_id', user.agency_id)
      return data ?? []
    },
    staleTime: 30_000,
    enabled: !!user?.agency_id,
  })

  const candidates = data ?? []
  const total       = candidates.length
  const hiredList   = candidates.filter(c => isHired(c.current_stage))
  const rejList     = candidates.filter(c => isRejected(c.current_stage))
  const activeList  = candidates.filter(c => !isHired(c.current_stage) && !isRejected(c.current_stage))

  const hired      = hiredList.length
  const rejected   = rejList.length
  const inPipeline = activeList.length
  const hireRate   = total > 0 ? Math.round((hired / total) * 100) : 0
  const rejRate    = total > 0 ? Math.round((rejected / total) * 100) : 0

  // Active stage counts — sorted by pipeline order
  const activeMap: Record<string, number> = {}
  activeList.forEach(c => { activeMap[c.current_stage] = (activeMap[c.current_stage] ?? 0) + 1 })
  const activeStages = [
    ...PIPELINE_ORDER.filter(s => activeMap[s]).map(s => ({ stage: s, count: activeMap[s] })),
    ...Object.entries(activeMap).filter(([s]) => !PIPELINE_ORDER.includes(s)).map(([s, n]) => ({ stage: s, count: n })),
  ]
  const maxActive = Math.max(...activeStages.map(s => s.count), 1)

  // Rejection stage counts — sorted by count desc
  const rejMap: Record<string, number> = {}
  rejList.forEach(c => { rejMap[c.current_stage] = (rejMap[c.current_stage] ?? 0) + 1 })
  const rejStages = Object.entries(rejMap).sort(([,a],[,b]) => b - a)
  const maxRej = Math.max(...rejStages.map(([,n]) => n), 1)

  if (isLoading) return (
    <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-300"/></div>
  )
  if (error) return (
    <div className="text-sm text-red-400 text-center py-8">Failed to load submissions</div>
  )
  if (total === 0) return (
    <div className="text-sm text-gray-400 text-center py-12">No candidates submitted yet</div>
  )

  return (
    <div className="space-y-4">

      {/* ── Stats strip ────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { value: total,      label: 'Total Submitted', cls: 'text-gray-900',    bg: 'bg-white border border-gray-100' },
          { value: inPipeline, label: 'In Pipeline',     cls: 'text-indigo-600',  bg: 'bg-indigo-50'  },
          { value: hired,      label: `Hired · ${hireRate}%`, cls: 'text-emerald-700', bg: 'bg-emerald-50' },
          { value: rejected,   label: `Rejected · ${rejRate}%`, cls: 'text-red-600', bg: 'bg-red-50'  },
        ].map(({ value, label, cls, bg }) => (
          <div key={label} className={`${bg} rounded-xl px-4 py-3`}>
            <p className={`text-[26px] font-bold tabular-nums leading-none ${cls}`}>{value}</p>
            <p className="text-[11px] text-gray-500 mt-1 leading-tight">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Two-column: Active pipeline | Rejection funnel ─────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Active pipeline */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-50">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Active Pipeline</p>
          </div>
          <div className="p-4">
            {activeStages.length === 0 ? (
              <p className="text-[12px] text-gray-400 text-center py-4">No active candidates</p>
            ) : (
              <div className="space-y-2.5">
                {activeStages.map(({ stage, count }) => {
                  const barW = Math.round((count / maxActive) * 100)
                  const pct  = Math.round((count / total) * 100)
                  const bar  = STAGE_BAR[stage]  ?? 'bg-gray-300'
                  const txt  = STAGE_TEXT[stage] ?? 'text-gray-700'
                  return (
                    <div key={stage} className="flex items-center gap-3">
                      <span className={`text-[12px] font-medium w-28 flex-shrink-0 truncate ${txt}`}>{stage}</span>
                      <div className="flex-1 h-[6px] bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${bar} transition-all duration-500`} style={{ width: `${barW}%` }}/>
                      </div>
                      <span className="text-[12px] font-bold text-gray-700 w-6 text-right tabular-nums flex-shrink-0">{count}</span>
                      <span className="text-[10px] text-gray-300 w-7 text-right tabular-nums flex-shrink-0">{pct}%</span>
                    </div>
                  )
                })}
                <div className="pt-2 border-t border-gray-50 flex justify-between">
                  <span className="text-[11px] text-gray-400">Total in pipeline</span>
                  <span className="text-[12px] font-bold text-indigo-600 tabular-nums">{inPipeline}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Rejection funnel */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-50">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Where Candidates Dropped Off</p>
          </div>
          <div className="p-4">
            {rejStages.length === 0 ? (
              <div className="flex flex-col items-center py-6 gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
                  <span className="text-emerald-500 text-lg">✓</span>
                </div>
                <p className="text-[12px] text-gray-400">No rejections yet</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {rejStages.map(([stage, count]) => {
                  const barW = Math.round((count / maxRej) * 100)
                  const pct  = Math.round((count / total) * 100)
                  // Derive stage label without "Rejected" suffix for bar label context
                  const label = stage.replace(' Rejected', '').replace('Rejected', '').trim() || stage
                  return (
                    <div key={stage} className="flex items-center gap-3">
                      <span className="text-[12px] font-medium text-red-500 w-28 flex-shrink-0 truncate" title={stage}>{stage}</span>
                      <div className="flex-1 h-[6px] bg-red-50 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-red-300 transition-all duration-500" style={{ width: `${barW}%` }}/>
                      </div>
                      <span className="text-[12px] font-bold text-red-600 w-6 text-right tabular-nums flex-shrink-0">{count}</span>
                      <span className="text-[10px] text-gray-300 w-7 text-right tabular-nums flex-shrink-0">{pct}%</span>
                    </div>
                  )
                })}
                <div className="pt-2 border-t border-gray-50 flex justify-between">
                  <span className="text-[11px] text-gray-400">Total rejected</span>
                  <span className="text-[12px] font-bold text-red-500 tabular-nums">{rejected}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Hired section ──────────────────────────────────────── */}
      {hired > 0 && (
        <div className="bg-emerald-50 rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 mb-0.5">Placed & Hired</p>
            <p className="text-[12px] text-emerald-700">
              {hired} candidate{hired !== 1 ? 's' : ''} successfully hired — {hireRate}% success rate
            </p>
          </div>
          <div className="text-[28px] font-bold text-emerald-600 tabular-nums">{hired}</div>
        </div>
      )}

    </div>
  )
}
