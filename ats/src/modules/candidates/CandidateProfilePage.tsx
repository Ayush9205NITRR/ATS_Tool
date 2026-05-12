import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ArrowLeft, ExternalLink, Phone, Mail, Linkedin, Loader2, Send } from 'lucide-react'
import { useCandidate, useUpdateStage } from './useCandidates'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { PageHeader } from '../../shared/components/PageHeader'
import { useAuthStore } from '../auth/authStore'
import { formatDate, formatRelative, initialsOf, labelOf } from '../../shared/utils/helpers'
import { supabase } from '../../lib/supabaseClient'
import { INTERVIEW_STAGES } from '../../types/database.types'

const DEFAULT_STAGES = [...INTERVIEW_STAGES]

const NOTES_SECTIONS = [
  { key: 'screening',   label: 'Screening Call' },
  { key: 'r1',          label: 'R1 Interview' },
  { key: 'case_study',  label: 'Case Study' },
  { key: 'r2',          label: 'R2 Interview' },
  { key: 'r3',          label: 'R3 Interview' },
  { key: 'cf_virtual',  label: 'CF Virtual' },
  { key: 'cf_inperson', label: 'CF In-Person' },
]

interface NoteEntry {
  text: string
  author: string
  authorId: string
  timestamp: string
}

export function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, hasRole } = useAuthStore()
  const qc = useQueryClient()

  const canEdit = hasRole(['admin', 'super_admin', 'hr_team'])
  const canAddNotes = hasRole(['admin', 'super_admin', 'hr_team', 'interviewer'])
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)

  const { data: candidate, isLoading } = useCandidate(id!)
  const updateStage = useUpdateStage()

  const saveNote = async (sectionKey: string) => {
    const draft = draftNotes[sectionKey]?.trim()
    if (!draft) return
    setSavingNote(sectionKey)

    const existingNotes = (candidate as any)?.interview_notes ?? {}
    const existingEntries: NoteEntry[] = existingNotes[sectionKey] ?? []

    const newEntry: NoteEntry = {
      text: draft,
      author: user!.full_name,
      authorId: user!.id,
      timestamp: new Date().toISOString(),
    }

    const updatedEntries = [...existingEntries, newEntry]
    const updatedNotes = { ...existingNotes, [sectionKey]: updatedEntries }

    await supabase.from('candidates').update({ interview_notes: updatedNotes }).eq('id', id!)
    qc.invalidateQueries({ queryKey: ['candidate', id] })
    setDraftNotes((p) => ({ ...p, [sectionKey]: '' }))
    setSavingNote(null)
  }

  const stages = (candidate as any)?.job?.pipeline_stages ?? DEFAULT_STAGES

  if (isLoading) {
    return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
  }
  if (!candidate) {
    return <p className="text-gray-500 py-8 text-center">Candidate not found.</p>
  }

  const drivePreviewUrl = candidate.resume_url
    ? candidate.resume_url.replace('/view', '/preview').replace('?usp=sharing', '')
    : null

  const interviewNotes = (candidate as any).interview_notes ?? {}

  return (
    <div>
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <PageHeader
        title={candidate.full_name}
        subtitle={`${candidate.source_name} · ${labelOf(candidate.source_category)}`}
        action={<Badge label={candidate.status} type="status" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">

          {/* Pipeline Stage */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-gray-700 mb-3">Pipeline Stage</p>
            <div className="space-y-1">
              {stages.map((stage: string) => {
                const isActive = candidate.current_stage === stage
                return (
                  <button
                    key={stage}
                    disabled={!canEdit || updateStage.isPending}
                    onClick={() => { if (canEdit && !isActive) updateStage.mutate({ id: candidate.id, stage }) }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : canEdit
                        ? 'hover:bg-gray-50 text-gray-600 cursor-pointer'
                        : 'text-gray-400 cursor-default'
                    }`}
                  >
                    <span>{stage}</span>
                    {isActive && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Contact Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-gray-700 mb-3">Contact</p>
            <div className="space-y-2.5">
              <a href={`mailto:${candidate.email}`} className="flex items-center gap-2.5 text-sm text-gray-600 hover:text-blue-600 transition-colors">
                <Mail className="w-4 h-4 flex-shrink-0 text-gray-400" />{candidate.email}
              </a>
              {candidate.phone && (
                <a href={`tel:${candidate.phone}`} className="flex items-center gap-2.5 text-sm text-gray-600 hover:text-blue-600 transition-colors">
                  <Phone className="w-4 h-4 flex-shrink-0 text-gray-400" />{candidate.phone}
                </a>
              )}
              {candidate.linkedin_url && (
                <a href={candidate.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-sm text-blue-600 hover:underline">
                  <Linkedin className="w-4 h-4 flex-shrink-0" />LinkedIn Profile
                </a>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm space-y-2.5">
            <Row label="Source" value={`${labelOf(candidate.source_category)} — ${candidate.source_name}`} />
            <Row label="Job" value={(candidate as any).job?.title ?? '—'} />
            <Row label="Added" value={formatDate(candidate.created_at)} />
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-3 space-y-4">

          {/* Resume */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-700">Resume</p>
              {candidate.resume_url && (
                <a href={candidate.resume_url} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />}>Open in Drive</Button>
                </a>
              )}
            </div>
            {drivePreviewUrl ? (
              <iframe src={drivePreviewUrl} className="w-full border-0" style={{ height: '320px' }} title="Resume Preview" />
            ) : (
              <div className="flex items-center justify-center h-24 text-gray-400">
                <p className="text-sm">No resume link added</p>
              </div>
            )}
          </div>

          {/* Interview Notes — always visible, chat style */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <p className="text-sm font-semibold text-gray-700 px-5 py-3 border-b border-gray-100">Interview Notes</p>

            <div className="divide-y divide-gray-50">
              {NOTES_SECTIONS.map(({ key, label }) => {
                const entries: NoteEntry[] = interviewNotes[key] ?? []
                const draft = draftNotes[key] ?? ''

                return (
                  <div key={key} className="px-5 py-4">
                    {/* Section header */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${entries.length > 0 ? 'bg-blue-400' : 'bg-gray-200'}`} />
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
                      {entries.length > 0 && (
                        <span className="text-xs text-gray-400 ml-auto">{entries.length} note{entries.length > 1 ? 's' : ''}</span>
                      )}
                    </div>

                    {/* Existing notes */}
                    {entries.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {entries.map((entry, i) => (
                          <div key={i} className="bg-gray-50 rounded-lg px-3 py-2.5">
                            <p className="text-sm text-gray-700 whitespace-pre-wrap">{entry.text}</p>
                            <p className="text-xs text-gray-400 mt-1.5">
                              <span className="font-medium text-gray-500">{entry.author}</span>
                              {' · '}
                              {formatRelative(entry.timestamp)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add note input */}
                    {canAddNotes && (
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <textarea
                            rows={2}
                            value={draft}
                            onChange={(e) => setDraftNotes((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder={`Add ${label} notes…`}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(key)
                            }}
                          />
                        </div>
                        <button
                          onClick={() => saveNote(key)}
                          disabled={!draft.trim() || savingNote === key}
                          className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 flex items-center justify-center transition-colors mb-0.5"
                        >
                          {savingNote === key
                            ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                            : <Send className="w-3.5 h-3.5 text-white" />
                          }
                        </button>
                      </div>
                    )}

                    {entries.length === 0 && !canAddNotes && (
                      <p className="text-xs text-gray-400">No notes yet</p>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-400 w-16 flex-shrink-0 text-xs">{label}</span>
      <span className="text-gray-700 font-medium text-sm">{value}</span>
    </div>
  )
}
