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
      const { data } = await supabase.from('jobs').select('id,title,pipeline_stages,jd_link,interview_format')
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

  const query = useQuery({
    queryKey: ['candidates', filters, user?.id, user?.role],
    queryFn: async () => {
      // 1. Fetch data — RLS enforces agency isolation server-side
      let candidates = await candidateService.list(filters)

      // 2. Role-based client filter (defence-in-depth on top of RLS)
      if (user?.role === 'agency') {
        const agencyId = user.agency_id
        if (!agencyId) return []
        candidates = candidates.filter((c: any) => c.agency_id === agencyId)
      } else if (user?.role === 'hr_team') {
        // HR sees only candidates assigned to them via hr_owner or assigned_hrs
        candidates = candidates.filter((c: any) =>
          c.hr_owner === user.id ||
          (Array.isArray(c.assigned_hrs) && c.assigned_hrs.includes(user.id))
        )
      } else if (user?.role === 'interviewer') {
        // Interviewer sees only candidates assigned to them
        candidates = candidates.filter((c: any) =>
          Array.isArray(c.assigned_interviewers) && c.assigned_interviewers.includes(user.id)
        )
      }

      // 3. Local fuzzy search
      if (filters.search) {
        const q = filters.search.toLowerCase()
        candidates = candidates.filter(
          (c: any) =>
            c.full_name?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q)
        )
      }

      return candidates
    },
    enabled: true,
  })

  // Enrich with job data at render time so jobsMap updates propagate without re-fetching
  const enriched = query.data?.map((c: any) => ({
    ...c,
    job: c.job_id && jobsMap[c.job_id] ? jobsMap[c.job_id] : null,
  }))

  return { ...query, data: enriched }
}

export function useCandidate(id: string) {
  const { data: jobsMap = {} } = useJobsMap()
  const query = useQuery({
    queryKey: ['candidate', id],
    queryFn: async () => candidateService.getById(id),
    enabled: !!id,
  })

  // Enrich with job data at render time so jobsMap updates propagate without re-fetching
  const candidate = query.data
    ? { ...query.data, job: query.data.job_id ? (jobsMap[query.data.job_id] ?? null) : null }
    : query.data

  return { ...query, data: candidate }
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
