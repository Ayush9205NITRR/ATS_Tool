import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search, Upload, UserPlus, Loader2, ExternalLink, FileText,
  Eye, X, Archive, Trash2, Filter, ChevronDown, Check,
  Layers, GripVertical, Download
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
import { useStages as useStagesHook } from '../../shared/hooks/useStages'
import { formatDate, formatDateTime } from '../../shared/utils/helpers'

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
  { key:'ca_decision',    label:'CA Decision',    width:140 },
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
const DEFAULT_VISIBLE  = new Set(['stage','job','ca_decision','hr_owner','interviewer','interview_date'])
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

// ── Source cell — shows category only, click to change ────────
const PLATFORM_SRC_LIST = ['LinkedIn','Naukri','Indeed','Internshala','Unstop','Shine','Monster','Foundit','Apna','Website','Other']

const SourceCell = memo(({ cid, category, canEdit, onUpdate }: {
  cid:string; category:string; canEdit:boolean
  onUpdate:(id:string,f:string,v:any)=>void
}) => {
  const badgeCls =
    category==='agency'    ? 'bg-violet-50 text-violet-700 border-violet-100' :
    category==='platform'  ? 'bg-sky-50 text-sky-700 border-sky-100' :
    category==='college'   ? 'bg-amber-50 text-amber-700 border-amber-100' :
    category==='referral'  ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
    'bg-gray-50 text-gray-400 border-gray-100'
  const label = category === 'referral' ? 'Referral' : category ? category.charAt(0).toUpperCase()+category.slice(1) : '—'
  const badge = (
    <span className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border font-medium ${canEdit?'cursor-pointer hover:opacity-75':''} ${badgeCls}`}>
      {label}{canEdit && <ChevronDown className="w-2.5 h-2.5 opacity-40"/>}
    </span>
  )
  if (!canEdit) return badge
  return (
    <Popup trigger={badge}>
      <div className="px-1 py-1 min-w-[130px]">
        <p className="text-xs text-gray-400 font-medium px-2 pt-1 pb-0.5">Source Type</p>
        {[['platform','Platform'],['agency','Agency'],['college','College'],['referral','Employee Referral']].map(([cat,lbl])=>(
          <button key={cat}
            onClick={()=>{ onUpdate(cid,'source_category',cat); onUpdate(cid,'source_name','') }}
            className={`w-full text-left text-xs px-2.5 py-2 rounded flex items-center justify-between gap-3 transition-colors ${
              category===cat?'bg-blue-50 text-blue-700 font-medium':'text-gray-600 hover:bg-gray-50'
            }`}>
            {lbl}{category===cat&&<Check className="w-3 h-3"/>}
          </button>
        ))}
      </div>
    </Popup>
  )
})

// ── Sub-Source cell — shows source_name, dropdown by category ──
const SubSourceCell = memo(({ cid, category, name, canEdit, onUpdate }: {
  cid:string; category:string; name:string; canEdit:boolean
  onUpdate:(id:string,f:string,v:any)=>void
}) => {
  const [agencyUsers, setAgencyUsers] = useState<{id:string;full_name:string}[]>([])
  const [colleges, setColleges]       = useState<string[]>([])
  const [employees, setEmployees]     = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [collegeInput, setCollegeInput] = useState(name)

  const display = name || <span className="text-gray-300">—</span>
  if (!canEdit || !category) return <span className="text-xs text-gray-600">{display}</span>

  const trigger = (
    <span className="inline-flex items-center gap-0.5 text-xs text-gray-700 cursor-pointer hover:text-blue-600 max-w-[130px] truncate">
      <span className="truncate">{name || <span className="text-gray-400 italic">select…</span>}</span>
      <ChevronDown className="w-2.5 h-2.5 opacity-50 flex-shrink-0"/>
    </span>
  )

  const loadData = () => {
    if (loaded) return; setLoaded(true)
    if (category === 'agency') {
      // Only show agencies that are registered users in Settings (role='agency')
      supabase.from('users').select('id,full_name').eq('role','agency').eq('is_active',true).order('full_name')
        .then(({data}) => setAgencyUsers(data ?? []))
    } else if (category === 'college') {
      supabase.from('candidates').select('source_name').eq('source_category','college').not('source_name','is',null)
        .then(({data}) => {
          const unique = [...new Set((data ?? []).map((d:any) => d.source_name).filter(Boolean))].sort()
          setColleges(unique)
        })
    } else if (category === 'referral') {
      supabase.from('app_settings').select('value').eq('key','employee_referral_list').maybeSingle()
        .then(({data}) => {
          if (!data?.value) return
          try { setEmployees(JSON.parse(data.value) as string[]) } catch { /* ignore */ }
        })
    }
  }

  if (category === 'agency') return (
    <Popup trigger={<span onClick={loadData}>{trigger}</span>}>
      <div className="px-1 py-1 max-h-52 overflow-y-auto">
        {agencyUsers.length === 0
          ? <p className="text-xs text-gray-400 px-2 py-2 italic">Loading…</p>
          : agencyUsers.map(u => (
            <button key={u.id} onClick={() => onUpdate(cid, 'source_name', u.full_name)}
              className={`w-full text-left text-xs px-2.5 py-2 rounded hover:bg-purple-50 flex items-center justify-between gap-3 ${name===u.full_name?'text-purple-700 font-semibold bg-purple-50':''}`}>
              {u.full_name}{name===u.full_name&&<Check className="w-3 h-3 text-purple-500"/>}
            </button>
          ))
        }
      </div>
    </Popup>
  )

  if (category === 'platform') return (
    <Popup trigger={trigger}>
      <div className="px-1 py-1">
        {PLATFORM_SRC_LIST.map(p => (
          <button key={p} onClick={() => onUpdate(cid, 'source_name', p)}
            className={`w-full text-left text-xs px-2.5 py-2 rounded hover:bg-blue-50 flex items-center justify-between gap-3 ${name===p?'text-blue-700 font-semibold bg-blue-50':''}`}>
            {p}{name===p&&<Check className="w-3 h-3 text-blue-500"/>}
          </button>
        ))}
      </div>
    </Popup>
  )

  if (category === 'referral') return (
    <Popup trigger={<span onClick={loadData}>{trigger}</span>}>
      <div className="px-1 py-1 max-h-52 overflow-y-auto">
        {employees.length === 0
          ? <p className="text-xs text-gray-400 px-2 py-2 italic">No employees configured</p>
          : employees.map(e => (
            <button key={e} onClick={() => onUpdate(cid, 'source_name', e)}
              className={`w-full text-left text-xs px-2.5 py-2 rounded hover:bg-emerald-50 flex items-center justify-between gap-3 ${name===e?'text-emerald-700 font-semibold bg-emerald-50':''}`}>
              {e}{name===e&&<Check className="w-3 h-3 text-emerald-500"/>}
            </button>
          ))
        }
      </div>
    </Popup>
  )

  return (
    <Popup trigger={<span onClick={loadData}>{trigger}</span>}>
      <div className="px-2 py-2 w-52">
        <input type="text" value={collegeInput}
          onChange={e => setCollegeInput(e.target.value)}
          onBlur={e => { if(e.target.value && e.target.value !== name) onUpdate(cid, 'source_name', e.target.value) }}
          onKeyDown={e => { if(e.key==='Enter') { if(collegeInput) onUpdate(cid,'source_name',collegeInput); (e.target as any).blur() }}}
          placeholder="Type or select college…"
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"/>
        {colleges.length > 0 && (
          <div className="max-h-36 overflow-y-auto border-t border-gray-100 pt-1">
            {colleges.map(c => (
              <button key={c} onClick={() => { setCollegeInput(c); onUpdate(cid, 'source_name', c) }}
                className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-amber-50 ${name===c?'text-amber-700 font-semibold':''}`}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
    </Popup>
  )
})

// ── Stage cell ────────────────────────────────────────────────
const StageCell = memo(({ cid, value, canEdit, onUpdate, stages, stageConfigs }: {
  cid:string; value:string; canEdit:boolean; onUpdate:(id:string,f:string,v:any)=>void
  stages:string[]; stageConfigs:{name:string;color:string;textColor:string}[]
}) => {
  const cfg = stageConfigs.find(s=>s.name===value)
  const pillCls = cfg ? `${cfg.color} ${cfg.textColor}` : (STAGE_PILL[value] ?? 'bg-gray-100 text-gray-600')
  const dotCls  = cfg ? cfg.color.replace('bg-','bg-').replace('-100','-400').replace('-50','-400') : (STAGE_BAR[value] ?? 'bg-gray-300')
  const pill = (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium ${canEdit?'cursor-pointer hover:opacity-80':''} ${pillCls}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotCls}`}/>
      {value}{canEdit&&<ChevronDown className="w-3 h-3 opacity-40 ml-0.5"/>}
    </span>
  )
  if (!canEdit) return pill
  return (
    <Popup trigger={pill}>
      {stages.map(s=>{
        const c = stageConfigs.find(x=>x.name===s)
        return (
          <button key={s} onClick={()=>onUpdate(cid,'current_stage',s)}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2.5">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${c?.color??'bg-gray-200'}`}/>
            <span className={`flex-1 ${s===value?'font-semibold text-gray-900':'text-gray-600'}`}>{s}</span>
            {s===value&&<Check className="w-3 h-3 text-blue-500"/>}
          </button>
        )
      })}
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

function exportCSV(candidates: any[], jobs: any[], hrUsers: any[]) {
  const getName = (arr: any[], id: string) => arr.find(u => u.id === id)?.full_name ?? ''
  const rows = candidates.map(c => [
    c.full_name ?? '',
    c.email ?? '',
    c.phone ?? '',
    c.current_stage ?? '',
    c.job?.title ?? '',
    c.source_category ?? '',
    c.source_name ?? '',
    getName(hrUsers, c.hr_owner ?? ''),
    c.interview_date ? new Date(c.interview_date).toLocaleString() : '',
    c.status ?? '',
  ])
  const header = ['Name','Email','Phone','Stage','Job','Source','Sub-Source','HR Owner','Interview Date','Status']
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'candidates.csv'; a.click()
  URL.revokeObjectURL(url)
}

// ── Main page ─────────────────────────────────────────────────
export function CandidatesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasRole, user } = useAuthStore()
  const qc = useQueryClient()

  const canEdit     = hasRole(['admin','super_admin','hr_team'])
  const canAssign   = hasRole(['admin','super_admin'])
  const canAssignHR = hasRole(['admin','super_admin'])
  const isSuperAdmin = hasRole(['super_admin'])
  const isAgency    = hasRole(['agency'])

  const { stageConfigs } = useStagesHook()
  const STAGES: string[] = stageConfigs.map(s => s.name)

  const { data: caSettings } = useQuery({
    queryKey: ['app-settings', 'cost_approval'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'cost_approval').maybeSingle()
      if (!data?.value) return { stageName: '' as string }
      try { return { stageName: (JSON.parse(data.value).stage_name ?? '') as string } } catch { return { stageName: '' as string } }
    },
    staleTime: 60_000,
  })
  const caStageForCleanup = caSettings?.stageName ?? ''

  const [serverFilters, setServerFilters] = useState<CandidateFilters>(() => ({
    job_id: searchParams.get('job') || undefined,
  }))
  const [search, setSearch]         = useState(() => searchParams.get('q') ?? '')
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>(() => {
    try { return JSON.parse(decodeURIComponent(searchParams.get('f') ?? '[]')) } catch { return [] }
  })
  const [filterMode, setFilterMode] = useState<'and'|'or'>(() =>
    (searchParams.get('fm') as 'and'|'or') ?? 'and'
  )

  useEffect(() => {
    const p: Record<string,string> = {}
    if (search) p.q = search
    if (serverFilters.job_id) p.job = serverFilters.job_id
    if (activeFilters.length) p.f = encodeURIComponent(JSON.stringify(activeFilters))
    if (filterMode !== 'and') p.fm = filterMode
    setSearchParams(p, { replace: true })
  }, [search, serverFilters, activeFilters, filterMode])

  const [showArchived, setShowArchived] = useState(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [showFilterBar, setShowFilterBar] = useState(false)
  const [showColPicker, setShowColPicker] = useState(false)
  const [showBulkMenu, setShowBulkMenu]   = useState(false)
  const [bulkField, setBulkField]         = useState<string|null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string|null>(null)
  const [groupBy, setGroupBy] = useState('')
  const LS_KEY = 'ats_col_layout_v1'
  const savedLayout = (() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') } catch { return {} }
  })()

  const [colOrder, setColOrder]       = useState<string[]>(savedLayout.colOrder ?? DEFAULT_ORDER)
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(savedLayout.visibleCols ?? [...DEFAULT_VISIBLE]))
  const [pinnedCols, setPinnedCols]   = useState<Set<string>>(new Set(savedLayout.pinnedCols ?? []))

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      colOrder,
      visibleCols: [...visibleCols],
      pinnedCols: [...pinnedCols],
    }))
  }, [colOrder, visibleCols, pinnedCols])

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

  const { data: jobs=[] } = useQuery({
    queryKey: ['jobs','filter', isAgency ? 'agency' : 'all'],
    queryFn: async () => {
      let q = supabase.from('jobs').select('id,title,show_to_agency').order('title')
      if (isAgency) q = (q as any).eq('show_to_agency', true)
      const { data } = await q
      return data ?? []
    }
  })
  // Only show HR Team + Admin in HR Owner dropdown (not super_admin — they're system users)
  const { data: hrUsers=[] }     = useQuery({ queryKey:['users','hr'],           queryFn:async()=>{const{data}=await supabase.from('users').select('id,full_name').in('role',['hr_team','admin']).eq('is_active',true).order('full_name');return data??[]} })
  const { data: interviewers=[] }= useQuery({ queryKey:['users','interviewers'], queryFn:async()=>{const{data}=await supabase.from('users').select('id,full_name').eq('role','interviewer').eq('is_active',true).order('full_name');return data??[]} })
  const { data: customFields=[] }= useQuery({ queryKey:['custom-fields'],        queryFn:async()=>{const{data}=await supabase.from('custom_fields').select('*').eq('is_active',true).order('sort_order');return data??[]} })

  // Core useCandidates hook query injection context handling
  const { data: candidates=[], isLoading } = useCandidates({ ...serverFilters, search:search||undefined })

  const AGENCY_HIDDEN = new Set(['hr_owner','interviewer'])
  const effectiveVisible = isAgency
    ? new Set([...DEFAULT_VISIBLE, 'subsource','email','phone','resume','notes','updated_at','source'].filter(k => !AGENCY_HIDDEN.has(k)))
    : visibleCols

  const orderedVisible = useMemo(() => {
    const cf = (customFields as any[])
      .filter((f:any) => f.show_in_columns !== false && (!isAgency || f.show_to_agency !== false))
      .map(f => `cf_${f.field_name}`)
    const all = [...colOrder, ...cf].filter(k => effectiveVisible.has(k))
    const pinned   = all.filter(k => pinnedCols.has(k))
    const unpinned = all.filter(k => !pinnedCols.has(k))
    return [...pinned, ...unpinned]
  }, [colOrder, effectiveVisible, customFields, pinnedCols, isAgency])

const displayed = useMemo(() => {
    let list = candidates.filter((c:any) => showArchived ? !!c.archived_at : !c.archived_at)

    const agencyId = user?.agency_id
    if (isAgency && agencyId) {
      list = list.filter((c:any) => c.agency_id === agencyId)
    }

    if (activeFilters.length) list = applyFilters(list, activeFilters, jobs as any[], interviewers as any[], filterMode, customFields as any[])
    return list
  }, [candidates, showArchived, activeFilters, jobs, interviewers, filterMode, customFields, isAgency, user])

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

  const updateField = useMutation({
    mutationFn: async({id,field,value,fromStage}:{id:string;field:string;value:any;fromStage?:string})=>{
      const updates: Record<string,any> = { [field]: value }
      if (field === 'current_stage' && value) {
        updates.interview_date = null
        // Log stage change for HR activity tracker (fire-and-forget)
        if (user?.id && fromStage && fromStage !== value) {
          supabase.rpc('log_stage_change', {
            p_candidate_id: id,
            p_from_stage:   fromStage,
            p_to_stage:     value,
            p_changed_by:   user.id,
          }).then()
        }
        if (caStageForCleanup) {
          const newIdx = STAGES.indexOf(value)
          const caIdx = STAGES.indexOf(caStageForCleanup)
          if (caIdx >= 0 && newIdx <= caIdx) {
            const { data: c } = await supabase.from('candidates').select('interview_notes').eq('id', id).maybeSingle()
            const notes: Record<string,any> = (c as any)?.interview_notes ?? {}
            const { cost_approval: _ca, cost_approval_comments: _cac, ...cleaned } = notes
            updates.cost_approval_decision = null
            updates.interview_notes = cleaned
          }
        }
      }
      const{error}=await supabase.from('candidates').update(updates).eq('id',id)
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
    mutationFn: async ({ field, value }: { field: string; value: any }) => {
      const ids = Array.from(selectedIds)
      let payload: Record<string, any>

      if (field === 'hr_owner') {
        payload = { hr_owner: value || null }
      } else if (field === 'assigned_interviewers') {
        payload = { assigned_interviewers: Array.isArray(value) ? value : [value] }
      } else {
        payload = { [field]: value }
      }

      const { error } = await supabase.from('candidates').update(payload).in('id', ids)
      if (error) { console.error('[bulkUpdate]', field, error); throw error }

      // Log bulk stage changes for HR activity tracker (fire-and-forget)
      if (field === 'current_stage' && value && user?.id) {
        const stageMap = Object.fromEntries(
          (candidates as any[]).filter((c:any) => ids.includes(c.id)).map((c:any) => [c.id, c.current_stage])
        )
        ids.forEach(cid => {
          const fromStage = stageMap[cid]
          if (fromStage && fromStage !== value) {
            supabase.rpc('log_stage_change', {
              p_candidate_id: cid,
              p_from_stage:   fromStage,
              p_to_stage:     value,
              p_changed_by:   user.id,
            }).then()
          }
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['hr-activity'] })
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

  const onUpdate  = useCallback((id:string,field:string,value:any)=>{
    const fromStage = field === 'current_stage'
      ? (candidates as any[]).find((c:any) => c.id === id)?.current_stage
      : undefined
    updateField.mutate({id,field,value,fromStage})
  },[updateField, candidates])
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
    ...COLS.filter(c => !isAgency || !['hr_owner','interviewer'].includes(c.key)),
    ...(customFields as any[])
      .filter((f:any) => f.show_in_columns !== false && (!isAgency || f.show_to_agency !== false))
      .map(f=>({key:`cf_${f.field_name}`,label:f.field_label,width:130}))
  ],[customFields, isAgency])

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
            <button onClick={()=>{setShowArchived(a=>!a);setSelectedIds(new Set())}}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-all ${showArchived?'bg-amber-50 border-amber-200 text-amber-700':'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
              <Archive className="w-3.5 h-3.5"/>
              {showArchived?'Active view':'Archived'}
            </button>

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
                        <button onClick={()=>setVisibleCols(p=>{const n=new Set(p);n.has(col.key)?n.delete(col.key):n.add(col.key);return n})}
                          className={`w-4 h-4 rounded border flex items-center justify-center transition-all flex-shrink-0 ${visibleCols.has(col.key)?'bg-blue-500 border-blue-500':'border-gray-300 hover:border-gray-400'}`}>
                          {visibleCols.has(col.key)&&<Check className="w-2.5 h-2.5 text-white"/>}
                        </button>
                        <span className="text-sm text-gray-700 flex-1">{col.label}</span>
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

            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5">
              <Layers className="w-3.5 h-3.5 text-gray-400"/>
              <select value={groupBy} onChange={e=>setGroupBy(e.target.value)}
                className="text-sm bg-transparent border-none outline-none text-gray-600 cursor-pointer">
                {GROUPS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {selectedIds.size>0 && !isAgency &&(
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
                      {[
                        ['current_stage',       'Change Stage'],
                        ['job_id',              'Assign Job'],
                        ['source_category',     'Change Source'],
                        ['source_name',         'Change Sub-Source'],
                        ['interview_date',      'Set Interview Date'],
                        ...(canAssignHR ? [['hr_owner','Assign HR Owner']] : [] as any),
                        ['assigned_interviewers','Assign Interviewer'],
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
                      {bulkField && bulkField !== '__delete__' && (
                        <div className="border-t border-gray-100 mt-1 pt-2 px-1 space-y-2" onClick={e=>e.stopPropagation()}>
                          {bulkField === 'interview_date' ? (
                            <input type="datetime-local"
                              value={bulkSelectValue}
                              onChange={e => setBulkSelectValue(e.target.value)}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"/>
                          ) : bulkField === 'source_name' ? (
                            <input type="text"
                              value={bulkSelectValue}
                              onChange={e => setBulkSelectValue(e.target.value)}
                              placeholder="e.g. IIT Delhi, Naukri, LinkedIn…"
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"/>
                          ) : (
                            <select
                              value={bulkSelectValue}
                              onChange={e => setBulkSelectValue(e.target.value)}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                              <option value="" disabled>Choose…</option>
                              {bulkField === 'current_stage'
                                ? STAGES.map(s => <option key={s} value={s}>{s}</option>)
                                : bulkField === 'job_id'
                                ? (jobs as any[]).map(j => <option key={j.id} value={j.id}>{j.title}</option>)
                                : bulkField === 'source_category'
                                ? [['platform','Platform'],['agency','Agency'],['college','College'],['referral','Employee Referral']].map(([s,l]) => <option key={s} value={s}>{l}</option>)
                                : bulkField === 'assigned_interviewers'
                                ? (interviewers as any[]).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)
                                : bulkField === 'hr_owner'
                                ? (hrUsers as any[]).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)
                                : null
                              }
                            </select>
                          )}
                          <button
                            disabled={bulkUpdate.isPending || !bulkSelectValue}
                            onClick={e => {
                              e.stopPropagation()
                              if (!bulkSelectValue) return
                              const val = bulkField === 'interview_date'
                                ? new Date(bulkSelectValue).toISOString()
                                : bulkSelectValue
                              bulkUpdate.mutate({ field: bulkField!, value: val })
                            }}
                            className="w-full py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5">
                            {bulkUpdate.isPending
                              ? <><Loader2 className="w-3 h-3 animate-spin"/>Updating…</>
                              : `Apply to ${selectedIds.size} candidate${selectedIds.size !== 1 ? 's' : ''}`
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
                      <div className="border-t border-gray-100 mt-1 pt-1">
                        <button
                          onClick={() => {
                            const sel = displayed.filter((c:any) => selectedIds.has(c.id))
                            exportCSV(sel, jobs as any[], hrUsers as any[])
                            setShowBulkMenu(false)
                          }}
                          className="w-full text-left text-sm px-3 py-2 rounded-lg text-blue-700 hover:bg-blue-50 transition-colors flex items-center gap-2">
                          <Download className="w-3.5 h-3.5"/>Download CSV
                        </button>
                      </div>
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
                jobs={jobs as any[]}
                interviewers={isAgency ? [] : interviewers as any[]}
                hrUsers={isAgency ? [] : hrUsers as any[]}
                mode={filterMode} onModeChange={setFilterMode}
                hideHrFields={isAgency}
                stages={STAGES}
                customFieldDefs={(customFields as any[])
                  .filter((f:any) => !isAgency || f.show_to_agency !== false)
                  .map(f=>({field_name:f.field_name,field_label:f.field_label,field_type:f.field_type}))}/>
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
                            <td className={`px-4 py-2.5 sticky left-0 z-10 ${isSel?'bg-blue-50':'bg-white group-hover/row:bg-gray-50/60'} after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-gray-100`}>
                              <input type="checkbox" checked={isSel} onChange={()=>toggleSel(c.id)}
                                className="rounded border-gray-300 text-blue-600 cursor-pointer w-4 h-4"/>
                            </td>
                            <td className={`px-4 py-2.5 sticky left-10 z-10 min-w-[180px] ${isSel?'bg-blue-50':'bg-white group-hover/row:bg-gray-50/60'} after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-gray-100`}>
                              <button onClick={()=>navigate(`/candidates/${c.id}`)}
                                className="font-medium text-gray-900 hover:text-blue-600 transition-colors text-left text-sm">{c.full_name}</button>
                            </td>
                            {orderedVisible.map(key=>{
                              if (key==='stage') return <td key="stage" className="px-3 py-2.5"><StageCell cid={c.id} value={c.current_stage} canEdit={canEdit} onUpdate={onUpdate} stages={STAGES} stageConfigs={stageConfigs}/></td>
                              if (key==='job') return <td key="job" className="px-3 py-2.5"><SelectCell cid={c.id} field="job_id" display={c.job?.title ?? getName(jobs as any[],c.job_id)} canEdit={canAssign} onUpdate={onUpdate} options={(jobs as any[]).map(j=>({label:j.title,value:j.id}))}/></td>
                              if (key==='ca_decision') {
                                const caEntries: any[] = c.interview_notes?.cost_approval ?? []
                                const decision: string = caEntries[caEntries.length - 1]?.decision ?? c.cost_approval_decision ?? ''
                                if (!decision) return <td key="ca_decision" className="px-3 py-2.5"><span className="text-gray-200 text-xs">—</span></td>
                                return <td key="ca_decision" className="px-3 py-2.5">
                                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md font-semibold ${
                                    decision === 'go_ahead'
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-orange-100 text-orange-700'
                                  }`}>
                                    {decision === 'go_ahead' ? '✓ Go Ahead' : '↺ Re-work'}
                                  </span>
                                </td>
                              }
                              if (key==='source') return <td key="source" className="px-3 py-2.5"><SourceCell cid={c.id} category={c.source_category} canEdit={canEdit} onUpdate={onUpdate}/></td>
                              if (key==='subsource') return <td key="subsource" className="px-3 py-2.5"><SubSourceCell cid={c.id} category={c.source_category} name={c.source_name??''} canEdit={canEdit} onUpdate={onUpdate}/></td>
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
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-0.5 justify-end">
                                {canEdit && !isAgency && (
                                  <ActionBtn onClick={()=>archiveOne.mutate({id:c.id,archive:!c.archived_at})} title={c.archived_at?'Unarchive':'Archive'}>
                                    <Archive className="w-3.5 h-3.5"/>
                                  </ActionBtn>
                                )}
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

    </div>
  )
}
