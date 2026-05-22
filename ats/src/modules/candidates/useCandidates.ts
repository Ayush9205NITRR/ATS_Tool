// ============================================================
// USE CANDIDATES — TanStack Query hooks for candidate data
// ============================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { candidateService, type CandidateFilters } from './candidateService'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'

// Fetch all open jobs once, cache 60s — used to enrich candidates safely
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

export function useCandidates(filters: CandidateFilters & { search?: string } = {}) {
  const { user } = useAuthStore()
  const { data: jobsMap = {} } = useJobsMap()

  return useQuery({
    queryKey: ['candidates', filters, user?.id, user?.role],
    queryFn: async () => {
      // 1. Fetch data from service
      let candidates = await candidateService.list(filters)

      // 2. Strict client enforcement loop for agency constraints
      if (user?.role === 'agency') {
        const currentAgencyId = (user as any).agency_id
        if (currentAgencyId) {
          candidates = candidates.filter((c: any) => c.agency_id === currentAgencyId)
        } else {
          return []
        }
      }

      // 3. Local fuzzy search logic
      if (filters?.search) {
        const q = filters.search.toLowerCase()
        candidates = candidates.filter(
          (c: any) =>
            c.full_name?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q)
        )
      }

      // 4. Enrich candidates with cached job data
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
