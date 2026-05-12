import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  ArrowLeft, ExternalLink, Phone, Mail, Linkedin,
  Loader2, Send, Pencil, Check, X, ChevronDown, CheckCircle
} from 'lucide-react'
import { useCandidate, useUpdateStage } from './useCandidates'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../shared/components/Button'
import { useAuthStore } from '../auth/authStore'
import { formatDate, formatDateTime, formatRelative, labelOf } from '../../shared/utils/helpers'
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
  Applied:'bg-gray-100 text-gray-700', Screening:'bg-blue-100 text-blue-700',
  R1:'bg-indigo-100 text-indigo-700', 'Case Study':'bg-yellow-100 text-yellow-700',
  R2:'bg-orange-100 text-orange-700', R3:'bg-orange-200 text-orange-800',
  'CF (Virtual)':'bg-purple-100 text-purple-700', 'CF (In-Person)':'bg-purple-200 text-purple-800',
  Offer:'bg-violet-100 text-violet-700', Hired:'bg-green-100 text-green-700',
  Rejected:'bg-red-100 text-red-700',
}

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
  const [contactDraft, setContactDraft] = useState({ email: '', phone: '', linkedin_url: '' })
  const [generalNotesDraft, setGeneralNotesDraft] = useState('')
  const [feedbackDone, setFeedbackDone] = useState(false)

  const { data: candidate, isLoading } = useCandidate(id!)
  const updateStage = useUpdateStage()

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users', 'all-active'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name,role').eq('is_active', true)
      return (data ?? []) as { id: string; full_name: string; role: string }[]
    },
  })

  // Check feedback status for current interviewer
  const { data: myFeedback, refetch: refetchFeedback } = useQuery({
    queryKey: ['my-feedback', id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('interview_feedback')
        .select('id, submitted_at')
        .eq('candidate_id', id!)
        .eq('interviewer_id', user!.id)
        .maybeSingle()
      return data
    },
    enabled: !!user && !!id,
  })

  // Sync local feedbackDone with query result
  useEffect(() => {
    setFeedbackDone(!!myFeedback?.submitted_at)
  }, [myFeedback])

  const hrUsers          = allUsers.filter(u => ['hr_team','admin','super_admin'].includes(u.role))
  const interviewerUsers = allUsers.filter(u => u.role === 'interviewer')

  // updateField — always invalidates BOTH candidate and candidates list
  const updateField = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      const { error } = await supabase.from('candidates').update({ [field]: value }).eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => {
      // Invalidate both so main list and profile both reflect changes
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
      }).eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate', id] })
      qc.invalidateQueries({ queryKey: ['candidates'] })
      setEditMode(false)
    },
  })

  // Submit feedback — use insert with ON CONFLICT DO UPDATE via raw approach
  const submitFeedback = useMutation({
    mutationFn: async () => {
      // First try to delete existing, then insert fresh (avoids constraint name issues)
      await supabase.from('interview_feedback')
        .delete()
        .eq('candidate_id', id!)
        .eq('interviewer_id', user!.id)

      const { error } = await supabase.from('interview_feedback').insert({
        candidate_id: id!,
        interviewer_id: user!.id,
        submitted_at: new Date().toISOString(),
      })
      if (error) throw error
    },
    onSuccess: async () => {
      setFeedbackDone(true)
      await refetchFeedback()
      qc.invalidateQueries({ queryKey: ['my-interviews', user?.id] })
      qc.invalidateQueries({ queryKey: ['my-feedback', id, user?.id] })
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
    if (!error) {
      qc.invalidateQueries({ queryKey: ['candidate', id] })
      setDraftNotes(p => ({ ...p, [sectionKey]: '' }))
    }
    setSavingNote(null)
  }

  const enterEditMode = () => {
    if (!candidate) return
    setContactDraft({ email: candidate.email, phone: candidate.phone ?? '', linkedin_url: candidate.linkedin_url ?? '' })
    setGeneralNotesDraft((candidate as any).notes ?? '')
    setEditMode(true)
  }

  // Toggle interviewer in array
  const toggleInterviewer = (uid: string) => {
    const curr: string[] = (candidate as any).assigned_interviewers ?? []
    const next = curr.includes(uid) ? curr.filter(i => i !== uid) : [...curr, uid]
    updateField.mutate({ field: 'assigned_interviewers', value: next })
  }

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
  if (!candidate) return <p className="text-gray-500 py-8 text-center">Candidate not found.</p>

  const stages = (candidate as any)?.job?.pipeline_stages ?? [...INTERVIEW_STAGES]
  const interviewNotes = (candidate as any).interview_notes ?? {}
  const assignedInterviewers: string[] = (candidate as any).assigned_interviewers ?? []
  // Multi HR owner — uses assigned_hr_owners array; falls back to legacy hr_owner
  const assignedHROwners: string[] = (() => {
    const arr = (candidate as any).assigned_hr_owners
    if (arr && arr.length > 0) return arr
    const single = (candidate as any).hr_owner
    return single ? [single] : []
  })()

  const drivePreviewUrl = candidate.resume_url
    ? candidate.resume_url.includes('drive.google.com')
      ? candidate.resume_url.replace('/view','').replace('?usp=sharing','') + '?embedded=true'
      : candidate.resume_url
    : null

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4"/> Back
        </button>
        <div className="flex items-center gap-2">
          {isInterviewer && (
            feedbackDone ? (
              <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
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
          {canEdit && (
            editMode ? (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" icon={<X className="w-3.5 h-3.5"/>} onClick={() => setEditMode(false)}>Cancel</Button>
                <Button size="sm" loading={saveAll.isPending} icon={<Check className="w-3.5 h-3.5"/>} onClick={() => saveAll.mutate()}>Save Changes</Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" icon={<Pencil className="w-3.5 h-3.5"/>} onClick={enterEditMode}>Edit Info</Button>
            )
          )}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{candidate.full_name}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{candidate.source_name} · {labelOf(candidate.source_category)}</p>
        </div>
        <div className="relative">
          {canEdit ? (
            <>
              <button onClick={() => setStageOpen(o => !o)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium ${STAGE_COLOURS[candidate.current_stage] ?? 'bg-gray-100 text-gray-700'}`}>
                {candidate.current_stage}<ChevronDown className="w-4 h-4"/>
              </button>
              {stageOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setStageOpen(false)}/>
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 w-52 max-h-80 overflow-y-auto">
                    {stages.map((s: string) => (
                      <button key={s} onClick={() => { updateStage.mutate({ id: candidate.id, stage: s }); setStageOpen(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLOURS[s] ?? 'bg-gray-100'}`}>{s}</span>
                        {s === candidate.current_stage && <Check className="w-3.5 h-3.5 text-blue-500"/>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <span className={`px-3 py-1.5 rounded-xl text-sm font-medium ${STAGE_COLOURS[candidate.current_stage] ?? 'bg-gray-100 text-gray-700'}`}>
              {candidate.current_stage}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── Left ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Contact */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-gray-700 mb-3">Contact</p>
            {editMode ? (
              <div className="space-y-2.5">
                {([['email','Email','email'],['phone','Phone','tel'],['linkedin_url','LinkedIn URL','url']] as const).map(([k, label, type]) => (
                  <div key={k}>
                    <label className="block text-xs text-gray-400 mb-1">{label}</label>
                    <input type={type} value={contactDraft[k]}
                      onChange={e => setContactDraft(p => ({ ...p, [k]: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2.5">
                <a href={`mailto:${candidate.email}`} className="flex items-center gap-2.5 text-sm text-gray-600 hover:text-blue-600">
                  <Mail className="w-4 h-4 text-gray-400 flex-shrink-0"/>{candidate.email}
                </a>
                {candidate.phone && (
                  <a href={`tel:${candidate.phone}`} className="flex items-center gap-2.5 text-sm text-gray-600 hover:text-blue-600">
                    <Phone className="w-4 h-4 text-gray-400 flex-shrink-0"/>{candidate.phone}
                  </a>
                )}
                {candidate.linkedin_url && (
                  <a href={candidate.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-sm text-blue-600 hover:underline">
                    <Linkedin className="w-4 h-4 flex-shrink-0"/>LinkedIn Profile
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Assignment */}
          {!isInterviewer && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <p className="text-sm font-semibold text-gray-700">Assignment</p>

              {/* HR Owner — pill multi-select, only admin/super_admin can change */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">
                  HR Owner
                  {assignedHROwners.length > 0 && (
                    <span className="ml-1.5 text-green-600 font-medium">({assignedHROwners.length} assigned)</span>
                  )}
                </p>
                {hrUsers.length === 0 ? (
                  <p className="text-xs text-gray-400">No HR members found</p>
                ) : canAssignHR ? (
                  <div className="flex flex-wrap gap-1.5">
                    {hrUsers.map(u => {
                      const sel = assignedHROwners.includes(u.id)
                      return (
                        <button key={u.id}
                          onClick={() => {
                            const next = sel
                              ? assignedHROwners.filter(i => i !== u.id)
                              : [...assignedHROwners, u.id]
                            // Update both columns for backward compat
                            updateField.mutate({ field: 'assigned_hr_owners', value: next })
                            updateField.mutate({ field: 'hr_owner', value: next[0] ?? null })
                          }}
                          disabled={updateField.isPending}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                            sel
                              ? 'bg-green-600 text-white border-green-600 shadow-sm'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-green-300 hover:text-green-600'
                          } disabled:cursor-not-allowed disabled:opacity-60`}>
                          {sel && <Check className="w-3 h-3 inline mr-1"/>}
                          {u.full_name}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  // HR Team: read-only view
                  <div className="flex flex-wrap gap-1.5">
                    {assignedHROwners.length > 0
                      ? assignedHROwners.map(uid => {
                          const u = hrUsers.find(h => h.id === uid)
                          return u ? (
                            <span key={uid} className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                              {u.full_name}
                            </span>
                          ) : null
                        })
                      : <p className="text-sm text-gray-400">—</p>
                    }
                  </div>
                )}
              </div>

              {/* Interviewers — multi-select pill toggle */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">
                  Interviewers
                  {assignedInterviewers.length > 0 && (
                    <span className="ml-1.5 text-blue-600 font-medium">({assignedInterviewers.length} assigned)</span>
                  )}
                </p>
                {interviewerUsers.length === 0 ? (
                  <p className="text-xs text-gray-400">No interviewers in Settings yet</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {interviewerUsers.map(u => {
                      const sel = assignedInterviewers.includes(u.id)
                      return (
                        <button key={u.id}
                          onClick={() => canEdit && toggleInterviewer(u.id)}
                          disabled={!canEdit || updateField.isPending}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                            sel
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                          } disabled:cursor-not-allowed disabled:opacity-60`}>
                          {sel && <Check className="w-3 h-3 inline mr-1"/>}
                          {u.full_name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Interview Date — LOCKED unless editMode is ON */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Interview Date & Time</p>
                {editMode && canEdit ? (
                  <input type="datetime-local"
                    value={toDatetimeLocal((candidate as any).interview_date)}
                    onChange={e => updateField.mutate({ field: 'interview_date', value: toISO(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                ) : (
                  <p className="text-sm text-gray-700">
                    {(candidate as any).interview_date ? formatDateTime((candidate as any).interview_date) : '—'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2 text-sm">
            <Row label="Source" value={`${labelOf(candidate.source_category)} — ${candidate.source_name}`}/>
            <Row label="Job" value={(candidate as any).job?.title ?? '—'}/>
            <Row label="Added" value={formatDate(candidate.created_at)}/>
          </div>
        </div>

        {/* ── Right ── */}
        <div className="lg:col-span-3 space-y-4">
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
              <iframe src={drivePreviewUrl} className="w-full border-0" style={{ height: '280px' }} title="Resume"/>
            ) : (
              <div className="flex items-center justify-center h-20 text-gray-400">
                <p className="text-sm">No resume link added</p>
              </div>
            )}
          </div>

          {/* General Notes */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-gray-700 mb-2">General Notes</p>
            {editMode ? (
              <textarea value={generalNotesDraft}
                onChange={e => setGeneralNotesDraft(e.target.value)}
                rows={4} placeholder="General notes about this candidate…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"/>
            ) : (
              (candidate as any).notes
                ? <p className="text-sm text-gray-700 whitespace-pre-wrap">{(candidate as any).notes}</p>
                : <p className="text-xs text-gray-400">{canEdit ? 'Click "Edit Info" to add notes.' : 'No notes.'}</p>
            )}
          </div>

          {/* Interview Notes */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <p className="text-sm font-semibold text-gray-700 px-5 py-3 border-b border-gray-100">Interview Notes</p>
            <div className="divide-y divide-gray-50">
              {NOTES_SECTIONS.map(({ key, label }) => {
                const entries: NoteEntry[] = interviewNotes[key] ?? []
                const draft = draftNotes[key] ?? ''
                return (
                  <div key={key} className="px-5 py-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${entries.length > 0 ? 'bg-blue-400' : 'bg-gray-200'}`}/>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
                      {entries.length > 0 && <span className="text-xs text-gray-400 ml-auto">{entries.length} note{entries.length > 1 ? 's' : ''}</span>}
                    </div>
                    {entries.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {entries.map((e, i) => (
                          <div key={i} className="bg-gray-50 rounded-lg px-3 py-2.5">
                            <p className="text-sm text-gray-700 whitespace-pre-wrap">{e.text}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              <span className="font-medium text-gray-500">{e.author}</span> · {formatRelative(e.timestamp)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {canAddNotes && (
                      <div className="flex gap-2 items-end">
                        <textarea rows={2} value={draft}
                          onChange={e => setDraftNotes(p => ({ ...p, [key]: e.target.value }))}
                          placeholder={`Add ${label} notes…`}
                          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(key) }}
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"/>
                        <button onClick={() => saveNote(key)} disabled={!draft.trim() || savingNote === key}
                          className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 flex items-center justify-center transition-colors">
                          {savingNote === key ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin"/> : <Send className="w-3.5 h-3.5 text-white"/>}
                        </button>
                      </div>
                    )}
                    {entries.length === 0 && !canAddNotes && <p className="text-xs text-gray-400">No notes yet.</p>}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-400 w-16 flex-shrink-0 text-xs">{label}</span>
      <span className="text-gray-700 font-medium text-sm">{value}</span>
    </div>
  )
}
