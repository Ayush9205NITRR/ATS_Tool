import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'

export interface Agency { id: string; name: string }

export function useAgencies() {
  return useQuery({
    queryKey: ['agencies'],
    queryFn: async () => {
      const { data } = await supabase.from('agencies').select('id,name').order('name')
      return (data ?? []) as Agency[]
    },
    staleTime: 60_000,
  })
}
