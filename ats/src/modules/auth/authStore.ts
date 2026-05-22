// ============================================================
// AUTH STORE — Zustand store for global auth + user state
// All components read from here. Never call supabase.auth directly.
// ============================================================
import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import type { User, Role } from '../../types/database.types'

const VALID_ROLES: Role[] = ['super_admin', 'admin', 'hr_team', 'interviewer', 'agency']

interface AuthState {
  user: User | null
  session: any | null
  loading: boolean
  setSession: (session: any) => Promise<void>
  signOut: () => Promise<void>
  hasRole: (roles: Role[]) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,

  setSession: async (session) => {
    if (!session) {
      set({ user: null, session: null, loading: false })
      return
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single()

    if (error) {
      console.error('[authStore] Failed to fetch user profile:', error.message)
    }

    if (!data) {
      // Profile missing — trigger should have created it, but this is the safety net.
      // Use metadata role if valid, otherwise default to hr_team.
      const meta = session.user.user_metadata ?? {}
      const email = session.user.email ?? ''
      const metaRole = meta.role as string | undefined
      const role: Role = metaRole && VALID_ROLES.includes(metaRole as Role)
        ? (metaRole as Role)
        : 'hr_team'

      const { data: inserted } = await supabase.from('users').insert({
        id: session.user.id,
        email,
        full_name: meta.full_name ?? email.split('@')[0],
        role,
        agency_id: null,
        is_active: true,
      }).select().single()

      set({ user: (inserted as User) ?? null, session, loading: false })
      return
    }

    set({ user: data as User, session, loading: false })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, session: null })
  },

  hasRole: (roles) => {
    const { user } = get()
    if (!user) return false
    return roles.includes(user.role)
  },
}))
