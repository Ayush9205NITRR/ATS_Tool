// ============================================================
// AUTH STORE — Zustand store for global auth + user state
// All components read from here. Never call supabase.auth directly.
// ============================================================
import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import type { User } from '../../types/database.types'

interface AuthState {
  user: User | null
  session: any | null
  loading: boolean
  setSession: (session: any) => Promise<void>
  signOut: () => Promise<void>
  hasRole: (roles: User['role'][]) => boolean
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
    // Fetch profile from public.users table
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single()

    set({ user: data ?? null, session, loading: false })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, session: null })
  },

  // Helper: check if current user has one of the given roles
  hasRole: (roles) => {
    const { user } = get()
    if (!user) return false
    return roles.includes(user.role)
  },
}))
