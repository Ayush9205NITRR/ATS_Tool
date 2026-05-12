// ============================================================
// CANDIDATES PAGE — Full featured table with inline editing
// Fixes: dropdown lag, HR Team view, AND/OR filters, tooltips
// ============================================================
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Upload, UserPlus, Loader2, ExternalLink, FileText,
  Eye, X, Archive, Trash2, Filter, ChevronDown, Check, Plus
} from 'lucide-react'
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

const STAGE_COLOURS: Record<string, string> = {
  Applied: 'bg-gray-100 text-gray-700',
  Screening: 'bg-blue-100 text-blue-700',
  R1: 'bg-indigo-100 text-indigo-700',
  'Case Study': 'bg-yellow-100 text-yellow-700',
  R2: 'bg-orange-100 text-orange-700',
  R3: 'bg-orange-200 text-orange-800',
  'CF (Virtual)': 'bg-purple-100 text-purple-700',
  'CF (In-Person)': 'bg-purple-200 text-purple-800',
  Offer: 'bg-violet-100 text-violet-700',
  Hired: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
}

const DEFAULT_COLS = new Set(['stage', 'job', 'source', 'subsource', 'hr_owner', 'interviewer', 'interview_date'])
const ALL_COLUMNS = [
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'resume', label: 'Resume' },
  { key: 'stage', label: 'Stage' },
  { key: 'job', label: 'Job' },
  { key: 'source', label: 'Source' },
  { key: 'subsource', label: 'Sub-Source' },
  { key: 'hr_owner', label: 'HR Owner' },
  { key: 'interviewer', label: 'Interviewer' },
  { key: 'interview_date', label: 'Interview Date' },
  { key: 'notes', label: 'Notes' },
]

// ── No-lag Popup Dropdown ─────────────────────────────────────
function PopupSelect({
  trigger, children, align = 'left'
}: { trigger: React.ReactNode; children: React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(o => !o)}>{trigger}</div>
      {open && (
        <div
          className={`absolute top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 min-w-[160px] max-h-64 overflow-y-auto ${align === 'right' ? 'right-0' : 'left-0'}`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ── Stage Cell ────────────────────────────────────────────────
function StageCell({ cid, value, canEdit, onUpdate }: { cid: string; value: string; canEdit: boolean; onUpdate: (id: string, f: string, v: any) => void }) {
  const pill = <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer select-none ${STAGE_COLOURS[value] ?? 'bg-gray-100 text-gray-700'}`}>
    {value}{canEdit && <ChevronDown className="w-3 h-3 opacity-60"/>}
  </span>

  if (!canEdit) return pill

  return (
    <PopupSelect trigger={pill}>
      {INTERVIEW_STAGES.map(s => (
        <button key={s} onClick={() => onUpdate(cid, 'current_stage', s)}
          className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center justify-between gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLOURS[s] ?? 'bg-gray-100 text-gray-700'}`}>{s}</span>
          {s === value && <Check className="w-3 h-3 text-blue-500 flex-shrink-0"/>}
        </button>
      ))}
    </PopupSelect>
  )
}

// ── Generic Select Cell ───────────────────────────────────────
function SelectCell({ cid, field, display, options, canEdit, onUpdate, placeholder = '—' }: {
  cid: string; field: string; display?: string | null
  options: { label: string; value: string }[]
  canEdit: boolean; onUpdate: (id: string, f: string, v: any) => void
  placeholder?: string
}) {
  const trigger = <button className="flex items-center gap-1 text-xs text-gray-700 hover:text-blue-600 transition-colors group max-w-[130px]">
    <span className="truncate">{display ?? <span className="text-gray-300">{placeholder}</span>}</span>
    {canEdit && <ChevronDown className="w-3 h-3 text-gray-300 group-hover:text-blue-400 flex-shrink-0"/>}
  </button>

  if (!canEdit) return <span className="text-xs text-gray-600">{display ?? '—'}</span>

  return (
    <PopupSelect trigger={trigger}>
      <button onClick={() => onUpdate(cid, field, null)}
        className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">— Clear —</button>
      {options.map(o => (
        <button key={o.value} onClick={() => onUpdate(cid, field, o.value)}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center justify-between gap-2">
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </PopupSelect>
  )
}

// ── Date Cell ─────────────────────────────────────────────────
function DateCell({ cid, value, canEdit, onUpdate }: { cid: string; value: string | null; canEdit: boolean; onUpdate: (id: string, f: string, v: any) => void }) {
  const [editing, setEditing] = useState(false)
  if (!canEdit) return <span className="text-xs text-gray-500">{value ? formatDate(value) : '—'}</span>
  if (editing) return (
    <input type="date" defaultValue={value ? value.split('T')[0] : ''} autoFocus
      onBlur={e => {
        // Save as full ISO string so it's in sync with datetime-local in profile
        const v = e.target.value ? new Date(e.target.value).toISOString() : null
        onUpdate(cid, 'interview_date', v)
        setEditing(false)
      }}
      className="w-28 px-2 py-0.5 border border-blue-400 rounded text-xs bg-white focus:outline-none"/>
  )
  return (
    <button onClick={() => setEditing(true)}
      className="text-xs text-gray-500 hover:text-blue-600 transition-colors whitespace-nowrap">
      {value ? formatDate(value) : <span className="text-gray-300">Set date</span>}
    </button>
  )
}

// ── Tooltip Button ────────────────────────────────────────────
function TipBtn({ onClick, colour, tip, children }: { onClick: () => void; colour: 'blue'|'amber'|'red'; tip: string; children: React.ReactNode }) {
  const colours = {
    blue:  { btn: 'hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50', tip: 'bg-blue-600 after:border-t-blue-600' },
    amber: { btn: 'hover:text-amber-600 hover:border-amber-300 hover:bg-amber-50', tip: 'bg-amber-500 after:border-t-amber-500' },
    red:   { btn: 'hover:text-red-600 hover:border-red-300 hover:bg-red-50', tip: 'bg-red-600 after:border-t-red-600' },
  }[colour]
  return (
    <div className="relative group/tip">
      <button onClick={onClick}
        className={`p-1.5 rounded-lg border border-gray-200 text-gray-400 transition-all ${colours.btn}`}>
        {children}
      </button>
      <div className={`absolute bottom-full right-0 mb-2 px-2 py-1 ${colours.tip.split(' ')[0]} text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover/tip:opacity-100 pointer-events-none z-50 transition-opacity`}>
        {tip}
        <div className="absolute top-full right-2 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-current"/>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export function CandidatesPage() {
  const navigate = useNavigate()
  const { hasRole, user } = useAuthStore()
  const qc = useQueryClient()
  const canEdit      = hasRole(['admin', 'super_admin', 'hr_team'])
  const canAssign    = hasRole(['admin', 'super_admin'])
  const canAssignHR  = hasRole(['admin', 'super_admin'])  // HR Team cannot change hr_owner
  const isSuperAdmin = hasRole(['super_admin'])

  const [filters, setFilters]         = useState<CandidateFilters>({})
  const [search, setSearch]           = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [showColPicker, setShowColPicker] = useState(false)
  const [showBulkMenu, setShowBulkMenu]   = useState(false)
  const [showFilterBar, setShowFilterBar] = useState(false)
  const [bulkField, setBulkField]         = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [filterMode, setFilterMode]       = useState<'and' | 'or'>('and')
  const [visibleCols, setVisibleCols]     = useState<Set<string>>(DEFAULT_COLS)
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilterBar(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'filter'],
    queryFn: async () => { const { data } = await supabase.from('jobs').select('id,title').order('title'); return data ?? [] },
  })
  const { data: hrUsers = [] } = useQuery({
    queryKey: ['users', 'hr'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name')
        .in('role', ['hr_team', 'admin', 'super_admin']).eq('is_active', true)
      return data ?? []
    },
  })
  const { data: interviewers = [] } = useQuery({
    queryKey: ['users', 'interviewers'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name')
        .eq('role', 'interviewer').eq('is_active', true)
      return data ?? []
    },
  })
  const { data: customFields = [] } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => { const { data } = await supabase.from('custom_fields').select('*').eq('is_active', true).order('sort_order'); return data ?? [] },
  })

  const { data: candidates = [], isLoading } = useCandidates({ ...filters, search: search || undefined })

  // Apply client-side filters with AND/OR mode
  const displayed = useMemo(() => {
    let list = candidates.filter((c: any) => showArchived ? !!c.archived_at : !c.archived_at)
    if (!activeFilters.length) return list
    return applyFilters(list, activeFilters, jobs as any[], interviewers as any[], filterMode)
  }, [candidates, showArchived, activeFilters, jobs, interviewers, filterMode])

  const updateField = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      // assigned_interviewers is always an array
      const payload = { [field]: value }
      const { error } = await supabase.from('candidates').update(payload).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['candidates'] }),
  })

  const archiveOne = useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      const { error } = await supabase.from('candidates').update({
        archived_at: archive ? new Date().toISOString() : null,
        archived_by: archive ? user!.id : null,
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['candidates'] }); setSelectedIds(new Set()) },
  })

  const deleteOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('candidates').delete().eq('id', id)
      if (error) throw error
    },
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
      const { error } = await supabase.from('candidates').update({
        archived_at: archive ? new Date().toISOString() : null,
        archived_by: archive ? user!.id : null,
      }).in('id', Array.from(selectedIds))
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['candidates'] }); setSelectedIds(new Set()) },
  })

  const onUpdate = useCallback((id: string, field: string, value: any) => updateField.mutate({ id, field, value }), [])
  const toggleCol = (key: string) => setVisibleCols(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleSel = (id: string) => setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelectedIds(selectedIds.size === displayed.length ? new Set() : new Set(displayed.map((c: any) => c.id)))
  const getName = (list: any[], id: string | null) => { if (!id) return null; const i = list.find(u => u.id === id); return i?.full_name ?? i?.title ?? null }
  const show = (key: string) => visibleCols.has(key)

  const colCols = [...ALL_COLUMNS, ...(customFields as any[]).map(f => ({ key: `cf_${f.field_name}`, label: f.field_label }))]

  return (
    <div>
      <PageHeader
        title={showArchived ? 'Archived' : 'Candidates'}
        subtitle={`${displayed.length}${candidates.length !== displayed.length ? ` of ${(candidates as any[]).filter((c:any) => showArchived ? !!c.archived_at : !c.archived_at).length}` : ''} total${selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ''}`}
        action={
          <div className="flex gap-2 flex-wrap justify-end">
            <Button variant={showArchived ? 'primary' : 'secondary'} size="sm"
              icon={<Archive className="w-3.5 h-3.5"/>}
              onClick={() => { setShowArchived(a => !a); setSelectedIds(new Set()) }}>
              {showArchived ? 'Active' : 'Archived'}
            </Button>

            {/* Column picker */}
            <div className="relative">
              <Button variant="secondary" size="sm" icon={<Eye className="w-3.5 h-3.5"/>}
                onClick={() => setShowColPicker(o => !o)}>Columns</Button>
              {showColPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowColPicker(false)}/>
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3 w-44 max-h-72 overflow-y-auto">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Show / Hide</p>
                    {colCols.map(col => (
                      <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer">
                        <input type="checkbox" checked={visibleCols.has(col.key)} onChange={() => toggleCol(col.key)}
                          className="rounded border-gray-300 text-blue-600"/>
                        <span className="text-sm text-gray-700">{col.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Bulk actions */}
            {selectedIds.size > 0 && (
              <div className="relative">
                <Button size="sm" onClick={() => setShowBulkMenu(o => !o)}>Bulk ({selectedIds.size}) ▾</Button>
                {showBulkMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => { setShowBulkMenu(false); setBulkField(null) }}/>
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3 w-56">
                      <p className="text-xs font-semibold text-gray-500 mb-2">Bulk Actions</p>
                      {[
                        ['current_stage', 'Change Stage'],
                        ['job_id', 'Assign Job'],
                        ...(canAssignHR ? [['hr_owner', 'Assign HR Owner']] : []),
                        ['assigned_interviewers', 'Assign Interviewer'],
                      ].map(([f, label]) => (
                        <button key={f} onClick={() => setBulkField(f)}
                          className={`w-full text-left text-sm px-2 py-1.5 rounded transition-colors ${bulkField === f ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}>
                          {label}
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
                            {bulkField === 'current_stage' ? 'Stage' : bulkField === 'job_id' ? 'Job' : bulkField === 'hr_owner' ? 'HR Owner' : 'Interviewer'}
                          </p>
                          <select autoFocus defaultValue=""
                            onChange={e => { if (e.target.value) bulkUpdate.mutate({ field: bulkField, value: e.target.value }) }}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none">
                            <option value="" disabled>Choose…</option>
                            {bulkField === 'current_stage'
                              ? INTERVIEW_STAGES.map(s => <option key={s} value={s}>{s}</option>)
                              : bulkField === 'job_id'
                              ? (jobs as any[]).map(j => <option key={j.id} value={j.id}>{j.title}</option>)
                              : bulkField === 'assigned_interviewers'
                              ? (interviewers as any[]).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)
                              : (hrUsers as any[]).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)
                            }
                          </select>
                        </div>
                      )}
                      {bulkField === '__delete__' && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="text-xs text-red-600 mb-2 font-medium">Delete {selectedIds.size} permanently?</p>
                          <div className="flex gap-2">
                            <button onClick={() => setBulkField(null)}
                              className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs text-gray-600">Cancel</button>
                            <button onClick={async () => {
                              await supabase.from('candidates').delete().in('id', Array.from(selectedIds))
                              qc.invalidateQueries({ queryKey: ['candidates'] })
                              setSelectedIds(new Set()); setBulkField(null); setShowBulkMenu(false)
                            }} className="flex-1 px-2 py-1.5 bg-red-600 rounded text-xs text-white font-medium">Delete All</button>
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

      {/* Filter + Search bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>

        {/* Airtable filter */}
        <div ref={filterRef} className="relative">
          <Button variant={activeFilters.length > 0 ? 'primary' : 'secondary'} size="sm"
            icon={<Filter className="w-3.5 h-3.5"/>}
            onClick={() => setShowFilterBar(o => !o)}>
            {activeFilters.length > 0 ? `${activeFilters.length} filter${activeFilters.length > 1 ? 's' : ''}` : 'Filter'}
          </Button>
          {showFilterBar && (
            <div className="absolute left-0 top-full mt-1 z-50">
              <FilterBar
                filters={activeFilters}
                onChange={setActiveFilters}
                jobs={jobs as any[]}
                interviewers={interviewers as any[]}
                mode={filterMode}
                onModeChange={setFilterMode}
              />
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

        {(activeFilters.length > 0 || search || filters.job_id || (filters as any).hr_owner) && (
          <Button variant="ghost" size="sm" icon={<X className="w-3.5 h-3.5"/>}
            onClick={() => { setFilters({}); setSearch(''); setActiveFilters([]) }}>
            Clear all
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
      ) : displayed.length === 0 ? (
        <EmptyState
          title={showArchived ? 'No archived candidates' : activeFilters.length ? 'No matches' : 'No candidates'}
          description={showArchived ? 'Archive from active list.' : activeFilters.length ? 'Try clearing filters.' : 'Upload your first candidate.'}
          action={canEdit && !showArchived && !activeFilters.length ? <Button size="sm" onClick={() => navigate('/upload')}>Upload</Button> : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox"
                      checked={selectedIds.size === displayed.length && displayed.length > 0}
                      onChange={toggleAll}
                      className="rounded border-gray-300 text-blue-600 cursor-pointer"/>
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
                  <th className="px-3 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayed.map((c: any) => {
                  const isSel = selectedIds.has(c.id)
                  const interviewerNames = (c.assigned_interviewers ?? [])
                    .map((id: string) => getName(interviewers as any[], id))
                    .filter(Boolean).join(', ')
                  return (
                    <tr key={c.id} className={`transition-colors ${isSel ? 'bg-blue-50/50' : 'hover:bg-gray-50/40'} ${c.archived_at ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2.5 w-10">
                        <input type="checkbox" checked={isSel} onChange={() => toggleSel(c.id)}
                          className="rounded border-gray-300 text-blue-600 cursor-pointer"/>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button onClick={() => navigate(`/candidates/${c.id}`)}
                          className="font-medium text-blue-600 hover:underline text-sm text-left">{c.full_name}</button>
                      </td>
                      {show('email') && <td className="px-3 py-2.5">
                        <a href={`mailto:${c.email}`} className="text-gray-500 hover:text-blue-600 text-xs">{c.email}</a>
                      </td>}
                      {show('phone') && <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{c.phone ?? '—'}</td>}
                      {show('linkedin') && <td className="px-3 py-2.5">
                        {c.linkedin_url
                          ? <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs"><ExternalLink className="w-3 h-3"/>View</a>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>}
                      {show('resume') && <td className="px-3 py-2.5">
                        {c.resume_url
                          ? <a href={c.resume_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs"><FileText className="w-3 h-3"/>View</a>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>}
                      {show('stage') && <td className="px-3 py-2.5 min-w-[120px]">
                        <StageCell cid={c.id} value={c.current_stage} canEdit={canEdit} onUpdate={onUpdate}/>
                      </td>}
                      {show('job') && <td className="px-3 py-2.5 min-w-[130px]">
                        <SelectCell cid={c.id} field="job_id"
                          display={getName(jobs as any[], c.job_id)}
                          canEdit={canAssign} onUpdate={onUpdate}
                          options={(jobs as any[]).map(j => ({ label: j.title, value: j.id }))}/>
                      </td>}
                      {show('source') && <td className="px-3 py-2.5 min-w-[100px]">
                        <SelectCell cid={c.id} field="source_category" display={c.source_category}
                          canEdit={canEdit} onUpdate={onUpdate}
                          options={SOURCES.map(s => ({ label: s.charAt(0).toUpperCase() + s.slice(1), value: s }))}/>
                      </td>}
                      {show('subsource') && <td className="px-3 py-2.5 text-xs text-gray-600">{c.source_name}</td>}
                      {show('hr_owner') && <td className="px-3 py-2.5 min-w-[120px]">
                        {/* HR Team can VIEW but not change hr_owner */}
                        <SelectCell cid={c.id} field="hr_owner"
                          display={getName(hrUsers as any[], c.hr_owner)}
                          canEdit={canAssignHR}
                          onUpdate={onUpdate}
                          options={(hrUsers as any[]).map(u => ({ label: u.full_name, value: u.id }))}/>
                      </td>}
                      {show('interviewer') && <td className="px-3 py-2.5 min-w-[140px]">
                        {/* Multi-select: shows all assigned, click to toggle */}
                        <SelectCell cid={c.id} field="assigned_interviewers"
                          display={interviewerNames || null}
                          canEdit={canEdit}
                          onUpdate={(id, _, v) => {
                            const curr: string[] = c.assigned_interviewers ?? []
                            const next = curr.includes(v) ? curr.filter((i: string) => i !== v) : [...curr, v]
                            onUpdate(id, 'assigned_interviewers', next)
                          }}
                          options={(interviewers as any[]).map(u => ({ label: u.full_name, value: u.id }))}/>
                      </td>}
                      {show('interview_date') && <td className="px-3 py-2.5 min-w-[110px]">
                        {/* Reads ISO timestamp, displays formatted */}
                        <DateCell cid={c.id} value={c.interview_date} canEdit={canEdit} onUpdate={onUpdate}/>
                      </td>}
                      {show('notes') && <td className="px-3 py-2.5 max-w-[140px]">
                        {c.notes ? <p className="text-gray-500 text-xs truncate">{c.notes}</p> : <span className="text-gray-300 text-xs">—</span>}
                      </td>}
                      {(customFields as any[]).filter(f => show(`cf_${f.field_name}`)).map(f => (
                        <td key={f.id} className="px-3 py-2.5 text-xs text-gray-600">{c.custom_data?.[f.field_name] ?? '—'}</td>
                      ))}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          <TipBtn colour="amber" tip={c.archived_at ? 'Unarchive' : 'Archive'}
                            onClick={() => archiveOne.mutate({ id: c.id, archive: !c.archived_at })}>
                            <Archive className="w-3.5 h-3.5"/>
                          </TipBtn>
                          {isSuperAdmin && (
                            <TipBtn colour="red" tip="Delete permanently" onClick={() => setConfirmDelete(c.id)}>
                              <Trash2 className="w-3.5 h-3.5"/>
                            </TipBtn>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">Click Stage to change · Click Job / HR / Interviewer to assign · Hover for actions</p>
            {selectedIds.size > 0 && (
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                <X className="w-3 h-3"/> Clear
              </button>
            )}
          </div>
        </div>
      )}

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Candidate" size="sm">
        <p className="text-sm text-gray-600 mb-4">Permanently delete this candidate? Consider archiving instead.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" loading={deleteOne.isPending}
            onClick={() => confirmDelete && deleteOne.mutate(confirmDelete)}>Delete</Button>
        </div>
      </Modal>
    </div>
  )
}
