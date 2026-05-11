import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '../shared/components/AppShell'
import { AuthGuard } from '../modules/auth/AuthGuard'
import { LoginPage } from '../modules/auth/LoginPage'
import { lazy, Suspense } from 'react'

const DashboardPage    = lazy(() => import('../modules/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const CandidatesPage   = lazy(() => import('../modules/candidates/CandidatesPage').then(m => ({ default: m.CandidatesPage })))
const CandidateProfile = lazy(() => import('../modules/candidates/CandidateProfilePage').then(m => ({ default: m.CandidateProfilePage })))
const JobsPage         = lazy(() => import('../modules/jobs/JobsPage').then(m => ({ default: m.JobsPage })))
const UploadPage       = lazy(() => import('../modules/upload/UploadPage').then(m => ({ default: m.UploadPage })))
const InterviewsPage   = lazy(() => import('../modules/interviews/InterviewsPage').then(m => ({ default: m.InterviewsPage })))
const SettingsPage     = lazy(() => import('../modules/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))

function PageLoader() {
  return <div className="flex items-center justify-center py-24"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<AuthGuard><AppShell /></AuthGuard>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />

            {/* All roles */}
            <Route path="/candidates" element={<CandidatesPage />} />
            <Route path="/candidates/:id" element={<CandidateProfile />} />

            {/* Interviewer */}
            <Route path="/interviews" element={
              <AuthGuard roles={['interviewer','admin','super_admin','hr_team']}><InterviewsPage /></AuthGuard>
            } />

            {/* Admin + HR Team + Super Admin */}
            <Route path="/jobs" element={
              <AuthGuard roles={['admin','super_admin','hr_team']}><JobsPage /></AuthGuard>
            } />
            <Route path="/upload" element={
              <AuthGuard roles={['admin','super_admin','hr_team']}><UploadPage /></AuthGuard>
            } />

            {/* Super Admin only */}
            <Route path="/settings" element={
              <AuthGuard roles={['super_admin']}><SettingsPage /></AuthGuard>
            } />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
