import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, Briefcase, Upload, ClipboardList, Settings, Menu, LogOut, X } from 'lucide-react'
import { useAuthStore } from '../../modules/auth/authStore'
import { initialsOf } from '../utils/helpers'

const NAV = [
  { to: '/dashboard',  label: 'Dashboard',     icon: LayoutDashboard, roles: ['super_admin','admin','hr_team','interviewer','agency'] },
  { to: '/candidates', label: 'Candidates',     icon: Users,           roles: ['super_admin','admin','hr_team'] },
  { to: '/candidates', label: 'My Submissions', icon: Users,           roles: ['agency'] },
  { to: '/interviews', label: 'My Interviews',  icon: ClipboardList,   roles: ['interviewer'] },
  { to: '/jobs',       label: 'Jobs',           icon: Briefcase,       roles: ['super_admin','admin','hr_team'] },
  { to: '/upload',     label: 'Upload',         icon: Upload,          roles: ['super_admin','admin','hr_team','agency'] },
  { to: '/settings',   label: 'Settings',       icon: Settings,        roles: ['super_admin'] },
]

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin', admin: 'Admin',
  hr_team: 'HR Team', interviewer: 'Interviewer', agency: 'Agency',
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
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center">
              <Briefcase className="w-3 h-3 text-white" />
            </div>
            <span className="font-semibold text-zinc-900 text-sm">ATS</span>
          </div>
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
