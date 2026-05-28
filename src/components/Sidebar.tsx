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
  LogOut,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  isCollapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ isCollapsed = false, onToggle }: SidebarProps) {
  const { logout, user, role } = useAuth();
  
  const navItems = [
    { to: '/', icon: Home, label: 'Dashboard', allow: ['admin', 'operator', 'central_team'] },
    { to: '/students', icon: Users, label: 'Students', allow: ['admin', 'operator', 'central_team', 'central', 'center_level', 'center', 'teacher'] },
    { to: '/tests', icon: BookOpen, label: 'Test Series', allow: ['admin', 'operator', 'central_team'] },
    { to: '/results', icon: BarChart3, label: 'Analysis', allow: ['admin', 'operator', 'central_team', 'central', 'center_level', 'center', 'teacher'] },
    { to: '/masters/qbg', icon: Database, label: 'QBG Master', allow: ['admin', 'operator'] },
    { to: '/logs', icon: LayoutDashboard, label: 'Audit Logs', allow: ['admin', 'operator'] },
    { to: '/more', icon: MoreHorizontal, label: 'Settings', allow: ['admin', 'operator'] },
  ].filter(item => !role || item.allow.includes(role));

  const roleLabel = () => {
    switch(role) {
      case 'admin': return 'Administrator';
      case 'central_team': return 'Central Team';
      case 'central': return 'Central';
      case 'center_level': return 'Center Admin';
      case 'teacher': return 'Academic Mentor';
      case 'operator': return 'Operator';
      default: return 'Staff';
    }
  };

  return (
    <aside className={cn(
      "fixed left-0 top-0 bottom-0 bg-white border-r border-slate-200 hidden md:flex flex-col z-[60] transition-all duration-300",
      isCollapsed ? "w-20" : "w-64"
    )}>
      {/* Brand */}
      <div className={cn("p-6 border-b border-slate-50 transition-all duration-300", isCollapsed ? "p-4 flex justify-center" : "p-6")}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg shadow-slate-200 flex-shrink-0">
             <BookOpen className="text-white" size={20} strokeWidth={2.5} />
          </div>
          {!isCollapsed && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }} 
              animate={{ opacity: 1, x: 0 }} 
              className="flex-1 min-w-0"
            >
              <h1 className="text-lg font-black text-slate-900 tracking-tight leading-none">Gurukul</h1>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mt-1">Management System</p>
            </motion.div>
          )}
        </div>
      </div>

      {/* Nav Items */}
      <nav className={cn("flex-1 py-6 space-y-1 overflow-y-auto no-scrollbar", isCollapsed ? "px-2" : "px-3")}>
        {!isCollapsed ? (
          <p className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4">Main Menu</p>
        ) : (
          <div className="h-4" />
        )}
        
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            title={isCollapsed ? label : undefined}
            className={({ isActive }) => cn(
              "flex items-center transition-all group duration-200",
              isCollapsed 
                ? "justify-center w-12 h-12 mx-auto rounded-xl p-0" 
                : "gap-3 px-4 py-3 rounded-xl",
              isActive 
                ? "bg-slate-900 text-white shadow-md shadow-slate-200" 
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
            )}
          >
            <Icon 
              size={18} 
              strokeWidth={2} 
              className="transition-transform duration-200 flex-shrink-0"
            />
            {!isCollapsed && (
              <span className="font-bold text-sm tracking-tight">{label}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User Info */}
      <div className={cn("p-4 border-t border-slate-100", isCollapsed ? "p-2 flex flex-col items-center gap-4" : "space-y-2")}>
        <div className={cn("bg-slate-50 flex items-center transition-all duration-300", isCollapsed ? "p-1.5 rounded-xl justify-center" : "rounded-2xl p-3 gap-3 w-full")}>
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-black flex-shrink-0">
            {user?.email?.[0].toUpperCase()}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0 animate-fade-in">
              <p className="text-xs font-bold text-slate-900 truncate">{user?.email?.split('@')[0]}</p>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight truncate">
                {roleLabel()}
              </p>
            </div>
          )}
        </div>
        <button 
          onClick={logout}
          title="Logout"
          className={cn(
            "flex items-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all group",
            isCollapsed ? "w-10 h-10 justify-center p-0 mx-auto" : "gap-3 px-4 py-3 w-full"
          )}
        >
          <LogOut size={18} className="flex-shrink-0" />
          {!isCollapsed && (
            <span className="font-bold text-sm">Logout</span>
          )}
        </button>
      </div>

      {/* Collapse Toggle Button */}
      {onToggle && (
        <button
          onClick={onToggle}
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          className="absolute right-[-14px] top-1/2 -translate-y-1/2 w-7 h-7 bg-white border border-slate-200 rounded-full flex items-center justify-center cursor-pointer shadow-sm hover:bg-slate-50 hover:border-slate-300 hover:shadow transition-all text-slate-500 z-[70] outline-none"
        >
          {isCollapsed ? (
            <ChevronRight size={12} strokeWidth={3} className="text-slate-600" />
          ) : (
            <ChevronLeft size={12} strokeWidth={3} className="text-slate-600" />
          )}
        </button>
      )}
    </aside>
  );
}
