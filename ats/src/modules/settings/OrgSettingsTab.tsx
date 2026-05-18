// Org Settings Tab — Super Admin only
// Controls org email, sender name, rejection workflow
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { Check, Loader2, Mail, User, Building } from 'lucide-react'

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
