// ============================================================
// HR ACTIVITY WIDGET — daily / weekly / monthly tracker
// ============================================================
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserCheck, BarChart2, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuthStore } from '../../auth/authStore'

type Period = 'today' | 'week' | 'month'

function periodRange(p: Period): { start: Date; end: Date } {
  const now  = new Date()
  const end  = new Date(now)
  end.setHours(23, 59, 59, 999)
  const start = new Date(now)

  if (p === 'today') {
    start.setHours(0, 0, 0, 0)
  } else if (p === 'week') {
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)
  } else {
    start.setDate(now.getDate() - 29)
    start.setHours(0, 0, 0, 0)
  }
  return { start, end }
}

interface ActivityRow {
  changed_by:  string
  full_name:   string | null
  screened:    number
  interviews:  number
  total_moves: number
}

export function HRActivityWidget() {
  const { user, hasRole } = useAuthStore()
  const [period, setPeriod] = useState<Period>('week')
  const isAdmin = hasRole(['admin', 'super_admin'])

  const { start, end } = useMemo(() => periodRange(period), [period])

  const { data = [], isLoading, error } = useQuery<ActivityRow[]>({
    queryKey: ['hr-activity', period, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_hr_activity', {
        p_start_date: start.toISOString(),
        p_end_date:   end.toISOString(),
      })
      if (error) throw error
      return (data ?? []).map((r: any) => ({
        ...r,
        screened:    Number(r.screened    ?? 0),
        interviews:  Number(r.interviews  ?? 0),
        total_moves: Number(r.total_moves ?? 0),
      }))
    },
    enabled: !!user,
    staleTime: 30_000,
    retry: false,
  })

  // Detect "RPC not deployed yet" (migration not run) vs a real failure
  const errMsg = (error as any)?.message ?? ''
  const setupNeeded = /get_hr_activity|function|does not exist|schema cache|PGRST202|404/i.test(errMsg)

  const PERIODS: { key: Period; label: string }[] = [
    { key: 'today', label: 'Today'      },
    { key: 'week',  label: 'This Week'  },
    { key: 'month', label: 'This Month' },
  ]

  const totals = useMemo(() => ({
    screened:   data.reduce((s, r) => s + r.screened,   0),
    interviews: data.reduce((s, r) => s + r.interviews, 0),
  }), [data])

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-3.5 h-3.5 text-indigo-400"/>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            HR Activity {isAdmin ? '— All Team' : '— My Activity'}
          </p>
        </div>
        {/* Period toggle */}
        <div className="flex items-center gap-0.5 bg-gray-50 rounded-lg p-0.5">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all ${
                period === key
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex divide-x divide-gray-50 border-b border-gray-50">
        <div className="flex-1 px-5 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Profiles Screened</p>
          <p className="text-[22px] font-bold text-gray-900 tabular-nums leading-none">{isLoading ? '—' : totals.screened}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Applied → moved forward</p>
        </div>
        <div className="flex-1 px-5 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Interviews Scheduled</p>
          <p className="text-[22px] font-bold text-gray-900 tabular-nums leading-none">{isLoading ? '—' : totals.interviews}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">First entry into interview rounds</p>
        </div>
      </div>

      {/* Per-HR breakdown (admin sees all; HR sees own row) */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-gray-300"/>
        </div>
      ) : error ? (
        setupNeeded ? (
          <div className="flex flex-col items-center py-8 gap-2 px-6">
            <AlertTriangle className="w-6 h-6 text-amber-400"/>
            <p className="text-[12px] font-medium text-gray-600">Tracker not set up yet</p>
            <p className="text-[11px] text-gray-400 text-center max-w-[340px] leading-relaxed">
              Run the migration <code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded text-gray-600">supabase-hr-activity-migration.sql</code> in
              your Supabase SQL editor to enable activity logging. Stage changes will be tracked from that point onward.
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-red-400 text-center py-6">Could not load activity data</p>
        )
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2">
          <UserCheck className="w-6 h-6 text-gray-200"/>
          <p className="text-[12px] text-gray-400">No stage changes recorded in this period</p>
          {!isAdmin && (
            <p className="text-[11px] text-gray-300 text-center max-w-[240px]">
              Activity is logged when you move a candidate from one stage to another.
            </p>
          )}
        </div>
      ) : (
        <div>
          {/* Table header */}
          <div className="grid grid-cols-[1fr_80px_100px_80px] px-4 py-2 border-b border-gray-50">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{isAdmin ? 'HR Manager' : 'Period'}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 text-center">Screened</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 text-center">Interviews</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 text-center">Moves</p>
          </div>
          <div className="divide-y divide-gray-50">
            {data.map((row) => {
              const maxScreened = Math.max(...data.map(r => r.screened), 1)
              const pct = Math.round((row.screened / maxScreened) * 100)
              return (
                <div key={row.changed_by} className="grid grid-cols-[1fr_80px_100px_80px] items-center px-4 py-2.5 hover:bg-gray-50/60 transition-colors">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-gray-800 truncate">
                      {row.full_name ?? 'Unknown'}
                      {row.changed_by === user?.id && (
                        <span className="ml-1.5 text-[10px] font-semibold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full">You</span>
                      )}
                    </p>
                    {/* Screened progress bar */}
                    <div className="mt-1 h-[3px] bg-gray-100 rounded-full w-full overflow-hidden">
                      <div className="h-full bg-indigo-300 rounded-full transition-all duration-500" style={{ width: `${pct}%` }}/>
                    </div>
                  </div>
                  <p className="text-[13px] font-bold text-indigo-600 text-center tabular-nums">{row.screened}</p>
                  <p className="text-[13px] font-bold text-emerald-600 text-center tabular-nums">{row.interviews}</p>
                  <p className="text-[13px] font-semibold text-gray-500 text-center tabular-nums">{row.total_moves}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="px-4 py-2.5 border-t border-gray-50 bg-gray-50/30">
        <p className="text-[10px] text-gray-300">
          Screened = moved forward from Applied (excludes direct rejections). Interviews = entered interview pipeline for the first time. Moves = all stage changes.
        </p>
      </div>
    </div>
  )
}
