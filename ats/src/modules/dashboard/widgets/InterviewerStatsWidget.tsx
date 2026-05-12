import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { useAuthStore } from '../../auth/authStore'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Clock, Star, Users, ChevronRight } from 'lucide-react'
import { formatDate } from '../../../shared/utils/helpers'

export function InterviewerStatsWidget() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery({
    queryKey: ['widget','interviewer-stats', user?.id],
    queryFn: async () => {
      const [
        { data: assigned },
        { data: feedback },
      ] = await Promise.all([
        supabase.from('candidates')
          .select('id, full_name, current_stage, interview_date, job:jobs(title)')
          .contains('assigned_interviewers', [user!.id])
          .eq('status','active'),
        supabase.from('interview_feedback')
          .select('overall_score, candidate_id, submitted_at')
          .eq('interviewer_id', user!.id),
      ])

      const feedbackCandidateIds = new Set(feedback?.map(f => f.candidate_id))
      const pending = assigned?.filter(c => !feedbackCandidateIds.has(c.id)) ?? []
      const completed = assigned?.filter(c => feedbackCandidateIds.has(c.id)) ?? []
      const avgScore = feedback && feedback.length > 0
        ? (feedback.reduce((a,f) => a + f.overall_score, 0) / feedback.length).toFixed(1)
        : null

      // Upcoming interviews (have interview_date set)
      const upcoming = pending
        .filter(c => c.interview_date)
        .sort((a,b) => new Date(a.interview_date!).getTime() - new Date(b.interview_date!).getTime())
        .slice(0, 3)

      return { total: assigned?.length ?? 0, pending: pending.length, completed: completed.length, avgScore, upcoming, pendingList: pending.slice(0,5) }
    },
    enabled: !!user,
  })

  return (
    <WidgetBase title="My Interview Panel" loading={isLoading} error={error?.message}>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <Users className="w-4 h-4 text-blue-500 mx-auto mb-1"/>
          <p className="text-xl font-bold text-blue-700">{data?.total ?? 0}</p>
          <p className="text-xs text-blue-500">Assigned</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-3 text-center">
          <Clock className="w-4 h-4 text-amber-500 mx-auto mb-1"/>
          <p className="text-xl font-bold text-amber-700">{data?.pending ?? 0}</p>
          <p className="text-xs text-amber-500">Pending</p>
        </div>
        <div className="bg-green-50 rounded-xl p-3 text-center">
          <CheckCircle className="w-4 h-4 text-green-500 mx-auto mb-1"/>
          <p className="text-xl font-bold text-green-700">{data?.completed ?? 0}</p>
          <p className="text-xs text-green-500">Done</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-3 text-center">
          <Star className="w-4 h-4 text-purple-500 mx-auto mb-1"/>
          <p className="text-xl font-bold text-purple-700">{data?.avgScore ?? '—'}</p>
          <p className="text-xs text-purple-500">Avg Score</p>
        </div>
      </div>

      {/* Upcoming interviews */}
      {data?.upcoming && data.upcoming.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Upcoming</p>
          <div className="space-y-1.5">
            {data.upcoming.map((c:any) => (
              <div key={c.id} className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                  <p className="text-xs text-gray-500">{(c.job as any)?.title ?? 'No role'} · {c.current_stage}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-blue-700">{formatDate(c.interview_date)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending feedback */}
      {data?.pendingList && data.pendingList.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Pending Feedback ({data.pending})
          </p>
          <div className="space-y-1">
            {data.pendingList.map((c:any) => (
              <button key={c.id} onClick={() => navigate(`/candidates/${c.id}`)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left">
                <div>
                  <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                  <p className="text-xs text-gray-400">{c.current_stage}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300"/>
              </button>
            ))}
          </div>
          {data.pending > 5 && (
            <button onClick={() => navigate('/interviews')} className="mt-2 w-full text-xs text-blue-600 hover:underline text-center">
              View all {data.pending} pending →
            </button>
          )}
        </div>
      )}

      {data?.total === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">No candidates assigned yet</p>
      )}
    </WidgetBase>
  )
}
