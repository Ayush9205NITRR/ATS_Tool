// ============================================================
// CANDIDATES PAGE — Optimized, Group By, Column Management
// ============================================================
import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Upload, UserPlus, Loader2, ExternalLink, FileText,
  Eye, X, Archive, Trash2, Filter, ChevronDown, Check, Plus,
  Layers, GripVertical, Pin
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSortable, SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
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
import { formatDate, formatDateTime } from '../../shared/utils/helpers'

const SOURCES: SourceCategory[] = ['platform', 'agency', 'college']

const STAGE_COLOURS: Record<string, string> = {
  Applied:'bg-gray-100 text-gray-700', Screening:'bg-blue-100 text-blue-700',
  R1:'bg-indigo-100 text-indigo-700', 'Case Study':'bg-yellow-100 text-yellow-700',
  R2:'bg-orange-100 text-orange-700', R3:'bg-orange-200 text-orange-800',
  'CF (Virtual)':'bg-purple-100 text-purple-700', 'CF (In-Person)':'bg-purple-200 text-purple-800',
  Offer:'bg-violet-100 text-violet-700', Hired:'bg-green-100 text-green-700',
  Rejected:'bg-red-100 text-red-700',
}

const STAGE_COLOR_BAR: Record<string, string> = {
  Applied:'bg-gray-300', Screening:'bg-blue-400', R1:'bg-indigo-400',
  'Case Study':'bg-yellow-400', R2:'bg-orange-400', R3:'bg-orange-500',
  'CF (Virtual)':'bg-purple-400', 'CF (In-Person)':'bg-purple-500',
  Offer:'bg-violet-500', Hired:'bg-green-500', Rejected:'bg-red-400',
}

// ── Column definitions ─────────────────────────────────────────
const STATIC_COLS = [
  { key: 'name',           label: 'Name',           frozen: true,  width: 180 },
  { key: 'stage',          label: 'Stage',           frozen: false, width: 140 },
  { key: 'job',            label: 'Job',             frozen: false, width: 160 },
  { key: 'source',         label: 'Source',          frozen: false, width: 110 },
  { key: 'subsource',      label: 'Sub-Source',      frozen: false, width: 140 },
  { key: 'hr_owner',       label: 'HR Owner',        frozen: false, width: 130 },
  { key: 'interviewer',    label: 'Interviewer',     frozen: false, width: 160 },
  { key: 'interview_date', label: 'Interview Date',  frozen: false, width: 170 },
  { key: 'updated_at',     label: 'Updated',         frozen: false, width: 120 },
  { key: 'email',          label: 'Email',           frozen: false, width: 180 },
  { key: 'phone',          label: 'Phone',           frozen: false, width: 130 },
  { key: 'linkedin',       label: 'LinkedIn',        frozen: false, width: 90  },
  { key: 'resume',         label: 'Resume',          frozen: false, width: 90  },
  { key: 'notes',          label: 'Notes',           frozen: false, width: 150 },
]

const DEFAULT_VISIBLE = new Set(['name','stage','job','source','subsource','hr_owner','interviewer','interview_date'])
const DEFAULT_ORDER   = STATIC_COLS.map(c => c.key)

// ── Popup Select (no lag) ─────────────────────────────────────
function PopupSelect({ trigger, children, align = 'left' }: {
  trigger: React.ReactNode; children: React.ReactNode; align?: 'left'|'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])
  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(o => !o)}>{trigger}</div>
      {open && (
        <div className={`absolute top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 min-w-[160px] max-h-64 overflow-y-auto ${align==='right'?'right-0':'left-0'}`}
          onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Stage Cell ────────────────────────────────────────────────
const StageCell = memo(({ cid, value, canEdit, onUpdate }: {
  cid: string; value: string; canEdit: boolean; onUpdate: (id: string, f: string, v: any) => void
}) => {
  const pill = (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${canEdit ? 'cursor-pointer' : ''} ${STAGE_COLOURS[value] ?? 'bg-gray-100 text-gray-700'}`}>
      {value}{canEdit && <ChevronDown className="w-2.5 h-2.5 opacity-50"/>}
    </span>
  )
  if (!canEdit) return pill
  return (
    <PopupSelect trigger={pill}>
      {INTERVIEW_STAGES.map(s => (
        <button key={s} onClick={() => onUpdate(cid,'current_stage',s)}
          className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center justify-between gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLOURS[s]??'bg-gray-100'}`}>{s}</span>
          {s===value && <Check className="w-3 h-3 text-blue-500 flex-shrink-0"/>}
        </button>
      ))}
    </PopupSelect>
  )
})

// ── Select Cell ───────────────────────────────────────────────
const SelectCell = memo(({ cid, field, display, options, canEdit, onUpdate }: {
  cid: string; field: string; display?: string|null
  options: {label:string;value:string}[]
  canEdit: boolean; onUpdate: (id:string,f:string,v:any)=>void
}) => {
  const trigger = (
    <button className="flex items-center gap-1 text-xs text-gray-700 hover:text-blue-600 transition-colors group max-w-[130px]">
      <span className="truncate">{display ?? <span className="text-gray-300">—</span>}</span>
      {canEdit && <ChevronDown className="w-2.5 h-2.5 text-gray-300 group-hover:text-blue-400 flex-shrink-0"/>}
    </button>
  )
  if (!canEdit) return <span className="text-xs text-gray-600">{display??'—'}</span>
  return (
    <PopupSelect trigger={trigger}>
      <button onClick={()=>onUpdate(cid,field,null)} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">— Clear —</button>
      {options.map(o=>(
        <button key={o.value} onClick={()=>onUpdate(cid,field,o.value)}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 truncate">{o.label}</button>
      ))}
    </PopupSelect>
  )
})

// ── Multi-Select Cell ─────────────────────────────────────────
const MultiSelectCell = memo(({ cid, field, selectedIds, options, canEdit, onUpdate }: {
  cid: string; field: string; selectedIds: string[]
  options: {label:string;value:string}[]
  canEdit: boolean; onUpdate: (id:string,f:string,v:string[])=>void
}) => {
  const display = selectedIds.length > 0
    ? options.filter(o=>selectedIds.includes(o.value)).map(o=>o.label).join(', ')
    : null
  const trigger = (
    <button className="flex items-center gap-1 text-xs text-gray-700 hover:text-blue-600 transition-colors group max-w-[150px]">
      <span className="truncate">{display ?? <span className="text-gray-300">—</span>}</span>
      {canEdit && <ChevronDown className="w-2.5 h-2.5 text-gray-300 group-hover:text-blue-400 flex-shrink-0"/>}
    </button>
  )
  if (!canEdit) return <span className="text-xs text-gray-600">{display??'—'}</span>
  return (
    <PopupSelect trigger={trigger}>
      <p className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-50">Select multiple</p>
      {options.map(o=>{
        const sel = selectedIds.includes(o.value)
        return (
          <button key={o.value}
            onClick={(e)=>{e.stopPropagation(); const next=sel?selectedIds.filter(i=>i!==o.value):[...selectedIds,o.value]; onUpdate(cid,field,next)}}
            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center justify-between gap-2 ${sel?'text-blue-700 font-medium':'text-gray-700'}`}>
            <span className="truncate">{o.label}</span>
            {sel && <Check className="w-3 h-3 text-blue-500 flex-shrink-0"/>}
          </button>
        )
      })}
      {selectedIds.length>0&&<button onClick={()=>onUpdate(cid,field,[])} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-red-50 hover:text-red-500 border-t border-gray-50">Clear all</button>}
    </PopupSelect>
  )
})

// ── Date Cell ─────────────────────────────────────────────────
const DateCell = memo(({ cid, value, canEdit, onUpdate }: {
  cid: string; value: string|null; canEdit: boolean; onUpdate: (id:string,f:string,v:any)=>void
}) => {
  const [editing, setEditing] = useState(false)
  const display = value ? formatDateTime(value) : null
  if (!canEdit) return <span className="text-xs text-gray-500">{display??'—'}</span>
  if (editing) return (
    <input type="datetime-local" defaultValue={value?value.replace(' ','T').slice(0,16):''} autoFocus
      onBlur={e=>{onUpdate(cid,'interview_date',e.target.value?new Date(e.target.value).toISOString():null);setEditing(false)}}
      className="w-44 px-2 py-0.5 border border-blue-400 rounded text-xs bg-white focus:outline-none"/>
  )
  return (
    <button onClick={()=>setEditing(true)} className="text-xs text-gray-500 hover:text-blue-600 transition-colors whitespace-nowrap">
      {display ?? <span className="text-gray-300">Set date</span>}
    </button>
  )
})

// ── Tooltip Button ────────────────────────────────────────────
function TipBtn({ onClick, colour, tip, children }: {
  onClick:()=>void; colour:'blue'|'amber'|'red'; tip:string; children:React.ReactNode
}) {
  const c = {
    blue:  'hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50',
    amber: 'hover:text-amber-600 hover:border-amber-300 hover:bg-amber-50',
    red:   'hover:text-red-600 hover:border-red-300 hover:bg-red-50',
  }[colour]
  return (
    <div className="relative group/tip">
      <button onClick={onClick} className={`p-1.5 rounded-lg border border-gray-200 text-gray-400 transition-all ${c}`}>{children}</button>
      <div className="absolute bottom-full right-0 mb-1.5 px-2 py-1 bg-gray-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover/tip:opacity-100 pointer-events-none z-50 transition-opacity">
        {tip}
      </div>
    </div>
  )
}

// ── Sortable Column Header ─────────────────────────────────────
function SortableColHeader({ id, label, frozen, onFreeze }: {
  id: string; label: string; frozen: boolean; onFreeze: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <th ref={setNodeRef} style={style}
      className={`text-left px-3 py-3 font-medium text-xs text-gray-500 uppercase tracking-wide whitespace-nowrap select-none ${frozen ? 'bg-blue-50/40' : ''}`}>
      <div className="flex items-center gap-1.5 group/col">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex-shrink-0">
          <GripVertical className="w-3 h-3"/>
        </div>
        <span>{label}</span>
        <button onClick={() => onFreeze(id)}
          className={`opacity-0 group-hover/col:opacity-100 transition-opacity flex-shrink-0 ${frozen ? 'text-blue-500' : 'text-gray-300 hover:text-blue-400'}`}
          title={frozen ? 'Unpin column' : 'Pin column'}>
          <Pin className="w-3 h-3"/>
        </button>
      </div>
    </th>
  )
}

// ── Group By Header Row ───────────────────────────────────────
function GroupHeader({ label, count, colour }: { label: string; count: number; colour?: string }) {
  return (
    <tr>
      <td colSpan={99} className="px-3 py-2 bg-gray-50 border-y border-gray-100">
        <div className="flex items-center gap-2">
          {colour && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colour}`}/>}
          <span className="text-xs font-semibold text-gray-600">{label}</span>
          <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 py-0.5">{count}</span>
        </div>
      </td>
    </tr>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export function CandidatesPage() {
  const navigate = useNavigate()
  const { hasRole, user } = useAuthStore()
  const qc = useQueryClient()
  const canEdit     = hasRole(['admin','super_admin','hr_team'])
  const canAssign   = hasRole(['admin','super_admin'])
  const canAssignHR = hasRole(['admin','super_admin'])
  const isSuperAdmin = hasRole(['super_admin'])

  // ── Filter state ──────────────────────────────────────────
  const [filters, setFilters]         = useState<CandidateFilters>({})
  const [search, setSearch]           = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [filterMode, setFilterMode]       = useState<'and'|'or'>('and')
  const [showFilterBar, setShowFilterBar] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  // ── Column state ──────────────────────────────────────────
  const [colOrder, setColOrder]     = useState<string[]>(DEFAULT_ORDER)
  const [visibleCols, setVisibleCols] = useState<Set<string>>(DEFAULT_VISIBLE)
  const [frozenCols, setFrozenCols]   = useState<Set<string>>(new Set(['name']))
  const [showColPicker, setShowColPicker] = useState(false)

  // ── Group By ──────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState<string>('')

  // ── Bulk ─────────────────────────────────────────────────
  const [showBulkMenu, setShowBulkMenu] = useState(false)
  const [bulkField, setBulkField]       = useState<string|null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string|null>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilterBar(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  // ── Data ─────────────────────────────────────────────────
  const { data: jobs = [] } = useQuery({ queryKey:['jobs','filter'], queryFn: async()=>{const{data}=await supabase.from('jobs').select('id,title').order('title');return data??[]} })
  const { data: hrUsers = [] } = useQuery({ queryKey:['users','hr'], queryFn: async()=>{const{data}=await supabase.from('users').select('id,full_name').in('role',['hr_team','admin','super_admin']).eq('is_active',true);return data??[]} })
  const { data: interviewers = [] } = useQuery({ queryKey:['users','interviewers'], queryFn: async()=>{const{data}=await supabase.from('users').select('id,full_name').eq('role','interviewer').eq('is_active',true);return data??[]} })
  const { data: customFields = [] } = useQuery({ queryKey:['custom-fields'], queryFn: async()=>{const{data}=await supabase.from('custom_fields').select('*').eq('is_active',true).order('sort_order');return data??[]} })

  const { data: candidates = [], isLoading } = useCandidates({ ...filters, search: search||undefined })

  // ── Computed columns list ──────────────────────────────────
  const allCols = useMemo(() => [
    ...STATIC_COLS,
    ...(customFields as any[]).map(f => ({ key:`cf_${f.field_name}`, label:f.field_label, frozen:false, width:130 }))
  ], [customFields])

  const orderedVisible = useMemo(() => {
    const keys = [...colOrder, ...(customFields as any[]).map((f:any)=>`cf_${f.field_name}`)].filter(k => visibleCols.has(k))
    const frozen = keys.filter(k => frozenCols.has(k))
    const unfrozen = keys.filter(k => !frozenCols.has(k))
    return [...frozen, ...unfrozen]
  }, [colOrder, visibleCols, frozenCols, customFields])

  // ── Filtered + grouped ────────────────────────────────────
  const displayed = useMemo(() => {
    let list = candidates.filter((c:any) => showArchived ? !!c.archived_at : !c.archived_at)
    if (activeFilters.length) list = applyFilters(list, activeFilters, jobs as any[], interviewers as any[], filterMode, customFields as any[])
    return list
  }, [candidates, showArchived, activeFilters, jobs, interviewers, filterMode, customFields])

  const grouped = useMemo(() => {
    if (!groupBy) return [{ key: '', label: '', items: displayed }]
    const map = new Map<string, any[]>()
    displayed.forEach((c:any) => {
      let key = ''
      if (groupBy === 'current_stage') key = c.current_stage ?? 'Unknown'
      else if (groupBy === 'job_id') key = c.job?.title ?? 'No Job'
      else if (groupBy === 'source_category') key = c.source_category ?? 'Unknown'
      else if (groupBy === 'hr_owner') key = (hrUsers as any[]).find(u=>u.id===c.hr_owner)?.full_name ?? 'Unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    })
    return Array.from(map.entries())
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([key, items]) => ({ key, label: key, items }))
  }, [displayed, groupBy, hrUsers])

  // ── Mutations ────────────────────────────────────────────
  const updateField = useMutation({
    mutationFn: async({id,field,value}:{id:string;field:string;value:any})=>{
      const{error}=await supabase.from('candidates').update({[field]:value}).eq('id',id)
      if(error){console.error('[updateField]',error);throw error}
    },
    onSuccess: ()=>qc.invalidateQueries({queryKey:['candidates']}),
  })

  const archiveOne = useMutation({
    mutationFn: async({id,archive}:{id:string;archive:boolean})=>{
      const{error}=await supabase.from('candidates').update({archived_at:archive?new Date().toISOString():null,archived_by:archive?user!.id:null}).eq('id',id)
      if(error)throw error
    },
    onSuccess:()=>{qc.invalidateQueries({queryKey:['candidates']});setSelectedIds(new Set())},
  })

  const deleteOne = useMutation({
    mutationFn: async(id:string)=>{const{error}=await supabase.from('candidates').delete().eq('id',id);if(error)throw error},
    onSuccess:()=>{qc.invalidateQueries({queryKey:['candidates']});setConfirmDelete(null)},
  })

  const bulkUpdate = useMutation({
    mutationFn: async({field,value}:{field:string;value:any})=>{
      const ids = Array.from(selectedIds)
      const isArr = ['assigned_interviewers','assigned_hr_owners'].includes(field)
      const payload = isArr ? {[field]:Array.isArray(value)?value:[value]} : {[field]:value}
      const{error}=await supabase.from('candidates').update(payload).in('id',ids)
      if(error){console.error('[bulkUpdate]',error);throw error}
    },
    onSuccess:()=>{qc.invalidateQueries({queryKey:['candidates']});setSelectedIds(new Set());setBulkField(null);setShowBulkMenu(false)},
  })

  const bulkArchive = useMutation({
    mutationFn: async(archive:boolean)=>{
      const{error}=await supabase.from('candidates').update({archived_at:archive?new Date().toISOString():null,archived_by:archive?user!.id:null}).in('id',Array.from(selectedIds))
      if(error)throw error
    },
    onSuccess:()=>{qc.invalidateQueries({queryKey:['candidates']});setSelectedIds(new Set())},
  })

  // ── Handlers (memoized) ───────────────────────────────────
  const onUpdate = useCallback((id:string,field:string,value:any)=>updateField.mutate({id,field,value}),[updateField])
  const toggleSel = useCallback((id:string)=>setSelectedIds(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n}),[])
  const toggleAll = useCallback(()=>setSelectedIds(s=>s.size===displayed.length?new Set():new Set(displayed.map((c:any)=>c.id))),[displayed])
  const getName = useCallback((list:any[],id:string|null)=>{if(!id)return null;const i=list.find(u=>u.id===id);return i?.full_name??i?.title??null},[])
  const show = useCallback((key:string)=>visibleCols.has(key),[visibleCols])
  const toggleFreeze = useCallback((key:string)=>setFrozenCols(p=>{const n=new Set(p);n.has(key)?n.delete(key):n.add(key);return n}),[])

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setColOrder(prev => {
        const ai = prev.indexOf(active.id as string)
        const oi = prev.indexOf(over.id as string)
        return arrayMove(prev, ai, oi)
      })
    }
  }, [])

  const GROUP_BY_OPTIONS = [
    { value: '', label: 'No grouping' },
    { value: 'current_stage',   label: 'Stage' },
    { value: 'job_id',          label: 'Job' },
    { value: 'source_category', label: 'Source' },
    { value: 'hr_owner',        label: 'HR Owner' },
  ]

  const colCols = useMemo(() => [...allCols.filter(c=>c.key!=='name')],[allCols])

  return (
    <div>
      <PageHeader
        title={showArchived ? 'Archived' : 'Candidates'}
        subtitle={`${displayed.length} total${selectedIds.size>0?` · ${selectedIds.size} selected`:''}`}
        action={
          <div className="flex gap-2 flex-wrap justify-end">
            <Button variant={showArchived?'primary':'secondary'} size="sm" icon={<Archive className="w-3.5 h-3.5"/>}
              onClick={()=>{setShowArchived(a=>!a);setSelectedIds(new Set())}}>
              {showArchived?'Active':'Archived'}
            </Button>

            {/* Column picker */}
            <div className="relative">
              <Button variant="secondary" size="sm" icon={<Eye className="w-3.5 h-3.5"/>}
                onClick={()=>setShowColPicker(o=>!o)}>Columns</Button>
              {showColPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={()=>setShowColPicker(false)}/>
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3 w-48 max-h-72 overflow-y-auto">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Show / Hide</p>
                    {colCols.map(col=>(
                      <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer hover:text-blue-600">
                        <input type="checkbox" checked={visibleCols.has(col.key)}
                          onChange={()=>setVisibleCols(p=>{const n=new Set(p);n.has(col.key)?n.delete(col.key):n.add(col.key);return n})}
                          className="rounded border-gray-300 text-blue-600"/>
                        <span className="text-sm text-gray-700">{col.label}</span>
                        {frozenCols.has(col.key) && <Pin className="w-3 h-3 text-blue-400 ml-auto"/>}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Group By */}
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white">
              <Layers className="w-3.5 h-3.5 text-gray-400"/>
              <select value={groupBy} onChange={e=>setGroupBy(e.target.value)}
                className="text-sm bg-transparent border-none outline-none text-gray-700 pr-1">
                {GROUP_BY_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Bulk */}
            {selectedIds.size > 0 && (
              <div className="relative">
                <Button size="sm" onClick={()=>setShowBulkMenu(o=>!o)}>Bulk ({selectedIds.size}) ▾</Button>
                {showBulkMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={()=>{setShowBulkMenu(false);setBulkField(null)}}/>
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3 w-56">
                      <p className="text-xs font-semibold text-gray-500 mb-2">Bulk Actions</p>
                      {[['current_stage','Change Stage'],['job_id','Assign Job'],
                        ...(canAssignHR?[['assigned_hr_owners','Assign HR Owner']]:[] as any),
                        ['assigned_interviewers','Assign Interviewer']
                      ].map(([f,label])=>(
                        <button key={f} onClick={()=>setBulkField(f)}
                          className={`w-full text-left text-sm px-2 py-1.5 rounded transition-colors ${bulkField===f?'bg-blue-50 text-blue-700':'hover:bg-gray-50 text-gray-700'}`}>
                          {label}
                        </button>
                      ))}
                      <button onClick={()=>bulkArchive.mutate(!showArchived)}
                        className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-amber-50 text-amber-600">
                        {showArchived?'Unarchive':'Archive'} selected
                      </button>
                      {isSuperAdmin && (
                        <button onClick={()=>setBulkField('__delete__')}
                          className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-red-50 text-red-600 border-t border-gray-100 mt-1 pt-2">
                          Delete permanently
                        </button>
                      )}
                      {bulkField && bulkField!=='__delete__' && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <select autoFocus defaultValue=""
                            onChange={e=>{if(e.target.value)bulkUpdate.mutate({field:bulkField,value:e.target.value})}}
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
                      {bulkField==='__delete__' && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="text-xs text-red-600 mb-2 font-medium">Delete {selectedIds.size} permanently?</p>
                          <div className="flex gap-2">
                            <button onClick={()=>setBulkField(null)} className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs text-gray-600">Cancel</button>
                            <button onClick={async()=>{await supabase.from('candidates').delete().in('id',Array.from(selectedIds));qc.invalidateQueries({queryKey:['candidates']});setSelectedIds(new Set());setBulkField(null);setShowBulkMenu(false)}} className="flex-1 px-2 py-1.5 bg-red-600 rounded text-xs text-white font-medium">Delete All</button>
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
                <Button variant="secondary" size="sm" icon={<Upload className="w-3.5 h-3.5"/>} onClick={()=>navigate('/upload')}>Upload</Button>
                <Button size="sm" icon={<UserPlus className="w-3.5 h-3.5"/>} onClick={()=>navigate('/upload?mode=single')}>Add One</Button>
              </>
            )}
          </div>
        }
      />

      {/* Search + Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or email…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>

        <div ref={filterRef} className="relative">
          <Button variant={activeFilters.length>0?'primary':'secondary'} size="sm"
            icon={<Filter className="w-3.5 h-3.5"/>}
            onClick={()=>setShowFilterBar(o=>!o)}>
            {activeFilters.length>0?`${activeFilters.length} filter${activeFilters.length>1?'s':''}`:'Filter'}
          </Button>
          {showFilterBar && (
            <div className="absolute left-0 top-full mt-1 z-50">
              <FilterBar filters={activeFilters} onChange={setActiveFilters}
                jobs={jobs as any[]} interviewers={interviewers as any[]}
                hrUsers={hrUsers as any[]} mode={filterMode} onModeChange={setFilterMode}
                customFieldDefs={(customFields as any[]).map(f=>({field_name:f.field_name,field_label:f.field_label,field_type:f.field_type}))}/>
            </div>
          )}
        </div>

        <select value={filters.job_id??''} onChange={e=>setFilters(p=>({...p,job_id:e.target.value||undefined}))}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All jobs</option>
          {(jobs as any[]).map(j=><option key={j.id} value={j.id}>{j.title}</option>)}
        </select>

        {(activeFilters.length>0||search||filters.job_id) && (
          <Button variant="ghost" size="sm" icon={<X className="w-3.5 h-3.5"/>}
            onClick={()=>{setFilters({});setSearch('');setActiveFilters([])}}>Clear</Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
      ) : displayed.length===0 ? (
        <EmptyState title={showArchived?'No archived candidates':activeFilters.length?'No matches':'No candidates'}
          description={showArchived?'Archive from active list.':activeFilters.length?'Try clearing filters.':'Upload your first candidate.'}
          action={canEdit&&!showArchived&&!activeFilters.length?<Button size="sm" onClick={()=>navigate('/upload')}>Upload</Button>:undefined}/>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-3 py-3 w-10 sticky left-0 bg-gray-50 z-10">
                      <input type="checkbox" checked={selectedIds.size===displayed.length&&displayed.length>0}
                        onChange={toggleAll} className="rounded border-gray-300 text-blue-600 cursor-pointer"/>
                    </th>
                    <SortableContext items={orderedVisible} strategy={horizontalListSortingStrategy}>
                      {orderedVisible.map(key => {
                        const col = allCols.find(c=>c.key===key)
                        if (!col) return null
                        const isNm = key==='name'
                        if (isNm) return (
                          <th key="name" className="text-left px-3 py-3 font-medium text-xs text-gray-500 uppercase tracking-wide sticky left-10 bg-gray-50 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                            <div className="flex items-center gap-1">
                              <Pin className="w-3 h-3 text-blue-400"/>
                              Name
                            </div>
                          </th>
                        )
                        return (
                          <SortableColHeader key={key} id={key} label={col.label}
                            frozen={frozenCols.has(key)} onFreeze={toggleFreeze}/>
                        )
                      })}
                    </SortableContext>
                    <th className="px-3 py-3 text-right text-xs text-gray-500 uppercase tracking-wide font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {grouped.map(({ key: groupKey, label: groupLabel, items }) => (
                    <>
                      {groupBy && <GroupHeader key={`gh_${groupKey}`} label={groupLabel} count={items.length} colour={STAGE_COLOR_BAR[groupKey]}/>}
                      {items.map((c:any) => {
                        const isSel = selectedIds.has(c.id)
                        return (
                          <tr key={c.id} className={`transition-colors ${isSel?'bg-blue-50/50':'hover:bg-gray-50/40'} ${c.archived_at?'opacity-50':''}`}>
                            <td className="px-3 py-2.5 w-10 sticky left-0 bg-white z-10 group-hover:bg-gray-50">
                              <input type="checkbox" checked={isSel} onChange={()=>toggleSel(c.id)}
                                className="rounded border-gray-300 text-blue-600 cursor-pointer"/>
                            </td>
                            {orderedVisible.map(key => {
                              const isFrz = key==='name' || frozenCols.has(key)
                              const stickyStyle = isFrz ? 'sticky left-10 z-10 bg-white shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]' : ''
                              if (key==='name') return (
                                <td key="name" className={`px-3 py-2.5 whitespace-nowrap ${stickyStyle}`}>
                                  <button onClick={()=>navigate(`/candidates/${c.id}`)}
                                    className="font-medium text-blue-600 hover:underline text-sm text-left">{c.full_name}</button>
                                </td>
                              )
                              if (key==='stage') return <td key="stage" className={`px-3 py-2.5 min-w-[130px] ${stickyStyle}`}><StageCell cid={c.id} value={c.current_stage} canEdit={canEdit} onUpdate={onUpdate}/></td>
                              if (key==='job') return <td key="job" className={`px-3 py-2.5 min-w-[140px] ${stickyStyle}`}><SelectCell cid={c.id} field="job_id" display={getName(jobs as any[],c.job_id)} canEdit={canAssign} onUpdate={onUpdate} options={(jobs as any[]).map(j=>({label:j.title,value:j.id}))}/></td>
                              if (key==='source') return <td key="source" className={`px-3 py-2.5 ${stickyStyle}`}><SelectCell cid={c.id} field="source_category" display={c.source_category} canEdit={canEdit} onUpdate={onUpdate} options={SOURCES.map(s=>({label:s.charAt(0).toUpperCase()+s.slice(1),value:s}))}/></td>
                              if (key==='subsource') return <td key="subsource" className={`px-3 py-2.5 text-xs text-gray-600 ${stickyStyle}`}>{c.source_name}</td>
                              if (key==='hr_owner') return <td key="hr_owner" className={`px-3 py-2.5 min-w-[120px] ${stickyStyle}`}><SelectCell cid={c.id} field="hr_owner" display={getName(hrUsers as any[],c.hr_owner)} canEdit={canAssignHR} onUpdate={onUpdate} options={(hrUsers as any[]).map(u=>({label:u.full_name,value:u.id}))}/></td>
                              if (key==='interviewer') return <td key="interviewer" className={`px-3 py-2.5 min-w-[150px] ${stickyStyle}`}><MultiSelectCell cid={c.id} field="assigned_interviewers" selectedIds={c.assigned_interviewers??[]} canEdit={canEdit} onUpdate={(id,_,arr)=>onUpdate(id,'assigned_interviewers',arr)} options={(interviewers as any[]).map(u=>({label:u.full_name,value:u.id}))}/></td>
                              if (key==='interview_date') return <td key="interview_date" className={`px-3 py-2.5 min-w-[160px] ${stickyStyle}`}><DateCell cid={c.id} value={c.interview_date} canEdit={canEdit} onUpdate={onUpdate}/></td>
                              if (key==='updated_at') return <td key="updated_at" className={`px-3 py-2.5 text-xs text-gray-400 ${stickyStyle}`}>{c.updated_at?formatDate(c.updated_at):'—'}</td>
                              if (key==='email') return <td key="email" className={`px-3 py-2.5 ${stickyStyle}`}><a href={`mailto:${c.email}`} className="text-gray-500 hover:text-blue-600 text-xs">{c.email}</a></td>
                              if (key==='phone') return <td key="phone" className={`px-3 py-2.5 text-xs text-gray-600 ${stickyStyle}`}>{c.phone??'—'}</td>
                              if (key==='linkedin') return <td key="linkedin" className={`px-3 py-2.5 ${stickyStyle}`}>{c.linkedin_url?<a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs flex items-center gap-1"><ExternalLink className="w-3 h-3"/>View</a>:<span className="text-gray-300 text-xs">—</span>}</td>
                              if (key==='resume') return <td key="resume" className={`px-3 py-2.5 ${stickyStyle}`}>{c.resume_url?<a href={c.resume_url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs flex items-center gap-1"><FileText className="w-3 h-3"/>View</a>:<span className="text-gray-300 text-xs">—</span>}</td>
                              if (key==='notes') return <td key="notes" className={`px-3 py-2.5 max-w-[140px] ${stickyStyle}`}>{c.notes?<p className="text-gray-500 text-xs truncate">{c.notes}</p>:<span className="text-gray-300 text-xs">—</span>}</td>
                              // Custom fields
                              if (key.startsWith('cf_')) {
                                const fn = key.slice(3)
                                return <td key={key} className={`px-3 py-2.5 text-xs text-gray-600 ${stickyStyle}`}>{c.custom_data?.[fn]??'—'}</td>
                              }
                              return null
                            })}
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1 justify-end">
                                <TipBtn colour="amber" tip={c.archived_at?'Unarchive':'Archive'}
                                  onClick={()=>archiveOne.mutate({id:c.id,archive:!c.archived_at})}>
                                  <Archive className="w-3.5 h-3.5"/>
                                </TipBtn>
                                {isSuperAdmin && (
                                  <TipBtn colour="red" tip="Delete permanently" onClick={()=>setConfirmDelete(c.id)}>
                                    <Trash2 className="w-3.5 h-3.5"/>
                                  </TipBtn>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </>
                  ))}
                </tbody>
              </table>
            </DndContext>
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">Drag column headers to reorder · 📌 Pin to freeze · Group By to organise</p>
            {selectedIds.size>0&&<button onClick={()=>setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><X className="w-3 h-3"/>Clear</button>}
          </div>
        </div>
      )}

      <Modal open={!!confirmDelete} onClose={()=>setConfirmDelete(null)} title="Delete Candidate" size="sm">
        <p className="text-sm text-gray-600 mb-4">Permanently delete this candidate? Consider archiving instead.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={()=>setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" loading={deleteOne.isPending} onClick={()=>confirmDelete&&deleteOne.mutate(confirmDelete)}>Delete</Button>
        </div>
      </Modal>
    </div>
  )
}
