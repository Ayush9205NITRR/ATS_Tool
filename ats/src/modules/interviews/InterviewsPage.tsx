import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, ChevronRight, Check } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { formatDate } from '../../shared/utils/helpers'
import { PageHeader } from '../../shared/components/PageHeader'

type FeedbackFilter = 'pending' | 'submitted'

const STAGE_COLOURS: Record<string, string> = {
  Applied: 'bg-gray-100 text-gray-600',
  Screening: 'bg-blue-100 text-blue-700',
  R1: 'bg-indigo-100 text-indigo-700',
  'Case Study': 'bg-yellow-100 text-yellow-700',
  R2: 'bg-orange-100 text-orange-700',
  R3: 'bg-orange-200 text-orange-800',
  'CF (Virtual)': 'bg-purple-100 text-purple-700',
  'CF (In-Person)': 'bg-purple-200 text-purple-800',
  Offer: 'bg-violet-100 text-violet-700',
  Hired: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
}

export function InterviewsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<FeedbackFilter>('pending')

  const { data, isLoading } = useQuery({
    queryKey: ['my-interviews', user?.id],
    queryFn: async () => {
      const { data: candidates } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, interview_date, job_id, job:jobs(title)')
        .contains('assigned_interviewers', [user!.id])
        .eq('status', 'active')

      const { data: feedback } = await supabase
        .from('interview_feedback')
        .select('candidate_id, submitted_at')
        .eq('interviewer_id', user!.id)

      const doneMap = new Map((feedback ?? []).map(f => [f.candidate_id, f.submitted_at as string]))
      const all = candidates ?? []

      return {
        all,
        doneMap,
        pending:   all.filter(c => !doneMap.has(c.id)),
        submitted: all.filter(c => doneMap.has(c.id)),
      }
    },
    enabled: !!user,
  })

  const markSubmitted = useMutation({
    mutationFn: async (candidateId: string) => {
      const { error } = await supabase
        .from('interview_feedback')
        .upsert({
          candidate_id: candidateId,
          interviewer_id: user!.id,
          submitted_at: new Date().toISOString(),
        }, { onConflict: 'candidate_id,interviewer_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-interviews'] }),
  })

  const displayed = filter === 'pending' ? (data?.pending ?? []) : (data?.submitted ?? [])
  const pendingCount   = data?.pending.length ?? 0
  const submittedCount = data?.submitted.length ?? 0

  return (
    <div>
      <PageHeader
        title="My Interviews"
        subtitle={`${data?.all.length ?? 0} assigned · ${pendingCount} pending feedback`}
      />

      {/* Filter toggle */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-5">
        <button
          onClick={() => setFilter('pending')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            filter === 'pending'
              ? 'bg-white shadow-sm text-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Pending Feedback
          {pendingCount > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
              filter === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'
            }`}>
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setFilter('submitted')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            filter === 'submitted'
              ? 'bg-white shadow-sm text-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Feedback Submitted
          {submittedCount > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
              filter === 'submitted' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
            }`}>
              {submittedCount}
            </span>
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-16 text-gray-400">
          {filter === 'pending' ? (
            <>
              <Check className="w-8 h-8 mb-2 text-green-400" />
              <p className="text-sm font-medium text-gray-600">All caught up!</p>
              <p className="text-xs mt-1">No pending feedback.</p>
            </>
          ) : (
            <>
              <p className="text-sm">No feedback submitted yet.</p>
              <p className="text-xs mt-1">Go to Pending Feedback to submit.</p>
            </>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Candidate</th>
                <th className="text-left px-4 py-3 font-medium">Job</th>
                <th className="text-left px-4 py-3 font-medium">Stage</th>
                <th className="text-left px-4 py-3 font-medium">Interview Date</th>
                {filter === 'submitted' && (
                  <th className="text-left px-4 py-3 font-medium">Submitted At</th>
                )}
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayed.map((c: any) => {
                const submittedAt = data?.doneMap.get(c.id)
                return (
                  <tr key={c.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/candidates/${c.id}`)}
                        className="font-medium text-blue-600 hover:underline text-left"
                      >
                        {c.full_name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {c.job?.title ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[c.current_stage] ?? 'bg-gray-100 text-gray-600'}`}>
                        {c.current_stage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {c.interview_date ? formatDate(c.interview_date) : <span className="text-gray-300">—</span>}
                    </td>
                    {filter === 'submitted' && (
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {submittedAt ? formatDate(submittedAt) : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      {filter === 'pending' ? (
                        <button
                          onClick={() => navigate(`/candidates/${c.id}`)}
                          className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                        >
                          Add Notes & Submit
                        </button>
                      ) : (
                        <button
                          onClick={() => navigate(`/candidates/${c.id}`)}
                          className="text-xs px-3 py-1.5 border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 rounded-lg font-medium transition-colors inline-flex items-center gap-1"
                        >
                          <ChevronRight className="w-3 h-3" /> View
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
