import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle } from 'lucide-react'
import { useState } from 'react'
import { candidateService } from '../../candidates/candidateService'
import { supabase } from '../../../lib/supabaseClient'
import { useAuthStore } from '../../auth/authStore'
import { Button } from '../../../shared/components/Button'

const schema = z.object({
  full_name:       z.string().min(2, 'Required'),
  email:           z.string().email('Valid email required'),
  phone:           z.string().optional(),
  job_id:          z.string().optional(),
  source_category: z.enum(['platform','agency','college'], { required_error: 'Select a source type' }),
  source_name:     z.string().min(1, 'Source name required'),
  resume_url:      z.string().url('Enter a valid URL').optional().or(z.literal('')),
  linkedin_url:    z.string().url('Enter a valid URL').optional().or(z.literal('')),
  notes:           z.string().optional(),
})
type FormData = z.infer<typeof schema>

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

interface Props { onSuccess?: () => void }

export function SingleEntryForm({ onSuccess }: Props) {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [done, setDone] = useState(false)
  const [customValues, setCustomValues] = useState<Record<string, any>>({})

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'open'],
    queryFn: async () => {
      const { data } = await supabase.from('jobs').select('id,title').eq('status','open').order('title')
      return data ?? []
    },
  })

  const { data: customFields = [] } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => {
      const { data } = await supabase.from('custom_fields').select('*').eq('is_active', true).order('sort_order')
      return data ?? []
    },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { source_category: 'platform' },
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      candidateService.create({
        ...data,
        job_id: data.job_id || null,
        phone: data.phone || null,
        resume_url: data.resume_url || null,
        linkedin_url: data.linkedin_url || null,
        notes: data.notes || null,
        current_stage: 'Applied',
        status: 'active',
        tags: [],
        assigned_interviewers: [],
        hr_owner: null,
        screening_notes: null,
        interview_notes: {},
        custom_data: customValues,
        uploaded_by: user!.id,
      } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
      setDone(true)
      setCustomValues({})
      reset()
      setTimeout(() => { setDone(false); onSuccess?.() }, 2000)
    },
  })

  const renderCustomField = (field: any) => {
    const value = customValues[field.field_name] ?? ''
    const onChange = (v: any) => setCustomValues((p) => ({ ...p, [field.field_name]: v }))

    switch (field.field_type) {
      case 'number':
        return <input type="number" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${field.field_label.toLowerCase()}`} className={inputCls} />
      case 'date':
        return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      case 'url':
        return <input type="url" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder="https://" className={inputCls} />
      case 'boolean':
        return (
          <div className="flex items-center gap-2 py-2">
            <input type="checkbox" id={field.field_name} checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 w-4 h-4" />
            <label htmlFor={field.field_name} className="text-sm text-gray-600">Yes</label>
          </div>
        )
      default:
        return <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${field.field_label.toLowerCase()}`} className={inputCls} />
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <CheckCircle className="w-10 h-10 text-green-500" />
        <p className="text-sm font-medium text-gray-700">Candidate added successfully!</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Full Name *" error={errors.full_name?.message}>
          <input {...register('full_name')} placeholder="Rahul Sharma" className={inputCls} />
        </Field>
        <Field label="Email *" error={errors.email?.message}>
          <input {...register('email')} type="email" placeholder="rahul@example.com" className={inputCls} />
        </Field>
        <Field label="Phone">
          <input {...register('phone')} placeholder="+91 98765 43210" className={inputCls} />
        </Field>
        <Field label="Job Opening">
          <select {...register('job_id')} className={inputCls}>
            <option value="">— No specific role —</option>
            {(jobs as any[]).map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </Field>
        <Field label="Source Type *" error={errors.source_category?.message}>
          <select {...register('source_category')} className={inputCls}>
            <option value="platform">Platform (LinkedIn, Naukri…)</option>
            <option value="agency">Agency</option>
            <option value="college">College</option>
          </select>
        </Field>
        <Field label="Source Name *" error={errors.source_name?.message}>
          <input {...register('source_name')} placeholder="e.g. LinkedIn / ABC Consultants / IIT Delhi" className={inputCls} />
        </Field>
        <Field label="Resume URL (Google Drive)" error={errors.resume_url?.message} className="sm:col-span-2">
          <input {...register('resume_url')} placeholder="https://drive.google.com/file/d/…" className={inputCls} />
        </Field>
        <Field label="LinkedIn URL" error={errors.linkedin_url?.message} className="sm:col-span-2">
          <input {...register('linkedin_url')} placeholder="https://linkedin.com/in/…" className={inputCls} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea {...register('notes')} rows={3} placeholder="Any initial notes…" className={inputCls} />
        </Field>

        {/* Custom Fields */}
        {(customFields as any[]).length > 0 && (
          <div className="sm:col-span-2">
            <div className="border-t border-gray-100 pt-4 mt-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Additional Fields</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(customFields as any[]).map((field) => (
                  <div key={field.id}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {field.field_label}
                      {field.is_required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    {renderCustomField(field)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {mutation.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={mutation.isPending}>Add Candidate</Button>
      </div>
    </form>
  )
}

function Field({ label, error, children, className = '' }: {
  label: string; error?: string; children: React.ReactNode; className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
