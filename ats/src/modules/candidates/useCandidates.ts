// ============================================================
// USE CANDIDATES — TanStack Query hooks for candidate data
// Fetches candidates + joins job data client-side (avoids FK schema issues)
// ============================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { candidateService, type CandidateFilters } from './candidateService'
import { supabase } from '../../lib/supabaseClient'

// Fetch all open jobs once, cache 60s — used to enrich candidates with job.title
function useJobsMap() {
  return useQuery({
    queryKey: ['jobs', 'map'],
    queryFn: async () => {
      const { data } = await supabase.from('jobs').select('id,title,pipeline_stages,jd_link')
      const map: Record<string, any> = {}
      ;(data ?? []).forEach(j => { map[j.id] = j })
      return map
    },
    staleTime: 60_000,
  })
}

export function useCandidates(filters: CandidateFilters = {}) {
  const { data: jobsMap = {} } = useJobsMap()
  return useQuery({
    queryKey: ['candidates', filters],
    queryFn: async () => {
      const candidates = await candidateService.list(filters)
      // Enrich with job data client-side (no DB join needed)
      return candidates.map((c: any) => ({
        ...c,
        job: c.job_id && jobsMap[c.job_id] ? jobsMap[c.job_id] : null,
      }))
    },
    enabled: true,
  })
}

export function useCandidate(id: string) {
  const { data: jobsMap = {} } = useJobsMap()
  return useQuery({
    queryKey: ['candidate', id],
    queryFn: async () => {
      const c = await candidateService.getById(id)
      if (!c) return null
      return {
        ...c,
        job: c.job_id && jobsMap[c.job_id] ? jobsMap[c.job_id] : null,
      }
    },
    enabled: !!id,
  })
}

export function useUpdateStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      candidateService.updateStage(id, stage),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['candidate', data.id] })
      qc.invalidateQueries({ queryKey: ['widget'] })
    },
  })
}

export function useDeleteCandidate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => candidateService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
    },
  })
}
