import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Users } from 'lucide-react'
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
const schema = z.object({
  full_name: z.string().min(2, 'Required'),
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'Min 8 characters'),
  role: z.enum(['super_admin','admin','hr_team','interviewer']),
})
type FormData = z.infer<typeof schema>

const ROLE_COLOUR: Record<Role, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  admin:       'bg-blue-100 text-blue-700',
  hr_team:     'bg-green-100 text-green-700',
  interviewer: 'bg-gray-100 text-gray-600',
}

export function SettingsPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false })
      return (data ?? []) as User[]
    },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'interviewer' },
  })

  const createUser = useMutation({
    mutationFn: async (d: FormData) => {
      const { data: authData, error: authErr } = await supabase.auth.signUp({ email: d.email, password: d.password })
      if (authErr) throw authErr
      const { error } = await supabase.from('users').insert({ id: authData.user!.id, email: d.email, full_name: d.full_name, role: d.role, is_active: true })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); reset(); setShowModal(false) },
  })

  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role }) => {
      const { error } = await supabase.from('users').update({ role }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('users').update({ is_active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const ROLES: Role[] = ['super_admin', 'admin', 'hr_team', 'interviewer']

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Manage team members and access"
        action={<Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowModal(true)}>Add User</Button>}
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
      ) : users.length === 0 ? (
        <EmptyState icon={<Users className="w-5 h-5" />} title="No users yet" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {users.map((u, i) => (
            <div key={u.id} className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold text-blue-700">{initialsOf(u.full_name)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{u.full_name}</p>
                <p className="text-xs text-gray-400">{u.email}</p>
              </div>
              {/* Role changer */}
              <select
                value={u.role}
                onChange={(e) => updateRole.mutate({ id: u.id, role: e.target.value as Role })}
                className={`text-xs font-medium px-2.5 py-1 rounded-full border-0 cursor-pointer ${ROLE_COLOUR[u.role]}`}
              >
                {ROLES.map((r) => <option key={r} value={r}>{labelOf(r)}</option>)}
              </select>
              <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate({ id: u.id, is_active: !u.is_active })}>
                {u.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Team Member" size="sm">
        <form onSubmit={handleSubmit((d) => createUser.mutate(d))} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input {...register('full_name')} placeholder="Priya Sharma" className={inputCls} />
            {errors.full_name && <p className="mt-1 text-xs text-red-600">{errors.full_name.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input {...register('email')} type="email" className={inputCls} />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Temporary Password</label>
            <input {...register('password')} type="password" className={inputCls} />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select {...register('role')} className={inputCls}>
              <option value="interviewer">Interviewer</option>
              <option value="hr_team">HR Team</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          {createUser.error && <p className="text-sm text-red-600">{(createUser.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" loading={createUser.isPending}>Add User</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
