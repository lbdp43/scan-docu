import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';

// Lazy-loaded pages for code splitting
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Scan = lazy(() => import('./pages/Scan'));
const Manual = lazy(() => import('./pages/Manual'));
const History = lazy(() => import('./pages/History'));
const Admin = lazy(() => import('./pages/Admin'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
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

function PrivateRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="animate-spin w-8 h-8 border-2 border-green-mid border-t-transparent rounded-full" />
      </div>
    );
  }

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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-bg"><div className="animate-spin w-8 h-8 border-2 border-green-mid border-t-transparent rounded-full" /></div>}>
          <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
              <Route path="/" element={<Suspense fallback={<PageFallback />}><Scan /></Suspense>} />
              <Route path="/dashboard" element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
              <Route path="/manual" element={<Suspense fallback={<PageFallback />}><Manual /></Suspense>} />
              <Route path="/history" element={<Suspense fallback={<PageFallback />}><History /></Suspense>} />
              <Route path="/stats" element={<Suspense fallback={<PageFallback />}><Stats /></Suspense>} />
              <Route path="/profile" element={<Suspense fallback={<PageFallback />}><Profile /></Suspense>} />
              <Route path="/admin" element={<PrivateRoute adminOnly><Suspense fallback={<PageFallback />}><Admin /></Suspense></PrivateRoute>} />
              <Route path="/admin/users" element={<PrivateRoute adminOnly><Suspense fallback={<PageFallback />}><AdminUsers /></Suspense></PrivateRoute>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
