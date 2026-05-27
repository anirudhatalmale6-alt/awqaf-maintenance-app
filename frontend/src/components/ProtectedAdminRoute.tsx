import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, User, LogIn } from 'lucide-react';

interface ProtectedAdminRouteProps {
  children: React.ReactNode;
}

const ProtectedAdminRoute: React.FC<ProtectedAdminRouteProps> = ({
  children,
}) => {
  const { user, loading, hasPermission, permissionsLoading, logout } = useAuth();

  // Loading state
  if (loading || permissionsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">جاري التحقق من الصلاحيات...</p>
        </div>
      </div>
    );
  }

  // If the user is not logged in, redirect to home
  if (!user) {
    return <Navigate to="/" replace />;
  }

  // Check if user has access_admin_panel permission OR create_bulk_reports permission
  // Users with create_bulk_reports can access the admin panel but will only see the bulk-reports tab
  if (!hasPermission('access_admin_panel') && !hasPermission('create_bulk_reports')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <Shield className="h-8 w-8 text-red-600" />
            </div>
            <CardTitle className="text-xl text-gray-900">
              صلاحيات غير كافية
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="text-gray-600">
              <p className="mb-2">
                الحساب المستخدم لا يملك صلاحية الوصول للوحة الإدارة.
              </p>
              <div className="bg-gray-100 rounded-lg p-3 mb-4">
                <div className="flex items-center justify-center space-x-2 text-sm">
                  <User className="h-4 w-4 text-gray-500" />
                  <span className="text-gray-700">
                    الحساب الحالي: {user.email}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  الدور: {user.role}
                </div>
              </div>
              <p className="text-sm">
                يرجى تسجيل الدخول بحساب يملك الصلاحيات المطلوبة.
              </p>
            </div>

            <div className="space-y-3">
              <Button onClick={() => { logout(); window.location.href = '/login'; }} className="w-full" variant="outline">
                <LogIn className="h-4 w-4 mr-2" />
                تبديل الحساب
              </Button>

              <Button
                onClick={() => window.history.back()}
                className="w-full"
                variant="ghost"
              >
                رجوع
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User has permission, render children
  return <>{children}</>;
};

export default ProtectedAdminRoute;