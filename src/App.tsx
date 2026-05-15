import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BottomNav } from './components/BottomNav';
import { Sidebar } from './components/Sidebar';
import { Button } from './components/UI';
import { LogIn } from 'lucide-react';

// Lazy load pages
const Home = React.lazy(() => import('./pages/Home'));
const Students = React.lazy(() => import('./pages/Students'));
const Tests = React.lazy(() => import('./pages/Tests'));
const Results = React.lazy(() => import('./pages/Results'));
const More = React.lazy(() => import('./pages/More'));
const Masters = React.lazy(() => import('./pages/admin/Masters'));
const Patterns = React.lazy(() => import('./pages/admin/Patterns'));
const QBG = React.lazy(() => import('./pages/QBG'));
const Logs = React.lazy(() => import('./pages/Logs'));

function UnauthorizedPage() {
  const { logout, user } = useAuth();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
      <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mb-6">
        <ShieldAlert className="text-red-600" size={48} />
      </div>
      <h1 className="text-2xl font-black text-slate-900 mb-2">Access Restricted</h1>
      <p className="text-slate-500 text-center max-w-md mb-8">
        Your email <span className="font-bold text-slate-900">({user?.email})</span> is not authorized to access this system. 
        Kindly connect with the administrator to gain access.
      </p>
      <Button variant="outline" onClick={logout} className="space-x-2">
        <LogOut size={18} />
        <span>Logout</span>
      </Button>
    </div>
  )
}

import { ShieldAlert, LogOut } from 'lucide-react';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, role } = useAuth();
  
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>
  );
  
  if (!user) return <Navigate to="/login" />;
  if (role === 'unauthorized') return <UnauthorizedPage />;
  
  return (
    <div className="min-h-screen flex bg-[#F8FAFC] selection:bg-blue-100 uppercase-none">
      <Sidebar />
      <div className="flex-1 pb-24 md:pb-8 md:pl-64 overflow-x-hidden transition-all duration-300">
        <Suspense fallback={
          <div className="min-h-screen flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <div className="max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8">
            {children}
          </div>
        </Suspense>
      </div>
      <BottomNav />
    </div>
  );
}

function LoginPage() {
  const { signIn, user, loading } = useAuth();
  
  if (loading) return null;
  if (user) return <Navigate to="/" />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-white overflow-hidden relative">
      {/* Decorative blobs */}
      <div className="absolute top-[-10%] right-[-10%] w-64 h-64 bg-blue-50 rounded-full blur-3xl opacity-50" />
      <div className="absolute bottom-[-10%] left-[-10%] w-64 h-64 bg-indigo-50 rounded-full blur-3xl opacity-50" />

      <div className="relative z-10 w-full max-w-sm flex flex-col items-center">
        <div className="w-32 h-32 bg-blue-600 rounded-[2.5rem] flex items-center justify-center mb-10 shadow-2xl shadow-blue-100 rotate-6 hover:rotate-0 transition-transform duration-500 group">
          <BookOpen className="text-white group-hover:scale-110 transition-transform" size={56} strokeWidth={2.5} />
        </div>
        <div className="text-center space-y-2 mb-16">
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">PW Gurukul</h1>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Student Result Engine • v1.0</p>
        </div>
        
        <Button size="xl" onClick={signIn} className="w-full py-6 flex items-center justify-center space-x-4 shadow-xl shadow-blue-100 hover:shadow-2xl hover:-translate-y-1 transition-all rounded-[2rem]">
          <div className="p-2 bg-white/20 rounded-xl">
             <LogIn size={26} strokeWidth={3} />
          </div>
          <span className="font-black uppercase tracking-widest text-sm">Login with Google</span>
        </Button>
        
        <div className="mt-12 flex flex-col items-center space-y-4">
          <p className="text-[10px] text-slate-300 font-black uppercase tracking-[0.3em]">
            Official Staff Access Only
          </p>
          <div className="flex space-x-2">
            <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse" />
            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse delay-75" />
            <div className="w-1.5 h-1.5 bg-blue-200 rounded-full animate-pulse delay-150" />
          </div>
        </div>
      </div>
    </div>
  );
}

import { BookOpen } from 'lucide-react';

function HomeSelector() {
  const { role } = useAuth();
  const isAdmin = role === 'admin' || role === 'operator' || role === 'central_team';
  if (role === 'teacher' || role === 'center_level') {
    return <Navigate to="/students" />;
  }
  return <Home />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth();
  if (loading) return null;
  const isAuthorized = role === 'admin' || role === 'operator';
  if (!isAuthorized) return <Navigate to="/students" />;
  return <>{children}</>;
}

function RestrictedRoute({ children, allow }: { children: React.ReactNode, allow: string[] }) {
  const { role, loading } = useAuth();
  if (loading) return null;
  if (!role || !allow.includes(role)) return <Navigate to="/students" />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<PrivateRoute><HomeSelector /></PrivateRoute>} />
          <Route path="/students" element={<PrivateRoute><RestrictedRoute allow={['admin', 'operator', 'central_team', 'center_level', 'teacher']}><Students /></RestrictedRoute></PrivateRoute>} />
          <Route path="/tests" element={<PrivateRoute><RestrictedRoute allow={['admin', 'operator', 'central_team', 'center_level']}><Tests /></RestrictedRoute></PrivateRoute>} />
          <Route path="/results" element={<PrivateRoute><RestrictedRoute allow={['admin', 'operator', 'central_team', 'center_level', 'teacher']}><Results /></RestrictedRoute></PrivateRoute>} />
          <Route path="/more" element={<PrivateRoute><AdminRoute><More /></AdminRoute></PrivateRoute>} />
          <Route path="/masters/qbg" element={<PrivateRoute><AdminRoute><QBG /></AdminRoute></PrivateRoute>} />
          <Route path="/masters/patterns" element={<PrivateRoute><AdminRoute><Patterns /></AdminRoute></PrivateRoute>} />
          <Route path="/logs" element={<PrivateRoute><AdminRoute><Logs /></AdminRoute></PrivateRoute>} />
          <Route path="/masters/:type" element={<PrivateRoute><AdminRoute><Masters /></AdminRoute></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
