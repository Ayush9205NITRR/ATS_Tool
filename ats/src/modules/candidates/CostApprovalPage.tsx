// ============================================================
// COST APPROVAL PAGE — List of candidates at/past CA stage
// Name | Role | Status | Review button
// ============================================================
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Loader2, ExternalLink, CheckCircle, RefreshCw, Clock } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../auth/authStore'
import { supabase } from '../../lib/supabaseClient'

function stageKeyOf(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_')
}

function useCostApprovalSettings() {
  return useQuery({
    queryKey: ['app-settings', 'cost_approval'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings')
        .select('value').eq('key', 'cost_approval').maybeSingle()
      if (!data?.value) return { stageName: 'Cost Approval', panelIds: [] as string[] }
      try {
        const parsed = JSON.parse(data.value)
        return {
          stageName: (parsed.stage_name ?? 'Cost Approval') as string,
          panelIds: (parsed.reviewer_ids ?? []) as string[],
        }
      } catch {
        return { stageName: 'Cost Approval', panelIds: [] as string[] }
      }
    },
    staleTime: 30_000,
  })
}

export function CostApprovalPage() {
  const { user, hasRole } = useAuthStore()
  const navigate = useNavigate()

  const canEdit   = hasRole(['admin', 'super_admin', 'hr_team'])
  const { data: caSettings, isLoading: settingsLoading } = useCostApprovalSettings()
  const costApprovalStageName = caSettings?.stageName ?? 'Cost Approval'
  const isCAPanel = (caSettings?.panelIds ?? []).includes(user?.id ?? '')

  const { data: allCandidates = [], isLoading: candidatesLoading } = useQuery({
    queryKey: ['candidates', 'cost-approval-page', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('*')
        .order('created_at', { ascending: false })
      return (data ?? []) as any[]
    },
    staleTime: 30_000,
    enabled: !settingsLoading,
  })

  const { data: jobsMap = {} } = useQuery({
    queryKey: ['jobs', 'map'],
    queryFn: async () => {
      const { data } = await supabase.from('jobs').select('id,title')
      const map: Record<string, any> = {}
      ;(data ?? []).forEach((j: any) => { map[j.id] = j })
      return map
    },
    staleTime: 60_000,
  })

  // Filter to candidates that have reached or passed CA stage, or have a CA record
  // Exclude rejected candidates (current_stage === 'Rejected' or ends with ' Rejected')
  const caCandidates = allCandidates.filter((c: any) => {
    const stage = (c.current_stage ?? '') as string
    if (stage === 'Rejected' || stage.endsWith(' Rejected')) return false
    const hasCARec = (c.interview_notes?.cost_approval ?? []).length > 0 || !!c.cost_approval_decision
    const isAtCA   = stageKeyOf(stage) === stageKeyOf(costApprovalStageName)
    return hasCARec || isAtCA
  })

  const getCAStatus = (c: any): 'go_ahead' | 'rework_required' | 'awaiting' => {
    const caEntries: any[] = c.interview_notes?.cost_approval ?? []
    const decision = caEntries[caEntries.length - 1]?.decision ?? c.cost_approval_decision ?? ''
    if (decision === 'go_ahead') return 'go_ahead'
    if (decision === 'rework_required') return 'rework_required'
    return 'awaiting'
  }

  const isLoading = settingsLoading || candidatesLoading

  if (!canEdit && !isCAPanel) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <ShieldCheck className="w-8 h-8 text-gray-300"/>
        <p className="text-sm text-gray-500">You don't have access to Cost Approval.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-6">
        <ShieldCheck className="w-5 h-5 text-indigo-600 flex-shrink-0"/>
        <h1 className="text-xl font-semibold text-gray-900">Cost Approval</h1>
        {!isLoading && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {caCandidates.length} candidate{caCandidates.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500"/>
        </div>
      ) : caCandidates.length === 0 ? (
        <div className="flex flex-col items-center py-24 gap-3 text-center">
          <ShieldCheck className="w-8 h-8 text-gray-200"/>
          <p className="text-sm font-medium text-gray-500">No candidates at Cost Approval yet</p>
          <p className="text-xs text-gray-400">Candidates will appear here once they reach the "{costApprovalStageName}" stage.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Name</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Role</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Current Stage</th>
                  <th className="px-5 py-3"/>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {caCandidates.map((c: any) => {
                  const status = getCAStatus(c)
                  const job = c.job_id ? jobsMap[c.job_id] : null
                  return (
                    <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-5 py-3.5 align-middle">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                          {c.email && <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 align-middle">
                        <p className="text-sm text-gray-700">{job?.title ?? <span className="text-gray-400 italic text-xs">—</span>}</p>
                      </td>
                      <td className="px-5 py-3.5 align-middle">
                        {status === 'go_ahead' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-green-100 text-green-700">
                            <CheckCircle className="w-3 h-3"/> Go Ahead
                          </span>
                        )}
                        {status === 'rework_required' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-orange-100 text-orange-700">
                            <RefreshCw className="w-3 h-3"/> Re-work Required
                          </span>
                        )}
                        {status === 'awaiting' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-600">
                            <Clock className="w-3 h-3"/> Awaiting
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 align-middle">
                        <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{c.current_stage}</span>
                      </td>
                      <td className="px-5 py-3.5 align-middle text-right">
                        <button
                          onClick={() => navigate(`/candidates/${c.id}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3"/> Review Profile
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
