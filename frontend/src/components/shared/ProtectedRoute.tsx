import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/authStore'

export default function ProtectedRoute() {
  // Subscribe to accessToken directly so this component re-renders whenever
  // auth state changes (logout, session expiry). Selecting the `isAuthenticated`
  // function itself returns a stable reference and would never trigger a re-render.
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAuthenticated = useAuthStore.getState().isAuthenticated

  if (!accessToken || !isAuthenticated()) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
