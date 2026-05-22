// Agency Dashboard Widget — shows their submitted candidates by stage
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { useAuthStore } from '../../auth/authStore'
import { WidgetBase } from './WidgetBase'
import { Users, XCircle, CheckCircle, Clock } from 'lucide-react'

const STAGE_COLOURS: Record<string, string> = {
  Applied:         'bg-gray-200',
  Screening:       'bg-blue-300',
  R1:              'bg-indigo-300',
  'Case Study':    'bg-amber-300',
  R2:              'bg-orange-300',
  R3:              'bg-orange-400',
  'CF (Virtual)':  'bg-purple-300',
  'CF (In-Person)':'bg-purple-400',
  Offer:           'bg-violet-400',
  Hired:           'bg-green-400',
  Rejected:        'bg-red-300',
}

const STAGE_TEXT: Record<string, string> = {
  Applied:         'text-gray-700',
  Screening:       'text-blue-700',
  R1:              'text-indigo-700',
  'Case Study':    'text-amber-700',
  R2:              'text-orange-700',
  R3:              'text-orange-800',
  'CF (Virtual)':  'text-purple-700',
  'CF (In-Person)':'text-purple-800',
  Offer:           'text-violet-700',
  Hired:           'text-green-700',
  Rejected:        'text-red-600',
}

export function AgencyDashboardWidget() {
  const { user } = useAuthStore()

  const { data, isLoading, error } = useQuery({
    queryKey: ['agency-dashboard', user?.agency_id],
    queryFn: async () => {
      // Filter by the user's linked agency_id, NOT user.id.
      // agency_id is the FK to public.agencies(id); user.id is auth UUID.
      if (!user?.agency_id) return []
      const { data } = await supabase
        .from('candidates')
        .select('current_stage, status')
        .eq('agency_id', user.agency_id)
        .eq('status', 'active')
      return data ?? []
    },
    staleTime: 30_000,
    enabled: !!user?.agency_id,
  })

  const candidates = data ?? []
  const total      = candidates.length
  const rejected   = candidates.filter(c => c.current_stage === 'Rejected').length
  const hired      = candidates.filter(c => c.current_stage === 'Hired').length
  const inProgress = total - rejected - hired

  // Stage breakdown
  const stageMap: Record<string, number> = {}
  candidates.forEach(c => {
    stageMap[c.current_stage] = (stageMap[c.current_stage] ?? 0) + 1
  })
  const stageBreakdown = Object.entries(stageMap)
    .sort(([,a],[,b]) => b - a)

  return (
    <WidgetBase title="My Submissions" loading={isLoading} error={error?.message}>
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <Users className="w-4 h-4 text-blue-500 mx-auto mb-1"/>
          <p className="text-xl font-bold text-blue-700">{total}</p>
          <p className="text-xs text-blue-500">Total</p>
        </div>
        <div className="bg-green-50 rounded-xl p-3 text-center">
          <CheckCircle className="w-4 h-4 text-green-500 mx-auto mb-1"/>
          <p className="text-xl font-bold text-green-700">{hired}</p>
          <p className="text-xs text-green-500">Hired</p>
        </div>
        <div className="bg-red-50 rounded-xl p-3 text-center">
          <XCircle className="w-4 h-4 text-red-400 mx-auto mb-1"/>
          <p className="text-xl font-bold text-red-600">{rejected}</p>
          <p className="text-xs text-red-400">Rejected</p>
        </div>
      </div>

      {/* In Progress */}
      {inProgress > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 rounded-lg px-3 py-2 mb-4">
          <Clock className="w-3.5 h-3.5 text-amber-500 flex-shrink-0"/>
          <p className="text-xs text-amber-700 font-medium">{inProgress} candidate{inProgress !== 1 ? 's' : ''} in progress</p>
        </div>
      )}

      {/* Pipeline stage breakdown */}
      {stageBreakdown.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">By Stage</p>
          {stageBreakdown.map(([stage, count]) => {
            const pct = total > 0 ? Math.round(count / total * 100) : 0
            return (
              <div key={stage}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`text-xs font-medium ${STAGE_TEXT[stage] ?? 'text-gray-600'}`}>{stage}</span>
                  <span className="text-xs text-gray-500">{count} · {pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${STAGE_COLOURS[stage] ?? 'bg-gray-300'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-400 text-center py-4">No candidates submitted yet</p>
      )}
    </WidgetBase>
  )
}
