// ============================================================
// CANDIDATE SERVICE — all Supabase queries for candidates
// Components never call supabase directly.
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import type { Candidate, CandidateStatus, SourceCategory } from '../../types/database.types'

export interface CandidateFilters {
  stage?: string
  status?: CandidateStatus
  source_category?: SourceCategory
  job_id?: string
  search?: string
}

export const candidateService = {
  list: async (filters: CandidateFilters = {}) => {
    let query = supabase
      .from('candidates')
      .select('*, job:jobs(id, title, pipeline_stages)')
      .order('created_at', { ascending: false })

    if (filters.stage)           query = query.eq('current_stage', filters.stage)
    if (filters.status)          query = query.eq('status', filters.status)
    if (filters.source_category) query = query.eq('source_category', filters.source_category)
    if (filters.job_id)          query = query.eq('job_id', filters.job_id)
    if (filters.search) {
      query = query.or(`full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`)
    }

    const { data, error } = await query
    if (error) throw error
    return data ?? []
  },

  getById: async (id: string) => {
    const { data, error } = await supabase
      .from('candidates')
      .select('*, job:jobs(id, title, pipeline_stages)')
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  },

  create: async (payload: Omit<Candidate, 'id' | 'created_at' | 'updated_at'>) => {
    const { data, error } = await supabase
      .from('candidates')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return data
  },

  update: async (id: string, payload: Partial<Candidate>) => {
    const { data, error } = await supabase
      .from('candidates')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  },

  updateStage: async (id: string, stage: string) => {
    return candidateService.update(id, { current_stage: stage })
  },

  bulkCreate: async (candidates: Omit<Candidate, 'id' | 'created_at' | 'updated_at'>[]) => {
    const { data, error } = await supabase
      .from('candidates')
      .insert(candidates)
      .select()
    if (error) throw error
    return data ?? []
  },

  delete: async (id: string) => {
    const { error } = await supabase.from('candidates').delete().eq('id', id)
    if (error) throw error
  },
}
