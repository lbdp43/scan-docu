import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ExpenseTypesProvider } from './context/ExpenseTypesContext';
import Layout from './components/Layout';

// Lazy-loaded pages for code splitting
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Scan = lazy(() => import('./pages/Scan'));
const Manual = lazy(() => import('./pages/Manual'));
const History = lazy(() => import('./pages/History'));
const Admin = lazy(() => import('./pages/Admin'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const AdminTypes = lazy(() => import('./pages/AdminTypes'));
const Profile = lazy(() => import('./pages/Profile'));
const Stats = lazy(() => import('./pages/Stats'));

function PageFallback() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-7 bg-card rounded-xl w-48" />
      <div className="h-48 bg-card rounded-4xl" />
      <div className="h-20 bg-card rounded-3xl" />
      <div className="h-20 bg-card rounded-3xl" />
    </div>
  );
}

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="animate-spin w-8 h-8 border-2 border-green-mid border-t-transparent rounded-full" />
    </div>
  );
}

function PrivateRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;

  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

// Wrap a lazy page in its own Suspense boundary
const page = (Component) => (
  <Suspense fallback={<PageFallback />}>
    <Component />
  </Suspense>
);

const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <PublicRoute>
        <Suspense fallback={<Spinner />}>
          <Login />
        </Suspense>
      </PublicRoute>
    ),
  },
  {
    element: (
      <PrivateRoute>
        <Layout />
      </PrivateRoute>
    ),
    children: [
      { index: true, element: page(Scan) },
      { path: 'dashboard', element: page(Dashboard) },
      { path: 'manual', element: page(Manual) },
      { path: 'history', element: page(History) },
      { path: 'stats', element: page(Stats) },
      { path: 'profile', element: page(Profile) },
      { path: 'admin', element: <PrivateRoute adminOnly>{page(Admin)}</PrivateRoute> },
      { path: 'admin/users', element: <PrivateRoute adminOnly>{page(AdminUsers)}</PrivateRoute> },
      { path: 'admin/types', element: <PrivateRoute adminOnly>{page(AdminTypes)}</PrivateRoute> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function App() {
  return (
    <AuthProvider>
      <ExpenseTypesProvider>
        <RouterProvider router={router} />
      </ExpenseTypesProvider>
    </AuthProvider>
  );
}
