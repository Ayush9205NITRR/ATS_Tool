// Interviewer Schedule Widget — date-wise interview split + feedback submitted per interviewer
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { ChevronDown, ChevronRight, CheckCircle, Clock, Calendar } from 'lucide-react'

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function InterviewerScheduleWidget() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data = [], isLoading, error } = useQuery({
    queryKey: ['widget', 'interviewer-schedule'],
    queryFn: async () => {
      // Fetch interviewers first (needed for ids), then candidates + feedback in parallel
      const { data: interviewers } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('role', 'interviewer')
        .eq('is_active', true)
        .order('full_name')

      if (!interviewers?.length) return []

      const ids = interviewers.map(u => u.id)

      const [{ data: candidates }, { data: feedback }] = await Promise.all([
        supabase
          .from('candidates')
          .select('id, full_name, interview_date, current_stage, assigned_interviewers')
          .eq('status', 'active')
          .not('assigned_interviewers', 'is', null),
        supabase
          .from('interview_feedback')
          .select('interviewer_id, candidate_id, submitted_at')
          .in('interviewer_id', ids),
      ])

      // Build per-interviewer data
      const feedbackByInterviewer: Record<string, Set<string>> = {}
      feedback?.forEach(f => {
        if (!feedbackByInterviewer[f.interviewer_id]) feedbackByInterviewer[f.interviewer_id] = new Set()
        feedbackByInterviewer[f.interviewer_id].add(f.candidate_id)
      })

      return interviewers.map(u => {
        // Candidates assigned to this interviewer
        const assigned = (candidates ?? []).filter(c =>
          Array.isArray(c.assigned_interviewers) && c.assigned_interviewers.includes(u.id)
        )

        const feedbackDone = feedbackByInterviewer[u.id] ?? new Set()
        const pending   = assigned.filter(c => !feedbackDone.has(c.id))
        const submitted = assigned.filter(c =>  feedbackDone.has(c.id))

        // Date-wise grouping (only candidates with interview_date set)
        const dateMap: Record<string, { name: string; stage: string }[]> = {}
        assigned
          .filter(c => c.interview_date)
          .forEach(c => {
            const d = c.interview_date!.slice(0, 10)
            if (!dateMap[d]) dateMap[d] = []
            dateMap[d].push({ name: c.full_name, stage: c.current_stage })
          })

        const dateSlots = Object.entries(dateMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, list]) => ({ date, list }))

        return {
          id:          u.id,
          name:        u.full_name,
          total:       assigned.length,
          pending:     pending.length,
          submitted:   submitted.length,
          dateSlots,
        }
      }).filter(u => u.total > 0)  // hide interviewers with nothing assigned
    },
  })

  const toggle = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const today = new Date().toISOString().slice(0, 10)

  return (
    <WidgetBase title="Interviewer Schedule" loading={isLoading} error={error?.message}>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No interviews assigned yet</p>
      ) : (
        <div className="space-y-1.5">
          {data.map(u => {
            const isOpen = expanded.has(u.id)
            const pct = u.total > 0 ? Math.round((u.submitted / u.total) * 100) : 0

            return (
              <div key={u.id} className="border border-gray-100 rounded-xl overflow-hidden">
                {/* Header */}
                <button
                  onClick={() => toggle(u.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 text-left"
                >
                  {isOpen
                    ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
                    : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"/>
                  }
                  {/* Avatar */}
                  <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-indigo-700">
                      {u.name.split(' ').map((p: string) => p[0]).join('').slice(0,2).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{u.name}</p>
                    {/* Feedback progress bar */}
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 bg-gray-100 rounded-full h-1 overflow-hidden">
                        <div className="h-full bg-green-400 rounded-full" style={{ width: `${pct}%` }}/>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{pct}% done</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex items-center gap-1 text-amber-600">
                      <Clock className="w-3 h-3"/>
                      <span className="text-xs font-medium">{u.pending}</span>
                    </div>
                    <div className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="w-3 h-3"/>
                      <span className="text-xs font-medium">{u.submitted}</span>
                    </div>
                  </div>
                </button>

                {/* Expanded — date-wise slots */}
                {isOpen && (
                  <div className="px-4 pb-3 pt-1 bg-gray-50/40 border-t border-gray-100">
                    {u.dateSlots.length === 0 ? (
                      <p className="text-xs text-gray-400 py-1">No interview dates scheduled</p>
                    ) : (
                      <div className="space-y-2 mt-1">
                        {u.dateSlots.map(({ date, list }) => {
                          const isPast   = date <  today
                          const isToday  = date === today
                          const isFuture = date >  today
                          return (
                            <div key={date}>
                              <div className="flex items-center gap-2 mb-1">
                                <Calendar className={`w-3 h-3 flex-shrink-0 ${isToday ? 'text-blue-500' : isPast ? 'text-gray-300' : 'text-indigo-400'}`}/>
                                <span className={`text-xs font-semibold ${isToday ? 'text-blue-600' : isPast ? 'text-gray-400' : 'text-indigo-600'}`}>
                                  {formatDateShort(date)}
                                  {isToday && <span className="ml-1 text-blue-400">(today)</span>}
                                </span>
                                <span className="text-xs text-gray-400">· {list.length} candidate{list.length !== 1 ? 's' : ''}</span>
                              </div>
                              <div className="pl-5 space-y-0.5">
                                {list.map((c, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    <span className={`text-xs ${isPast ? 'text-gray-400' : 'text-gray-700'}`}>{c.name}</span>
                                    <span className="text-xs text-gray-400">· {c.stage}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {/* Feedback summary footer */}
                    <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-4">
                      <span className="text-xs text-gray-500">{u.total} assigned total</span>
                      <span className="text-xs text-green-600">{u.submitted} feedback submitted</span>
                      {u.pending > 0 && <span className="text-xs text-amber-600">{u.pending} pending</span>}
                    </div>
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
