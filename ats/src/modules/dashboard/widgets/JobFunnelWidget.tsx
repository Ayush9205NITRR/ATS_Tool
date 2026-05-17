// Job-Specific Stage Funnel Widget
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { INTERVIEW_STAGES } from '../../../types/database.types'

const STAGE_COLOURS: Record<string,string> = {
  Applied:'bg-gray-200', Screening:'bg-blue-300', R1:'bg-indigo-300',
  'Case Study':'bg-yellow-300', R2:'bg-orange-300', R3:'bg-orange-400',
  'CF (Virtual)':'bg-purple-300', 'CF (In-Person)':'bg-purple-400',
  Offer:'bg-violet-400', Hired:'bg-green-400', Rejected:'bg-red-300',
}

export function JobFunnelWidget() {
  const [selectedJob, setSelectedJob] = useState<string>('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['widget','job-funnel'],
    queryFn: async () => {
      const [{ data: jobs }, { data: candidates }] = await Promise.all([
        supabase.from('jobs').select('id,title').order('title'),
        supabase.from('candidates').select('job_id,current_stage,status').eq('status','active'),
      ])
      return { jobs: jobs??[], candidates: candidates??[] }
    },
    staleTime: 30_000,
  })

  const jobs = data?.jobs ?? []
  const candidates = data?.candidates ?? []

  const displayJobs = selectedJob ? jobs.filter((j:any)=>j.id===selectedJob) : jobs

  const getFunnel = (jobId: string) => {
    const jobCandidates = candidates.filter((c:any)=>c.job_id===jobId)
    const total = jobCandidates.length
    const stages = INTERVIEW_STAGES.slice(0, 8).map(s => ({
      stage: s,
      count: jobCandidates.filter((c:any)=>c.current_stage===s).length,
    })).filter(s=>s.count>0)
    return { total, stages }
  }

  return (
    <WidgetBase title="Job-wise Pipeline" loading={isLoading} error={error?.message}>
      <div className="mb-3">
        <select value={selectedJob} onChange={e=>setSelectedJob(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">All Jobs</option>
          {jobs.map((j:any)=><option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
      </div>
      <div className="space-y-4">
        {displayJobs.slice(0,5).map((job:any)=>{
          const { total, stages } = getFunnel(job.id)
          if (total===0) return null
          return (
            <div key={job.id}>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-medium text-gray-800 truncate flex-1">{job.title}</p>
                <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{total} total</span>
              </div>
              <div className="space-y-1">
                {stages.map(({ stage, count })=>{
                  const pct = total > 0 ? Math.round(count/total*100) : 0
                  return (
                    <div key={stage} className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-24 flex-shrink-0 truncate">{stage}</span>
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${STAGE_COLOURS[stage]??'bg-gray-300'}`} style={{width:`${pct}%`}}/>
                      </div>
                      <span className="text-xs text-gray-600 w-8 text-right flex-shrink-0">{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {displayJobs.length===0&&<p className="text-sm text-gray-400 text-center py-4">No jobs found</p>}
      </div>
    </WidgetBase>
  )
}
