// ============================================================
// HR DASHBOARD WIDGET — per HR member: jobs, candidates, funnel
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { useAuthStore } from '../../auth/authStore'
import { Briefcase, Users } from 'lucide-react'
import { Badge } from '../../../shared/components/Badge'

const STAGE_COLOURS: Record<string, string> = {
  Applied: 'bg-gray-200', Screening: 'bg-blue-400', R1: 'bg-indigo-400',
  'Case Study': 'bg-yellow-400', R2: 'bg-orange-400', R3: 'bg-orange-500',
  'CF (Virtual)': 'bg-purple-400', 'CF (In-Person)': 'bg-purple-500',
  Offer: 'bg-violet-500', Hired: 'bg-green-500', Rejected: 'bg-red-400',
}

export function HRDashboardWidget() {
  const { user, hasRole } = useAuthStore()
  const isHR = hasRole(['hr_team'])

  const { data, isLoading, error } = useQuery({
    queryKey: ['widget', 'hr-dashboard', user?.id],
    queryFn: async () => {
      // HR sees their own data, admin/super_admin sees all
      const jobQuery = isHR
        ? supabase.from('jobs').select('id,title,status').eq('hr_owner', user!.id)
        : supabase.from('jobs').select('id,title,status').eq('status', 'open')

      const { data: jobs } = await jobQuery.order('created_at', { ascending: false })
      if (!jobs?.length) return { jobs: [], totalCandidates: 0, stageBreakdown: {} }

      const { data: candidates } = await supabase
        .from('candidates')
        .select('job_id, current_stage, status')
        .in('job_id', jobs.map(j => j.id))
        .eq('status', 'active')

      const stageBreakdown: Record<string, number> = {}
      const jobCounts: Record<string, number> = {}
      candidates?.forEach(c => {
        stageBreakdown[c.current_stage] = (stageBreakdown[c.current_stage] ?? 0) + 1
        jobCounts[c.job_id] = (jobCounts[c.job_id] ?? 0) + 1
      })

      return {
        jobs: jobs.map(j => ({ ...j, count: jobCounts[j.id] ?? 0 })),
        totalCandidates: candidates?.length ?? 0,
        stageBreakdown,
      }
    },
    enabled: !!user,
  })

  const totalStages = Object.values(data?.stageBreakdown ?? {}).reduce((a, b) => a + b, 0) || 1

  return (
    <WidgetBase title={isHR ? 'My Pipeline' : 'Pipeline Overview'} loading={isLoading} error={error?.message}>
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <Briefcase className="w-4 h-4 text-blue-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-blue-700">{data?.jobs.length ?? 0}</p>
          <p className="text-xs text-blue-500">{isHR ? 'My Jobs' : 'Open Jobs'}</p>
        </div>
        <div className="bg-green-50 rounded-lg p-3 text-center">
          <Users className="w-4 h-4 text-green-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-green-700">{data?.totalCandidates ?? 0}</p>
          <p className="text-xs text-green-500">Candidates</p>
        </div>
      </div>

      {/* Jobs list */}
      {data?.jobs.length ? (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Jobs</p>
          <div className="space-y-1.5">
            {data.jobs.map((job: any) => (
              <div key={job.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-700 font-medium truncate flex-1">{job.title}</span>
                <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full ml-2 flex-shrink-0">
                  {job.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400 text-center py-2 mb-3">No jobs assigned</p>
      )}

      {/* Stage funnel */}
      {Object.keys(data?.stageBreakdown ?? {}).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Stage Breakdown</p>
          <div className="space-y-1.5">
            {Object.entries(data!.stageBreakdown).map(([stage, count]) => (
              <div key={stage} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 flex-shrink-0 truncate">{stage}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${STAGE_COLOURS[stage] ?? 'bg-gray-400'}`}
                    style={{ width: `${(count / totalStages) * 100}%` }} />
                </div>
                <span className="text-xs font-medium text-gray-700 w-4 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </WidgetBase>
  )
}
