// ============================================================
// JOBS SERVICE
// ============================================================
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

  create: async (payload: Omit<Job, 'id' | 'created_at' | 'updated_at'>) => {
    const { data, error } = await supabase.from('jobs').insert(payload).select().single()
    if (error) throw error
    return data
  },

  update: async (id: string, payload: Partial<Job>) => {
    const { data, error } = await supabase
      .from('jobs').update(payload).eq('id', id).select().single()
    if (error) throw error
    return data
  },
}
