// ============================================================
// DASHBOARD PAGE — reads the widget registry and renders them
// To add a widget: edit widgetRegistry.ts only. This file never changes.
// ============================================================
import { WIDGET_REGISTRY } from './widgetRegistry'
import { useAuthStore } from '../auth/authStore'
import { PageHeader } from '../../shared/components/PageHeader'

export function DashboardPage() {
  const { user } = useAuthStore()

  const widgets = WIDGET_REGISTRY.filter(
    (w) => user && w.roles.includes(user.role)
  )

  const smallWidgets = widgets.filter((w) => w.size === 'sm')
  const medWidgets   = widgets.filter((w) => w.size === 'md')
  const largeWidgets = widgets.filter((w) => w.size === 'lg')

  return (
    <div>
      <PageHeader
        title={`Good ${getGreeting()}, ${user?.full_name.split(' ')[0]} 👋`}
        subtitle="Here's what's happening in your pipeline today."
      />

      {/* Small stat cards — 2 or 4 columns */}
      {smallWidgets.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {smallWidgets.map(({ id, component: Widget }) => (
            <Widget key={id} />
          ))}
        </div>
      )}

      {/* Medium widgets — 2 columns */}
      {medWidgets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {medWidgets.map(({ id, component: Widget }) => (
            <Widget key={id} />
          ))}
        </div>
      )}

      {/* Large widgets — full width */}
      {largeWidgets.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {largeWidgets.map(({ id, component: Widget }) => (
            <Widget key={id} />
          ))}
        </div>
      )}
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
