// Replace your entire InterviewsPage component with this

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, CheckCircle, Clock, ChevronRight, ChevronDown, ChevronUp, Search, X, Edit2 } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { formatDate } from '../../shared/utils/helpers'
import { PageHeader } from '../../shared/components/PageHeader'

const STAGE_COLOURS: Record<string, string> = {
  Screening: 'bg-blue-100 text-blue-700',
  R1: 'bg-indigo-100 text-indigo-700',
  'Case Study': 'bg-yellow-100 text-yellow-700',
  R2: 'bg-orange-100 text-orange-700',
  R3: 'bg-orange-200 text-orange-800',
  'CF (Virtual)': 'bg-purple-100 text-purple-700',
  'CF (In-Person)': 'bg-purple-200 text-purple-800',
  Applied: 'bg-gray-100 text-gray-700',
  Offer: 'bg-violet-100 text-violet-700',
  Hired: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
}

function Section({ title, count, colorClass, defaultOpen = true, children }: { title: string; count: number; colorClass: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-semibold ${colorClass}`}>{title}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorClass} bg-opacity-20`}>{count}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400"/> : <ChevronDown className="w-4 h-4 text-gray-400"/>}
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

function CandidateRow({ c, icon, showDate = false, isCompleted = false }: { c: any; icon: React.ReactNode; showDate?: boolean; isCompleted?: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors">
      <div className="flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/candidates/${c.id}`)}>
        <p className="text-sm font-medium text-gray-900 hover:underline">{c.full_name}</p>
        <p className="text-xs text-gray-400">{(c.job as any)?.title ?? 'No role'}</p>
      </div>
      <div className="flex items-center gap-4 flex-shrink-0">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[c.current_stage] ?? 'bg-gray-100 text-gray-600'}`}>
          {c.current_stage}
        </span>
        {showDate && c.interview_date && (
          <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full whitespace-nowrap">
            {formatDate(c.interview_date)}
          </span>
        )}
        {/* NEW LOGIC: Edit button for submitted feedback */}
        {isCompleted ? (
          <button 
            onClick={() => navigate(`/candidates/${c.id}?edit=true`)}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-blue-600 border border-gray-200 px-3 py-1.5 rounded-lg bg-white"
          >
            <Edit2 className="w-3.5 h-3.5"/> Edit
          </button>
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0 cursor-pointer" onClick={() => navigate(`/candidates/${c.id}`)}/>
        )}
      </div>
    </div>
  )
}

export function InterviewsPage() {
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  
  const { data, isLoading } = useQuery({
    queryKey: ['my-interviews', user?.id],
    queryFn: async () => {
      const { data: candidates } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, interview_date, assigned_interviewers, job:jobs(id, title)')
        .contains('assigned_interviewers', [user!.id])
        .is('archived_at', null)
        .order('interview_date', { ascending: true, nullsFirst: false })

      const { data: feedback } = await supabase
        .from('interview_feedback')
        .select('candidate_id')
        .eq('interviewer_id', user!.id)

      const doneIds = new Set((feedback ?? []).map((f: any) => f.candidate_id))
      const all = candidates ?? []

      const completed = all.filter(c => doneIds.has(c.id))
      const pending = all.filter(c => !doneIds.has(c.id))
      const upcoming = pending.filter(c => c.interview_date).sort((a, b) => new Date(a.interview_date!).getTime() - new Date(b.interview_date!).getTime())

      return { pending, completed, upcoming, total: all.length }
    },
    enabled: !!user,
  })

  const filteredUpcoming = data?.upcoming.filter(c => c.full_name.toLowerCase().includes(search.toLowerCase())) ?? []
  const filteredPending = data?.pending.filter(c => c.full_name.toLowerCase().includes(search.toLowerCase())) ?? []
  const filteredCompleted = data?.completed.filter(c => c.full_name.toLowerCase().includes(search.toLowerCase())) ?? []

  return (
    <div>
      <PageHeader title="My Interviews" subtitle={`${data?.total ?? 0} assigned candidates`} />
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
      ) : (
        <div className="space-y-5">
          {/* REMOVED AVG SCORE CARD */}
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
              <p className="text-sm text-gray-500 mt-1">Feedback submitted</p>
            </div>
          </div>

          <div className="relative flex-1 min-w-48 mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search candidate name…" className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {filteredUpcoming.length > 0 && (
            <Section title="📅 Upcoming Interviews" count={filteredUpcoming.length} colorClass="text-blue-700" defaultOpen={true}>
              {filteredUpcoming.map(c => <CandidateRow key={c.id} c={c} showDate icon={<div className="w-2 h-2 rounded-full bg-blue-400"/>} />)}
            </Section>
          )}

          {filteredPending.length > 0 && (
            <Section title="⏳ Pending Feedback" count={filteredPending.length} colorClass="text-amber-700" defaultOpen={true}>
              {filteredPending.map(c => <CandidateRow key={c.id} c={c} icon={<Clock className="w-4 h-4 text-amber-400"/>} />)}
            </Section>
          )}

          {filteredCompleted.length > 0 && (
            <Section title="✅ Feedback Submitted" count={filteredCompleted.length} colorClass="text-green-700" defaultOpen={false}>
              {filteredCompleted.map(c => <CandidateRow key={c.id} c={c} isCompleted={true} icon={<CheckCircle className="w-4 h-4 text-green-500"/>} />)}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
