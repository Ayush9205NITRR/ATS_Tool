import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Users, Columns, Trash2, GripVertical, Pencil, Check, X } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader } from '../../shared/components/PageHeader'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'
import { EmptyState } from '../../shared/components/EmptyState'
import { initialsOf, labelOf } from '../../shared/utils/helpers'
import type { User, Role } from '../../types/database.types'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

const userSchema = z.object({
  full_name: z.string().min(2, 'Required'),
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'Min 8 characters'),
  role: z.enum(['super_admin','admin','hr_team','interviewer']),
})
type UserFormData = z.infer<typeof userSchema>

const fieldSchema = z.object({
  field_label: z.string().min(1, 'Label required'),
  field_type:  z.enum(['text','number','date','url','boolean']),
  is_required: z.boolean().default(false),
})
type FieldFormData = z.infer<typeof fieldSchema>

const ROLE_COLOUR: Record<Role, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  admin:       'bg-blue-100 text-blue-700',
  hr_team:     'bg-green-100 text-green-700',
  interviewer: 'bg-gray-100 text-gray-600',
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text', number: 'Number', date: 'Date', url: 'URL / Link', boolean: 'Yes / No',
}

type Tab = 'users' | 'fields'

export function SettingsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('users')
  const [showUserModal, setShowUserModal]   = useState(false)
  const [showFieldModal, setShowFieldModal] = useState(false)
  const [editingField, setEditingField]     = useState<any | null>(null)
  const [editingFieldType, setEditingFieldType] = useState('')

  // ── Users ─────────────────────────────────────────────────
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => { const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false }); return (data ?? []) as User[] },
  })

  const { register: ru, handleSubmit: hu, reset: resetU, formState: { errors: eu } } = useForm<UserFormData>({
    resolver: zodResolver(userSchema), defaultValues: { role: 'interviewer' },
  })

  const createUser = useMutation({
    mutationFn: async (d: UserFormData) => {
      const { data: authData, error: authErr } = await supabase.auth.signUp({ email: d.email, password: d.password })
      if (authErr) throw authErr
      const { error } = await supabase.from('users').insert({ id: authData.user!.id, email: d.email, full_name: d.full_name, role: d.role, is_active: true })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); resetU(); setShowUserModal(false) },
  })

  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role }) => { const { error } = await supabase.from('users').update({ role }).eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => { const { error } = await supabase.from('users').update({ is_active }).eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  // ── Custom Fields ──────────────────────────────────────────
  const { data: fields = [], isLoading: fieldsLoading } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => { const { data } = await supabase.from('custom_fields').select('*').order('sort_order').order('created_at'); return data ?? [] },
  })

  const { register: rf, handleSubmit: hf, reset: resetF, formState: { errors: ef } } = useForm<FieldFormData>({
    resolver: zodResolver(fieldSchema), defaultValues: { field_type: 'text', is_required: false },
  })

  const createField = useMutation({
    mutationFn: async (d: FieldFormData) => {
      const field_name = d.field_label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      const { error } = await supabase.from('custom_fields').insert({
        field_name, field_label: d.field_label, field_type: d.field_type,
        is_required: d.is_required, sort_order: fields.length,
      })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['custom-fields'] }); resetF(); setShowFieldModal(false) },
  })

  const updateFieldType = useMutation({
    mutationFn: async ({ id, field_type }: { id: string; field_type: string }) => {
      const { error } = await supabase.from('custom_fields').update({ field_type }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['custom-fields'] }); setEditingField(null) },
  })

  const toggleField = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => { const { error } = await supabase.from('custom_fields').update({ is_active }).eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  })

  const deleteField = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('custom_fields').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  })

  const ROLES: Role[] = ['super_admin', 'admin', 'hr_team', 'interviewer']

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Manage team and system configuration"
        action={
          tab === 'users'
            ? <Button size="sm" icon={<Plus className="w-3.5 h-3.5"/>} onClick={() => setShowUserModal(true)}>Add User</Button>
            : <Button size="sm" icon={<Plus className="w-3.5 h-3.5"/>} onClick={() => setShowFieldModal(true)}>Add Field</Button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {([['users', <Users className="w-4 h-4"/>, 'Team Members'], ['fields', <Columns className="w-4 h-4"/>, 'Custom Fields']] as const).map(([t, icon, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ── USERS ── */}
      {tab === 'users' && (
        <>
          {usersLoading ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
          : users.length === 0 ? <EmptyState icon={<Users className="w-5 h-5"/>} title="No users yet"/>
          : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {users.map((u, i) => (
                <div key={u.id} className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                  <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-semibold text-blue-700">{initialsOf(u.full_name)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">{u.full_name}</p>
                      {!u.is_active && <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Inactive</span>}
                    </div>
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </div>
                  <select value={u.role} onChange={e => updateRole.mutate({ id: u.id, role: e.target.value as Role })}
                    className={`text-xs font-medium px-2.5 py-1 rounded-full border-0 cursor-pointer ${ROLE_COLOUR[u.role]}`}>
                    {ROLES.map(r => <option key={r} value={r}>{labelOf(r)}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate({ id: u.id, is_active: !u.is_active })}>
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Modal open={showUserModal} onClose={() => setShowUserModal(false)} title="Add Team Member" size="sm">
            <form onSubmit={hu(d => createUser.mutate(d))} className="space-y-4">
              {[['full_name','Full Name','Priya Sharma','text'],['email','Email','priya@company.com','email'],['password','Temporary Password','','password']].map(([key,label,ph,type]) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input {...ru(key as any)} type={type} placeholder={ph} className={inputCls}/>
                  {eu[key as keyof typeof eu] && <p className="mt-1 text-xs text-red-600">{(eu[key as keyof typeof eu] as any)?.message}</p>}
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select {...ru('role')} className={inputCls}>
                  <option value="interviewer">Interviewer</option>
                  <option value="hr_team">HR Team</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              {createUser.error && <p className="text-sm text-red-600">{(createUser.error as Error).message}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" type="button" onClick={() => setShowUserModal(false)}>Cancel</Button>
                <Button type="submit" loading={createUser.isPending}>Add User</Button>
              </div>
            </form>
          </Modal>
        </>
      )}

      {/* ── CUSTOM FIELDS ── */}
      {tab === 'fields' && (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-sm text-blue-700">
              Fields added here appear in the <strong>Add Candidate form</strong> and <strong>Candidates list</strong> automatically.
              Click <strong>Type</strong> to change the data type of any field.
            </p>
          </div>

          {fieldsLoading ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
          : fields.length === 0 ? (
            <EmptyState icon={<Columns className="w-5 h-5"/>} title="No custom fields yet"
              description="Add fields like 'Current CTC', 'Notice Period', 'Expected Salary'"
              action={<Button size="sm" onClick={() => setShowFieldModal(true)}>Add your first field</Button>}/>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="grid grid-cols-12 px-5 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <div className="col-span-1"/>
                <div className="col-span-4">Field Name</div>
                <div className="col-span-3">Type <span className="normal-case font-normal text-gray-400">(click to change)</span></div>
                <div className="col-span-2">Required</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-1"/>
              </div>
              {(fields as any[]).map((field, i) => (
                <div key={field.id} className={`grid grid-cols-12 items-center px-5 py-3.5 ${i > 0 ? 'border-t border-gray-100' : ''} hover:bg-gray-50/40 transition-colors`}>
                  <div className="col-span-1 text-gray-300"><GripVertical className="w-4 h-4"/></div>
                  <div className="col-span-4">
                    <p className="text-sm font-medium text-gray-900">{field.field_label}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{field.field_name}</p>
                  </div>
                  <div className="col-span-3">
                    {editingField?.id === field.id ? (
                      <div className="flex items-center gap-1.5">
                        <select value={editingFieldType} onChange={e => setEditingFieldType(e.target.value)}
                          className="px-2 py-1 border border-blue-400 rounded text-xs bg-white focus:outline-none">
                          {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <button onClick={() => updateFieldType.mutate({ id: field.id, field_type: editingFieldType })}
                          className="p-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                          <Check className="w-3 h-3"/>
                        </button>
                        <button onClick={() => setEditingField(null)} className="p-1 rounded text-gray-400 hover:text-gray-600">
                          <X className="w-3 h-3"/>
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingField(field); setEditingFieldType(field.field_type) }}
                        className="flex items-center gap-1.5 group/type">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full group-hover/type:bg-blue-50 group-hover/type:text-blue-600 transition-colors">
                          {FIELD_TYPE_LABELS[field.field_type] ?? field.field_type}
                        </span>
                        <Pencil className="w-3 h-3 text-gray-300 opacity-0 group-hover/type:opacity-100 group-hover/type:text-blue-400 transition-all"/>
                      </button>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${field.is_required ? 'bg-red-50 text-red-600' : 'text-gray-400'}`}>
                      {field.is_required ? 'Required' : 'Optional'}
                    </span>
                  </div>
                  <div className="col-span-1">
                    <button onClick={() => toggleField.mutate({ id: field.id, is_active: !field.is_active })}
                      className={`text-xs px-2 py-0.5 rounded-full transition-colors ${field.is_active ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                      {field.is_active ? 'Active' : 'Hidden'}
                    </button>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => deleteField.mutate(field.id)} className="text-gray-200 hover:text-red-500 transition-colors p-1">
                      <Trash2 className="w-4 h-4"/>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Modal open={showFieldModal} onClose={() => setShowFieldModal(false)} title="Add Custom Field" size="sm">
            <form onSubmit={hf(d => createField.mutate(d))} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Field Label *</label>
                <input {...rf('field_label')} placeholder="e.g. Current CTC, Notice Period" className={inputCls}/>
                {ef.field_label && <p className="mt-1 text-xs text-red-600">{ef.field_label.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data Type *</label>
                <select {...rf('field_type')} className={inputCls}>
                  <option value="text">Text — short text input</option>
                  <option value="number">Number — numeric value (LPA, years…)</option>
                  <option value="date">Date — date picker</option>
                  <option value="url">URL / Link — website or document</option>
                  <option value="boolean">Yes / No — checkbox</option>
                </select>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" {...rf('is_required')} className="rounded border-gray-300 text-blue-600 w-4 h-4"/>
                <span className="text-sm text-gray-700">Make this field required</span>
              </label>
              {createField.error && <p className="text-sm text-red-600">{(createField.error as Error).message}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" type="button" onClick={() => setShowFieldModal(false)}>Cancel</Button>
                <Button type="submit" loading={createField.isPending}>Add Field</Button>
              </div>
            </form>
          </Modal>
        </>
      )}
    </div>
  )
}
