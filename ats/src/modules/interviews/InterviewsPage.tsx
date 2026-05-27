// ============================================================
// INTERVIEWS PAGE
// Interviewers: My Interviews list (pending / submitted)
// Admin/HR/Super Admin: Interviews Pending + Interviews Rejected
// ============================================================
import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Loader2, CheckCircle, Clock, Briefcase, Calendar, X, ChevronDown,
  ClipboardList, XCircle, Users,
} from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { formatDateTime } from '../../shared/utils/helpers'
import { PageHeader } from '../../shared/components/PageHeader'

// ─── Date filter types ───────────────────────────────────────
type DateOp =
  | 'any' | 'is' | 'before' | 'after' | 'on_or_before' | 'on_or_after'
  | 'between' | 'today' | 'tomorrow' | 'yesterday'
  | 'last_7' | 'next_7' | 'this_month' | 'empty' | 'not_empty'

const DATE_OP_LABEL: Record<DateOp, string> = {
  any: 'Any date', is: 'Is…', before: 'Is before…', after: 'Is after…',
  on_or_before: 'Is on or before…', on_or_after: 'Is on or after…',
  between: 'Is between…', today: 'Today', tomorrow: 'Tomorrow',
  yesterday: 'Yesterday', last_7: 'In the last 7 days', next_7: 'In the next 7 days',
  this_month: 'This month', empty: 'Is empty', not_empty: 'Is not empty',
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

function matchesDateFilter(iso: string | null, op: DateOp, a: string, b: string): boolean {
  if (op === 'any') return true
  if (op === 'empty') return !iso
  if (op === 'not_empty') return !!iso
  if (!iso) return false
  const d = iso.slice(0, 10)
  const today = ymd(new Date())
  switch (op) {
    case 'is':           return !!a && d === a
    case 'before':       return !!a && d < a
    case 'after':        return !!a && d > a
    case 'on_or_before': return !!a && d <= a
    case 'on_or_after':  return !!a && d >= a
    case 'between':      return !!a && !!b && d >= a && d <= b
    case 'today':        return d === today
    case 'tomorrow':     return d === ymd(addDays(new Date(), 1))
    case 'yesterday':    return d === ymd(addDays(new Date(), -1))
    case 'last_7':       return d >= ymd(addDays(new Date(), -7)) && d <= today
    case 'next_7':       return d >= today && d <= ymd(addDays(new Date(), 7))
    case 'this_month':   return d.slice(0, 7) === today.slice(0, 7)
    default:             return true
  }
}

const STAGE_COLOURS: Record<string, string> = {
  Screening: 'bg-blue-100 text-blue-700',
  R1: 'bg-indigo-100 text-indigo-700',
  'Case Study': 'bg-yellow-100 text-yellow-700',
  R2: 'bg-orange-100 text-orange-700',
  R3: 'bg-orange-200 text-orange-800',
  'CF (Virtual)': 'bg-purple-100 text-purple-700',
  'CF (In-Person)': 'bg-purple-200 text-purple-800',
  Offer: 'bg-violet-100 text-violet-700',
}

// ─── Helpers ─────────────────────────────────────────────────
async function fetchJobsMap(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {}
  const { data } = await supabase.from('jobs').select('id,title').in('id', ids)
  const m: Record<string, string> = {}
  ;(data ?? []).forEach((j: any) => { m[j.id] = j.title })
  return m
}

// ─── Main component ──────────────────────────────────────────
export function InterviewsPage() {
  const { user, hasRole } = useAuthStore()
  const navigate = useNavigate()
  const isInterviewer  = hasRole(['interviewer'])
  const isStaff        = hasRole(['admin', 'super_admin', 'hr_team'])

  return (
    <div>
      {isInterviewer && <InterviewerView user={user} navigate={navigate} />}
      {isStaff       && <StaffView       user={user} navigate={navigate} />}
    </div>
  )
}

// ============================================================
// INTERVIEWER VIEW — My Interviews (pending / submitted)
// ============================================================
function InterviewerView({ user, navigate }: { user: any; navigate: (p: string) => void }) {
  const [filter, setFilter] = useState<'pending' | 'submitted'>('pending')
  const [jobFilter, setJobFilter] = useState('')
  const [dateOp, setDateOp] = useState<DateOp>('any')
  const [dateA, setDateA] = useState('')
  const [dateB, setDateB] = useState('')
  const [dateOpen, setDateOpen] = useState(false)
  const dateRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dateOpen) return
    const h = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [dateOpen])

  const { data, isLoading } = useQuery({
    queryKey: ['my-interviews', user?.id],
    queryFn: async () => {
      const { data: candidates, error } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, interview_date, job_id, status')
        .contains('assigned_interviewers', [user!.id])

      if (error) throw error

      const jobsMap = await fetchJobsMap([...new Set((candidates ?? []).map((c: any) => c.job_id).filter(Boolean))])
      const enriched = (candidates ?? []).map((c: any) => ({
        ...c, job: c.job_id ? { id: c.job_id, title: jobsMap[c.job_id] ?? null } : null,
      }))

      const { data: feedback } = await supabase
        .from('interview_feedback')
        .select('candidate_id, submitted_at')
        .eq('interviewer_id', user!.id)

      const doneMap = new Map((feedback ?? []).map((f: any) => [f.candidate_id, f.submitted_at as string]))

      const active    = enriched.filter((c: any) => c.status === 'active')
      const pending   = active.filter((c: any) => !doneMap.has(c.id))
      const submitted = active.filter((c: any) => doneMap.has(c.id))

      return { all: enriched, doneMap, pending, submitted }
    },
    enabled: !!user,
    staleTime: 0,
  })

  const rawList = filter === 'pending' ? (data?.pending ?? []) : (data?.submitted ?? [])

  const jobOptions = useMemo(() => {
    const m = new Map<string, string>()
    ;(data?.all ?? []).forEach((c: any) => { if (c.job?.id && c.job?.title) m.set(c.job.id, c.job.title) })
    return Array.from(m, ([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title))
  }, [data?.all])

  const displayed = useMemo(() => rawList.filter((c: any) => {
    if (jobFilter && c.job?.id !== jobFilter) return false
    if (!matchesDateFilter(c.interview_date ?? null, dateOp, dateA, dateB)) return false
    return true
  }), [rawList, jobFilter, dateOp, dateA, dateB])

  const pendingCount   = data?.pending.length   ?? 0
  const submittedCount = data?.submitted.length ?? 0

  const clearDate = () => { setDateOp('any'); setDateA(''); setDateB('') }

  const dateChipLabel = (() => {
    if (dateOp === 'any') return 'Interview date'
    if (dateOp === 'between' && dateA && dateB) return `${dateA} → ${dateB}`
    if (['is','before','after','on_or_before','on_or_after'].includes(dateOp) && dateA)
      return `${DATE_OP_LABEL[dateOp].replace('…', '')} ${dateA}`
    return DATE_OP_LABEL[dateOp]
  })()

  return (
    <>
      <PageHeader
        title="My Interviews"
        subtitle={`${data?.all.length ?? 0} assigned · ${pendingCount} pending feedback`}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-4">
        {([['pending', 'Pending Feedback', pendingCount], ['submitted', 'Feedback Submitted', submittedCount]] as const).map(([val, label, count]) => (
          <button key={val} onClick={() => setFilter(val as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === val ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {val === 'pending' ? <Clock className="w-3.5 h-3.5"/> : <CheckCircle className="w-3.5 h-3.5"/>}
            {label}
            {count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                filter === val
                  ? val === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                  : 'bg-gray-200 text-gray-500'
              }`}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg bg-white px-3 py-2">
          <Briefcase className="w-3.5 h-3.5 text-gray-400"/>
          <select value={jobFilter} onChange={e => setJobFilter(e.target.value)}
            className="text-sm bg-transparent border-none outline-none text-gray-700 cursor-pointer pr-1 max-w-[200px]">
            <option value="">All jobs</option>
            {jobOptions.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>
        {(jobFilter || dateOp !== 'any') && (
          <button onClick={() => { setJobFilter(''); clearDate() }}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg hover:bg-gray-50">
            <X className="w-3.5 h-3.5"/> Clear filters
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto mr-2">Showing {displayed.length} of {rawList.length}</span>
        <DateFilterButton dateOp={dateOp} dateA={dateA} dateB={dateB} label={dateChipLabel}
          open={dateOpen} setOpen={setDateOpen} setDateOp={setDateOp} setDateA={setDateA}
          setDateB={setDateB} clearDate={clearDate} dateRef={dateRef}/>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
      ) : displayed.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-16">
          <CheckCircle className="w-8 h-8 mb-2 text-green-400"/>
          <p className="text-sm font-medium text-gray-600">{filter === 'pending' ? 'All caught up!' : 'No submissions yet.'}</p>
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
                {filter === 'submitted' && <th className="text-left px-4 py-3 font-medium">Submitted At</th>}
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayed.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50/40 transition-colors">
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/candidates/${c.id}`)}
                      className="font-medium text-blue-600 hover:underline text-left">{c.full_name}</button>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{c.job?.title ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[c.current_stage] ?? 'bg-gray-100 text-gray-600'}`}>
                      {c.current_stage}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                    {c.interview_date ? formatDateTime(c.interview_date) : <span className="text-gray-300">—</span>}
                  </td>
                  {filter === 'submitted' && (
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {data?.doneMap.get(c.id) ? formatDateTime(data.doneMap.get(c.id)!) : '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => navigate(`/candidates/${c.id}`)}
                      className="text-xs px-3 py-1.5 border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 rounded-lg transition-colors">
                      {filter === 'pending' ? 'Add Notes & Decide' : 'View Profile'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
            <p className="text-xs text-gray-400">Click "Add Notes & Decide" to open the candidate profile and submit your decision</p>
          </div>
        </div>
      )}
    </>
  )
}

// ============================================================
// STAFF VIEW — Interviews Pending + Interviews Rejected (Admin/HR/Super Admin)
// ============================================================
type StaffTab = 'pending' | 'rejected'

function StaffView({ user, navigate }: { user: any; navigate: (p: string) => void }) {
  const [tab, setTab] = useState<StaffTab>('pending')

  // Pending = active candidates whose interview_date is null (cleared after decision)
  // AND who have at least one assigned_interviewer (i.e., were actively being interviewed)
  // Rejected = status = 'rejected'
  const { data: pendingCandidates = [], isLoading: loadingPending } = useQuery({
    queryKey: ['staff-interviews-pending'],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, job_id, assigned_interviewers, updated_at, status')
        .eq('status', 'active')
        .is('interview_date', null)
        .not('assigned_interviewers', 'eq', '{}')
        .not('assigned_interviewers', 'is', null)
        .order('updated_at', { ascending: false })
      if (!data?.length) return []
      const jobsMap = await fetchJobsMap([...new Set((data).map((c: any) => c.job_id).filter(Boolean))])
      const userIds = [...new Set(data.flatMap((c: any) => c.assigned_interviewers ?? []))]
      const usersMap: Record<string, string> = {}
      if (userIds.length) {
        const { data: users } = await supabase.from('users').select('id, full_name').in('id', userIds)
        ;(users ?? []).forEach((u: any) => { usersMap[u.id] = u.full_name })
      }
      return data.map((c: any) => ({
        ...c,
        jobTitle: jobsMap[c.job_id] ?? null,
        interviewerNames: (c.assigned_interviewers ?? []).map((uid: string) => usersMap[uid] ?? uid).join(', '),
      }))
    },
    staleTime: 0,
  })

  const { data: rejectedCandidates = [], isLoading: loadingRejected } = useQuery({
    queryKey: ['staff-interviews-rejected'],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, job_id, assigned_interviewers, updated_at')
        .eq('status', 'rejected')
        .not('assigned_interviewers', 'eq', '{}')
        .not('assigned_interviewers', 'is', null)
        .order('updated_at', { ascending: false })
      if (!data?.length) return []
      const jobsMap = await fetchJobsMap([...new Set(data.map((c: any) => c.job_id).filter(Boolean))])
      const userIds = [...new Set(data.flatMap((c: any) => c.assigned_interviewers ?? []))]
      const usersMap: Record<string, string> = {}
      if (userIds.length) {
        const { data: users } = await supabase.from('users').select('id, full_name').in('id', userIds)
        ;(users ?? []).forEach((u: any) => { usersMap[u.id] = u.full_name })
      }
      return data.map((c: any) => ({
        ...c,
        jobTitle: jobsMap[c.job_id] ?? null,
        interviewerNames: (c.assigned_interviewers ?? []).map((uid: string) => usersMap[uid] ?? uid).join(', '),
      }))
    },
    staleTime: 0,
  })

  const isLoading = tab === 'pending' ? loadingPending : loadingRejected
  const list      = tab === 'pending' ? pendingCandidates : rejectedCandidates

  return (
    <>
      <PageHeader
        title="Interviews"
        subtitle={`${pendingCandidates.length} pending schedule · ${rejectedCandidates.length} rejected`}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-4">
        <button onClick={() => setTab('pending')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'pending' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}>
          <ClipboardList className="w-3.5 h-3.5"/>
          Interviews Pending
          {pendingCandidates.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
              tab === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'
            }`}>{pendingCandidates.length}</span>
          )}
        </button>
        <button onClick={() => setTab('rejected')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'rejected' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}>
          <XCircle className="w-3.5 h-3.5"/>
          Interviews Rejected
          {rejectedCandidates.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
              tab === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-500'
            }`}>{rejectedCandidates.length}</span>
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-indigo-500"/></div>
      ) : list.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-16">
          {tab === 'pending'
            ? <><ClipboardList className="w-8 h-8 mb-2 text-gray-200"/><p className="text-sm font-medium text-gray-500">No interviews pending scheduling</p><p className="text-xs text-gray-400 mt-1">When interviewers select candidates for the next round, they'll appear here.</p></>
            : <><XCircle className="w-8 h-8 mb-2 text-gray-200"/><p className="text-sm font-medium text-gray-500">No rejected candidates</p></>
          }
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {tab === 'pending' && (
            <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
              <ClipboardList className="w-3.5 h-3.5 text-amber-600"/>
              <p className="text-xs text-amber-700 font-medium">These candidates were selected for the next round by their interviewer. Schedule their next interview.</p>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Candidate</th>
                <th className="text-left px-4 py-3 font-medium">Job</th>
                <th className="text-left px-4 py-3 font-medium">{tab === 'pending' ? 'Next Stage' : 'Rejected At Stage'}</th>
                <th className="text-left px-4 py-3 font-medium"><div className="flex items-center gap-1"><Users className="w-3 h-3"/>Interviewer(s)</div></th>
                <th className="text-left px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium text-right"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {list.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50/40 transition-colors">
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/candidates/${c.id}`)}
                      className="font-medium text-blue-600 hover:underline text-left">{c.full_name}</button>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{c.jobTitle ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      tab === 'rejected'
                        ? 'bg-red-100 text-red-700'
                        : STAGE_COLOURS[c.current_stage] ?? 'bg-gray-100 text-gray-600'
                    }`}>
                      {c.current_stage}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{c.interviewerNames || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {c.updated_at ? formatDateTime(c.updated_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => navigate(`/candidates/${c.id}`)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                        tab === 'pending'
                          ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                          : 'border border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}>
                      {tab === 'pending' ? 'Schedule Interview' : 'View Profile'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
            <p className="text-xs text-gray-400">{list.length} candidate{list.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Date Filter Button (shared) ─────────────────────────────
function DateFilterButton({ dateOp, dateA, dateB, label, open, setOpen, setDateOp, setDateA, setDateB, clearDate, dateRef }: {
  dateOp: DateOp; dateA: string; dateB: string; label: string; open: boolean
  setOpen: (v: boolean) => void; setDateOp: (v: DateOp) => void
  setDateA: (v: string) => void; setDateB: (v: string) => void
  clearDate: () => void; dateRef: React.RefObject<HTMLDivElement>
}) {
  return (
    <div className="relative" ref={dateRef}>
      <button onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm transition-colors ${
          dateOp !== 'any' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
        }`}>
        <Calendar className="w-3.5 h-3.5"/>
        <span className="max-w-[200px] truncate">{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}/>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Interview Date</p>
            {dateOp !== 'any' && (
              <button onClick={clearDate} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-0.5">
                <X className="w-3 h-3"/> Reset
              </button>
            )}
          </div>
          <select value={dateOp} onChange={e => {
            const op = e.target.value as DateOp
            setDateOp(op)
            if (op !== 'between') setDateB('')
            if (['any','today','tomorrow','yesterday','last_7','next_7','this_month','empty','not_empty'].includes(op)) {
              setDateA(''); setDateB('')
            }
          }} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 mb-2 bg-white">
            <optgroup label="Filter">
              {(['any','is','before','after','on_or_before','on_or_after','between'] as DateOp[]).map(op => (
                <option key={op} value={op}>{DATE_OP_LABEL[op]}</option>
              ))}
            </optgroup>
            <optgroup label="Quick presets">
              {(['today','tomorrow','yesterday','last_7','next_7','this_month'] as DateOp[]).map(op => (
                <option key={op} value={op}>{DATE_OP_LABEL[op]}</option>
              ))}
            </optgroup>
          </select>
          {['is','before','after','on_or_before','on_or_after','between'].includes(dateOp) && (
            <div className="flex items-center gap-2">
              <input type="date" value={dateA} onChange={e => setDateA(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5"/>
              {dateOp === 'between' && (
                <><span className="text-xs text-gray-400">to</span>
                  <input type="date" value={dateB} onChange={e => setDateB(e.target.value)}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5"/></>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
