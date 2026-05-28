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
const TIMEOUT_MS = 45_000

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

// ─── Robust normalizer — handles flat, nested, and array responses ────────────

function str(v: any): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v) && v.length > 0) {
    // Some parsers return ["value"] or [{value:"..."}]
    const first = v[0]
    if (typeof first === 'string') return first.trim() || null
    return str(first?.value ?? first?.text ?? first?.raw ?? null)
  }
  if (typeof v === 'object') {
    return str(v.value ?? v.text ?? v.raw ?? v.name ?? null)
  }
  return null
}

function pick(obj: any, ...keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null
  // Exact match first
  for (const k of keys) {
    const v = obj[k]
    if (v != null && v !== '') { const s = str(v); if (s) return s }
  }
  // Case-insensitive / normalised-key match
  const normMap: Record<string, string> = {}
  for (const k of Object.keys(obj)) normMap[k.toLowerCase().replace(/[_\s\-\.]/g, '')] = k
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[_\s\-\.]/g, '')
    const realKey = normMap[norm]
    if (realKey) {
      const v = obj[realKey]
      if (v != null && v !== '') { const s = str(v); if (s) return s }
    }
  }
  return null
}

function deep(obj: any, path: string[]): any {
  let cur = obj
  for (const seg of path) {
    if (!cur || typeof cur !== 'object') return null
    cur = cur[seg] ?? Object.values(cur).find((_v, _i, arr) => {
      const parentKey = Object.keys(cur)[Object.values(cur).indexOf(arr as any)]
      return parentKey?.toLowerCase().replace(/[_\s-]/g, '') === seg.toLowerCase().replace(/[_\s-]/g, '')
    }) ?? null
  }
  return cur
}

function extractName(data: any): string {
  // Direct flat fields
  const flat = pick(data,
    'full_name','fullName','name','candidate_name','candidateName',
    'applicant_name','applicantName','person_name','personName',
    'Name','Full Name','FullName'
  )
  if (flat) return flat

  // Nested: personal_info, basics, contact, contact_info, personal
  const nestedSections = ['personal_info','personalInfo','personal','basics','contact','contact_info','contactInfo','header','profile']
  for (const sec of nestedSections) {
    const section = data[sec]
    if (!section || typeof section !== 'object') continue
    const v = pick(section, 'full_name','fullName','name','first_name','firstName','candidate_name')
    if (v) {
      // If only first/last separately, combine
      const first = pick(section, 'first_name','firstName','first')
      const last  = pick(section, 'last_name','lastName','last','surname')
      if (first && last) return `${first} ${last}`.trim()
      return v
    }
    // first + last name combination
    const first = pick(section, 'first_name','firstName','first','given_name','givenName')
    const last  = pick(section, 'last_name','lastName','last','family_name','familyName','surname')
    if (first && last) return `${first} ${last}`.trim()
    if (first) return first
  }

  // Top-level first + last combination
  const first = pick(data, 'first_name','firstName','first','given_name','givenName')
  const last  = pick(data, 'last_name','lastName','last','family_name','familyName','surname')
  if (first && last) return `${first} ${last}`.trim()
  if (first) return first

  return ''
}

function extractEmail(data: any): string {
  const flat = pick(data,
    'email','email_address','emailAddress','email_id','emailId',
    'e_mail','e-mail','mail','Email','EmailAddress'
  )
  if (flat && flat.includes('@')) return flat.toLowerCase()

  // Nested personal sections
  for (const sec of ['personal_info','personalInfo','contact','contact_info','contactInfo','basics','personal']) {
    const section = data[sec]
    if (!section) continue
    const v = pick(section, 'email','email_address','emailAddress','email_id','emailId','mail')
    if (v && v.includes('@')) return v.toLowerCase()
  }

  // emails array [{value:"..."}] or ["..."]
  const emailArr = data.emails ?? data.email_addresses ?? data.emailAddresses
  if (Array.isArray(emailArr) && emailArr.length > 0) {
    const v = str(emailArr[0])
    if (v && v.includes('@')) return v.toLowerCase()
  }

  // Scan all string values for email pattern
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/
  const found = scanForPattern(data, emailRegex)
  if (found) return found.toLowerCase()

  return ''
}

function extractPhone(data: any): string | null {
  const phoneKeys = ['phone','phone_number','phoneNumber','mobile','mobile_number','mobileNumber',
    'contact','contact_number','contactNumber','cell','cell_number','cellNumber',
    'phone_no','phoneNo','tel','telephone','Phone','Mobile','Contact']

  const flat = pick(data, ...phoneKeys)
  if (flat) return normalizePhone(flat)

  for (const sec of ['personal_info','personalInfo','contact','contact_info','contactInfo','basics','personal']) {
    const section = data[sec]
    if (!section) continue
    const v = pick(section, ...phoneKeys)
    if (v) return normalizePhone(v)
  }

  // phoneNumbers array
  const phoneArr = data.phoneNumbers ?? data.phone_numbers ?? data.phones
  if (Array.isArray(phoneArr) && phoneArr.length > 0) {
    const v = str(phoneArr[0])
    if (v) return normalizePhone(v)
  }

  // Scan for 10-digit phone pattern
  const phoneRegex = /(\+91[\s\-]?)?[6-9]\d{9}/
  const found = scanForPattern(data, phoneRegex)
  if (found) return normalizePhone(found)

  return null
}

function extractLinkedIn(data: any): string | null {
  const linkedinKeys = ['linkedin','linkedin_url','linkedinUrl','linkedin_link','linkedinLink',
    'linkedin_profile','linkedinProfile','LinkedIn','LinkedInURL']
  const flat = pick(data, ...linkedinKeys)
  if (flat && flat.includes('linkedin')) return flat

  for (const sec of ['personal_info','personalInfo','contact','contact_info','contactInfo','basics','personal','social','social_profiles','socialProfiles']) {
    const section = data[sec]
    if (!section) continue
    if (Array.isArray(section)) {
      // [{network:"linkedin", url:"..."}]
      const li = section.find((s: any) =>
        (s.network ?? s.name ?? s.type ?? '').toLowerCase().includes('linkedin')
      )
      if (li) return str(li.url ?? li.link ?? li.href ?? li.value) ?? null
    } else {
      const v = pick(section, ...linkedinKeys)
      if (v && v.includes('linkedin')) return v
    }
  }

  // Scan for linkedin.com in all string values
  const liRegex = /https?:\/\/(www\.)?linkedin\.com\/in\/[^\s"'<>]+/i
  return scanForPattern(data, liRegex)
}

function extractCurrentCompanyAndRole(data: any): { company: string | null; designation: string | null } {
  // Direct flat fields first
  const company = pick(data,
    'current_company','currentCompany','current_employer','currentEmployer',
    'company','organization','employer','company_name','companyName',
    'current_organization','currentOrganization'
  )
  const designation = pick(data,
    'current_designation','currentDesignation','current_role','currentRole',
    'designation','title','job_title','jobTitle','position','current_title','currentTitle',
    'role','current_position','currentPosition'
  )
  if (company && designation) return { company, designation }

  // Look in experience / work_experience arrays for current position
  const expArr = (
    data.experience ?? data.work_experience ?? data.workExperience ??
    data.work_history ?? data.workHistory ?? data.jobs ?? data.employment ??
    data.employment_history ?? data.employmentHistory
  )
  if (Array.isArray(expArr) && expArr.length > 0) {
    // Find current: is_current=true, end_date=null/present, or just the first entry
    const current = expArr.find((e: any) =>
      e.is_current === true || e.isCurrent === true ||
      e.currently_working === true || e.currentlyWorking === true ||
      e.end_date === null || e.endDate === null ||
      /present|current|now|till date/i.test(str(e.end_date ?? e.endDate ?? e.to ?? '') ?? '')
    ) ?? expArr[0]

    if (current) {
      const co = pick(current,
        'company','company_name','companyName','employer','organization',
        'org','name','firm','organization_name','organizationName'
      ) ?? company
      const role = pick(current,
        'title','job_title','jobTitle','designation','position','role',
        'current_designation','currentDesignation','name'
      ) ?? designation
      return { company: co, designation: role }
    }
  }

  // Nested summary section
  const summary = data.summary ?? data.profile_summary ?? data.profileSummary
  if (summary && typeof summary === 'object') {
    return {
      company: pick(summary, 'current_company','company','employer') ?? company,
      designation: pick(summary, 'current_designation','designation','title','role') ?? designation,
    }
  }

  return { company: company ?? null, designation: designation ?? null }
}

function scanForPattern(obj: any, regex: RegExp, depth = 0): string | null {
  if (depth > 5 || !obj) return null
  if (typeof obj === 'string') {
    const m = obj.match(regex)
    return m ? m[0] : null
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = scanForPattern(item, regex, depth + 1)
      if (found) return found
    }
  } else if (typeof obj === 'object') {
    for (const v of Object.values(obj)) {
      const found = scanForPattern(v, regex, depth + 1)
      if (found) return found
    }
  }
  return null
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  // Remove leading country code (91 for India)
  const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
  if (cleaned.length === 10) return cleaned
  if (cleaned.length > 10) return cleaned.slice(-10)
  return cleaned.length >= 7 ? cleaned : null
}

function normalizeParserResponse(raw: any): ParsedResume {
  // Unwrap common envelope wrappers
  const data = raw?.data ?? raw?.result ?? raw?.resume ?? raw?.candidate ?? raw?.output ?? raw

  const { company, designation } = extractCurrentCompanyAndRole(data)

  return {
    full_name:           extractName(data),
    email:               extractEmail(data),
    phone:               extractPhone(data),
    linkedin_url:        extractLinkedIn(data),
    current_company:     company,
    current_designation: designation,
  }
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
