// ============================================================
// DASHBOARD — role-aware, action-first, no widget grid
// ============================================================
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp, TrendingDown, Calendar, Clock, ShieldCheck,
  CheckCircle2, ArrowUpRight, ChevronDown, BarChart3,
  Loader2, ArrowRight, Users, Briefcase,
} from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { useStages as useStagesHook } from '../../shared/hooks/useStages'

// Existing widgets — used in collapsible "Detailed Analytics"
import { SourceFunnelWidget }       from './widgets/SourceFunnelWidget'
import { FunnelStagesWidget }       from './widgets/FunnelStagesWidget'
import { JobBreakdownWidget }       from './widgets/JobBreakdownWidget'
import { HRTeamWidget }             from './widgets/HRTeamWidget'
import { InterviewerScheduleWidget } from './widgets/InterviewerScheduleWidget'
import { JobSourceBreakdownWidget } from './widgets/JobSourceBreakdownWidget'
import { AgencyDashboardWidget }    from './widgets/AgencyDashboardWidget'
import { HRActivityWidget }         from './widgets/HRActivityWidget'

// ─── Helpers ────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const today = () => ymd(new Date())

// ─── Stage colours ────────────────────────────────────────────────────
const STAGE_BAR: Record<string, string> = {
  Applied: 'bg-slate-300', Screening: 'bg-blue-400', R1: 'bg-indigo-400',
  'Case Study': 'bg-amber-400', R2: 'bg-orange-400', R3: 'bg-orange-500',
  'CF (Virtual)': 'bg-purple-400', 'CF (In-Person)': 'bg-purple-600',
  'Cost Approval': 'bg-yellow-400', Offer: 'bg-violet-500',
  Hired: 'bg-emerald-500', Rejected: 'bg-red-400',
}
const STAGE_PILL_BG: Record<string, string> = {
  Applied: 'bg-slate-100 text-slate-600', Screening: 'bg-blue-50 text-blue-700',
  R1: 'bg-indigo-50 text-indigo-700', 'Case Study': 'bg-amber-50 text-amber-700',
  R2: 'bg-orange-50 text-orange-700', R3: 'bg-orange-100 text-orange-800',
  'CF (Virtual)': 'bg-purple-50 text-purple-700', 'CF (In-Person)': 'bg-purple-100 text-purple-800',
  'Cost Approval': 'bg-yellow-50 text-yellow-700', Offer: 'bg-violet-50 text-violet-700',
  Hired: 'bg-emerald-50 text-emerald-700', Rejected: 'bg-red-50 text-red-600',
}
const stageBar  = (name: string, cfgs: any[]) => { const c = cfgs.find(s => s.name === name); return c?.color?.replace('-50','-400').replace('-100','-500') ?? STAGE_BAR[name] ?? 'bg-gray-300' }
const stagePill = (name: string, cfgs: any[]) => { const c = cfgs.find(s => s.name === name); return c ? `${c.color} ${c.textColor}` : (STAGE_PILL_BG[name] ?? 'bg-gray-100 text-gray-600') }

// ─── Tiny shared pieces ────────────────────────────────────────────────
function Divider() { return <div className="w-px h-7 bg-gray-150 self-center flex-shrink-0" style={{ backgroundColor: '#E8EAF0' }}/> }

function BigStat({ n, label, trend }: { n: number | string; label: string; trend?: number }) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[26px] font-bold tracking-tight text-gray-900 tabular-nums leading-none">{n}</span>
        {trend !== undefined && trend !== 0 && (
          <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${trend > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {trend > 0 ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mt-0.5">{label}</p>
    </div>
  )
}

function SectionCard({ title, badge, action, children, className = '' }: {
  title: string; badge?: number; action?: { label: string; href: string }
  children: React.ReactNode; className?: string
}) {
  const navigate = useNavigate()
  return (
    <div className={`bg-white rounded-xl border border-gray-100 overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{title}</p>
          {badge != null && badge > 0 && (
            <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full leading-none">{badge}</span>
          )}
        </div>
        {action && (
          <button onClick={() => navigate(action.href)} className="flex items-center gap-0.5 text-[11px] text-indigo-500 hover:text-indigo-700 transition-colors">
            {action.label}<ArrowUpRight className="w-3 h-3"/>
          </button>
        )}
      </div>
      <div className="p-4 space-y-0.5">{children}</div>
    </div>
  )
}

function AllClear({ label = 'All caught up — nothing needs attention' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-5 gap-2.5">
      <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center">
        <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" size={18}/>
      </div>
      <p className="text-[12px] text-gray-400 text-center leading-snug max-w-[180px]">{label}</p>
    </div>
  )
}

function MiniLoader() {
  return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-300"/></div>
}

// ─── Main export ────────────────────────────────────────────────────────
export function DashboardPage() {
  const { user, hasRole } = useAuthStore()
  if (!user) return null
  if (hasRole(['interviewer'])) return <InterviewerDashboard user={user} />
  if (hasRole(['agency']))      return <AgencyDashboard />
  return <StaffDashboard user={user} hasRole={hasRole} />
}

// ============================================================
// STAFF DASHBOARD (admin / super_admin / hr_team)
// ============================================================
function StaffDashboard({ user, hasRole }: { user: any; hasRole: (r: string[]) => boolean }) {
  const navigate = useNavigate()
  const { stageConfigs } = useStagesHook()
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const isSuper = hasRole(['super_admin'])
  const isAdmin = hasRole(['super_admin', 'admin'])

  // ── Unified data fetch ──────────────────────────────────────
  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['dash-candidates'],
    queryFn: async () => {
      const { data } = await supabase.from('candidates')
        .select('id,full_name,current_stage,status,created_at,updated_at,interview_date,assigned_interviewers,source_category,source_name,job_id,interview_notes,cost_approval_decision')
      return (data ?? []) as any[]
    },
    staleTime: 30_000,
  })

  const { data: openJobsCount = 0 } = useQuery({
    queryKey: ['dash-open-jobs-count'],
    queryFn: async () => {
      const { count } = await supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'open')
      return count ?? 0
    },
    staleTime: 60_000,
  })

  const { data: caSettings } = useQuery({
    queryKey: ['app-settings', 'cost_approval'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'cost_approval').maybeSingle()
      if (!data?.value) return { stageName: 'Cost Approval' }
      try { return { stageName: JSON.parse(data.value).stage_name ?? 'Cost Approval' } } catch { return { stageName: 'Cost Approval' } }
    },
    staleTime: 60_000,
  })

  const { data: feedbacks = [] } = useQuery({
    queryKey: ['dash-feedbacks'],
    queryFn: async () => {
      const { data } = await supabase.from('interview_feedback').select('candidate_id,interviewer_id')
      return (data ?? []) as any[]
    },
    staleTime: 30_000,
  })

  // ── Derived ────────────────────────────────────────────────
  // Hired / Rejected are determined by current_stage (this system's convention)
  const hired    = useMemo(() => candidates.filter((c: any) => c.current_stage === 'Hired'),   [candidates])
  const rejected = useMemo(() => candidates.filter((c: any) => c.current_stage === 'Rejected'), [candidates])
  const active   = useMemo(() => candidates.filter((c: any) => c.current_stage !== 'Hired' && c.current_stage !== 'Rejected'), [candidates])
  const caStage = caSettings?.stageName ?? 'Cost Approval'
  const stages  = useMemo(() => stageConfigs.map((s: any) => s.name), [stageConfigs])

  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {}
    active.forEach((c: any) => { if (c.current_stage) m[c.current_stage] = (m[c.current_stage] ?? 0) + 1 })
    return m
  }, [active])

  const stagesWithCounts = useMemo(() => {
    const raw = stages.map((s: string) => ({ name: s, count: stageCounts[s] ?? 0 })).filter(s => s.count > 0)
    return raw.length ? raw : Object.entries(stageCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [stages, stageCounts])

  const maxCount = Math.max(...stagesWithCounts.map(s => s.count), 1)

  const todayStr = today()
  const todayInterviews = useMemo(() =>
    active.filter((c: any) => c.interview_date && ymd(new Date(c.interview_date)) === todayStr)
      .sort((a: any, b: any) => new Date(a.interview_date).getTime() - new Date(b.interview_date).getTime()),
    [active, todayStr]
  )

  const now = new Date()
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0)
  const startOfLast = new Date(startOfWeek); startOfLast.setDate(startOfLast.getDate() - 7)

  const thisWeek = useMemo(() => candidates.filter((c: any) => new Date(c.created_at) >= startOfWeek).length, [candidates])
  const lastWeek = useMemo(() => candidates.filter((c: any) => { const d = new Date(c.created_at); return d >= startOfLast && d < startOfWeek }).length, [candidates])
  const wow = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : (thisWeek > 0 ? 100 : 0)

  const avgTTH = useMemo(() => {
    const times = hired.filter((c: any) => c.created_at && c.updated_at)
      .map((c: any) => (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()) / 86400000)
    return times.length ? Math.round(times.reduce((a: number, b: number) => a + b, 0) / times.length) : null
  }, [hired])

  const hireRate = useMemo(() => {
    return candidates.length ? Math.round((hired.length / candidates.length) * 100) : 0
  }, [candidates, hired])

  // Needs attention
  const pendingCA = useMemo(() => active.filter((c: any) => {
    if (c.current_stage !== caStage) return false
    const entries: any[] = c.interview_notes?.cost_approval ?? []
    const last = entries[entries.length - 1]
    return !((last?.decision && last.decision !== 'reset') || c.cost_approval_decision)
  }).length, [active, caStage])

  const pendingScheduling = useMemo(() =>
    candidates.filter((c: any) => !c.interview_date && (c.assigned_interviewers?.length ?? 0) > 0).length,
    [candidates]
  )

  const fbDoneSet = useMemo(() => new Set(feedbacks.map((f: any) => `${f.candidate_id}:${f.interviewer_id}`)), [feedbacks])
  const pendingFeedback = useMemo(() => {
    let n = 0
    candidates.forEach((c: any) => (c.assigned_interviewers ?? []).forEach((iid: string) => { if (!fbDoneSet.has(`${c.id}:${iid}`)) n++ }))
    return n
  }, [candidates, fbDoneSet])

  const attentionItems = useMemo(() => {
    const items: any[] = []
    if (pendingCA > 0)        items.push({ id: 'ca',   icon: ShieldCheck, label: 'pending cost approval',          count: pendingCA,        href: '/cost-approval', color: 'amber'  })
    if (pendingScheduling > 0) items.push({ id: 'sch',  icon: Calendar,    label: 'awaiting interview scheduling',  count: pendingScheduling, href: '/interviews',    color: 'blue'   })
    if (pendingFeedback > 0)  items.push({ id: 'fb',   icon: Clock,       label: 'pending interviewer feedback',   count: pendingFeedback,  href: '/interviews',    color: 'orange' })
    return items
  }, [pendingCA, pendingScheduling, pendingFeedback])

  const totalAttention = attentionItems.reduce((s: number, i: any) => s + i.count, 0)

  if (isLoading) return <MiniLoader />

  const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[12px] text-gray-400 font-medium mb-1">{dateLabel}</p>
          <h1 className="text-[22px] font-bold tracking-tight text-gray-900 leading-tight">
            {greeting()}, {user.full_name.split(' ')[0]}
          </h1>
        </div>
        {totalAttention > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0"/>
            <p className="text-[12px] font-semibold text-amber-700">{totalAttention} item{totalAttention !== 1 ? 's' : ''} need attention</p>
          </div>
        )}
      </div>

      {/* ── Stats strip ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-5">
        <BigStat n={candidates.length} label="total candidates" />
        <Divider />
        <BigStat n={active.length}    label="in pipeline" />
        <Divider />
        <BigStat n={hired.length}     label="hired" />
        <Divider />
        <BigStat n={openJobsCount}    label="open jobs" />
        <Divider />
        <BigStat n={thisWeek}         label="this week" trend={wow} />
        {todayInterviews.length > 0 && <><Divider /><BigStat n={todayInterviews.length} label="today's interviews" /></>}
      </div>

      {/* ── Main grid ────────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-4">

        {/* Pipeline ─── 5 cols */}
        <div className="col-span-12 lg:col-span-5">
          <SectionCard title="Pipeline" className="h-full">
            {stagesWithCounts.length === 0 ? (
              <p className="text-[12px] text-gray-400 py-2">No active candidates</p>
            ) : (
              <div className="space-y-2 pt-1">
                {stagesWithCounts.map(({ name, count }) => {
                  const pct = Math.round((count / active.length) * 100)
                  const barW = Math.round((count / maxCount) * 100)
                  const bar = STAGE_BAR[name] ?? 'bg-gray-300'
                  return (
                    <button
                      key={name}
                      onClick={() => navigate(`/candidates?f=${encodeURIComponent(JSON.stringify([{id:String(Date.now()),field:'current_stage',op:'is_any_of',value:'',values:[name]}]))}`)
                      }
                      className="w-full flex items-center gap-3 group hover:bg-gray-50/60 -mx-1 px-1 py-1 rounded-lg transition-colors"
                    >
                      <span className="text-[12px] text-gray-600 w-28 flex-shrink-0 truncate text-left group-hover:text-gray-900 transition-colors">{name}</span>
                      <div className="flex-1 h-[5px] bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${bar}`} style={{ width: `${barW}%` }}/>
                      </div>
                      <span className="text-[12px] font-bold text-gray-800 w-6 text-right flex-shrink-0 tabular-nums">{count}</span>
                      <span className="text-[10px] text-gray-300 w-8 text-right flex-shrink-0 tabular-nums">{pct}%</span>
                    </button>
                  )
                })}
                <div className="pt-2 mt-2 border-t border-gray-50 flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">Total active</span>
                  <span className="text-[13px] font-bold text-gray-700 tabular-nums">{active.length}</span>
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Needs attention ─── 4 cols */}
        <div className="col-span-12 md:col-span-6 lg:col-span-4">
          <SectionCard title="Action needed" badge={totalAttention} className="h-full">
            {attentionItems.length === 0 ? (
              <AllClear />
            ) : attentionItems.map((item: any) => {
              const colors: Record<string, string> = { amber: 'bg-amber-50 text-amber-600', blue: 'bg-blue-50 text-blue-600', orange: 'bg-orange-50 text-orange-600' }
              const cls = colors[item.color] ?? 'bg-gray-50 text-gray-600'
              const textCls = cls.split(' ')[1]
              return (
                <button key={item.id} onClick={() => navigate(item.href)}
                  className="w-full flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/80 -mx-2 px-2 rounded-lg transition-colors group">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${cls.split(' ')[0]}`}>
                    <item.icon className={`w-3.5 h-3.5 ${textCls}`}/>
                  </div>
                  <span className="flex-1 text-[12px] text-gray-700 text-left leading-snug">{item.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[13px] font-bold tabular-nums ${textCls}`}>{item.count}</span>
                    <ArrowRight className="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors"/>
                  </div>
                </button>
              )
            })}
          </SectionCard>
        </div>

        {/* Today's interviews ─── 3 cols */}
        <div className="col-span-12 md:col-span-6 lg:col-span-3">
          <SectionCard title="Today's interviews" className="h-full">
            {todayInterviews.length === 0 ? (
              <AllClear label="No interviews scheduled for today" />
            ) : todayInterviews.map((c: any) => {
              const time = c.interview_date
                ? new Date(c.interview_date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                : '—'
              return (
                <button key={c.id} onClick={() => navigate(`/candidates/${c.id}`)}
                  className="w-full flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50/80 -mx-2 px-2 rounded-lg transition-colors group">
                  <span className="text-[11px] font-mono text-gray-400 w-14 flex-shrink-0 text-left">{time}</span>
                  <span className="flex-1 text-[12px] font-medium text-gray-800 truncate text-left group-hover:text-indigo-600 transition-colors">{c.full_name}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${stagePill(c.current_stage, stageConfigs)}`}>
                    {c.current_stage}
                  </span>
                </button>
              )
            })}
          </SectionCard>
        </div>
      </div>

      {/* ── Analytics cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Avg. time to hire', value: avgTTH !== null ? `${avgTTH}d` : '—', sub: 'days from apply to offer' },
          { label: 'Hire rate',         value: `${hireRate}%`, sub: `${hired.length} hired of ${candidates.length} total` },
          { label: 'Total hired',       value: hired.length,   sub: 'all time' },
          { label: 'Added this week',   value: thisWeek,       sub: `vs ${lastWeek} last week`, trend: wow },
        ].map(({ label, value, sub, trend }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 px-4 py-3.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{label}</p>
            <div className="flex items-baseline gap-1.5 mb-1">
              <span className="text-[22px] font-bold tracking-tight text-gray-900 tabular-nums leading-none">{value}</span>
              {trend !== undefined && trend !== 0 && (
                <span className={`flex items-center gap-0.5 text-[11px] font-bold ${trend > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {trend > 0 ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>}
                  {Math.abs(trend)}%
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-400">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── HR Activity tracker ─────────────────────────────────── */}
      <HRActivityWidget />

      {/* ── Detailed analytics (collapsible) ────────────────────── */}
      <div className="rounded-xl border border-gray-100 overflow-hidden">
        <button onClick={() => setAnalyticsOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50/50 transition-colors">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-gray-400"/>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Detailed Analytics</p>
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-300 transition-transform duration-200 ${analyticsOpen ? 'rotate-180' : ''}`}/>
        </button>
        {analyticsOpen && (
          <div className="border-t border-gray-100 p-4 bg-gray-50/20 space-y-4 animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SourceFunnelWidget />
              <FunnelStagesWidget />
            </div>
            <JobBreakdownWidget />
            <JobSourceBreakdownWidget />
            {isAdmin && <InterviewerScheduleWidget />}
            {isSuper && <HRTeamWidget />}
          </div>
        )}
      </div>

    </div>
  )
}

// ============================================================
// INTERVIEWER DASHBOARD
// ============================================================
function InterviewerDashboard({ user }: { user: any }) {
  const navigate = useNavigate()
  const { stageConfigs } = useStagesHook()

  const { data, isLoading } = useQuery({
    queryKey: ['my-interviews-dash', user?.id],
    queryFn: async () => {
      const [{ data: candidates }, { data: feedback }] = await Promise.all([
        supabase.from('candidates')
          .select('id,full_name,current_stage,interview_date,job_id,status')
          .contains('assigned_interviewers', [user!.id])
          .eq('status', 'active'),
        supabase.from('interview_feedback')
          .select('candidate_id,submitted_at')
          .eq('interviewer_id', user!.id),
      ])
      const jobIds = [...new Set((candidates ?? []).map((c: any) => c.job_id).filter(Boolean))]
      const jobsMap: Record<string, string> = {}
      if (jobIds.length) {
        const { data: jobs } = await supabase.from('jobs').select('id,title').in('id', jobIds)
        ;(jobs ?? []).forEach((j: any) => { jobsMap[j.id] = j.title })
      }
      const doneSet = new Set((feedback ?? []).map((f: any) => f.candidate_id))
      return (candidates ?? []).map((c: any) => ({ ...c, jobTitle: jobsMap[c.job_id] ?? null, feedbackDone: doneSet.has(c.id) })) as any[]
    },
    enabled: !!user,
    staleTime: 0,
  })

  const all      = data ?? []
  const todayStr = today()
  const upcoming = all.filter((c: any) => c.interview_date && new Date(c.interview_date) > new Date())
    .sort((a: any, b: any) => new Date(a.interview_date).getTime() - new Date(b.interview_date).getTime())
  const todayList  = all.filter((c: any) => c.interview_date && ymd(new Date(c.interview_date)) === todayStr)
  const pending    = all.filter((c: any) => !c.feedbackDone)
  const done       = all.filter((c: any) => c.feedbackDone)

  const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  if (isLoading) return <MiniLoader />

  return (
    <div className="space-y-6 animate-fade-in">

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[12px] text-gray-400 font-medium mb-1">{dateLabel}</p>
          <h1 className="text-[22px] font-bold tracking-tight text-gray-900">{greeting()}, {user.full_name.split(' ')[0]}</h1>
        </div>
        {pending.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"/>
            <p className="text-[12px] font-semibold text-amber-700">{pending.length} pending feedback</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <BigStat n={all.length}     label="assigned" />
        <Divider />
        <BigStat n={pending.length} label="feedback pending" />
        <Divider />
        <BigStat n={done.length}    label="completed" />
        {todayList.length > 0 && <><Divider /><BigStat n={todayList.length} label="today" /></>}
      </div>

      <div className="grid grid-cols-12 gap-4">

        {/* Upcoming interviews */}
        <div className="col-span-12 md:col-span-7">
          <SectionCard title="Upcoming interviews">
            {upcoming.length === 0 ? (
              <AllClear label="No upcoming interviews scheduled" />
            ) : upcoming.slice(0, 8).map((c: any) => {
              const dt = new Date(c.interview_date)
              const isToday = ymd(dt) === todayStr
              const dateStr = isToday ? 'Today' : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
              return (
                <button key={c.id} onClick={() => navigate(`/candidates/${c.id}`)}
                  className="w-full flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/80 -mx-2 px-2 rounded-lg transition-colors group text-left">
                  <div className="w-14 flex-shrink-0">
                    <p className={`text-[11px] font-semibold ${isToday ? 'text-indigo-600' : 'text-gray-500'}`}>{dateStr}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{timeStr}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-gray-800 truncate group-hover:text-indigo-600 transition-colors">{c.full_name}</p>
                    <p className="text-[11px] text-gray-400 truncate">{c.jobTitle ?? '—'}</p>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${stagePill(c.current_stage, stageConfigs)}`}>
                    {c.current_stage}
                  </span>
                </button>
              )
            })}
          </SectionCard>
        </div>

        {/* Pending feedback */}
        <div className="col-span-12 md:col-span-5">
          <SectionCard title="Pending feedback" badge={pending.length} action={{ label: 'View all', href: '/interviews' }}>
            {pending.length === 0 ? (
              <AllClear />
            ) : pending.slice(0, 6).map((c: any) => (
              <button key={c.id} onClick={() => navigate(`/candidates/${c.id}`)}
                className="w-full flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/80 -mx-2 px-2 rounded-lg transition-colors group text-left">
                <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-[9px] font-bold text-orange-600">{c.full_name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-gray-800 truncate group-hover:text-indigo-600 transition-colors">{c.full_name}</p>
                  <p className="text-[10px] text-gray-400 truncate">{c.jobTitle ?? '—'}</p>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${stagePill(c.current_stage, stageConfigs)}`}>
                  {c.current_stage}
                </span>
                <ArrowRight className="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0"/>
              </button>
            ))}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// AGENCY DASHBOARD — wrap old widget in new shell
// ============================================================
function AgencyDashboard() {
  const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const { user } = useAuthStore()
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <p className="text-[12px] text-gray-400 font-medium mb-1">{dateLabel}</p>
        <h1 className="text-[22px] font-bold tracking-tight text-gray-900">{greeting()}, {user?.full_name.split(' ')[0]}</h1>
      </div>
      <AgencyDashboardWidget />
    </div>
  )
}
