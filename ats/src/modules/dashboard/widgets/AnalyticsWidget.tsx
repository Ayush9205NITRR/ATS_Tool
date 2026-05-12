// ============================================================
// ANALYTICS WIDGET — Time to hire, Conversion rate, WoW
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { TrendingUp, TrendingDown, Clock, Target, Users } from 'lucide-react'

export function AnalyticsWidget() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['widget','analytics'],
    queryFn: async () => {
      const now = new Date()
      const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay())
      const startOfLastWeek = new Date(startOfWeek); startOfLastWeek.setDate(startOfWeek.getDate() - 7)

      const [
        { data: allCandidates },
        { data: hired },
        { data: thisWeek },
        { data: lastWeek },
      ] = await Promise.all([
        supabase.from('candidates').select('id, created_at, status').eq('status','active'),
        supabase.from('candidates').select('id, created_at, updated_at').eq('status','hired'),
        supabase.from('candidates').select('id').gte('created_at', startOfWeek.toISOString()),
        supabase.from('candidates').select('id')
          .gte('created_at', startOfLastWeek.toISOString())
          .lt('created_at', startOfWeek.toISOString()),
      ])

      // Avg time to hire (days from created_at to hired updated_at)
      let avgDays = null
      if (hired && hired.length > 0) {
        const totalDays = hired.reduce((sum, c) => {
          const diff = new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()
          return sum + diff / (1000 * 60 * 60 * 24)
        }, 0)
        avgDays = Math.round(totalDays / hired.length)
      }

      const total = allCandidates?.length ?? 0
      const hiredCount = hired?.length ?? 0
      const convRate = total > 0 ? Math.round((hiredCount / (total + hiredCount)) * 100) : 0
      const thisWeekCount = thisWeek?.length ?? 0
      const lastWeekCount = lastWeek?.length ?? 0
      const wow = lastWeekCount > 0
        ? Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100)
        : thisWeekCount > 0 ? 100 : 0

      return { avgDays, convRate, thisWeekCount, lastWeekCount, wow, total, hiredCount }
    },
  })

  return (
    <WidgetBase title="Hiring Analytics" loading={isLoading} error={error?.message}>
      <div className="grid grid-cols-2 gap-3">
        {/* Time to hire */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-blue-500"/>
            <span className="text-xs font-medium text-blue-600">Avg Time to Hire</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">
            {data?.avgDays != null ? `${data.avgDays}d` : '—'}
          </p>
          <p className="text-xs text-blue-500 mt-0.5">from application to hire</p>
        </div>

        {/* Conversion rate */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-green-500"/>
            <span className="text-xs font-medium text-green-600">Hire Rate</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{data?.convRate ?? 0}%</p>
          <p className="text-xs text-green-500 mt-0.5">{data?.hiredCount ?? 0} hired of {(data?.total??0)+(data?.hiredCount??0)}</p>
        </div>

        {/* This week */}
        <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-purple-500"/>
            <span className="text-xs font-medium text-purple-600">This Week</span>
          </div>
          <p className="text-2xl font-bold text-purple-700">{data?.thisWeekCount ?? 0}</p>
          <p className="text-xs text-purple-500 mt-0.5">new candidates</p>
        </div>

        {/* Week over week */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            {(data?.wow ?? 0) >= 0
              ? <TrendingUp className="w-4 h-4 text-green-500"/>
              : <TrendingDown className="w-4 h-4 text-red-500"/>
            }
            <span className="text-xs font-medium text-amber-600">vs Last Week</span>
          </div>
          <p className={`text-2xl font-bold ${(data?.wow??0)>=0?'text-green-700':'text-red-700'}`}>
            {(data?.wow??0)>=0?'+':''}{data?.wow ?? 0}%
          </p>
          <p className="text-xs text-amber-500 mt-0.5">last week: {data?.lastWeekCount ?? 0}</p>
        </div>
      </div>
    </WidgetBase>
  )
}
