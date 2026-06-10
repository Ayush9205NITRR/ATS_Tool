import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, CheckCircle, AlertTriangle, Loader2, Edit3, Link2, RotateCcw } from 'lucide-react'
import { Button } from '../../shared/components/Button'
import { parseResumeFromUrl } from './resumeParserService'
import { candidateService, normalizePhone } from '../candidates/candidateService'
import { useAuthStore } from '../auth/authStore'
import { useDuplicateCheck } from '../../shared/hooks/useDuplicateCheck'
import { supabase } from '../../lib/supabaseClient'

const PLATFORM_SRCS = ['LinkedIn','Naukri','Indeed','Internshala','Shine','Monster','Foundit','Apna','Unstop','Website','Other']

function SubSourceField({ sourceCategory, value, onChange }: {
  sourceCategory: string; value: string; onChange: (v: string) => void
}) {
  const { data: agencies = [] } = useQuery({
    queryKey: ['agency-users-subsource'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name').eq('role','agency').eq('is_active',true).order('full_name')
      return (data ?? []).map((u: any) => ({ id: u.id, name: u.full_name }))
    },
    staleTime: 60_000,
    enabled: sourceCategory === 'agency',
  })
  const { data: employees = [] } = useQuery({
    queryKey: ['app-settings', 'employee_referral_list'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key','employee_referral_list').maybeSingle()
      if (!data?.value) return [] as string[]
      try { return JSON.parse(data.value) as string[] } catch { return [] as string[] }
    },
    staleTime: 60_000,
    enabled: sourceCategory === 'referral',
  })
  const cls = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all'
  if (!sourceCategory) return <input disabled placeholder="Select source type first…" className={`${cls} bg-gray-50 text-gray-400 cursor-not-allowed border-gray-100`} />
  if (sourceCategory === 'agency') return (
    <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
      <option value="">Select agency…</option>
      {(agencies as any[]).map((a: any) => <option key={a.id} value={a.name}>{a.name}</option>)}
    </select>
  )
  if (sourceCategory === 'platform') return (
    <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
      <option value="">Select platform…</option>
      {PLATFORM_SRCS.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
  )
  if (sourceCategory === 'referral') {
    if ((employees as string[]).length === 0) return (
      <div className="space-y-1">
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder="Type referrer's name…" className={cls} />
        <p className="text-[11px] text-gray-400">
          No employee list configured.{' '}
          <a href="/settings" className="text-violet-500 hover:underline">Add employees in Settings →</a>
        </p>
      </div>
    )
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
        <option value="">Select employee…</option>
        {(employees as string[]).map(e => <option key={e} value={e}>{e}</option>)}
      </select>
    )
  }
  return <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="e.g. IIT Delhi, BITS Pilani…" className={cls} />
}

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all'

function Field({ label, error, required, children, className }: {
  label: string; error?: string; required?: boolean; children: React.ReactNode; className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}

export function SingleResumeUpload() {
  const { user, hasRole } = useAuthStore()
  const isAgency = hasRole(['agency'])
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [resumeUrl, setResumeUrl] = useState('')
  const [sourceCategory, setSourceCategory] = useState(isAgency ? 'agency' : '')
  const [sourceName, setSourceName] = useState(isAgency ? (user?.full_name ?? '') : '')

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [currentCompany, setCurrentCompany] = useState('')
  const [currentDesignation, setCurrentDesignation] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')

  const [parsed, setParsed] = useState(false)
  const [done, setDone] = useState(false)
  const { duplicates, check: checkDup, reset: resetDup } = useDuplicateCheck()

  useEffect(() => { if (!isAgency) setSourceName('') }, [sourceCategory])

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

  useEffect(() => { checkDup(email, phone) }, [email, phone])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: normalizePhone(phone) || null,
        resume_url: resumeUrl.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        source_category: isAgency ? 'agency' : (sourceCategory || 'platform') as 'platform' | 'agency' | 'college' | 'referral',
        source_name: isAgency ? (user?.full_name ?? '') : (sourceName.trim() || 'Unknown'),
        current_stage: 'Applied',
        status: 'active',
        tags: [],
        assigned_interviewers: [],
        job_id: selectedJobId || null,
        hr_owner: user?.role === 'hr_team' ? user!.id : null,
        assigned_hr_owners: user?.role === 'hr_team' ? [user!.id] : [],
        notes: null,
        screening_notes: null,
        interview_notes: {},
        custom_data: {
          ...(currentCompany ? { current_organization: currentCompany } : {}),
          ...(currentDesignation ? { designation: currentDesignation } : {}),
        },
        uploaded_by: user!.id,
        agency_id: isAgency ? (user!.id ?? null) : null,
        interview_date: null,
        archived_at: null,
        archived_by: null,
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
    setResumeUrl('')
    setSourceCategory(isAgency ? 'agency' : '')
    setSourceName(isAgency ? (user?.full_name ?? '') : '')
    setFullName(''); setEmail(''); setPhone(''); setLinkedinUrl('')
    setCurrentCompany(''); setCurrentDesignation('')
    setParsed(false); resetDup(); setDone(false); setSelectedJobId('')
    parseMutation.reset(); saveMutation.reset()
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 px-6">
        <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-green-500" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">Candidate Added!</p>
          <p className="text-sm text-gray-500 mt-1">Resume parsed and saved to your pipeline.</p>
        </div>
        <div className="flex gap-3 mt-2">
          <Button variant="secondary" onClick={resetForm} icon={<RotateCcw className="w-4 h-4" />}>Add another</Button>
          <Button onClick={() => navigate('/candidates')}>View candidates</Button>
        </div>
      </div>
    )
  }

  const canFetch = resumeUrl.trim().length > 10

  return (
    <div className="p-6 space-y-8">
      {/* Step 1 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white">1</span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Resume URL &amp; Source</h3>
            <p className="text-xs text-gray-400">Paste the public resume link and select the source</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Resume URL" required className="sm:col-span-2">
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="url"
                value={resumeUrl}
                onChange={e => setResumeUrl(e.target.value)}
                placeholder="https://drive.google.com/file/d/... or any public resume link"
                className={`${inputCls} pl-9`}
              />
            </div>
          </Field>

          {!isAgency ? (
            <Field label="Source">
              <select value={sourceCategory} onChange={e => setSourceCategory(e.target.value)} className={inputCls}>
                <option value="">Select source type…</option>
                <option value="platform">🔗 Platform</option>
                <option value="agency">🏢 Agency</option>
                <option value="college">🎓 College</option>
                <option value="referral">👤 Employee Referral</option>
              </select>
            </Field>
          ) : (
            <Field label="Source">
              <input value="Agency" disabled className={`${inputCls} bg-violet-50 text-violet-700 font-medium border-violet-200`} />
            </Field>
          )}

          {!isAgency ? (
            <Field label={sourceCategory === 'agency' ? 'Agency Name' : sourceCategory === 'college' ? 'College Name' : sourceCategory === 'referral' ? 'Referred By' : 'Platform'}>
              <SubSourceField sourceCategory={sourceCategory} value={sourceName} onChange={setSourceName} />
            </Field>
          ) : (
            <Field label="Agency">
              <input value={user?.full_name ?? ''} disabled className={`${inputCls} bg-violet-50 text-violet-700 font-medium border-violet-200`} />
            </Field>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => parseMutation.mutate(resumeUrl.trim())}
            disabled={!canFetch || parseMutation.isPending}
            loading={parseMutation.isPending}
            icon={<Search className="w-4 h-4" />}
          >
            {parseMutation.isPending ? 'Parsing…' : 'Fetch & Populate'}
          </Button>
          {parseMutation.isPending && (
            <span className="text-xs text-gray-400 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Extracting resume data, this may take a moment…
            </span>
          )}
        </div>

        {parseMutation.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-600">{(parseMutation.error as Error).message}</p>
          </div>
        )}
      </div>

      {/* Step 2 — shown after successful parse */}
      {parsed && (
        <>
          <div className="h-px bg-gradient-to-r from-transparent via-violet-200 to-transparent" />

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-white">2</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Review &amp; Edit</h3>
                  <Edit3 className="w-3.5 h-3.5 text-gray-400" />
                </div>
                <p className="text-xs text-gray-400">AI-extracted data — review and correct if needed</p>
              </div>
            </div>

            <div className="bg-violet-50/40 border border-violet-100 rounded-2xl p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Full Name" required>
                  <input value={fullName} onChange={e => setFullName(e.target.value)} className={inputCls} placeholder="Candidate's full name" />
                </Field>
                <Field label="Email" required error={duplicates.length > 0 ? `Duplicate: already exists as "${duplicates[0].full_name}"` : undefined}>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className={`${inputCls} ${duplicates.length > 0 ? 'border-red-300 focus:ring-red-400' : ''}`}
                    placeholder="email@example.com"
                  />
                </Field>
                <Field label="Phone">
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
                  <input value={currentDesignation} onChange={e => setCurrentDesignation(e.target.value)} className={inputCls} placeholder="Job title / role" />
                </Field>
                <Field label="Assign to Job" className="sm:col-span-2">
                  <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} className={inputCls}>
                    <option value="">— No specific job —</option>
                    {(jobs as any[]).map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            {duplicates.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-700">Duplicate candidate detected</p>
                  {duplicates.map(d => (
                    <p key={d.id} className="text-xs text-red-500 mt-0.5">
                      <em>{d.full_name}</em> already exists (matched by {d.match_type}) — currently at <strong>{d.current_stage}</strong>.
                    </p>
                  ))}
                </div>
              </div>
            )}

            {saveMutation.error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-sm text-red-600">{(saveMutation.error as Error).message}</p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={resetForm}>Reset</Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!fullName.trim() || !email.trim() || duplicates.length > 0}
                loading={saveMutation.isPending}
                icon={<CheckCircle className="w-4 h-4" />}
              >
                Save Candidate
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
