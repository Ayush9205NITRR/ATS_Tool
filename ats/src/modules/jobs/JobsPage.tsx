// ============================================================
// JOBS PAGE
// ============================================================
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Briefcase, Loader2 } from 'lucide-react'
import { jobService } from './jobService'
import { PageHeader } from '../../shared/components/PageHeader'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'
import { EmptyState } from '../../shared/components/EmptyState'
import { useAuthStore } from '../auth/authStore'
import { formatDate, labelOf } from '../../shared/utils/helpers'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

const schema = z.object({
  title: z.string().min(2, 'Required'),
  department: z.string().optional(),
  location: z.string().optional(),
  employment_type: z.enum(['full_time','part_time','contract','internship']).optional(),
  description: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

export function JobsPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: jobService.list,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const create = useMutation({
    mutationFn: (d: FormData) => jobService.create({
      ...d,
      department: d.department || null,
      location: d.location || null,
      employment_type: d.employment_type ?? null,
      description: d.description || null,
      status: 'open',
      pipeline_stages: ['Applied','Screening','Interview','Offer','Hired','Rejected'],
      created_by: user!.id,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jobs'] }); reset(); setShowModal(false) },
  })

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      jobService.update(id, { status: status as any }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle={`${jobs.length} total positions`}
        action={
          <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowModal(true)}>
            New Job
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="w-5 h-5" />}
          title="No jobs yet"
          description="Create your first job opening to start adding candidates."
          action={<Button size="sm" onClick={() => setShowModal(true)}>Create job</Button>}
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-medium text-gray-900">{job.title}</p>
                  <Badge label={job.status} type="status" />
                </div>
                <p className="text-sm text-gray-400">
                  {[job.department, job.location, job.employment_type ? labelOf(job.employment_type) : null]
                    .filter(Boolean).join(' · ')}
                </p>
                <p className="text-xs text-gray-300 mt-1">Created {formatDate(job.created_at)}</p>
              </div>
              {job.status === 'open' && (
                <Button
                  variant="secondary" size="sm"
                  loading={updateStatus.isPending}
                  onClick={() => updateStatus.mutate({ id: job.id, status: 'closed' })}
                >
                  Close
                </Button>
              )}
              {job.status === 'closed' && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => updateStatus.mutate({ id: job.id, status: 'open' })}
                >
                  Reopen
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Create Job Opening" size="sm">
        <form onSubmit={handleSubmit((d) => create.mutate(d))} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job Title *</label>
            <input {...register('title')} placeholder="e.g. Senior Backend Engineer" className={inputCls} />
            {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <input {...register('department')} placeholder="Engineering" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input {...register('location')} placeholder="Gurugram / Remote" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select {...register('employment_type')} className={inputCls}>
              <option value="">Select type</option>
              <option value="full_time">Full Time</option>
              <option value="part_time">Part Time</option>
              <option value="contract">Contract</option>
              <option value="internship">Internship</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea {...register('description')} rows={3} placeholder="Job description…" className={inputCls} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" loading={create.isPending}>Create Job</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
