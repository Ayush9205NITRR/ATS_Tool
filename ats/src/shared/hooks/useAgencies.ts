// Agency users hook — agencies are users with role='agency'
// No separate agencies table. agency.id = user.id, agency.name = user.full_name
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'

export interface Agency { id: string; name: string; email: string }

export function useAgencies() {
  return useQuery({
    queryKey: ['agency-users'],
    queryFn: async () => {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('role', 'agency')
        .eq('is_active', true)
        .order('full_name')
      return (data ?? []).map(u => ({
        id: u.id,
        name: u.full_name,
        email: u.email,
      })) as Agency[]
    },
    staleTime: 60_000,
  })
}

// Sub-source options per source type
export const PLATFORM_SOURCES = [
  'LinkedIn', 'Naukri', 'Indeed', 'Internshala', 'Shine',
  'Monster', 'Foundit', 'Apna', 'Referral', 'Website', 'Other',
]
export const COLLEGE_SOURCE_PLACEHOLDER = 'Enter college name…'
