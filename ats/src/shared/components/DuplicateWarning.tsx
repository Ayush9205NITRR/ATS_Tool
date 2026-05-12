// ============================================================
// DUPLICATE WARNING — reusable banner shown when duplicates found
// ============================================================
import { AlertTriangle, ExternalLink } from 'lucide-react'
import type { DuplicateMatch } from '../hooks/useDuplicateCheck'

interface Props {
  duplicates: DuplicateMatch[]
  checking: boolean
  onViewProfile?: (id: string) => void
}

const MATCH_LABELS = {
  email: 'Same email',
  phone: 'Same phone',
  both:  'Same email & phone',
}

const MATCH_COLOURS = {
  email: 'bg-amber-50 border-amber-300 text-amber-800',
  phone: 'bg-amber-50 border-amber-300 text-amber-800',
  both:  'bg-red-50 border-red-300 text-red-800',
}

const BADGE_COLOURS = {
  email: 'bg-amber-100 text-amber-700',
  phone: 'bg-amber-100 text-amber-700',
  both:  'bg-red-100 text-red-700',
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

  const severity = duplicates.some(d => d.match_type === 'both') ? 'both' : duplicates[0].match_type

  return (
    <div className={`border rounded-xl p-3 ${MATCH_COLOURS[severity]}`}>
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5"/>
        <p className="text-sm font-semibold">
          {duplicates.length === 1 ? 'Possible duplicate found' : `${duplicates.length} possible duplicates found`}
        </p>
      </div>
      <div className="space-y-2">
        {duplicates.map(d => (
          <div key={d.id} className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium">{d.full_name}</p>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${BADGE_COLOURS[d.match_type]}`}>
                  {MATCH_LABELS[d.match_type]}
                </span>
                <span className="text-xs text-gray-500">{d.current_stage}</span>
              </div>
              <p className="text-xs text-gray-500 truncate">{d.email}{d.phone ? ` · ${d.phone}` : ''}</p>
            </div>
            {onViewProfile && (
              <button onClick={() => onViewProfile(d.id)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline flex-shrink-0 ml-2">
                View <ExternalLink className="w-3 h-3"/>
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs mt-2 opacity-70">You can still proceed — just verify this isn't a duplicate.</p>
    </div>
  )
}
