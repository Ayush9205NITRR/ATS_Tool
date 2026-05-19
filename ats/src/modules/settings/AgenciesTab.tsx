// Agencies Tab — Super Admin manages agencies + assigns users to them
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { Plus, Trash2, Check, Loader2, ChevronDown, Building2 } from 'lucide-react'
import { initialsOf } from '../../shared/utils/helpers'

export function AgenciesTab() {
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [saved, setSaved]    = useState(false)

  // Load agencies
  const { data: agencies = [], isLoading } = useQuery({
    queryKey: ['agencies'],
    queryFn: async () => {
      const { data } = await supabase.from('agencies').select('id,name,created_at').order('name')
      return data ?? []
    },
  })

  // Load all agency-role users
  const { data: agencyUsers = [] } = useQuery({
    queryKey: ['users', 'agency-role'],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id,full_name,email,agency_id,is_active')
        .eq('role', 'agency').order('full_name')
      return data ?? []
    },
  })

  // Create agency
  const createAgency = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('agencies').insert({ name })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agencies'] })
      setNewName(''); setSaved(true); setTimeout(() => setSaved(false), 2000)
    },
  })

  // Delete agency
  const deleteAgency = useMutation({
    mutationFn: async (id: string) => {
      // Unlink users first
      await supabase.from('users').update({ agency_id: null }).eq('agency_id', id)
      const { error } = await supabase.from('agencies').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agencies'] })
      qc.invalidateQueries({ queryKey: ['users', 'agency-role'] })
    },
  })

  // Assign user to agency
  const assignUser = useMutation({
    mutationFn: async ({ userId, agencyId }: { userId: string; agencyId: string | null }) => {
      const { error } = await supabase.from('users').update({ agency_id: agencyId }).eq('id', userId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', 'agency-role'] })
      qc.invalidateQueries({ queryKey: ['agencies'] })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Agency Management</h3>
        <p className="text-xs text-gray-500">Create agencies and assign agency users to them. Each agency's candidates are isolated by their agency ID.</p>
      </div>

      {/* Create new agency */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Add New Agency</p>
        <div className="flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createAgency.mutate(newName.trim()) }}
            placeholder="Agency name e.g. ABC Consultants"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          <button onClick={() => newName.trim() && createAgency.mutate(newName.trim())}
            disabled={!newName.trim() || createAgency.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors">
            {createAgency.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : saved ? <Check className="w-3.5 h-3.5"/> : <Plus className="w-3.5 h-3.5"/>}
            {saved ? 'Created!' : 'Create'}
          </button>
        </div>
        {createAgency.error && <p className="mt-2 text-xs text-red-600">{(createAgency.error as Error).message}</p>}
      </div>

      {/* Agencies list */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400"/></div>
      ) : agencies.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <Building2 className="w-8 h-8 mx-auto mb-2 text-gray-200"/>
          No agencies yet. Create one above.
        </div>
      ) : (
        <div className="space-y-3">
          {(agencies as any[]).map(agency => {
            const members = (agencyUsers as any[]).filter(u => u.agency_id === agency.id)
            const unassigned = (agencyUsers as any[]).filter(u => !u.agency_id)

            return (
              <div key={agency.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Agency header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-purple-600"/>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{agency.name}</p>
                      <p className="text-xs text-gray-400">{members.length} user{members.length !== 1 ? 's' : ''} assigned</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Assign unassigned user */}
                    {unassigned.length > 0 && (
                      <select defaultValue=""
                        onChange={e => { if (e.target.value) assignUser.mutate({ userId: e.target.value, agencyId: agency.id }); e.target.value = '' }}
                        className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none text-gray-600">
                        <option value="" disabled>+ Assign user</option>
                        {unassigned.map((u: any) => (
                          <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
                        ))}
                      </select>
                    )}
                    <button onClick={() => deleteAgency.mutate(agency.id)}
                      className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                </div>

                {/* Members */}
                {members.length > 0 ? (
                  <div className="divide-y divide-gray-50">
                    {members.map((u: any) => (
                      <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/40">
                        <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-orange-700">{initialsOf(u.full_name)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 font-medium">{u.full_name}</p>
                          <p className="text-xs text-gray-400">{u.email}</p>
                        </div>
                        {!u.is_active && <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Inactive</span>}
                        <button onClick={() => assignUser.mutate({ userId: u.id, agencyId: null })}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-red-50">
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-3 text-xs text-gray-400 italic">No users assigned yet.</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Unassigned agency users */}
      {(agencyUsers as any[]).filter(u => !u.agency_id).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-amber-700 mb-2">⚠️ Unassigned Agency Users</p>
          <p className="text-xs text-amber-600 mb-3">These users have the Agency role but aren't linked to any agency — they won't be able to upload candidates.</p>
          <div className="space-y-1.5">
            {(agencyUsers as any[]).filter(u => !u.agency_id).map((u: any) => (
              <div key={u.id} className="flex items-center gap-2 text-sm text-amber-800">
                <span className="font-medium">{u.full_name}</span>
                <span className="text-amber-500 text-xs">({u.email})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
