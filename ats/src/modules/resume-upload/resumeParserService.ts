import { supabase } from '../../lib/supabaseClient'

export interface ParsedResume {
  full_name: string
  email: string
  phone: string | null
  linkedin_url: string | null
  current_company: string | null
  current_designation: string | null
}

const _RAW_URL = (import.meta.env.VITE_RESUME_PARSER_URL as string | undefined)?.replace(/\/+$/, '')
const PARSER_URL = _RAW_URL ? (_RAW_URL.endsWith('/parse') ? _RAW_URL : `${_RAW_URL}/parse`) : undefined
const PARSER_API_KEY = import.meta.env.VITE_RESUME_PARSER_API_KEY as string | undefined
const TIMEOUT_MS = 30_000

export async function parseResumeFromUrl(resumeUrl: string): Promise<ParsedResume> {
  if (!PARSER_URL) {
    throw new Error('Resume parser not configured. Set VITE_RESUME_PARSER_URL in your environment.')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (PARSER_API_KEY) headers['Authorization'] = `Bearer ${PARSER_API_KEY}`

    const res = await fetch(PARSER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: resumeUrl }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Parser returned ${res.status}: ${text || 'Unknown error'}`)
    }

    const json = await res.json()
    return normalizeParserResponse(json)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Resume parsing timed out. The URL may be inaccessible or the file too large.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function normalizeParserResponse(raw: any): ParsedResume {
  const data = raw.data ?? raw.result ?? raw
  return {
    full_name: extractField(data, ['full_name', 'name', 'candidate_name', 'Name']) ?? '',
    email: extractField(data, ['email', 'email_address', 'Email']) ?? '',
    phone: extractField(data, ['phone', 'phone_number', 'mobile', 'contact', 'Phone']) ?? null,
    linkedin_url: extractField(data, ['linkedin', 'linkedin_url', 'linkedin_link', 'LinkedIn']) ?? null,
    current_company: extractField(data, ['current_company', 'company', 'organization', 'employer', 'Company']) ?? null,
    current_designation: extractField(data, ['current_designation', 'designation', 'title', 'job_title', 'position', 'Designation']) ?? null,
  }
}

function extractField(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== '') return String(obj[key]).trim()
  }
  for (const key of Object.keys(obj)) {
    const lk = key.toLowerCase().replace(/[_\s-]/g, '')
    for (const target of keys) {
      if (lk === target.toLowerCase().replace(/[_\s-]/g, '')) {
        if (obj[key] != null && obj[key] !== '') return String(obj[key]).trim()
      }
    }
  }
  return null
}

export async function checkDuplicateByEmail(email: string): Promise<{ exists: boolean; candidateId?: string; candidateName?: string }> {
  if (!email) return { exists: false }
  const normalized = email.trim().toLowerCase()
  const { data } = await supabase
    .from('candidates')
    .select('id, full_name')
    .ilike('email', normalized)
    .limit(1)
  if (data && data.length > 0) {
    return { exists: true, candidateId: data[0].id, candidateName: data[0].full_name }
  }
  return { exists: false }
}
