// ============================================================
// HR TEAM WIDGET — Super Admin only: HR member → job → candidates
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { initialsOf } from '../../../shared/utils/helpers'

export function HRTeamWidget() {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['widget', 'hr-team'],
    queryFn: async () => {
      const { data: hrUsers } = await supabase
        .from('users')
        .select('id, full_name, email')
        .in('role', ['hr_team', 'admin'])
        .eq('is_active', true)

      if (!hrUsers?.length) return []

      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, title, hr_owner')
        .eq('status', 'open')

      const { data: candidates } = await supabase
        .from('candidates')
        .select('job_id, current_stage')

      return hrUsers.map((user) => {
        const userJobs = (jobs ?? []).filter((j) => j.hr_owner === user.id)
        const jobsWithCounts = userJobs.map((job) => ({
          ...job,
          candidateCount: (candidates ?? []).filter((c) => c.job_id === job.id).length,
        }))
        return { ...user, jobs: jobsWithCounts, totalCandidates: jobsWithCounts.reduce((a, j) => a + j.candidateCount, 0) }
      })
    },
  })

  return (
    <WidgetBase title="HR Team Overview" loading={isLoading} error={error?.message}>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No HR team members yet</p>
      ) : (
        <div className="space-y-3">
          {data.map((member: any) => (
            <div key={member.id} className="flex items-start gap-3 p-3 border border-gray-100 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-green-700">{initialsOf(member.full_name)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900">{member.full_name}</p>
                  <span className="text-xs text-gray-500">{member.totalCandidates} candidates</span>
                </div>
                {member.jobs.length > 0 ? (
                  <div className="mt-1 space-y-0.5">
                    {member.jobs.map((job: any) => (
                      <p key={job.id} className="text-xs text-gray-500">
                        {job.title} — <span className="text-blue-600">{job.candidateCount}</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-0.5">No jobs assigned</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetBase>
  )
}
