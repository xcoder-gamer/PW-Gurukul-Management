import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, getDocs, limit, where, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Card, Badge, Input, Select, Loader } from '../components/UI';
import { motion } from 'framer-motion';
import { History, Search, Filter, Clock, User, Tag, Info, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

export default function Logs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    userEmail: '',
    category: '',
    action: ''
  });

  useEffect(() => {
    fetchLogs();
  }, [filters]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let q = query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(100));
      
      if (filters.category) {
        q = query(collection(db, 'logs'), where('category', '==', filters.category), orderBy('timestamp', 'desc'), limit(100));
      }

      const snap = await getDocs(q);
      let logData = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // Client side filtering for more complex filters if needed
      if (filters.userEmail) {
        logData = logData.filter(l => l.userEmail.toLowerCase().includes(filters.userEmail.toLowerCase()));
      }
      if (filters.action) {
        logData = logData.filter(l => l.action === filters.action);
      }

      setLogs(logData);
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClearAllLogs = async () => {
    if (!window.confirm('CRITICAL: This will PERMANENTLY delete ALL audit logs. This action CANNOT be undone. Are you sure?')) return;
    
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'logs'));
      const chunks = [];
      const CHUNK_SIZE = 450;
      for (let i = 0; i < snap.docs.length; i += CHUNK_SIZE) {
        chunks.push(snap.docs.slice(i, i + CHUNK_SIZE));
      }

      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      toast.success('All logs cleared successfully');
      fetchLogs();
    } catch (err) {
       console.error(err);
       toast.error('Failed to clear logs');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLog = async (logId: string) => {
    if (!window.confirm('Delete this audit log?')) return;
    try {
      await deleteDoc(doc(db, 'logs', logId));
      setLogs(prev => prev.filter(l => l.id !== logId));
      toast.success('Log entry deleted');
    } catch (err) {
       console.error(err);
       toast.error('Failed to delete log');
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em]">System Audit</p>
          <h2 className="text-4xl font-black text-slate-900 tracking-tight">Audit Logs</h2>
          <p className="text-slate-400 font-bold text-sm">Track management activity, edits, and system changes.</p>
        </div>
        <div className="flex items-center gap-3">
           <button 
             onClick={handleClearAllLogs}
             className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-50 text-rose-600 font-black text-xs uppercase tracking-widest hover:bg-rose-100 transition-colors"
           >
              <Trash2 size={16} />
              Clear Audit Trail
           </button>
        </div>
      </header>

      {/* Filters */}
      <Card className="p-4 border-slate-100 shadow-sm bg-slate-50/50">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Performed By</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <Input 
                placeholder="Email address..." 
                className="pl-9 bg-white"
                value={filters.userEmail}
                onChange={e => setFilters({...filters, userEmail: e.target.value})}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Category</label>
            <Select 
              className="bg-white"
              value={filters.category}
              onChange={e => setFilters({...filters, category: e.target.value})}
            >
              <option value="">All Categories</option>
              <option value="TEST">Tests</option>
              <option value="STUDENT">Students</option>
              <option value="BATCH">Batches</option>
              <option value="CENTER">Centers</option>
              <option value="PROGRAM">Programs</option>
              <option value="QBG">QBG Master</option>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Action Type</label>
            <Select 
              className="bg-white"
              value={filters.action}
              onChange={e => setFilters({...filters, action: e.target.value})}
            >
              <option value="">All Actions</option>
              <option value="CREATE">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
              <option value="IMPORT">Import</option>
              <option value="REUPLOAD_KEY">Reupload Key</option>
            </Select>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-20 space-y-4 bg-white rounded-3xl border border-slate-100 shadow-sm">
            <Loader />
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Retrieving audit trails...</p>
          </div>
        ) : logs.length === 0 ? (
          <Card className="p-20 text-center flex flex-col items-center justify-center space-y-4 border-dashed border-2">
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-200">
              <History size={32} />
            </div>
            <div className="space-y-1">
              <p className="font-black text-slate-900">No logs found</p>
              <p className="text-slate-400 text-sm">Either no activity has occurred yet or the filters are too strict.</p>
            </div>
          </Card>
        ) : (
          logs.map((log, index) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              key={log.id}
            >
              <Card className="p-4 border-slate-100 hover:border-blue-100 transition-colors">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex gap-4 items-start">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                      log.action === 'CREATE' ? "bg-green-50 text-green-600" :
                      log.action === 'UPDATE' ? "bg-blue-50 text-blue-600" :
                      log.action === 'DELETE' ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-600"
                    )}>
                      {log.action === 'CREATE' ? <Plus size={18} /> : 
                       log.action === 'UPDATE' ? <Clock size={18} /> : 
                       log.action === 'DELETE' ? <Tag size={18} /> : <Info size={18} />}
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-slate-900 tracking-tight">{log.resourceName}</span>
                        <Badge variant={
                          log.action === 'CREATE' ? 'green' : 
                          log.action === 'UPDATE' ? 'blue' : 
                          log.action === 'DELETE' ? 'red' : 'slate'
                        }>
                          {log.action}
                        </Badge>
                        <Badge variant="blue">{log.category}</Badge>
                      </div>
                      <p className="text-slate-500 text-sm font-medium">{log.details}</p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col md:items-end md:justify-center shrink-0 pl-14 md:pl-0 gap-3">
                    <div className="flex flex-col md:items-end">
                      <div className="flex items-center gap-2 text-slate-600 font-bold text-xs uppercase tracking-tight">
                        <User size={12} />
                        {log.userEmail}
                      </div>
                      <div className="flex items-center gap-2 text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-1">
                        <Clock size={10} />
                        {log.timestamp ? format(log.timestamp.toDate(), 'PPP p') : 'Just now'}
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDeleteLog(log.id)}
                      className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors md:self-end"
                      title="Delete log"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
