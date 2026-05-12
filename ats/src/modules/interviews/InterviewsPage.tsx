// ============================================================
// INTERVIEWS PAGE — Interviewer's focused view
// Improvements: collapsible sections, search, filter by job/stage
// ============================================================
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Loader2, CheckCircle, Clock, ChevronRight,
  ChevronDown, ChevronUp, Search, X
} from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { formatDate } from '../../shared/utils/helpers'
import { PageHeader } from '../../shared/components/PageHeader'

const STAGE_COLOURS: Record<string, string> = {
  Screening:        'bg-blue-100 text-blue-700',
  R1:               'bg-indigo-100 text-indigo-700',
  'Case Study':     'bg-yellow-100 text-yellow-700',
  R2:               'bg-orange-100 text-orange-700',
  R3:               'bg-orange-200 text-orange-800',
  'CF (Virtual)':   'bg-purple-100 text-purple-700',
  'CF (In-Person)': 'bg-purple-200 text-purple-800',
  Applied:          'bg-gray-100 text-gray-700',
  Offer:            'bg-violet-100 text-violet-700',
  Hired:            'bg-green-100 text-green-700',
  Rejected:         'bg-red-100 text-red-700',
}

// ── Collapsible Section ───────────────────────────────────────
function Section({
  title, count, colorClass, defaultOpen = true, children
}: {
  title: string; count: number; colorClass: string
  defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <p className={`text-sm font-semibold ${colorClass}`}>{title}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorClass} bg-opacity-20`}>
            {count}
          </span>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-gray-400"/>
          : <ChevronDown className="w-4 h-4 text-gray-400"/>
        }
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

// ── Candidate Row ─────────────────────────────────────────────
function CandidateRow({
  c, icon, showDate = false
}: {
  c: any; icon: React.ReactNode; showDate?: boolean
}) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(`/candidates/${c.id}`)}
      className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors text-left"
    >
      <div className="flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
        <p className="text-xs text-gray-400">{(c.job as any)?.title ?? 'No role'}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[c.current_stage] ?? 'bg-gray-100 text-gray-600'}`}>
          {c.current_stage}
        </span>
        {showDate && c.interview_date && (
          <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full whitespace-nowrap">
            {formatDate(c.interview_date)}
          </span>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0"/>
    </button>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export function InterviewsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  // Filter state
  const [search, setSearch]       = useState('')
  const [jobFilter, setJobFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['my-interviews', user?.id],
    queryFn: async () => {
      const { data: candidates } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, interview_date, job:jobs(id, title)')
        .contains('assigned_interviewers', [user!.id])
        .eq('status', 'active')
        .order('interview_date', { ascending: true, nullsFirst: false })

      const { data: feedback } = await supabase
        .from('interview_feedback')
        .select('candidate_id')
        .eq('interviewer_id', user!.id)

      const doneIds = new Set((feedback ?? []).map(f => f.candidate_id))
      const all     = candidates ?? []

      const pending   = all.filter(c => !doneIds.has(c.id))
      const completed = all.filter(c =>  doneIds.has(c.id))
      const upcoming  = pending
        .filter(c => c.interview_date)
        .sort((a, b) => new Date(a.interview_date).getTime() - new Date(b.interview_date).getTime())

      // Unique jobs for filter dropdown
      const jobs = Array.from(
        new Map(all.map(c => [(c.job as any)?.id, (c.job as any)?.title]).filter(([id]) => id)).entries()
      ).map(([id, title]) => ({ id, title }))

      // Unique stages
      const stages = Array.from(new Set(all.map(c => c.current_stage))).filter(Boolean)

      return { pending, completed, upcoming, total: all.length, jobs, stages }
    },
    enabled: !!user,
  })

  // Client-side filter applied to all three sections
  const filter = useMemo(() => (list: any[]) => {
    return list.filter(c => {
      const matchSearch = !search ||
        c.full_name.toLowerCase().includes(search.toLowerCase())
      const matchJob = !jobFilter ||
        (c.job as any)?.id === jobFilter
      const matchStage = !stageFilter ||
        c.current_stage === stageFilter
      return matchSearch && matchJob && matchStage
    })
  }, [search, jobFilter, stageFilter])

  const filteredUpcoming  = filter(data?.upcoming  ?? [])
  const filteredPending   = filter(data?.pending   ?? [])
  const filteredCompleted = filter(data?.completed ?? [])
  const hasFilters        = !!(search || jobFilter || stageFilter)

  return (
    <div>
      <PageHeader
        title="My Interviews"
        subtitle={`${data?.total ?? 0} assigned candidates`}
      />

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500"/>
        </div>
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

          {/* Search + Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search candidate name…"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Job filter */}
            <select
              value={jobFilter}
              onChange={e => setJobFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All jobs</option>
              {(data?.jobs ?? []).map(j => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </select>

            {/* Stage filter */}
            <select
              value={stageFilter}
              onChange={e => setStageFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All stages</option>
              {(data?.stages ?? []).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            {/* Clear filters */}
            {hasFilters && (
              <button
                onClick={() => { setSearch(''); setJobFilter(''); setStageFilter('') }}
                className="flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <X className="w-3.5 h-3.5"/> Clear
              </button>
            )}
          </div>

          {/* Filtered empty state */}
          {hasFilters && filteredUpcoming.length === 0 && filteredPending.length === 0 && filteredCompleted.length === 0 && (
            <div className="text-center py-10 text-gray-400 bg-white rounded-xl border border-gray-200">
              <p className="text-sm">No candidates match your filters.</p>
            </div>
          )}

          {/* Upcoming Interviews */}
          {(hasFilters ? filteredUpcoming.length > 0 : (data?.upcoming?.length ?? 0) > 0) && (
            <Section
              title="📅 Upcoming Interviews"
              count={filteredUpcoming.length}
              colorClass="text-blue-700"
              defaultOpen={true}
            >
              {filteredUpcoming.map(c => (
                <CandidateRow
                  key={c.id} c={c} showDate
                  icon={<div className="w-2 h-2 rounded-full bg-blue-400"/>}
                />
              ))}
            </Section>
          )}

          {/* Pending Feedback */}
          {(hasFilters ? filteredPending.length > 0 : (data?.pending?.length ?? 0) > 0) && (
            <Section
              title="⏳ Pending Feedback"
              count={filteredPending.length}
              colorClass="text-amber-700"
              defaultOpen={true}
            >
              {filteredPending.map(c => (
                <CandidateRow
                  key={c.id} c={c}
                  icon={<Clock className="w-4 h-4 text-amber-400"/>}
                />
              ))}
            </Section>
          )}

          {/* Feedback Submitted */}
          {(hasFilters ? filteredCompleted.length > 0 : (data?.completed?.length ?? 0) > 0) && (
            <Section
              title="✅ Feedback Submitted"
              count={filteredCompleted.length}
              colorClass="text-green-700"
              defaultOpen={false}   {/* collapsed by default — out of sight */}
            >
              {filteredCompleted.map(c => (
                <CandidateRow
                  key={c.id} c={c}
                  icon={<CheckCircle className="w-4 h-4 text-green-500"/>}
                />
              ))}
            </Section>
          )}

          {/* Empty state (no candidates at all) */}
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
