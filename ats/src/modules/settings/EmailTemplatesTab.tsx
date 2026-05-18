// ============================================================
// EMAIL TEMPLATES TAB — Super Admin controlled
// Variables: {name}, {job}, {interviewer}, {date}, {company},
//            {sender_name}, {mode}, {jd_link}, {resume_note}
// ============================================================
import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Check, X, Mail, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'

const TEMPLATE_TYPES = [
  { value: 'interview_invite', label: 'Interview Invite', color: 'bg-blue-50 text-blue-700' },
  { value: 'stage_update',     label: 'Stage Update',    color: 'bg-amber-50 text-amber-700' },
  { value: 'rejection',        label: 'Rejection',       color: 'bg-red-50 text-red-700' },
  { value: 'custom',           label: 'Custom',          color: 'bg-gray-100 text-gray-600' },
]

const VARIABLES = ['{name}','{job}','{company}','{interviewer}','{date}','{mode}','{sender_name}','{jd_link}','{resume_note}']

interface Template {
  id: string; name: string; type: string; subject: string; body: string
  from_email: string; from_name: string; is_active: boolean
}

export function EmailTemplatesTab() {
  const { hasRole } = useAuthStore()
  const qc = useQueryClient()
  const isSuperAdmin = hasRole(['super_admin'])
  const canEdit = hasRole(['super_admin', 'admin'])

  const [editing, setEditing]   = useState<Partial<Template> | null>(null)
  const [isNew, setIsNew]       = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['email-templates'],
    queryFn: async () => {
      const { data } = await supabase.from('email_templates').select('*').order('type').order('name')
      return (data ?? []) as Template[]
    },
  })

  const save = useMutation({
    mutationFn: async (t: Partial<Template>) => {
      if (t.id) {
        const { error } = await supabase.from('email_templates')
          .update({ name:t.name,type:t.type,subject:t.subject,body:t.body,from_email:t.from_email,from_name:t.from_name,updated_at:new Date().toISOString() })
          .eq('id', t.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('email_templates')
          .insert({ name:t.name,type:t.type,subject:t.subject,body:t.body,from_email:t.from_email||'hiring@enout.in',from_name:t.from_name||'Hiring Team' })
        if (error) throw error
      }
    },
    onSuccess: () => { qc.invalidateQueries({queryKey:['email-templates']}); setEditing(null); setIsNew(false) },
  })

  const del = useMutation({
    mutationFn: async (id: string) => { const{error}=await supabase.from('email_templates').delete().eq('id',id); if(error)throw error },
    onSuccess: () => qc.invalidateQueries({queryKey:['email-templates']}),
  })

  const toggle = useMutation({
    mutationFn: async ({id,is_active}:{id:string;is_active:boolean}) => {
      const{error}=await supabase.from('email_templates').update({is_active}).eq('id',id); if(error)throw error
    },
    onSuccess: () => qc.invalidateQueries({queryKey:['email-templates']}),
  })

  // Insert variable at cursor in body textarea
  const insertVar = useCallback((v: string) => {
    if (!bodyRef.current) return
    const el = bodyRef.current
    const start = el.selectionStart, end = el.selectionEnd
    const cur = editing?.body ?? ''
    const next = cur.slice(0,start) + v + cur.slice(end)
    setEditing(p => p ? {...p, body:next} : null)
    setTimeout(() => { el.focus(); el.setSelectionRange(start+v.length,start+v.length) }, 0)
  }, [editing?.body])

  const typeInfo = (type: string) => TEMPLATE_TYPES.find(t=>t.value===type)

  if (editing !== null) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">{isNew ? 'New Template' : 'Edit Template'}</h3>
          <div className="flex gap-2">
            <button onClick={()=>{setEditing(null);setIsNew(false)}}
              className="px-3 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={()=>save.mutate(editing)} disabled={save.isPending||!editing.name||!editing.subject||!editing.body}
              className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5"/>Save template
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Template Name *</label>
            <input value={editing.name??''} onChange={e=>setEditing(p=>p?{...p,name:e.target.value}:null)}
              placeholder="e.g. Rejection - Senior Role"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
            <select value={editing.type??'custom'} onChange={e=>setEditing(p=>p?{...p,type:e.target.value}:null)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              {TEMPLATE_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From Name</label>
            <input value={editing.from_name??'Hiring Team'} onChange={e=>setEditing(p=>p?{...p,from_name:e.target.value}:null)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From Email</label>
            <input value={editing.from_email??'hiring@enout.in'} onChange={e=>setEditing(p=>p?{...p,from_email:e.target.value}:null)}
              type="email"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Email Subject *</label>
          <input value={editing.subject??''} onChange={e=>setEditing(p=>p?{...p,subject:e.target.value}:null)}
            placeholder="Your Interview for {job} at {company}"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-600">Email Body * <span className="font-normal text-gray-400">— click to insert variables</span></label>
          </div>
          {/* Variable pills */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {VARIABLES.map(v=>(
              <button key={v} onClick={()=>insertVar(v)}
                className="text-xs px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-full hover:bg-blue-100 transition-colors font-mono">
                {v}
              </button>
            ))}
          </div>
          <textarea
            ref={bodyRef}
            rows={14}
            value={editing.body??''}
            onChange={e=>setEditing(p=>p?{...p,body:e.target.value}:null)}
            placeholder="Dear {name}, ..."
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"/>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
          <p className="text-xs font-medium text-blue-800 mb-1">Variable Reference</p>
          <div className="grid grid-cols-2 gap-1 text-xs text-blue-700">
            {[
              ['{name}','Candidate name'],
              ['{job}','Job title'],
              ['{company}','Company name'],
              ['{interviewer}','Interviewer name'],
              ['{date}','Interview date/time'],
              ['{mode}','Meeting link/location'],
              ['{sender_name}','HR person name'],
              ['{jd_link}','Job description link'],
              ['{resume_note}','Resume reference'],
            ].map(([v,d])=>(
              <div key={v} className="flex gap-1.5"><span className="font-mono">{v}</span><span className="text-blue-500">→ {d}</span></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">Manage email templates for candidate communications.</p>
          <p className="text-xs text-gray-400 mt-0.5">Super Admin controls From email address and template content.</p>
        </div>
        {canEdit && (
          <button onClick={()=>{setEditing({name:'',type:'custom',subject:'',body:'',from_email:'hiring@enout.in',from_name:'Hiring Team'});setIsNew(true)}}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">
            <Plus className="w-3.5 h-3.5"/>New template
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Loading templates…</div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => {
            const ti = typeInfo(t.type)
            return (
              <div key={t.id} className={`bg-white rounded-xl border border-gray-100 p-4 transition-colors ${!t.is_active?'opacity-50':''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ti?.color??'bg-gray-100 text-gray-600'}`}>{ti?.label??t.type}</span>
                      <p className="text-sm font-medium text-gray-900">{t.name}</p>
                    </div>
                    <p className="text-xs text-gray-500 truncate">Subject: {t.subject}</p>
                    <p className="text-xs text-gray-400 mt-0.5">From: {t.from_name} &lt;{t.from_email}&gt;</p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={()=>toggle.mutate({id:t.id,is_active:!t.is_active})}
                        className={`text-xs px-2 py-0.5 rounded-full ${t.is_active?'bg-green-50 text-green-600 hover:bg-green-100':'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                        {t.is_active?'Active':'Off'}
                      </button>
                      <button onClick={()=>{setEditing(t);setIsNew(false)}}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                        <Pencil className="w-3.5 h-3.5"/>
                      </button>
                      {isSuperAdmin && (
                        <button onClick={()=>del.mutate(t.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5"/>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {templates.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Mail className="w-8 h-8 mx-auto mb-2 opacity-40"/>
              <p className="text-sm">No templates yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
