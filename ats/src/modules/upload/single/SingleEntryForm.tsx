// ============================================================
// SINGLE ENTRY FORM — add one candidate manually
// ============================================================
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

interface Props { onSuccess?: () => void }

export function SingleEntryForm({ onSuccess }: Props) {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [done, setDone] = useState(false)

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'open'],
    queryFn: async () => {
      const { data } = await supabase.from('jobs').select('id,title').eq('status','open').order('title')
      return data ?? []
    },
  })

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormData>({
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
        uploaded_by: user!.id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
      setDone(true)
      reset()
      setTimeout(() => { setDone(false); onSuccess?.() }, 2000)
    },
  })

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
        <Field label="Phone" error={errors.phone?.message}>
          <input {...register('phone')} placeholder="+91 98765 43210" className={inputCls} />
        </Field>
        <Field label="Job Opening" error={errors.job_id?.message}>
          <select {...register('job_id')} className={inputCls}>
            <option value="">— No specific role —</option>
            {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.title}</option>)}
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
      </div>

      {mutation.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={mutation.isPending}>
          Add Candidate
        </Button>
      </div>
    </form>
  )
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

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
