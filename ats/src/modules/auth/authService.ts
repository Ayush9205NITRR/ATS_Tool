// ============================================================
// AUTH SERVICE — all Supabase auth calls live here
// ============================================================
import { supabase } from '../../lib/supabaseClient'

export const authService = {
  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  getSession: async () => {
    const { data } = await supabase.auth.getSession()
    return data.session
  },

  onAuthStateChange: (callback: (session: any) => void) => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session)
    })
    return data.subscription
  },
}
