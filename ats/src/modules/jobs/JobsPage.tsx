import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Briefcase, Loader2, Users, Target, DollarSign, ChevronDown, ChevronRight } from 'lucide-react'
import { jobService } from './jobService'
import { supabase } from '../../lib/supabaseClient'
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

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

const schema = z.object({
  title:            z.string().min(2, 'Required'),
  department:       z.string().optional(),
  location:         z.string().optional(),
  employment_type:  z.enum(['full_time','part_time','contract','internship']).optional(),
  job_level:        z.string().optional(),
  headcount:        z.number().min(1).default(1),
  salary_min:       z.string().optional(),
  salary_max:       z.string().optional(),
  target_date:      z.string().optional(),
  required_skills:  z.string().optional(),
  description:      z.string().optional(),
})
type FormData = z.infer<typeof schema>

const JOB_LEVELS = ['Intern','Junior','Mid','Senior','Lead','Manager','Director','VP']

const STATUS_COLOUR: Record<string, string> = {
  open:   'bg-green-100 text-green-700',
  draft:  'bg-gray-100 text-gray-600',
  paused: 'bg-amber-100 text-amber-700',
  closed: 'bg-red-100 text-red-600',
}

export function JobsPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: jobService.list,
  })

  // Candidate counts per job
  const { data: candidateCounts = {} } = useQuery({
    queryKey: ['jobs','candidate-counts'],
    queryFn: async () => {
      const { data } = await supabase.from('candidates').select('job_id, current_stage').eq('status','active')
      const counts: Record<string, { total: number; stages: Record<string, number> }> = {}
      data?.forEach(c => {
        if (!c.job_id) return
        if (!counts[c.job_id]) counts[c.job_id] = { total: 0, stages: {} }
        counts[c.job_id].total++
        counts[c.job_id].stages[c.current_stage] = (counts[c.job_id].stages[c.current_stage] ?? 0) + 1
      })
      return counts
    },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { headcount: 1 },
  })

  const create = useMutation({
    mutationFn: (d: FormData) => jobService.create({
      title: d.title,
      department: d.department || null,
      location: d.location || null,
      employment_type: d.employment_type ?? null,
      description: d.description || null,
      status: 'open',
      pipeline_stages: ['Applied','Screening','R1','Case Study','R2','R3','CF (Virtual)','CF (In-Person)','Offer','Hired','Rejected'],
      hr_owner: null,
      created_by: user!.id,
      // Extra fields stored in description as JSON for now
    } as any),
    onSuccess: () => { qc.invalidateQueries({queryKey:['jobs']}); reset(); setShowModal(false) },
  })

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      jobService.update(id, { status: status as any }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })

  const STAGE_ORDER = ['Applied','Screening','R1','Case Study','R2','R3','CF (Virtual)','CF (In-Person)','Offer','Hired','Rejected']
  const STAGE_COLOURS: Record<string, string> = {
    Applied:'bg-gray-400', Screening:'bg-blue-400', R1:'bg-indigo-400',
    'Case Study':'bg-yellow-400', R2:'bg-orange-400', R3:'bg-orange-500',
    'CF (Virtual)':'bg-purple-400', 'CF (In-Person)':'bg-purple-500',
    Offer:'bg-violet-500', Hired:'bg-green-500', Rejected:'bg-red-400',
  }

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle={`${jobs.length} total positions`}
        action={
          <Button size="sm" icon={<Plus className="w-3.5 h-3.5"/>} onClick={() => setShowModal(true)}>
            New Job
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
      ) : jobs.length === 0 ? (
        <EmptyState icon={<Briefcase className="w-5 h-5"/>} title="No jobs yet"
          description="Create your first job opening."
          action={<Button size="sm" onClick={() => setShowModal(true)}>Create job</Button>}/>
      ) : (
        <div className="space-y-3">
          {jobs.map((job: any) => {
            const counts = (candidateCounts as any)[job.id] ?? { total: 0, stages: {} }
            const isExpanded = expanded === job.id
            const activeStages = STAGE_ORDER.filter(s => counts.stages[s] > 0)

            return (
              <div key={job.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Job header */}
                <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50/50"
                  onClick={() => setExpanded(isExpanded ? null : job.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className="font-semibold text-gray-900">{job.title}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOUR[job.status]}`}>
                        {job.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      {job.department && <span>{job.department}</span>}
                      {job.location && <span>📍 {job.location}</span>}
                      {job.employment_type && <span>{labelOf(job.employment_type)}</span>}
                      <span>Created {formatDate(job.created_at)}</span>
                    </div>
                  </div>

                  {/* Candidate count */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-blue-600">{counts.total}</p>
                      <p className="text-xs text-gray-400">candidates</p>
                    </div>

                    {/* Mini funnel */}
                    {activeStages.length > 0 && (
                      <div className="hidden md:flex items-center gap-1">
                        {activeStages.slice(0, 5).map(s => (
                          <div key={s} className="text-center">
                            <div className={`w-6 h-6 rounded-full ${STAGE_COLOURS[s] ?? 'bg-gray-300'} flex items-center justify-center`}>
                              <span className="text-white text-xs font-bold">{counts.stages[s]}</span>
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5" style={{fontSize:'9px'}}>{s.substring(0,3)}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {job.status === 'open' && (
                        <Button variant="secondary" size="sm" loading={updateStatus.isPending}
                          onClick={e => { e.stopPropagation(); updateStatus.mutate({id:job.id, status:'closed'}) }}>
                          Close
                        </Button>
                      )}
                      {job.status === 'closed' && (
                        <Button variant="ghost" size="sm"
                          onClick={e => { e.stopPropagation(); updateStatus.mutate({id:job.id, status:'open'}) }}>
                          Reopen
                        </Button>
                      )}
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400"/> : <ChevronRight className="w-4 h-4 text-gray-400"/>}
                    </div>
                  </div>
                </div>

                {/* Expanded stage breakdown */}
                {isExpanded && (
                  <div className="px-5 pb-4 pt-1 border-t border-gray-100 bg-gray-50/30">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Stage Breakdown</p>
                    {activeStages.length === 0 ? (
                      <p className="text-sm text-gray-400">No candidates yet</p>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {STAGE_ORDER.filter(s => counts.stages[s]).map(s => (
                          <div key={s} className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                            <p className="text-xl font-bold text-gray-900">{counts.stages[s]}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{s}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create Job Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Create Job Opening" size="md">
        <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job Title *</label>
            <input {...register('title')} placeholder="e.g. Senior Backend Engineer" className={inputCls}/>
            {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <input {...register('department')} placeholder="Engineering" className={inputCls}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input {...register('location')} placeholder="Gurugram / Remote" className={inputCls}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Employment Type</label>
              <select {...register('employment_type')} className={inputCls}>
                <option value="">Select type</option>
                <option value="full_time">Full Time</option>
                <option value="part_time">Part Time</option>
                <option value="contract">Contract</option>
                <option value="internship">Internship</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Job Level</label>
              <select {...register('job_level')} className={inputCls}>
                <option value="">Select level</option>
                {JOB_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">No. of Openings</label>
              <input {...register('headcount', {valueAsNumber:true})} type="number" min="1" defaultValue="1" className={inputCls}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Hire Date</label>
              <input {...register('target_date')} type="date" className={inputCls}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Salary Min (LPA)</label>
              <input {...register('salary_min')} placeholder="e.g. 8" className={inputCls}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Salary Max (LPA)</label>
              <input {...register('salary_max')} placeholder="e.g. 15" className={inputCls}/>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Required Skills</label>
            <input {...register('required_skills')} placeholder="React, Node.js, PostgreSQL (comma separated)" className={inputCls}/>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job Description</label>
            <textarea {...register('description')} rows={3} placeholder="Job description…" className={inputCls}/>
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
