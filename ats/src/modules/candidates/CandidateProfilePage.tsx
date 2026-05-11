import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ArrowLeft, ExternalLink, Phone, Mail, Linkedin, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { useCandidate, useUpdateStage } from './useCandidates'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { PageHeader } from '../../shared/components/PageHeader'
import { useAuthStore } from '../auth/authStore'
import { formatDate, labelOf } from '../../shared/utils/helpers'
import { supabase } from '../../lib/supabaseClient'
import { INTERVIEW_STAGES } from '../../types/database.types'

const DEFAULT_STAGES = [...INTERVIEW_STAGES]

const NOTES_SECTIONS = [
  { key: 'screening', label: 'Screening Call Notes' },
  { key: 'r1',        label: 'R1 Interview Notes' },
  { key: 'case_study',label: 'Case Study Notes' },
  { key: 'r2',        label: 'R2 Interview Notes' },
  { key: 'r3',        label: 'R3 Interview Notes' },
  { key: 'cf_virtual',   label: 'CF Virtual Notes' },
  { key: 'cf_inperson',  label: 'CF In-Person Notes' },
]

export function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, hasRole } = useAuthStore()
  const qc = useQueryClient()

  const canEdit = hasRole(['admin', 'super_admin', 'hr_team'])
  const isInterviewer = hasRole(['interviewer'])
  const [expandedNote, setExpandedNote] = useState<string | null>(null)
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)

  const { data: candidate, isLoading } = useCandidate(id!)
  const updateStage = useUpdateStage()

  const saveNote = async (key: string) => {
    setSavingNote(key)
    const isTopLevel = key === 'screening'
    const update = isTopLevel
      ? { screening_notes: noteValues[key] }
      : { interview_notes: { ...(candidate as any)?.interview_notes, [key]: noteValues[key] } }

    await supabase.from('candidates').update(update).eq('id', id!)
    qc.invalidateQueries({ queryKey: ['candidate', id] })
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
                    disabled={(!canEdit) || updateStage.isPending}
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

          {/* Interview Notes — accordion */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <p className="text-sm font-semibold text-gray-700 px-5 py-3 border-b border-gray-100">Interview Notes</p>
            {NOTES_SECTIONS.map(({ key, label }) => {
              const isOpen = expandedNote === key
              const savedValue = key === 'screening'
                ? (candidate as any).screening_notes ?? ''
                : interviewNotes[key] ?? ''
              const currentValue = noteValues[key] ?? savedValue

              return (
                <div key={key} className="border-b border-gray-50 last:border-0">
                  <button
                    onClick={() => setExpandedNote(isOpen ? null : key)}
                    className="w-full flex items-center justify-between px-5 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-medium">{label}</span>
                    <div className="flex items-center gap-2">
                      {savedValue && <span className="w-2 h-2 rounded-full bg-blue-400" />}
                      {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-4">
                      <textarea
                        rows={4}
                        value={currentValue}
                        onChange={(e) => setNoteValues((p) => ({ ...p, [key]: e.target.value }))}
                        disabled={!canEdit && !isInterviewer}
                        placeholder={`Add ${label.toLowerCase()}…`}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      />
                      {(canEdit || isInterviewer) && (
                        <div className="flex justify-end mt-2">
                          <Button size="sm" loading={savingNote === key} onClick={() => saveNote(key)}>
                            Save
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right column — Resume */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden h-full min-h-[600px]">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-700">Resume</p>
              {candidate.resume_url && (
                <a href={candidate.resume_url} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />}>
                    Open in Drive
                  </Button>
                </a>
              )}
            </div>
            {drivePreviewUrl ? (
              <iframe src={drivePreviewUrl} className="w-full h-full border-0" style={{ minHeight: '560px' }} title="Resume Preview" />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <p className="text-sm">No resume link added</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-400 w-16 flex-shrink-0">{label}</span>
      <span className="text-gray-700 font-medium">{value}</span>
    </div>
  )
}
