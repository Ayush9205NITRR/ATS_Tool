// ============================================================
// USE CANDIDATES — TanStack Query hooks for candidate data
// ============================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { candidateService, type CandidateFilters } from './candidateService'

export function useCandidates(filters: CandidateFilters = {}) {
  return useQuery({
    queryKey: ['candidates', filters],
    queryFn: () => candidateService.list(filters),
  })
}

export function useCandidate(id: string) {
  return useQuery({
    queryKey: ['candidate', id],
    queryFn: () => candidateService.getById(id),
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
