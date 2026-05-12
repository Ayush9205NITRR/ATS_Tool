import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, CheckCircle, AlertCircle, ChevronRight, AlertTriangle } from 'lucide-react'
import { candidateService } from '../../candidates/candidateService'
import { parseCSV } from '../../../shared/utils/helpers'
import { useAuthStore } from '../../auth/authStore'
import { Button } from '../../../shared/components/Button'
import type { SourceCategory } from '../../../types/database.types'

const ATS_FIELDS = [
  { key: 'full_name',       label: 'Full Name',       required: true },
  { key: 'email',           label: 'Email',            required: true },
  { key: 'source_category', label: 'Source Type',      required: true },
  { key: 'source_name',     label: 'Source Name',      required: true },
  { key: 'phone',           label: 'Phone',            required: false },
  { key: 'resume_url',      label: 'Resume URL',       required: false },
  { key: 'linkedin_url',    label: 'LinkedIn URL',     required: false },
  { key: 'notes',           label: 'Notes',            required: false },
]

// Normalize source_category — handles any variation
function normalizeSourceCategory(raw: string): SourceCategory {
  const val = (raw ?? '').toLowerCase().trim()
  if (val.includes('platform') || val.includes('linkedin') || val.includes('naukri') ||
      val.includes('indeed') || val.includes('portal') || val.includes('online') || val.includes('job')) {
    return 'platform'
  }
  if (val.includes('agency') || val.includes('consultant') || val.includes('recruiter') || val.includes('vendor')) {
    return 'agency'
  }
  if (val.includes('college') || val.includes('university') || val.includes('campus') ||
      val.includes('iit') || val.includes('iim') || val.includes('institute') || val.includes('school')) {
    return 'college'
  }
  // Default: if contains 'platform' raw value
  if (['platform','agency','college'].includes(val)) return val as SourceCategory
  return 'platform' // fallback
}

type Step = 1 | 2 | 3 | 4

interface RowResult {
  row: Record<string, string>
  index: number
  valid: boolean
  errors: string[]
  normalized?: any
}

export function CsvUploader() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>(1)
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [fileError, setFileError] = useState('')
  const [rowResults, setRowResults] = useState<RowResult[]>([])
  const [skipInvalid, setSkipInvalid] = useState(true)

  const mutation = useMutation({
    mutationFn: (rows: any[]) => candidateService.bulkCreate(rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
      setStep(4)
    },
  })

  const onFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const rows = parseCSV(text)
      if (rows.length === 0) { setFileError('CSV appears empty or invalid.'); return }
      setCsvRows(rows)
      setCsvHeaders(Object.keys(rows[0]))
      // Auto-map headers
      const autoMap: Record<string, string> = {}
      ATS_FIELDS.forEach(({ key }) => {
        const match = Object.keys(rows[0]).find(h =>
          h.toLowerCase().replace(/[\s_-]/g, '') === key.toLowerCase().replace(/[\s_-]/g, '') ||
          h.toLowerCase().includes(key.split('_')[0].toLowerCase())
        )
        if (match) autoMap[key] = match
      })
      setMapping(autoMap)
      setFileError('')
      setStep(2)
    }
    reader.readAsText(file)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.csv') || file?.type === 'text/csv') onFile(file)
    else setFileError('Please upload a .csv file.')
  }, [onFile])

  const validateAndPreview = () => {
    const results: RowResult[] = csvRows.map((row, i) => {
      const mapped: Record<string, string> = {}
      ATS_FIELDS.forEach(({ key }) => {
        mapped[key] = mapping[key] ? (row[mapping[key]] ?? '').trim() : ''
      })

      const errors: string[] = []
      if (!mapped.full_name) errors.push('"Full Name" is missing')
      if (!mapped.email) errors.push('"Email" is missing')
      if (!mapped.source_name) errors.push('"Source Name" is missing')

      const normalizedCategory = normalizeSourceCategory(mapped.source_category)
      const normalized = {
        full_name:              mapped.full_name,
        email:                  mapped.email,
        source_category:        normalizedCategory,
        source_name:            mapped.source_name || mapped.source_category || 'Unknown',
        phone:                  mapped.phone || null,
        resume_url:             mapped.resume_url || null,
        linkedin_url:           mapped.linkedin_url || null,
        notes:                  mapped.notes || null,
        current_stage:          'Applied',
        status:                 'active' as const,
        tags:                   [],
        assigned_interviewers:  [],
        job_id:                 null,
        hr_owner:               null,
        screening_notes:        null,
        interview_notes:        {},
        custom_data:            {},
        uploaded_by:            user!.id,
      }

      return { row: mapped, index: i + 2, valid: errors.length === 0, errors, normalized }
    })

    setRowResults(results)
    setStep(3)
  }

  const validRows = rowResults.filter(r => r.valid)
  const invalidRows = rowResults.filter(r => !r.valid)
  const toUpload = skipInvalid ? validRows : rowResults.filter(r => r.valid)

  const submit = () => {
    mutation.mutate(toUpload.map(r => r.normalized))
  }

  // ─── Step 1 ───────────────────────────────────────────
  if (step === 1) return (
    <div>
      <div onDrop={onDrop} onDragOver={e=>e.preventDefault()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 transition-colors cursor-pointer"
        onClick={()=>document.getElementById('csv-file-input')?.click()}>
        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3"/>
        <p className="text-sm font-medium text-gray-700 mb-1">Drop your CSV here or click to browse</p>
        <p className="text-xs text-gray-400">Supports .csv files</p>
        <input type="file" accept=".csv" id="csv-file-input" className="hidden"
          onChange={e=>{ const f=e.target.files?.[0]; if(f) onFile(f) }}/>
      </div>

      <div className="mt-4 bg-blue-50 rounded-xl p-4">
        <p className="text-xs font-semibold text-blue-700 mb-2">Required columns (any column name works, just map them):</p>
        <div className="flex flex-wrap gap-1.5">
          {ATS_FIELDS.filter(f=>f.required).map(f=>(
            <span key={f.key} className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">{f.label} *</span>
          ))}
          {ATS_FIELDS.filter(f=>!f.required).map(f=>(
            <span key={f.key} className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{f.label}</span>
          ))}
        </div>
        <p className="text-xs text-blue-500 mt-2">
          💡 Source Type accepts: "college", "platform", "agency", "LinkedIn", "Campus", "Consultant" — auto-normalized
        </p>
      </div>

      {fileError && (
        <div className="mt-3 flex items-center gap-2 text-red-600">
          <AlertCircle className="w-4 h-4"/>
          <p className="text-sm">{fileError}</p>
        </div>
      )}
    </div>
  )

  // ─── Step 2: Map columns ──────────────────────────────
  if (step === 2) return (
    <div>
      <StepBreadcrumb step={2} total={csvRows.length} onBack={()=>setStep(1)}/>
      <p className="text-xs text-gray-400 mb-4">Map your CSV columns to ATS fields. Auto-mapped where possible.</p>

      <div className="space-y-2.5">
        {ATS_FIELDS.map(({ key, label, required }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="text-sm text-gray-700 w-32 flex-shrink-0">
              {label} {required && <span className="text-red-500">*</span>}
            </span>
            <select value={mapping[key]??''}
              onChange={e=>setMapping(p=>({...p,[key]:e.target.value}))}
              className={`flex-1 px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                mapping[key] ? 'border-green-300 bg-green-50' : required ? 'border-gray-300' : 'border-gray-200'
              }`}>
              <option value="">— skip —</option>
              {csvHeaders.map(h=><option key={h} value={h}>{h}</option>)}
            </select>
            {mapping[key] && <span className="text-green-500 text-xs flex-shrink-0">✓ mapped</span>}
          </div>
        ))}
      </div>

      {/* Source type hint */}
      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          <strong>Source Type</strong> will be auto-normalized — "Campus", "LinkedIn", "Consultant" etc. all get mapped to platform/agency/college automatically.
        </p>
      </div>

      <div className="flex justify-end mt-6">
        <Button onClick={validateAndPreview} icon={<ChevronRight className="w-4 h-4"/>}>Preview</Button>
      </div>
    </div>
  )

  // ─── Step 3: Preview ──────────────────────────────────
  if (step === 3) return (
    <div>
      <StepBreadcrumb step={3} total={csvRows.length} onBack={()=>setStep(2)}/>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 my-4">
        <div className="bg-green-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-green-700">{validRows.length}</p>
          <p className="text-xs text-green-600">Ready to upload</p>
        </div>
        <div className={`${invalidRows.length>0?'bg-red-50':'bg-gray-50'} rounded-lg p-3 text-center`}>
          <p className={`text-2xl font-bold ${invalidRows.length>0?'text-red-600':'text-gray-400'}`}>{invalidRows.length}</p>
          <p className={`text-xs ${invalidRows.length>0?'text-red-500':'text-gray-400'}`}>Rows with errors</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-blue-700">{csvRows.length}</p>
          <p className="text-xs text-blue-600">Total rows</p>
        </div>
      </div>

      {/* Invalid rows */}
      {invalidRows.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-red-600 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5"/> {invalidRows.length} rows will be skipped
            </p>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={skipInvalid} onChange={e=>setSkipInvalid(e.target.checked)}
                className="rounded border-gray-300 text-blue-600"/>
              Skip invalid rows
            </label>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-32 overflow-y-auto space-y-1">
            {invalidRows.slice(0,10).map(r=>(
              <p key={r.index} className="text-xs text-red-600">
                Row {r.index}: {r.errors.join(', ')}
                {r.row.full_name && ` — ${r.row.full_name}`}
              </p>
            ))}
            {invalidRows.length > 10 && <p className="text-xs text-red-400">...and {invalidRows.length-10} more</p>}
          </div>
        </div>
      )}

      {/* Preview table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
              <th className="text-left px-3 py-2 font-medium text-gray-500">Name</th>
              <th className="text-left px-3 py-2 font-medium text-gray-500">Email</th>
              <th className="text-left px-3 py-2 font-medium text-gray-500">Source Type</th>
              <th className="text-left px-3 py-2 font-medium text-gray-500">Source Name</th>
              <th className="text-left px-3 py-2 font-medium text-gray-500">Phone</th>
            </tr>
          </thead>
          <tbody>
            {rowResults.slice(0,15).map((r,i)=>(
              <tr key={i} className={`border-b border-gray-100 ${!r.valid?'bg-red-50':''}`}>
                <td className="px-3 py-2">
                  {r.valid
                    ? <span className="text-green-600 text-xs">✓</span>
                    : <span className="text-red-500 text-xs" title={r.errors.join(', ')}>✗ skip</span>
                  }
                </td>
                <td className="px-3 py-2 text-gray-900">{r.row.full_name || <span className="text-red-400">—</span>}</td>
                <td className="px-3 py-2 text-gray-600">{r.row.email || <span className="text-red-400">—</span>}</td>
                <td className="px-3 py-2">
                  <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                    {r.normalized?.source_category ?? normalizeSourceCategory(r.row.source_category)}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600">{r.row.source_name}</td>
                <td className="px-3 py-2 text-gray-400">{r.row.phone || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rowResults.length > 15 && (
          <p className="text-xs text-gray-400 text-center py-2">+ {rowResults.length-15} more rows</p>
        )}
      </div>

      {mutation.error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
        </div>
      )}

      <div className="flex justify-between items-center mt-6">
        <Button variant="secondary" onClick={()=>setStep(2)}>← Back</Button>
        <Button onClick={submit} loading={mutation.isPending} disabled={toUpload.length===0}>
          Upload {toUpload.length} candidates
          {invalidRows.length > 0 && ` (${invalidRows.length} skipped)`}
        </Button>
      </div>
    </div>
  )

  // ─── Step 4: Done ─────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <CheckCircle className="w-12 h-12 text-green-500"/>
      <p className="text-base font-semibold text-gray-900">Upload complete!</p>
      <p className="text-sm text-gray-500">
        {toUpload.length} candidates added successfully.
        {invalidRows.length > 0 && ` ${invalidRows.length} rows were skipped.`}
      </p>
      <Button variant="secondary" onClick={()=>{setStep(1);setCsvRows([]);setCsvHeaders([]);setRowResults([])}}>
        Upload another file
      </Button>
    </div>
  )
}

function StepBreadcrumb({ step, total, onBack }: { step: number; total: number; onBack: () => void }) {
  const steps = ['Upload file','Map columns','Preview','Done']
  return (
    <div className="mb-4">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
        {steps.map((s,i)=>(
          <span key={i} className={`flex items-center gap-1 ${i+1===step?'text-blue-600 font-semibold':''}`}>
            {i>0&&<ChevronRight className="w-3 h-3"/>}{s}
          </span>
        ))}
      </div>
      <p className="text-xs text-gray-400">{total} rows in your file</p>
    </div>
  )
}
