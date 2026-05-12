import { useState, useEffect } from 'react'
import { Settings2, X, LayoutDashboard } from 'lucide-react'
import { WIDGET_REGISTRY, type WidgetConfig } from './widgetRegistry'
import { useAuthStore } from '../auth/authStore'
import { PageHeader } from '../../shared/components/PageHeader'
import { Button } from '../../shared/components/Button'

const STORAGE_KEY = 'ats_dashboard_v2'

function loadConfig(role: string): string[] {
  try {
    const saved = localStorage.getItem(`${STORAGE_KEY}_${role}`)
    if (saved) return JSON.parse(saved)
  } catch {}
  return WIDGET_REGISTRY.filter(w => w.roles.includes(role)).map(w => w.id)
}

function saveConfig(role: string, ids: string[]) {
  try { localStorage.setItem(`${STORAGE_KEY}_${role}`, JSON.stringify(ids)) } catch {}
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

export function DashboardPage() {
  const { user } = useAuthStore()
  const isSuperAdmin = user?.role === 'super_admin'
  const [customizing, setCustomizing] = useState(false)
  const [visibleIds, setVisibleIds] = useState<string[]>([])

  useEffect(() => {
    if (user) setVisibleIds(loadConfig(user.role))
  }, [user?.role])

  if (!user) return null

  const available = WIDGET_REGISTRY.filter(w => w.roles.includes(user.role))
  const visible = visibleIds
    .map(id => available.find(w => w.id === id))
    .filter(Boolean) as WidgetConfig[]

  const toggle = (id: string) => {
    const next = visibleIds.includes(id)
      ? visibleIds.filter(i => i !== id)
      : [...visibleIds, id]
    setVisibleIds(next)
    saveConfig(user.role, next)
  }

  const reset = () => {
    const def = available.map(w => w.id)
    setVisibleIds(def)
    saveConfig(user.role, def)
  }

  // Split widgets by size
  const smWidgets  = visible.filter(w => w.size === 'sm')
  const mdWidgets  = visible.filter(w => w.size === 'md')
  const lgWidgets  = visible.filter(w => w.size === 'lg')

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Good {getGreeting()}, {user.full_name.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Here's what's happening in your pipeline today.</p>
        </div>
        {isSuperAdmin && (
          <div className="flex items-center gap-2">
            {customizing && <Button variant="ghost" size="sm" onClick={reset}>Reset</Button>}
            <Button variant={customizing ? 'primary' : 'secondary'} size="sm"
              icon={customizing ? <X className="w-3.5 h-3.5"/> : <Settings2 className="w-3.5 h-3.5"/>}
              onClick={() => setCustomizing(!customizing)}>
              {customizing ? 'Done' : 'Customize'}
            </Button>
          </div>
        )}
      </div>

      {/* Widget picker */}
      {customizing && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Toggle Widgets</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {available.map(w => {
              const isOn = visibleIds.includes(w.id)
              return (
                <button key={w.id} onClick={() => toggle(w.id)}
                  className={`text-left p-3 rounded-xl border-2 transition-all ${isOn ? 'border-blue-500 bg-blue-50/40' : 'border-gray-100 bg-gray-50/50 opacity-50'}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-gray-800 truncate">{w.title}</p>
                    <div className={`w-3.5 h-3.5 rounded-full flex-shrink-0 border-2 ${isOn ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}/>
                  </div>
                  <p className="text-xs text-gray-400 leading-tight">{w.description}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Small stat cards — 2-col grid */}
      {smWidgets.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {smWidgets.map(({ id, component: W }) => <W key={id}/>)}
        </div>
      )}

      {/* Medium widgets — 2-col grid */}
      {mdWidgets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mdWidgets.map(({ id, component: W }) => <W key={id}/>)}
        </div>
      )}

      {/* Large widgets — full width */}
      {lgWidgets.length > 0 && (
        <div className="space-y-4">
          {lgWidgets.map(({ id, component: W }) => <W key={id}/>)}
        </div>
      )}

      {visible.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <LayoutDashboard className="w-8 h-8 mb-2 opacity-40"/>
          <p className="text-sm">No widgets visible.</p>
          {isSuperAdmin && <p className="text-xs mt-1">Click <strong>Customize</strong> to add widgets.</p>}
        </div>
      )}
    </div>
  )
}
