import type { ComponentType } from 'react'
import { TotalCandidatesWidget }  from './widgets/TotalCandidatesWidget'
import { OpenJobsWidget }         from './widgets/OpenJobsWidget'
import { SourceBreakdownWidget }  from './widgets/SourceBreakdownWidget'
import { SourceFunnelWidget }     from './widgets/SourceFunnelWidget'
import { FunnelStagesWidget }     from './widgets/FunnelStagesWidget'
import { RecentActivityWidget }   from './widgets/RecentActivityWidget'
import { JobBreakdownWidget }     from './widgets/JobBreakdownWidget'
import { HRTeamWidget }           from './widgets/HRTeamWidget'
import { HRDashboardWidget }      from './widgets/HRDashboardWidget'
import { InterviewerStatsWidget } from './widgets/InterviewerStatsWidget'

export interface WidgetConfig {
  id: string
  title: string
  component: ComponentType
  size: 'sm' | 'md' | 'lg'
  roles: string[]
  description: string
}

export const WIDGET_REGISTRY: WidgetConfig[] = [
  {
    id: 'total-candidates',
    title: 'Total Candidates',
    component: TotalCandidatesWidget,
    size: 'sm',
    roles: ['super_admin','admin','hr_team','interviewer'],
    description: 'Total candidate count all time',
  },
  {
    id: 'open-jobs',
    title: 'Open Jobs',
    component: OpenJobsWidget,
    size: 'sm',
    roles: ['super_admin','admin','hr_team'],
    description: 'Number of currently open positions',
  },
  {
    id: 'hr-dashboard',
    title: 'My Pipeline',
    component: HRDashboardWidget,
    size: 'md',
    roles: ['hr_team','admin','super_admin'],
    description: 'Jobs assigned, candidate count, and stage funnel',
  },
  {
    id: 'interviewer-stats',
    title: 'Interview Summary',
    component: InterviewerStatsWidget,
    size: 'md',
    roles: ['interviewer','admin','super_admin'],
    description: 'Interviews taken, feedback given, average score',
  },
  {
    id: 'source-funnel',
    title: 'Source-wise Candidates',
    component: SourceFunnelWidget,
    size: 'md',
    roles: ['super_admin','admin','hr_team'],
    description: 'Candidates received from Platform, Agency, College',
  },
  {
    id: 'recent-activity',
    title: 'Recent Candidates',
    component: RecentActivityWidget,
    size: 'md',
    roles: ['super_admin','admin','hr_team','interviewer'],
    description: 'Latest candidates added to the system',
  },
  {
    id: 'job-breakdown',
    title: 'Candidates by Job',
    component: JobBreakdownWidget,
    size: 'lg',
    roles: ['super_admin','admin','hr_team'],
    description: 'Per-job candidate count with stage breakdown',
  },
  {
    id: 'funnel-stages',
    title: 'Pipeline Funnel',
    component: FunnelStagesWidget,
    size: 'lg',
    roles: ['super_admin','admin','hr_team'],
    description: 'Overall pipeline stage distribution',
  },
  {
    id: 'source-breakdown',
    title: 'Source Chart',
    component: SourceBreakdownWidget,
    size: 'md',
    roles: ['super_admin','admin'],
    description: 'Bar chart of candidates by source category',
  },
  {
    id: 'hr-team',
    title: 'HR Team Overview',
    component: HRTeamWidget,
    size: 'lg',
    roles: ['super_admin'],
    description: 'HR member → jobs → candidate counts',
  },
]
