// ============================================================
// DASHBOARD PAGE — customizable widget grid
// Super Admin can toggle widgets on/off and reorder them
// ============================================================
import { useState, useEffect } from 'react'
import { Settings2, X, GripVertical, LayoutDashboard } from 'lucide-react'
import { WIDGET_REGISTRY, type WidgetConfig } from './widgetRegistry'
import { useAuthStore } from '../auth/authStore'
import { PageHeader } from '../../shared/components/PageHeader'
import { Button } from '../../shared/components/Button'

const STORAGE_KEY = 'ats_dashboard_config'

interface DashboardConfig {
  visibleIds: string[]
  order: string[]
}

function getDefaultConfig(role: string): DashboardConfig {
  const visible = WIDGET_REGISTRY
    .filter(w => w.roles.includes(role))
    .map(w => w.id)
  return { visibleIds: visible, order: visible }
}

function loadConfig(role: string): DashboardConfig {
  try {
    const saved = localStorage.getItem(`${STORAGE_KEY}_${role}`)
    if (saved) return JSON.parse(saved)
  } catch {}
  return getDefaultConfig(role)
}

function saveConfig(role: string, config: DashboardConfig) {
  try { localStorage.setItem(`${STORAGE_KEY}_${role}`, JSON.stringify(config)) } catch {}
}

export function DashboardPage() {
  const { user } = useAuthStore()
  const isSuperAdmin = user?.role === 'super_admin'
  const [customizing, setCustomizing] = useState(false)
  const [config, setConfig] = useState<DashboardConfig>(() =>
    user ? loadConfig(user.role) : { visibleIds: [], order: [] }
  )
  const [dragId, setDragId] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      const c = loadConfig(user.role)
      setConfig(c)
    }
  }, [user?.role])

  if (!user) return null

  // Available widgets for this role
  const available = WIDGET_REGISTRY.filter(w => w.roles.includes(user.role))

  // Ordered visible widgets
  const orderedVisible = config.order
    .filter(id => config.visibleIds.includes(id))
    .map(id => available.find(w => w.id === id))
    .filter(Boolean) as WidgetConfig[]

  const toggleWidget = (id: string) => {
    const next = { ...config }
    if (next.visibleIds.includes(id)) {
      next.visibleIds = next.visibleIds.filter(i => i !== id)
    } else {
      next.visibleIds = [...next.visibleIds, id]
      if (!next.order.includes(id)) next.order = [...next.order, id]
    }
    setConfig(next)
    saveConfig(user.role, next)
  }

  // Simple drag reorder
  const onDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!dragId || dragId === targetId) return
    const order = [...config.order]
    const from = order.indexOf(dragId)
    const to = order.indexOf(targetId)
    if (from === -1 || to === -1) return
    order.splice(from, 1)
    order.splice(to, 0, dragId)
    const next = { ...config, order }
    setConfig(next)
    saveConfig(user.role, next)
  }

  const resetConfig = () => {
    const def = getDefaultConfig(user.role)
    setConfig(def)
    saveConfig(user.role, def)
  }

  // Group into rows
  const smWidgets  = orderedVisible.filter(w => w.size === 'sm')
  const mdWidgets  = orderedVisible.filter(w => w.size === 'md')
  const lgWidgets  = orderedVisible.filter(w => w.size === 'lg')

  return (
    <div>
      <PageHeader
        title={`Good ${getGreeting()}, ${user.full_name.split(' ')[0]} 👋`}
        subtitle="Here's what's happening in your pipeline today."
        action={
          isSuperAdmin ? (
            <div className="flex gap-2">
              {customizing && (
                <Button variant="ghost" size="sm" onClick={resetConfig}>Reset</Button>
              )}
              <Button
                variant={customizing ? 'primary' : 'secondary'}
                size="sm"
                icon={customizing ? <X className="w-3.5 h-3.5" /> : <Settings2 className="w-3.5 h-3.5" />}
                onClick={() => setCustomizing(!customizing)}
              >
                {customizing ? 'Done' : 'Customize'}
              </Button>
            </div>
          ) : null
        }
      />

      {/* Customize panel */}
      {customizing && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4" /> Customize Dashboard
          </p>
          <p className="text-xs text-blue-600 mb-3">Toggle widgets on/off. Drag them to reorder.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {available.map(w => {
              const isOn = config.visibleIds.includes(w.id)
              return (
                <button key={w.id} onClick={() => toggleWidget(w.id)}
                  className={`text-left p-3 rounded-lg border-2 transition-all ${
                    isOn ? 'border-blue-500 bg-white' : 'border-gray-200 bg-white/50 opacity-60'
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-gray-800">{w.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{w.description}</p>
                    </div>
                    <div className={`w-4 h-4 rounded-full flex-shrink-0 mt-0.5 ${isOn ? 'bg-blue-500' : 'bg-gray-200'}`} />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Small stat widgets */}
      {smWidgets.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {smWidgets.map(({ id, component: Widget }) => (
            <div key={id} draggable={customizing}
              onDragStart={() => setDragId(id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={e => onDragOver(e, id)}
              className={customizing ? 'cursor-grab active:cursor-grabbing ring-2 ring-blue-300 rounded-xl' : ''}>
              <Widget />
            </div>
          ))}
        </div>
      )}

      {/* Medium widgets — 2 col */}
      {mdWidgets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {mdWidgets.map(({ id, component: Widget }) => (
            <div key={id} draggable={customizing}
              onDragStart={() => setDragId(id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={e => onDragOver(e, id)}
              className={customizing ? 'cursor-grab active:cursor-grabbing ring-2 ring-blue-300 rounded-xl' : ''}>
              {customizing && (
                <div className="flex items-center gap-1 px-3 py-1 bg-blue-100 rounded-t-xl">
                  <GripVertical className="w-3 h-3 text-blue-400" />
                  <span className="text-xs text-blue-500">Drag to reorder</span>
                </div>
              )}
              <Widget />
            </div>
          ))}
        </div>
      )}

      {/* Large widgets — full width */}
      {lgWidgets.length > 0 && (
        <div className="space-y-4">
          {lgWidgets.map(({ id, component: Widget }) => (
            <div key={id} draggable={customizing}
              onDragStart={() => setDragId(id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={e => onDragOver(e, id)}
              className={customizing ? 'cursor-grab active:cursor-grabbing ring-2 ring-blue-300 rounded-xl' : ''}>
              <Widget />
            </div>
          ))}
        </div>
      )}

      {orderedVisible.length === 0 && !customizing && (
        <div className="text-center py-16 text-gray-400">
          <LayoutDashboard className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No widgets visible. Click Customize to add them.</p>
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
