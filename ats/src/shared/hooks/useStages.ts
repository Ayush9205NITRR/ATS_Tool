// Global stages hook — single source of truth
// Super admin can edit in Settings → Org Settings
// All components use this hook — any change reflects everywhere
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'

export const DEFAULT_STAGES = [
  'Applied', 'Screening', 'R1', 'Case Study', 'R2', 'R3',
  'CF (Virtual)', 'CF (In-Person)', 'Offer', 'Hired', 'Rejected'
]

export function useStages() {
  const { data, isLoading } = useQuery({
    queryKey: ['app-settings', 'pipeline_stages'],
    queryFn: async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'pipeline_stages')
        .maybeSingle()
      if (!data?.value) return DEFAULT_STAGES
      try {
        const parsed = JSON.parse(data.value)
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_STAGES
      } catch {
        return DEFAULT_STAGES
      }
    },
    staleTime: 30_000,
  })

  return { stages: data ?? DEFAULT_STAGES, isLoading }
}

export function useSaveStages() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (stages: string[]) => {
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key: 'pipeline_stages', value: JSON.stringify(stages) }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-settings'] })
      qc.invalidateQueries({ queryKey: ['app-settings', 'pipeline_stages'] })
    },
  })
}
