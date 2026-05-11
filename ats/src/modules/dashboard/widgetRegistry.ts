// ============================================================
// WIDGET REGISTRY — THE plug-and-play mechanism
//
// To add a new widget:
//   1. Create MyWidget.tsx in /widgets/
//   2. Import it here
//   3. Add one entry to WIDGET_REGISTRY
//   4. Done — it appears on the dashboard automatically
//
// To remove a widget: delete its entry. Nothing else changes.
// ============================================================
import type { ComponentType } from 'react'
import { TotalCandidatesWidget }  from './widgets/TotalCandidatesWidget'
import { SourceBreakdownWidget }  from './widgets/SourceBreakdownWidget'
import { FunnelStagesWidget }     from './widgets/FunnelStagesWidget'
import { OpenJobsWidget }         from './widgets/OpenJobsWidget'
import { RecentActivityWidget }   from './widgets/RecentActivityWidget'

export interface WidgetConfig {
  id: string
  title: string
  component: ComponentType
  size: 'sm' | 'md' | 'lg'   // sm=1col  md=1col  lg=2col (full width)
  roles: string[]             // which roles see this widget
}

export const WIDGET_REGISTRY: WidgetConfig[] = [
  {
    id: 'total-candidates',
    title: 'Total Candidates',
    component: TotalCandidatesWidget,
    size: 'sm',
    roles: ['super_admin', 'admin', 'interviewer'],
  },
  {
    id: 'open-jobs',
    title: 'Open Jobs',
    component: OpenJobsWidget,
    size: 'sm',
    roles: ['super_admin', 'admin'],
  },
  {
    id: 'source-breakdown',
    title: 'Source Breakdown',
    component: SourceBreakdownWidget,
    size: 'md',
    roles: ['super_admin', 'admin'],
  },
  {
    id: 'funnel-stages',
    title: 'Pipeline Funnel',
    component: FunnelStagesWidget,
    size: 'lg',
    roles: ['super_admin', 'admin'],
  },
  {
    id: 'recent-activity',
    title: 'Recent Activity',
    component: RecentActivityWidget,
    size: 'md',
    roles: ['super_admin', 'admin', 'interviewer'],
  },
]
