import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import ErrorBoundary from './components/ErrorBoundary'
import { RequireAuth, RequireOrganization, RequirePermission } from './components/guards'
import AppShell from './components/AppShell'
import LoginPage from './pages/LoginPage'
import BootstrapPage from './pages/BootstrapPage'
import DashboardPage from './pages/DashboardPage'
import AuditPage from './pages/AuditPage'
import UnauthorizedPage from './pages/UnauthorizedPage'

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />

            <Route
              path="/bootstrap"
              element={
                <RequireAuth>
                  <BootstrapPage />
                </RequireAuth>
              }
            />

            <Route
              element={
                <RequireAuth>
                  <RequireOrganization>
                    <AppShell />
                  </RequireOrganization>
                </RequireAuth>
              }
            >
              <Route
                index
                element={
                  <RequirePermission permission="dashboard.view">
                    <DashboardPage />
                  </RequirePermission>
                }
              />
              <Route
                path="audit"
                element={
                  <RequirePermission permission="audit.view">
                    <AuditPage />
                  </RequirePermission>
                }
              />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
