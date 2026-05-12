// ============================================================
// INTERVIEWER STATS WIDGET
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { useAuthStore } from '../../auth/authStore'
import { ClipboardList, Star, Users } from 'lucide-react'

export function InterviewerStatsWidget() {
  const { user } = useAuthStore()

  const { data, isLoading, error } = useQuery({
    queryKey: ['widget', 'interviewer-stats', user?.id],
    queryFn: async () => {
      const [{ count: assigned }, { data: feedback }, { data: candidates }] = await Promise.all([
        supabase.from('candidates').select('*', { count: 'exact', head: true })
          .contains('assigned_interviewers', [user!.id]).eq('status', 'active'),
        supabase.from('interview_feedback').select('overall_score').eq('interviewer_id', user!.id),
        supabase.from('candidates').select('current_stage')
          .contains('assigned_interviewers', [user!.id]),
      ])
      const avgScore = feedback && feedback.length > 0
        ? (feedback.reduce((a, f) => a + f.overall_score, 0) / feedback.length).toFixed(1)
        : null
      const stageBreakdown: Record<string, number> = {}
      candidates?.forEach(c => { stageBreakdown[c.current_stage] = (stageBreakdown[c.current_stage] ?? 0) + 1 })
      return { assigned: assigned ?? 0, feedbackCount: feedback?.length ?? 0, avgScore, stageBreakdown }
    },
    enabled: !!user,
  })

  return (
    <WidgetBase title="My Interview Summary" loading={isLoading} error={error?.message}>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <Users className="w-4 h-4 text-blue-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-blue-700">{data?.assigned ?? 0}</p>
          <p className="text-xs text-blue-500">Assigned</p>
        </div>
        <div className="bg-green-50 rounded-lg p-3 text-center">
          <ClipboardList className="w-4 h-4 text-green-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-green-700">{data?.feedbackCount ?? 0}</p>
          <p className="text-xs text-green-500">Feedbacks</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-3 text-center">
          <Star className="w-4 h-4 text-amber-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-amber-700">{data?.avgScore ?? '—'}</p>
          <p className="text-xs text-amber-500">Avg Score</p>
        </div>
      </div>
      {data && Object.keys(data.stageBreakdown).length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">My Candidates by Stage</p>
          <div className="space-y-1.5">
            {Object.entries(data.stageBreakdown).map(([stage, count]) => (
              <div key={stage} className="flex items-center justify-between">
                <span className="text-xs text-gray-600">{stage}</span>
                <span className="text-xs font-medium text-gray-900 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </WidgetBase>
  )
}
