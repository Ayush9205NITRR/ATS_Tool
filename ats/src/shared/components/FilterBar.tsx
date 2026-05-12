// ── Airtable-style Filter Bar ─────────────────────────────────
// Supports: text (contains/not_contains/is/is_empty/is_not_empty)
//           single-select (is/is_not)
//           multi-select (is_any_of/is_none_of)

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
  value: string      // single value
  values: string[]   // multi values (is_any_of / is_none_of)
}

export const FILTER_FIELDS = [
  { key: 'full_name',       label: 'Name',         type: 'text'   },
  { key: 'email',           label: 'Email',        type: 'text'   },
  { key: 'phone',           label: 'Phone',        type: 'text'   },
  { key: 'current_stage',   label: 'Stage',        type: 'multi'  },
  { key: 'source_category', label: 'Source',       type: 'single' },
  { key: 'source_name',     label: 'Sub-Source',   type: 'text'   },
  { key: 'job_id',          label: 'Job',          type: 'multi'  },
]

export const OPS_FOR_TYPE: Record<string, { op: FilterOp; label: string }[]> = {
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

export function applyFilters(candidates: any[], filters: ActiveFilter[], jobs: any[]): any[] {
  if (filters.length === 0) return candidates

  return candidates.filter(c =>
    filters.every(f => {
      // job_id special case — compare UUID directly
      let raw: string
      if (f.field === 'job_id') {
        raw = (c.job_id ?? c.job?.id ?? '').toString().toLowerCase().trim()
      } else {
        raw = (c[f.field] ?? '').toString().toLowerCase().trim()
      }

      const val = f.value.toLowerCase().trim()

      switch (f.op) {
        case 'contains':      return raw.includes(val)
        case 'not_contains':  return !raw.includes(val)
        case 'is':            return raw === val
        case 'is_not':        return raw !== val
        case 'is_empty':      return !raw
        case 'is_not_empty':  return !!raw
        case 'is_any_of':
          if (f.values.length === 0) return true
          return f.values.some(v => raw === v.toLowerCase())
        case 'is_none_of':
          if (f.values.length === 0) return true
          return !f.values.some(v => raw === v.toLowerCase())
        default: return true
      }
    })
  )
}

interface FilterBarProps {
  filters: ActiveFilter[]
  onChange: (f: ActiveFilter[]) => void
  jobs: { id: string; title: string }[]
}

export function FilterBar({ filters, onChange, jobs }: FilterBarProps) {
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

  const toggleMultiValue = (filterId: string, val: string) => {
    const f = filters.find(ff => ff.id === filterId)
    if (!f) return
    const next = f.values.includes(val)
      ? f.values.filter(v => v !== val)
      : [...f.values, val]
    update(filterId, { values: next })
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 w-[520px] z-50">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Filter Candidates</p>

      {filters.length === 0 && (
        <p className="text-xs text-gray-400 py-1 mb-2">No filters active. Add one below.</p>
      )}

      <div className="space-y-3">
        {filters.map(f => {
          const fieldDef = FILTER_FIELDS.find(ff => ff.key === f.field) ?? { type: 'text' }
          const ops = OPS_FOR_TYPE[fieldDef.type] ?? OPS_FOR_TYPE.text
          const showValue = !['is_empty', 'is_not_empty'].includes(f.op)
          const isMulti = ['is_any_of', 'is_none_of'].includes(f.op)

          // Option lists for select fields
          const getOptions = (field: string): { label: string; value: string }[] => {
            if (field === 'current_stage') return [...INTERVIEW_STAGES].map(s => ({ label: s, value: s }))
            if (field === 'source_category') return SOURCES.map(s => ({ label: s.charAt(0).toUpperCase()+s.slice(1), value: s }))
            if (field === 'job_id') return jobs.map(j => ({ label: j.title, value: j.id }))
            return []
          }

          return (
            <div key={f.id} className="space-y-2">
              <div className="flex items-center gap-2">
                {/* Field selector */}
                <select
                  value={f.field}
                  onChange={e => {
                    const newField = e.target.value
                    const newDef = FILTER_FIELDS.find(ff => ff.key === newField)
                    const newOps = OPS_FOR_TYPE[newDef?.type ?? 'text']
                    update(f.id, { field: newField, op: newOps[0].op, value: '', values: [] })
                  }}
                  className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {FILTER_FIELDS.map(ff => (
                    <option key={ff.key} value={ff.key}>{ff.label}</option>
                  ))}
                </select>

                {/* Op selector */}
                <select
                  value={f.op}
                  onChange={e => update(f.id, { op: e.target.value as FilterOp, value: '', values: [] })}
                  className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>

                {/* Single text value */}
                {showValue && !isMulti && fieldDef.type === 'text' && (
                  <input
                    value={f.value}
                    onChange={e => update(f.id, { value: e.target.value })}
                    placeholder="value…"
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                )}

                {/* Single select value */}
                {showValue && !isMulti && (fieldDef.type === 'single' || fieldDef.type === 'multi') && (
                  <select
                    value={f.value}
                    onChange={e => update(f.id, { value: e.target.value })}
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">Choose…</option>
                    {getOptions(f.field).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                )}

                {!showValue && <div className="flex-1"/>}

                <button onClick={() => remove(f.id)} className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
                  <X className="w-4 h-4"/>
                </button>
              </div>

              {/* Multi-select pills */}
              {showValue && isMulti && (
                <div className="ml-2 flex flex-wrap gap-1.5 p-2 bg-gray-50 rounded-lg">
                  {getOptions(f.field).map(opt => {
                    const selected = f.values.includes(opt.value)
                    return (
                      <button
                        key={opt.value}
                        onClick={() => toggleMultiValue(f.id, opt.value)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                          selected
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                  {f.values.length > 0 && (
                    <span className="text-xs text-gray-400 self-center ml-1">{f.values.length} selected</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        onClick={add}
        className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
      >
        <Plus className="w-3.5 h-3.5"/> Add filter
      </button>
    </div>
  )
}
