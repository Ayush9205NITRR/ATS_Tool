import { useState, useEffect } from 'react'
import { Settings2, X } from 'lucide-react'
import { WIDGET_REGISTRY } from './widgetRegistry'
import { useAuthStore } from '../auth/authStore'
import { Button } from '../../shared/components/Button'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'

const STORAGE_KEY = 'ats_db_v4'

// Role-specific default widgets — clean and minimal
const ROLE_DEFAULTS: Record<string, string[]> = {
  super_admin: ['total-candidates','open-jobs','analytics','source-funnel','recent-activity','job-breakdown','funnel-stages','hr-team'],
  admin:       ['total-candidates','open-jobs','analytics','hr-dashboard','source-funnel','recent-activity','job-breakdown'],
  hr_team:     ['total-candidates','open-jobs','hr-dashboard','source-funnel','recent-activity'],
  interviewer: ['interviewer-stats','recent-activity'],
}

function load(role: string): string[] {
  try { const s = localStorage.getItem(`${STORAGE_KEY}_${role}`); if (s) return JSON.parse(s) } catch {}
  return ROLE_DEFAULTS[role] ?? []
}
function save(role: string, ids: string[]) {
  try { localStorage.setItem(`${STORAGE_KEY}_${role}`, JSON.stringify(ids)) } catch {}
}
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

export function DashboardPage() {
  const { user } = useAuthStore()
  const [customizing, setCustomizing] = useState(false)
  const [visible, setVisible] = useState<string[]>([])

  useEffect(() => { if (user) setVisible(load(user.role)) }, [user?.role])

  if (!user) return null

  const available = WIDGET_REGISTRY.filter(w => w.roles.includes(user.role))
  const widgets = visible.map(id => available.find(w => w.id === id)).filter(Boolean) as typeof available
  const isSuperAdmin = user.role === 'super_admin'

  const toggle = (id: string) => {
    const next = visible.includes(id) ? visible.filter(i => i !== id) : [...visible, id]
    setVisible(next); save(user.role, next)
  }
  const reset = () => {
    const def = ROLE_DEFAULTS[user.role] ?? []
    setVisible(def); save(user.role, def)
  }

  const sm = widgets.filter(w => w.size === 'sm')
  const md = widgets.filter(w => w.size === 'md')
  const lg = widgets.filter(w => w.size === 'lg')

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Good {greeting()}, {user.full_name.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {user.role === 'interviewer' ? 'Your assigned interviews and feedback.' : "Here's what's happening in your pipeline today."}
          </p>
        </div>
        {isSuperAdmin && (
          <div className="flex gap-2">
            {customizing && <Button variant="ghost" size="sm" onClick={reset}>Reset</Button>}
            <Button variant={customizing ? 'primary' : 'secondary'} size="sm"
              icon={customizing ? <X className="w-3.5 h-3.5"/> : <Settings2 className="w-3.5 h-3.5"/>}
              onClick={() => setCustomizing(c => !c)}>
              {customizing ? 'Done' : 'Customize'}
            </Button>
          </div>
        )}
      </div>

      {/* Customize panel */}
      {customizing && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Toggle Widgets</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {available.map(w => {
              const on = visible.includes(w.id)
              return (
                <button key={w.id} onClick={() => toggle(w.id)}
                  className={`text-left p-3 rounded-xl border-2 transition-all ${on ? 'border-blue-500 bg-blue-50/30' : 'border-gray-100 opacity-50 hover:opacity-70'}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-gray-800 truncate">{w.title}</p>
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ${on ? 'bg-blue-500' : 'bg-gray-200'}`}/>
                  </div>
                  <p className="text-xs text-gray-400 leading-tight">{w.description}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {sm.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {sm.map(({ id, component: W }) => <W key={id}/>)}
        </div>
      )}
      {md.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {md.map(({ id, component: W }) => <W key={id}/>)}
        </div>
      )}
      {lg.length > 0 && (
        <div className="space-y-4">
          {lg.map(({ id, component: W }) => <W key={id}/>)}
        </div>
      )}
      {widgets.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-sm">No widgets visible.</p>
          {isSuperAdmin && <p className="text-xs mt-1">Click <strong>Customize</strong> to add widgets.</p>}
        </div>
      )}
    </div>
  )
}
