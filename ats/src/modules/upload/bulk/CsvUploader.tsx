// ============================================================
// CSV UPLOADER — 4-step bulk upload wizard
// Step 1: Drop file → Step 2: Map columns → Step 3: Preview → Step 4: Confirm
// ============================================================
import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, CheckCircle, AlertCircle, ChevronRight } from 'lucide-react'
import { candidateService } from '../../candidates/candidateService'
import { parseCSV } from '../../../shared/utils/helpers'
import { useAuthStore } from '../../auth/authStore'
import { Button } from '../../../shared/components/Button'
import type { SourceCategory } from '../../../types/database.types'

// The ATS fields that CSV columns can be mapped to
const ATS_FIELDS = [
  { key: 'full_name',       label: 'Full Name',    required: true },
  { key: 'email',           label: 'Email',         required: true },
  { key: 'source_category', label: 'Source Type',   required: true },
  { key: 'source_name',     label: 'Source Name',   required: true },
  { key: 'phone',           label: 'Phone',          required: false },
  { key: 'resume_url',      label: 'Resume URL',     required: false },
  { key: 'linkedin_url',    label: 'LinkedIn URL',   required: false },
  { key: 'notes',           label: 'Notes',          required: false },
]

type Step = 1 | 2 | 3 | 4

export function CsvUploader() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>(1)
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<string[]>([])

  const mutation = useMutation({
    mutationFn: (rows: any[]) => candidateService.bulkCreate(rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
      setStep(4)
    },
  })

  // Step 1 — file drop
  const onFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const rows = parseCSV(text)
      if (rows.length === 0) { setErrors(['CSV appears empty or invalid.']); return }
      setCsvRows(rows)
      setCsvHeaders(Object.keys(rows[0]))
      // Auto-map headers that exactly match field names
      const autoMap: Record<string, string> = {}
      ATS_FIELDS.forEach(({ key }) => {
        const match = Object.keys(rows[0]).find(
          (h) => h.toLowerCase().replace(/\s/g,'_') === key.toLowerCase()
        )
        if (match) autoMap[key] = match
      })
      setMapping(autoMap)
      setErrors([])
      setStep(2)
    }
    reader.readAsText(file)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type === 'text/csv' || file?.name.endsWith('.csv')) onFile(file)
    else setErrors(['Please upload a .csv file.'])
  }, [onFile])

  // Step 3 — validate + transform
  const mappedRows = csvRows.map((row) => {
    const out: Record<string, string> = {}
    ATS_FIELDS.forEach(({ key }) => {
      if (mapping[key]) out[key] = row[mapping[key]] ?? ''
    })
    return out
  })

  const validateAndProceed = () => {
    const errs: string[] = []
    mappedRows.forEach((row, i) => {
      ATS_FIELDS.filter((f) => f.required).forEach(({ key, label }) => {
        if (!row[key]) errs.push(`Row ${i + 1}: "${label}" is missing`)
      })
    })
    if (errs.length > 0) { setErrors(errs.slice(0, 5)); return }
    setErrors([])
    setStep(3)
  }

  const submit = () => {
    const payload = mappedRows.map((row) => ({
      full_name: row.full_name,
      email: row.email,
      source_category: (row.source_category?.toLowerCase() ?? 'platform') as SourceCategory,
      source_name: row.source_name,
      phone: row.phone || null,
      resume_url: row.resume_url || null,
      linkedin_url: row.linkedin_url || null,
      notes: row.notes || null,
      current_stage: 'Applied',
      status: 'active' as const,
      tags: [],
      assigned_interviewers: [],
      job_id: null,
      uploaded_by: user!.id,
    }))
    mutation.mutate(payload)
  }

  // ─── Step 1: Upload ───────────────────────────────────────
  if (step === 1) return (
    <div>
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 transition-colors"
      >
        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-700 mb-1">Drop your CSV file here</p>
        <p className="text-xs text-gray-400 mb-4">or click to browse</p>
        <input
          type="file" accept=".csv" className="hidden" id="csv-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
        />
        <label htmlFor="csv-input">
          <Button variant="secondary" size="sm" type="button"
            onClick={() => document.getElementById('csv-input')?.click()}>
            Browse file
          </Button>
        </label>
      </div>

      <div className="mt-4 bg-blue-50 rounded-lg px-4 py-3">
        <p className="text-xs font-medium text-blue-700 mb-1">Required CSV columns:</p>
        <p className="text-xs text-blue-600">full_name, email, source_category (platform/agency/college), source_name</p>
      </div>

      {errors.map((e, i) => (
        <div key={i} className="mt-2 flex items-center gap-2 text-red-600">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">{e}</p>
        </div>
      ))}
    </div>
  )

  // ─── Step 2: Map columns ──────────────────────────────────
  if (step === 2) return (
    <div>
      <StepHeader step={2} total={csvRows.length} onBack={() => setStep(1)} />
      <div className="space-y-3 mt-4">
        {ATS_FIELDS.map(({ key, label, required }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="text-sm text-gray-700 w-36 flex-shrink-0">
              {label} {required && <span className="text-red-500">*</span>}
            </span>
            <select
              value={mapping[key] ?? ''}
              onChange={(e) => setMapping((p) => ({ ...p, [key]: e.target.value }))}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— skip —</option>
              {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>

      {errors.map((e, i) => (
        <p key={i} className="mt-1 text-xs text-red-600">• {e}</p>
      ))}

      <div className="flex justify-end mt-6">
        <Button onClick={validateAndProceed} icon={<ChevronRight className="w-4 h-4" />}>
          Preview
        </Button>
      </div>
    </div>
  )

  // ─── Step 3: Preview ──────────────────────────────────────
  if (step === 3) return (
    <div>
      <StepHeader step={3} total={csvRows.length} onBack={() => setStep(2)} />
      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {['Name','Email','Source Type','Source Name','Phone'].map((h) => (
                <th key={h} className="text-left px-3 py-2 font-medium text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mappedRows.slice(0, 10).map((row, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="px-3 py-2 text-gray-900">{row.full_name || <span className="text-red-400">missing</span>}</td>
                <td className="px-3 py-2 text-gray-600">{row.email || <span className="text-red-400">missing</span>}</td>
                <td className="px-3 py-2 text-gray-600 capitalize">{row.source_category}</td>
                <td className="px-3 py-2 text-gray-600">{row.source_name}</td>
                <td className="px-3 py-2 text-gray-400">{row.phone || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {mappedRows.length > 10 && (
          <p className="text-xs text-gray-400 text-center py-2">
            + {mappedRows.length - 10} more rows
          </p>
        )}
      </div>

      {mutation.error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
        </div>
      )}

      <div className="flex justify-end mt-6 gap-2">
        <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
        <Button onClick={submit} loading={mutation.isPending}>
          Upload {mappedRows.length} candidates
        </Button>
      </div>
    </div>
  )

  // ─── Step 4: Done ─────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <CheckCircle className="w-12 h-12 text-green-500" />
      <p className="text-base font-medium text-gray-900">Upload complete!</p>
      <p className="text-sm text-gray-500">{csvRows.length} candidates added to the system.</p>
      <Button variant="secondary" onClick={() => { setStep(1); setCsvRows([]); setCsvHeaders([]) }}>
        Upload another file
      </Button>
    </div>
  )
}

function StepHeader({ step, total, onBack }: { step: number; total: number; onBack: () => void }) {
  const steps = ['Upload file', 'Map columns', 'Preview', 'Done']
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
        {steps.map((s, i) => (
          <span key={i} className={`flex items-center gap-1 ${i + 1 === step ? 'text-blue-600 font-medium' : ''}`}>
            {i > 0 && <ChevronRight className="w-3 h-3" />}
            {s}
          </span>
        ))}
      </div>
      <p className="text-sm text-gray-500">{total} rows detected in your file</p>
    </div>
  )
}
