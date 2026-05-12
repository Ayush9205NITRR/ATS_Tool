import { useState, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Upload, CheckCircle, AlertTriangle, ChevronRight, Sparkles } from 'lucide-react'
import { candidateService } from '../../candidates/candidateService'
import { useAuthStore } from '../../auth/authStore'
import { Button } from '../../../shared/components/Button'
import { supabase } from '../../../lib/supabaseClient'
import type { SourceCategory } from '../../../types/database.types'

type Step = 1 | 2 | 3 | 4

// ── Helpers ──────────────────────────────────────────────────

function parseCSVRobust(text: string): Record<string, string>[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') { inQuotes = !inQuotes }
    else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (current.trim()) lines.push(current)
      current = ''
      if (ch === '\r' && text[i+1] === '\n') i++
      continue
    }
    current += ch
  }
  if (current.trim()) lines.push(current)

  const parseRow = (line: string): string[] => {
    const fields: string[] = []
    let field = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { field += '"'; i++ }
        else inQ = !inQ
      } else if (ch === ',' && !inQ) {
        fields.push(field.trim())
        field = ''
      } else {
        field += ch
      }
    }
    fields.push(field.trim())
    return fields
  }

  if (lines.length < 2) return []
  const headers = parseRow(lines[0])
  return lines.slice(1).map(line => {
    const vals = parseRow(line)
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (vals[i] ?? '').trim()]))
  })
}

function extractUrl(text: string): string | null {
  if (!text) return null
  // Airtable format: "filename.pdf (https://...)" — extract URL inside parens
  const parenMatch = text.match(/\(https?:\/\/[^)]+\)/)
  if (parenMatch) return parenMatch[0].slice(1, -1)
  // Plain URL
  const urlMatch = text.match(/https?:\/\/[^\s,)]+/)
  return urlMatch ? urlMatch[0] : null
}

function normalizeSource(raw: string): SourceCategory {
  const v = (raw ?? '').toLowerCase().trim()
  if (v.includes('college') || v.includes('university') || v.includes('campus') ||
      v.includes('iit') || v.includes('iim') || v.includes('institute') || v.includes('school'))
    return 'college'
  if (v.includes('agency') || v.includes('consultant') || v.includes('recruiter') || v.includes('vendor'))
    return 'agency'
  return 'platform'
}

function normalizePhone(raw: string): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 10) return '+' + digits
  return raw || null
}

// ── Smart Column Detector ────────────────────────────────────

interface ColumnMap {
  full_name: string; email: string; phone: string; linkedin: string
  source: string; source_name: string; resume: string; notes: string
  college: string
}

function autoDetectColumns(headers: string[]): Partial<ColumnMap> {
  const find = (...patterns: string[]) =>
    headers.find(h => patterns.some(p => h.toLowerCase().includes(p.toLowerCase()))) ?? ''

  return {
    full_name:   find('full name', 'name', 'candidate'),
    email:       find('email', 'mail'),
    phone:       find('phone', 'mobile', 'contact'),
    linkedin:    find('linkedin', 'profile'),
    source:      find('source'),
    source_name: find('college/university', 'college', 'university', 'institution', 'agency'),
    resume:      find('resume', 'cv'),
    notes:       find('tell us', 'about yourself', 'summary', 'note', 'why'),
    college:     find('college/university', 'university name', 'institute'),
  }
}

function transformRow(row: Record<string, string>, colMap: Partial<ColumnMap>, userId: string, jobId: string | null): any {
  const get = (key: keyof ColumnMap) => colMap[key] ? (row[colMap[key]!] ?? '') : ''

  const sourceName = get('college') || get('source_name') || get('source') || 'Unknown'
  const sourceRaw = get('source')
  const resumeRaw = get('resume')
  const resumeUrl = extractUrl(resumeRaw)

  return {
    full_name:             get('full_name').trim(),
    email:                 get('email').trim().toLowerCase(),
    phone:                 normalizePhone(get('phone')),
    linkedin_url:          extractUrl(get('linkedin')) || (get('linkedin').startsWith('http') ? get('linkedin') : null),
    resume_url:            resumeUrl,
    source_category:       normalizeSource(sourceRaw || 'college'),
    source_name:           sourceName.trim() || 'Unknown',
    notes:                 get('notes').slice(0, 500) || null,
    current_stage:         'Applied',
    status:                'active' as const,
    tags:                  [],
    assigned_interviewers: [],
    job_id:                jobId || null,
    hr_owner:              null,
    screening_notes:       null,
    interview_notes:       {},
    custom_data:           {},
    uploaded_by:           userId,
  }
}

// ── Component ────────────────────────────────────────────────

export function CsvUploader() {
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const [step, setStep]           = useState<Step>(1)
  const [rows, setRows]           = useState<Record<string, string>[]>([])
  const [headers, setHeaders]     = useState<string[]>([])
  const [colMap, setColMap]       = useState<Partial<ColumnMap>>({})
  const [selectedJobId, setSelectedJobId] = useState<string>('')

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'open'],
    queryFn: async () => {
      const { data } = await supabase.from('jobs').select('id,title').eq('status','open').order('title')
      return data ?? []
    },
  })
  const [isAirtable, setIsAirtable] = useState(false)
  const [transformed, setTransformed] = useState<any[]>([])
  const [dupMap, setDupMap] = useState<Record<string, string>>({}) // email -> existing candidate name

  const mutation = useMutation({
    mutationFn: (payload: any[]) => candidateService.bulkCreate(payload),
    onSuccess: () => { qc.invalidateQueries({queryKey:['candidates']}); qc.invalidateQueries({queryKey:['widget']}); setStep(4) },
  })

  const onFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseCSVRobust(text)
      if (!parsed.length) { setFileErr('CSV empty or invalid.'); return }

      const hdrs = Object.keys(parsed[0])
      const detected = autoDetectColumns(hdrs)

      // Detect Airtable format
      const isAt = hdrs.some(h => h.includes('Airtable') || h.includes('Why') || h.includes('CGPA') || h.includes('relocat'))
      setIsAirtable(isAt)
      setRows(parsed)
      setHeaders(hdrs)
      setColMap(detected)
      setFileErr('')
      setStep(2)
    }
    reader.readAsText(file)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.csv') || file?.type === 'text/csv') onFile(file)
    else setFileErr('Please upload a .csv file.')
  }, [onFile])

  const preview = async () => {
    const result = rows.map(r => transformRow(r, colMap, user!.id, null))
    setTransformed(result)

    // Check for duplicates in bulk
    const emails = result.filter(r => r.email).map(r => r.email)
    const phones = result.filter(r => r.phone).map(r => r.phone.replace(/\D/g,'').slice(-10)).filter(p => p.length >= 10)

    if (emails.length > 0 || phones.length > 0) {
      const filters: string[] = []
      if (emails.length) emails.forEach(e => filters.push(`email.ilike.${e}`))
      if (phones.length) phones.forEach(p => filters.push(`phone.ilike.%${p}`))

      const { data } = await supabase
        .from('candidates')
        .select('id, full_name, email, phone')
        .or(filters.slice(0, 20).join(',')) // Supabase limit
        .limit(50)

      const map: Record<string, string> = {}
      data?.forEach(existing => {
        if (existing.email) map[existing.email.toLowerCase()] = existing.full_name
        if (existing.phone) {
          const p = existing.phone.replace(/\D/g,'').slice(-10)
          if (p.length >= 10) map[`phone:${p}`] = existing.full_name
        }
      })
      setDupMap(map)
    }

    setStep(3)
  }

  const valid   = transformed.filter(r => r.full_name && r.email)
  const invalid = transformed.filter(r => !r.full_name || !r.email)

  // ─── Step 1 ───────────────────────────────────────────────
  if (step === 1) return (
    <div>
      <div onDrop={onDrop} onDragOver={e=>e.preventDefault()}
        onClick={()=>document.getElementById('csv-inp')?.click()}
        className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center hover:border-blue-400 transition-colors cursor-pointer bg-gray-50/50 hover:bg-blue-50/20">
        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3"/>
        <p className="text-sm font-semibold text-gray-700 mb-1">Drop your CSV here or click to browse</p>
        <p className="text-xs text-gray-400">Supports Airtable exports, LinkedIn exports, and custom CSV files</p>
        <input type="file" accept=".csv" id="csv-inp" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f)}}/>
      </div>

      {fileErr && <p className="mt-3 text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4"/>{fileErr}</p>}

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        {[['✅','Airtable exports','Auto-detected'],['✅','LinkedIn CSV','Auto-detected'],['✅','Custom CSV','Column mapper']].map(([icon,title,sub])=>(
          <div key={title} className="bg-gray-50 rounded-lg p-3">
            <p className="text-lg mb-1">{icon}</p>
            <p className="text-xs font-semibold text-gray-700">{title}</p>
            <p className="text-xs text-gray-400">{sub}</p>
          </div>
        ))}
      </div>
    </div>
  )

  // ─── Step 2: Map ──────────────────────────────────────────
  if (step === 2) return (
    <div>
      <Breadcrumb step={2} total={rows.length} onBack={()=>setStep(1)}/>

      {isAirtable && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4">
          <Sparkles className="w-4 h-4 text-blue-500 flex-shrink-0"/>
          <p className="text-sm text-blue-700">
            <strong>Airtable format detected!</strong> Columns auto-mapped. Verify below and click Preview.
          </p>
        </div>
      )}

      <div className="space-y-2 text-sm">
        {([
          ['full_name',   'Full Name *'],
          ['email',       'Email *'],
          ['phone',       'Phone'],
          ['linkedin',    'LinkedIn URL'],
          ['source',      'Source Type'],
          ['source_name', 'Source / College Name'],
          ['resume',      'Resume / CV'],
          ['notes',       'Notes / About'],
        ] as [keyof ColumnMap, string][]).map(([key, label]) => (
          <div key={key} className="flex items-center gap-3">
            <span className="text-gray-600 w-36 flex-shrink-0 text-xs">{label}</span>
            <select value={colMap[key]??''}
              onChange={e=>setColMap(p=>({...p,[key]:e.target.value}))}
              className={`flex-1 px-3 py-2 border rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                colMap[key] ? 'border-green-300 bg-green-50/50' : 'border-gray-200'
              }`}>
              <option value="">— skip —</option>
              {headers.map(h=><option key={h} value={h}>{h}</option>)}
            </select>
            {colMap[key] && <span className="text-green-500 text-xs flex-shrink-0">✓</span>}
          </div>
        ))}
      </div>

      <div className="flex justify-end mt-5">
        <Button onClick={preview} icon={<ChevronRight className="w-4 h-4"/>}>Preview {rows.length} rows</Button>
      </div>
    </div>
  )

  // ─── Step 3: Preview ──────────────────────────────────────
  if (step === 3) return (
    <div>
      <Breadcrumb step={3} total={rows.length} onBack={()=>setStep(2)}/>

      <div className="grid grid-cols-3 gap-3 my-4">
        <div className="bg-green-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-green-700">{valid.length}</p>
          <p className="text-xs text-green-600">Ready to upload</p>
        </div>
        <div className={`${invalid.length>0?'bg-red-50':'bg-gray-50'} rounded-xl p-3 text-center`}>
          <p className={`text-2xl font-bold ${invalid.length>0?'text-red-600':'text-gray-400'}`}>{invalid.length}</p>
          <p className={`text-xs ${invalid.length>0?'text-red-500':'text-gray-400'}`}>Skipped (no name/email)</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-blue-700">{rows.length}</p>
          <p className="text-xs text-blue-600">Total rows</p>
        </div>
      </div>

      {/* Duplicate summary */}
      {Object.keys(dupMap).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3 flex items-start gap-2">
          <span className="text-amber-500 text-base flex-shrink-0">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Possible duplicates detected</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Rows marked with ⚠️ may already exist. Review before uploading.
            </p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-3 py-2.5 font-medium text-gray-500">Status</th>
              <th className="text-left px-3 py-2.5 font-medium text-gray-500">Name</th>
              <th className="text-left px-3 py-2.5 font-medium text-gray-500">Email</th>
              <th className="text-left px-3 py-2.5 font-medium text-gray-500">Phone</th>
              <th className="text-left px-3 py-2.5 font-medium text-gray-500">Source</th>
              <th className="text-left px-3 py-2.5 font-medium text-gray-500">Source Name</th>
              <th className="text-left px-3 py-2.5 font-medium text-gray-500">LinkedIn</th>
              <th className="text-left px-3 py-2.5 font-medium text-gray-500">Resume</th>
            </tr>
          </thead>
          <tbody>
            {transformed.slice(0,20).map((r,i)=>{
              const emailDup = r.email && dupMap[r.email.toLowerCase()]
              const phoneDup = r.phone && dupMap[`phone:${r.phone.replace(/\D/g,'').slice(-10)}`]
              const isDup = !!(emailDup || phoneDup)
              const dupName = emailDup || phoneDup
              return (
              <tr key={i} className={`border-b border-gray-50 ${!r.full_name||!r.email?'bg-red-50 opacity-60':isDup?'bg-amber-50':''}`}>
                <td className="px-3 py-2">
                  {!r.full_name||!r.email
                    ? <span className="text-red-500 text-xs">✗ skip</span>
                    : isDup
                    ? <span className="text-amber-600 text-xs" title={`Matches: ${dupName}`}>⚠️ dup</span>
                    : <span className="text-green-500 text-xs">✓</span>
                  }
                </td>
                <td className="px-3 py-2 text-gray-600 max-w-[120px] truncate">{r.source_name}</td>
                <td className="px-3 py-2">{r.linkedin_url?<span className="text-blue-500">✓</span>:'—'}</td>
                <td className="px-3 py-2">{r.resume_url?<span className="text-green-500">✓</span>:'—'}</td>
              </tr>
            )})}
          </tbody>
        </table>
        {transformed.length>20&&<p className="text-xs text-center text-gray-400 py-2">+{transformed.length-20} more rows</p>}
      </div>

      {mutation.error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
        </div>
      )}

      <div className="flex justify-between mt-5 items-center">
        <Button variant="secondary" onClick={()=>setStep(2)}>← Back</Button>
        <div className="text-right">
          {Object.keys(dupMap).length > 0 && (
            <p className="text-xs text-amber-600 mb-1">⚠️ {Object.keys(dupMap).length} possible duplicates — will still upload</p>
          )}
          <Button onClick={()=>mutation.mutate(valid)} loading={mutation.isPending} disabled={valid.length===0}>
            Upload {valid.length} candidates
          </Button>
        </div>
      </div>
    </div>
  )

  // ─── Step 4: Done ─────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <CheckCircle className="w-12 h-12 text-green-500"/>
      <p className="text-lg font-semibold text-gray-900">Upload complete!</p>
      <p className="text-sm text-gray-500">{valid.length} candidates added to your ATS.</p>
      <Button variant="secondary" onClick={()=>{setStep(1);setRows([]);setTransformed([])}}>Upload another file</Button>
    </div>
  )
}

function Breadcrumb({step,total,onBack}:{step:number;total:number;onBack:()=>void}) {
  const steps = ['Upload file','Map columns','Preview','Done']
  return (
    <div className="mb-4">
      <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
        {steps.map((s,i)=>(
          <span key={i} className={`flex items-center gap-1 ${i+1===step?'text-blue-600 font-semibold':''}`}>
            {i>0&&<ChevronRight className="w-3 h-3"/>}{s}
          </span>
        ))}
      </div>
      <p className="text-xs text-gray-400">{total} rows detected</p>
    </div>
  )
}
