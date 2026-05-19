// Org Settings Tab — Super Admin only
// Controls org email, sender name, rejection workflow
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { Check, Loader2, Mail, User, Building, Plus, X, GripVertical } from 'lucide-react'
import { useStages, useSaveStages, DEFAULT_STAGES } from '../../shared/hooks/useStages'

interface Setting { key: string; value: string }

const SETTINGS_KEYS = ['org_email', 'org_name', 'org_sender_name']
const LABELS: Record<string, { label: string; hint: string; icon: React.ReactNode }> = {
  org_email:       { label: 'From Email Address', hint: 'e.g. hiring@enout.in — used as sender in all candidate emails', icon: <Mail className="w-4 h-4"/> },
  org_name:        { label: 'Organisation Name',  hint: 'Shown in email signatures and templates', icon: <Building className="w-4 h-4"/> },
  org_sender_name: { label: 'Sender Display Name', hint: 'e.g. "Enout Hiring Team" — shown in From field', icon: <User className="w-4 h-4"/> },
}

export function OrgSettingsTab() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const isSuperAdmin = hasRole(['super_admin'])

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('key,value').in('key', SETTINGS_KEYS)
      return (data ?? []) as Setting[]
    },
    staleTime: 30_000,
  })

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saved, setSaved]   = useState<string | null>(null)

  const getValue = (key: string) =>
    drafts[key] !== undefined ? drafts[key] : settings.find(s => s.key === key)?.value ?? ''

  const saveSetting = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const { error } = await supabase.from('app_settings')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: (_, { key }) => {
      qc.invalidateQueries({ queryKey: ['app-settings'] })
      qc.invalidateQueries({ queryKey: ['settings', 'org-email'] })
      setSaved(key)
      setTimeout(() => setSaved(null), 2000)
    },
  })

  if (!isSuperAdmin) return (
    <div className="py-12 text-center text-sm text-gray-400">Super Admin access required.</div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Organisation Settings</h3>
        <p className="text-xs text-gray-500">These values are used in all outgoing emails and calendar invites.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400"/></div>
      ) : (
        <div className="space-y-4">
          {SETTINGS_KEYS.map(key => {
            const meta = LABELS[key]
            const val = getValue(key)
            const isDirty = drafts[key] !== undefined && drafts[key] !== settings.find(s => s.key === key)?.value
            return (
              <div key={key} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-gray-400">{meta.icon}</span>
                  <label className="text-sm font-medium text-gray-900">{meta.label}</label>
                </div>
                <p className="text-xs text-gray-400 mb-2.5">{meta.hint}</p>
                <div className="flex gap-2">
                  <input
                    value={val}
                    onChange={e => setDrafts(p => ({ ...p, [key]: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder={meta.hint}
                  />
                  <button
                    onClick={() => saveSetting.mutate({ key, value: val })}
                    disabled={!isDirty || saveSetting.isPending}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                      saved === key
                        ? 'bg-green-500 text-white'
                        : isDirty
                        ? 'bg-gray-900 text-white hover:bg-gray-800'
                        : 'bg-gray-100 text-gray-400 cursor-default'
                    }`}>
                    {saved === key
                      ? <><Check className="w-3.5 h-3.5"/>Saved</>
                      : saveSetting.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin"/>
                      : 'Save'
                    }
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Stage Editor */}
      <StageEditor/>

      {/* Rejection Workflow */}
      <RejectionWorkflow/>
    </div>
  )
}

// ── Rejection Workflow ────────────────────────────────────────
function RejectionWorkflow() {
  const qc = useQueryClient()
  const [name, setName]     = useState('')
  const [subject, setSubject] = useState('Application Update — {job}')
  const [body, setBody]     = useState(`Dear {name},

Thank you for your interest in the {job} position at {company} and for taking the time to go through our hiring process.

After careful consideration, we've decided to move forward with other candidates whose qualifications more closely match our current requirements.

We appreciate your effort and encourage you to apply for future openings that match your profile.

Wishing you all the best in your career journey.

Warm regards,
{sender_name}
{company}`)
  const [saved, setSaved] = useState(false)

  const { data: templates = [] } = useQuery({
    queryKey: ['email-templates', 'rejection'],
    queryFn: async () => {
      const { data } = await supabase.from('email_templates').select('*').eq('type','rejection').eq('is_active',true).order('created_at')
      return data ?? []
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('email_templates').insert({
        name, subject, body, type: 'rejection', is_active: true,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates'] })
      setSaved(true); setName(''); setTimeout(() => setSaved(false), 2000)
    },
  })

  const del = useMutation({
    mutationFn: async (id: string) => { await supabase.from('email_templates').delete().eq('id', id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-templates'] }),
  })

  const VARS = ['{name}', '{job}', '{company}', '{sender_name}', '{interviewer}', '{date}']

  return (
    <div className="border-t border-gray-100 pt-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Rejection Email Workflow</h3>
        <p className="text-xs text-gray-500">Create reusable rejection templates. Variables are auto-filled when sending.</p>
      </div>

      {/* Variable reference */}
      <div className="flex flex-wrap gap-1.5">
        {VARS.map(v => (
          <span key={v} className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{v}</span>
        ))}
        <span className="text-xs text-gray-400 self-center">— available variables</span>
      </div>

      {/* Existing templates */}
      {(templates as any[]).length > 0 && (
        <div className="space-y-2">
          {(templates as any[]).map((t: any) => (
            <div key={t.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t.subject}</p>
              </div>
              <button onClick={() => del.mutate(t.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors">Delete</button>
            </div>
          ))}
        </div>
      )}

      {/* Create new */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">New rejection template</p>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Template name (e.g. Standard Rejection)"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        <input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Email subject"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        <textarea value={body} onChange={e=>setBody(e.target.value)} rows={8}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"/>
        <button onClick={()=>create.mutate()} disabled={!name||!subject||!body||create.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors">
          {saved ? <><Check className="w-3.5 h-3.5"/>Saved!</> : 'Save template'}
        </button>
      </div>
    </div>
  )
}

// ── Stage Editor — Super Admin only ───────────────────────────
function StageEditor() {
  const { stages, isLoading } = useStages()
  const saveStages = useSaveStages()
  const [draft, setDraft] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [newStage, setNewStage] = useState('')
  const [saved, setSaved] = useState(false)

  const startEdit = () => { setDraft([...stages]); setEditing(true); setSaved(false) }
  const cancel    = () => { setEditing(false); setDraft([]) }

  const addStage = () => {
    const s = newStage.trim()
    if (!s || draft.includes(s)) return
    setDraft(p => [...p, s])
    setNewStage('')
  }

  const removeStage = (s: string) => setDraft(p => p.filter(x => x !== s))

  const moveUp   = (i: number) => { if (i===0) return; const n=[...draft]; [n[i-1],n[i]]=[n[i],n[i-1]]; setDraft(n) }
  const moveDown = (i: number) => { if (i===draft.length-1) return; const n=[...draft]; [n[i],n[i+1]]=[n[i+1],n[i]]; setDraft(n) }

  const save = async () => {
    if (!draft.length) return
    await saveStages.mutateAsync(draft)
    setSaved(true); setEditing(false); setDraft([])
    setTimeout(() => setSaved(false), 2000)
  }

  const reset = async () => {
    await saveStages.mutateAsync(DEFAULT_STAGES)
    setSaved(true); setEditing(false); setDraft([])
  }

  return (
    <div className="border-t border-gray-100 pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Pipeline Stages</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Changes reflect everywhere — Candidate page, Profile, Notes, Filters.
          </p>
        </div>
        {!editing ? (
          <div className="flex gap-2">
            <button onClick={reset}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded transition-colors">
              Reset to default
            </button>
            <button onClick={startEdit}
              className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
              Edit stages
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={cancel} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded">Cancel</button>
            <button onClick={save} disabled={saveStages.isPending || !draft.length}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1 transition-colors">
              {saveStages.isPending ? <Loader2 className="w-3 h-3 animate-spin"/> : saved ? <Check className="w-3 h-3"/> : null}
              Save & apply
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          {/* Ordered stage list */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {draft.map((s, i) => (
              <div key={s} className={`flex items-center gap-2 px-3 py-2.5 ${i>0?'border-t border-gray-50':''} group hover:bg-gray-50/50`}>
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveUp(i)} disabled={i===0}
                    className="text-gray-200 hover:text-gray-500 disabled:opacity-0 leading-none text-xs">▲</button>
                  <button onClick={() => moveDown(i)} disabled={i===draft.length-1}
                    className="text-gray-200 hover:text-gray-500 disabled:opacity-0 leading-none text-xs">▼</button>
                </div>
                <span className="w-5 h-5 flex items-center justify-center text-xs text-gray-400 font-mono">{i+1}</span>
                <span className="flex-1 text-sm text-gray-800">{s}</span>
                {/* Protect terminal stages */}
                {!['Hired','Rejected'].includes(s) ? (
                  <button onClick={() => removeStage(s)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all">
                    <X className="w-3.5 h-3.5"/>
                  </button>
                ) : (
                  <span className="text-xs text-gray-300 opacity-0 group-hover:opacity-100">locked</span>
                )}
              </div>
            ))}
          </div>

          {/* Add new stage */}
          <div className="flex gap-2">
            <input value={newStage} onChange={e => setNewStage(e.target.value)}
              onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); addStage() }}}
              placeholder="Add a new stage…"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
            <button onClick={addStage} disabled={!newStage.trim()}
              className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center gap-1">
              <Plus className="w-4 h-4"/>Add
            </button>
          </div>
          <p className="text-xs text-gray-400">⚠️ Hired and Rejected are terminal stages and cannot be removed. Changing stage names will not retroactively update existing candidates.</p>
        </div>
      ) : (
        /* Read-only view */
        <div className="flex flex-wrap gap-1.5">
          {(isLoading ? DEFAULT_STAGES : stages).map((s, i) => (
            <div key={s} className="flex items-center gap-1 bg-gray-100 text-gray-600 text-xs px-2.5 py-1 rounded-full">
              <span className="text-gray-400 font-mono">{i+1}.</span>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
