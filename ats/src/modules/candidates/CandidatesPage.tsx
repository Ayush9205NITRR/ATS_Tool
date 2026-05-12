import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Upload, UserPlus, Loader2, ExternalLink, FileText, ChevronDown, Eye, X, Archive, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCandidates } from './useCandidates'
import { PageHeader } from '../../shared/components/PageHeader'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { EmptyState } from '../../shared/components/EmptyState'
import { Modal } from '../../shared/components/Modal'
import { useAuthStore } from '../auth/authStore'
import { supabase } from '../../lib/supabaseClient'
import type { CandidateFilters } from './candidateService'
import type { SourceCategory } from '../../types/database.types'
import { INTERVIEW_STAGES } from '../../types/database.types'
import { formatDate } from '../../shared/utils/helpers'

const SOURCES: SourceCategory[] = ['platform', 'agency', 'college']

const DEFAULT_COLS = new Set(['stage','job','source','subsource','hr_owner','interviewer','interview_date'])

export function CandidatesPage() {
  const navigate = useNavigate()
  const { hasRole, user } = useAuthStore()
  const qc = useQueryClient()
  const canEdit      = hasRole(['admin', 'super_admin', 'hr_team'])
  const canAssign    = hasRole(['admin', 'super_admin'])
  const isSuperAdmin = hasRole(['super_admin'])
  const isHRTeam     = hasRole(['hr_team'])

  const [filters, setFilters]       = useState<CandidateFilters>({})
  const [search, setSearch]         = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editingCell, setEditingCell]   = useState<{id:string;field:string}|null>(null)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [showColPicker, setShowColPicker] = useState(false)
  const [showBulkMenu, setShowBulkMenu]   = useState(false)
  const [bulkField, setBulkField]         = useState<string|null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string|null>(null)
  const [visibleCols, setVisibleCols]     = useState<Set<string>>(DEFAULT_COLS)

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs','filter'],
    queryFn: async () => { const {data} = await supabase.from('jobs').select('id,title').order('title'); return data??[] },
  })
  const { data: hrUsers = [] } = useQuery({
    queryKey: ['users','hr'],
    queryFn: async () => { const {data} = await supabase.from('users').select('id,full_name').in('role',['hr_team','admin','super_admin']).eq('is_active',true); return data??[] },
  })
  const { data: interviewers = [] } = useQuery({
    queryKey: ['users','interviewers'],
    queryFn: async () => { const {data} = await supabase.from('users').select('id,full_name').eq('role','interviewer').eq('is_active',true); return data??[] },
  })
  const { data: customFields = [] } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => { const {data} = await supabase.from('custom_fields').select('*').eq('is_active',true).order('sort_order'); return data??[] },
  })

  const { data: candidates = [], isLoading } = useCandidates({ ...filters, search: search||undefined })

  const displayed = candidates.filter((c:any) => showArchived ? !!c.archived_at : !c.archived_at)

  const updateField = useMutation({
    mutationFn: async ({id,field,value}:{id:string;field:string;value:any}) => {
      const {error} = await supabase.from('candidates').update({[field]:value}).eq('id',id)
      if(error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({queryKey:['candidates']}); setEditingCell(null) },
  })

  const archiveOne = useMutation({
    mutationFn: async ({id,archive}:{id:string;archive:boolean}) => {
      const {error} = await supabase.from('candidates').update({archived_at:archive?new Date().toISOString():null,archived_by:archive?user!.id:null}).eq('id',id)
      if(error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({queryKey:['candidates']}); setSelectedIds(new Set()) },
  })

  const deleteOne = useMutation({
    mutationFn: async (id:string) => { const {error}=await supabase.from('candidates').delete().eq('id',id); if(error) throw error },
    onSuccess: () => { qc.invalidateQueries({queryKey:['candidates']}); setConfirmDelete(null) },
  })

  const bulkUpdate = useMutation({
    mutationFn: async ({field,value}:{field:string;value:any}) => {
      const {error}=await supabase.from('candidates').update({[field]:value}).in('id',Array.from(selectedIds))
      if(error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({queryKey:['candidates']}); setSelectedIds(new Set()); setBulkField(null); setShowBulkMenu(false) },
  })

  const bulkArchive = useMutation({
    mutationFn: async (archive:boolean) => {
      const {error}=await supabase.from('candidates').update({archived_at:archive?new Date().toISOString():null,archived_by:archive?user!.id:null}).in('id',Array.from(selectedIds))
      if(error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({queryKey:['candidates']}); setSelectedIds(new Set()) },
  })

  // Magic link
  const createMagicLink = useMutation({
    mutationFn: async (candidateId:string) => {
      const {data,error}=await supabase.from('magic_review_links').insert({candidate_id:candidateId,created_by:user!.id}).select().single()
      if(error) throw error
      const url = `${window.location.origin}/review/${data.id}`
      await navigator.clipboard.writeText(url)
      return url
    },
  })

  const setFilter = (key:keyof CandidateFilters,value:string) => setFilters(p=>({...p,[key]:value||undefined}))
  const toggleCol = (key:string) => setVisibleCols(p=>{const n=new Set(p);n.has(key)?n.delete(key):n.add(key);return n})
  const toggleSelect = (id:string) => setSelectedIds(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n})
  const toggleAll = () => setSelectedIds(selectedIds.size===displayed.length?new Set():new Set(displayed.map((c:any)=>c.id)))
  const getName = (list:any[],id:string|null) => id?list.find(u=>u.id===id)?.full_name??null:null
  const show = (key:string) => visibleCols.has(key)

  const ALL_COLUMNS = [
    {key:'email',label:'Email'},
    {key:'phone',label:'Phone'},
    {key:'linkedin',label:'LinkedIn'},
    {key:'resume',label:'Resume'},
    {key:'stage',label:'Stage'},
    {key:'job',label:'Job'},
    {key:'source',label:'Source'},
    {key:'subsource',label:'Sub-Source'},
    {key:'hr_owner',label:'HR Owner'},
    {key:'interviewer',label:'Interviewer'},
    {key:'interview_date',label:'Interview Date'},
    {key:'notes',label:'Notes'},
    ...(customFields as any[]).map(f=>({key:`cf_${f.field_name}`,label:f.field_label})),
  ]

  // Inline editable dropdown
  const EditDrop = ({cid,field,val,display,opts}:{cid:string;field:string;val:string|null;display?:string|null;opts:{label:string;value:string}[]}) => {
    if(!canEdit) return <span className="text-gray-600 text-xs">{display??val??'—'}</span>
    const isEditing = editingCell?.id===cid&&editingCell?.field===field
    return isEditing?(
      <select autoFocus defaultValue={val??''} onBlur={e=>updateField.mutate({id:cid,field,value:e.target.value||null})}
        className="w-full px-2 py-1 border border-blue-400 rounded text-xs bg-white focus:outline-none">
        <option value="">— None —</option>
        {opts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ):(
      <button onClick={()=>setEditingCell({id:cid,field})} className="flex items-center gap-1 text-xs text-gray-700 hover:text-blue-600 w-full text-left group/c">
        <span className="truncate max-w-[130px]">{display??val??<span className="text-gray-300">—</span>}</span>
        <ChevronDown className="w-3 h-3 text-gray-300 opacity-0 group-hover/c:opacity-100 group-hover/c:text-blue-400 flex-shrink-0"/>
      </button>
    )
  }

  return (
    <div>
      <PageHeader
        title={showArchived?'Archived':'Candidates'}
        subtitle={`${displayed.length} total${selectedIds.size>0?` · ${selectedIds.size} selected`:''}`}
        action={
          <div className="flex gap-2 flex-wrap justify-end">
            <Button variant={showArchived?'primary':'secondary'} size="sm" icon={<Archive className="w-3.5 h-3.5"/>}
              onClick={()=>{setShowArchived(!showArchived);setSelectedIds(new Set())}}>
              {showArchived?'Active':'Archived'}
            </Button>

            <div className="relative">
              <Button variant="secondary" size="sm" icon={<Eye className="w-3.5 h-3.5"/>} onClick={()=>{setShowColPicker(!showColPicker);setShowBulkMenu(false)}}>
                Columns
              </Button>
              {showColPicker&&(
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-3 w-48 max-h-72 overflow-y-auto">
                  <p className="text-xs font-semibold text-gray-500 mb-2">Show / Hide</p>
                  {ALL_COLUMNS.map(col=>(
                    <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer">
                      <input type="checkbox" checked={visibleCols.has(col.key)} onChange={()=>toggleCol(col.key)} className="rounded border-gray-300 text-blue-600"/>
                      <span className="text-sm text-gray-700">{col.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {selectedIds.size>0&&(
              <div className="relative">
                <Button size="sm" onClick={()=>{setShowBulkMenu(!showBulkMenu);setShowColPicker(false)}}>
                  Bulk ({selectedIds.size}) ▾
                </Button>
                {showBulkMenu&&(
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-3 w-56">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Bulk Actions</p>
                    <button onClick={()=>setBulkField('current_stage')} className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50 text-gray-700">Change Stage</button>
                    {canAssign&&<button onClick={()=>setBulkField('job_id')} className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50 text-gray-700">Assign Job</button>}
                    {canAssign&&<button onClick={()=>setBulkField('hr_owner')} className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50 text-gray-700">Assign HR Owner</button>}
                    {canAssign&&<button onClick={()=>setBulkField('assigned_interviewers')} className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50 text-gray-700">Assign Interviewer</button>}
                    <button onClick={()=>bulkArchive.mutate(!showArchived)} className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50 text-amber-600">
                      {showArchived?'Unarchive selected':'Archive selected'}
                    </button>
                    {isSuperAdmin&&(
                      <button onClick={()=>setBulkField('__delete__')} className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-red-50 text-red-600 border-t border-gray-100 mt-1 pt-2">
                        Delete selected permanently
                      </button>
                    )}
                    {bulkField&&bulkField!=='__delete__'&&(
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <p className="text-xs text-gray-500 mb-1">
                          {bulkField==='current_stage'?'Select Stage':bulkField==='hr_owner'?'Select HR Owner':bulkField==='job_id'?'Select Job':'Select Interviewer'}
                        </p>
                        <select autoFocus defaultValue="" onChange={e=>{if(e.target.value) bulkUpdate.mutate({field:bulkField,value:bulkField==='assigned_interviewers'?[e.target.value]:e.target.value})}}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none">
                          <option value="" disabled>Choose…</option>
                          {bulkField==='current_stage'
                            ?INTERVIEW_STAGES.map(s=><option key={s} value={s}>{s}</option>)
                            :bulkField==='job_id'
                            ?(jobs as any[]).map(j=><option key={j.id} value={j.id}>{j.title}</option>)
                            :bulkField==='assigned_interviewers'
                            ?(interviewers as any[]).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)
                            :(hrUsers as any[]).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)
                          }
                        </select>
                      </div>
                    )}
                    {bulkField==='__delete__'&&(
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <p className="text-xs text-red-600 mb-2 font-medium">Delete {selectedIds.size} candidates permanently?</p>
                        <div className="flex gap-2">
                          <button onClick={()=>setBulkField(null)} className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
                          <button
                            onClick={async()=>{
                              const {supabase} = await import('../../lib/supabaseClient')
                              const {error} = await supabase.from('candidates').delete().in('id',Array.from(selectedIds))
                              if(!error){qc.invalidateQueries({queryKey:['candidates']});setSelectedIds(new Set());setBulkField(null);setShowBulkMenu(false)}
                            }}
                            className="flex-1 px-2 py-1.5 bg-red-600 hover:bg-red-700 rounded text-xs text-white font-medium">
                            Delete All
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {canEdit&&!showArchived&&(
              <>
                <Button variant="secondary" size="sm" icon={<Upload className="w-3.5 h-3.5"/>} onClick={()=>navigate('/upload')}>Upload</Button>
                <Button size="sm" icon={<UserPlus className="w-3.5 h-3.5"/>} onClick={()=>navigate('/upload?mode=single')}>Add One</Button>
              </>
            )}
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or email…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <select value={filters.job_id??''} onChange={e=>setFilter('job_id',e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All jobs</option>
          {(jobs as any[]).map(j=><option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
        <select value={filters.stage??''} onChange={e=>setFilter('stage',e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All stages</option>
          {INTERVIEW_STAGES.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.source_category??''} onChange={e=>setFilter('source_category',e.target.value as SourceCategory)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All sources</option>
          {SOURCES.map(s=><option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
        {isSuperAdmin&&(
          <select onChange={e=>setFilter('hr_owner' as any,e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All HR owners</option>
            {(hrUsers as any[]).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        )}
        {(filters.stage||filters.source_category||filters.job_id||(filters as any).hr_owner||search)&&(
          <Button variant="ghost" size="sm" onClick={()=>{setFilters({});setSearch('')}}>Clear</Button>
        )}
      </div>

      {(showColPicker||showBulkMenu)&&<div className="fixed inset-0 z-20" onClick={()=>{setShowColPicker(false);setShowBulkMenu(false);setBulkField(null)}}/>}

      {isLoading?(
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
      ):displayed.length===0?(
        <EmptyState title={showArchived?'No archived candidates':'No candidates found'}
          description={showArchived?'Archive candidates from the active list.':'Upload your first candidate.'}
          action={canEdit&&!showArchived?<Button size="sm" onClick={()=>navigate('/upload')}>Upload</Button>:undefined}/>
      ):(
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" checked={selectedIds.size===displayed.length&&displayed.length>0} onChange={toggleAll} className="rounded border-gray-300 text-blue-600 cursor-pointer"/>
                  </th>
                  <th className="text-left px-3 py-3 font-medium">Name</th>
                  {show('email')&&<th className="text-left px-3 py-3 font-medium">Email</th>}
                  {show('phone')&&<th className="text-left px-3 py-3 font-medium">Phone</th>}
                  {show('linkedin')&&<th className="text-left px-3 py-3 font-medium">LinkedIn</th>}
                  {show('resume')&&<th className="text-left px-3 py-3 font-medium">Resume</th>}
                  {show('stage')&&<th className="text-left px-3 py-3 font-medium">Stage</th>}
                  {show('job')&&<th className="text-left px-3 py-3 font-medium">Job</th>}
                  {show('source')&&<th className="text-left px-3 py-3 font-medium">Source</th>}
                  {show('subsource')&&<th className="text-left px-3 py-3 font-medium">Sub-Source</th>}
                  {show('hr_owner')&&<th className="text-left px-3 py-3 font-medium">HR Owner</th>}
                  {show('interviewer')&&<th className="text-left px-3 py-3 font-medium">Interviewer</th>}
                  {show('interview_date')&&<th className="text-left px-3 py-3 font-medium">Interview Date</th>}
                  {show('notes')&&<th className="text-left px-3 py-3 font-medium">Notes</th>}
                  {(customFields as any[]).filter(f=>show(`cf_${f.field_name}`)).map(f=>(
                    <th key={f.id} className="text-left px-3 py-3 font-medium">{f.field_label}</th>
                  ))}
                  <th className="px-3 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayed.map((c:any)=>{
                  const isSelected=selectedIds.has(c.id)
                  const interviewerName = c.assigned_interviewers?.length>0 ? getName(interviewers as any[],c.assigned_interviewers[0]) : null
                  return(
                    <tr key={c.id} className={`transition-colors group ${isSelected?'bg-blue-50/60':'hover:bg-gray-50/50'} ${c.archived_at?'opacity-50':''}`}>
                      <td className="px-3 py-2.5 w-10">
                        <input type="checkbox" checked={isSelected} onChange={()=>toggleSelect(c.id)} className="rounded border-gray-300 text-blue-600 cursor-pointer"/>
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={()=>navigate(`/candidates/${c.id}`)} className="font-medium text-blue-600 hover:underline text-left text-sm whitespace-nowrap">{c.full_name}</button>
                      </td>
                      {show('email')&&<td className="px-3 py-2.5"><a href={`mailto:${c.email}`} className="text-gray-500 hover:text-blue-600 text-xs">{c.email}</a></td>}
                      {show('phone')&&<td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{c.phone??'—'}</td>}
                      {show('linkedin')&&<td className="px-3 py-2.5">{c.linkedin_url?<a href={c.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs"><ExternalLink className="w-3 h-3"/>View</a>:<span className="text-gray-300 text-xs">—</span>}</td>}
                      {show('resume')&&<td className="px-3 py-2.5">{c.resume_url?<a href={c.resume_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs"><FileText className="w-3 h-3"/>View</a>:<span className="text-gray-300 text-xs">—</span>}</td>}
                      {show('stage')&&<td className="px-3 py-2.5 min-w-[120px]"><EditDrop cid={c.id} field="current_stage" val={c.current_stage} opts={INTERVIEW_STAGES.map(s=>({label:s,value:s}))}/></td>}
                      {show('job')&&<td className="px-3 py-2.5 min-w-[130px]"><EditDrop cid={c.id} field="job_id" val={c.job_id} display={getName(jobs as any[],c.job_id)} opts={(jobs as any[]).map(j=>({label:j.title,value:j.id}))}/></td>}
                      {show('source')&&<td className="px-3 py-2.5 min-w-[100px]"><EditDrop cid={c.id} field="source_category" val={c.source_category} opts={SOURCES.map(s=>({label:s.charAt(0).toUpperCase()+s.slice(1),value:s}))}/></td>}
                      {show('subsource')&&<td className="px-3 py-2.5 text-xs text-gray-600">{c.source_name}</td>}
                      {show('hr_owner')&&<td className="px-3 py-2.5 min-w-[120px]">{canAssign?<EditDrop cid={c.id} field="hr_owner" val={c.hr_owner} display={getName(hrUsers as any[],c.hr_owner)} opts={(hrUsers as any[]).map(u=>({label:u.full_name,value:u.id}))}/>:<span className="text-xs text-gray-600">{getName(hrUsers as any[],c.hr_owner)??'—'}</span>}</td>}
                      {show('interviewer')&&<td className="px-3 py-2.5 min-w-[120px]">{canAssign?<EditDrop cid={c.id} field="assigned_interviewers" val={c.assigned_interviewers?.[0]??null} display={interviewerName} opts={(interviewers as any[]).map(u=>({label:u.full_name,value:u.id}))}/>:<span className="text-xs text-gray-600">{interviewerName??'—'}</span>}</td>}
                      {show('interview_date')&&<td className="px-3 py-2.5 min-w-[110px]">
                        {editingCell?.id===c.id&&editingCell?.field==='interview_date'?(
                          <input type="date" defaultValue={c.interview_date??''} autoFocus
                            onBlur={e=>updateField.mutate({id:c.id,field:'interview_date',value:e.target.value||null})}
                            className="w-full px-2 py-1 border border-blue-400 rounded text-xs bg-white focus:outline-none"/>
                        ):(
                          <button onClick={()=>canEdit&&setEditingCell({id:c.id,field:'interview_date'})} className="text-xs text-gray-600 hover:text-blue-600 flex items-center gap-1 group/d">
                            {c.interview_date?formatDate(c.interview_date):<span className="text-gray-300">Set date</span>}
                            {canEdit&&<ChevronDown className="w-3 h-3 opacity-0 group-hover/d:opacity-100 text-blue-400"/>}
                          </button>
                        )}
                      </td>}
                      {show('notes')&&<td className="px-3 py-2.5 max-w-[140px]">{c.notes?<p className="text-gray-500 text-xs truncate">{c.notes}</p>:<span className="text-gray-300 text-xs">—</span>}</td>}
                      {(customFields as any[]).filter(f=>show(`cf_${f.field_name}`)).map(f=>(
                        <td key={f.id} className="px-3 py-2.5 text-xs text-gray-600">{c.custom_data?.[f.field_name]??'—'}</td>
                      ))}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {canAssign&&(
                            <button onClick={async()=>{await createMagicLink.mutateAsync(c.id); alert('Link copied to clipboard!')}}
                              className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors text-xs font-medium" title="Copy shareable link">
                              🔗
                            </button>
                          )}
                          <button onClick={()=>archiveOne.mutate({id:c.id,archive:!c.archived_at})}
                            className="p-1.5 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title={c.archived_at?'Unarchive':'Archive'}>
                            <Archive className="w-3.5 h-3.5"/>
                          </button>
                          {isSuperAdmin&&(
                            <button onClick={()=>setConfirmDelete(c.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                              <Trash2 className="w-3.5 h-3.5"/>
                            </button>
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
            <p className="text-xs text-gray-400">Click Stage, Job, Source, HR Owner or Interviewer to edit · Hover for actions · 🔗 to share</p>
            {selectedIds.size>0&&<button onClick={()=>setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><X className="w-3 h-3"/>Clear selection</button>}
          </div>
        </div>
      )}

      <Modal open={!!confirmDelete} onClose={()=>setConfirmDelete(null)} title="Delete Candidate" size="sm">
        <p className="text-sm text-gray-600 mb-4">This permanently deletes the candidate and all data. Consider archiving instead.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={()=>setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" loading={deleteOne.isPending} onClick={()=>confirmDelete&&deleteOne.mutate(confirmDelete)}>Delete Permanently</Button>
        </div>
      </Modal>
    </div>
  )
}
