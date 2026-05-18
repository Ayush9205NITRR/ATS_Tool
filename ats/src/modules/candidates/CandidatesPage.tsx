import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Upload, UserPlus, Loader2, ExternalLink, FileText,
  Eye, X, Archive, Trash2, Filter, ChevronDown, Check,
  Layers, GripVertical, Calendar
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates,
  horizontalListSortingStrategy, useSortable, arrayMove
} from '@dnd-kit/sortable'
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
import { INTERVIEW_STAGES } from '../../types/database.types'
import { formatDate, formatDateTime } from '../../shared/utils/helpers'
import { ScheduleInterviewModal } from './ScheduleInterviewModal'
import { SendEmailModal } from './SendEmailModal'

// ── Stage colours ─────────────────────────────────────────────
const STAGE_PILL: Record<string,string> = {
  Applied:'bg-gray-100 text-gray-600', Screening:'bg-blue-50 text-blue-700',
  R1:'bg-indigo-50 text-indigo-700', 'Case Study':'bg-amber-50 text-amber-700',
  R2:'bg-orange-50 text-orange-700', R3:'bg-orange-100 text-orange-800',
  'CF (Virtual)':'bg-purple-50 text-purple-700', 'CF (In-Person)':'bg-purple-100 text-purple-800',
  Offer:'bg-violet-50 text-violet-700', Hired:'bg-green-50 text-green-700',
  Rejected:'bg-red-50 text-red-600',
}
const STAGE_BAR: Record<string,string> = {
  Applied:'bg-gray-300', Screening:'bg-blue-400', R1:'bg-indigo-400',
  'Case Study':'bg-amber-400', R2:'bg-orange-400', R3:'bg-orange-500',
  'CF (Virtual)':'bg-purple-400', 'CF (In-Person)':'bg-purple-500',
  Offer:'bg-violet-500', Hired:'bg-green-500', Rejected:'bg-red-400',
}

// ── Column config ─────────────────────────────────────────────
interface ColDef { key: string; label: string; width: number; alwaysVisible?: boolean }
const COLS: ColDef[] = [
  { key:'stage',          label:'Stage',          width:150 },
  { key:'job',            label:'Job',            width:160 },
  { key:'source',         label:'Source',         width:100 },
  { key:'subsource',      label:'Sub-Source',     width:140 },
  { key:'hr_owner',       label:'HR Owner',       width:130 },
  { key:'interviewer',    label:'Interviewer',    width:160 },
  { key:'interview_date', label:'Interview Date', width:170 },
  { key:'updated_at',     label:'Updated',        width:110 },
  { key:'email',          label:'Email',          width:190 },
  { key:'phone',          label:'Phone',          width:120 },
  { key:'linkedin',       label:'LinkedIn',       width:80  },
  { key:'resume',         label:'Resume',         width:80  },
  { key:'notes',          label:'Notes',          width:150 },
]
const DEFAULT_VISIBLE  = new Set(['stage','job','hr_owner','interviewer','interview_date'])
const DEFAULT_ORDER    = COLS.map(c=>c.key)

// ── Tiny popup (no-lag dropdown) ──────────────────────────────
function Popup({ trigger, children }: { trigger:React.ReactNode; children:React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(o=>!o)}>{trigger}</div>
      {open && (
        <div onClick={() => setOpen(false)}
          className="absolute top-full left-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-50 py-1 min-w-[160px] max-h-60 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Stage cell ────────────────────────────────────────────────
const StageCell = memo(({ cid, value, canEdit, onUpdate }: {
  cid:string; value:string; canEdit:boolean; onUpdate:(id:string,f:string,v:any)=>void
}) => {
  const pill = <span className={`inline-flex items-center gap-0.5 text-xs px-2.5 py-1 rounded-md font-medium ${canEdit?'cursor-pointer hover:opacity-80':''} ${STAGE_PILL[value]??'bg-gray-100 text-gray-600'}`}>
    {value}{canEdit&&<ChevronDown className="w-3 h-3 opacity-40 ml-0.5"/>}
  </span>
  if (!canEdit) return pill
  return (
    <Popup trigger={pill}>
      {INTERVIEW_STAGES.map(s=>(
        <button key={s} onClick={()=>onUpdate(cid,'current_stage',s)}
          className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STAGE_BAR[s]??'bg-gray-300'}`}/>
          <span className={`flex-1 ${s===value?'font-semibold text-gray-900':'text-gray-600'}`}>{s}</span>
          {s===value&&<Check className="w-3 h-3 text-blue-500"/>}
        </button>
      ))}
    </Popup>
  )
})

// ── Select cell ───────────────────────────────────────────────
const SelectCell = memo(({ cid, field, display, options, canEdit, onUpdate }: {
  cid:string; field:string; display?:string|null
  options:{label:string;value:string}[]
  canEdit:boolean; onUpdate:(id:string,f:string,v:any)=>void
}) => {
  if (!canEdit) return <span className="text-xs text-gray-500">{display??<span className="text-gray-300">—</span>}</span>
  return (
    <Popup trigger={
      <button className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 group">
        <span className="max-w-[120px] truncate">{display??<span className="text-gray-300">—</span>}</span>
        <ChevronDown className="w-3 h-3 text-gray-300 group-hover:text-gray-500 flex-shrink-0"/>
      </button>
    }>
      <button onClick={()=>onUpdate(cid,field,null)} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">Clear</button>
      {options.map(o=>(
        <button key={o.value} onClick={()=>onUpdate(cid,field,o.value)}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 truncate">{o.label}</button>
      ))}
    </Popup>
  )
})

// ── Multi-select cell ─────────────────────────────────────────
const MultiCell = memo(({ cid, field, ids, options, canEdit, onUpdate }: {
  cid:string; field:string; ids:string[]
  options:{label:string;value:string}[]
  canEdit:boolean; onUpdate:(id:string,f:string,v:string[])=>void
}) => {
  const names = options.filter(o=>ids.includes(o.value)).map(o=>o.label)
  if (!canEdit) return <span className="text-xs text-gray-500">{names.join(', ')||<span className="text-gray-300">—</span>}</span>
  return (
    <Popup trigger={
      <button className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 group max-w-[150px]">
        <span className="truncate">{names.length?names.join(', '):<span className="text-gray-300">—</span>}</span>
        <ChevronDown className="w-3 h-3 text-gray-300 group-hover:text-gray-500 flex-shrink-0"/>
      </button>
    }>
      {options.map(o=>{
        const sel = ids.includes(o.value)
        return (
          <button key={o.value}
            onClick={e=>{e.stopPropagation();const next=sel?ids.filter(i=>i!==o.value):[...ids,o.value];onUpdate(cid,field,next)}}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2.5">
            <span className={`w-3.5 h-3.5 rounded flex-shrink-0 border ${sel?'bg-blue-500 border-blue-500':'border-gray-300'} flex items-center justify-center`}>
              {sel&&<Check className="w-2.5 h-2.5 text-white"/>}
            </span>
            <span className={`truncate ${sel?'text-gray-900 font-medium':'text-gray-600'}`}>{o.label}</span>
          </button>
        )
      })}
      {ids.length>0&&<button onClick={()=>onUpdate(cid,field,[])} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-50 border-t border-gray-50 mt-1">Clear all</button>}
    </Popup>
  )
})

// ── Date cell ─────────────────────────────────────────────────
const DateCell = memo(({ cid, value, canEdit, onUpdate }: {
  cid:string; value:string|null; canEdit:boolean; onUpdate:(id:string,f:string,v:any)=>void
}) => {
  const [editing, setEditing] = useState(false)
  if (!canEdit) return <span className="text-xs text-gray-500">{value?formatDateTime(value):'—'}</span>
  if (editing) return (
    <input type="datetime-local" defaultValue={value?value.replace(' ','T').slice(0,16):''} autoFocus
      onBlur={e=>{onUpdate(cid,'interview_date',e.target.value?new Date(e.target.value).toISOString():null);setEditing(false)}}
      className="w-44 px-2 py-0.5 border border-blue-400 rounded text-xs bg-white focus:outline-none"/>
  )
  return (
    <button onClick={()=>setEditing(true)} className="text-xs text-gray-500 hover:text-blue-600 transition-colors">
      {value?formatDateTime(value):<span className="text-gray-300">Set time</span>}
    </button>
  )
})

// ── Sortable header cell ──────────────────────────────────────
function SortableHeader({ id, label }: { id:string; label:string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <th ref={setNodeRef}
      style={{ transform:CSS.Transform.toString(transform), transition, opacity:isDragging?0.4:1 }}
      className="text-left px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap select-none">
      <div className="flex items-center gap-1.5">
        <span {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-200 hover:text-gray-400 transition-colors">
          <GripVertical className="w-3.5 h-3.5"/>
        </span>
        {label}
      </div>
    </th>
  )
}

// ── Group section header ──────────────────────────────────────
function GroupRow({ label, count }: { label:string; count:number }) {
  return (
    <tr>
      <td colSpan={99} className="px-4 py-2 bg-gray-50/80 border-y border-gray-100 first:border-t-0">
        <span className="text-xs font-semibold text-gray-500">{label}</span>
        <span className="ml-2 text-xs text-gray-400 font-normal">{count} candidate{count!==1?'s':''}</span>
      </td>
    </tr>
  )
}

// ── Row action button ─────────────────────────────────────────
function ActionBtn({ onClick, title, children, danger }: { onClick:()=>void; title:string; children:React.ReactNode; danger?:boolean }) {
  return (
    <button onClick={onClick} title={title}
      className={`p-1.5 rounded-lg transition-all opacity-0 group-hover/row:opacity-100 ${danger?'hover:bg-red-50 hover:text-red-500 text-gray-300':'hover:bg-gray-100 text-gray-300 hover:text-gray-600'}`}>
      {children}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────
export function CandidatesPage() {
  const navigate = useNavigate()
  const { hasRole, user } = useAuthStore()
  const qc = useQueryClient()

  const canEdit     = hasRole(['admin','super_admin','hr_team'])
  const canAssign   = hasRole(['admin','super_admin'])
  const canAssignHR = hasRole(['admin','super_admin'])
  const isSuperAdmin = hasRole(['super_admin'])

  const [serverFilters, setServerFilters] = useState<CandidateFilters>({})
  const [search, setSearch]         = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [filterMode, setFilterMode]       = useState<'and'|'or'>('and')
  const [showFilterBar, setShowFilterBar] = useState(false)
  const [showColPicker, setShowColPicker] = useState(false)
  const [showBulkMenu, setShowBulkMenu]   = useState(false)
  const [bulkField, setBulkField]         = useState<string|null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string|null>(null)
  const [groupBy, setGroupBy] = useState('')
  const [colOrder, setColOrder]     = useState<string[]>(DEFAULT_ORDER)
  const [visibleCols, setVisibleCols] = useState<Set<string>>(DEFAULT_VISIBLE)
  const [pinnedCols, setPinnedCols]   = useState<Set<string>>(new Set<string>())
  const [scheduleCandidate, setScheduleCandidate] = useState<any | null>(null)
  const [sendEmailCandidates, setSendEmailCandidates] = useState<any[]>([])
  const [bulkSelectValue, setBulkSelectValue] = useState('')
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (e:MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilterBar(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const { data: jobs=[] }        = useQuery({ queryKey:['jobs','filter'],        queryFn:async()=>{const{data}=await supabase.from('jobs').select('id,title').order('title');return data??[]} })
  const { data: hrUsers=[] }     = useQuery({ queryKey:['users','hr'],           queryFn:async()=>{const{data}=await supabase.from('users').select('id,full_name').in('role',['hr_team','admin','super_admin']).eq('is_active',true);return data??[]} })
  const { data: interviewers=[] }= useQuery({ queryKey:['users','interviewers'], queryFn:async()=>{const{data}=await supabase.from('users').select('id,full_name').eq('role','interviewer').eq('is_active',true);return data??[]} })
  const { data: customFields=[] }= useQuery({ queryKey:['custom-fields'],        queryFn:async()=>{const{data}=await supabase.from('custom_fields').select('*').eq('is_active',true).order('sort_order');return data??[]} })

  const { data: candidates=[], isLoading } = useCandidates({ ...serverFilters, search:search||undefined })

  const orderedVisible = useMemo(() => {
    const cf = (customFields as any[]).map(f=>`cf_${f.field_name}`)
    const all = [...colOrder, ...cf].filter(k => visibleCols.has(k))
    // Pinned cols come first (after name which is always frozen)
    const pinned   = all.filter(k => pinnedCols.has(k))
    const unpinned = all.filter(k => !pinnedCols.has(k))
    return [...pinned, ...unpinned]
  }, [colOrder, visibleCols, customFields, pinnedCols])

  const displayed = useMemo(() => {
    let list = candidates.filter((c:any) => showArchived ? !!c.archived_at : !c.archived_at)
    if (activeFilters.length) list = applyFilters(list, activeFilters, jobs as any[], interviewers as any[], filterMode, customFields as any[])
    return list
  }, [candidates, showArchived, activeFilters, jobs, interviewers, filterMode, customFields])

  const grouped = useMemo(() => {
    if (!groupBy) return [{ key:'', label:'', items:displayed }]
    const map = new Map<string,any[]>()
    displayed.forEach((c:any) => {
      let key = ''
      if (groupBy==='current_stage') key = c.current_stage??'Unknown'
      else if (groupBy==='job_id') key = c.job?.title??'No Job'
      else if (groupBy==='source_category') key = c.source_category??'Unknown'
      else if (groupBy==='hr_owner') key = (hrUsers as any[]).find(u=>u.id===c.hr_owner)?.full_name??'Unassigned'
      if (!map.has(key)) map.set(key,[])
      map.get(key)!.push(c)
    })
    return Array.from(map.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([key,items])=>({key,label:key,items}))
  }, [displayed, groupBy, hrUsers])

  // Mutations
  const updateField = useMutation({
    mutationFn: async({id,field,value}:{id:string;field:string;value:any})=>{
      const{error}=await supabase.from('candidates').update({[field]:value}).eq('id',id)
      if(error){console.error('[upd]',error);throw error}
    },
    onSuccess:()=>qc.invalidateQueries({queryKey:['candidates']}),
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
      let payload: Record<string, any>

      if (field === 'hr_owner') {
        // Single UUID field — direct update
        payload = { hr_owner: value || null }
      } else if (field === 'assigned_interviewers') {
        payload = { assigned_interviewers: Array.isArray(value) ? value : [value] }
      } else {
        payload = { [field]: value }
      }

      const { error } = await supabase.from('candidates').update(payload).in('id', ids)
      if (error) { console.error('[bulkUpdate]', error); throw error }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      setSelectedIds(new Set())
      setBulkField(null)
      setBulkSelectValue('')
      setShowBulkMenu(false)
    },
  })

  const bulkArchive = useMutation({
    mutationFn: async(archive:boolean)=>{
      const{error}=await supabase.from('candidates').update({archived_at:archive?new Date().toISOString():null,archived_by:archive?user!.id:null}).in('id',Array.from(selectedIds))
      if(error)throw error
    },
    onSuccess:()=>{qc.invalidateQueries({queryKey:['candidates']});setSelectedIds(new Set())},
  })

  const onUpdate  = useCallback((id:string,field:string,value:any)=>updateField.mutate({id,field,value}),[updateField])
  const toggleSel = useCallback((id:string)=>setSelectedIds(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n}),[])
  const toggleAll = useCallback(()=>setSelectedIds(s=>s.size===displayed.length?new Set():new Set(displayed.map((c:any)=>c.id))),[displayed])
  const getName   = useCallback((list:any[], id:string|null) => {
    if (!id) return null
    const item = list.find(u => u.id === id)
    return item?.full_name ?? item?.title ?? null
  }, [])

  const onDragEnd = useCallback((event:DragEndEvent)=>{
    const{active,over}=event
    if(over&&active.id!==over.id){
      setColOrder(prev=>{
        const ai=prev.indexOf(active.id as string),oi=prev.indexOf(over.id as string)
        return arrayMove(prev,ai,oi)
      })
    }
  },[])

  const allColDefs = useMemo(()=>[
    ...COLS,
    ...(customFields as any[]).map(f=>({key:`cf_${f.field_name}`,label:f.field_label,width:130}))
  ],[customFields])

  const GROUPS = [
    {value:'',label:'No grouping'},
    {value:'current_stage',label:'Stage'},
    {value:'job_id',label:'Job'},
    {value:'source_category',label:'Source'},
    {value:'hr_owner',label:'HR Owner'},
  ]

  const colPickerCols = useMemo(()=>allColDefs,[allColDefs])

  return (
    <div className="space-y-4">
      <PageHeader
        title={showArchived?'Archived':'Candidates'}
        subtitle={`${displayed.length} candidate${displayed.length!==1?'s':''}${selectedIds.size>0?` · ${selectedIds.size} selected`:''}`}
        action={
          <div className="flex items-center gap-2">
            {/* Archive toggle */}
            <button onClick={()=>{setShowArchived(a=>!a);setSelectedIds(new Set())}}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-all ${showArchived?'bg-amber-50 border-amber-200 text-amber-700':'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
              <Archive className="w-3.5 h-3.5"/>
              {showArchived?'Active view':'Archived'}
            </button>

            {/* Column picker */}
            <div className="relative">
              <button onClick={()=>setShowColPicker(o=>!o)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-all">
                <Eye className="w-3.5 h-3.5"/>Columns
              </button>
              {showColPicker&&(
                <>
                  <div className="fixed inset-0 z-40" onClick={()=>setShowColPicker(false)}/>
                  <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-100 rounded-xl shadow-lg z-50 p-4 w-56">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">Show & pin columns</p>
                    {colPickerCols.map(col=>(
                      <div key={col.key} className="flex items-center gap-2 py-1 group">
                        {/* Visible toggle */}
                        <button onClick={()=>setVisibleCols(p=>{const n=new Set(p);n.has(col.key)?n.delete(col.key):n.add(col.key);return n})}
                          className={`w-4 h-4 rounded border flex items-center justify-center transition-all flex-shrink-0 ${visibleCols.has(col.key)?'bg-blue-500 border-blue-500':'border-gray-300 hover:border-gray-400'}`}>
                          {visibleCols.has(col.key)&&<Check className="w-2.5 h-2.5 text-white"/>}
                        </button>
                        <span className="text-sm text-gray-700 flex-1">{col.label}</span>
                        {/* Pin toggle — only when visible, clear state */}
                        {visibleCols.has(col.key) && (
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              setPinnedCols(p => {
                                const n = new Set(p)
                                n.has(col.key) ? n.delete(col.key) : n.add(col.key)
                                return n
                              })
                            }}
                            title={pinnedCols.has(col.key) ? 'Click to unpin' : 'Click to pin left'}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-all ${
                              pinnedCols.has(col.key)
                                ? 'bg-blue-100 text-blue-700 font-medium'
                                : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100 opacity-0 group-hover:opacity-100'
                            }`}>
                            {pinnedCols.has(col.key) ? '📌 Pinned' : '📌 Pin'}
                          </button>
                        )}
                      </div>
                    ))}
                    {pinnedCols.size > 0 && (
                      <button onClick={() => setPinnedCols(new Set())}
                        className="mt-2 text-xs text-gray-400 hover:text-gray-600">Unpin all</button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Group By */}
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5">
              <Layers className="w-3.5 h-3.5 text-gray-400"/>
              <select value={groupBy} onChange={e=>setGroupBy(e.target.value)}
                className="text-sm bg-transparent border-none outline-none text-gray-600 cursor-pointer">
                {GROUPS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Bulk */}
            {selectedIds.size>0&&(
              <div className="relative">
                <button onClick={()=>setShowBulkMenu(o=>!o)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  {selectedIds.size} selected
                  <ChevronDown className="w-3.5 h-3.5"/>
                </button>
                {showBulkMenu&&(
                  <>
                    <div className="fixed inset-0 z-40" onClick={()=>{setShowBulkMenu(false);setBulkField(null)}}/>
                    <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-100 rounded-xl shadow-lg z-50 p-2 w-52">
                      {[['current_stage','Change Stage'],['job_id','Assign Job'],
                        ...(canAssignHR?[['hr_owner','Assign HR Owner']]:[] as any),
                        ['assigned_interviewers','Assign Interviewer']
                      ].map(([f,lbl])=>(
                        <button key={f} onClick={()=>{setBulkField(f);setBulkSelectValue('')}}
                          className={`w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${bulkField===f?'bg-blue-50 text-blue-700':'text-gray-700 hover:bg-gray-50'}`}>
                          {lbl}
                        </button>
                      ))}
                      <div className="border-t border-gray-100 mt-1 pt-1">
                        <button onClick={()=>bulkArchive.mutate(!showArchived)}
                          className="w-full text-left text-sm px-3 py-2 rounded-lg text-amber-700 hover:bg-amber-50 transition-colors">
                          {showArchived?'Unarchive':'Archive'} selected
                        </button>
                        {isSuperAdmin&&(
                          <button onClick={()=>setBulkField('__delete__')}
                            className="w-full text-left text-sm px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors">
                            Delete permanently
                          </button>
                        )}
                      </div>
                      {bulkField&&bulkField!=='__delete__'&&(
                        <div className="border-t border-gray-100 mt-1 pt-2 px-1 space-y-2" onClick={e=>e.stopPropagation()}>
                          <select
                            value={bulkSelectValue}
                            onChange={e => setBulkSelectValue(e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                            <option value="" disabled>Choose…</option>
                            {bulkField==='current_stage'?INTERVIEW_STAGES.map(s=><option key={s} value={s}>{s}</option>)
                              :bulkField==='job_id'?(jobs as any[]).map(j=><option key={j.id} value={j.id}>{j.title}</option>)
                              :bulkField==='assigned_interviewers'?(interviewers as any[]).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)
                              :bulkField==='hr_owner'?(hrUsers as any[]).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)
                              :null
                            }
                          </select>
                          <button
                            disabled={bulkUpdate.isPending || !bulkSelectValue}
                            onClick={e => {
                              e.stopPropagation()
                              if (bulkSelectValue) bulkUpdate.mutate({ field: bulkField!, value: bulkSelectValue })
                            }}
                            className="w-full py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5">
                            {bulkUpdate.isPending
                              ? <><Loader2 className="w-3 h-3 animate-spin"/>Updating…</>
                              : `Apply to ${selectedIds.size} candidate${selectedIds.size!==1?'s':''}`
                            }
                          </button>
                        </div>
                      )}
                      {bulkField==='__delete__'&&(
                        <div className="border-t border-gray-100 mt-1 pt-2 px-1 space-y-2">
                          <p className="text-xs text-red-600">Delete {selectedIds.size} permanently?</p>
                          <div className="flex gap-2">
                            <button onClick={()=>setBulkField(null)} className="flex-1 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
                            <button onClick={async()=>{await supabase.from('candidates').delete().in('id',Array.from(selectedIds));qc.invalidateQueries({queryKey:['candidates']});setSelectedIds(new Set());setBulkField(null);setShowBulkMenu(false)}}
                              className="flex-1 py-1.5 bg-red-600 rounded-lg text-xs text-white hover:bg-red-700">Delete</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {canEdit&&!showArchived&&(
              <>
                <button onClick={()=>navigate('/upload')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-all">
                  <Upload className="w-3.5 h-3.5"/>Upload
                </button>
                <button onClick={()=>navigate('/upload?mode=single')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
                  <UserPlus className="w-3.5 h-3.5"/>Add candidate
                </button>
              </>
            )}
          </div>
        }
      />

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or email…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"/>
        </div>

        <div ref={filterRef} className="relative">
          <button onClick={()=>setShowFilterBar(o=>!o)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-all ${activeFilters.length>0?'bg-blue-600 text-white border-blue-600 hover:bg-blue-700':'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
            <Filter className="w-3.5 h-3.5"/>
            {activeFilters.length>0?`${activeFilters.length} filter${activeFilters.length>1?'s':''}` : 'Filter'}
          </button>
          {showFilterBar&&(
            <div className="absolute left-0 top-full mt-1.5 z-50">
              <FilterBar filters={activeFilters} onChange={setActiveFilters}
                jobs={jobs as any[]} interviewers={interviewers as any[]}
                hrUsers={hrUsers as any[]} mode={filterMode} onModeChange={setFilterMode}
                customFieldDefs={(customFields as any[]).map(f=>({field_name:f.field_name,field_label:f.field_label,field_type:f.field_type}))}/>
            </div>
          )}
        </div>

        <select value={serverFilters.job_id??''} onChange={e=>setServerFilters(p=>({...p,job_id:e.target.value||undefined}))}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-600">
          <option value="">All jobs</option>
          {(jobs as any[]).map(j=><option key={j.id} value={j.id}>{j.title}</option>)}
        </select>

        {(activeFilters.length>0||search||serverFilters.job_id)&&(
          <button onClick={()=>{setServerFilters({});setSearch('');setActiveFilters([])}}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <X className="w-3.5 h-3.5"/>Clear
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400"/></div>
      ) : displayed.length===0 ? (
        <EmptyState title={showArchived?'No archived candidates':activeFilters.length?'No matches':'No candidates'}
          description={activeFilters.length?'Try adjusting your filters.':'Add your first candidate.'}
          action={canEdit&&!showArchived&&!activeFilters.length?<Button size="sm" onClick={()=>navigate('/upload')}>Upload candidates</Button>:undefined}/>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-100">
                    {/* Checkbox + Name — always frozen left */}
                    <th className="px-4 py-3 w-10 bg-white sticky left-0 z-20 after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-gray-100">
                      <input type="checkbox" checked={selectedIds.size===displayed.length&&displayed.length>0}
                        onChange={toggleAll} className="rounded border-gray-300 text-blue-600 cursor-pointer w-4 h-4"/>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide bg-white sticky left-10 z-20 min-w-[180px] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-gray-100">
                      Name
                    </th>
                    <SortableContext items={orderedVisible} strategy={horizontalListSortingStrategy}>
                      {orderedVisible.map(key=>{
                        const col = allColDefs.find(c=>c.key===key)
                        return col ? <SortableHeader key={key} id={key} label={col.label}/> : null
                      })}
                    </SortableContext>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide w-20">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(({key:gk,label:gl,items})=>(
                    <>
                      {groupBy&&<GroupRow key={`g_${gk}`} label={gl||'Unknown'} count={items.length}/>}
                      {items.map((c:any)=>{
                        const isSel = selectedIds.has(c.id)
                        return (
                          <tr key={c.id}
                            className={`group/row border-b border-gray-50 last:border-0 transition-colors ${isSel?'bg-blue-50/40':'hover:bg-gray-50/60'} ${c.archived_at?'opacity-40':''}`}>
                            {/* Checkbox — sticky */}
                            <td className={`px-4 py-2.5 sticky left-0 z-10 ${isSel?'bg-blue-50':'bg-white group-hover/row:bg-gray-50/60'} after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-gray-100`}>
                              <input type="checkbox" checked={isSel} onChange={()=>toggleSel(c.id)}
                                className="rounded border-gray-300 text-blue-600 cursor-pointer w-4 h-4"/>
                            </td>
                            {/* Name — sticky */}
                            <td className={`px-4 py-2.5 sticky left-10 z-10 min-w-[180px] ${isSel?'bg-blue-50':'bg-white group-hover/row:bg-gray-50/60'} after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-gray-100`}>
                              <button onClick={()=>navigate(`/candidates/${c.id}`)}
                                className="font-medium text-gray-900 hover:text-blue-600 transition-colors text-left text-sm">{c.full_name}</button>
                            </td>
                            {/* Dynamic columns */}
                            {orderedVisible.map(key=>{
                              if (key==='stage') return <td key="stage" className="px-3 py-2.5"><StageCell cid={c.id} value={c.current_stage} canEdit={canEdit} onUpdate={onUpdate}/></td>
                              if (key==='job') return <td key="job" className="px-3 py-2.5"><SelectCell cid={c.id} field="job_id" display={c.job?.title ?? getName(jobs as any[],c.job_id)} canEdit={canAssign} onUpdate={onUpdate} options={(jobs as any[]).map(j=>({label:j.title,value:j.id}))}/></td>
                              if (key==='source') return <td key="source" className="px-3 py-2.5 text-xs text-gray-500 capitalize">{c.source_category??'—'}</td>
                              if (key==='subsource') return <td key="subsource" className="px-3 py-2.5 text-xs text-gray-500">{c.source_name??'—'}</td>
                              if (key==='hr_owner') return <td key="hr_owner" className="px-3 py-2.5"><SelectCell cid={c.id} field="hr_owner" display={getName(hrUsers as any[],c.hr_owner)} canEdit={canAssignHR} onUpdate={onUpdate} options={(hrUsers as any[]).map(u=>({label:u.full_name,value:u.id}))}/></td>
                              if (key==='interviewer') return <td key="interviewer" className="px-3 py-2.5"><MultiCell cid={c.id} field="assigned_interviewers" ids={c.assigned_interviewers??[]} canEdit={canEdit} onUpdate={(id,_,arr)=>onUpdate(id,'assigned_interviewers',arr)} options={(interviewers as any[]).map(u=>({label:u.full_name,value:u.id}))}/></td>
                              if (key==='interview_date') return <td key="interview_date" className="px-3 py-2.5"><DateCell cid={c.id} value={c.interview_date} canEdit={canEdit} onUpdate={onUpdate}/></td>
                              if (key==='updated_at') return <td key="updated_at" className="px-3 py-2.5 text-xs text-gray-400">{c.updated_at?formatDate(c.updated_at):'—'}</td>
                              if (key==='email') return <td key="email" className="px-3 py-2.5"><a href={`mailto:${c.email}`} className="text-xs text-gray-500 hover:text-blue-600">{c.email}</a></td>
                              if (key==='phone') return <td key="phone" className="px-3 py-2.5 text-xs text-gray-500">{c.phone??'—'}</td>
                              if (key==='linkedin') return <td key="linkedin" className="px-3 py-2.5">{c.linkedin_url?<a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 flex items-center gap-1"><ExternalLink className="w-3 h-3"/>Link</a>:<span className="text-gray-200 text-xs">—</span>}</td>
                              if (key==='resume') return <td key="resume" className="px-3 py-2.5">{c.resume_url?<a href={c.resume_url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 flex items-center gap-1"><FileText className="w-3 h-3"/>Link</a>:<span className="text-gray-200 text-xs">—</span>}</td>
                              if (key==='notes') return <td key="notes" className="px-3 py-2.5 max-w-[150px]"><p className="text-xs text-gray-400 truncate">{c.notes||'—'}</p></td>
                              if (key.startsWith('cf_')) return <td key={key} className="px-3 py-2.5 text-xs text-gray-500">{c.custom_data?.[key.slice(3)]??'—'}</td>
                              return null
                            })}
                            {/* Actions */}
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-0.5 justify-end">
                                {canEdit && (
                                  <ActionBtn onClick={() => setScheduleCandidate(c)} title="Schedule interview">
                                    <Calendar className="w-3.5 h-3.5"/>
                                  </ActionBtn>
                                )}
                                <ActionBtn onClick={()=>archiveOne.mutate({id:c.id,archive:!c.archived_at})} title={c.archived_at?'Unarchive':'Archive'}>
                                  <Archive className="w-3.5 h-3.5"/>
                                </ActionBtn>
                                {isSuperAdmin&&(
                                  <ActionBtn onClick={()=>setConfirmDelete(c.id)} title="Delete permanently" danger>
                                    <Trash2 className="w-3.5 h-3.5"/>
                                  </ActionBtn>
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
            </div>
          </DndContext>
          <div className="px-4 py-2.5 border-t border-gray-50 flex items-center justify-between bg-gray-50/40">
            <p className="text-xs text-gray-400">
              Drag <GripVertical className="w-3 h-3 inline"/> to reorder · Click name to open profile
            </p>
            {selectedIds.size>0&&(
              <button onClick={()=>setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                <X className="w-3 h-3"/>Clear selection
              </button>
            )}
          </div>
        </div>
      )}

      <Modal open={!!confirmDelete} onClose={()=>setConfirmDelete(null)} title="Delete candidate" size="sm">
        <p className="text-sm text-gray-600 mb-4">Permanently delete this candidate? This cannot be undone. Consider archiving instead.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={()=>setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" loading={deleteOne.isPending} onClick={()=>confirmDelete&&deleteOne.mutate(confirmDelete)}>Delete</Button>
        </div>
      </Modal>

      {/* Schedule Interview Modal — isolated, no parent re-renders */}
      {scheduleCandidate && (
        <ScheduleInterviewModal
          candidateId={scheduleCandidate.id}
          candidateName={scheduleCandidate.full_name}
          candidateEmail={scheduleCandidate.email}
          resumeUrl={scheduleCandidate.resume_url}
          jobTitle={scheduleCandidate.job?.title}
          jdLink={scheduleCandidate.job?.jd_link}
          onClose={() => setScheduleCandidate(null)}
        />
      )}
    </div>
  )
}
