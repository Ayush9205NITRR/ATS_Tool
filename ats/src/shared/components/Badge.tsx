import type { CandidateStatus, JobStatus } from '../../types/database.types'

const STAGE_COLOURS: Record<string, string> = {
  Applied:         'bg-zinc-100 text-zinc-600',
  Screening:       'bg-blue-50 text-blue-700',
  Interview:       'bg-amber-50 text-amber-700',
  R1:              'bg-indigo-50 text-indigo-700',
  R2:              'bg-orange-50 text-orange-700',
  'Case Study':    'bg-amber-50 text-amber-700',
  'CF (Virtual)':  'bg-purple-50 text-purple-700',
  'CF (In-Person)':'bg-purple-100 text-purple-800',
  Offer:           'bg-violet-50 text-violet-700',
  Hired:           'bg-emerald-50 text-emerald-700',
  Rejected:        'bg-red-50 text-red-600',
  Withdrawn:       'bg-zinc-100 text-zinc-500',
}

const STATUS_COLOURS: Record<string, string> = {
  active:    'bg-emerald-50 text-emerald-700',
  rejected:  'bg-red-50 text-red-700',
  hired:     'bg-emerald-50 text-emerald-700',
  withdrawn: 'bg-zinc-100 text-zinc-500',
  draft:     'bg-zinc-100 text-zinc-600',
  open:      'bg-blue-50 text-blue-700',
  paused:    'bg-amber-50 text-amber-700',
  closed:    'bg-red-50 text-red-700',
}

interface Props {
  label: string
  type?: 'stage' | 'status' | 'default'
  className?: string
}

export function Badge({ label, type = 'default', className = '' }: Props) {
  let colour = 'bg-zinc-100 text-zinc-600'
  if (type === 'stage')  colour = STAGE_COLOURS[label]  ?? 'bg-zinc-100 text-zinc-600'
  if (type === 'status') colour = STATUS_COLOURS[label] ?? 'bg-zinc-100 text-zinc-600'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colour} ${className}`}>
      {label}
    </span>
  )
}
