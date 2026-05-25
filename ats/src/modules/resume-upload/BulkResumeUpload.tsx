import { useState, useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Upload, CheckCircle, AlertTriangle, Download, Loader2,
  ChevronRight, RefreshCw, XCircle, Eye,
} from 'lucide-react'
import { Button } from '../../shared/components/Button'
import { parseResumeFromUrl, checkDuplicateByEmail } from './resumeParserService'
import { candidateService, normalizePhone } from '../candidates/candidateService'
import { useAuthStore } from '../auth/authStore'
import { supabase } from '../../lib/supabaseClient'

interface CsvRow {
  resume_url: string
  source: string
  sub_source: string
}

type RowStatus = 'pending' | 'parsing' | 'parsed' | 'failed' | 'duplicate' | 'saved'

interface ProcessedRow {
  index: number
  csv: CsvRow
  status: RowStatus
  error?: string
  data?: {
    full_name: string
    email: string
    phone: string | null
    linkedin_url: string | null
    current_company: string | null
    current_designation: string | null
  }
}

function parseCSV(text: string): Record<string, string>[] {
  const lines: string[] = []
  let current = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') inQuotes = !inQuotes
    else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (current.trim()) lines.push(current)
      current = ''
      if (ch === '\r' && text[i + 1] === '\n') i++
      continue
    }
    current += ch
  }
  if (current.trim()) lines.push(current)

  const parseRow = (line: string): string[] => {
    const fields: string[] = []
    let field = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { if (inQ && line[i + 1] === '"') { field += '"'; i++ } else inQ = !inQ }
      else if (ch === ',' && !inQ) { fields.push(field.trim()); field = '' }
      else field += ch
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

function detectColumn(headers: string[], ...patterns: string[]): string | null {
  const lower = headers.map(h => h.toLowerCase().replace(/[_\s-]/g, ''))
  for (const p of patterns) {
    const idx = lower.indexOf(p.toLowerCase().replace(/[_\s-]/g, ''))
    if (idx !== -1) return headers[idx]
  }
  for (const p of patterns) {
    const h = headers.find((_, i) => lower[i].includes(p.toLowerCase().replace(/[_\s-]/g, '')))
    if (h) return h
  }
  return null
}

function generateSampleCsv(): string {
  return [
    'Resume URL,Source,Sub-Source',
    'https://drive.google.com/file/d/abc123/view,LinkedIn,"Post by Ayush"',
    'https://drive.google.com/file/d/def456/view,Agency,TalentCorp',
    'https://drive.google.com/file/d/ghi789/view,Direct,Campus Drive',
  ].join('\n')
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const STATUS_BADGE: Record<RowStatus, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Pending' },
  parsing:   { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Parsing...' },
  parsed:    { bg: 'bg-green-100', text: 'text-green-700', label: 'Parsed' },
  failed:    { bg: 'bg-red-100', text: 'text-red-700', label: 'Failed' },
  duplicate: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Duplicate' },
  saved:     { bg: 'bg-green-100', text: 'text-green-700', label: 'Saved' },
}

export function BulkResumeUpload() {
  const { user, hasRole } = useAuthStore()
  const isAgency = hasRole(['agency'])
  const qc = useQueryClient()

  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'done'>('upload')
  const [processedRows, setProcessedRows] = useState<ProcessedRow[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [fileErr, setFileErr] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')
  const cancelRef = useRef(false)

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'open', isAgency ? `agency-${user?.id}` : 'all'],
    queryFn: async () => {
      const { data } = await supabase.from('jobs').select('id,title,show_to_agency,allowed_agency_ids').eq('status', 'open').order('title')
      if (!isAgency) return data ?? []
      return (data ?? []).filter((j: any) =>
        j.show_to_agency && (!j.allowed_agency_ids || j.allowed_agency_ids.length === 0 || j.allowed_agency_ids.includes(user?.id))
      )
    },
  })

  const processRows = async (csvRows: CsvRow[]) => {
    cancelRef.current = false
    const rows: ProcessedRow[] = csvRows.map((csv, i) => ({
      index: i, csv, status: 'pending' as RowStatus,
    }))
    setProcessedRows(rows)
    setProgress({ current: 0, total: rows.length })
    setStep('processing')

    for (let i = 0; i < rows.length; i++) {
      if (cancelRef.current) break
      setProcessedRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'parsing' } : r))

      try {
        const parsed = await parseResumeFromUrl(rows[i].csv.resume_url)

        let status: RowStatus = 'parsed'
        let error: string | undefined

        if (parsed.email) {
          const dup = await checkDuplicateByEmail(parsed.email)
          if (dup.exists) {
            status = 'duplicate'
            error = `Duplicate: ${dup.candidateName} (${parsed.email})`
          }
        }

        rows[i] = { ...rows[i], status, data: parsed, error }
      } catch (err: any) {
        rows[i] = { ...rows[i], status: 'failed', error: err.message || 'Parse failed' }
      }

      setProcessedRows([...rows])
      setProgress({ current: i + 1, total: rows.length })
    }

    setStep('review')
  }

  const onFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      if (!parsed.length) { setFileErr('CSV is empty or invalid.'); return }

      const headers = Object.keys(parsed[0])
      const urlCol = detectColumn(headers, 'resume url', 'resume_url', 'url', 'resume link', 'link')
      const srcCol = detectColumn(headers, 'source')
      const subSrcCol = detectColumn(headers, 'sub-source', 'sub_source', 'subsource')

      if (!urlCol) { setFileErr('CSV must have a "Resume URL" column.'); return }
      if (!srcCol) { setFileErr('CSV must have a "Source" column.'); return }

      const csvRows: CsvRow[] = parsed
        .filter(row => row[urlCol]?.trim())
        .map(row => ({
          resume_url: row[urlCol].trim(),
          source: row[srcCol]?.trim() || 'Direct',
          sub_source: subSrcCol ? (row[subSrcCol]?.trim() || '') : '',
        }))

      if (!csvRows.length) { setFileErr('No valid rows found with Resume URLs.'); return }
      setFileErr('')
      processRows(csvRows)
    }
    reader.readAsText(file)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.csv') || file?.type === 'text/csv') onFile(file)
    else setFileErr('Please upload a .csv file.')
  }, [onFile])

  const saveMutation = useMutation({
    mutationFn: async (rowsToSave: ProcessedRow[]) => {
      const payloads = rowsToSave.map(row => {
        const d = row.data!
        const sourceCategory = isAgency ? 'agency' : normalizeSourceCategory(row.csv.source)
        return {
          full_name: d.full_name,
          email: d.email.trim().toLowerCase(),
          phone: normalizePhone(d.phone) || null,
          resume_url: row.csv.resume_url,
          linkedin_url: d.linkedin_url || null,
          source_category: sourceCategory,
          source_name: isAgency ? (user?.full_name ?? '') : (row.csv.sub_source || row.csv.source || 'Unknown'),
          current_stage: 'Applied',
          status: 'active' as const,
          tags: [],
          assigned_interviewers: [],
          job_id: selectedJobId || null,
          hr_owner: null,
          notes: null,
          screening_notes: null,
          interview_notes: {},
          custom_data: {
            ...(d.current_company ? { current_organization: d.current_company } : {}),
            ...(d.current_designation ? { designation: d.current_designation } : {}),
          },
          agency_id: isAgency ? (user!.id ?? null) : null,
          interview_date: null,
          archived_at: null,
          archived_by: null,
          uploaded_by: user!.id,
        }
      })
      return candidateService.bulkCreate(payloads, user?.role, user?.id)
    },
    onSuccess: (_, savedRows) => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
      setProcessedRows(prev => prev.map(r => {
        if (savedRows.some(sr => sr.index === r.index)) return { ...r, status: 'saved' as RowStatus }
        return r
      }))
      setStep('done')
    },
  })

  const parsedRows = processedRows.filter(r => r.status === 'parsed')
  const failedRows = processedRows.filter(r => r.status === 'failed')
  const dupRows = processedRows.filter(r => r.status === 'duplicate')
  const savedCount = processedRows.filter(r => r.status === 'saved').length

  const resetAll = () => {
    setStep('upload'); setProcessedRows([]); setProgress({ current: 0, total: 0 })
    setFileErr(''); setSelectedJobId(''); cancelRef.current = false
    saveMutation.reset()
  }

  // Upload step
  if (step === 'upload') {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-600">Upload a CSV with resume URLs to bulk-parse and import candidates.</p>
          <button
            onClick={() => downloadCsv(generateSampleCsv(), 'resume_upload_template.csv')}
            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            Download Sample CSV
          </button>
        </div>

        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <span className="text-xs text-gray-600 w-36 flex-shrink-0">
            Assign to Job {isAgency && <span className="text-red-500">*</span>}
          </span>
          <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)}
            className={`mt-1 w-full px-3 py-1.5 border rounded-lg text-sm bg-white focus:outline-none ${isAgency && !selectedJobId ? 'border-red-300' : 'border-gray-200'}`}>
            {!isAgency && <option value="">-- No job --</option>}
            {isAgency && <option value="">-- Select a job (required) --</option>}
            {(jobs as any[]).map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => {
            if (isAgency && !selectedJobId) return
            document.getElementById('resume-csv-inp')?.click()
          }}
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer bg-gray-50/50 ${
            isAgency && !selectedJobId
              ? 'border-gray-200 opacity-50 cursor-not-allowed'
              : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50/20'
          }`}
        >
          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-700 mb-1">Drop your CSV here or click to browse</p>
          <p className="text-xs text-gray-400">CSV must contain: Resume URL, Source, Sub-Source (optional)</p>
          <input
            type="file" accept=".csv" id="resume-csv-inp" className="hidden"
            disabled={isAgency && !selectedJobId}
            onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
          />
        </div>
        {fileErr && (
          <p className="mt-3 text-sm text-red-600 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />{fileErr}
          </p>
        )}

        <div className="mt-4 bg-blue-50 border border-blue-100 rounded-lg p-3">
          <p className="text-xs font-semibold text-blue-700 mb-1">CSV Format Requirements:</p>
          <ul className="text-xs text-blue-600 space-y-0.5 list-disc list-inside">
            <li><strong>Resume URL</strong> (required) - Public link to resume (Google Drive, Dropbox, etc.)</li>
            <li><strong>Source</strong> (required) - e.g., LinkedIn, Agency, Direct, Campus</li>
            <li><strong>Sub-Source</strong> (optional) - e.g., "Post by Ayush", "TalentCorp"</li>
          </ul>
        </div>
      </div>
    )
  }

  // Processing step
  if (step === 'processing') {
    const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
    return (
      <div className="py-8">
        <div className="flex flex-col items-center gap-4 mb-8">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
          <p className="text-lg font-semibold text-gray-900">Parsing Resumes...</p>
          <p className="text-sm text-gray-500">Processing {progress.current} of {progress.total} resumes</p>
          <div className="w-full max-w-md">
            <div className="bg-gray-200 rounded-full h-2.5">
              <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1 text-center">{pct}% complete</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => { cancelRef.current = true }}>
            Cancel
          </Button>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-3 py-2 font-medium text-gray-500">#</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500">Resume URL</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {processedRows.map((row, i) => {
                const badge = STATUS_BADGE[row.status]
                return (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[300px] truncate">{row.csv.resume_url}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                        {row.status === 'parsing' && <Loader2 className="w-3 h-3 animate-spin inline mr-1" />}
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // Review step
  if (step === 'review') {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Eye className="w-5 h-5 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">Review Parsed Results</h3>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-700">{processedRows.length}</p>
            <p className="text-xs text-gray-500">Total</p>
          </div>
          <div className="bg-green-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-green-700">{parsedRows.length}</p>
            <p className="text-xs text-green-600">Ready to save</p>
          </div>
          <div className={`${failedRows.length > 0 ? 'bg-red-50' : 'bg-gray-50'} rounded-xl p-3 text-center`}>
            <p className={`text-2xl font-bold ${failedRows.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>{failedRows.length}</p>
            <p className={`text-xs ${failedRows.length > 0 ? 'text-red-500' : 'text-gray-400'}`}>Failed</p>
          </div>
          <div className={`${dupRows.length > 0 ? 'bg-yellow-50' : 'bg-gray-50'} rounded-xl p-3 text-center`}>
            <p className={`text-2xl font-bold ${dupRows.length > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{dupRows.length}</p>
            <p className={`text-xs ${dupRows.length > 0 ? 'text-yellow-500' : 'text-gray-400'}`}>Duplicates</p>
          </div>
        </div>

        {/* Failed rows section */}
        {failedRows.length > 0 && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-red-200 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-600" />
              <p className="text-sm font-semibold text-red-800">
                {failedRows.length} URL{failedRows.length > 1 ? 's' : ''} failed to parse
              </p>
            </div>
            <div className="divide-y divide-red-100">
              {failedRows.map(row => (
                <div key={row.index} className="px-4 py-2.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-600 truncate">{row.csv.resume_url}</p>
                    <p className="text-xs text-red-600 mt-0.5">{row.error}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Duplicate rows */}
        {dupRows.length > 0 && (
          <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-yellow-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
              <p className="text-sm font-semibold text-yellow-800">
                {dupRows.length} duplicate{dupRows.length > 1 ? 's' : ''} found (skipped)
              </p>
            </div>
            <div className="divide-y divide-yellow-100">
              {dupRows.map(row => (
                <div key={row.index} className="px-4 py-2.5">
                  <p className="text-xs text-gray-700">{row.data?.full_name || 'Unknown'} - {row.data?.email}</p>
                  <p className="text-xs text-yellow-600 mt-0.5">{row.error}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Parsed rows table */}
        {parsedRows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-gray-200 mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-3 py-2.5 font-medium text-gray-500">#</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-500">Name</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-500">Email</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-500">Phone</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-500">Company</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-500">Designation</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-500">Source</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 50).map(row => (
                  <tr key={row.index} className="border-b border-gray-50">
                    <td className="px-3 py-2 text-gray-400">{row.index + 1}</td>
                    <td className="px-3 py-2 text-gray-700 font-medium">{row.data?.full_name || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{row.data?.email || '-'}</td>
                    <td className="px-3 py-2 text-gray-500">{row.data?.phone || '-'}</td>
                    <td className="px-3 py-2 text-gray-500">{row.data?.current_company || '-'}</td>
                    <td className="px-3 py-2 text-gray-500">{row.data?.current_designation || '-'}</td>
                    <td className="px-3 py-2 text-gray-500">{row.csv.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedRows.length > 50 && (
              <p className="text-xs text-center text-gray-400 py-2">+{parsedRows.length - 50} more rows not shown</p>
            )}
          </div>
        )}

        {saveMutation.error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <p className="text-sm text-red-600">{(saveMutation.error as Error).message}</p>
          </div>
        )}

        <div className="flex justify-between items-center">
          <Button variant="secondary" onClick={resetAll} icon={<RefreshCw className="w-4 h-4" />}>
            Start over
          </Button>
          <div className="text-right">
            {(failedRows.length > 0 || dupRows.length > 0) && (
              <p className="text-xs text-gray-500 mb-1">
                {failedRows.length > 0 && `${failedRows.length} failed`}
                {failedRows.length > 0 && dupRows.length > 0 && ', '}
                {dupRows.length > 0 && `${dupRows.length} duplicates`}
                {' '}skipped
              </p>
            )}
            <Button
              onClick={() => saveMutation.mutate(parsedRows)}
              loading={saveMutation.isPending}
              disabled={parsedRows.length === 0}
              icon={<CheckCircle className="w-4 h-4" />}
            >
              Save {parsedRows.length} candidate{parsedRows.length !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Done step
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <CheckCircle className="w-12 h-12 text-green-500" />
      <p className="text-lg font-semibold text-gray-900">Bulk Upload Complete!</p>
      <p className="text-sm text-gray-500">
        {parsedRows.length} candidate{parsedRows.length !== 1 ? 's' : ''} saved.
        {failedRows.length > 0 && ` ${failedRows.length} failed.`}
        {dupRows.length > 0 && ` ${dupRows.length} duplicates skipped.`}
      </p>
      <Button variant="secondary" onClick={resetAll}>Upload another batch</Button>
    </div>
  )
}

function normalizeSourceCategory(source: string): 'platform' | 'agency' | 'college' {
  const v = (source ?? '').toLowerCase()
  if (v.includes('college') || v.includes('campus') || v.includes('university')) return 'college'
  if (v.includes('agency') || v.includes('recruiter')) return 'agency'
  return 'platform'
}
