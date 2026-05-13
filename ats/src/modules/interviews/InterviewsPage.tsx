// ============================================================
// INTERVIEWS PAGE — Table view matching CandidatesPage style
// Feedback state managed via interview_feedback table
// ============================================================
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, CheckCircle, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { formatDate, formatDateTime } from '../../shared/utils/helpers'
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['my-interviews', user?.id],
    queryFn: async () => {
      // Fetch all candidates assigned to me
      const { data: candidates, error: cErr } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, interview_date, job:jobs(title)')
        .contains('assigned_interviewers', [user!.id])
        .eq('status', 'active')

      if (cErr) throw cErr

      // Fetch my submitted feedback
      const { data: feedback, error: fErr } = await supabase
        .from('interview_feedback')
        .select('candidate_id, submitted_at')
        .eq('interviewer_id', user!.id)

      if (fErr) throw fErr

      const doneMap = new Map((feedback ?? []).map(f => [f.candidate_id, f.submitted_at as string]))

      return {
        all: candidates ?? [],
        doneMap,
        pending:   (candidates ?? []).filter(c => !doneMap.has(c.id)),
        submitted: (candidates ?? []).filter(c =>  doneMap.has(c.id)),
      }
    },
    enabled: !!user,
    staleTime: 0, // Always refetch — critical for feedback state
  })

  // Submit feedback for a single candidate
  const submitOne = useMutation({
    mutationFn: async (candidateId: string) => {
      // Get stage from displayed candidates
      const cand = data?.all.find((c: any) => c.id === candidateId)
      const stage = cand?.current_stage ?? 'Applied'

      await supabase.from('interview_feedback')
        .delete()
        .eq('candidate_id', candidateId)
        .eq('interviewer_id', user!.id)

      const { error } = await supabase.from('interview_feedback').insert({
        candidate_id: candidateId,
        interviewer_id: user!.id,
        submitted_at: new Date().toISOString(),
        stage,
      })
      if (error) { console.error('[submitOne]', error); throw error }
    },
    onSuccess: async () => {
      await refetch()
      qc.invalidateQueries({ queryKey: ['my-feedback'] })
      qc.invalidateQueries({ queryKey: ['my-interviews'] })
    },
  })

  // Submit feedback for all selected (bulk)
  const submitBulk = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedIds)
      for (const cid of ids) {
        const cand = data?.all.find((c: any) => c.id === cid)
        const stage = cand?.current_stage ?? 'Applied'

        await supabase.from('interview_feedback')
          .delete()
          .eq('candidate_id', cid)
          .eq('interviewer_id', user!.id)

        const { error } = await supabase.from('interview_feedback').insert({
          candidate_id: cid,
          interviewer_id: user!.id,
          submitted_at: new Date().toISOString(),
          stage,
        })
        if (error) { console.error('[submitBulk]', cid, error); throw error }
      }
    },
    onSuccess: async () => {
      setSelectedIds(new Set())
      await refetch()
      qc.invalidateQueries({ queryKey: ['my-interviews'] })
    },
  })

  const displayed = filter === 'pending' ? (data?.pending ?? []) : (data?.submitted ?? [])
  const pendingCount   = data?.pending.length ?? 0
  const submittedCount = data?.submitted.length ?? 0

  const toggleSel = (id: string) =>
    setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () =>
    setSelectedIds(selectedIds.size === displayed.length ? new Set() : new Set(displayed.map(c => c.id)))

  return (
    <div>
      <PageHeader
        title="My Interviews"
        subtitle={`${data?.all.length ?? 0} assigned · ${pendingCount} pending feedback`}
      />

      {/* Filter toggle */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
          <button onClick={() => { setFilter('pending'); setSelectedIds(new Set()) }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === 'pending' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Clock className="w-3.5 h-3.5"/>
            Pending Feedback
            {pendingCount > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                filter === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'
              }`}>{pendingCount}</span>
            )}
          </button>
          <button onClick={() => { setFilter('submitted'); setSelectedIds(new Set()) }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === 'submitted' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <CheckCircle className="w-3.5 h-3.5"/>
            Feedback Submitted
            {submittedCount > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                filter === 'submitted' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
              }`}>{submittedCount}</span>
            )}
          </button>
        </div>

        {/* Bulk submit */}
        {filter === 'pending' && selectedIds.size > 0 && (
          <button
            onClick={() => submitBulk.mutate()}
            disabled={submitBulk.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {submitBulk.isPending
              ? <Loader2 className="w-4 h-4 animate-spin"/>
              : <CheckCircle className="w-4 h-4"/>
            }
            Submit Feedback ({selectedIds.size})
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500"/>
        </div>
      ) : displayed.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-16 text-gray-400">
          {filter === 'pending' ? (
            <>
              <CheckCircle className="w-8 h-8 mb-2 text-green-400"/>
              <p className="text-sm font-medium text-gray-600">All caught up!</p>
              <p className="text-xs mt-1">No pending feedback.</p>
            </>
          ) : (
            <p className="text-sm">No feedback submitted yet.</p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                {filter === 'pending' && (
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox"
                      checked={selectedIds.size === displayed.length && displayed.length > 0}
                      onChange={toggleAll}
                      className="rounded border-gray-300 text-blue-600 cursor-pointer"/>
                  </th>
                )}
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
                const isSel = selectedIds.has(c.id)
                const submittedAt = data?.doneMap.get(c.id)
                const isSubmitting = submitOne.isPending && submitOne.variables === c.id

                return (
                  <tr key={c.id} className={`transition-colors ${isSel ? 'bg-blue-50/50' : 'hover:bg-gray-50/40'}`}>
                    {filter === 'pending' && (
                      <td className="px-4 py-3 w-10">
                        <input type="checkbox" checked={isSel} onChange={() => toggleSel(c.id)}
                          className="rounded border-gray-300 text-blue-600 cursor-pointer"/>
                      </td>
                    )}

                    {/* Name */}
                    <td className="px-4 py-3">
                      <button onClick={() => navigate(`/candidates/${c.id}`)}
                        className="font-medium text-blue-600 hover:underline text-left text-sm">
                        {c.full_name}
                      </button>
                    </td>

                    {/* Job */}
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {c.job?.title ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Stage */}
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[c.current_stage] ?? 'bg-gray-100 text-gray-600'}`}>
                        {c.current_stage}
                      </span>
                    </td>

                    {/* Interview Date */}
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {c.interview_date ? formatDateTime(c.interview_date) : <span className="text-gray-300">—</span>}
                    </td>

                    {/* Submitted At (submitted tab only) */}
                    {filter === 'submitted' && (
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {submittedAt ? formatDateTime(submittedAt) : '—'}
                      </td>
                    )}

                    {/* Action */}
                    <td className="px-4 py-3 text-right">
                      {filter === 'pending' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => navigate(`/candidates/${c.id}`)}
                            className="text-xs px-3 py-1.5 border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 rounded-lg transition-colors">
                            Add Notes
                          </button>
                          <button
                            onClick={() => submitOne.mutate(c.id)}
                            disabled={isSubmitting}
                            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-60 flex items-center gap-1"
                          >
                            {isSubmitting
                              ? <Loader2 className="w-3 h-3 animate-spin"/>
                              : <CheckCircle className="w-3 h-3"/>
                            }
                            Submit
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => navigate(`/candidates/${c.id}`)}
                          className="text-xs px-3 py-1.5 border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 rounded-lg transition-colors">
                          View Profile
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Footer */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {filter === 'pending'
                ? 'Select candidates to bulk submit · Or submit individually'
                : `${submittedCount} feedback${submittedCount !== 1 ? 's' : ''} submitted`
              }
            </p>
            {selectedIds.size > 0 && (
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600">
                Clear selection
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
