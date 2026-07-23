import { Navigate, Outlet } from 'react-router-dom'
import { PageLoader } from '@renderer/components/PageLoader'
import { useAuthStore } from './auth-store'
import type { AppUser, UserRole } from '@shared/types'
import { MANAGEMENT_PERMISSIONS, hasAnyPermission, hasPermission, type Permission } from '@shared/types/user'

interface ProtectedRouteProps {
  roles?: UserRole[]
  permission?: Permission
  anyPermission?: Permission[]
}

function fallbackPath(user: AppUser): string {
  if (hasAnyPermission(user, MANAGEMENT_PERMISSIONS)) return '/manager'
  if (hasPermission(user, 'pos')) return '/pos'
  if (hasPermission(user, 'order_history')) return '/pos/history'
  if (hasPermission(user, 'cashier_inventory')) return '/pos/inventory'
  return '/login'
}

export function ProtectedRoute({ roles, permission, anyPermission }: ProtectedRouteProps): React.ReactElement {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />

  if (anyPermission && !hasAnyPermission(user, anyPermission)) {
    return <Navigate to={fallbackPath(user)} replace />
  }

  if (permission && !hasPermission(user, permission)) {
    return <Navigate to={fallbackPath(user)} replace />
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={fallbackPath(user)} replace />
  }

  return <Outlet />
}
