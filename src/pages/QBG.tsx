import React, { useState, useEffect } from 'react';
import { Card, Button, Input, Select, Badge, Loader } from '../components/UI';
import { 
  Search, 
  Plus, 
  Upload, 
  Download, 
  Filter, 
  Database, 
  X, 
  Check, 
  FileSpreadsheet,
  Trash2,
  Edit2,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, getDocs, query, where, deleteDoc, doc, Timestamp, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

export default function QBG() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  
  const [qData, setQData] = useState({
    subject: '',
    subjectId: '',
    chapter: '',
    chapterId: '',
    topic: '',
    topicId: '',
    subtopic: '',
    subtopicId: '',
  });

  const [oldData, setOldData] = useState<any>(null);

  useEffect(() => {
    fetchQuestions();
  }, []);

  const fetchQuestions = async () => {
    try {
      const snap = await getDocs(collection(db, 'qbgLibrary'));
      const flatList: any[] = [];
      snap.docs.forEach(docSnap => {
        const docData = docSnap.data();
        const docId = docSnap.id;

        // Hierarchical Format is MANDATORY in this new collection
        if (docData.data && typeof docData.data === 'object') {
          const subjectName = docData.subject;
          const subjectId = docId;
          const data = docData.data;

          Object.entries(data).forEach(([chId, ch]: any) => {
            if (!ch.topics || Object.keys(ch.topics).length === 0) {
               flatList.push({
                 id: `${subjectId}_${chId}`,
                 subject: subjectName, subjectId,
                 chapter: ch.name, chapterId: chId,
                 topic: '—', topicId: '—',
                 subtopic: '—', subtopicId: '—',
                 isHierarchical: true,
                 docId: subjectId
               });
               return;
            }
            Object.entries(ch.topics).forEach(([tId, t]: any) => {
              if (!t.subtopics || Object.keys(t.subtopics).length === 0) {
                flatList.push({
                  id: `${subjectId}_${chId}_${tId}`,
                  subject: subjectName, subjectId,
                  chapter: ch.name, chapterId: chId,
                  topic: t.name, topicId: tId,
                  subtopic: '—', subtopicId: '—',
                  isHierarchical: true,
                  docId: subjectId
                });
                return;
              }
              Object.entries(t.subtopics).forEach(([stId, st]: any) => {
                flatList.push({
                  id: `${subjectId}_${chId}_${tId}_${stId}`,
                  subject: subjectName, subjectId,
                  chapter: ch.name, chapterId: chId,
                  topic: t.name, topicId: tId,
                  subtopic: st.name, subtopicId: stId,
                  isHierarchical: true,
                  docId: subjectId
                });
              });
            });
          });
        }
      });
      setQuestions(flatList);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'qbgLibrary');
    } finally {
      setLoading(false);
    }
  };

  const handleAddQuestion = async () => {
    try {
      const { setDoc, doc: fsDoc, getDoc } = await import('firebase/firestore');
      
      // If we are editing, and the document ID (subjectId) changed, we might need more complex logic.
      // For now, assume subjectId is the document key.
      
      if (editingId && oldData) {
        // If it's a hierarchical edit, we need to remove the old path first if any IDs changed
        // But for simplicity, let's assume we are updating the existing subject document
        const subjectRef = fsDoc(db, 'qbgLibrary', qData.subjectId);
        const subjectSnap = await getDoc(subjectRef);
        
        let subjectDocData = subjectSnap.exists() ? subjectSnap.data() : { 
          subject: qData.subject, 
          subjectId: qData.subjectId, 
          data: {} 
        };

        const data = { ...(subjectDocData.data || {}) };

        // If something changed in the hierarchy, we should ideally clean up old branches.
        // However, QBG hierarchical structure here is: doc(subjectId) -> data -> chapterId -> topics -> topicId -> subtopics -> subtopicId
        
        // Remove old if different
        if (oldData.subjectId === qData.subjectId) {
           if (oldData.chapterId !== qData.chapterId) {
             delete data[oldData.chapterId];
           } else if (oldData.topicId !== qData.topicId) {
             delete data[oldData.chapterId].topics[oldData.topicId];
           } else if (oldData.subtopicId !== qData.subtopicId && oldData.subtopicId !== '—') {
             delete data[oldData.chapterId].topics[oldData.topicId].subtopics[oldData.subtopicId];
           }
        }

        if (!data[qData.chapterId]) data[qData.chapterId] = { name: qData.chapter, topics: {} };
        if (!data[qData.chapterId].topics[qData.topicId]) data[qData.chapterId].topics[qData.topicId] = { name: qData.topic, subtopics: {} };
        if (qData.subtopicId && qData.subtopicId !== '—') {
          if (!data[qData.chapterId].topics[qData.topicId].subtopics) data[qData.chapterId].topics[qData.topicId].subtopics = {};
          data[qData.chapterId].topics[qData.topicId].subtopics[qData.subtopicId] = { name: qData.subtopic };
        }

        await setDoc(subjectRef, { ...subjectDocData, data, updatedAt: Timestamp.now() });
        toast.success('Question updated successfully');
      } else {
        const subjectRef = fsDoc(db, 'qbgLibrary', qData.subjectId);
        const subjectSnap = await getDoc(subjectRef);
        
        let subjectDocData = subjectSnap.exists() ? subjectSnap.data() : { 
          subject: qData.subject, 
          subjectId: qData.subjectId, 
          data: {} 
        };

        const newData = { ...(subjectDocData.data || {}) };
        if (!newData[qData.chapterId]) newData[qData.chapterId] = { name: qData.chapter, topics: {} };
        if (!newData[qData.chapterId].topics[qData.topicId]) newData[qData.chapterId].topics[qData.topicId] = { name: qData.topic, subtopics: {} };
        if (qData.subtopicId && qData.subtopicId !== '—') {
          if (!newData[qData.chapterId].topics[qData.topicId].subtopics) newData[qData.chapterId].topics[qData.topicId].subtopics = {};
          newData[qData.chapterId].topics[qData.topicId].subtopics[qData.subtopicId] = { name: qData.subtopic };
        }

        await setDoc(subjectRef, { ...subjectDocData, data: newData, updatedAt: Timestamp.now() });
        toast.success('Question added successfully');
      }
      
      setIsModalOpen(false);
      setEditingId(null);
      setOldData(null);
      fetchQuestions();
    } catch (err) {
      toast.error('Operation failed');
      handleFirestoreError(err, OperationType.WRITE, 'qbgLibrary');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // Group by subject to perform minimal writes
        const subjectsMap: Record<string, any> = {};
        jsonData.forEach((row: any) => {
          const sId = String(row.subjectId || row['Subject Id'] || '');
          if (!sId) return;
          
          if (!subjectsMap[sId]) {
            subjectsMap[sId] = {
              subject: String(row.subject || row.Subject || ''),
              subjectId: sId,
              data: {}
            };
          }

          const chId = String(row.chapterId || row['Chapter Id'] || '');
          const tId = String(row.topicId || row['Topic Id'] || '');
          const stId = String(row.subtopicId || row['Subtopic Id'] || '');

          if (chId) {
            if (!subjectsMap[sId].data[chId]) subjectsMap[sId].data[chId] = { name: String(row.chapter || row.Chapter || ''), topics: {} };
            if (tId) {
              if (!subjectsMap[sId].data[chId].topics[tId]) subjectsMap[sId].data[chId].topics[tId] = { name: String(row.topic || row.Topic || ''), subtopics: {} };
              if (stId) {
                if (!subjectsMap[sId].data[chId].topics[tId].subtopics) subjectsMap[sId].data[chId].topics[tId].subtopics = {};
                subjectsMap[sId].data[chId].topics[tId].subtopics[stId] = { name: String(row.subtopic || row.Subtopic || '') };
              }
            }
          }
        });

        const { setDoc, doc: fsDoc } = await import('firebase/firestore');
        const batchPromises = Object.entries(subjectsMap).map(([sId, sData]) => 
          setDoc(fsDoc(db, 'qbgLibrary', sId), { ...sData, updatedAt: Timestamp.now() }, { merge: true })
        );

        await Promise.all(batchPromises);
        toast.success(`Import complete! Heavily mapped ${jsonData.length} records.`);
        fetchQuestions();
      } catch (err) {
        toast.error('Import failed. Please check file format.');
        handleFirestoreError(err, OperationType.WRITE, 'qbgLibrary_bulk');
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadTemplate = () => {
    const template = [
      { 
        Subject: 'Physics', 
        'Subject Id': 'SUB01', 
        Chapter: 'Unit & Dimension', 
        'Chapter Id': 'CH01', 
        Topic: 'Significant Figures', 
        'Topic Id': 'T01', 
        Subtopic: 'Measurement', 
        'Subtopic Id': 'ST01',
      }
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "QBG_Master");
    XLSX.writeFile(wb, "QBG_Import_Template.xlsx");
  };

  const filteredQuestions = questions.filter(q => 
    (q.subject || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (q.chapter || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (q.topic || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (q.subtopic || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-10 space-y-10 relative">
      {isImporting && <Loader fullScreen label="Importing Bulk Data..." />}
      
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] pl-0.5">Database</p>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">QBG Master</h1>
          <p className="text-slate-500 font-medium text-sm">
            Question Bank & ID Management system for accurate test evaluation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button 
            variant="outline" 
            size="md" 
            className="border-red-100 text-red-500 hover:bg-red-50"
            onClick={async () => {
              if (confirm('CRITICAL: This will delete ALL mapping records in the new Library. Are you sure?')) {
                setLoading(true);
                try {
                  const snap = await getDocs(collection(db, 'qbgLibrary'));
                  const deletePromises = snap.docs.map(d => deleteDoc(doc(db, 'qbgLibrary', d.id)));
                  await Promise.all(deletePromises);
                  toast.success('Library cleared successfully');
                  fetchQuestions();
                } catch (err) {
                  toast.error('Failed to clear library');
                  handleFirestoreError(err, OperationType.WRITE, 'qbgClearAll');
                } finally {
                  setLoading(false);
                }
              }
            }}
          >
            <Trash2 size={18} className="mr-2" />
            Clear
          </Button>
          <Button variant="outline" size="md" onClick={downloadTemplate} className="border-slate-200">
            <Download className="mr-2 text-blue-600" size={18} />
            Template
          </Button>
          <div className="relative">
            <input 
              type="file" 
              accept=".xlsx,.xls,.csv" 
              className="absolute inset-0 opacity-0 cursor-pointer z-10" 
              onChange={handleImport}
              disabled={isImporting}
            />
            <Button variant="secondary" size="md" className="bg-white border border-slate-100" disabled={isImporting}>
              <Upload className="mr-2 text-indigo-600" size={18} />
              {isImporting ? 'Processing...' : 'Push Bulk Data'}
            </Button>
          </div>
          <Button variant="primary" size="md" onClick={() => setIsModalOpen(true)} className="bg-blue-600 shadow-lg shadow-blue-100 px-6">
            <Plus className="mr-2" size={18} strokeWidth={3} />
            New Question
          </Button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 relative">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <Input 
            placeholder="Search by Q-ID, Subject, Chapter or Topic..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-14 py-8 rounded-2xl text-lg font-bold border-slate-100 focus:border-blue-400 transition-all bg-white shadow-sm"
          />
        </div>
        <Card className="flex items-center gap-4 px-8 py-2 border-slate-100 bg-white shadow-sm whitespace-nowrap">
          <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
             <Database size={18} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-tight">Total Records</p>
            <p className="text-xl font-black text-slate-900 leading-tight">{questions.length}</p>
          </div>
        </Card>
      </div>

      {/* List - Tabular Format */}
      <Card className="border-slate-100 bg-white shadow-sm overflow-hidden rounded-[2.5rem]">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead className="bg-slate-50/50">
              <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <th className="px-6 py-5">Subject (ID)</th>
                <th className="px-6 py-5">Chapter (ID)</th>
                <th className="px-6 py-5">Topic (ID)</th>
                <th className="px-6 py-5">Subtopic (ID)</th>
                <th className="px-6 py-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-6 py-8"><div className="h-4 bg-slate-100 rounded w-full" /></td>
                  </tr>
                ))
              ) : filteredQuestions.map(q => (
                <tr key={q.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-black text-slate-900 leading-tight">{q.subject}</span>
                      <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">{q.subjectId}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-black text-slate-900 leading-tight">{q.chapter}</span>
                      <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">{q.chapterId}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-black text-slate-900 leading-tight">{q.topic}</span>
                      <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">{q.topicId}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-black text-slate-900 leading-tight">{q.subtopic || '—'}</span>
                      <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">{q.subtopicId || '—'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-right flex items-center justify-end gap-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="hover:bg-blue-50 hover:text-blue-600 rounded-xl"
                      onClick={() => {
                        setEditingId(q.id);
                        setOldData(q);
                        setQData({
                          subject: q.subject,
                          subjectId: q.subjectId,
                          chapter: q.chapter,
                          chapterId: q.chapterId,
                          topic: q.topic,
                          topicId: q.topicId,
                          subtopic: q.subtopic === '—' ? '' : q.subtopic,
                          subtopicId: q.subtopicId === '—' ? '' : q.subtopicId,
                        });
                        setIsModalOpen(true);
                      }}
                    >
                      <Edit2 size={16} />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="hover:bg-red-50 hover:text-red-500 rounded-xl"
                      onClick={async () => {
                        if(confirm('Delete this record?')) {
                          try {
                            const { getDoc, setDoc, deleteDoc: fsDelete, doc: fsDoc } = await import('firebase/firestore');
                            
                            if (q.isHierarchical) {
                              const subjectRef = fsDoc(db, 'qbgLibrary', q.docId);
                              const subjectSnap = await getDoc(subjectRef);
                              if (subjectSnap.exists()) {
                                const sData = subjectSnap.data();
                                const data = { ...sData.data };
                                
                                if (q.subtopicId !== '—' && data[q.chapterId]?.topics[q.topicId]?.subtopics) {
                                  delete data[q.chapterId].topics[q.topicId].subtopics[q.subtopicId];
                                } else if (q.topicId !== '—' && data[q.chapterId]?.topics) {
                                  delete data[q.chapterId].topics[q.topicId];
                                } else if (data[q.chapterId]) {
                                  delete data[q.chapterId];
                                }
                                
                                await setDoc(subjectRef, { ...sData, data }, { merge: true });
                              }
                            } else {
                              // Fallback for any stray flat records
                              await fsDelete(fsDoc(db, 'qbgLibrary', q.docId));
                            }
                            toast.success('Mapping deleted');
                            fetchQuestions();
                          } catch (err) {
                            toast.error('Delete failed');
                            handleFirestoreError(err, OperationType.WRITE, 'qbgDelete');
                          }
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[3rem] w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 flex items-center justify-between border-b border-slate-50 shrink-0">
                <h2 className="text-3xl font-black text-slate-900">{editingId ? 'Edit' : 'Add'} Question Master</h2>
                <button onClick={() => { setIsModalOpen(false); setEditingId(null); }} className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="p-8 overflow-y-auto flex-1 space-y-6">
                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subject Name</label>
                    <Input placeholder="Subject Name" value={qData.subject} onChange={e => setQData({...qData, subject: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subject ID</label>
                    <Input placeholder="SUB-001" value={qData.subjectId} onChange={e => setQData({...qData, subjectId: e.target.value})} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Chapter Name</label>
                    <Input placeholder="Chapter Name" value={qData.chapter} onChange={e => setQData({...qData, chapter: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Chapter ID</label>
                    <Input placeholder="CH-001" value={qData.chapterId} onChange={e => setQData({...qData, chapterId: e.target.value})} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Topic Name</label>
                    <Input placeholder="Topic Name" value={qData.topic} onChange={e => setQData({...qData, topic: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Topic ID</label>
                    <Input placeholder="T-001" value={qData.topicId} onChange={e => setQData({...qData, topicId: e.target.value})} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subtopic Name</label>
                    <Input placeholder="Subtopic Name" value={qData.subtopic} onChange={e => setQData({...qData, subtopic: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subtopic ID</label>
                    <Input placeholder="ST-001" value={qData.subtopicId} onChange={e => setQData({...qData, subtopicId: e.target.value})} />
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-slate-50 bg-slate-50/30 flex items-center gap-4 shrink-0">
                <Button variant="secondary" size="lg" className="flex-1" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                <Button variant="primary" size="lg" className="flex-[2] bg-blue-600 shadow-lg shadow-blue-100" onClick={handleAddQuestion}>Save Data to Master</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
