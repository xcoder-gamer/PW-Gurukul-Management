import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Users, BookOpen, BarChart3, MoreHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'framer-motion';

import { useAuth } from '../context/AuthContext';

export function BottomNav() {
  const { role } = useAuth();

  const navItems = [
    { to: '/', icon: Home, label: 'Home', allow: ['admin', 'operator', 'central_team'] },
    { to: '/students', icon: Users, label: 'Students', allow: ['admin', 'operator', 'central_team', 'central', 'center_level', 'center', 'teacher'] },
    { to: '/tests', icon: BookOpen, label: 'Tests', allow: ['admin', 'operator', 'central_team'] },
    { to: '/results', icon: BarChart3, label: 'Analysis', allow: ['admin', 'operator', 'central_team', 'central', 'center_level', 'center', 'teacher'] },
    { to: '/more', icon: MoreHorizontal, label: 'More', allow: ['admin', 'operator'] },
  ].filter(item => !role || item.allow.includes(role));

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-20 bg-white/95 backdrop-blur-xl border-t border-slate-200/50 flex items-center justify-around px-4 z-[50] shadow-[0_-10px_40px_rgba(0,0,0,0.05)] pb-safe md:hidden">
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className="flex flex-col items-center justify-center w-full h-full relative outline-none"
        >
          {({ isActive }) => (
            <>
              <div className={cn(
                "flex flex-col items-center transition-all duration-300",
                isActive ? "text-blue-600" : "text-slate-400"
              )}>
                <Icon 
                  size={22} 
                  strokeWidth={isActive ? 2.5 : 2} 
                  className={cn("transition-transform duration-300", isActive && "scale-110 -translate-y-0.5")}
                />
                <span className={cn(
                  "text-[10px] font-black uppercase tracking-[0.12em] mt-1 transition-all duration-300",
                  isActive ? "opacity-100" : "opacity-60"
                )}>
                  {label}
                </span>
              </div>
              {isActive && (
                <motion.div 
                  layoutId="nav-dot"
                  className="absolute bottom-1 w-1 h-1 bg-blue-600 rounded-full"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
