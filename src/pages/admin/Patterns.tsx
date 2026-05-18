import React, { useState, useEffect } from 'react';
import { Card, Button, Input, Select, Badge, Loader } from '../../components/UI';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, getDocs, addDoc, updateDoc, doc, deleteDoc, query, where, Timestamp } from 'firebase/firestore';
import { Plus, Pencil, Trash2, ChevronLeft, Save, Layout, Settings, Trophy, Target, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';

export default function Patterns() {
  const [loading, setLoading] = useState(false);
  const [patterns, setPatterns] = useState<any[]>([]);
  const [view, setView] = useState<'list' | 'create'>('list');
  const [formData, setFormData] = useState({
    name: '',
    totalQuestions: 75,
    markingScheme: {
      positive: 4,
      negative: -1,
      partial: false
    }
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    fetchPatterns();
  }, []);

  const fetchPatterns = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'testPatterns'));
      setPatterns(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'testPatterns');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name) return toast.error('Name is required');
    setLoading(true);
    try {
      const payload = {
        ...formData,
        updatedAt: Timestamp.now()
      };

      if (editingId) {
        await updateDoc(doc(db, 'testPatterns', editingId), payload);
        toast.success('Pattern updated');
      } else {
        await addDoc(collection(db, 'testPatterns'), {
          ...payload,
          createdAt: Timestamp.now()
        });
        toast.success('Pattern created');
      }
      setView('list');
      fetchPatterns();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'testPatterns');
    } finally {
      setLoading(false);
    }
  };

  const setupDefaults = async () => {
    if (patterns.length > 0) {
      if (!confirm('This will add default patterns for JEE Main, NEET and Advanced. Continue?')) return;
    }
    setLoading(true);
    try {
      const defaults = [
        { name: 'JEE_MAIN', totalQuestions: 90, markingScheme: { positive: 4, negative: -1, partial: false } },
        { name: 'NEET', totalQuestions: 200, markingScheme: { positive: 4, negative: -1, partial: false } },
        { name: 'JEE_ADVANCED', totalQuestions: 48, markingScheme: { positive: 4, negative: -2, partial: true } }
      ];

      for (const d of defaults) {
        const exists = patterns.find(p => p.name === d.name);
        if (!exists) {
          await addDoc(collection(db, 'testPatterns'), {
            ...d,
            createdAt: Timestamp.now()
          });
        }
      }
      toast.success('Default patterns initialized');
      fetchPatterns();
    } catch (err) {
      console.error(err);
      toast.error('Failed to setup defaults');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedIds.length} patterns?`)) return;
    setLoading(true);
    try {
      const { writeBatch, doc: fsDoc } = await import('firebase/firestore');
      const batch = writeBatch(db);
      selectedIds.forEach(id => batch.delete(fsDoc(db, 'testPatterns', id)));
      await batch.commit();
      toast.success(`${selectedIds.length} patterns deleted`);
      setSelectedIds([]);
      fetchPatterns();
    } catch (err) {
      console.error(err);
      toast.error('Bulk deletion failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-10">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] pl-0.5">Configuration</p>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">Test Patterns</h1>
          <p className="text-slate-500 font-medium text-sm">Define default scoring and structure for different exam types.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="md" onClick={setupDefaults} className="border-blue-100 text-blue-600 bg-white">
            <Settings size={18} className="mr-2" />
            Setup Defaults
          </Button>
          <Button variant="primary" size="md" onClick={() => {
            setFormData({ name: '', totalQuestions: 75, markingScheme: { positive: 4, negative: -1, partial: false } });
            setEditingId(null);
            setView('create');
          }}>
            <Plus size={18} className="mr-2" />
            Add Pattern
          </Button>
        </div>
      </header>

      {view === 'list' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {patterns.map(p => (
            <Card 
              key={p.id} 
              className={cn(
                "p-8 border-slate-100 hover:shadow-xl hover:shadow-slate-200/50 transition-all group overflow-hidden relative",
                selectedIds.includes(p.id) ? "border-blue-200 bg-blue-50/10 shadow-lg" : ""
              )}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div 
                      className={cn(
                        "w-6 h-6 rounded-lg border-2 flex items-center justify-center cursor-pointer transition-all",
                        selectedIds.includes(p.id) ? "bg-blue-600 border-blue-600" : "border-slate-200 bg-white"
                      )}
                      onClick={(e) => toggleSelect(p.id, e)}
                    >
                      {selectedIds.includes(p.id) && <Plus size={14} className="text-white rotate-45" />}
                    </div>
                    <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                      {p.name.includes('JEE') ? <Target size={24} /> : <Trophy size={24} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => {
                      setFormData({ ...p });
                      setEditingId(p.id);
                      setView('create');
                    }} className="p-2 bg-slate-50 text-slate-400 hover:text-blue-600 rounded-xl transition-colors">
                      <Pencil size={16} />
                    </button>
                    <button onClick={async () => {
                      if (!confirm('Delete this pattern?')) return;
                      await deleteDoc(doc(db, 'testPatterns', p.id));
                      fetchPatterns();
                    }} className="p-2 bg-slate-50 text-slate-400 hover:text-rose-600 rounded-xl transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div>
                  <h4 className="text-xl font-black text-slate-900 tracking-tight">{p.name.replace('_', ' ')}</h4>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{p.totalQuestions} Questions</p>
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div className="bg-emerald-50 p-2 rounded-xl text-center border border-emerald-100/50">
                    <p className="text-[8px] font-black text-emerald-600 uppercase tracking-tighter shadow-none">Positive</p>
                    <p className="text-sm font-black text-emerald-700">+{p.markingScheme.positive}</p>
                  </div>
                  <div className="bg-rose-50 p-2 rounded-xl text-center border border-rose-100/50">
                     <p className="text-[8px] font-black text-rose-600 uppercase tracking-tighter shadow-none">Negative</p>
                     <p className="text-sm font-black text-rose-700">{p.markingScheme.negative}</p>
                  </div>
                  <div className={cn(
                    "p-2 rounded-xl text-center border",
                    p.markingScheme.partial ? "bg-indigo-50 border-indigo-100/50 text-indigo-700" : "bg-slate-50 border-slate-100 text-slate-400"
                  )}>
                     <p className="text-[8px] font-black uppercase tracking-tighter shadow-none">Partial</p>
                     <p className="text-sm font-black">{p.markingScheme.partial ? 'YES' : 'NO'}</p>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="max-w-2xl p-10 mx-auto border-slate-100 shadow-2xl shadow-slate-200/40 rounded-[2.5rem]">
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <button onClick={() => setView('list')} className="p-3 bg-slate-50 text-slate-400 rounded-2xl">
                <ChevronLeft size={24} />
              </button>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">{editingId ? 'Edit pattern' : 'New exam pattern'}</h3>
            </div>

            <div className="space-y-6">
               <div className="space-y-2">
                 <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Pattern Name</label>
                 <Input 
                   placeholder="e.g. JEE_MAIN_MODIFIED" 
                   value={formData.name} 
                   onChange={e => setFormData({...formData, name: e.target.value.toUpperCase()})} 
                 />
               </div>

               <div className="grid grid-cols-2 gap-6">
                 <div className="space-y-2">
                   <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Total Questions</label>
                   <Input 
                     type="number" 
                     value={formData.totalQuestions} 
                     onChange={e => setFormData({...formData, totalQuestions: parseInt(e.target.value) || 0})} 
                   />
                 </div>
                 <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Partial Marking</label>
                    <Select value={formData.markingScheme.partial ? 'yes' : 'no'} onChange={e => setFormData({
                      ...formData,
                      markingScheme: { ...formData.markingScheme, partial: e.target.value === 'yes' }
                    })}>
                      <option value="no">No Partial Marking</option>
                      <option value="yes">Enable Partial Marking</option>
                    </Select>
                 </div>
               </div>

               <div className="grid grid-cols-2 gap-6">
                 <div className="space-y-2">
                   <label className="text-xs font-black text-emerald-600 uppercase tracking-widest ml-1">Positive Score</label>
                   <Input 
                     type="number" 
                     className="border-emerald-100 bg-emerald-50/20 text-emerald-700"
                     value={formData.markingScheme.positive} 
                     onChange={e => setFormData({
                        ...formData,
                        markingScheme: { ...formData.markingScheme, positive: parseFloat(e.target.value) || 0 }
                     })} 
                   />
                 </div>
                 <div className="space-y-2">
                   <label className="text-xs font-black text-rose-600 uppercase tracking-widest ml-1">Negative Score</label>
                   <Input 
                     type="number" 
                     className="border-rose-100 bg-rose-50/20 text-rose-700"
                     value={formData.markingScheme.negative} 
                     onChange={e => setFormData({
                        ...formData,
                        markingScheme: { ...formData.markingScheme, negative: parseFloat(e.target.value) || 0 }
                     })} 
                   />
                 </div>
               </div>

               <Button variant="primary" size="lg" className="w-full py-6 text-lg font-black tracking-widest uppercase shadow-xl shadow-blue-100" onClick={handleSave}>
                 {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : (
                   <>
                     <Save size={20} className="mr-2" />
                     {editingId ? 'Update Configuration' : 'Create Pattern'}
                   </>
                 )}
               </Button>
            </div>
          </div>
        </Card>
      )}

      {selectedIds.length > 0 && (
        <motion.div 
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-8 py-4 rounded-[2rem] shadow-2xl flex items-center gap-8 z-50 border border-white/10 backdrop-blur-xl"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center font-black">
              {selectedIds.length}
            </div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Selected</p>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <button 
            onClick={handleBulkDelete}
            className="flex items-center gap-2 text-rose-400 hover:text-rose-300 transition-colors font-black uppercase tracking-widest text-xs"
          >
            <Trash2 size={18} />
            Bulk Delete
          </button>
          <button 
            onClick={() => setSelectedIds([])}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <Plus size={20} className="rotate-45" />
          </button>
        </motion.div>
      )}
    </div>
  );
}
