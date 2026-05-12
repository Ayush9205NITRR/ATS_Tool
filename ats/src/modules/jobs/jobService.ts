import { supabase } from '../../lib/supabaseClient'
import type { Job } from '../../types/database.types'

export const jobService = {
  list: async () => {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  create: async (payload: any) => {
    const { data, error } = await supabase.from('jobs').insert(payload).select().single()
    if (error) throw error
    return data
  },

  update: async (id: string, payload: any) => {
    const { data, error } = await supabase
      .from('jobs').update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) throw error
    return data
  },
}
