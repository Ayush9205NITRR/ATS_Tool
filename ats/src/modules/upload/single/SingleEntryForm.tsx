import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CheckCircle } from 'lucide-react'
import { candidateService } from '../../candidates/candidateService'
import { useAuthStore } from '../../auth/authStore'
import { useDuplicateCheck } from '../../../shared/hooks/useDuplicateCheck'
import { DuplicateWarning } from '../../../shared/components/DuplicateWarning'
import { Button } from '../../../shared/components/Button'
import { supabase } from '../../../lib/supabaseClient'

const PLATFORM_SRCS = ['LinkedIn','Naukri','Indeed','Internshala','Shine','Monster','Foundit','Apna','Referral','Website','Other']

// Inline SubSourceField — no external file dependency
function SubSourceField({ sourceCategory, value, onChange, required }: {
  sourceCategory: string; value: string; onChange:(v:string)=>void; required?: boolean
}) {
  const { data: agencies = [] } = useQuery({
    queryKey: ['agency-users-subsource'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name').eq('role','agency').eq('is_active',true).order('full_name')
      return (data ?? []).map((u:any) => ({ id: u.id, name: u.full_name }))
    },
    staleTime: 60_000,
  })
  const cls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500'
  if (!sourceCategory) return <input disabled placeholder="Select source type first…" className={`${cls} bg-gray-50 text-gray-400`}/>
  if (sourceCategory === 'agency') return (
    <select value={value} onChange={e=>onChange(e.target.value)} className={cls} required={required}>
      <option value="">Select agency…</option>
      {(agencies as any[]).map((a:any) => <option key={a.id} value={a.name}>{a.name}</option>)}
    </select>
  )
  if (sourceCategory === 'platform') return (
    <select value={value} onChange={e=>onChange(e.target.value)} className={cls} required={required}>
      <option value="">Select platform…</option>
      {PLATFORM_SRCS.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
  )
  return <input type="text" value={value} onChange={e=>onChange(e.target.value)} placeholder="e.g. IIT Delhi, BITS Pilani…" className={cls} required={required}/>
}

const schema = z.object({
  full_name:       z.string().min(1, 'Name required'),
  email:           z.string().email('Valid email required').transform(v => v.trim().toLowerCase()),
  phone:           z.string().refine(v => !v?.trim() || v.replace(/\D/g,'').length === 10, '10-digit number required').optional(),
  job_id:          z.string().min(1, 'Job selection is required'),
  source_category: z.enum(['platform','agency','college']).optional(),
  resume_url:      z.string().url('Valid URL').optional().or(z.literal('')),
  linkedin_url:    z.string().url('Valid URL').optional().or(z.literal('')),
  notes:           z.string().optional(),
})
type FormData = z.infer<typeof schema>

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'
const Field = ({ label, error, children, className }: { label:string; error?:string; children:React.ReactNode; className?:string }) => (
  <div className={className}>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    {children}
    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
  </div>
)

export function SingleEntryForm({ onSuccess }: { onSuccess?: () => void }) {
  const { user, hasRole } = useAuthStore()
  const isAgency = hasRole(['agency'])
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [done, setDone] = useState(false)
  const [sourceCategory, setSourceCategory] = useState(isAgency ? 'agency' : '')
  const [sourceName, setSourceName] = useState(isAgency ? (user?.full_name ?? '') : '')
  const [customValues, setCustomValues] = useState<Record<string,any>>({})
  const { duplicates, checking, check, reset: resetDup } = useDuplicateCheck()

  // Reset sub-source when source changes
  useEffect(() => { if (!isAgency) setSourceName('') }, [sourceCategory])

  // Jobs — agency sees only jobs assigned to them
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'open', isAgency ? `agency-${user?.id}` : 'all'],
    queryFn: async () => {
      const { data } = await supabase.from('jobs').select('id,title,show_to_agency,allowed_agency_ids').eq('status','open').order('title')
      if (!isAgency || !user?.id) return data ?? []
      return (data ?? []).filter((j:any) =>
        j.show_to_agency && (!j.allowed_agency_ids || j.allowed_agency_ids.length === 0 || j.allowed_agency_ids.includes(user.id))
      )
    },
  })

  const { data: customFields = [] } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => {
      const { data } = await supabase.from('custom_fields').select('*').eq('is_active',true).order('sort_order')
      return data ?? []
    },
  })

  const { register, handleSubmit, reset: resetForm, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const watchEmail = watch('email')
  const watchPhone = watch('phone')
  useEffect(() => { check(watchEmail ?? '', watchPhone ?? '') }, [watchEmail, watchPhone])

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload: any = {
        full_name:            data.full_name,
        email:                data.email,
        phone:                data.phone?.replace(/\D/g,'').slice(0,10) || null,
        job_id:               data.job_id,
        source_category:      isAgency ? 'agency' : (sourceCategory || 'platform'),
        source_name:          isAgency ? (user?.full_name ?? '') : sourceName,
        resume_url:           data.resume_url || null,
        linkedin_url:         data.linkedin_url || null,
        notes:                data.notes || null,
        current_stage:        'Applied',
        status:               'active',
        tags:                 [],
        assigned_interviewers:[],
        hr_owner:             null,
        screening_notes:      null,
        interview_notes:      {},
        custom_data:          customValues,
        uploaded_by:          user!.id,
        ...(isAgency ? { agency_id: user!.id } : {}),
      }
      return candidateService.create(payload, user?.role, user?.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
      setDone(true); resetDup(); resetForm()
      setSourceCategory(isAgency ? 'agency' : '')
      setSourceName(isAgency ? (user?.full_name ?? '') : '')
      setCustomValues({})
      setTimeout(() => { setDone(false); onSuccess?.() }, 2000)
    },
  })

  if (done) return (
    <div className="flex flex-col items-center gap-3 py-12">
      <CheckCircle className="w-10 h-10 text-green-500"/>
      <p className="text-lg font-semibold text-gray-900">Candidate added!</p>
      <Button variant="secondary" onClick={() => navigate('/candidates')}>View submissions</Button>
    </div>
  )

  const visibleCustomFields = (customFields as any[]).filter(f => !isAgency || f.show_to_agency !== false)

  return (
    <form onSubmit={handleSubmit(d => {
      if (duplicates.length > 0) return
      mutation.mutate(d)
    })} className="space-y-4">

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Name */}
        <Field label="Full Name *" error={errors.full_name?.message}>
          <input {...register('full_name')} placeholder="Priya Sharma" className={inputCls}/>
        </Field>

        {/* Email */}
        <Field label="Email *" error={errors.email?.message}>
          <input {...register('email')} type="email" placeholder="priya@example.com" className={inputCls}/>
        </Field>

        {/* Phone */}
        <Field label="Phone" error={errors.phone?.message}>
          <input {...register('phone')} placeholder="10-digit number" maxLength={10}
            onInput={e => { (e.target as HTMLInputElement).value = (e.target as HTMLInputElement).value.replace(/\D/g,'').slice(0,10) }}
            className={inputCls}/>
        </Field>

        {/* Job — Mandatory */}
        <Field label="Job Opening *" error={errors.job_id?.message}>
          <select {...register('job_id')} className={inputCls}>
            <option value="">Select job *</option>
            {(jobs as any[]).map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
          {isAgency && (jobs as any[]).length === 0 && (
            <p className="mt-1 text-xs text-red-500">No job openings available — contact HR.</p>
          )}
        </Field>

        {/* Source — hidden for agency (auto-set) */}
        {!isAgency ? (
          <Field label="Source *">
            <select value={sourceCategory} onChange={e => setSourceCategory(e.target.value)} className={inputCls}>
              <option value="">Select source type…</option>
              <option value="platform">🔗 Platform</option>
              <option value="agency">🏢 Agency</option>
              <option value="college">🎓 College</option>
            </select>
          </Field>
        ) : (
          <Field label="Agency">
            <input value={user?.full_name ?? ''} disabled className={`${inputCls} bg-purple-50 text-purple-700 font-medium border-purple-200`}/>
          </Field>
        )}

        {/* Sub-Source — dynamic based on source */}
        {!isAgency && (
          <Field label={sourceCategory === 'agency' ? 'Agency Name *' : sourceCategory === 'college' ? 'College Name *' : 'Platform *'}>
            <SubSourceField
              sourceCategory={sourceCategory}
              value={sourceName}
              onChange={setSourceName}
              required
            />
          </Field>
        )}

        {/* Resume */}
        <Field label="Resume URL" error={errors.resume_url?.message} className="sm:col-span-2">
          <input {...register('resume_url')} placeholder="https://drive.google.com/file/d/…" className={inputCls}/>
        </Field>

        {/* LinkedIn */}
        <Field label="LinkedIn URL" error={errors.linkedin_url?.message} className="sm:col-span-2">
          <input {...register('linkedin_url')} placeholder="https://linkedin.com/in/…" className={inputCls}/>
        </Field>

        {/* Notes */}
        <Field label="Notes" className="sm:col-span-2">
          <textarea {...register('notes')} rows={3} placeholder="Any initial notes…" className={inputCls}/>
        </Field>
      </div>

      {/* Custom fields */}
      {visibleCustomFields.length > 0 && (
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Additional Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visibleCustomFields.map((f:any) => (
              <Field key={f.id} label={f.is_required ? `${f.field_label} *` : f.field_label}>
                {f.field_type === 'boolean' ? (
                  <div className="flex items-center gap-2">
                    <input type="checkbox" onChange={e => setCustomValues(p=>({...p,[f.field_name]:e.target.checked}))}
                      className="rounded border-gray-300 text-blue-600"/>
                    <span className="text-sm text-gray-600">{f.field_label}</span>
                  </div>
                ) : (
                  <input type={f.field_type==='number'?'number':f.field_type==='date'?'date':f.field_type==='url'?'url':'text'}
                    placeholder={f.field_label}
                    onChange={e => setCustomValues(p=>({...p,[f.field_name]:e.target.value}))}
                    className={inputCls}/>
                )}
              </Field>
            ))}
          </div>
        </div>
      )}

      {(duplicates.length > 0 || checking) && (
        <DuplicateWarning duplicates={duplicates} checking={checking}
          onViewProfile={id => window.open(`/candidates/${id}`, '_blank')}/>
      )}

      {mutation.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
        </div>
      )}

      <div className="flex justify-end pt-2">
        {duplicates.length > 0 ? (
          <span className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            🚫 Duplicate — fix email/phone before adding
          </span>
        ) : (
          <Button type="submit" loading={mutation.isPending} disabled={checking}>
            {checking ? 'Checking…' : 'Add Candidate'}
          </Button>
        )}
      </div>
    </form>
  )
}
