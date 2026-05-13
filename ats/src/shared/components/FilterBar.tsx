import React from 'react'
import { X, Plus } from 'lucide-react'
import { INTERVIEW_STAGES } from '../../types/database.types'

// ── Types ─────────────────────────────────────────────────────
export type FilterOp =
  | 'contains' | 'not_contains' | 'is' | 'is_not'
  | 'is_any_of' | 'is_none_of'
  | 'is_empty' | 'is_not_empty'
  | 'gt' | 'lt' | 'gte' | 'lte'            // numeric
  | 'date_is' | 'date_before' | 'date_after' // datetime

export type FilterMode = 'and' | 'or'

export interface ActiveFilter {
  id: string
  field: string
  op: FilterOp
  value: string
  values: string[]
}

export interface CustomFieldDef {
  field_name: string
  field_label: string
  field_type: 'text' | 'number' | 'date' | 'url' | 'boolean'
}

type FieldType = 'text' | 'multi' | 'single' | 'number' | 'datetime' | 'boolean'

interface FieldDef {
  key: string
  label: string
  type: FieldType
  custom?: boolean
}

// Static system fields
const SYSTEM_FIELDS: FieldDef[] = [
  { key: 'full_name',        label: 'Name',           type: 'text'     },
  { key: 'email',            label: 'Email',          type: 'text'     },
  { key: 'phone',            label: 'Phone',          type: 'text'     },
  { key: 'current_stage',    label: 'Stage',          type: 'multi'    },
  { key: 'source_category',  label: 'Source',         type: 'single'   },
  { key: 'source_name',      label: 'Sub-Source',     type: 'text'     },
  { key: 'job_id',           label: 'Job',            type: 'multi'    },
  { key: 'interviewer_id',   label: 'Interviewer',    type: 'multi'    },
  { key: 'hr_owner',         label: 'HR Owner',       type: 'single'   },
  { key: 'interview_date',   label: 'Interview Date', type: 'datetime' },
]

// Ops per field type
const OPS_FOR: Record<FieldType, { op: FilterOp; label: string }[]> = {
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
  ],
  number: [
    { op: 'is',   label: '= equals' },
    { op: 'gt',   label: '> greater than' },
    { op: 'gte',  label: '≥ at least' },
    { op: 'lt',   label: '< less than' },
    { op: 'lte',  label: '≤ at most' },
    { op: 'is_empty',     label: 'is empty' },
    { op: 'is_not_empty', label: 'is not empty' },
  ],
  datetime: [
    { op: 'date_is',     label: 'is on' },
    { op: 'date_before', label: 'is before' },
    { op: 'date_after',  label: 'is after' },
    { op: 'is_empty',    label: 'is not set' },
    { op: 'is_not_empty',label: 'is set' },
  ],
  boolean: [
    { op: 'is', label: 'is' },
  ],
}

const SOURCES = ['platform', 'agency', 'college']

// ── Apply filters ──────────────────────────────────────────────
export function applyFilters(
  candidates: any[],
  filters: ActiveFilter[],
  jobs: any[],
  interviewers: any[],
  mode: FilterMode = 'and',
  customFieldDefs: CustomFieldDef[] = []
): any[] {
  if (!filters.length) return candidates

  const match = (c: any, f: ActiveFilter): boolean => {
    // ── Interviewer array field ──
    if (f.field === 'interviewer_id') {
      const arr: string[] = c.assigned_interviewers ?? []
      if (f.op === 'is_any_of')  return !f.values.length || f.values.some(v => arr.includes(v))
      if (f.op === 'is_none_of') return !f.values.length || !f.values.some(v => arr.includes(v))
      return true
    }

    // ── Interview date ──
    if (f.field === 'interview_date') {
      const d = c.interview_date ? new Date(c.interview_date) : null
      if (f.op === 'is_empty')     return !d
      if (f.op === 'is_not_empty') return !!d
      if (!d || !f.value) return true
      const ref = new Date(f.value)
      if (f.op === 'date_is')     return d.toDateString() === ref.toDateString()
      if (f.op === 'date_before') return d < ref
      if (f.op === 'date_after')  return d > ref
      return true
    }

    // ── Job ID ──
    if (f.field === 'job_id') {
      const raw = (c.job_id ?? c.job?.id ?? '').toString().toLowerCase()
      if (f.op === 'is_any_of')  return !f.values.length || f.values.some(v => raw === v.toLowerCase())
      if (f.op === 'is_none_of') return !f.values.length || !f.values.some(v => raw === v.toLowerCase())
      return true
    }

    // ── Custom field ──
    const cfDef = customFieldDefs.find(cf => `cf_${cf.field_name}` === f.field)
    if (cfDef) {
      const raw = (c.custom_data?.[cfDef.field_name] ?? '').toString().trim()
      if (f.op === 'is_empty')     return !raw
      if (f.op === 'is_not_empty') return !!raw
      if (cfDef.field_type === 'number') {
        const num = parseFloat(raw)
        const ref = parseFloat(f.value)
        if (isNaN(num) || isNaN(ref)) return false
        if (f.op === 'is')  return num === ref
        if (f.op === 'gt')  return num > ref
        if (f.op === 'gte') return num >= ref
        if (f.op === 'lt')  return num < ref
        if (f.op === 'lte') return num <= ref
        return true
      }
      // text/url/boolean
      const lower = raw.toLowerCase()
      const val = f.value.toLowerCase()
      if (f.op === 'contains')     return lower.includes(val)
      if (f.op === 'not_contains') return !lower.includes(val)
      if (f.op === 'is')           return lower === val
      if (f.op === 'is_not')       return lower !== val
      return true
    }

    // ── Standard scalar field ──
    const raw = (c[f.field] ?? '').toString().toLowerCase().trim()
    const val = f.value.toLowerCase().trim()
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

// ── FilterBar UI ──────────────────────────────────────────────
interface Props {
  filters: ActiveFilter[]
  onChange: (f: ActiveFilter[]) => void
  jobs: { id: string; title: string }[]
  interviewers: { id: string; full_name: string }[]
  hrUsers: { id: string; full_name: string }[]
  mode: FilterMode
  onModeChange: (m: FilterMode) => void
  customFieldDefs?: CustomFieldDef[]
}

export function FilterBar({ filters, onChange, jobs, interviewers, hrUsers, mode, onModeChange, customFieldDefs = [] }: Props) {
  // Build dynamic field list including custom fields
  const allFields: FieldDef[] = [
    ...SYSTEM_FIELDS,
    ...customFieldDefs.map(cf => ({
      key: `cf_${cf.field_name}`,
      label: cf.field_label,
      type: (
        cf.field_type === 'number'  ? 'number'   :
        cf.field_type === 'date'    ? 'datetime' :
        cf.field_type === 'boolean' ? 'boolean'  : 'text'
      ) as FieldType,
      custom: true,
    })),
  ]

  const add = () => onChange([...filters, {
    id: Date.now().toString(), field: 'full_name', op: 'contains', value: '', values: []
  }])

  const upd = (id: string, patch: Partial<ActiveFilter>) =>
    onChange(filters.map(f => f.id === id ? { ...f, ...patch } : f))

  const rem = (id: string) => onChange(filters.filter(f => f.id !== id))

  const togglePill = (id: string, val: string) => {
    const f = filters.find(ff => ff.id === id)
    if (!f) return
    upd(id, { values: f.values.includes(val) ? f.values.filter(v => v !== val) : [...f.values, val] })
  }

  const getOpts = (field: string) => {
    if (field === 'current_stage')   return INTERVIEW_STAGES.map(s => ({ label: s, value: s }))
    if (field === 'source_category') return SOURCES.map(s => ({ label: s.charAt(0).toUpperCase()+s.slice(1), value: s }))
    if (field === 'job_id')          return jobs.map(j => ({ label: j.title, value: j.id }))
    if (field === 'interviewer_id')  return interviewers.map(u => ({ label: u.full_name, value: u.id }))
    if (field === 'hr_owner')        return hrUsers.map(u => ({ label: u.full_name, value: u.id }))
    return []
  }

  const inputCls = 'flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 z-50" style={{ width: '540px' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Filter Candidates</p>
        {filters.length > 1 && (
          <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
            {(['and','or'] as FilterMode[]).map(m => (
              <button key={m} onClick={() => onModeChange(m)}
                className={`px-3 py-1 rounded-md text-xs font-bold uppercase transition-all ${
                  mode === m ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'
                }`}>{m}</button>
            ))}
          </div>
        )}
      </div>

      {!filters.length && <p className="text-xs text-gray-400 mb-3">No filters yet. Click + Add filter.</p>}

      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
        {filters.map((f, idx) => {
          const fieldDef = allFields.find(ff => ff.key === f.field) ?? { type: 'text' as FieldType, key: f.field, label: f.field }
          const ops = OPS_FOR[fieldDef.type] ?? OPS_FOR.text
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
                {/* Field selector */}
                <select value={f.field}
                  onChange={e => {
                    const nd = allFields.find(ff => ff.key === e.target.value)
                    upd(f.id, { field: e.target.value, op: (OPS_FOR[nd?.type ?? 'text'])[0].op, value: '', values: [] })
                  }}
                  className={inputCls}>
                  <optgroup label="Candidate">
                    {SYSTEM_FIELDS.map(ff => <option key={ff.key} value={ff.key}>{ff.label}</option>)}
                  </optgroup>
                  {customFieldDefs.length > 0 && (
                    <optgroup label="Custom Fields">
                      {customFieldDefs.map(cf => (
                        <option key={`cf_${cf.field_name}`} value={`cf_${cf.field_name}`}>{cf.field_label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {/* Operator */}
                <select value={f.op}
                  onChange={e => upd(f.id, { op: e.target.value as FilterOp, value: '', values: [] })}
                  className={inputCls}>
                  {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>

                {/* Value input — varies by type */}
                {showVal && !isPills && (
                  fieldDef.type === 'datetime' ? (
                    <input type="date" value={f.value}
                      onChange={e => upd(f.id, { value: e.target.value })}
                      className={inputCls}/>
                  ) : fieldDef.type === 'number' ? (
                    <input type="number" value={f.value} placeholder="e.g. 10"
                      onChange={e => upd(f.id, { value: e.target.value })}
                      className={inputCls}/>
                  ) : fieldDef.type === 'boolean' ? (
                    <select value={f.value} onChange={e => upd(f.id, { value: e.target.value })} className={inputCls}>
                      <option value="">Choose…</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (fieldDef.type === 'single' || (fieldDef.type === 'multi' && opts.length > 0)) && !isPills ? (
                    <select value={f.value} onChange={e => upd(f.id, { value: e.target.value })} className={inputCls}>
                      <option value="">Choose…</option>
                      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input value={f.value} onChange={e => upd(f.id, { value: e.target.value })}
                      placeholder="value…" className={inputCls}/>
                  )
                )}
                {!showVal && <div className="flex-1"/>}

                <button onClick={() => rem(f.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors p-1 flex-shrink-0">
                  <X className="w-3.5 h-3.5"/>
                </button>
              </div>

              {/* Pill multi-select */}
              {showVal && isPills && opts.length > 0 && (
                <div className="mt-2 ml-1 flex flex-wrap gap-1.5 bg-gray-50 rounded-lg p-2.5">
                  {opts.map(o => {
                    const sel = f.values.includes(o.value)
                    return (
                      <button key={o.value} onClick={() => togglePill(f.id, o.value)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                          sel ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                        }`}>
                        {o.label}
                      </button>
                    )
                  })}
                  {f.values.length > 0 && (
                    <span className="text-xs text-gray-400 self-center">{f.values.length} selected</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button onClick={add}
        className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
        <Plus className="w-3.5 h-3.5"/> Add filter
      </button>
    </div>
  )
}
