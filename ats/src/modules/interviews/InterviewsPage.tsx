// ============================================================
// INTERVIEWS PAGE — Table view matching CandidatesPage style
// Feedback state managed via interview_feedback table
// ============================================================
import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, CheckCircle, Clock, Briefcase, Calendar, X, ChevronDown, UserCheck, UserX, ArrowRight } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { formatDateTime } from '../../shared/utils/helpers'
import { PageHeader } from '../../shared/components/PageHeader'

type FeedbackFilter = 'pending' | 'submitted'
type AdminTab = 'pending' | 'rejected'

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

function matchesDateFilter(iso: string | null, op: DateOp, a: string, b: string): boolean {
  if (op === 'any')        return true
  if (op === 'empty')      return !iso
  if (op === 'not_empty')  return !!iso
  if (!iso)                return false
  const d = iso.slice(0, 10)
  const today = ymd(new Date())
  switch (op) {
    case 'is':            return !!a && d === a
    case 'before':        return !!a && d <  a
    case 'after':         return !!a && d >  a
    case 'on_or_before':  return !!a && d <= a
    case 'on_or_after':   return !!a && d >= a
    case 'between':       return !!a && !!b && d >= a && d <= b
    case 'today':         return d === today
    case 'tomorrow':      return d === ymd(addDays(new Date(), 1))
    case 'yesterday':     return d === ymd(addDays(new Date(), -1))
    case 'last_7':        return d >= ymd(addDays(new Date(), -7)) && d <= today
    case 'next_7':        return d >= today && d <= ymd(addDays(new Date(), 7))
    case 'this_month':    return d.slice(0, 7) === today.slice(0, 7)
    default:              return true
  }
}

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
  const { user, hasRole } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isInterviewer = hasRole(['interviewer'])
  const [filter, setFilter]     = useState<FeedbackFilter>('pending')
  const [adminTab, setAdminTab] = useState<AdminTab>('pending')

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

  // Admin / HR view: candidates reviewed by interviewers
  const { data: adminData, isLoading: adminLoading } = useQuery({
    queryKey: ['admin-interview-reviews'],
    queryFn: async () => {
      const { data: feedbacks, error } = await supabase
        .from('interview_feedback')
        .select('id, candidate_id, interviewer_id, stage, recommendation, submitted_at')
        .in('recommendation', ['yes', 'no'])
        .order('submitted_at', { ascending: false })
      if (error) throw error

      const candidateIds = [...new Set((feedbacks ?? []).map((f: any) => f.candidate_id))]
      const interviewerIds = [...new Set((feedbacks ?? []).map((f: any) => f.interviewer_id))]

      const [{ data: candidates }, { data: interviewers }] = await Promise.all([
        candidateIds.length
          ? supabase.from('candidates').select('id, full_name, current_stage, job_id').in('id', candidateIds)
          : { data: [] as any[] },
        interviewerIds.length
          ? supabase.from('users').select('id, full_name').in('id', interviewerIds)
          : { data: [] as any[] },
      ])

      const jobIds = [...new Set((candidates ?? []).map((c: any) => c.job_id).filter(Boolean))]
      const { data: jobs } = jobIds.length
        ? await supabase.from('jobs').select('id, title').in('id', jobIds)
        : { data: [] as any[] }

      const candidateMap = Object.fromEntries((candidates ?? []).map((c: any) => [c.id, c]))
      const interviewerMap = Object.fromEntries((interviewers ?? []).map((u: any) => [u.id, u.full_name]))
      const jobMap = Object.fromEntries((jobs ?? []).map((j: any) => [j.id, j.title]))

      const enrich = (f: any) => {
        const c = candidateMap[f.candidate_id] ?? {}
        return {
          ...f,
          candidateName: c.full_name ?? '—',
          candidateStage: c.current_stage ?? f.stage,
          candidateId: f.candidate_id,
          jobTitle: jobMap[c.job_id] ?? '—',
          interviewerName: interviewerMap[f.interviewer_id] ?? '—',
        }
      }

      return {
        pending:  (feedbacks ?? []).filter((f: any) => f.recommendation === 'yes').map(enrich),
        rejected: (feedbacks ?? []).filter((f: any) => f.recommendation === 'no').map(enrich),
      }
    },
    enabled: !isInterviewer && !!user,
    staleTime: 30_000,
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
      if (jobFilter && c.job?.id !== jobFilter) return false
      if (!matchesDateFilter(c.interview_date ?? null, dateOp, dateA, dateB)) return false
      return true
    })
  }, [rawList, jobFilter, dateOp, dateA, dateB])

  const pendingCount   = data?.pending.length   ?? 0
  const submittedCount = data?.submitted.length ?? 0
  const hasActiveFilters = !!(jobFilter || dateOp !== 'any')

  // Short chip label that appears on the date button
  const dateChipLabel = (() => {
    if (dateOp === 'any')                       return 'Interview date'
    if (dateOp === 'between' && dateA && dateB) return `${dateA} → ${dateB}`
    if (['is','before','after','on_or_before','on_or_after'].includes(dateOp) && dateA) {
      return `${DATE_OP_LABEL[dateOp].replace('…','')} ${dateA}`
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
          : `${adminData?.pending.length ?? 0} pending schedule · ${adminData?.rejected.length ?? 0} rejected`
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

      {/* Filter bar — Job + Interview Date range */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg bg-white px-3 py-2">
          <Briefcase className="w-3.5 h-3.5 text-gray-400"/>
          <select
            value={jobFilter}
            onChange={e => { setJobFilter(e.target.value); setSelectedIds(new Set()) }}
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
            onClick={() => { setJobFilter(''); clearDate(); setSelectedIds(new Set()) }}
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
            <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Interview Date</p>
                {dateOp !== 'any' && (
                  <button onClick={clearDate} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-0.5">
                    <X className="w-3 h-3"/> Reset
                  </button>
                )}
              </div>

              <select
                value={dateOp}
                onChange={e => {
                  const op = e.target.value as DateOp
                  setDateOp(op)
                  if (op !== 'between') setDateB('')
                  if (['any','today','tomorrow','yesterday','last_7','next_7','this_month','empty','not_empty'].includes(op)) {
                    setDateA(''); setDateB('')
                  }
                  setSelectedIds(new Set())
                }}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 mb-2 bg-white"
              >
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
                <optgroup label="State">
                  {(['empty','not_empty'] as DateOp[]).map(op => (
                    <option key={op} value={op}>{DATE_OP_LABEL[op]}</option>
                  ))}
                </optgroup>
              </select>

              {['is','before','after','on_or_before','on_or_after','between'].includes(dateOp) && (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={dateA}
                    onChange={e => { setDateA(e.target.value); setSelectedIds(new Set()) }}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                  />
                  {dateOp === 'between' && (
                    <>
                      <span className="text-xs text-gray-400">to</span>
                      <input
                        type="date"
                        value={dateB}
                        onChange={e => { setDateB(e.target.value); setSelectedIds(new Set()) }}
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                      />
                    </>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-gray-100">
                {(['today','tomorrow','last_7','next_7','this_month'] as DateOp[]).map(op => (
                  <button
                    key={op}
                    onClick={() => { setDateOp(op); setDateA(''); setDateB(''); setSelectedIds(new Set()) }}
                    className={`text-xs px-2 py-1 rounded-md border transition-colors ${
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

      </>}

      {/* Admin / HR Manager view */}
      {!isInterviewer && (
        <div>
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl mb-4 w-fit">
            <button
              onClick={() => setAdminTab('pending')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                adminTab === 'pending' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5"/>
              Interviews Pending
              {(adminData?.pending.length ?? 0) > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  adminTab === 'pending' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
                }`}>{adminData!.pending.length}</span>
              )}
            </button>
            <button
              onClick={() => setAdminTab('rejected')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                adminTab === 'rejected' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <UserX className="w-3.5 h-3.5"/>
              Interviews Rejected
              {(adminData?.rejected.length ?? 0) > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  adminTab === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-500'
                }`}>{adminData!.rejected.length}</span>
              )}
            </button>
          </div>

          {adminLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500"/>
            </div>
          ) : (() => {
            const rows = adminTab === 'pending' ? (adminData?.pending ?? []) : (adminData?.rejected ?? [])
            if (rows.length === 0) {
              return (
                <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-16 text-gray-400">
                  {adminTab === 'pending' ? (
                    <>
                      <UserCheck className="w-8 h-8 mb-2 text-gray-300"/>
                      <p className="text-sm font-medium text-gray-500">No pending interviews</p>
                      <p className="text-xs mt-1">Candidates selected for next round will appear here.</p>
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
            return (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-4 py-3 font-medium">Candidate</th>
                      <th className="text-left px-4 py-3 font-medium">Job</th>
                      <th className="text-left px-4 py-3 font-medium">Reviewed At Stage</th>
                      <th className="text-left px-4 py-3 font-medium">Reviewer</th>
                      <th className="text-left px-4 py-3 font-medium">Decision Date</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((r: any) => (
                      <tr key={r.id} className="hover:bg-gray-50/40 transition-colors">
                        <td className="px-4 py-3">
                          <button onClick={() => navigate(`/candidates/${r.candidateId}`)}
                            className="font-medium text-blue-600 hover:underline text-left text-sm">
                            {r.candidateName}
                          </button>
                          {adminTab === 'pending' && (
                            <p className="text-xs text-gray-400 mt-0.5">Current: {r.candidateStage}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{r.jobTitle}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[r.stage] ?? 'bg-gray-100 text-gray-600'}`}>
                            {r.stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{r.interviewerName}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {r.submitted_at ? formatDateTime(r.submitted_at) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => navigate(`/candidates/${r.candidateId}`)}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 rounded-lg transition-colors ml-auto">
                            View Profile <ArrowRight className="w-3 h-3"/>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                  <p className="text-xs text-gray-400">
                    {adminTab === 'pending'
                      ? `${rows.length} candidate${rows.length !== 1 ? 's' : ''} ready to schedule for next round`
                      : `${rows.length} candidate${rows.length !== 1 ? 's' : ''} rejected by interviewers`
                    }
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

