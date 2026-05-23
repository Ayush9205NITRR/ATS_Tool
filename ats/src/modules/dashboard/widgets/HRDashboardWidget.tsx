// HR Dashboard — My Pipeline with nested Job → Source → Sub-source → Stage
import { useAuthStore } from '../../auth/authStore'
import { JobSourceBreakdownWidget } from './JobSourceBreakdownWidget'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { Briefcase, Users, CheckCircle } from 'lucide-react'

export function HRDashboardWidget() {
  const { user, hasRole } = useAuthStore()
  const isHR = hasRole(['hr_team'])

  const { data: stats, isLoading } = useQuery({
    queryKey: ['widget', 'hr-stats', user?.id, isHR],
    queryFn: async () => {
      let query = supabase
        .from('candidates')
        .select('id, current_stage, status, hr_owner, assigned_hrs')
        .eq('status', 'active')

      if (isHR && user?.id) {
        query = query.or(`hr_owner.eq.${user.id},assigned_hrs.cs.{${user.id}}`)
      }

      const { data: candidates } = await query

      // Jobs assigned to this HR
      const jobQuery = isHR
        ? supabase.from('jobs').select('id,title,status').or(`hr_owner.eq.${user!.id},assigned_hrs.cs.{${user!.id}}`)
        : supabase.from('jobs').select('id,title,status').eq('status','open')

      const { data: jobs } = await jobQuery

      const total    = candidates?.length ?? 0
      const hired    = candidates?.filter(c => c.current_stage === 'Hired').length ?? 0
      const rejected = candidates?.filter(c => c.current_stage === 'Rejected').length ?? 0

      return { total, hired, rejected, inProgress: total - hired - rejected, jobCount: jobs?.length ?? 0 }
    },
    enabled: !!user,
  })

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <WidgetBase title={isHR ? 'My Pipeline' : 'Pipeline Overview'} loading={isLoading}>
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-blue-50 rounded-lg p-2.5 text-center">
            <Briefcase className="w-3.5 h-3.5 text-blue-500 mx-auto mb-1"/>
            <p className="text-xl font-bold text-blue-700">{stats?.jobCount ?? 0}</p>
            <p className="text-xs text-blue-500">{isHR ? 'My Jobs' : 'Open Jobs'}</p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-2.5 text-center">
            <Users className="w-3.5 h-3.5 text-indigo-500 mx-auto mb-1"/>
            <p className="text-xl font-bold text-indigo-700">{stats?.total ?? 0}</p>
            <p className="text-xs text-indigo-500">Total</p>
          </div>
          <div className="bg-green-50 rounded-lg p-2.5 text-center">
            <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto mb-1"/>
            <p className="text-xl font-bold text-green-700">{stats?.hired ?? 0}</p>
            <p className="text-xs text-green-500">Hired</p>
          </div>
          <div className="bg-amber-50 rounded-lg p-2.5 text-center">
            <Users className="w-3.5 h-3.5 text-amber-500 mx-auto mb-1"/>
            <p className="text-xl font-bold text-amber-700">{stats?.inProgress ?? 0}</p>
            <p className="text-xs text-amber-500">Active</p>
          </div>
        </div>
      </WidgetBase>

      {/* Nested breakdown */}
      <JobSourceBreakdownWidget />
    </div>
  )
}
