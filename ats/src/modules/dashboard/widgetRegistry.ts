import type { ComponentType } from 'react'
import { TotalCandidatesWidget }  from './widgets/TotalCandidatesWidget'
import { SourceBreakdownWidget }  from './widgets/SourceBreakdownWidget'
import { FunnelStagesWidget }     from './widgets/FunnelStagesWidget'
import { OpenJobsWidget }         from './widgets/OpenJobsWidget'
import { RecentActivityWidget }   from './widgets/RecentActivityWidget'
import { JobBreakdownWidget }     from './widgets/JobBreakdownWidget'
import { HRTeamWidget }           from './widgets/HRTeamWidget'

export interface WidgetConfig {
  id: string
  title: string
  component: ComponentType
  size: 'sm' | 'md' | 'lg'
  roles: string[]
}

export const WIDGET_REGISTRY: WidgetConfig[] = [
  {
    id: 'total-candidates',
    title: 'Total Candidates',
    component: TotalCandidatesWidget,
    size: 'sm',
    roles: ['super_admin', 'admin', 'hr_team', 'interviewer'],
  },
  {
    id: 'open-jobs',
    title: 'Open Jobs',
    component: OpenJobsWidget,
    size: 'sm',
    roles: ['super_admin', 'admin', 'hr_team'],
  },
  {
    id: 'source-breakdown',
    title: 'Source Breakdown',
    component: SourceBreakdownWidget,
    size: 'md',
    roles: ['super_admin', 'admin', 'hr_team'],
  },
  {
    id: 'recent-activity',
    title: 'Recent Candidates',
    component: RecentActivityWidget,
    size: 'md',
    roles: ['super_admin', 'admin', 'hr_team', 'interviewer'],
  },
  {
    id: 'job-breakdown',
    title: 'Candidates by Job',
    component: JobBreakdownWidget,
    size: 'lg',
    roles: ['super_admin', 'admin', 'hr_team'],
  },
  {
    id: 'funnel-stages',
    title: 'Pipeline Funnel',
    component: FunnelStagesWidget,
    size: 'lg',
    roles: ['super_admin', 'admin', 'hr_team'],
  },
  {
    id: 'hr-team',
    title: 'HR Team Overview',
    component: HRTeamWidget,
    size: 'lg',
    roles: ['super_admin'],
  },
]
