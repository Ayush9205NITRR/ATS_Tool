// ============================================================
// APP ROUTER — all routes defined here, nowhere else
// Adding a new page = add one line here + create the module file
// ============================================================
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '../shared/components/AppShell'
import { AuthGuard } from '../modules/auth/AuthGuard'
import { LoginPage } from '../modules/auth/LoginPage'

// Lazy-load pages — keeps initial bundle small
import { lazy, Suspense } from 'react'
const DashboardPage      = lazy(() => import('../modules/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const CandidatesPage     = lazy(() => import('../modules/candidates/CandidatesPage').then(m => ({ default: m.CandidatesPage })))
const CandidateProfile   = lazy(() => import('../modules/candidates/CandidateProfilePage').then(m => ({ default: m.CandidateProfilePage })))
const JobsPage           = lazy(() => import('../modules/jobs/JobsPage').then(m => ({ default: m.JobsPage })))
const UploadPage         = lazy(() => import('../modules/upload/UploadPage').then(m => ({ default: m.UploadPage })))
const InterviewsPage     = lazy(() => import('../modules/interviews/InterviewsPage').then(m => ({ default: m.InterviewsPage })))
const SettingsPage       = lazy(() => import('../modules/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected — all roles */}
          <Route element={<AuthGuard><AppShell /></AuthGuard>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/candidates" element={<CandidatesPage />} />
            <Route path="/candidates/:id" element={<CandidateProfile />} />
            <Route path="/interviews" element={
              <AuthGuard roles={['interviewer','admin','super_admin']}><InterviewsPage /></AuthGuard>
            } />

            {/* Admin + Super Admin only */}
            <Route path="/jobs" element={
              <AuthGuard roles={['admin','super_admin']}><JobsPage /></AuthGuard>
            } />
            <Route path="/upload" element={
              <AuthGuard roles={['admin','super_admin']}><UploadPage /></AuthGuard>
            } />

            {/* Super Admin only */}
            <Route path="/settings" element={
              <AuthGuard roles={['super_admin']}><SettingsPage /></AuthGuard>
            } />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
