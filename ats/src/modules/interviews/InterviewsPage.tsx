// ============================================================
// INTERVIEWS PAGE — Table view matching CandidatesPage style
// Feedback state managed via interview_feedback table
// ============================================================
import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, CheckCircle, Clock, Briefcase, Calendar, X, ChevronDown, UserCheck, UserX, ArrowRight, Search } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { formatDateTime } from '../../shared/utils/helpers'
import { PageHeader } from '../../shared/components/PageHeader'
import { useStages } from '../../shared/hooks/useStages'

type FeedbackFilter = 'pending' | 'submitted'
type AdminTab = 'to_schedule' | 'scheduled' | 'rejected'

const INTERVIEW_STAGE_LIST = ['Screening', 'R1', 'Case Study', 'R2', 'R3', 'CF (Virtual)', 'CF (In-Person)']

// ─── Airtable-style date filter ──────────────────────────────
type DateOp =
  | 'any' | 'is' | 'before' | 'after' | 'on_or_before' | 'on_or_after'
  | 'between' | 'today' | 'tomorrow' | 'yesterday'
  | 'last_7' | 'next_7' | 'this_month' | 'empty' | 'not_empty'

const DATE_OP_LABEL: Record<DateOp, string> = {
  any:          'Any date',
  is:           'Is…',
  before:       'Is before…',
  after:        'Is after…',
  on_or_before: 'Is on or before…',
  on_or_after:  'Is on or after…',
  between:      'Is between…',
  today:        'Today',
  tomorrow:     'Tomorrow',
  yesterday:    'Yesterday',
  last_7:       'In the last 7 days',
  next_7:       'In the next 7 days',
  this_month:   'This month',
  empty:        'Is empty',
  not_empty:    'Is not empty',
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

// Normalize a filter value (date "2026-05-27" or datetime-local "2026-05-27T16:30")
// to a comparable string. DB values are ISO UTC; convert to local datetime-local format for comparison.
function toLocalDT(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function toLocalDate(iso: string): string { return toLocalDT(iso).slice(0, 10) }

function matchesDateFilter(iso: string | null, op: DateOp, a: string, b: string): boolean {
  if (op === 'any')        return true
  if (op === 'empty')      return !iso
  if (op === 'not_empty')  return !!iso
  if (!iso)                return false
  // If filter value contains time, compare full datetime-local; otherwise compare date-only
  const hasTime = (v: string) => v.includes('T') && v.length > 10
  const cmpVal  = hasTime(a) || hasTime(b) ? toLocalDT(iso) : toLocalDate(iso)
  const today   = ymd(new Date())
  switch (op) {
    case 'is':            return !!a && cmpVal === a
    case 'before':        return !!a && cmpVal <  a
    case 'after':         return !!a && cmpVal >  a
    case 'on_or_before':  return !!a && cmpVal <= a
    case 'on_or_after':   return !!a && cmpVal >= a
    case 'between':       return !!a && !!b && cmpVal >= a && cmpVal <= b
    case 'today':         return toLocalDate(iso) === today
    case 'tomorrow':      return toLocalDate(iso) === ymd(addDays(new Date(), 1))
    case 'yesterday':     return toLocalDate(iso) === ymd(addDays(new Date(), -1))
    case 'last_7':        return toLocalDate(iso) >= ymd(addDays(new Date(), -7)) && toLocalDate(iso) <= today
    case 'next_7':        return toLocalDate(iso) >= today && toLocalDate(iso) <= ymd(addDays(new Date(), 7))
    case 'this_month':    return toLocalDate(iso).slice(0, 7) === today.slice(0, 7)
    default:              return true
  }
}

export function InterviewsPage() {
  const { user, hasRole } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isInterviewer = hasRole(['interviewer'])

  const { stageConfigs } = useStages()
  const stageColour = (name: string) => {
    const cfg = stageConfigs.find(s => s.name === name)
    return cfg ? `${cfg.color} ${cfg.textColor}` : 'bg-gray-100 text-gray-600'
  }
  const [filter, setFilter]     = useState<FeedbackFilter>('pending')
  const [adminTab, setAdminTab] = useState<AdminTab>('to_schedule')
  const [searchQuery, setSearchQuery] = useState('')
  const [adminSearch, setAdminSearch]           = useState('')
  const [adminJobFilter, setAdminJobFilter]     = useState('')
  const [adminStageFilter, setAdminStageFilter] = useState('')
  const [adminPanelFilter, setAdminPanelFilter] = useState('')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [jobFilter, setJobFilter]     = useState<string>('')
  const [dateOp,    setDateOp]        = useState<DateOp>('any')
  const [dateA,     setDateA]         = useState<string>('')
  const [dateB,     setDateB]         = useState<string>('')
  const [dateOpen,  setDateOpen]      = useState(false)
  const dateRef = useRef<HTMLDivElement>(null)

  // Close the date popover on outside click
  useEffect(() => {
    if (!dateOpen) return
    const onClick = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [dateOpen])

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['my-interviews', user?.id],
    queryFn: async () => {
      // Fetch all candidates assigned to me
      const { data: candidates, error: cErr } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, interview_date, job_id')
        .contains('assigned_interviewers', [user!.id])
        .eq('status', 'active')

      if (cErr) throw cErr

      // Fetch job titles separately (no join needed)
      const jobIds = [...new Set((candidates ?? []).map(c => c.job_id).filter(Boolean))]
      const jobsMap: Record<string, string> = {}
      if (jobIds.length) {
        const { data: jobs } = await supabase.from('jobs').select('id,title').in('id', jobIds)
        ;(jobs ?? []).forEach(j => { jobsMap[j.id] = j.title })
      }

      // Attach job title + id to each candidate
      const candidatesWithJob = (candidates ?? []).map(c => ({
        ...c,
        job: c.job_id ? { id: c.job_id, title: jobsMap[c.job_id] ?? null } : null,
      }))

      // Fetch my submitted feedback
      const { data: feedback, error: fErr } = await supabase
        .from('interview_feedback')
        .select('candidate_id, submitted_at')
        .eq('interviewer_id', user!.id)

      if (fErr) throw fErr

      const doneMap = new Map((feedback ?? []).map(f => [f.candidate_id, f.submitted_at as string]))

      // Pending/submitted must use the enriched list so the Job column renders
      return {
        all: candidatesWithJob,
        doneMap,
        pending:   candidatesWithJob.filter(c => !doneMap.has(c.id)),
        submitted: candidatesWithJob.filter(c =>  doneMap.has(c.id)),
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

  // Admin / HR view — any-approver logic + candidates-with-date for scheduled
  const { data: adminData, isLoading: adminLoading } = useQuery({
    queryKey: ['admin-interviews-v2'],
    queryFn: async () => {
      // All feedbacks (yes/no), not just latest per candidate
      const { data: allFeedbacks } = await supabase
        .from('interview_feedback')
        .select('candidate_id, stage, recommendation, submitted_at, interviewer_id')
        .in('recommendation', ['yes', 'no'])
        .order('submitted_at', { ascending: false })

      // Group ALL feedbacks by candidate; track which have any 'yes'
      const feedbackByCand = new Map<string, any[]>()
      const approvalsByCand = new Map<string, any[]>()
      for (const f of allFeedbacks ?? []) {
        if (!feedbackByCand.has(f.candidate_id)) feedbackByCand.set(f.candidate_id, [])
        feedbackByCand.get(f.candidate_id)!.push(f)
        if (f.recommendation === 'yes') {
          if (!approvalsByCand.has(f.candidate_id)) approvalsByCand.set(f.candidate_id, [])
          approvalsByCand.get(f.candidate_id)!.push(f)
        }
      }

      const feedbackCandIds = [...feedbackByCand.keys()]

      // Also fetch candidates with interview_date set (may have no feedback yet)
      const { data: scheduledCands } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, interview_date, job_id, assigned_interviewers')
        .not('interview_date', 'is', null)
        .eq('status', 'active')

      const scheduledIds = (scheduledCands ?? []).map((c: any) => c.id)
      const allCandIds = [...new Set([...feedbackCandIds, ...scheduledIds])]
      if (!allCandIds.length) return { toSchedule: [], scheduled: [], rejected: [] }

      const { data: candidates } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage, interview_date, job_id, assigned_interviewers')
        .in('id', allCandIds)

      const candidateMap = Object.fromEntries((candidates ?? []).map((c: any) => [c.id, c]))

      const jobIds     = [...new Set((candidates ?? []).map((c: any) => c.job_id).filter(Boolean))]
      const panelIds   = [...new Set((candidates ?? []).flatMap((c: any) => c.assigned_interviewers ?? []))]
      const reviewerIds= [...new Set((allFeedbacks ?? []).map((f: any) => f.interviewer_id))]
      const allUserIds = [...new Set([...panelIds, ...reviewerIds])]

      const [{ data: jobs }, { data: users }] = await Promise.all([
        jobIds.length     ? supabase.from('jobs').select('id,title').in('id', jobIds)       : { data: [] as any[] },
        allUserIds.length ? supabase.from('users').select('id,full_name').in('id', allUserIds) : { data: [] as any[] },
      ])

      const jobMap  = Object.fromEntries((jobs  ?? []).map((j: any) => [j.id, j.title]))
      const userMap = Object.fromEntries((users ?? []).map((u: any) => [u.id, u.full_name]))

      const enrichCand = (c: any, approvals?: any[]) => {
        const latest = approvals?.[0] ?? feedbackByCand.get(c.id)?.[0]
        return {
          id:            c.id,
          full_name:     c.full_name ?? '—',
          current_stage: c.current_stage ?? '—',
          interview_date:c.interview_date ?? null,
          job_id:        c.job_id ?? null,
          jobTitle:      jobMap[c.job_id] ?? '—',
          panelNames:    ((c.assigned_interviewers ?? []) as string[]).map((uid: string) => userMap[uid]).filter(Boolean) as string[],
          feedbackStage: latest?.stage ?? c.current_stage,
          feedbackAt:    latest?.submitted_at ?? null,
          reviewerName:  latest ? (userMap[latest.interviewer_id] ?? '—') : '—',
          // ALL names who gave 'yes' — displayed in "Approved By" column
          approvedBy:    (approvals ?? []).map((f: any) => userMap[f.interviewer_id]).filter(Boolean) as string[],
        }
      }

      const toSchedule: any[] = []
      const scheduled:  any[] = []
      const rejected:   any[] = []

      const seen = new Set<string>()

      for (const c of candidates ?? []) {
        seen.add(c.id)
        const stage = (c.current_stage ?? '') as string
        const isRejected = stage === 'Rejected' || stage.endsWith(' Rejected')

        if (isRejected) {
          rejected.push(enrichCand(c))
          continue
        }

        if (c.interview_date) {
          scheduled.push(enrichCand(c, approvalsByCand.get(c.id)))
          continue
        }

        // Any 'yes' feedback → To be Scheduled
        if (approvalsByCand.has(c.id)) {
          toSchedule.push(enrichCand(c, approvalsByCand.get(c.id)))
        }
      }

      return { toSchedule, scheduled, rejected }
    },
    enabled: !isInterviewer && !!user,
    staleTime: 30_000,
  })

  const { data: allAdminJobs = [] } = useQuery({
    queryKey: ['jobs-for-admin-filter'],
    queryFn: async () => {
      const { data } = await supabase.from('jobs').select('id,title').order('title')
      return data ?? []
    },
    enabled: !isInterviewer,
  })

  const { data: allAdminInterviewers = [] } = useQuery({
    queryKey: ['interviewers-for-admin-filter'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name').eq('role','interviewer').eq('is_active',true).order('full_name')
      return data ?? []
    },
    enabled: !isInterviewer,
  })

  const rawList = filter === 'pending' ? (data?.pending ?? []) : (data?.submitted ?? [])

  // Distinct jobs across ALL assigned candidates (so the dropdown stays stable
  // when toggling between pending / submitted)
  const jobOptions = useMemo(() => {
    const map = new Map<string, string>()
    ;(data?.all ?? []).forEach((c: any) => {
      if (c.job?.id && c.job?.title) map.set(c.job.id, c.job.title)
    })
    return Array.from(map, ([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [data?.all])

  // Apply job + interview_date filters
  const displayed = useMemo(() => {
    return rawList.filter((c: any) => {
      if (searchQuery && !c.full_name.toLowerCase().includes(searchQuery.toLowerCase())) return false
      if (jobFilter && c.job?.id !== jobFilter) return false
      if (!matchesDateFilter(c.interview_date ?? null, dateOp, dateA, dateB)) return false
      return true
    })
  }, [rawList, searchQuery, jobFilter, dateOp, dateA, dateB])

  const pendingCount   = data?.pending.length   ?? 0
  const submittedCount = data?.submitted.length ?? 0
  const hasActiveFilters = !!(searchQuery || jobFilter || dateOp !== 'any')

  // Short chip label — format datetime-local "2026-05-27T16:30" as "27 May, 4:30 pm"
  const fmtFilterDT = (v: string) => {
    if (!v) return ''
    const d = new Date(v)
    if (isNaN(d.getTime())) return v
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
  }
  const dateChipLabel = (() => {
    if (dateOp === 'any')                       return 'Interview date'
    if (dateOp === 'between' && dateA && dateB) return `${fmtFilterDT(dateA)} → ${fmtFilterDT(dateB)}`
    if (['is','before','after','on_or_before','on_or_after'].includes(dateOp) && dateA) {
      return `${DATE_OP_LABEL[dateOp].replace('…','')} ${fmtFilterDT(dateA)}`
    }
    return DATE_OP_LABEL[dateOp]
  })()

  const clearDate = () => { setDateOp('any'); setDateA(''); setDateB('') }

  const toggleSel = (id: string) =>
    setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () =>
    setSelectedIds(selectedIds.size === displayed.length ? new Set() : new Set(displayed.map(c => c.id)))

  return (
    <div>
      <PageHeader
        title={isInterviewer ? 'My Interviews' : 'Interview Reviews'}
        subtitle={isInterviewer
          ? `${data?.all.length ?? 0} assigned · ${pendingCount} pending feedback`
          : `${adminData?.toSchedule.length ?? 0} to schedule · ${adminData?.scheduled.length ?? 0} scheduled · ${adminData?.rejected.length ?? 0} rejected`
        }
      />

      {/* Interviewer section — only show for interviewers */}
      {isInterviewer && <>
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

      </div>

      {/* Filter bar — Search + Job + Interview Date range */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg bg-white px-3 py-2 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search candidates…"
            className="text-sm bg-transparent border-none outline-none text-gray-700 min-w-[140px]"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-gray-300 hover:text-gray-500 flex-shrink-0">
              <X className="w-3.5 h-3.5"/>
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg bg-white px-3 py-2">
          <Briefcase className="w-3.5 h-3.5 text-gray-400"/>
          <select
            value={jobFilter}
            onChange={e => { setJobFilter(e.target.value) }}
            className="text-sm bg-transparent border-none outline-none text-gray-700 cursor-pointer pr-1 max-w-[200px]"
          >
            <option value="">All jobs</option>
            {jobOptions.map(j => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
        </div>

        {hasActiveFilters && (
          <button
            onClick={() => { setSearchQuery(''); setJobFilter(''); clearDate() }}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg hover:bg-gray-50"
          >
            <X className="w-3.5 h-3.5"/> Clear filters
          </button>
        )}

        <span className="text-xs text-gray-400 ml-auto mr-2">
          Showing {displayed.length} of {rawList.length}
        </span>

        {/* ───── Airtable-style Interview Date filter (at the end) ───── */}
        <div className="relative" ref={dateRef}>
          <button
            onClick={() => setDateOpen(o => !o)}
            className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm transition-colors ${
              dateOp !== 'any'
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
            }`}
          >
            <Calendar className="w-3.5 h-3.5"/>
            <span className="max-w-[200px] truncate">{dateChipLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${dateOpen ? 'rotate-180' : ''}`}/>
          </button>

          {dateOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Interview Date</p>
                {dateOp !== 'any' && (
                  <button onClick={clearDate} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-0.5">
                    <X className="w-3 h-3"/> Reset
                  </button>
                )}
              </div>

              {/* Always-visible datetime input — sets "is" filter directly */}
              <div>
                <p className="text-[10px] text-gray-400 mb-1">Pick exact date &amp; time</p>
                <input
                  type="datetime-local"
                  value={['is','any'].includes(dateOp) ? dateA : ''}
                  onChange={e => {
                    setDateA(e.target.value)
                    setDateOp(e.target.value ? 'is' : 'any')
                    setDateB('')
                    setSelectedIds(new Set())
                  }}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {/* Quick preset chips */}
              <div>
                <p className="text-[10px] text-gray-400 mb-1.5">Quick presets</p>
                <div className="flex flex-wrap gap-1">
                  {(['today','tomorrow','last_7','next_7','this_month'] as DateOp[]).map(op => (
                    <button
                      key={op}
                      onClick={() => { setDateOp(op); setDateA(''); setDateB(''); setSelectedIds(new Set()) }}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                        dateOp === op
                          ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {DATE_OP_LABEL[op]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced range filter */}
              <details className="group">
                <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600 list-none flex items-center gap-1">
                  <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform"/> Advanced (before / after / range)
                </summary>
                <div className="mt-2 space-y-2">
                  <select
                    value={dateOp}
                    onChange={e => {
                      const op = e.target.value as DateOp
                      setDateOp(op)
                      if (op !== 'between') setDateB('')
                      if (['any','today','tomorrow','yesterday','last_7','next_7','this_month','empty','not_empty'].includes(op)) {
                        setDateA(''); setDateB('')
                      }
                    }}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                  >
                    {(['any','before','after','on_or_before','on_or_after','between','empty','not_empty'] as DateOp[]).map(op => (
                      <option key={op} value={op}>{DATE_OP_LABEL[op]}</option>
                    ))}
                  </select>
                  {['before','after','on_or_before','on_or_after','between'].includes(dateOp) && (
                    <div className="flex flex-col gap-2">
                      <input
                        type="datetime-local"
                        value={dateA}
                        onChange={e => { setDateA(e.target.value); setSelectedIds(new Set()) }}
                        className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                      />
                      {dateOp === 'between' && (
                        <>
                          <span className="text-xs text-gray-400 text-center">to</span>
                          <input
                            type="datetime-local"
                            value={dateB}
                            onChange={e => { setDateB(e.target.value); setSelectedIds(new Set()) }}
                            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>

      {/* Regular interview feedback view */}
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
                <th className="text-left px-4 py-3 font-medium">Candidate</th>
                <th className="text-left px-4 py-3 font-medium">Job</th>
                <th className="text-left px-4 py-3 font-medium">Stage</th>
                <th className="text-left px-4 py-3 font-medium">Interview Date</th>
                {filter === 'submitted' && (
                  <th className="text-left px-4 py-3 font-medium">Decision Date</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayed.map((c: any) => {
                const submittedAt = data?.doneMap.get(c.id)

                return (
                  <tr key={c.id}
                    className="hover:bg-gray-50/40 transition-colors cursor-pointer"
                    onClick={() => navigate(`/candidates/${c.id}`)}>

                    {/* Name */}
                    <td className="px-4 py-3">
                      <span className="font-medium text-blue-600 text-sm">{c.full_name}</span>
                    </td>

                    {/* Job */}
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {c.job?.title ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Stage */}
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stageColour(c.current_stage)}`}>
                        {c.current_stage}
                      </span>
                    </td>

                    {/* Interview Date */}
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {c.interview_date ? formatDateTime(c.interview_date) : <span className="text-gray-300">—</span>}
                    </td>

                    {/* Decision Date (submitted tab only) */}
                    {filter === 'submitted' && (
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {submittedAt ? formatDateTime(submittedAt) : '—'}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>

    {/* Footer */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              {filter === 'pending'
                ? `${displayed.length} candidate${displayed.length !== 1 ? 's' : ''} awaiting your decision — click a name to open their profile`
                : `${submittedCount} decision${submittedCount !== 1 ? 's' : ''} submitted`
              }
            </p>
          </div>
        </div>
      )}

      </>}

      {/* Admin / HR Manager view */}
      {!isInterviewer && (
        <div>
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl mb-4 w-fit">
            <button
              onClick={() => setAdminTab('to_schedule')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                adminTab === 'to_schedule' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Clock className="w-3.5 h-3.5"/>
              To be Scheduled
              {(adminData?.toSchedule.length ?? 0) > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${adminTab === 'to_schedule' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'}`}>
                  {adminData!.toSchedule.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setAdminTab('scheduled')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                adminTab === 'scheduled' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Calendar className="w-3.5 h-3.5"/>
              Interviews Scheduled
              {(adminData?.scheduled.length ?? 0) > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${adminTab === 'scheduled' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'}`}>
                  {adminData!.scheduled.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setAdminTab('rejected')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                adminTab === 'rejected' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <UserX className="w-3.5 h-3.5"/>
              Interview Rejects
              {(adminData?.rejected.length ?? 0) > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${adminTab === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-500'}`}>
                  {adminData!.rejected.length}
                </span>
              )}
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg bg-white px-3 py-2 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
              <input
                type="text"
                value={adminSearch}
                onChange={e => setAdminSearch(e.target.value)}
                placeholder="Search candidates…"
                className="text-sm bg-transparent border-none outline-none text-gray-700 min-w-[120px]"
              />
              {adminSearch && (
                <button onClick={() => setAdminSearch('')} className="text-gray-300 hover:text-gray-500">
                  <X className="w-3.5 h-3.5"/>
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg bg-white px-3 py-2">
              <Briefcase className="w-3.5 h-3.5 text-gray-400"/>
              <select value={adminJobFilter} onChange={e => setAdminJobFilter(e.target.value)}
                className="text-sm bg-transparent border-none outline-none text-gray-700 cursor-pointer max-w-[180px]">
                <option value="">All jobs</option>
                {(allAdminJobs as any[]).map((j: any) => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
            </div>
            <select value={adminStageFilter} onChange={e => setAdminStageFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none text-gray-700">
              <option value="">All stages</option>
              {INTERVIEW_STAGE_LIST.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={adminPanelFilter} onChange={e => setAdminPanelFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none text-gray-700">
              <option value="">All panel</option>
              {(allAdminInterviewers as any[]).map((u: any) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
            </select>
            {(adminSearch || adminJobFilter || adminStageFilter || adminPanelFilter) && (
              <button
                onClick={() => { setAdminSearch(''); setAdminJobFilter(''); setAdminStageFilter(''); setAdminPanelFilter('') }}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg hover:bg-gray-50">
                <X className="w-3.5 h-3.5"/> Clear
              </button>
            )}
          </div>

          {adminLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500"/>
            </div>
          ) : (() => {
            const rawRows = adminTab === 'to_schedule'
              ? (adminData?.toSchedule ?? [])
              : adminTab === 'scheduled'
              ? (adminData?.scheduled ?? [])
              : (adminData?.rejected ?? [])

            const rows = rawRows.filter((r: any) => {
              if (adminSearch && !r.full_name?.toLowerCase().includes(adminSearch.toLowerCase())) return false
              if (adminJobFilter && r.job_id !== adminJobFilter) return false
              if (adminStageFilter && r.feedbackStage !== adminStageFilter) return false
              if (adminPanelFilter && !(r.panelNames ?? []).includes(adminPanelFilter)) return false
              return true
            })

            if (rows.length === 0) {
              return (
                <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-16 text-gray-400">
                  {adminTab === 'to_schedule' ? (
                    <>
                      <UserCheck className="w-8 h-8 mb-2 text-gray-300"/>
                      <p className="text-sm font-medium text-gray-500">No interviews to schedule</p>
                      <p className="text-xs mt-1">Candidates approved by interviewers will appear here.</p>
                    </>
                  ) : adminTab === 'scheduled' ? (
                    <>
                      <Calendar className="w-8 h-8 mb-2 text-gray-300"/>
                      <p className="text-sm font-medium text-gray-500">No interviews scheduled</p>
                      <p className="text-xs mt-1">Approved candidates with an interview date set will appear here.</p>
                    </>
                  ) : (
                    <>
                      <UserX className="w-8 h-8 mb-2 text-gray-300"/>
                      <p className="text-sm font-medium text-gray-500">No rejected candidates</p>
                      <p className="text-xs mt-1">Candidates rejected by interviewers will appear here.</p>
                    </>
                  )}
                </div>
              )
            }

            // Helper: shared candidate row render
            const CandidateRow = ({ r, showDate }: { r: any; showDate?: boolean }) => (
              <tr key={r.id} className="hover:bg-gray-50/40 transition-colors">
                <td className="px-4 py-3">
                  <button onClick={() => navigate(`/candidates/${r.id}`)}
                    className="font-medium text-blue-600 hover:underline text-left text-sm">
                    {r.full_name}
                  </button>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{r.jobTitle}</td>
                {/* Stage */}
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stageColour(r.feedbackStage ?? r.current_stage)}`}>
                    {r.feedbackStage ?? r.current_stage}
                  </span>
                </td>
                {/* Approved By — only on to_schedule tab */}
                {adminTab === 'to_schedule' && (
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {(r.approvedBy ?? []).length > 0
                      ? <div className="flex flex-wrap gap-1">
                          {(r.approvedBy as string[]).map((n: string) => (
                            <span key={n} className="bg-green-50 text-green-700 border border-green-100 px-1.5 py-0.5 rounded-md text-xs font-medium">{n}</span>
                          ))}
                        </div>
                      : <span className="text-gray-300">—</span>}
                  </td>
                )}
                {/* Panel — only on scheduled tab */}
                {adminTab === 'scheduled' && (
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {(r.panelNames ?? []).length > 0
                      ? <div className="flex flex-wrap gap-1">{(r.panelNames as string[]).map((n: string) => (
                          <span key={n} className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded-md text-xs">{n}</span>
                        ))}</div>
                      : <span className="text-gray-300">—</span>}
                  </td>
                )}
                {/* Rejected stage */}
                {adminTab === 'rejected' && (
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    <span className="font-medium text-red-600">{r.current_stage}</span>
                    {r.feedbackAt && <span className="ml-1 text-gray-400">· {formatDateTime(r.feedbackAt)}</span>}
                  </td>
                )}
                {showDate && (
                  <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                    {r.interview_date ? formatDateTime(r.interview_date) : <span className="text-gray-300">—</span>}
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  <button onClick={() => navigate(`/candidates/${r.id}`)}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 rounded-lg transition-colors ml-auto">
                    View <ArrowRight className="w-3 h-3"/>
                  </button>
                </td>
              </tr>
            )

            const TableHead = ({ showDate }: { showDate?: boolean }) => (
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Candidate</th>
                  <th className="text-left px-4 py-3 font-medium">Job</th>
                  <th className="text-left px-4 py-3 font-medium">Stage</th>
                  {adminTab === 'to_schedule' && <th className="text-left px-4 py-3 font-medium">Approved By</th>}
                  {adminTab === 'scheduled'   && <th className="text-left px-4 py-3 font-medium">Panel</th>}
                  {adminTab === 'rejected'    && <th className="text-left px-4 py-3 font-medium">Rejected Stage</th>}
                  {showDate && <th className="text-left px-4 py-3 font-medium">Interview Date</th>}
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
            )

            // "To be Scheduled" — split into two sub-sections
            if (adminTab === 'to_schedule') {
              const screeningApproved = rows.filter((r: any) => r.feedbackStage === 'Screening')
              const interviewApproved = rows.filter((r: any) => r.feedbackStage !== 'Screening')
              return (
                <div className="space-y-4">
                  {screeningApproved.length > 0 && (
                    <div className="bg-white rounded-xl border border-blue-100 overflow-hidden">
                      <div className="px-4 py-2.5 bg-blue-50/60 border-b border-blue-100 flex items-center gap-2">
                        <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Screening Approved</span>
                        <span className="text-xs text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded-full">{screeningApproved.length}</span>
                      </div>
                      <table className="w-full text-sm"><TableHead/><tbody className="divide-y divide-gray-50">{screeningApproved.map((r: any) => <CandidateRow key={r.id} r={r}/>)}</tbody></table>
                    </div>
                  )}
                  {interviewApproved.length > 0 && (
                    <div className="bg-white rounded-xl border border-indigo-100 overflow-hidden">
                      <div className="px-4 py-2.5 bg-indigo-50/60 border-b border-indigo-100 flex items-center gap-2">
                        <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Interview Approved</span>
                        <span className="text-xs text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded-full">{interviewApproved.length}</span>
                      </div>
                      <table className="w-full text-sm"><TableHead/><tbody className="divide-y divide-gray-50">{interviewApproved.map((r: any) => <CandidateRow key={r.id} r={r}/>)}</tbody></table>
                    </div>
                  )}
                  <p className="text-xs text-gray-400 px-1">{rows.length} candidate{rows.length !== 1 ? 's' : ''} approved — set an interview date to move them to Scheduled</p>
                </div>
              )
            }

            return (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <TableHead showDate={adminTab === 'scheduled'}/>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((r: any) => <CandidateRow key={r.id} r={r} showDate={adminTab === 'scheduled'}/>)}
                  </tbody>
                </table>
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                  <p className="text-xs text-gray-400">
                    {rows.length} candidate{rows.length !== 1 ? 's' : ''}
                    {adminTab === 'scheduled' ? ' with interview scheduled' : ' rejected — stage auto-updated'}
                  </p>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

