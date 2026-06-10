// ============================================================
// CANDIDATE PROFILE PAGE — Clean sidebar layout, unified pills
// ============================================================
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  ArrowLeft, ExternalLink, Phone, Mail, Linkedin, FileText,
  Loader2, Send, Pencil, Check, X, ChevronDown, CheckCircle, XCircle,
  ClipboardList, ShieldCheck, BookOpen
} from 'lucide-react'
import { useCandidate, useUpdateStage } from './useCandidates'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../shared/components/Button'
import { useAuthStore } from '../auth/authStore'
import { formatDateTime, formatDate, formatRelative, labelOf } from '../../shared/utils/helpers'
import { supabase } from '../../lib/supabaseClient'
import { INTERVIEW_STAGES, type NoteEntry } from '../../types/database.types'
import { useStages as useStagesHook } from '../../shared/hooks/useStages'
import { useAgencies } from '../../shared/hooks/useAgencies'

// Derives stable key from stage name — same logic used everywhere
function stageKeyOf(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_')
}

// Fetch cost approval settings (stage name + panel user IDs)
function useCostApprovalSettings() {
  return useQuery({
    queryKey: ['app-settings', 'cost_approval'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings')
        .select('value').eq('key', 'cost_approval').maybeSingle()
      if (!data?.value) return { stageName: 'Cost Approval', panelIds: [] as string[] }
      try {
        const parsed = JSON.parse(data.value)
        return {
          stageName: (parsed.stage_name ?? 'Cost Approval') as string,
          panelIds: (parsed.reviewer_ids ?? []) as string[],
        }
      } catch {
        return { stageName: 'Cost Approval', panelIds: [] as string[] }
      }
    },
    staleTime: 30_000,
  })
}

// Unified pill design
const PILL_BASE     = 'px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer select-none'
const PILL_OFF     = 'bg-white border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-800'
const PILL_ON      = 'bg-slate-800 text-white border-slate-800'
const PILL_DISABLED = 'bg-gray-50 border-gray-100 text-gray-400 cursor-default'

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
  const isAgency      = hasRole(['agency'])
  const isHR          = hasRole(['hr_team'])
  const canEdit       = hasRole(['admin', 'super_admin', 'hr_team'])
  const canAssignHR   = hasRole(['admin', 'super_admin'])
  const canAddNotes   = hasRole(['admin', 'super_admin', 'hr_team', 'interviewer'])

  const [editMode, setEditMode]     = useState(false)
  const [stageOpen, setStageOpen]   = useState(false)
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)
  const [feedbackErr, setFeedbackErr] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState<{ section: string; index: number; text: string } | null>(null)
  const [savingEditNote, setSavingEditNote] = useState(false)
  const [decisionEditMode, setDecisionEditMode] = useState(false)
  // Cost approval state
  const [caDecision, setCaDecision]   = useState<'go_ahead' | 'rework_required' | 'rejected' | ''>('')
  const [caNotes, setCaNotes]         = useState('')
  const [caSaveStatus, setCaSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [caComment, setCaComment]     = useState('')
  const [caSavingComment, setCaSavingComment] = useState(false)
  const [caEditMode, setCaEditMode]   = useState(false)
  // Latch: once cost approval section is shown for this candidate, keep it shown
  // even during brief cache-refetch windows where conditions might flicker false.
  const costApprovalShownForId = useRef<string | null>(null)
  // Interview date inline auto-save
  const [interviewDateSaving, setInterviewDateSaving] = useState(false)
  const interviewDateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Edit mode drafts
  const [contactDraft, setContactDraft] = useState({
    full_name: '', email: '', phone: '', linkedin_url: '', resume_url: '',
    source_category: '', source_name: '',
  })
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

  // Job templates — stored in interview_format JSONB column.
  // 'screening' key = HR-only questions; other keys = round questions for panel members.
  const jobId = (candidate as any)?.job_id
  const { data: jobTemplates } = useQuery({
    queryKey: ['job-templates', jobId],
    queryFn: async () => {
      const { data } = await supabase.from('jobs')
        .select('interview_format')
        .eq('id', jobId!)
        .maybeSingle()
      return data as { interview_format: Record<string, string[]> | null } | null
    },
    enabled: !!jobId,
    staleTime: 60_000,
  })

  // Interview feedback records — used in cost approval to highlight interviewer + date
  const { data: interviewFeedbacks = [] } = useQuery({
    queryKey: ['interview-feedback-all', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('interview_feedback')
        .select('id, interviewer_id, stage, submitted_at, overall_score, strengths, concerns, recommendation')
        .eq('candidate_id', id!)
        .order('submitted_at', { ascending: true })
      return (data ?? []) as any[]
    },
    enabled: !!id,
    staleTime: 30_000,
  })

  // Sync cost approval fields from interview_notes.cost_approval when candidate loads
  useEffect(() => {
    if (!candidate) return
    const iNotes = (candidate as any).interview_notes ?? {}
    const caEntries: any[] = iNotes['cost_approval'] ?? []
    const latest = caEntries[caEntries.length - 1]
    if (latest) {
      setCaDecision(latest.decision ?? '')
      setCaNotes(latest.text ?? '')
    }
  }, [(candidate as any)?.id])

  // Keep interviewDateDraft in sync with DB value when not in edit mode
  useEffect(() => {
    if (!editMode && candidate) {
      setInterviewDateDraft(toDatetimeLocal((candidate as any).interview_date))
    }
  }, [(candidate as any)?.interview_date, editMode])

  // Stage config — shared hook (same queryKey as OrgSettingsTab + CandidatesPage)
  const { stageConfigs: stageConfigsRaw } = useStagesHook()

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

  const { data: caSettings } = useCostApprovalSettings()
  const costApprovalStageName = caSettings?.stageName ?? 'Cost Approval'
  const costApprovalPanelIds  = caSettings?.panelIds  ?? []

  const { data: myFeedback, refetch: refetchFeedback } = useQuery({
    queryKey: ['my-feedback', id, user?.id],
    queryFn: async () => {
      if (!isInterviewer || !user) return null
      const { data, error } = await supabase
        .from('interview_feedback')
        .select('id, submitted_at, recommendation, stage')
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
  const enterEditMode = () => {
    if (!candidate) return
    setContactDraft({
      full_name: candidate.full_name ?? '',
      email: candidate.email ?? '',
      phone: candidate.phone ?? '',
      linkedin_url: candidate.linkedin_url ?? '',
      resume_url: candidate.resume_url ?? '',
      source_category: (candidate as any).source_category ?? '',
      source_name: (candidate as any).source_name ?? '',
    })
    setGeneralNotesDraft((candidate as any).notes ?? '')
    setInterviewDateDraft(toDatetimeLocal((candidate as any).interview_date))
    setCustomDataDraft((candidate as any).custom_data ?? {})
    setEditMode(true)
  }

  // updateField — optimistic update + surgical cache patch, no visible flicker
  const updateField = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      // Apply optimistically to the profile cache immediately
      const prev = qc.getQueryData<any>(['candidate', id])
      if (prev) qc.setQueryData(['candidate', id], { ...prev, [field]: value })
      const { error } = await supabase.from('candidates').update({ [field]: value }).eq('id', id!)
      if (error) {
        // Revert on failure
        if (prev) qc.setQueryData(['candidate', id], prev)
        console.error('[updateField]', field, error)
        throw error
      }
    },
    onSuccess: (_, { field, value }) => {
      qc.setQueriesData<any[]>({ queryKey: ['candidates'] }, old =>
        Array.isArray(old) ? old.map(c => c.id === id ? { ...c, [field]: value } : c) : old
      )
      qc.invalidateQueries({ queryKey: ['candidates'], refetchType: 'none' })
      qc.invalidateQueries({ queryKey: ['candidate', id], refetchType: 'none' })
    },
  })

  const saveAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('candidates').update({
        full_name: contactDraft.full_name || undefined,
        email: contactDraft.email,
        phone: contactDraft.phone || null,
        linkedin_url: contactDraft.linkedin_url || null,
        resume_url: contactDraft.resume_url || null,
        source_category: contactDraft.source_category || null,
        source_name: contactDraft.source_name || null,
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

  // Interviewer decision: records feedback only — HR advances stage separately
  const makeDecision = useMutation({
    mutationFn: async ({ decision, currentStage }: {
      decision: 'yes' | 'no'; currentStage: string
    }) => {
      setFeedbackErr(null)
      const { data: existing } = await supabase
        .from('interview_feedback')
        .select('id')
        .eq('candidate_id', id!)
        .eq('interviewer_id', user!.id)
        .maybeSingle()

      let error
      if (existing?.id) {
        const result = await supabase.from('interview_feedback').update({
          submitted_at: new Date().toISOString(),
          stage: currentStage,
          recommendation: decision,
          overall_score: 3,
        }).eq('id', existing.id)
        error = result.error
      } else {
        const result = await supabase.from('interview_feedback').insert({
          candidate_id: id!,
          interviewer_id: user!.id,
          submitted_at: new Date().toISOString(),
          stage: currentStage,
          recommendation: decision,
          overall_score: 3,
        })
        error = result.error
      }
      if (error) { console.error('[feedback decision]', error); throw error }

      // On any verdict, clear interview_date so the candidate resets for the next scheduling cycle.
      // Rejection also auto-advances stage to "{stage} Rejected". A direct candidates.update()
      // is silently dropped by RLS for interviewers (candidates_update_staff only allows
      // admin/super_admin/hr_team), so use the SECURITY DEFINER set_candidate_stage RPC.
      const newStage = decision === 'no' ? `${currentStage} Rejected` : currentStage
      const { error: stageErr } = await supabase.rpc('set_candidate_stage', {
        p_candidate_id: id!,
        p_new_stage: newStage,
        p_new_status: 'active',
      })
      if (stageErr) {
        if (stageErr.code === 'PGRST202' || stageErr.message?.includes('Could not find')) {
          // RPC not yet created (migration not run) — fall back to direct update
          const candidateUpdate: Record<string, any> = { interview_date: null }
          if (decision === 'no') candidateUpdate.current_stage = newStage
          const { error: updateErr } = await supabase.from('candidates').update(candidateUpdate).eq('id', id!)
          if (updateErr) console.error('[candidate update after decision]', updateErr)
        } else {
          console.error('[set_candidate_stage]', stageErr)
          throw stageErr
        }
      }
    },
    onSuccess: async () => {
      setDecisionEditMode(false)
      await refetchFeedback()
      qc.invalidateQueries({ queryKey: ['my-feedback', id, user?.id] })
      qc.invalidateQueries({ queryKey: ['my-interviews'] })
      qc.invalidateQueries({ queryKey: ['candidate', id] })
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
      qc.invalidateQueries({ queryKey: ['interview-feedback-all', id] })
    },
    onError: (err: any) => {
      setFeedbackErr(err?.message ?? 'Failed. Check browser console.')
    },
  })

  const saveNote = async (sectionKey: string) => {
    const draft = draftNotes[sectionKey]?.trim()
    if (!draft) return
    setSavingNote(sectionKey)
    const existing = (candidate as any)?.interview_notes ?? {}
    const entries: NoteEntry[] = existing[sectionKey] ?? []
    const newEntry: NoteEntry = { text: draft, author: user!.full_name, authorId: user!.id, timestamp: new Date().toISOString() }
    const updated = { ...existing, [sectionKey]: [...entries, newEntry] }

    try {
      // Try RPC first (works for all roles including interviewers)
      const { data: newNotes, error: rpcError } = await supabase.rpc('submit_interview_note', {
        p_candidate_id: id!,
        p_section_key: sectionKey,
        p_note_text: draft,
      })
      if (!rpcError) {
        const cached = qc.getQueryData<any>(['candidate', id])
        if (cached) qc.setQueryData(['candidate', id], { ...cached, interview_notes: newNotes })
        setDraftNotes(p => ({ ...p, [sectionKey]: '' }))
        setSavingNote(null)
        return
      }
      // RPC not deployed — fall back to direct update
      if ((rpcError as any).code !== 'PGRST202' && !rpcError.message?.includes('Could not find')) {
        throw rpcError
      }
    } catch (err: any) {
      console.error('[saveNote]', err)
      setSavingNote(null)
      return
    }

    // Direct update fallback (only works for admin/HR/super_admin)
    try {
      const { data: rows, error: updateErr } = await supabase.from('candidates')
        .update({ interview_notes: updated }).eq('id', id!).select('id')
      if (updateErr) throw updateErr
      if (!rows?.length) throw new Error('Run supabase-ca-migration.sql in Supabase SQL Editor to enable this for interviewers')
      const cached = qc.getQueryData<any>(['candidate', id])
      if (cached) qc.setQueryData(['candidate', id], { ...cached, interview_notes: updated })
      setDraftNotes(p => ({ ...p, [sectionKey]: '' }))
    } catch (err: any) {
      console.error('[saveNote fallback]', err)
    }
    setSavingNote(null)
  }

  // Edit an existing note — only the original author can edit
  const saveEditedNote = async () => {
    if (!editingNote) return
    const { section, index, text } = editingNote
    const trimmed = text.trim()
    if (!trimmed) return
    setSavingEditNote(true)
    const existing = (candidate as any)?.interview_notes ?? {}
    const entries: NoteEntry[] = [...(existing[section] ?? [])]
    entries[index] = { ...entries[index], text: trimmed, timestamp: new Date().toISOString() }
    const newNotes = { ...existing, [section]: entries }

    // Optimistically update the cache first so the UI reflects the change immediately
    const cached = qc.getQueryData<any>(['candidate', id])
    if (cached) qc.setQueryData(['candidate', id], { ...cached, interview_notes: newNotes })
    setEditingNote(null)
    setSavingEditNote(false)

    // Persist to DB (RPC first for interviewer RLS bypass, direct update fallback)
    const { error: rpcError } = await supabase.rpc('submit_interview_note_edit', {
      p_candidate_id: id!,
      p_section_key: section,
      p_note_index: index,
      p_note_text: trimmed,
    })
    if (rpcError && (rpcError as any).code !== 'PGRST202' && !rpcError.message?.includes('Could not find')) {
      console.error('[saveEditedNote rpc]', rpcError)
    } else if (!rpcError) {
      return
    }

    // Direct update fallback
    const { error } = await supabase.from('candidates').update({
      interview_notes: newNotes
    }).eq('id', id!)
    if (error) {
      console.error('[saveEditedNote]', error)
      // Revert cache on failure
      if (cached) qc.setQueryData(['candidate', id], cached)
      qc.invalidateQueries({ queryKey: ['candidate', id] })
    }
  }

  const submitCostApproval = async () => {
    if (!caDecision) return
    if (caDecision === 'rework_required' && !caNotes.trim()) return
    setCaSaveStatus('saving')
    try {
      const decisionLabel = caDecision === 'go_ahead' ? 'Go Ahead'
        : caDecision === 'rejected' ? 'Rejected at CA'
        : 'Re-work Required'

      // Use SECURITY DEFINER RPC so interviewers (CA panel) can bypass the
      // candidates UPDATE RLS policy which only allows admin/hr_team/super_admin.
      const { data: savedNotes, error: rpcError } = await supabase.rpc('submit_cost_approval', {
        p_candidate_id: id!,
        p_decision: caDecision,
        p_notes: caNotes || '',
      })

      if (rpcError) {
        // RPC not yet created (migration not run) → fall back to direct update (works for admin/HR)
        if ((rpcError as any).code === 'PGRST202' || rpcError.message?.includes('Could not find')) {
          const existing = (candidate as any)?.interview_notes ?? {}
          const caEntry = {
            text: caNotes || '',
            author: user!.full_name,
            authorId: user!.id,
            timestamp: new Date().toISOString(),
            decision: caDecision,
          }
          const newNotes = { ...existing, cost_approval: [...(existing.cost_approval ?? []), caEntry] }
          const { data: updatedRows, error: updateError } = await supabase.from('candidates')
            .update({ interview_notes: newNotes })
            .eq('id', id!)
            .select('id')
          if (updateError) throw updateError
          if (!updatedRows?.length) throw new Error('Permission denied. Run supabase-ca-migration.sql in your Supabase SQL editor to enable CA panel decision saving.')
          qc.setQueryData(['candidate', id], { ...(qc.getQueryData<any>(['candidate', id]) ?? {}), interview_notes: newNotes })
        } else {
          throw rpcError
        }
      } else if (savedNotes) {
        // RPC returned the new interview_notes — update cache immediately
        const cached = qc.getQueryData<any>(['candidate', id])
        if (cached) qc.setQueryData(['candidate', id], { ...cached, interview_notes: savedNotes })
      }

      // When CA decision is rejection, auto-advance stage to "{CA stage} Rejected"
      if (caDecision === 'rejected') {
        const caRejectedStage = `${costApprovalStageName} Rejected`
        const { error: stageErr } = await supabase.from('candidates')
          .update({ current_stage: caRejectedStage, interview_date: null })
          .eq('id', id!)
        if (stageErr) console.error('[CA rejection stage update]', stageErr)
        else if (user?.id && candidate.current_stage !== caRejectedStage) {
          supabase.rpc('log_stage_change', {
            p_candidate_id: id!,
            p_from_stage: candidate.current_stage,
            p_to_stage: caRejectedStage,
            p_changed_by: user.id,
          }).then()
        }
      }

      // Force refetch to confirm DB state persisted
      qc.invalidateQueries({ queryKey: ['candidate', id] })
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })

      // Notify super_admin + admin + hr_team (non-blocking — ignore errors)
      supabase.from('users').select('id')
        .in('role', ['super_admin', 'admin', 'hr_team']).eq('is_active', true)
        .then(({ data: notifyUsers }) => {
          if (notifyUsers?.length) {
            supabase.from('notifications').insert(
              notifyUsers.map(u => ({
                user_id: u.id,
                type: 'cost_approval',
                title: `Cost Approval: ${candidate.full_name}`,
                body: `Decision: ${decisionLabel} · by ${user!.full_name}`,
                metadata: { candidate_id: id! },
              }))
            )
          }
        })

      setCaSaveStatus('saved')
      setCaEditMode(false)
      setTimeout(() => setCaSaveStatus('idle'), 3000)
    } catch (err: any) {
      console.error('[submitCostApproval]', err)
      setCaSaveStatus('error')
    }
  }

  const submitCAComment = async () => {
    if (!caComment.trim()) return
    setCaSavingComment(true)
    const existing = (candidate as any)?.interview_notes ?? {}
    const comments: NoteEntry[] = existing['cost_approval_comments'] ?? []
    const newEntry = { text: caComment.trim(), author: user!.full_name, authorId: user!.id, timestamp: new Date().toISOString() }
    const newNotes = { ...existing, cost_approval_comments: [...comments, newEntry] }

    // Try RPC first (bypasses RLS for interviewers); fall back to direct update for admin/HR
    let saved = false
    const { data: rpcResult, error: rpcErr } = await supabase.rpc('submit_ca_comment', {
      p_candidate_id: id!,
      p_comment_text: caComment.trim(),
    })
    if (!rpcErr && rpcResult) {
      qc.setQueryData(['candidate', id], { ...(qc.getQueryData<any>(['candidate', id]) ?? {}), interview_notes: rpcResult })
      saved = true
    } else {
      // Fallback: direct update (works for admin/HR)
      const { data: updatedRows, error: updateError } = await supabase.from('candidates')
        .update({ interview_notes: newNotes }).eq('id', id!).select('id')
      if (!updateError && updatedRows?.length) {
        const cached = qc.getQueryData<any>(['candidate', id])
        if (cached) qc.setQueryData(['candidate', id], { ...cached, interview_notes: newNotes })
        saved = true
      } else {
        console.error('[submitCAComment]', updateError ?? 'Permission denied (0 rows updated)')
      }
    }

    if (saved) {
      setCaComment('')
      qc.invalidateQueries({ queryKey: ['candidate', id] })
    }
    setCaSavingComment(false)
  }

  // Debounced interview date save — fires 800 ms after last keystroke, optimistic
  const saveInterviewDateInline = useCallback((val: string) => {
    if (interviewDateTimerRef.current) clearTimeout(interviewDateTimerRef.current)
    interviewDateTimerRef.current = setTimeout(async () => {
      setInterviewDateSaving(true)
      const isoVal = val ? toISO(val) : null
      const prev = qc.getQueryData<any>(['candidate', id])
      if (prev) qc.setQueryData(['candidate', id], { ...prev, interview_date: isoVal })
      const { error } = await supabase.from('candidates').update({ interview_date: isoVal }).eq('id', id!)
      if (error) {
        console.error('[interview date inline save]', error)
        if (prev) qc.setQueryData(['candidate', id], prev)
      } else {
        qc.setQueriesData<any[]>({ queryKey: ['candidates'] }, old =>
          Array.isArray(old) ? old.map(c => c.id === id ? { ...c, interview_date: isoVal } : c) : old
        )
        qc.invalidateQueries({ queryKey: ['candidates'], refetchType: 'none' })
      }
      setInterviewDateSaving(false)
    }, 800)
  }, [id, qc])

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

  // Stage names — always from settings hook (same source as CandidatesPage)
  const stages: string[] = stageConfigsRaw.map((s: any) => s.name)

  // Notes sections — all pipeline stages that have notes capability
  // Used for the interview notes panel (left column) and for cost approval history
  const ALL_NOTES_SECTIONS: { key: string; label: string }[] = (() => {
    const richConfigs = stageConfigsRaw.filter((s: any) => s.hasNotes)
    if (richConfigs.length) {
      return richConfigs.map((s: any) => ({
        key: stageKeyOf(s.name),
        label: s.name,
      }))
    }
    return [
      { key: 'screening',   label: 'Screening'     },
      { key: 'r1',          label: 'R1'             },
      { key: 'case_study',  label: 'Case Study'     },
      { key: 'r2',          label: 'R2'             },
      { key: 'r3',          label: 'R3'             },
      { key: 'cf_virtual',  label: 'CF (Virtual)'   },
      { key: 'cf_inperson', label: 'CF (In-Person)' },
    ]
  })()

  // Stage-based notes: show sections for stages the candidate has actually reached
  // (pipeline order up to and including current stage, excluding cost approval stage)
  const currentStageIdx = stages.indexOf(candidate.current_stage)
  const reachedStageKeys = new Set(
    stages
      .slice(0, currentStageIdx >= 0 ? currentStageIdx + 1 : stages.length)
      .filter(s => s !== costApprovalStageName)
      .map(stageKeyOf)
  )

  // Declare CA context variables early so visibleNotesSections and custom fields filter can use them
  const costApprovalPipelineIdxEarly = stages.findIndex(s => stageKeyOf(s) === stageKeyOf(costApprovalStageName))
  const hasReachedOrPassedCAEarly = costApprovalPipelineIdxEarly >= 0 && currentStageIdx >= costApprovalPipelineIdxEarly
  const isInCostApprovalEarly = stageKeyOf(candidate.current_stage) === stageKeyOf(costApprovalStageName)
  const isCAPanel = costApprovalPanelIds.includes(user?.id ?? '')

  // interviewNotes needed by visibleNotesSections (must precede it)
  const interviewNotes = (candidate as any).interview_notes ?? {}

  const visibleNotesSections = (() => {
    // CA panel members at cost approval stage: show ALL reached stages as context
    if (isInterviewer && isCAPanel && hasReachedOrPassedCAEarly) {
      return ALL_NOTES_SECTIONS.filter(s => reachedStageKeys.has(s.key))
    }
    if (isInterviewer) {
      const isOnCurrentPanel = ((candidate as any).assigned_interviewers ?? []).includes(user?.id ?? '')
      const currentKey = stageKeyOf(candidate.current_stage)

      // Always include sections where this interviewer has existing notes — so they can always edit
      const myNotesSections = ALL_NOTES_SECTIONS.filter(({ key }) =>
        (interviewNotes[key] ?? []).some((e: NoteEntry) => e.authorId === user?.id)
      )

      if (isOnCurrentPanel) {
        // On panel: show past notes sections + current stage section (for new notes)
        const currentSection = ALL_NOTES_SECTIONS.find(s => s.key === currentKey)
        const map = new Map(myNotesSections.map(s => [s.key, s]))
        if (currentSection) map.set(currentKey, currentSection)
        return Array.from(map.values())
      }

      // Not on current panel (e.g., R1 interviewer after candidate advanced to R2):
      // show only sections with their existing notes so they can still edit
      if (myNotesSections.length > 0) return myNotesSections
      // Fallback for first visit before any notes are written
      const fallback = ALL_NOTES_SECTIONS.find(s => s.key === currentKey)
      return fallback ? [fallback] : []
    }
    // HR and admin/super: show reached stages only (progressive reveal as candidate advances)
    return ALL_NOTES_SECTIONS.filter(s => reachedStageKeys.has(s.key))
  })()

  // Template questions per stage
  // Screening: HR only. Round: assigned panel member for this candidate, current stage only.
  const getTemplateQuestions = (sectionKey: string): string[] => {
    if (!jobTemplates) return []
    const fmt = jobTemplates.interview_format ?? {}
    if (sectionKey === 'screening') {
      return isHR ? (fmt['screening'] ?? []) : []
    }
    // Round questionnaire: only for the candidate's current stage, only if user is on the panel
    const onPanel = ((candidate as any).assigned_interviewers ?? []).includes(user?.id ?? '')
    const currentKey = stageKeyOf(candidate.current_stage)
    if (!onPanel || sectionKey !== currentKey) return []
    return fmt[sectionKey] ?? []
  }

  // interviewNotes declared above (before visibleNotesSections)

  // History stages: every pipeline stage except cost approval itself
  const HISTORY_STAGES: { key: string; label: string }[] = stages
    .filter(s => s !== costApprovalStageName)
    .map(s => ({ key: stageKeyOf(s), label: s }))

  // Cost approval context
  const isInCostApproval = isInCostApprovalEarly
  // isCAPanel, costApprovalPipelineIdxEarly, hasReachedOrPassedCAEarly declared above for visibleNotesSections
  const hasCostApprovalRecord = (interviewNotes['cost_approval'] ?? []).length > 0 || !!(candidate as any).cost_approval_decision
  const costApprovalPipelineIdx = costApprovalPipelineIdxEarly
  const hasReachedOrPassedCA = hasReachedOrPassedCAEarly
  // CA-rejected stage: candidate was rejected AT the cost approval step — CA view must stay visible
  const isCARejectedStage = candidate.current_stage === `${costApprovalStageName} Rejected`
  // Rejected candidates never show Cost Approval — EXCEPT when rejection happened at the CA stage itself
  const isRejectedStage = !isCARejectedStage && (candidate.current_stage === 'Rejected' || (candidate.current_stage ?? '').endsWith(' Rejected'))
  const canSeeCostApproval = !isRejectedStage && (isInCostApproval || hasReachedOrPassedCA || hasCostApprovalRecord) && (canEdit || isCAPanel)
  const canSubmitCostApproval = !isRejectedStage && isCAPanel && (isInCostApproval || hasReachedOrPassedCA || hasCostApprovalRecord)

  // Latch: keep showing during brief cache-refetch windows, but clear when stage
  // definitively moves below CA with no record (or is rejected) — restores normal UI
  if (canSeeCostApproval) {
    costApprovalShownForId.current = candidate.id
  } else if (isRejectedStage || (!isInCostApproval && !hasReachedOrPassedCA && !hasCostApprovalRecord)) {
    if (costApprovalShownForId.current === candidate.id) costApprovalShownForId.current = null
  }
  const canSeeCostApprovalLatched = canSeeCostApproval || costApprovalShownForId.current === candidate.id

  // Derived variables for the cost approval UI section
  const caEntries: any[] = interviewNotes['cost_approval'] ?? []
  const latestCAEntry = caEntries[caEntries.length - 1] ?? null
  const costApprovalDecision = (candidate as any).cost_approval_decision as string | null
  const costApprovalNotes: NoteEntry[] = (candidate as any).cost_approval_notes ?? []
  const hasCAResult = !!(latestCAEntry?.decision || costApprovalDecision)
  const caResultDecision: string = latestCAEntry?.decision ?? costApprovalDecision ?? ''
  const caResultGoAhead = caResultDecision === 'go_ahead'
  const caResultRejected = caResultDecision === 'rejected'
  const caResultAuthor = latestCAEntry?.author ?? ''
  const caResultTs = latestCAEntry?.timestamp ?? ''
  const caResultNotes = latestCAEntry?.text ?? ''
  const showCAForm = canSubmitCostApproval && (!hasCAResult || caEditMode)

  // Stage pill color — DB config → hardcoded map → gray fallback
  const STAGE_COLOURS: Record<string, string> = {
    Applied:'bg-gray-100 text-gray-600',      Screening:'bg-blue-50 text-blue-700',
    R1:'bg-indigo-50 text-indigo-700',        'Case Study':'bg-amber-50 text-amber-700',
    R2:'bg-orange-50 text-orange-700',        R3:'bg-orange-100 text-orange-800',
    'CF (Virtual)':'bg-purple-50 text-purple-700', 'CF (In-Person)':'bg-purple-100 text-purple-800',
    Offer:'bg-violet-50 text-violet-700',     Hired:'bg-green-50 text-green-700',
    Rejected:'bg-red-50 text-red-600',
  }
  const stageColor = (name: string): string => {
    const cfg = stageConfigsRaw.find((s: any) => s.name === name)
    if (cfg?.color) return `${cfg.color} ${cfg.textColor}`
    return STAGE_COLOURS[name] ?? 'bg-gray-100 text-gray-600'
  }
  const assignedInterviewers: string[] = (candidate as any).assigned_interviewers ?? []
  const assignedHROwners: string[] = (candidate as any)?.assigned_hr_owners?.length > 0
    ? (candidate as any).assigned_hr_owners
    : ((candidate as any).hr_owner ? [(candidate as any).hr_owner] : [])

  const feedbackSubmitted = !!myFeedback?.submitted_at
  const feedbackDecision = (myFeedback as any)?.recommendation as 'yes' | 'no' | null ?? null

  // Stage change: always clears interview_date; resets CA data if new stage is at/before CA stage
  const handleStageChange = async (newStage: string) => {
    setStageOpen(false)
    const fromStage = candidate.current_stage
    const newIdx = stages.indexOf(newStage)
    const updates: Record<string, any> = { current_stage: newStage, interview_date: null }

    if (costApprovalPipelineIdx >= 0 && newIdx <= costApprovalPipelineIdx) {
      const existing = (candidate as any)?.interview_notes ?? {}
      const { cost_approval: _ca, cost_approval_comments: _cac, ...cleanedNotes } = existing as Record<string, any>
      updates.cost_approval_decision = null
      updates.interview_notes = cleanedNotes
      const hasCaData = !!(candidate as any)?.cost_approval_decision ||
        ((candidate as any)?.interview_notes?.cost_approval ?? []).length > 0
      if (hasCaData) {
        const existingNotes: any[] = (candidate as any)?.cost_approval_notes ?? []
        updates.cost_approval_notes = [...existingNotes, {
          text: `Cost approval reset — stage moved back to ${newStage}`,
          author: user?.full_name ?? 'System',
          authorId: user?.id ?? '',
          timestamp: new Date().toISOString(),
        }]
      }
    }

    // Optimistic: apply stage badge change instantly — no waiting for DB round-trip
    const prev = qc.getQueryData<any>(['candidate', id])
    if (prev) qc.setQueryData(['candidate', id], { ...prev, ...updates })

    const { error } = await supabase.from('candidates').update(updates).eq('id', candidate.id)
    if (error) {
      console.error('[stage change]', error)
      if (prev) qc.setQueryData(['candidate', id], prev)  // revert on failure
      alert(`Could not change stage: ${error.message}`)
      return
    }
    // Log the stage change for HR activity tracking (fire-and-forget)
    if (user?.id && fromStage !== newStage) {
      supabase.rpc('log_stage_change', {
        p_candidate_id: candidate.id,
        p_from_stage:   fromStage,
        p_to_stage:     newStage,
        p_changed_by:   user.id,
      }).then()
    }
    qc.setQueriesData<any[]>({ queryKey: ['candidates'] }, old =>
      Array.isArray(old) ? old.map(c => c.id === candidate.id ? { ...c, ...updates } : c) : old
    )
    qc.invalidateQueries({ queryKey: ['candidates'], refetchType: 'none' })
    qc.invalidateQueries({ queryKey: ['candidate', id], refetchType: 'none' })
    qc.invalidateQueries({ queryKey: ['widget'] })
    qc.invalidateQueries({ queryKey: ['hr-activity'] })
  }

  // Google Drive preview: convert share URL to embedded preview
  const drivePreviewUrl = candidate.resume_url
    ? candidate.resume_url.includes('drive.google.com')
      ? candidate.resume_url
          .replace(/\/view.*$/, '/preview')
          .replace(/\/edit.*$/, '/preview')
      : null
    : null

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft className="w-4 h-4"/> Back
        </button>
        <div className="flex items-center gap-2">
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
          <p className="text-sm text-gray-400 mt-0.5">
            {(candidate as any).agency?.name
              ? <span>🏢 {(candidate as any).agency.name}</span>
              : candidate.source_category === 'referral'
                ? <span>👤 {candidate.source_name ? `Referred by ${candidate.source_name}` : 'Employee Referral'}</span>
                : `${candidate.source_name} · ${labelOf(candidate.source_category)}`
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Cost approval decision badge — visible to admin/super_admin/hr */}
          {costApprovalDecision && canEdit && (
            <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              costApprovalDecision === 'go_ahead'
                ? 'bg-green-100 text-green-700 border border-green-200'
                : costApprovalDecision === 'rejected'
                ? 'bg-red-100 text-red-700 border border-red-200'
                : 'bg-orange-100 text-orange-700 border border-orange-200'
            }`}>
              {costApprovalDecision === 'go_ahead' ? '✅ Go Ahead'
              : costApprovalDecision === 'rejected' ? '❌ CA Rejected'
              : '🔁 Re-work Required'}
            </span>
          )}
          <div className="relative">
            {canEdit && !isAgency ? (
              <>
                <button onClick={() => setStageOpen(o => !o)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border ${stageColor(candidate.current_stage)} border-transparent`}>
                  {candidate.current_stage}<ChevronDown className="w-3.5 h-3.5 opacity-60"/>
                </button>
                {stageOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setStageOpen(false)}/>
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 w-52 max-h-80 overflow-y-auto">
                      {stages.map((s: string) => (
                        <button key={s} onClick={() => handleStageChange(s)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${stageColor(s)}`}>{s}</span>
                          {s === candidate.current_stage && <Check className="w-3.5 h-3.5 text-slate-600"/>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${stageColor(candidate.current_stage)}`}>
                {candidate.current_stage}
                {isAgency && <span className="ml-1.5 text-xs opacity-60">(view only)</span>}
              </span>
            )}
          </div>
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
                {/* Name */}
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">Full Name</label>
                  <input value={contactDraft.full_name}
                    onChange={e => setContactDraft(p => ({ ...p, full_name: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"/>
                </div>
                {/* Contact fields */}
                {([
                  ['email','Email','email'],
                  ['phone','Phone','tel'],
                  ['linkedin_url','LinkedIn','url'],
                  ['resume_url','Resume URL','url'],
                ] as const).map(([k,label,type]) => (
                  <div key={k}>
                    <label className="block text-xs text-gray-400 mb-0.5">{label}</label>
                    <input type={type} value={contactDraft[k]}
                      onChange={e => setContactDraft(p => ({ ...p, [k]: e.target.value }))}
                      placeholder={k === 'resume_url' ? 'https://drive.google.com/...' : ''}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"/>
                  </div>
                ))}
                {/* Source — separate dropdowns */}
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">Source</label>
                  <select value={contactDraft.source_category}
                    onChange={e => setContactDraft(p => ({ ...p, source_category: e.target.value, source_name: '' }))}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select source…</option>
                    <option value="platform">🔗 Platform</option>
                    <option value="agency">🏢 Agency</option>
                    <option value="college">🎓 College</option>
                    <option value="referral">👤 Employee Referral</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">Sub-Source</label>
                  <ProfileSubSource
                    sourceCategory={contactDraft.source_category}
                    value={contactDraft.source_name}
                    onChange={v => setContactDraft(p => ({ ...p, source_name: v }))}
                  />
                </div>
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
                {candidate.resume_url && (
                  <a href={candidate.resume_url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-sm text-blue-600 hover:underline">
                    <FileText className="w-3.5 h-3.5 flex-shrink-0"/>View Resume
                  </a>
                )}
                {!candidate.phone && !candidate.linkedin_url && !candidate.resume_url && (
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
                ['Source', candidate.source_category === 'referral'
                  ? (candidate.source_name ? `Referred by ${candidate.source_name}` : 'Employee Referral — Unknown')
                  : `${labelOf(candidate.source_category)} — ${candidate.source_name}`
                ],
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

          {/* Assignment — hidden from interviewer AND agency */}
          {!isInterviewer && !isAgency && (
            <div className="px-5 py-4 space-y-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Assignment</p>

              {/* HR Owner */}
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
                            const next = sel ? null : u.id
                            updateField.mutate({ field: 'hr_owner', value: next })
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

              {/* Interview Date — always editable inline for canEdit; auto-saves 800 ms after change */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-500">Interview Date & Time</p>
                  {interviewDateSaving && <Loader2 className="w-3 h-3 animate-spin text-gray-400"/>}
                </div>
                {canEdit ? (
                  <input
                    type="datetime-local"
                    value={interviewDateDraft}
                    onChange={e => {
                      setInterviewDateDraft(e.target.value)
                      if (!editMode) saveInterviewDateInline(e.target.value)
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />
                ) : (
                  <p className="text-sm text-gray-700">
                    {(candidate as any).interview_date ? formatDateTime((candidate as any).interview_date) : <span className="text-gray-400 italic text-xs">Not set</span>}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Interview Date — visible to agency as read-only */}
          {isAgency && (candidate as any).interview_date && (
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Interview</p>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-blue-500">📅</span>
                {formatDateTime((candidate as any).interview_date)}
              </div>
            </div>
          )}
          {(() => {
            const visibleFields = (customFields as any[]).filter((f: any) =>
              !isInterviewer || f.show_to_interviewer !== false || (isCAPanel && (isInCostApprovalEarly || hasReachedOrPassedCAEarly))
            )
            if (visibleFields.length === 0) return null
            const customData = (candidate as any).custom_data ?? {}
            return (
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Additional Details</p>
                {editMode ? (
                  <div className="space-y-3">
                    {visibleFields.map((f: any) => (
                      <div key={f.id}>
                        <label className="block text-xs text-gray-400 mb-0.5">
                          {f.field_label}
                          {f.is_required && <span className="text-red-400 ml-1">*</span>}
                          {!isInterviewer && f.show_to_interviewer === false && (
                            <span className="ml-1 text-xs text-gray-300">(restricted)</span>
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
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"/>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <dl className="space-y-2">
                    {visibleFields.map((f: any) => {
                      const val = customData[f.field_name]
                      return (
                        <div key={f.id} className="flex gap-2">
                          <dt className="text-gray-400 text-xs w-28 flex-shrink-0 pt-0.5">{f.field_label}</dt>
                          <dd className="text-sm text-gray-700 font-medium">
                            {val === undefined || val === null || val === ''
                              ? <span className="text-gray-300 italic text-xs">—</span>
                              : f.field_type === 'boolean'
                              ? (val === 'true' || val === true ? 'Yes' : 'No')
                              : f.field_type === 'url'
                              ? <a href={val} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs break-all">{val}</a>
                              : String(val)
                            }
                          </dd>
                        </div>
                      )
                    })}
                  </dl>
                )}
              </div>
            )
          })()}
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
              <iframe src={drivePreviewUrl} className="w-full border-0" style={{ height: '320px' }} title="Resume"/>
            ) : candidate.resume_url ? (
              <div className="px-5 py-4 flex items-center gap-2.5">
                <FileText className="w-4 h-4 flex-shrink-0 text-gray-400"/>
                <a href={candidate.resume_url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline break-all">
                  Open resume ↗
                </a>
                <span className="text-xs text-gray-400 flex-shrink-0">(inline preview for Google Drive only)</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 px-5 py-4 text-gray-400">
                <FileText className="w-4 h-4 flex-shrink-0"/>
                <p className="text-sm">No resume attached</p>
                {canEdit && <span className="text-xs text-gray-300">· Add URL via Edit</span>}
              </div>
            )}
          </div>

          {/* Interview Schedule — shown for interviewers (hidden in left sidebar for them) */}
          {isInterviewer && (
            <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
              (candidate as any).interview_date
                ? 'border-blue-100 bg-blue-50/60'
                : 'border-gray-100 bg-gray-50/40'
            }`}>
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <ClipboardList className="w-4 h-4 text-blue-600"/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Your Interview</p>
                {(candidate as any).interview_date ? (
                  <p className="text-sm font-medium text-gray-900">{formatDateTime((candidate as any).interview_date)}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">Not scheduled yet</p>
                )}
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                feedbackSubmitted ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {feedbackSubmitted ? 'Feedback Submitted' : 'Pending Feedback'}
              </span>
            </div>
          )}

          {/* General Notes — always visible (except agency) */}
          {!isAgency && (
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
          )}

          {/* ── Cost Approval — unified section with interview history + decision + discussion ── */}
          {!isAgency && canSeeCostApprovalLatched && (
            <div className={`rounded-xl border overflow-hidden bg-white ${
              hasCAResult
                ? caResultGoAhead ? 'border-green-200'
                : caResultRejected ? 'border-red-200'
                : 'border-orange-200'
                : 'border-amber-200'
            }`}>
              {/* Header */}
              <div className={`px-4 py-3 border-b flex items-center justify-between ${
                hasCAResult
                  ? caResultGoAhead ? 'bg-green-50 border-green-100'
                  : caResultRejected ? 'bg-red-50 border-red-100'
                  : 'bg-orange-50 border-orange-100'
                  : 'bg-amber-50/40 border-amber-100'
              }`}>
                <div className="flex items-center gap-2">
                  <ShieldCheck className={`w-4 h-4 flex-shrink-0 ${
                    hasCAResult
                      ? caResultGoAhead ? 'text-green-600'
                      : caResultRejected ? 'text-red-500'
                      : 'text-orange-500'
                      : 'text-amber-500'
                  }`}/>
                  <p className="text-sm font-semibold text-gray-800">Cost Approval</p>
                  {!hasCAResult && (isInCostApproval || hasReachedOrPassedCA) && (
                    <span className="text-xs text-amber-600">· Awaiting decision</span>
                  )}
                </div>
                {hasCAResult && (
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    caResultGoAhead ? 'bg-green-100 text-green-700'
                    : caResultRejected ? 'bg-red-100 text-red-700'
                    : 'bg-orange-100 text-orange-700'
                  }`}>
                    {caResultGoAhead ? '✓ Go Ahead'
                    : caResultRejected ? '✗ Rejected'
                    : '↺ Re-work Required'}
                  </span>
                )}
              </div>

              {/* Candidate Interview History — full notes per stage */}
              <div className="border-b border-gray-100">
                <div className="px-4 py-2.5 bg-gray-50/60 border-b border-gray-100">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Interview History</p>
                </div>
                <div className="divide-y divide-gray-100">
                  {ALL_NOTES_SECTIONS.filter(s => s.key !== stageKeyOf(costApprovalStageName)).map(({ key, label }) => {
                    const entries: NoteEntry[] = interviewNotes[key] ?? []
                    const stageFeedback = interviewFeedbacks.filter((f: any) => stageKeyOf(f.stage ?? '') === key)
                    const noteAuthors = [...new Set(entries.map(e => e.author))]
                    const feedbackAuthors = stageFeedback.map((f: any) => {
                      const u = allUsers.find(u => u.id === f.interviewer_id)
                      return u?.full_name ?? null
                    }).filter(Boolean) as string[]
                    const allAuthors = [...new Set([...noteAuthors, ...feedbackAuthors])]
                    const firstTs = entries[0]?.timestamp ?? stageFeedback[0]?.submitted_at ?? null
                    const stageReached = reachedStageKeys.has(key)
                    return (
                      <div key={key} className={`px-4 py-3 ${stageReached ? '' : 'opacity-30'}`}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${stageReached ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                            {label}
                          </span>
                          {allAuthors.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              {allAuthors.map((author, i) => (
                                <div key={i} className="flex items-center gap-1">
                                  <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-600 text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                                    {author.charAt(0).toUpperCase()}
                                  </span>
                                  <span className="text-xs text-gray-500">{author}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {firstTs && <span className="text-xs text-gray-400 ml-auto">{formatDate(firstTs)}</span>}
                        </div>
                        {entries.length > 0 ? (
                          <div className="space-y-1.5 pl-1">
                            {entries.map((e, i) => (
                              <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
                                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{e.text}</p>
                                <p className="text-xs text-gray-400 mt-1">
                                  <span className="font-medium text-gray-500">{e.author}</span> · {formatRelative(e.timestamp)}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-300 italic pl-1">No notes</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Decision result */}
              {hasCAResult && !caEditMode && (
                <div className={`px-4 py-3 border-b ${
                  caResultGoAhead ? 'bg-green-50/20 border-green-100'
                  : caResultRejected ? 'bg-red-50/20 border-red-100'
                  : 'bg-orange-50/20 border-orange-100'
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-gray-500">
                        By <span className="font-medium text-gray-700">{caResultAuthor}</span>
                        {caResultTs && <span className="text-gray-400"> · {formatRelative(caResultTs)}</span>}
                      </p>
                      {caResultNotes && <p className="text-sm text-gray-700 mt-1.5 whitespace-pre-wrap leading-relaxed">{caResultNotes}</p>}
                    </div>
                    {canSubmitCostApproval && (
                      <button
                        onClick={() => { setCaEditMode(true); setCaDecision(caResultDecision as any); setCaNotes(caResultNotes) }}
                        className="flex-shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <Pencil className="w-3 h-3"/> Edit
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Submit / edit form — CA panel only */}
              {showCAForm && (
                <div className="px-4 py-3 border-b border-gray-100 space-y-3">
                  {caEditMode && <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Edit Decision</p>}
                  <textarea
                    rows={2}
                    value={caNotes}
                    onChange={e => setCaNotes(e.target.value)}
                    placeholder={caDecision === 'rework_required' ? 'Comment (required for Re-work)' : 'Notes (optional)'}
                    className={`w-full px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 resize-y ${
                      caDecision === 'rework_required' && !caNotes.trim()
                        ? 'border-orange-300 focus:ring-orange-300'
                        : 'border-gray-200 focus:ring-slate-300'
                    }`}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setCaDecision('go_ahead')}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-all ${
                        caDecision === 'go_ahead' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-green-700 border-green-200 hover:border-green-400'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5"/> Go Ahead
                    </button>
                    <button
                      onClick={() => setCaDecision('rework_required')}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-all ${
                        caDecision === 'rework_required' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-orange-700 border-orange-200 hover:border-orange-400'
                      }`}
                    >
                      <X className="w-3.5 h-3.5"/> Re-work
                    </button>
                    <button
                      onClick={() => setCaDecision('rejected')}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-all ${
                        caDecision === 'rejected' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-200 hover:border-red-400'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5"/> Reject
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={submitCostApproval}
                      disabled={!caDecision || (caDecision === 'rework_required' && !caNotes.trim()) || caSaveStatus === 'saving'}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        caSaveStatus === 'saved' ? 'bg-green-500 text-white'
                        : !caDecision || (caDecision === 'rework_required' && !caNotes.trim()) ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-slate-800 hover:bg-slate-700 text-white'
                      }`}
                    >
                      {caSaveStatus === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin"/>}
                      {caSaveStatus === 'saved' ? <><Check className="w-3.5 h-3.5"/> Submitted!</> : caSaveStatus === 'saving' ? 'Submitting…' : 'Submit Decision'}
                    </button>
                    {caEditMode && (
                      <button onClick={() => setCaEditMode(false)} className="px-3 py-2 border border-gray-200 text-gray-500 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
                    )}
                    {caSaveStatus === 'error' && <p className="text-xs text-red-600">Failed. Try again.</p>}
                  </div>
                </div>
              )}

              {/* Discussion / Comments chat */}
              <div className="px-4 py-3.5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Discussion</p>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {(interviewNotes['cost_approval_comments'] ?? []).length === 0 && (
                    <p className="text-xs text-gray-400 italic">No comments yet.</p>
                  )}
                  {(interviewNotes['cost_approval_comments'] ?? []).map((c: any, i: number) => {
                    const isMe = c.authorId === user?.id
                    return (
                      <div key={i} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${isMe ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                          {(c.author ?? '?').charAt(0).toUpperCase()}
                        </div>
                        <div className={`flex flex-col gap-0.5 max-w-[78%] ${isMe ? 'items-end' : 'items-start'}`}>
                          <div className={`px-3 py-2 rounded-2xl text-sm leading-snug ${isMe ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'}`}>
                            {c.text}
                          </div>
                          <p className="text-[10px] text-gray-400 px-1">
                            {!isMe && <span className="font-medium text-gray-500 mr-1">{c.author}</span>}
                            {formatRelative(c.timestamp)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {(canEdit || isCAPanel) && (
                  <div className="flex gap-2 items-end mt-3">
                    <textarea
                      rows={2}
                      value={caComment}
                      onChange={e => setCaComment(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitCAComment() }}
                      placeholder="Add a comment… (Ctrl+Enter to send)"
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                    />
                    <button
                      onClick={submitCAComment}
                      disabled={!caComment.trim() || caSavingComment}
                      className="flex-shrink-0 h-8 w-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 flex items-center justify-center transition-colors"
                    >
                      {caSavingComment ? <Loader2 className="w-3 h-3 text-white animate-spin"/> : <Send className="w-3 h-3 text-white"/>}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Interview Notes — shown ONLY when Cost Approval section is NOT visible */}
          {!isAgency && !canSeeCostApprovalLatched && (
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3 px-1">Interview Notes</p>

            {/* ── Interviewer: Knowledge Base (previous rounds, read-only) ── */}
            {isInterviewer && (() => {
              const currentIdx = stages.indexOf(candidate.current_stage)
              const prevStagesWithNotes = currentIdx > 0
                ? stages.slice(0, currentIdx)
                    .filter(s => s !== costApprovalStageName)
                    .map(s => ({ key: stageKeyOf(s), label: s }))
                    .filter(({ key }) => (interviewNotes[key] ?? []).length > 0)
                : []
              if (prevStagesWithNotes.length === 0) return null
              return (
                <div className="mb-4 rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                    <BookOpen className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Knowledge Base</p>
                    <span className="text-xs text-slate-400">— previous rounds, read-only</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {prevStagesWithNotes.map(({ key, label }) => {
                      const entries: NoteEntry[] = interviewNotes[key] ?? []
                      return (
                        <div key={key} className="px-4 py-3">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{label}</p>
                          <div className="space-y-1.5">
                            {entries.map((e, i) => (
                              <div key={i} className="bg-white border border-slate-100 rounded-lg px-3 py-2.5">
                                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{e.text}</p>
                                <p className="text-xs text-slate-400 mt-1">
                                  <span className="font-medium text-slate-500">{e.author}</span> · {formatRelative(e.timestamp)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* ── Notes sections (per pipeline stage) ── */}
            <div className="space-y-0">
              {visibleNotesSections.map(({ key, label }, sectionIdx) => {
                const entries: NoteEntry[] = interviewNotes[key] ?? []
                const draft = draftNotes[key] ?? ''
                const templateQs = getTemplateQuestions(key)
                return (
                  <div key={key} className={`${sectionIdx > 0 ? 'border-t border-gray-100' : ''}`}>
                    {/* Section header */}
                    <div className="flex items-center gap-2 px-1 py-2.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${entries.length > 0 ? 'bg-slate-600' : 'bg-gray-200'}`}/>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">{label}</p>
                      {entries.length > 0 && <span className="text-xs text-gray-400">{entries.length}</span>}
                    </div>

                    {/* Questionnaire for this stage — only shown when questions exist */}
                    {templateQs.length > 0 && (
                      <div className="pl-3.5 pb-2">
                        <p className="text-xs text-indigo-600 font-semibold mb-1.5 uppercase tracking-wide">Interview Format</p>
                        <ol className="space-y-1 list-decimal list-inside">
                          {templateQs.map((q, qi) => (
                            <li key={qi} className="text-xs text-indigo-700 bg-indigo-50/60 rounded px-2.5 py-1.5 leading-relaxed">{q}</li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* Existing entries */}
                    {entries.length > 0 && (
                      <div className="space-y-2 mb-2 pl-3.5">
                        {entries.map((e, i) => {
                          const isMyNote = e.authorId === user?.id
                          const isEditing = editingNote?.section === key && editingNote?.index === i
                          return (
                            <div key={i} className="bg-gray-50 rounded-lg px-3 py-2.5 group/note">
                              {isEditing ? (
                                <div className="space-y-2">
                                  <textarea autoFocus rows={4} value={editingNote.text}
                                    onChange={ev => setEditingNote(p => p ? { ...p, text: ev.target.value } : null)}
                                    className="w-full px-2.5 py-2 border border-slate-400 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y"/>
                                  <div className="flex items-center gap-2">
                                    <button onClick={saveEditedNote} disabled={savingEditNote || !editingNote.text.trim()}
                                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:bg-gray-300 text-white text-xs rounded-lg flex items-center gap-1 transition-colors">
                                      {savingEditNote ? <Loader2 className="w-3 h-3 animate-spin"/> : <Check className="w-3 h-3"/>}
                                      Save
                                    </button>
                                    <button onClick={() => setEditingNote(null)}
                                      className="px-3 py-1 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-gray-100 transition-colors">
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{e.text}</p>
                                  <div className="flex items-center justify-between mt-1.5">
                                    <p className="text-xs text-gray-400">
                                      <span className="font-medium text-gray-500">{e.author}</span> · {formatRelative(e.timestamp)}
                                    </p>
                                    {isMyNote && (
                                      <button onClick={() => setEditingNote({ section: key, index: i, text: e.text })}
                                        className="opacity-0 group-hover/note:opacity-100 transition-opacity text-xs text-gray-400 hover:text-slate-600 flex items-center gap-0.5">
                                        <Pencil className="w-3 h-3"/> Edit
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Input — interviewers can only add notes on current stage while on panel */}
                    {canAddNotes && (!isHR || key === 'screening') &&
                      (!isInterviewer || (key === stageKeyOf(candidate.current_stage) && assignedInterviewers.includes(user?.id ?? ''))) && (
                      <div className="flex gap-2 items-end pb-3 pl-3.5">
                        <textarea rows={3} value={draft}
                          onChange={e => setDraftNotes(p => ({ ...p, [key]: e.target.value }))}
                          placeholder={`Add ${label} note…`}
                          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(key) }}
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y min-h-[72px]"/>
                        <button onClick={() => saveNote(key)} disabled={!draft.trim() || savingNote === key}
                          className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:bg-gray-200 flex items-center justify-center transition-colors self-end">
                          {savingNote === key ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin"/> : <Send className="w-3.5 h-3.5 text-white"/>}
                        </button>
                      </div>
                    )}
                    {entries.length === 0 && !(canAddNotes && (!isHR || key === 'screening') && (!isInterviewer || (key === stageKeyOf(candidate.current_stage) && assignedInterviewers.includes(user?.id ?? '')))) && (
                      <p className="text-xs text-gray-400 pl-3.5 pb-3 italic">No notes yet.</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          )}

          {/* Agency Feedback — only shown when source_category = 'agency'
              HR/Admin: Read+Write | Agency: Read-only | Interviewer: Hidden */}
          {!isInterviewer && (candidate as any).source_category === 'agency' && (
            <>
              {isAgency && (
                <div className="bg-blue-50/60 rounded-xl border border-blue-100 px-5 py-4">
                  <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0"/>
                    HR Feedback
                  </p>
                  {(candidate as any).agency_notes ? (
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {(candidate as any).agency_notes}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No feedback shared yet.</p>
                  )}
                </div>
              )}
              {!isAgency && (
                <AgencyFeedbackEditor
                  candidateId={candidate.id}
                  currentFeedback={(candidate as any).agency_notes ?? ''}
                  canEdit={canEdit}
                />
              )}
            </>
          )}

          {/* ── Panel Decisions — visible to HR/Admin for current stage ── */}
          {canEdit && !isInterviewer && (() => {
            const stageFeedbacks = (interviewFeedbacks as any[]).filter(f => f.stage === candidate.current_stage)
            if (!stageFeedbacks.length) return null
            const userMap = Object.fromEntries(allUsers.map(u => [u.id, u.full_name]))
            return (
              <div className="bg-gray-50/60 rounded-xl border border-gray-100 px-5 py-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Panel Decisions
                  <span className="ml-1.5 text-xs font-normal text-gray-400">— {candidate.current_stage}</span>
                </p>
                <div className="space-y-2">
                  {stageFeedbacks.map((f: any) => {
                    const isYes = f.recommendation === 'yes'
                    const isNo  = f.recommendation === 'no'
                    return (
                      <div key={f.id} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${
                        isYes ? 'bg-green-50 border-green-100' : isNo ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'
                      }`}>
                        <div className="flex items-center gap-2">
                          {isYes
                            ? <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0"/>
                            : isNo
                            ? <XCircle className="w-4 h-4 text-red-500 flex-shrink-0"/>
                            : null}
                          <span className="text-sm text-gray-700">{userMap[f.interviewer_id] ?? '—'}</span>
                        </div>
                        <span className={`text-xs font-semibold ${isYes ? 'text-green-700' : isNo ? 'text-red-700' : 'text-gray-400'}`}>
                          {isYes ? '✓ Proceed' : isNo ? '✗ Reject' : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ── Interview Decision — Interviewers only ── */}
          {isInterviewer && (
            <div className={`rounded-xl border-2 px-5 py-4 ${
              feedbackDecision === 'yes' && !decisionEditMode ? 'border-green-200 bg-green-50/40' :
              feedbackDecision === 'no'  && !decisionEditMode ? 'border-red-200 bg-red-50/40' :
              'border-slate-200 bg-slate-50/40'
            }`}>
              {feedbackDecision === 'yes' && !decisionEditMode ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0"/>
                    <div>
                      <p className="text-sm font-semibold text-green-800">Decision Submitted — Proceed</p>
                      <p className="text-xs text-green-600 mt-0.5">You recommended this candidate for the next round.</p>
                    </div>
                  </div>
                  <button onClick={() => setDecisionEditMode(true)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 ml-4">
                    <Pencil className="w-3 h-3"/> Edit
                  </button>
                </div>
              ) : feedbackDecision === 'no' && !decisionEditMode ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <XCircle className="w-5 h-5 text-red-500 flex-shrink-0"/>
                    <div>
                      <p className="text-sm font-semibold text-red-700">Decision Submitted — Rejected</p>
                      <p className="text-xs text-red-500 mt-0.5">You rejected this candidate at {(myFeedback as any)?.stage ?? candidate.current_stage}.</p>
                    </div>
                  </div>
                  <button onClick={() => setDecisionEditMode(true)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 ml-4">
                    <Pencil className="w-3 h-3"/> Edit
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-semibold text-gray-800">Your Decision</p>
                    {decisionEditMode && (
                      <button onClick={() => setDecisionEditMode(false)}
                        className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                        <X className="w-3 h-3"/> Cancel
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-3">Add interview notes above, then submit your recommendation.</p>
                  {feedbackErr && <p className="text-xs text-red-600 mb-2">{feedbackErr}</p>}
                  <div className="flex gap-3">
                    <button
                      onClick={() => makeDecision.mutate({ decision: 'yes', currentStage: candidate.current_stage })}
                      disabled={makeDecision.isPending}
                      className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {makeDecision.isPending ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle className="w-4 h-4"/>}
                      Recommend: Proceed
                    </button>
                    <button
                      onClick={() => makeDecision.mutate({ decision: 'no', currentStage: candidate.current_stage })}
                      disabled={makeDecision.isPending}
                      className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {makeDecision.isPending ? <Loader2 className="w-4 h-4 animate-spin"/> : <XCircle className="w-4 h-4"/>}
                      Recommend: Reject
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
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

// ── Agency Feedback Editor (HR/Admin fills, Agency reads) ─────
function AgencyFeedbackEditor({ candidateId, currentFeedback, canEdit }: {
  candidateId: string; currentFeedback: string; canEdit: boolean
}) {
  const [text, setText] = useState(currentFeedback)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const qc = useQueryClient()

  const save = async () => {
    setSaving(true)
    await supabase.from('candidates').update({ agency_notes: text }).eq('id', candidateId)
    qc.invalidateQueries({ queryKey: ['candidate', candidateId] })
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="bg-amber-50/40 rounded-xl border border-amber-100 px-5 py-4 space-y-2">
      <p className="text-sm font-semibold text-gray-700">Agency Feedback
        <span className="ml-1.5 text-xs font-normal text-gray-400">— visible to the agency</span>
      </p>
      {canEdit ? (
        <>
          <textarea rows={3} value={text} onChange={e=>setText(e.target.value)}
            placeholder="Add remarks for the agency about this candidate…"
            className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"/>
          <button onClick={save} disabled={saving || text === currentFeedback}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs rounded-lg hover:bg-amber-700 disabled:opacity-40 transition-colors">
            {saving ? <Loader2 className="w-3 h-3 animate-spin"/> : saved ? <Check className="w-3 h-3"/> : null}
            {saved ? 'Saved!' : 'Save feedback'}
          </button>
        </>
      ) : (
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{text || <span className="text-gray-400 italic text-xs">No feedback added yet.</span>}</p>
      )}
    </div>
  )
}

const _PLATFORM_SOURCES = ['LinkedIn','Naukri','Indeed','Internshala','Unstop','Shine','Monster','Foundit','Apna','Website','Other']

function ProfileSubSource({ sourceCategory, value, onChange }: {
  sourceCategory: string; value: string; onChange: (v: string) => void
}) {
  const { data: agencyUsers = [] } = useAgencies()
  const { data: employees = [] } = useQuery<string[]>({
    queryKey: ['employee-referral-list'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'employee_referral_list').maybeSingle()
      if (!data?.value) return []
      try { return JSON.parse(data.value) as string[] } catch { return [] }
    },
    staleTime: 60_000,
    enabled: sourceCategory === 'referral',
  })
  const cls = 'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400'

  if (sourceCategory === 'agency') return (
    <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
      <option value="">Select agency…</option>
      {agencyUsers.map((u:any) => <option key={u.id} value={u.name}>{u.name}</option>)}
    </select>
  )
  if (sourceCategory === 'platform') return (
    <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
      <option value="">Select platform…</option>
      {_PLATFORM_SOURCES.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
  )
  if (sourceCategory === 'referral') return (
    <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
      <option value="">Select employee…</option>
      {employees.map(e => <option key={e} value={e}>{e}</option>)}
    </select>
  )
  if (sourceCategory === 'college') return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder="e.g. IIT Delhi…" className={cls}/>
  )
  return <input disabled placeholder="Select source first…" className={`${cls} bg-gray-50 text-gray-400`}/>
}
