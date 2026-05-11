import { supabase } from '../../lib/supabaseClient'

export const authService = {
  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) throw new Error(error.message)
    return data
  },

  signOut: async () => {
    await supabase.auth.signOut()
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
