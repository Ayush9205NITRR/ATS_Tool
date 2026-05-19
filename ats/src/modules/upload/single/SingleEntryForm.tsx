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
import { SourceDropdown } from '../../../shared/components/SourceDropdown'
import { supabase } from '../../../lib/supabaseClient'

const schema = z.object({
  full_name:       z.string().min(1, 'Name required'),
  email:           z.string().email('Valid email required').transform(v => v.trim().toLowerCase()),
  phone:           z.string()
    .refine(v => !v?.trim() || v.replace(/\D/g,'').length === 10, '10 digits required')
    .optional(),
  job_id:          z.string().optional(),
  source_category: z.enum(['platform','agency','college']).default('platform'),
  source_name:     z.string().optional(),
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
  const [source, setSource] = useState<{ category: string; name: string }>(
    isAgency ? { category: 'agency', name: user?.full_name ?? '' } : { category: 'platform', name: '' }
  )
  const [customValues, setCustomValues] = useState<Record<string,any>>({})
  const { duplicates, checking, check, reset: resetDup } = useDuplicateCheck()

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'open', isAgency ? 'agency' : 'all'],
    queryFn: async () => {
      let q = supabase.from('jobs').select('id,title').eq('status','open').order('title')
      if (isAgency) q = (q as any).eq('show_to_agency', true)
      const { data } = await q
      return data ?? []
    },
  })

  const { data: customFields = [] } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => {
      const { data } = await supabase.from('custom_fields').select('*').eq('is_active',true).order('sort_order')
      return data ?? []
    },
  })

  const { register, handleSubmit, reset: resetForm, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { source_category: isAgency ? 'agency' : 'platform' },
  })

  const watchEmail  = watch('email')
  const watchPhone  = watch('phone')
  useEffect(() => { check(watchEmail ?? '', watchPhone ?? '') }, [watchEmail, watchPhone])

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload: any = {
        full_name:            data.full_name,
        email:                data.email,
        phone:                data.phone?.replace(/\D/g,'').slice(0,10) || null,
        job_id:               data.job_id || null,
        source_category:      isAgency ? 'agency' : source.category,
        source_name:          isAgency ? (user?.full_name ?? '') : source.name,
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
        // Agency: set agency_id to their own user id
        ...(isAgency ? { agency_id: user!.id } : {}),
      }
      return candidateService.create(payload, user?.role, user?.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
      setDone(true); resetDup(); resetForm()
      setSource(isAgency ? { category: 'agency', name: user?.full_name ?? '' } : { category: 'platform', name: '' })
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

  // Visible custom fields for this role
  const visibleCustomFields = (customFields as any[]).filter(f =>
    isAgency ? f.show_to_agency !== false : true
  )

  return (
    <form onSubmit={handleSubmit(d => {
      if (duplicates.length > 0) return
      mutation.mutate(d)
    })} className="space-y-4">

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Full Name *" error={errors.full_name?.message}>
          <input {...register('full_name')} placeholder="Priya Sharma" className={inputCls}/>
        </Field>
        <Field label="Email *" error={errors.email?.message}>
          <input {...register('email')} type="email" placeholder="priya@example.com" className={inputCls}/>
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <input {...register('phone')} placeholder="10-digit number" maxLength={10}
            onInput={e => { (e.target as HTMLInputElement).value = (e.target as HTMLInputElement).value.replace(/\D/g,'').slice(0,10) }}
            className={inputCls}/>
        </Field>
        <Field label="Job Opening">
          <select {...register('job_id')} className={inputCls}>
            <option value="">Select job (optional)</option>
            {(jobs as any[]).map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
          {isAgency && (jobs as any[]).length === 0 && (
            <p className="mt-1 text-xs text-amber-600">No active job openings available.</p>
          )}
        </Field>

        {/* Source — single combined dropdown (agency/platform/college + sub-source in one) */}
        {!isAgency ? (
          <Field label="Source *" className="sm:col-span-2">
            <SourceDropdown value={source} onChange={setSource}/>
            {!source.name && <p className="mt-1 text-xs text-amber-600">Select a source</p>}
          </Field>
        ) : (
          <Field label="Agency" className="sm:col-span-1">
            <input value={user?.full_name ?? ''} disabled
              className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm bg-purple-50 text-purple-700 font-medium"/>
          </Field>
        )}

        <Field label="Resume URL" error={errors.resume_url?.message} className="sm:col-span-2">
          <input {...register('resume_url')} placeholder="https://drive.google.com/file/d/…" className={inputCls}/>
        </Field>
        <Field label="LinkedIn URL" error={errors.linkedin_url?.message} className="sm:col-span-2">
          <input {...register('linkedin_url')} placeholder="https://linkedin.com/in/…" className={inputCls}/>
        </Field>
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
                  <input
                    type={f.field_type==='number'?'number':f.field_type==='date'?'date':f.field_type==='url'?'url':'text'}
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
            🚫 Duplicate found — fix email/phone before adding
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
