import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, Briefcase, Upload, ClipboardList, Settings, Menu, LogOut } from 'lucide-react'
import { useAuthStore } from '../../modules/auth/authStore'
import { initialsOf } from '../utils/helpers'

const NAV = [
  { to: '/dashboard',  label: 'Dashboard',      icon: LayoutDashboard, roles: ['super_admin','admin','hr_team','interviewer'] },
  { to: '/candidates', label: 'Candidates',      icon: Users,           roles: ['super_admin','admin','hr_team'] },
  { to: '/interviews', label: 'My Interviews',   icon: ClipboardList,   roles: ['interviewer'] },
  { to: '/jobs',       label: 'Jobs',            icon: Briefcase,       roles: ['super_admin','admin','hr_team'] },
  { to: '/upload',     label: 'Upload',          icon: Upload,          roles: ['super_admin','admin','hr_team'] },
  { to: '/settings',   label: 'Settings',        icon: Settings,        roles: ['super_admin'] },
]

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin', admin: 'Admin',
  hr_team: 'HR Team', interviewer: 'Interviewer',
}

export function AppShell() {
  const { user, signOut } = useAuthStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const visibleNav = NAV.filter(n => user && n.roles.includes(user.role))

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <Briefcase className="w-4 h-4 text-white"/>
        </div>
        <span className="font-semibold text-gray-900">ATS</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {visibleNav.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }>
            <Icon className="w-4 h-4 flex-shrink-0"/>
            {label}
          </NavLink>
        ))}
      </nav>

      {user && (
        <div className="border-t border-gray-100 px-3 py-3">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-blue-700">{initialsOf(user.full_name)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user.full_name}</p>
              <p className="text-xs text-gray-400 truncate">{ROLE_LABELS[user.role] ?? user.role}</p>
            </div>
            <button onClick={signOut} className="text-gray-400 hover:text-gray-600 transition-colors" title="Sign out">
              <LogOut className="w-4 h-4"/>
            </button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="hidden md:flex flex-col w-56 bg-white border-r border-gray-200 flex-shrink-0">
        <Sidebar/>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)}/>
          <aside className="relative w-56 h-full bg-white border-r border-gray-200">
            <Sidebar/>
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <button onClick={() => setMobileOpen(true)}><Menu className="w-5 h-5 text-gray-600"/></button>
          <span className="font-semibold text-gray-900 text-sm">ATS</span>
        </div>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
            <Outlet/>
          </div>
        </main>
      </div>
    </div>
  )
}
