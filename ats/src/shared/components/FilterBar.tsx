import React from 'react'
import { X, Plus } from 'lucide-react'
import { INTERVIEW_STAGES } from '../../types/database.types'

export type FilterOp = 'contains'|'not_contains'|'is'|'is_not'|'is_any_of'|'is_none_of'|'is_empty'|'is_not_empty'
export type FilterMode = 'and' | 'or'

export interface ActiveFilter {
  id: string; field: string; op: FilterOp; value: string; values: string[]
}

export const FILTER_FIELDS = [
  { key: 'full_name',         label: 'Name',            type: 'text'   },
  { key: 'email',             label: 'Email',           type: 'text'   },
  { key: 'phone',             label: 'Phone',           type: 'text'   },
  { key: 'current_stage',     label: 'Stage',           type: 'multi'  },
  { key: 'source_category',   label: 'Source',          type: 'single' },
  { key: 'source_name',       label: 'Sub-Source',      type: 'text'   },
  { key: 'job_id',            label: 'Job',             type: 'multi'  },
  { key: 'interviewer_id',    label: 'Interviewer',     type: 'multi'  },
  { key: 'has_interview_date',label: 'Interview Date',  type: 'single' },
]

const OPS: Record<string, { op: FilterOp; label: string }[]> = {
  text:   [
    { op: 'contains', label: 'contains' }, { op: 'not_contains', label: 'does not contain' },
    { op: 'is', label: 'is exactly' }, { op: 'is_not', label: 'is not' },
    { op: 'is_empty', label: 'is empty' }, { op: 'is_not_empty', label: 'is not empty' },
  ],
  single: [{ op: 'is', label: 'is' }, { op: 'is_not', label: 'is not' }],
  multi:  [{ op: 'is_any_of', label: 'is any of' }, { op: 'is_none_of', label: 'is none of' }],
}

const SOURCES = ['platform', 'agency', 'college']

export function applyFilters(
  candidates: any[],
  filters: ActiveFilter[],
  jobs: any[],
  interviewers: any[],
  mode: FilterMode = 'and'
): any[] {
  if (!filters.length) return candidates
  const match = (c: any, f: ActiveFilter): boolean => {
    // Special: interviewer_id checks assigned_interviewers array
    if (f.field === 'interviewer_id') {
      const arr: string[] = c.assigned_interviewers ?? []
      if (f.op === 'is_any_of') return !f.values.length || f.values.some(v => arr.includes(v))
      if (f.op === 'is_none_of') return !f.values.length || !f.values.some(v => arr.includes(v))
      return true
    }
    // Special: has_interview_date
    if (f.field === 'has_interview_date') {
      const has = !!c.interview_date
      return f.value === 'yes' ? has : !has
    }
    const raw = f.field === 'job_id'
      ? (c.job_id ?? c.job?.id ?? '').toString().toLowerCase()
      : (c[f.field] ?? '').toString().toLowerCase()
    const val = f.value.toLowerCase()
    switch (f.op) {
      case 'contains':     return raw.includes(val)
      case 'not_contains': return !raw.includes(val)
      case 'is':           return raw === val
      case 'is_not':       return raw !== val
      case 'is_empty':     return !raw
      case 'is_not_empty': return !!raw
      case 'is_any_of':    return !f.values.length || f.values.some(v => raw === v.toLowerCase())
      case 'is_none_of':   return !f.values.length || !f.values.some(v => raw === v.toLowerCase())
      default:             return true
    }
  }
  return candidates.filter(c =>
    mode === 'and' ? filters.every(f => match(c, f)) : filters.some(f => match(c, f))
  )
}

interface Props {
  filters: ActiveFilter[]
  onChange: (f: ActiveFilter[]) => void
  jobs: { id: string; title: string }[]
  interviewers: { id: string; full_name: string }[]
  mode: FilterMode
  onModeChange: (m: FilterMode) => void
}

export function FilterBar({ filters, onChange, jobs, interviewers, mode, onModeChange }: Props) {
  const add = () => onChange([...filters, { id: Date.now().toString(), field: 'full_name', op: 'contains', value: '', values: [] }])
  const upd = (id: string, p: Partial<ActiveFilter>) => onChange(filters.map(f => f.id === id ? { ...f, ...p } : f))
  const rem = (id: string) => onChange(filters.filter(f => f.id !== id))

  const togglePill = (id: string, val: string) => {
    const f = filters.find(ff => ff.id === id); if (!f) return
    upd(id, { values: f.values.includes(val) ? f.values.filter(v => v !== val) : [...f.values, val] })
  }

  const getOpts = (field: string) => {
    if (field === 'current_stage') return INTERVIEW_STAGES.map(s => ({ label: s, value: s }))
    if (field === 'source_category') return SOURCES.map(s => ({ label: s.charAt(0).toUpperCase()+s.slice(1), value: s }))
    if (field === 'job_id') return jobs.map(j => ({ label: j.title, value: j.id }))
    if (field === 'interviewer_id') return interviewers.map(u => ({ label: u.full_name, value: u.id }))
    if (field === 'has_interview_date') return [{ label: 'Set', value: 'yes' }, { label: 'Not set', value: 'no' }]
    return []
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 z-50" style={{ width: '520px' }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Filter Candidates</p>
        {filters.length > 1 && (
          <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
            {(['and','or'] as FilterMode[]).map(m => (
              <button key={m} onClick={() => onModeChange(m)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase transition-all ${mode === m ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {!filters.length && <p className="text-xs text-gray-400 mb-3">No filters yet.</p>}

      <div className="space-y-3">
        {filters.map((f, idx) => {
          const def = FILTER_FIELDS.find(ff => ff.key === f.field) ?? { type: 'text' }
          const ops = OPS[def.type] ?? OPS.text
          const showVal = !['is_empty','is_not_empty'].includes(f.op)
          const isPills = ['is_any_of','is_none_of'].includes(f.op)
          const opts = getOpts(f.field)

          return (
            <div key={f.id}>
              {idx > 0 && (
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-px bg-gray-100"/>
                  <span className="text-xs font-bold text-gray-400 uppercase">{mode}</span>
                  <div className="flex-1 h-px bg-gray-100"/>
                </div>
              )}
              <div className="flex items-center gap-2">
                <select value={f.field}
                  onChange={e => {
                    const nd = FILTER_FIELDS.find(ff => ff.key === e.target.value)
                    upd(f.id, { field: e.target.value, op: (OPS[nd?.type??'text'])[0].op, value: '', values: [] })
                  }}
                  className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {FILTER_FIELDS.map(ff => <option key={ff.key} value={ff.key}>{ff.label}</option>)}
                </select>
                <select value={f.op}
                  onChange={e => upd(f.id, { op: e.target.value as FilterOp, value: '', values: [] })}
                  className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                {showVal && !isPills && def.type === 'text' && (
                  <input value={f.value} onChange={e => upd(f.id, { value: e.target.value })} placeholder="value…"
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                )}
                {showVal && !isPills && def.type !== 'text' && (
                  <select value={f.value} onChange={e => upd(f.id, { value: e.target.value })}
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">Choose…</option>
                    {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {!showVal && <div className="flex-1"/>}
                <button onClick={() => rem(f.id)} className="text-gray-300 hover:text-red-500 transition-colors p-1 flex-shrink-0">
                  <X className="w-3.5 h-3.5"/>
                </button>
              </div>
              {showVal && isPills && opts.length > 0 && (
                <div className="mt-2 ml-1 flex flex-wrap gap-1.5 bg-gray-50 rounded-lg p-2.5">
                  {opts.map(o => {
                    const sel = f.values.includes(o.value)
                    return (
                      <button key={o.value} onClick={() => togglePill(f.id, o.value)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${sel ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                        {o.label}
                      </button>
                    )
                  })}
                  {f.values.length > 0 && <span className="text-xs text-gray-400 self-center">{f.values.length} selected</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button onClick={add} className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
        <Plus className="w-3.5 h-3.5"/> Add filter
      </button>
    </div>
  )
}
