// ============================================================
// QUERY CLIENT — TanStack Query global config
// ============================================================
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,   // 5 min — cached data shown immediately on revisit
      gcTime: 1000 * 60 * 15,     // 15 min — keep in memory for fast back-navigation
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
