import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ArrowLeft, ExternalLink, Phone, Mail, Linkedin, Loader2, Send, Pencil, Check, X, ChevronDown } from 'lucide-react'
import { useCandidate, useUpdateStage } from './useCandidates'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { PageHeader } from '../../shared/components/PageHeader'
import { useAuthStore } from '../auth/authStore'
import { formatDate, formatRelative, labelOf } from '../../shared/utils/helpers'
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

const STAGE_COLOURS: Record<string,string> = {
  Applied:'bg-gray-100 text-gray-700', Screening:'bg-blue-100 text-blue-700',
  R1:'bg-indigo-100 text-indigo-700', 'Case Study':'bg-yellow-100 text-yellow-700',
  R2:'bg-orange-100 text-orange-700', R3:'bg-orange-200 text-orange-800',
  'CF (Virtual)':'bg-purple-100 text-purple-700','CF (In-Person)':'bg-purple-200 text-purple-800',
  Offer:'bg-violet-100 text-violet-700', Hired:'bg-green-100 text-green-700',
  Rejected:'bg-red-100 text-red-700',
}

interface NoteEntry { text: string; author: string; authorId: string; timestamp: string }

export function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, hasRole } = useAuthStore()
  const qc = useQueryClient()

  const isInterviewer = hasRole(['interviewer'])
  const canEdit       = hasRole(['admin', 'super_admin', 'hr_team'])
  const canAddNotes   = hasRole(['admin', 'super_admin', 'hr_team', 'interviewer'])
  const isSuperAdmin  = hasRole(['super_admin'])

  const [draftNotes, setDraftNotes]   = useState<Record<string, string>>({})
  const [savingNote, setSavingNote]   = useState<string | null>(null)
  const [editContact, setEditContact] = useState(false)
  const [contactForm, setContactForm] = useState({ phone: '', linkedin_url: '', email: '' })
  const [stageOpen, setStageOpen]     = useState(false)

  const { data: candidate, isLoading } = useCandidate(id!)
  const updateStage = useUpdateStage()

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users', 'all-active'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name,role').eq('is_active', true)
      return data ?? []
    },
  })

  const hrUsers     = (allUsers as any[]).filter(u => ['hr_team','admin','super_admin'].includes(u.role))
  const interviewerUsers = (allUsers as any[]).filter(u => u.role === 'interviewer')

  const updateContact = useMutation({
    mutationFn: async (data: any) => {
      const { error } = await supabase.from('candidates').update(data).eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['candidate', id] }); setEditContact(false) },
  })

  const updateField = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: any }) => {
      const { error } = await supabase.from('candidates').update({ [field]: value }).eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['candidate', id] }),
  })

  const saveNote = async (sectionKey: string) => {
    const draft = draftNotes[sectionKey]?.trim()
    if (!draft) return
    setSavingNote(sectionKey)
    const existing = (candidate as any)?.interview_notes ?? {}
    const entries: NoteEntry[] = existing[sectionKey] ?? []
    await supabase.from('candidates').update({
      interview_notes: { ...existing, [sectionKey]: [...entries, {
        text: draft, author: user!.full_name,
        authorId: user!.id, timestamp: new Date().toISOString(),
      }]}
    }).eq('id', id!)
    qc.invalidateQueries({ queryKey: ['candidate', id] })
    setDraftNotes(p => ({ ...p, [sectionKey]: '' }))
    setSavingNote(null)
  }

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
  if (!candidate) return <p className="text-gray-500 py-8 text-center">Candidate not found.</p>

  const stages = (candidate as any)?.job?.pipeline_stages ?? [...INTERVIEW_STAGES]
  const interviewNotes = (candidate as any).interview_notes ?? {}
  const initialNotes = (candidate as any).notes // from add-candidate form
  const drivePreviewUrl = candidate.resume_url
    ? candidate.resume_url.replace('/view','').replace('?usp=sharing','') + (candidate.resume_url.includes('drive.google.com') ? '?embedded=true' : '')
    : null

  const assignedInterviewerIds: string[] = (candidate as any).assigned_interviewers ?? []
  const hrOwnerId: string | null = (candidate as any).hr_owner ?? null

  // Multi-select toggle for interviewers
  const toggleInterviewer = (userId: string) => {
    const current = assignedInterviewerIds
    const next = current.includes(userId) ? current.filter(i => i !== userId) : [...current, userId]
    updateField.mutate({ field: 'assigned_interviewers', value: next })
  }

  return (
    <div>
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4"/> Back
      </button>

      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{candidate.full_name}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{candidate.source_name} · {labelOf(candidate.source_category)}</p>
        </div>
        {/* Stage dropdown — top right */}
        <div className="relative">
          {canEdit ? (
            <>
              <button onClick={() => setStageOpen(!stageOpen)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium ${STAGE_COLOURS[candidate.current_stage] ?? 'bg-gray-100 text-gray-700'}`}>
                {candidate.current_stage}
                <ChevronDown className="w-4 h-4"/>
              </button>
              {stageOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setStageOpen(false)}/>
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 w-52 max-h-80 overflow-y-auto">
                    {stages.map((s: string) => (
                      <button key={s} onClick={() => { updateStage.mutate({ id: candidate.id, stage: s }); setStageOpen(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLOURS[s] ?? 'bg-gray-100 text-gray-600'}`}>{s}</span>
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
        {/* ── Left column ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Contact */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700">Contact</p>
              {canEdit && !editContact && (
                <button onClick={() => { setContactForm({ phone: candidate.phone ?? '', linkedin_url: candidate.linkedin_url ?? '', email: candidate.email }); setEditContact(true) }}
                  className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded hover:bg-blue-50">
                  <Pencil className="w-3.5 h-3.5"/>
                </button>
              )}
            </div>
            {editContact ? (
              <div className="space-y-2.5">
                {[['email','Email','text'],['phone','Phone','tel'],['linkedin_url','LinkedIn URL','url']].map(([k,label,type]) => (
                  <div key={k}>
                    <label className="block text-xs text-gray-500 mb-1">{label}</label>
                    <input value={(contactForm as any)[k]} type={type}
                      onChange={e => setContactForm(p => ({...p,[k]:e.target.value}))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" loading={updateContact.isPending}
                    onClick={() => updateContact.mutate({ phone: contactForm.phone||null, linkedin_url: contactForm.linkedin_url||null, email: contactForm.email })}>
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditContact(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <a href={`mailto:${candidate.email}`} className="flex items-center gap-2.5 text-sm text-gray-600 hover:text-blue-600 transition-colors">
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

          {/* Assignment — HR + Interviewers (multi) */}
          {!isInterviewer && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <p className="text-sm font-semibold text-gray-700">Assignment</p>

              {/* HR Owner — single */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">HR Owner</p>
                {canEdit ? (
                  <select value={hrOwnerId ?? ''}
                    onChange={e => updateField.mutate({ field: 'hr_owner', value: e.target.value || null })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Unassigned —</option>
                    {hrUsers.map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                ) : (
                  <p className="text-sm text-gray-700">{hrUsers.find((u:any) => u.id === hrOwnerId)?.full_name ?? '—'}</p>
                )}
              </div>

              {/* Interviewers — multi-select */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Interviewers <span className="text-gray-300">(select multiple)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {interviewerUsers.map((u: any) => {
                    const selected = assignedInterviewerIds.includes(u.id)
                    return (
                      <button key={u.id}
                        onClick={() => canEdit && toggleInterviewer(u.id)}
                        disabled={!canEdit}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                          selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                        } ${!canEdit ? 'cursor-default' : 'cursor-pointer'}`}>
                        {u.full_name}
                      </button>
                    )
                  })}
                  {interviewerUsers.length === 0 && <p className="text-xs text-gray-400">No interviewers added in Settings</p>}
                </div>
              </div>

              {/* Interview Date + Time */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Interview Date</p>
                {canEdit ? (
                  <input type="datetime-local"
                    value={(candidate as any).interview_date ?? ''}
                    onChange={e => updateField.mutate({ field: 'interview_date', value: e.target.value || null })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                ) : (
                  <p className="text-sm text-gray-700">{(candidate as any).interview_date ? formatDate((candidate as any).interview_date) : '—'}</p>
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

        {/* ── Right column ── */}
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
              <iframe src={drivePreviewUrl} className="w-full border-0" style={{ height: '320px' }} title="Resume"/>
            ) : (
              <div className="flex items-center justify-center h-20 text-gray-400">
                <p className="text-sm">No resume link</p>
              </div>
            )}
          </div>

          {/* Notes — from add-candidate form (general notes) */}
          {(initialNotes || canEdit) && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-sm font-semibold text-gray-700 mb-2">General Notes</p>
              {canEdit ? (
                <textarea
                  defaultValue={initialNotes ?? ''}
                  rows={3}
                  onBlur={e => updateField.mutate({ field: 'notes', value: e.target.value || null })}
                  placeholder="General notes about this candidate…"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"/>
              ) : (
                <p className="text-sm text-gray-700">{initialNotes}</p>
              )}
            </div>
          )}

          {/* Interview Notes — per round */}
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
                          onChange={e => setDraftNotes(p => ({...p,[key]:e.target.value}))}
                          placeholder={`Add ${label} notes…`}
                          onKeyDown={e => { if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)) saveNote(key) }}
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white"/>
                        <button onClick={() => saveNote(key)} disabled={!draft.trim()||savingNote===key}
                          className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 flex items-center justify-center transition-colors">
                          {savingNote===key ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin"/> : <Send className="w-3.5 h-3.5 text-white"/>}
                        </button>
                      </div>
                    )}
                    {entries.length === 0 && !canAddNotes && <p className="text-xs text-gray-400">No notes yet</p>}
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
