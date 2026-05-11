// ============================================================
// BADGE — coloured status pill used across the app
// ============================================================
import type { CandidateStatus, JobStatus } from '../../types/database.types'

const STAGE_COLOURS: Record<string, string> = {
  Applied:    'bg-gray-100 text-gray-700',
  Screening:  'bg-blue-100 text-blue-700',
  Interview:  'bg-amber-100 text-amber-700',
  Offer:      'bg-purple-100 text-purple-700',
  Hired:      'bg-green-100 text-green-700',
  Rejected:   'bg-red-100 text-red-700',
  Withdrawn:  'bg-gray-100 text-gray-500',
}

const STATUS_COLOURS: Record<CandidateStatus | JobStatus, string> = {
  active:    'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
  hired:     'bg-green-100 text-green-700',
  withdrawn: 'bg-gray-100 text-gray-500',
  draft:     'bg-gray-100 text-gray-600',
  open:      'bg-blue-100 text-blue-700',
  paused:    'bg-amber-100 text-amber-700',
  closed:    'bg-red-100 text-red-700',
}

interface Props {
  label: string
  type?: 'stage' | 'status' | 'default'
  className?: string
}

export function Badge({ label, type = 'default', className = '' }: Props) {
  let colour = 'bg-gray-100 text-gray-600'
  if (type === 'stage') colour = STAGE_COLOURS[label] ?? 'bg-gray-100 text-gray-600'
  if (type === 'status') colour = STATUS_COLOURS[label as CandidateStatus] ?? 'bg-gray-100 text-gray-600'

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colour} ${className}`}>
      {label}
    </span>
  )
}
