// ============================================================
// APP.TSX — root of the application
// Initialises auth listener, wraps with QueryClientProvider
// ============================================================
import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from './lib/queryClient'
import { AppRouter } from './routes/AppRouter'
import { authService } from './modules/auth/authService'
import { useAuthStore } from './modules/auth/authStore'

function AuthListener({ children }: { children: React.ReactNode }) {
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    // Load existing session on mount
    authService.getSession().then(setSession)

    // Listen for auth changes (login, logout, token refresh)
    const subscription = authService.onAuthStateChange(setSession)
    return () => subscription.unsubscribe()
  }, [])

  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthListener>
        <AppRouter />
      </AuthListener>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
