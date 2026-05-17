import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { initialsOf } from '../../../shared/utils/helpers'
import { ChevronDown, ChevronRight, Briefcase, Users } from 'lucide-react'

const STAGE_DOT: Record<string, string> = {
  Applied:'bg-gray-300', Screening:'bg-blue-400', R1:'bg-indigo-400',
  'Case Study':'bg-yellow-400', R2:'bg-orange-400', R3:'bg-orange-500',
  'CF (Virtual)':'bg-purple-400', 'CF (In-Person)':'bg-purple-500',
  Offer:'bg-violet-500', Hired:'bg-green-500', Rejected:'bg-red-400',
}

export function HRTeamWidget() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [assigningJob, setAssigningJob] = useState<string | null>(null) // hr user id

  const { data, isLoading, error } = useQuery({
    queryKey: ['widget', 'hr-team'],
    queryFn: async () => {
      const [{ data: hrUsers }, { data: jobs }, { data: candidates }, { data: allJobs }] = await Promise.all([
        supabase.from('users').select('id,full_name,email').in('role',['hr_team','admin']).eq('is_active',true),
        supabase.from('jobs').select('id,title,hr_owner').eq('status','open'),
        supabase.from('candidates').select('job_id,current_stage,hr_owner,status').eq('status','active'),
        supabase.from('jobs').select('id,title').eq('status','open').order('title'),
      ])

      return {
        hrUsers: (hrUsers ?? []).map(user => {
          const userJobs = (jobs ?? []).filter(j => j.hr_owner === user.id)
          const directCandidates = (candidates ?? []).filter(c => c.hr_owner === user.id)

          // Stage breakdown across all assigned candidates
          const stageMap: Record<string, number> = {}
          directCandidates.forEach(c => {
            stageMap[c.current_stage] = (stageMap[c.current_stage] ?? 0) + 1
          })

          return {
            ...user,
            jobs: userJobs,
            candidates: directCandidates,
            stageMap,
            totalCandidates: directCandidates.length,
          }
        }),
        allJobs: allJobs ?? [],
      }
    },
    staleTime: 30_000,
  })

  const assignJob = useMutation({
    mutationFn: async ({ jobId, hrId }: { jobId: string; hrId: string }) => {
      // 1. Set hr_owner on job
      const { error: jobErr } = await supabase.from('jobs').update({ hr_owner: hrId }).eq('id', jobId)
      if (jobErr) throw jobErr
      // 2. Assign all active candidates of this job to this HR owner
      const { error: candErr } = await supabase.from('candidates')
        .update({ hr_owner: hrId })
        .eq('job_id', jobId)
        .eq('status', 'active')
      if (candErr) throw candErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['widget', 'hr-team'] })
      qc.invalidateQueries({ queryKey: ['candidates'] })
      setAssigningJob(null)
    },
  })

  const hrUsers = data?.hrUsers ?? []
  const allJobs = data?.allJobs ?? []

  return (
    <WidgetBase title="HR Team Overview" loading={isLoading} error={error?.message}>
      {hrUsers.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No HR team members yet</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {hrUsers.map((member: any) => {
            const isExp = expanded === member.id
            const topStages = Object.entries(member.stageMap as Record<string,number>)
              .sort(([,a],[,b]) => b - a).slice(0, 5)

            return (
              <div key={member.id}>
                {/* Member row */}
                <div
                  className="flex items-center gap-3 py-3 cursor-pointer hover:bg-gray-50/50 transition-colors px-1 rounded-lg"
                  onClick={() => setExpanded(isExp ? null : member.id)}
                >
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-slate-600">{initialsOf(member.full_name)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{member.full_name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Briefcase className="w-3 h-3"/>{member.jobs.length} jobs
                      </span>
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Users className="w-3 h-3"/>{member.totalCandidates} candidates
                      </span>
                    </div>
                  </div>
                  {isExp ? <ChevronDown className="w-4 h-4 text-gray-400"/> : <ChevronRight className="w-4 h-4 text-gray-400"/>}
                </div>

                {/* Expanded detail */}
                {isExp && (
                  <div className="pl-11 pb-3 space-y-3">
                    {/* Stage breakdown */}
                    {topStages.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-400 mb-1.5">Candidates by Stage</p>
                        <div className="space-y-1">
                          {topStages.map(([stage, count]) => (
                            <div key={stage} className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STAGE_DOT[stage] ?? 'bg-gray-300'}`}/>
                              <span className="text-xs text-gray-600 flex-1">{stage}</span>
                              <span className="text-xs font-medium text-gray-700">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Assigned jobs */}
                    {member.jobs.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-400 mb-1.5">Assigned Jobs</p>
                        <div className="flex flex-wrap gap-1">
                          {member.jobs.map((j: any) => (
                            <span key={j.id} className="text-xs bg-slate-50 border border-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                              {j.title}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Assign a job */}
                    {assigningJob === member.id ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-500">Assign a job to {member.full_name}:</p>
                        <div className="flex gap-2">
                          <select id={`job-sel-${member.id}`}
                            className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                            <option value="">Choose job…</option>
                            {allJobs.map((j: any) => (
                              <option key={j.id} value={j.id}>{j.title}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              const sel = document.getElementById(`job-sel-${member.id}`) as HTMLSelectElement
                              if (sel.value) assignJob.mutate({ jobId: sel.value, hrId: member.id })
                            }}
                            disabled={assignJob.isPending}
                            className="text-xs px-3 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50">
                            Assign
                          </button>
                          <button onClick={() => setAssigningJob(null)}
                            className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">
                            Cancel
                          </button>
                        </div>
                        <p className="text-xs text-gray-400">All active candidates in this job will be assigned to {member.full_name}.</p>
                      </div>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setAssigningJob(member.id) }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                        + Assign a job
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </WidgetBase>
  )
}
