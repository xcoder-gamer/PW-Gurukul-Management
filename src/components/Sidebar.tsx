import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Home, 
  Users, 
  BookOpen, 
  BarChart3, 
  MoreHorizontal, 
  Database,
  LayoutDashboard,
  LogOut
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';

export function Sidebar() {
  const { logout, user, role } = useAuth();
  const isAdmin = role === 'admin' || role === 'operator';
  
  const navItems = [
    { to: '/', icon: Home, label: 'Dashboard', allow: ['admin', 'operator', 'central_team'] },
    { to: '/students', icon: Users, label: 'Students', allow: ['admin', 'operator', 'central_team', 'center_level', 'teacher'] },
    { to: '/tests', icon: BookOpen, label: 'Test Series', allow: ['admin', 'operator', 'central_team', 'center_level'] },
    { to: '/results', icon: BarChart3, label: 'Analysis', allow: ['admin', 'operator', 'central_team', 'center_level', 'teacher'] },
    { to: '/masters/qbg', icon: Database, label: 'QBG Master', allow: ['admin', 'operator'] },
    { to: '/logs', icon: LayoutDashboard, label: 'Audit Logs', allow: ['admin', 'operator'] },
    { to: '/more', icon: MoreHorizontal, label: 'Settings', allow: ['admin', 'operator'] },
  ].filter(item => !role || item.allow.includes(role));

  const roleLabel = () => {
    switch(role) {
      case 'admin': return 'Administrator';
      case 'central_team': return 'Central Team';
      case 'center_level': return 'Center Admin';
      case 'teacher': return 'Academic Mentor';
      case 'operator': return 'Operator';
      default: return 'Staff';
    }
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-slate-200 hidden md:flex flex-col z-[60]">
      {/* Brand */}
      <div className="p-6 border-b border-slate-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg shadow-slate-200">
             <BookOpen className="text-white" size={20} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 tracking-tight leading-tight">Gurukul</h1>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-tight">Management System</p>
          </div>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
        <p className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4">Main Menu</p>
        
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all group duration-200",
              isActive 
                ? "bg-slate-900 text-white shadow-md shadow-slate-200" 
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
            )}
          >
            <Icon 
              size={18} 
              strokeWidth={2} 
              className="transition-transform duration-200"
            />
            <span className="font-bold text-sm tracking-tight">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User Info */}
      <div className="p-4 border-t border-slate-100 space-y-2">
        <div className="bg-slate-50 rounded-2xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-black">
            {user?.email?.[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 truncate">{user?.email?.split('@')[0]}</p>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight">
              {roleLabel()}
            </p>
          </div>
        </div>
        <button 
          onClick={logout}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all w-full group"
        >
          <LogOut size={18} />
          <span className="font-bold text-sm">Logout</span>
        </button>
      </div>
    </aside>
  );
}
