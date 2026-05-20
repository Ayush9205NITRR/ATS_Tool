// ============================================================
// DUPLICATE BLOCK — hard block, no override allowed
// ============================================================
import { XCircle, ExternalLink } from 'lucide-react'
import type { DuplicateMatch } from '../hooks/useDuplicateCheck'

interface Props {
  duplicates: DuplicateMatch[]
  checking: boolean
  onViewProfile?: (id: string) => void
}

const MATCH_LABELS = {
  email: 'Email already exists',
  phone: 'Phone already exists',
  both:  'Email & phone already exist',
}

export function DuplicateWarning({ duplicates, checking, onViewProfile }: Props) {
  if (checking) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
        <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin"/>
        Checking for duplicates…
      </div>
    )
  }

  if (duplicates.length === 0) return null

  return (
    <div className="border border-red-300 rounded-xl p-3 bg-red-50">
      <div className="flex items-start gap-2 mb-2.5">
        <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5"/>
        <div>
          <p className="text-sm font-semibold text-red-800">
            Candidate already exists — cannot add
          </p>
          <p className="text-xs text-red-600 mt-0.5">
            A candidate with this email or phone number is already in the system.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {duplicates.map(d => (
          <div key={d.id} className="flex items-center justify-between bg-white/70 rounded-lg px-3 py-2.5 border border-red-100">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-gray-900">{d.full_name}</p>
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                  {MATCH_LABELS[d.match_type]}
                </span>
                <span className="text-xs text-gray-500">{d.current_stage}</span>
              </div>
              <p className="text-xs text-gray-500 truncate mt-0.5">
                {d.email}{d.phone ? ` · ${d.phone}` : ''}
              </p>
            </div>
            {onViewProfile && (
              <button onClick={() => onViewProfile(d.id)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline flex-shrink-0 ml-3 font-medium">
                View profile <ExternalLink className="w-3 h-3"/>
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-red-700 font-medium mt-2.5 flex items-center gap-1">
        🚫 Submission blocked. Please update the existing candidate's record instead.
      </p>
    </div>
  )
}
