// ============================================================
// CANDIDATE PROFILE PAGE
// ============================================================
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Phone, Mail, Linkedin, Loader2 } from 'lucide-react'
import { useCandidate, useUpdateStage } from './useCandidates'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { PageHeader } from '../../shared/components/PageHeader'
import { useAuthStore } from '../auth/authStore'
import { formatDate, labelOf } from '../../shared/utils/helpers'

const DEFAULT_STAGES = ['Applied','Screening','Interview','Offer','Hired','Rejected']

export function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { hasRole } = useAuthStore()
  const canEdit = hasRole(['admin', 'super_admin'])

  const { data: candidate, isLoading } = useCandidate(id!)
  const updateStage = useUpdateStage()

  const stages = (candidate as any)?.job?.pipeline_stages ?? DEFAULT_STAGES

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  if (!candidate) {
    return <p className="text-gray-500 py-8 text-center">Candidate not found.</p>
  }

  const drivePreviewUrl = candidate.resume_url
    ? candidate.resume_url.replace('/view', '/preview').replace('?usp=sharing', '')
    : null

  return (
    <div>
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
      >
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

          {/* Stage pipeline */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-gray-700 mb-3">Pipeline Stage</p>
            <div className="space-y-1.5">
              {stages.map((stage: string) => {
                const isActive = candidate.current_stage === stage
                return (
                  <button
                    key={stage}
                    disabled={!canEdit || updateStage.isPending}
                    onClick={() => {
                      if (canEdit && !isActive) {
                        updateStage.mutate({ id: candidate.id, stage })
                      }
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : canEdit
                        ? 'hover:bg-gray-50 text-gray-600 cursor-pointer'
                        : 'text-gray-500 cursor-default'
                    }`}
                  >
                    <span>{stage}</span>
                    {isActive && (
                      <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Contact info */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-gray-700 mb-3">Contact</p>
            <div className="space-y-2.5">
              <a href={`mailto:${candidate.email}`}
                className="flex items-center gap-2.5 text-sm text-gray-600 hover:text-blue-600 transition-colors">
                <Mail className="w-4 h-4 flex-shrink-0 text-gray-400" />
                {candidate.email}
              </a>
              {candidate.phone && (
                <a href={`tel:${candidate.phone}`}
                  className="flex items-center gap-2.5 text-sm text-gray-600 hover:text-blue-600 transition-colors">
                  <Phone className="w-4 h-4 flex-shrink-0 text-gray-400" />
                  {candidate.phone}
                </a>
              )}
              {candidate.linkedin_url && (
                <a href={candidate.linkedin_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2.5 text-sm text-blue-600 hover:underline transition-colors">
                  <Linkedin className="w-4 h-4 flex-shrink-0" />
                  LinkedIn Profile
                </a>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm space-y-2.5">
            <Row label="Source" value={`${labelOf(candidate.source_category)} — ${candidate.source_name}`} />
            <Row label="Job" value={(candidate as any).job?.title ?? '—'} />
            <Row label="Added" value={formatDate(candidate.created_at)} />
            {candidate.tags?.length > 0 && (
              <div className="flex items-start gap-2 pt-1">
                <span className="text-gray-400 w-20 flex-shrink-0">Tags</span>
                <div className="flex flex-wrap gap-1">
                  {candidate.tags.map((tag: string) => (
                    <span key={tag} className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          {candidate.notes && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-sm font-semibold text-gray-700 mb-2">Notes</p>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{candidate.notes}</p>
            </div>
          )}
        </div>

        {/* Right column — Resume viewer */}
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
              <iframe
                src={drivePreviewUrl}
                className="w-full h-full border-0"
                style={{ minHeight: '560px' }}
                title="Resume Preview"
              />
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
