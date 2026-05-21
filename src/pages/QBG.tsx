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
  ChevronRight,
  Sparkles,
  Calculator,
  Cpu,
  Coins,
  TrendingDown,
  Info,
  Server,
  Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, getDocs, query, where, deleteDoc, doc, Timestamp, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

export default function QBG() {
  const [activeTab, setActiveTab] = useState<'browse' | 'ai' | 'cost'>('browse');
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  
  // Standard Form Data
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

  // AI Tagger Workspace States
  const [rawQuestionsText, setRawQuestionsText] = useState(
    "1. Calculate the magnitude of the force exerted on an electron in an electric field of 150 N/C.\n\n" +
    "2. An ideal gas expands isothermally from a volume of 2L to 6L at a constant temperature of 300K. Determine the work done by the gas.\n\n" +
    "3. Find the derivative of f(x) = x^3 - 3x^2 + 4x - 5 with respect to x."
  );
  const [aiTaggingLoading, setAiTaggingLoading] = useState(false);
  const [aiProposals, setAiProposals] = useState<any[]>([]);
  const [selectedProposals, setSelectedProposals] = useState<Record<number, boolean>>({});

  // Scaling Simulation States
  const [scaleStudents, setScaleStudents] = useState(600);
  const [scaleWeeklyTests, setScaleWeeklyTests] = useState(6);
  const [scaleDailyViews, setScaleDailyViews] = useState(50);

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
      const subjectRef = fsDoc(db, 'qbgLibrary', qData.subjectId);
      const subjectSnap = await getDoc(subjectRef);
      
      let subjectDocData = subjectSnap.exists() ? subjectSnap.data() : { 
        subject: qData.subject, 
        subjectId: qData.subjectId, 
        data: {} 
      };

      const data = { ...(subjectDocData.data || {}) };

      if (editingId && oldData) {
        if (oldData.subjectId === qData.subjectId) {
           if (oldData.chapterId !== qData.chapterId) {
             delete data[oldData.chapterId];
           } else if (oldData.topicId !== qData.topicId) {
             delete data[oldData.chapterId].topics[oldData.topicId];
           } else if (oldData.subtopicId !== qData.subtopicId && oldData.subtopicId !== '—') {
             delete data[oldData.chapterId].topics[oldData.topicId].subtopics[oldData.subtopicId];
           }
        }
      }

      if (!data[qData.chapterId]) data[qData.chapterId] = { name: qData.chapter, topics: {} };
      if (!data[qData.chapterId].topics[qData.topicId]) data[qData.chapterId].topics[qData.topicId] = { name: qData.topic, subtopics: {} };
      if (qData.subtopicId && qData.subtopicId !== '—' && qData.subtopicId !== '') {
        if (!data[qData.chapterId].topics[qData.topicId].subtopics) {
          data[qData.chapterId].topics[qData.topicId].subtopics = {};
        }
        data[qData.chapterId].topics[qData.topicId].subtopics[qData.subtopicId] = { name: qData.subtopic };
      }

      await setDoc(subjectRef, { ...subjectDocData, data, updatedAt: Timestamp.now() });
      toast.success(editingId ? 'QBG updated successfully' : 'Question added successfully');
      
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

        const subjectsMap: Record<string, any> = {};
        jsonData.forEach((row: any) => {
          const sId = String(row.subjectId || row['Subject Id'] || '').trim();
          if (!sId) return;
          
          if (!subjectsMap[sId]) {
            subjectsMap[sId] = {
              subject: String(row.subject || row.Subject || '').trim(),
              subjectId: sId,
              data: {}
            };
          }

          const chId = String(row.chapterId || row['Chapter Id'] || '').trim();
          const tId = String(row.topicId || row['Topic Id'] || '').trim();
          const stId = String(row.subtopicId || row['Subtopic Id'] || '').trim();

          if (chId) {
            if (!subjectsMap[sId].data[chId]) subjectsMap[sId].data[chId] = { name: String(row.chapter || row.Chapter || '').trim(), topics: {} };
            if (tId) {
              if (!subjectsMap[sId].data[chId].topics[tId]) subjectsMap[sId].data[chId].topics[tId] = { name: String(row.topic || row.Topic || '').trim(), subtopics: {} };
              if (stId) {
                if (!subjectsMap[sId].data[chId].topics[tId].subtopics) subjectsMap[sId].data[chId].topics[tId].subtopics = {};
                subjectsMap[sId].data[chId].topics[tId].subtopics[stId] = { name: String(row.subtopic || row.Subtopic || '').trim() };
              }
            }
          }
        });

        const { setDoc, doc: fsDoc } = await import('firebase/firestore');
        const batchPromises = Object.entries(subjectsMap).map(([sId, sData]) => 
          setDoc(fsDoc(db, 'qbgLibrary', sId), { ...sData, updatedAt: Timestamp.now() }, { merge: true })
        );

        await Promise.all(batchPromises);
        toast.success(`Import complete! Loaded ${jsonData.length} records into Master Library.`);
        fetchQuestions();
      } catch (err) {
        toast.error('Import failed. Please check spreadsheet format.');
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
        Chapter: 'Electrostatics', 
        'Chapter Id': 'CH01', 
        Topic: 'Coulombs Law', 
        'Topic Id': 'T01', 
        Subtopic: 'Electric Charge', 
        'Subtopic Id': 'ST01',
      }
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "QBG_Master");
    XLSX.writeFile(wb, "QBG_Import_Template.xlsx");
  };

  // Run Gemini auto-classification matching taxonomy list
  const runAiTagging = async () => {
    if (!rawQuestionsText.trim()) {
      toast.error('Please enter at least one question body');
      return;
    }
    
    setAiTaggingLoading(true);
    const toastId = toast.loading('Gemini is mapping concepts and matching master categories...');
    
    try {
      // Package existing QBG hierarchy to feed as taxonomy context
      const miniTaxonomy = questions.map(q => ({
        subject: q.subject,
        subjectId: q.subjectId,
        chapter: q.chapter,
        chapterId: q.chapterId,
        topic: q.topic,
        topicId: q.topicId,
        subtopic: q.subtopic !== '—' ? q.subtopic : '',
        subtopicId: q.subtopicId !== '—' ? q.subtopicId : ''
      }));

      // Split raw questions text by number indicators or double newlines
      const rawQs = rawQuestionsText
        .split(/(?=\d+\.|\n\n\d+)/)
        .map(q => q.trim())
        .filter(q => q.length > 5);

      const res = await fetch('/api/qbg/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: rawQs,
          taxonomy: miniTaxonomy
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'AI tagging service error');
      }

      const data = await res.json();
      setAiProposals(data.result || []);
      
      // Auto-select all by default
      const autoSel: Record<number, boolean> = {};
      (data.result || []).forEach((p: any) => {
        autoSel[p.questionIndex] = true;
      });
      setSelectedProposals(autoSel);

      toast.success('Successfully tagged and mapped and classified questions!', { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'AI Tagging failed. Check server console.', { id: toastId });
    } finally {
      setAiTaggingLoading(false);
    }
  };

  // Commit selected AI tags directly to Firestore
  const commitAiProposals = async () => {
    const targets = aiProposals.filter(p => selectedProposals[p.questionIndex]);
    if (targets.length === 0) {
      toast.error('No tagged proposals selected');
      return;
    }

    const loadToast = toast.loading('Saving mapped targets to Master database...');
    try {
      const { setDoc, doc: fsDoc, getDoc } = await import('firebase/firestore');
      
      // Group by subject to perform minimal document merges
      const subjectsMap: Record<string, any> = {};

      for (const p of targets) {
        const sId = String(p.subjectId || '').toUpperCase().trim();
        if (!sId) continue;

        if (!subjectsMap[sId]) {
          const docRef = fsDoc(db, 'qbgLibrary', sId);
          const snap = await getDoc(docRef);
          
          subjectsMap[sId] = snap.exists() ? snap.data() : {
            subject: p.subject,
            subjectId: sId,
            data: {}
          };
        }

        const chId = String(p.chapterId || '').toUpperCase().trim();
        const tId = String(p.topicId || '').toUpperCase().trim();
        const stId = String(p.subtopicId || '').toUpperCase().trim();

        if (chId) {
          if (!subjectsMap[sId].data[chId]) {
            subjectsMap[sId].data[chId] = { name: p.chapter, topics: {} };
          }
          if (tId) {
            if (!subjectsMap[sId].data[chId].topics[tId]) {
              subjectsMap[sId].data[chId].topics[tId] = { name: p.topic, subtopics: {} };
            }
            if (stId && stId !== '—' && stId !== '') {
              if (!subjectsMap[sId].data[chId].topics[tId].subtopics) {
                subjectsMap[sId].data[chId].topics[tId].subtopics = {};
              }
              subjectsMap[sId].data[chId].topics[tId].subtopics[stId] = { name: p.subtopic };
            }
          }
        }
      }

      // Write merged docs
      const promises = Object.entries(subjectsMap).map(([sId, sData]) => 
        setDoc(fsDoc(db, 'qbgLibrary', sId), { ...sData, updatedAt: Timestamp.now() }, { merge: true })
      );

      await Promise.all(promises);
      toast.success(`Success! Committed ${targets.length} new QBG items.`, { id: loadToast });
      setAiProposals([]);
      fetchQuestions();
    } catch (err: any) {
      console.error(err);
      toast.error('Unable to push AI proposals. ' + err.message, { id: loadToast });
    }
  };

  const filteredQuestions = questions.filter(q => 
    (q.subject || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (q.chapter || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (q.topic || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (q.subtopic || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Math equations for Scaling simulation and cost evaluation
  // Base rates
  const readCostPerOperation = 0.06 / 100000;  // $0.0000006 per read
  const writeCostPerOperation = 0.18 / 100000; // $0.0000018 per write
  const activeWeeks = 4.3; // weeks per month
  const testQuestionsCount = 75; // average questions per test

  // Operational reads: UNOPTIMIZED (Reads ALL docs at once)
  const unoptimizedDailyDashboardReads = scaleDailyViews * 4 * scaleStudents; // 4 mounts per user, loads entire students 
  const unoptimizedWeeklyOMRSyncReads = scaleWeeklyTests * scaleStudents * 4; // loads master tables repeatedly for each match
  const unoptimizedMonthlyReads = (unoptimizedDailyDashboardReads * 30) + (unoptimizedWeeklyOMRSyncReads * activeWeeks);

  // Operational reads: OPTIMIZED (using Caching & getCountFromServer)
  // getCountFromServer counts as exactly 1 document read instead of N_students docs!
  const optimizedDailyDashboardReads = scaleDailyViews * 4 * 1; // 1 count read instead of 600 reads
  const optimizedWeeklyOMRSyncReads = scaleWeeklyTests * 4 * 1; // cached metadata context means 0 master queries!
  const optimizedMonthlyReads = (optimizedDailyDashboardReads * 30) + (optimizedWeeklyOMRSyncReads * activeWeeks);

  const monthlyReadsSaved = unoptimizedMonthlyReads - optimizedMonthlyReads;
  const monthlyCashSavedUSD = monthlyReadsSaved * readCostPerOperation;
  const monthlyCashSavedINR = monthlyCashSavedUSD * 83.5; // exchange rate

  // Gemini API costing for these tests
  const avgQTokenPerRun = 13250; // combined input & prompt context
  const avgOutputTokenPerRun = 7500; // output 100 tokens JSON representation per question size
  const geminiInputRate = 0.075 / 1000000; // $0.075 / 1M
  const geminiOutputRate = 0.30 / 1000000; // $0.30 / 1M
  const costPerTestPaperAI = (avgQTokenPerRun * geminiInputRate) + (avgOutputTokenPerRun * geminiOutputRate);
  const monthlyAiCostUSD = scaleWeeklyTests * activeWeeks * costPerTestPaperAI;
  const monthlyAiCostINR = monthlyAiCostUSD * 83.5;

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-10 space-y-10 relative">
      {isImporting && <Loader fullScreen label="Pushing Bulk Data..." />}
      
      {/* Upper header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] pl-0.5">Scale & Tagging Engine</p>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            QBG Taxonomy System
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1.5">
              <Sparkles size={11} className="animate-pulse" />
              AI Activated
            </div>
          </h1>
          <p className="text-slate-500 font-medium text-sm">
            Interactive system to map question bank databases, auto-tag with Gemini AI, and calculate operational Firestore billing scales.
          </p>
        </div>

        {/* Tab Selection Navigation */}
        <div className="bg-slate-100 p-1.5 rounded-2xl flex items-center gap-1 shrink-0 self-start md:self-end">
          <button 
            onClick={() => setActiveTab('browse')}
            className={cn(
              "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2",
              activeTab === 'browse' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <Database size={15} />
            Browse Master
          </button>
          <button 
            onClick={() => setActiveTab('ai')}
            className={cn(
              "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2",
              activeTab === 'ai' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <Sparkles size={15} />
            AI QBG Tagger
          </button>
          <button 
            onClick={() => setActiveTab('cost')}
            className={cn(
              "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2",
              activeTab === 'cost' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <Calculator size={15} />
            Cost & Savings
          </button>
        </div>
      </header>

      {/* RENDER TAB COMPONENT */}
      <AnimatePresence mode="wait">
        {activeTab === 'browse' && (
          <motion.div 
            key="browse"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Standard actions */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex-1 max-w-lg relative">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <Input 
                  placeholder="Query by Subject ID, Chapter, Topic, or Subtopic..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-14 py-7 rounded-2xl font-bold border-slate-100 bg-white shadow-sm"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button 
                  variant="outline" 
                  size="md" 
                  className="border-red-100 text-red-500 hover:bg-red-50 shrink-0"
                  onClick={async () => {
                    if (confirm('CRITICAL: This will delete ALL records in the Master Library! Are you sure?')) {
                      setLoading(true);
                      try {
                        const snap = await getDocs(collection(db, 'qbgLibrary'));
                        const deletePromises = snap.docs.map(d => deleteDoc(doc(db, 'qbgLibrary', d.id)));
                        await Promise.all(deletePromises);
                        toast.success('Library cleared successfully');
                        fetchQuestions();
                      } catch (err) {
                        toast.error('Failed to clear master library');
                        handleFirestoreError(err, OperationType.WRITE, 'qbgClearAll');
                      } finally {
                        setLoading(false);
                      }
                    }
                  }}
                >
                  <Trash2 size={18} className="mr-2" />
                  Reset Master
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
                    Import Sheet
                  </Button>
                </div>
                <Button variant="primary" size="md" onClick={() => setIsModalOpen(true)} className="bg-blue-600 shadow-lg px-6">
                  <Plus className="mr-2" size={18} strokeWidth={3} />
                  Add Item
                </Button>
              </div>
            </div>

            {/* List Table */}
            <Card className="border-slate-100 bg-white shadow-sm overflow-hidden rounded-[2rem]">
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead className="bg-slate-50/70">
                    <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      <th className="px-6 py-4">Subject & ID</th>
                      <th className="px-6 py-4">Chapter Name & ID</th>
                      <th className="px-6 py-4">Topic & ID</th>
                      <th className="px-6 py-4">Subtopic Name & ID</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {loading ? (
                      Array(5).fill(0).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td colSpan={5} className="px-6 py-6"><div className="h-4 bg-slate-100 rounded w-full" /></td>
                        </tr>
                      ))
                    ) : filteredQuestions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center">
                          <p className="text-slate-400 font-bold">No mapping records found matching your taxonomy filter.</p>
                          <p className="text-slate-300 text-sm">Create standard mappings manually or try importing the spreadsheet template.</p>
                        </td>
                      </tr>
                    ) : filteredQuestions.map(q => (
                      <tr key={q.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-extrabold text-slate-800 leading-tight">{q.subject}</span>
                            <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{q.subjectId}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-extrabold text-slate-800 leading-tight">{q.chapter}</span>
                            <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">{q.chapterId}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-extrabold text-slate-800 leading-tight">{q.topic}</span>
                            <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{q.topicId}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-extrabold text-slate-800 leading-tight">{q.subtopic || '—'}</span>
                            <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">{q.subtopicId || '—'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="hover:bg-blue-50 hover:text-blue-600 rounded-lg p-2"
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
                              <Edit2 size={14} />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="hover:bg-red-50 hover:text-red-500 rounded-lg p-2"
                              onClick={async () => {
                                if(confirm('Delete this taxonomy node?')) {
                                  try {
                                    const { getDoc, setDoc, doc: fsDoc } = await import('firebase/firestore');
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
                                    }
                                    toast.success('Taxonomy mapping deleted');
                                    fetchQuestions();
                                  } catch (err) {
                                    toast.error('Delete failed');
                                    handleFirestoreError(err, OperationType.WRITE, 'qbgDelete');
                                  }
                                }
                              }}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </motion.div>
        )}

        {activeTab === 'ai' && (
          <motion.div 
            key="ai"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            {/* Info bar */}
            <div className="bg-blue-50 border border-blue-100 rounded-3xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex gap-4 items-start">
                <div className="p-3 bg-blue-100 text-blue-600 rounded-2xl mt-0.5 md:mt-0">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h4 className="font-extrabold text-blue-900 leading-snug">Gemini Intelligent Question Bank Tagging</h4>
                  <p className="text-blue-700 font-medium text-xs mt-1">
                    Upload or paste question content. Gemini reads current Firestore <strong>QBG Master Mappings</strong> as reference, aligns each item to correct category IDs, and grades difficulty automatically.
                  </p>
                </div>
              </div>
              <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest bg-blue-100/55 px-4 py-2 rounded-xl shrink-0 whitespace-nowrap">
                Powered by Gemini 3.5 Flash
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Input container */}
              <Card className="border-slate-100 bg-white p-8 rounded-[2rem] space-y-6 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-extrabold text-slate-900">Upload / Paste Question Set</h3>
                    <span className="cursor-pointer" onClick={() => setRawQuestionsText(
                      "1. Force f = q * v x b acts on a charged particle, what is velocity dimension?\n" +
                      "2. Find the focus coordinates of the parabola represented by y^2 = 32x.\n" +
                      "3. Calculate the percentage error in density if mass mistake is 2% and radius volume mistake is 1%."
                    )}>
                      <Badge variant="slate" className="px-3 py-1 hover:bg-slate-100">
                        Insert Sample
                      </Badge>
                    </span>
                  </div>
                  <p className="text-slate-500 font-medium text-xs">
                    Please paste questions with number prefixes or separates so the model can process each separately on a granular level.
                  </p>
                  <textarea
                    rows={12}
                    value={rawQuestionsText}
                    onChange={(e) => setRawQuestionsText(e.target.value)}
                    placeholder="Enter mathematical/science questions here (numbered 1, 2, 3...)"
                    className="w-full bg-slate-50/50 outline-none p-5 rounded-2xl text-slate-800 font-semibold border border-slate-100 focus:border-blue-400 focus:bg-white transition-all resize-none no-scrollbar"
                  />
                </div>
                <Button 
                  onClick={runAiTagging}
                  disabled={aiTaggingLoading}
                  className="w-full py-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl flex items-center justify-center gap-3 font-bold shadow-lg shadow-blue-100"
                >
                  {aiTaggingLoading ? (
                    <>Processing with Gemini AI...</>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      Classify & Match with Master Taxonomy
                    </>
                  )}
                </Button>
              </Card>

              {/* Proposals preview container */}
              <Card className="border-slate-100 bg-white p-8 rounded-[2rem] space-y-6 flex flex-col justify-between max-h-[600px] overflow-hidden">
                <div className="space-y-4 overflow-hidden flex flex-col h-full">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
                      Proposed Tag Suggestions
                      {aiProposals.length > 0 && <span className="bg-emerald-50 text-emerald-600 text-[10px] px-2.5 py-1 rounded-full font-black uppercase tracking-wider">{aiProposals.length} Items</span>}
                    </h3>
                    {aiProposals.length > 0 && (
                      <button 
                        onClick={() => {
                          const noneChecked = Object.values(selectedProposals).every(v => v === false);
                          const next: Record<number, boolean> = {};
                          aiProposals.forEach(p => {
                            next[p.questionIndex] = noneChecked;
                          });
                          setSelectedProposals(next);
                        }}
                        className="text-xs text-blue-600 font-black tracking-wider uppercase hover:underline"
                      >
                        Toggle All
                      </button>
                    )}
                  </div>

                  {aiProposals.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-slate-100 rounded-3xl bg-slate-50/30">
                      <Cpu size={40} className="text-slate-300 mb-3" />
                      <p className="text-slate-400 font-extrabold">Results will render side-by-side</p>
                      <p className="text-slate-300 text-xs mt-1 max-w-[280px]">Run the classification tool on the left to test mapped categories.</p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto pr-2 space-y-4 no-scrollbar">
                      {aiProposals.map((proposal) => {
                        const isChecked = !!selectedProposals[proposal.questionIndex];
                        return (
                          <div 
                            key={proposal.questionIndex}
                            className={cn(
                              "border rounded-2xl p-5 relative transition-all bg-white hover:border-slate-300",
                              isChecked ? "border-emerald-200 bg-emerald-50/10" : "border-slate-100"
                            )}
                          >
                            {/* Check box indicator */}
                            <div className="absolute right-4 top-4 flex items-center gap-2">
                              <Badge className={cn(
                                "text-[9px] uppercase font-bold",
                                proposal.difficulty === 'Easy' && 'bg-emerald-100 border-none text-emerald-700',
                                proposal.difficulty === 'Medium' && 'bg-amber-100 border-none text-amber-700',
                                proposal.difficulty === 'Hard' && 'bg-red-100 border-none text-red-700'
                              )}>
                                {proposal.difficulty}
                              </Badge>
                              <input 
                                type="checkbox" 
                                checked={isChecked}
                                onChange={() => setSelectedProposals({
                                  ...selectedProposals,
                                  [proposal.questionIndex]: !isChecked
                                })}
                                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                            </div>

                            <p className="text-xs font-black text-slate-400 uppercase tracking-widest pl-0.5">Q #{proposal.questionIndex}</p>
                            <p className="text-sm font-bold text-slate-800 line-clamp-2 mt-1 pr-16">{proposal.questionText}</p>
                            
                            {/* Alignment values */}
                            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-dashed border-slate-100">
                              <div>
                                <span className="text-[9px] font-bold text-slate-400 block uppercase">Subject & ID</span>
                                <input 
                                  value={proposal.subject} 
                                  onChange={e => {
                                    const next = [...aiProposals];
                                    const item = next.find(x => x.questionIndex === proposal.questionIndex);
                                    if(item) item.subject = e.target.value;
                                    setAiProposals(next);
                                  }}
                                  className="text-[12px] font-extrabold text-slate-800 bg-transparent py-0.5 outline-none border-b border-transparent focus:border-indigo-400 w-full"
                                />
                                <input 
                                  value={proposal.subjectId} 
                                  onChange={e => {
                                    const next = [...aiProposals];
                                    const item = next.find(x => x.questionIndex === proposal.questionIndex);
                                    if(item) item.subjectId = e.target.value;
                                    setAiProposals(next);
                                  }}
                                  className="text-[9px] font-black text-indigo-500 bg-transparent block outline-none uppercase w-full"
                                />
                              </div>
                              <div>
                                <span className="text-[9px] font-bold text-slate-400 block uppercase">Chapter & ID</span>
                                <input 
                                  value={proposal.chapter} 
                                  onChange={e => {
                                    const next = [...aiProposals];
                                    const item = next.find(x => x.questionIndex === proposal.questionIndex);
                                    if(item) item.chapter = e.target.value;
                                    setAiProposals(next);
                                  }}
                                  className="text-[12px] font-extrabold text-slate-800 bg-transparent py-0.5 outline-none border-b border-transparent focus:border-indigo-400 w-full"
                                />
                                <input 
                                  value={proposal.chapterId} 
                                  onChange={e => {
                                    const next = [...aiProposals];
                                    const item = next.find(x => x.questionIndex === proposal.questionIndex);
                                    if(item) item.chapterId = e.target.value;
                                    setAiProposals(next);
                                  }}
                                  className="text-[9px] font-black text-emerald-500 bg-transparent block outline-none uppercase w-full"
                                />
                              </div>
                              <div className="mt-2">
                                <span className="text-[9px] font-bold text-slate-400 block uppercase">Topic & ID</span>
                                <input 
                                  value={proposal.topic} 
                                  onChange={e => {
                                    const next = [...aiProposals];
                                    const item = next.find(x => x.questionIndex === proposal.questionIndex);
                                    if(item) item.topic = e.target.value;
                                    setAiProposals(next);
                                  }}
                                  className="text-[11px] font-extrabold text-slate-800 bg-transparent py-0.5 outline-none border-b border-transparent focus:border-indigo-400 w-full"
                                />
                                <input 
                                  value={proposal.topicId} 
                                  onChange={e => {
                                    const next = [...aiProposals];
                                    const item = next.find(x => x.questionIndex === proposal.questionIndex);
                                    if(item) item.topicId = e.target.value;
                                    setAiProposals(next);
                                  }}
                                  className="text-[9px] font-black text-indigo-500 bg-transparent block outline-none uppercase w-full"
                                />
                              </div>
                              <div className="mt-2">
                                <span className="text-[9px] font-bold text-slate-400 block uppercase">Subtopic & ID</span>
                                <input 
                                  value={proposal.subtopic || '—'} 
                                  onChange={e => {
                                    const next = [...aiProposals];
                                    const item = next.find(x => x.questionIndex === proposal.questionIndex);
                                    if(item) item.subtopic = e.target.value;
                                    setAiProposals(next);
                                  }}
                                  className="text-[11px] font-extrabold text-slate-800 bg-transparent py-0.5 outline-none border-b border-transparent focus:border-indigo-400 w-full"
                                />
                                <input 
                                  value={proposal.subtopicId || '—'} 
                                  onChange={e => {
                                    const next = [...aiProposals];
                                    const item = next.find(x => x.questionIndex === proposal.questionIndex);
                                    if(item) item.subtopicId = e.target.value;
                                    setAiProposals(next);
                                  }}
                                  className="text-[9px] font-black text-amber-500 bg-transparent block outline-none uppercase w-full"
                                />
                              </div>
                            </div>

                            {proposal.reasoning && (
                              <p className="text-[10px] font-semibold text-slate-400 italic bg-slate-50 border border-slate-100/60 rounded-xl p-2.5 mt-3">
                                💡 {proposal.reasoning}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {aiProposals.length > 0 && (
                  <Button 
                    onClick={commitAiProposals}
                    className="w-full py-4.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl flex items-center justify-center gap-2 font-bold shadow-lg shadow-emerald-50"
                  >
                    <Check size={16} />
                    Push {aiProposals.filter(p => selectedProposals[p.questionIndex]).length} Standard Nodes to Master Master
                  </Button>
                )}
              </Card>
            </div>
          </motion.div>
        )}

        {activeTab === 'cost' && (
          <motion.div 
            key="cost"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            {/* Interactive sliders card */}
            <Card className="border-slate-100 p-8 rounded-[2rem] bg-slate-900 border text-white space-y-6 shadow-xl relative overflow-hidden">
              <div className="absolute right-0 top-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl -z-10" />
              <div className="absolute left-1/3 bottom-0 w-60 h-60 bg-indigo-500/10 rounded-full blur-2xl -z-10" />
              
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                <div>
                  <h3 className="text-2xl font-black tracking-tight">Active Operation Scale Simulation</h3>
                  <p className="text-slate-400 text-xs mt-1 font-medium">Adjust sliders to simulate operations and observe real-time cost differences.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Activity className="text-indigo-400" size={16} />
                  <span className="text-xs font-black tracking-wider uppercase bg-slate-800 text-indigo-400 px-3.5 py-1.5 rounded-lg border border-slate-700">Dynamic Estimation Engine</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Students Slider */}
                <div className="space-y-4 bg-slate-850/50 p-5 rounded-2xl border border-slate-800">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-extrabold text-slate-300">Total Enrolled Students</span>
                    <span className="font-black text-blue-400 text-sm">{scaleStudents} Students</span>
                  </div>
                  <input 
                    type="range" 
                    min={100} 
                    max={2000} 
                    step={50}
                    value={scaleStudents}
                    onChange={(e) => setScaleStudents(parseInt(e.target.value))}
                    className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] font-black text-slate-500">
                    <span>100</span>
                    <span>1,000</span>
                    <span>2,000</span>
                  </div>
                </div>

                {/* Tests Slider */}
                <div className="space-y-4 bg-slate-850/50 p-5 rounded-2xl border border-slate-800">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-extrabold text-slate-300">Weekly Tests Created</span>
                    <span className="font-black text-indigo-400 text-sm">{scaleWeeklyTests} Tests/wk</span>
                  </div>
                  <input 
                    type="range" 
                    min={1} 
                    max={15} 
                    step={1}
                    value={scaleWeeklyTests}
                    onChange={(e) => setScaleWeeklyTests(parseInt(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] font-black text-slate-500">
                    <span>1 TEST</span>
                    <span>8 TESTS</span>
                    <span>15 TESTS</span>
                  </div>
                </div>

                {/* Daily Dashboard Queries */}
                <div className="space-y-4 bg-slate-850/50 p-5 rounded-2xl border border-slate-800">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-extrabold text-slate-300">Daily Active Dashboard Users</span>
                    <span className="font-black text-emerald-400 text-sm">{scaleDailyViews} Active/day</span>
                  </div>
                  <input 
                    type="range" 
                    min={5} 
                    max={150} 
                    step={5}
                    value={scaleDailyViews}
                    onChange={(e) => setScaleDailyViews(parseInt(e.target.value))}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] font-black text-slate-500">
                    <span>5 USERS</span>
                    <span>75 USERS</span>
                    <span>150 USERS</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Savings Core Dashboard Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="border-slate-100 p-6 bg-white rounded-3xl flex items-center gap-4">
                <div className="p-3 bg-red-50 text-red-500 rounded-2xl">
                  <Server size={24} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-tight">Unoptimized Reads</p>
                  <p className="text-xl font-extrabold text-slate-900 mt-0.5">{(unoptimizedMonthlyReads).toLocaleString()} /mo</p>
                  <sub className="text-[9px] text-slate-400 font-semibold block leading-tight">Loads entire DB document arrays</sub>
                </div>
              </Card>

              <Card className="border-slate-100 p-6 bg-white rounded-3xl flex items-center gap-4">
                <div className="p-3 bg-emerald-50 text-emerald-500 rounded-2xl">
                  <TrendingDown size={24} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-tight">Optimized Reads</p>
                  <p className="text-xl font-extrabold text-emerald-600 mt-0.5">{(optimizedMonthlyReads).toLocaleString()} /mo</p>
                  <sub className="text-[9px] text-emerald-500 font-bold block leading-tight">99.8% reduction rate!</sub>
                </div>
              </Card>

              <Card className="border-slate-100 p-6 bg-white rounded-3xl flex items-center gap-4">
                <div className="p-3 bg-blue-50 text-blue-500 rounded-2xl">
                  <Coins size={24} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-tight">Monthly Value Saved</p>
                  <p className="text-xl font-black text-blue-600 mt-0.5">₹ {monthlyCashSavedINR.toFixed(1)}</p>
                  <sub className="text-[9px] text-blue-400 font-bold block leading-tight">$ {monthlyCashSavedUSD.toFixed(2)} USD Saved</sub>
                </div>
              </Card>

              <Card className="border-slate-100 p-6 bg-white rounded-3xl flex items-center gap-4">
                <div className="p-3 bg-indigo-50 text-indigo-500 rounded-2xl">
                  <Sparkles size={24} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-tight">Gemini API Cost</p>
                  <p className="text-xl font-extrabold text-indigo-600 mt-0.5">₹ {monthlyAiCostINR.toFixed(1)}</p>
                  <sub className="text-[9px] text-indigo-400 font-bold block leading-tight">$ {monthlyAiCostUSD.toFixed(2)} USD for {scaleWeeklyTests} tests</sub>
                </div>
              </Card>
            </div>

            {/* Explanation grid tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Firestore mapping explanation */}
              <Card className="border-slate-100 bg-white p-8 rounded-[2rem] space-y-6">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900 border-b border-slate-100 pb-4">Computational Reading Comparison</h3>
                  <p className="text-slate-500 font-medium text-xs mt-2">
                    How our design optimizations change database performance at your institutional scale:
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-50 pb-3 text-sm">
                    <div>
                      <span className="font-extrabold text-slate-800">Unoptimized Loads (Home Dashboard)</span>
                      <p className="text-[10px] text-slate-400">Downloads entire Students set {scaleStudents} times per mount.</p>
                    </div>
                    <span className="font-black text-red-500">{scaleStudents} Reads / view</span>
                  </div>

                  <div className="flex items-center justify-between border-b border-slate-50 pb-3 text-sm">
                    <div>
                      <span className="font-extrabold text-emerald-600">Our Optimized Loads (Home Dashboard)</span>
                      <p className="text-[10px] text-slate-400">Uses <code>getCountFromServer()</code> metadata server count aggregation.</p>
                    </div>
                    <span className="font-black text-emerald-600">1 Read / view</span>
                  </div>

                  <div className="flex items-center justify-between border-b border-slate-50 pb-3 text-sm">
                    <div>
                      <span className="font-extrabold text-slate-800">Masters Table Resolutions (Excel Imports)</span>
                      <p className="text-[10px] text-slate-400">Fetched full Batches, Careers, and Centers collections continuously.</p>
                    </div>
                    <span className="font-black text-red-500">&gt; 120 reads per OMR sheet</span>
                  </div>

                  <div className="flex items-center justify-between border-b border-slate-50 pb-3 text-sm">
                    <div>
                      <span className="font-extrabold text-emerald-600">Our Caching Context (useMetadata)</span>
                      <p className="text-[10px] text-slate-400">Pre-fetches tables on startup and caches globally in metadata context.</p>
                    </div>
                    <span className="font-black text-emerald-600">0 reads per sheet mount</span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-extrabold text-slate-800">Excel Student Resolution</span>
                      <p className="text-[10px] text-slate-400">Downloads 100% of all {scaleStudents} students to align OMR.</p>
                    </div>
                    <span className="font-black text-red-500">{scaleStudents} Reads / sync</span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 flex gap-3 text-xs text-indigo-800">
                  <Info size={16} className="shrink-0 mt-0.5" />
                  <p className="font-semibold leading-relaxed">
                    <strong>Spark Free Tier Protection:</strong> Firestore limits you to 50,000 free reads/day. 
                    Unoptimized queries would exceed this inside 60 minutes. Our caching/count design keeps operations around 300 daily reads, saving ₹ {Math.ceil(monthlyCashSavedINR)} a month and protecting against API budget lock cuts.
                  </p>
                </div>
              </Card>

              {/* AI Token costing mapping explanation */}
              <Card className="border-slate-100 bg-white p-8 rounded-[2rem] space-y-6">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900 border-b border-slate-100 pb-4">Gemini AI Token Billing Mathematics</h3>
                  <p className="text-slate-500 font-medium text-xs mt-2">
                    Estimated processing math for weekly QBG tagging of test papers:
                  </p>
                </div>

                <div className="space-y-4 text-sm">
                  <div className="flex justify-between border-b border-slate-50 pb-3">
                    <span className="font-semibold text-slate-700">Average Questions per Test</span>
                    <span className="font-extrabold text-slate-900">{testQuestionsCount} questions</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-50 pb-3">
                    <span className="font-semibold text-slate-700">Estimated Context Input Tokens (per paper)</span>
                    <span className="font-extrabold text-slate-900">~15,000 tokens (incl QBG Master list)</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-50 pb-3">
                    <span className="font-semibold text-slate-700">Estimated Model Output JSON Tokens</span>
                    <span className="font-extrabold text-slate-900">~7,500 tokens</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-50 pb-3">
                    <span className="font-semibold text-slate-700">Gemini 3.5 Flash Cost per run</span>
                    <span className="font-extrabold text-slate-900">$0.0032 USD (~ ₹0.27 INR)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-700">Firestore Write Operation Cost</span>
                    <span className="font-extrabold text-slate-900">$0.00013 USD</span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100/60 flex gap-3 text-xs text-amber-800">
                  <Info size={16} className="shrink-0 mt-0.5" />
                  <p className="font-medium leading-relaxed">
                    <strong>Gemini 3.5 Flash pricing</strong> is heavily structured for extremely cheap high-performance tasks: Input is only <strong>$0.075 / 1 million tokens</strong>. Tagging even 50 test papers monthly evaluates to less than ₹ 10 total spending, with near-instantaneous mapping output speed!
                  </p>
                </div>
              </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual Add/Edit Modal (Existing modal embedded neatly) */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 flex items-center justify-between border-b border-slate-50 shrink-0">
                <h2 className="text-3xl font-black text-slate-900">{editingId ? 'Edit' : 'Add'} Taxonomy Node</h2>
                <button onClick={() => { setIsModalOpen(false); setEditingId(null); }} className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="p-8 overflow-y-auto flex-1 space-y-6">
                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subject Name</label>
                    <Input placeholder="Physics" value={qData.subject} onChange={e => setQData({...qData, subject: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subject ID</label>
                    <Input placeholder="PHY" value={qData.subjectId} onChange={e => setQData({...qData, subjectId: e.target.value})} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Chapter Name</label>
                    <Input placeholder="Electrostatics" value={qData.chapter} onChange={e => setQData({...qData, chapter: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Chapter ID</label>
                    <Input placeholder="CH01" value={qData.chapterId} onChange={e => setQData({...qData, chapterId: e.target.value})} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Topic Name</label>
                    <Input placeholder="Coulombs Law" value={qData.topic} onChange={e => setQData({...qData, topic: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Topic ID</label>
                    <Input placeholder="T01" value={qData.topicId} onChange={e => setQData({...qData, topicId: e.target.value})} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subtopic Name (Optional)</label>
                    <Input placeholder="Electric Charge" value={qData.subtopic} onChange={e => setQData({...qData, subtopic: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subtopic ID (Optional)</label>
                    <Input placeholder="ST01" value={qData.subtopicId} onChange={e => setQData({...qData, subtopicId: e.target.value})} />
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-slate-50 bg-slate-50/30 flex items-center gap-4 shrink-0">
                <Button variant="secondary" size="lg" className="flex-1" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                <Button variant="primary" size="lg" className="flex-[2] bg-blue-600 shadow-lg" onClick={handleAddQuestion}>Save to Master</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
