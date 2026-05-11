// ============================================================
// AUTH GUARD — wraps protected routes
// Usage: <AuthGuard roles={['admin','super_admin']}><Page/></AuthGuard>
// ============================================================
import { Navigate } from 'react-router-dom'
import { useAuthStore } from './authStore'
import type { User } from '../../types/database.types'

interface Props {
  children: React.ReactNode
  roles?: User['role'][]        // if omitted, any logged-in user passes
}

export function AuthGuard({ children, roles }: Props) {
  const { user, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
