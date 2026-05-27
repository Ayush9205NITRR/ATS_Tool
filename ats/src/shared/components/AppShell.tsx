import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, Briefcase, Upload, ClipboardList, Settings, Menu, LogOut, X, Bell, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '../../modules/auth/authStore'
import { initialsOf } from '../utils/helpers'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'

const NAV = [
  { to: '/dashboard',  label: 'Dashboard',     icon: LayoutDashboard, roles: ['super_admin','admin','hr_team','interviewer','agency'] },
  { to: '/candidates', label: 'Candidates',     icon: Users,           roles: ['super_admin','admin','hr_team'] },
  { to: '/candidates', label: 'My Submissions', icon: Users,           roles: ['agency'] },
  { to: '/interviews',     label: 'My Interviews',  icon: ClipboardList, roles: ['interviewer'] },
  { to: '/cost-approval',  label: 'Cost Approval',  icon: ShieldCheck,   roles: ['super_admin','admin','hr_team','interviewer'] },
  { to: '/jobs',           label: 'Jobs',           icon: Briefcase,     roles: ['super_admin','admin','hr_team'] },
  { to: '/upload',     label: 'Upload',         icon: Upload,          roles: ['super_admin','admin','hr_team','agency'] },
  { to: '/settings',   label: 'Settings',       icon: Settings,        roles: ['super_admin'] },
]

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin', admin: 'Admin',
  hr_team: 'HR Team', interviewer: 'Interviewer', agency: 'Agency',
}

function NotificationBell({ upward = false }: { upward?: boolean }) {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('notifications').select('*')
        .eq('user_id', user!.id).order('created_at', { ascending: false }).limit(20)
      return (data ?? []) as { id: string; title: string; body: string | null; read_at: string | null; created_at: string; metadata: any }[]
    },
    enabled: !!user,
    staleTime: 0,
    refetchInterval: 30_000,
  })

  const unread = notifications.filter(n => !n.read_at).length

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['notifications', user?.id] })
  }

  const markAllRead = async () => {
    const ids = notifications.filter(n => !n.read_at).map(n => n.id)
    if (!ids.length) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    qc.invalidateQueries({ queryKey: ['notifications', user?.id] })
  }

  const timeAgo = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(ms / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="relative p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors">
        <Bell className="w-4 h-4"/>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}/>
          <div className={`absolute w-80 bg-white border border-zinc-200 rounded-xl shadow-lg z-50 overflow-hidden ${upward ? 'left-0 bottom-full mb-2' : 'right-0 top-full mt-2'}`}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100">
              <p className="text-sm font-semibold text-zinc-800">Notifications</p>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs text-indigo-600 hover:text-indigo-800">Mark all read</button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="text-sm text-zinc-400 text-center py-6">No notifications</p>
              ) : notifications.map(n => (
                <div key={n.id} onClick={() => { if (!n.read_at) markRead(n.id) }}
                  className={`px-4 py-3 cursor-pointer hover:bg-zinc-50 border-b border-zinc-50 last:border-0 ${!n.read_at ? 'bg-indigo-50/30' : ''}`}>
                  <div className="flex items-start gap-2">
                    {!n.read_at && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0"/>}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800">{n.title}</p>
                      {n.body && <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-xs text-zinc-400 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function AppShell() {
  const { user, signOut } = useAuthStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const visibleNav = NAV.filter(n => user && n.roles.includes(user.role))

  const Sidebar = () => (
    <div className="flex flex-col h-full bg-white">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-14 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Briefcase className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-semibold text-zinc-900 tracking-tight text-[15px]">ATS</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto scrollbar-thin">
        {visibleNav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={`${to}-${label}`}
            to={to}
            end={to === '/dashboard'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 font-normal'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${isActive ? 'text-indigo-600' : 'text-zinc-400'}`} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      {user && (
        <div className="border-t border-zinc-100 px-3 py-3">
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-indigo-700">{initialsOf(user.full_name)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 truncate leading-tight">{user.full_name}</p>
              <p className="text-xs text-zinc-400 truncate leading-tight mt-0.5">{ROLE_LABELS[user.role] ?? user.role}</p>
            </div>
            {['super_admin', 'admin', 'hr_team'].includes(user.role) && <NotificationBell upward />}
            <button
              onClick={signOut}
              className="text-zinc-300 hover:text-zinc-600 transition-colors p-1 rounded-lg hover:bg-zinc-100"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex h-screen bg-[#F8FAFC]">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-[220px] flex-shrink-0 shadow-sidebar">
        <Sidebar />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-[220px] h-full shadow-card-md animate-slide-up">
            <Sidebar />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <div className="md:hidden flex items-center gap-3 px-4 h-14 bg-white border-b border-zinc-100">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-500 transition-colors"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2 flex-1">
            <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center">
              <Briefcase className="w-3 h-3 text-white" />
            </div>
            <span className="font-semibold text-zinc-900 text-sm">ATS</span>
          </div>
          <NotificationBell />
        </div>

        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-7xl mx-auto px-5 md:px-8 py-6 animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
