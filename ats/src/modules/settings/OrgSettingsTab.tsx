// Org Settings Tab — Super Admin only
// Controls org name, pipeline stages, cost approval, referral list
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { Check, Loader2, Building, Plus, X, ShieldCheck } from 'lucide-react'
import { useStages, useSaveStages, DEFAULT_STAGE_CONFIGS, COLOR_OPTIONS, type StageConfig } from '../../shared/hooks/useStages'

interface Setting { key: string; value: string }

const SETTINGS_KEYS = ['org_name']
const LABELS: Record<string, { label: string; hint: string; icon: React.ReactNode }> = {
  org_name: { label: 'Organisation Name', hint: 'Shown across the app and on candidate-facing pages', icon: <Building className="w-4 h-4"/> },
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
        <p className="text-xs text-gray-500">Your organisation details, shown across the app.</p>
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

      {/* Cost Approval Settings */}
      <CostApprovalSettingsSection/>

      {/* Employee Referral List */}
      <EmployeeListSection/>
    </div>
  )
}

// ── Employee Referral List ────────────────────────────────────
function EmployeeListSection() {
  const qc = useQueryClient()
  const [newEmployee, setNewEmployee] = useState('')
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState<string[] | null>(null)

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employee-referral-list'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'employee_referral_list').maybeSingle()
      if (!data?.value) return [] as string[]
      try { return JSON.parse(data.value) as string[] } catch { return [] as string[] }
    },
    staleTime: 30_000,
  })

  const currentList = draft ?? employees

  const addEmployee = () => {
    const trimmed = newEmployee.trim()
    if (!trimmed || currentList.includes(trimmed)) return
    setDraft([...currentList, trimmed])
    setNewEmployee('')
  }

  const removeEmployee = (name: string) => setDraft(currentList.filter(e => e !== name))

  const save = async () => {
    const { error } = await supabase.from('app_settings').upsert({
      key: 'employee_referral_list',
      value: JSON.stringify([...currentList].sort()),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    if (error) { console.error('[employee list save]', error); return }
    qc.invalidateQueries({ queryKey: ['employee-referral-list'] })
    setSaved(true)
    setDraft(null)
    setTimeout(() => setSaved(false), 2000)
  }

  const isDirty = draft !== null

  return (
    <div className="border-t border-gray-100 pt-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Employee Referral List</h3>
        <p className="text-xs text-gray-500">Manage the list of employees available as referrers when adding candidates via Employee Referral source.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-gray-400"/></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex gap-2">
            <input
              value={newEmployee}
              onChange={e => setNewEmployee(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmployee() } }}
              placeholder="Employee full name…"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button onClick={addEmployee} disabled={!newEmployee.trim()}
              className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-40 flex items-center gap-1 transition-colors flex-shrink-0">
              <Plus className="w-4 h-4"/> Add
            </button>
          </div>

          {currentList.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No employees added yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {[...currentList].sort().map(e => (
                <span key={e} className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 border border-gray-200 px-2.5 py-1 rounded-full">
                  {e}
                  <button onClick={() => removeEmployee(e)} className="text-gray-400 hover:text-red-500 transition-colors ml-0.5">
                    <X className="w-3 h-3"/>
                  </button>
                </span>
              ))}
            </div>
          )}

          {isDirty && (
            <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
              <button onClick={save}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium transition-all ${
                  saved ? 'bg-green-500 text-white' : 'bg-gray-900 text-white hover:bg-gray-800'
                }`}>
                {saved ? <><Check className="w-3.5 h-3.5"/>Saved</> : 'Save changes'}
              </button>
              <button onClick={() => setDraft(null)} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
                Discard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Stage Editor — Super Admin only ───────────────────────────
function StageEditor() {
  const { stageConfigs, isLoading } = useStages()
  const saveStages = useSaveStages()
  const [draft, setDraft] = useState<StageConfig[]>([])
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[0])
  const [saved, setSaved] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  const startEdit = () => { setDraft(stageConfigs.map(s => ({...s}))); setEditing(true); setSaved(false) }
  const cancel    = () => { setEditing(false); setDraft([]); setEditingIdx(null) }

  const addStage = () => {
    const n = newName.trim()
    if (!n || draft.some(s => s.name === n)) return
    setDraft(p => [...p, { name:n, color:newColor.bg, textColor:newColor.text, hasNotes:true }])
    setNewName('')
  }

  const remove   = (i: number) => setDraft(p => p.filter((_,j) => j !== i))
  const moveUp   = (i: number) => { if (i===0) return; const n=[...draft]; [n[i-1],n[i]]=[n[i],n[i-1]]; setDraft(n) }
  const moveDown = (i: number) => { if (i===draft.length-1) return; const n=[...draft]; [n[i],n[i+1]]=[n[i+1],n[i]]; setDraft(n) }

  const update = (i: number, patch: Partial<StageConfig>) =>
    setDraft(p => p.map((s,j) => j===i ? {...s,...patch} : s))

  const save = async () => {
    if (!draft.length) return
    await saveStages.mutateAsync(draft)
    setSaved(true); setEditing(false); setDraft([]); setEditingIdx(null)
    setTimeout(() => setSaved(false), 2000)
  }

  const reset = async () => {
    await saveStages.mutateAsync(DEFAULT_STAGE_CONFIGS)
    setSaved(true); setEditing(false); setDraft([]); setEditingIdx(null)
  }

  const configs = isLoading ? DEFAULT_STAGE_CONFIGS : stageConfigs

  return (
    <div className="border-t border-gray-100 pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Pipeline Stages</h3>
          <p className="text-xs text-gray-500 mt-0.5">Rename, reorder, set colors, and control which stages show a notes section.</p>
        </div>
        {!editing ? (
          <div className="flex gap-2">
            <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded transition-colors">Reset default</button>
            <button onClick={startEdit} className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">Edit stages</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={cancel} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded">Cancel</button>
            <button onClick={save} disabled={saveStages.isPending || !draft.length}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5 transition-colors">
              {saveStages.isPending ? <Loader2 className="w-3 h-3 animate-spin"/> : saved ? <Check className="w-3 h-3"/> : null}
              Save & apply
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-50">
            {draft.map((s, i) => (
              <div key={i} className="px-3 py-2.5 hover:bg-gray-50/40 transition-colors">
                <div className="flex items-center gap-2">
                  {/* Reorder */}
                  <div className="flex flex-col gap-0 flex-shrink-0">
                    <button onClick={() => moveUp(i)} disabled={i===0} className="text-gray-200 hover:text-gray-500 disabled:opacity-0 leading-[1.1] text-xs">▲</button>
                    <button onClick={() => moveDown(i)} disabled={i===draft.length-1} className="text-gray-200 hover:text-gray-500 disabled:opacity-0 leading-[1.1] text-xs">▼</button>
                  </div>
                  {/* Color swatch */}
                  <button onClick={() => setEditingIdx(editingIdx===i ? null : i)}
                    className={`w-6 h-6 rounded-full flex-shrink-0 border-2 ${s.color} ${editingIdx===i?'border-gray-500':'border-transparent'} hover:border-gray-400 transition-all`}/>
                  {/* Name (editable inline) */}
                  <input value={s.name}
                    onChange={e => update(i, { name: e.target.value })}
                    className="flex-1 text-sm bg-transparent border-b border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none py-0.5 transition-colors"/>
                  {/* Notes toggle */}
                  <button onClick={() => update(i, { hasNotes: !s.hasNotes })}
                    title={s.hasNotes ? 'Notes enabled — click to disable' : 'Notes disabled — click to enable'}
                    className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 transition-colors ${
                      s.hasNotes ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-400 border-gray-200'
                    }`}>
                    {s.hasNotes ? '📝 Notes on' : 'Notes off'}
                  </button>
                  {/* Delete */}
                  {!['Hired','Rejected'].includes(s.name) ? (
                    <button onClick={() => remove(i)} className="text-gray-200 hover:text-red-500 transition-colors flex-shrink-0">
                      <X className="w-3.5 h-3.5"/>
                    </button>
                  ) : <div className="w-3.5"/>}
                </div>
                {/* Color picker (inline expand) */}
                {editingIdx === i && (
                  <div className="mt-2.5 pl-8 flex flex-wrap gap-1.5">
                    {COLOR_OPTIONS.map(opt => (
                      <button key={opt.bg} onClick={() => { update(i, { color:opt.bg, textColor:opt.text }); setEditingIdx(null) }}
                        title={opt.label}
                        className={`w-6 h-6 rounded-full ${opt.bg} border-2 hover:scale-110 transition-transform ${s.color===opt.bg?'border-gray-600':'border-transparent'}`}/>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add new stage */}
          <div className="flex gap-2 items-center">
            {/* Color for new stage */}
            <div className="relative group/nc">
              <button className={`w-8 h-8 rounded-full flex-shrink-0 border-2 border-gray-200 ${newColor.bg}`}/>
              <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-2 z-10 hidden group-hover/nc:flex flex-wrap gap-1.5 w-40">
                {COLOR_OPTIONS.map(opt => (
                  <button key={opt.bg} onClick={() => setNewColor(opt)}
                    className={`w-6 h-6 rounded-full ${opt.bg} border-2 hover:scale-110 transition-transform ${newColor.bg===opt.bg?'border-gray-600':'border-transparent'}`}/>
                ))}
              </div>
            </div>
            <input value={newName} onChange={e=>setNewName(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addStage()}}}
              placeholder="New stage name…"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
            <button onClick={addStage} disabled={!newName.trim()}
              className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-40 flex items-center gap-1 transition-colors flex-shrink-0">
              <Plus className="w-4 h-4"/>Add
            </button>
          </div>
          <p className="text-xs text-gray-400">Click the color circle to change color. "Notes on/off" controls whether notes appear on candidate profiles for that stage.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {configs.map((s, i) => (
            <div key={i} className={`flex items-center gap-1.5 ${s.color} ${s.textColor} text-xs px-2.5 py-1 rounded-full`}>
              <span className="opacity-50 font-mono">{i+1}.</span>
              {s.name}
              {s.hasNotes && <span className="text-xs opacity-60">📝</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Cost Approval Settings ────────────────────────────────────
function CostApprovalSettingsSection() {
  const qc = useQueryClient()
  const { stageConfigs } = useStages()

  const { data: settings } = useQuery({
    queryKey: ['app-settings', 'cost_approval'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'cost_approval').maybeSingle()
      if (!data?.value) return { stage_name: '', reviewer_ids: [] as string[] }
      try { return JSON.parse(data.value) as { stage_name: string; reviewer_ids: string[] } } catch { return { stage_name: '', reviewer_ids: [] as string[] } }
    },
    staleTime: 30_000,
  })

  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users-for-cost-approval'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name,email,role').eq('is_active', true).order('full_name')
      return (data ?? []) as { id: string; full_name: string; email: string; role: string }[]
    },
    staleTime: 60_000,
  })

  const [stageName, setStageName] = useState('')
  const [reviewerIds, setReviewerIds] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [editMode, setEditMode] = useState(false)

  useEffect(() => {
    if (settings && !initialized) {
      setStageName(settings.stage_name)
      setReviewerIds(settings.reviewer_ids)
      setInitialized(true)
      // Start in view mode if settings already exist
      setEditMode(!settings.stage_name)
    }
  }, [settings, initialized])

  const save = async () => {
    const { error } = await supabase.from('app_settings').upsert({
      key: 'cost_approval',
      value: JSON.stringify({ stage_name: stageName, reviewer_ids: reviewerIds }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    if (error) { console.error('[cost approval save]', error); return }
    qc.invalidateQueries({ queryKey: ['app-settings', 'cost_approval'] })
    setSaved(true)
    setEditMode(false)
    setTimeout(() => setSaved(false), 2000)
  }

  const cancelEdit = () => {
    // Reset drafts to saved values
    if (settings) { setStageName(settings.stage_name); setReviewerIds(settings.reviewer_ids) }
    setEditMode(false)
  }

  const toggleReviewer = (uid: string) =>
    setReviewerIds(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid])

  const selectedReviewers = allUsers.filter(u => reviewerIds.includes(u.id))

  return (
    <div className="border-t border-gray-100 pt-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Cost Approval Workflow</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure which pipeline stage triggers cost approval and who can review candidates in that stage.
          </p>
        </div>
        {!editMode && settings?.stage_name && (
          <button onClick={() => setEditMode(true)}
            className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex-shrink-0 ml-4">
            Edit
          </button>
        )}
      </div>

      {!editMode ? (
        /* ── View mode ── */
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          {settings?.stage_name ? (
            <>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Cost Approval Stage</p>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-500"/>
                  {settings.stage_name}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Reviewers</p>
                {selectedReviewers.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedReviewers.map(u => (
                      <span key={u.id} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full">
                        {u.full_name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">No reviewers assigned</p>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-400 mb-3">Cost approval not configured yet.</p>
              <button onClick={() => setEditMode(true)}
                className="text-sm px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
                Configure now
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ── Edit mode ── */
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          {/* Stage Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cost Approval Stage</label>
            <p className="text-xs text-gray-400 mb-2">Select the pipeline stage that triggers cost approval review</p>
            <select value={stageName} onChange={e => setStageName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
              <option value="">— Select stage —</option>
              {stageConfigs.map(s => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Reviewers */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reviewers
              {reviewerIds.length > 0 && (
                <span className="ml-2 text-xs font-normal text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                  {reviewerIds.length} selected
                </span>
              )}
            </label>
            <p className="text-xs text-gray-400 mb-2">These users will see candidates in the cost approval stage and can submit Go Ahead / Re-work decisions</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {allUsers.filter(u => u.role !== 'agency').map(u => {
                const sel = reviewerIds.includes(u.id)
                return (
                  <div key={u.id} onClick={() => toggleReviewer(u.id)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors select-none ${
                      sel ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
                    }`}>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                      sel ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                    }`}>
                      {sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800">{u.full_name}</p>
                      <p className="text-xs text-gray-400">{u.email} · {u.role.replace('_', ' ')}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={!stageName}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium transition-all ${
                saved ? 'bg-green-500 text-white'
                  : !stageName ? 'bg-gray-100 text-gray-400 cursor-default'
                  : 'bg-gray-900 text-white hover:bg-gray-800'
              }`}>
              {saved ? <><Check className="w-3.5 h-3.5"/>Saved</> : 'Save settings'}
            </button>
            {settings?.stage_name && (
              <button onClick={cancelEdit}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
