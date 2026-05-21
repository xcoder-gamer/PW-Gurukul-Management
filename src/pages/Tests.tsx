import React, { useState, useEffect } from 'react';
import { Card, Button, Select, Input, Badge, Loader } from '../components/UI';
import { Check, ChevronRight, ChevronLeft, Upload, FileJson, AlertCircle, Save, X, FileSpreadsheet, Download, Plus, CheckCircle2, Database, Pencil, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, getDocs, addDoc, Timestamp, query, where, deleteDoc, doc, writeBatch, updateDoc, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { addLog, LogAction, LogCategory } from '../lib/logs';
import { useAuth } from '../context/AuthContext';
import { useMetadata } from '../context/MetadataContext';

export default function Tests() {
  const { user, role } = useAuth();
  const isAdmin = role === 'admin' || role === 'operator' || role === 'central_team';
  const navigate = useNavigate();
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
  const [selectedTest, setSelectedTest] = useState<any>(null);
  const [step, setStep] = useState(1);
  const [totalQuestions, setTotalQuestions] = useState(75);
  const [loading, setLoading] = useState(false);
  const { programs, centers, batches, testPatterns: patterns } = useMetadata();
  const [tests, setTests] = useState<any[]>([]);
  const [qbgMaster, setQbgMaster] = useState<any[]>([]);

  const [filters, setFilters] = useState({
    name: '',
    date: '',
    centerId: '',
    batchId: ''
  });
  
  const [formData, setFormData] = useState({
    name: '',
    date: '',
    pattern: '' as 'JEE_MAIN' | 'JEE_ADVANCED' | 'NEET' | '',
    advancedPapers: [] as string[],
    programId: '',
    batchIds: [] as string[],
    totalQuestions: 75,
    answerKey: {} as any,
    paperKeys: {} as Record<string, any>,
    paperMappings: {} as Record<string, any>,
    subQbgMapping: null as any,
    status: 'DRAFT' as 'ACTIVE' | 'DRAFT'
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);

  const [answerKeyFile, setAnswerKeyFile] = useState<string | null>(null);
  const [subQbgFile, setSubQbgFile] = useState<string | null>(null);
  const [paperFiles, setPaperFiles] = useState<Record<string, { answer?: string, mapping?: string }>>({});

  const sortTests = (data: any[]) => {
    return [...data].sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  };

  useEffect(() => {
    const fetchMasters = async () => {
      try {
        const [testSnap, qbgSnap] = await Promise.all([
          getDocs(query(collection(db, 'tests'), limit(150))),
          getDocs(collection(db, 'qbgLibrary'))
        ]);
        setTests(testSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => {
          const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
          const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
          return timeB - timeA;
        }));
        
        // Flatten hierarchical QBG Library
        const qbgList: any[] = [];
        qbgSnap.docs.forEach(docSnap => {
          const sData = docSnap.data();
          const sId = docSnap.id;
          const sName = sData.subject;
          
          qbgList.push({ id: sId, name: sName, type: 'subject', subjectId: sId, subjectName: sName });

          if (sData.data) {
            Object.entries(sData.data).forEach(([chId, ch]: any) => {
              qbgList.push({ 
                id: chId, 
                name: ch.name, 
                type: 'chapter', 
                subjectId: sId, 
                subjectName: sName,
                chapterId: chId,
                chapterName: ch.name
              });
              if (ch.topics) {
                Object.entries(ch.topics).forEach(([tId, t]: any) => {
                  qbgList.push({ 
                    name: t.name, 
                    type: 'topic', 
                    subjectId: sId, 
                    subjectName: sName,
                    chapterId: chId,
                    chapterName: ch.name,
                    topicId: tId,
                    topicName: t.name
                  });
                  if (t.subtopics) {
                    Object.entries(t.subtopics).forEach(([stId, st]: any) => {
                      qbgList.push({ 
                        name: st.name, 
                        type: 'subtopic', 
                        subjectId: sId, 
                        subjectName: sName,
                        chapterId: chId,
                        chapterName: ch.name,
                        topicId: tId,
                        topicName: t.name,
                        subtopicId: stId,
                        subtopicName: st.name
                      });
                    });
                  }
                });
              }
            });
          }
        });
        setQbgMaster(qbgList);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'programs_batches_tests_qbg_library');
      }
    };
    fetchMasters();

    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'create') {
      setStep(1);
    }
  }, []);

  const advancedPapersCount = formData.pattern === 'JEE_ADVANCED' ? formData.advancedPapers.length : 0;
  const totalUploadSteps = formData.pattern === 'JEE_ADVANCED' ? Math.max(1, advancedPapersCount) : 1;
  const totalSteps = totalUploadSteps + 2; // 1 (Setup) + N (Uploads) + 1 (Preview)

  const isLastStep = step === totalSteps;
  const isPreviewStep = step === totalSteps;
  const isUploadStep = step > 1 && step <= totalUploadSteps + 1;

  const nextStep = () => {
    if (step === 1) {
      if (!formData.name || !formData.date || !formData.pattern || !formData.programId || formData.batchIds.length === 0) {
        toast.error('All fields including at least one batch are required');
        return;
      }
      if (formData.pattern === 'JEE_ADVANCED' && formData.advancedPapers.length === 0) {
        toast.error('Please select at least one Advanced paper');
        return;
      }
    }
    
    // Check key for the current upload step
    if (step > 1 && step <= totalUploadSteps + 1) {
      const currentPaperIndex = step - 2;
      const currentPaper = formData.pattern === 'JEE_ADVANCED' ? formData.advancedPapers[currentPaperIndex] : 'DEFAULT';
      const currentKey = formData.pattern === 'JEE_ADVANCED' ? (formData.paperKeys?.[currentPaper] || {}) : formData.answerKey;
      
      if (Object.keys(currentKey).length === 0) {
        toast.error(`Please upload answer key ${formData.pattern === 'JEE_ADVANCED' ? `for ${currentPaper} ` : ''}to proceed`);
        return;
      }
    }

    setStep(s => Math.min(s + 1, totalSteps));
  };

  const prevStep = () => setStep(s => Math.max(s - 1, 1));

  const toggleBatch = (batchId: string) => {
    setFormData(prev => ({
      ...prev,
      batchIds: prev.batchIds.includes(batchId)
        ? prev.batchIds.filter(id => id !== batchId)
        : [...prev.batchIds, batchId]
    }));
  };

  const handleAnswerKeyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const currentPaperIndex = step - 2;
    const currentPaper = formData.pattern === 'JEE_ADVANCED' ? formData.advancedPapers[currentPaperIndex] : null;

    if (currentPaper) {
      setPaperFiles(prev => ({
        ...prev,
        [currentPaper]: { ...prev[currentPaper], answer: file.name }
      }));
    } else {
      setAnswerKeyFile(file.name);
    }

    const reader = new FileReader();

    if (file.name.endsWith('.json')) {
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          if (currentPaper) {
            setFormData({ 
              ...formData, 
              paperKeys: { ...formData.paperKeys, [currentPaper]: json } 
            });
          } else {
            setFormData({ ...formData, answerKey: json });
          }
          toast.success('JSON Key uploaded');
        } catch (err) {
          toast.error('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')) {
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawData = XLSX.utils.sheet_to_json(worksheet);
          
          const key: any = {};
          let maxQ = 0;
          rawData.forEach((row: any) => {
            const qNumRaw = row.Question || row.No || row.qNo || row.id || row.number || row.qIdx || row.qno || row.QNo || '';
            const normalizedQNum = String(qNumRaw).trim().replace(/[^\d]/g, '');
            if (!normalizedQNum) return;

            const qInt = parseInt(normalizedQNum);
            const qStr = String(qInt);
            
            let ansRaw = row.Answer ?? row.Key ?? row.ans ?? row.answer ?? row['Correct Answer'] ?? row['correct answer'] ?? row.correctAns ?? '';
            let ans = String(ansRaw).trim();
            
            // Clean JEE Advanced style answers like (A, C) or (8.89 to 8.90)
            if (ans.startsWith('(') && ans.endsWith(')')) {
              ans = ans.slice(1, -1).trim();
            }

            const subRaw = String(row.subject || row.Subject || '').trim();
            const subL = subRaw.toLowerCase();
            let subNorm = subRaw;
            
            if (subL === 'math' || subL === 'maths' || subL === 'mathematics') subNorm = 'Math';
            else if (subL === 'physics') subNorm = 'Physics';
            else if (subL === 'chemistry') subNorm = 'Chemistry';
            else if (subL === 'botany') subNorm = 'Botany';
            else if (subL === 'zoology') subNorm = 'Zoology';
            else if (subL === 'biology') subNorm = 'Biology';

            if (qStr && (ans !== '' || ansRaw === 0)) {
              if (qInt > maxQ) maxQ = qInt;

              // Handle Range detection
              let isRange = false;
              let rangeMin = 0;
              let rangeMax = 0;
              if (ans.toLowerCase().includes('to')) {
                const parts = ans.toLowerCase().split('to').map(p => parseFloat(p.trim()));
                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                  isRange = true;
                  rangeMin = parts[0];
                  rangeMax = parts[1];
                }
              }

              // Support for new 2025 Template columns
              const type = row.Type || row.type || (isRange || !isNaN(parseFloat(ans)) ? 'Numerical' : (ans.includes(',') ? 'MCQ' : 'SCQ'));
              
              const defaultPos = 4;
              const defaultNeg = (type === 'Numerical' || type === 'Integer') ? ((formData.pattern === 'JEE_MAIN' || formData.pattern === 'NEET') ? -1 : 0) : -1;
              const pos = parseFloat(row.Positive || row.positive || row.Marks || row.marks || row.correct || defaultPos);
              let neg = parseFloat(row.Negative || row.negative || row['Negative Marks'] || row.wrong || defaultNeg);
              
              // STRICT OVERRIDE for Numerical questions in JEE patterns
              if ((type === 'Numerical' || type === 'Integer') && formData.pattern === 'JEE_ADVANCED') {
                neg = 0;
              }

              if ((type === 'Numerical' || type === 'Integer') && (formData.pattern === 'JEE_MAIN' || formData.pattern === 'NEET')) {
                neg = -1;
              }

              const part = parseFloat(row.Partial || row.partial || row['Partial Correct'] || 0);

              // Clean MCQ answers - remove commas and spaces: "A, C" -> "AC"
              const cleanAns = type === 'MCQ' ? ans.replace(/[\s,]/g, '').toUpperCase() : ans;

              key[qStr] = {
                ans: cleanAns,
                isRange,
                rangeMin,
                rangeMax,
                subject: subNorm,
                correct: pos,
                wrong: neg,
                unattempt: parseFloat(row['unattempt'] || row.unattempted || 0),
                partial: part,
                type: type,
                paper: currentPaper || row['Year-Paper'] || row.paper || ''
              };
            }
          });
          
          if (Object.keys(key).length === 0) {
            toast.error('Could not find question/answer columns');
            return;
          }
          
          if (currentPaper) {
            setFormData(prev => ({ 
              ...prev, 
              paperKeys: { ...prev.paperKeys, [currentPaper]: key },
              totalQuestions: maxQ > 0 ? maxQ : prev.totalQuestions
            }));
          } else {
            setFormData(prev => ({ 
              ...prev, 
              answerKey: key,
              totalQuestions: maxQ > 0 ? maxQ : prev.totalQuestions
            }));
          }
          toast.success(`Key processed: ${Object.keys(key).length} questions${currentPaper ? ` for ${currentPaper}` : ''}`);
        } catch (err) {
          console.error(err);
          toast.error('Error reading Excel file');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleSubQbgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const currentPaperIndex = step - 2;
    const currentPaper = formData.pattern === 'JEE_ADVANCED' ? formData.advancedPapers[currentPaperIndex] : null;

    if (currentPaper) {
      setPaperFiles(prev => ({
        ...prev,
        [currentPaper]: { ...prev[currentPaper], mapping: file.name }
      }));
    } else {
      setSubQbgFile(file.name);
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        
        const mapping: Record<string, any> = {};
        let maxQ = 0;
        rows.forEach(r => {
          // Handle Q-1, Q-2 or just 1, 2
          let qIdxRaw = String(r.Question || r.QNo || r.qIdx || r.qn || '');
          const normalizedQIdx = qIdxRaw.replace('Q-', '').replace(/[^\d]/g, '').trim();
          
          if (normalizedQIdx) {
            const qInt = parseInt(normalizedQIdx);
            const qIdx = String(qInt);
            if (qInt > maxQ) maxQ = qInt;
            
            const rawDifficulty = String(r['Difficulty level'] || r.difficulty || '');
            let difficulty = rawDifficulty;
            if (rawDifficulty === '1') difficulty = 'Easy';
            else if (rawDifficulty === '2') difficulty = 'Medium';
            else if (rawDifficulty === '3') difficulty = 'Hard';

            mapping[qIdx] = { 
              subjectId: r['QBG Subject Id'] || r.subjectId || '',
              chapterId: r['QBG Chapter Id'] || r.chapterId || '',
              topicId: r['QBG Topic Id'] || r.topicId || '',
              subtopicId: r['QBG SubTopic Id'] || r.subtopicId || '',
              difficulty: difficulty,
              paper: currentPaper
            };
          }
        });

        if (currentPaper) {
          setFormData(prev => ({ 
            ...prev, 
            paperMappings: { ...prev.paperMappings, [currentPaper]: mapping },
            totalQuestions: maxQ > 0 ? maxQ : prev.totalQuestions
          }));
        } else {
          setFormData(prev => ({ 
            ...prev, 
            subQbgMapping: mapping,
            totalQuestions: maxQ > 0 ? maxQ : prev.totalQuestions
          }));
        }
        toast.success(`Mapping processed: ${Object.keys(mapping).length} links${currentPaper ? ` for ${currentPaper}` : ''}`);
      } catch (err) {
        console.error(err);
        toast.error('Error reading Sub QBG file');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadTemplate = (type: 'answer' | 'qbg') => {
    let data: any[] = [];
    let fileName = '';

    if (type === 'answer') {
      if (formData.pattern === 'JEE_ADVANCED') {
        data = [
          { 'Year-Paper': '2025 - P1', Subject: 'Physics', Question: 'Q1', Type: 'SCQ', Positive: 3, Negative: 1, Partial: 0, Answer: 'A' },
          { 'Year-Paper': '2025 - P1', Subject: 'Physics', Question: 'Q5', Type: 'MCQ', Positive: 4, Negative: 2, Partial: 1, Answer: 'ABC' },
          { 'Year-Paper': '2025 - P1', Subject: 'Physics', Question: 'Q8', Type: 'Numerical', Positive: 4, Negative: 0, Partial: 0, Answer: '12.5' }
        ];
      } else {
        data = [{ Question: 1, Answer: 'A', Subject: 'Physics', 'Type': 'SCQ', 'Positive': 4, 'Negative': -1, unattempt: 0, 'Partial': 0 }];
      }
      fileName = 'AnswerKey_Template.xlsx';
    } else {
      data = [{ 
        Question: 'Q-1', 
        'QBG Subject Id': 'PHY_01', 
        'QBG Chapter Id': 'CH_05', 
        'QBG Topic Id': 'T_10', 
        'QBG SubTopic Id': 'ST_02',
        'Difficulty level': 'Medium' 
      }];
      fileName = 'SubQBG_Mapping_Template.xlsx';
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, fileName);
  };

  const handleCreateTest = async (isDraft: boolean = false) => {
    // Better validation for answer keys
    const hasKey = formData.pattern === 'JEE_ADVANCED' 
      ? Object.keys(formData.paperKeys).length > 0 
      : Object.keys(formData.answerKey).length > 0;

    if (!isDraft && (!formData.name || !formData.date || !formData.programId || !hasKey)) {
      toast.error('Required fields missing (Name, Date, Program, and Answer Key are mandatory)');
      return;
    }
    
    if (isDraft && !formData.name) {
      toast.error('Test Name required for draft');
      return;
    }

    try {
      setLoading(true);
      
      let finalAnswerKey: Record<string, any> = {};
      
      if (formData.pattern === 'JEE_ADVANCED') {
        Object.entries(formData.paperKeys).forEach(([pName, keys]) => {
          const mapping = formData.paperMappings[pName] || {};
          Object.entries(keys).forEach(([qNum, details]: [any, any]) => {
            const mapped = mapping[qNum] || {};
            
            const subjectLookup = qbgMaster.find(q => q.subjectId === mapped.subjectId && q.type === 'subject');
            const chapterLookup = qbgMaster.find(q => q.chapterId === mapped.chapterId && q.subjectId === mapped.subjectId && q.type === 'chapter');
            const topicLookup = qbgMaster.find(q => q.topicId === mapped.topicId && q.chapterId === mapped.chapterId && q.type === 'topic');
            const subtopicLookup = qbgMaster.find(q => q.subtopicId === mapped.subtopicId && q.topicId === mapped.topicId && q.type === 'subtopic');

            const diff = mapped.difficulty || details.difficulty || 'Medium';

            finalAnswerKey[`${pName}-${qNum}`] = {
              ...details,
              subjectId: mapped.subjectId || details.subjectId || '',
              chapterId: mapped.chapterId || details.chapterId || '',
              topicId: mapped.topicId || details.topicId || '',
              subtopicId: mapped.subtopicId || details.subtopicId || '',
              subject: subjectLookup?.name || details.subject || '',
              chapter: chapterLookup?.name || details.chapter || '',
              topic: topicLookup?.name || details.topic || '',
              subtopic: subtopicLookup?.name || details.subtopic || '',
              difficulty: diff,
              paper: pName
            };
          });
        });
      } else {
        finalAnswerKey = { ...formData.answerKey };
        // Clean up any undefined values that break Firestore
        Object.keys(finalAnswerKey).forEach(qNum => {
          if (finalAnswerKey[qNum].paper === undefined) finalAnswerKey[qNum].paper = '';
        });

        if (formData.subQbgMapping && finalAnswerKey) {
          Object.keys(formData.subQbgMapping).forEach(qNum => {
            if (finalAnswerKey[qNum]) {
              const mapped = formData.subQbgMapping[qNum];
              
              // Search in library by IDs to extract names
              const subjectLookup = qbgMaster.find(q => q.subjectId === mapped.subjectId && q.type === 'subject');
              const chapterLookup = qbgMaster.find(q => q.chapterId === mapped.chapterId && q.subjectId === mapped.subjectId && q.type === 'chapter');
              const topicLookup = qbgMaster.find(q => q.topicId === mapped.topicId && q.chapterId === mapped.chapterId && q.type === 'topic');
              const subtopicLookup = qbgMaster.find(q => q.subtopicId === mapped.subtopicId && q.topicId === mapped.topicId && q.type === 'subtopic');

              const mappedDiff = mapped.difficulty || 'Medium';

              const subLookupName = String(subjectLookup?.name || mapped.subject || '').trim();
              const subLower = subLookupName.toLowerCase();
              let normalizedSubName = subLookupName;
              
              if (subLower === 'math' || subLower === 'maths' || subLower === 'mathematics') normalizedSubName = 'Math';
              else if (subLower === 'physics') normalizedSubName = 'Physics';
              else if (subLower === 'chemistry') normalizedSubName = 'Chemistry';
              else if (subLower === 'botany') normalizedSubName = 'Botany';
              else if (subLower === 'zoology') normalizedSubName = 'Zoology';
              else if (subLower === 'biology') normalizedSubName = 'Biology';

              finalAnswerKey[qNum] = {
                ...finalAnswerKey[qNum],
                subjectId: mapped.subjectId || '',
                chapterId: mapped.chapterId || '',
                topicId: mapped.topicId || '',
                subtopicId: mapped.subtopicId || '',
                subject: normalizedSubName,
                chapter: chapterLookup?.name || mapped.chapter || '',
                topic: topicLookup?.name || mapped.topic || '',
                subtopic: subtopicLookup?.name || mapped.subtopic || '',
                difficulty: mappedDiff
              };
            }
          });
        }
      }

      const testMaxScore = finalAnswerKey ? Object.values(finalAnswerKey).reduce((acc: number, q: any) => {
        return acc + (parseFloat(q.correct) || 4);
      }, 0) : 0;

      const nextVersion = editingId ? (tests.find(t => t.id === editingId)?.answerKeyVersion || 1) + 1 : 1;
      const payload = {
        name: formData.name || 'Untitled Test',
        date: formData.date || '',
        pattern: formData.pattern || 'NEET',
        advancedPapers: formData.advancedPapers || [],
        programId: formData.programId || '',
        batchIds: formData.batchIds || [],
        totalQuestions: formData.totalQuestions || 0,
        answerKey: finalAnswerKey,
        paperKeys: formData.paperKeys || {},
        paperMappings: formData.paperMappings || {},
        subQbgMapping: formData.subQbgMapping || null,
        maxScore: testMaxScore,
        isActive: !isDraft,
        status: isDraft ? 'DRAFT' : 'ACTIVE',
        answerKeyVersion: nextVersion,
        updatedAt: Timestamp.now()
      };

      // Sanitize payload to remove undefined values which Firestore rejects
      const sanitize = (obj: any): any => {
        if (obj === null || typeof obj !== 'object' || obj instanceof Timestamp) return obj;
        if (Array.isArray(obj)) return obj.map(v => sanitize(v));
        const newObj: any = {};
        Object.entries(obj).forEach(([k, v]) => {
          if (v !== undefined) newObj[k] = sanitize(v);
        });
        return newObj;
      };
      const sanitizedPayload = sanitize(payload);

      if (editingId) {
        await updateDoc(doc(db, 'tests', editingId), sanitizedPayload);
        
        await addLog({
          userId: user?.uid || 'system',
          userEmail: user?.email || 'unknown',
          action: LogAction.UPDATE,
          category: LogCategory.TEST,
          resourceId: editingId,
          resourceName: formData.name,
          details: `Test updated to version ${nextVersion}. Status: ${payload.status}`,
          newData: { name: payload.name, date: payload.date, status: payload.status, version: nextVersion }
        });
      } else {
        const docRef = await addDoc(collection(db, 'tests'), {
          ...sanitizedPayload,
          createdAt: Timestamp.now()
        });

        await addLog({
          userId: user?.uid || 'system',
          userEmail: user?.email || 'unknown',
          action: LogAction.CREATE,
          category: LogCategory.TEST,
          resourceId: docRef.id,
          resourceName: formData.name,
          details: isDraft ? 'New test draft created' : 'New test created and activated',
          newData: { name: payload.name, date: payload.date, status: payload.status }
        });
      }

      toast.success(isDraft ? `Draft saved successfully! (Version ${nextVersion})` : `Test activated successfully! (Version ${nextVersion})`);
      
      // Refresh list and reset
      const testSnap = await getDocs(collection(db, 'tests'));
      setTests(testSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      }));
      
      setView('list');
      resetForm();
    } catch (error) {
      console.error('Test Save Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred while saving test';
      toast.error(`Failed to save test: ${errorMessage}`);
      handleFirestoreError(error, OperationType.WRITE, 'tests');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      date: '',
      pattern: '',
      advancedPapers: [],
      programId: '',
      batchIds: [],
      totalQuestions: 75,
      answerKey: {},
      paperKeys: {},
      paperMappings: {},
      subQbgMapping: null,
      status: 'DRAFT'
    });
    setEditingId(null);
    setAnswerKeyFile(null);
    setSubQbgFile(null);
    setPaperFiles({});
    setStep(1);
  };

  const handleDeleteTest = async (testId: string) => {
    if (!window.confirm('CRITICAL: This will PERMANENTLY delete this test and it CANNOT be undone. All results for this test will stay in the database but will be orphaned. Are you sure?')) return;
    
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'tests', testId));
      toast.success('Test deleted permanently');
      
      const testSnap = await getDocs(collection(db, 'tests'));
      setTests(sortTests(testSnap.docs.map(d => ({ id: d.id, ...d.data() } as any))));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'tests');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`CRITICAL: This will PERMANENTLY delete ${selectedTestIds.length} tests and all their data. This CANNOT be undone. Are you sure?`)) return;
    
    setLoading(true);
    try {
      const batch = writeBatch(db);
      selectedTestIds.forEach(id => {
        batch.delete(doc(db, 'tests', id));
      });
      await batch.commit();
      
      toast.success(`${selectedTestIds.length} tests deleted permanently`);
      setSelectedTestIds([]);
      
      const testSnap = await getDocs(collection(db, 'tests'));
      setTests(sortTests(testSnap.docs.map(d => ({ id: d.id, ...d.data() } as any))));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'tests_bulk');
    } finally {
      setLoading(false);
    }
  };

  const filteredTests = React.useMemo(() => {
    return tests.filter(test => {
      const matchesName = !filters.name || test.name.toLowerCase().includes(filters.name.toLowerCase());
      const matchesDate = !filters.date || test.date === filters.date;
      const matchesBatch = !filters.batchId || test.batchIds?.includes(filters.batchId);
      
      const matchesCenter = !filters.centerId || test.batchIds?.some((bid: string) => {
        const b = batches.find(batch => batch.id === bid);
        return b?.centerId === filters.centerId;
      });

      return matchesName && matchesDate && matchesBatch && matchesCenter;
    });
  }, [tests, filters, batches]);

  const startEditing = (test: any) => {
    setFormData({
      name: test.name || '',
      date: test.date || '',
      pattern: test.pattern || '',
      advancedPapers: test.advancedPapers || [],
      programId: test.programId || '',
      batchIds: test.batchIds || [],
      totalQuestions: test.totalQuestions || 75,
      answerKey: test.answerKey || {},
      paperKeys: test.paperKeys || {},
      paperMappings: test.paperMappings || {},
      subQbgMapping: test.subQbgMapping || null,
      status: test.status || 'ACTIVE'
    });
    setEditingId(test.id);
    setView('create');
    setStep(1);
  };

  const renderStep = () => {
    if (step === 1) {
      return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Test Name</label>
                  <Input
                    placeholder="e.g. Unit Test 05"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Test Date</label>
                  <Input
                    type="date"
                    value={formData.date}
                    onChange={e => setFormData({...formData, date: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Test Pattern</label>
                  <Select 
                    value={formData.pattern} 
                    onChange={e => {
                      const val = e.target.value as any;
                      let newQCount = formData.totalQuestions;
                      if (val === 'JEE_MAIN') newQCount = 90;
                      if (val === 'NEET') newQCount = 200;
                      
                      setFormData({
                        ...formData, 
                        pattern: val,
                        totalQuestions: newQCount,
                        advancedPapers: val === 'JEE_ADVANCED' ? formData.advancedPapers : []
                      });
                    }}
                  >
                    <option value="">Select Pattern...</option>
                    <option value="JEE_MAIN">JEE Main</option>
                    <option value="JEE_ADVANCED">JEE Advanced</option>
                    <option value="NEET">NEET</option>
                  </Select>
                </div>

                {formData.pattern === 'JEE_ADVANCED' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="md:col-span-2 space-y-2 px-1">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1 block">Select Advanced Papers (Max 2)</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                      {['2020', '2021', '2022', '2023', '2024', '2025'].flatMap(year => [`${year}-P1`, `${year}-P2`]).map(paper => (
                        <button
                          key={paper}
                          type="button"
                          onClick={() => {
                            const isSelected = formData.advancedPapers.includes(paper);
                            if (!isSelected && formData.advancedPapers.length >= 2) {
                              toast.error('Maximum 2 Advanced papers can be selected');
                              return;
                            }
                            const newPapers = isSelected
                              ? formData.advancedPapers.filter(p => p !== paper)
                              : [...formData.advancedPapers, paper];
                            
                            let newQCount = formData.totalQuestions;
                            if (newPapers.some(p => p.startsWith('2025'))) {
                              newQCount = 48;
                            }

                            setFormData({ ...formData, advancedPapers: newPapers, totalQuestions: newQCount });
                          }}
                          className={cn(
                            "py-1.5 px-2 rounded-xl text-[10px] font-black transition-all border-2",
                            formData.advancedPapers.includes(paper)
                              ? "bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-100"
                              : "bg-white text-slate-500 border-slate-100 hover:border-blue-200"
                          )}
                        >
                          {paper}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Program</label>
                  <Select value={formData.programId} onChange={e => setFormData({...formData, programId: e.target.value, batchIds: []})}>
                    <option value="">Select Program...</option>
                    {programs.filter(p => p.isActive || p.id === formData.programId).map(p => <option key={p.id} value={p.id}>{p.programName}</option>)}
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between px-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Select Batches</label>
                {formData.programId && (
                  <Badge variant="blue" className="bg-blue-50 text-blue-600 border-none uppercase tracking-widest text-[9px]">
                    {programs.find(p => p.id === formData.programId)?.programName}
                  </Badge>
                )}
              </div>
              
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto no-scrollbar pb-4 pr-1 border-2 border-slate-50 rounded-3xl p-4">
                  {formData.programId ? (
                    batches.filter(b => b.programId === formData.programId && (b.isActive || formData.batchIds.includes(b.id))).map(b => (
                      <Card 
                        key={b.id} 
                        className={cn(
                          "p-4 transition-all duration-300 border-2",
                          formData.batchIds.includes(b.id) ? "border-blue-600 bg-blue-50/30" : "border-slate-100/50 hover:border-blue-200 cursor-pointer"
                        )}
                        onClick={() => toggleBatch(b.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <span className="font-bold text-slate-700 block">{b.batchName}</span>
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">
                              {centers.find(c => c.id === b.centerId)?.centerName || 'Unknown Center'}
                            </span>
                          </div>
                          <div className={cn(
                            "w-6 h-6 rounded-lg flex items-center justify-center transition-colors",
                            formData.batchIds.includes(b.id) ? "bg-blue-600 text-white" : "bg-slate-100 text-transparent"
                          )}>
                             <Check size={14} strokeWidth={4} />
                          </div>
                        </div>
                      </Card>
                    ))
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center space-y-3 opacity-40 py-10">
                      <Database size={32} />
                      <p className="text-xs font-black uppercase tracking-widest">Select Program First</p>
                    </div>
                  )}
                  {formData.programId && batches.filter(b => b.programId === formData.programId && (b.isActive || formData.batchIds.includes(b.id))).length === 0 && (
                    <div className="p-8 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
                      <p className="text-slate-400 font-bold text-sm">No active batches found for this program</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      );
    } 
    
    // Upload steps
    if (step > 1 && step <= totalUploadSteps + 1) {
      const currentPaperIndex = step - 2;
      const currentPaper = formData.pattern === 'JEE_ADVANCED' ? formData.advancedPapers[currentPaperIndex] : null;
      const currentPaperFileKey = currentPaper || 'answerKey';
      
      return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
           <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-6 border-b border-slate-100">
              <div className="space-y-1">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Marking & Config {currentPaper ? `• ${currentPaper}` : ''}</p>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Upload Answer Key {currentPaper ? `for ${currentPaper}` : ''}</h3>
              </div>
              <div className="flex items-center space-x-4 bg-slate-50 p-2 rounded-2xl">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Q-Count</span>
                <button 
                  onClick={() => {
                    const newCount = Math.max(1, formData.totalQuestions - 1);
                    setFormData({...formData, totalQuestions: newCount});
                  }} 
                  className="w-10 h-10 rounded-xl bg-white border border-slate-100 text-slate-900 flex items-center justify-center text-xl font-black shadow-sm"
                >-</button>
                <Input 
                  type="number" 
                  value={formData.totalQuestions}
                  onChange={e => setFormData({...formData, totalQuestions: parseInt(e.target.value) || 0})}
                  className="w-20 text-center font-black h-10 rounded-xl tabular-nums bg-white"
                />
                <button 
                  onClick={() => {
                    const newCount = formData.totalQuestions + 1;
                    setFormData({...formData, totalQuestions: newCount});
                  }} 
                  className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center text-xl font-black shadow-lg shadow-blue-100"
                >+</button>
              </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Answer Key Import Section */}
              <Card className="p-8 border-slate-100 shadow-xl shadow-slate-200/40 rounded-[2.5rem] bg-white relative overflow-hidden group">
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 shadow-inner group-hover:rotate-6 transition-transform">
                      <FileSpreadsheet size={28} />
                    </div>
                    {(currentPaper ? formData.paperKeys[currentPaper] : answerKeyFile) && (
                      <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-[10px] font-black border border-emerald-100 shadow-sm">
                        <CheckCircle2 size={12} />
                        UPLOADED
                      </div>
                    )}
                  </div>
                  
                  <div className="space-y-1">
                     <h4 className="text-xl font-black text-slate-900 tracking-tight">1. Answer Key</h4>
                     <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{currentPaper ? `Mapping for ${currentPaper}` : 'Mandatory for scoring'}</p>
                  </div>

                  {(currentPaper ? paperFiles[currentPaper]?.answer : answerKeyFile) ? (
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3">
                      <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center text-blue-600 shadow-sm">
                        <FileJson size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-slate-700 truncate">{currentPaper ? paperFiles[currentPaper]?.answer : answerKeyFile}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Active Reference</p>
                      </div>
                    </div>
                  ) : (
                    <div className="h-20 border-2 border-dashed border-slate-100 rounded-2xl flex items-center justify-center bg-slate-50/50">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Awaiting file...</p>
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <div className="relative flex-1">
                      <input 
                        type="file" 
                        accept=".json,.xlsx,.xls,.csv" 
                        className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                        onChange={handleAnswerKeyUpload} 
                      />
                      <Button variant="primary" size="md" className="w-full bg-blue-600 shadow-lg shadow-blue-100">
                        {(currentPaper ? formData.paperKeys[currentPaper] : answerKeyFile) ? 'Change Key' : 'Select Key'}
                      </Button>
                    </div>
                    <Button 
                      variant="outline" 
                      size="md" 
                      onClick={() => downloadTemplate('answer')}
                      className="border-slate-200 text-slate-500 hover:bg-slate-50"
                    >
                      <Download size={18} />
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Sub QBG Mapping Section */}
              <Card className="p-8 border-slate-100 shadow-xl shadow-slate-200/40 rounded-[2.5rem] bg-white relative overflow-hidden group">
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 shadow-inner group-hover:-rotate-6 transition-transform">
                      <Database size={28} />
                    </div>
                    {(currentPaper ? formData.paperMappings[currentPaper] : subQbgFile) && (
                      <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-[10px] font-black border border-emerald-100 shadow-sm">
                        <CheckCircle2 size={12} />
                        MAPPED
                      </div>
                    )}
                  </div>
                  
                  <div className="space-y-1">
                     <h4 className="text-xl font-black text-slate-900 tracking-tight">2. QBG Mapping</h4>
                     <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Topic & Chapter Linking</p>
                  </div>

                  {(currentPaper ? paperFiles[currentPaper]?.mapping : subQbgFile) ? (
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3">
                      <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center text-amber-600 shadow-sm">
                        <Database size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-slate-700 truncate">{currentPaper ? paperFiles[currentPaper]?.mapping : subQbgFile}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Active Mapping</p>
                      </div>
                    </div>
                  ) : (
                    <div className="h-20 border-2 border-dashed border-slate-100 rounded-2xl flex items-center justify-center bg-slate-50/50">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Optional Upload</p>
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <div className="relative flex-1">
                      <input 
                        type="file" 
                        accept=".xlsx,.xls,.csv" 
                        className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                        onChange={handleSubQbgUpload} 
                      />
                      <Button variant="secondary" size="md" className="w-full bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100">
                        {(currentPaper ? formData.paperMappings[currentPaper] : subQbgFile) ? 'Change Map' : 'Select Map'}
                      </Button>
                    </div>
                    <Button 
                      variant="outline" 
                      size="md" 
                      onClick={() => downloadTemplate('qbg')}
                      className="border-slate-200 text-slate-500 hover:bg-slate-50"
                    >
                      <Download size={18} />
                    </Button>
                  </div>
                </div>
              </Card>
           </div>
           
           {(currentPaper ? formData.paperKeys[currentPaper] : (formData.answerKey && Object.keys(formData.answerKey).length > 0)) && (
             <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center justify-between p-6 bg-emerald-50/30 rounded-[2.5rem] border border-emerald-100/50">
                <div className="flex items-center space-x-5">
                  <div className="p-3.5 bg-emerald-100 rounded-2xl text-emerald-600">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <span className="text-base font-black text-slate-800 block">System Ready</span>
                    <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">
                      Validated {Object.keys(currentPaper ? formData.paperKeys[currentPaper] : formData.answerKey).length} Solutions {currentPaper ? `for ${currentPaper}` : ''}
                    </span>
                  </div>
                </div>
                <div className="w-10 h-10 bg-emerald-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-100">
                  <Check size={22} strokeWidth={3} />
                </div>
             </motion.div>
           )}
        </motion.div>
      );
    }
    
    // Preview step
    if (step === totalSteps) {
      // Merge all paper keys for preview if it's JEE Advanced
      const previewKeys = formData.pattern === 'JEE_ADVANCED' 
        ? Object.entries(formData.paperKeys).reduce((acc: any, [pName, keys]) => {
            Object.entries(keys).forEach(([qNum, details]: [any, any]) => {
              acc[`${pName}-${qNum}`] = details;
            });
            return acc;
          }, {})
        : formData.answerKey;

      const previewMappings = formData.pattern === 'JEE_ADVANCED'
        ? Object.entries(formData.paperMappings).reduce((acc: any, [pName, mappings]) => {
            Object.entries(mappings).forEach(([qNum, details]: [any, any]) => {
              acc[`${pName}-${qNum}`] = details;
            });
            return acc;
          }, {})
        : formData.subQbgMapping;

      const previewQNums = Object.keys(previewKeys).sort((a, b) => {
        if (a.includes('-') && b.includes('-')) {
          const [pA, qA] = a.split('-');
          const [pB, qB] = b.split('-');
          if (pA !== pB) return pA.localeCompare(pB);
          return parseInt(qA) - parseInt(qB);
        }
        return parseInt(a) - parseInt(b);
      });

      return (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
          <div className="flex items-center justify-between px-1">
            <div className="space-y-1">
              <h4 className="text-xl font-black text-slate-900 tracking-tight">Question Analysis Mapping</h4>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Link questions to Sub-QBG Master</p>
            </div>
            <Badge variant="blue">{previewQNums.length} Questions Total</Badge>
          </div>

          {formData.pattern === 'JEE_ADVANCED' && formData.advancedPapers.length > 0 && (
            <div className="px-1 flex flex-wrap gap-2">
              {formData.advancedPapers.map(p => (
                <Badge key={p} variant="blue" className="bg-blue-600 text-white border-none">{p}</Badge>
              ))}
            </div>
          )}

          <div className="max-h-[500px] overflow-y-auto no-scrollbar pr-2 space-y-3 font-sans">
            {previewQNums.map((qNumStr) => {
              const qKeyData = previewKeys[qNumStr] || {};
              const mappedData = previewMappings[qNumStr] || {};
              
              const subjectId = qKeyData.subjectId || mappedData.subjectId || '';
              const chapterId = qKeyData.chapterId || mappedData.chapterId || '';
              const topicId = qKeyData.topicId || mappedData.topicId || '';
              const subtopicId = qKeyData.subtopicId || mappedData.subtopicId || '';
              
              const subjectLookup = qbgMaster.find(q => q.subjectId === subjectId && q.type === 'subject');
              const chapterLookup = qbgMaster.find(q => q.chapterId === chapterId && q.subjectId === subjectId && q.type === 'chapter');
              const topicLookup = qbgMaster.find(q => q.topicId === topicId && q.chapterId === chapterId && q.type === 'topic');
              
              const subjectNameAttr = qKeyData.subject || mappedData.subject || subjectLookup?.name || '';
              const chapterNameAttr = qKeyData.chapter || mappedData.chapter || chapterLookup?.name || '';
              const topicNameAttr = qKeyData.topic || mappedData.topic || topicLookup?.name || '';
              const ans = qKeyData.ans;
              
              return (
                <Card key={qNumStr} className="p-4 border-slate-100 shadow-sm flex flex-col gap-4 group hover:border-blue-200 transition-all">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "min-w-10 h-10 px-2 rounded-xl flex items-center justify-center text-xs font-black transition-all",
                      ans ? "bg-blue-50 text-blue-600" : "bg-slate-50 text-slate-400"
                    )}>
                      {qNumStr.includes('-') ? qNumStr.split('-')[1] : qNumStr}
                    </div>
                    {qNumStr.includes('-') && (
                      <Badge className="bg-slate-100 text-slate-500 border-none text-[8px] uppercase tracking-tighter">
                        {qNumStr.split('-')[0]}
                      </Badge>
                    )}
                    <div className="flex-1 flex items-center justify-between">
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{subjectNameAttr || 'No Subject'}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-700">{chapterNameAttr || 'No Chapter Mapping'}</p>
                          {topicNameAttr && <Badge variant="slate" className="text-[9px] bg-slate-50 text-slate-500 font-medium">{topicNameAttr}</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                         {ans && <div className="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center font-black text-xs border border-emerald-100">{ans}</div>}
                         <Badge variant="slate" className="text-[9px]">{qKeyData.difficulty || mappedData.difficulty || 'Normal'}</Badge>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </motion.div>
      );
    }
  };

  const handleSyncAll = async () => {
    if (!window.confirm('This will re-sync subject/chapter mappings for ALL tests from the current QBG Library. Proceed?')) return;
    
    setLoading(true);
    try {
      const updatedTestsCount = 0;
      const { updateDoc, doc: fsDoc } = await import('firebase/firestore');
      
      for (const test of tests) {
        if (!test.answerKey) continue;
        
        const finalAnswerKey = { ...test.answerKey };
        let hasChanges = false;
        
        Object.keys(finalAnswerKey).forEach(qNum => {
          const details = finalAnswerKey[qNum];
          const subjectId = details.subjectId;
          const chapterId = details.chapterId;
          const topicId = details.topicId;
          const subtopicId = details.subtopicId;
          
          if (subjectId) {
            const subjectLookup = qbgMaster.find(q => q.subjectId === subjectId && q.type === 'subject');
            const chapterLookup = qbgMaster.find(q => q.chapterId === chapterId && q.subjectId === subjectId && q.type === 'chapter');
            const topicLookup = qbgMaster.find(q => q.topicId === topicId && q.chapterId === chapterId && q.type === 'topic');
            const subtopicLookup = qbgMaster.find(q => q.subtopicId === subtopicId && q.topicId === topicId && q.type === 'subtopic');
            
            const newSubName = (subjectLookup?.name || details.subject || '');
            const normalizedSubName = (newSubName.toLowerCase() === 'math' || newSubName.toLowerCase() === 'maths' || newSubName.toLowerCase() === 'mathematics') ? 'Math' : newSubName;
            
            const newChName = chapterLookup?.name || details.chapter || '';
            const newTopicName = topicLookup?.name || details.topic || '';
            const newSubTopicName = subtopicLookup?.name || details.subtopic || '';
            
            if (details.subject !== normalizedSubName || details.chapter !== newChName || details.topic !== newTopicName) {
              finalAnswerKey[qNum] = {
                ...details,
                subject: normalizedSubName,
                chapter: newChName,
                topic: newTopicName,
                subtopic: newSubTopicName
              };
              hasChanges = true;
            }
          }
        });
        
        if (hasChanges) {
          await updateDoc(fsDoc(db, 'tests', test.id), {
            answerKey: finalAnswerKey,
            updatedAt: Timestamp.now()
          });
        }
      }
      
      toast.success('All tests synced with QBG Library');
      // Refresh list
      const testSnap = await getDocs(collection(db, 'tests'));
      setTests(testSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      }));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'tests_sync');
    } finally {
      setLoading(false);
    }
  };

  if (view === 'detail' && selectedTest) {
    const assignedBatches = batches.filter(b => selectedTest.batchIds?.includes(b.id));
    
    return (
      <div className="space-y-10 relative">
        {loading && <Loader fullScreen label="Processing Test..." />}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <button onClick={() => setView('list')} className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 transition-colors">
              <ChevronLeft size={24} strokeWidth={3} className="text-slate-900" />
            </button>
            <div className="space-y-1">
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] pl-0.5">Test Configuration</p>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none">{selectedTest.name}</h2>
              <div className="flex items-center gap-3">
                 <Badge variant="blue">{selectedTest.date}</Badge>
                 <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Version {selectedTest.answerKeyVersion || 1}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isAdmin && (
                <Button 
                  variant="outline" 
                  size="md" 
                  onClick={() => {
                    handleDeleteTest(selectedTest.id);
                    setView('list');
                    setSelectedTest(null);
                  }} 
                  className="border-rose-100 text-rose-500 hover:bg-rose-50 hover:border-rose-200 px-4 rounded-2xl"
                >
                  <Trash2 size={18} />
                </Button>
              )}
              <Button 
                variant="secondary" 
                size="md" 
                onClick={() => startEditing(selectedTest)} 
                className="bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 px-6 rounded-2xl"
              >
                <Pencil size={18} className="mr-2" />
                <span className="text-[10px] font-black uppercase tracking-widest leading-none">Edit Test</span>
              </Button>
              <Button 
                variant="secondary" 
                size="md" 
                onClick={() => {
                  startEditing(selectedTest);
                  setStep(2);
                }} 
                className="bg-slate-50 text-slate-600 border border-slate-100 hover:bg-slate-100 px-6 rounded-2xl"
              >
                <Upload size={18} className="mr-2" />
                <span className="text-[10px] font-black uppercase tracking-widest leading-none">Reupload Key</span>
              </Button>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
           <div className="lg:col-span-1 space-y-8">
              <Card className="p-8 space-y-6 border-slate-100 shadow-sm">
                 <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs">Summary</h3>
                 <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                       <span className="text-sm font-bold text-slate-500">Pattern</span>
                       <span className="text-sm font-black text-slate-900">{selectedTest.pattern?.replace('_', ' ')}</span>
                    </div>
                    {selectedTest.pattern === 'JEE_ADVANCED' && selectedTest.advancedPapers?.length > 0 && (
                      <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none block">Papers</span>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedTest.advancedPapers.map((p: string) => (
                            <Badge key={p} variant="blue" className="text-[9px] px-2 py-0.5 bg-blue-600 text-white border-none">{p}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                       <span className="text-sm font-bold text-slate-500">Total Questions</span>
                       <span className="text-xl font-black text-slate-900">{selectedTest.totalQuestions}</span>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                       <span className="text-sm font-bold text-slate-500">Program</span>
                       <span className="text-sm font-black text-slate-900">
                         {programs.find(p => p.id === selectedTest.programId)?.programName || 'Unknown'}
                       </span>
                    </div>
                 </div>
              </Card>

              <Card className="p-8 space-y-6 border-slate-100 shadow-sm">
                 <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs">Assigned Batches</h3>
                 <div className="grid gap-3">
                    {assignedBatches.map(b => (
                       <div key={b.id} className="flex items-center gap-3 p-3 bg-blue-50/50 rounded-xl border border-blue-100/50">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span className="text-sm font-bold text-slate-700">{b.batchName}</span>
                       </div>
                    ))}
                    {assignedBatches.length === 0 && (
                      <p className="text-xs text-slate-400 italic">No batches linked</p>
                    )}
                 </div>
              </Card>
           </div>

           <div className="lg:col-span-2 space-y-6">
              <div className="flex items-center justify-between">
                 <h3 className="font-black text-2xl text-slate-900 tracking-tight">Master Answer Key</h3>
                 <Badge variant="blue">Matrix View</Badge>
              </div>

              <Card className="border-slate-100 overflow-hidden shadow-sm">
                 <div className="overflow-x-auto no-scrollbar">
                    <table className="w-full text-left">
                       <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                             <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Q.No</th>
                             <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Answer</th>
                             <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Mapping Info</th>
                             <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Marking (C/W/B/P)</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-50">
                          {selectedTest.answerKey && Object.entries(selectedTest.answerKey).map(([qNum, details]: [string, any]) => (
                             <tr key={qNum} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4">
                                   <span className="text-sm font-black text-slate-400">#{qNum}</span>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col gap-1">
                                      <Badge variant="blue" className="w-fit">{typeof details === 'string' ? details : details.ans}</Badge>
                                      <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{details.type || 'SCQ'}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                   <div className="flex flex-col space-y-1">
                                      <div className="flex items-center gap-2">
                                         <Badge variant="slate" className="text-[8px] px-1.5 py-0 bg-slate-100 text-slate-500 border-none">{details.subject || '—'}</Badge>
                                         <span className="text-[11px] font-black text-slate-900 truncate max-w-[150px]">{details.chapter || 'No Chapter mapping'}</span>
                                      </div>
                                      <div className="flex items-center gap-2 overflow-hidden">
                                         <div className="flex items-center gap-1 min-w-0">
                                           <span className="text-[9px] font-bold text-slate-400 truncate">{details.topic || '—'}</span>
                                           <span className="text-[9px] text-slate-200">/</span>
                                           <span className="text-[9px] font-bold text-slate-400 truncate">{details.subtopic || '—'}</span>
                                          </div>
                                         {details.difficulty && (
                                           <span className={cn(
                                             "text-[8px] font-black px-1.5 py-0.5 rounded-lg uppercase tracking-tighter ml-auto flex-shrink-0 shadow-sm border",
                                             details.difficulty.toLowerCase() === 'hard' ? 'bg-red-50 text-red-500 border-red-100' :
                                             details.difficulty.toLowerCase() === 'medium' ? 'bg-amber-50 text-amber-500 border-amber-100' :
                                             'bg-emerald-50 text-emerald-500 border-emerald-100'
                                           )}>
                                             {details.difficulty}
                                           </span>
                                         )}
                                      </div>
                                   </div>
                                </td>
                                <td className="px-6 py-4">
                                   <div className="flex items-center gap-3">
                                      <div className="flex flex-col">
                                        <span className="text-xs font-black text-emerald-600">+{details.correct || 4}</span>
                                        <span className="text-[8px] font-bold text-slate-400 uppercase">Correct</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-xs font-black text-rose-500">
                                          {(details.type === 'Numerical' || details.type === 'Integer') 
                                            ? ((formData.pattern === 'JEE_MAIN' || formData.pattern === 'NEET') ? -1 : 0) 
                                            : (details.wrong ?? -1)}
                                        </span>
                                        <span className="text-[8px] font-bold text-slate-400 uppercase">Wrong</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-xs font-black text-slate-400">0</span>
                                        <span className="text-[8px] font-bold text-slate-400 uppercase">Blank</span>
                                      </div>
                                      {(details.partial || details.type === 'MCQ') && (
                                        <div className="flex flex-col">
                                          <span className="text-xs font-black text-indigo-500">+{details.partial || 1}</span>
                                          <span className="text-[8px] font-bold text-slate-400 uppercase">Partial</span>
                                        </div>
                                      )}
                                   </div>
                                </td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 </div>
              </Card>
           </div>
        </div>
      </div>
    );
  }

  if (view === 'list') {
    return (
      <div className="space-y-10 relative">
        {loading && <Loader fullScreen label="Loading Tests..." />}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] pl-0.5">Academic Database</p>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight">Test Master</h1>
            <p className="text-slate-500 font-medium text-sm">
              Manage your academic examinations, answer keys and evaluation schedules.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="lg" onClick={handleSyncAll} className="border-blue-200 text-blue-600 bg-blue-50/50">
              <Database className="mr-2" size={18} />
              Sync All Data
            </Button>
            <Button variant="primary" size="lg" onClick={() => {
              resetForm();
              setView('create');
            }} className="shadow-lg shadow-blue-100 px-8">
              <Plus className="mr-2" size={20} strokeWidth={3} />
              Create New Test
            </Button>
          </div>
        </header>

        {/* Filters Bar */}
        <Card className="p-4 border-slate-100 shadow-sm bg-slate-50/50">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Test Name</label>
              <Input 
                placeholder="Search by name..." 
                value={filters.name}
                onChange={e => setFilters({...filters, name: e.target.value})}
                className="bg-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Test Date</label>
              <Input 
                type="date"
                value={filters.date}
                onChange={e => setFilters({...filters, date: e.target.value})}
                className="bg-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Center</label>
              <Select 
                value={filters.centerId}
                onChange={e => setFilters({...filters, centerId: e.target.value})}
                className="bg-white"
              >
                <option value="">All Centers</option>
                {centers.filter(c => c.isActive).map(c => <option key={c.id} value={c.id}>{c.centerName}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Batch</label>
              <Select 
                value={filters.batchId}
                onChange={e => setFilters({...filters, batchId: e.target.value})}
                className="bg-white"
              >
                <option value="">All Batches</option>
                {batches
                  .filter(b => b.isActive && (!filters.centerId || b.centerId === filters.centerId))
                  .map(b => <option key={b.id} value={b.id}>{b.batchName}</option>)
                }
              </Select>
            </div>
          </div>
        </Card>

        {/* Bulk Actions */}
        <AnimatePresence>
          {selectedTestIds.length > 0 && (
            <motion.div 
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-6 px-8 py-4 bg-slate-900 text-white rounded-3xl shadow-2xl border border-white/10 backdrop-blur-xl"
            >
              <div className="flex items-center gap-3 pr-6 border-r border-white/10">
                <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center font-black text-xs">
                  {selectedTestIds.length}
                </div>
                <span className="text-xs font-black uppercase tracking-widest text-slate-400">Tests Selected</span>
              </div>
              
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setSelectedTestIds([])}
                  className="text-white hover:bg-white/10 font-bold px-4"
                >
                  Deselect All
                </Button>
                {isAdmin && (
                  <Button 
                    variant="primary" 
                    size="sm" 
                    onClick={handleBulkDelete}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-widest text-[10px] px-6 py-2.5 rounded-xl border-none"
                  >
                    <Trash2 className="mr-2" size={14} />
                    Delete Permanently
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {loading ? (
            Array(8).fill(0).map((_, i) => <div key={i} className="h-48 bg-white rounded-[2.5rem] animate-pulse border border-slate-100" />)
          ) : filteredTests.length === 0 ? (
            <Card className="col-span-full p-20 flex flex-col items-center justify-center text-center space-y-4 border-dashed border-2 border-slate-100">
               <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center text-slate-200">
                  <FileJson size={40} />
               </div>
               <div className="space-y-1">
                 <h3 className="font-black text-slate-900">No Tests Found</h3>
                 <p className="text-slate-400 text-sm max-w-xs">No tests match your current filter criteria.</p>
               </div>
               <Button variant="secondary" size="md" onClick={() => {
                 setFilters({ name: '', date: '', centerId: '', batchId: '' });
               }} className="bg-white border-slate-200 px-8">
                  Clear Filters
               </Button>
            </Card>
          ) : (
            filteredTests.map((test) => (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} key={test.id} className="relative">
                <div className="absolute top-4 left-4 z-10">
                  <input 
                    type="checkbox"
                    className="w-5 h-5 rounded-lg border-2 border-slate-200 text-blue-600 focus:ring-blue-500 cursor-pointer transition-all bg-white"
                    checked={selectedTestIds.includes(test.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      setSelectedTestIds(prev => 
                        prev.includes(test.id) ? prev.filter(id => id !== test.id) : [...prev, test.id]
                      );
                    }}
                  />
                </div>
                <Card 
                  className={cn(
                    "p-6 h-full flex flex-col justify-between hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 group border-slate-100 cursor-pointer overflow-hidden",
                    test.status === 'DRAFT' && "border-amber-200 bg-amber-50/20",
                    selectedTestIds.includes(test.id) && "border-blue-500 ring-2 ring-blue-500/10 bg-blue-50/20"
                  )}
                  onClick={() => {
                    if (test.status === 'DRAFT') {
                      startEditing(test);
                      setStep(test.answerKey && Object.keys(test.answerKey).length > 0 ? 3 : 1);
                    } else {
                      setSelectedTest(test);
                      setView('detail');
                    }
                  }}
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className={cn(
                        "p-3 rounded-2xl transition-colors duration-300",
                        test.status === 'DRAFT' ? "bg-amber-100 text-amber-600" : "bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white"
                      )}>
                        {test.status === 'DRAFT' ? <Save size={20} strokeWidth={3} /> : <Check size={20} strokeWidth={3} />}
                      </div>
                      <div className="flex items-center gap-2">
                          <button 
                             onClick={(e) => {
                                e.stopPropagation();
                                startEditing(test);
                             }}
                             className="p-2 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-xl text-slate-400 transition-all shadow-sm"
                          >
                             <Pencil size={16} strokeWidth={3} />
                          </button>
                          {isAdmin && (
                            <button 
                              onClick={(e) => {
                                 e.stopPropagation();
                                 handleDeleteTest(test.id);
                              }}
                              className="p-2 bg-slate-100 hover:bg-rose-600 hover:text-white rounded-xl text-slate-400 transition-all shadow-sm"
                            >
                               <Trash2 size={16} strokeWidth={3} />
                            </button>
                          )}
                          <Badge variant={test.status === 'DRAFT' ? 'amber' : (test.isActive ? 'green' : 'slate')}>
                            {test.status === 'DRAFT' ? 'Draft' : (test.isActive ? 'Active' : 'Archived')}
                         </Badge>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-black text-slate-900 tracking-tight text-lg line-clamp-2">{test.name}</h4>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{test.date}</p>
                    </div>
                  </div>
                  <div className="mt-6 pt-6 border-t border-slate-50 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-2xl font-black text-slate-900">{test.totalQuestions}</span>
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Questions</span>
                    </div>
                    <div className="text-right">
                       <span className="text-[10px] font-black bg-slate-100 px-2 py-1 rounded-lg text-slate-500 uppercase tracking-widest">
                         v{test.answerKeyVersion || 1}
                       </span>
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

  return (
    <div className="space-y-10 pb-32 relative">
      {loading && <Loader fullScreen label="Saving Test Data..." />}
      <header className="space-y-6">
        <div className="flex items-center gap-4 mb-2">
           <Button variant="secondary" size="md" onClick={() => setView('list')} className="bg-white p-3 rounded-2xl border-slate-100 shadow-sm">
             <ChevronLeft size={24} />
           </Button>
           <div className="space-y-0.5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Test Engine</p>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">Create Test</h1>
           </div>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner mr-6">
            <motion.div 
              className="h-full bg-blue-600 rounded-full" 
              animate={{ width: `${(step / totalSteps) * 100}%` }}
              transition={{ type: 'spring', damping: 20, stiffness: 100 }}
            />
          </div>
          <span className="text-xs font-black text-blue-600 bg-blue-50 px-5 py-2.5 rounded-2xl uppercase tracking-widest border border-blue-100">
             Step {step} of {totalSteps}
          </span>
        </div>
      </header>

      <div className="bg-white rounded-[3rem] border border-slate-100 shadow-xl shadow-slate-200/40 p-8 md:p-12 min-h-[400px]">
        {renderStep()}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 max-w-4xl mx-auto pt-8">
        <div className="order-2 sm:order-1">
          {step > 1 && (
            <Button variant="outline" size="lg" onClick={prevStep} className="px-8 rounded-2xl border-slate-200 text-slate-500">
              <ChevronLeft className="mr-2" size={20} strokeWidth={3} />
              Previous
            </Button>
          )}
        </div>
        
        <div className="flex items-center gap-3 order-1 sm:order-2 w-full sm:w-auto">
          <Button 
            variant="secondary" 
            size="lg" 
            onClick={() => handleCreateTest(true)} 
            disabled={loading}
            className="flex-1 sm:flex-none rounded-2xl px-6 bg-amber-50 text-amber-600 border border-amber-100 hover:bg-amber-100 font-black uppercase text-[10px] tracking-widest"
          >
            <Save className="mr-2" size={18} />
            Save Draft
          </Button>

          <Button 
            variant="primary" 
            size="lg" 
            disabled={loading}
            onClick={() => step === totalSteps ? handleCreateTest(false) : nextStep()} 
            className="flex-1 sm:flex-none px-10 rounded-2xl shadow-xl shadow-blue-100 bg-blue-600"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span className="font-black uppercase text-[11px] tracking-widest">
                  {step === totalSteps ? 'Finalize & Activate' : 'Continue'}
                </span>
                {step < totalSteps && <ChevronRight className="ml-2" size={20} strokeWidth={3} />}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
