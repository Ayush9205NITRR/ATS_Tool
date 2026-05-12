import { X, Plus } from 'lucide-react'
import { INTERVIEW_STAGES } from '../../types/database.types'

export type FilterOp =
  | 'contains' | 'not_contains'
  | 'is' | 'is_not'
  | 'is_any_of' | 'is_none_of'
  | 'is_empty' | 'is_not_empty'

export interface ActiveFilter {
  id: string
  field: string
  op: FilterOp
  value: string
  values: string[]
}

export const FILTER_FIELDS = [
  { key: 'full_name',       label: 'Name',       type: 'text'   },
  { key: 'email',           label: 'Email',      type: 'text'   },
  { key: 'phone',           label: 'Phone',      type: 'text'   },
  { key: 'current_stage',   label: 'Stage',      type: 'multi'  },
  { key: 'source_category', label: 'Source',     type: 'single' },
  { key: 'source_name',     label: 'Sub-Source', type: 'text'   },
  { key: 'job_id',          label: 'Job',        type: 'multi'  },
]

const OPS: Record<string, { op: FilterOp; label: string }[]> = {
  text: [
    { op: 'contains',     label: 'contains' },
    { op: 'not_contains', label: 'does not contain' },
    { op: 'is',           label: 'is exactly' },
    { op: 'is_not',       label: 'is not' },
    { op: 'is_empty',     label: 'is empty' },
    { op: 'is_not_empty', label: 'is not empty' },
  ],
  single: [
    { op: 'is',     label: 'is' },
    { op: 'is_not', label: 'is not' },
  ],
  multi: [
    { op: 'is_any_of',  label: 'is any of' },
    { op: 'is_none_of', label: 'is none of' },
    { op: 'is',         label: 'is exactly' },
  ],
}

const SOURCES = ['platform', 'agency', 'college']

// ── Client-side filter logic ──────────────────────────────────
export function applyFilters(candidates: any[], filters: ActiveFilter[], jobs: any[]): any[] {
  if (!filters.length) return candidates

  return candidates.filter(c =>
    filters.every(f => {
      // Get raw value — handle job_id specially since it comes from join
      let raw: string
      if (f.field === 'job_id') {
        // Try direct job_id first, then nested job object
        raw = (c.job_id ?? c.job?.id ?? '').toString().toLowerCase().trim()
      } else {
        raw = (c[f.field] ?? '').toString().toLowerCase().trim()
      }

      const val = f.value.toLowerCase().trim()

      switch (f.op) {
        case 'contains':     return raw.includes(val)
        case 'not_contains': return !raw.includes(val)
        case 'is':           return raw === val
        case 'is_not':       return raw !== val
        case 'is_empty':     return !raw
        case 'is_not_empty': return !!raw
        case 'is_any_of':
          return f.values.length === 0 || f.values.some(v => raw === v.toLowerCase())
        case 'is_none_of':
          return f.values.length === 0 || !f.values.some(v => raw === v.toLowerCase())
        default: return true
      }
    })
  )
}

// ── Filter Bar UI ─────────────────────────────────────────────
interface Props {
  filters: ActiveFilter[]
  onChange: (f: ActiveFilter[]) => void
  jobs: { id: string; title: string }[]
}

export function FilterBar({ filters, onChange, jobs }: Props) {
  const add = () => onChange([...filters, {
    id: Date.now().toString(),
    field: 'full_name',
    op: 'contains',
    value: '',
    values: [],
  }])

  const update = (id: string, patch: Partial<ActiveFilter>) =>
    onChange(filters.map(f => f.id === id ? { ...f, ...patch } : f))

  const remove = (id: string) => onChange(filters.filter(f => f.id !== id))

  const togglePill = (filterId: string, val: string) => {
    const f = filters.find(ff => ff.id === filterId)
    if (!f) return
    const next = f.values.includes(val)
      ? f.values.filter(v => v !== val)
      : [...f.values, val]
    update(filterId, { values: next })
  }

  const getOptions = (field: string) => {
    if (field === 'current_stage') return INTERVIEW_STAGES.map(s => ({ label: s, value: s }))
    if (field === 'source_category') return SOURCES.map(s => ({ label: s.charAt(0).toUpperCase()+s.slice(1), value: s }))
    if (field === 'job_id') return jobs.map(j => ({ label: j.title, value: j.id }))
    return []
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 z-50" style={{ width: '500px' }}>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Filter Candidates</p>

      {!filters.length && (
        <p className="text-xs text-gray-400 mb-3">No filters yet. Click + Add filter below.</p>
      )}

      <div className="space-y-3">
        {filters.map(f => {
          const def = FILTER_FIELDS.find(ff => ff.key === f.field) ?? { type: 'text', key: f.field, label: f.field }
          const ops = OPS[def.type] ?? OPS.text
          const showVal = !['is_empty', 'is_not_empty'].includes(f.op)
          const isPills = ['is_any_of', 'is_none_of'].includes(f.op)
          const opts = getOptions(f.field)

          return (
            <div key={f.id}>
              <div className="flex items-center gap-2">
                {/* Field */}
                <select value={f.field}
                  onChange={e => {
                    const nd = FILTER_FIELDS.find(ff => ff.key === e.target.value)
                    update(f.id, { field: e.target.value, op: (OPS[nd?.type??'text'])[0].op, value: '', values: [] })
                  }}
                  className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {FILTER_FIELDS.map(ff => <option key={ff.key} value={ff.key}>{ff.label}</option>)}
                </select>

                {/* Operator */}
                <select value={f.op}
                  onChange={e => update(f.id, { op: e.target.value as FilterOp, value: '', values: [] })}
                  className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>

                {/* Value — text */}
                {showVal && !isPills && def.type === 'text' && (
                  <input value={f.value} onChange={e => update(f.id, { value: e.target.value })}
                    placeholder="value…"
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                )}

                {/* Value — single select */}
                {showVal && !isPills && (def.type === 'single' || def.type === 'multi') && (
                  <select value={f.value} onChange={e => update(f.id, { value: e.target.value })}
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">Choose…</option>
                    {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}

                {!showVal && <div className="flex-1"/>}

                <button onClick={() => remove(f.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 p-1">
                  <X className="w-3.5 h-3.5"/>
                </button>
              </div>

              {/* Pills for is_any_of / is_none_of */}
              {showVal && isPills && opts.length > 0 && (
                <div className="mt-2 ml-1 flex flex-wrap gap-1.5 bg-gray-50 rounded-lg p-2">
                  {opts.map(o => {
                    const sel = f.values.includes(o.value)
                    return (
                      <button key={o.value} onClick={() => togglePill(f.id, o.value)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                          sel
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                        }`}>
                        {o.label}
                      </button>
                    )
                  })}
                  {f.values.length > 0 && (
                    <span className="text-xs text-gray-400 self-center">
                      {f.values.length} selected
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button onClick={add}
        className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors">
        <Plus className="w-3.5 h-3.5"/> Add filter
      </button>
    </div>
  )
}
