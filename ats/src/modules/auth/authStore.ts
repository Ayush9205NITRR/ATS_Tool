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
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single()

    if (error) {
      console.error('[authStore] Failed to fetch user profile:', error.message)
    }

    if (!data) {
      // Profile missing — create it from session metadata
      const meta = session.user.user_metadata ?? {}
      const email = session.user.email ?? ''
      const { data: inserted } = await supabase.from('users').insert({
        id: session.user.id,
        email,
        full_name: meta.full_name ?? email.split('@')[0],
        role: 'hr_team',
        is_active: true,
      }).select().single()
      set({ user: inserted ?? null, session, loading: false })
      return
    }

    set({ user: data, session, loading: false })
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
