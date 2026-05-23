// Job → Source → Sub-Source → Stage nested breakdown
// Used by both HRDashboardWidget (hr_team, filtered) and JobSourceBreakdownWidget (admin, all)
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { useAuthStore } from '../../auth/authStore'
import { ChevronDown, ChevronRight } from 'lucide-react'

const STAGE_COLOURS: Record<string, string> = {
  Applied:          'bg-gray-300',
  Screening:        'bg-blue-400',
  R1:               'bg-indigo-400',
  'Case Study':     'bg-amber-400',
  R2:               'bg-orange-400',
  R3:               'bg-orange-500',
  'CF (Virtual)':   'bg-purple-400',
  'CF (In-Person)': 'bg-purple-500',
  Offer:            'bg-violet-500',
  Hired:            'bg-green-500',
  Rejected:         'bg-red-400',
}

const SOURCE_STYLE: Record<string, { bg: string; text: string; badge: string }> = {
  agency:   { bg: 'bg-purple-50', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700' },
  college:  { bg: 'bg-green-50',  text: 'text-green-700',  badge: 'bg-green-100 text-green-700'  },
  platform: { bg: 'bg-blue-50',   text: 'text-blue-700',   badge: 'bg-blue-100 text-blue-700'    },
}

interface StageMap  { [stage: string]: number }
interface SubSource { name: string; total: number; stages: StageMap }
interface Source    { category: string; total: number; subSources: SubSource[] }
interface Job       { id: string; title: string; total: number; sources: Source[] }

function buildTree(candidates: any[]): Job[] {
  const jobMap = new Map<string, Job>()

  candidates.forEach(c => {
    const jobKey   = c.job_id   ?? '__no_job__'
    const jobTitle = c.job_title ?? 'No Job Assigned'
    const cat      = c.source_category ?? 'platform'
    const sub      = c.source_name     ?? 'Unknown'
    const stage    = c.current_stage   ?? 'Applied'

    if (!jobMap.has(jobKey)) jobMap.set(jobKey, { id: jobKey, title: jobTitle, total: 0, sources: [] })
    const job = jobMap.get(jobKey)!
    job.total++

    let src = job.sources.find(s => s.category === cat)
    if (!src) { src = { category: cat, total: 0, subSources: [] }; job.sources.push(src) }
    src.total++

    let ss = src.subSources.find(s => s.name === sub)
    if (!ss) { ss = { name: sub, total: 0, stages: {} }; src.subSources.push(ss) }
    ss.total++
    ss.stages[stage] = (ss.stages[stage] ?? 0) + 1
  })

  // Sort everything descending by count
  return Array.from(jobMap.values())
    .sort((a, b) => b.total - a.total)
    .map(job => ({
      ...job,
      sources: job.sources
        .sort((a, b) => b.total - a.total)
        .map(src => ({
          ...src,
          subSources: src.subSources.sort((a, b) => b.total - a.total),
        })),
    }))
}

export function JobSourceBreakdownWidget() {
  const { user, hasRole } = useAuthStore()
  const isHR = hasRole(['hr_team'])

  const [openJobs,   setOpenJobs]   = useState<Set<string>>(new Set())
  const [openSrcs,   setOpenSrcs]   = useState<Set<string>>(new Set())
  const [openSubs,   setOpenSubs]   = useState<Set<string>>(new Set())

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); setter(n)
  }

  const { data: tree = [], isLoading, error } = useQuery({
    queryKey: ['widget', 'job-source-breakdown', user?.id, isHR],
    queryFn: async () => {
      let query = supabase
        .from('candidates')
        .select('id, job_id, source_category, source_name, current_stage, hr_owner, assigned_hrs, status')
        .eq('status', 'active')

      // HR team: only candidates assigned to them
      if (isHR && user?.id) {
        query = query.or(`hr_owner.eq.${user.id},assigned_hrs.cs.{${user.id}}`)
      }

      const { data: candidates, error: cErr } = await query
      if (cErr) throw cErr

      // Enrich with job titles
      const jobIds = [...new Set((candidates ?? []).map(c => c.job_id).filter(Boolean))]
      const jobTitleMap: Record<string, string> = {}
      if (jobIds.length) {
        const { data: jobs } = await supabase.from('jobs').select('id,title').in('id', jobIds)
        ;(jobs ?? []).forEach(j => { jobTitleMap[j.id] = j.title })
      }

      const enriched = (candidates ?? []).map(c => ({
        ...c,
        job_title: c.job_id ? (jobTitleMap[c.job_id] ?? 'Unknown Job') : null,
      }))

      return buildTree(enriched)
    },
    enabled: !!user,
  })

  const title = isHR ? 'My Pipeline Breakdown' : 'Job × Source × Stage'

  return (
    <WidgetBase title={title} loading={isLoading} error={error?.message}>
      {tree.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No candidates yet</p>
      ) : (
        <div className="space-y-1">
          {tree.map(job => {
            const jobOpen = openJobs.has(job.id)
            return (
              <div key={job.id} className="border border-gray-100 rounded-xl overflow-hidden">

                {/* ── Job row ── */}
                <button
                  onClick={() => toggle(openJobs, job.id, setOpenJobs)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 text-left"
                >
                  {jobOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
                           : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>}
                  <span className="flex-1 text-sm font-semibold text-gray-900 truncate">{job.title}</span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">{job.total}</span>
                </button>

                {jobOpen && (
                  <div className="border-t border-gray-100">
                    {job.sources.map(src => {
                      const srcKey  = `${job.id}:${src.category}`
                      const srcOpen = openSrcs.has(srcKey)
                      const style   = SOURCE_STYLE[src.category] ?? SOURCE_STYLE.platform

                      return (
                        <div key={src.category}>
                          {/* ── Source row ── */}
                          <button
                            onClick={() => toggle(openSrcs, srcKey, setOpenSrcs)}
                            className={`w-full flex items-center gap-2 px-5 py-2 hover:opacity-90 text-left ${style.bg}`}
                          >
                            {srcOpen ? <ChevronDown className={`w-3 h-3 flex-shrink-0 ${style.text}`}/>
                                     : <ChevronRight className={`w-3 h-3 flex-shrink-0 ${style.text}`}/>}
                            <span className={`flex-1 text-xs font-semibold capitalize ${style.text}`}>{src.category}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${style.badge}`}>{src.total}</span>
                          </button>

                          {srcOpen && src.subSources.map(ss => {
                            const ssKey  = `${srcKey}:${ss.name}`
                            const ssOpen = openSubs.has(ssKey)
                            const stageEntries = Object.entries(ss.stages).sort(([,a],[,b]) => b - a)

                            return (
                              <div key={ss.name} className="bg-white">
                                {/* ── Sub-Source row ── */}
                                <button
                                  onClick={() => toggle(openSubs, ssKey, setOpenSubs)}
                                  className="w-full flex items-center gap-2 px-8 py-2 hover:bg-gray-50 border-t border-gray-50 text-left"
                                >
                                  {ssOpen ? <ChevronDown className="w-3 h-3 text-gray-300 flex-shrink-0"/>
                                           : <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0"/>}
                                  <span className="flex-1 text-xs text-gray-700 truncate">{ss.name}</span>
                                  <span className="text-xs text-gray-400 flex-shrink-0">{ss.total}</span>
                                </button>

                                {/* ── Stage bars ── */}
                                {ssOpen && (
                                  <div className="px-11 pb-2 pt-1 bg-gray-50/40 space-y-1">
                                    {stageEntries.map(([stage, count]) => {
                                      const pct = Math.round((count / ss.total) * 100)
                                      return (
                                        <div key={stage} className="flex items-center gap-2">
                                          <span className="text-xs text-gray-500 w-28 flex-shrink-0 truncate">{stage}</span>
                                          <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                            <div className={`h-full rounded-full ${STAGE_COLOURS[stage] ?? 'bg-gray-300'}`}
                                              style={{ width: `${pct}%` }}/>
                                          </div>
                                          <span className="text-xs text-gray-600 w-10 text-right flex-shrink-0">{count}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
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
