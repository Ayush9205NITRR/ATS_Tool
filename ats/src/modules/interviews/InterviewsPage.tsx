import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, CheckCircle, Clock, ChevronRight, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
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
  const qc = useQueryClient()

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
        .select('candidate_id, submitted_at')
        .eq('interviewer_id', user!.id)

      const doneMap = new Map((feedback ?? []).map(f => [f.candidate_id, f.submitted_at]))
      const all = candidates ?? []

      return {
        pending:   all.filter(c => !doneMap.has(c.id)),
        completed: all.filter(c => doneMap.has(c.id)),
        upcoming:  all.filter(c => !doneMap.has(c.id) && c.interview_date)
          .sort((a, b) => new Date(a.interview_date).getTime() - new Date(b.interview_date).getTime()),
        total: all.length,
      }
    },
    enabled: !!user,
  })

  // Submit feedback — inserts row into interview_feedback
  const submitFeedback = useMutation({
    mutationFn: async (candidateId: string) => {
      const { error } = await supabase.from('interview_feedback').upsert({
        candidate_id: candidateId,
        interviewer_id: user!.id,
        submitted_at: new Date().toISOString(),
      }, { onConflict: 'candidate_id,interviewer_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-interviews'] }),
  })

  return (
    <div>
      <PageHeader title="My Interviews" subtitle={`${data?.total ?? 0} assigned candidates`}/>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
      ) : (
        <div className="space-y-5">
          {/* Stats — removed Avg Score */}
          <div className="grid grid-cols-3 gap-4">
            <Stat value={data?.pending.length ?? 0} label="Pending feedback" colour="amber"/>
            <Stat value={data?.upcoming.length ?? 0} label="Scheduled" colour="blue"/>
            <Stat value={data?.completed.length ?? 0} label="Completed" colour="green"/>
          </div>

          {/* Upcoming */}
          {(data?.upcoming?.length ?? 0) > 0 && (
            <Section title="📅 Upcoming Interviews" accent="blue">
              {data!.upcoming.map(c => (
                <CandidateRow key={c.id} c={c} onClick={() => navigate(`/candidates/${c.id}`)}>
                  <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                    {formatDate(c.interview_date)}
                  </span>
                </CandidateRow>
              ))}
            </Section>
          )}

          {/* Pending feedback */}
          {(data?.pending?.length ?? 0) > 0 && (
            <Section title={`⏳ Pending Feedback (${data!.pending.length})`} accent="amber">
              {data!.pending.map(c => (
                <div key={c.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-50 last:border-0">
                  <Clock className="w-4 h-4 text-amber-400 flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                    <p className="text-xs text-gray-400">{(c.job as any)?.title ?? 'No role'}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[c.current_stage] ?? 'bg-gray-100 text-gray-600'}`}>
                    {c.current_stage}
                  </span>
                  {/* Submit Feedback → moves to Completed */}
                  <button
                    onClick={() => submitFeedback.mutate(c.id)}
                    disabled={submitFeedback.isPending}
                    className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex-shrink-0 disabled:opacity-50">
                    Submit Feedback
                  </button>
                  <button onClick={() => navigate(`/candidates/${c.id}`)} className="text-gray-300 hover:text-gray-500">
                    <ChevronRight className="w-4 h-4"/>
                  </button>
                </div>
              ))}
            </Section>
          )}

          {/* Completed */}
          {(data?.completed?.length ?? 0) > 0 && (
            <Section title={`✅ Feedback Submitted (${data!.completed.length})`} accent="green">
              {data!.completed.map(c => (
                <div key={c.id} className="flex items-center gap-4 px-5 py-3 border-b border-gray-50 last:border-0">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700">{c.full_name}</p>
                    <p className="text-xs text-gray-400">{(c.job as any)?.title ?? 'No role'}</p>
                  </div>
                  {/* Edit button → takes to profile */}
                  <button onClick={() => navigate(`/candidates/${c.id}`)}
                    className="text-xs px-3 py-1.5 border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 rounded-lg font-medium transition-colors flex-shrink-0 flex items-center gap-1">
                    <Pencil className="w-3 h-3"/> Edit
                  </button>
                </div>
              ))}
            </Section>
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

function Stat({ value, label, colour }: { value: number; label: string; colour: 'amber'|'blue'|'green' }) {
  const cls = { amber: 'text-amber-600', blue: 'text-blue-600', green: 'text-green-600' }[colour]
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
      <p className={`text-3xl font-bold ${cls}`}>{value}</p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </div>
  )
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  const bg = accent === 'blue' ? 'bg-blue-50/40' : accent === 'amber' ? 'bg-amber-50/40' : 'bg-green-50/40'
  const text = accent === 'blue' ? 'text-blue-700' : accent === 'amber' ? 'text-amber-700' : 'text-green-700'
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className={`px-5 py-3 border-b border-gray-100 ${bg}`}>
        <p className={`text-sm font-semibold ${text}`}>{title}</p>
      </div>
      {children}
    </div>
  )
}

function CandidateRow({ c, onClick, children }: { c: any; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors text-left">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
        <p className="text-xs text-gray-400">{(c.job as any)?.title ?? 'No role'} · {c.current_stage}</p>
      </div>
      {children}
      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0"/>
    </button>
  )
}
