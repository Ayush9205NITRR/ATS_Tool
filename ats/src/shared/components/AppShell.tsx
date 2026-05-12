// ============================================================
// INTERVIEWS PAGE — Interviewer's focused view
// Shows only assigned candidates + pending feedback
// ============================================================
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, CheckCircle, Clock, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from "../../modules/auth/authStore"
import { formatDate } from '../../shared/utils/helpers'
import { PageHeader } from '../../shared/components/PageHeader'

const STAGE_COLOURS: Record<string, string> = {
  Screening: 'bg-blue-100 text-blue-700', R1: 'bg-indigo-100 text-indigo-700',
  'Case Study': 'bg-yellow-100 text-yellow-700', R2: 'bg-orange-100 text-orange-700',
  R3: 'bg-orange-200 text-orange-800', 'CF (Virtual)': 'bg-purple-100 text-purple-700',
  'CF (In-Person)': 'bg-purple-200 text-purple-800',
}

export function InterviewsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['my-interviews', user?.id],
    queryFn: async () => {
      const { data: candidates } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, interview_date, job:jobs(title)')
        .contains('assigned_interviewers', [user!.id])
        .eq('status', 'active')
        .order('interview_date', { ascending: true, nullsFirst: false })

      const { data: feedback } = await supabase
        .from('interview_feedback')
        .select('candidate_id')
        .eq('interviewer_id', user!.id)

      const doneIds = new Set((feedback ?? []).map(f => f.candidate_id))

      const pending   = (candidates ?? []).filter(c => !doneIds.has(c.id))
      const completed = (candidates ?? []).filter(c => doneIds.has(c.id))

      // Upcoming = have interview_date set and not done
      const upcoming = pending
        .filter(c => c.interview_date)
        .sort((a, b) => new Date(a.interview_date).getTime() - new Date(b.interview_date).getTime())

      return { pending, completed, upcoming, total: (candidates ?? []).length }
    },
    enabled: !!user,
  })

  return (
    <div>
      <PageHeader title="My Interviews" subtitle={`${data?.total ?? 0} assigned candidates`}/>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
      ) : (
        <div className="space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-3xl font-bold text-amber-600">{data?.pending.length ?? 0}</p>
              <p className="text-sm text-gray-500 mt-1">Pending feedback</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-3xl font-bold text-blue-600">{data?.upcoming.length ?? 0}</p>
              <p className="text-sm text-gray-500 mt-1">Scheduled</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-3xl font-bold text-green-600">{data?.completed.length ?? 0}</p>
              <p className="text-sm text-gray-500 mt-1">Completed</p>
            </div>
          </div>

          {/* Upcoming */}
          {(data?.upcoming?.length ?? 0) > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-blue-50/40">
                <p className="text-sm font-semibold text-blue-700">📅 Upcoming Interviews</p>
              </div>
              {data!.upcoming.map(c => (
                <button key={c.id} onClick={() => navigate(`/candidates/${c.id}`)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors text-left">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                    <p className="text-xs text-gray-400">{(c.job as any)?.title ?? 'No role'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                      {formatDate(c.interview_date)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{c.current_stage}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0"/>
                </button>
              ))}
            </div>
          )}

          {/* Pending feedback */}
          {(data?.pending?.length ?? 0) > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/40">
                <p className="text-sm font-semibold text-amber-700">⏳ Pending Feedback ({data!.pending.length})</p>
              </div>
              {data!.pending.map(c => (
                <button key={c.id} onClick={() => navigate(`/candidates/${c.id}`)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors text-left">
                  <Clock className="w-4 h-4 text-amber-400 flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                    <p className="text-xs text-gray-400">{(c.job as any)?.title ?? 'No role'}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[c.current_stage] ?? 'bg-gray-100 text-gray-600'}`}>
                    {c.current_stage}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0"/>
                </button>
              ))}
            </div>
          )}

          {/* Completed */}
          {(data?.completed?.length ?? 0) > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-green-50/40">
                <p className="text-sm font-semibold text-green-700">✅ Feedback Submitted ({data!.completed.length})</p>
              </div>
              {data!.completed.map(c => (
                <button key={c.id} onClick={() => navigate(`/candidates/${c.id}`)}
                  className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-0 opacity-70 transition-colors text-left">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0"/>
                  <p className="text-sm text-gray-700 flex-1">{c.full_name}</p>
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0"/>
                </button>
              ))}
            </div>
          )}

          {!data?.total && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-sm">No interviews assigned yet.</p>
              <p className="text-xs mt-1">Your HR team will assign candidates to you.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
