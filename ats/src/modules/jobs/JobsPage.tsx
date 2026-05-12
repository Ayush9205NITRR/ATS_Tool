import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Briefcase, Loader2, ChevronDown, ChevronRight, Pencil, Users, Calendar, DollarSign, Target, Hash, Layers, ExternalLink } from 'lucide-react'
import { jobService } from './jobService'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader } from '../../shared/components/PageHeader'
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
  title:           z.string().min(2,'Required'),
  department:      z.string().optional(),
  location:        z.string().optional(),
  employment_type: z.enum(['full_time','part_time','contract','internship']).optional(),
  job_level:       z.string().optional(),
  headcount:       z.coerce.number().min(1).default(1),
  salary_min:      z.coerce.number().optional(),
  salary_max:      z.coerce.number().optional(),
  target_date:     z.string().optional(),
  required_skills: z.string().optional(),
  requisition_id:  z.string().optional(),
  description:     z.string().optional(),
  jd_link:         z.string().optional(),
})
type FormData = z.infer<typeof schema>

const JOB_LEVELS = ['Intern','Junior','Mid-Level','Senior','Lead','Manager','Director','VP']

const STAGE_ORDER = ['Applied','Screening','R1','Case Study','R2','R3','CF (Virtual)','CF (In-Person)','Offer','Hired','Rejected']
const STAGE_COLOURS: Record<string,string> = {
  Applied:'bg-gray-300 text-gray-700', Screening:'bg-blue-400 text-white',
  R1:'bg-indigo-400 text-white', 'Case Study':'bg-yellow-400 text-gray-800',
  R2:'bg-orange-400 text-white', R3:'bg-orange-500 text-white',
  'CF (Virtual)':'bg-purple-400 text-white','CF (In-Person)':'bg-purple-500 text-white',
  Offer:'bg-violet-500 text-white', Hired:'bg-green-500 text-white', Rejected:'bg-red-400 text-white',
}

const STATUS_COLOUR: Record<string,string> = {
  open:  'bg-green-100 text-green-700 border border-green-200',
  draft: 'bg-gray-100 text-gray-600 border border-gray-200',
  paused:'bg-amber-100 text-amber-700 border border-amber-200',
  closed:'bg-red-100 text-red-600 border border-red-200',
}

function JobForm({ job, onClose }: { job?: any; onClose: () => void }) {
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const {register,handleSubmit,formState:{errors}} = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: job ? {
      ...job,
      required_skills: job.required_skills?.join(', ') ?? '',
      salary_min: job.salary_min ?? undefined,
      salary_max: job.salary_max ?? undefined,
    } : { headcount: 1 },
  })

  const save = useMutation({
    mutationFn: async (d: FormData) => {
      const skills = d.required_skills ? d.required_skills.split(',').map(s=>s.trim()).filter(Boolean) : []
      const payload = {
        title: d.title, department: d.department||null, location: d.location||null,
        employment_type: d.employment_type??null, description: d.description||null,
        job_level: d.job_level||null, headcount: d.headcount||1,
        salary_min: d.salary_min||null, salary_max: d.salary_max||null,
        target_date: d.target_date||null, required_skills: skills,
        requisition_id: d.requisition_id||null,
        jd_link: (d as any).jd_link||null,
      }
      if (job) return jobService.update(job.id, payload as any)
      return jobService.create({
        ...payload, status:'open', hr_owner: null, created_by: user!.id,
        pipeline_stages: ['Applied','Screening','R1','Case Study','R2','R3','CF (Virtual)','CF (In-Person)','Offer','Hired','Rejected'],
      } as any)
    },
    onSuccess: () => { qc.invalidateQueries({queryKey:['jobs']}); onClose() },
  })

  return (
    <form onSubmit={handleSubmit(d=>save.mutate(d))} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Job Title *</label>
        <input {...register('title')} placeholder="e.g. Business Development Manager" className={inputCls}/>
        {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
          <input {...register('department')} placeholder="Sales, Engineering…" className={inputCls}/>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
          <input {...register('location')} placeholder="Gurugram / Remote" className={inputCls}/>
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Level</label>
          <select {...register('job_level')} className={inputCls}>
            <option value="">Select level</option>
            {JOB_LEVELS.map(l=><option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">No. of Openings</label>
          <input {...register('headcount')} type="number" min="1" placeholder="1" className={inputCls}/>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Req ID <span className="text-gray-400 font-normal text-xs">(optional)</span></label>
          <input {...register('requisition_id')} placeholder="e.g. BD-2025-01" className={inputCls}/>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Salary Range (LPA)</label>
        <div className="flex gap-2 items-center">
          <input {...register('salary_min')} type="number" placeholder="Min e.g. 8" className={inputCls}/>
          <span className="text-gray-400 flex-shrink-0">to</span>
          <input {...register('salary_max')} type="number" placeholder="Max e.g. 15" className={inputCls}/>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Target Hire Date</label>
        <input {...register('target_date')} type="date" className={inputCls}/>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Required Skills</label>
        <input {...register('required_skills')} placeholder="React, Node.js, PostgreSQL (comma separated)" className={inputCls}/>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Job Description Link <span className="text-gray-400 font-normal text-xs">(Google Doc / Notion / PDF)</span></label>
        <input {...register('jd_link')} placeholder="https://docs.google.com/..." className={inputCls}/>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description / Notes</label>
        <textarea {...register('description')} rows={4} placeholder="Job summary, key responsibilities, what you're looking for…" className={inputCls}/>
      </div>

      {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>{job ? 'Save Changes' : 'Create Job'}</Button>
      </div>
    </form>
  )
}

export function JobsPage() {
  const { hasRole } = useAuthStore()
  const qc = useQueryClient()
  const canEdit = hasRole(['admin','super_admin'])

  const [showCreate, setShowCreate] = useState(false)
  const [editJob, setEditJob]       = useState<any|null>(null)
  const [detailJob, setDetailJob]   = useState<any|null>(null)
  const [expanded, setExpanded]     = useState<string|null>(null)

  const { data: jobs=[], isLoading } = useQuery({ queryKey:['jobs'], queryFn: jobService.list })

  const { data: candidateCounts={} } = useQuery({
    queryKey:['jobs','candidate-counts'],
    queryFn: async () => {
      const {data} = await supabase.from('candidates').select('job_id,current_stage').eq('status','active')
      const counts: Record<string,{total:number;stages:Record<string,number>}> = {}
      data?.forEach(c => {
        if(!c.job_id) return
        if(!counts[c.job_id]) counts[c.job_id]={total:0,stages:{}}
        counts[c.job_id].total++
        counts[c.job_id].stages[c.current_stage]=(counts[c.job_id].stages[c.current_stage]??0)+1
      })
      return counts
    },
  })

  const updateStatus = useMutation({
    mutationFn: ({id,status}:{id:string;status:string}) => jobService.update(id,{status:status as any}),
    onSuccess: () => qc.invalidateQueries({queryKey:['jobs']}),
  })

  return (
    <div>
      <PageHeader title="Jobs" subtitle={`${jobs.length} total positions`}
        action={canEdit && <Button size="sm" icon={<Plus className="w-3.5 h-3.5"/>} onClick={()=>setShowCreate(true)}>New Job</Button>}
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500"/></div>
      ) : jobs.length===0 ? (
        <EmptyState icon={<Briefcase className="w-5 h-5"/>} title="No jobs yet"
          description="Create your first job opening."
          action={canEdit && <Button size="sm" onClick={()=>setShowCreate(true)}>Create job</Button>}/>
      ) : (
        <div className="space-y-2">
          {(jobs as any[]).map(job => {
            const counts = (candidateCounts as any)[job.id] ?? {total:0,stages:{}}
            const isOpen = expanded===job.id
            const activeStages = STAGE_ORDER.filter(s=>counts.stages[s]>0)

            return (
              <div key={job.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  {/* Expand */}
                  <button onClick={()=>setExpanded(isOpen?null:job.id)}
                    className="text-gray-300 hover:text-gray-500 flex-shrink-0 transition-colors">
                    {isOpen ? <ChevronDown className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
                  </button>

                  {/* Main info — clickable for detail */}
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={()=>setDetailJob(job)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">{job.title}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOUR[job.status]}`}>{job.status}</span>
                      {job.job_level && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{job.job_level}</span>}
                    </div>
                    <div className="flex items-center gap-2.5 text-xs text-gray-400 mt-0.5 flex-wrap">
                      {job.department && <span>{job.department}</span>}
                      {job.location && <span>📍 {job.location}</span>}
                      {job.employment_type && <span>{labelOf(job.employment_type)}</span>}
                      {job.salary_min && job.salary_max && <span>💰 {job.salary_min}–{job.salary_max} LPA</span>}
                      {job.headcount > 1 && <span>👥 {job.headcount} openings</span>}
                      {job.target_date && <span>🎯 Hire by {formatDate(job.target_date)}</span>}
                    </div>
                  </div>

                  {/* Stage mini-bars */}
                  {activeStages.length > 0 && (
                    <div className="hidden xl:flex items-end gap-1 flex-shrink-0">
                      {activeStages.slice(0,7).map(s=>(
                        <div key={s} className="flex flex-col items-center gap-0.5" title={`${s}: ${counts.stages[s]}`}>
                          <span className="text-xs font-bold text-gray-600">{counts.stages[s]}</span>
                          <div className={`w-4 rounded-sm ${STAGE_COLOURS[s]?.split(' ')[0]??'bg-gray-300'}`}
                            style={{height:`${Math.max(6,(counts.stages[s]/counts.total)*28)}px`}}/>
                          <span className="text-gray-400" style={{fontSize:'8px'}}>{s.substring(0,3)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Count */}
                  <div className="text-center flex-shrink-0">
                    <p className="text-xl font-bold text-blue-600">{counts.total}</p>
                    <p className="text-xs text-gray-400">candidates</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canEdit && (
                      <button onClick={()=>setEditJob(job)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Edit job">
                        <Pencil className="w-3.5 h-3.5"/>
                      </button>
                    )}
                    {job.status==='open' && canEdit && (
                      <Button variant="secondary" size="sm" loading={updateStatus.isPending}
                        onClick={()=>updateStatus.mutate({id:job.id,status:'closed'})}>Close</Button>
                    )}
                    {job.status==='closed' && canEdit && (
                      <Button variant="ghost" size="sm"
                        onClick={()=>updateStatus.mutate({id:job.id,status:'open'})}>Reopen</Button>
                    )}
                  </div>
                </div>

                {/* Expanded stage breakdown */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-gray-100 bg-gray-50/30">
                    {activeStages.length===0 ? (
                      <p className="text-sm text-gray-400 py-2">No active candidates yet</p>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-11 gap-2 mt-2">
                        {STAGE_ORDER.filter(s=>counts.stages[s]).map(s=>(
                          <div key={s} className="bg-white rounded-lg border border-gray-200 p-2 text-center">
                            <p className="text-lg font-bold text-gray-900">{counts.stages[s]}</p>
                            <p className="text-xs text-gray-500 leading-tight">{s}</p>
                            <p className="text-xs text-blue-500 font-medium">{Math.round((counts.stages[s]/counts.total)*100)}%</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {job.required_skills?.length>0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {job.required_skills.map((s:string)=>(
                          <span key={s} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{s}</span>
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

      {/* Detail Modal */}
      <Modal open={!!detailJob} onClose={()=>setDetailJob(null)} title={detailJob?.title??''} size="md">
        {detailJob && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOUR[detailJob.status]}`}>{detailJob.status}</span>
              {detailJob.job_level && <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{detailJob.job_level}</span>}
              {detailJob.employment_type && <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{labelOf(detailJob.employment_type)}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {detailJob.department && <InfoRow icon={<Layers className="w-4 h-4"/>} label="Department" value={detailJob.department}/>}
              {detailJob.location && <InfoRow icon={<Target className="w-4 h-4"/>} label="Location" value={detailJob.location}/>}
              {(detailJob.salary_min||detailJob.salary_max) && (
                <InfoRow icon={<DollarSign className="w-4 h-4"/>} label="Salary" value={`${detailJob.salary_min??'?'}–${detailJob.salary_max??'?'} LPA`}/>
              )}
              {detailJob.headcount && <InfoRow icon={<Users className="w-4 h-4"/>} label="Openings" value={`${detailJob.headcount} position${detailJob.headcount>1?'s':''}`}/>}
              {detailJob.target_date && <InfoRow icon={<Calendar className="w-4 h-4"/>} label="Hire by" value={formatDate(detailJob.target_date)}/>}
              {detailJob.requisition_id && <InfoRow icon={<Hash className="w-4 h-4"/>} label="Req ID" value={detailJob.requisition_id}/>}
            </div>

            {detailJob.jd_link && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Job Description</p>
                <a href={detailJob.jd_link} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline bg-blue-50 px-3 py-2 rounded-lg">
                  <ExternalLink className="w-4 h-4"/> Open JD Document
                </a>
              </div>
            )}

            {detailJob.required_skills?.length>0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Required Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {detailJob.required_skills.map((s:string)=>(
                    <span key={s} className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">{s}</span>
                  ))}
                </div>
              </div>
            )}

            {detailJob.description && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes / Description</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{detailJob.description}</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-400">Created {formatDate(detailJob.created_at)}</p>
              {canEdit && (
                <Button variant="secondary" size="sm" icon={<Pencil className="w-3.5 h-3.5"/>}
                  onClick={()=>{ setDetailJob(null); setEditJob(detailJob) }}>
                  Edit Job
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Create Modal */}
      <Modal open={showCreate} onClose={()=>setShowCreate(false)} title="Create Job Opening" size="md">
        <JobForm onClose={()=>setShowCreate(false)}/>
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editJob} onClose={()=>setEditJob(null)} title={`Edit — ${editJob?.title??''}`} size="md">
        {editJob && <JobForm job={editJob} onClose={()=>setEditJob(null)}/>}
      </Modal>
    </div>
  )
}

function InfoRow({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-400 mt-0.5 flex-shrink-0">{icon}</span>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900">{value}</p>
      </div>
    </div>
  )
}
