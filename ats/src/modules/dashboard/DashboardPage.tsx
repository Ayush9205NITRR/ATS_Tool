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
import { AnalyticsWidget }        from './widgets/AnalyticsWidget'
import { JobFunnelWidget }        from './widgets/JobFunnelWidget'
import { SourceSplitWidget }      from './widgets/SourceSplitWidget'
import { AgencyDashboardWidget }  from './widgets/AgencyDashboardWidget'

export interface WidgetConfig {
  id: string; title: string; component: ComponentType
  size: 'sm'|'md'|'lg'; roles: string[]; description: string
}

export const WIDGET_REGISTRY: WidgetConfig[] = [
  { id:'total-candidates',  title:'Total Candidates',       component:TotalCandidatesWidget,  size:'sm', roles:['super_admin','admin','hr_team','interviewer','agency'], description:'Total candidate count' },
  { id:'open-jobs',         title:'Open Jobs',              component:OpenJobsWidget,          size:'sm', roles:['super_admin','admin','hr_team'],               description:'Active positions' },
  { id:'analytics',         title:'Hiring Analytics',       component:AnalyticsWidget,         size:'md', roles:['super_admin','admin'],                         description:'Time-to-hire, conversion rate, week-over-week' },
  { id:'hr-dashboard',      title:'My Pipeline',            component:HRDashboardWidget,       size:'md', roles:['hr_team','admin','super_admin'],               description:'Jobs, candidates, stage funnel' },
  { id:'interviewer-stats', title:'My Interviews',          component:InterviewerStatsWidget,  size:'md', roles:['interviewer','admin','super_admin'],           description:'Pending, completed, upcoming interviews' },
  { id:'source-funnel',     title:'Source Candidates',      component:SourceFunnelWidget,      size:'md', roles:['super_admin','admin','hr_team'],               description:'Platform, Agency, College breakdown' },
  { id:'recent-activity',   title:'Recent Candidates',      component:RecentActivityWidget,    size:'md', roles:['super_admin','admin','hr_team','interviewer','agency'], description:'Latest candidates added' },
  { id:'job-breakdown',     title:'Candidates by Job',      component:JobBreakdownWidget,      size:'lg', roles:['super_admin','admin','hr_team'],               description:'Per-job candidate count and stages' },
  { id:'job-funnel',        title:'Job-wise Pipeline',      component:JobFunnelWidget,         size:'md', roles:['super_admin','admin'],                         description:'Stage funnel per job with filter' },
  { id:'source-split',      title:'Source & Sub-Source',    component:SourceSplitWidget,       size:'md', roles:['super_admin','admin'],                         description:'Source conversion by job' },
  { id:'funnel-stages',     title:'Pipeline Funnel',        component:FunnelStagesWidget,      size:'lg', roles:['super_admin','admin','hr_team'],               description:'Overall stage distribution' },
  { id:'source-breakdown',  title:'Source Chart',           component:SourceBreakdownWidget,   size:'md', roles:['super_admin','admin'],                         description:'Bar chart by source category' },
  { id:'hr-team',           title:'HR Team Overview',       component:HRTeamWidget,            size:'lg', roles:['super_admin'],                                 description:'HR member → jobs → candidates' },
  { id:'agency-dashboard',  title:'My Submissions',         component:AgencyDashboardWidget,   size:'md', roles:['agency'],                                      description:'Stage breakdown of submitted candidates' },
]
