// ============================================================
// CANDIDATE PROFILE PAGE
// Fixes:
//  - Interviewers: Airtable-style multi-select pills
//  - HR Owner: also multi-select pills (or single-select — kept as single per your schema but with pill UI)
//  - Interview date changes sync correctly (uses datetime-local, saved to DB immediately)
//  - "Submit Feedback" button visible ONLY to the assigned interviewer
//  - Once submitted → candidate moves to "Feedback Submitted" on Interviews page
// ============================================================
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Edit2, Check, X, Loader2, Send } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { INTERVIEW_STAGES } from '../../types/database.types'
import { formatDate } from '../../shared/utils/helpers'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'

const STAGE_COLOURS: Record<string, string> = {
  Applied: 'bg-gray-100 text-gray-700',
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

// Stage-to-note-section mapping
const STAGE_NOTE_KEYS: { stage: string; label: string; field: string }[] = [
  { stage: 'Screening',      label: 'Screening Call',  field: 'screening_notes'  },
  { stage: 'R1',             label: 'R1 Interview',    field: 'r1_notes'         },
  { stage: 'Case Study',     label: 'Case Study',      field: 'case_study_notes' },
  { stage: 'R2',             label: 'R2 Interview',    field: 'r2_notes'         },
  { stage: 'R3',             label: 'R3 Interview',    field: 'r3_notes'         },
  { stage: 'CF (Virtual)',   label: 'CF Virtual',      field: 'cf_virtual_notes' },
  { stage: 'CF (In-Person)', label: 'CF In-Person',    field: 'cf_inperson_notes'},
]

// ── Pill Multi-Select ─────────────────────────────────────────
function PillMultiSelect({
  label,
  options,
  selectedIds,
  onChange,
  disabled = false,
}: {
  label: string
  options: { id: string; full_name: string }[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(i => i !== id) : [...selectedIds, id])
  }
  const selectedCount = selectedIds.length

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-2">
        {label} {selectedCount > 0 && <span className="text-blue-600">({selectedCount} assigned)</span>}
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map(u => {
          const sel = selectedIds.includes(u.id)
          return (
            <button
              key={u.id}
              disabled={disabled}
              onClick={() => toggle(u.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                sel
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {sel && <Check className="w-3 h-3"/>}
              {u.full_name}
            </button>
          )
        })}
        {options.length === 0 && (
          <p className="text-xs text-gray-400">No options available</p>
        )}
      </div>
    </div>
  )
}

// ── Single Pill Select (HR Owner) ─────────────────────────────
function PillSingleSelect({
  label,
  options,
  selectedId,
  onChange,
  disabled = false,
}: {
  label: string
  options: { id: string; full_name: string }[]
  selectedId: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-2">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map(u => {
          const sel = selectedId === u.id
          return (
            <button
              key={u.id}
              disabled={disabled}
              onClick={() => onChange(sel ? null : u.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                sel
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {sel && <Check className="w-3 h-3"/>}
              {u.full_name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Interview Note Section ────────────────────────────────────
function NoteSection({
  stageLabel,
  field,
  candidateId,
  notes,
  canEdit,
  onSaved,
}: {
  stageLabel: string
  field: string
  candidateId: string
  notes: any[]  // array of {id, content, interviewer_name, created_at}
  canEdit: boolean
  onSaved: () => void
}) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const { user } = useAuthStore()

  const save = async () => {
    if (!draft.trim()) return
    setSaving(true)
    await supabase.from('interview_notes').insert({
      candidate_id: candidateId,
      stage_field: field,
      content: draft.trim(),
      interviewer_id: user!.id,
    })
    setDraft('')
    setSaving(false)
    onSaved()
  }

  return (
    <div className="border-b border-gray-100 last:border-0 pb-4 last:pb-0">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${notes.length > 0 ? 'bg-blue-400' : 'bg-gray-200'}`}/>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{stageLabel}</p>
        {notes.length > 0 && (
          <span className="text-xs text-gray-400">{notes.length} note{notes.length > 1 ? 's' : ''}</span>
        )}
      </div>

      {notes.map(n => (
        <div key={n.id} className="ml-4 mb-2 bg-gray-50 rounded-lg p-2.5">
          <p className="text-sm text-gray-700">{n.content}</p>
          <p className="text-xs text-gray-400 mt-1">{n.interviewer_name} · {n.created_at ? formatDate(n.created_at) : 'Today'}</p>
        </div>
      ))}

      {canEdit && (
        <div className="ml-4 flex gap-2 items-end">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={`Add ${stageLabel} notes…`}
            rows={2}
            className="flex-1 px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
          <button
            onClick={save}
            disabled={!draft.trim() || saving}
            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Send className="w-3.5 h-3.5"/>}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Profile Page ─────────────────────────────────────────
export function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, hasRole } = useAuthStore()
  const qc = useQueryClient()

  const canEdit       = hasRole(['admin', 'super_admin', 'hr_team'])
  const canAssign     = hasRole(['admin', 'super_admin'])
  const isInterviewer = hasRole(['interviewer'])
  const isSuperAdmin  = hasRole(['super_admin'])

  const [notes, setNotes]                   = useState('')
  const [savingNotes, setSavingNotes]       = useState(false)
  const [showStageMenu, setShowStageMenu]   = useState(false)
  const [showFeedbackConfirm, setShowFeedbackConfirm] = useState(false)
  const [submittingFeedback, setSubmittingFeedback]   = useState(false)

  // ── Candidate data ───────────────────────────────────────────
  const { data: candidate, isLoading, refetch } = useQuery({
    queryKey: ['candidate', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('*, job:jobs(id, title)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  // ── HR users & interviewers ──────────────────────────────────
  const { data: hrUsers = [] } = useQuery({
    queryKey: ['users', 'hr'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name')
        .in('role', ['hr_team', 'admin', 'super_admin']).eq('is_active', true)
      return data ?? []
    },
  })
  const { data: interviewers = [] } = useQuery({
    queryKey: ['users', 'interviewers'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name')
        .eq('role', 'interviewer').eq('is_active', true)
      return data ?? []
    },
  })

  // ── Interview notes ──────────────────────────────────────────
  const { data: interviewNotes = [], refetch: refetchNotes } = useQuery({
    queryKey: ['interview-notes', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('interview_notes')
        .select('*, interviewer:users(full_name)')
        .eq('candidate_id', id!)
        .order('created_at', { ascending: true })
      return (data ?? []).map(n => ({
        ...n,
        interviewer_name: (n.interviewer as any)?.full_name ?? 'Unknown',
      }))
    },
    enabled: !!id,
  })

  // ── Feedback submitted? ──────────────────────────────────────
  const { data: feedbackRecord } = useQuery({
    queryKey: ['feedback', id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('interview_feedback')
        .select('id')
        .eq('candidate_id', id!)
        .eq('interviewer_id', user!.id)
        .maybeSingle()
      return data
    },
    enabled: !!id && !!user && isInterviewer,
  })
  const feedbackSubmitted = !!feedbackRecord

  // ── Is this interviewer assigned to this candidate? ──────────
  const isAssignedInterviewer = isInterviewer && (candidate?.assigned_interviewers ?? []).includes(user?.id ?? '')

  useEffect(() => {
    if (candidate) setNotes(candidate.notes ?? '')
  }, [candidate?.id])

  // ── Mutations ────────────────────────────────────────────────
  const updateCandidate = async (patch: Record<string, any>) => {
    await supabase.from('candidates').update(patch).eq('id', id!)
    refetch()
    // Also invalidate the candidates list so table reflects changes
    qc.invalidateQueries({ queryKey: ['candidates'] })
  }

  const saveNotes = async () => {
    setSavingNotes(true)
    await updateCandidate({ notes })
    setSavingNotes(false)
  }

  // ── Submit Feedback ──────────────────────────────────────────
  const submitFeedback = async () => {
    setSubmittingFeedback(true)
    try {
      // Insert feedback record (marks as "submitted")
      await supabase.from('interview_feedback').upsert({
        candidate_id: id!,
        interviewer_id: user!.id,
        submitted_at: new Date().toISOString(),
      }, { onConflict: 'candidate_id,interviewer_id' })

      qc.invalidateQueries({ queryKey: ['feedback', id, user?.id] })
      qc.invalidateQueries({ queryKey: ['my-interviews', user?.id] })
      setShowFeedbackConfirm(false)
    } finally {
      setSubmittingFeedback(false)
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
  }
  if (!candidate) {
    return <div className="py-16 text-center text-gray-400">Candidate not found.</div>
  }

  const assignedInterviewerIds: string[] = candidate.assigned_interviewers ?? []

  return (
    <div className="max-w-5xl">
      {/* Back + header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-3 transition-colors">
            <ArrowLeft className="w-4 h-4"/> Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{candidate.full_name}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {candidate.source_name}{candidate.source_category ? ` · ${candidate.source_category.charAt(0).toUpperCase() + candidate.source_category.slice(1)}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Stage badge + changer (HR/Admin only) */}
          {canEdit ? (
            <div className="relative">
              <button
                onClick={() => setShowStageMenu(o => !o)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer border-0 ${STAGE_COLOURS[candidate.current_stage] ?? 'bg-gray-100 text-gray-700'}`}
              >
                {candidate.current_stage}
                <svg className="w-3.5 h-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
              </button>
              {showStageMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowStageMenu(false)}/>
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 w-48 max-h-72 overflow-y-auto">
                    {INTERVIEW_STAGES.map(s => (
                      <button key={s} onClick={() => { updateCandidate({ current_stage: s }); setShowStageMenu(false) }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center justify-between gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLOURS[s] ?? 'bg-gray-100 text-gray-700'}`}>{s}</span>
                        {s === candidate.current_stage && <Check className="w-3 h-3 text-blue-500"/>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${STAGE_COLOURS[candidate.current_stage] ?? 'bg-gray-100 text-gray-700'}`}>
              {candidate.current_stage}
            </span>
          )}

          {/* ── Submit Feedback button — INTERVIEWER ONLY ── */}
          {isAssignedInterviewer && !feedbackSubmitted && (
            <Button
              size="sm"
              onClick={() => setShowFeedbackConfirm(true)}
              icon={<Check className="w-3.5 h-3.5"/>}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              Submit Feedback
            </Button>
          )}
          {isAssignedInterviewer && feedbackSubmitted && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
              <Check className="w-3 h-3"/> Feedback Submitted
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── Left column ─────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Contact */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Contact</h3>
            <div className="space-y-2">
              {candidate.email && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="text-gray-400">✉</span>
                  <a href={`mailto:${candidate.email}`} className="hover:text-blue-600 transition-colors">{candidate.email}</a>
                </div>
              )}
              {candidate.phone && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="text-gray-400">📞</span>
                  <span>{candidate.phone}</span>
                </div>
              )}
              {candidate.linkedin_url && (
                <a href={candidate.linkedin_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                  <span>🔗</span> LinkedIn Profile
                </a>
              )}
            </div>
          </div>

          {/* ── Assignment (HR/Admin editable) ───────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Assignment</h3>

            {/* HR Owner — single-select pills */}
            <PillSingleSelect
              label="HR Owner"
              options={hrUsers as any[]}
              selectedId={candidate.hr_owner ?? null}
              disabled={!canAssign}
              onChange={id => updateCandidate({ hr_owner: id })}
            />

            {/* Interviewers — multi-select pills */}
            <PillMultiSelect
              label="Interviewers (select multiple)"
              options={interviewers as any[]}
              selectedIds={assignedInterviewerIds}
              disabled={!canEdit}
              onChange={ids => updateCandidate({ assigned_interviewers: ids })}
            />

            {/* Interview Date & Time */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Interview Date &amp; Time</label>
              <input
                type="datetime-local"
                // ── FIX: convert stored ISO string to datetime-local format
                defaultValue={
                  candidate.interview_date
                    ? new Date(candidate.interview_date).toISOString().slice(0, 16)
                    : ''
                }
                disabled={!canEdit}
                onBlur={e => {
                  const val = e.target.value
                  // Save as ISO string so both profile and list table stay in sync
                  updateCandidate({ interview_date: val ? new Date(val).toISOString() : null })
                }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:bg-gray-50"
              />
            </div>
          </div>

          {/* Meta */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Source</span>
                <span className="text-gray-700 font-medium">
                  {candidate.source_category
                    ? `${candidate.source_category.charAt(0).toUpperCase() + candidate.source_category.slice(1)} — ${candidate.source_name ?? ''}`
                    : candidate.source_name ?? '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Job</span>
                <span className="text-gray-700 font-medium">{(candidate.job as any)?.title ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Added</span>
                <span className="text-gray-700 font-medium">{candidate.created_at ? formatDate(candidate.created_at) : '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right column ─────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">

          {/* Resume */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Resume</h3>
              {candidate.resume_url && (
                <a href={candidate.resume_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  <ExternalLink className="w-3 h-3"/> Open
                </a>
              )}
            </div>
            {candidate.resume_url ? (
              <iframe
                src={candidate.resume_url}
                className="w-full h-64 rounded-lg border border-gray-100"
                title="Resume"
              />
            ) : (
              <p className="text-sm text-gray-400">No resume uploaded.</p>
            )}
          </div>

          {/* General Notes */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">General Notes</h3>
              {canEdit && (
                <button onClick={saveNotes} disabled={savingNotes}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50">
                  {savingNotes ? <Loader2 className="w-3 h-3 animate-spin"/> : <Check className="w-3 h-3"/>}
                  Save Notes
                </button>
              )}
            </div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={!canEdit}
              rows={5}
              placeholder="Add notes about this candidate…"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none disabled:opacity-50 disabled:bg-gray-50"
            />
          </div>

          {/* Interview Notes — per stage */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Interview Notes</h3>
            <div className="space-y-4">
              {STAGE_NOTE_KEYS.map(({ stage, label, field }) => {
                const stageNotes = interviewNotes.filter((n: any) => n.stage_field === field)
                // Only show note entry if: hr/admin can always see, interviewer only if assigned
                const canAddNote = canEdit || isAssignedInterviewer
                return (
                  <NoteSection
                    key={field}
                    stageLabel={label}
                    field={field}
                    candidateId={id!}
                    notes={stageNotes}
                    canEdit={canAddNote}
                    onSaved={refetchNotes}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Submit Feedback confirmation modal ─────────────────── */}
      <Modal open={showFeedbackConfirm} onClose={() => setShowFeedbackConfirm(false)} title="Submit Feedback" size="sm">
        <p className="text-sm text-gray-600 mb-4">
          Once submitted, your feedback for <strong>{candidate.full_name}</strong> will be marked as complete.
          This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setShowFeedbackConfirm(false)}>Cancel</Button>
          <Button
            loading={submittingFeedback}
            onClick={submitFeedback}
            className="bg-green-600 hover:bg-green-700 text-white"
            icon={<Check className="w-3.5 h-3.5"/>}
          >
            Yes, Submit Feedback
          </Button>
        </div>
      </Modal>
    </div>
  )
}
