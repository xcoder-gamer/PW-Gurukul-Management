import React, { useEffect, useState, useMemo } from 'react';
import { collection, query, getDocs, limit, orderBy, where, getCountFromServer } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useMetadata } from '../context/MetadataContext';
import { Card, Button, Select, Input } from '../components/UI';
import { Users, BookOpen, Target, Trophy, Plus, Upload, CheckCircle, ChevronRight, BarChart3, Clock, UserPlus, FilePlus, Database, Settings, LayoutDashboard, User as UserIcon, Filter, X, Calendar, MapPin, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';

export default function Home() {
  const { user, role } = useAuth();
  const { centers: metaCenters, batches: metaBatches } = useMetadata();
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    students: 0,
    tests: 0,
    avgAccuracy: 0,
    activePrograms: 0,
    totalResults: 0
  });
  const [recentTests, setRecentTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [masters, setMasters] = useState<{ centers: any[], batches: any[], testDates: string[] }>({ centers: [], batches: [], testDates: [] });
  const [filters, setFilters] = useState<{
    centerIds: string[];
    batchIds: string[];
    testDates: string[];
  }>({
    centerIds: [],
    batchIds: [],
    testDates: []
  });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const fetchMasters = async () => {
      const cacheKey = 'home_test_dates_cache';
      const now = Date.now();
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { dates, timestamp } = JSON.parse(cached);
          if (now - timestamp < 15 * 60 * 1000) { // 15 minutes cache
            setMasters(prev => ({
              ...prev,
              testDates: dates
            }));
            return;
          }
        } catch (e) {
          console.warn("Failed parsing test dates cache:", e);
        }
      }

      try {
        const testSnap = await getDocs(query(collection(db, 'tests'), orderBy('date', 'desc'), limit(100)));
        const dates = Array.from(new Set(testSnap.docs.map(d => d.data().date).filter(Boolean))) as string[];

        setMasters(prev => ({
          ...prev,
          testDates: dates
        }));

        sessionStorage.setItem(cacheKey, JSON.stringify({
          dates,
          timestamp: now
        }));
      } catch (err) {
        console.error('Error fetching test dates:', err);
      }
    };
    fetchMasters();
  }, []);

  useEffect(() => {
    const activeCenters = metaCenters.filter(c => c.isActive !== false);
    const activeBatches = metaBatches.filter(b => b.isActive !== false);

    setMasters(prev => ({
      ...prev,
      centers: activeCenters,
      batches: activeBatches
    }));
  }, [metaCenters, metaBatches]);

  useEffect(() => {
    const fetchData = async () => {
      const filterKey = `home_dashboard_cache_${JSON.stringify(filters)}`;
      const now = Date.now();
      const cached = sessionStorage.getItem(filterKey);
      if (cached) {
        try {
          const { stats: cachedStats, recentTests: cachedRecent, timestamp } = JSON.parse(cached);
          if (now - timestamp < 5 * 60 * 1000) { // 5 minutes cache duration
            setStats(cachedStats);
            setRecentTests(cachedRecent);
            setLoading(false);
            return;
          }
        } catch (e) {
          console.warn("Parsing cached home stats failed:", e);
        }
      }

      try {
        setLoading(true);
        
        let studentQuery = query(collection(db, 'students'));
        if (filters.centerIds.length > 0) studentQuery = query(studentQuery, where('centerId', 'in', filters.centerIds));
        if (filters.batchIds.length > 0) studentQuery = query(studentQuery, where('batchId', 'in', filters.batchIds));

        let testQuery = query(collection(db, 'tests'));
        if (filters.batchIds.length > 0) {
          testQuery = query(testQuery, where('batchIds', 'array-contains-any', filters.batchIds));
        }
        if (filters.testDates.length > 0) testQuery = query(testQuery, where('date', 'in', filters.testDates));

        let resultQuery = query(collection(db, 'result_updated'));
        if (filters.batchIds.length > 0) resultQuery = query(resultQuery, where('batchId', 'in', filters.batchIds));
        if (filters.centerIds.length > 0) resultQuery = query(resultQuery, where('centerId', 'in', filters.centerIds));

        // Aggregate counts: 100% server-side optimized counts
        // Accuracy limits: We fetch a strong sample of latest 200 results to calculate representative avg. accuracy
        const [
          studentCountSnap,
          testSnap,
          progCountSnap,
          resultCountSnap,
          totalTestCountSnap,
          resultsAccuracySampleSnap
        ] = await Promise.all([
          getCountFromServer(studentQuery),
          getDocs(query(testQuery, orderBy('createdAt', 'desc'), limit(5))),
          getCountFromServer(collection(db, 'programs')),
          getCountFromServer(resultQuery),
          getCountFromServer(testQuery).catch(() => ({ data: () => ({ count: 0 }) })),
          getDocs(query(resultQuery, limit(200)))
        ]);

        const validResults = resultsAccuracySampleSnap.docs.filter((d: any) => !d.data().isAbsent);
        let avgAcc = 0;
        if (validResults.length > 0) {
          const totalAcc = validResults.reduce((sum: number, d: any) => sum + (d.data().accuracy || 0), 0);
          avgAcc = Math.round(totalAcc / validResults.length);
        }

        const freshStats = {
          students: studentCountSnap.data().count,
          tests: totalTestCountSnap.data().count,
          avgAccuracy: avgAcc || 0,
          activePrograms: progCountSnap.data().count,
          totalResults: resultCountSnap.data().count
        };
        const freshRecentTests = testSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

        setStats(freshStats);
        setRecentTests(freshRecentTests);

        sessionStorage.setItem(filterKey, JSON.stringify({
          stats: freshStats,
          recentTests: freshRecentTests,
          timestamp: now
        }));
      } catch (error) {
        console.error('Home stats error:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [filters]);

  const isAdmin = role === 'admin' || role === 'operator' || role === 'central_team';

  const quickActions = [
    { label: 'Student Directory', icon: UserPlus, color: 'bg-blue-50 text-blue-600', path: '/students' },
    ...(isAdmin ? [
      { label: 'Test Master', icon: FilePlus, color: 'bg-emerald-50 text-emerald-600', path: '/tests' },
      { label: 'Result Evaluation', icon: Upload, color: 'bg-purple-50 text-purple-600', path: '/results?action=upload' },
      { label: 'QBG Master', icon: Database, color: 'bg-amber-50 text-amber-600', path: '/masters/qbg' },
    ] : []),
    { label: 'Analytics Hub', icon: BarChart3, color: 'bg-orange-50 text-orange-600', path: '/results' },
    ...(isAdmin ? [
      { label: 'Management', icon: Settings, color: 'bg-slate-50 text-slate-600', path: '/more' },
    ] : []),
  ];

  return (
    <div className="space-y-10">
      {/* Dashboard Top Bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] pl-0.5">Overview</p>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              Dashboard
              <span className="text-blue-600 block w-2 h-2 rounded-full animate-pulse bg-blue-600" />
            </h1>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "rounded-xl border-slate-200 text-slate-500 font-bold px-4",
                showFilters && "bg-blue-600 text-white border-blue-600"
              )}
            >
              <Filter size={14} className="mr-2" />
              Filters
              {Object.values(filters).some(v => v.length > 0) && (
                <span className="ml-2 w-2 h-2 bg-rose-500 rounded-full" />
              )}
            </Button>
          </div>
          <p className="text-slate-500 font-medium text-sm">
            Welcome back, <span className="text-slate-900 font-bold">{user?.displayName || user?.email?.split('@')[0]}</span>. 
            Here's what's happening today.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <Card className="p-6 border-slate-100 bg-slate-50/50 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-1">Centers</label>
                  <div className="flex flex-wrap gap-2 p-1">
                    {masters.centers.map(center => (
                      <button
                        key={center.id}
                        onClick={() => {
                          const newIds = filters.centerIds.includes(center.id)
                            ? filters.centerIds.filter(id => id !== center.id)
                            : [...filters.centerIds, center.id];
                          setFilters({ ...filters, centerIds: newIds, batchIds: [] });
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-[10px] font-black tracking-tight transition-all border shadow-sm",
                          filters.centerIds.includes(center.id)
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "bg-white border-slate-200 text-slate-500 hover:border-blue-300"
                        )}
                      >
                        {center.centerName}
                      </button>
                    ))}
                    {masters.centers.length === 0 && <p className="text-[10px] font-bold text-slate-300 italic">No centers found</p>}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-1">Batches</label>
                  <div className="flex flex-wrap gap-2 p-1 max-h-[120px] overflow-y-auto custom-scrollbar">
                    {masters.batches
                      .filter(b => filters.centerIds.length === 0 || filters.centerIds.includes(b.centerId))
                      .map(batch => (
                      <button
                        key={batch.id}
                        onClick={() => {
                          const newIds = filters.batchIds.includes(batch.id)
                            ? filters.batchIds.filter(id => id !== batch.id)
                            : [...filters.batchIds, batch.id];
                          setFilters({ ...filters, batchIds: newIds });
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-[10px] font-black tracking-tight transition-all border shadow-sm",
                          filters.batchIds.includes(batch.id)
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : "bg-white border-slate-200 text-slate-500 hover:border-indigo-300"
                        )}
                      >
                        {batch.batchName}
                      </button>
                    ))}
                    {masters.batches.length === 0 && <p className="text-[10px] font-bold text-slate-300 italic">No batches found</p>}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-1">Test Dates</label>
                  <div className="flex flex-wrap gap-2 p-1">
                    {masters.testDates.map(date => (
                      <button
                        key={date}
                        onClick={() => {
                          const newDates = filters.testDates.includes(date)
                            ? filters.testDates.filter(d => d !== date)
                            : [...filters.testDates, date];
                          setFilters({ ...filters, testDates: newDates });
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-[10px] font-black tracking-tight transition-all border shadow-sm",
                          filters.testDates.includes(date)
                            ? "bg-purple-600 border-purple-600 text-white"
                            : "bg-white border-slate-200 text-slate-500 hover:border-purple-300"
                        )}
                      >
                        {new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                      </button>
                    ))}
                    {masters.testDates.length === 0 && <p className="text-[10px] font-bold text-slate-300 italic">No dates found</p>}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200/50">
                <p className="text-[10px] font-bold text-slate-400 italic italic">
                  * Multi-select enabled. Filtering currently applied to summary stats.
                </p>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setFilters({ centerIds: [], batchIds: [], testDates: [] })}
                  className="text-slate-400 hover:text-rose-500 font-bold h-8 px-3 rounded-lg"
                >
                  <X size={14} className="mr-1" />
                  Clear All Filters
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Enrolled Students', value: stats.students, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50', trend: loading ? 'Refreshing...' : '+12% this month' },
          { label: 'Tests Conducted', value: stats.tests, icon: BookOpen, color: 'text-purple-600', bg: 'bg-purple-50', trend: loading ? '...' : `${stats.tests} available` },
          { label: 'Avg. Accuracy', value: stats.totalResults > 0 ? `${stats.avgAccuracy}%` : '0%', icon: Target, color: 'text-emerald-600', bg: 'bg-emerald-50', trend: stats.totalResults > 0 ? 'Filtered Data' : 'Awaiting Data' },
          { label: 'Total Programs', value: stats.activePrograms, icon: Trophy, color: 'text-orange-600', bg: 'bg-orange-50', trend: 'Global Config' },
        ].map((item, idx) => (
          <Card key={idx} className="p-6 border-slate-100/60 hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 group">
            <div className="flex items-start justify-between mb-4">
              <div className={cn("p-3 rounded-xl transition-transform group-hover:scale-110 duration-300", item.bg)}>
                <item.icon className={item.color} size={22} />
              </div>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">{item.trend}</span>
            </div>
            <p className="text-2xl font-black text-slate-900 tracking-tight">{item.value}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{item.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Quick Actions Console */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-blue-600">
               <LayoutDashboard size={20} />
               <h2 className="text-xl font-black text-slate-900 tracking-tight underline decoration-blue-100 decoration-4 underline-offset-4">Console</h2>
            </div>
            <button className="text-xs font-bold text-blue-600 hover:underline">Support Hub</button>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {quickActions.map((action, idx) => (
              <NavLink key={idx} to={action.path}>
                <Card className="p-5 border-slate-100 hover:border-blue-400 hover:bg-blue-50/20 transition-all group flex items-center gap-4">
                  <div className={cn("p-3 rounded-xl shadow-sm border border-slate-50 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300", action.color.split(' ')[0], "bg-white")}>
                    <action.icon size={20} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 leading-none mb-1">{action.label}</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Access Module</p>
                  </div>
                  <ChevronRight size={14} className="ml-auto text-slate-200 group-hover:text-blue-600 transition-colors" />
                </Card>
              </NavLink>
            ))}
          </div>
        </div>

        {/* Recent Activity Feed */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
             <Clock className="text-slate-400" size={20} />
             <h2 className="text-xl font-black text-slate-900 tracking-tight">Live Activity</h2>
          </div>
          
          <Card className="p-6 border-slate-100 flex flex-col gap-6 bg-white/50 backdrop-blur-sm">
            {recentTests.length > 0 ? recentTests.map((t, idx) => (
              <div key={idx} className="flex gap-4 relative group">
                {idx !== recentTests.length - 1 && (
                  <div className="absolute left-4 top-8 bottom-[-24px] w-0.5 bg-slate-50 group-hover:bg-blue-100 transition-colors" />
                )}
                <div className="w-8 h-8 rounded-lg bg-white border border-slate-100 shadow-sm flex items-center justify-center shrink-0 z-10 transition-transform group-hover:rotate-12">
                   <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate leading-none mb-1.5">{t.testName || t.name}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight flex items-center gap-2">
                    <BookOpen size={10} />
                    {new Date(t.createdAt?.seconds * 1000).toLocaleDateString()}
                  </p>
                </div>
              </div>
            )) : (
              <div className="py-10 text-center">
                <Clock className="mx-auto text-slate-200 mb-3" size={32} />
                <p className="text-xs font-bold text-slate-300 uppercase tracking-widest">Awaiting Logs...</p>
              </div>
            )}
            <Button variant="outline" size="sm" className="w-full mt-2 border-slate-100 text-slate-500 font-bold hover:bg-slate-50">
              Audit Logs
              <ChevronRight size={14} className="ml-1" />
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

