import { useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabaseClient'

export interface DuplicateMatch {
  id: string
  full_name: string
  email: string
  phone: string | null
  current_stage: string
  match_type: 'email' | 'phone' | 'both'
}

export function useDuplicateCheck() {
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  const [checking, setChecking]     = useState(false)
  const debounceRef = useRef<any>(null)

  const check = useCallback(async (email: string, phone: string, excludeId?: string) => {
    const cleanEmail = email.trim().toLowerCase()
    const cleanPhone = phone.trim().replace(/\D/g, '').slice(-10)

    if (!cleanEmail && !cleanPhone) { setDuplicates([]); return }

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setChecking(true)
      try {
        const filters: string[] = []
        if (cleanEmail) filters.push(`email.ilike.${cleanEmail}`)
        if (cleanPhone && cleanPhone.length >= 10) filters.push(`phone.ilike.%${cleanPhone}`)

        const { data } = await supabase
          .from('candidates')
          .select('id, full_name, email, phone, current_stage')
          .or(filters.join(','))
          .limit(5)

        const results: DuplicateMatch[] = (data ?? [])
          .filter(c => excludeId ? c.id !== excludeId : true)
          .map(c => {
            const emailMatch = cleanEmail && c.email?.toLowerCase() === cleanEmail
            const phoneMatch = cleanPhone && c.phone?.replace(/\D/g,'').slice(-10) === cleanPhone
            return { ...c, match_type: (emailMatch && phoneMatch) ? 'both' : emailMatch ? 'email' : 'phone' } as DuplicateMatch
          })

        setDuplicates(results)
      } finally { setChecking(false) }
    }, 600)
  }, [])

  const reset = () => setDuplicates([])
  return { duplicates, checking, check, reset }
}
