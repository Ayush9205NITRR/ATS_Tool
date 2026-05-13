// ============================================================
// CANDIDATE PROFILE PAGE — Clean sidebar layout, unified pills
// ============================================================
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft, ExternalLink, Phone, Mail, Linkedin, FileText,
  Loader2, Send, Pencil, Check, X, ChevronDown, CheckCircle
} from 'lucide-react'
import { useCandidate, useUpdateStage } from './useCandidates'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../shared/components/Button'
import { useAuthStore } from '../auth/authStore'
import { formatDateTime, formatDate, formatRelative, labelOf } from '../../shared/utils/helpers'
import { supabase } from '../../lib/supabaseClient'
import { INTERVIEW_STAGES } from '../../types/database.types'

const NOTES_SECTIONS = [
  { key: 'screening',   label: 'Screening Call' },
  { key: 'r1',          label: 'R1 Interview' },
  { key: 'case_study',  label: 'Case Study' },
  { key: 'r2',          label: 'R2 Interview' },
  { key: 'r3',          label: 'R3 Interview' },
  { key: 'cf_virtual',  label: 'CF Virtual' },
  { key: 'cf_inperson', label: 'CF In-Person' },
]

const STAGE_COLOURS: Record<string, string> = {
  Applied:'bg-gray-100 text-gray-600', Screening:'bg-blue-50 text-blue-700',
  R1:'bg-indigo-50 text-indigo-700', 'Case Study':'bg-amber-50 text-amber-700',
  R2:'bg-orange-50 text-orange-700', R3:'bg-orange-100 text-orange-800',
  'CF (Virtual)':'bg-purple-50 text-purple-700', 'CF (In-Person)':'bg-purple-100 text-purple-800',
  Offer:'bg-violet-50 text-violet-700', Hired:'bg-green-50 text-green-700',
  Rejected:'bg-red-50 text-red-600',
}

// Unified pill design — same for HR Owner and Interviewers
const PILL_BASE    = 'px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer select-none'
const PILL_OFF     = 'bg-white border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-800'
const PILL_ON      = 'bg-slate-800 text-white border-slate-800'
const PILL_DISABLED = 'bg-gray-50 border-gray-100 text-gray-400 cursor-default'

interface NoteEntry { text: string; author: string; authorId: string; timestamp: string }

function toDatetimeLocal(v: string | null | undefined): string {
  if (!v) return ''
  return v.replace(' ', 'T').slice(0, 16)
}
function toISO(v: string): string | null {
  if (!v) return null
  return new Date(v).toISOString()
}

export function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, hasRole } = useAuthStore()
  const qc = useQueryClient()

  const isInterviewer = hasRole(['interviewer'])
  const canEdit       = hasRole(['admin', 'super_admin', 'hr_team'])
  const canAssignHR   = hasRole(['admin', 'super_admin'])
  const canAddNotes   = hasRole(['admin', 'super_admin', 'hr_team', 'interviewer'])

  const [editMode, setEditMode]     = useState(false)
  const [stageOpen, setStageOpen]   = useState(false)
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)
  const [feedbackErr, setFeedbackErr] = useState<string | null>(null)

  // Edit mode drafts
  const [contactDraft, setContactDraft] = useState({ email: '', phone: '', linkedin_url: '' })
  const [generalNotesDraft, setGeneralNotesDraft] = useState('')
  const [interviewDateDraft, setInterviewDateDraft] = useState('')
  const [customDataDraft, setCustomDataDraft] = useState<Record<string, string>>({})

  const { data: candidate, isLoading } = useCandidate(id!)
  const updateStage = useUpdateStage()

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users', 'all-active'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name,role').eq('is_active', true)
      return (data ?? []) as { id: string; full_name: string; role: string }[]
    },
    staleTime: 60_000,
  })

  // Custom fields — filtered by role visibility
  const { data: customFields = [] } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => {
      const { data } = await supabase
        .from('custom_fields')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      return (data ?? []) as any[]
    },
    staleTime: 60_000,
  })

  const { data: myFeedback, refetch: refetchFeedback } = useQuery({
    queryKey: ['my-feedback', id, user?.id],
    queryFn: async () => {
      if (!isInterviewer || !user) return null
      const { data, error } = await supabase
        .from('interview_feedback')
        .select('id, submitted_at')
        .eq('candidate_id', id!)
        .eq('interviewer_id', user.id)
        .maybeSingle()
      if (error) console.error('[feedback query]', error)
      return data
    },
    enabled: !!user && isInterviewer,
    staleTime: 0,
  })

  const hrUsers          = allUsers.filter(u => ['hr_team','admin','super_admin'].includes(u.role))
  const interviewerUsers = allUsers.filter(u => u.role === 'interviewer')

  // Enter edit mode — snapshot current values
  const enterEditMode = useCallback(() => {
    if (!candidate) return
    setContactDraft({
      email: candidate.email,
      phone: candidate.phone ?? '',
      linkedin_url: candidate.linkedin_url ?? '',
    })
    setGeneralNotesDraft((candidate as any).notes ?? '')
    setInterviewDateDraft(toDatetimeLocal((candidate as any).interview_date))
    setCustomDataDraft((candidate as any).custom_data ?? {})
    setEditMode(true)
  }, [candidate])

  // updateField — always invalidates both lists
  const updateField = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      const { error } = await supabase.from('candidates').update({ [field]: value }).eq('id', id!)
      if (error) { console.error('[updateField]', field, error); throw error }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate', id] })
      qc.invalidateQueries({ queryKey: ['candidates'] })
    },
  })

  const saveAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('candidates').update({
        email: contactDraft.email,
        phone: contactDraft.phone || null,
        linkedin_url: contactDraft.linkedin_url || null,
        notes: generalNotesDraft || null,
        interview_date: toISO(interviewDateDraft),
        custom_data: customDataDraft,
      }).eq('id', id!)
      if (error) { console.error('[saveAll]', error); throw error }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate', id] })
      qc.invalidateQueries({ queryKey: ['candidates'] })
      setEditMode(false)
    },
  })

  // Submit feedback — upsert approach (no delete needed, avoids RLS delete issue)
  const submitFeedback = useMutation({
    mutationFn: async () => {
      setFeedbackErr(null)
      const stage = (candidate as any)?.current_stage ?? 'Applied'

      // Check if record already exists
      const { data: existing } = await supabase
        .from('interview_feedback')
        .select('id')
        .eq('candidate_id', id!)
        .eq('interviewer_id', user!.id)
        .maybeSingle()

      let error
      if (existing?.id) {
        // Update existing record
        const result = await supabase
          .from('interview_feedback')
          .update({ submitted_at: new Date().toISOString(), stage })
          .eq('id', existing.id)
        error = result.error
      } else {
        // Insert new record
        const result = await supabase
          .from('interview_feedback')
          .insert({ candidate_id: id!, interviewer_id: user!.id, submitted_at: new Date().toISOString(), stage })
        error = result.error
      }

      if (error) { console.error('[feedback submit]', error); throw error }
    },
    onSuccess: async () => {
      await refetchFeedback()
      qc.invalidateQueries({ queryKey: ['my-feedback', id, user?.id] })
      qc.invalidateQueries({ queryKey: ['my-interviews'] })
    },
    onError: (err: any) => {
      setFeedbackErr(err?.message ?? 'Failed. Check browser console for details.')
    },
  })

  const saveNote = async (sectionKey: string) => {
    const draft = draftNotes[sectionKey]?.trim()
    if (!draft) return
    setSavingNote(sectionKey)
    const existing = (candidate as any)?.interview_notes ?? {}
    const entries: NoteEntry[] = existing[sectionKey] ?? []
    const { error } = await supabase.from('candidates').update({
      interview_notes: { ...existing, [sectionKey]: [...entries, {
        text: draft, author: user!.full_name,
        authorId: user!.id, timestamp: new Date().toISOString(),
      }]}
    }).eq('id', id!)
    if (error) console.error('[saveNote]', error)
    else {
      qc.invalidateQueries({ queryKey: ['candidate', id] })
      setDraftNotes(p => ({ ...p, [sectionKey]: '' }))
    }
    setSavingNote(null)
  }

  const toggleInterviewer = useCallback((uid: string) => {
    const curr: string[] = (candidate as any)?.assigned_interviewers ?? []
    const next = curr.includes(uid) ? curr.filter(i => i !== uid) : [...curr, uid]
    updateField.mutate({ field: 'assigned_interviewers', value: next })
  }, [candidate, updateField])

  const toggleHROwner = useCallback((uid: string) => {
    const curr: string[] = (candidate as any)?.assigned_hr_owners?.length > 0
      ? (candidate as any).assigned_hr_owners
      : ((candidate as any).hr_owner ? [(candidate as any).hr_owner] : [])
    const next = curr.includes(uid) ? curr.filter(i => i !== uid) : [...curr, uid]
    updateField.mutate({ field: 'assigned_hr_owners', value: next })
    updateField.mutate({ field: 'hr_owner', value: next[0] ?? null })
  }, [candidate, updateField])

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
  if (!candidate) return <p className="text-gray-500 py-8 text-center">Candidate not found.</p>

  const stages = (candidate as any)?.job?.pipeline_stages ?? [...INTERVIEW_STAGES]
  const interviewNotes = (candidate as any).interview_notes ?? {}
  const assignedInterviewers: string[] = (candidate as any).assigned_interviewers ?? []
  const assignedHROwners: string[] = (candidate as any)?.assigned_hr_owners?.length > 0
    ? (candidate as any).assigned_hr_owners
    : ((candidate as any).hr_owner ? [(candidate as any).hr_owner] : [])

  const feedbackSubmitted = !!myFeedback?.submitted_at

  const drivePreviewUrl = candidate.resume_url
    ? candidate.resume_url.includes('drive.google.com')
      ? candidate.resume_url.replace('/view','').replace('?usp=sharing','') + '?embedded=true'
      : candidate.resume_url
    : null

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft className="w-4 h-4"/> Back
        </button>
        <div className="flex items-center gap-2">
          {isInterviewer && (
            feedbackSubmitted ? (
              <div className="flex items-center gap-1.5 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                <CheckCircle className="w-4 h-4"/>Feedback Submitted
              </div>
            ) : (
              <Button size="sm" loading={submitFeedback.isPending}
                icon={<CheckCircle className="w-3.5 h-3.5"/>}
                onClick={() => submitFeedback.mutate()}>
                Submit Feedback
              </Button>
            )
          )}
          {feedbackErr && <p className="text-xs text-red-600">{feedbackErr}</p>}
          {canEdit && (
            editMode ? (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" icon={<X className="w-3.5 h-3.5"/>} onClick={() => setEditMode(false)}>Cancel</Button>
                <Button size="sm" loading={saveAll.isPending} icon={<Check className="w-3.5 h-3.5"/>} onClick={() => saveAll.mutate()}>Save</Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" icon={<Pencil className="w-3.5 h-3.5"/>} onClick={enterEditMode}>Edit</Button>
            )
          )}
        </div>
      </div>

      {/* Name + Stage row */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{candidate.full_name}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{candidate.source_name} · {labelOf(candidate.source_category)}</p>
        </div>
        <div className="relative">
          {canEdit ? (
            <>
              <button onClick={() => setStageOpen(o => !o)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border ${STAGE_COLOURS[candidate.current_stage] ?? 'bg-gray-100 text-gray-600'} border-transparent`}>
                {candidate.current_stage}<ChevronDown className="w-3.5 h-3.5 opacity-60"/>
              </button>
              {stageOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setStageOpen(false)}/>
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 w-52 max-h-80 overflow-y-auto">
                    {stages.map((s: string) => (
                      <button key={s} onClick={() => { updateStage.mutate({ id: candidate.id, stage: s }); setStageOpen(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLOURS[s] ?? 'bg-gray-100'}`}>{s}</span>
                        {s === candidate.current_stage && <Check className="w-3.5 h-3.5 text-slate-600"/>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${STAGE_COLOURS[candidate.current_stage] ?? 'bg-gray-100 text-gray-600'}`}>
              {candidate.current_stage}
            </span>
          )}
        </div>
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── Left sidebar — seamless, no stacked cards ── */}
        <aside className="lg:col-span-2 bg-gray-50/60 rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">

          {/* Contact */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Contact</p>
            {editMode ? (
              <div className="space-y-2.5">
                {([['email','Email','email'],['phone','Phone','tel'],['linkedin_url','LinkedIn','url']] as const).map(([k,label,type]) => (
                  <div key={k}>
                    <label className="block text-xs text-gray-400 mb-0.5">{label}</label>
                    <input type={type} value={contactDraft[k]}
                      onChange={e => setContactDraft(p => ({ ...p, [k]: e.target.value }))}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"/>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <a href={`mailto:${candidate.email}`} className="flex items-center gap-2.5 text-sm text-gray-700 hover:text-blue-600 transition-colors">
                  <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>{candidate.email}
                </a>
                {candidate.phone && (
                  <a href={`tel:${candidate.phone}`} className="flex items-center gap-2.5 text-sm text-gray-700 hover:text-blue-600">
                    <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>{candidate.phone}
                  </a>
                )}
                {candidate.linkedin_url && (
                  <a href={candidate.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-sm text-blue-600 hover:underline">
                    <Linkedin className="w-3.5 h-3.5 flex-shrink-0"/>LinkedIn Profile
                  </a>
                )}
                {!candidate.phone && !candidate.linkedin_url && (
                  <p className="text-xs text-gray-400 italic">Click Edit to add phone / LinkedIn</p>
                )}
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Details</p>
            <div className="space-y-2">
              {[
                ['Source', `${labelOf(candidate.source_category)} — ${candidate.source_name}`],
                ['Job', (candidate as any).job?.title ?? '—'],
                ['Added', formatDate(candidate.created_at)],
              ].map(([label, val]) => (
                <div key={label} className="flex gap-2 text-sm">
                  <span className="text-gray-400 w-14 flex-shrink-0 text-xs pt-0.5">{label}</span>
                  <span className="text-gray-700">{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Assignment — hidden from interviewer */}
          {!isInterviewer && (
            <div className="px-5 py-4 space-y-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Assignment</p>

              {/* HR Owner — SINGLE select pill (click to assign, click again to unassign) */}
              <div>
                <p className="text-xs text-gray-500 mb-2">HR Owner <span className="text-gray-300">(single)</span></p>
                {hrUsers.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No HR members</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {hrUsers.map(u => {
                      const sel = (candidate as any).hr_owner === u.id
                      return (
                        <button key={u.id}
                          onClick={() => {
                            if (!canAssignHR) return
                            // Single select: toggle off if same, else assign
                            const next = sel ? null : u.id
                            updateField.mutate({ field: 'hr_owner', value: next })
                            // Also update assigned_hr_owners for consistency
                            updateField.mutate({ field: 'assigned_hr_owners', value: next ? [next] : [] })
                          }}
                          disabled={!canAssignHR}
                          className={`${PILL_BASE} ${!canAssignHR ? PILL_DISABLED : sel ? PILL_ON : PILL_OFF}`}>
                          {sel && <Check className="w-2.5 h-2.5 inline mr-1 opacity-80"/>}
                          {u.full_name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Interviewers — MULTI select pills, same design as HR Owner */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Interviewers <span className="text-gray-300">(multi)</span></p>
                {interviewerUsers.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No interviewers in Settings</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {interviewerUsers.map(u => {
                      const sel = assignedInterviewers.includes(u.id)
                      return (
                        <button key={u.id}
                          onClick={() => canEdit && toggleInterviewer(u.id)}
                          disabled={!canEdit}
                          className={`${PILL_BASE} ${!canEdit ? PILL_DISABLED : sel ? PILL_ON : PILL_OFF}`}>
                          {sel && <Check className="w-2.5 h-2.5 inline mr-1 opacity-80"/>}
                          {u.full_name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Interview Date — only editable in edit mode */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Interview Date & Time</p>
                {editMode && canEdit ? (
                  <input type="datetime-local" value={interviewDateDraft}
                    onChange={e => setInterviewDateDraft(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"/>
                ) : (
                  <p className="text-sm text-gray-700">
                    {(candidate as any).interview_date ? formatDateTime((candidate as any).interview_date) : <span className="text-gray-400 italic text-xs">Not set</span>}
                  </p>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* ── Right column ── */}
        <div className="lg:col-span-3 space-y-5">

          {/* Resume */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-700">Resume</p>
              {candidate.resume_url && (
                <a href={candidate.resume_url} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm" icon={<ExternalLink className="w-3.5 h-3.5"/>}>Open</Button>
                </a>
              )}
            </div>
            {drivePreviewUrl ? (
              <iframe src={drivePreviewUrl} className="w-full border-0" style={{ height: '300px' }} title="Resume"/>
            ) : (
              /* Minimal empty state — no giant box */
              <div className="flex items-center gap-2.5 px-5 py-4 text-gray-400">
                <FileText className="w-4 h-4 flex-shrink-0"/>
                <p className="text-sm">No resume attached</p>
                {canEdit && <span className="text-xs text-gray-300">· Add URL via Edit</span>}
              </div>
            )}
          </div>

          {/* General Notes — clean, no heavy border */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-sm font-semibold text-gray-700">General Notes</p>
            </div>
            {editMode ? (
              <textarea value={generalNotesDraft}
                onChange={e => setGeneralNotesDraft(e.target.value)}
                rows={4} placeholder="General notes about this candidate…"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y bg-white"/>
            ) : (
              (candidate as any).notes ? (
                <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{(candidate as any).notes}</p>
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic px-1">{canEdit ? 'Click Edit to add notes.' : 'No notes.'}</p>
              )
            )}
          </div>

          {/* Additional Details — custom fields, hidden from interviewers if show_to_interviewer=false */}
          {(() => {
            const visibleFields = customFields.filter((f: any) =>
              !isInterviewer || f.show_to_interviewer !== false
            )
            if (visibleFields.length === 0) return null
            const customData = (candidate as any).custom_data ?? {}
            return (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2 px-1">Additional Details</p>
                {editMode ? (
                  <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-3">
                    {visibleFields.map((f: any) => (
                      <div key={f.id}>
                        <label className="block text-xs text-gray-400 mb-1">
                          {f.field_label}
                          {f.is_required && <span className="text-red-400 ml-1">*</span>}
                          {!isInterviewer && f.show_to_interviewer === false && (
                            <span className="ml-1.5 text-xs text-gray-300">(hidden from interviewers)</span>
                          )}
                        </label>
                        {f.field_type === 'boolean' ? (
                          <div className="flex items-center gap-2">
                            <input type="checkbox"
                              checked={customDataDraft[f.field_name] === 'true'}
                              onChange={e => setCustomDataDraft(p => ({ ...p, [f.field_name]: e.target.checked ? 'true' : 'false' }))}
                              className="rounded border-gray-300 text-blue-600"/>
                            <span className="text-sm text-gray-600">{customDataDraft[f.field_name] === 'true' ? 'Yes' : 'No'}</span>
                          </div>
                        ) : (
                          <input
                            type={f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : f.field_type === 'url' ? 'url' : 'text'}
                            value={customDataDraft[f.field_name] ?? ''}
                            onChange={e => setCustomDataDraft(p => ({ ...p, [f.field_name]: e.target.value }))}
                            placeholder={f.field_label}
                            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"/>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
                    <dl className="space-y-2">
                      {visibleFields.map((f: any) => {
                        const val = customData[f.field_name]
                        return (
                          <div key={f.id} className="flex gap-3 text-sm">
                            <dt className="text-gray-400 text-xs w-28 flex-shrink-0 pt-0.5">{f.field_label}</dt>
                            <dd className="text-gray-700 font-medium">
                              {val === undefined || val === null || val === ''
                                ? <span className="text-gray-300 italic text-xs">—</span>
                                : f.field_type === 'boolean'
                                ? (val === 'true' || val === true ? 'Yes' : 'No')
                                : f.field_type === 'url'
                                ? <a href={val} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">{val}</a>
                                : String(val)
                              }
                            </dd>
                          </div>
                        )
                      })}
                    </dl>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Interview Notes — clean feed, no outer border */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3 px-1">Interview Notes</p>
            <div className="space-y-0">
              {NOTES_SECTIONS.map(({ key, label }, sectionIdx) => {
                const entries: NoteEntry[] = interviewNotes[key] ?? []
                const draft = draftNotes[key] ?? ''
                return (
                  <div key={key} className={`${sectionIdx > 0 ? 'border-t border-gray-100' : ''}`}>
                    {/* Section header */}
                    <div className="flex items-center gap-2 px-1 py-2.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${entries.length > 0 ? 'bg-slate-600' : 'bg-gray-200'}`}/>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">{label}</p>
                      {entries.length > 0 && <span className="text-xs text-gray-400">{entries.length}</span>}
                    </div>

                    {/* Existing entries */}
                    {entries.length > 0 && (
                      <div className="space-y-2 mb-2 pl-3.5">
                        {entries.map((e, i) => (
                          <div key={i} className="bg-gray-50 rounded-lg px-3 py-2.5">
                            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{e.text}</p>
                            <p className="text-xs text-gray-400 mt-1.5">
                              <span className="font-medium text-gray-500">{e.author}</span> · {formatRelative(e.timestamp)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Input */}
                    {canAddNotes && (
                      <div className="flex gap-2 items-end pb-3 pl-3.5">
                        <textarea rows={2} value={draft}
                          onChange={e => setDraftNotes(p => ({ ...p, [key]: e.target.value }))}
                          placeholder={`Add ${label} note…`}
                          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(key) }}
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none"/>
                        <button onClick={() => saveNote(key)}
                          disabled={!draft.trim() || savingNote === key}
                          className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:bg-gray-200 flex items-center justify-center transition-colors">
                          {savingNote === key ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin"/> : <Send className="w-3.5 h-3.5 text-white"/>}
                        </button>
                      </div>
                    )}
                    {entries.length === 0 && !canAddNotes && (
                      <p className="text-xs text-gray-400 pl-3.5 pb-3 italic">No notes yet.</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
