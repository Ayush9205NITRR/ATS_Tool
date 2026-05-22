import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Users, Columns, Trash2, GripVertical, Pencil, Check, X, Mail, Search } from 'lucide-react'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
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
  role: z.enum(['super_admin','admin','hr_team','interviewer', 'agency']),
})
type UserFormData = z.infer<typeof userSchema>

const fieldSchema = z.object({
  field_label: z.string().min(1, 'Label required'),
  field_type:  z.enum(['text','number','date','url','boolean']),
  is_required: z.boolean().default(false),
})
type FieldFormData = z.infer<typeof fieldSchema>

const ROLE_COLOUR: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  admin:       'bg-blue-100 text-blue-700',
  hr_team:     'bg-green-100 text-green-700',
  interviewer: 'bg-amber-100 text-amber-700',
  agency:      'bg-orange-100 text-orange-700',
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text', number: 'Number', date: 'Date', url: 'URL / Link', boolean: 'Yes / No',
}

import { EmailTemplatesTab } from './EmailTemplatesTab'
import { OrgSettingsTab } from './OrgSettingsTab'

type Tab = 'users' | 'fields' | 'emails' | 'org'

export function SettingsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('users')
  const { hasRole } = useAuthStore()
  const isSuperAdmin = hasRole(['super_admin'])
  const [showUserModal, setShowUserModal]   = useState(false)
  const [editingUser, setEditingUser]       = useState<any | null>(null)
  const [showFieldModal, setShowFieldModal] = useState(false)
  const [editingField, setEditingField]     = useState<any | null>(null)
  const [editingFieldType, setEditingFieldType] = useState('')
  const [editingFieldLabel, setEditingFieldLabel] = useState<{id:string;label:string}|null>(null)
  const [filteredUsers, setFilteredUsers]   = useState<any[] | null>(null)

  const updateFieldLabel = useMutation({
    mutationFn: async ({id,label}:{id:string;label:string}) => {
      const {error} = await supabase.from('custom_fields').update({field_label:label}).eq('id',id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({queryKey:['custom-fields']}); setEditingFieldLabel(null) },
  })

  // ── Users ─────────────────────────────────────────────────
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => { const { data } = await supabase.from('users').select('*').order('full_name', { ascending: true }); return (data ?? []) as User[] },
  })

  const { register: ru, handleSubmit: hu, reset: resetU, formState: { errors: eu } } = useForm<UserFormData>({
    resolver: zodResolver(userSchema), defaultValues: { role: 'interviewer' },
  })

  const createUser = useMutation({
    mutationFn: async (d: UserFormData) => {
      // 1. Create the user authentication and base profile via RPC
      const { data: userId, error } = await supabase.rpc('create_user_with_auth', {
        p_email: d.email,
        p_password: d.password,
        p_full_name: d.full_name,
        p_role: d.role,
      })
      if (error) throw new Error(error.message)

      // 2. If the user is an agency, provision and link their agency container automatically
      if (d.role === 'agency') {
        const { data: newAgency, error: agencyErr } = await supabase
          .from('agencies')
          .insert({ name: d.full_name })
          .select('id')
          .single()

        if (agencyErr) throw agencyErr

        if (newAgency && userId) {
          const { error: linkErr } = await supabase
            .from('users')
            .update({ agency_id: newAgency.id })
            .eq('id', userId)
            if (linkErr) throw linkErr
        }
      }
      return userId
    },
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ['users'] }); 
      qc.invalidateQueries({ queryKey: ['agencies'] }); 
      resetU(); 
      setShowUserModal(false);
    },
  })

const updateRole = useMutation({
    mutationFn: async ({ id, role, full_name }: { id: string; role: Role; full_name: string }) => {
      // 1. Update the basic role in the users table
      const { error } = await supabase.from('users').update({ role }).eq('id', id)
      if (error) throw error

      // 2. If they are changed TO an agency, ensure they have a linked agency bucket
      if (role === 'agency') {
        // Look for an existing agency with their exact name
        let { data: existingAgency } = await supabase.from('agencies').select('id').ilike('name', full_name).maybeSingle()
        let agencyId = existingAgency?.id

        // If it doesn't exist, auto-create it
        if (!agencyId) {
          const { data: newAgency, error: agError } = await supabase.from('agencies').insert({ name: full_name }).select('id').single()
          if (agError) throw agError
          agencyId = newAgency.id
        }

        // Link the user securely to the agency ID
        await supabase.from('users').update({ agency_id: agencyId }).eq('id', id)
      } else {
        // If they are changed AWAY from agency to something else, remove the link
        await supabase.from('users').update({ agency_id: null }).eq('id', id)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('users').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => { const { error } = await supabase.from('users').update({ is_active }).eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const updateUser = useMutation({
    mutationFn: async ({ id, full_name, email, password }: { id:string; full_name:string; email:string; password?:string }) => {
      // Update profile in users table
      const { error: profileErr } = await supabase.from('users').update({ full_name, email }).eq('id', id)
      if (profileErr) throw profileErr
      // Password update via Supabase Admin (requires service role — run SQL instead)
      if (password?.trim()) {
        // Update password via auth.users directly (service role function)
        const { error: pwErr } = await supabase.rpc('update_user_password', { user_id: id, new_password: password })
        if (pwErr) {
          // Fallback: if RPC doesn't exist, show SQL to run manually
          throw new Error(`Password update requires Admin API. Run this SQL in Supabase:\nUPDATE auth.users SET encrypted_password = crypt('${password}', gen_salt('bf')) WHERE id = '${id}';`)
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEditingUser(null) },
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
    mutationFn: async ({ id, is_active, show_to_interviewer, show_to_agency, show_in_columns }: {
      id: string; is_active: boolean; show_to_interviewer?: boolean; show_to_agency?: boolean; show_in_columns?: boolean
    }) => {
      const update: any = { is_active }
      if (show_to_interviewer !== undefined) update.show_to_interviewer = show_to_interviewer
      if (show_to_agency     !== undefined) update.show_to_agency      = show_to_agency
      if (show_in_columns    !== undefined) update.show_in_columns      = show_in_columns
      const { error } = await supabase.from('custom_fields').update(update).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  })

  const deleteField = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('custom_fields').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  })

  const ROLES: Role[] = ['super_admin', 'admin', 'hr_team', 'interviewer', 'agency']

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
        {([['users', <Users className="w-4 h-4"/>, 'Team Members'], ['fields', <Columns className="w-4 h-4"/>, 'Fields'], ['emails', <Mail className="w-4 h-4"/>, 'Email Templates'], ['org', <Mail className="w-4 h-4"/>, 'Org Settings']] as const).map(([t, icon, label]) => (
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
            <div className="space-y-3">
              {/* Search + filter bar */}
              <UserSearchBar users={users as any[]} onFiltered={setFilteredUsers}/>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {(filteredUsers ?? users).map((u:any, i:number) => (
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
                  <select value={u.role} onChange={e => updateRole.mutate({ id: u.id, role: e.target.value as Role, full_name: u.full_name })}
                    className={`text-xs font-medium px-2.5 py-1 rounded-full border-0 cursor-pointer ${ROLE_COLOUR[u.role]}`}>
                    {ROLES.map(r => <option key={r} value={r}>{labelOf(r)}</option>)}
                  </select>
                  {isSuperAdmin && (
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditingUser(u)}>Edit</Button>
                      <button 
                        onClick={() => {
                          if(window.confirm(`Are you sure you want to delete ${u.full_name}?`)) {
                            deleteUser.mutate(u.id);
                          }
                        }} 
                        className="text-gray-300 hover:text-red-500 transition-colors p-1"
                        title="Delete User"
                      >
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate({ id: u.id, is_active: !u.is_active })}>
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              ))}
              </div>
            </div>
          )}

          <Modal open={showUserModal} onClose={() => setShowUserModal(false)} title="Add Team Member" size="sm">
            <form onSubmit={hu(d => createUser.mutate(d))} className="space-y-4">
              {[['full_name','Full Name *','e.g. ABC Consultants (agency name)','text'],['email','Email *','priya@company.com','email'],['password','Temporary Password *','','password']].map(([key,label,ph,type]) => (
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
                  <option value="agency">Agency</option>
                  <option value="hr_team">HR Team</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
                {eu.role && <p className="mt-1 text-xs text-red-600">{eu.role.message}</p>}
                <p className="mt-1.5 text-xs text-gray-400">
                  💡 <strong>For Agency:</strong> Use the agency company name as "Full Name" — this becomes the agency identifier. Candidates uploaded by them will automatically link to this account.
                </p>
              </div>
              {createUser.error && <p className="text-sm text-red-600">{(createUser.error as Error).message}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" type="button" onClick={() => setShowUserModal(false)}>Cancel</Button>
                <Button type="submit" loading={createUser.isPending}>Add User</Button>
              </div>
            </form>
          </Modal>

          {/* Edit User Modal */}
          {editingUser && (
            <EditUserModal
              user={editingUser}
              onSave={(data) => updateUser.mutate({ id: editingUser.id, ...data })}
              onClose={() => setEditingUser(null)}
              saving={updateUser.isPending}
              error={updateUser.error ? (updateUser.error as Error).message : null}
            />
          )}
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
                <div className="col-span-4">Field / API Key</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-2">Required</div>
                <div className="col-span-2">Interviewer</div>
                <div className="col-span-1">Agency</div>
                <div className="col-span-1">Status</div>
              </div>
              {(fields as any[]).map((field, i) => (
                <div key={field.id} className={`grid grid-cols-12 items-center px-5 py-3 ${i > 0 ? 'border-t border-gray-100' : ''} hover:bg-gray-50/30 transition-colors`}>
                  {/* Field name + key */}
                  <div className="col-span-4">
                    {editingFieldLabel?.id === field.id ? (
                      <div className="flex items-center gap-1.5">
                        <input autoFocus value={editingFieldLabel!.label}
                          onChange={e => setEditingFieldLabel(p => p ? {...p, label: e.target.value} : p)}
                          onKeyDown={e => { if(e.key==='Enter') updateFieldLabel.mutate({id:field.id, label:editingFieldLabel!.label}) }}
                          className="flex-1 px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none"/>
                        <button onClick={() => updateFieldLabel.mutate({id:field.id, label:editingFieldLabel!.label})}
                          className="p-1 rounded bg-blue-600 text-white"><Check className="w-3 h-3"/></button>
                        <button onClick={() => setEditingFieldLabel(null)}
                          className="p-1 rounded text-gray-400 hover:text-gray-600"><X className="w-3 h-3"/></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{field.field_label}</p>
                          <p className="text-xs text-blue-500 font-mono mt-0.5 bg-blue-50 px-1.5 py-0.5 rounded inline-block">{field.field_name}</p>
                        </div>
                        <button onClick={() => setEditingFieldLabel({id:field.id, label:field.field_label})}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-blue-600 transition-all">
                          <Pencil className="w-3 h-3"/>
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Type */}
                  <div className="col-span-2">
                    {editingField?.id === field.id ? (
                      <div className="flex items-center gap-1">
                        <select value={editingFieldType} onChange={e => setEditingFieldType(e.target.value)}
                          className="px-1.5 py-1 border border-blue-400 rounded text-xs bg-white focus:outline-none w-24">
                          {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <button onClick={() => updateFieldType.mutate({ id: field.id, field_type: editingFieldType })}
                          className="p-1 rounded bg-blue-600 text-white"><Check className="w-3 h-3"/></button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingField(field); setEditingFieldType(field.field_type) }}
                        className="text-xs text-gray-500 hover:text-blue-600 border border-gray-200 px-2 py-0.5 rounded hover:border-blue-300 transition-colors">
                        {FIELD_TYPE_LABELS[field.field_type] ?? field.field_type}
                      </button>
                    )}
                  </div>
                  {/* Required */}
                  <div className="col-span-2">
                    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${field.is_required ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-gray-50 text-gray-400 border border-gray-200'}`}>
                      {field.is_required ? '* Mandatory' : 'Optional'}
                    </span>
                  </div>
                  {/* Interviewer sees */}
                  <div className="col-span-2">
                    <button onClick={() => toggleField.mutate({ id: field.id, is_active: field.is_active, show_to_interviewer: !field.show_to_interviewer })}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${field.show_to_interviewer !== false ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}>
                      {field.show_to_interviewer !== false ? '✓ Yes' : '✗ No'}
                    </button>
                  </div>
                  {/* Agency sees */}
                  <div className="col-span-1">
                    <button onClick={() => toggleField.mutate({ id: field.id, is_active: field.is_active, show_to_agency: field.show_to_agency === false ? true : false })}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${field.show_to_agency !== false ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}>
                      {field.show_to_agency !== false ? '✓' : '✗'}
                    </button>
                  </div>
                  {/* Actions */}
                  <div className="col-span-1 flex items-center gap-1">
                    <button onClick={() => toggleField.mutate({ id: field.id, is_active: !field.is_active })}
                      className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${field.is_active ? 'bg-green-50 text-green-600 border-green-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                      {field.is_active ? 'On' : 'Off'}
                    </button>
                    <button onClick={() => deleteField.mutate(field.id)} className="text-gray-200 hover:text-red-500 transition-colors p-1">
                      <Trash2 className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Modal open={showFieldModal} onClose={() => setShowFieldModal(false)} title="Add Field" size="sm">
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

      {/* ── EMAIL TEMPLATES ── */}
      {tab === 'emails'   && <EmailTemplatesTab />}
      {tab === 'org'      && <OrgSettingsTab />}
    </div>
  )
}

export default SettingsPage

// ── User Search + Filter bar ──────────────────────────────────
function UserSearchBar({ users, onFiltered }: { users: any[]; onFiltered: (u: any[]) => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all'|'active'|'inactive'>('all')
  const [role, setRole] = useState('')

  useEffect(() => {
    let filtered = users
    if (q) filtered = filtered.filter(u => u.full_name?.toLowerCase().includes(q.toLowerCase()) || u.email?.toLowerCase().includes(q.toLowerCase()))
    if (status === 'active') filtered = filtered.filter(u => u.is_active)
    if (status === 'inactive') filtered = filtered.filter(u => !u.is_active)
    if (role) filtered = filtered.filter(u => u.role === role)
    onFiltered(filtered)
  }, [q, status, role, users])

  return (
    <div className="flex gap-2 items-center">
      <div className="relative flex-1">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
      </div>
      <select value={status} onChange={e => setStatus(e.target.value as any)}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none">
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
      <select value={role} onChange={e => setRole(e.target.value)}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none">
        <option value="">All Roles</option>
        <option value="super_admin">Super Admin</option>
        <option value="admin">Admin</option>
        <option value="hr_team">HR Team</option>
        <option value="interviewer">Interviewer</option>
        <option value="agency">Agency</option>
      </select>
    </div>
  )
}
function EditUserModal({ user, onSave, onClose, saving, error }: {
  user: any
  onSave: (data: { full_name:string; email:string; password?:string }) => void
  onClose: () => void
  saving: boolean
  error: string | null
}) {
  const [fullName, setFullName] = useState(user.full_name ?? '')
  const [email, setEmail]       = useState(user.email ?? '')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm"/>
      <div onClick={e=>e.stopPropagation()}
        className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">Edit User — {user.full_name}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
            <input value={fullName} onChange={e=>setFullName(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email Address</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-600">New Password</label>
              <button onClick={()=>setShowPw(o=>!o)} className="text-xs text-gray-400 hover:text-gray-600">{showPw?'Hide':'Show'}</button>
            </div>
            <input type={showPw?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)}
              placeholder="Leave blank to keep current password"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={()=>onSave({ full_name:fullName, email, password:password||undefined })} disabled={saving||!fullName||!email}
            className="px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center gap-2">
            {saving ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block"/>Saving…</> : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
