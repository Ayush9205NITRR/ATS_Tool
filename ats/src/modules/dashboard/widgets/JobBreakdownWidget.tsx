// ============================================================
// JOB BREAKDOWN WIDGET — candidates per job with stage breakdown
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { Badge } from '../../../shared/components/Badge'
import { useNavigate } from 'react-router-dom'

export function JobBreakdownWidget() {
  const navigate = useNavigate()

  const { data = [], isLoading, error } = useQuery({
    queryKey: ['widget', 'job-breakdown'],
    queryFn: async () => {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, title, status')
        .eq('status', 'open')
        .order('title')

      if (!jobs?.length) return []

      const { data: candidates } = await supabase
        .from('candidates')
        .select('job_id, current_stage, status')
        .eq('status', 'active')

      return jobs.map((job) => {
        const jobCandidates = (candidates ?? []).filter((c) => c.job_id === job.id)
        const stageCounts: Record<string, number> = {}
        jobCandidates.forEach((c) => {
          stageCounts[c.current_stage] = (stageCounts[c.current_stage] ?? 0) + 1
        })
        return { ...job, total: jobCandidates.length, stageCounts }
      })
    },
  })

  return (
    <WidgetBase title="Candidates by Job" loading={isLoading} error={error?.message}>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No open jobs yet</p>
      ) : (
        <div className="space-y-4">
          {data.map((job: any) => (
            <div key={job.id} className="border border-gray-100 rounded-lg p-3 hover:border-blue-200 transition-colors cursor-pointer"
              onClick={() => navigate(`/candidates?job_id=${job.id}`)}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-900">{job.title}</p>
                <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                  {job.total} candidates
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(job.stageCounts).map(([stage, count]) => (
                  <div key={stage} className="flex items-center gap-1">
                    <Badge label={stage} type="stage" />
                    <span className="text-xs text-gray-500">{count as number}</span>
                  </div>
                ))}
                {job.total === 0 && <p className="text-xs text-gray-400">No active candidates</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetBase>
  )
}
