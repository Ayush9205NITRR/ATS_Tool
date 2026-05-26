// ============================================================
// CANDIDATE PROFILE PAGE — Clean sidebar layout, unified pills
// ============================================================
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  ArrowLeft, ExternalLink, Phone, Mail, Linkedin, FileText,
  Loader2, Send, Pencil, Check, X, ChevronDown, CheckCircle,
  ClipboardList, ShieldCheck, BookOpen
} from 'lucide-react'
import { useCandidate, useUpdateStage } from './useCandidates'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../shared/components/Button'
import { useAuthStore } from '../auth/authStore'
import { formatDateTime, formatDate, formatRelative, labelOf } from '../../shared/utils/helpers'
import { supabase } from '../../lib/supabaseClient'
import { INTERVIEW_STAGES, type NoteEntry, type CostApprovalSettings } from '../../types/database.types'
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
  // Note editing: key = `${sectionKey}:${entryIndex}`, value = draft text
  const [editingNote, setEditingNote] = useState<{ section: string; index: number; text: string } | null>(null)
  const [savingEditNote, setSavingEditNote] = useState(false)
  // Cost approval state
  const [caDecision, setCaDecision]   = useState<'go_ahead' | 'rework_required' | ''>('')
  const [caNotes, setCaNotes]         = useState('')
  const [caSaveStatus, setCaSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [caComment, setCaComment]     = useState('')
  const [caSavingComment, setCaSavingComment] = useState(false)
  const [caEditMode, setCaEditMode]   = useState(false)
  // Latch: once cost approval section is shown for this candidate, keep it shown
  // even during brief cache-refetch windows where conditions might flicker false.
  const costApprovalShownForId = useRef<string | null>(null)

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

  // Cost approval settings from app_settings
  const { data: costApprovalSettings } = useQuery({
    queryKey: ['app-settings', 'cost_approval'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'cost_approval').maybeSingle()
      if (!data?.value) return null
      try { return JSON.parse(data.value) as CostApprovalSettings } catch { return null }
    },
    staleTime: 30_000,
  })

  // Job templates — fetch screening_template + interview_templates for this job
  const jobId = (candidate as any)?.job_id
  const { data: jobTemplates } = useQuery({
    queryKey: ['job-templates', jobId],
    queryFn: async () => {
      const { data } = await supabase.from('jobs')
        .select('screening_template, interview_templates')
        .eq('id', jobId!)
        .maybeSingle()
      return data as { screening_template: string[] | null; interview_templates: Record<string, string[]> | null } | null
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

  // Submit feedback — simple: just marks that interviewer submitted feedback
  // Notes are already saved via interview_notes on candidates table
  const submitFeedback = useMutation({
    mutationFn: async () => {
      setFeedbackErr(null)

      const { data: existing } = await supabase
        .from('interview_feedback')
        .select('id')
        .eq('candidate_id', id!)
        .eq('interviewer_id', user!.id)
        .maybeSingle()

      let error
      if (existing?.id) {
        const result = await supabase.from('interview_feedback')
          .update({ submitted_at: new Date().toISOString() })
          .eq('id', existing.id)
        error = result.error
      } else {
        const result = await supabase.from('interview_feedback')
          .insert({ candidate_id: id!, interviewer_id: user!.id })
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
    const newNotes = { ...existing, [sectionKey]: [...entries, newEntry] }
    const { error } = await supabase.from('candidates').update({ interview_notes: newNotes }).eq('id', id!)
    if (error) { console.error('[saveNote]', error) }
    else {
      const cached = qc.getQueryData<any>(['candidate', id])
      if (cached) qc.setQueryData(['candidate', id], { ...cached, interview_notes: newNotes })
      setDraftNotes(p => ({ ...p, [sectionKey]: '' }))
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
    const { error } = await supabase.from('candidates').update({
      interview_notes: { ...existing, [section]: entries }
    }).eq('id', id!)
    if (error) console.error('[saveEditedNote]', error)
    else {
      qc.invalidateQueries({ queryKey: ['candidate', id] })
      setEditingNote(null)
    }
    setSavingEditNote(false)
  }

  const submitCostApproval = async () => {
    if (!caDecision) return
    setCaSaveStatus('saving')
    try {
      const decisionLabel = caDecision === 'go_ahead' ? 'Go Ahead' : 'Re-work Required'

      const existing = (candidate as any)?.interview_notes ?? {}
      const caEntry = {
        text: caNotes || '',
        author: user!.full_name,
        authorId: user!.id,
        timestamp: new Date().toISOString(),
        decision: caDecision,
      }
      const newNotes = { ...existing, cost_approval: [...(existing.cost_approval ?? []), caEntry] }

      const { error } = await supabase.from('candidates').update({
        interview_notes: newNotes,
      }).eq('id', id!)
      if (error) throw error

      // Optimistically update the React Query cache immediately so UI reflects decision at once
      const cached = qc.getQueryData<any>(['candidate', id])
      if (cached) {
        qc.setQueryData(['candidate', id], { ...cached, interview_notes: newNotes })
      }

      // Also try dedicated columns (might not exist if migration not run — ignore errors)
      await supabase.from('candidates').update({
        cost_approval_decision: caDecision,
        cost_approval_notes: caNotes || null,
        cost_approval_submitted_at: new Date().toISOString(),
        cost_approval_submitted_by: user!.id,
      }).eq('id', id!).then(() => {}, () => {})

      // Notify super_admin + admin + hr_team
      const { data: notifyUsers } = await supabase.from('users')
        .select('id')
        .in('role', ['super_admin', 'admin', 'hr_team'])
        .eq('is_active', true)
      if (notifyUsers?.length) {
        await supabase.from('notifications').insert(
          notifyUsers.map(u => ({
            user_id: u.id,
            type: 'cost_approval',
            message: `Cost Approval decision for ${candidate.full_name}: ${decisionLabel}. Submitted by ${user!.full_name}.`,
            candidate_id: id!,
          }))
        )
      }

      // Invalidate list view only; individual candidate cache is already correct from setQueryData above
      qc.invalidateQueries({ queryKey: ['candidates'] })
      setCaSaveStatus('saved')
      setCaEditMode(false)
      setTimeout(() => setCaSaveStatus('idle'), 3000)
    } catch (err) {
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
    const { error } = await supabase.from('candidates').update({
      interview_notes: newNotes,
    }).eq('id', id!)
    if (!error) {
      const cached = qc.getQueryData<any>(['candidate', id])
      if (cached) qc.setQueryData(['candidate', id], { ...cached, interview_notes: newNotes })
      setCaComment('')
    }
    setCaSavingComment(false)
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

  // Stage names — always from hook (hook returns defaults if DB empty)
  const stages: string[] = (() => {
    const jobStages = (candidate as any)?.job?.pipeline_stages
    if (jobStages?.length) return jobStages
    return stageConfigsRaw.map((s: any) => s.name)
  })()

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

  // Interviewers: only their current stage. HR: only sections with existing notes + screening. Admin/Super: all.
  const visibleNotesSections = (() => {
    if (isInterviewer) {
      const key = stageKeyOf(candidate.current_stage)
      const match = ALL_NOTES_SECTIONS.find(s => s.key === key)
      return match ? [match] : []
    }
    if (isHR) {
      // HR sees screening (their domain) + any section that already has notes
      return ALL_NOTES_SECTIONS.filter(s =>
        s.key === 'screening' || (interviewNotes[s.key] ?? []).length > 0
      )
    }
    return ALL_NOTES_SECTIONS
  })()

  // Template questions: HR only gets screening questionnaire; interviewers get their stage; admins get all
  const getTemplateQuestions = (sectionKey: string): string[] => {
    if (isHR && sectionKey !== 'screening') return []
    if (!jobTemplates) return []
    if (sectionKey === 'screening') return (jobTemplates.screening_template as string[]) ?? []
    return ((jobTemplates.interview_templates as Record<string, string[]>) ?? {})[sectionKey] ?? []
  }

  // History stages: every pipeline stage except cost approval itself
  const HISTORY_STAGES: { key: string; label: string }[] = stages
    .filter(s => s !== costApprovalStageName)
    .map(s => ({ key: stageKeyOf(s), label: s }))

  // Cost approval context
  const interviewNotes = (candidate as any).interview_notes ?? {}
  const isInCostApproval = candidate.current_stage === costApprovalStageName
  const isCAPanel = costApprovalPanelIds.includes(user?.id ?? '')
  const hasCostApprovalRecord = (interviewNotes['cost_approval'] ?? []).length > 0 || !!(candidate as any).cost_approval_decision
  const canSeeCostApproval = (isInCostApproval || hasCostApprovalRecord) && (canEdit || isCAPanel)
  const canSubmitCostApproval = isInCostApproval && isCAPanel

  // Latch: once we've shown this section for this candidate, keep showing it
  // even during brief cache-refetch windows where conditions might flicker false
  if (canSeeCostApproval) costApprovalShownForId.current = candidate.id
  const canSeeCostApprovalLatched = canSeeCostApproval || costApprovalShownForId.current === candidate.id

  // Derived variables for the cost approval UI section
  const caEntries: any[] = interviewNotes['cost_approval'] ?? []
  const latestCAEntry = caEntries[caEntries.length - 1] ?? null
  const costApprovalDecision = (candidate as any).cost_approval_decision as string | null
  const costApprovalNotes: NoteEntry[] = (candidate as any).cost_approval_notes ?? []
  const hasCAResult = !!(latestCAEntry?.decision || costApprovalDecision)
  const caResultDecision: string = latestCAEntry?.decision ?? costApprovalDecision ?? ''
  const caResultGoAhead = caResultDecision === 'go_ahead'
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

  // Cost approval — determine visibility
  const isCostApprovalStage = !!(costApprovalSettings?.stage_name && candidate.current_stage === costApprovalSettings.stage_name)
  const isCostApprovalReviewer = !!(costApprovalSettings && user && costApprovalSettings.reviewer_ids.includes(user.id))
  const canViewCostApproval = isCostApprovalStage && (isCostApprovalReviewer || canEdit)

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
                : 'bg-orange-100 text-orange-700 border border-orange-200'
            }`}>
              {costApprovalDecision === 'go_ahead' ? '✅ Go Ahead' : '🔁 Re-work Required'}
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
                        <button key={s} onClick={() => { updateStage.mutate({ id: candidate.id, stage: s }); setStageOpen(false) }}
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
              !isInterviewer || f.show_to_interviewer !== false
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
                            <span className="ml-1 text-xs text-gray-300">(hidden from interviewers)</span>
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

          {/* Interview Notes — always visible for non-agency */}
          {!isAgency && (
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3 px-1">Interview Notes</p>

            {/* ── Interviewer: Knowledge Base (previous rounds, read-only) ── */}
            {isInterviewer && (() => {
              const currentIdx = stages.indexOf(candidate.current_stage)
              const prevStages = currentIdx > 0
                ? stages.slice(0, currentIdx)
                    .filter(s => s !== costApprovalStageName)
                    .map(s => ({ key: stageKeyOf(s), label: s }))
                : []
              const hasPrevNotes = prevStages.some(({ key }) => (interviewNotes[key] ?? []).length > 0)
              if (!hasPrevNotes) return null
              return (
                <div className="mb-4 rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                    <BookOpen className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Knowledge Base</p>
                    <span className="text-xs text-slate-400">— previous rounds, read-only</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {/* Previous stage notes in pipeline order */}
                    {prevStages.map(({ key, label }) => {
                      const entries: NoteEntry[] = interviewNotes[key] ?? []
                      if (entries.length === 0) return null
                      return (
                        <div key={key} className="px-4 py-3">
                          <p className="text-xs font-medium text-slate-400 mb-1.5">{label}</p>
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

                    {/* Template questions — format for this stage */}
                    {templateQs.length > 0 && (
                      <div className="pl-3.5 pb-2">
                        <p className="text-xs text-indigo-600 font-medium mb-1.5">Format / Questions</p>
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

                    {/* Input — HR can only add to screening; other roles follow canAddNotes */}
                    {canAddNotes && (!isHR || key === 'screening') && (
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
                    {entries.length === 0 && !(canAddNotes && (!isHR || key === 'screening')) && (
                      <p className="text-xs text-gray-400 pl-3.5 pb-3 italic">No notes yet.</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          )}

          {/* ── Cost Approval ── */}
          {!isAgency && canSeeCostApprovalLatched && (
            <div className={`rounded-xl border overflow-hidden bg-white ${
              hasCAResult
                ? caResultGoAhead ? 'border-green-200' : 'border-orange-200'
                : 'border-amber-200'
            }`}>

              {/* Header */}
              <div className={`flex items-center justify-between px-5 py-4 ${
                hasCAResult
                  ? caResultGoAhead ? 'bg-green-50 border-b border-green-100' : 'bg-orange-50 border-b border-orange-100'
                  : 'bg-amber-50 border-b border-amber-100'
              }`}>
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className={`w-4 h-4 flex-shrink-0 ${
                    hasCAResult ? (caResultGoAhead ? 'text-green-600' : 'text-orange-500') : 'text-amber-600'
                  }`}/>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{costApprovalStageName}</p>
                    {!hasCAResult && <p className="text-xs text-amber-500">Awaiting panel decision</p>}
                    {hasCAResult && (
                      <p className="text-xs text-gray-500">
                        {caResultAuthor}{caResultTs ? ` · ${formatRelative(caResultTs)}` : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasCAResult && (
                    <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                      caResultGoAhead ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {caResultGoAhead ? <CheckCircle className="w-3.5 h-3.5"/> : <X className="w-3.5 h-3.5"/>}
                      {caResultGoAhead ? 'Go Ahead' : 'Re-work Required'}
                    </span>
                  )}
                  {hasCAResult && canSubmitCostApproval && !caEditMode && (
                    <button
                      onClick={() => { setCaEditMode(true); setCaDecision(caResultDecision as any); setCaNotes(caResultNotes) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-all"
                    >
                      <Pencil className="w-3 h-3"/> Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Decision notes — shown when submitted and not editing */}
              {hasCAResult && !caEditMode && caResultNotes && (
                <div className="px-5 py-3.5 border-b border-gray-100">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{caResultNotes}</p>
                </div>
              )}

              {/* Re-work: show interview history for context */}
              {hasCAResult && !caResultGoAhead && !caEditMode && (() => {
                const historyStages = ALL_NOTES_SECTIONS.filter(s => s.key !== stageKeyOf(costApprovalStageName))
                const stagesWithNotes = historyStages.filter(s => (interviewNotes[s.key] ?? []).length > 0)
                if (!stagesWithNotes.length) return null
                return (
                  <div className="px-5 py-4 border-b border-orange-100 bg-orange-50/30">
                    <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-3">Interview History</p>
                    <div className="space-y-3">
                      {stagesWithNotes.map(({ key, label }) => {
                        const entries: NoteEntry[] = interviewNotes[key] ?? []
                        return (
                          <div key={key}>
                            <p className="text-xs font-medium text-orange-600 mb-1.5">{label}</p>
                            <div className="space-y-1.5">
                              {entries.map((e, i) => (
                                <div key={i} className="bg-white rounded-lg px-3 py-2.5 border border-orange-100">
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{e.text}</p>
                                  <p className="text-xs text-gray-400 mt-1">
                                    <span className="font-medium text-gray-500">{e.author}</span> · {formatRelative(e.timestamp)}
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

              {/* Submit / Edit form — panel members only */}
              {((!hasCAResult && canSubmitCostApproval) || (caEditMode && canSubmitCostApproval)) && (
                <div className="px-5 py-4 space-y-3 border-b border-gray-100">
                  {caEditMode && (
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Edit Decision</p>
                  )}
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">Notes <span className="text-gray-300">(optional)</span></p>
                    <textarea
                      rows={3}
                      value={caNotes}
                      onChange={e => setCaNotes(e.target.value)}
                      placeholder="Add context for your decision…"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 resize-y"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setCaDecision('go_ahead')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                        caDecision === 'go_ahead'
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white text-green-700 border-green-200 hover:border-green-400'
                      }`}
                    >
                      <Check className="w-4 h-4"/> Go Ahead
                    </button>
                    <button
                      onClick={() => setCaDecision('rework_required')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                        caDecision === 'rework_required'
                          ? 'bg-orange-600 text-white border-orange-600'
                          : 'bg-white text-orange-700 border-orange-200 hover:border-orange-400'
                      }`}
                    >
                      <X className="w-4 h-4"/> Re-work Required
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={submitCostApproval}
                      disabled={!caDecision || caSaveStatus === 'saving'}
                      className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                        caSaveStatus === 'saved'
                          ? 'bg-green-500 text-white'
                          : !caDecision
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-slate-800 hover:bg-slate-700 text-white'
                      }`}
                    >
                      {caSaveStatus === 'saving' && <Loader2 className="w-4 h-4 animate-spin"/>}
                      {caSaveStatus === 'saved' ? <><Check className="w-4 h-4"/> Submitted!</>
                        : caSaveStatus === 'saving' ? 'Submitting…'
                        : 'Submit Decision'}
                    </button>
                    {caEditMode && (
                      <button
                        onClick={() => { setCaEditMode(false); setCaDecision(''); setCaNotes('') }}
                        className="px-4 py-2 border border-gray-200 text-gray-500 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    {caSaveStatus === 'error' && <p className="text-xs text-red-600">Failed. Try again.</p>}
                    {!caDecision && <p className="text-xs text-gray-400">Select a decision above</p>}
                  </div>
                </div>
              )}

              {/* Comments — always visible to panel + HR/admin */}
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Comments
                  {!canEdit && isCAPanel && <span className="ml-1.5 font-normal normal-case text-gray-300">(read-only)</span>}
                </p>
                {(interviewNotes['cost_approval_comments'] ?? []).length === 0 && (
                  <p className="text-xs text-gray-400 italic">No comments yet.</p>
                )}
                {(interviewNotes['cost_approval_comments'] ?? []).map((c: any, i: number) => (
                  <div key={i} className="bg-gray-50 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xs font-semibold text-gray-700">{c.author}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{formatRelative(c.timestamp)}</span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.text}</p>
                  </div>
                ))}
                {canEdit && (
                  <div className="flex gap-2 items-end">
                    <textarea
                      rows={2}
                      value={caComment}
                      onChange={e => setCaComment(e.target.value)}
                      placeholder="Add a comment…"
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 resize-y"
                    />
                    <button
                      onClick={submitCAComment}
                      disabled={!caComment.trim() || caSavingComment}
                      className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:bg-gray-200 flex items-center justify-center transition-colors self-end"
                    >
                      {caSavingComment ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin"/> : <Send className="w-3.5 h-3.5 text-white"/>}
                    </button>
                  </div>
                )}
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

          {/* ── Submit Feedback — Interviewers only, simple button at bottom ── */}
          {isInterviewer && (
            <div className={`rounded-xl border-2 px-5 py-4 flex items-center gap-4 ${feedbackSubmitted ? 'border-green-200 bg-green-50/40' : 'border-slate-200 bg-slate-50/40'}`}>
              {feedbackSubmitted ? (
                <div className="flex items-center gap-2.5">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0"/>
                  <div>
                    <p className="text-sm font-semibold text-green-800">Feedback Submitted</p>
                    <p className="text-xs text-green-600 mt-0.5">Your notes have been recorded.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Ready to submit?</p>
                    <p className="text-xs text-gray-500 mt-0.5">Add your interview notes above, then submit feedback.</p>
                  </div>
                  {feedbackErr && <p className="text-xs text-red-600">{feedbackErr}</p>}
                  <button onClick={() => submitFeedback.mutate()} disabled={submitFeedback.isPending}
                    className="flex-shrink-0 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
                    {submitFeedback.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin"/>Submitting…</>
                      : <><CheckCircle className="w-4 h-4"/>Submit Feedback</>
                    }
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Cost Approval Panel ─────────────────────────────────────────
function CostApprovalPanel({ candidateId, candidateName, candidateSource, candidateCreatedAt, interviewNotes, costApprovalDecision, costApprovalNotes, isReviewer, user, onRefresh }: {
  candidateId: string
  candidateName: string
  candidateSource: string
  candidateCreatedAt: string
  interviewNotes: Record<string, any>
  costApprovalDecision: string | null
  costApprovalNotes: NoteEntry[]
  isReviewer: boolean
  user: { id: string; full_name: string; role: string }
  onRefresh: () => void
}) {
  const [noteText, setNoteText] = useState('')
  const [decision, setDecision] = useState<'go_ahead' | 'rework_required' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const stageProgression = Object.entries(interviewNotes)
    .filter(([, entries]) => Array.isArray(entries) && (entries as any[]).length > 0)
    .map(([key]) => key.replace(/_+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim())

  const submitDecision = async () => {
    if (!decision) return
    setSubmitting(true)
    const newNote: NoteEntry | null = noteText.trim() ? {
      text: noteText.trim(),
      author: user.full_name,
      authorId: user.id,
      timestamp: new Date().toISOString(),
    } : null
    const updatedNotes = newNote ? [...costApprovalNotes, newNote] : costApprovalNotes

    const { error } = await supabase.from('candidates').update({
      cost_approval_decision: decision,
      cost_approval_notes: updatedNotes,
    }).eq('id', candidateId)

    if (error) {
      console.error('[cost approval submit]', error)
      setSubmitting(false)
      return
    }

    // Notify super admins
    const { data: superAdmins } = await supabase.from('users').select('id').eq('role', 'super_admin').eq('is_active', true)
    if (superAdmins?.length) {
      const { error: notifErr } = await supabase.from('notifications').insert(superAdmins.map(u => ({
        user_id: u.id,
        type: 'cost_approval',
        title: decision === 'go_ahead' ? `✅ Go Ahead — ${candidateName}` : `🔁 Re-work Required — ${candidateName}`,
        body: `${user.full_name} submitted "${decision === 'go_ahead' ? 'Go Ahead' : 'Re-work Required'}" for ${candidateName}`,
        metadata: { candidate_id: candidateId, decision, reviewer_id: user.id },
      })))
      if (notifErr) console.error('[notification insert]', notifErr)
    }

    setNoteText('')
    setDecision(null)
    setSubmitted(true)
    setSubmitting(false)
    onRefresh()
  }

  // Also allow saving just a note without decision
  const saveNoteOnly = async () => {
    if (!noteText.trim()) return
    setSubmitting(true)
    const newNote: NoteEntry = {
      text: noteText.trim(),
      author: user.full_name,
      authorId: user.id,
      timestamp: new Date().toISOString(),
    }
    const { error } = await supabase.from('candidates').update({
      cost_approval_notes: [...costApprovalNotes, newNote],
    }).eq('id', candidateId)
    if (error) console.error('[cost approval note]', error)
    else {
      setNoteText('')
      onRefresh()
    }
    setSubmitting(false)
  }

  return (
    <div className="bg-amber-50/40 rounded-xl border-2 border-amber-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 bg-amber-50 border-b border-amber-200">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-amber-900">Cost Approval</p>
          {costApprovalDecision && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              costApprovalDecision === 'go_ahead'
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-orange-100 text-orange-700 border border-orange-200'
            }`}>
              {costApprovalDecision === 'go_ahead' ? '✅ Go Ahead' : '🔁 Re-work Required'}
            </span>
          )}
        </div>
      </div>

      {/* Candidate Journey */}
      <div className="px-5 py-4 border-b border-amber-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Candidate Journey</p>
        <div className="space-y-2">
          <div className="flex gap-2 text-sm">
            <span className="text-gray-400 w-16 text-xs flex-shrink-0 pt-0.5">Added</span>
            <span className="text-gray-700">{formatDate(candidateCreatedAt)}</span>
          </div>
          <div className="flex gap-2 text-sm">
            <span className="text-gray-400 w-16 text-xs flex-shrink-0 pt-0.5">Source</span>
            <span className="text-gray-700">{candidateSource}</span>
          </div>
          {stageProgression.length > 0 && (
            <div className="flex gap-2 text-sm">
              <span className="text-gray-400 w-16 text-xs flex-shrink-0 pt-1">Stages</span>
              <div className="flex flex-wrap gap-1">
                {stageProgression.map(s => (
                  <span key={s} className="text-xs bg-white text-gray-600 px-2 py-0.5 rounded-full border border-gray-200">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cost Approval Notes — always visible to admin/super_admin/hr */}
      <div className="px-5 py-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Approval Notes</p>

        {costApprovalNotes.length > 0 ? (
          <div className="space-y-2 mb-4">
            {costApprovalNotes.map((note, i) => (
              <div key={i} className="bg-white rounded-lg px-3 py-2.5 border border-amber-100">
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{note.text}</p>
                <p className="text-xs text-gray-400 mt-1.5">
                  <span className="font-medium text-gray-500">{note.author}</span> · {formatRelative(note.timestamp)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic mb-4">No approval notes yet.</p>
        )}

        {/* Reviewer input — write notes + submit decision */}
        {isReviewer && !submitted && (
          <div className="space-y-3 border-t border-amber-100 pt-4">
            <textarea rows={3} value={noteText} onChange={e => setNoteText(e.target.value)}
              placeholder="Add notes for cost approval decision…"
              className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"/>

            {/* Save note without decision */}
            {noteText.trim() && (
              <button onClick={saveNoteOnly} disabled={submitting}
                className="text-xs text-amber-700 hover:text-amber-900 flex items-center gap-1 transition-colors">
                <Send className="w-3 h-3"/> Save note
              </button>
            )}

            {/* Decision */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Decision</p>
              <div className="flex gap-2">
                <button onClick={() => setDecision('go_ahead')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border-2 transition-all ${
                    decision === 'go_ahead'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600 hover:border-green-300 hover:bg-green-50/50'
                  }`}>
                  <Check className="w-4 h-4"/> Go Ahead
                </button>
                <button onClick={() => setDecision('rework_required')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border-2 transition-all ${
                    decision === 'rework_required'
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 text-gray-600 hover:border-orange-300 hover:bg-orange-50/50'
                  }`}>
                  <X className="w-4 h-4"/> Re-work Required
                </button>
              </div>
            </div>

            <button onClick={submitDecision} disabled={!decision || submitting}
              className="w-full px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle className="w-4 h-4"/>}
              Submit Decision
            </button>
            {!decision && <p className="text-xs text-gray-400 text-center">Select a decision above before submitting</p>}
          </div>
        )}

        {/* After submission confirmation */}
        {submitted && (
          <div className="border-t border-amber-100 pt-4">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle className="w-5 h-5"/>
              <p className="text-sm font-semibold">Decision submitted successfully</p>
            </div>
          </div>
        )}
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

const _PLATFORM_SOURCES = ['LinkedIn','Naukri','Indeed','Internshala','Shine','Monster','Foundit','Apna','Referral','Website','Other']

function ProfileSubSource({ sourceCategory, value, onChange }: {
  sourceCategory: string; value: string; onChange: (v: string) => void
}) {
  const { data: agencyUsers = [] } = useAgencies()
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
  if (sourceCategory === 'college') return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder="e.g. IIT Delhi…" className={cls}/>
  )
  return <input disabled placeholder="Select source first…" className={`${cls} bg-gray-50 text-gray-400`}/>
}
