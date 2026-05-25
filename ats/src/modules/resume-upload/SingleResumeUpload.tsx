import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, CheckCircle, AlertTriangle, Loader2, Edit3 } from 'lucide-react'
import { Button } from '../../shared/components/Button'
import { parseResumeFromUrl, checkDuplicateByEmail } from './resumeParserService'
import { candidateService, normalizePhone } from '../candidates/candidateService'
import { useAuthStore } from '../auth/authStore'
import { supabase } from '../../lib/supabaseClient'

const SOURCE_OPTIONS = [
  { value: 'platform', label: 'LinkedIn' },
  { value: 'platform', label: 'Naukri' },
  { value: 'platform', label: 'Indeed' },
  { value: 'agency', label: 'Agency' },
  { value: 'platform', label: 'Direct' },
  { value: 'college', label: 'Campus' },
  { value: 'platform', label: 'Referral' },
  { value: 'platform', label: 'Other' },
]

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'
const readOnlyCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-700'

function Field({ label, error, required, children, className }: {
  label: string; error?: string; required?: boolean; children: React.ReactNode; className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

type SourceLabel = typeof SOURCE_OPTIONS[number]['label']

function getSourceCategory(label: string): 'platform' | 'agency' | 'college' {
  const match = SOURCE_OPTIONS.find(o => o.label === label)
  return (match?.value as 'platform' | 'agency' | 'college') ?? 'platform'
}

export function SingleResumeUpload() {
  const { user, hasRole } = useAuthStore()
  const isAgency = hasRole(['agency'])
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [resumeUrl, setResumeUrl] = useState('')
  const [source, setSource] = useState<SourceLabel>(isAgency ? 'Agency' : '')
  const [subSource, setSubSource] = useState(isAgency ? (user?.full_name ?? '') : '')

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [currentCompany, setCurrentCompany] = useState('')
  const [currentDesignation, setCurrentDesignation] = useState('')

  const [parsed, setParsed] = useState(false)
  const [dupInfo, setDupInfo] = useState<{ exists: boolean; candidateId?: string; candidateName?: string }>({ exists: false })
  const [done, setDone] = useState(false)

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
  const [selectedJobId, setSelectedJobId] = useState('')

  const parseMutation = useMutation({
    mutationFn: (url: string) => parseResumeFromUrl(url),
    onSuccess: (data) => {
      setFullName(data.full_name || '')
      setEmail(data.email || '')
      setPhone(data.phone || '')
      setLinkedinUrl(data.linkedin_url || '')
      setCurrentCompany(data.current_company || '')
      setCurrentDesignation(data.current_designation || '')
      setParsed(true)
    },
  })

  useEffect(() => {
    if (!email) { setDupInfo({ exists: false }); return }
    const timer = setTimeout(async () => {
      const result = await checkDuplicateByEmail(email)
      setDupInfo(result)
    }, 600)
    return () => clearTimeout(timer)
  }, [email])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: normalizePhone(phone) || null,
        resume_url: resumeUrl.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        source_category: isAgency ? 'agency' : getSourceCategory(source),
        source_name: isAgency ? (user?.full_name ?? '') : (subSource.trim() || source || 'Unknown'),
        current_stage: 'Applied',
        status: 'active',
        tags: [],
        assigned_interviewers: [],
        job_id: selectedJobId || null,
        hr_owner: null,
        notes: null,
        screening_notes: null,
        interview_notes: {},
        custom_data: {
          ...(currentCompany ? { current_organization: currentCompany } : {}),
          ...(currentDesignation ? { designation: currentDesignation } : {}),
        },
        uploaded_by: user!.id,
        ...(isAgency ? { agency_id: user!.id } : {}),
      }
      return candidateService.create(payload, user?.role, user?.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
      setDone(true)
    },
  })

  const resetForm = () => {
    setResumeUrl(''); setSource(isAgency ? 'Agency' : ''); setSubSource(isAgency ? (user?.full_name ?? '') : '')
    setFullName(''); setEmail(''); setPhone(''); setLinkedinUrl('')
    setCurrentCompany(''); setCurrentDesignation('')
    setParsed(false); setDupInfo({ exists: false }); setDone(false); setSelectedJobId('')
    parseMutation.reset(); saveMutation.reset()
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <CheckCircle className="w-10 h-10 text-green-500" />
        <p className="text-lg font-semibold text-gray-900">Candidate added!</p>
        <p className="text-sm text-gray-500">Resume parsed and saved successfully.</p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={resetForm}>Add another</Button>
          <Button variant="secondary" onClick={() => navigate('/candidates')}>View candidates</Button>
        </div>
      </div>
    )
  }

  const canFetch = resumeUrl.trim().length > 0 && source.length > 0
  const canSave = fullName.trim() && email.trim() && !dupInfo.exists

  return (
    <div className="space-y-6">
      {/* Step 1: URL + Source */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white">1</span>
          </div>
          <h3 className="text-sm font-semibold text-gray-900">Enter Resume Details</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Resume URL" required className="sm:col-span-2">
            <input
              type="url"
              value={resumeUrl}
              onChange={e => setResumeUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/... or any public resume link"
              className={inputCls}
            />
          </Field>

          {!isAgency ? (
            <Field label="Source" required>
              <select
                value={source}
                onChange={e => setSource(e.target.value as SourceLabel)}
                className={inputCls}
              >
                <option value="">Select source...</option>
                {SOURCE_OPTIONS.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Source">
              <input value="Agency" disabled className={`${inputCls} bg-purple-50 text-purple-700 font-medium border-purple-200`} />
            </Field>
          )}

          {!isAgency ? (
            <Field label="Sub-Source">
              <input
                type="text"
                value={subSource}
                onChange={e => setSubSource(e.target.value)}
                placeholder='e.g. "Post by Ayush", "Campus Drive"'
                className={inputCls}
              />
            </Field>
          ) : (
            <Field label="Agency">
              <input value={user?.full_name ?? ''} disabled className={`${inputCls} bg-purple-50 text-purple-700 font-medium border-purple-200`} />
            </Field>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => parseMutation.mutate(resumeUrl.trim())}
            disabled={!canFetch}
            loading={parseMutation.isPending}
            icon={<Search className="w-4 h-4" />}
          >
            Fetch & Populate
          </Button>
          {parseMutation.isPending && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />Parsing resume...
            </span>
          )}
        </div>

        {parseMutation.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-600">{(parseMutation.error as Error).message}</p>
          </div>
        )}
      </div>

      {/* Step 2: Extracted data */}
      {parsed && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">2</span>
            </div>
            <h3 className="text-sm font-semibold text-gray-900">Review & Edit Extracted Data</h3>
            <Edit3 className="w-3.5 h-3.5 text-gray-400" />
          </div>

          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name" required>
                <input value={fullName} onChange={e => setFullName(e.target.value)} className={inputCls} placeholder="Candidate's full name" />
              </Field>
              <Field label="Email" required error={dupInfo.exists ? `Duplicate: ${dupInfo.candidateName}` : undefined}>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="email@example.com" />
              </Field>
              <Field label="Phone Number">
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className={inputCls}
                  placeholder="10-digit number"
                  maxLength={10}
                />
              </Field>
              <Field label="LinkedIn URL">
                <input value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} className={inputCls} placeholder="https://linkedin.com/in/..." />
              </Field>
              <Field label="Current Company">
                <input value={currentCompany} onChange={e => setCurrentCompany(e.target.value)} className={inputCls} placeholder="Company name" />
              </Field>
              <Field label="Current Designation">
                <input value={currentDesignation} onChange={e => setCurrentDesignation(e.target.value)} className={inputCls} placeholder="Job title" />
              </Field>
              <Field label="Assign to Job" className="sm:col-span-2">
                <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} className={inputCls}>
                  <option value="">-- No job --</option>
                  {(jobs as any[]).map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {dupInfo.exists && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-700 font-medium">Duplicate candidate detected</p>
                <p className="text-xs text-red-600">
                  A candidate with email <strong>{email}</strong> already exists: <em>{dupInfo.candidateName}</em>.
                  Change the email or update the existing record instead.
                </p>
              </div>
            </div>
          )}

          {saveMutation.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-sm text-red-600">{(saveMutation.error as Error).message}</p>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave}
              loading={saveMutation.isPending}
              icon={<CheckCircle className="w-4 h-4" />}
            >
              Save Candidate
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
