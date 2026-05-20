// ============================================================
// CANDIDATE SERVICE
// - Email + Phone normalized before every DB write
// - Phone: exactly 10 digits, reject anything else
// - Dedup: email (primary) + phone (secondary) — both checked
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import type { Candidate, CandidateStatus, SourceCategory } from '../../types/database.types'

export interface CandidateFilters {
  stage?: string
  status?: CandidateStatus
  source_category?: SourceCategory
  job_id?: string
  search?: string
  hr_owner?: string
}

// ── Normalize ─────────────────────────────────────────────────
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  return email.trim().toLowerCase()
}

// Phone: strip everything, keep exactly 10 digits (last 10 if longer)
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  // Strip country code 91 or leading 0
  const clean = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
    : digits
  // Must be exactly 10 digits
  return clean.length === 10 ? clean : null
}

export function validatePhone(phone: string): { valid: boolean; message?: string } {
  if (!phone.trim()) return { valid: true } // optional field
  const digits = phone.replace(/\D/g, '')
  const clean = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
    : digits
  if (clean.length !== 10) return { valid: false, message: 'Phone must be exactly 10 digits' }
  return { valid: true }
}

function normalizePayload<T extends Record<string, any>>(payload: T): T {
  return {
    ...payload,
    email: normalizeEmail(payload.email) ?? payload.email,
    phone: normalizePhone(payload.phone),
  }
}

// ── Server-side dedup — email AND phone ──────────────────────
export async function findDuplicates(
  candidates: { email?: string; phone?: string | null }[],
  excludeId?: string
): Promise<{ emailDups: Set<string>; phoneDups: Set<string> }> {
  const emailDups = new Set<string>()
  const phoneDups = new Set<string>()

  for (const c of candidates.slice(0, 20)) {
    const email = normalizeEmail(c.email) || null
    const phone = normalizePhone(c.phone) || null
    if (!email && !phone) continue

    const { data } = await supabase.rpc('check_candidate_duplicate', {
      p_email: email,
      p_phone: phone,
      p_exclude_id: excludeId ?? null,
    })
    ;(data ?? []).forEach((r: any) => {
      if (r.existing_email) emailDups.add(r.existing_email.toLowerCase().trim())
      if (r.existing_phone) phoneDups.add(r.existing_phone.replace(/\D/g,'').slice(-10))
    })
  }
  return { emailDups, phoneDups }
}

export const candidateService = {
  list: async (filters: CandidateFilters = {}) => {
    // Simple select without join to avoid schema cache issues
    // Job data fetched separately where needed
    let query = supabase
      .from('candidates')
      .select('*')
      .order('created_at', { ascending: false })

    if (filters.stage)           query = query.eq('current_stage', filters.stage)
    if (filters.status)          query = query.eq('status', filters.status)
    if (filters.source_category) query = query.eq('source_category', filters.source_category)
    if (filters.job_id)          query = query.eq('job_id', filters.job_id)
    if (filters.hr_owner)        query = query.eq('hr_owner', filters.hr_owner)
    if (filters.search) {
      query = query.or(`full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`)
    }

    const { data, error } = await query
    if (error) { console.error('[candidateService.list]', error); throw error }
    return data ?? []
  },

  getById: async (id: string) => {
    const { data, error } = await supabase
      .from('candidates')
      .select('*')
      .eq('id', id)
      .single()
    if (error) { console.error('[candidateService.getById]', error); throw error }
    return data
  },

  create: async (payload: Omit<Candidate, 'id' | 'created_at' | 'updated_at'>, callerRole?: string, callerId?: string) => {
    const normalized = normalizePayload(payload)

    // Agency: agency_id = their own user id, source_name = their full_name
    if (callerRole === 'agency' && callerId) {
      normalized.source_category = 'agency' as any
      ;(normalized as any).agency_id = callerId
      if (!normalized.source_name) {
        const { data: userRow } = await supabase
          .from('users').select('full_name').eq('id', callerId).maybeSingle()
        if (userRow?.full_name) normalized.source_name = userRow.full_name
      }
    }

    // Server-side dedup before insert
    const { emailDups, phoneDups } = await findDuplicates([normalized])
    if (normalized.email && emailDups.has(normalized.email)) {
      throw new Error('Candidate already exists.')
    }
    if (normalized.phone && phoneDups.has(normalized.phone)) {
      throw new Error('Candidate already exists.')
    }
    const { data, error } = await supabase
      .from('candidates').insert(normalized).select().single()
    if (error) {
      if (error.code === '23505') throw new Error('Candidate already exists.')
      throw error
    }
    return data
  },

  update: async (id: string, payload: Partial<Candidate>) => {
    const normalized = normalizePayload(payload as any)
    const { data, error } = await supabase
      .from('candidates')
      .update({ ...normalized, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) throw error
    return data
  },

  updateStage: async (id: string, stage: string) => {
    return candidateService.update(id, { current_stage: stage })
  },

  // Bulk create — normalize all + server-side email+phone dedup
  bulkCreate: async (candidates: Omit<Candidate, 'id' | 'created_at' | 'updated_at'>[], callerRole?: string, callerId?: string) => {
    let normalized = candidates.map(normalizePayload)

    // Agency: agency_id = their own user id, source_name = their full_name
    if (callerRole === 'agency' && callerId) {
      const { data: userRow } = await supabase
        .from('users').select('full_name').eq('id', callerId).maybeSingle()
      const agencyName = userRow?.full_name ?? ''
      normalized = normalized.map(c => ({
        ...c,
        source_category: 'agency' as any,
        agency_id: callerId,                        // agency_id = user's own id
        source_name: c.source_name || agencyName,
      }))
    }

    // Server-side dedup
    const { emailDups, phoneDups } = await findDuplicates(normalized)

    const clean: typeof normalized = []
    normalized.forEach(c => {
      const emailDup = c.email && emailDups.has(c.email.toLowerCase().trim())
      const phoneDup = c.phone && phoneDups.has(c.phone.replace(/\D/g,'').slice(-10))
      if (emailDup || phoneDup) {
        console.warn('[bulkCreate] blocked duplicate:', c.email, c.phone)
        return
      }
      if (c.phone && c.phone.replace(/\D/g,'').length !== 10) c.phone = null
      clean.push(c)
    })

    if (!clean.length) return []

    const { data, error } = await supabase
      .from('candidates').insert(clean).select()
    if (error) {
      if (error.code === '23505') throw new Error('Candidate already exists.')
      throw error
    }
    return data ?? []
  },

  delete: async (id: string) => {
    const { error } = await supabase.from('candidates').delete().eq('id', id)
    if (error) throw error
  },
}
