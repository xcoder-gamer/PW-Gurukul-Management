import React, { useState, useEffect, useMemo } from 'react';
import { Card, Button, Input, Select, Badge, Loader } from '../components/UI';
import { 
  Search, 
  Filter, 
  TrendingUp, 
  User as UserIcon, 
  Award, 
  Target, 
  ChevronRight, 
  BarChart3, 
  ChevronLeft,
  Settings,
  Upload,
  Cpu,
  RefreshCw,
  CheckCircle2,
  X,
  Plus,
  FileText,
  FileSpreadsheet,
  Download,
  AlertCircle,
  TrendingDown,
  Database,
  Trash2,
  Layout
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { BottomSheet } from './Students';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  addDoc, 
  serverTimestamp, 
  orderBy,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  deleteDoc
} from 'firebase/firestore';
import Papa from 'papaparse';

import * as XLSX from 'xlsx';
import { toast } from 'sonner';

// Utility to calculate score and stats
const evaluateResult = (studentAnswers: Record<string, string>, answerKey: any, qbgMap: any = {}, pattern: string = '') => {
  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let blankCount = 0;
  const chapterStats: any = {};
  const subjectStats: any = {};
  const topicStats: any = {};
  const difficultyStats: any = {
    'Easy': { total: 0, correct: 0, wrong: 0, blank: 0, score: 0 },
    'Medium': { total: 0, correct: 0, wrong: 0, blank: 0, score: 0 },
    'Hard': { total: 0, correct: 0, wrong: 0, blank: 0, score: 0 },
    'Normal': { total: 0, correct: 0, wrong: 0, blank: 0, score: 0 }
  };
  const mappedEvaluation: any[] = [];

  // Helper to normalize keys (e.g., "Q.1", "Q1", "1" -> "1")
  const normalizeQKey = (key: string) => {
    if (!key) return '';
    // If it's a paper-prefixed key (e.g., "Paper 1-1"), preserve the prefix but normalize the number
    if (key.includes('-')) {
      const parts = key.split('-');
      const numPart = parts.pop()?.replace(/[^0-9]/g, '') || '';
      const num = numPart ? String(parseInt(numPart)) : '';
      return num ? `${parts.join('-')}-${num}` : parts.join('-');
    }
    const digits = key.replace(/[^0-9]/g, '');
    return digits ? String(parseInt(digits)) : '';
  };
  
  // Normalize all student answer keys for easier lookup
  const normalizedStudentAns: Record<string, string> = {};
  Object.entries(studentAnswers || {}).forEach(([k, v]) => {
    normalizedStudentAns[normalizeQKey(k)] = String(v || '').trim().toUpperCase();
  });

  // Ensure answerKey is an object we can iterate
  const keyEntries = Object.entries(answerKey || {}).sort((a, b) => {
    const aN = parseInt(a[0].replace(/[^0-9]/g, '')) || 0;
    const bN = parseInt(b[0].replace(/[^0-9]/g, '')) || 0;
    return aN - bN;
  });
  
  keyEntries.forEach(([rawQIdx, qData]: [string, any]) => {
    const qIdx = normalizeQKey(rawQIdx);
    if (!qIdx) return; // Skip if no numeric index found

    const studentAns = normalizedStudentAns[qIdx] || '';
    
    // Normalize correct answer
    const correctAns = String(typeof qData === 'string' ? qData : (qData.ans || qData.answer || '')).trim().toUpperCase();
    
    // 1. Identify identifying traits of the question
    const isNumerical = !!(qData.type === 'Numerical' || qData.Type === 'Numerical' || qData.isRange);
    const isMCQ = !!(qData.type === 'MCQ' || qData.Type === 'MCQ' || (correctAns.includes(',') || correctAns.includes(' ') || (correctAns.length > 1 && !isNumerical)));
    
    // 2. Fetch specific weights from the data or provide basic fallbacks
    // Prefer explicitly named fields from the answer key JSON
    const weights = typeof qData === 'object' ? qData : {};
    
    // Fallback logic: Only used if columns are missing from the input source
    const fallbackCorrect = 4;
    const fallbackWrong = (pattern === 'JEE_ADVANCED' && !isNumerical) ? -2 : (pattern === 'JEE_ADVANCED' && isNumerical) ? 0 : -1;

    let correctPoints = parseFloat(String(weights.correct ?? weights.positive ?? fallbackCorrect));
    if (isNaN(correctPoints)) correctPoints = fallbackCorrect;
    
    let wrongPoints = parseFloat(String(weights.wrong ?? weights.negative ?? fallbackWrong));
    if (isNaN(wrongPoints)) wrongPoints = fallbackWrong;

    // STRICT OVERRIDE for Numerical questions in JEE patterns
    // JEE Advanced standardly has 0 negative marks for Numerical/Integer questions
    // JEE Main now has -1 (as per user request)
    if (isNumerical && pattern === 'JEE_ADVANCED') {
      wrongPoints = 0;
    }
    
    if (isNumerical && (pattern === 'JEE_MAIN' || pattern === 'NEET')) {
      wrongPoints = -1;
    }

    const unattemptPoints = parseFloat(String(weights.unattempt ?? weights.unattempted ?? 0));
    
    // Optional: Allow the data to specify partial marks per question
    const partialPoints = parseFloat(String(weights.partial ?? weights.partialCorrect ?? (pattern === 'JEE_ADVANCED' ? 1 : 0)));

    // Ensure magnitude of wrong points is treated as deduction (negative) if not already
    // but ONLY if the user actually intended a deduction (i.e. it's not 0 or positive intended)
    // Most users provide -1 or 1 for deduction. If they provide 0, we keep it 0.
    if (Math.abs(wrongPoints) > 0 && wrongPoints > 0) {
      // If positive number provided for a wrong answer, assume it's a deduction magnitude
      wrongPoints = -Math.abs(wrongPoints);
    }

    // Mapping info
    const subjectId = qData.subjectId || '';
    const chapterId = qData.chapterId || '';
    const topicId = qData.topicId || '';
    const subtopicId = qData.subtopicId || '';
    
    // Normalize difficulty mapping (1=Easy, 2=Medium, 3=Hard)
    const rawDiff = String(qData.difficulty || '');
    let normalizedDifficulty = rawDiff === '1' ? 'Easy' : 
                             rawDiff === '2' ? 'Medium' : 
                             rawDiff === '3' ? 'Hard' : 
                             rawDiff || 'Normal';

    const chap = qData.chapter || chapterId || 'General';
    const rawSubject = qData.subject || subjectId || 'N/A';
    const subject = (rawSubject.toLowerCase() === 'math' || rawSubject.toLowerCase() === 'maths' || rawSubject.toLowerCase() === 'mathematics') ? 'Math' : rawSubject;
    const topic = qbgMap[topicId]?.topic || qData.topic || topicId || '';
    const diff = normalizedDifficulty;

    if (!chapterStats[chap]) {
      chapterStats[chap] = { total: 0, correct: 0, wrong: 0, score: 0, subject, chapterId };
    }
    chapterStats[chap].total++;

    if (!subjectStats[subject]) {
      subjectStats[subject] = { total: 0, correct: 0, wrong: 0, blank: 0, score: 0, subjectId };
    }
    subjectStats[subject].total++;

    if (topic) {
      if (!topicStats[topic]) {
        topicStats[topic] = { total: 0, correct: 0, score: 0, subject, chapter: chap };
      }
      topicStats[topic].total++;
    }

    if (!difficultyStats[diff]) {
      difficultyStats[diff] = { total: 0, correct: 0, wrong: 0, blank: 0, score: 0 };
    }
    difficultyStats[diff].total++;

    let status: 'correct' | 'wrong' | 'blank' | 'partial' = 'wrong';
    let qScore = 0;

    // Helper to check if student answer matches any of the allowed options
    const isMatched = (sVal: string, cVal: string, isNumeric: boolean = false) => {
      const s = sVal.trim().toUpperCase();
      const c = cVal.trim().toUpperCase();
      if (s === c) return true;
      
      // Handle multiple options like "A OR B", "1/2", "A | B"
      const options = c.split(/[\/|]|\sOR\s/i).map(o => o.trim()).filter(o => o !== '');
      if (options.length > 1) {
        return options.some(opt => {
          if (s === opt) return true;
          if (isNumeric || !isNaN(parseFloat(s.replace(/[^0-9.-]/g, ''))) || !isNaN(parseFloat(opt.replace(/[^0-9.-]/g, '')))) {
            const sNum = parseFloat(s.replace(/[^0-9.-]/g, ''));
            const optNum = parseFloat(opt.replace(/[^0-9.-]/g, ''));
            if (!isNaN(sNum) && !isNaN(optNum) && Math.abs(sNum - optNum) < 0.0001) return true;
          }
          return false;
        });
      }
      return false;
    };

    if (correctAns === 'BONUS') {
      correctCount++;
      qScore = correctPoints;
      status = 'correct';
    } else if (!studentAns || studentAns === '' || studentAns === 'BLANK' || studentAns === '-' || studentAns === '?') {
      qScore = unattemptPoints;
      blankCount++;
      status = 'blank';
    } else if (qData.type === 'Numerical' || qData.Type === 'Numerical' || (!isNaN(parseFloat(String(studentAns))) && !isNaN(parseFloat(String(correctAns)))) || correctAns.includes('OR') || correctAns.includes('/') || correctAns.includes('|')) {
      // Numerical or Multi-option single choice
      if (isMatched(studentAns, correctAns, true)) {
        correctCount++;
        qScore = correctPoints;
        status = 'correct';
      } else {
        wrongCount++;
        qScore = wrongPoints;
        status = 'wrong';
      }
    } else if (qData.isRange) {
      const val = parseFloat(studentAns);
      if (!isNaN(val) && val >= qData.rangeMin && val <= qData.rangeMax) {
        correctCount++;
        qScore = correctPoints;
        status = 'correct';
      } else {
        wrongCount++;
        qScore = wrongPoints;
        status = 'wrong';
      }
    } else if (qData.type === 'MCQ' || qData.Type === 'MCQ' || (correctAns.includes(',') || correctAns.includes(' ') || (correctAns.length > 1 && !isNumerical))) {
      // Complex Partial Marking for MCQ
      // Standardize: remove spaces/commas, sort characters
      const studentKeys = studentAns.replace(/[\s,]/g, '').toUpperCase().split('').filter(k => k.length > 0).sort();
      const correctKeys = (correctAns || '').replace(/[\s,]/g, '').toUpperCase().split('').filter(k => k.length > 0).sort();
      
      const isIncorrectSelected = studentKeys.some(k => !correctKeys.includes(k));
      const correctSelectedCount = studentKeys.filter(k => correctKeys.includes(k)).length;
      
      if (isIncorrectSelected) {
        wrongCount++;
        qScore = wrongPoints;
        status = 'wrong';
      } else if (correctSelectedCount === correctKeys.length && correctSelectedCount > 0) {
        correctCount++;
        qScore = correctPoints;
        status = 'correct';
      } else if (correctSelectedCount > 0) {
        // Partial marking logic: Use partialPoints from answer key if defined
        // fallback to JEE Advanced behavior (+1 per correct option) if partialPoints is the default 1
        if (partialPoints === 1 && pattern === 'JEE_ADVANCED') {
           qScore = correctSelectedCount; 
        } else {
           qScore = partialPoints * (partialPoints > 0 ? correctSelectedCount : 1); 
        }
        status = 'partial';
      } else {
        wrongCount++;
        qScore = wrongPoints;
        status = 'wrong';
      }
    } else if (isMatched(studentAns, correctAns)) {
      correctCount++;
      qScore = correctPoints;
      status = 'correct';
    } else {
      wrongCount++;
      qScore = wrongPoints;
      status = 'wrong';
    }

    // Update global score
    score += qScore;

    // Update stats based on status
    if (status === 'correct' || status === 'partial') {
      chapterStats[chap].correct++;
      chapterStats[chap].score += qScore;
      subjectStats[subject].correct++;
      subjectStats[subject].score += qScore;
      if (topic) {
        topicStats[topic].correct++;
        topicStats[topic].score += qScore;
      }
      difficultyStats[diff].correct++;
      difficultyStats[diff].score += qScore;
    } else if (status === 'blank') {
      subjectStats[subject].blank++;
      subjectStats[subject].score += qScore;
      difficultyStats[diff].blank++;
      difficultyStats[diff].score += qScore;
    } else {
      chapterStats[chap].wrong++;
      chapterStats[chap].score += qScore;
      subjectStats[subject].wrong++;
      subjectStats[subject].score += qScore;
      if (topic) {
        topicStats[topic].score += qScore;
      }
      difficultyStats[diff].wrong++;
      difficultyStats[diff].score += qScore;
    }

    const qScoreToUse = qScore;

    mappedEvaluation.push({
      qIdx: rawQIdx,
      studentAns,
      correctAns,
      status,
      subject,
      subjectId,
      chapter: chap,
      chapterId,
      topicId,
      subtopicId,
      difficulty: diff,
      paper: qData.paper || '',
      scoreReceived: qScoreToUse,
      maxMarks: correctPoints
    });
  });

  // Helper to convert stats map to array for storage
  const statsToArray = (stats: any) => {
    return Object.entries(stats).map(([name, data]: [string, any]) => ({
      name,
      ...data
    }));
  };

  const accuracy = (correctCount / (correctCount + wrongCount || 1)) * 100;
  const isAbsent = keyEntries.length > 0 && blankCount === keyEntries.length;

  return {
    score,
    correct: correctCount,
    wrong: wrongCount,
    blank: blankCount,
    isAbsent,
    accuracy,
    chapterStats: statsToArray(chapterStats),
    subjectStats: statsToArray(subjectStats),
    topicStats: statsToArray(topicStats),
    difficultyStats: statsToArray(difficultyStats),
    mappedEvaluation
  };
};

export default function Results() {
  const { role } = useAuth();
  const isAdmin = role === 'admin' || role === 'operator' || role === 'central_team';
  const canEdit = role === 'admin' || role === 'operator' || role === 'central_team';
  const [view, setView] = useState<'list' | 'detail' | 'table' | 'analytics'>('table');
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [manualData, setManualData] = useState({
    regNo: '',
    name: '',
    phone: '',
    email: '',
    testMode: 'offline' as 'offline' | 'online',
    isAbsent: false,
    studentAnswers: {} as Record<string, string>
  });
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isAdvancedFilterOpen, setIsAdvancedFilterOpen] = useState(false);
  const [tests, setTests] = useState<any[]>([]);
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedResult, setSelectedResult] = useState<any>(null);
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [selectedPaper, setSelectedPaper] = useState<string>('');
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [isSyncingGlobal, setIsSyncingGlobal] = useState(false);
  const [resultsSortConfig, setResultsSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [filters, setFilters] = useState({
    minAccuracy: 0,
    minMathAccuracy: 0,
    topOnly: false,
    subject: 'all',
    difficulty: 'all',
    testMode: 'all' as 'all' | 'offline' | 'online',
    programId: '',
    centerId: '',
    batchId: ''
  });

  const sortedResults = useMemo(() => {
    // Standardize results into map format for easiest UI consumption
    const normalizedResults = results.map(res => ({
      ...res,
      subjectStats: Array.isArray(res.subjectStats) 
        ? res.subjectStats.reduce((acc: any, s: any) => ({ ...acc, [s.name]: s }), {}) 
        : res.subjectStats,
      chapterStats: Array.isArray(res.chapterStats)
        ? res.chapterStats.reduce((acc: any, c: any) => ({ ...acc, [c.name]: c }), {})
        : res.chapterStats,
      topicStats: Array.isArray(res.topicStats)
        ? res.topicStats.reduce((acc: any, t: any) => ({ ...acc, [t.name]: t }), {})
        : res.topicStats,
      difficultyStats: Array.isArray(res.difficultyStats)
        ? res.difficultyStats.reduce((acc: any, d: any) => ({ ...acc, [d.name]: d }), {})
        : res.difficultyStats
    }));

    let filtered = [...normalizedResults];

    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(r => 
        (r.studentName || '').toLowerCase().includes(search) || 
        (r.regNo || '').toLowerCase().includes(search)
      );
    }

    if (filters.minAccuracy > 0) {
      filtered = filtered.filter(r => (r.accuracy || 0) >= filters.minAccuracy);
    }

    if (filters.minMathAccuracy > 0) {
      filtered = filtered.filter(r => {
        // Find math subject stats
        const mathStats = r.subjectStats?.Math || r.subjectStats?.Maths || r.subjectStats?.Mathematics;
        
        if (!mathStats) return false;
        const acc = (mathStats.correct / (mathStats.total - mathStats.blank || 1)) * 100;
        return acc >= filters.minMathAccuracy;
      });
    }

    if (filters.subject !== 'all') {
      filtered = filtered.filter(r => r.subjectStats && r.subjectStats[filters.subject]);
    }

    if (filters.difficulty !== 'all') {
      filtered = filtered.filter(r => r.difficultyStats && r.difficultyStats[filters.difficulty]);
    }

    if (filters.testMode !== 'all') {
      filtered = filtered.filter(r => (r.testMode || 'offline') === filters.testMode);
    }

    if (filters.programId) {
      filtered = filtered.filter(r => r.programId === filters.programId);
    }

    if (filters.centerId) {
      filtered = filtered.filter(r => r.centerId === filters.centerId);
    }

    if (filters.batchId) {
      filtered = filtered.filter(r => r.batchId === filters.batchId);
    }

    const sorted = filtered.sort((a: any, b: any) => {
      if (resultsSortConfig) {
        let aVal = a[resultsSortConfig.key];
        let bVal = b[resultsSortConfig.key];
        
        // Handle nested paths or dynamic subject scores
        if (resultsSortConfig.key.startsWith('subject_')) {
          const subName = resultsSortConfig.key.replace('subject_', '');
          aVal = a.subjectStats?.[subName]?.score || 0;
          bVal = b.subjectStats?.[subName]?.score || 0;
        }

        if (resultsSortConfig.key === 'physics') aVal = a.subjectStats?.Physics?.score || 0;
        if (resultsSortConfig.key === 'chemistry') aVal = a.subjectStats?.Chemistry?.score || 0;
        if (resultsSortConfig.key === 'math') aVal = a.subjectStats?.Math?.score || a.subjectStats?.Maths?.score || a.subjectStats?.Mathematics?.score || 0;

        if (aVal < bVal) return resultsSortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return resultsSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      }

      // Default sorting
      if (selectedTestIds.length > 1) {
        if (a.testDate !== b.testDate) return b.testDate.localeCompare(a.testDate);
      }
      return (b.score || 0) - (a.score || 0);
    });
    
    // Add ranks dynamically if multiple tests or filters active
    const ranked = sorted.map((r, i) => ({ ...r, rank: i + 1 }));

    if (filters.topOnly) {
      return ranked.slice(0, 10);
    }
    
    return ranked;
  }, [results, filters, selectedTestIds, resultsSortConfig]);

  const allAvailableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    results.forEach(res => {
      if (res.subjectStats) {
        if (Array.isArray(res.subjectStats)) {
          res.subjectStats.forEach((s: any) => { if (s.name) subjects.add(s.name); });
        } else {
          Object.keys(res.subjectStats).forEach(sName => subjects.add(sName));
        }
      }
    });
    return Array.from(subjects).sort();
  }, [results]);
  const [masters, setMasters] = useState<any>({
    programs: [],
    centers: [],
    batches: []
  });

  useEffect(() => {
    fetchTests();
    fetchMasters();
    
    // Handle action from external links
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'upload') {
      setIsBulkUploadOpen(true);
    }
  }, []);

  const fetchMasters = async () => {
    try {
      const [p, c, b] = await Promise.all([
        getDocs(collection(db, 'programs')),
        getDocs(collection(db, 'centers')),
        getDocs(collection(db, 'batches'))
      ]);
      setMasters({
        programs: p.docs.map(d => ({ id: d.id, ...d.data() })),
        centers: c.docs.map(d => ({ id: d.id, ...d.data() })),
        batches: b.docs.map(d => ({ id: d.id, ...d.data() }))
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleBulkOMRUpload = async (jsonData: any[], targetTestId: string, paperName?: string) => {
    if (!targetTestId) {
      toast.error('No test selected for upload');
      return;
    }
    
    setIsProcessingBulk(true);
    const toastId = toast.loading('Processing bulk OMR data...');
    
    try {
      const test = tests.find(t => t.id === targetTestId);
      if (!test) throw new Error('Test template not found');

      // 1. Fetch Masters for resolution
      const [studentsSnap, qbgSnap, batchSnap, centSnap, progSnap, existingResultsSnap] = await Promise.all([
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'qbgLibrary')),
        getDocs(collection(db, 'batches')),
        getDocs(collection(db, 'centers')),
        getDocs(collection(db, 'programs')),
        getDocs(query(collection(db, 'result_updated'), where('testId', '==', targetTestId)))
      ]);

      const existingResultsMap = existingResultsSnap.docs.reduce((acc: any, d) => {
        acc[String(d.data().regNo).toUpperCase()] = { id: d.id, ...d.data() };
        return acc;
      }, {});

      const studentMaster = studentsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      const qbgMap: Record<string, any> = {};
      qbgSnap.docs.forEach(docSnap => {
        const sData = docSnap.data();
        if (sData.data) {
          const sName = sData.subject;
          Object.entries(sData.data).forEach(([chId, ch]: any) => {
            if (ch.topics) {
              Object.entries(ch.topics).forEach(([tId, t]: any) => {
                qbgMap[tId] = { topic: t.name, chapter: ch.name, subject: sName };
                if (t.subtopics) {
                  Object.entries(t.subtopics).forEach(([stId, st]: any) => {
                    qbgMap[stId] = { topic: st.name, chapter: ch.name, subject: sName };
                  });
                }
              });
            }
          });
        }
      });
      
      const batchMapDetails = batchSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.id]: d.data() }), {});
      const centerMapDetails = centSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.id]: d.data() }), {});
      const progMapDetails = progSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.id]: d.data() }), {});

      // 2. Process rows
      let count = 0;
      const chunks = [];
      const CHUNK_SIZE = 450; // Leave room for other operations
      
      for (let i = 0; i < jsonData.length; i += CHUNK_SIZE) {
        chunks.push(jsonData.slice(i, i + CHUNK_SIZE));
      }

      for (const chunk of chunks) {
        const resultsBatch = writeBatch(db);
        
        for (const row of chunk) {
          const regNoRaw = row.regNo || row.registrationNo || row.rollNo || row.ID || row['Reg No'] || row.RollNum || row.EnrollmentNo || '';
          const regNo = String(regNoRaw).trim().toUpperCase();
          if (!regNo) continue;

          const student = studentMaster.find((s: any) => String(s.regNo).toUpperCase() === regNo);
          const existingResult = existingResultsMap[regNo];
          
          let newAnswers: Record<string, string> = {};
          Object.keys(row).forEach(key => {
            const lowerKey = key.toLowerCase().replace(/\s/g, '');
            const normalizedKey = key.replace(/[^0-9]/g, '');
            const isMetadata = ['regno', 'registrationno', 'rollno', 'id', 'name', 'studentname', 'phone', 'email', 'testmode', 'isabsent', 'rollnum', 'enrollmentno'].includes(lowerKey);
            
            if (normalizedKey && !isNaN(parseInt(normalizedKey)) && !isMetadata) {
              const qInt = parseInt(normalizedKey);
              const qKey = paperName ? `${paperName}-${qInt}` : String(qInt);
              const val = row[key];
              newAnswers[qKey] = (val !== null && val !== undefined) ? String(val).trim().toUpperCase() : '';
            }
          });

          const mergedAnswers = {
            ...(existingResult?.responsesJson || {}),
            ...newAnswers
          };

          const stats = evaluateResult(mergedAnswers, test.answerKey || {}, qbgMap, test.pattern);
          
          const centerId = student?.centerId || existingResult?.centerId || '';
          const batchId = student?.batchId || existingResult?.batchId || '';
          const programId = student?.programId || existingResult?.programId || '';

          const payload = {
            testId: targetTestId,
            testName: test.name || 'Unknown',
            testDate: test.date || '',
            regNo: regNo,
            studentName: student?.name || row.studentName || row.name || existingResult?.studentName || 'Unknown Student',
            testMode: row.testMode?.toLowerCase() === 'online' ? 'online' : (student?.testMode || 'offline'),
            centerId: centerId,
            centerName: centerId && centerMapDetails[centerId] ? (centerMapDetails[centerId].centerName || '') : (existingResult?.centerName || ''),
            batchId: batchId,
            batchName: batchId && batchMapDetails[batchId] ? (batchMapDetails[batchId].batchName || '') : (existingResult?.batchName || ''),
            batchCode: student?.batchCode || existingResult?.batchCode || '',
            programId: programId,
            programName: programId && progMapDetails[programId] ? (progMapDetails[programId].programName || '') : (existingResult?.programName || ''),
            phone: student?.phone || row.phone || existingResult?.phone || '',
            email: student?.email || row.email || existingResult?.email || '',
            ...stats,
            isAbsent: row.isAbsent === true || row.isAbsent === 'TRUE' || row.isAbsent === 'Yes' || row.isAbsent === 'absent',
            responsesJson: mergedAnswers,
            evaluatedAt: serverTimestamp(),
            answerKeyVersion: test.answerKeyVersion || 1
          };

          if (existingResult) {
            resultsBatch.update(doc(db, 'result_updated', existingResult.id), payload);
          } else {
            const newRef = doc(collection(db, 'result_updated'));
            resultsBatch.set(newRef, payload);
          }
          count++;
        }
        await resultsBatch.commit();
      }

      toast.success(`Successfully processed ${count} student results!`, { id: toastId });
      setIsBulkUploadOpen(false);
      setSelectedPaper('');
      fetchResults(selectedTestIds);
    } catch (err) {
      console.error(err);
      toast.error('Bulk upload failed. Check file format.', { id: toastId });
    } finally {
      setIsProcessingBulk(false);
    }
  };

  const handleSyncGlobalMetadata = async () => {
    setIsSyncingGlobal(true);
    const toastId = toast.loading('Syncing student metadata...');
    try {
      const [resultsSnap, studentsSnap, batchSnap, centSnap, progSnap] = await Promise.all([
        getDocs(collection(db, 'result_updated')),
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'batches')),
        getDocs(collection(db, 'centers')),
        getDocs(collection(db, 'programs'))
      ]);

      const studentMap = studentsSnap.docs.reduce((acc: any, d) => {
        const data = d.data();
        if (data.regNo) acc[String(data.regNo).toUpperCase()] = data;
        return acc;
      }, {});
      
      const batchMap = batchSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.id]: d.data() }), {});
      const centerMap = centSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.id]: d.data() }), {});
      const progMap = progSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.id]: d.data() }), {});

      let updateCount = 0;
      let currentBatch = writeBatch(db);
      let opCount = 0;

      for (const resDoc of resultsSnap.docs) {
        const resData = resDoc.data();
        const regNo = String(resData.regNo || '').trim().toUpperCase();
        if (!regNo) continue;

        const student = studentMap[regNo];
        if (student) {
          const updates: any = {};
          if (!resData.studentName || resData.studentName === 'Unknown Student') updates.studentName = student.name;
          if (!resData.centerId && student.centerId) updates.centerId = student.centerId;
          const centerId = updates.centerId || resData.centerId;
          if (centerId && centerMap[centerId] && !resData.centerName) updates.centerName = centerMap[centerId].centerName;
          
          if (!resData.batchId && student.batchId) updates.batchId = student.batchId;
          const batchId = updates.batchId || resData.batchId;
          if (batchId && batchMap[batchId] && !resData.batchName) updates.batchName = batchMap[batchId].batchName;
          
          if (!resData.programId && student.programId) updates.programId = student.programId;
          const progId = updates.programId || resData.programId;
          if (progId && progMap[progId] && !resData.programName) updates.programName = progMap[progId].programName;
          
          if (student.batchCode && !resData.batchCode) updates.batchCode = student.batchCode;

          if (Object.keys(updates).length > 0) {
            currentBatch.update(resDoc.ref, { ...updates, metadataSyncedAt: serverTimestamp() });
            updateCount++;
            opCount++;

            if (opCount >= 450) {
              await currentBatch.commit();
              currentBatch = writeBatch(db);
              opCount = 0;
            }
          }
        }
      }

      if (opCount > 0) {
        await currentBatch.commit();
      }

      if (updateCount > 0) {
        toast.success(`Synced metadata for ${updateCount} results!`, { id: toastId });
        fetchResults(selectedTestIds);
      } else {
        toast.success('All results are up to date.', { id: toastId });
      }
    } catch (err) {
      console.error(err);
      toast.error('Sync failed', { id: toastId });
    } finally {
      setIsSyncingGlobal(false);
    }
  };

  const handleReevaluateResults = async () => {
    const isGlobal = selectedTestIds.length === 0;
    const targetIds = isGlobal ? tests.map(t => t.id) : selectedTestIds;

    if (targetIds.length === 0) {
      toast.error('No tests found to re-evaluate');
      return;
    }
    
    const countDisplay = isGlobal
      ? "all results across ALL tests"
      : (selectedTestIds.length === 1 
          ? `results for "${tests.find(t => t.id === selectedTestIds[0])?.name}"`
          : `results for ${selectedTestIds.length} selected tests`);

    if (!confirm(`Re-evaluate ${countDisplay}? This will update scores using the latest answer key(s).`)) return;

    setIsReevaluating(true);
    const toastId = toast.loading('Re-evaluating...');
    
    try {
      // Build comprehensive QBG mapping
      const qbgSnap = await getDocs(collection(db, 'qbgLibrary'));
      const qbgMap: Record<string, any> = {};
      
      qbgSnap.docs.forEach(docSnap => {
        const sData = docSnap.data();
        if (sData && sData.data && typeof sData.data === 'object') {
          const sName = sData.subject;
          Object.entries(sData.data).forEach(([chId, ch]: any) => {
            if (ch && ch.topics) {
              Object.entries(ch.topics).forEach(([tId, t]: any) => {
                qbgMap[tId] = { topic: t.name, chapter: ch.name, subject: sName };
                if (t.subtopics) {
                  Object.entries(t.subtopics).forEach(([stId, st]: any) => {
                    qbgMap[stId] = { topic: st.name, chapter: ch.name, subject: sName };
                  });
                }
              });
            }
          });
        }
      });

      // Also fetch individual qbgMaster for backup/direct mapping
      const qbgMasterSnap = await getDocs(collection(db, 'qbgMaster'));
      qbgMasterSnap.docs.forEach(d => {
        const data = d.data();
        if (data.id && !qbgMap[data.id]) {
          qbgMap[data.id] = data;
        }
      });

      let totalUpdated = 0;

      for (const testId of targetIds) {
        // Fetch latest test doc to ensure we have the most recent answer key
        const testDoc = await getDoc(doc(db, 'tests', testId));
        if (!testDoc.exists()) continue;
        const test = { id: testDoc.id, ...testDoc.data() } as any;

        const resultsSnap = await getDocs(query(collection(db, 'result_updated'), where('testId', '==', testId)));
        if (resultsSnap.empty) continue;

        const docsToUpdate = resultsSnap.docs;
        const chunkSize = 50; // Smaller chunks for better reliability
        
        for (let i = 0; i < docsToUpdate.length; i += chunkSize) {
          const batch = writeBatch(db);
          const chunk = docsToUpdate.slice(i, i + chunkSize);
          
          chunk.forEach(docSnap => {
            const resData = docSnap.data();
            const stats = evaluateResult(resData.responsesJson || {}, test.answerKey || {}, qbgMap, test.pattern);
            batch.update(docSnap.ref, {
              ...stats,
              answerKeyVersion: test.answerKeyVersion || 1,
              reevaluatedAt: serverTimestamp()
            });
          });
          await batch.commit();
        }
        totalUpdated += docsToUpdate.length;
      }

      toast.success(`Successfully re-evaluated ${totalUpdated} results!`, { id: toastId });
      fetchResults(selectedTestIds);
    } catch (err) {
      console.error('Re-evaluation error:', err);
      toast.error('Re-evaluation failed', { id: toastId });
    } finally {
      setIsReevaluating(false);
    }
  };

  const fetchTests = async () => {
    try {
      const snap = await getDocs(collection(db, 'tests'));
      setTests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'tests');
    }
  };

  const fetchResults = async (testIds: string[]) => {
    if (testIds.length === 0) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const allResults: any[] = [];
      for (const id of testIds) {
        const q = query(collection(db, 'result_updated'), where('testId', '==', id), orderBy('score', 'desc'));
        const snap = await getDocs(q);
        allResults.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
      setResults(allResults);
      
      // Keep selectedResult in sync if it's currently open
      if (selectedResult) {
        const updated = allResults.find(r => r.id === selectedResult.id);
        if (updated) setSelectedResult(updated);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'result_updated');
    } finally {
      setLoading(false);
    }
  };

  const handleTestToggle = (testId: string) => {
    setSelectedTestIds(prev => {
      const next = prev.includes(testId) 
        ? prev.filter(id => id !== testId)
        : [...prev, testId];
      fetchResults(next);
      return next;
    });
  };

  const deleteSelectedResults = async () => {
    if (selectedResultIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedResultIds.length} selected results? This action cannot be undone.`)) return;

    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      selectedResultIds.forEach(id => {
        batch.delete(doc(db, 'result_updated', id));
      });
      await batch.commit();
      
      toast.success(`${selectedResultIds.length} results deleted successfully`);
      setSelectedResultIds([]);
      fetchResults(selectedTestIds);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'result_updated');
      toast.error('Failed to delete results');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportCSV = () => {
    if (sortedResults.length === 0) {
      toast.error('No results to export');
      return;
    }

    const testName = selectedTestIds.length === 1 
      ? tests.find(t => t.id === selectedTestIds[0])?.name || 'Results'
      : 'Combined_Results';
    
    const exportData = sortedResults.map(res => {
      const pScore = res.subjectStats?.Physics?.score || 0;
      const cScore = res.subjectStats?.Chemistry?.score || 0;
      const mScore = res.subjectStats?.Math?.score || res.subjectStats?.Maths?.score || res.subjectStats?.Mathematics?.score || 0;

      return {
        'Rank': res.rank,
        'Reg No.': res.regNo,
        'Student Name': res.studentName,
        'Center': res.centerName || '—',
        'Batch': res.batchName || '—',
        'Total Score': res.score,
        'Physics': pScore,
        'Chemistry': cScore,
        'Mathematics': mScore,
        'Correct': res.correct || 0,
        'Wrong': res.wrong || 0,
        'Unattempted': res.blank || 0,
        'Accuracy %': `${Math.round(res.accuracy)}%`,
        'Test Date': res.testDate,
        'Test Name': res.testName
      };
    });

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${testName.replace(/[^a-z0-9]/gi, '_')}_Results.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (view === 'analytics' && selectedTestIds.length > 0) {
    return (
      <GlobalAnalytics 
        results={results} 
        tests={tests} 
        onBack={() => setView('table')} 
        selectedTestIds={selectedTestIds}
        onTestToggle={handleTestToggle}
        onSelectAllTests={(allIds) => {
          setSelectedTestIds(allIds);
          fetchResults(allIds);
        }}
      />
    );
  }

  if (view === 'detail' && selectedResult) {
    return <ResultDetail result={selectedResult} onBack={() => setView('table')} onUpdate={() => fetchResults(selectedTestIds)} />;
  }

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-10 space-y-10 relative">
      {(loading || isReevaluating) && (
        <Loader fullScreen label={isReevaluating ? "Recalculating Scores..." : "Loading Data..."} />
      )}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] pl-0.5">Performance</p>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">Results & Analytics</h1>
          <p className="text-slate-500 font-medium text-sm">
            View detailed rankings, accuracy reports and student performance metrics.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative group min-w-[280px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={16} />
            <input 
              type="text"
              placeholder="Search by Student Name or Reg No..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-100 rounded-2xl pl-11 pr-4 py-2.5 text-sm font-bold focus:ring-4 focus:ring-blue-100 focus:border-blue-300 outline-none transition-all"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <Button variant="outline" size="md" onClick={handleExportCSV} disabled={selectedTestIds.length === 0 || results.length === 0} className="border-slate-200">
            <Download size={18} className="mr-2 text-emerald-600" />
            Export CSV
          </Button>

          {canEdit && selectedResultIds.length > 0 && (
            <Button 
              variant="outline" 
              size="md" 
              onClick={deleteSelectedResults} 
              disabled={isDeleting}
              className="border-rose-200 text-rose-600 hover:bg-rose-50"
            >
              <Trash2 className="mr-2 text-rose-600" size={18} />
              Delete Selected ({selectedResultIds.length})
            </Button>
          )}

          {isAdmin && (
            <Button 
              variant="outline" 
              size="md" 
              onClick={() => {
                if (selectedTestIds.length === 0) {
                  const allIds = tests.map(t => t.id);
                  setSelectedTestIds(allIds);
                  fetchResults(allIds);
                }
                setView('analytics');
              }} 
              className={cn("border-slate-200", view === 'analytics' && "bg-blue-50 border-blue-200")}
            >
              <BarChart3 size={18} className="mr-2 text-indigo-600" />
              Global Analysis
            </Button>
          )}
          {isAdmin && (
            <Button 
              variant="outline" 
              size="md" 
              onClick={() => setIsAdvancedFilterOpen(true)} 
              className={cn("border-slate-200", (filters.minAccuracy > 0 || filters.minMathAccuracy > 0 || filters.topOnly) && "border-blue-300 bg-blue-50")}
            >
              <Filter size={18} className="mr-2 text-blue-600" />
              Advanced Filter
            </Button>
          )}
          {canEdit && (
            <Button variant="primary" size="md" onClick={() => {
              if (selectedTestIds.length === 0) {
                toast.error('Please select a test first');
                return;
              }
              setShowManualEntry(true);
              setEditingResultId(null);
              setManualData({ regNo: '', name: '', phone: '', email: '', testMode: 'offline', isAbsent: false, studentAnswers: {} });
            }} className="bg-blue-600 shadow-lg shadow-blue-100">
              <Plus size={18} className="mr-2" />
              Add Result
            </Button>
          )}
          {canEdit && (
            <Button 
              variant="outline" 
              size="md" 
              onClick={handleSyncGlobalMetadata} 
              disabled={isSyncingGlobal}
              className="border-blue-100 text-blue-600 hover:bg-blue-50"
            >
              <RefreshCw size={18} className={cn("mr-2", isSyncingGlobal && "animate-spin")} />
              Sync Metadata
            </Button>
          )}
          {canEdit && (
            <Button 
              variant="outline" 
              size="md" 
              onClick={handleReevaluateResults} 
              disabled={isReevaluating}
              className="border-amber-100 text-amber-600 hover:bg-amber-50"
            >
              <RefreshCw size={18} className={cn("mr-2", isReevaluating && "animate-spin")} />
              {isReevaluating ? 'Evaluating...' : selectedTestIds.length > 0 ? 'Re-evaluate Selected' : 'Re-evaluate All Results'}
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" size="md" onClick={() => setIsBulkUploadOpen(true)} className="border-slate-200">
              <Upload size={18} className="mr-2 text-purple-600" />
              Bulk OMR
            </Button>
          )}
          <Button variant="secondary" size="md" onClick={() => setIsFilterOpen(true)} className="bg-white border border-slate-100 rounded-2xl px-6">
            <Filter size={18} className="mr-2" />
            {selectedTestIds.length === 1 
              ? tests.find(t => t.id === selectedTestIds[0])?.name 
              : selectedTestIds.length > 1 
                ? `${selectedTestIds.length} Tests Selected`
                : 'Select Test'}
          </Button>
        </div>
      </header>

      {selectedTestIds.length > 0 ? (() => {
        const validResultsSummary = results.filter(r => !r.isAbsent);
        return (
          <Card className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-8 relative overflow-hidden shadow-xl shadow-blue-100">
            <div className="relative z-10 space-y-6">
              <div>
                <p className="text-blue-100 text-[10px] font-black uppercase tracking-[0.2em]">Highest Performance</p>
                <h3 className="text-2xl font-black tracking-tight mt-1">
                  {selectedTestIds.length === 1 
                    ? tests.find(t => t.id === selectedTestIds[0])?.name 
                    : `${selectedTestIds.length} Tests Summary`}
                </h3>
              </div>
              <div className="flex space-x-8">
                <div className="space-y-1">
                  <p className="text-4xl font-black leading-none">
                    {results.length > 0 ? (results[0]?.score || 0) : 0}
                    {selectedTestIds.length === 1 && (
                      <span className="text-lg font-bold text-blue-200">
                        /{tests.find(t => t.id === selectedTestIds[0])?.maxScore || 300}
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-blue-100 font-bold uppercase tracking-widest opacity-80">Max Score</p>
                </div>
                <div className="space-y-1">
                  <p className="text-4xl font-black leading-none">
                    {validResultsSummary.length > 0 ? Math.round(validResultsSummary.reduce((acc, r) => acc + (r.score || 0), 0) / validResultsSummary.length) : 0}
                  </p>
                  <p className="text-[10px] text-blue-100 font-bold uppercase tracking-widest opacity-80">Batch Avg (Present)</p>
                </div>
              </div>
            </div>
            <div className="absolute right-[-10%] bottom-[-10%] opacity-15">
               <BarChart3 size={180} strokeWidth={1} />
            </div>
          </Card>
        );
      })() : (
        <div className="py-12 bg-white rounded-[2.5rem] border border-dashed border-slate-200 flex flex-col items-center justify-center text-center p-8 space-y-4">
           <div className="p-5 bg-slate-50 rounded-[2rem] text-slate-300">
             <Target size={40} />
           </div>
           <div>
             <p className="font-black text-slate-900 tracking-tight">Select a test to view results</p>
             <p className="text-xs text-slate-400 mt-1">Pick a test from the filter menu to see student performance</p>
           </div>
           <Button onClick={() => setIsFilterOpen(true)} size="sm">Select Test Now</Button>
        </div>
      )}

      {selectedTestIds.length > 0 ? (
        <Card className="bg-white border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1400px]">
              <thead className="bg-slate-50/50">
                <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">
                  <th className="px-6 py-5 w-10">
                    <input 
                      type="checkbox" 
                      className="rounded border-slate-300"
                      checked={sortedResults.length > 0 && selectedResultIds.length === sortedResults.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedResultIds(sortedResults.map(r => r.id));
                        } else {
                          setSelectedResultIds([]);
                        }
                      }}
                    />
                  </th>
                  <th 
                    className="px-6 py-5 cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = resultsSortConfig?.key === 'testDate' && resultsSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setResultsSortConfig({ key: 'testDate', direction: dir });
                    }}
                  >
                    Test Date {resultsSortConfig?.key === 'testDate' && (resultsSortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-5">Test Name</th>
                  <th 
                    className="px-6 py-5 cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = resultsSortConfig?.key === 'regNo' && resultsSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setResultsSortConfig({ key: 'regNo', direction: dir });
                    }}
                  >
                    Reg No. {resultsSortConfig?.key === 'regNo' && (resultsSortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className="px-6 py-5 cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = resultsSortConfig?.key === 'studentName' && resultsSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setResultsSortConfig({ key: 'studentName', direction: dir });
                    }}
                  >
                    Student Name {resultsSortConfig?.key === 'studentName' && (resultsSortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-5">Center Name</th>
                  <th className="px-6 py-5">Batch</th>
                  <th className="px-6 py-5">Mode</th>
                  <th 
                    className="px-6 py-5 text-center bg-blue-50/30 cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = resultsSortConfig?.key === 'score' && resultsSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setResultsSortConfig({ key: 'score', direction: dir });
                    }}
                  >
                    Total Score {resultsSortConfig?.key === 'score' && (resultsSortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  {allAvailableSubjects.map(sub => (
                    <th 
                      key={sub}
                      className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() => {
                        const dir = resultsSortConfig?.key === `subject_${sub}` && resultsSortConfig.direction === 'asc' ? 'desc' : 'asc';
                        setResultsSortConfig({ key: `subject_${sub}`, direction: dir });
                      }}
                    >
                      {sub} {resultsSortConfig?.key === `subject_${sub}` && (resultsSortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  ))}
                  <th 
                    className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = resultsSortConfig?.key === 'accuracy' && resultsSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setResultsSortConfig({ key: 'accuracy', direction: dir });
                    }}
                  >
                    % Accuracy {resultsSortConfig?.key === 'accuracy' && (resultsSortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-5 text-center">Rank</th>
                  <th className="px-6 py-5 text-center">Correct</th>
                  <th className="px-6 py-5 text-center">Wrong</th>
                  <th className="px-6 py-5 text-center">Unattempt</th>
                  {isAdmin && <th className="px-6 py-5 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sortedResults.map((res) => {
                  const pScore = res.subjectStats?.Physics?.score || 0;
                  const cScore = res.subjectStats?.Chemistry?.score || 0;
                  const mScore = res.subjectStats?.Math?.score || res.subjectStats?.Maths?.score || res.subjectStats?.Mathematics?.score || 0;
                  
                  return (
                    <tr key={res.id} className={cn("group hover:bg-slate-50/80 transition-colors", selectedResultIds.includes(res.id) && "bg-blue-50/50")}>
                      <td className="px-6 py-5">
                        <input 
                          type="checkbox" 
                          className="rounded border-slate-300"
                          checked={selectedResultIds.includes(res.id)}
                          onChange={() => {
                            setSelectedResultIds(prev => 
                              prev.includes(res.id) 
                                ? prev.filter(id => id !== res.id) 
                                : [...prev, res.id]
                            );
                          }}
                        />
                      </td>
                      <td className="px-6 py-5 text-[10px] font-bold text-slate-400 uppercase">{res.testDate}</td>
                      <td className="px-6 py-5 font-black text-slate-900">{res.testName}</td>
                      <td className="px-6 py-5 text-[11px] font-bold text-blue-600 uppercase">{res.regNo}</td>
                      <td className="px-6 py-5 font-black text-slate-900">
                        {res.studentName}
                        {res.isAbsent && <Badge variant="slate" className="ml-2 text-[8px] bg-slate-100 text-slate-400">ABSENT</Badge>}
                      </td>
                      <td className="px-6 py-5 text-sm font-bold text-slate-600">{res.centerName || '—'}</td>
                      <td className="px-6 py-5 text-sm font-medium text-slate-500">{res.batchName || '—'}</td>
                      <td className="px-6 py-5">
                        <Badge variant={res.testMode === 'online' ? 'blue' : 'slate'} className="text-[9px] uppercase">
                          {res.testMode || 'offline'}
                        </Badge>
                      </td>
                      <td className="px-6 py-5 text-center bg-blue-50/10">
                        <span className="text-xl font-black text-blue-600 tracking-tighter">{res.isAbsent ? '—' : res.score}</span>
                      </td>
                      {allAvailableSubjects.map(sub => (
                        <td key={sub} className="px-6 py-5 text-center">
                          <span className="text-sm font-black text-indigo-600">{res.isAbsent ? '—' : (res.subjectStats?.[sub]?.score || 0)}</span>
                        </td>
                      ))}
                      <td className="px-6 py-5 text-center">
                        <Badge variant={res.accuracy > 70 ? 'green' : 'blue'} className="text-[9px]">
                          {res.isAbsent ? '—' : `${Math.round(res.accuracy)}%`}
                        </Badge>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <div className={cn(
                          "w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs mx-auto",
                          res.isAbsent ? "text-slate-200" :
                          res.rank === 1 ? "bg-amber-100 text-amber-700" :
                          res.rank === 2 ? "bg-slate-100 text-slate-500" :
                          res.rank === 3 ? "bg-orange-50 text-orange-600" :
                          "text-slate-400"
                        )}>
                          {res.isAbsent ? '—' : `#${res.rank}`}
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center text-sm font-black text-emerald-500">{res.isAbsent ? '—' : (res.correct || 0)}</td>
                      <td className="px-6 py-5 text-center text-sm font-black text-rose-500">{res.isAbsent ? '—' : (res.wrong || 0)}</td>
                      <td className="px-6 py-5 text-center text-sm font-black text-slate-300">{res.isAbsent ? '—' : (res.blank || 0)}</td>
                      {isAdmin && (
                        <td className="px-6 py-5 text-right flex items-center justify-end gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => { setSelectedResult(res); setView('detail'); }}
                            className="hover:bg-blue-50 hover:text-blue-600 rounded-xl"
                          >
                            <ChevronRight size={18} strokeWidth={3} />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={async (e) => { 
                              e.stopPropagation();
                              if (confirm('Delete this specific result?')) {
                                try {
                                  await deleteDoc(doc(db, 'result_updated', res.id));
                                  toast.success('Result deleted');
                                  fetchResults(selectedTestIds);
                                } catch (err) {
                                  handleFirestoreError(err, OperationType.DELETE, 'result_updated');
                                }
                              }
                            }}
                            className="hover:bg-rose-50 hover:text-rose-600 rounded-xl"
                          >
                            <Trash2 size={16} strokeWidth={3} />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="py-12 bg-white rounded-[2.5rem] border border-dashed border-slate-200 flex flex-col items-center justify-center text-center p-8 space-y-4">
           <div className="p-5 bg-slate-50 rounded-[2rem] text-slate-300">
             <Target size={40} />
           </div>
           <div>
             <p className="font-black text-slate-900 tracking-tight">Select a test to view results</p>
             <p className="text-xs text-slate-400 mt-1">Pick a test from the filter menu to see student performance</p>
           </div>
           <Button onClick={() => setIsFilterOpen(true)} size="sm">Select Test Now</Button>
        </div>
      )}

      <BottomSheet isOpen={isFilterOpen} onClose={() => setIsFilterOpen(false)}>
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Select Test</h2>
              <p className="text-sm text-slate-400 font-bold">Pick one or more tests to analyze</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between ml-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Tests to Analyze</label>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 text-[9px] font-black"
                  onClick={() => {
                    if (selectedTestIds.length === tests.length) {
                      setSelectedTestIds([]);
                      setResults([]);
                    } else {
                      const allIds = tests.map(t => t.id);
                      setSelectedTestIds(allIds);
                      fetchResults(allIds);
                    }
                  }}
                >
                  {selectedTestIds.length === tests.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-2 no-scrollbar">
                {tests.map(t => (
                  <button 
                    key={t.id} 
                    onClick={() => handleTestToggle(t.id)}
                    className={cn(
                      "w-full p-4 text-left font-black rounded-2xl border-2 transition-all outline-none flex items-center justify-between group",
                      selectedTestIds.includes(t.id) 
                        ? "bg-blue-600 border-blue-600 text-white" 
                        : "bg-white border-slate-100 text-slate-700 hover:border-blue-200"
                    )}
                  >
                    <div>
                      <span className="block">{t.name}</span>
                      <span className={cn("text-[9px] font-bold uppercase tracking-widest", selectedTestIds.includes(t.id) ? "text-blue-100" : "text-slate-400")}>
                        {t.date}
                      </span>
                    </div>
                    {selectedTestIds.includes(t.id) && <CheckCircle2 size={16} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button variant="primary" className="w-full py-6 rounded-2xl shadow-xl shadow-blue-100" onClick={() => setIsFilterOpen(false)}>
            Apply & Close
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet isOpen={isAdvancedFilterOpen} onClose={() => setIsAdvancedFilterOpen(false)}>
        <div className="space-y-10">
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none">Advanced Data Filters</h2>
            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">Refine analysis based on performance</p>
          </div>

          <div className="space-y-12 py-4">
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Filter by Subject</label>
                  <Select 
                    value={filters.subject} 
                    onChange={e => setFilters({...filters, subject: e.target.value})}
                    className="rounded-2xl border-slate-100 font-bold"
                  >
                    <option value="all">All Subjects</option>
                    {allAvailableSubjects.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Program</label>
                  <Select 
                    value={filters.programId} 
                    onChange={e => setFilters({...filters, programId: e.target.value, batchId: ''})}
                    className="rounded-2xl border-slate-100 font-bold"
                  >
                    <option value="">All Programs</option>
                    {masters.programs.filter((p: any) => p.isActive).map((p: any) => (
                      <option key={p.id} value={p.id}>{p.programName}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Center</label>
                  <Select 
                    value={filters.centerId} 
                    onChange={e => setFilters({...filters, centerId: e.target.value, batchId: ''})}
                    className="rounded-2xl border-slate-100 font-bold"
                  >
                    <option value="">All Centers</option>
                    {masters.centers.filter((c: any) => c.isActive).map((c: any) => (
                      <option key={c.id} value={c.id}>{c.centerName}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Batch</label>
                  <Select 
                    value={filters.batchId} 
                    onChange={e => setFilters({...filters, batchId: e.target.value})}
                    className="rounded-2xl border-slate-100 font-bold"
                  >
                    <option value="">All Batches</option>
                    {masters.batches.filter((b: any) => 
                      b.isActive && 
                      (!filters.programId || b.programId === filters.programId) &&
                      (!filters.centerId || b.centerId === filters.centerId)
                    ).map((b: any) => (
                      <option key={b.id} value={b.id}>{b.batchName}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Test Mode</label>
                  <Select 
                    value={filters.testMode} 
                    onChange={e => setFilters({...filters, testMode: e.target.value as any})}
                    className="rounded-2xl border-slate-100 font-bold"
                  >
                    <option value="all">All Modes</option>
                    <option value="offline">Offline</option>
                    <option value="online">Online</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Filter by Difficulty</label>
                  <Select 
                    value={filters.difficulty} 
                    onChange={e => setFilters({...filters, difficulty: e.target.value})}
                    className="rounded-2xl border-slate-100 font-bold"
                  >
                    <option value="all">All Difficulty</option>
                    <option value="Easy">Easy</option>
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Min Overall Accuracy (%)</label>
                    <p className="text-[9px] text-slate-300 font-bold mt-1">Filter students above this score</p>
                  </div>
                  <span className="text-2xl font-black text-blue-600 underline decoration-blue-100 underline-offset-4">{filters.minAccuracy}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={filters.minAccuracy} 
                  onChange={e => setFilters(prev => ({ ...prev, minAccuracy: parseInt(e.target.value) }))}
                  className="w-full accent-blue-600 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Min Math Accuracy (%)</label>
                    <p className="text-[9px] text-slate-300 font-bold mt-1">Focus on core numerical proficiency</p>
                  </div>
                  <span className="text-2xl font-black text-indigo-600 underline decoration-indigo-100 underline-offset-4">{filters.minMathAccuracy}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={filters.minMathAccuracy} 
                  onChange={e => setFilters(prev => ({ ...prev, minMathAccuracy: parseInt(e.target.value) }))}
                  className="w-full accent-indigo-600 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-6 bg-slate-50 rounded-[2rem] border border-slate-100 group hover:border-blue-200 transition-all">
                <div className="space-y-1">
                  <p className="text-sm font-black text-slate-900 leading-tight">Show Top 10 Students ONLY</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Global Rank Highlight</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={filters.topOnly} 
                  onChange={e => setFilters(prev => ({ ...prev, topOnly: e.target.checked }))}
                  className="w-6 h-6 rounded-lg border-slate-200 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <Button 
                variant="outline" 
                size="lg" 
                className="flex-1 py-6 rounded-3xl border-slate-200 font-bold text-slate-400 hover:bg-slate-50 transition-colors"
                onClick={() => {
                  setFilters({ 
                    minAccuracy: 0, 
                    minMathAccuracy: 0, 
                    topOnly: false, 
                    subject: 'all', 
                    difficulty: 'all', 
                    testMode: 'all',
                    programId: '',
                    centerId: '',
                    batchId: ''
                  });
                  setIsAdvancedFilterOpen(false);
                }}
              >
                Reset Defaults
              </Button>
              <Button 
                variant="primary" 
                size="lg" 
                className="flex-1 py-6 rounded-3xl bg-blue-600 shadow-xl shadow-blue-100 font-black text-lg"
                onClick={() => setIsAdvancedFilterOpen(false)}
              >
                Apply Filters
              </Button>
            </div>
          </div>
        </div>
      </BottomSheet>

      {/* Manual Entry Modal */}
      <AnimatePresence>
        {showManualEntry && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !isSavingManual && setShowManualEntry(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-2xl bg-white rounded-[2.5rem] p-8 space-y-8 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-slate-900">{editingResultId ? 'Edit Result' : 'Manual Result Entry'}</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Test: {tests.find(t => t.id === selectedTestIds[0])?.name}</p>
                </div>
                <button onClick={() => setShowManualEntry(false)} className="p-2 bg-slate-50 rounded-xl">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Registration Number</label>
                    <div className="relative">
                      <Input 
                        placeholder="Enter Student Reg No."
                        value={manualData.regNo}
                        onChange={async (e) => {
                          const val = e.target.value.toUpperCase();
                          setManualData({ ...manualData, regNo: val });
                          
                          // Auto-fetch student if exists
                          if (val.length >= 3) {
                            try {
                              const q = query(collection(db, 'students'), where('regNo', '==', val));
                              const snap = await getDocs(q);
                              if (!snap.empty) {
                                const sData = snap.docs[0].data();
                                setManualData(prev => ({
                                  ...prev,
                                  regNo: val,
                                  name: sData.name || prev.name,
                                  phone: sData.phone || prev.phone,
                                  email: sData.email || prev.email
                                }));
                              }
                            } catch (err) {
                              console.error('Error fetching student:', err);
                            }
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Student Name</label>
                    <Input 
                      placeholder="Enter Full Name"
                      value={manualData.name}
                      onChange={e => setManualData({ ...manualData, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Phone Number</label>
                    <Input 
                      placeholder="Enter Phone Number"
                      value={manualData.phone}
                      onChange={e => setManualData({ ...manualData, phone: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email ID</label>
                    <Input 
                      placeholder="Enter Email Address"
                      value={manualData.email}
                      onChange={e => setManualData({ ...manualData, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Test Mode</label>
                    <Select 
                      value={manualData.testMode}
                      onChange={e => setManualData({ ...manualData, testMode: e.target.value as 'offline' | 'online' })}
                      className="font-bold border-slate-100 rounded-2xl shadow-sm"
                    >
                      <option value="offline">Offline</option>
                      <option value="online">Online</option>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <input 
                    type="checkbox"
                    id="isAbsent"
                    className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    checked={manualData.isAbsent}
                    onChange={e => setManualData({ ...manualData, isAbsent: e.target.checked })}
                  />
                  <label htmlFor="isAbsent" className="flex-1 cursor-pointer">
                    <p className="text-sm font-black text-slate-900">Mark student as Absent</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Score and stats will be marked as "-"</p>
                  </label>
                </div>

                <div className={cn("space-y-4 transition-opacity", manualData.isAbsent && "opacity-30 pointer-events-none")}>
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Question Responses {manualData.isAbsent && "(Disabled)"}</label>
                    <Badge variant="blue">{tests.find(t => t.id === selectedTestIds[0])?.totalQuestions || 0} Questions</Badge>
                  </div>
                  
                  <div className="space-y-6 max-h-[400px] overflow-y-auto p-2 no-scrollbar">
                    {(() => {
                      const test = tests.find(t => t.id === selectedTestIds[0]);
                      if (test?.pattern === 'JEE_ADVANCED' && test.advancedPapers) {
                        return test.advancedPapers.map((paperName: string) => {
                          // Find questions for this paper in answerKey
                          const paperQNums = Object.keys(test.answerKey || {})
                            .filter(k => k.startsWith(`${paperName}-`))
                            .map(k => k.replace(`${paperName}-`, ''))
                            .sort((a, b) => parseInt(a) - parseInt(b));

                          if (paperQNums.length === 0) return null;

                          return (
                            <div key={paperName} className="space-y-3">
                              <h4 className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em] border-b border-slate-100 pb-1">{paperName}</h4>
                              <div className="grid grid-cols-5 sm:grid-cols-8 gap-3">
                                {paperQNums.map((qNum) => {
                                  const qKey = `${paperName}-${qNum}`;
                                  return (
                                    <div key={qKey} className="space-y-1 text-center">
                                      <label className="text-[9px] font-black text-slate-400">Q.{qNum}</label>
                                      <Input 
                                        className="text-center px-1 font-bold h-10"
                                        maxLength={10}
                                        value={manualData.studentAnswers[qKey] || ''}
                                        placeholder="-"
                                        onChange={e => {
                                          setManualData({
                                            ...manualData,
                                            studentAnswers: {
                                              ...manualData.studentAnswers,
                                              [qKey]: e.target.value.toUpperCase()
                                            }
                                          });
                                        }}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        });
                      }

                      // Default flat numbering for other patterns
                      return (
                        <div className="grid grid-cols-5 sm:grid-cols-8 gap-3">
                          {Array.from({ length: test?.totalQuestions || 0 }).map((_, i) => {
                            const qIdx = String(i + 1);
                            return (
                              <div key={qIdx} className="space-y-1 text-center">
                                <label className="text-[9px] font-black text-slate-400">Q.{qIdx}</label>
                                <Input 
                                  className="text-center px-1 font-bold h-10"
                                  maxLength={10}
                                  value={manualData.studentAnswers[qIdx] || ''}
                                  placeholder="-"
                                  onChange={e => {
                                    setManualData({
                                      ...manualData,
                                      studentAnswers: {
                                        ...manualData.studentAnswers,
                                        [qIdx]: e.target.value.toUpperCase()
                                      }
                                    });
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <Button 
                  variant="primary" 
                  className="w-full py-6 text-lg shadow-xl shadow-blue-100"
                  disabled={isSavingManual || !manualData.regNo}
                  onClick={async () => {
                    try {
                      setIsSavingManual(true);
                      const test = tests.find(t => t.id === selectedTestIds[0]);
                      if (!test) return;

                      // 1. Fetch data for mapping
                      const [studentsSnap, qbgSnap, batchSnap, centSnap] = await Promise.all([
                        getDocs(query(collection(db, 'students'), where('regNo', '==', manualData.regNo))),
                        getDocs(collection(db, 'qbgMaster')),
                        getDocs(collection(db, 'batches')),
                        getDocs(collection(db, 'centers'))
                      ]);

                      const studentInfo = studentsSnap.docs[0]?.data() || {};
                      const qbgMap = qbgSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.data().id]: d.data() }), {});
                      const batchMap = batchSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.id]: d.data() }), {});
                      const centerMap = centSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.id]: d.data() }), {});

                      // 2. Scoring Logic (Unified)
                      const stats = evaluateResult(manualData.studentAnswers, test.answerKey || {}, qbgMap, test.pattern);

                      const resultPayload = {
                        testId: selectedTestIds[0],
                        testName: test.name || '',
                        testDate: test.date || '',
                        regNo: manualData.regNo,
                        studentName: manualData.name || studentInfo.name || 'Student (Manual)',
                        testMode: manualData.testMode || studentInfo.testMode || 'offline',
                        centerId: studentInfo.centerId || '',
                        centerName: studentInfo.centerId && centerMap[studentInfo.centerId] ? (centerMap[studentInfo.centerId].centerName || '') : '',
                        batchId: studentInfo.batchId || '',
                        batchName: batchMap[studentInfo.batchId]?.batchName || '',
                        phone: manualData.phone || studentInfo.phone || '',
                        email: manualData.email || studentInfo.email || '',
                        ...stats,
                        isAbsent: manualData.isAbsent || stats.isAbsent,
                        partial: 0,
                        responsesJson: manualData.studentAnswers || {},
                        evaluatedAt: serverTimestamp(),
                        answerKeyVersion: test.answerKeyVersion || 1
                      };

                      // 3. Save to Firebase
                      if (editingResultId) {
                        await updateDoc(doc(db, 'result_updated', editingResultId), resultPayload);
                      } else {
                        await addDoc(collection(db, 'result_updated'), resultPayload);
                      }

                      // 4. Update Student Master if exists
                      if (studentsSnap.docs[0]) {
                        await updateDoc(doc(db, 'students', studentsSnap.docs[0].id), {
                          name: manualData.name || studentInfo.name || '',
                          phone: manualData.phone || studentInfo.phone || '',
                          email: manualData.email || studentInfo.email || ''
                        });
                      }

                      toast.success(editingResultId ? 'Result updated successfully!' : 'Result saved successfully!');
                      setShowManualEntry(false);
                      setEditingResultId(null);
                      setManualData({ regNo: '', name: '', phone: '', email: '', testMode: 'offline', isAbsent: false, studentAnswers: {} });
                      fetchResults(selectedTestIds);
                    } catch (err) {
                      console.error(err);
                      handleFirestoreError(err, OperationType.WRITE, 'result_updated');
                      toast.error('Failed to save manual result');
                    } finally {
                      setIsSavingManual(false);
                    }
                  }}
                >
                  {isSavingManual ? 'Saving...' : 'Finalize & Post Score'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <BottomSheet isOpen={isBulkUploadOpen} onClose={() => setIsBulkUploadOpen(false)}>
        <div className="space-y-6 text-center">
          <div className="w-20 h-20 bg-purple-50 rounded-[2rem] flex items-center justify-center text-purple-600 mx-auto">
             <Upload size={32} strokeWidth={3} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Bulk OMR Upload</h2>
            <p className="text-sm text-slate-400 font-bold mt-2">Upload multiple student responses for a test</p>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left px-1">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Process for Test</label>
                <Select 
                  value={selectedTestIds[0] || ''} 
                  onChange={e => {
                    if (e.target.value) {
                      setSelectedTestIds([e.target.value]);
                      setSelectedPaper(''); // Reset paper when test changes
                    }
                  }}
                  className="font-bold border-slate-100 rounded-2xl"
                >
                  <option value="">Select Test...</option>
                  {tests.map(t => <option key={t.id} value={t.id}>{t.name} ({t.date})</option>)}
                </Select>
              </div>

              {selectedTestIds[0] && tests.find(t => t.id === selectedTestIds[0])?.pattern === 'JEE_ADVANCED' && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Paper</label>
                  <Select 
                    value={selectedPaper}
                    onChange={e => setSelectedPaper(e.target.value)}
                    className="font-bold border-slate-100 rounded-2xl border-blue-200 bg-blue-50/30"
                  >
                    <option value="">Choose Paper...</option>
                    {tests.find(t => t.id === selectedTestIds[0])?.advancedPapers?.map((p: string) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

            <div className={cn(
              "p-8 bg-[#F8FAFC] border-2 border-dashed border-slate-200 rounded-[2.5rem] relative group cursor-pointer hover:border-blue-200 transition-colors",
              (!selectedTestIds[0] || (tests.find(t => t.id === selectedTestIds[0])?.pattern === 'JEE_ADVANCED' && !selectedPaper)) && "opacity-50 pointer-events-none"
            )}>
              <input 
                type="file" 
                accept=".csv,.xlsx,.xls" 
                className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file || !selectedTestIds[0]) return;
                  
                  const targetTest = tests.find(t => t.id === selectedTestIds[0]);
                  if (targetTest?.pattern === 'JEE_ADVANCED' && !selectedPaper) {
                    toast.error('Please select a paper first');
                    return;
                  }

                  const reader = new FileReader();
                  reader.onload = async (event) => {
                    const data = new Uint8Array(event.target?.result as ArrayBuffer);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet);
                    handleBulkOMRUpload(jsonData, selectedTestIds[0], selectedPaper);
                  };
                  reader.readAsArrayBuffer(file);
                }}
              />
              <div className="space-y-2">
                <span className="block font-black text-slate-900">Click to select CSV/Excel Results</span>
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
                  Required: regNo, testMode (online/offline) <br/>
                  Questions as columns: 1, 2, 3... or Q1, Q2...
                </span>
              </div>
            </div>

            {selectedTestIds[0] && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-[10px] font-black text-blue-600 uppercase tracking-widest h-12 rounded-2xl border border-blue-50 bg-blue-50/20"
                onClick={() => {
                  const targetTest = tests.find(t => t.id === selectedTestIds[0]);
                  if (!targetTest) return;

                  // Create template data
                  const templateRow: any = {
                    'regNo': 'REG001',
                    'testMode': 'offline',
                    'isAbsent': 'No'
                  };

                  // Add question columns
                  const qKeys = Object.keys(targetTest.answerKey || {})
                    .filter(k => !selectedPaper || k.startsWith(`${selectedPaper}-`))
                    .map(k => k.includes('-') ? k.split('-')[1] : k)
                    .sort((a, b) => parseInt(a) - parseInt(b));

                  qKeys.forEach(qNum => {
                    templateRow[qNum] = ''; // Placeholder for answers
                  });

                  const ws = XLSX.utils.json_to_sheet([templateRow]);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "OMR Template");
                  XLSX.writeFile(wb, `${targetTest.name}${selectedPaper ? `_${selectedPaper}` : ''}_Template.xlsx`);
                }}
              >
                <Download size={14} className="mr-2" />
                Download {selectedPaper || ''} OMR Template
              </Button>
            )}

            {isProcessingBulk && <Loader label="Processing Data..." />}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

function GlobalAnalytics({ results, tests, onBack, selectedTestIds, onTestToggle, onSelectAllTests }: { 
  results: any[], 
  tests: any[], 
  onBack: () => void,
  selectedTestIds: string[],
  onTestToggle?: (id: string) => void,
  onSelectAllTests?: (ids: string[]) => void
}) {
  const [activeAnalysisView, setActiveAnalysisView] = useState<'summary' | 'question' | 'topic' | 'student'>('summary');
  const [qbgMap, setQbgMap] = useState<Record<string, any>>({});
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedTestModes, setSelectedTestModes] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]); // Array of sKeys (regNo_name)
  const [studentSearchFocused, setStudentSearchFocused] = useState(false);
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['correct', 'incorrect', 'unattempted', 'accuracy']);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [topicSortConfig, setTopicSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [studentSortConfig, setStudentSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [isColumnDropdownVisible, setIsColumnDropdownVisible] = useState(false);

  useEffect(() => {
    // Initial sync removed as it is now managed by parent props
  }, [tests.length]);

  useEffect(() => {
    async function fetchQbg() {
      try {
        const qbgSnap = await getDocs(collection(db, 'qbgLibrary'));
        const map: Record<string, any> = {};
        
        qbgSnap.docs.forEach(docSnap => {
          const sData = docSnap.data();
          const sName = sData.subject;
          
          if (sData.data) {
            Object.entries(sData.data).forEach(([chId, ch]: any) => {
              if (ch.topics) {
                Object.entries(ch.topics).forEach(([tId, t]: any) => {
                  map[tId] = { topic: t.name, chapter: ch.name, subject: sName };
                  if (t.subtopics) {
                    Object.entries(t.subtopics).forEach(([stId, st]: any) => {
                      map[stId] = { topic: st.name, chapter: ch.name, subject: sName };
                    });
                  }
                });
              }
            });
          }
        });
        setQbgMap(map);
      } catch (err) {
        console.error('Failed to fetch qbgLibrary for topic names:', err);
      }
    }
    fetchQbg();
  }, []);

  const aggregateStats = useMemo(() => {
    if (results.length === 0) return null;
    const subjects: any = {};
    const chapters: any = {};
    const topics: any = {};
    const difficulties: any = {};
    const paperStats: any = {};
    const questionMap: any = {};
    const topicTable: any = {};

    const studentAggregates: Record<string, any> = {};
    
    results.forEach(res => {
      // Apply Test Filter
      if (selectedTestIds.length > 0 && !selectedTestIds.includes(res.testId)) return;
      
      // Apply Test Mode Filter
      if (selectedTestModes.length > 0 && !selectedTestModes.includes(res.testMode || 'offline')) return;
      
      const sKey = `${res.regNo || 'NOREG'}_${res.studentName}`;
      if (!studentAggregates[sKey]) {
        studentAggregates[sKey] = {
          regNo: res.regNo || '—',
          studentName: res.studentName,
          centerName: res.centerName || '—',
          batchName: res.batchName || '—',
          batchCode: res.batchCode || '—',
          sKey: sKey,
          testsTaken: 0,
          totalScore: 0,
          totalCorrect: 0,
          totalWrong: 0,
          totalBlank: 0,
          totalQuestions: 0,
          scores: []
        };
      }
      studentAggregates[sKey].testsTaken++;
      studentAggregates[sKey].totalScore += res.score || 0;
      studentAggregates[sKey].totalCorrect += res.correct || 0;
      studentAggregates[sKey].totalWrong += res.wrong || 0;
      studentAggregates[sKey].totalBlank += res.blank || 0;
      studentAggregates[sKey].totalQuestions += (res.correct || 0) + (res.wrong || 0) + (res.blank || 0);
      studentAggregates[sKey].scores.push(res.score || 0);
      
      if (res.centerName && res.centerName !== '—') studentAggregates[sKey].centerName = res.centerName;
      if (res.batchName && res.batchName !== '—') studentAggregates[sKey].batchName = res.batchName;
      if (res.batchCode) studentAggregates[sKey].batchCode = res.batchCode;

      // Multi-student selection filter
      if (selectedStudents.length > 0 && !selectedStudents.includes(sKey)) return;

      // Apply Student Search Filter (legacy fuzzy)
      if (studentSearch && selectedStudents.length === 0) {
        const search = studentSearch.toLowerCase();
        const matchesName = (res.studentName || '').toLowerCase().includes(search);
        const matchesRegNo = (res.regNo || '').toLowerCase().includes(search);
        if (!matchesName && !matchesRegNo) return;
      }

      // Per Student Mapped Evaluation
      const evaluations = res.mappedEvaluation || [];
      evaluations.forEach((ev: any) => {
        const sName = ev.subject || 'N/A';
        const cName = ev.chapter || 'N/A';
        const tName = qbgMap[ev.topicId]?.topic || ev.topic || ev.topicId || 'N/A';
        const dName = ev.difficulty || 'Normal';
        const pName = ev.paper || 'N/A';

        // Paper Stats
        if (pName !== 'N/A') {
          if (!paperStats[pName]) paperStats[pName] = { totalQuestions: 0, totalCorrect: 0, totalScore: 0, maxScore: 0 };
          paperStats[pName].totalQuestions++;
          paperStats[pName].totalScore += ev.scoreReceived || 0;
          paperStats[pName].maxScore += ev.maxMarks || 0;
          if (ev.status === 'correct') paperStats[pName].totalCorrect++;
        }

        // Apply filters
        if (selectedSubjects.length > 0 && !selectedSubjects.includes(sName)) return;
        if (selectedChapters.length > 0 && !selectedChapters.includes(cName)) return;
        if (selectedTopics.length > 0 && !selectedTopics.includes(tName)) return;

        // Subject Stats
        if (!subjects[sName]) subjects[sName] = { totalQuestions: 0, totalCorrect: 0 };
        subjects[sName].totalQuestions++;
        if (ev.status === 'correct') subjects[sName].totalCorrect++;

        // Chapter Stats
        if (!chapters[cName]) chapters[cName] = { totalQuestions: 0, totalCorrect: 0, subject: sName };
        chapters[cName].totalQuestions++;
        if (ev.status === 'correct') chapters[cName].totalCorrect++;

        // Topic Stats (Summary Cards)
        if (!topics[tName]) topics[tName] = { totalQuestions: 0, totalCorrect: 0, chapter: cName };
        topics[tName].totalQuestions++;
        if (ev.status === 'correct') topics[tName].totalCorrect++;

        // Difficulty Stats
        if (!difficulties[dName]) difficulties[dName] = { totalQuestions: 0, totalCorrect: 0 };
        difficulties[dName].totalQuestions++;
        if (ev.status === 'correct') difficulties[dName].totalCorrect++;

        // Question-wise Summary
        const qKey = `${ev.testId}_${ev.qIdx}`;
        if (!questionMap[qKey]) {
          questionMap[qKey] = { 
            qIdx: ev.qIdx, 
            subject: sName, 
            chapter: cName, 
            topic: tName, 
            correct: 0, 
            incorrect: 0, 
            unattempted: 0,
            num: parseInt(ev.qIdx.replace(/[^0-9]/g, '')) || 0
          };
        }
        if (ev.status === 'correct') questionMap[qKey].correct++;
        else if (ev.status === 'wrong') questionMap[qKey].incorrect++;
        else questionMap[qKey].unattempted++;

        // Topic-wise Table
        if (!topicTable[tName]) {
          topicTable[tName] = { subject: sName, chapter: cName, topic: tName, correct: 0, incorrect: 0, unattempted: 0, qSet: new Set() };
        }
        topicTable[tName].qSet.add(qKey);
        if (ev.status === 'correct') topicTable[tName].correct++;
        else if (ev.status === 'wrong') topicTable[tName].incorrect++;
        else topicTable[tName].unattempted++;
      });
    });

    let questionsList = Object.values(questionMap);
    if (sortConfig) {
      questionsList.sort((a: any, b: any) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];
        
        if (sortConfig.key === 'accuracy') {
          aVal = (a.correct / (a.correct + a.incorrect + a.unattempted || 1));
          bVal = (b.correct / (b.correct + b.incorrect + b.unattempted || 1));
        }

        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      questionsList.sort((a: any, b: any) => a.num - b.num);
    }

    let topicTableList = Object.values(topicTable).map((t: any) => ({
      ...t,
      questionsCount: t.qSet.size,
      totalAttempts: t.correct + t.incorrect + t.unattempted,
      accuracy: Math.round((t.correct / (t.correct + t.incorrect || 1)) * 100)
    }));

    if (topicSortConfig) {
      topicTableList.sort((a: any, b: any) => {
        const aVal = a[topicSortConfig.key];
        const bVal = b[topicSortConfig.key];
        if (aVal < bVal) return topicSortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return topicSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      topicTableList.sort((a: any, b: any) => b.totalAttempts - a.totalAttempts);
    }

    let studentTableList = Object.values(studentAggregates).map((s: any) => ({
      ...s,
      avgScore: Math.round(s.totalScore / s.testsTaken),
      accuracy: Math.round((s.totalCorrect / (s.totalCorrect + s.totalWrong || 1)) * 100)
    }));

    // For the suggestion list, we want all students regardless of selectedStudents filter
    const allStudentsList = [...studentTableList];

    if (studentSortConfig) {
      studentTableList.sort((a: any, b: any) => {
        const aVal = a[studentSortConfig.key];
        const bVal = b[studentSortConfig.key];
        if (aVal < bVal) return studentSortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return studentSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      studentTableList.sort((a: any, b: any) => b.totalScore - a.totalScore);
    }

    return { 
      subjects, 
      chapters, 
      topics, 
      difficulties, 
      paperStats,
      questions: questionsList, 
      topicTable: topicTableList, 
      studentTable: studentTableList,
      allStudents: allStudentsList 
    };
  }, [results, qbgMap, selectedSubjects, selectedChapters, selectedTopics, studentSearch, selectedStudents, studentSortConfig, sortConfig, topicSortConfig]);

  // Derived filter options
  const filterOptions = useMemo(() => {
    const s = new Set<string>();
    const c = new Set<string>();
    const t = new Set<string>();
    const ts = new Set<string>();
    const tm = new Set<string>();
    const sn = new Set<string>();
    const rn = new Set<string>();

    results.forEach(res => {
      ts.add(res.testId);
      tm.add(res.testMode || 'offline');
      if (res.studentName) sn.add(res.studentName);
      if (res.regNo) rn.add(res.regNo);
      
      const evaluations = res.mappedEvaluation || [];
      evaluations.forEach((ev: any) => {
        if (ev.subject) s.add(ev.subject);
        if (ev.chapter) c.add(ev.chapter);
        const name = qbgMap[ev.topicId]?.topic || ev.topic || ev.topicId;
        if (name) t.add(name);
      });
    });

    return {
      subjects: Array.from(s).sort(),
      chapters: Array.from(c).sort(),
      topics: Array.from(t).sort(),
      testModes: Array.from(tm).sort(),
      tests: tests,
      studentNames: Array.from(sn).sort(),
      regNos: Array.from(rn).sort()
    };
  }, [results, qbgMap, tests]);

  const filteredResultsCount = useMemo(() => {
    return results.filter(r => selectedTestIds.includes(r.testId)).length;
  }, [results, selectedTestIds]);

  if (!aggregateStats) return (
    <div className="flex flex-col items-center justify-center p-20 space-y-4">
      <Loader label="Preparing Analytics..." />
      <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Processing response matrices</p>
    </div>
  );

  const handleExportGlobal = () => {
    if (aggregateStats.studentTable.length === 0) {
      toast.error('No analysis data to export');
      return;
    }

    const exportData = aggregateStats.studentTable.map((s: any) => ({
      'Reg No': s.regNo,
      'Student Name': s.studentName,
      'Tests Taken': s.testsTaken,
      'Total Score': s.totalScore,
      'Avg Score': s.avgScore,
      'Total Correct': s.totalCorrect,
      'Total Wrong': s.totalWrong,
      'Total Blank': s.totalBlank,
      'Accuracy %': `${s.accuracy}%`
    }));

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `Global_Analysis_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-10 space-y-10 relative">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <button onClick={onBack} className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 transition-colors">
            <ChevronLeft size={24} strokeWidth={3} className="text-slate-900" />
          </button>
          <div className="space-y-1">
            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.3em] pl-0.5">Test Summary</p>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Global QBG Analysis</h2>
            <p className="text-slate-500 font-medium text-sm">
              {selectedTestIds.length === 1 && tests.find(t => t.id === selectedTestIds[0]) 
                ? tests.find(t => t.id === selectedTestIds[0])?.name 
                : `${selectedTestIds.length} Tests Selected`} • {filteredResultsCount} Students
            </p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="md" onClick={handleExportGlobal} className="border-slate-200">
            <Download size={18} className="mr-2 text-emerald-600" />
            Export CSV
          </Button>
          
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={16} />
            <input 
              type="text"
              placeholder="Search (Name/RegNo)..."
              value={studentSearch}
              onChange={(e) => {
                setStudentSearch(e.target.value);
                setStudentSearchFocused(true);
              }}
              onFocus={() => setStudentSearchFocused(true)}
              className="bg-white border border-slate-100 rounded-xl pl-10 pr-4 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none w-[200px] transition-all"
            />
            {studentSearch && (
              <button 
                onClick={() => setStudentSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
              >
                <X size={14} />
              </button>
            )}

            {/* Search Suggestions Dropdown */}
            <AnimatePresence>
              {studentSearchFocused && (studentSearch.length > 1 || selectedStudents.length > 0) && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setStudentSearchFocused(false)} 
                  />
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute top-full right-0 mt-2 w-[300px] bg-white border border-slate-100 rounded-2xl shadow-xl z-50 overflow-hidden"
                  >
                    {selectedStudents.length > 0 && (
                      <div className="p-3 bg-slate-50/50 border-b border-slate-50">
                         <div className="flex items-center justify-between mb-2">
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Selected Students</span>
                           <button 
                             onClick={() => setSelectedStudents([])}
                             className="text-[10px] font-black text-rose-500 hover:text-rose-600 uppercase"
                           >
                             Clear
                           </button>
                         </div>
                         <div className="flex flex-wrap gap-2">
                            {selectedStudents.map(sKey => {
                              const s = aggregateStats?.allStudents?.find((x: any) => x.sKey === sKey);
                              return (
                                <button
                                  key={sKey}
                                  onClick={() => setSelectedStudents(prev => prev.filter(x => x !== sKey))}
                                  className="flex items-center gap-2 px-2.5 py-1 bg-white border border-slate-100 rounded-lg text-[9px] font-black text-slate-600 hover:bg-rose-50 hover:border-rose-100 hover:text-rose-600 transition-all"
                                >
                                  {s?.studentName || sKey}
                                  <X size={10} />
                                </button>
                              );
                            })}
                         </div>
                      </div>
                    )}

                    <div className="max-h-[300px] overflow-y-auto no-scrollbar">
                      {aggregateStats?.allStudents
                        ?.filter((s: any) => {
                          if (selectedStudents.includes(s.sKey)) return false;
                          const search = studentSearch.toLowerCase();
                          return s.studentName.toLowerCase().includes(search) || (s.regNo || '').toLowerCase().includes(search);
                        })
                        .slice(0, 10)
                        .map((s: any) => (
                          <button
                            key={s.sKey}
                            onClick={() => {
                              setSelectedStudents(prev => [...prev, s.sKey]);
                              setStudentSearch('');
                            }}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-blue-50/50 transition-colors border-b border-slate-50 last:border-0 text-left"
                          >
                            <div className="flex flex-col">
                              <span className="text-sm font-black text-slate-900">{s.studentName}</span>
                              <span className="text-[10px] font-bold text-slate-400 uppercase">Reg: {s.regNo}</span>
                            </div>
                            <Plus size={14} className="text-blue-500" />
                          </button>
                        ))
                      }
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          <div className="relative">
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={() => setIsColumnDropdownVisible(!isColumnDropdownVisible)}
              className="bg-white border border-slate-100 rounded-xl px-4 text-slate-600"
            >
              <Layout size={16} className="mr-2" />
              Columns
            </Button>
            
            {isColumnDropdownVisible && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-100 rounded-2xl shadow-xl z-50 p-4 space-y-2">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Show/Hide Columns</p>
                {[
                  { id: 'correct', label: 'Correct' },
                  { id: 'incorrect', label: 'Incorrect' },
                  { id: 'unattempted', label: 'Unattempted' },
                  { id: 'accuracy', label: 'Accuracy %' }
                ].map(col => (
                  <label key={col.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors">
                    <input 
                      type="checkbox" 
                      checked={visibleColumns.includes(col.id)}
                      onChange={() => {
                        setVisibleColumns(prev => 
                          prev.includes(col.id) ? prev.filter(x => x !== col.id) : [...prev, col.id]
                        );
                      }}
                      className="rounded border-slate-200 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs font-bold text-slate-600">{col.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Button 
            variant="secondary" 
            size="sm" 
            onClick={() => setIsFilterVisible(!isFilterVisible)}
            className={cn("bg-white border border-slate-100 rounded-xl px-4", isFilterVisible && "bg-slate-900 text-white")}
          >
            <Filter size={16} className="mr-2" />
            Filters
          </Button>
          <div className="flex bg-slate-100 p-1.5 rounded-2xl">
            <button 
              onClick={() => setActiveAnalysisView('summary')}
              className={cn(
                "px-5 py-2.5 rounded-xl text-xs font-black transition-all",
                activeAnalysisView === 'summary' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Summary
            </button>
            <button 
              onClick={() => setActiveAnalysisView('question')}
              className={cn(
                "px-5 py-2.5 rounded-xl text-xs font-black transition-all",
                activeAnalysisView === 'question' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Question-wise
            </button>
            <button 
              onClick={() => setActiveAnalysisView('topic')}
              className={cn(
                "px-5 py-2.5 rounded-xl text-xs font-black transition-all",
                activeAnalysisView === 'topic' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Topic-wise
            </button>
            <button 
              onClick={() => setActiveAnalysisView('student')}
              className={cn(
                "px-5 py-2.5 rounded-xl text-xs font-black transition-all",
                activeAnalysisView === 'student' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Student-wise
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {isFilterVisible && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }} 
            animate={{ height: 'auto', opacity: 1 }} 
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <Card className="p-8 border-slate-100 bg-slate-50/50 space-y-8 rounded-[2rem]">
               <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                  {/* Test Filter */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Select Tests</label>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-5 text-[9px] font-black"
                        onClick={() => onSelectAllTests ? onSelectAllTests(selectedTestIds.length === tests.length ? [] : tests.map(t => t.id)) : null}
                      >
                        {selectedTestIds.length === tests.length ? 'Reset' : 'Select All'}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2 max-h-[150px] overflow-y-auto no-scrollbar pr-2">
                       {tests.map(t => (
                         <button 
                          key={t.id} 
                          onClick={() => onTestToggle ? onTestToggle(t.id) : null}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-black transition-all",
                            selectedTestIds.includes(t.id) ? "bg-slate-900 text-white shadow-md shadow-slate-200" : "bg-white text-slate-500 border border-slate-100"
                          )}
                         >
                           {t.name}
                         </button>
                       ))}
                    </div>
                  </div>
                  {/* Subject Filter */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Subjects</label>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-5 text-[9px] font-black"
                        onClick={() => setSelectedSubjects(selectedSubjects.length === filterOptions.subjects.length ? [] : filterOptions.subjects)}
                      >
                        {selectedSubjects.length === filterOptions.subjects.length ? 'Reset' : 'Select All'}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                       {filterOptions.subjects.map(s => (
                         <button 
                          key={s} 
                          onClick={() => setSelectedSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-black transition-all",
                            selectedSubjects.includes(s) ? "bg-blue-600 text-white shadow-md shadow-blue-100" : "bg-white text-slate-500 border border-slate-100"
                          )}
                         >
                           {s}
                         </button>
                       ))}
                    </div>
                  </div>

                  {/* Chapter Filter */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Chapters</label>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-5 text-[9px] font-black"
                        onClick={() => setSelectedChapters(selectedChapters.length === filterOptions.chapters.length ? [] : filterOptions.chapters)}
                      >
                        {selectedChapters.length === filterOptions.chapters.length ? 'Reset' : 'Select All'}
                      </Button>
                    </div>
                    <div className="max-h-[150px] overflow-y-auto no-scrollbar flex flex-wrap gap-2 pr-2">
                       {filterOptions.chapters.map(c => (
                         <button 
                          key={c} 
                          onClick={() => setSelectedChapters(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-black transition-all",
                            selectedChapters.includes(c) ? "bg-indigo-600 text-white shadow-md shadow-indigo-100" : "bg-white text-slate-500 border border-slate-100"
                          )}
                         >
                           {c}
                         </button>
                       ))}
                    </div>
                  </div>

                  {/* Topic Filter */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Topics</label>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-5 text-[9px] font-black"
                        onClick={() => setSelectedTopics(selectedTopics.length === filterOptions.topics.length ? [] : filterOptions.topics)}
                      >
                        {selectedTopics.length === filterOptions.topics.length ? 'Reset' : 'Select All'}
                      </Button>
                    </div>
                    <div className="max-h-[150px] overflow-y-auto no-scrollbar flex flex-wrap gap-2 pr-2">
                       {filterOptions.topics.map(t => (
                         <button 
                          key={t} 
                          onClick={() => setSelectedTopics(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-black transition-all",
                            selectedTopics.includes(t) ? "bg-emerald-600 text-white shadow-md shadow-emerald-100" : "bg-white text-slate-500 border border-slate-100"
                          )}
                         >
                           {t}
                         </button>
                       ))}
                    </div>
                  </div>

                  {/* Test Mode Filter */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Test Modes</label>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-5 text-[9px] font-black"
                        onClick={() => setSelectedTestModes(selectedTestModes.length === filterOptions.testModes.length ? [] : filterOptions.testModes)}
                      >
                        {selectedTestModes.length === filterOptions.testModes.length ? 'Reset' : 'Select All'}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                       {filterOptions.testModes.map(m => (
                         <button 
                          key={m} 
                          onClick={() => setSelectedTestModes(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-black transition-all",
                            selectedTestModes.includes(m) ? "bg-amber-600 text-white shadow-md shadow-amber-100" : "bg-white text-slate-500 border border-slate-100"
                          )}
                         >
                           {m}
                         </button>
                       ))}
                    </div>
                  </div>

                  {/* Student Filter */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Students</label>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-5 text-[9px] font-black"
                        onClick={() => {
                          const allSkeys = aggregateStats?.allStudents?.map((s: any) => s.sKey) || [];
                          setSelectedStudents(selectedStudents.length === allSkeys.length ? [] : allSkeys);
                        }}
                      >
                        {selectedStudents.length === (aggregateStats?.allStudents?.length || 0) ? 'Reset' : 'Select All'}
                      </Button>
                    </div>
                    <div className="max-h-[150px] overflow-y-auto no-scrollbar flex flex-wrap gap-2 pr-2">
                       {aggregateStats?.allStudents?.map((s: any) => (
                         <button 
                          key={s.sKey} 
                          onClick={() => setSelectedStudents(prev => prev.includes(s.sKey) ? prev.filter(x => x !== s.sKey) : [...prev, s.sKey])}
                          className={cn(
                            "px-2 py-1 rounded-lg text-[9px] font-black transition-all",
                            selectedStudents.includes(s.sKey) ? "bg-slate-900 text-white shadow-md shadow-slate-200" : "bg-white text-slate-500 border border-slate-100"
                          )}
                         >
                           {s.studentName}
                         </button>
                       ))}
                    </div>
                  </div>
               </div>
               <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-400 uppercase italic">
                    * Stats below will automatically update based on your active filter selection.
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => {
                    if (onSelectAllTests) onSelectAllTests(tests.map(t => t.id));
                    setSelectedSubjects([]);
                    setSelectedChapters([]);
                    setSelectedTopics([]);
                    setSelectedStudents([]);
                  }} className="text-rose-500 hover:text-rose-600">
                    Clear All Filters
                  </Button>
               </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {activeAnalysisView === 'summary' && (
        <>
          {Object.keys(aggregateStats.paperStats).length > 0 && (
            <section className="space-y-6">
              <h3 className="font-black text-xl text-slate-900 tracking-tight">Paper-wise Breakdown</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.entries(aggregateStats.paperStats).map(([pName, pStats]: [string, any]) => {
                  const accuracy = Math.round((pStats.totalCorrect / pStats.totalQuestions) * 100);
                  const avgScore = (pStats.totalScore / results.length).toFixed(1);
                  const maxPossible = (pStats.maxScore / results.length).toFixed(0);

                  return (
                    <Card key={pName} className="p-6 border-blue-100 bg-blue-50/20 rounded-[2rem] space-y-4">
                      <div className="flex items-center justify-between">
                        <Badge variant="blue" className="bg-blue-600 text-white border-none">{pName}</Badge>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">{pStats.totalQuestions} Questions</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-white rounded-2xl border border-blue-50">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Avg Score</p>
                          <div className="flex items-baseline gap-1">
                            <span className="text-xl font-black text-slate-900">{avgScore}</span>
                            <span className="text-[10px] font-bold text-slate-400">/ {maxPossible}</span>
                          </div>
                        </div>
                        <div className="p-4 bg-white rounded-2xl border border-blue-50">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Accuracy</p>
                          <span className="text-xl font-black text-blue-600">{accuracy}%</span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-blue-600" 
                          initial={{ width: 0 }}
                          animate={{ width: `${accuracy}%` }}
                        />
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          <section className="space-y-6">
            <h3 className="font-black text-xl text-slate-900 tracking-tight">Difficulty Matrix</h3>
            <Card className="overflow-hidden border-slate-100 shadow-sm bg-white rounded-3xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-50 bg-slate-50/50">
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Difficulty</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Total Q's</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Correct</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Avg. Accuracy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {Object.entries(aggregateStats.difficulties).map(([diff, stats]: [string, any]) => {
                      if (stats.totalQuestions === 0) return null;
                      const accuracy = Math.round((stats.totalCorrect / stats.totalQuestions) * 100);
                      return (
                        <tr key={diff} className="hover:bg-slate-50/30 transition-colors">
                          <td className="px-6 py-4">
                            <span className={cn(
                              "text-xs font-black uppercase tracking-widest",
                              diff === 'Easy' ? "text-emerald-500" :
                              diff === 'Medium' ? "text-amber-500" :
                              diff === 'Hard' ? "text-rose-500" : "text-slate-400"
                            )}>{diff}</span>
                          </td>
                          <td className="px-6 py-4 text-center font-bold text-slate-600">{stats.totalQuestions}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 font-black text-xs">
                              {stats.totalCorrect}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-xs font-black text-blue-600">{accuracy}%</span>
                              <div className="w-16 h-1 bg-slate-100 rounded-full overflow-hidden">
                                <motion.div 
                                  className="h-full bg-blue-600" 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${accuracy}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="p-8 space-y-6">
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Subject Performance</h3>
              <div className="space-y-6">
                {Object.entries(aggregateStats.subjects).map(([name, stats]: [string, any]) => {
                  const acc = stats.totalQuestions > 0 ? Math.round((stats.totalCorrect / stats.totalQuestions) * 100) : 0;
                  return (
                    <div key={name} className="space-y-2">
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-sm font-black text-slate-900">{name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">Avg. Accuracy</p>
                        </div>
                        <span className="text-lg font-black text-blue-600">{acc}%</span>
                      </div>
                      <div className="h-3 bg-slate-50 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-blue-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${acc}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-8 space-y-6">
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Top Challenging Chapters</h3>
              <div className="space-y-4">
                 {Object.entries(aggregateStats.chapters)
                   .filter(([_, stats]: [string, any]) => stats.totalQuestions > 0)
                   .sort((a: any, b: any) => (a[1].totalCorrect / a[1].totalQuestions) - (b[1].totalCorrect / b[1].totalQuestions))
                   .slice(0, 5)
                   .map(([name, stats]: [string, any]) => {
                     const acc = Math.round((stats.totalCorrect / stats.totalQuestions) * 100);
                     return (
                       <div key={name} className="flex items-center justify-between p-4 bg-rose-50/50 rounded-2xl border border-rose-100/50">
                          <div>
                            <p className="text-sm font-black text-slate-900">{name}</p>
                            <p className="text-[9px] font-bold text-rose-400 uppercase tracking-widest">{stats.subject}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-black text-rose-600">{acc}%</p>
                            <p className="text-[9px] font-bold text-rose-300 uppercase">Proficiency</p>
                          </div>
                       </div>
                     );
                   })}
              </div>
            </Card>
          </div>

          <Card className="p-8 space-y-6 mb-20">
             <h3 className="text-xl font-black text-slate-900 tracking-tight">Topic-wise Summary</h3>
             <div className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                   <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50/50">
                         <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <th className="px-6 py-4">Topic</th>
                            <th className="px-6 py-4 text-center">Correct / Total</th>
                            <th className="px-6 py-4 text-center">Accuracy (%)</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                         {Object.entries(aggregateStats.topics)
                           .filter(([_, stats]: [string, any]) => stats.totalQuestions > 0)
                           .sort((a: any, b: any) => b[1].totalQuestions - a[1].totalQuestions)
                           .map(([name, stats]: [string, any]) => {
                             const acc = Math.round((stats.totalCorrect / stats.totalQuestions) * 100);
                             return (
                               <tr key={name} className="hover:bg-slate-50/50 transition-colors">
                                 <td className="px-6 py-4">
                                   <div className="flex flex-col">
                                      <span className="text-sm font-black text-slate-900">{name}</span>
                                      <span className="text-[9px] font-bold text-slate-400 uppercase">{stats.chapter}</span>
                                   </div>
                                 </td>
                                 <td className="px-6 py-4 text-center">
                                    <span className="text-sm font-bold text-slate-600">{stats.totalCorrect} / {stats.totalQuestions}</span>
                                 </td>
                                 <td className="px-6 py-4 text-center">
                                    <Badge className={cn(
                                       "text-[10px] font-black",
                                       acc >= 80 ? "bg-emerald-100 text-emerald-700" :
                                       acc >= 50 ? "bg-amber-100 text-amber-700" :
                                       "bg-rose-100 text-rose-700"
                                    )}>
                                       {acc}%
                                    </Badge>
                                 </td>
                               </tr>
                             );
                           })}
                      </tbody>
                   </table>
                </div>
             </div>
          </Card>
        </>
      )}

      {activeAnalysisView === 'topic' && (
        <Card className="bg-white border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50/50">
                <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">
                  <th 
                    className="px-6 py-5 cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = topicSortConfig?.key === 'topic' && topicSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setTopicSortConfig({ key: 'topic', direction: dir });
                    }}
                  >
                    Topic / Sub-Topic
                  </th>
                  <th 
                    className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = topicSortConfig?.key === 'totalAttempts' && topicSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setTopicSortConfig({ key: 'totalAttempts', direction: dir });
                    }}
                  >
                    Total Attempts
                  </th>
                  <th 
                    className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = topicSortConfig?.key === 'totalCorrect' && topicSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setTopicSortConfig({ key: 'totalCorrect', direction: dir });
                    }}
                  >
                    Correct
                  </th>
                  <th 
                    className="px-6 py-5 text-right cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = topicSortConfig?.key === 'accuracy' && topicSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setTopicSortConfig({ key: 'accuracy', direction: dir });
                    }}
                  >
                    Accuracy
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {aggregateStats.topicTable.map((t: any) => (
                  <tr key={`${t.topic}_${t.subTopic}`} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="text-sm font-black text-slate-900 group-hover:text-blue-600 transition-colors">{t.topic}</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">{t.subTopic || 'General'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-center font-black text-slate-400">{t.totalAttempts}</td>
                    <td className="px-6 py-5 text-center">
                       <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 font-black text-xs">
                         {t.totalCorrect}
                       </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                       <div className="flex flex-col items-end gap-1">
                          <span className="text-sm font-black text-blue-600">{t.accuracy}%</span>
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                             <motion.div 
                               className="h-full bg-blue-600"
                               initial={{ width: 0 }}
                               animate={{ width: `${t.accuracy}%` }}
                             />
                          </div>
                       </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeAnalysisView === 'student' && (
        <Card className="bg-white border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50/50">
                <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">
                  <th 
                    className="px-6 py-5 cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = studentSortConfig?.key === 'studentName' && studentSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setStudentSortConfig({ key: 'studentName', direction: dir });
                    }}
                  >
                    Student / Reg No
                  </th>
                  <th className="px-6 py-5 text-center">Center / Batch</th>
                  <th 
                    className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = studentSortConfig?.key === 'testsTaken' && studentSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setStudentSortConfig({ key: 'testsTaken', direction: dir });
                    }}
                  >
                    Tests Taken
                  </th>
                  <th 
                    className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = studentSortConfig?.key === 'totalScore' && studentSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setStudentSortConfig({ key: 'totalScore', direction: dir });
                    }}
                  >
                    Total Score
                  </th>
                  <th 
                    className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = studentSortConfig?.key === 'avgScore' && studentSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setStudentSortConfig({ key: 'avgScore', direction: dir });
                    }}
                  >
                    Avg. Score
                  </th>
                  <th className="px-6 py-5 text-center">Correct/Total</th>
                  <th 
                    className="px-6 py-5 text-right cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = studentSortConfig?.key === 'accuracy' && studentSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setStudentSortConfig({ key: 'accuracy', direction: dir });
                    }}
                  >
                    Avg. Accuracy
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {aggregateStats.studentTable.map((s: any) => (
                  <tr key={`${s.regNo}_${s.studentName}`} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="text-sm font-black text-slate-900 group-hover:text-blue-600 transition-colors">{s.studentName}</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Reg: {s.regNo}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-center">
                      <div className="flex flex-col items-center">
                        <Badge variant="slate" className="bg-white border-slate-200 text-slate-500 font-black whitespace-nowrap text-[10px]">
                          {s.centerName || '—'}
                        </Badge>
                        <span className="text-[9px] font-black text-slate-400 mt-1 uppercase tracking-tighter">
                          {s.batchCode || s.batchName || '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-center">
                       <span className="px-2.5 py-1 bg-slate-100 rounded-lg text-[10px] font-black text-slate-600 uppercase">
                         {s.testsTaken} Tests
                       </span>
                    </td>
                    <td className="px-6 py-5 text-center font-black text-slate-900 text-lg">{s.totalScore}</td>
                    <td className="px-6 py-5 text-center font-black text-indigo-600">{s.avgScore}</td>
                    <td className="px-6 py-5 text-center text-xs font-bold text-slate-500">
                       {s.totalCorrect} / {s.totalQuestions}
                    </td>
                    <td className="px-6 py-5 text-right">
                       <div className="flex flex-col items-end gap-1">
                          <span className="text-sm font-black text-blue-600">{s.accuracy}%</span>
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                             <motion.div 
                               className="h-full bg-blue-600"
                               initial={{ width: 0 }}
                               animate={{ width: `${s.accuracy}%` }}
                             />
                          </div>
                       </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeAnalysisView === 'question' && (
        <Card className="bg-white border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50/50">
                <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">
                  <th 
                    className="px-6 py-5 cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = sortConfig?.key === 'num' && sortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setSortConfig({ key: 'num', direction: dir });
                    }}
                  >
                    Q.No {sortConfig?.key === 'num' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className="px-6 py-5 cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = sortConfig?.key === 'subject' && sortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setSortConfig({ key: 'subject', direction: dir });
                    }}
                  >
                    Subject {sortConfig?.key === 'subject' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-5">Chapter Name</th>
                  <th className="px-6 py-5">Topic</th>
                  {visibleColumns.includes('correct') && (
                    <th 
                      className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() => {
                        const dir = sortConfig?.key === 'correct' && sortConfig.direction === 'asc' ? 'desc' : 'asc';
                        setSortConfig({ key: 'correct', direction: dir });
                      }}
                    >
                      Correct {sortConfig?.key === 'correct' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  )}
                  {visibleColumns.includes('incorrect') && (
                    <th 
                      className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() => {
                        const dir = sortConfig?.key === 'incorrect' && sortConfig.direction === 'asc' ? 'desc' : 'asc';
                        setSortConfig({ key: 'incorrect', direction: dir });
                      }}
                    >
                      Incorrect {sortConfig?.key === 'incorrect' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  )}
                  {visibleColumns.includes('unattempted') && (
                    <th 
                      className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() => {
                        const dir = sortConfig?.key === 'unattempted' && sortConfig.direction === 'asc' ? 'desc' : 'asc';
                        setSortConfig({ key: 'unattempted', direction: dir });
                      }}
                    >
                      Unattempted {sortConfig?.key === 'unattempted' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  )}
                  {visibleColumns.includes('accuracy') && (
                    <th 
                      className="px-6 py-5 text-center cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() => {
                        const dir = sortConfig?.key === 'accuracy' && sortConfig.direction === 'asc' ? 'desc' : 'asc';
                        setSortConfig({ key: 'accuracy', direction: dir });
                      }}
                    >
                      Avg % {sortConfig?.key === 'accuracy' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {aggregateStats.questions.map((q: any) => {
                  const total = q.correct + q.incorrect + q.unattempted;
                  const acc = Math.round((q.correct / (total - q.unattempted || 1)) * 100);
                  const attemptRate = Math.round(((q.correct + q.incorrect) / total) * 100);
                  
                  return (
                    <tr key={q.qIdx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-2 text-xs font-black text-slate-800">Q.{q.qIdx}</td>
                      <td className="px-4 py-2 font-black">
                        <Badge variant={q.subject === 'Physics' ? 'amber' : q.subject === 'Chemistry' ? 'blue' : 'green'} className="text-[7px] py-0 h-4">
                          {q.subject}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-xs font-bold text-slate-600 truncate max-w-[120px]">{q.chapter}</td>
                      <td className="px-4 py-2 text-xs font-medium text-slate-500 truncate max-w-[120px]">{q.topic}</td>
                      {visibleColumns.includes('correct') && (
                        <td className="px-4 py-2 text-center text-xs font-black text-emerald-600">{q.correct}</td>
                      )}
                      {visibleColumns.includes('incorrect') && (
                        <td className="px-4 py-2 text-center text-xs font-black text-rose-500">{q.incorrect}</td>
                      )}
                      {visibleColumns.includes('unattempted') && (
                        <td className="px-4 py-2 text-center text-xs font-black text-slate-300">{q.unattempted}</td>
                      )}
                      {visibleColumns.includes('accuracy') && (
                        <td className="px-4 py-2 text-center">
                          <span className={cn("text-xs font-black", acc > 70 ? "text-emerald-600" : acc > 40 ? "text-amber-600" : "text-rose-600")}>
                            {acc}%
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeAnalysisView === 'topic' && (
        <Card className="bg-white border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50/50">
                <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Chapter</th>
                  <th className="px-4 py-3">Topic</th>
                  <th className="px-4 py-3 text-center">Qus</th>
                  <th className="px-4 py-3 text-center">Attm</th>
                  {visibleColumns.includes('correct') && (
                    <th className="px-4 py-3 text-center">Corr</th>
                  )}
                  {visibleColumns.includes('incorrect') && (
                    <th className="px-4 py-3 text-center">Incorr</th>
                  )}
                  {visibleColumns.includes('unattempted') && (
                    <th className="px-4 py-3 text-center">Unattm</th>
                  )}
                  {visibleColumns.includes('accuracy') && (
                    <th className="px-4 py-3 text-center">Avg %</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {aggregateStats.topicTable.map((t: any, i: number) => {
                  const acc = Math.round((t.correct / (t.correct + t.incorrect || 1)) * 100);
                  
                  return (
                    <tr key={i} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-2">
                        <Badge variant={t.subject === 'Physics' ? 'amber' : t.subject === 'Chemistry' ? 'blue' : 'green'} className="text-[7px] py-0 h-3.5">
                          {t.subject}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-[11px] font-bold text-slate-600 truncate max-w-[120px]">{t.chapter}</td>
                      <td className="px-4 py-2 text-[11px] font-medium text-slate-500 truncate max-w-[120px]">{t.topic}</td>
                      <td className="px-4 py-2 text-center text-xs font-black text-slate-500">{t.questionsCount}</td>
                      <td className="px-4 py-2 text-center text-xs font-bold text-slate-600">{t.correct + t.incorrect}</td>
                      {visibleColumns.includes('correct') && (
                        <td className="px-4 py-2 text-center text-xs font-black text-emerald-600">{t.correct}</td>
                      )}
                      {visibleColumns.includes('incorrect') && (
                        <td className="px-4 py-2 text-center text-xs font-black text-rose-500">{t.incorrect}</td>
                      )}
                      {visibleColumns.includes('unattempted') && (
                        <td className="px-4 py-2 text-center text-xs font-black text-slate-300">{t.unattempted}</td>
                      )}
                      {visibleColumns.includes('accuracy') && (
                        <td className="px-4 py-2 text-center">
                            <Badge className={cn(
                              "text-[9px] font-black py-0 h-4 min-w-[32px] flex items-center justify-center",
                              acc >= 80 ? "bg-emerald-100 text-emerald-700" :
                              acc >= 50 ? "bg-amber-100 text-amber-700" :
                              "bg-rose-100 text-rose-700"
                            )}>
                              {acc}%
                            </Badge>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ResultDetail({ result, onBack, onUpdate }: { result: any, onBack: () => void, onUpdate?: () => void }) {
  const { role } = useAuth();
  const isAdmin = role === 'admin' || role === 'operator' || role === 'central_team';
  const [test, setTest] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedPaper, setSelectedPaper] = useState<string>('');
  const [qbgTopics, setQbgTopics] = useState<Record<string, any>>({});
  const [topicSort, setTopicSort] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [omrFilter, setOmrFilter] = useState<{ status: string, difficulty: string, subject: string }>({
    status: 'all',
    difficulty: 'all',
    subject: 'all'
  });

  const normalizedResult = useMemo(() => {
    return {
      ...result,
      subjectStats: Array.isArray(result.subjectStats) 
        ? result.subjectStats.reduce((acc: any, s: any) => ({ ...acc, [s.name]: s }), {}) 
        : result.subjectStats,
      chapterStats: Array.isArray(result.chapterStats)
        ? result.chapterStats.reduce((acc: any, c: any) => ({ ...acc, [c.name]: c }), {})
        : result.chapterStats,
      difficultyStats: Array.isArray(result.difficultyStats)
        ? result.difficultyStats.reduce((acc: any, d: any) => ({ ...acc, [d.name]: d }), {})
        : result.difficultyStats
    };
  }, [result]);

  const sortedTopicStats = useMemo(() => {
    if (!normalizedResult.topicStats) return [];
    let list = Object.entries(normalizedResult.topicStats).map(([id, stats]: [string, any]) => ({
      id,
      ...stats,
      topicName: qbgTopics[id]?.topic || id,
      accuracy: (stats.total > 0 ? (stats.correct / stats.total) * 100 : 0)
    }));

    if (topicSort) {
      list.sort((a: any, b: any) => {
        let aVal = a[topicSort.key];
        let bVal = b[topicSort.key];
        if (topicSort.key === 'attempted') {
          aVal = (a.correct || 0) + (a.wrong || 0);
          bVal = (b.correct || 0) + (b.wrong || 0);
        }
        if (topicSort.key === 'unattempted') {
          aVal = (a.total || 0) - (a.correct || 0) - (a.wrong || 0);
          bVal = (b.total || 0) - (b.correct || 0) - (b.wrong || 0);
        }
        
        if (aVal < bVal) return topicSort.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return topicSort.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return list;
  }, [normalizedResult.topicStats, topicSort, qbgTopics]);

  useEffect(() => {
    const fetchQbg = async () => {
      try {
        const qbgSnap = await getDocs(collection(db, 'qbgLibrary'));
        const map: Record<string, any> = {};
        
        qbgSnap.docs.forEach(docSnap => {
          const sData = docSnap.data();
          const sName = sData.subject;
          
          if (sData.data) {
            Object.entries(sData.data).forEach(([chId, ch]: any) => {
              if (ch.topics) {
                Object.entries(ch.topics).forEach(([tId, t]: any) => {
                  map[tId] = { topic: t.name, chapter: ch.name, subject: sName };
                  if (t.subtopics) {
                    Object.entries(t.subtopics).forEach(([stId, st]: any) => {
                      map[stId] = { topic: st.name, chapter: ch.name, subject: sName };
                    });
                  }
                });
              }
            });
          }
        });
        setQbgTopics(map);
      } catch (err) {
        console.error('Failed to fetch qbgLibrary:', err);
      }
    };
    fetchQbg();
  }, []);

  useEffect(() => {
    const fetchTest = async () => {
      if (result.testId) {
        const docRef = doc(db, 'tests', result.testId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setTest(docSnap.data());
        }
      }
    };
    fetchTest();
  }, [result.testId]);

  useEffect(() => {
    const checkAutoSync = async () => {
      if (test && result && !isSyncing) {
        const testVer = test.answerKeyVersion || 0;
        const resVer = result.answerKeyVersion || 0;
        
        if (testVer > resVer) {
          console.log(`Auto-syncing scorecard: Test version ${testVer} > Result version ${resVer}`);
          handleSync();
        }
      }
    };
    checkAutoSync();
  }, [test, result.id]);

  const handleSync = async () => {
    if (!test || !result.id) return;
    try {
      setIsSyncing(true);
      const qbgSnap = await getDocs(collection(db, 'qbgMaster'));
      const qbgMap = qbgSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.data().id]: d.data() }), {});
      
      const stats = evaluateResult(result.responsesJson || {}, test.answerKey || {}, qbgMap, test.pattern);
      
      await updateDoc(doc(db, 'result_updated', result.id), {
        ...stats,
        reevaluatedAt: serverTimestamp(),
        answerKeyVersion: test.answerKeyVersion || 1
      });
      
      toast.success('Score synchronized successfully!');
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error(err);
      toast.error('Failed to sync score');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDelete = async () => {
    if (!result.id) return;
    if (!window.confirm('Are you sure you want to delete this result? This action cannot be undone.')) return;
    
    try {
      setIsSyncing(true); // Reusing isSyncing for overlay
      await deleteDoc(doc(db, 'result_updated', result.id));
      toast.success('Result deleted successfully');
      if (onUpdate) onUpdate();
      onBack();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `result_updated/${result.id}`);
      toast.error('Failed to delete result');
    } finally {
      setIsSyncing(false);
    }
  };

  // Live evaluation for display consistency
  const activeStats = test ? evaluateResult(result.responsesJson || {}, test.answerKey || {}, {}, test.pattern) : null;
  const evaluationToUse = result.mappedEvaluation || activeStats?.mappedEvaluation || [];
  
  const filteredEvaluation = useMemo(() => {
    let list = [...evaluationToUse];
    if (omrFilter.status !== 'all') {
      list = list.filter(ev => ev.status === omrFilter.status);
    }
    if (omrFilter.difficulty !== 'all') {
      list = list.filter(ev => ev.difficulty === omrFilter.difficulty);
    }
    if (omrFilter.subject !== 'all') {
      list = list.filter(ev => ev.subject === omrFilter.subject);
    }
    return list;
  }, [evaluationToUse, omrFilter]);

  const currentScore = result.score || activeStats?.score || 0;
  const currentCorrect = result.correct || activeStats?.correct || 0;
  const currentWrong = result.wrong || activeStats?.wrong || 0;
  const currentAccuracy = result.accuracy || activeStats?.accuracy || 0;

  const handleExportDetail = () => {
    const exportData = [
      { Category: 'Student Name', Value: result.studentName },
      { Category: 'Reg No', Value: result.regNo },
      { Category: 'Total Score', Value: currentScore },
      { Category: 'Correct', Value: currentCorrect },
      { Category: 'Wrong', Value: currentWrong },
      { Category: 'Accuracy', Value: `${currentAccuracy}%` },
      { Category: '', Value: '' },
      { Category: 'Subject Breakdown', Value: '' }
    ];

    Object.entries(result.subjectStats || activeStats?.subjectStats || {}).forEach(([subject, stats]: [string, any]) => {
      exportData.push({ Category: subject, Value: `Score: ${stats.score}, Correct: ${stats.correct}, Incorrect: ${stats.wrong || 0}` });
    });

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${result.studentName}_Result_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-10 space-y-10 relative">
      {isSyncing && <Loader fullScreen label="Synchronizing Scores..." />}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <button onClick={onBack} className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 transition-colors">
            <ChevronLeft size={24} strokeWidth={3} className="text-slate-900" />
          </button>
          <div className="space-y-1">
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] pl-0.5">Final Result & Analytics</p>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none">{result.studentName}</h2>
            <div className="flex items-center gap-3">
               <Badge variant="blue">{result.regNo}</Badge>
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Rank #{result.rank} • Test ID: {result.testId.slice(-6)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" size="md" className="bg-blue-600 shadow-lg shadow-blue-100" onClick={() => window.print()}>
            Print Scorecard
          </Button>
          {isAdmin && (
            <Button variant="outline" size="md" onClick={handleSync} disabled={isSyncing} className="border-slate-200">
              <RefreshCw className={cn("mr-2", isSyncing && "animate-spin")} size={18} />
              {isSyncing ? 'Syncing...' : 'Sync Data'}
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="md" onClick={handleDelete} className="border-rose-100 text-rose-500 hover:bg-rose-50 hover:border-rose-200">
              <Trash2 size={18} />
            </Button>
          )}
        </div>
      </header>

      {/* Toolbar Section moved from header for cleaner look */}
      <div className="flex flex-wrap items-center justify-end gap-3 bg-white/50 backdrop-blur-sm p-2 rounded-2xl border border-slate-100/50">
          <Button variant="outline" size="sm" onClick={handleExportDetail} className="border-slate-200 h-9">
            <Download size={14} className="mr-2 text-emerald-600" />
            <span className="text-xs uppercase tracking-wider font-bold">Export CSV</span>
          </Button>

          {isAdmin && (
            <div className="relative group h-9">
              {test?.pattern === 'JEE_ADVANCED' && (
                <div className="absolute bottom-full left-0 mb-2 w-48 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
                  <div className="bg-white border border-slate-200 rounded-xl shadow-xl p-3 space-y-2">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Target Paper</p>
                    <Select 
                      value={selectedPaper}
                      onChange={e => setSelectedPaper(e.target.value)}
                      className="h-9 py-1 px-3 text-xs rounded-lg bg-blue-50/50 border-blue-100"
                    >
                      <option value="">Select Paper...</option>
                      {test.advancedPapers?.map((p: string) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </div>
                </div>
              )}
              <input 
                type="file" 
                className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                accept=".csv,.xlsx,.xls"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !test || !result.id) return;
                  
                  if (test.pattern === 'JEE_ADVANCED' && !selectedPaper) {
                    toast.error('Please select a target paper first');
                    return;
                  }
                  
                  try {
                    setIsSyncing(true);
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                      try {
                        const data = new Uint8Array(event.target?.result as ArrayBuffer);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
                        
                        const row = rows[0]; 
                        let newAnswers: Record<string, string> = {};
                        
                        Object.keys(row).forEach(key => {
                          const normalizedKey = key.replace(/[^0-9]/g, '');
                          if (normalizedKey && !isNaN(parseInt(normalizedKey)) && !['regno', 'phone', 'id', 'rollno', 'name', 'studentname'].includes(key.toLowerCase().replace(/\s/g, ''))) {
                            const qKey = (test.pattern === 'JEE_ADVANCED' && selectedPaper) 
                              ? `${selectedPaper}-${normalizedKey}` 
                              : normalizedKey;
                            newAnswers[qKey] = String(row[key] || '').toUpperCase();
                          }
                        });

                        const mergedAnswers = {
                          ...(result.responsesJson || {}),
                          ...newAnswers
                        };

                        const qbgSnap = await getDocs(collection(db, 'qbgMaster'));
                        const qbgMap = qbgSnap.docs.reduce((acc: any, d) => ({ ...acc, [d.data().id]: d.data() }), {});
                        const stats = evaluateResult(mergedAnswers, test.answerKey || {}, qbgMap, test.pattern);

                        await updateDoc(doc(db, 'result_updated', result.id), {
                          ...stats,
                          responsesJson: mergedAnswers,
                          updatedAt: serverTimestamp(),
                          reevaluatedAt: serverTimestamp()
                        });

                        toast.success('OMR Response updated successfully!');
                        setSelectedPaper('');
                        if (onUpdate) onUpdate();
                      } catch (err) {
                        console.error(err);
                        toast.error('Failed to process OMR file');
                      }
                    };
                    reader.readAsArrayBuffer(file);
                  } catch (err) {
                    console.error(err);
                    toast.error('Error reading file');
                  } finally {
                    setIsSyncing(false);
                  }
                }}
              />
              <Button variant="outline" size="sm" className="border-slate-200 h-9">
                <Upload className="mr-2 text-blue-600" size={14} />
                <span className="text-xs uppercase tracking-wider font-bold">Re-upload OMR</span>
              </Button>
            </div>
          )}
          <Button variant="outline" size="sm" className="border-slate-200 h-9">
            <Download className="mr-2" size={14} />
            <span className="text-xs uppercase tracking-wider font-bold">Transcript</span>
          </Button>
          {isAdmin && (
            <Button variant="primary" size="sm" className="bg-emerald-600 shadow-lg shadow-emerald-100 border-none h-9">
              <span className="text-xs uppercase tracking-wider font-bold">Send to Parents</span>
            </Button>
          )}
      </div>

      {/* Row Level Summary Bar */}
      <Card className="p-6 bg-slate-900 border-none rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
        <div className="flex items-center justify-between min-w-[900px] divide-x divide-slate-800 px-2 relative z-10">
          <div className="flex-1 px-8 text-center space-y-1">
            <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest leading-none">Aggregate Score</p>
            <p className="text-3xl font-black text-white tracking-tighter">{result.isAbsent ? '—' : currentScore}</p>
          </div>
          <div className="flex-1 px-8 text-center space-y-1">
            <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest leading-none">Rank</p>
            <p className="text-3xl font-black text-white tracking-tighter">{result.isAbsent ? '—' : `#${result.rank || 0}`}</p>
          </div>
          <div className="flex-1 px-8 text-center space-y-1">
            <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest leading-none">Physics</p>
            <p className="text-2xl font-black text-white">{result.isAbsent ? '—' : (normalizedResult.subjectStats?.Physics?.score || 0)}</p>
          </div>
          <div className="flex-1 px-8 text-center space-y-1">
            <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest leading-none">Chemistry</p>
            <p className="text-2xl font-black text-white">{result.isAbsent ? '—' : (normalizedResult.subjectStats?.Chemistry?.score || 0)}</p>
          </div>
          <div className="flex-1 px-8 text-center space-y-1">
            <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest leading-none">Math</p>
            <p className="text-2xl font-black text-white">{result.isAbsent ? '—' : (normalizedResult.subjectStats?.Math?.score || normalizedResult.subjectStats?.Mathematics?.score || 0)}</p>
          </div>
          <div className="flex-1 px-8 text-center space-y-1">
            <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest leading-none">Acc.</p>
            <p className="text-2xl font-black text-white">{result.isAbsent ? '—' : `${Math.round(currentAccuracy)}%`}</p>
          </div>
          <div className="flex-1 px-8 text-center space-y-1">
            <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest leading-none">Wrong</p>
            <p className="text-2xl font-black text-white">{result.isAbsent ? '—' : currentWrong}</p>
          </div>
          <div className="flex-1 px-8 text-center space-y-1">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none">Blank</p>
            <p className="text-2xl font-black text-slate-300">{result.isAbsent ? '—' : (result.blank || 0)}</p>
          </div>
        </div>
        {/* Glow effect */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-indigo-500/10 rounded-full blur-[60px] translate-y-1/3 -translate-x-1/4" />
      </Card>

      {/* Student Metadata Card */}
      <Card className="p-8 bg-white border-slate-100 rounded-[2.5rem] shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-black text-slate-900 tracking-tight flex items-center">
            <UserIcon className="mr-2 text-blue-600" size={20} />
            Student Detail Content
          </h3>
          <Badge variant="blue" className="bg-blue-50 text-blue-600 border-none uppercase tracking-widest text-[9px]">Verified Identity</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="space-y-1 text-center md:text-left">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Program & Batch</p>
            <div className="flex flex-col">
              <p className="font-bold text-slate-900">{result.programName || '—'}</p>
              <p className="text-[10px] font-black text-blue-600 uppercase mt-0.5">{result.batchCode || result.batchName || '—'}</p>
            </div>
          </div>
          <div className="space-y-1 text-center md:text-left">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Center Name</p>
            <p className="font-bold text-slate-900">{result.centerName || '—'}</p>
          </div>
          <div className="space-y-1 text-center md:text-left lg:col-span-2">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Status / Registration</p>
            <div className="flex items-center justify-center md:justify-start gap-3 mt-1">
              <div className="flex items-center gap-2">
                <Badge variant={result.isAbsent ? 'slate' : 'green'} className="text-[10px]">
                  {result.isAbsent ? 'ABSENT' : 'PRESENT'}
                </Badge>
                <Badge variant={result.testMode === 'online' ? 'blue' : 'slate'} className="text-[10px] uppercase">
                  {result.testMode || 'offline'}
                </Badge>
                <span className="text-sm font-black text-slate-700 tracking-tight">{result.regNo}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-10 flex flex-col items-center justify-center space-y-4 shadow-xl shadow-blue-100 rounded-[3rem] relative overflow-hidden">
             <div className="relative z-10 w-20 h-20 bg-white/20 rounded-[2.5rem] flex items-center justify-center backdrop-blur-md">
               <Award size={36} strokeWidth={2.5} />
             </div>
             <div className="relative z-10 text-center">
               <p className="text-7xl font-black tracking-tighter leading-none mb-1">{result.isAbsent ? '—' : currentScore}</p>
               <p className="text-sm uppercase font-black text-blue-100 tracking-[0.3em] opacity-80">Aggregate Score</p>
               <p className="text-xs font-bold text-white/50 mt-4 tracking-widest uppercase">{result.isAbsent ? 'ABSENT' : `Rank #${result.rank}`}</p>
             </div>
             <div className="absolute right-[-20%] bottom-[-20%] opacity-10">
                <Target size={240} />
             </div>
          </Card>

          <Card className="p-8 space-y-6 border-slate-100 shadow-sm">
             <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-900">Score Metrics</h3>
                <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                  <TrendingUp size={18} />
                </div>
             </div>
             <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                   <div className="flex items-center gap-3">
                     <div className="w-2 h-2 rounded-full bg-emerald-500" />
                     <p className="text-sm font-bold text-slate-600">Correct Answers</p>
                   </div>
                   <p className="text-xl font-black text-slate-900">{currentCorrect}</p>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                   <div className="flex items-center gap-3">
                     <div className="w-2 h-2 rounded-full bg-rose-500" />
                     <p className="text-sm font-bold text-slate-600">Incorrect Answers</p>
                   </div>
                   <p className="text-xl font-black text-slate-900">{currentWrong}</p>
                </div>
                <div className="flex items-center justify-between p-4 bg-blue-600 rounded-2xl text-white">
                   <p className="text-sm font-bold text-blue-100/80">Batch Accuracy Rate</p>
                   <p className="text-xl font-black">{Math.round(currentAccuracy)}%</p>
                </div>
             </div>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h3 className="font-black text-2xl text-slate-900 tracking-tight">Student OMR Response Sheet</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Select 
                value={omrFilter.status} 
                onChange={(e) => setOmrFilter({...omrFilter, status: e.target.value})}
                className="text-[10px] uppercase font-black tracking-widest py-1.5 px-3 rounded-xl border-slate-100"
              >
                <option value="all">All Status</option>
                <option value="correct">Correct</option>
                <option value="wrong">Incorrect</option>
                <option value="blank">Blank</option>
              </Select>
              <Select 
                value={omrFilter.subject} 
                onChange={(e) => setOmrFilter({...omrFilter, subject: e.target.value})}
                className="text-[10px] uppercase font-black tracking-widest py-1.5 px-3 rounded-xl border-slate-100"
              >
                <option value="all">All Subjects</option>
                {Object.keys(normalizedResult.subjectStats || {}).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
              <Select 
                value={omrFilter.difficulty} 
                onChange={(e) => setOmrFilter({...omrFilter, difficulty: e.target.value})}
                className="text-[10px] uppercase font-black tracking-widest py-1.5 px-3 rounded-xl border-slate-100"
              >
                <option value="all">All Difficulty</option>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </Select>
            </div>
          </div>
          
          <Card className="p-8 bg-white border-slate-100 rounded-[3rem] shadow-sm space-y-10">
             {(() => {
               const grouped = filteredEvaluation.reduce((acc: any, ev: any) => {
                 const p = ev.paper || 'Questions';
                 if (!acc[p]) acc[p] = [];
                 acc[p].push(ev);
                 return acc;
               }, {});

               if (filteredEvaluation.length === 0) {
                 return (
                   <div className="py-12 text-center space-y-4">
                      <FileText className="mx-auto text-slate-200" size={48} />
                      <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">No matching responses found</p>
                      <Button variant="ghost" size="sm" onClick={() => setOmrFilter({ status: 'all', difficulty: 'all', subject: 'all' })}>
                        Clear Filters
                      </Button>
                   </div>
                 );
               }

               return Object.entries(grouped)
                 .sort(([a], [b]) => a.localeCompare(b))
                 .map(([paperName, items]: [string, any]) => {
                   const sortedItems = [...items].sort((a, b) => {
                     const numA = parseInt(a.qIdx.split('-').pop() || '0');
                     const numB = parseInt(b.qIdx.split('-').pop() || '0');
                     return numA - numB;
                   });

                   return (
                     <div key={paperName} className="space-y-4">
                       <div className="flex items-center justify-between border-b border-slate-50 pb-2">
                         <h4 className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em]">{paperName}</h4>
                         <Badge variant="blue" className="text-[9px]">{sortedItems.length} Items</Badge>
                       </div>
                       <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-x-3 gap-y-6">
                         {sortedItems.map((ev: any) => {
                           const cleanQNum = ev.qIdx.split('-').pop();
                           return (
                            <div key={ev.qIdx} className="flex flex-col items-center gap-1.5 p-1 rounded-xl transition-all hover:bg-slate-50 group relative">
                              <span className="text-[9px] font-black text-slate-400 leading-none">Q.{cleanQNum}</span>
                              <div className={cn(
                                "w-10 h-10 rounded-full border-2 flex flex-col items-center justify-center text-[11px] font-bold transition-all relative",
                                ev.status === 'blank' ? "bg-slate-50 border-slate-200 text-slate-400" :
                                ev.status === 'correct' 
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-600" 
                                  : (ev.status === 'partial' ? "bg-amber-50 border-amber-200 text-amber-600" : "bg-rose-50 border-rose-200 text-rose-600")
                              )}>
                                <span className="leading-none">{ev.status === 'blank' ? '?' : ev.studentAns}</span>
                                {ev.status !== 'correct' && ev.status !== 'blank' && (
                                  <span className="text-[7px] opacity-60 font-black mt-0.5 border-t border-current pt-0.5 px-1">{ev.correctAns}</span>
                                )}
                                
                                {/* Score indicator */}
                                <div className={cn(
                                  "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full border flex items-center justify-center text-[8px] font-black shadow-sm",
                                  ev.status === 'correct' ? "bg-emerald-500 border-emerald-600 text-white" :
                                  ev.status === 'wrong' ? "bg-rose-500 border-rose-600 text-white" :
                                  ev.status === 'partial' ? "bg-amber-500 border-amber-600 text-white" : "bg-slate-100 border-slate-200 text-slate-500"
                                )}>
                                  {ev.scoreReceived >= 0 ? `+${ev.scoreReceived}` : ev.scoreReceived}
                                </div>
                              </div>
                              
                              {/* Tooltip for Correct Answer */}
                              <div className="absolute top-full mt-1 bg-slate-900 text-white text-[8px] font-bold py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none whitespace-nowrap shadow-xl">
                                Correct: {ev.correctAns}
                              </div>
                            </div>
                           );
                         })}
                       </div>
                     </div>
                   );
                 });

             })()}

             <div className="mt-10 pt-8 border-t border-slate-50 grid grid-cols-2 lg:grid-cols-4 gap-8">
                <div className="flex items-start gap-3">
                   <div className="w-4 h-4 rounded-full bg-emerald-500 shrink-0 mt-0.5" />
                   <div>
                     <p className="text-xs font-black text-slate-900 uppercase">Correct Mapping</p>
                     <p className="text-[10px] font-medium text-slate-400">Student response matches master answer key.</p>
                   </div>
                </div>
                <div className="flex items-start gap-3">
                   <div className="w-4 h-4 rounded-full bg-rose-500 shrink-0 mt-0.5" />
                   <div>
                     <p className="text-xs font-black text-slate-900 uppercase">Incorrect Mapping</p>
                     <p className="text-[10px] font-medium text-slate-400">Student response differs from answer key.</p>
                   </div>
                </div>
                <div className="flex items-start gap-3">
                   <div className="w-4 h-4 rounded-full bg-slate-300 shrink-0 mt-0.5" />
                   <div>
                     <p className="text-xs font-black text-slate-900 uppercase">Unattempted</p>
                     <p className="text-[10px] font-medium text-slate-400">Question was skipped or not reached.</p>
                   </div>
                </div>

                <div className="flex items-start gap-3">
                   <div className="w-4 h-4 rounded-full bg-blue-500 shrink-0 mt-0.5" />
                   <div>
                     <p className="text-xs font-black text-slate-900 uppercase">Bonus Question</p>
                     <p className="text-[10px] font-medium text-slate-400">Marked as BONUS in key (auto-awarded points).</p>
                   </div>
                </div>
             </div>
          </Card>

          <section className="space-y-6">
            <h3 className="font-black text-xl text-slate-900 tracking-tight">Difficulty Matrix</h3>
            <Card className="overflow-hidden border-slate-100 shadow-sm bg-white rounded-3xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-50 bg-slate-50/50">
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Difficulty</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Questions</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Correct</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Incorrect</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Unattempted</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {Object.entries(normalizedResult.difficultyStats || activeStats?.difficultyStats || {}).map(([diff, stats]: [string, any]) => {
                      if (stats.total === 0) return null;
                      const attempted = stats.correct + (stats.wrong || 0);
                      const accuracy = attempted > 0 ? Math.round((stats.correct / attempted) * 100) : 0;
                      return (
                        <tr key={diff} className="hover:bg-slate-50/30 transition-colors">
                          <td className="px-6 py-4">
                            <span className={cn(
                              "text-xs font-black uppercase tracking-widest",
                              diff === 'Easy' ? "text-emerald-500" :
                              diff === 'Medium' ? "text-amber-500" :
                              diff === 'Hard' ? "text-rose-500" : "text-slate-400"
                            )}>{diff}</span>
                          </td>
                          <td className="px-6 py-4 text-center font-bold text-slate-600">{stats.total}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 font-black text-xs">
                              {stats.correct}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-50 text-rose-600 font-black text-xs">
                              {stats.wrong || 0}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-50 text-slate-400 font-black text-xs">
                              {stats.blank || 0}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-xs font-black text-blue-600">{accuracy}%</span>
                              <div className="w-16 h-1 bg-slate-100 rounded-full overflow-hidden">
                                <motion.div 
                                  className="h-full bg-blue-600" 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${accuracy}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>

          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-xl text-slate-900 tracking-tight">Subject Breakdown</h3>
              <Badge variant="slate" className="bg-slate-50 text-slate-500 border-slate-100 uppercase tracking-widest text-[9px]">Comparative Analysis</Badge>
            </div>
            <Card className="overflow-hidden border-slate-100 shadow-sm bg-white rounded-3xl">
              <div className="overflow-x-auto overflow-y-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-50 bg-slate-50/50">
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Subject</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Score</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Questions</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Correct</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Incorrect</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Unattempted</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {Object.entries(result.subjectStats || activeStats?.subjectStats || {}).map(([subject, stats]: [string, any]) => {
                      const attempted = stats.correct + (stats.wrong || 0);
                      const accuracy = attempted > 0 ? Math.round((stats.correct / attempted) * 100) : 0;
                      return (
                        <tr key={subject} className="hover:bg-slate-50/30 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-2 h-2 rounded-full",
                                subject === 'Physics' ? "bg-amber-500" :
                                subject === 'Chemistry' ? "bg-indigo-500" :
                                "bg-emerald-500"
                              )} />
                              <span className="text-sm font-black text-slate-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight">{subject}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center font-black text-slate-900">{stats.score}</td>
                          <td className="px-6 py-4 text-center font-bold text-slate-400 text-sm">{stats.total}</td>
                          <td className="px-6 py-4 text-center">
                             <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 font-black text-xs">
                               {stats.correct}
                             </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-50 text-rose-600 font-black text-xs">
                               {stats.wrong || 0}
                             </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                             <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-50 text-slate-400 font-black text-xs">
                               {stats.blank || 0}
                             </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-xs font-black text-blue-600">{accuracy}%</span>
                              <div className="w-16 h-1 bg-slate-100 rounded-full overflow-hidden">
                                <motion.div 
                                  className="h-full bg-blue-600"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${accuracy}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>

          <section className="space-y-6">
            <h3 className="font-black text-xl text-slate-900 tracking-tight">Topic-Level Proficiency</h3>
            <div className="bg-white border border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50/50">
                    <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      <th 
                        className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors"
                        onClick={() => {
                          const dir = topicSort?.key === 'topicName' && topicSort.direction === 'asc' ? 'desc' : 'asc';
                          setTopicSort({ key: 'topicName', direction: dir });
                        }}
                      >
                        Topic {topicSort?.key === 'topicName' && (topicSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors"
                        onClick={() => {
                          const dir = topicSort?.key === 'total' && topicSort.direction === 'asc' ? 'desc' : 'asc';
                          setTopicSort({ key: 'total', direction: dir });
                        }}
                      >
                        Ques. {topicSort?.key === 'total' && (topicSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                         className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors"
                         onClick={() => {
                           const dir = topicSort?.key === 'attempted' && topicSort.direction === 'asc' ? 'desc' : 'asc';
                           setTopicSort({ key: 'attempted', direction: dir });
                         }}
                      >
                        Attm. {topicSort?.key === 'attempted' && (topicSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors"
                        onClick={() => {
                          const dir = topicSort?.key === 'correct' && topicSort.direction === 'asc' ? 'desc' : 'asc';
                          setTopicSort({ key: 'correct', direction: dir });
                        }}
                      >
                        Corr. {topicSort?.key === 'correct' && (topicSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors"
                        onClick={() => {
                          const dir = topicSort?.key === 'wrong' && topicSort.direction === 'asc' ? 'desc' : 'asc';
                          setTopicSort({ key: 'wrong', direction: dir });
                        }}
                      >
                        Incorr. {topicSort?.key === 'wrong' && (topicSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors"
                        onClick={() => {
                          const dir = topicSort?.key === 'unattempted' && topicSort.direction === 'asc' ? 'desc' : 'asc';
                          setTopicSort({ key: 'unattempted', direction: dir });
                        }}
                      >
                        Unattm. {topicSort?.key === 'unattempted' && (topicSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors"
                        onClick={() => {
                          const dir = topicSort?.key === 'accuracy' && topicSort.direction === 'asc' ? 'desc' : 'asc';
                          setTopicSort({ key: 'accuracy', direction: dir });
                        }}
                      >
                        Acc % {topicSort?.key === 'accuracy' && (topicSort.direction === 'asc' ? '↑' : '↓')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {sortedTopicStats.length > 0 ? sortedTopicStats.map((stats: any) => {
                      const topicName = stats.topicName;
                      const total = stats.total || 0;
                      const correct = stats.correct || 0;
                      const wrong = stats.wrong || 0;
                      const blank = stats.blank || (total - correct - wrong);
                      const attempted = correct + wrong;
                      const accuracy = Math.round(stats.accuracy);
                      
                      return (
                        <tr key={stats.id} className="group hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-2">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs font-black text-slate-800 leading-tight">{topicName}</span>
                              <Badge variant="slate" className="text-[7px] w-fit opacity-60 h-auto py-0">{stats.chapter}</Badge>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className="text-xs font-bold text-slate-500">{total}</span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className="text-xs font-bold text-slate-600">{attempted}</span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className="text-xs font-black text-emerald-600">{correct}</span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className="text-xs font-black text-rose-500">{wrong}</span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className="text-xs font-medium text-slate-400">{blank}</span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <Badge className={cn(
                              "text-[9px] font-black py-0 h-4 min-w-[32px] flex items-center justify-center",
                              accuracy >= 80 ? "bg-emerald-100 text-emerald-700" :
                              accuracy >= 50 ? "bg-amber-100 text-amber-700" :
                              "bg-rose-100 text-rose-700"
                            )}>
                              {accuracy}%
                            </Badge>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={7} className="px-6 py-10 text-center text-xs text-slate-400 italic">No topic analysis available.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <h3 className="font-black text-xl text-slate-900 tracking-tight">Chapter Analysis (Sub-QBG Link)</h3>
            <div className="bg-white border border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50/50">
                    <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      <th className="px-4 py-3">Chapter Name</th>
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-4 py-3 text-center">Qus</th>
                      <th className="px-4 py-3 text-center">Corr</th>
                      <th className="px-4 py-3 text-center">Score</th>
                      <th className="px-4 py-3 text-center">Acc (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {normalizedResult.chapterStats ? Object.entries(normalizedResult.chapterStats).map(([chap, stats]: [string, any]) => {
                      const acc = Math.round((stats.correct / stats.total) * 100);
                      return (
                        <tr key={chap} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-2.5 text-xs font-black text-slate-800">{chap}</td>
                          <td className="px-4 py-2.5">
                             <Badge variant={stats.subject === 'Physics' ? 'amber' : stats.subject === 'Chemistry' ? 'blue' : 'green'} className="text-[8px] py-0 h-4">
                               {stats.subject}
                             </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs font-bold text-slate-500">{stats.total}</td>
                          <td className="px-4 py-2.5 text-center text-xs font-black text-emerald-600">{stats.correct}</td>
                          <td className="px-4 py-2.5 text-center text-xs font-black text-blue-600">{stats.score}</td>
                          <td className="px-4 py-2.5 text-center">
                            <Badge className={cn(
                              "text-[9px] font-black py-0 h-4",
                              acc >= 80 ? "bg-emerald-100 text-emerald-700" :
                              acc >= 50 ? "bg-amber-100 text-amber-700" :
                              "bg-rose-100 text-rose-700"
                            )}>
                              {acc}%
                            </Badge>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={6} className="px-6 py-10 text-center text-xs text-slate-400 italic">No chapter analysis data found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, val, color, bg }: { label: string, val: number, color: string, bg: string }) {
  return (
    <Card className="flex flex-col items-center justify-center p-4 space-y-1">
       <span className={cn("px-3 py-1 rounded-lg text-[18px] font-black", bg, color)}>{val}</span>
       <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
    </Card>
  );
}



