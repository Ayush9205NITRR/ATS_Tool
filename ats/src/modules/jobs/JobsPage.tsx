import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Briefcase, Loader2, ChevronDown, ChevronRight, Pencil, Users, Calendar, DollarSign, Target, Hash, Layers, ExternalLink, ClipboardList, X } from 'lucide-react'
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

// Derive a stable key from a stage name (mirrors CandidateProfilePage logic)
function stageKeyOf(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_')
}

// Interview stages that can have question formats
const INTERVIEW_STAGE_NAMES = ['Screening', 'R1', 'Case Study', 'R2', 'R3', 'CF (Virtual)', 'CF (In-Person)']

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

const ROUND_STAGES = ['R1', 'Case Study', 'R2', 'R3', 'CF (Virtual)', 'CF (In-Person)']

function JobForm({ job, onClose }: { job?: any; onClose: () => void }) {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [agencyIds, setAgencyIds] = useState<string[]>(job?.allowed_agency_ids ?? [])
  const [showToAllAgencies, setShowToAllAgencies] = useState<boolean>(job?.show_to_agency ?? false)

  // HR assignment (multi)
  const [hrIds, setHrIds]                 = useState<string[]>(job?.assigned_hrs ?? [])
  const [assignAllCandidates, setAssignAllCandidates] = useState<boolean>(false)

  // All stage templates stored in interview_format JSONB column.
  // Key 'screening' → screening questions (HR-visible); other keys → round questions (panel-visible).
  const existingFormat: Record<string, string[]> = job?.interview_format ?? {}
  const ALL_TEMPLATE_STAGES = ['Screening', ...ROUND_STAGES]
  const [interviewFormat, setInterviewFormat] = useState<Record<string, string>>(
    Object.fromEntries(
      ALL_TEMPLATE_STAGES.map(name => {
        const key = stageKeyOf(name)
        const qs: string[] = existingFormat[key] ?? []
        return [key, qs.join('\n')]
      })
    )
  )
  const [showInterviewFormat, setShowInterviewFormat] = useState(false)

  const { data: agencyUsers = [] } = useQuery({
    queryKey: ['agency-users'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name,email').eq('role','agency').eq('is_active',true).order('full_name')
      return data ?? []
    },
  })

  const { data: hrUsers = [] } = useQuery({
    queryKey: ['hr-users'],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id,full_name,email,role')
        .in('role', ['hr_team','admin'])
        .eq('is_active', true)
        .order('full_name')
      return data ?? []
    },
  })

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

      // Save all templates into the existing interview_format JSONB column
      const toLines = (key: string) =>
        (interviewFormat[key] ?? '').split('\n').map(s => s.trim()).filter(Boolean)

      const interviewFormatObj: Record<string, string[]> = {}
      ALL_TEMPLATE_STAGES.forEach(name => {
        const key = stageKeyOf(name)
        const qs = toLines(key)
        if (qs.length) interviewFormatObj[key] = qs
      })

      const payload = {
        title: d.title, department: d.department||null, location: d.location||null,
        employment_type: d.employment_type??null, description: d.description||null,
        job_level: d.job_level||null, headcount: d.headcount||1,
        salary_min: d.salary_min||null, salary_max: d.salary_max||null,
        target_date: d.target_date||null, required_skills: skills,
        requisition_id: d.requisition_id||null,
        jd_link: (d as any).jd_link||null,
        show_to_agency: showToAllAgencies || agencyIds.length > 0,
        allowed_agency_ids: showToAllAgencies ? [] : agencyIds,
        assigned_hrs: hrIds,
        // hr_owner stays as the FIRST selected HR for backward compatibility
        hr_owner: hrIds[0] ?? null,
        interview_format: interviewFormatObj,
      }
      const saved = job
        ? await jobService.update(job.id, payload as any)
        : await jobService.create({
            ...payload, status:'open', created_by: user!.id,
            pipeline_stages: ['Applied','Screening','R1','Case Study','R2','R3','CF (Virtual)','CF (In-Person)','Offer','Hired','Rejected'],
          } as any)

      // If the toggle is on, propagate HRs to every existing candidate of this job
      if (assignAllCandidates && hrIds.length > 0 && (saved as any)?.id) {
        const { error: rpcErr } = await supabase.rpc('assign_hrs_to_job_candidates', {
          p_job_id: (saved as any).id,
          p_hr_ids: hrIds,
        })
        if (rpcErr) console.error('[assign_hrs_to_job_candidates]', rpcErr)
      }
      return saved
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      qc.invalidateQueries({ queryKey: ['candidates'] })
      onClose()
    },
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

      {/* HR Assignment — multi-select + assign-all toggle */}
      <div className="border border-blue-200 rounded-xl p-4 bg-blue-50/30">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-gray-700">Assign HR Manager(s)</p>
            <p className="text-xs text-gray-400 mt-0.5">Who manages this job (Admin / HR Team)</p>
          </div>
          {hrIds.length > 0 && (
            <span className="text-xs text-blue-700 font-medium bg-blue-100 px-2 py-1 rounded-full">
              {hrIds.length} selected
            </span>
          )}
        </div>

        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 mb-3">
          {(hrUsers as any[]).length === 0 ? (
            <p className="text-xs text-amber-600">No HR or Admin users found.</p>
          ) : (hrUsers as any[]).map((u: any) => {
            const sel = hrIds.includes(u.id)
            return (
              <div key={u.id}
                onClick={e => { e.preventDefault(); e.stopPropagation(); setHrIds(prev => sel ? prev.filter(id => id !== u.id) : [...prev, u.id]) }}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors select-none ${sel ? 'bg-blue-50 border border-blue-300' : 'hover:bg-gray-50 border border-transparent'}`}>
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${sel ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>
                  {sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{u.full_name}</p>
                  <p className="text-xs text-gray-400">{u.email} · {u.role === 'admin' ? 'Admin' : 'HR'}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Assign-all toggle */}
        <label
          className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${hrIds.length === 0 ? 'bg-gray-50 opacity-50 cursor-not-allowed' : 'bg-white border border-blue-200 hover:bg-blue-50'}`}
          title={hrIds.length === 0 ? 'Select at least one HR first' : ''}
        >
          <div>
            <p className="text-sm font-medium text-gray-700">Assign all candidates</p>
            <p className="text-xs text-gray-400">Apply these HRs to every existing candidate of this job</p>
          </div>
          <div
            onClick={e => {
              e.preventDefault(); e.stopPropagation()
              if (hrIds.length > 0) setAssignAllCandidates(o => !o)
            }}
            className={`w-10 h-5 rounded-full transition-colors relative ${assignAllCandidates ? 'bg-blue-500' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${assignAllCandidates ? 'translate-x-5' : 'translate-x-0.5'}`}/>
          </div>
        </label>
        {assignAllCandidates && hrIds.length > 0 && (
          <p className="text-xs text-blue-700 mt-2 px-2">
            ✓ On save, {hrIds.length} HR{hrIds.length > 1 ? 's' : ''} will be assigned to every candidate of this job.
          </p>
        )}
      </div>

      {/* Agency Visibility — required field, not optional */}
      <div className="border border-purple-200 rounded-xl p-4 bg-purple-50/30">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-gray-700">Agency Visibility <span className="text-red-500">*</span></p>
            <p className="text-xs text-gray-400 mt-0.5">Which agencies can see and submit candidates for this job</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-gray-500">All agencies</span>
            <div onClick={e => { e.preventDefault(); e.stopPropagation(); setShowToAllAgencies(o => !o); if (!showToAllAgencies) setAgencyIds([]) }}
              className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${showToAllAgencies ? 'bg-purple-500' : 'bg-gray-200'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showToAllAgencies ? 'translate-x-5' : 'translate-x-0.5'}`}/>
            </div>
          </label>
        </div>
        {!showToAllAgencies && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Select specific agencies:</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {(agencyUsers as any[]).length === 0 ? (
                <p className="text-xs text-amber-600">No agency users found — add users with role "Agency" in Settings → Team Members.</p>
              ) : (agencyUsers as any[]).map((u: any) => {
                const sel = agencyIds.includes(u.id)
                return (
                  <div key={u.id}
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setAgencyIds(prev => sel ? prev.filter(id => id !== u.id) : [...prev, u.id]) }}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors select-none ${sel ? 'bg-purple-50 border border-purple-200' : 'hover:bg-gray-50 border border-transparent'}`}>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${sel ? 'bg-purple-500 border-purple-500' : 'border-gray-300'}`}>
                      {sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{u.full_name}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                    {sel && <span className="text-xs text-purple-600 font-medium">Selected</span>}
                  </div>
                )
              })}
            </div>
            {agencyIds.length > 0 && (
              <p className="mt-2 text-xs text-purple-700 font-medium bg-purple-50 px-3 py-1.5 rounded-lg">
                ✓ {agencyIds.length} agenc{agencyIds.length > 1 ? 'ies' : 'y'} selected
              </p>
            )}
          </div>
        )}
      </div>

      {/* Interview Format Templates */}
      <div className="border border-green-200 rounded-xl overflow-hidden bg-green-50/20">
        <button
          type="button"
          onClick={() => setShowInterviewFormat(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-green-50/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-green-600" />
            <p className="text-sm font-medium text-gray-700">Interview Format Templates</p>
            <span className="text-xs text-gray-400">(optional — shown as a guide to interviewers)</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showInterviewFormat ? 'rotate-180' : ''}`} />
        </button>

        {showInterviewFormat && (
          <div className="px-4 pb-4 border-t border-green-100 space-y-4 pt-3">
            <p className="text-xs text-gray-400">One question per line. Questions are shown on the candidate profile to the relevant viewer only.</p>
            {ALL_TEMPLATE_STAGES.map(stageName => {
              const key = stageKeyOf(stageName)
              const isScreening = stageName === 'Screening'
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-xs font-semibold text-gray-700">{stageName}</label>
                    {isScreening
                      ? <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded-full">HR only</span>
                      : <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-full">Assigned panel · this stage only</span>
                    }
                  </div>
                  <textarea
                    rows={3}
                    value={interviewFormat[key] ?? ''}
                    onChange={e => setInterviewFormat(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={isScreening
                      ? 'e.g.\nWalk me through your background\nWhy are you looking for a change?'
                      : `e.g.\nTell me about a relevant project\nHow do you handle ambiguity?`}
                    className={inputCls + ' resize-y font-normal text-xs'}
                  />
                </div>
              )
            })}
          </div>
        )}
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
  const { hasRole, user: authUser } = useAuthStore()
  const qc = useQueryClient()
  const canEdit = hasRole(['admin','super_admin'])
  const isAgency = hasRole(['agency'])

  const [showCreate, setShowCreate] = useState(false)
  const [editJob, setEditJob]       = useState<any|null>(null)
  const [detailJob, setDetailJob]   = useState<any|null>(null)
  const [expanded, setExpanded]     = useState<string|null>(null)

  const { data: jobs=[], isLoading } = useQuery({
    queryKey: ['jobs', isAgency ? `agency-${authUser?.id}` : 'all'],
    queryFn: async () => {
      if (isAgency && authUser?.id) {
        const { data } = await supabase.from('jobs').select('*').eq('status','open').order('created_at',{ascending:false})
        return (data ?? []).filter((j:any) =>
          j.show_to_agency &&
          (!j.allowed_agency_ids || j.allowed_agency_ids.length === 0 || j.allowed_agency_ids.includes(authUser.id))
        )
      }
      return jobService.list()
    }
  })

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
                    {/* Agency visibility — read-only badge, edit via pencil */}
                    {job.show_to_agency && (
                      <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-100">
                        🏢 {(job.allowed_agency_ids?.length > 0) ? `${job.allowed_agency_ids.length} agenc${job.allowed_agency_ids.length > 1 ? 'ies' : 'y'}` : 'All agencies'}
                      </span>
                    )}
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
