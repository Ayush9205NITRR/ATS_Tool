// Source & Sub-Source Split Widget with job filter
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'

const SOURCE_COLOURS: Record<string,string> = {
  platform: 'bg-blue-400', agency: 'bg-purple-400', college: 'bg-amber-400'
}

export function SourceSplitWidget() {
  const [jobFilter, setJobFilter] = useState<string>('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['widget','source-split'],
    queryFn: async () => {
      const [{ data: jobs }, { data: candidates }] = await Promise.all([
        supabase.from('jobs').select('id,title').eq('status','open').order('title'),
        supabase.from('candidates').select('job_id,source_category,source_name,current_stage,status').eq('status','active'),
      ])
      return { jobs: jobs??[], candidates: candidates??[] }
    },
    staleTime: 30_000,
  })

  const jobs = data?.jobs ?? []
  const allCandidates = data?.candidates ?? []
  const candidates = jobFilter ? allCandidates.filter((c:any)=>c.job_id===jobFilter) : allCandidates
  const total = candidates.length

  const bySource = ['platform','agency','college'].map(src => {
    const list = candidates.filter((c:any)=>c.source_category===src)
    // Sub-sources
    const subMap = new Map<string,number>()
    list.forEach((c:any)=>{ const k=c.source_name||'Unknown'; subMap.set(k,(subMap.get(k)??0)+1) })
    const subs = Array.from(subMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0,4)
    return { src, count: list.length, pct: total>0?Math.round(list.length/total*100):0, subs }
  }).filter(s=>s.count>0)

  return (
    <WidgetBase title="Source & Sub-Source Split" loading={isLoading} error={error?.message}>
      <div className="mb-3">
        <select value={jobFilter} onChange={e=>setJobFilter(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">All Jobs</option>
          {jobs.map((j:any)=><option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
      </div>

      <div className="space-y-4">
        {bySource.map(({ src, count, pct, subs })=>(
          <div key={src}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${SOURCE_COLOURS[src]}`}/>
                <span className="text-sm font-semibold text-gray-700 capitalize">{src}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-600">{pct}%</span>
                <span className="text-xs text-gray-400">{count}</span>
              </div>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
              <div className={`h-full rounded-full ${SOURCE_COLOURS[src]}`} style={{width:`${pct}%`}}/>
            </div>
            {subs.length > 0 && (
              <div className="pl-4 space-y-1">
                {subs.map(([name, cnt])=>(
                  <div key={name} className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="flex-1 truncate">{name}</span>
                    <span className="text-gray-400">{cnt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {bySource.length===0&&<p className="text-sm text-gray-400 text-center py-4">No candidates yet</p>}
      </div>
    </WidgetBase>
  )
}
