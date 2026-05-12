import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Upload, UserPlus, Loader2, ExternalLink, FileText, Eye, X, Archive, Trash2, Filter, ChevronDown } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCandidates } from './useCandidates'
import { PageHeader } from '../../shared/components/PageHeader'
import { Button } from '../../shared/components/Button'
import { EmptyState } from '../../shared/components/EmptyState'
import { Modal } from '../../shared/components/Modal'
import { FilterBar, applyFilters } from '../../shared/components/FilterBar'
import type { ActiveFilter } from '../../shared/components/FilterBar'
import { useAuthStore } from '../auth/authStore'
import { supabase } from '../../lib/supabaseClient'
import type { CandidateFilters } from './candidateService'
import type { SourceCategory } from '../../types/database.types'
import { INTERVIEW_STAGES } from '../../types/database.types'
import { formatDate } from '../../shared/utils/helpers'

const SOURCES: SourceCategory[] = ['platform', 'agency', 'college']


const DEFAULT_COLS = new Set(['stage','job','source','subsource','hr_owner','interviewer','interview_date'])
const ALL_COLUMNS = [
  { key: 'email',          label: 'Email' },
  { key: 'phone',          label: 'Phone' },
  { key: 'linkedin',       label: 'LinkedIn' },
  { key: 'resume',         label: 'Resume' },
  { key: 'stage',          label: 'Stage' },
  { key: 'job',            label: 'Job' },
  { key: 'source',         label: 'Source' },
  { key: 'subsource',      label: 'Sub-Source' },
  { key: 'hr_owner',       label: 'HR Owner' },
  { key: 'interviewer',    label: 'Interviewer' },
  { key: 'interview_date', label: 'Interview Date' },
  { key: 'notes',          label: 'Notes' },
]

// ── Inline Stage Dropdown ─────────────────────────────────────
function StageCell({ candidateId, value, canEdit, onUpdate }: { candidateId: string; value: string; canEdit: boolean; onUpdate: (id: string, field: string, val: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const STAGE_COLOURS: Record<string, string> = {
    Applied: 'bg-gray-100 text-gray-700', Screening: 'bg-blue-100 text-blue-700',
    R1: 'bg-indigo-100 text-indigo-700', 'Case Study': 'bg-yellow-100 text-yellow-700',
    R2: 'bg-orange-100 text-orange-700', R3: 'bg-orange-200 text-orange-800',
    'CF (Virtual)': 'bg-purple-100 text-purple-700', 'CF (In-Person)': 'bg-purple-200 text-purple-800',
    Offer: 'bg-violet-100 text-violet-700', Hired: 'bg-green-100 text-green-700',
    Rejected: 'bg-red-100 text-red-700',
  }

  if (!canEdit) return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[value] ?? 'bg-gray-100 text-gray-600'}`}>{value}</span>

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 hover:opacity-80 transition-opacity ${STAGE_COLOURS[value] ?? 'bg-gray-100 text-gray-600'}`}>
        {value}
        <ChevronDown className="w-3 h-3"/>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 w-44 max-h-72 overflow-y-auto">
          {INTERVIEW_STAGES.map(s => (
            <button key={s} onClick={() => { onUpdate(candidateId, 'current_stage', s); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors flex items-center justify-between ${s === value ? 'font-semibold text-blue-600' : 'text-gray-700'}`}>
              <span className={`px-2 py-0.5 rounded-full ${STAGE_COLOURS[s] ?? 'bg-gray-100'}`}>{s}</span>
              {s === value && <span className="text-blue-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Inline Dropdown Cell ──────────────────────────────────────
function SelectCell({ candidateId, field, value, display, options, canEdit, onUpdate, placeholder }: {
  candidateId: string; field: string; value: string | null; display?: string | null
  options: { label: string; value: string }[]; canEdit: boolean; onUpdate: (id: string, field: string, val: any) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!canEdit) return <span className="text-xs text-gray-600">{display ?? value ?? '—'}</span>

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="text-xs text-gray-700 hover:text-blue-600 flex items-center gap-1 group/sel transition-colors">
        <span className="truncate max-w-[110px]">{display ?? value ?? <span className="text-gray-300">{placeholder ?? '—'}</span>}</span>
        <ChevronDown className="w-3 h-3 text-gray-300 group-hover/sel:text-blue-400 flex-shrink-0"/>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 w-48 max-h-60 overflow-y-auto">
          <button onClick={() => { onUpdate(candidateId, field, null); setOpen(false) }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">— Clear —</button>
          {options.map(o => (
            <button key={o.value} onClick={() => { onUpdate(candidateId, field, o.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center justify-between ${o.value === value ? 'font-semibold text-blue-600' : 'text-gray-700'}`}>
              {o.label}
              {o.value === value && <span className="text-blue-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Date Cell ────────────────────────────────────────────────
function DateCell({ candidateId, value, canEdit, onUpdate }: { candidateId: string; value: string | null; canEdit: boolean; onUpdate: (id: string, field: string, val: any) => void }) {
  const [editing, setEditing] = useState(false)
  if (!canEdit) return <span className="text-xs text-gray-500">{value ? formatDate(value) : '—'}</span>
  if (editing) return (
    <input type="date" defaultValue={value ?? ''} autoFocus
      onBlur={e => { onUpdate(candidateId, 'interview_date', e.target.value || null); setEditing(false) }}
      className="w-28 px-2 py-1 border border-blue-400 rounded text-xs focus:outline-none bg-white"/>
  )
  return (
    <button onClick={() => setEditing(true)} className="text-xs text-gray-400 hover:text-blue-600 transition-colors">
      {value ? formatDate(value) : 'Set date'}
    </button>
  )
}

// ── Main Component ────────────────────────────────────────────
export function CandidatesPage() {
  const navigate = useNavigate()
  const { hasRole, user } = useAuthStore()
  const qc = useQueryClient()
  const canEdit      = hasRole(['admin', 'super_admin', 'hr_team'])
  const canAssign    = hasRole(['admin', 'super_admin'])
  const isSuperAdmin = hasRole(['super_admin'])

  const [filters, setFilters]           = useState<CandidateFilters>({})
  const [search, setSearch]             = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [showColPicker, setShowColPicker] = useState(false)
  const [showBulkMenu, setShowBulkMenu]   = useState(false)
  const [showFilterBar, setShowFilterBar] = useState(false)
  const [bulkField, setBulkField]         = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [visibleCols, setVisibleCols]     = useState<Set<string>>(DEFAULT_COLS)
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilterBar(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const { data: jobs = [] } = useQuery({ queryKey: ['jobs','filter'], queryFn: async () => { const {data}=await supabase.from('jobs').select('id,title').order('title'); return data??[] } })
  const { data: hrUsers = [] } = useQuery({ queryKey: ['users','hr'], queryFn: async () => { const {data}=await supabase.from('users').select('id,full_name').in('role',['hr_team','admin','super_admin']).eq('is_active',true); return data??[] } })
  const { data: interviewers = [] } = useQuery({ queryKey: ['users','interviewers'], queryFn: async () => { const {data}=await supabase.from('users').select('id,full_name').eq('role','interviewer').eq('is_active',true); return data??[] } })
  const { data: customFields = [] } = useQuery({ queryKey: ['custom-fields'], queryFn: async () => { const {data}=await supabase.from('custom_fields').select('*').eq('is_active',true).order('sort_order'); return data??[] } })

  const { data: candidates = [], isLoading } = useCandidates({ ...filters, search: search||undefined })

  let displayed = candidates.filter((c:any) => showArchived ? !!c.archived_at : !c.archived_at)
  if (activeFilters.length > 0) displayed = applyFilters(displayed, activeFilters, jobs as any[])

  const updateField = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      const payload = field === 'assigned_interviewers' ? { [field]: value ? [value] : [] } : { [field]: value }
      const { error } = await supabase.from('candidates').update(payload).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['candidates'] }),
  })

  const onUpdate = (id: string, field: string, value: any) => updateField.mutate({ id, field, value })

  const archiveOne = useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      const { error } = await supabase.from('candidates').update({ archived_at: archive ? new Date().toISOString() : null, archived_by: archive ? user!.id : null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['candidates'] }); setSelectedIds(new Set()) },
  })

  const deleteOne = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('candidates').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['candidates'] }); setConfirmDelete(null) },
  })

  const bulkUpdate = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: any }) => {
      const payload = field === 'assigned_interviewers' ? { [field]: value ? [value] : [] } : { [field]: value }
      const { error } = await supabase.from('candidates').update(payload).in('id', Array.from(selectedIds))
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['candidates'] }); setSelectedIds(new Set()); setBulkField(null); setShowBulkMenu(false) },
  })

  const bulkArchive = useMutation({
    mutationFn: async (archive: boolean) => {
      const { error } = await supabase.from('candidates').update({ archived_at: archive ? new Date().toISOString() : null, archived_by: archive ? user!.id : null }).in('id', Array.from(selectedIds))
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['candidates'] }); setSelectedIds(new Set()) },
  })

  const createMagicLink = useMutation({
    mutationFn: async (candidateId: string) => {
      const { data, error } = await supabase.from('magic_review_links').insert({ candidate_id: candidateId, created_by: user!.id }).select().single()
      if (error) throw error
      const url = `${window.location.origin}/review/${data.id}`
      await navigator.clipboard.writeText(url)
      return url
    },
  })

  const toggleCol = (key: string) => setVisibleCols(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleSelect = (id: string) => setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelectedIds(selectedIds.size === displayed.length ? new Set() : new Set(displayed.map((c: any) => c.id)))
  const getName = (list: any[], id: string | null) => { if (!id) return null; const item = list.find(u => u.id === id); return item?.full_name ?? item?.title ?? null }
  const show = (key: string) => visibleCols.has(key)

  const hasActiveFilters = activeFilters.length > 0 || search

  return (
    <div>
      <PageHeader
        title={showArchived ? 'Archived' : 'Candidates'}
        subtitle={`${displayed.length}${candidates.length !== displayed.length ? ` of ${candidates.length}` : ''} total${selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ''}`}
        action={
          <div className="flex gap-2 flex-wrap justify-end">
            <Button variant={showArchived ? 'primary' : 'secondary'} size="sm" icon={<Archive className="w-3.5 h-3.5"/>}
              onClick={() => { setShowArchived(!showArchived); setSelectedIds(new Set()) }}>
              {showArchived ? 'Active' : 'Archived'}
            </Button>

            {/* Column picker */}
            <div className="relative">
              <Button variant="secondary" size="sm" icon={<Eye className="w-3.5 h-3.5"/>}
                onClick={() => { setShowColPicker(!showColPicker); setShowBulkMenu(false) }}>
                Columns
              </Button>
              {showColPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowColPicker(false)}/>
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3 w-44 max-h-72 overflow-y-auto">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Columns</p>
                    {[...ALL_COLUMNS, ...(customFields as any[]).map(f => ({ key: `cf_${f.field_name}`, label: f.field_label }))].map(col => (
                      <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer hover:text-blue-600">
                        <input type="checkbox" checked={visibleCols.has(col.key)} onChange={() => toggleCol(col.key)} className="rounded border-gray-300 text-blue-600"/>
                        <span className="text-sm text-gray-700">{col.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Bulk */}
            {selectedIds.size > 0 && (
              <div className="relative">
                <Button size="sm" onClick={() => { setShowBulkMenu(!showBulkMenu); setShowColPicker(false) }}>
                  Bulk ({selectedIds.size}) ▾
                </Button>
                {showBulkMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => { setShowBulkMenu(false); setBulkField(null) }}/>
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3 w-56">
                      <p className="text-xs font-semibold text-gray-500 mb-2">Bulk Actions</p>
                      {['current_stage','job_id','hr_owner','assigned_interviewers'].map(f => (
                        <button key={f} onClick={() => setBulkField(f)}
                          className={`w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50 text-gray-700 ${bulkField===f?'bg-blue-50 text-blue-700':''}`}>
                          {f==='current_stage'?'Change Stage':f==='job_id'?'Assign Job':f==='hr_owner'?'Assign HR Owner':'Assign Interviewer'}
                        </button>
                      ))}
                      <button onClick={() => bulkArchive.mutate(!showArchived)}
                        className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-amber-50 text-amber-600">
                        {showArchived ? 'Unarchive' : 'Archive'} selected
                      </button>
                      {isSuperAdmin && (
                        <button onClick={() => setBulkField('__delete__')}
                          className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-red-50 text-red-600 border-t border-gray-100 mt-1 pt-2">
                          Delete permanently
                        </button>
                      )}
                      {bulkField && bulkField !== '__delete__' && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="text-xs text-gray-500 mb-1">
                            {bulkField==='current_stage'?'Stage':bulkField==='job_id'?'Job':bulkField==='hr_owner'?'HR Owner':'Interviewer'}
                          </p>
                          <select autoFocus defaultValue="" onChange={e => { if(e.target.value) bulkUpdate.mutate({ field: bulkField, value: e.target.value }) }}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none">
                            <option value="" disabled>Choose…</option>
                            {bulkField==='current_stage' ? INTERVIEW_STAGES.map(s=><option key={s} value={s}>{s}</option>)
                              : bulkField==='job_id' ? (jobs as any[]).map(j=><option key={j.id} value={j.id}>{j.title}</option>)
                              : bulkField==='assigned_interviewers' ? (interviewers as any[]).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)
                              : (hrUsers as any[]).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)
                            }
                          </select>
                        </div>
                      )}
                      {bulkField === '__delete__' && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="text-xs text-red-600 mb-2 font-medium">Delete {selectedIds.size} permanently?</p>
                          <div className="flex gap-2">
                            <button onClick={() => setBulkField(null)} className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs text-gray-600">Cancel</button>
                            <button onClick={async () => {
                              const {supabase: sb} = await import('../../lib/supabaseClient')
                              await sb.from('candidates').delete().in('id', Array.from(selectedIds))
                              qc.invalidateQueries({queryKey:['candidates']}); setSelectedIds(new Set()); setBulkField(null); setShowBulkMenu(false)
                            }} className="flex-1 px-2 py-1.5 bg-red-600 hover:bg-red-700 rounded text-xs text-white font-medium">Delete All</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {canEdit && !showArchived && (
              <>
                <Button variant="secondary" size="sm" icon={<Upload className="w-3.5 h-3.5"/>} onClick={() => navigate('/upload')}>Upload</Button>
                <Button size="sm" icon={<UserPlus className="w-3.5 h-3.5"/>} onClick={() => navigate('/upload?mode=single')}>Add One</Button>
              </>
            )}
          </div>
        }
      />

      {/* ── Filter & Search bar ── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>

        {/* Airtable-style filter */}
        <div ref={filterRef} className="relative">
          <Button variant={activeFilters.length > 0 ? 'primary' : 'secondary'} size="sm"
            icon={<Filter className="w-3.5 h-3.5"/>}
            onClick={() => setShowFilterBar(!showFilterBar)}>
            {activeFilters.length > 0 ? `${activeFilters.length} filter${activeFilters.length > 1 ? 's' : ''}` : 'Filter'}
          </Button>
          {showFilterBar && (
            <div className="absolute left-0 top-full mt-1 z-50">
              <FilterBar filters={activeFilters} onChange={setActiveFilters} jobs={jobs as any[]}/>
            </div>
          )}
        </div>

        {/* Job quick filter */}
        <select value={filters.job_id ?? ''} onChange={e => setFilters(p => ({ ...p, job_id: e.target.value || undefined }))}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All jobs</option>
          {(jobs as any[]).map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>

        {isSuperAdmin && (
          <select onChange={e => setFilters(p => ({ ...p, hr_owner: e.target.value || undefined } as any))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All HR owners</option>
            {(hrUsers as any[]).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        )}

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setFilters({}); setSearch(''); setActiveFilters([]) }}>
            <X className="w-3.5 h-3.5"/> Clear all
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
      ) : displayed.length === 0 ? (
        <EmptyState title={showArchived ? 'No archived candidates' : 'No candidates found'}
          description={showArchived ? 'Archive candidates from the active list.' : 'Try clearing filters or upload candidates.'}
          action={canEdit && !showArchived ? <Button size="sm" onClick={() => navigate('/upload')}>Upload</Button> : undefined}/>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" checked={selectedIds.size === displayed.length && displayed.length > 0} onChange={toggleAll} className="rounded border-gray-300 text-blue-600 cursor-pointer"/>
                  </th>
                  <th className="text-left px-3 py-3 font-medium">Name</th>
                  {show('email') && <th className="text-left px-3 py-3 font-medium">Email</th>}
                  {show('phone') && <th className="text-left px-3 py-3 font-medium">Phone</th>}
                  {show('linkedin') && <th className="text-left px-3 py-3 font-medium">LinkedIn</th>}
                  {show('resume') && <th className="text-left px-3 py-3 font-medium">Resume</th>}
                  {show('stage') && <th className="text-left px-3 py-3 font-medium">Stage</th>}
                  {show('job') && <th className="text-left px-3 py-3 font-medium">Job</th>}
                  {show('source') && <th className="text-left px-3 py-3 font-medium">Source</th>}
                  {show('subsource') && <th className="text-left px-3 py-3 font-medium">Sub-Source</th>}
                  {show('hr_owner') && <th className="text-left px-3 py-3 font-medium">HR Owner</th>}
                  {show('interviewer') && <th className="text-left px-3 py-3 font-medium">Interviewer</th>}
                  {show('interview_date') && <th className="text-left px-3 py-3 font-medium">Interview Date</th>}
                  {show('notes') && <th className="text-left px-3 py-3 font-medium">Notes</th>}
                  {(customFields as any[]).filter(f => show(`cf_${f.field_name}`)).map(f => (
                    <th key={f.id} className="text-left px-3 py-3 font-medium">{f.field_label}</th>
                  ))}
                  <th className="px-3 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayed.map((c: any) => {
                  const isSelected = selectedIds.has(c.id)
                  const interviewerName = c.assigned_interviewers?.length > 0 ? getName(interviewers as any[], c.assigned_interviewers[0]) : null
                  return (
                    <tr key={c.id} className={`transition-colors ${isSelected ? 'bg-blue-50/60' : 'hover:bg-gray-50/60'} ${c.archived_at ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2.5 w-10">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(c.id)} className="rounded border-gray-300 text-blue-600 cursor-pointer"/>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button onClick={() => navigate(`/candidates/${c.id}`)} className="font-medium text-blue-600 hover:underline text-sm text-left">{c.full_name}</button>
                      </td>
                      {show('email') && <td className="px-3 py-2.5"><a href={`mailto:${c.email}`} className="text-gray-500 hover:text-blue-600 text-xs whitespace-nowrap">{c.email}</a></td>}
                      {show('phone') && <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{c.phone ?? '—'}</td>}
                      {show('linkedin') && <td className="px-3 py-2.5">{c.linkedin_url ? <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs"><ExternalLink className="w-3 h-3"/>View</a> : <span className="text-gray-300 text-xs">—</span>}</td>}
                      {show('resume') && <td className="px-3 py-2.5">{c.resume_url ? <a href={c.resume_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs"><FileText className="w-3 h-3"/>View</a> : <span className="text-gray-300 text-xs">—</span>}</td>}
                      {show('stage') && <td className="px-3 py-2.5 min-w-[130px]">
                        <StageCell candidateId={c.id} value={c.current_stage} canEdit={canEdit} onUpdate={onUpdate}/>
                      </td>}
                      {show('job') && <td className="px-3 py-2.5 min-w-[130px]">
                        <SelectCell candidateId={c.id} field="job_id" value={c.job_id} display={getName(jobs as any[], c.job_id)} canEdit={canAssign} onUpdate={onUpdate} options={(jobs as any[]).map(j => ({ label: j.title, value: j.id }))}/>
                      </td>}
                      {show('source') && <td className="px-3 py-2.5 min-w-[100px]">
                        <SelectCell candidateId={c.id} field="source_category" value={c.source_category} canEdit={canEdit} onUpdate={onUpdate} options={SOURCES.map(s => ({ label: s.charAt(0).toUpperCase()+s.slice(1), value: s }))}/>
                      </td>}
                      {show('subsource') && <td className="px-3 py-2.5 text-xs text-gray-600">{c.source_name}</td>}
                      {show('hr_owner') && <td className="px-3 py-2.5 min-w-[120px]">
                        <SelectCell candidateId={c.id} field="hr_owner" value={c.hr_owner} display={getName(hrUsers as any[], c.hr_owner)} canEdit={canAssign} onUpdate={onUpdate} options={(hrUsers as any[]).map(u => ({ label: u.full_name, value: u.id }))}/>
                      </td>}
                      {show('interviewer') && <td className="px-3 py-2.5 min-w-[120px]">
                        <SelectCell candidateId={c.id} field="assigned_interviewers" value={c.assigned_interviewers?.[0] ?? null} display={interviewerName} canEdit={canAssign} onUpdate={onUpdate} options={(interviewers as any[]).map(u => ({ label: u.full_name, value: u.id }))}/>
                      </td>}
                      {show('interview_date') && <td className="px-3 py-2.5 min-w-[110px]">
                        <DateCell candidateId={c.id} value={c.interview_date} canEdit={canEdit} onUpdate={onUpdate}/>
                      </td>}
                      {show('notes') && <td className="px-3 py-2.5 max-w-[140px]">{c.notes ? <p className="text-gray-500 text-xs truncate">{c.notes}</p> : <span className="text-gray-300 text-xs">—</span>}</td>}
                      {(customFields as any[]).filter(f => show(`cf_${f.field_name}`)).map(f => (
                        <td key={f.id} className="px-3 py-2.5 text-xs text-gray-600">{c.custom_data?.[f.field_name] ?? '—'}</td>
                      ))}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          {canAssign && (
                            <ActionBtn
                              label="Copy interview link"
                              colour="blue"
                              onClick={async () => { try { await createMagicLink.mutateAsync(c.id); alert('🔗 Interview link copied!') } catch { alert('Could not copy link') } }}>
                              🔗
                            </ActionBtn>
                          )}
                          <ActionBtn
                            label={c.archived_at ? 'Unarchive' : 'Archive'}
                            colour="amber"
                            onClick={() => archiveOne.mutate({ id: c.id, archive: !c.archived_at })}>
                            <Archive className="w-3.5 h-3.5"/>
                          </ActionBtn>
                          {isSuperAdmin && (
                            <ActionBtn label="Delete permanently" colour="red" onClick={() => setConfirmDelete(c.id)}>
                              <Trash2 className="w-3.5 h-3.5"/>
                            </ActionBtn>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-gray-50/50 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">Click Stage to change · Click Job/HR/Interviewer to assign · 🔗 Interview link · 📦 Archive · 🗑️ Delete</p>
            {selectedIds.size > 0 && <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><X className="w-3 h-3"/>Clear</button>}
          </div>
        </div>
      )}

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Candidate" size="sm">
        <p className="text-sm text-gray-600 mb-4">Permanently delete this candidate and all data? Consider archiving instead.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" loading={deleteOne.isPending} onClick={() => confirmDelete && deleteOne.mutate(confirmDelete)}>Delete Permanently</Button>
        </div>
      </Modal>
    </div>
  )
}

// ── Tooltip Action Button ─────────────────────────────────────
const COLOUR_MAP = {
  blue:  { base: 'text-gray-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50', tip: 'bg-blue-600' },
  amber: { base: 'text-gray-400 hover:text-amber-600 hover:border-amber-300 hover:bg-amber-50', tip: 'bg-amber-500' },
  red:   { base: 'text-gray-400 hover:text-red-600 hover:border-red-300 hover:bg-red-50', tip: 'bg-red-600' },
}

function ActionBtn({ label, colour, onClick, children }: {
  label: string; colour: 'blue' | 'amber' | 'red'; onClick: () => void; children: React.ReactNode
}) {
  const c = COLOUR_MAP[colour]
  return (
    <div className="relative group/btn">
      <button onClick={onClick}
        className={`p-1.5 rounded-lg border border-gray-200 transition-all ${c.base}`}>
        {children}
      </button>
      {/* Tooltip */}
      <div className={`absolute bottom-full right-0 mb-1.5 px-2 py-1 ${c.tip} text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg`}>
        {label}
        <div className={`absolute top-full right-2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent ${colour === 'blue' ? 'border-t-blue-600' : colour === 'amber' ? 'border-t-amber-500' : 'border-t-red-600'}`}/>
      </div>
    </div>
  )
}
