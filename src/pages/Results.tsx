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
  Layout,
  Activity,
  Inbox
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ComposedChart
} from 'recharts';
import { BottomSheet } from './Students';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { useMetadata } from '../context/MetadataContext';
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
  deleteDoc,
  limit
} from 'firebase/firestore';
import Papa from 'papaparse';

import { toast } from 'sonner';
import { addLog, LogAction, LogCategory } from '../lib/logs';

// Utility to determine Rank Bucket based on percentage score and pattern
const determineRankBucket = (score: number, maxScore: number, pattern: string): string => {
  if (!maxScore || maxScore <= 0 || score === undefined || score === null) return '—';
  const pct = (score / maxScore) * 100;
  const pat = (pattern || '').toUpperCase();

  // Smart fallback detection if pattern is empty
  let isNeet = pat === 'NEET';
  let isJeeMain = pat.includes('JEE_MAIN') || pat === 'JEE MAIN' || pat === 'JEE_MAIN';
  let isJeeAdv = pat.includes('JEE_ADVANCED') || pat.includes('ADV') || pat === 'JEE ADV' || pat === 'JEE_ADVANCED';

  if (!isNeet && !isJeeMain && !isJeeAdv) {
    if (maxScore === 720) {
      isNeet = true;
    } else {
      isJeeMain = true; // default fallback
    }
  }

  if (isJeeMain) {
    if (pct >= 95.00) return 'Under 100';
    if (pct >= 91.67) return 'Under 500';
    if (pct >= 88.33) return 'Under 1k';
    if (pct >= 85.67) return 'Under 2k';
    if (pct >= 83.67) return 'Under 3k';
    if (pct >= 82.33) return 'Under 4k';
    if (pct >= 81.33) return 'Under 5k';
    if (pct >= 80.33) return 'Under 6k';
    if (pct >= 79.33) return 'Under 7k';
    if (pct >= 78.33) return 'Under 8k';
    if (pct >= 77.33) return 'Under 9k';
    if (pct >= 76.67) return 'Under 10k';
    return 'More than 10k';
  } else if (isJeeAdv) {
    if (pct >= 80.00) return 'Under 100';
    if (pct >= 70.00) return 'Under 500';
    if (pct >= 65.00) return 'Under 1k';
    if (pct >= 58.00) return 'Under 2k';
    if (pct >= 54.00) return 'Under 3k';
    if (pct >= 51.50) return 'Under 4k';
    if (pct >= 49.00) return 'Under 5k';
    if (pct >= 46.50) return 'Under 6k';
    if (pct >= 45.60) return 'Under 7k';
    if (pct >= 44.00) return 'Under 8k';
    if (pct >= 43.00) return 'Under 9k';
    if (pct >= 42.00) return 'Under 10k';
    return 'More than 10k';
  } else if (isNeet) {
    if (pct >= 97.92) return 'Under 100';
    if (pct >= 95.83) return 'Under 500';
    if (pct >= 93.06) return 'Under 1k';
    if (pct >= 92.36) return 'Under 2k';
    if (pct >= 91.67) return 'Under 3k';
    if (pct >= 90.97) return 'Under 4k';
    if (pct >= 90.28) return 'Under 5k';
    if (pct >= 89.72) return 'Under 6k';
    if (pct >= 89.17) return 'Under 7k';
    if (pct >= 88.61) return 'Under 8k';
    if (pct >= 88.06) return 'Under 9k';
    if (pct >= 87.50) return 'Under 10k';
    return 'More than 10k';
  }
  return '—';
};

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
    const rawSubject = String(qData.subject || subjectId || 'N/A').trim();
    const subLower = rawSubject.toLowerCase();
    let subject = rawSubject;
    
    if (subLower === 'math' || subLower === 'maths' || subLower === 'mathematics') subject = 'Math';
    else if (subLower === 'physics') subject = 'Physics';
    else if (subLower === 'chemistry') subject = 'Chemistry';
    else if (subLower === 'botany') subject = 'Botany';
    else if (subLower === 'zoology') subject = 'Zoology';
    else if (subLower === 'biology') subject = 'Biology';
    const topic = (qbgMap || {})[`${chapterId}_${topicId}`]?.topic || 
                  (qbgMap || {})[`${chap}_${topicId}`]?.topic || 
                  (qbgMap || {})[`${subjectId}_${chapterId}_${topicId}`]?.topic || 
                  (qbgMap || {})[topicId]?.topic || 
                  qData.topic || 
                  topicId || '';
    const diff = normalizedDifficulty;

    if (!chapterStats[chap]) {
      chapterStats[chap] = { total: 0, correct: 0, wrong: 0, score: 0, subject, chapterId };
    }
    chapterStats[chap].total++;

    if (!subjectStats[subject]) {
      subjectStats[subject] = { total: 0, correct: 0, wrong: 0, blank: 0, score: 0, maxScore: 0, subjectId };
    }
    subjectStats[subject].total++;
    subjectStats[subject].maxScore += correctPoints;

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
    } else if (qData.isRange || correctAns.toLowerCase().includes('to') || (correctAns.includes('-') && !correctAns.startsWith('-') && !isNaN(parseFloat(correctAns.split('-')[0])) && !isNaN(parseFloat(correctAns.split('-')[1])))) {
      // Dynamic range resolution for robust evaluation fallback
      let rMin = parseFloat(String(qData.rangeMin ?? 0));
      let rMax = parseFloat(String(qData.rangeMax ?? 0));
      let isRangeValid = !!qData.isRange;

      if (!isRangeValid) {
        if (correctAns.toLowerCase().includes('to')) {
          const parts = correctAns.toLowerCase().split('to').map(p => parseFloat(p.trim()));
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            isRangeValid = true;
            rMin = Math.min(parts[0], parts[1]);
            rMax = Math.max(parts[0], parts[1]);
          }
        } else {
          const parts = correctAns.split('-');
          if (parts.length === 2) {
            const p0 = parseFloat(parts[0].trim());
            const p1 = parseFloat(parts[1].trim());
            if (!isNaN(p0) && !isNaN(p1)) {
              isRangeValid = true;
              rMin = Math.min(p0, p1);
              rMax = Math.max(p0, p1);
            }
          }
        }
      }

      const val = parseFloat(studentAns);
      if (isRangeValid && !isNaN(val) && val >= rMin && val <= rMax) {
        correctCount++;
        qScore = correctPoints;
        status = 'correct';
      } else {
        wrongCount++;
        qScore = wrongPoints;
        status = 'wrong';
      }
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

export const standardizeSubjectStats = (stats: any) => {
  if (!stats) return {};
  const normalized: Record<string, any> = {};
  const subjectsList = ['Physics', 'Chemistry', 'Math', 'Botany', 'Zoology', 'Biology'];
  
  if (Array.isArray(stats)) {
    stats.forEach((s: any) => {
      if (s && s.name) {
        const matchingSub = subjectsList.find(sub => 
          sub.toLowerCase() === s.name.toLowerCase().trim() ||
          (sub === 'Math' && (s.name.toLowerCase().trim() === 'maths' || s.name.toLowerCase().trim() === 'mathematics'))
        );
        if (matchingSub) {
          const score = s.score !== undefined ? s.score : s.Score;
          normalized[matchingSub] = { 
            ...s, 
            score: typeof score === 'number' ? score : Number(score) || 0 
          };
        }
      }
    });
  } else if (typeof stats === 'object') {
    Object.entries(stats).forEach(([k, v]) => {
      if (k && v) {
        const matchingSub = subjectsList.find(sub => 
          sub.toLowerCase() === k.toLowerCase().trim() ||
          (sub === 'Math' && (k.toLowerCase().trim() === 'maths' || k.toLowerCase().trim() === 'mathematics'))
        );
        if (matchingSub) {
          if (typeof v === 'object') {
            const score = (v as any).score !== undefined ? (v as any).score : (v as any).Score;
            normalized[matchingSub] = { 
              ...(v as any), 
              score: typeof score === 'number' ? score : Number(score) || 0 
            };
          } else {
            normalized[matchingSub] = { score: typeof v === 'number' ? v : Number(v) || 0 };
          }
        }
      }
    });
  }
  return normalized;
};

export const getSubjectScore = (res: any, subType: 'Physics' | 'Chemistry' | 'Math' | 'Botany' | 'Zoology' | 'Biology'): string | number => {
  if (!res || !res.subjectStats || res.isAbsent) return '—';
  const stats = res.subjectStats;

  let normalizedStats: Record<string, any> = {};
  if (Array.isArray(stats)) {
    stats.forEach((s: any) => {
      if (s && s.name) {
        normalizedStats[s.name.toLowerCase().trim()] = s;
      }
    });
  } else if (typeof stats === 'object') {
    Object.entries(stats).forEach(([k, v]) => {
      if (k && v) {
        normalizedStats[k.toLowerCase().trim()] = v;
      }
    });
  }

  let val: any = null;
  const subLower = subType.toLowerCase();
  if (subLower === 'physics') {
    val = normalizedStats.physics ?? normalizedStats.ph;
  } else if (subLower === 'chemistry') {
    val = normalizedStats.chemistry ?? normalizedStats.ch;
  } else if (subLower === 'math' || subLower === 'maths' || subLower === 'mathematics') {
    val = normalizedStats.math ?? normalizedStats.maths ?? normalizedStats.mathematics;
  } else if (subLower === 'botany') {
    val = normalizedStats.botany ?? normalizedStats.bot;
  } else if (subLower === 'zoology') {
    val = normalizedStats.zoology ?? normalizedStats.zoo;
  } else if (subLower === 'biology') {
    val = normalizedStats.biology ?? normalizedStats.bio;
  }

  if (val === null || val === undefined) return '—';
  if (typeof val === 'object') {
    const score = val.score !== undefined ? val.score : val.Score;
    return score !== undefined ? score : '—';
  }
  return val;
};

export const getRawSubjectObj = (res: any, subType: 'Physics' | 'Chemistry' | 'Math' | 'Botany' | 'Zoology' | 'Biology'): any => {
  if (!res || !res.subjectStats || res.isAbsent) return null;
  const stats = res.subjectStats;

  let normalizedStats: Record<string, any> = {};
  if (Array.isArray(stats)) {
    stats.forEach((s: any) => {
      if (s && s.name) {
        normalizedStats[s.name.toLowerCase().trim()] = s;
      }
    });
  } else if (typeof stats === 'object') {
    Object.entries(stats).forEach(([k, v]) => {
      if (k && v) {
        normalizedStats[k.toLowerCase().trim()] = v;
      }
    });
  }

  let val: any = null;
  const subLower = subType.toLowerCase();
  if (subLower === 'physics') {
    val = normalizedStats.physics ?? normalizedStats.ph;
  } else if (subLower === 'chemistry') {
    val = normalizedStats.chemistry ?? normalizedStats.ch;
  } else if (subLower === 'math' || subLower === 'maths' || subLower === 'mathematics') {
    val = normalizedStats.math ?? normalizedStats.maths ?? normalizedStats.mathematics;
  } else if (subLower === 'botany') {
    val = normalizedStats.botany ?? normalizedStats.bot;
  } else if (subLower === 'zoology') {
    val = normalizedStats.zoology ?? normalizedStats.zoo;
  } else if (subLower === 'biology') {
    val = normalizedStats.biology ?? normalizedStats.bio;
  }

  if (!val || typeof val !== 'object') return null;
  return val;
};

export const getTotalSubjectMark = (subStat: any, subName: string, testPattern: string, isMedical: boolean) => {
  if (subStat && subStat.maxScore) return subStat.maxScore;
  const name = subName.toLowerCase();
  const pattern = (testPattern || '').toUpperCase();
  if (pattern === 'NEET' || isMedical) {
    if (name.includes('phys')) return 180;
    if (name.includes('chem')) return 180;
    if (name.includes('bot')) return 180;
    if (name.includes('zoo')) return 180;
    if (name.includes('bio')) return 360;
    return 180;
  }
  if (pattern === 'JEE_MAIN') {
    return 100;
  }
  if (pattern === 'JEE_ADVANCED') {
    if (subStat && subStat.total) return subStat.total * 4;
    return 120;
  }
  if (subStat && subStat.total) return subStat.total * 4;
  return 100;
};

// Session-level memory cache to avoid redundant expensive reads of student profiles
const studentCache: Record<string, any> = {};

interface StudentAnalysisDashboardProps {
  regNo: string;
  onBack: () => void;
}

function StudentAnalysisDashboard({ regNo, onBack }: StudentAnalysisDashboardProps) {
  const { programs: metaPrograms, centers: metaCenters, batches: metaBatches, qbgMap } = useMetadata();
  const [student, setStudent] = useState<any>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        // 1. Fetch student info
        const studentRef = doc(db, 'students', regNo.toUpperCase());
        const studentDoc = await getDoc(studentRef);
        let studentData = null;
        if (studentDoc.exists()) {
          studentData = { id: studentDoc.id, ...studentDoc.data() };
        } else {
          // Fallback if the doc isn't indexed by uppercase ID
          const qS = query(collection(db, 'students'), where('regNo', '==', regNo));
          const snapS = await getDocs(qS);
          if (!snapS.empty) {
            studentData = { id: snapS.docs[0].id, ...snapS.docs[0].data() };
          }
        }
        setStudent(studentData);

        // 2. Fetch tests so we can resolve testMaxScore / maxScore
        const testsSnap = await getDocs(collection(db, 'tests'));
        const testsData = testsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setTests(testsData);

        // 3. Fetch all result attempts
        const qR = query(collection(db, 'result_updated'), where('regNo', '==', regNo));
        const snapR = await getDocs(qR);
        const attemptsData = snapR.docs.map(d => ({ id: d.id, ...d.data() }));
        setAttempts(attemptsData);
      } catch (err) {
        console.error("Failed to fetch student analysis data:", err);
        toast.error("Failed to load student analysis dashboard");
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, [regNo]);

  const stats = useMemo(() => {
    if (attempts.length === 0) return null;

    let totalScore = 0;
    let totalCorrect = 0;
    let totalWrong = 0;
    let totalBlank = 0;
    let testsTaken = 0;

    const attemptsList = attempts.map(att => {
      const matchT = tests.find(t => t.id === att.testId);
      const mName = matchT?.name || att.testName || 'Unknown Test';
      const mDate = matchT?.date || att.testDate || att.date || '—';
      const mMaxScore = matchT?.maxScore || att.maxScore || att.totalMarks || 360;
      const pct = mMaxScore > 0 ? (att.score / mMaxScore) * 100 : 0;
      const acc = Math.round((att.correct / (att.correct + att.wrong || 1)) * 100);

      totalScore += att.score || 0;
      totalCorrect += att.correct || 0;
      totalWrong += att.wrong || 0;
      totalBlank += att.blank || 0;
      testsTaken++;

      return {
        ...att,
        testName: mName,
        testDate: mDate,
        maxScore: mMaxScore,
        percentage: pct,
        accuracy: acc
      };
    });

    const avgScore = testsTaken > 0 ? Math.round(totalScore / testsTaken) : 0;
    const avgAccuracy = Math.round((totalCorrect / (totalCorrect + totalWrong || 1)) * 100);

    // Find highest and lowest by PERCENTAGE as explicitly requested:
    // "everything highest , lowest with the % not a number because eveytime possibility is base is different"
    let maxAttempt = attemptsList.length > 0 ? attemptsList[0] : null;
    let minAttempt = attemptsList.length > 0 ? attemptsList[0] : null;

    for (const att of attemptsList) {
      if (!maxAttempt || att.percentage > maxAttempt.percentage) {
        maxAttempt = att;
      }
      if (!minAttempt || att.percentage < minAttempt.percentage) {
        minAttempt = att;
      }
    }

    // Concept / Topic scoring
    const conceptScores: Record<string, { correct: number, total: number, subject: string, chapter: string, topicName: string }> = {};
    attemptsList.forEach(att => {
      const mapped = att.mappedEvaluation || [];
      mapped.forEach((ev: any) => {
        const sName = ev.subject || 'N/A';
        const cName = ev.chapter || 'N/A';
        const tName = qbgMap?.[`${ev.chapterId}_${ev.topicId}`]?.topic ||
                      qbgMap?.[`${ev.chapter}_${ev.topicId}`]?.topic ||
                      qbgMap?.[`${ev.subjectId}_${ev.chapterId}_${ev.topicId}`]?.topic ||
                      qbgMap?.[ev.topicId]?.topic || 
                      ev.topic || 
                      ev.topicId || 'N/A';
        const comboKey = `${sName} - ${cName} - ${tName}`;
        if (!conceptScores[comboKey]) {
          conceptScores[comboKey] = {
            correct: 0,
            total: 0,
            subject: sName,
            chapter: cName,
            topicName: tName
          };
        }
        conceptScores[comboKey].total++;
        if (ev.status === 'correct') {
          conceptScores[comboKey].correct++;
        }
      });
    });

    const conceptsList = Object.values(conceptScores).map((c: any) => ({
      ...c,
      accuracy: Math.round((c.correct / c.total) * 100)
    }));

    // Strengths (high accuracy) and Growth chapters (low accuracy)
    const strengths = [...conceptsList]
      .filter(c => c.accuracy >= 70)
      .sort((a, b) => b.accuracy - a.accuracy || b.total - a.total)
      .slice(0, 6);

    const weaknesses = [...conceptsList]
      .filter(c => c.accuracy < 70)
      .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total)
      .slice(0, 6);

    // Subject Performance list
    const subjectAggregates: Record<string, { correct: number, total: number }> = {};
    attemptsList.forEach(att => {
      const mapped = att.mappedEvaluation || [];
      mapped.forEach((ev: any) => {
        const sName = ev.subject || 'N/A';
        if (!subjectAggregates[sName]) {
          subjectAggregates[sName] = { correct: 0, total: 0 };
        }
        subjectAggregates[sName].total++;
        if (ev.status === 'correct') {
          subjectAggregates[sName].correct++;
        }
      });
    });

    const subjectStats = Object.entries(subjectAggregates).map(([subject, sStats]) => {
      const correct = sStats.correct;
      const total = sStats.total;
      const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
      return {
        subject,
        correct,
        total,
        accuracy
      };
    }).sort((a, b) => b.accuracy - a.accuracy);

    return {
      testsTaken,
      avgScore,
      avgAccuracy,
      maxAttempt,
      minAttempt,
      strengths,
      weaknesses,
      subjectStats,
      attemptsList: attemptsList.sort((a, b) => {
        const dateA = new Date(a.testDate).getTime() || 0;
        const dateB = new Date(b.testDate).getTime() || 0;
        return dateB - dateA; // reverse chronological default
      })
    };
  }, [attempts, tests, qbgMap]);

  if (loading) {
    return <Loader fullScreen label="Loading Detailed Student Dashboard..." />;
  }

  // Resolve metadata batch and center names manually for beautiful headers
  const batchCodeResolved = student ? metaBatches.find(b => b.id === student.batchId)?.batchCode || student.batchCode || '—' : '—';
  const centerNameResolved = student ? metaCenters.find(c => c.id === student.centerId)?.centerName || student.centerName || '—' : '—';
  const programNameResolved = student ? metaPrograms.find(p => p.id === student.programId)?.programName || student.programName || '—' : '—';

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 md:p-8 space-y-8 font-sans antialiased text-slate-800">
      {/* Upper Navigation & Dashboard Header card */}
      <Card className="bg-white border-slate-100 p-8 rounded-[2rem] shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={onBack}
              className="w-10 h-10 rounded-xl border-slate-200 flex items-center justify-center p-0 flex-shrink-0 hover:bg-slate-50 transition-colors"
              title="Back"
            >
              <ChevronLeft size={20} strokeWidth={3} className="text-slate-600" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight leading-none">
                  {student?.name || 'Academic Record Summary'}
                </h1>
                <Badge variant="blue" className="bg-blue-50 text-blue-600 border-none font-black text-[10px] h-5 py-0">
                  STUDENT PORTAL
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-[11px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                  REG: {student?.regNo || regNo}
                </span>
                {student?.type && (
                  <span className="text-[10px] font-black text-violet-700 bg-violet-50 px-2 py-0.5 rounded border border-violet-150 uppercase tracking-widest font-mono">
                    {student.type}
                  </span>
                )}
                {student?.rankTarget && (
                  <span className="text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-150 uppercase tracking-widest font-mono flex items-center gap-1">
                    <Target size={11} className="text-amber-500" />
                    TARGET: {student.rankTarget} ({student.targetYear || '—'})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6 flex-wrap">
            <div className="text-left">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Batch Profile</span>
              <span className="text-slate-700 font-extrabold text-sm">{batchCodeResolved}</span>
              <span className="text-slate-400 font-bold block text-[10px] leading-none mt-0.5 max-w-[200px] truncate" title={programNameResolved}>
                {programNameResolved}
              </span>
            </div>
            <div className="h-10 w-px bg-slate-200 hidden sm:block" />
            <div className="text-left">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Academic Center</span>
              <span className="text-slate-700 font-extrabold text-sm block">{centerNameResolved}</span>
            </div>
            {stats && (
              <>
                <div className="h-10 w-px bg-slate-200 hidden sm:block" />
                <div className="flex gap-4 items-center pl-2">
                  <div className="bg-slate-50 rounded-xl px-4 py-2 border border-slate-100/50">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">TESTS</span>
                    <span className="text-slate-800 font-black text-lg">{stats.testsTaken} Attempts</span>
                  </div>
                  <div className="bg-slate-50 rounded-xl px-4 py-2 border border-slate-100/50">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">AVG SCORE</span>
                    <span className="text-slate-800 font-black text-lg">{stats.avgScore}</span>
                  </div>
                  <div className="bg-emerald-50 rounded-xl px-4 py-2 border border-emerald-100/30">
                    <span className="text-[9px] font-black text-emerald-600 uppercase tracking-wider block">AVG ACCURACY</span>
                    <span className="text-emerald-700 font-black text-lg">{stats.avgAccuracy}%</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {!stats ? (
        <Card className="bg-white border-slate-150 p-20 text-center rounded-[2rem] shadow-sm space-y-4">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400 shadow-inner">
            <Activity size={32} />
          </div>
          <h3 className="font-extrabold text-slate-800 text-lg">No Results Detected</h3>
          <p className="text-slate-400 max-w-md mx-auto text-sm leading-relaxed">
            There are currently no standard OMR test attempts tracked in our database for registration number <strong>{regNo.toUpperCase()}</strong>.
          </p>
          <Button variant="primary" onClick={onBack} size="md" className="rounded-xl px-6 bg-blue-600 mt-2">
            Return to Master Directory
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Column 1: Score Milestones with % directly listed block */}
          <section className="lg:col-span-1 space-y-6">
            <h3 className="font-black text-[11px] text-slate-400 uppercase tracking-[0.2em] pl-1">
              SCORE MILESTONES (AVG {stats.avgScore})
            </h3>
            
            <div className="grid grid-cols-1 gap-6">
              {/* Highest Score Attempt Card */}
              <Card className="bg-white border border-emerald-100 rounded-[2rem] p-6 shadow-sm space-y-4 relative overflow-hidden group hover:scale-[1.01] transition-transform">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-bl-full -z-10 opacity-40 group-hover:scale-110 transition-transform" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full uppercase tracking-widest">
                    Highest Performance
                  </span>
                  <TrendingUp className="text-emerald-500" size={18} />
                </div>
                
                {stats.maxAttempt && (
                  <div className="space-y-2">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-black text-emerald-600 tracking-tight">
                        {stats.maxAttempt.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-800 leading-normal line-clamp-2" title={stats.maxAttempt.testName}>
                        {stats.maxAttempt.testName}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 font-mono text-[10px] text-slate-400 font-bold">
                        <span>Score: {stats.maxAttempt.score} / {stats.maxAttempt.maxScore}</span>
                        <span>•</span>
                        <span>{stats.maxAttempt.testDate}</span>
                      </div>
                    </div>
                  </div>
                )}
              </Card>

              {/* Lowest Score Attempt Card */}
              <Card className="bg-white border border-rose-100 rounded-[2rem] p-6 shadow-sm space-y-4 relative overflow-hidden group hover:scale-[1.01] transition-transform">
                <div className="absolute top-0 right-0 w-24 h-24 bg-rose-50 rounded-bl-full -z-10 opacity-40 group-hover:scale-110 transition-transform" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-rose-800 bg-rose-50 px-3 py-1 rounded-full uppercase tracking-widest">
                    Lowest Performance
                  </span>
                  <TrendingDown className="text-rose-500" size={18} />
                </div>
                
                {stats.minAttempt && (
                  <div className="space-y-2">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-black text-rose-500 tracking-tight">
                        {stats.minAttempt.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-800 leading-normal line-clamp-2" title={stats.minAttempt.testName}>
                        {stats.minAttempt.testName}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 font-mono text-[10px] text-slate-400 font-bold">
                        <span>Score: {stats.minAttempt.score} / {stats.minAttempt.maxScore}</span>
                        <span>•</span>
                        <span>{stats.minAttempt.testDate}</span>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </section>

          {/* Column 2: Subject Performance with accurate breakdown */}
          <section className="lg:col-span-1 space-y-6">
            <h3 className="font-black text-[11px] text-slate-400 uppercase tracking-[0.2em] pl-1">
              SUBJECT PERFORMANCE
            </h3>

            <Card className="bg-white border-slate-100 p-6 rounded-[2rem] shadow-sm space-y-5">
              {stats.subjectStats.length > 0 ? (
                stats.subjectStats.map((sub, i) => {
                  const barColor = sub.subject === 'Physics' ? 'bg-amber-500' : sub.subject === 'Chemistry' ? 'bg-blue-500' : 'bg-emerald-500';
                  const titleColor = sub.subject === 'Physics' ? 'text-amber-800 bg-amber-50' : sub.subject === 'Chemistry' ? 'text-blue-800 bg-blue-50' : 'text-emerald-800 bg-emerald-50';

                  return (
                    <div key={i} className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className={cn("text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider", titleColor)}>
                          {sub.subject}
                        </span>
                        <span className="text-sm font-black text-slate-850">
                          {sub.accuracy}%
                        </span>
                      </div>
                      
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${sub.accuracy}%` }} />
                      </div>

                      <div className="flex items-center justify-between font-mono text-[10px] text-slate-400 font-bold leading-none mt-1">
                        <span>C: {sub.correct} / T: {sub.total} Questions</span>
                        <span className="text-[9px] uppercase tracking-wider font-sans text-slate-300">View Details</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-center text-xs text-slate-400 py-10 italic">No subject aggregates computed.</p>
              )}
            </Card>
          </section>

          {/* Column 3: Strength Chapters & Topics */}
          <section className="lg:col-span-1 space-y-6">
            <h3 className="font-black text-[11px] text-slate-400 uppercase tracking-[0.2em] pl-1">
              STRENGTH TOPICS (≥ 70% ACCURACY)
            </h3>

            <Card className="bg-white border-slate-100 p-6 rounded-[2rem] shadow-sm h-[calc(100%-2.5rem)] flex flex-col justify-between">
              <div className="space-y-4">
                {stats.strengths.length > 0 ? (
                  stats.strengths.map((st, i) => (
                    <div key={i} className="flex gap-3 items-start border-b border-dashed border-slate-50 pb-3 last:border-none last:pb-0">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 mt-1 flex-shrink-0" />
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <p className="text-xs font-black text-slate-800 leading-normal truncate" title={st.topicName}>
                          {st.topicName}
                        </p>
                        <p className="text-[10px] font-bold text-slate-400 leading-none truncate max-w-[170px]" title={st.chapter}>
                          {st.chapter}
                        </p>
                      </div>
                      <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors border-none text-[10px] font-black rounded-lg h-6">
                        {st.accuracy}%
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-xs text-slate-400 py-12 italic">No topics achieved ≥ 70% average accuracy yet.</p>
                )}
              </div>
            </Card>
          </section>

          {/* Column 4: Growth Opportunities */}
          <section className="lg:col-span-1 space-y-6">
            <h3 className="font-black text-[11px] text-slate-400 uppercase tracking-[0.2em] pl-1">
              GROWTH OPPORTUNITIES
            </h3>

            <Card className="bg-white border-slate-100 p-6 rounded-[2rem] shadow-sm h-[calc(100%-2.5rem)] flex flex-col justify-between">
              <div className="space-y-4">
                {stats.weaknesses.length > 0 ? (
                  stats.weaknesses.map((wk, i) => (
                    <div key={i} className="flex gap-3 items-start border-b border-dashed border-slate-50 pb-3 last:border-none last:pb-0">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-450 mt-1 flex-shrink-0" />
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <p className="text-xs font-black text-slate-800 leading-normal truncate" title={wk.topicName}>
                          {wk.topicName}
                        </p>
                        <p className="text-[10px] font-bold text-slate-400 leading-none truncate max-w-[170px]" title={wk.chapter}>
                          {wk.chapter}
                        </p>
                      </div>
                      <Badge className="bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors border-none text-[10px] font-black rounded-lg h-6">
                        {wk.accuracy}%
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-xs text-slate-400 py-12 italic">Clear! No topics below 70% accuracy recorded.</p>
                )}
              </div>
            </Card>
          </section>
        </div>
      )}

      {/* Attempt History Section at the bottom */}
      {stats && stats.attemptsList.length > 0 && (
        <section className="space-y-6">
          <h3 className="font-black text-lg text-slate-900 tracking-tight pl-0.5">
            OMR ATTEMPT HISTORY (ALL TEST ATTEMPTS TRACKED)
          </h3>
          <div className="bg-white border border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50/50">
                  <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest pl-4">
                    <th className="px-4 py-1.5">Test Date</th>
                    <th className="px-4 py-1.5">Test Series / Chapter Name</th>
                    <th className="px-4 py-1.5 text-center">Correct Answers</th>
                    <th className="px-4 py-1.5 text-center">Incorrect Answers</th>
                    <th className="px-4 py-1.5 text-center">Unattempted</th>
                    <th className="px-4 py-1.5 text-center">Max Score</th>
                    <th className="px-4 py-1.5 text-center">Score</th>
                    <th className="px-4 py-1.5 text-right">Percentage Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {stats.attemptsList.map((att, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-1.5 text-xs font-bold text-slate-500 font-mono">
                        {att.testDate}
                      </td>
                      <td className="px-4 py-1.5 max-w-[280px]">
                        <p className="text-xs font-black text-slate-800 truncate" title={att.testName}>
                          {att.testName}
                        </p>
                        <Badge variant="slate" className="text-[8.5px] uppercase tracking-wide h-4 py-0 mt-1 leading-none font-sans font-black bg-slate-50 text-slate-400 border-none">
                          {att.testMode || 'offline'}
                        </Badge>
                      </td>
                      <td className="px-4 py-1.5 text-center font-bold text-emerald-600 text-xs font-mono">
                        {att.correct}
                      </td>
                      <td className="px-4 py-1.5 text-center font-bold text-rose-500 text-xs font-mono">
                        {att.wrong}
                      </td>
                      <td className="px-4 py-1.5 text-center font-bold text-slate-400 text-xs font-mono">
                        {att.blank}
                      </td>
                      <td className="px-4 py-1.5 text-center font-bold text-slate-500 text-xs font-mono">
                        {att.maxScore}
                      </td>
                      <td className="px-4 py-1.5 text-center font-black text-slate-900 text-sm font-mono0">
                        {att.score}
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <Badge className={cn(
                          "text-[10px] font-black font-mono py-1 px-2.5 h-6 rounded-lg",
                          att.percentage >= 70 ? "bg-emerald-100 text-emerald-700" :
                          att.percentage >= 40 ? "bg-amber-100 text-amber-700" :
                          "bg-rose-100 text-rose-700"
                        )}>
                          {att.percentage.toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

const findBatchSafely = (idOrCode: string, list: any[]) => {
  if (!idOrCode) return null;
  const clean = String(idOrCode).trim().toLowerCase();
  return list.find(b => b.id === idOrCode) ||
         list.find(b => String(b.batchCode || '').trim().toLowerCase() === clean) ||
         list.find(b => String(b.batchName || '').trim().toLowerCase() === clean);
};

const findCenterSafely = (idOrCode: string, list: any[]) => {
  if (!idOrCode) return null;
  const clean = String(idOrCode).trim().toLowerCase();
  return list.find(c => c.id === idOrCode) ||
         list.find(c => String(c.centerName || '').trim().toLowerCase() === clean);
};

const findProgramSafely = (idOrCode: string, list: any[]) => {
  if (!idOrCode) return null;
  const clean = String(idOrCode).trim().toLowerCase();
  return list.find(p => p.id === idOrCode) ||
         list.find(p => String(p.programName || '').trim().toLowerCase() === clean);
};

export default function Results() {
  const { user, role, centerId, batchIds } = useAuth();
  const { programs: metaPrograms, centers: metaCenters, batches: metaBatches, qbgMap: metaQbgMap, qbgLibrary: metaQbgLibrary } = useMetadata();

  const isAdmin = role === 'admin' || role === 'operator' || role === 'central_team' || role === 'central';
  const canEdit = role === 'admin' || role === 'operator' || role === 'central_team' || role === 'central';
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
    studentAnswers: {} as Record<string, string>,
    type: '',
    rankTarget: '',
    targetYear: ''
  });
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isAdvancedFilterOpen, setIsAdvancedFilterOpen] = useState(false);
  const [tests, setTests] = useState<any[]>([]);
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [globalTestIds, setGlobalTestIds] = useState<string[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedResult, setSelectedResult] = useState<any>(null);
  const [detailBackView, setDetailBackView] = useState<'table' | 'analytics'>('table');
  const [autoPrintDetail, setAutoPrintDetail] = useState(false);
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [selectedPaper, setSelectedPaper] = useState<string>('');
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [isSyncingGlobal, setIsSyncingGlobal] = useState(false);
  const [resultsSortConfig, setResultsSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [exportWithName, setExportWithName] = useState<boolean>(true);
  const [filters, setFilters] = useState({
    minAccuracy: 0,
    minMathAccuracy: 0,
    topOnly: false,
    subject: 'all',
    difficulty: 'all',
    testMode: 'all' as 'all' | 'offline' | 'online',
    studentType: 'all' as 'all' | 'Hosteller' | 'e-Gurukul' | 'Day Boarding',
    programId: '',
    centerId: '',
    batchId: ''
  });

  useEffect(() => {
    if (role === 'center' || role === 'center_level') {
      if (centerId && centerId !== 'all') {
        const allowed = centerId.split(',').map(id => id.trim()).filter(Boolean);
        if (allowed.length > 0 && !filters.centerId) {
          setFilters(f => ({ ...f, centerId: allowed[0] }));
        }
      }
    } else if (role === 'teacher') {
      if (batchIds && batchIds.length > 0) {
        if (!filters.batchId || !batchIds.includes(filters.batchId)) {
          setFilters(f => ({ ...f, batchId: batchIds[0] }));
        }
      }
    }
  }, [role, centerId, batchIds]);

  const [wizardProgramId, setWizardProgramId] = useState('');
  const [wizardBatchId, setWizardBatchId] = useState('');
  const [wizardDate, setWizardDate] = useState('');
  const [testSearchQuery, setTestSearchQuery] = useState('');

  const wizardFilteredBatches = useMemo(() => {
    if (!wizardProgramId) return metaBatches.filter(b => b.isActive);
    return metaBatches.filter(b => b.programId === wizardProgramId && b.isActive);
  }, [wizardProgramId, metaBatches]);

  const uniqueTestDatesVec = useMemo(() => {
    const dates = tests.map(t => t.date).filter(Boolean);
    const uniqueDates = Array.from(new Set(dates)).sort((a, b) => b.localeCompare(a));
    return uniqueDates.map(d => {
      const testsOnDate = tests.filter(t => t.date === d);
      const programIds = Array.from(new Set(testsOnDate.map(t => t.programId).filter(Boolean)));
      const programNames = programIds.map(pid => {
        const prog = metaPrograms.find((p: any) => p.id === pid);
        return prog ? prog.programName : '';
      }).filter(Boolean);
      const programsLabel = programNames.length > 0 ? ` (${programNames.join(', ')})` : '';
      return {
        date: d,
        label: `${d}${programsLabel}`
      };
    });
  }, [tests, metaPrograms]);

  const wizardFilteredTests = useMemo(() => {
    return tests.filter(t => {
      const matchesProg = !wizardProgramId || t.programId === wizardProgramId;
      const matchesBatch = !wizardBatchId || t.batchIds?.includes(wizardBatchId);
      const matchesSearch = !testSearchQuery || t.name?.toLowerCase().includes(testSearchQuery.toLowerCase()) || String(t.pattern || '').toLowerCase().includes(testSearchQuery.toLowerCase());
      const matchesDate = !wizardDate || t.date === wizardDate;
      return matchesProg && matchesBatch && matchesSearch && matchesDate;
    });
  }, [wizardProgramId, wizardBatchId, testSearchQuery, wizardDate, tests]);

  const sortedResults = useMemo(() => {
    // Standardize results into map format for easiest UI consumption
    const rawNormalized = results.map(res => {
      const associatedTest = tests.find(t => t.id === res.testId);
      return {
        ...res,
        testPattern: associatedTest?.pattern || res.pattern || '',
        testMaxScore: associatedTest?.maxScore || res.maxScore || (associatedTest?.pattern === 'NEET' ? 720 : 360),
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
      };
    });

    // Calculate standard competition ranks GLOBALLY per testId (before any filtering or permissions are applied)
    const globalTestGroups: Record<string, any[]> = {};
    rawNormalized.forEach((r: any) => {
      if (!globalTestGroups[r.testId]) {
        globalTestGroups[r.testId] = [];
      }
      globalTestGroups[r.testId].push(r);
    });

    const globalRankMap: Record<string, number> = {};
    Object.entries(globalTestGroups).forEach(([tId, group]) => {
      // Sort group by score descending, putting absent students at the bottom
      const sortedGroup = [...group].sort((a: any, b: any) => {
        if (a.isAbsent && !b.isAbsent) return 1;
        if (!a.isAbsent && b.isAbsent) return -1;
        return (b.score || 0) - (a.score || 0);
      });

      let currentRank = 1;
      sortedGroup.forEach((r: any, idx: number) => {
        if (r.isAbsent) {
          globalRankMap[r.id] = idx + 1; // Fallback sequential rank
          return;
        }
        if (idx === 0) {
          currentRank = 1;
        } else {
          const prevRes = sortedGroup[idx - 1];
          if (r.score !== prevRes.score) {
            currentRank = idx + 1;
          }
        }
        globalRankMap[r.id] = currentRank;
      });
    });

    // Attach global rank to the normalized results
    const normalizedResults = rawNormalized.map((r: any) => ({
      ...r,
      rank: globalRankMap[r.id] || 1
    }));

    // Filter results based on roles and center permissions
    const permittedResults = normalizedResults.filter(r => {
      if ((role === 'center' || role === 'center_level') && centerId !== 'all') {
        const allowedCentersSet = (() => {
          const ids = centerId ? centerId.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
          const set = new Set(ids);
          ids.forEach(id => {
            const match = metaCenters.find(c => 
              String(c.id).trim().toLowerCase() === id || 
              String(c.centerName || '').trim().toLowerCase() === id
            );
            if (match) {
              set.add(String(match.id).trim().toLowerCase());
              set.add(String(match.centerName || '').trim().toLowerCase());
            }
          });
          return set;
        })();
        const rCenterIdLower = String(r.centerId || '').trim().toLowerCase();
        const rCenterNameLower = String(r.centerName || '').trim().toLowerCase();
        if (!allowedCentersSet.has(rCenterIdLower) && !allowedCentersSet.has(rCenterNameLower)) {
          return false;
        }
      }
      if (role === 'teacher' && (!batchIds || !batchIds.includes(r.batchId))) {
        return false;
      }
      return true;
    });

    let filtered = [...permittedResults];

    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(r => 
        String(r.studentName || '').toLowerCase().includes(search) || 
        String(r.regNo || '').toLowerCase().includes(search) ||
        String(r.centerName || '').toLowerCase().includes(search) ||
        String(r.batchName || '').toLowerCase().includes(search) ||
        String(r.batchCode || '').toLowerCase().includes(search)
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

    if (filters.studentType && filters.studentType !== 'all') {
      filtered = filtered.filter(r => {
        const typeStr = String(r.type || '').toLowerCase();
        if (filters.studentType === 'Hosteller') {
          return typeStr.includes('hostel');
        } else if (filters.studentType === 'e-Gurukul') {
          return typeStr.includes('gurukul') || typeStr.includes('guru');
        } else if (filters.studentType === 'Day Boarding') {
          return typeStr.includes('board') || typeStr.includes('day');
        }
        return true;
      });
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

    if (filters.topOnly) {
      return sorted.slice(0, 10);
    }
    
    return sorted;
  }, [results, filters, selectedTestIds, resultsSortConfig, searchTerm]);

  const isMedicalFromTestsOnly = useMemo(() => {
    if (filters?.programId) {
      const prog = metaPrograms.find((p: any) => p.id === filters.programId);
      if (prog) {
        const name = (prog.programName || '').toUpperCase();
        const code = (prog.programCode || '').toUpperCase();
        return name.includes('NEET') || name.includes('MED') || code.includes('NEET') || code.includes('MED');
      }
    }
    if (selectedTestIds.length === 0) return false;
    const activeTest = tests.find(t => t.id === selectedTestIds[0]);
    if (!activeTest) return false;
    const activeProgram = metaPrograms.find((p: any) => p.id === activeTest.programId);
    const progName = (activeProgram?.programName || '').toUpperCase();
    const progCode = (activeProgram?.programCode || '').toUpperCase();
    return progName.includes('NEET') || progName.includes('MED') || 
           progCode.includes('NEET') || progCode.includes('MED') || 
           (activeTest.pattern && activeTest.pattern.toUpperCase().includes('NEET'));
  }, [filters?.programId, selectedTestIds, tests, metaPrograms]);

  const allAvailableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    results.forEach(res => {
      if (res.subjectStats) {
        if (Array.isArray(res.subjectStats)) {
          res.subjectStats.forEach((s: any) => { 
            if (s.name && s.name !== 'N/A' && s.name !== 'NA' && s.name !== '') {
              subjects.add(s.name); 
            }
          });
        } else {
          Object.keys(res.subjectStats).forEach(sName => {
            if (sName !== 'N/A' && sName !== 'NA' && sName !== '') {
              subjects.add(sName);
            }
          });
        }
      }
    });

    const list = Array.from(subjects);
    
    // Sort sequence:
    // JEE: Physics, Chemistry, Maths
    // NEET: Physics, Chemistry, Botany, Zoology
    let priorityList: string[] = [];
    if (isMedicalFromTestsOnly) {
      priorityList = ['Physics', 'Chemistry', 'Botany', 'Zoology', 'Biology'];
    } else {
      priorityList = ['Physics', 'Chemistry', 'Math', 'Maths', 'Mathematics'];
    }

    return list.sort((a, b) => {
      const indexA = priorityList.findIndex(p => p.toLowerCase() === a.toLowerCase() || (a.toLowerCase() === 'mathematics' && p.toLowerCase() === 'math'));
      const indexB = priorityList.findIndex(p => p.toLowerCase() === b.toLowerCase() || (b.toLowerCase() === 'mathematics' && p.toLowerCase() === 'math'));
      
      const valA = indexA === -1 ? 999 : indexA;
      const valB = indexB === -1 ? 999 : indexB;
      
      if (valA !== valB) {
        return valA - valB;
      }
      return a.localeCompare(b);
    });
  }, [results, isMedicalFromTestsOnly]);
  const masters = useMemo(() => ({
    programs: metaPrograms,
    centers: metaCenters,
    batches: metaBatches
  }), [metaPrograms, metaCenters, metaBatches]);

  const headersStats = useMemo(() => {
    const stats: Record<string, { highest: number | string, avg: number | string }> = {};
    allAvailableSubjects.forEach(subName => {
      const validScores = results
        .filter(r => !r.isAbsent)
        .map(r => {
          const score = getSubjectScore(r, subName as any);
          return typeof score === 'number' ? score : null;
        })
        .filter((v): v is number => v !== null);

      if (validScores.length === 0) {
        stats[subName] = { highest: '—', avg: '—' };
      } else {
        const highestVal = Math.max(...validScores);
        const avgVal = Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length);
        stats[subName] = { highest: highestVal, avg: avgVal };
      }
    });

    const validTotalScores = results.filter(r => !r.isAbsent).map(r => r.score || 0);
    if (validTotalScores.length === 0) {
      stats['CUMULATIVE'] = { highest: '—', avg: '—' };
    } else {
      const highestVal = Math.max(...validTotalScores);
      const avgVal = Math.round(validTotalScores.reduce((a, b) => a + b, 0) / validTotalScores.length);
      stats['CUMULATIVE'] = { highest: highestVal, avg: avgVal };
    }

    return stats;
  }, [allAvailableSubjects, results]);

  useEffect(() => {
    fetchTests();
    
    // Handle action from external links
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'upload') {
      setIsBulkUploadOpen(true);
    }
  }, []);

  const getRowValue = (row: any, keys: string[]) => {
    for (const k of Object.keys(row)) {
      const norm = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (keys.some(tk => tk.toLowerCase().replace(/[^a-z0-9]/g, '') === norm)) {
        return row[k];
      }
    }
    return undefined;
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

      // 1. Check for duplicate registration numbers in the uploaded file itself
      const rawRegNosInFile = jsonData.map(row => {
        const regNoRaw = getRowValue(row, ['regNo', 'registrationNo', 'rollNo', 'id', 'reg_no', 'roll_no', 'studid', 'rollnum', 'enrollmentno', 'student_id']);
        return String(regNoRaw || '').trim().toUpperCase();
      }).filter(Boolean);

      const seenRegNos = new Set<string>();
      const duplicateRegNos = new Set<string>();
      for (const r of rawRegNosInFile) {
        if (seenRegNos.has(r)) {
          duplicateRegNos.add(r);
        } else {
          seenRegNos.add(r);
        }
      }

      if (duplicateRegNos.size > 0) {
        setIsProcessingBulk(false);
        toast.error(`OMR upload aborted: Duplicate registration numbers found in file: ${Array.from(duplicateRegNos).join(', ')}`, { id: toastId });
        return;
      }

      const regNosInFile = Array.from(new Set(rawRegNosInFile));

      // 2. Fetch Masters for resolution
      const [existingResultsSnap] = await Promise.all([
        getDocs(query(collection(db, 'result_updated'), where('testId', '==', targetTestId)))
      ]);

      let studentMaster: any[] = [];
      if (regNosInFile.length > 0) {
        const queryRegsSet = new Set<string>();
        regNosInFile.forEach(r => {
          queryRegsSet.add(r.toUpperCase());
          queryRegsSet.add(r.toLowerCase());
        });
        const queryRegs = Array.from(queryRegsSet);

        // Firestore limit is 30 for 'in' queries
        const chunksOf30: string[][] = [];
        for (let offset = 0; offset < queryRegs.length; offset += 30) {
          chunksOf30.push(queryRegs.slice(offset, offset + 30));
        }
        const studentChunks = await Promise.all(
          chunksOf30.map(async (chunk) => {
            const snap = await getDocs(query(collection(db, 'students'), where('regNo', 'in', chunk)));
            return snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
          })
        );
        studentMaster = studentChunks.flat();
      }

      // 3. Validate Test and Student Program Mismatch
      if (test.programId) {
        const testProgram = metaPrograms.find((p: any) => p.id === test.programId);
        const testProgramName = testProgram?.programName || 'Selected Test Program';
        
        const programMismatches: string[] = [];
        
        jsonData.forEach(row => {
          const regNoRaw = getRowValue(row, ['regNo', 'registrationNo', 'rollNo', 'id', 'reg_no', 'roll_no', 'studid', 'rollnum', 'enrollmentno', 'student_id']);
          const regNo = String(regNoRaw || '').trim().toUpperCase();
          if (!regNo) return;
          
          const student = studentMaster.find((s: any) => String(s.regNo || '').trim().toUpperCase() === regNo);
          if (student && student.programId && student.programId !== test.programId) {
            const studentProg = metaPrograms.find((p: any) => p.id === student.programId);
            const studentProgName = studentProg?.programName || 'Unknown Program';
            programMismatches.push(`${student.name || regNo} (${regNo}) belongs to program "${studentProgName}" but the test is for "${testProgramName}"`);
          }
        });

        if (programMismatches.length > 0) {
          setIsProcessingBulk(false);
          toast.error(`OMR upload aborted: Students from a different program were detected in the file:\n${programMismatches.join('\n')}`, { id: toastId, duration: 6000 });
          return;
        }
      }

      const existingResultsMap = existingResultsSnap.docs.reduce((acc: any, d) => {
        acc[String(d.data().regNo).toUpperCase()] = { id: d.id, ...d.data() };
        return acc;
      }, {});

      const qbgMap = metaQbgMap;
      
      const batchMapDetails = metaBatches.reduce((acc: any, d) => ({ ...acc, [d.id]: d }), {});
      const centerMapDetails = metaCenters.reduce((acc: any, d) => ({ ...acc, [d.id]: d }), {});
      const progMapDetails = metaPrograms.reduce((acc: any, d) => ({ ...acc, [d.id]: d }), {});

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
          const regNoRaw = getRowValue(row, ['regNo', 'registrationNo', 'rollNo', 'id', 'reg_no', 'roll_no', 'studid', 'rollnum', 'enrollmentno', 'student_id']);
          const regNo = String(regNoRaw || '').trim().toUpperCase();
          if (!regNo) continue;

          const student = studentMaster.find((s: any) => String(s.regNo || '').trim().toUpperCase() === regNo);
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

          const batchDetail = findBatchSafely(batchId, metaBatches);
          const centerDetail = findCenterSafely(centerId, metaCenters);
          const programDetail = findProgramSafely(programId, metaPrograms);

          const payload = {
            testId: targetTestId,
            testName: test.name || 'Unknown',
            testDate: test.date || '',
            regNo: regNo,
            studentName: student?.name || row.studentName || row.name || existingResult?.studentName || 'Unknown Student',
            testMode: row.testMode?.toLowerCase() === 'online' ? 'online' : (student?.testMode || 'offline'),
            centerId: centerDetail?.id || centerId,
            centerName: centerDetail?.centerName || existingResult?.centerName || '',
            batchId: batchDetail?.id || batchId,
            batchName: batchDetail?.batchName || existingResult?.batchName || '',
            batchCode: student?.batchCode || batchDetail?.batchCode || existingResult?.batchCode || '',
            programId: programDetail?.id || programId,
            programName: programDetail?.programName || existingResult?.programName || '',
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
      const targetTestIds = selectedTestIds.length > 0 
        ? selectedTestIds 
        : tests.map(t => t.id);

      if (targetTestIds.length === 0) {
        toast.info('No tests found to sync.', { id: toastId });
        setIsSyncingGlobal(false);
        return;
      }

      let updateCount = 0;
      let currentBatch = writeBatch(db);
      let opCount = 0;
      const localStudentCache: Record<string, any> = {};

      for (const testId of targetTestIds) {
        const resultsQuery = query(collection(db, 'result_updated'), where('testId', '==', testId));
        const resultsSnap = await getDocs(resultsQuery);
        
        if (resultsSnap.empty) continue;

        const regNos = Array.from(new Set(
          resultsSnap.docs.map(doc => String(doc.data().regNo || '').trim().toUpperCase()).filter(Boolean)
        ));

        if (regNos.length === 0) continue;

        // Fetch students in chunks of 30 for missing regNos
        const missingRegNos = regNos.filter(regNo => !localStudentCache[regNo]);
        if (missingRegNos.length > 0) {
          const chunks: string[][] = [];
          for (let i = 0; i < missingRegNos.length; i += 30) {
            chunks.push(missingRegNos.slice(i, i + 30));
          }

          for (const chunk of chunks) {
            try {
              const studentsQuery = query(collection(db, 'students'), where('regNo', 'in', chunk));
              const studentsSnap = await getDocs(studentsQuery);
              studentsSnap.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (data.regNo) {
                  localStudentCache[String(data.regNo).trim().toUpperCase()] = data;
                }
              });
            } catch (err) {
              console.warn("Failed syncing chunk of students:", err);
            }
          }
        }

        for (const resDoc of resultsSnap.docs) {
          const resData = resDoc.data();
          const regNo = String(resData.regNo || '').trim().toUpperCase();
          if (!regNo) continue;

          const student = localStudentCache[regNo];
          if (student) {
            const updates: any = {};
            if (!resData.studentName || resData.studentName === 'Unknown Student' || resData.studentName !== student.name) {
              updates.studentName = student.name;
            }
            if (student.centerId && (!resData.centerId || resData.centerId !== student.centerId)) {
              updates.centerId = student.centerId;
              const centerDetail = findCenterSafely(student.centerId, metaCenters);
              if (centerDetail) {
                updates.centerName = centerDetail.centerName;
              }
            }
            if (student.batchId && (!resData.batchId || resData.batchId !== student.batchId)) {
              updates.batchId = student.batchId;
              const batchDetail = findBatchSafely(student.batchId, metaBatches);
              if (batchDetail) {
                updates.batchName = batchDetail.batchName;
                updates.batchCode = student.batchCode || batchDetail.batchCode || '';
              }
            }
            if (student.programId && (!resData.programId || resData.programId !== student.programId)) {
              updates.programId = student.programId;
              const programDetail = findProgramSafely(student.programId, metaPrograms);
              if (programDetail) {
                updates.programName = programDetail.programName;
              }
            }
            if (student.batchCode && (!resData.batchCode || resData.batchCode !== student.batchCode)) {
              updates.batchCode = student.batchCode;
            }

            Object.keys(updates).forEach(key => {
              if (updates[key] === undefined) {
                delete updates[key];
              }
            });

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
      toast.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`, { id: toastId });
    } finally {
      setIsSyncingGlobal(false);
    }
  };

  const handleDeleteOrphanedResults = async () => {
    if (!window.confirm('Are you sure you want to search the database for orphaned results (results with no matching test master) and delete them?')) {
      return;
    }

    setLoading(true);
    const toastId = toast.loading('Searching for orphaned results...');
    try {
      // 1. Resolve all active test IDs from local state (saves an expensive table scan of tests!)
      const testIds = new Set(tests.map(t => t.id));

      // 2. Fetch results with a safety limit of 1500 to avoid exceeding the Firestore memory/query allocation limits
      const resultsSnap = await getDocs(query(collection(db, 'result_updated'), limit(1500)));
      const orphanedDocs = resultsSnap.docs.filter(docSnap => {
        const data = docSnap.data();
        return !data.testId || !testIds.has(data.testId);
      });

      if (orphanedDocs.length === 0) {
        toast.success('No orphaned results found in the database!', { id: toastId });
        setLoading(false);
        return;
      }

      if (!window.confirm(`Found ${orphanedDocs.length} orphaned result(s) with no matching test master in the database. Do you want to permanently delete them? This action CANNOT be undone.`)) {
        toast.error('Clean up canceled by user', { id: toastId });
        setLoading(false);
        return;
      }

      // 3. Delete them in batches/parallels
      const CHUNK_SIZE = 15;
      const docIdsToDelete = orphanedDocs.map(d => d.id);
      const chunks = [];
      for (let i = 0; i < docIdsToDelete.length; i += CHUNK_SIZE) {
        chunks.push(docIdsToDelete.slice(i, i + CHUNK_SIZE));
      }

      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(id => deleteDoc(doc(db, 'result_updated', id)))
        );
      }

      // Also log this
      await addLog({
        userId: user?.uid || 'system',
        userEmail: user?.email || 'unknown',
        action: LogAction.DELETE,
        category: LogCategory.TEST,
        resourceId: 'bulk-orphans',
        resourceName: 'Orphaned Results Cleanup',
        details: `Deleted ${orphanedDocs.length} orphaned results from the database`,
      });

      toast.success(`Successfully deleted ${orphanedDocs.length} orphaned results!`, { id: toastId });
      fetchResults(selectedTestIds);
    } catch (err: any) {
      console.error('Failed to cleanup orphaned results:', err);
      toast.error(err.message || 'Cleanup failed', { id: toastId });
    } finally {
      setLoading(false);
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
      const qbgMap = metaQbgMap;

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
      const snap = await getDocs(query(collection(db, 'tests'), limit(150)));
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      fetched.sort((a: any, b: any) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateB.localeCompare(dateA);
      });
      setTests(fetched);
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
      const queries = testIds.map(id => query(collection(db, 'result_updated'), where('testId', '==', id)));
      const snaps = await Promise.all(queries.map(q => getDocs(q)));
      snaps.forEach(snap => {
        allResults.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });

      // In-memory sort by score descending to prevent database in-memory sort limits or composite index requisites
      allResults.sort((a, b) => {
        if (a.isAbsent && !b.isAbsent) return 1;
        if (!a.isAbsent && b.isAbsent) return -1;
        return (b.score || 0) - (a.score || 0);
      });

      // Dynamically fetch and merge up-to-date student details to solve any stale/missing mapping issues!
      const uniqueRegNos = Array.from(new Set(allResults.map(r => String(r.regNo || '').trim().toUpperCase()).filter(Boolean)));
      const studentMap: Record<string, any> = {};
      
      if (uniqueRegNos.length > 0) {
        const missingRegNos = uniqueRegNos.filter(regNo => !studentCache[regNo]);
        
        if (missingRegNos.length > 0) {
          const chunks: string[][] = [];
          for (let i = 0; i < missingRegNos.length; i += 30) {
            chunks.push(missingRegNos.slice(i, i + 30));
          }
          
          try {
            const studentSnaps = await Promise.all(
              chunks.map(chunk => getDocs(query(collection(db, 'students'), where('regNo', 'in', chunk))))
            );
            studentSnaps.forEach(snap => {
              snap.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (data.regNo) {
                  const regUpper = String(data.regNo).trim().toUpperCase();
                  studentCache[regUpper] = { id: docSnap.id, ...data };
                }
              });
            });
          } catch (studentErr) {
            console.warn("Failed fetching students dynamically for results merging:", studentErr);
          }
        }

        uniqueRegNos.forEach(regNo => {
          if (studentCache[regNo]) {
            studentMap[regNo] = studentCache[regNo];
          }
        });
      }

      // Now, merge the fresh student details on the fly!
      const mergedResults = allResults.map(res => {
        const key = String(res.regNo || '').trim().toUpperCase();
        const studentInfo = studentMap[key];
        
        if (studentInfo) {
          // Resolve batch and center names using cached metadata
          const batchId = studentInfo.batchId || res.batchId;
          const centerId = studentInfo.centerId || res.centerId;
          const programId = studentInfo.programId || res.programId;
          
          const batchDetail = findBatchSafely(batchId, metaBatches);
          const centerDetail = findCenterSafely(centerId, metaCenters);
          const programDetail = findProgramSafely(programId, metaPrograms);
          
          return {
            ...res,
            studentName: studentInfo.name || res.studentName,
            phone: studentInfo.phone || res.phone,
            email: studentInfo.email || res.email,
            centerId: centerDetail?.id || centerId,
            centerName: centerDetail?.centerName || res.centerName,
            batchId: batchDetail?.id || batchId,
            batchName: batchDetail?.batchName || res.batchName,
            batchCode: studentInfo.batchCode || batchDetail?.batchCode || res.batchCode,
            programId: programDetail?.id || programId,
            programName: programDetail?.programName || res.programName,
            type: studentInfo.type || '',
            rankTarget: studentInfo.rankTarget || '',
            targetYear: studentInfo.targetYear || '',
          };
        } else {
          // If no student document exists but ids are in result, still map batch/center names dynamically from cached metadata if possible!
          const batchDetail = findBatchSafely(res.batchId, metaBatches);
          const centerDetail = findCenterSafely(res.centerId, metaCenters);
          const programDetail = findProgramSafely(res.programId, metaPrograms);
          
          return {
            ...res,
            centerId: centerDetail?.id || res.centerId,
            centerName: centerDetail?.centerName || res.centerName,
            batchId: batchDetail?.id || res.batchId,
            batchName: batchDetail?.batchName || res.batchName,
            programId: programDetail?.id || res.programId,
            programName: programDetail?.programName || res.programName,
          };
        }
      });

      const normalizedResults = mergedResults.map(r => ({
        ...r,
        subjectStats: standardizeSubjectStats(r.subjectStats)
      }));

      setResults(normalizedResults);
      
      // Keep selectedResult in sync if it's currently open
      if (selectedResult) {
        const updated = normalizedResults.find(r => r.id === selectedResult.id);
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
      const next = prev.includes(testId) ? [] : [testId];
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
        'Student Name': exportWithName ? res.studentName : `STUDENT_${res.regNo || 'ANON'}`,
        'Center': res.centerName || '—',
        'Batch': res.batchName || '—',
        'Total Score': res.score,
        'Estimated Rank Bucket': determineRankBucket(res.score, res.testMaxScore, res.testPattern),
        'Physics': pScore,
        'Chemistry': cScore,
        'Mathematics': mScore,
        'Correct': res.correct || 0,
        'Wrong': res.wrong || 0,
        'Unattempted': res.blank || 0,
        'Accuracy %': `${Math.round(res.accuracy || 0)}%`,
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

  const handleExportExcel = () => {
    if (sortedResults.length === 0) {
      toast.error('No results to export');
      return;
    }

    const testName = selectedTestIds.length === 1 
      ? tests.find(t => t.id === selectedTestIds[0])?.name || 'Results'
      : `${selectedTestIds.length} Combined Test Series Results`;

    const displaySubjects = allAvailableSubjects;

    // Build the grid representation for the Excel Sheet
    const aoa: any[][] = [
      ["CONSOLIDATED STUDENT PERFORMANCE TRACKING & COMPARATIVE MATRIX"],
      [`Test Series: ${testName}`],
      [`Exported On: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} • Generated securely`],
      [], // Spacing Row
    ];

    // Formatted Table Headers
    const headers = [
      'Rank',
      'Roll No',
      'Student Name',
      'Batch',
      'Center',
      ...displaySubjects.map(sub => sub.toUpperCase()),
      'Accuracy %',
      'Correct (C)',
      'Wrong (W)',
      'Unattempted (U)',
      'Total Score'
    ];
    aoa.push(headers);

    // Formatted Student Rows
    sortedResults.forEach(res => {
      const scoreMaxLimit = selectedTestIds.length === 1 
        ? (tests.find(t => t.id === selectedTestIds[0])?.maxScore || 300) 
        : (res.testMaxScore || 300);

      const rollNo = res.regNo || '—';
      const studentName = exportWithName ? res.studentName : `STUDENT_${res.regNo || 'ANON'}`;
      const batchCode = res.batchCode || '—';
      const centerName = res.centerName || '—';
      const accuracy = res.isAbsent ? '—' : `${Math.round(res.accuracy || 0)}%`;
      const correct = res.isAbsent ? '—' : (res.correct ?? 0);
      const wrong = res.isAbsent ? '—' : (res.wrong ?? res.incorrect ?? 0);
      const blank = res.isAbsent ? '—' : (res.blank ?? res.unattempted ?? 0);
      const totalScore = res.isAbsent ? 'ABSENT' : `${res.score}/${scoreMaxLimit}`;

      const row = [
        res.isAbsent ? '—' : `${res.rank}`,
        rollNo,
        studentName,
        batchCode,
        centerName
      ];

      // Subject specific marks
      displaySubjects.forEach(sub => {
        const subScore = res.isAbsent ? '—' : (res.subjectStats?.[sub]?.score ?? 0);
        row.push(subScore);
      });

      row.push(accuracy);
      row.push(correct);
      row.push(wrong);
      row.push(blank);
      row.push(totalScore);

      aoa.push(row);
    });

    // Spacer
    aoa.push([]);

    // Highest Score Summary Row
    const maxRow: any[] = [
      'MAX (HIGHEST)',
      '',
      '',
      '',
      ''
    ];
    displaySubjects.forEach(sub => {
      const stat = headersStats[sub] || { highest: '—' };
      maxRow.push(stat.highest);
    });
    maxRow.push(''); // No specific accuracy max formula
    maxRow.push(''); // No correct max
    maxRow.push(''); // No wrong max
    maxRow.push(''); // No blank max
    const totalMaxStat = headersStats['CUMULATIVE'] || { highest: '—' };
    maxRow.push(totalMaxStat.highest);
    aoa.push(maxRow);

    // Average Score Summary Row
    const avgRow: any[] = [
      'AVERAGE SCORES',
      '',
      '',
      '',
      ''
    ];
    displaySubjects.forEach(sub => {
      const stat = headersStats[sub] || { avg: '—' };
      avgRow.push(stat.avg);
    });
    avgRow.push(''); // No accuracy average
    avgRow.push(''); // No correct avg
    avgRow.push(''); // No wrong avg
    avgRow.push(''); // No blank avg
    const totalAvgStat = headersStats['CUMULATIVE'] || { avg: '—' };
    avgRow.push(totalAvgStat.avg);
    aoa.push(avgRow);

    // Instantiate and fill Excel Worksheet
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Define elegant column auto-spacing properties to avoid numerical #### errors or cutoffs
    const colsWidths = [
      { wch: 8 },  // Rank
      { wch: 15 }, // Roll No
      { wch: 28 }, // Student Name
      { wch: 20 }, // Batch
      { wch: 22 }, // Center
      ...displaySubjects.map(() => ({ wch: 15 })), // Dynamic Subject Columns
      { wch: 14 }, // Accuracy
      { wch: 12 }, // Correct
      { wch: 12 }, // Wrong
      { wch: 15 }, // Unattempted
      { wch: 16 }  // Total Score
    ];
    ws['!cols'] = colsWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Performance Matrix');

    const sanitizedFileName = testName.replace(/[^a-z0-9]/gi, '_');
    XLSX.writeFile(wb, `${sanitizedFileName}_Leaderboard.xlsx`);
  };

  const handleExportPDF = () => {
    if (sortedResults.length === 0) {
      toast.error('No results to export');
      return;
    }

    const doc = new jsPDF('l', 'mm', 'a4');
    const testName = selectedTestIds.length === 1 
      ? tests.find(t => t.id === selectedTestIds[0])?.name || 'Results'
      : `${selectedTestIds.length} Combined Test Series Results`;

    // Dynamic brand elements matching the screen header exactly
    const progText = filters.programId ? (metaPrograms.find((p: any) => p.id === filters.programId)?.programName || '—') : 'All Programs';
    const centerText = filters.centerId ? (metaCenters.find((c: any) => c.id === filters.centerId)?.centerName || '—') : 'All Centers';
    const batchText = filters.batchId ? (metaBatches.find((b: any) => b.id === filters.batchId)?.batchCode || '—') : 'All Batches';

    // Premium styling top header section mirroring page margins
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text("DIVISION (PROGRAM)", 14, 12);
    doc.text("CENTER", 74, 12);
    doc.text("CLASS BATCH", 134, 12);

    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(progText.toUpperCase(), 14, 17);
    doc.text(centerText.toUpperCase(), 74, 17);
    doc.text(batchText.toUpperCase(), 134, 17);

    // Official Report metadata alignment block on top right
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("OFFICIAL REPORT", 283, 12, { align: "right" });
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(new Date().toLocaleDateString(), 283, 17, { align: "right" });
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Consolidated ${selectedTestIds.length} Test${selectedTestIds.length > 1 ? 's' : ''}`, 283, 21, { align: "right" });

    // Prominent tracking title banner
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text("CONSOLIDATED STUDENT PERFORMANCE TRACKING & COMPARATIVE MATRIX", 14, 27);

    const displaySubjects = allAvailableSubjects;
    
    // Build the exact columns mirroring the beautiful screen grid
    const tableHeaders = [
      'STUDENT PROFILE\nRoll-No / Program Batch',
      ...displaySubjects.map(sub => {
        const stat = headersStats[sub] || { highest: '—', avg: '—' };
        return `${sub.toUpperCase()}\nMax: ${stat.highest} | Avg: ${stat.avg}`;
      }),
      (() => {
        const stat = headersStats['CUMULATIVE'] || { highest: '—', avg: '—' };
        return `CUMULATIVE\nMax: ${stat.highest} | Avg: ${stat.avg}`;
      })(),
      'RANK\nTest Rank'
    ];

    // Format body rows vertically aligned with score and correct/wrong/unattempted tags
    const tableRows = sortedResults.map(res => {
      const scoreMaxLimit = selectedTestIds.length === 1 
        ? (tests.find(t => t.id === selectedTestIds[0])?.maxScore || 300) 
        : (res.testMaxScore || 300);

      const rollNo = res.regNo || '—';
      const studentName = exportWithName ? res.studentName : `STUDENT_${res.regNo || 'ANON'}`;
      const batchCode = res.batchCode || '—';
      const centerName = res.centerName || '—';

      // student profile cells combining location, name and enrollment roll IDs
      const profileCell = [
        studentName,
        `#${rollNo}   ${batchCode}`,
        `${centerName.toUpperCase()}${res.type ? `  •  ${res.type}` : ''}`
      ].join('\n');

      if (res.isAbsent) {
        return [
          profileCell,
          ...displaySubjects.map(() => '—\nAbsent'),
          '— / —\nAbsent',
          '—'
        ];
      }

      // subject cells presenting both score and correct/wrong/unattempted breakdown on line 2
      const subjectCells = displaySubjects.map(sub => {
        const stats = res.subjectStats?.[sub];
        const score = stats?.score ?? 0;
        const correct = stats?.correct ?? 0;
        const wrong = stats?.wrong ?? 0;
        const blank = stats?.blank ?? 0;
        return `${score}\nC:${correct} | W:${wrong} | U:${blank}`;
      });

      // cumulative cell presenting overall score, accuracy and dynamic target tags
      const cumulativeCell = [
        `${res.score}/${scoreMaxLimit}`,
        `${Math.round(res.accuracy || 0)}% Acc  •  C:${res.correct || 0} | W:${res.wrong || 0} | U:${res.blank || 0}`,
        res.rankTarget ? `${res.rankTarget}` : ''
      ].filter(Boolean).join('\n');

      // Rank cell
      const rankCell = `#${res.rank}`;

      return [
        profileCell,
        ...subjectCells,
        cumulativeCell,
        rankCell
      ];
    });

    // Dynamic width calculation matching available landscape paper dimensions (269mm total table width)
    const columnStyles: any = {
      0: { cellWidth: 70, halign: 'left' }
    };
    columnStyles[1 + displaySubjects.length] = { cellWidth: 55, halign: 'center' };
    columnStyles[2 + displaySubjects.length] = { cellWidth: 20, halign: 'center' };

    const remainingWidth = 269 - 70 - 55 - 20;
    const subColWidth = remainingWidth / displaySubjects.length;
    for (let i = 1; i <= displaySubjects.length; i++) {
      columnStyles[i] = { cellWidth: subColWidth, halign: 'center' };
    }

    autoTable(doc, {
      head: [tableHeaders],
      body: tableRows,
      startY: 33,
      theme: 'grid',
      headStyles: {
        fillColor: [10, 25, 47], // premium dark brand blue (matching top block of screenshot)
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
        halign: 'center',
        valign: 'middle',
        cellPadding: 4
      },
      columnStyles: columnStyles,
      styles: {
        fontSize: 8,
        cellPadding: 4,
        valign: 'middle',
        lineColor: [226, 232, 240] // light slate-200 thin grid outline
      },
      didParseCell: (data: any) => {
        // Format Student Profile Name specifically (make it slightly prominent on first line)
        if (data.row.section === 'body' && data.column.index === 0) {
          data.cell.styles.fontStyle = 'normal';
        }

        // Apply Gold / Silver / Bronze coloring rules with high-contrast text to rank cells
        if (data.row.section === 'body' && data.column.index === 2 + displaySubjects.length) {
          const val = data.cell.raw;
          if (val && typeof val === 'string' && val.startsWith('#')) {
            const num = parseInt(val.replace('#', ''), 10);
            if (num === 1) {
              data.cell.styles.fillColor = [254, 243, 199]; // amber-100
              data.cell.styles.textColor = [120, 53, 4]; // amber-900
              data.cell.styles.fontStyle = 'bold';
            } else if (num === 2) {
              data.cell.styles.fillColor = [241, 245, 249]; // slate-100
              data.cell.styles.textColor = [51, 65, 85]; // slate-700
              data.cell.styles.fontStyle = 'bold';
            } else if (num === 3) {
              data.cell.styles.fillColor = [255, 237, 213]; // orange-100
              data.cell.styles.textColor = [124, 45, 18]; // orange-900
              data.cell.styles.fontStyle = 'bold';
            } else {
              data.cell.styles.textColor = [71, 85, 105]; // slate-600
              data.cell.styles.fontStyle = 'semibold';
            }
          }
        }
      }
    });

    const sanitizedFileName = testName.replace(/[^a-z0-9]/gi, '_');
    doc.save(`${sanitizedFileName}_Leaderboard.pdf`);
  };




  const searchParams = new URLSearchParams(window.location.search);
  const studentRegNoParam = searchParams.get('studentRegNo');

  if (studentRegNoParam) {
    return (
      <StudentAnalysisDashboard 
        regNo={studentRegNoParam} 
        onBack={() => {
          // Clean the query parameter and refresh status
          window.history.pushState({}, '', window.location.pathname);
          window.location.reload();
        }} 
      />
    );
  }

  if (view === 'detail' && selectedResult) {
    return (
      <ResultDetail 
        result={selectedResult} 
        onBack={() => setView(detailBackView)} 
        onUpdate={() => fetchResults(selectedTestIds)} 
        autoPrint={autoPrintDetail}
        tests={tests}
        setSelectedResult={setSelectedResult}
      />
    );
  }

  return (
    <div className="w-full p-6 md:p-10 space-y-10 relative">
      {(loading || isReevaluating) && (
        <Loader fullScreen label={isReevaluating ? "Recalculating Scores..." : "Loading Data..."} />
      )}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-4 border-b border-slate-100">
        <div className="space-y-4">
          {/* Segmented View Switcher Tabs */}
          {(role === 'admin' || role === 'central' || role === 'center' || role === 'teacher' || role === 'central_team') && (
            <div className="flex bg-slate-100 p-1.5 rounded-2xl w-fit">
              <button
                onClick={() => {
                  setView('table');
                  fetchResults(selectedTestIds);
                }}
                className={cn(
                  "px-5 py-2.5 rounded-xl text-xs font-black transition-all",
                  view === 'table' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Select Test (Table)
              </button>
              <button
                onClick={() => {
                  let ids: string[] = [];
                  if (selectedTestIds && selectedTestIds.length > 0) {
                    ids = [...selectedTestIds];
                  } else if (wizardProgramId) {
                    ids = tests.filter(t => t.programId === wizardProgramId).map(t => t.id);
                  } else if (metaPrograms && metaPrograms.length > 0) {
                    const firstProgId = metaPrograms[0].id;
                    ids = tests.filter(t => t.programId === firstProgId).map(t => t.id);
                  }

                  if (ids.length === 0) {
                    ids = tests.slice(0, 5).map(t => t.id);
                  }

                  setGlobalTestIds(ids);
                  setView('analytics');
                  fetchResults(ids);
                }}
                className={cn(
                  "px-5 py-2.5 rounded-xl text-xs font-black transition-all",
                  view === 'analytics' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Global Analysis
              </button>
            </div>
          )}

          <div className="flex items-center gap-4">
            {view === 'table' && selectedTestIds.length > 0 && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {
                  setSelectedTestIds([]);
                  setResults([]);
                }}
                className="h-12 w-12 rounded-2xl border-slate-200 flex items-center justify-center p-0 flex-shrink-0"
                title="Back to Test Selection"
              >
                <ChevronLeft size={20} strokeWidth={3} className="text-slate-600" />
              </Button>
            )}
            <div className="space-y-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] pl-0.5">Performance</p>
              <h1 className="text-4xl font-black text-slate-900 tracking-tight">Results & Analytics</h1>
              <p className="text-slate-500 font-medium text-sm">
                {view === 'analytics' 
                  ? 'Comparative analytics and standard deviation dashboard across multiple test series.' 
                  : 'View detailed rankings, accuracy reports and student performance metrics.'}
              </p>
            </div>
          </div>
        </div>

        {view === 'table' && (
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
            {/* Elegant Name Export Selector Segment */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-2xl p-1 shadow-sm">
              <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-wider pl-2 select-none font-mono">
                Names:
              </span>
              <button
                type="button"
                onClick={() => setExportWithName(true)}
                className={cn(
                  "px-2.5 py-1 text-[10.5px] font-black uppercase tracking-wider transition-all cursor-pointer",
                  exportWithName ? "bg-blue-600 text-white rounded-xl shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                With Name
              </button>
              <button
                type="button"
                onClick={() => setExportWithName(false)}
                className={cn(
                  "px-2.5 py-1 text-[10.5px] font-black uppercase tracking-wider transition-all cursor-pointer",
                  !exportWithName ? "bg-amber-500 text-slate-950 rounded-xl shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                Without Name
              </button>
            </div>

            <Button variant="outline" size="md" onClick={handleExportCSV} disabled={selectedTestIds.length === 0 || results.length === 0} className="border-slate-200">
              <Download size={18} className="mr-2 text-emerald-600" />
              Export CSV
            </Button>

            <Button variant="outline" size="md" onClick={handleExportExcel} disabled={selectedTestIds.length === 0 || results.length === 0} className="border-slate-200">
              <FileSpreadsheet size={18} className="mr-2 text-emerald-700" />
              Export Excel
            </Button>

            <Button variant="outline" size="md" onClick={handleExportPDF} disabled={selectedTestIds.length === 0 || results.length === 0} className="border-slate-200">
              <FileText size={18} className="mr-2 text-rose-600" />
              Export PDF
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


            {canEdit && (
              <Button variant="primary" size="md" onClick={() => {
                if (selectedTestIds.length === 0) {
                  toast.error('Please select a test first');
                  return;
                }
                setShowManualEntry(true);
                setEditingResultId(null);
                setManualData({ regNo: '', name: '', phone: '', email: '', testMode: 'offline', isAbsent: false, studentAnswers: {}, type: '', rankTarget: '', targetYear: '' });
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
            {canEdit && (
              <Button 
                variant="outline" 
                size="md" 
                onClick={handleDeleteOrphanedResults}
                className="border-rose-100 text-rose-600 hover:bg-rose-50"
              >
                <Trash2 size={18} className="mr-2 text-rose-500" />
                Clean Orphans
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
        )}
      </header>

      {view === 'analytics' ? (
        <GlobalAnalytics 
          results={results} 
          tests={tests} 
          onBack={() => setView('table')} 
          selectedTestIds={globalTestIds}
          initialSearch={searchTerm}
          onTestToggle={(tId) => {
            const next = globalTestIds.includes(tId) ? globalTestIds.filter(id => id !== tId) : [...globalTestIds, tId];
            setGlobalTestIds(next);
            fetchResults(next);
          }}
          onSelectAllTests={(allIds) => {
            setGlobalTestIds(allIds);
            fetchResults(allIds);
          }}
          onSelectResult={(res) => {
            setSelectedResult(res);
            setDetailBackView('analytics');
            setAutoPrintDetail(false);
            setView('detail');
          }}
          onPrintResult={(res) => {
            setSelectedResult(res);
            setDetailBackView('analytics');
            setAutoPrintDetail(true);
            setView('detail');
          }}
          hideHeader={true}
        />
      ) : (
        <>
          {/* Top batch performance card removed — integrated into student scorecard table headers */}

      {selectedTestIds.length > 0 ? (
        <>
          {(wizardProgramId || wizardBatchId) && (
            <div className="mb-6 bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-600">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2.5 py-1 rounded-lg">Active Context</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Division:</span>
                  <span className="text-slate-900 font-black">{metaPrograms.find(p => p.id === wizardProgramId)?.programName || '—'}</span>
                </div>
                <div className="w-1 h-1 bg-slate-300 rounded-full" />
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Class:</span>
                  <span className="text-slate-900 font-black">{metaBatches.find(b => b.id === wizardBatchId)?.batchName || '—'}</span>
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  setWizardProgramId('');
                  setWizardBatchId('');
                  setSelectedTestIds([]);
                  setResults([]);
                  setFilters(prev => ({ ...prev, programId: '', batchId: '' }));
                }} 
                className="text-xs text-rose-600 font-black hover:bg-rose-50 hover:text-rose-700 px-3 py-1.5 h-auto rounded-xl"
              >
                Change Division/Class
              </Button>
            </div>
          )}
          {/* Polished Student Scorecard Leaderboard Card with Dark Header */}
          <Card className="bg-white border border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm animate-fade-in animate-duration-300">
            <div className="overflow-auto max-h-[75vh] hover-scrollbar no-scrollbar relative">
              <table className="w-full text-left border-collapse min-w-[1250px]">
                <thead className="sticky top-0 bg-slate-900 text-slate-300 z-30 border-b border-slate-800 shadow-md">
                  <tr className="text-[11px] font-black uppercase tracking-wider">
                    {/* 1st Header: Student Profile & Checkbox */}
                    <th className="px-6 py-5 text-left sticky left-0 z-35 bg-slate-900 text-white min-w-[320px] max-w-[320px] border-b border-slate-800 border-r border-slate-700">
                      <div className="flex items-center gap-3">
                        <input 
                          type="checkbox" 
                          className="rounded border-slate-700 bg-slate-800 checked:bg-blue-600 focus:ring-blue-500 text-blue-600 h-4 w-4 cursor-pointer"
                          checked={sortedResults.length > 0 && selectedResultIds.length === sortedResults.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedResultIds(sortedResults.map(r => r.id));
                            } else {
                              setSelectedResultIds([]);
                            }
                          }}
                        />
                        <div className="flex flex-col cursor-pointer hover:text-blue-400 transition-colors"
                          onClick={() => {
                            const dir = resultsSortConfig?.key === 'studentName' && resultsSortConfig.direction === 'asc' ? 'desc' : 'asc';
                            setResultsSortConfig({ key: 'studentName', direction: dir });
                          }}
                        >
                          <span className="text-[12px] text-blue-400 font-extrabold uppercase tracking-widest font-sans">
                            STUDENT PROFILE {resultsSortConfig?.key === 'studentName' && (resultsSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </span>
                          <span className="text-[9px] text-slate-400 font-bold font-mono mt-0.5 leading-none">
                            ROLL-NO / PROGRAM BATCH
                          </span>
                        </div>
                      </div>
                    </th>

                    {/* Subject Column Headers with Max & Avg score inside card element */}
                    {allAvailableSubjects.map(sub => {
                      const theme = (() => {
                        const norm = sub.toLowerCase();
                        if (norm.includes('phy')) return { border: 'border-amber-500/30', bg: 'bg-amber-500/5 hover:bg-amber-500/10', text: 'text-amber-500', name: 'PHYSICS' };
                        if (norm.includes('chem')) return { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5 hover:bg-emerald-500/10', text: 'text-emerald-500', name: 'CHEMISTRY' };
                        if (norm.includes('math') || norm.includes('mat')) return { border: 'border-sky-500/30', bg: 'bg-sky-500/5 hover:bg-sky-500/10', text: 'text-sky-500', name: 'MATHEMATICS' };
                        if (norm.includes('bot')) return { border: 'border-purple-500/30', bg: 'bg-purple-500/5 hover:bg-purple-500/10', text: 'text-purple-400', name: 'BOTANY' };
                        if (norm.includes('zoo')) return { border: 'border-pink-500/30', bg: 'bg-pink-500/5 hover:bg-pink-500/10', text: 'text-pink-400', name: 'ZOOLOGY' };
                        if (norm.includes('bio')) return { border: 'border-indigo-500/30', bg: 'bg-indigo-500/5 hover:bg-indigo-500/10', text: 'text-indigo-400', name: 'BIOLOGY' };
                        return { border: 'border-slate-500/30', bg: 'bg-slate-500/5', text: 'text-slate-400', name: sub.toUpperCase() };
                      })();
                      const stat = headersStats[sub] || { highest: '—', avg: '—' };
                      
                      return (
                        <th 
                          key={sub}
                          className="px-4 py-4 text-center cursor-pointer hover:bg-slate-800/80 transition-colors border-b border-slate-800"
                          onClick={() => {
                            const dir = resultsSortConfig?.key === `subject_${sub}` && resultsSortConfig.direction === 'asc' ? 'desc' : 'asc';
                            setResultsSortConfig({ key: `subject_${sub}`, direction: dir });
                          }}
                        >
                          <div className={cn("mx-auto rounded-xl border px-3 py-2 flex flex-col items-center max-w-[150px] transition-all", theme.border, theme.bg)}>
                            <span className={cn("text-[11px] font-black tracking-widest font-sans uppercase", theme.text)}>
                              {theme.name} {resultsSortConfig?.key === `subject_${sub}` && (resultsSortConfig.direction === 'asc' ? '↑' : '↓')}
                            </span>
                            <div className="flex gap-2 text-[9px] font-extrabold text-slate-400 mt-1 uppercase font-mono font-sans">
                              <span>MAX: <span className="text-white font-black">{stat.highest}</span></span>
                              <span>AVG: <span className="text-white font-black">{stat.avg}</span></span>
                            </div>
                          </div>
                        </th>
                      );
                    })}

                    {/* Cumulative Column Header */}
                    <th 
                      className="px-4 py-4 text-center cursor-pointer hover:bg-slate-800/80 transition-colors border-b border-slate-800"
                      onClick={() => {
                        const dir = resultsSortConfig?.key === 'score' && resultsSortConfig.direction === 'asc' ? 'desc' : 'asc';
                        setResultsSortConfig({ key: 'score', direction: dir });
                      }}
                    >
                      {(() => {
                        const stat = headersStats['CUMULATIVE'] || { highest: '—', avg: '—' };
                        return (
                          <div className="mx-auto rounded-xl border border-orange-500/30 px-3 py-2 bg-orange-500/5 hover:bg-orange-500/10 transition-all flex flex-col items-center max-w-[150px]">
                            <span className="text-[11px] font-black tracking-widest text-orange-400 font-sans uppercase">
                              CUMULATIVE {resultsSortConfig?.key === 'score' && (resultsSortConfig.direction === 'asc' ? '↑' : '↓')}
                            </span>
                            <div className="flex gap-2 text-[9px] font-extrabold text-slate-400 mt-1 uppercase font-mono font-sans">
                              <span>MAX: <span className="text-white font-black">{stat.highest}</span></span>
                              <span>AVG: <span className="text-white font-black">{stat.avg}</span></span>
                            </div>
                          </div>
                        );
                      })()}
                    </th>

                    {/* Rank Column Header */}
                    <th className="px-4 py-4 text-center border-b border-slate-800 w-32 font-sans">
                      <div className="mx-auto rounded-xl border border-yellow-500/20 px-3 py-2 bg-yellow-500/5 flex flex-col items-center max-w-[120px]">
                        <span className="text-[11.5px] font-black tracking-widest text-yellow-500 font-sans uppercase font-sans">RANK</span>
                        <span className="text-[9px] font-bold text-slate-400 mt-0.5 uppercase tracking-wide leading-none font-sans">
                          Test Rank
                        </span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedResults.map((res) => {
                    const scoreMaxLimit = selectedTestIds.length === 1 
                      ? (tests.find(t => t.id === selectedTestIds[0])?.maxScore || 300) 
                      : (res.testMaxScore || 300);

                    return (
                      <tr key={res.id} className={cn("group hover:bg-slate-50/75 transition-all text-sm", selectedResultIds.includes(res.id) && "bg-blue-50/30")}>
                        
                        {/* Student Profile Cell: Sticky Left */}
                        <td className="px-6 py-5 sticky left-0 bg-white group-hover:bg-slate-50/90 transition-colors z-10 border-b border-slate-100 border-r-4 border-amber-600/90">
                          <div className="flex items-start gap-4">
                            <input 
                              type="checkbox" 
                              className="rounded border-slate-300 mt-1 focus:ring-blue-500 text-blue-600 h-4 w-4 cursor-pointer"
                              checked={selectedResultIds.includes(res.id)}
                              onChange={() => {
                                setSelectedResultIds(prev => 
                                  prev.includes(res.id) 
                                    ? prev.filter(id => id !== res.id) 
                                    : [...prev, res.id]
                                );
                              }}
                            />
                            
                            <div className="flex flex-col gap-1 text-left min-w-0">
                              {/* Student Name */}
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedResult(res); 
                                  setDetailBackView('table');
                                  setAutoPrintDetail(false);
                                  setView('detail'); 
                                }}
                                className="text-left font-black text-slate-1000 group-hover:text-blue-700 text-[15px] leading-tight focus:outline-none transition-all hover:underline"
                              >
                                {exportWithName ? res.studentName : `STUDENT_${res.regNo || 'ANON'}`}
                              </button>

                              {/* Badges: Registration ID and Program Batch Code */}
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px] mt-0.5 font-sans">
                                {res.regNo && (
                                  <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono font-black border border-slate-200">
                                    #{res.regNo}
                                  </span>
                                )}
                                {res.batchCode && (
                                  <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-bold border border-blue-100 font-sans">
                                    {res.batchCode}
                                  </span>
                                )}
                              </div>

                              {/* Center Location */}
                              {res.centerName && (
                                <span className="text-[10.5px] text-slate-400 font-extrabold uppercase tracking-wider font-sans mt-0.5">
                                  {res.centerName}
                                </span>
                              )}

                              {/* Sub details with enrollment and gold target badges */}
                              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                {res.type && (
                                  <span className="text-[8.5px] font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase tracking-wide">
                                    {res.type}
                                  </span>
                                )}
                                
                                {(res.rankTarget || res.targetYear) && (
                                  <span className="text-[8.5px] font-black text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded flex items-center gap-1 font-sans">
                                    <span className="text-amber-500">🎯</span>
                                    <span>UNDER {res.rankTarget || '500'}</span>
                                    {res.targetYear && <span className="text-slate-400 font-bold">({res.targetYear})</span>}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Dynamic Subject Cells */}
                        {allAvailableSubjects.map(sub => {
                          const subObj = getRawSubjectObj(res, sub as any);
                          const correct = subObj?.correct ?? 0;
                          const wrong = subObj?.wrong ?? subObj?.incorrect ?? 0;
                          const blank = subObj?.blank ?? subObj?.unattempted ?? 0;
                          const subScore = res.isAbsent ? '—' : (res.subjectStats?.[sub]?.score ?? 0);

                          return (
                            <td key={sub} className="px-4 py-5 text-center border-b border-slate-100 font-sans">
                              <div className="flex flex-col items-center justify-center font-sans">
                                <span className="text-xl font-black text-slate-900 tracking-tight font-sans">
                                  {subScore}
                                </span>
                                {!res.isAbsent && (
                                  <span className="text-[10px] font-black mt-1 font-mono tracking-tight text-slate-400 whitespace-nowrap">
                                    <span className="text-emerald-600">C:{correct}</span>
                                    <span className="mx-1 text-slate-200">|</span>
                                    <span className="text-rose-500">W:{wrong}</span>
                                    <span className="mx-1 text-slate-200">|</span>
                                    <span className="text-slate-400">U:{blank}</span>
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}

                        {/* Cumulative Cell */}
                        <td className="px-4 py-5 text-center border-b border-slate-100 bg-slate-50/20 font-sans">
                          <div className="flex flex-col items-center justify-center font-sans">
                            <span className="text-xl font-black text-slate-900 tracking-tighter font-sans">
                              {res.isAbsent ? '—' : `${res.score}/${scoreMaxLimit}`}
                            </span>
                            {!res.isAbsent && (
                              <>
                                <span className="text-[10px] font-black text-emerald-600 font-sans mt-0.5 uppercase tracking-wide">
                                  {Math.round(res.accuracy || 0)}% Acc
                                </span>
                                <span className="text-[10px] font-black font-mono tracking-tight text-slate-400 mt-0.5 whitespace-nowrap">
                                  <span className="text-emerald-600 font-sans">C:{res.correct || 0}</span>
                                  <span className="mx-1 text-slate-200">|</span>
                                  <span className="text-rose-500 font-sans font-mono">W:{res.wrong || res.incorrect || 0}</span>
                                  <span className="mx-1 text-slate-200">|</span>
                                  <span className="text-slate-400 font-sans font-mono">U:{res.blank || res.unattempted || 0}</span>
                                </span>
                                
                                {/* Actions Container: PDF Badge + Admin Action */}
                                <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2">
                                  <span className="text-[8.5px] font-black text-rose-700 bg-rose-50 border border-rose-100 rounded px-2 py-0.5 tracking-tight uppercase font-mono leading-none">
                                    {determineRankBucket(res.score, scoreMaxLimit, res.testPattern)}
                                  </span>
                                  
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedResult(res);
                                      setDetailBackView('table');
                                      setAutoPrintDetail(true);
                                      setView('detail');
                                    }}
                                    title="Print PDF Scorecard"
                                    className="py-0.5 px-2 text-red-600 hover:text-red-700 bg-white hover:bg-red-50 border border-red-200 hover:border-red-300 rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer shadow-sm text-[8.5px] font-black uppercase tracking-tight h-[18px] leading-none"
                                  >
                                    <FileText size={10} strokeWidth={3} className="text-red-500" />
                                    <span>PDF</span>
                                  </button>

                                  {isAdmin && (
                                    <button
                                      type="button"
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
                                      title="Delete Result"
                                      className="py-0.5 px-2 text-rose-600 hover:text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 hover:border-rose-300 rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer shadow-sm text-[8.5px] font-black uppercase tracking-tight h-[18px] leading-none"
                                    >
                                      <Trash2 size={10} strokeWidth={3} className="text-rose-500" />
                                      <span>Delete</span>
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </td>

                        {/* Rank Cell */}
                        <td className={cn(
                          "text-center font-extrabold text-2xl px-4 py-5 border-b border-slate-100 w-32 font-sans",
                          res.isAbsent ? "text-slate-200" :
                          res.rank === 1 ? "text-amber-600 bg-amber-50/20 font-black" :
                          res.rank === 2 ? "text-slate-600 bg-slate-50/20 font-black" :
                          res.rank === 3 ? "text-orange-600 bg-orange-50/20 font-black" :
                          "text-slate-400 bg-slate-50/5"
                        )}>
                          {res.isAbsent ? '—' : `#${res.rank}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
            </table>
          </div>
        </Card>
        </>
      ) : (
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 md:p-12 shadow-sm space-y-8 animate-fade-in">
           {/* Header */}
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-50 pb-8">
              <div>
                 <Badge variant="blue" className="text-[10px] font-black uppercase tracking-widest px-3 py-1 bg-blue-50 text-blue-600 border-none mb-3">
                    Result Analysis Flow
                 </Badge>
                 <h2 className="text-3xl font-black text-slate-900 tracking-tight">
                    Select Tests for Analysis
                 </h2>
                 <p className="text-sm text-slate-400 font-bold mt-1">
                    Select one or more test series below to trigger comparative analytics and combined scoreboard views.
                 </p>
              </div>
              <div className="flex items-center gap-3 self-start md:self-auto hidden">
                 <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                       const visibleIds = wizardFilteredTests.map((t: any) => t.id);
                       const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedTestIds.includes(id));
                       if (allSelected) {
                          const next = selectedTestIds.filter(id => !visibleIds.includes(id));
                          setSelectedTestIds(next);
                          fetchResults(next);
                       } else {
                          const next = Array.from(new Set([...selectedTestIds, ...visibleIds]));
                          setSelectedTestIds(next);
                          fetchResults(next);
                       }
                    }}
                    className="border-slate-200 font-bold text-xs rounded-xl h-10 px-4"
                    disabled={wizardFilteredTests.length === 0}
                 >
                    {wizardFilteredTests.length > 0 && wizardFilteredTests.every((t: any) => selectedTestIds.includes(t.id)) 
                       ? 'Deselect All Filtered' 
                       : 'Select All Filtered'}
                 </Button>
              </div>
           </div>

           {/* Filter controls */}
            <div className="flex flex-col md:flex-row flex-wrap items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-100 max-w-5xl text-xs font-semibold">
               <div className="relative group flex-1 w-full md:w-auto">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={12} />
                  <Input 
                     type="text"
                     placeholder="Search test..." 
                     value={testSearchQuery}
                     onChange={e => setTestSearchQuery(e.target.value)}
                     className="pl-8 rounded-xl border-slate-100 bg-slate-50 focus:bg-white text-[11px] h-9"
                  />
               </div>

               <div className="w-full md:w-auto md:min-w-[170px]">
                  <Select 
                     value={wizardProgramId} 
                     onChange={e => {
                        setWizardProgramId(e.target.value);
                        setWizardBatchId(''); // reset batch when program changes
                     }}
                     className="rounded-xl border-slate-100 bg-slate-50 text-[11px] h-9 w-full py-1 px-2.5 font-bold text-slate-600 focus:outline-none"
                  >
                     <option value="">All Programs</option>
                     {metaPrograms.map(p => (
                        <option key={p.id} value={p.id}>{p.programName}</option>
                     ))}
                  </Select>
               </div>

               <div className="w-full md:w-auto md:min-w-[150px]">
                  <Select 
                     value={wizardBatchId} 
                     onChange={e => setWizardBatchId(e.target.value)}
                     className="rounded-xl border-slate-100 bg-slate-50 text-[11px] h-9 w-full py-1 px-2.5 font-bold text-slate-600 focus:outline-none"
                  >
                     <option value="">All Batches</option>
                     {wizardFilteredBatches.map(b => (
                        <option key={b.id} value={b.id}>{b.batchName}</option>
                     ))}
                  </Select>
               </div>

               <div className="w-full md:w-auto md:min-w-[180px]">
                  <Select 
                     value={wizardDate} 
                     onChange={e => setWizardDate(e.target.value)}
                     className="rounded-xl border-slate-100 bg-slate-50 text-[11px] h-9 w-full py-1 px-2.5 font-bold text-slate-600 focus:outline-none"
                  >
                     <option value="">All Test Dates</option>
                     {uniqueTestDatesVec.map(item => (
                        <option key={item.date} value={item.date}>{item.label}</option>
                     ))}
                  </Select>
               </div>
            </div>

            {/* Tests Grid */}
            <div className="space-y-6">
               {wizardFilteredTests.length > 0 ? (
                  <div className="bg-white border border-slate-150 rounded-[2.5rem] overflow-hidden shadow-sm overflow-y-auto pr-2 no-scrollbar" style={{ maxHeight: '55vh' }}>
                     <table className="w-full text-left border-collapse min-w-[700px]">
                        <thead className="bg-slate-50 text-slate-500 border-b border-slate-100 sticky top-0 z-10">
                           <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">
                              <th className="px-6 py-4 w-12"></th>
                              <th className="px-6 py-4">Test Details</th>
                              <th className="px-6 py-4">Date</th>
                              <th className="px-6 py-4 text-center">Pattern</th>
                              <th className="px-6 py-4 text-right">Academic Program</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-semibold text-slate-700 text-sm">
                           {wizardFilteredTests.map((t) => {
                              const isSelected = selectedTestIds.includes(t.id);
                              const prog = metaPrograms.find((p) => p.id === t.programId);
                              return (
                                 <tr 
                                    key={t.id}
                                    onClick={() => handleTestToggle(t.id)}
                                    className={cn(
                                       "hover:bg-slate-50/80 cursor-pointer group transition-colors",
                                       isSelected && "bg-blue-50/20"
                                    )}
                                 >
                                    <td className="px-6 py-4 w-12" onClick={(e) => e.stopPropagation()}>
                                       <input 
                                          type="checkbox"
                                          className="w-5 h-5 rounded-lg border-2 border-slate-200 text-blue-600 focus:ring-blue-500 cursor-pointer bg-white"
                                          checked={isSelected}
                                          onChange={() => handleTestToggle(t.id)}
                                       />
                                    </td>
                                    <td className="px-6 py-4">
                                       <div className="flex flex-col">
                                          <span className="font-extrabold text-slate-900 group-hover:text-blue-600 transition-colors">{t.name}</span>
                                          <span className="text-[10px] font-mono text-slate-400">ID: {t.id}</span>
                                       </div>
                                    </td>
                                    <td className="px-6 py-4">
                                       <span className="text-[11px] font-mono font-black text-slate-500 uppercase tracking-widest">{t.date}</span>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                       <span className="text-[10px] text-indigo-600 font-black uppercase tracking-widest bg-indigo-50 px-2.5 py-1 rounded-lg">
                                          {t.pattern?.replace('_', ' ')}
                                       </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                       {prog ? (
                                          <span className="text-[10px] text-emerald-600 font-black uppercase tracking-widest bg-emerald-50 px-2.5 py-1 rounded-lg">
                                             {prog.programName}
                                          </span>
                                       ) : (
                                          <span className="text-xs text-slate-400 italic">No assigned program</span>
                                       )}
                                    </td>
                                 </tr>
                              );
                           })}
                        </tbody>
                     </table>
                  </div>
               ) : (
                 <div className="py-16 bg-slate-50/50 rounded-[2.5rem] border border-slate-100 text-center space-y-4">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                       <BarChart3 size={24} />
                    </div>
                    <div className="space-y-1">
                       <p className="text-slate-800 font-black text-lg">No matching test records found</p>
                       <p className="text-sm text-slate-400 font-bold">Try clearing filters or adjusting your search keywords.</p>
                    </div>
                    {(wizardProgramId || wizardBatchId || wizardDate || testSearchQuery) && (
                       <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => { setWizardProgramId(''); setWizardBatchId(''); setWizardDate(''); setTestSearchQuery(''); }} 
                          className="border-slate-200"
                       >
                          Reset Filters
                       </Button>
                    )}
                 </div>
              )}

              {/* Action Banner for selected tests */}
              {selectedTestIds.length > 0 && (
                 <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-blue-50 border border-blue-100 rounded-[2rem] animate-fade-in mt-8">
                    <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-black text-sm">
                          {selectedTestIds.length}
                       </div>
                       <div>
                          <h4 className="font-black text-slate-950 text-sm">Multiple Tests Selected</h4>
                          <p className="text-xs text-slate-500 font-bold">Compare performance trends, standard deviations, and topic metrics.</p>
                       </div>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                       <Button 
                          variant="outline" 
                          onClick={() => { setSelectedTestIds([]); setResults([]); }}
                          className="border-blue-100 text-blue-700 bg-white hover:bg-blue-50 text-xs font-bold rounded-xl h-11 px-4 w-full sm:w-auto"
                       >
                          Clear Selection
                       </Button>
                       <Button 
                          variant="primary" 
                          onClick={() => {
                             setView('analytics');
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl h-11 px-6 shadow-md shadow-blue-200 w-full sm:w-auto"
                       >
                          Analyze Selected Tests →
                       </Button>
                    </div>
                 </div>
              )}
           </div>
        </div>
      )}
    </>
  )}
      <BottomSheet isOpen={isFilterOpen} onClose={() => setIsFilterOpen(false)}>
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Select Test</h2>
              <p className="text-sm text-slate-400 font-bold">Select a test to view results</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between ml-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Test Series</label>
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
                  {(role === 'center' || role === 'center_level') ? (
                    <Select 
                      value={filters.centerId} 
                      onChange={e => setFilters({...filters, centerId: e.target.value, batchId: ''})}
                      className="rounded-2xl border-slate-100 font-bold"
                    >
                      {centerId && centerId !== 'all' && centerId.includes(',') && <option value="">All My Centers</option>}
                      {masters.centers.filter((c: any) => {
                        const allowed = centerId ? centerId.split(',').map((id) => id.trim().toLowerCase()).filter(Boolean) : [];
                        return allowed.includes(String(c.id).toLowerCase()) || allowed.includes(String(c.centerName || '').toLowerCase());
                      }).map((c: any) => (
                        <option key={c.id} value={c.id}>{c.centerName}</option>
                      ))}
                    </Select>
                  ) : (
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
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Batch</label>
                  {role === 'teacher' ? (
                    <Select 
                      value={filters.batchId} 
                      onChange={e => setFilters({...filters, batchId: e.target.value})}
                      className="rounded-2xl border-slate-100 font-bold"
                    >
                      {masters.batches.filter((b: any) => b.isActive && batchIds?.includes(b.id)).map((b: any) => (
                        <option key={b.id} value={b.id}>{b.batchName}</option>
                      ))}
                    </Select>
                  ) : (
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
                  )}
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
                    studentType: 'all',
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
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          setManualData({ ...manualData, regNo: val });
                        }}
                        onBlur={async () => {
                          const val = manualData.regNo.trim();
                          if (val.length >= 3) {
                            try {
                              const q = query(collection(db, 'students'), where('regNo', '==', val));
                              const snap = await getDocs(q);
                              if (!snap.empty) {
                                const sData = snap.docs[0].data();
                                setManualData(prev => ({
                                  ...prev,
                                  name: sData.name || prev.name,
                                  phone: sData.phone || prev.phone,
                                  email: sData.email || prev.email,
                                  type: sData.type || prev.type || '',
                                  rankTarget: sData.rankTarget || prev.rankTarget || '',
                                  targetYear: sData.targetYear || prev.targetYear || ''
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

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Student Type</label>
                    <Select
                      value={manualData.type || ''}
                      onChange={e => setManualData({ ...manualData, type: e.target.value })}
                      className="font-bold border-slate-100 rounded-2xl shadow-sm"
                    >
                      <option value="">Select Student Type</option>
                      <option value="Dropper">Dropper</option>
                      <option value="12th Pass">12th Pass</option>
                      <option value="12th Study">12th Study</option>
                      <option value="11th Study">11th Study</option>
                      <option value="Foundation">Foundation</option>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Rank Target</label>
                    <Select
                      value={manualData.rankTarget || ''}
                      onChange={e => setManualData({ ...manualData, rankTarget: e.target.value })}
                      className="font-bold border-slate-100 rounded-2xl shadow-sm"
                    >
                      <option value="">Select Rank Target</option>
                      <option value="Under 100">Under 100</option>
                      <option value="Under 500">Under 500</option>
                      <option value="Under 1k">Under 1k</option>
                      <option value="Under 2k">Under 2k</option>
                      <option value="Under 3k">Under 3k</option>
                      <option value="Under 4k">Under 4k</option>
                      <option value="Under 5k">Under 5k</option>
                      <option value="Under 6k">Under 6k</option>
                      <option value="Under 7k">Under 7k</option>
                      <option value="Under 8k">Under 8k</option>
                      <option value="Under 9k">Under 9k</option>
                      <option value="Under 10k">Under 10k</option>
                      <option value="More than 10k">More than 10k</option>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Year</label>
                    <Input 
                      placeholder="Enter Target Year (e.g. 2026)"
                      value={manualData.targetYear || ''}
                      onChange={e => setManualData({ ...manualData, targetYear: e.target.value })}
                    />
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

                      // 1. Fetch data surgically (only the student record)
                      // Batches and Centers are already locally cached in useMetadata context
                      const [studentsSnap] = await Promise.all([
                        getDocs(query(collection(db, 'students'), where('regNo', '==', manualData.regNo)))
                      ]);

                      const studentInfo = studentsSnap.docs[0]?.data() || {};
                      const qbgMap = metaQbgMap;

                      // 2. Scoring Logic (Unified)
                      const stats = evaluateResult(manualData.studentAnswers, test.answerKey || {}, qbgMap, test.pattern);

                      const centerId = studentInfo.centerId || '';
                      const batchId = studentInfo.batchId || '';
                      const programId = studentInfo.programId || '';

                      const batchDetail = findBatchSafely(batchId, metaBatches);
                      const centerDetail = findCenterSafely(centerId, metaCenters);
                      const programDetail = findProgramSafely(programId, metaPrograms);

                      const resultPayload = {
                        testId: selectedTestIds[0],
                        testName: test.name || '',
                        testDate: test.date || '',
                        regNo: manualData.regNo,
                        studentName: manualData.name || studentInfo.name || 'Student (Manual)',
                        testMode: manualData.testMode || studentInfo.testMode || 'offline',
                        centerId: centerDetail?.id || centerId,
                        centerName: centerDetail?.centerName || '',
                        batchId: batchDetail?.id || batchId,
                        batchName: batchDetail?.batchName || '',
                        batchCode: studentInfo.batchCode || batchDetail?.batchCode || '',
                        programId: programDetail?.id || programId,
                        programName: programDetail?.programName || '',
                        phone: manualData.phone || studentInfo.phone || '',
                        email: manualData.email || studentInfo.email || '',
                        type: manualData.type || studentInfo.type || '',
                        rankTarget: manualData.rankTarget || studentInfo.rankTarget || '',
                        targetYear: manualData.targetYear || studentInfo.targetYear || '',
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
                          email: manualData.email || studentInfo.email || '',
                          type: manualData.type || studentInfo.type || '',
                          rankTarget: manualData.rankTarget || studentInfo.rankTarget || '',
                          targetYear: manualData.targetYear || studentInfo.targetYear || ''
                        });
                      }

                      toast.success(editingResultId ? 'Result updated successfully!' : 'Result saved successfully!');
                      setShowManualEntry(false);
                      setEditingResultId(null);
                      setManualData({ regNo: '', name: '', phone: '', email: '', testMode: 'offline', isAbsent: false, studentAnswers: {}, type: '', rankTarget: '', targetYear: '' });
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
                  {tests.map(t => {
                    const prog = metaPrograms.find((p: any) => p.id === t.programId);
                    const progLabel = prog ? ` | Program: ${prog.programName}` : '';
                    return <option key={t.id} value={t.id}>{t.name} ({t.date}{progLabel})</option>;
                  })}
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

function GlobalAnalytics({ results, tests, onBack, selectedTestIds, initialSearch = '', onTestToggle, onSelectAllTests, onSelectResult, onPrintResult, hideHeader = true }: { 
  results: any[], 
  tests: any[], 
  onBack: () => void,
  selectedTestIds: string[],
  initialSearch?: string,
  onTestToggle?: (id: string) => void,
  onSelectAllTests?: (ids: string[]) => void,
  onSelectResult?: (res: any) => void,
  onPrintResult?: (res: any) => void,
  hideHeader?: boolean
}) {
  const { qbgMap, programs: metaPrograms, centers: metaCenters, batches: metaBatches } = useMetadata();
  const { role, centerId, batchIds } = useAuth();
  const [exportWithName, setExportWithName] = useState<boolean>(true);
  const [activeAnalysisView, setActiveAnalysisView] = useState<'summary' | 'question' | 'topic' | 'student' | 'comparison' | 'center_comparison' | 'test_max_avg' | 'student_progress'>('summary');
  const [centerSubView, setCenterSubView] = useState<'all' | 'center' | 'trends' | 'progress'>('all');
  const [studentType, setStudentType] = useState<'all' | 'Hosteller' | 'Day Boarding' | 'e-Gurukul'>('all');
  const filters = { studentType };
  const setFilters = (updater: any) => {
    if (typeof updater === 'function') {
      const dummy = updater({ studentType });
      setStudentType(dummy.studentType);
    } else {
      setStudentType(updater.studentType);
    }
  };
  const [selectedCompStudentReg, setSelectedCompStudentReg] = useState<string>('');
  const [compHistory, setCompHistory] = useState<any[]>([]);
  const [isLoadingCompHistory, setIsLoadingCompHistory] = useState(false);
  const [allCompResults, setAllCompResults] = useState<any[]>([]);
  const [isLoadingAllComp, setIsLoadingAllComp] = useState(false);
  const [comparisonTestMode, setComparisonTestMode] = useState<'current' | 'two' | 'three' | 'all'>('three');
  const [selectedCompTestId, setSelectedCompTestId] = useState<string>('');

  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedTestModes, setSelectedTestModes] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState(initialSearch);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]); // Array of sKeys (regNo_name)
  const [selectedProgramId, setSelectedProgramId] = useState<string>(() => {
    if (selectedTestIds && selectedTestIds.length > 0 && tests && tests.length > 0) {
      const sampleTest = tests.find(t => t.id === selectedTestIds[0]);
      if (sampleTest?.programId) return sampleTest.programId;
    }
    if (metaPrograms && metaPrograms.length > 0) {
      return metaPrograms[0].id;
    }
    return '';
  });
  const [selectedCenterId, setSelectedCenterId] = useState<string>('');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');

  useEffect(() => {
    if ((role === 'center' || role === 'center_level') && centerId && centerId !== 'all') {
      const allowed = centerId.split(',').map(id => id.trim()).filter(Boolean);
      if (allowed.length > 0 && !selectedCenterId) {
        setSelectedCenterId(allowed[0]);
      }
    }
  }, [role, centerId, selectedCenterId]);

  useEffect(() => {
    if (initialSearch) {
      setStudentSearch(initialSearch);
    }
  }, [initialSearch]);
  const [studentSearchFocused, setStudentSearchFocused] = useState(false);
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['correct', 'incorrect', 'unattempted', 'accuracy']);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [topicSortConfig, setTopicSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'accuracy', direction: 'asc' });
  const [studentSortConfig, setStudentSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [isColumnDropdownVisible, setIsColumnDropdownVisible] = useState(false);
  const [challengingSubjectFilter, setChallengingSubjectFilter] = useState<string>('All');
  const [topicSubjectFilter, setTopicSubjectFilter] = useState<string>('All');
  const [summaryTopicSubjectFilter, setSummaryTopicSubjectFilter] = useState<string>('All');
  const [questionSubjectFilter, setQuestionSubjectFilter] = useState<string>('All');
  const [questionTestFilter, setQuestionTestFilter] = useState<string>('All');
  const [questionDateFilter, setQuestionDateFilter] = useState<string>('All');
  const [questionProgramFilter, setQuestionProgramFilter] = useState<string>('All');
  const [expandedStudentKey, setExpandedStudentKey] = useState<string>('');
  const [expandedStudentSubject, setExpandedStudentSubject] = useState<Record<string, string>>({});

  useEffect(() => {
    if (selectedTestIds && selectedTestIds.length > 0 && tests && tests.length > 0) {
      const sampleTest = tests.find(t => t.id === selectedTestIds[0]);
      if (sampleTest?.programId) {
        setSelectedProgramId(sampleTest.programId);
      }
    }
  }, [selectedTestIds, tests]);

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
    const allStudentsMap: Record<string, any> = {};
    
    results.forEach(res => {
      // Apply Test Filter
      if (selectedTestIds.length > 0 && !selectedTestIds.includes(res.testId)) return;

      // Apply Program/Division Filter
      if (selectedProgramId && res.programId !== selectedProgramId) return;

      // Apply Center Filter
      if (selectedCenterId && res.centerId !== selectedCenterId) return;

      // Apply Batch Filter
      if (selectedBatchId && res.batchId !== selectedBatchId) return;
      
      const sKey = `${res.regNo || 'NOREG'}_${res.studentName}`;
      
      // Collect for "All Students" list (dropdown/suggestions) - regardless of mode or search
      if (!allStudentsMap[sKey]) {
        allStudentsMap[sKey] = {
          regNo: res.regNo || '—',
          studentName: res.studentName,
          centerName: res.centerName || '—',
          batchName: res.batchName || '—',
          batchCode: res.batchCode || '—',
          type: res.type || '',
          rankTarget: res.rankTarget || '',
          targetYear: res.targetYear || '',
          sKey: sKey
        };
      } else {
        if (res.centerName && res.centerName !== '—') allStudentsMap[sKey].centerName = res.centerName;
        if (res.batchName && res.batchName !== '—') allStudentsMap[sKey].batchName = res.batchName;
        if (res.batchCode) allStudentsMap[sKey].batchCode = res.batchCode;
        if (res.type) allStudentsMap[sKey].type = res.type;
        if (res.rankTarget) allStudentsMap[sKey].rankTarget = res.rankTarget;
        if (res.targetYear) allStudentsMap[sKey].targetYear = res.targetYear;
      }

      // Apply Test Mode Filter for aggregate analysis
      if (selectedTestModes.length > 0 && !selectedTestModes.includes(res.testMode || 'offline')) return;

      // Apply Student Type Filter
      if (filters.studentType && filters.studentType !== 'all') {
        const typeStr = String(res.type || '').toLowerCase();
        if (filters.studentType === 'Hosteller') {
          if (!typeStr.includes('hostel')) return;
        } else if (filters.studentType === 'e-Gurukul') {
          if (!typeStr.includes('gurukul') && !typeStr.includes('guru')) return;
        } else if (filters.studentType === 'Day Boarding') {
          if (!typeStr.includes('board') && !typeStr.includes('day')) return;
        }
      }
      
      // Multi-student selection filter
      if (selectedStudents.length > 0 && !selectedStudents.includes(sKey)) return;

      // Apply Student Search Filter (fuzzy)
      if (studentSearch && selectedStudents.length === 0) {
        const search = studentSearch.toLowerCase();
        const matchesName = String(res.studentName || '').toLowerCase().includes(search);
        const matchesRegNo = String(res.regNo || '').toLowerCase().includes(search);
        const matchesCenter = String(res.centerName || '').toLowerCase().includes(search);
        const matchesBatch = String(res.batchName || '').toLowerCase().includes(search) || String(res.batchCode || '').toLowerCase().includes(search);
        
        if (!matchesName && !matchesRegNo && !matchesCenter && !matchesBatch) return;
      }

      if (!studentAggregates[sKey]) {
        studentAggregates[sKey] = {
          regNo: res.regNo || '—',
          studentName: res.studentName,
          centerName: res.centerName || '—',
          batchName: res.batchName || '—',
          batchCode: res.batchCode || '—',
          type: res.type || '',
          rankTarget: res.rankTarget || '',
          targetYear: res.targetYear || '',
          sKey: sKey,
          testsTaken: 0,
          totalScore: 0,
          totalCorrect: 0,
          totalWrong: 0,
          totalBlank: 0,
          totalQuestions: 0,
          scores: [],
          attempts: []
        };
      }
      studentAggregates[sKey].testsTaken++;
      studentAggregates[sKey].totalScore += res.score || 0;
      studentAggregates[sKey].totalCorrect += res.correct || 0;
      studentAggregates[sKey].totalWrong += res.wrong || 0;
      studentAggregates[sKey].totalBlank += res.blank || 0;
      studentAggregates[sKey].totalQuestions += (res.correct || 0) + (res.wrong || 0) + (res.blank || 0);
      studentAggregates[sKey].scores.push(res.score || 0);
      
      const testObjInstance = tests.find(t => t.id === res.testId);
      studentAggregates[sKey].attempts.push({
        testId: res.testId,
        testName: testObjInstance?.name || res.testName || 'Unknown Test',
        testDate: testObjInstance?.date || res.testDate || res.date || '—',
        score: res.score || 0,
        correct: res.correct || 0,
        wrong: res.wrong || 0,
        blank: res.blank || 0,
        mappedEvaluation: res.mappedEvaluation || []
      });
      
      if (res.centerName && res.centerName !== '—') studentAggregates[sKey].centerName = res.centerName;
      if (res.batchName && res.batchName !== '—') studentAggregates[sKey].batchName = res.batchName;
      if (res.batchCode) studentAggregates[sKey].batchCode = res.batchCode;
      if (res.type) studentAggregates[sKey].type = res.type;
      if (res.rankTarget) studentAggregates[sKey].rankTarget = res.rankTarget;
      if (res.targetYear) studentAggregates[sKey].targetYear = res.targetYear;

      // Per Student Mapped Evaluation
      const evaluations = res.mappedEvaluation || [];
      evaluations.forEach((ev: any) => {
        const sName = ev.subject || 'N/A';
        const cName = ev.chapter || 'N/A';
        const tName = (qbgMap || {})[`${ev.chapterId}_${ev.topicId}`]?.topic ||
                      (qbgMap || {})[`${ev.chapter}_${ev.topicId}`]?.topic ||
                      (qbgMap || {})[`${ev.subjectId}_${ev.chapterId}_${ev.topicId}`]?.topic ||
                      (qbgMap || {})[ev.topicId]?.topic || 
                      ev.topic || 
                      ev.topicId || 'N/A';
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
        if (!topics[tName]) topics[tName] = { totalQuestions: 0, totalCorrect: 0, chapter: cName, subject: sName };
        topics[tName].totalQuestions++;
        if (ev.status === 'correct') topics[tName].totalCorrect++;

        // Difficulty Stats
        if (!difficulties[dName]) difficulties[dName] = { totalQuestions: 0, totalCorrect: 0 };
        difficulties[dName].totalQuestions++;
        if (ev.status === 'correct') difficulties[dName].totalCorrect++;

        // Question-wise Summary
        const qKey = `${ev.testId || res.testId}_${ev.qIdx}`;
        if (!questionMap[qKey]) {
          const testObj = tests.find(t => t.id === (ev.testId || res.testId));
          questionMap[qKey] = { 
            qIdx: ev.qIdx, 
            subject: sName, 
            chapter: cName, 
            topic: tName, 
            correct: 0, 
            incorrect: 0, 
            unattempted: 0,
            num: parseInt(ev.qIdx.replace(/[^0-9]/g, '')) || 0,
            testName: testObj?.name || res.testName || 'Unknown Test',
            testDate: testObj?.date || res.testDate || res.date || '—',
            programName: res.programName || '—'
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

    let questionsList = Object.values(questionMap).map((q: any) => {
      const totalStudents = q.correct + q.incorrect + q.unattempted;
      const attempted = q.correct + q.incorrect;
      const accuracy = attempted > 0 ? Math.round((q.correct / attempted) * 100) : 0;
      return {
        ...q,
        totalStudents,
        attempted,
        accuracy
      };
    });

    if (sortConfig) {
      questionsList.sort((a: any, b: any) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];
        
        const numericKeys = ['totalStudents', 'attempted', 'correct', 'incorrect', 'unattempted', 'accuracy', 'num'];
        if (numericKeys.includes(sortConfig.key)) {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }

        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();

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
        let aVal = a[topicSortConfig.key];
        let bVal = b[topicSortConfig.key];
        const numericKeys = ['questionsCount', 'totalAttempts', 'correct', 'incorrect', 'unattempted', 'accuracy'];
        if (numericKeys.includes(topicSortConfig.key)) {
          return topicSortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
        if (aVal < bVal) return topicSortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return topicSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      topicTableList.sort((a: any, b: any) => b.totalAttempts - a.totalAttempts);
    }

    let studentTableList = Object.values(studentAggregates).map((s: any) => {
      const avgScore = Math.round(s.totalScore / s.testsTaken);
      const accuracy = Math.round((s.totalCorrect / (s.totalCorrect + s.totalWrong || 1)) * 100);

      let maxAttempt = s.attempts.length > 0 ? s.attempts[0] : null;
      let minAttempt = s.attempts.length > 0 ? s.attempts[0] : null;
      for (const att of s.attempts) {
        if (!maxAttempt || att.score > maxAttempt.score) {
          maxAttempt = att;
        }
        if (!minAttempt || att.score < minAttempt.score) {
          minAttempt = att;
        }
      }

      // Concept-wise / Topic strength & weakness - Accuracy
      const conceptScores: Record<string, { correct: number, total: number, subject: string, chapter: string, topicName: string }> = {};
      for (const att of s.attempts) {
        for (const ev of att.mappedEvaluation) {
          const sName = ev.subject || 'N/A';
          const cName = ev.chapter || 'N/A';
          const tName = (qbgMap || {})[`${ev.chapterId}_${ev.topicId}`]?.topic ||
                        (qbgMap || {})[`${ev.chapter}_${ev.topicId}`]?.topic ||
                        (qbgMap || {})[`${ev.subjectId}_${ev.chapterId}_${ev.topicId}`]?.topic ||
                        (qbgMap || {})[ev.topicId]?.topic || 
                        ev.topic || 
                        ev.topicId || 'N/A';
          const comboKey = `${sName} - ${cName} - ${tName}`;
          if (!conceptScores[comboKey]) {
            conceptScores[comboKey] = {
              correct: 0,
              total: 0,
              subject: sName,
              chapter: cName,
              topicName: tName
            };
          }
          conceptScores[comboKey].total++;
          if (ev.status === 'correct') {
            conceptScores[comboKey].correct++;
          }
        }
      }

      const conceptsList = Object.values(conceptScores).map((c: any) => ({
        ...c,
        accuracy: Math.round((c.correct / c.total) * 100)
      }));

      const strengths = [...conceptsList]
        .sort((a, b) => b.accuracy - a.accuracy || b.total - a.total)
        .slice(0, 3);

      const weaknesses = [...conceptsList]
        .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total)
        .slice(0, 3);

      // Overall subjectStats for studentwide analysis
      const subjectAggregates: Record<string, { correct: number, total: number }> = {};
      for (const att of s.attempts) {
        for (const ev of att.mappedEvaluation) {
          const sName = ev.subject || 'N/A';
          if (!subjectAggregates[sName]) {
            subjectAggregates[sName] = { correct: 0, total: 0 };
          }
          subjectAggregates[sName].total++;
          if (ev.status === 'correct') {
            subjectAggregates[sName].correct++;
          }
        }
      }

      const subjectStats = Object.entries(subjectAggregates).map(([subject, stats]) => ({
        subject,
        correct: stats.correct,
        total: stats.total,
        accuracy: Math.round((stats.correct / (stats.total || 1)) * 100)
      })).sort((a, b) => b.accuracy - a.accuracy || b.total - a.total);

      const subjectMetrics: Record<string, any> = {};
      Object.entries(subjectAggregates).forEach(([subName, sStats]) => {
        const atts: any[] = [];
        
        s.attempts.forEach((att: any) => {
          const qUnderSub = att.mappedEvaluation?.filter((ev: any) => ev.subject?.toLowerCase() === subName.toLowerCase()) || [];
          const rawSubObj = att.subjectStats ? getRawSubjectObj({ subjectStats: att.subjectStats }, subName as any) : null;
          
          if (qUnderSub.length > 0 || rawSubObj) {
            const correct = qUnderSub.length > 0
              ? qUnderSub.filter((ev: any) => ev.status === 'correct').length
              : (rawSubObj?.correct ?? 0);
            const total = qUnderSub.length > 0
              ? qUnderSub.length
              : (rawSubObj?.total ?? 0);
              
            const accuracy = total > 0 ? Math.round((correct / total) * 100) : (rawSubObj?.accuracy ?? 0);
            
            let scoreVal = rawSubObj?.score !== undefined ? rawSubObj.score : rawSubObj?.Score;
            if (scoreVal === undefined || scoreVal === null || isNaN(Number(scoreVal))) {
              if (qUnderSub.length > 0) {
                const hasMarks = qUnderSub.some((val: any) => val.scoreReceived !== undefined);
                if (hasMarks) {
                  scoreVal = qUnderSub.reduce((acc: number, val: any) => acc + (val.scoreReceived || 0), 0);
                } else {
                  scoreVal = correct;
                }
              } else {
                scoreVal = 0;
              }
            }
            
            atts.push({
              testName: att.testName,
              testDate: att.testDate,
              score: Number(scoreVal),
              accuracy: Number(accuracy),
              correct,
              total
            });
          }
        });

        if (atts.length > 0) {
          const totalScoreSum = atts.reduce((sum, item) => sum + item.score, 0);
          const avgScore = Math.round(totalScoreSum / atts.length);
          const avgAccuracy = Math.round(atts.reduce((sum, item) => sum + item.accuracy, 0) / atts.length);
          
          const sortedByScore = [...atts].sort((a, b) => b.score - a.score || b.accuracy - a.accuracy);
          const maxAtt = sortedByScore[0];
          const minAtt = sortedByScore[sortedByScore.length - 1];
          
          const subConcepts = conceptsList.filter((c: any) => c.subject?.toLowerCase() === subName.toLowerCase());
          const sortedConcepts = [...subConcepts].sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
          const weakest = sortedConcepts.length > 0 ? sortedConcepts[0] : null;
          const strongest = sortedConcepts.length > 0 ? sortedConcepts[sortedConcepts.length - 1] : null;
          
          subjectMetrics[subName] = {
            avgScore,
            avgAccuracy,
            maxAttempt: maxAtt ? { testName: maxAtt.testName, testDate: maxAtt.testDate, score: maxAtt.score, accuracy: maxAtt.accuracy, correct: maxAtt.correct, total: maxAtt.total } : null,
            minAttempt: minAtt ? { testName: minAtt.testName, testDate: minAtt.testDate, score: minAtt.score, accuracy: minAtt.accuracy, correct: minAtt.correct, total: minAtt.total } : null,
            weakestTopic: weakest ? { topicName: weakest.topicName, chapter: weakest.chapter, accuracy: weakest.accuracy } : null,
            strongestTopic: strongest ? { topicName: strongest.topicName, chapter: strongest.chapter, accuracy: strongest.accuracy } : null,
          };
        }
      });

      return {
        ...s,
        avgScore,
        accuracy,
        maxAttempt,
        minAttempt,
        strengths,
        weaknesses,
        subjectStats,
        subjectMetrics
      };
    });

    // For the suggestion list, we want all students regardless of selectedStudents filter
    const allStudentsList = Object.values(allStudentsMap);

    if (studentSortConfig) {
      studentTableList.sort((a: any, b: any) => {
        const aVal = a[studentSortConfig.key];
        const bVal = b[studentSortConfig.key];
        if (aVal < bVal) return studentSortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return studentSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      studentTableList.sort((a: any, b: any) => b.avgScore - a.avgScore);
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
  }, [results, qbgMap, selectedSubjects, selectedChapters, selectedTopics, selectedTestIds, selectedTestModes, studentSearch, selectedStudents, studentSortConfig, sortConfig, topicSortConfig, selectedProgramId, selectedCenterId, selectedBatchId, tests, filters.studentType]);

  useEffect(() => {
    if (!selectedCompStudentReg && aggregateStats?.allStudents && aggregateStats.allStudents.length > 0) {
      const firstWithReg = aggregateStats.allStudents.find((s: any) => s.regNo && s.regNo !== '—');
      if (firstWithReg) {
        setSelectedCompStudentReg(firstWithReg.regNo);
      } else if (aggregateStats.allStudents[0]?.regNo) {
        setSelectedCompStudentReg(aggregateStats.allStudents[0].regNo);
      }
    }
  }, [aggregateStats, selectedCompStudentReg]);

  // Elite candidates cross-center highlights
  const outstandingCandidates = useMemo(() => {
    if (results.length === 0) return [];
    const seen = new Set();
    const list: any[] = [];
    const sorted = [...results]
      .filter(r => !r.isAbsent && r.score != null)
      .sort((a, b) => (b.score || 0) - (a.score || 0));
      
    for (const r of sorted) {
      if (list.length >= 6) break;
      const key = `${r.regNo}_${r.studentName}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({
          studentName: r.studentName,
          regNo: r.regNo,
          centerName: r.centerName,
          batchName: r.batchName,
          score: r.score,
          maxScore: r.maxScore || (r.testPattern === 'NEET' || (tests.find(t => t.id === r.testId)?.pattern === 'NEET') ? 720 : 360),
          accuracy: r.accuracy || 0,
          testName: r.testName
        });
      }
    }
    return list;
  }, [results, tests]);

  // Center on Center comparison calculation
  const centerComparisonData = useMemo(() => {
    if (results.length === 0) return [];
    const centerGroups: Record<string, any[]> = {};
    
    results.forEach(res => {
      if (selectedTestIds.length > 0 && !selectedTestIds.includes(res.testId)) return;
      if (selectedProgramId && res.programId !== selectedProgramId) return;
      if (selectedCenterId && res.centerId !== selectedCenterId) return;
      if (selectedBatchId && res.batchId !== selectedBatchId) return;
      if (selectedTestModes.length > 0 && !selectedTestModes.includes(res.testMode || 'offline')) return;
      if (filters.studentType && filters.studentType !== 'all') {
        const typeStr = String(res.type || '').toLowerCase();
        if (filters.studentType === 'Hosteller') {
          if (!typeStr.includes('hostel')) return;
        } else if (filters.studentType === 'e-Gurukul') {
          if (!typeStr.includes('gurukul') && !typeStr.includes('guru')) return;
        } else if (filters.studentType === 'Day Boarding') {
          if (!typeStr.includes('board') && !typeStr.includes('day')) return;
        }
      }
      
      const cName = res.centerName || 'Unknown Center';
      if (!centerGroups[cName]) {
        centerGroups[cName] = [];
      }
      centerGroups[cName].push(res);
    });
    
    return Object.entries(centerGroups).map(([centerName, resList]) => {
      const totalAttempts = resList.length;
      const uniqueStudents = new Set(resList.map(r => r.regNo || r.studentName)).size;
      const totalScore = resList.reduce((sum, r) => sum + (r.score || 0), 0);
      const avgScore = totalAttempts > 0 ? Math.round(totalScore / totalAttempts) : 0;
      const maxScore = Math.max(...resList.map(r => r.score || 0));
      
      let totalCorrect = 0;
      let totalQuestions = 0;
      resList.forEach(r => {
        totalCorrect += r.correct || 0;
        totalQuestions += (r.correct || 0) + (r.wrong || 0) + (r.blank || 0);
      });
      const avgAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
      
      return {
        centerName,
        totalAttempts,
        uniqueStudents,
        avgScore,
        maxScore,
        avgAccuracy
      };
    }).sort((a, b) => b.avgScore - a.avgScore);
  }, [results, selectedTestIds, selectedProgramId, selectedCenterId, selectedBatchId, selectedTestModes, filters.studentType]);

  // Max Avg Comparison on Test calculation
  const testMaxAvgData = useMemo(() => {
    const testMap: Record<string, { testId: string, testName: string, testDate: string, scores: number[], correct: number, totalQ: number, attendance: number }> = {};
    
    results.forEach(res => {
      if (selectedTestIds.length > 0 && !selectedTestIds.includes(res.testId)) return;
      if (selectedProgramId && res.programId !== selectedProgramId) return;
      if (selectedCenterId && res.centerId !== selectedCenterId) return;
      if (selectedBatchId && res.batchId !== selectedBatchId) return;
      if (selectedTestModes.length > 0 && !selectedTestModes.includes(res.testMode || 'offline')) return;
      if (filters.studentType && filters.studentType !== 'all') {
        const typeStr = String(res.type || '').toLowerCase();
        if (filters.studentType === 'Hosteller') {
          if (!typeStr.includes('hostel')) return;
        } else if (filters.studentType === 'e-Gurukul') {
          if (!typeStr.includes('gurukul') && !typeStr.includes('guru')) return;
        } else if (filters.studentType === 'Day Boarding') {
          if (!typeStr.includes('board') && !typeStr.includes('day')) return;
        }
      }
      
      const tId = res.testId;
      if (!testMap[tId]) {
        const tObj = tests.find(t => t.id === tId);
        testMap[tId] = {
          testId: tId,
          testName: tObj?.name || res.testName || 'Unknown Test',
          testDate: tObj?.date || res.testDate || res.date || '—',
          scores: [],
          correct: 0,
          totalQ: 0,
          attendance: 0
        };
      }
      
      testMap[tId].scores.push(res.score || 0);
      testMap[tId].correct += res.correct || 0;
      testMap[tId].totalQ += (res.correct || 0) + (res.wrong || 0) + (res.blank || 0);
      testMap[tId].attendance++;
    });
    
    return Object.values(testMap).map(t => {
      const maxScore = t.scores.length > 0 ? Math.max(...t.scores) : 0;
      const avgScore = t.scores.length > 0 ? Math.round(t.scores.reduce((sum, s) => sum + s, 0) / t.scores.length) : 0;
      const avgAccuracy = t.totalQ > 0 ? Math.round((t.correct / t.totalQ) * 100) : 0;
      
      return {
        testId: t.testId,
        testName: t.testName,
        testDate: t.testDate,
        maxScore,
        avgScore,
        avgAccuracy,
        attendance: t.attendance
      };
    }).sort((a, b) => String(a.testDate).localeCompare(String(b.testDate)));
  }, [results, selectedTestIds, selectedProgramId, selectedCenterId, selectedBatchId, selectedTestModes, filters.studentType, tests]);

  // Student Progress calculation
  const studentProgressData = useMemo(() => {
    const list: any[] = [];
    let progressedCount = 0;
    let declinedCount = 0;
    let stableCount = 0;
    let singleTestCount = 0;
    
    if (!aggregateStats?.studentTable) return { list: [], progressedCount, declinedCount, stableCount, singleTestCount };
    
    aggregateStats.studentTable.forEach((s: any) => {
      const attempts = s.attempts || [];
      if (attempts.length === 0) return;
      
      const sortedAttempts = [...attempts].sort((a: any, b: any) => String(a.testDate).localeCompare(String(b.testDate)));
      const count = sortedAttempts.length;
      if (count === 1) {
        singleTestCount++;
        list.push({
          studentName: s.studentName,
          regNo: s.regNo,
          centerName: s.centerName,
          batchName: s.batchName,
          attemptsCount: 1,
          firstScore: sortedAttempts[0].score,
          lastScore: sortedAttempts[0].score,
          change: 0,
          status: 'Single Test',
          trend: []
        });
        return;
      }
      
      const firstAttempt = sortedAttempts[0];
      const lastAttempt = sortedAttempts[count - 1];
      const change = (lastAttempt.score || 0) - (firstAttempt.score || 0);
      
      let status: 'Progressed' | 'Declined' | 'Stable' = 'Stable';
      if (change > 5) {
        status = 'Progressed';
        progressedCount++;
      } else if (change < -5) {
        status = 'Declined';
        declinedCount++;
      } else {
        stableCount++;
      }
      
      list.push({
        studentName: s.studentName,
        regNo: s.regNo,
        centerName: s.centerName,
        batchName: s.batchName,
        attemptsCount: count,
        firstScore: firstAttempt.score,
        lastScore: lastAttempt.score,
        change,
        status,
        trend: sortedAttempts.map(a => ({ testName: a.testName, score: a.score }))
      });
    });
    
    return {
      list: list.sort((a, b) => b.change - a.change),
      progressedCount,
      declinedCount,
      stableCount,
      singleTestCount
    };
  }, [aggregateStats]);

  useEffect(() => {
    const fetchCompHistory = async () => {
      if (!selectedCompStudentReg) {
        setCompHistory([]);
        return;
      }
      setIsLoadingCompHistory(true);
      try {
        const historyQuery = query(
          collection(db, 'result_updated'),
          where('regNo', '==', selectedCompStudentReg)
        );
        const snap = await getDocs(historyQuery);
        const historyDocs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
        
        // Sort history chronologically by testDate (ascending)
        const sorted = historyDocs.sort((a, b) => {
          const dateCompare = (a.testDate || '').localeCompare(b.testDate || '');
          if (dateCompare !== 0) return dateCompare;
          const aTime = a.createdAt?.seconds || 0;
          const bTime = b.createdAt?.seconds || 0;
          return aTime - bTime;
        });
        setCompHistory(sorted);
      } catch (err) {
        console.error("Failed to load comparison student history:", err);
      } finally {
        setIsLoadingCompHistory(false);
      }
    };
    fetchCompHistory();
  }, [selectedCompStudentReg]);

  useEffect(() => {
    const fetchAllCompResults = async () => {
      if (activeAnalysisView !== 'comparison') return;
      setIsLoadingAllComp(true);
      try {
        // Collect applicable tests based on active filters to scope comparison tightly
        let applicableTests = [...tests];

        if (selectedProgramId) {
          applicableTests = applicableTests.filter(t => t.programId === selectedProgramId);
        }
        if (selectedBatchId) {
          applicableTests = applicableTests.filter(t => t.batchIds?.includes(selectedBatchId) || t.batchId === selectedBatchId);
        }

        // Sort chronologically by date
        applicableTests.sort((a, b) => {
          const dateA = a.date || '';
          const dateB = b.date || '';
          return dateB.localeCompare(dateA);
        });

        // Resolve tests to query
        // We always scope comparison to the active selection or the most recent 30 tests matching our scope.
        let testIdsToQuery = selectedTestIds.length > 0
          ? selectedTestIds.filter(id => applicableTests.some(t => t.id === id))
          : [];

        if (testIdsToQuery.length === 0) {
          testIdsToQuery = applicableTests.map(t => t.id);
        }

        if (testIdsToQuery.length === 0) {
          setAllCompResults([]);
          setIsLoadingAllComp(false);
          return;
        }

        // Keep at most 30 tests to fit within the Firestore 'in' query limit of 30
        if (testIdsToQuery.length > 30) {
          testIdsToQuery = testIdsToQuery.slice(0, 30);
        }

        let resultsQuery: any;
        let studentsQuery: any;

        const resultsColl = collection(db, 'result_updated');
        const studentsColl = collection(db, 'students');

        const allowedCenters = (role === 'center' || role === 'center_level') && centerId && centerId !== 'all'
          ? centerId.split(',').map(id => id.trim()).filter(Boolean)
          : [];

        if (selectedBatchId) {
          studentsQuery = query(studentsColl, where('batchId', '==', selectedBatchId));
        } else if (selectedCenterId) {
          studentsQuery = query(studentsColl, where('centerId', '==', selectedCenterId));
        } else if (selectedProgramId) {
          studentsQuery = query(studentsColl, where('programId', '==', selectedProgramId));
        } else if (allowedCenters.length > 0) {
          studentsQuery = query(studentsColl, where('centerId', 'in', allowedCenters));
        } else {
          studentsQuery = query(studentsColl, limit(150));
        }

        resultsQuery = query(resultsColl, where('testId', 'in', testIdsToQuery));

        const [resultsSnap, studentsSnap] = await Promise.all([
          getDocs(resultsQuery),
          getDocs(studentsQuery)
        ]);

        const resultsList = resultsSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })) as any[];
        const studentsList = studentsSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })) as any[];
        const studentMap = studentsList.reduce((acc: any, s) => {
          if (s.regNo) {
            acc[String(s.regNo).trim().toUpperCase()] = s;
          }
          return acc;
        }, {});

        // Fetch global comparison results for those same test IDs to get true unfiltered rankings across all centers
        const compTestIds = Array.from(new Set(resultsList.map(r => r.testId).filter(Boolean))) as string[];
        const globalComparisonRanks: Record<string, Record<string, number>> = {};
        if (compTestIds.length > 0) {
          try {
            const globalQueries = compTestIds.map(tId => 
              query(collection(db, 'result_updated'), where('testId', '==', tId))
            );
            const globalSnaps = await Promise.all(globalQueries.map(q => getDocs(q)));
            compTestIds.forEach((tId, idx) => {
              const snap = globalSnaps[idx];
              const testGroup = snap.docs.map(doc => doc.data() as any);
              const sortedGroup = [...testGroup].sort((a: any, b: any) => {
                if (a.isAbsent && !b.isAbsent) return 1;
                if (!a.isAbsent && b.isAbsent) return -1;
                return (b.score || 0) - (a.score || 0);
              });
              const ranks: Record<string, number> = {};
              let currentRank = 1;
              sortedGroup.forEach((r, gIdx) => {
                const regStr = r.regNo || '—';
                const sName = r.studentName || '';
                const studentKey = `${regStr}_${sName}`;
                if (r.isAbsent) {
                  ranks[studentKey] = gIdx + 1;
                  return;
                }
                if (gIdx === 0) {
                  currentRank = 1;
                } else {
                  const prevRes = sortedGroup[gIdx - 1];
                  if (r.score !== prevRes.score) {
                    currentRank = gIdx + 1;
                  }
                }
                ranks[studentKey] = currentRank;
              });
              globalComparisonRanks[tId] = ranks;
            });
          } catch (globalRanksErr) {
            console.warn("Failed fetching global test results for true rankings:", globalRanksErr);
          }
        }

        // Dynamically fetch and merge up-to-date student details for any missing student mappings in Comparison view
        const uniqueRegNos = Array.from(new Set(resultsList.map(r => String(r.regNo || '').trim().toUpperCase()).filter(Boolean)));
        const missingRegNos = uniqueRegNos.filter(regNo => !studentMap[regNo] && !studentCache[regNo]);
        
        if (missingRegNos.length > 0) {
          const chunks: string[][] = [];
          for (let i = 0; i < missingRegNos.length; i += 30) {
            chunks.push(missingRegNos.slice(i, i + 30));
          }
          try {
            const studentSnaps = await Promise.all(
              chunks.map(chunk => getDocs(query(collection(db, 'students'), where('regNo', 'in', chunk))))
            );
            studentSnaps.forEach(snap => {
              snap.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (data.regNo) {
                  const regUpper = String(data.regNo).trim().toUpperCase();
                  studentCache[regUpper] = { id: docSnap.id, ...data };
                }
              });
            });
          } catch (studentErr) {
            console.warn("Failed fetching students dynamically for comparison results:", studentErr);
          }
        }

        uniqueRegNos.forEach(regNo => {
          if (!studentMap[regNo] && studentCache[regNo]) {
            studentMap[regNo] = studentCache[regNo];
          }
        });

        const docs = resultsList.map(res => {
          const regKey = String(res.regNo || '').trim().toUpperCase();
          const studentInfo = studentMap[regKey];
          
          const regString = res.regNo || '—';
          const resolvedName = studentInfo ? (studentInfo.name || res.studentName) : res.studentName;
          const studentKey = `${regString}_${resolvedName}`;
          // Match by resolved student key or fallback original database student key
          const trueRankVal = globalComparisonRanks[res.testId]?.[studentKey] || globalComparisonRanks[res.testId]?.[`${regString}_${res.studentName}`] || 1;

          if (studentInfo) {
            const bId = studentInfo.batchId || res.batchId;
            const cId = studentInfo.centerId || res.centerId;
            const pId = studentInfo.programId || res.programId;

            const batchDetail = findBatchSafely(bId, metaBatches);
            const centerDetail = findCenterSafely(cId, metaCenters);
            const programDetail = findProgramSafely(pId, metaPrograms);

            return {
              ...res,
              studentName: studentInfo.name || res.studentName,
              centerId: centerDetail?.id || cId,
              centerName: centerDetail?.centerName || res.centerName,
              batchId: batchDetail?.id || bId,
              batchName: batchDetail?.batchName || res.batchName,
              programId: programDetail?.id || pId,
              programName: programDetail?.programName || res.programName,
              regNo: studentInfo.regNo || res.regNo,
              type: studentInfo.type || '',
              rankTarget: studentInfo.rankTarget || '',
              targetYear: studentInfo.targetYear || '',
              trueGlobalRank: trueRankVal,
            };
          } else {
            const batchDetail = findBatchSafely(res.batchId, metaBatches);
            const centerDetail = findCenterSafely(res.centerId, metaCenters);
            const programDetail = findProgramSafely(res.programId, metaPrograms);
            return {
              ...res,
              centerId: centerDetail?.id || res.centerId,
              centerName: centerDetail?.centerName || res.centerName,
              batchId: batchDetail?.id || res.batchId,
              batchName: batchDetail?.batchName || res.batchName,
              programId: programDetail?.id || res.programId,
              programName: programDetail?.programName || res.programName,
              trueGlobalRank: trueRankVal,
            };
          }
        });

        // Filter the mapped docs in-memory to prevent leaking data from other programs/centers/batches
        const filteredDocs = docs.filter(r => {
          if (selectedBatchId && r.batchId !== selectedBatchId) return false;
          if (selectedCenterId && r.centerId !== selectedCenterId) return false;
          if (selectedProgramId && r.programId !== selectedProgramId) return false;
          if (allowedCenters.length > 0 && !allowedCenters.includes(r.centerId)) return false;
          return true;
        });

        setAllCompResults(filteredDocs);
      } catch (err) {
        console.error("Failed to load all comparison results for grid with student resolution:", err);
      } finally {
        setIsLoadingAllComp(false);
      }
    };
    fetchAllCompResults();
  }, [activeAnalysisView, selectedProgramId, selectedCenterId, selectedBatchId]);

  const isMedicalProgram = useMemo(() => {
    if (selectedProgramId) {
      const prog = metaPrograms.find((p: any) => p.id === selectedProgramId);
      if (prog) {
        const name = (prog.programName || '').toUpperCase();
        const code = (prog.programCode || '').toUpperCase();
        return name.includes('NEET') || name.includes('MED') || code.includes('NEET') || code.includes('MED');
      }
    }
    // Deep fallback check: see if any test in displays or selected tests is NEET/Medical
    if (selectedTestIds && selectedTestIds.length > 0) {
      const hasNeetPropDoc = selectedTestIds.some(tId => {
        const testObj = tests.find(t => t.id === tId);
        if (testObj) {
          const pattern = (testObj.pattern || '').toUpperCase();
          const name = (testObj.name || '').toUpperCase();
          if (pattern === 'NEET' || name.includes('NEET') || name.includes('BIOLOGY') || name.includes('BOTANY') || name.includes('ZOOLOGY')) return true;
          if (testObj.programId) {
            const prog = metaPrograms.find((p: any) => p.id === testObj.programId);
            if (prog) {
              const pName = (prog.programName || '').toUpperCase();
              if (pName.includes('NEET') || pName.includes('MED')) return true;
            }
          }
        }
        return false;
      });
      if (hasNeetPropDoc) return true;
    }
    return false;
  }, [selectedProgramId, metaPrograms, selectedTestIds, tests]);

  const comparisonGridData = useMemo(() => {
    // Standardize allCompResults. If subjectStats is empty or missing, evaluate it dynamically.
    const resolvedResults = allCompResults.map(res => {
      let subjStats = res.subjectStats;
      const test = tests.find(t => t.id === res.testId);
      if (!subjStats || Object.keys(subjStats).length === 0) {
        if (test) {
          const stats = evaluateResult(res.responsesJson || {}, test.answerKey || {}, qbgMap, test.pattern);
          subjStats = stats.subjectStats;
        }
      }

      return {
        ...res,
        testName: test?.name || res.testName || 'Unknown Test',
        testDate: test?.date || res.testDate || '',
        testPattern: test?.pattern || res.pattern || '',
        testMaxScore: test?.maxScore || res.maxScore || (test?.pattern === 'NEET' ? 720 : 365),
        subjectStats: Array.isArray(subjStats) 
          ? subjStats.reduce((acc: any, s: any) => ({ ...acc, [s.name]: s }), {}) 
          : subjStats || {},
      };
    });

    // Find all tests belonging to the selected program to build columns
    let programResults = resolvedResults;
    if (selectedProgramId) {
      programResults = resolvedResults.filter(r => r.programId === selectedProgramId);
    }

    const uniqueTestsMap: Record<string, { testId: string, testName: string, testDate: string, timestamp: number }> = {};
    programResults.forEach(res => {
      if (!res.testId) return;
      const tId = res.testId;
      if (!uniqueTestsMap[tId]) {
        uniqueTestsMap[tId] = {
          testId: tId,
          testName: res.testName || '',
          testDate: res.testDate || '',
          timestamp: res.createdAt?.seconds || 0
        };
      } else {
        if (res.createdAt?.seconds && (!uniqueTestsMap[tId].timestamp || res.createdAt.seconds > uniqueTestsMap[tId].timestamp)) {
          uniqueTestsMap[tId].timestamp = res.createdAt.seconds;
        }
        if (res.testDate && !uniqueTestsMap[tId].testDate) {
          uniqueTestsMap[tId].testDate = res.testDate;
        }
      }
    });

    // Sort tests chronologically (newest to oldest)
    const chronTests = Object.values(uniqueTestsMap).sort((a, b) => {
      const dateCompare = (b.testDate || '').localeCompare(a.testDate || '');
      if (dateCompare !== 0) return dateCompare;
      return b.timestamp - a.timestamp;
    });

    // Calculate standard comparison ranks GLOBALLY per testId (before any filtering or permissions are applied)
    const testToResultsMap: Record<string, any[]> = {};
    resolvedResults.forEach(res => {
      if (!res.testId) return;
      if (!testToResultsMap[res.testId]) testToResultsMap[res.testId] = [];
      testToResultsMap[res.testId].push(res);
    });

    const globalComparisonTestRanks: Record<string, Record<string, number>> = {};
    Object.entries(testToResultsMap).forEach(([tId, list]) => {
      const sorted = [...list].sort((a, b) => {
        if (a.isAbsent && !b.isAbsent) return 1;
        if (!a.isAbsent && b.isAbsent) return -1;
        return (b.score || 0) - (a.score || 0);
      });
      const ranks: Record<string, number> = {};
      let currentRank = 1;
      sorted.forEach((res, idx) => {
        const studentKey = `${res.regNo || '—'}_${res.studentName}`;
        if (res.isAbsent) {
          ranks[studentKey] = idx + 1;
          return;
        }
        if (idx === 0) {
          currentRank = 1;
        } else {
          const prevRes = sorted[idx - 1];
          if (res.score !== prevRes.score) {
            currentRank = idx + 1;
          }
        }
        ranks[studentKey] = currentRank;
      });
      globalComparisonTestRanks[tId] = ranks;
    });

    // Group all results by student.
    const studentMap: Record<string, {
      studentName: string;
      regNo: string;
      batchId: string;
      batchName: string;
      centerId: string;
      centerName: string;
      programId: string;
      type?: string;
      rankTarget?: string;
      targetYear?: string;
      testResults: Record<string, any>;
    }> = {};

    resolvedResults.forEach(res => {
      const reg = res.regNo || '—';
      const key = `${reg}_${res.studentName}`;
      if (!studentMap[key]) {
        studentMap[key] = {
          studentName: res.studentName,
          regNo: reg,
          batchId: res.batchId || '',
          batchName: res.batchName || '—',
          centerId: res.centerId || '',
          centerName: res.centerName || '—',
          programId: res.programId || '',
          type: res.type || '',
          rankTarget: res.rankTarget || '',
          targetYear: res.targetYear || '',
          testResults: {}
        };
      }
      
      const rankVal = res.trueGlobalRank || globalComparisonTestRanks[res.testId]?.[key] || 1;
      studentMap[key].testResults[res.testId] = {
        ...res,
        rank: rankVal
      };
    });

    // Filter students at student profile level to prevent past scores from being dropped
    let filteredStudents = Object.values(studentMap);

    if (selectedProgramId) {
      filteredStudents = filteredStudents.filter(s => s.programId === selectedProgramId);
    }
    if (selectedCenterId) {
      filteredStudents = filteredStudents.filter(s => s.centerId === selectedCenterId);
    }
    if (selectedBatchId) {
      filteredStudents = filteredStudents.filter(s => s.batchId === selectedBatchId);
    }
    if (studentSearch) {
      const search = studentSearch.toLowerCase();
      filteredStudents = filteredStudents.filter(s => 
        (s.studentName || '').toLowerCase().includes(search) || 
        (s.regNo || '').toLowerCase().includes(search)
      );
    }

    // Sort students: Rank #1 of the current test (newest chronTests[0]) at the top!
    const currentTestId = chronTests[0]?.testId;
    const sortedStudents = [...filteredStudents].sort((a, b) => {
      const resA = currentTestId ? a.testResults[currentTestId] : null;
      const resB = currentTestId ? b.testResults[currentTestId] : null;

      const absentA = !resA || resA.isAbsent;
      const absentB = !resB || resB.isAbsent;

      // Relegate absent students to the bottom
      if (absentA && !absentB) return 1;
      if (!absentA && absentB) return -1;
      if (absentA && absentB) return a.studentName.localeCompare(b.studentName);

      const rankA = resA.rank || 100000;
      const rankB = resB.rank || 100000;

      if (rankA !== rankB) return rankA - rankB;
      return a.studentName.localeCompare(b.studentName);
    });

    return {
      chronTests,
      students: sortedStudents
    };
  }, [allCompResults, selectedProgramId, selectedCenterId, selectedBatchId, studentSearch, tests, qbgMap]);

  const displayedTests = useMemo(() => {
    const testsList = comparisonGridData.chronTests;
    let startIndex = 0;
    if (selectedCompTestId) {
      const idx = testsList.findIndex(t => t.testId === selectedCompTestId);
      if (idx !== -1) {
        startIndex = idx;
      }
    }
    
    if (comparisonTestMode === 'current') return testsList.slice(startIndex, startIndex + 1);
    if (comparisonTestMode === 'two') return testsList.slice(startIndex, startIndex + 2);
    if (comparisonTestMode === 'three') return testsList.slice(startIndex, startIndex + 3);
    return testsList.slice(startIndex); // 'all'
  }, [comparisonGridData.chronTests, comparisonTestMode, selectedCompTestId]);

  const testWiseStats = useMemo(() => {
    const statsMap: Record<string, {
      Physics: { max: number | string; avg: number | string };
      Chemistry: { max: number | string; avg: number | string };
      Botany: { max: number | string; avg: number | string };
      Zoology: { max: number | string; avg: number | string };
      Math: { max: number | string; avg: number | string };
      Total: { max: number | string; avg: number | string };
    }> = {};

    displayedTests.forEach(tMeta => {
      const resultsForTest: any[] = [];
      comparisonGridData.students.forEach(student => {
        const res = student.testResults[tMeta.testId];
        if (res && !res.isAbsent) {
          resultsForTest.push(res);
        }
      });

      const getStatsForSubject = (subj: 'Physics' | 'Chemistry' | 'Botany' | 'Zoology' | 'Math') => {
        const scores = resultsForTest
          .map(r => getSubjectScore(r, subj))
          .filter((v): v is number => typeof v === 'number');

        if (scores.length === 0) return { max: '—', avg: '—' };
        const maxVal = Math.max(...scores);
        const avgVal = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        return { max: maxVal, avg: avgVal };
      };

      const getStatsForTotal = () => {
        const totalScores = resultsForTest
          .map(r => r.score)
          .filter((v): v is number => typeof v === 'number');

        if (totalScores.length === 0) return { max: '—', avg: '—' };
        const maxVal = Math.max(...totalScores);
        const avgVal = Math.round(totalScores.reduce((a, b) => a + b, 0) / totalScores.length);
        return { max: maxVal, avg: avgVal };
      };

      statsMap[tMeta.testId] = {
        Physics: getStatsForSubject('Physics'),
        Chemistry: getStatsForSubject('Chemistry'),
        Botany: getStatsForSubject('Botany'),
        Zoology: getStatsForSubject('Zoology'),
        Math: getStatsForSubject('Math'),
        Total: getStatsForTotal()
      };
    });

    return statsMap;
  }, [displayedTests, comparisonGridData.students]);

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
        const name = qbgMap[`${ev.chapterId}_${ev.topicId}`]?.topic ||
                     qbgMap[`${ev.chapter}_${ev.topicId}`]?.topic ||
                     qbgMap[`${ev.subjectId}_${ev.chapterId}_${ev.topicId}`]?.topic ||
                     qbgMap[ev.topicId]?.topic || 
                     ev.topic || 
                     ev.topicId;
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
    return aggregateStats?.studentTable?.length || 0;
  }, [aggregateStats]);

  const handleExportGlobal = () => {
    if (!aggregateStats) {
      toast.error('No analytics data available to export');
      return;
    }
    let exportData: any[] = [];
    let filename = `Global_Analysis_${new Date().getTime()}.csv`;

    if (activeAnalysisView === 'summary') {
      // Export Subject Stats and Chapter Stats
      exportData = Object.entries(aggregateStats.subjects).map(([name, s]: any) => {
        const accuracy = s.totalQuestions > 0 ? Math.round((s.totalCorrect / s.totalQuestions) * 100) : 0;
        return {
          'Type': 'Subject',
          'Field/Name': name,
          'Total Questions': s.totalQuestions,
          'Total Correct': s.totalCorrect,
          'Accuracy %': `${accuracy}%`
        };
      });
      // Append Chapter Stats
      Object.entries(aggregateStats.chapters).forEach(([name, c]: any) => {
        const accuracy = c.totalQuestions > 0 ? Math.round((c.totalCorrect / c.totalQuestions) * 100) : 0;
        exportData.push({
          'Type': `Chapter (${c.subject})`,
          'Field/Name': name,
          'Total Questions': c.totalQuestions,
          'Total Correct': c.totalCorrect,
          'Accuracy %': `${accuracy}%`
        });
      });
      filename = `Subject_Chapter_Performance_${new Date().getTime()}.csv`;
    } 
    else if (activeAnalysisView === 'question') {
      const qList = aggregateStats.questions.filter((q: any) => {
        if (questionTestFilter !== 'All' && q.testName !== questionTestFilter) return false;
        if (questionDateFilter !== 'All' && q.testDate !== questionDateFilter) return false;
        if (questionProgramFilter !== 'All' && q.programName !== questionProgramFilter) return false;
        return true;
      });

      exportData = qList.map((q: any) => {
        const total = q.correct + q.incorrect + q.unattempted;
        const accuracy = (q.correct + q.incorrect) > 0 ? Math.round((q.correct / (q.correct + q.incorrect)) * 100) : 0;
        return {
          'Question Code': `Q-${q.qIdx}`,
          'Test Name': q.testName,
          'Test Date': q.testDate,
          'Program': q.programName,
          'Subject': q.subject,
          'Chapter': q.chapter,
          'Topic': q.topic,
          'Correct Graders (Count)': q.correct,
          'Wrong Graders (Count)': q.incorrect,
          'Unattempted (Count)': q.unattempted,
          'Total Graders': total,
          'Accuracy %': `${accuracy}%`
        };
      });
      filename = `Question_Wise_Performance_${new Date().getTime()}.csv`;
    } 
    else if (activeAnalysisView === 'topic') {
      exportData = aggregateStats.topicTable.map((t: any) => {
        return {
          'Topic Name': t.topic,
          'Subject Name': t.subject,
          'Chapter Name': t.chapter,
          'Questions Contributed': t.questionsCount,
          'Total Attempts (Students)': t.totalAttempts,
          'Total Correct Answers': t.correct,
          'Total Wrong Answers': t.incorrect,
          'Total Unattempted': t.unattempted,
          'Accuracy %': `${t.accuracy}%`
        };
      });
      filename = `Topic_Wise_Performance_${new Date().getTime()}.csv`;
    } 
    else if (activeAnalysisView === 'comparison') {
      handleExportComparisonCSV();
      return;
    } 
    else {
      // Default to Leaderboard (Student table) Export
      if (aggregateStats.studentTable.length === 0) {
        toast.error('No analysis data to export');
        return;
      }
      exportData = aggregateStats.studentTable.map((s: any) => ({
        'Reg No': s.regNo,
        'Student Name': exportWithName ? s.studentName : `STUDENT_${s.regNo || 'ANON'}`,
        'Tests Taken': s.testsTaken,
        'Total Score': s.totalScore,
        'Avg Score': s.avgScore,
        'Total Correct': s.totalCorrect,
        'Total Wrong': s.totalWrong,
        'Total Blank': s.totalBlank,
        'Accuracy %': `${s.accuracy}%`
      }));
      filename = `Leaderboard_Performance_${new Date().getTime()}.csv`;
    }

    if (exportData.length === 0) {
      toast.error('No results matched current filters to export');
      return;
    }

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportComparisonCSV = () => {
    if (comparisonGridData.students.length === 0) {
      toast.error('No student data to export');
      return;
    }

    const exportData: any[] = [];
    comparisonGridData.students.forEach(student => {
      displayedTests.forEach((testMeta) => {
        const testRes = student.testResults[testMeta.testId];
        const testObj = tests.find(t => t.id === testMeta.testId);

        const row: any = {
          'Student Name': exportWithName ? student.studentName : `STUDENT_${student.regNo || 'ANON'}`,
          'Registration No': student.regNo,
          'Center': student.centerName || '—',
          'Batch': student.batchName || '—',
          'Student Type': student.type || '—',
          'Rank Target': student.rankTarget || '—',
          'Test Name': testMeta.testName || 'Unknown',
          'Test Date': testMeta.testDate || '—',
        };

        if (!testRes) {
          row['Status'] = 'Absent';

          row['Physics Correct Qs'] = '—';
          row['Physics Incorrect Qs'] = '—';
          row['Physics Unattempted Qs'] = '—';
          row['Physics Score'] = '—';

          row['Chemistry Correct Qs'] = '—';
          row['Chemistry Incorrect Qs'] = '—';
          row['Chemistry Unattempted Qs'] = '—';
          row['Chemistry Score'] = '—';

          row['Botany Correct Qs'] = '—';
          row['Botany Incorrect Qs'] = '—';
          row['Botany Unattempted Qs'] = '—';
          row['Botany Score'] = '—';

          row['Zoology Correct Qs'] = '—';
          row['Zoology Incorrect Qs'] = '—';
          row['Zoology Unattempted Qs'] = '—';
          row['Zoology Score'] = '—';

          row['Biology Correct Qs'] = '—';
          row['Biology Incorrect Qs'] = '—';
          row['Biology Unattempted Qs'] = '—';
          row['Biology Score'] = '—';

          row['Mathematics Correct Qs'] = '—';
          row['Mathematics Incorrect Qs'] = '—';
          row['Mathematics Unattempted Qs'] = '—';
          row['Mathematics Score'] = '—';

          row['Total Correct Qs'] = '—';
          row['Total Incorrect Qs'] = '—';
          row['Total Unattempted Qs'] = '—';
          row['Total Score'] = '—';
          row['% Score'] = '—';
          row['Center Rank'] = '—';
          row['Predicted Rank'] = '—';
        } else {
          row['Status'] = 'Present';

          const phy = getRawSubjectObj(testRes, 'Physics');
          const chem = getRawSubjectObj(testRes, 'Chemistry');
          const bot = getRawSubjectObj(testRes, 'Botany');
          const zoo = getRawSubjectObj(testRes, 'Zoology');
          const bio = getRawSubjectObj(testRes, 'Biology');
          const math = getRawSubjectObj(testRes, 'Math');

          const phyScore = getSubjectScore(testRes, 'Physics');
          const chemScore = getSubjectScore(testRes, 'Chemistry');
          const botScore = getSubjectScore(testRes, 'Botany');
          const zooScore = getSubjectScore(testRes, 'Zoology');
          const bioScore = getSubjectScore(testRes, 'Biology');
          const mathScore = getSubjectScore(testRes, 'Math');

          const maxScoreVal = testObj?.maxScore || testRes.maxScore || (testObj?.pattern === 'NEET' || isMedicalProgram ? 720 : 360);
          const scoreVal = testRes.score || 0;
          const pct = maxScoreVal > 0 ? `${Math.round((scoreVal / maxScoreVal) * 100)}%` : '—';

          row['Physics Correct Qs'] = phy ? (phy.correct ?? 0) : 0;
          row['Physics Incorrect Qs'] = phy ? (phy.wrong ?? 0) : 0;
          row['Physics Unattempted Qs'] = phy ? (phy.blank ?? 0) : 0;
          row['Physics Score'] = phyScore;

          row['Chemistry Correct Qs'] = chem ? (chem.correct ?? 0) : 0;
          row['Chemistry Incorrect Qs'] = chem ? (chem.wrong ?? 0) : 0;
          row['Chemistry Unattempted Qs'] = chem ? (chem.blank ?? 0) : 0;
          row['Chemistry Score'] = chemScore;

          row['Botany Correct Qs'] = bot ? (bot.correct ?? 0) : 0;
          row['Botany Incorrect Qs'] = bot ? (bot.wrong ?? 0) : 0;
          row['Botany Unattempted Qs'] = bot ? (bot.blank ?? 0) : 0;
          row['Botany Score'] = botScore;

          row['Zoology Correct Qs'] = zoo ? (zoo.correct ?? 0) : 0;
          row['Zoology Incorrect Qs'] = zoo ? (zoo.wrong ?? 0) : 0;
          row['Zoology Unattempted Qs'] = zoo ? (zoo.blank ?? 0) : 0;
          row['Zoology Score'] = zooScore;

          row['Biology Correct Qs'] = bio ? (bio.correct ?? 0) : 0;
          row['Biology Incorrect Qs'] = bio ? (bio.wrong ?? 0) : 0;
          row['Biology Unattempted Qs'] = bio ? (bio.blank ?? 0) : 0;
          row['Biology Score'] = bioScore;

          row['Mathematics Correct Qs'] = math ? (math.correct ?? 0) : 0;
          row['Mathematics Incorrect Qs'] = math ? (math.wrong ?? 0) : 0;
          row['Mathematics Unattempted Qs'] = math ? (math.blank ?? 0) : 0;
          row['Mathematics Score'] = mathScore;

          const totalCorrect = testRes.correct || 0;
          const totalWrong = testRes.wrong || 0;
          const totalUnattempted = testRes.blank ?? (maxScoreVal - totalCorrect - totalWrong);

          row['Total Correct Qs'] = totalCorrect;
          row['Total Incorrect Qs'] = totalWrong;
          row['Total Unattempted Qs'] = totalUnattempted;
          row['Total Score'] = scoreVal;
          row['% Score'] = pct;
          row['Center Rank'] = testRes.rank || '—';
          row['Predicted Rank'] = determineRankBucket(scoreVal, maxScoreVal, testObj?.pattern || testRes.testPattern || '');
        }

        exportData.push(row);
      });
    });

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `Comparison_Grid_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectedProgObj = metaPrograms.find((p: any) => p.id === selectedProgramId);
  const selectedProgramName = selectedProgObj ? selectedProgObj.programName : '';

  return (
    <div className={cn(hideHeader ? "space-y-10 relative" : "w-full p-6 md:p-10 space-y-10 relative")}>
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        {!hideHeader ? (
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
                  : `${selectedTestIds.length} Tests Selected`} • {filteredResultsCount} Students{selectedProgramName ? ` of ${selectedProgramName}` : ''}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0">
             <div className="space-y-0.5">
               <div className="text-sm md:text-base text-slate-500 font-bold leading-relaxed flex flex-wrap items-center gap-x-2">
                 <span>Comparing:</span>
                 <span className="text-slate-900 font-black">{selectedTestIds.length === 1 && tests.find(t => t.id === selectedTestIds[0]) 
                   ? tests.find(t => t.id === selectedTestIds[0])?.name 
                   : `${selectedTestIds.length} Test Series`}</span>
                 <span className="text-slate-300">•</span>
                 <span className="text-blue-600 font-black">{filteredResultsCount} Students{selectedProgramName ? ` of ${selectedProgramName}` : ''}</span>
               </div>
             </div>
          </div>
        )}
        
        <div className="flex flex-wrap items-center gap-3">
          <Button 
            variant={isFilterVisible ? "secondary" : "outline"}
            size="md" 
            onClick={() => setIsFilterVisible(!isFilterVisible)}
            className="border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            <Filter size={18} className={cn("mr-2", isFilterVisible ? "text-blue-600" : "text-slate-400")} />
            {isFilterVisible ? "Hide Filters" : "Filters"}
          </Button>

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
                          return String(s.studentName || '').toLowerCase().includes(search) || 
                                 String(s.regNo || '').toLowerCase().includes(search) ||
                                 String(s.centerName || '').toLowerCase().includes(search) ||
                                 String(s.batchName || '').toLowerCase().includes(search) ||
                                 String(s.batchCode || '').toLowerCase().includes(search);
                        })
                        .slice(0, 10)
                        .map((s: any) => (
                          <button
                            key={s.sKey}
                            onClick={() => {
                              setSelectedStudents(prev => [...prev, s.sKey]);
                              if (s.regNo && s.regNo !== '—') {
                                setSelectedCompStudentReg(s.regNo);
                              }
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

          <div className="flex flex-wrap bg-slate-100 p-1.5 rounded-2xl gap-1">
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
            <button 
              onClick={() => setActiveAnalysisView('comparison')}
              className={cn(
                "px-5 py-2.5 rounded-xl text-xs font-black transition-all",
                activeAnalysisView === 'comparison' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Test Comparison
            </button>
            <button 
              onClick={() => setActiveAnalysisView('center_comparison')}
              className={cn(
                "px-5 py-2.5 rounded-xl text-xs font-black transition-all",
                activeAnalysisView === 'center_comparison' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Centre Comparison
            </button>
          </div>
        </div>
      </header>

      {/* ALWAYS VISIBLE Direct Academic Context Selector Bar has been moved into the collapsible Filters panel below to maximize screen space */}

      <AnimatePresence>
        {isFilterVisible && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }} 
            animate={{ height: 'auto', opacity: 1 }} 
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <Card className="p-8 border-slate-100 bg-slate-50/50 space-y-8 rounded-[2rem]">
               {/* Primary Academic Context Selectors */}
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-6 border-b border-slate-200">
                  {/* Direct Program Selector */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Division (Program)</label>
                    <Select 
                      value={selectedProgramId} 
                      onChange={e => {
                        const newProgId = e.target.value;
                        setSelectedProgramId(newProgId);
                        setSelectedBatchId('');
                        
                        if (onSelectAllTests) {
                          let filteredTests = tests;
                          if (newProgId) {
                            filteredTests = tests.filter((t: any) => t.programId === newProgId);
                          } else if (metaPrograms && metaPrograms.length > 0) {
                            const firstId = metaPrograms[0].id;
                            filteredTests = tests.filter((t: any) => t.programId === firstId);
                          }
                          onSelectAllTests(filteredTests.map((t: any) => t.id));
                        }
                      }}
                      className="rounded-xl border-slate-200/80 font-bold bg-white h-11 text-xs w-full shadow-sm"
                    >
                      <option value="">All Divisions</option>
                      {metaPrograms.filter((p: any) => p.isActive).map((p: any) => (
                        <option key={p.id} value={p.id}>{p.programName}</option>
                      ))}
                    </Select>
                  </div>

                  {/* Direct Center Selector */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Center</label>
                    <Select 
                      value={selectedCenterId} 
                      onChange={e => {
                        setSelectedCenterId(e.target.value);
                        setSelectedBatchId('');
                      }}
                      className="rounded-xl border-slate-200/80 font-bold bg-white h-11 text-xs w-full shadow-sm"
                    >
                      <option value="">All Centers</option>
                      {metaCenters.filter((c: any) => {
                         if (!c.isActive) return false;
                         if ((role === 'center' || role === 'center_level') && centerId && centerId !== 'all') {
                           const allowed = centerId.split(',').map(id => id.trim().toLowerCase()).filter(Boolean);
                           return allowed.includes(String(c.id).toLowerCase()) || allowed.includes(String(c.centerName || '').toLowerCase());
                         }
                         return true;
                       }).map((c: any) => (
                         <option key={c.id} value={c.id}>{c.centerName}</option>
                       ))}
                    </Select>
                  </div>

                  {/* Direct Batch Selector */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Batch</label>
                    <Select 
                      value={selectedBatchId} 
                      onChange={e => {
                        const newBatchId = e.target.value;
                        setSelectedBatchId(newBatchId);
                        
                        if (onSelectAllTests) {
                          let filteredTests = tests;
                          if (newBatchId) {
                            filteredTests = tests.filter((t: any) => t.batchIds?.includes(newBatchId));
                          } else if (selectedProgramId) {
                            filteredTests = tests.filter((t: any) => t.programId === selectedProgramId);
                          } else if (metaPrograms && metaPrograms.length > 0) {
                            const firstId = metaPrograms[0].id;
                            filteredTests = tests.filter((t: any) => t.programId === firstId);
                          }
                          onSelectAllTests(filteredTests.map((t: any) => t.id));
                        }
                      }}
                      className="rounded-xl border-slate-200/80 font-bold bg-white h-11 text-xs w-full shadow-sm"
                    >
                      <option value="">All Batches</option>
                      {metaBatches.filter((b: any) => 
                        b.isActive && 
                        (!selectedProgramId || b.programId === selectedProgramId) &&
                        (!selectedCenterId || b.centerId === selectedCenterId)
                      ).map((b: any) => (
                        <option key={b.id} value={b.id}>{b.batchName} ({b.batchCode})</option>
                      ))}
                    </Select>
                  </div>
               </div>
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
                  {/* Student Type Filter */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Student Type</label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                       {['all', 'Hosteller', 'e-Gurukul', 'Day Boarding'].map(t => (
                         <button 
                          key={t} 
                          onClick={() => setFilters((prev: any) => ({ ...prev, studentType: t as any }))}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-black transition-all",
                            (filters.studentType || 'all') === t ? "bg-purple-600 text-white shadow-md shadow-purple-100" : "bg-white text-slate-500 border border-slate-100"
                          )}
                         >
                           {t === 'all' ? 'All Types' : t === 'e-Gurukul' ? 'e-Guru' : t}
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
                    setSelectedProgramId('');
                    setSelectedCenterId('');
                    setSelectedBatchId('');
                    setFilters((prev: any) => ({ ...prev, studentType: 'all' }));
                  }} className="text-rose-500 hover:text-rose-600">
                    Clear All Filters
                  </Button>
               </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {!aggregateStats ? (
        <div className="flex flex-col items-center justify-center p-20 space-y-6 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm text-center">
          <div className="p-4 bg-slate-50 rounded-full text-slate-400">
            <Inbox size={48} strokeWidth={1.5} />
          </div>
          <div className="space-y-2">
            <h3 className="font-black text-xl text-slate-900 tracking-tight">No Test Data Found</h3>
            <p className="text-sm font-medium text-slate-500 max-w-sm mx-auto leading-relaxed font-sans">
              There are no student results recorded for the selected Division (Program), Center, or Batch.
            </p>
          </div>
        </div>
      ) : (
        <>
          {activeAnalysisView === 'summary' && (
        <>
          {/* Top Row: Difficulty Matrix & Subject Performance placed side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Difficulty Matrix Card */}
            <Card className="p-8 space-y-6 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm flex flex-col justify-between">
              <div className="space-y-4">
                <div>
                  <h3 className="font-black text-xl text-slate-900 tracking-tight">Difficulty Matrix</h3>
                  <p className="text-xs text-slate-400 font-medium">Breakdown of accuracy across question difficulties</p>
                </div>
                <div className="overflow-x-auto hover-scrollbar no-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/20">
                        <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Difficulty</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Total Q's</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Correct</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Avg. Accuracy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {Object.entries(aggregateStats.difficulties).map(([diff, stats]: [string, any]) => {
                        if (stats.totalQuestions === 0) return null;
                        const accuracy = Math.round((stats.totalCorrect / stats.totalQuestions) * 100);
                        return (
                          <tr key={diff} className="hover:bg-slate-50/30 transition-colors group">
                            <td className="px-4 py-3.5">
                              <span className={cn(
                                "text-xs font-black uppercase tracking-widest",
                                diff === 'Easy' ? "text-emerald-500" :
                                diff === 'Medium' ? "text-amber-500" :
                                diff === 'Hard' ? "text-rose-500" : "text-slate-400"
                              )}>{diff}</span>
                            </td>
                            <td className="px-4 py-3.5 text-center font-bold text-slate-600">{stats.totalQuestions}</td>
                            <td className="px-4 py-3.5 text-center">
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 font-extrabold text-xs">
                                {stats.totalCorrect}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
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
              </div>
            </Card>

            {/* Subject Performance Card */}
            <Card className="p-8 space-y-6 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Subject Performance</h3>
                <p className="text-xs text-slate-400 font-medium">Average proficiency ratings per core stream</p>
              </div>
              <div className="space-y-6 py-2">
                {Object.entries(aggregateStats.subjects).map(([name, stats]: [string, any]) => {
                  const acc = stats.totalQuestions > 0 ? Math.round((stats.totalCorrect / stats.totalQuestions) * 100) : 0;
                  return (
                    <div key={name} className="space-y-2 group">
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-sm font-black text-slate-900 group-hover:text-blue-600 transition-colors">{name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">Avg. Accuracy</p>
                        </div>
                        <span className="text-lg font-black text-blue-600">{acc}%</span>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div 
                          className={cn(
                            "h-full rounded-full",
                            acc >= 80 ? "bg-emerald-500" : acc >= 50 ? "bg-blue-600" : "bg-rose-500"
                          )}
                          initial={{ width: 0 }}
                          animate={{ width: `${acc}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Middle Row: Top Challenging Chapters with interactive subject filter */}
          <Card className="p-8 space-y-6 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-slate-100 pb-5">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Top Challenging Chapters</h3>
                <p className="text-xs text-slate-400 font-medium">Chapters requiring focus based on average test accuracy</p>
              </div>
              
              {/* Dynamic Subject Pill Filter */}
              <div className="flex flex-wrap gap-1.5 pt-2 md:pt-0">
                {['All', ...Object.keys(aggregateStats.subjects)].map((sub) => (
                  <button
                    key={sub}
                    onClick={() => setChallengingSubjectFilter(sub)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200 border",
                      challengingSubjectFilter === sub
                        ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                        : "bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100 hover:text-slate-600"
                    )}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
               {Object.entries(aggregateStats.chapters)
                 .filter(([_, stats]: [string, any]) => {
                   if (stats.totalQuestions === 0) return false;
                   if (challengingSubjectFilter !== 'All' && stats.subject !== challengingSubjectFilter) return false;
                   return true;
                 })
                 .sort((a: any, b: any) => (a[1].totalCorrect / a[1].totalQuestions) - (b[1].totalCorrect / b[1].totalQuestions))
                 .slice(0, 5)
                 .map(([name, stats]: [string, any]) => {
                   const acc = Math.round((stats.totalCorrect / stats.totalQuestions) * 100);
                   return (
                     <div key={name} className="flex flex-col justify-between p-5 bg-rose-50/20 hover:bg-rose-50/40 rounded-2xl border border-rose-100/30 transition-all duration-300 hover:shadow-md hover:shadow-rose-100/20 group relative overflow-hidden">
                        <div className="space-y-2">
                          <span className={cn(
                            "text-[8px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full inline-block",
                            stats.subject === 'Physics' ? 'bg-amber-100 text-amber-800' :
                            stats.subject === 'Chemistry' ? 'bg-blue-100 text-blue-800' :
                            'bg-emerald-100 text-emerald-800'
                          )}>
                            {stats.subject}
                          </span>
                          <p className="text-sm font-extrabold text-slate-800 line-clamp-2 leading-snug" title={name}>{name}</p>
                        </div>
                        <div className="mt-4 pt-3 border-t border-rose-100/30 flex justify-between items-end">
                          <div>
                            <p className="text-[9px] font-bold text-rose-400 uppercase tracking-widest">Accuracy</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-lg font-black text-rose-600">{acc}%</span>
                            </div>
                          </div>
                          <div className="w-10 h-1.5 bg-rose-100/50 rounded-full overflow-hidden mb-1">
                            <motion.div 
                              className="h-full bg-rose-600"
                              initial={{ width: 0 }}
                              animate={{ width: `${acc}%` }}
                            />
                          </div>
                        </div>
                     </div>
                   );
                 })}
                 {/* Empty state when no data for selected subject filter */}
                 {Object.entries(aggregateStats.chapters)
                   .filter(([_, stats]: [string, any]) => {
                     if (stats.totalQuestions === 0) return false;
                     if (challengingSubjectFilter !== 'All' && stats.subject !== challengingSubjectFilter) return false;
                     return true;
                   }).length === 0 && (
                     <div className="col-span-full py-8 text-center text-slate-400 font-medium text-sm">
                       No challenging chapters found for {challengingSubjectFilter}.
                     </div>
                   )}
            </div>
          </Card>

          {/* Bottom Row: Topic-wise summary in a beautiful grid map */}
          <Card className="p-8 space-y-6 mb-20 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm">
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-slate-100 pb-5">
               <div>
                 <h3 className="text-xl font-black text-slate-900 tracking-tight">Topic-wise Performance</h3>
                 <p className="text-xs text-slate-400 font-medium">Detailed breakdown of learning progress across subtopics</p>
               </div>
               
               {/* Summary Topic Subject Pill Filter */}
               <div className="flex flex-wrap gap-1.5 pt-2 md:pt-0">
                 {['All', ...Object.keys(aggregateStats.subjects)].map((sub) => (
                   <button
                     key={sub}
                     onClick={() => setSummaryTopicSubjectFilter(sub)}
                     className={cn(
                       "px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200 border",
                       summaryTopicSubjectFilter === sub
                         ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                         : "bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100 hover:text-slate-600"
                     )}
                   >
                     {sub}
                   </button>
                 ))}
               </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-h-[65vh] overflow-y-auto pr-2 hover-scrollbar no-scrollbar">
                {Object.entries(aggregateStats.topics)
                  .filter(([_, stats]: [string, any]) => {
                    if (stats.totalQuestions === 0) return false;
                    if (summaryTopicSubjectFilter !== 'All' && stats.subject !== summaryTopicSubjectFilter) return false;
                    return true;
                  })
                  .sort((a: any, b: any) => b[1].totalQuestions - a[1].totalQuestions)
                  .map(([name, stats]: [string, any]) => {
                    const acc = Math.round((stats.totalCorrect / stats.totalQuestions) * 100);
                    return (
                      <div key={name} className="p-5 bg-slate-50/20 hover:bg-slate-50 border border-slate-100 rounded-2xl flex flex-col justify-between gap-4 transition-all duration-300 hover:shadow-md hover:shadow-slate-100/50 group relative overflow-hidden">
                        <div className="space-y-2">
                          <div className="flex justify-between items-start gap-2">
                            <span className={cn(
                              "text-[8px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full inline-block",
                              stats.subject === 'Physics' ? 'bg-amber-100 text-amber-800' :
                              stats.subject === 'Chemistry' ? 'bg-blue-100 text-blue-800' :
                              'bg-emerald-100 text-emerald-800'
                            )}>
                              {stats.subject}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate" title={stats.chapter}>{stats.chapter}</span>
                            <h4 className="text-sm font-extrabold text-slate-800 group-hover:text-blue-600 transition-colors line-clamp-2 leading-snug" title={name}>{name}</h4>
                          </div>
                        </div>

                        <div className="mt-2 pt-3 border-t border-slate-100/60 flex justify-between items-end">
                          <div>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Accuracy</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={cn(
                                "text-lg font-black",
                                acc >= 80 ? "text-emerald-500" :
                                acc >= 50 ? "text-blue-500" :
                                "text-rose-500"
                              )}>{acc}%</span>
                            </div>
                          </div>
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1">
                            <motion.div 
                              className={cn(
                                "h-full",
                                acc >= 80 ? "bg-emerald-500" :
                                acc >= 50 ? "bg-blue-500" :
                                "bg-rose-500"
                              )}
                              initial={{ width: 0 }}
                              animate={{ width: `${acc}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                 {/* Empty state when no data for selected subject filter */}
                 {Object.entries(aggregateStats.topics)
                   .filter(([_, stats]: [string, any]) => {
                     if (stats.totalQuestions === 0) return false;
                     if (summaryTopicSubjectFilter !== 'All' && stats.subject !== summaryTopicSubjectFilter) return false;
                     return true;
                   }).length === 0 && (
                     <div className="col-span-full py-12 text-center text-slate-400 font-medium text-sm">
                       No subtopics found for {summaryTopicSubjectFilter}.
                     </div>
                   )}
             </div>
          </Card>
        </>
      )}



      {activeAnalysisView === 'student' && (
        <Card className="bg-white border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
          <div className="overflow-auto max-h-[75vh] hover-scrollbar no-scrollbar relative font-sans">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-md text-slate-500 z-20 border-b border-slate-100 shadow-sm shadow-slate-100/10">
                <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">
                  <th 
                    className="px-4 py-2 cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = studentSortConfig?.key === 'studentName' && studentSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setStudentSortConfig({ key: 'studentName', direction: dir });
                    }}
                  >
                    Student / Reg No{studentSortConfig?.key === 'studentName' && (studentSortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th className="px-4 py-2 text-center">Center / Batch</th>
                  <th 
                    className="px-4 py-2 text-center cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = studentSortConfig?.key === 'testsTaken' && studentSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setStudentSortConfig({ key: 'testsTaken', direction: dir });
                    }}
                  >
                    Tests Taken{studentSortConfig?.key === 'testsTaken' && (studentSortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th 
                    className="px-4 py-2 text-center cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = studentSortConfig?.key === 'avgScore' && studentSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setStudentSortConfig({ key: 'avgScore', direction: dir });
                    }}
                  >
                    Avg. Score{studentSortConfig?.key === 'avgScore' && (studentSortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th 
                    className="px-4 py-2 text-right cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => {
                      const dir = studentSortConfig?.key === 'accuracy' && studentSortConfig.direction === 'asc' ? 'desc' : 'asc';
                      setStudentSortConfig({ key: 'accuracy', direction: dir });
                    }}
                  >
                    Avg. Accuracy{studentSortConfig?.key === 'accuracy' && (studentSortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {aggregateStats.studentTable.map((s: any) => {
                  const isExpanded = false; // Always collapsed to avoid clutter and encourage new window analysis
                  return (
                    <React.Fragment key={`${s.regNo}_${s.studentName}`}>
                      <tr 
                        onClick={() => {
                          const url = `${window.location.origin}/results?studentRegNo=${s.regNo}`;
                          window.open(url, '_blank');
                        }}
                        className="hover:bg-slate-50/80 transition-all duration-200 group cursor-pointer"
                      >
                        <td className="px-4 py-2">
                          <div className="flex flex-col">
                            <span className="text-sm font-black text-slate-905 group-hover:text-blue-600 transition-colors flex items-center gap-2">
                              {exportWithName ? s.studentName : `STUDENT_${s.regNo || 'ANON'}`}
                              <span className="text-[9px] text-slate-400 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-full transition-colors font-medium">
                                Analyze Profile ↗
                              </span>
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              {exportWithName && (
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Reg: {s.regNo}</span>
                              )}
                              {exportWithName && s.type && (
                                <span className="text-[9px] font-black text-violet-750 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-100 uppercase tracking-wide font-mono animate-none">
                                  {s.type}
                                </span>
                              )}
                              {s.rankTarget && (
                                <span className="text-[9px] font-black text-amber-750 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 uppercase tracking-wide font-mono inline-flex items-center gap-0.5">
                                  <Target size={10} className="text-amber-500" />
                                  {s.rankTarget}
                                  {s.targetYear && (
                                    <span className="text-slate-400 text-[8px] font-normal">({s.targetYear})</span>
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <div className="flex flex-col items-center">
                            {exportWithName && s.centerName && (
                              <Badge variant="slate" className="bg-white border-slate-200 text-slate-500 font-black whitespace-nowrap text-[10px] py-0 h-4.5">
                                {s.centerName}
                              </Badge>
                            )}
                            {exportWithName && (
                              <span className="text-[9px] font-black text-slate-400 mt-0.5 uppercase tracking-tighter">
                                {s.batchCode || s.batchName || '—'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center">
                           <span className="px-2 py-0.5 bg-slate-100 rounded-lg text-[10px] font-black text-slate-600 uppercase">
                             {s.testsTaken} Tests
                           </span>
                        </td>
                        <td className="px-4 py-2 text-center font-black text-indigo-600 text-sm">{s.avgScore}</td>
                        <td className="px-4 py-2 text-right">
                           <div className="flex flex-col items-end gap-0.5">
                              <span className="text-xs font-black text-blue-600 leading-none">{s.accuracy}%</span>
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
                      {isExpanded && (
                        <tr className="bg-slate-50/40">
                          <td colSpan={5} className="px-6 py-6 border-t border-b border-dashed border-slate-200">
                            <motion.div 
                              initial={{ opacity: 0, scaleY: 0.95 }}
                              animate={{ opacity: 1, scaleY: 1 }}
                              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-left"
                            >
                              {/* score stats */}
                              <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4 shadow-sm">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 flex justify-between items-center">
                                  <span>Score Milestones</span>
                                  <span className="text-[11px] font-black text-indigo-600">Avg {s.avgScore}</span>
                                </h4>
                                
                                <div className="space-y-3">
                                  <div className="p-3 bg-emerald-50/30 border border-emerald-100/40 rounded-xl space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-extrabold text-emerald-800">Highest Score</span>
                                      <span className="text-sm font-black text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-md">{s.maxAttempt?.score ?? '—'}</span>
                                    </div>
                                    {s.maxAttempt && (
                                      <div className="pl-1 text-[10px] text-slate-500">
                                        <p className="font-extrabold text-slate-705 truncate max-w-[200px]" title={s.maxAttempt.testName}>{s.maxAttempt.testName}</p>
                                        <p className="font-medium mt-0.5 font-mono text-[9px]">{s.maxAttempt.testDate}</p>
                                      </div>
                                    )}
                                  </div>

                                  <div className="p-3 bg-rose-50/30 border border-rose-100/40 rounded-xl space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-extrabold text-rose-800">Lowest Score</span>
                                      <span className="text-sm font-black text-rose-500 bg-rose-50 px-2.5 py-0.5 rounded-md">{s.minAttempt?.score ?? '—'}</span>
                                    </div>
                                    {s.minAttempt && (
                                      <div className="pl-1 text-[10px] text-slate-500">
                                        <p className="font-extrabold text-slate-705 truncate max-w-[200px]" title={s.minAttempt.testName}>{s.minAttempt.testName}</p>
                                        <p className="font-medium mt-0.5 font-mono text-[9px]">{s.minAttempt.testDate}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Subjectwise Performance */}
                              <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4 shadow-sm col-span-1">
                                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Subject Performance</h4>
                                </div>
                                <div className="space-y-3 max-h-[420px] overflow-y-auto no-scrollbar pr-1">
                                  {s.subjectStats && s.subjectStats.length > 0 ? (
                                    s.subjectStats.map((sub: any, idx: number) => {
                                      const isSubExpanded = expandedStudentSubject[s.sKey] === sub.subject;
                                      const metrics = s.subjectMetrics?.[sub.subject];
                                      return (
                                        <div key={idx} className="border border-slate-100 bg-white hover:border-blue-100 rounded-xl p-3 transition-all space-y-1.5 shadow-xs">
                                          <div 
                                            onClick={() => setExpandedStudentSubject(prev => ({
                                              ...prev,
                                              [s.sKey]: isSubExpanded ? "" : sub.subject
                                            }))}
                                            className="flex items-center justify-between gap-2 cursor-pointer group"
                                          >
                                            <div className="truncate">
                                              <span className={cn(
                                                "text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded inline-block mb-0.5",
                                                sub.subject === 'Physics' ? 'bg-amber-100 text-amber-800' :
                                                sub.subject === 'Chemistry' ? 'bg-blue-100 text-blue-800' :
                                                (sub.subject === 'Botany' || sub.subject === 'Biology') ? 'bg-emerald-100 text-emerald-800' :
                                                sub.subject === 'Zoology' ? 'bg-teal-100 text-teal-800' :
                                                (sub.subject === 'Math' || sub.subject === 'Mathematics') ? 'bg-violet-100 text-violet-800' :
                                                'bg-slate-100 text-slate-800'
                                              )}>
                                                {sub.subject}
                                              </span>
                                              <div className="text-[9px] font-extrabold text-slate-400">
                                                C: {sub.correct} / T: {sub.total} • <span className="text-blue-600 font-bold group-hover:underline">{isSubExpanded ? "Hide Details" : "View Details"}</span>
                                              </div>
                                            </div>
                                            <div className="flex flex-col items-end">
                                              <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{sub.accuracy}%</span>
                                            </div>
                                          </div>
                                          
                                          <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500" style={{ width: `${sub.accuracy}%` }} />
                                          </div>
                                          
                                          {isSubExpanded && metrics && (
                                            <motion.div 
                                              initial={{ opacity: 0, height: 0 }}
                                              animate={{ opacity: 1, height: "auto" }}
                                              className="pt-2 border-t border-dashed border-slate-100 space-y-2 text-[11px]"
                                            >
                                              {/* average, max, min for subject */}
                                              <div className="grid grid-cols-1 gap-2">
                                                
                                                {/* Avg Score Milestone */}
                                                <div className="flex items-center justify-between p-1.5 bg-slate-50/50 rounded-lg text-[10px]">
                                                  <span className="font-extrabold text-slate-550">Subject Avg score</span>
                                                  <span className="font-black text-slate-705 bg-slate-100 px-1.5 py-0.5 rounded-sm">{metrics.avgScore}</span>
                                                </div>

                                                {/* Highest (Max) Subject Score */}
                                                {metrics.maxAttempt && (
                                                  <div className="p-2 bg-emerald-50/20 border border-emerald-100/30 rounded-lg space-y-1">
                                                    <div className="flex items-center justify-between">
                                                      <span className="text-[10px] font-extrabold text-emerald-800">Highest Score</span>
                                                      <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded">{metrics.maxAttempt.score}</span>
                                                    </div>
                                                    <div className="text-[8.5px] text-slate-500">
                                                      <p className="font-bold text-slate-705 truncate max-w-[210px]" title={metrics.maxAttempt.testName}>{metrics.maxAttempt.testName}</p>
                                                      <p className="font-medium font-mono text-slate-400 text-[8px]">{metrics.maxAttempt.testDate}</p>
                                                    </div>
                                                  </div>
                                                )}

                                                {/* Lowest (Min) Subject Score */}
                                                {metrics.minAttempt && (
                                                  <div className="p-2 bg-rose-50/20 border border-rose-100/30 rounded-lg space-y-1">
                                                    <div className="flex items-center justify-between">
                                                      <span className="text-[10px] font-extrabold text-rose-800">Lowest Score</span>
                                                      <span className="text-[10px] font-black text-rose-500 bg-rose-50 px-1.5 py-0.2 rounded">{metrics.minAttempt.score}</span>
                                                    </div>
                                                    <div className="text-[8.5px] text-slate-500">
                                                      <p className="font-bold text-slate-705 truncate max-w-[210px]" title={metrics.minAttempt.testName}>{metrics.minAttempt.testName}</p>
                                                      <p className="font-medium font-mono text-slate-400 text-[8px]">{metrics.minAttempt.testDate}</p>
                                                    </div>
                                                  </div>
                                                )}

                                                {/* Subjectwise Growth Opportunity (Weakest Topic) */}
                                                {metrics.weakestTopic && (
                                                  <div className="p-2 bg-rose-50/25 border border-rose-100/25 rounded-lg space-y-1">
                                                    <div className="flex items-center justify-between gap-1">
                                                      <span className="text-[9px] font-bold text-rose-850 uppercase tracking-tight">Growth Opportunity</span>
                                                      <span className="text-[9px] font-black text-rose-500 bg-rose-50 px-1.5 py-0.2 rounded">{metrics.weakestTopic.accuracy}%</span>
                                                    </div>
                                                    <p className="text-[8.5px] font-extrabold text-slate-705 truncate max-w-[210px]" title={metrics.weakestTopic.topicName}>{metrics.weakestTopic.topicName}</p>
                                                    <p className="text-[7.5px] font-semibold text-slate-400 uppercase truncate max-w-[210px]" title={metrics.weakestTopic.chapter}>{metrics.weakestTopic.chapter}</p>
                                                  </div>
                                                )}

                                                {/* Subjectwise Strength Area (Strongest Topic) */}
                                                {metrics.strongestTopic && (
                                                  <div className="p-2 bg-emerald-50/25 border border-emerald-100/25 rounded-lg space-y-1">
                                                    <div className="flex items-center justify-between gap-1">
                                                      <span className="text-[9px] font-bold text-emerald-850 uppercase tracking-tight font-sans">Top Strength</span>
                                                      <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded">{metrics.strongestTopic.accuracy}%</span>
                                                    </div>
                                                    <p className="text-[8.5px] font-extrabold text-slate-705 truncate max-w-[210px]" title={metrics.strongestTopic.topicName}>{metrics.strongestTopic.topicName}</p>
                                                    <p className="text-[7.5px] font-semibold text-slate-400 uppercase truncate max-w-[210px]" title={metrics.strongestTopic.chapter}>{metrics.strongestTopic.chapter}</p>
                                                  </div>
                                                )}

                                              </div>
                                            </motion.div>
                                          )}
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <p className="text-xs text-slate-400 italic py-4 text-center">No subjectwise data available.</p>
                                  )}
                                </div>
                              </div>

                              {/* strength Areas */}
                              <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4 shadow-sm">
                                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Strength Chapters & Topics</h4>
                                </div>
                                
                                <div className="space-y-3">
                                  {s.strengths && s.strengths.length > 0 ? (
                                    s.strengths.map((st: any, idx: number) => (
                                      <div key={idx} className="space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="truncate">
                                            <span className={cn(
                                              "text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded inline-block mb-0.5",
                                              st.subject === 'Physics' ? 'bg-amber-100 text-amber-800' :
                                              st.subject === 'Chemistry' ? 'bg-blue-100 text-blue-800' :
                                              'bg-emerald-100 text-emerald-800'
                                            )}>
                                              {st.subject}
                                            </span>
                                            <h5 className="text-[9px] font-bold text-slate-750 truncate max-w-[170px]" title={st.topicName}>{st.topicName}</h5>
                                          </div>
                                          <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">{st.accuracy}%</span>
                                        </div>
                                        <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                                          <div className="h-full bg-emerald-500" style={{ width: `${st.accuracy}%` }} />
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-xs text-slate-400 italic py-4 text-center">No strength areas identified.</p>
                                  )}
                                </div>
                              </div>

                              {/* growth Opportunities */}
                              <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4 shadow-sm">
                                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Growth Opportunities</h4>
                                </div>

                                <div className="space-y-3">
                                  {s.weaknesses && s.weaknesses.length > 0 ? (
                                    s.weaknesses.map((wk: any, idx: number) => (
                                      <div key={idx} className="space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="truncate">
                                            <span className={cn(
                                              "text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded inline-block mb-0.5",
                                              wk.subject === 'Physics' ? 'bg-amber-100 text-amber-800' :
                                              wk.subject === 'Chemistry' ? 'bg-blue-100 text-blue-800' :
                                              'bg-emerald-100 text-emerald-800'
                                            )}>
                                              {wk.subject}
                                            </span>
                                            <h5 className="text-[9px] font-bold text-slate-750 truncate max-w-[170px]" title={wk.topicName}>{wk.topicName}</h5>
                                          </div>
                                          <span className="text-[10px] font-black text-rose-550 bg-rose-50 px-1.5 py-0.5 rounded">{wk.accuracy}%</span>
                                        </div>
                                        <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                                          <div className="h-full bg-rose-500" style={{ width: `${wk.accuracy}%` }} />
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-xs text-slate-400 italic py-4 text-center">No growth areas identified.</p>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeAnalysisView === 'question' && (() => {
        const uniqueTestNames = Array.from(new Set(aggregateStats.questions.map((q: any) => q.testName).filter(Boolean))).sort();
        const uniqueTestDates = Array.from(new Set(aggregateStats.questions.map((q: any) => q.testDate).filter(Boolean))).sort();
        const uniquePrograms = Array.from(new Set(aggregateStats.questions.map((q: any) => q.programName).filter(Boolean))).sort();

        const filteredList = aggregateStats.questions.filter((q: any) => {
          if (questionSubjectFilter !== 'All' && q.subject !== questionSubjectFilter) return false;
          if (questionTestFilter !== 'All' && q.testName !== questionTestFilter) return false;
          if (questionDateFilter !== 'All' && q.testDate !== questionDateFilter) return false;
          if (questionProgramFilter !== 'All' && q.programName !== questionProgramFilter) return false;
          return true;
        });

        const toggleSort = (key: string) => {
          const dir = sortConfig?.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
          setSortConfig({ key, direction: dir });
        };

        const renderSortDirection = (key: string) => {
          if (sortConfig?.key !== key) return null;
          return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
        };

        return (
          <Card className="p-8 space-y-6 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm">
            <div className="flex flex-col gap-6 border-b border-slate-100 pb-5">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Question-wise Performance</h3>
                  <p className="text-xs text-slate-400 font-medium">Detailed breakdown of question metrics including Program, Test and Date details</p>
                </div>
                
                {/* Subject Pill Filter ('subjectwise filter') */}
                <div className="flex flex-wrap gap-1.5 self-start lg:self-auto">
                  {['All', ...Object.keys(aggregateStats.subjects)].map((sub) => (
                    <button
                      key={sub}
                      onClick={() => setQuestionSubjectFilter(sub)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200 border",
                        questionSubjectFilter === sub
                          ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                          : "bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100 hover:text-slate-600"
                      )}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              </div>

              {/* ONLY Test Name, Date, Program filters */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1 text-left">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Test Name Filter</span>
                  <select
                    value={questionTestFilter}
                    onChange={(e) => setQuestionTestFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="All">All Tests ({uniqueTestNames.length})</option>
                    {uniqueTestNames.map((name: any) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1 text-left">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Test Date Filter</span>
                  <select
                    value={questionDateFilter}
                    onChange={(e) => setQuestionDateFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="All">All Dates ({uniqueTestDates.length})</option>
                    {uniqueTestDates.map((date: any) => (
                      <option key={date} value={date}>{date}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1 text-left">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Program Filter</span>
                  <select
                    value={questionProgramFilter}
                    onChange={(e) => setQuestionProgramFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="All">All Programs ({uniquePrograms.length})</option>
                    {uniquePrograms.map((prog: any) => (
                      <option key={prog} value={prog}>{prog}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="w-full overflow-hidden rounded-[1.5rem] border border-slate-100 bg-white">
              <div className="overflow-x-auto max-h-[60vh] hover-scrollbar no-scrollbar">
                <table className="w-full text-left border-collapse table-fixed min-w-[1300px]">
                  <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-md text-slate-500 z-20 border-b border-slate-100">
                    <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      <th 
                        className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors w-[4%] text-center"
                        onClick={() => toggleSort('num')}
                      >
                        Q.No{renderSortDirection('num')}
                      </th>
                      <th 
                        className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors w-[6%]"
                        onClick={() => toggleSort('subject')}
                      >
                        Subject{renderSortDirection('subject')}
                      </th>
                      <th 
                        className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors w-[13%]"
                        onClick={() => toggleSort('chapter')}
                      >
                        Chapter{renderSortDirection('chapter')}
                      </th>
                      <th 
                        className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors w-[13%]"
                        onClick={() => toggleSort('topic')}
                      >
                        Topic{renderSortDirection('topic')}
                      </th>
                      <th 
                        className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors w-[13%]"
                        onClick={() => toggleSort('testName')}
                      >
                        Test{renderSortDirection('testName')}
                      </th>
                      <th 
                        className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors w-[7%]"
                        onClick={() => toggleSort('testDate')}
                      >
                        Date{renderSortDirection('testDate')}
                      </th>
                      <th 
                        className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors w-[7%]"
                        onClick={() => toggleSort('programName')}
                      >
                        Program{renderSortDirection('programName')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[8%]"
                        onClick={() => toggleSort('totalStudents')}
                      >
                        Total Students{renderSortDirection('totalStudents')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[7%]"
                        onClick={() => toggleSort('attempted')}
                      >
                        Attempted{renderSortDirection('attempted')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[6%]"
                        onClick={() => toggleSort('correct')}
                      >
                        Correct{renderSortDirection('correct')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[7%]"
                        onClick={() => toggleSort('incorrect')}
                      >
                        Incorrect{renderSortDirection('incorrect')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[8%]"
                        onClick={() => toggleSort('unattempted')}
                      >
                        Unattempted{renderSortDirection('unattempted')}
                      </th>
                      <th 
                        className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[5%]"
                        onClick={() => toggleSort('accuracy')}
                      >
                        % Accuracy{renderSortDirection('accuracy')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-[11px] font-semibold text-slate-600">
                    {filteredList.map((q: any, idx: number) => {
                      const totalStudents = q.totalStudents || (q.correct + q.incorrect + q.unattempted);
                      const attempted = q.attempted || (q.correct + q.incorrect);
                      const accVal = q.accuracy !== undefined ? q.accuracy : (attempted > 0 ? Math.round((q.correct / attempted) * 100) : 0);

                      return (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-2.5 text-center font-black text-slate-800">Q.{q.qIdx}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn(
                              "text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full inline-block",
                              q.subject === 'Physics' ? 'bg-amber-100 text-amber-800' :
                              q.subject === 'Chemistry' ? 'bg-blue-100 text-blue-800' :
                              'bg-emerald-100 text-emerald-800'
                            )}>
                              {q.subject}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-extrabold text-slate-800 truncate" title={q.chapter}>{q.chapter || '—'}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-500 truncate" title={q.topic}>{q.topic || '—'}</td>
                          <td className="px-4 py-2.5 font-bold text-slate-800 truncate" title={q.testName}>{q.testName}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-500 truncate" title={q.testDate}>{q.testDate}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-500 truncate" title={q.programName}>{q.programName}</td>
                          <td className="px-4 py-2.5 text-center font-bold text-slate-700">{totalStudents}</td>
                          <td className="px-4 py-2.5 text-center font-bold text-slate-600">{attempted}</td>
                          <td className="px-4 py-2.5 text-center font-bold text-emerald-600">{q.correct}</td>
                          <td className="px-4 py-2.5 text-center font-bold text-rose-500">{q.incorrect}</td>
                          <td className="px-4 py-2.5 text-center font-bold text-slate-400">{q.unattempted}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={cn(
                              "text-xs font-black px-2 py-0.5 rounded-md",
                              accVal >= 80 ? "bg-emerald-50 text-emerald-600" :
                              accVal >= 50 ? "bg-blue-50 text-blue-600" :
                              "bg-rose-50 text-rose-600"
                            )}>
                              {accVal}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {filteredList.length === 0 && (
              <div className="py-12 text-center text-slate-400 font-medium text-sm border border-dashed border-slate-100 rounded-3xl bg-slate-50/50">
                No matching question metrics found for the selected filters.
              </div>
            )}
          </Card>
        );
      })()}

      {activeAnalysisView === 'topic' && (() => {
        const filteredList = aggregateStats.topicTable.filter((t: any) => {
          if (topicSubjectFilter !== 'All' && t.subject !== topicSubjectFilter) return false;
          return true;
        });

        const toggleTopicSort = (key: string) => {
          const dir = topicSortConfig?.key === key && topicSortConfig.direction === 'asc' ? 'desc' : 'asc';
          setTopicSortConfig({ key, direction: dir });
        };

        const renderTopicSortDirection = (key: string) => {
          if (topicSortConfig?.key !== key) return null;
          return topicSortConfig.direction === 'asc' ? ' ↑' : ' ↓';
        };

        return (
          <div className="space-y-6">
            <Card className="p-8 space-y-6 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-slate-100 pb-5">
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Topic-wise Performance</h3>
                  <p className="text-xs text-slate-400 font-medium">Detailed breakdown of learning progress across subtopics, sorted by accuracy</p>
                </div>
                
                {/* Dynamic Subject Pill Filter */}
                <div className="flex flex-wrap gap-1.5 pt-2 md:pt-0">
                  {['All', ...Object.keys(aggregateStats.subjects)].map((sub) => (
                    <button
                      key={sub}
                      onClick={() => setTopicSubjectFilter(sub)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200 border",
                        topicSubjectFilter === sub
                          ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                          : "bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100 hover:text-slate-600"
                      )}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              </div>

              <div className="w-full overflow-hidden rounded-[1.5rem] border border-slate-100 bg-white">
                <div className="overflow-x-auto max-h-[60vh] hover-scrollbar no-scrollbar">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-md text-slate-500 z-20 border-b border-slate-100">
                      <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                        <th 
                          className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors w-[10%]"
                          onClick={() => toggleTopicSort('subject')}
                        >
                          Subject{renderTopicSortDirection('subject')}
                        </th>
                        <th 
                          className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors w-[18%]"
                          onClick={() => toggleTopicSort('chapter')}
                        >
                          Chapter{renderTopicSortDirection('chapter')}
                        </th>
                        <th 
                          className="px-4 py-3 cursor-pointer hover:text-blue-600 transition-colors w-[22%]"
                          onClick={() => toggleTopicSort('topic')}
                        >
                          Topic Name{renderTopicSortDirection('topic')}
                        </th>
                        <th 
                          className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[8%]"
                          onClick={() => toggleTopicSort('questionsCount')}
                        >
                          Qs Count{renderTopicSortDirection('questionsCount')}
                        </th>
                        <th 
                          className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[10%]"
                          onClick={() => toggleTopicSort('totalAttempts')}
                        >
                          Total Attempts{renderTopicSortDirection('totalAttempts')}
                        </th>
                        <th 
                          className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[8%]"
                          onClick={() => toggleTopicSort('correct')}
                        >
                          Correct{renderTopicSortDirection('correct')}
                        </th>
                        <th 
                          className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[8%]"
                          onClick={() => toggleTopicSort('incorrect')}
                        >
                          Incorrect{renderTopicSortDirection('incorrect')}
                        </th>
                        <th 
                          className="px-4 py-4 text-center cursor-pointer hover:text-blue-600 transition-colors w-[8%]"
                          onClick={() => toggleTopicSort('unattempted')}
                        >
                          Unattempted{renderTopicSortDirection('unattempted')}
                        </th>
                        <th 
                          className="px-4 py-3 text-center cursor-pointer hover:text-blue-600 transition-colors w-[8%]"
                          onClick={() => toggleTopicSort('accuracy')}
                        >
                          Accuracy{renderTopicSortDirection('accuracy')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 text-[11px] font-semibold text-slate-600">
                      {filteredList.map((t: any, idx: number) => {
                        return (
                          <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-2.5">
                              <span className={cn(
                                "text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full inline-block",
                                t.subject === 'Physics' ? 'bg-amber-100 text-amber-800' :
                                t.subject === 'Chemistry' ? 'bg-blue-100 text-blue-800' :
                                'bg-emerald-100 text-emerald-800'
                              )}>
                                {t.subject}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-extrabold text-slate-800 truncate" title={t.chapter}>{t.chapter || '—'}</td>
                            <td className="px-4 py-2.5 font-medium text-slate-500 truncate" title={t.topic}>{t.topic || '—'}</td>
                            <td className="px-4 py-2.5 text-center font-bold text-slate-700">{t.questionsCount}</td>
                            <td className="px-4 py-2.5 text-center font-bold text-slate-700">{t.totalAttempts}</td>
                            <td className="px-4 py-2.5 text-center font-black text-emerald-600">{t.correct}</td>
                            <td className="px-4 py-2.5 text-center font-black text-rose-500">{t.incorrect}</td>
                            <td className="px-4 py-2.5 text-center font-bold text-slate-400">{t.unattempted ?? 0}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={cn(
                                "text-xs font-black px-2 py-0.5 rounded-md",
                                t.accuracy >= 80 ? "bg-emerald-50 text-emerald-600" :
                                t.accuracy >= 50 ? "bg-blue-50 text-blue-600" :
                                "bg-rose-50 text-rose-600"
                              )}>
                                {t.accuracy}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {filteredList.length === 0 && (
                <div className="py-12 text-center text-slate-400 font-medium text-sm border border-dashed border-slate-100 rounded-3xl bg-slate-50/50">
                  No subtopic metrics available for {topicSubjectFilter}.
                </div>
              )}
            </Card>
          </div>
        );
      })()}

      {activeAnalysisView === 'comparison' && (
        <div className="space-y-6 print-comparison-matrix">
          {/* Dynamic Print Landscape CSS override for multi-student grid print */}
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              @page {
                size: landscape !important;
                margin: 8mm 6mm !important;
              }
              
              body, html, #root {
                background: #ffffff !important;
                color: #000000 !important;
                width: 100% !important;
                height: auto !important;
                overflow: visible !important;
              }

              /* Hide screen-specific interactive panels completely */
              aside, nav, header, button, select, input, .no-print, .toaster, [role="status"],
              .print-hide, .main-filters-header {
                display: none !important;
              }

              /* Expand container wrapping class to fit natural page */
              .print-comparison-matrix {
                padding: 0 !important;
                margin: 0 !important;
                width: 100% !important;
                display: block !important;
              }

              /* Force grid overflow to be visible and unconstrained */
              .print-comparison-matrix .overflow-x-auto {
                overflow: visible !important;
                max-height: none !important;
                max-width: none !important;
                width: 100% !important;
              }

              /* Drop thick screen shadow curves */
              .shadow-xl, .shadow-2xl, .shadow-sm, .shadow-md {
                box-shadow: none !important;
              }

              .rounded-[2rem], .rounded-3xl, .rounded-[2.5rem] {
                border-radius: 0.5rem !important;
                border: 1px solid #cbd5e1 !important;
              }

              /* Strip left student column and header stickiness to avoid clipping or overlapping shifts on print pages */
              .print-comparison-matrix thead,
              .print-comparison-matrix tr,
              .print-comparison-matrix th,
              .print-comparison-matrix td,
              .print-comparison-matrix th.sticky,
              .print-comparison-matrix td.sticky,
              .print-comparison-matrix .sticky {
                position: static !important;
                top: auto !important;
                bottom: auto !important;
                left: auto !important;
                right: auto !important;
                box-shadow: none !important;
              }
              
              .print-comparison-matrix tr {
                page-break-inside: avoid !important;
                border-bottom: 2px solid #64748b !important;
              }

              /* Explicit solid light gray grid borders for standard laser printing */
              .print-comparison-matrix table {
                width: 100% !important;
                border-collapse: collapse !important;
                page-break-inside: auto !important;
              }

              .print-comparison-matrix td,
              .print-comparison-matrix th {
                border: 1px solid #cbd5e1 !important;
                padding: 10px 8px !important;
                text-align: center !important;
                vertical-align: middle !important;
                font-size: 9.5px !important;
              }

              .print-comparison-matrix th {
                background-color: #f1f5f9 !important;
                color: #0f172a !important;
                font-weight: 900 !important;
              }

              .print-comparison-matrix td {
                background-color: #ffffff !important;
                color: #1e293b !important;
              }

              .print-comparison-matrix td:first-child {
                text-align: left !important;
                font-size: 10.5px !important;
                font-weight: 800 !important;
              }
            }
          ` }} />

          {/* Printable Brand Header for Comparison Grid Report */}
          <div className="hidden print:flex items-center justify-between border-b pb-4 mb-4 border-slate-300">
            <div className="space-y-1 text-left">
              <h1 className="text-base font-black uppercase tracking-wider text-slate-800">
                Consolidated Student Performance Tracking & Comparative Matrix
              </h1>
              <p className="text-[9px] font-bold text-slate-500 font-mono mt-1">
                {selectedProgramId ? `PROGRAM: ${metaPrograms.find((p: any) => p.id === selectedProgramId)?.programName || 'Unknown'}` : 'All Academic Programs'}
                {selectedBatchId && ` | BATCH: ${metaBatches.find((b: any) => b.id === selectedBatchId)?.batchCode || 'Unknown'}`}
                {selectedCenterId && ` | CENTER: ${metaCenters.find((c: any) => c.id === selectedCenterId)?.centerName || 'Unknown'}`}
              </p>
            </div>
            <div className="text-right space-y-0.5">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">Official Report</p>
              <p className="text-xs font-bold text-slate-800">{new Date().toLocaleDateString()}</p>
              <p className="text-[8px] text-slate-500 font-mono">Consolidated {displayedTests.length} Tests</p>
            </div>
          </div>

          {/* Main Comparison Filtering Header */}
          <div className="bg-slate-900 text-white p-6 md:p-8 rounded-[2rem] border border-slate-800 shadow-xl space-y-6 main-filters-header print:hidden">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="space-y-1">
                <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest block font-mono">Comparative Matrices</span>
                <h3 className="text-2xl font-black tracking-tight flex items-center gap-2">
                  <TrendingUp className="text-blue-500" size={24} />
                  Horizontal Student Test-on-Test Grid
                </h3>
                <p className="text-xs text-slate-400 font-medium font-sans">
                  Chronological comparison grid with exact subject and total mark distribution breakdowns
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Toggle timeline span */}
                <div className="flex flex-wrap items-center gap-1.5 bg-slate-800/80 p-1.5 rounded-xl border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setComparisonTestMode('current')}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                      comparisonTestMode === 'current' ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                    )}
                  >
                    Current Test
                  </button>
                  <button
                    type="button"
                    onClick={() => setComparisonTestMode('two')}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                      comparisonTestMode === 'two' ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                    )}
                  >
                    Current & Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setComparisonTestMode('three')}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                      comparisonTestMode === 'three' ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                    )}
                  >
                    Last 3 Tests
                  </button>
                  <button
                    type="button"
                    onClick={() => setComparisonTestMode('all')}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                      comparisonTestMode === 'all' ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                    )}
                  >
                    All History
                  </button>
                </div>

                {/* Anchor / Current Test Dropdown */}
                <div className="flex items-center gap-1.5 bg-slate-800/80 p-1.5 rounded-xl border border-slate-700 font-sans">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-2 select-none font-mono">
                    Anchor/Filter Test:
                  </span>
                  <select
                    value={selectedCompTestId}
                    onChange={(e) => {
                      setSelectedCompTestId(e.target.value);
                    }}
                    className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider h-7 rounded-lg px-2.5 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer max-w-[210px] sm:max-w-[250px] truncate"
                  >
                    <option value="">Latest Test ({comparisonGridData.chronTests[0]?.testDate || '—'})</option>
                    {comparisonGridData.chronTests.map((t: any) => (
                      <option key={t.testId} value={t.testId}>
                        {t.testDate ? `[${t.testDate}] ` : ''}{t.testName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Explicit Export Names Opt Toggle Selector */}
                <div className="flex items-center gap-1 bg-slate-800 border border-slate-700/80 rounded-xl p-1 shadow-sm font-sans mr-2">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest pl-2 select-none font-mono">
                    Names:
                  </span>
                  <button
                    type="button"
                    onClick={() => setExportWithName(true)}
                    className={cn(
                      "px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer rounded-lg",
                      exportWithName ? "bg-blue-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                    )}
                  >
                    Include
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportWithName(false)}
                    className={cn(
                      "px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer rounded-lg",
                      !exportWithName ? "bg-amber-500 text-slate-950 shadow-sm" : "text-slate-400 hover:text-white"
                    )}
                  >
                    Anonymize
                  </button>
                </div>

                {/* Print/Export buttons */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportComparisonCSV}
                    className="border-slate-700 hover:bg-slate-800 text-white font-black uppercase text-[10px] tracking-widest h-10 px-4 rounded-xl flex items-center gap-1.5"
                  >
                    <Download size={14} className="text-slate-400" />
                    Export CSV
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => window.print()}
                    className="bg-red-650 hover:bg-red-700 text-white border-none font-black uppercase text-[10px] tracking-widest h-10 px-4 rounded-xl flex items-center gap-1.5 shadow-lg shadow-red-900/40"
                  >
                    <FileText size={14} className="text-red-200" />
                    Export PDF
                  </Button>
                </div>
              </div>
            </div>

            {/* Program Level selector pills requested by user */}
            <div className="space-y-3 pt-4 border-t border-slate-800">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono">Program Level Filter:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProgramId('');
                    setSelectedBatchId('');
                  }}
                  className={cn(
                    "px-4 py-2.5 rounded-xl text-xs font-black tracking-wider uppercase transition-all",
                    !selectedProgramId
                      ? "bg-blue-600 text-white shadow-md shadow-blue-900/40"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                  )}
                >
                  All Programs
                </button>
                {metaPrograms.filter((p: any) => p.isActive).map((p: any) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => {
                      setSelectedProgramId(p.id);
                      setSelectedBatchId(''); // reset batch
                    }}
                    className={cn(
                      "px-4 py-2.5 rounded-xl text-xs font-black tracking-wider uppercase transition-all",
                      selectedProgramId === p.id
                        ? "bg-blue-600 text-white shadow-md shadow-blue-900/40"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                    )}
                  >
                    {p.programName}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-slate-800">
              {/* Search input inside panel */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest pl-1 font-mono">Search Student:</label>
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="Type student name or regNo..."
                    className="w-full h-10 bg-slate-800 text-white pl-10 pr-4 text-xs font-bold rounded-xl border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {studentSearch && (
                    <button
                      type="button"
                      onClick={() => setStudentSearch('')}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white font-bold text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Center Filter */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest pl-1 font-mono">Select Center:</label>
                <select
                  value={selectedCenterId}
                  onChange={(e) => setSelectedCenterId(e.target.value)}
                  className="w-full h-10 bg-slate-800 text-white px-3 text-xs font-bold rounded-xl border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Academic Centers</option>
                  {metaCenters.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.centerName}</option>
                  ))}
                </select>
              </div>

              {/* Batch Filter */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest pl-1 font-mono">Select Batch:</label>
                <select
                  value={selectedBatchId}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  className="w-full h-10 bg-slate-800 text-white px-3 text-xs font-bold rounded-xl border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Program Batches</option>
                  {metaBatches.filter((b: any) => !selectedProgramId || b.programId === selectedProgramId).map((b: any) => (
                    <option key={b.id} value={b.id}>{b.batchCode || b.batchName}</option>
                  ))}
                </select>
              </div>

              {/* Anchor / Current Test Dropdown */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest pl-1 font-mono">Current Test Date & Name:</label>
                <select
                  value={selectedCompTestId}
                  onChange={(e) => {
                    setSelectedCompTestId(e.target.value);
                    setComparisonTestMode('current'); // auto switch to view selected current test
                  }}
                  className="w-full h-10 bg-slate-800 text-white px-3 text-xs font-bold rounded-xl border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="">Latest Test ({comparisonGridData.chronTests[0]?.testDate || '—'})</option>
                  {comparisonGridData.chronTests.map((t: any) => (
                    <option key={t.testId} value={t.testId}>
                      {t.testDate ? `[${t.testDate}] ` : ''}{t.testName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {isLoadingAllComp ? (
            <div className="py-24 flex flex-col items-center justify-center gap-3 bg-white rounded-3xl border border-slate-100 shadow-sm text-center">
              <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mt-2">Loading historical results database...</p>
              <p className="text-[10px] text-slate-400 font-medium">Please wait while the multi-test matrix is aligned and consolidated.</p>
            </div>
          ) : comparisonGridData.students.length === 0 ? (
            <div className="py-24 flex flex-col items-center justify-center gap-4 bg-white rounded-[2rem] border border-slate-100 shadow-sm text-center px-4">
              <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-3xl flex items-center justify-center">
                <AlertCircle size={32} />
              </div>
              <div className="space-y-1">
                <p className="text-base font-black text-slate-900">No Student Records Found</p>
                <p className="text-xs text-slate-400 max-w-sm font-medium mx-auto">
                  No scores match the selected program filters or student search parameters. Try choosing another Program Level, Center or resetting your search query.
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => {
                    setSelectedProgramId('');
                    setSelectedBatchId('');
                    setSelectedCenterId('');
                    setStudentSearch('');
                  }}
                  className="text-[10px] font-black uppercase tracking-widest"
                >
                  Reset All Filters
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Spreadsheet Grid container */}
              <Card className="rounded-[2rem] border border-slate-200 shadow-xl bg-white overflow-hidden">
                <div className="overflow-x-auto overflow-y-auto max-h-[750px] relative">
                  <table className="w-full border-collapse text-xs text-left">
                    <thead className="sticky top-0 z-30 shadow-md">
                       {/* First Row Header Groups */}
                      <tr className="bg-[#0b1329] text-white border-b border-slate-800">
                        <th rowSpan={2} className="px-6 py-5 border-r-[3.5px] border-r-amber-700/80 align-middle min-w-[260px] sticky left-0 bg-[#0b1329] z-50 shadow-[4px_0_10px_rgba(0,0,0,0.2)]">
                          <div className="text-xs font-black uppercase tracking-widest font-mono text-blue-400">Student Profile</div>
                          <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5 font-mono">Roll-No / Program Batch</div>
                        </th>
                        {displayedTests.map((testMeta, idx) => {
                          const testLabel = idx === 0 ? '🏆 LATEST TEST' : '📅 PREVIOUS TEST';
                          return (
                            <th 
                              key={testMeta.testId} 
                              colSpan={isMedicalProgram ? 6 : 5} 
                              className={cn(
                                "px-4 py-3 text-center border-r-[3.5px] border-r-amber-700/80 font-extrabold tracking-widest uppercase text-[10px] font-mono",
                                idx === 0 ? "bg-[#0b1c3a] text-blue-200" : "bg-[#0f172a] text-slate-300"
                              )}
                            >
                              <div className="flex items-center justify-center gap-1.5 font-black text-[11px] tracking-wider">
                                {testLabel}
                              </div>
                              <div className="text-[10px] text-slate-300 font-bold normal-case tracking-tight mt-0.5 max-w-[240px] mx-auto truncate font-sans" title={testMeta.testName}>
                                {testMeta.testName || '—'}
                              </div>
                              <div className="text-[8px] text-slate-400 font-bold tracking-widest mt-0.5 font-mono opacity-90">
                                DATE: {testMeta.testDate || '—'}
                              </div>
                            </th>
                          );
                        })}
                      </tr>

                      {/* Second Row Header Sub-columns */}
                      <tr className="bg-[#121b33] text-slate-200 border-b border-slate-755 font-bold uppercase tracking-wider text-[9px] font-mono">
                        {displayedTests.map((testMeta) => (
                          <React.Fragment key={testMeta.testId}>
                            <th className="p-2.5 text-center border-r border-slate-705 min-w-[110px] text-slate-300 bg-[#121b33] font-bold">
                              <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/40 px-2.5 py-1 rounded-full inline-block mb-1 shadow-sm">Physics</div>
                              <div className="mt-1 pt-1 border-t border-slate-700/60 font-mono text-[8.5px] leading-tight text-slate-300 space-y-0.5 font-extrabold normal-case select-none">
                                <div className="flex justify-between px-0.5 items-center">
                                  <span className="text-slate-400 text-[7.5px] font-bold uppercase">MAX:</span>
                                  <span className="text-emerald-400 font-black">{testWiseStats[testMeta.testId]?.Physics?.max ?? '—'}</span>
                                </div>
                                <div className="flex justify-between px-0.5 items-center">
                                  <span className="text-slate-400 text-[7.5px] font-bold uppercase">AVG:</span>
                                  <span className="text-amber-500 font-black">{testWiseStats[testMeta.testId]?.Physics?.avg ?? '—'}</span>
                                </div>
                              </div>
                            </th>
                            <th className="p-2.5 text-center border-r border-slate-705 min-w-[110px] text-slate-300 bg-[#121b33] font-bold">
                              <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#2dd4bf] bg-[#2dd4bf]/10 border border-[#2dd4bf]/40 px-2.5 py-1 rounded-full inline-block mb-1 shadow-sm">Chemistry</div>
                              <div className="mt-1 pt-1 border-t border-slate-700/60 font-mono text-[8.5px] leading-tight text-slate-300 space-y-0.5 font-extrabold normal-case select-none">
                                <div className="flex justify-between px-0.5 items-center">
                                  <span className="text-slate-400 text-[7.5px] font-bold uppercase">MAX:</span>
                                  <span className="text-emerald-400 font-black">{testWiseStats[testMeta.testId]?.Chemistry?.max ?? '—'}</span>
                                </div>
                                <div className="flex justify-between px-0.5 items-center">
                                  <span className="text-slate-400 text-[7.5px] font-bold uppercase">AVG:</span>
                                  <span className="text-amber-500 font-black">{testWiseStats[testMeta.testId]?.Chemistry?.avg ?? '—'}</span>
                                </div>
                              </div>
                            </th>
                            {isMedicalProgram ? (
                              <>
                                <th className="p-2.5 text-center border-r border-slate-705 min-w-[110px] text-blue-350 bg-[#121b33] font-bold">
                                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#10b981] bg-[#10b981]/10 border border-[#10b981]/40 px-2.5 py-1 rounded-full inline-block mb-1 shadow-sm">Botany</div>
                                  <div className="mt-1 pt-1 border-t border-slate-700/60 font-mono text-[8.5px] leading-tight text-blue-400/80 space-y-0.5 font-extrabold normal-case select-none">
                                    <div className="flex justify-between px-0.5 items-center">
                                      <span className="text-slate-400 text-[7.5px] font-bold uppercase">MAX:</span>
                                      <span className="text-emerald-400 font-black">{testWiseStats[testMeta.testId]?.Botany?.max ?? '—'}</span>
                                    </div>
                                    <div className="flex justify-between px-0.5 items-center">
                                      <span className="text-slate-400 text-[7.5px] font-bold uppercase">AVG:</span>
                                      <span className="text-amber-500 font-black">{testWiseStats[testMeta.testId]?.Botany?.avg ?? '—'}</span>
                                    </div>
                                  </div>
                                </th>
                                <th className="p-2.5 text-center border-r border-slate-705 min-w-[110px] text-blue-350 bg-[#121b33] font-bold">
                                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#a3e635] bg-[#a3e635]/10 border border-[#a3e635]/40 px-2.5 py-1 rounded-full inline-block mb-1 shadow-sm">Zoology</div>
                                  <div className="mt-1 pt-1 border-t border-slate-700/60 font-mono text-[8.5px] leading-tight text-blue-400/80 space-y-0.5 font-extrabold normal-case select-none">
                                    <div className="flex justify-between px-0.5 items-center">
                                      <span className="text-slate-400 text-[7.5px] font-bold uppercase">MAX:</span>
                                      <span className="text-emerald-400 font-black">{testWiseStats[testMeta.testId]?.Zoology?.max ?? '—'}</span>
                                    </div>
                                    <div className="flex justify-between px-0.5 items-center">
                                      <span className="text-slate-400 text-[7.5px] font-bold uppercase">AVG:</span>
                                      <span className="text-amber-500 font-black">{testWiseStats[testMeta.testId]?.Zoology?.avg ?? '—'}</span>
                                    </div>
                                  </div>
                                </th>
                              </>
                            ) : (
                              <th className="p-2.5 text-center border-r border-slate-705 min-w-[115px] text-emerald-350 bg-[#121b33] font-bold">
                                <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#38bdf8] bg-[#38bdf8]/10 border border-[#38bdf8]/40 px-2.5 py-1 rounded-full inline-block mb-1 shadow-sm">Mathematics</div>
                                <div className="mt-1 pt-1 border-t border-slate-700/60 font-mono text-[8.5px] leading-tight text-emerald-400/80 space-y-0.5 font-extrabold normal-case select-none font-bold">
                                  <div className="flex justify-between px-0.5 items-center">
                                    <span className="text-slate-400 text-[7.5px] font-bold uppercase">MAX:</span>
                                    <span className="text-emerald-400 font-black">{testWiseStats[testMeta.testId]?.Math?.max ?? '—'}</span>
                                  </div>
                                  <div className="flex justify-between px-0.5 items-center">
                                    <span className="text-slate-400 text-[7.5px] font-bold uppercase">AVG:</span>
                                    <span className="text-amber-500 font-black">{testWiseStats[testMeta.testId]?.Math?.avg ?? '—'}</span>
                                  </div>
                                </div>
                              </th>
                            )}
                            <th className="p-2.5 text-center border-r border-slate-705 min-w-[130px] text-white bg-[#121b33] font-bold">
                              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#ea580c] bg-[#ea580c]/10 border border-[#ea580c]/50 px-2.5 py-1 rounded-full inline-block mb-1 shadow-sm">Cumulative</div>
                              <div className="mt-1 pt-1 border-t border-slate-700/60 font-mono text-[8.5px] leading-tight text-slate-300 space-y-0.5 font-extrabold normal-case select-none">
                                <div className="flex justify-between px-0.5 items-center">
                                  <span className="text-slate-400 text-[7.5px] font-bold uppercase">MAX:</span>
                                  <span className="text-emerald-400 font-black">{testWiseStats[testMeta.testId]?.Total?.max ?? '—'}</span>
                                </div>
                                <div className="flex justify-between px-0.5 items-center">
                                  <span className="text-slate-400 text-[7.5px] font-bold uppercase">AVG:</span>
                                  <span className="text-amber-500 font-black">{testWiseStats[testMeta.testId]?.Total?.avg ?? '—'}</span>
                                </div>
                              </div>
                            </th>
                            <th className="p-2.5 text-center border-r-[3.5px] border-r-amber-700/80 min-w-[80px] text-amber-400 bg-[#0d1427] font-bold">
                              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#facc15] bg-[#facc15]/10 border border-[#facc15]/40 px-2.5 py-1 rounded-full inline-block mb-1 shadow-sm">Rank</div>
                              <div className="mt-1 pt-1 border-t border-slate-700/60 font-mono text-[8px] leading-tight text-slate-400 font-extrabold normal-case select-none text-center">
                                Test Rank
                              </div>
                            </th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {comparisonGridData.students.map((studentItem) => {
                        return (
                          <tr key={studentItem.regNo + '_' + studentItem.studentName} className="hover:bg-slate-50/70 transition-all even:bg-slate-50/20 border-b-2 border-slate-300">
                             {/* Student Details sticky first column */}
                            <td className="px-4 py-2 border-r-[3.5px] border-r-amber-700/70 sticky left-0 bg-white z-10 shadow-[4px_0_10px_rgba(0,0,0,0.04)] hover:bg-slate-50">
                              <div className="font-extrabold text-slate-900 text-xs tracking-tight font-sans text-left">
                                {exportWithName ? studentItem.studentName : `STUDENT_${studentItem.regNo || 'ANON'}`}
                              </div>
                              {exportWithName && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  <span className="font-mono text-[9px] font-black text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                    #{studentItem.regNo}
                                  </span>
                                  <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 uppercase tracking-wider font-mono truncate max-w-[130px]" title={studentItem.batchName}>
                                    {studentItem.batchName}
                                  </span>
                                </div>
                              )}
                              {exportWithName && studentItem.centerName && (
                                <div className="text-[8px] text-slate-400 font-extrabold uppercase mt-1 tracking-widest font-mono text-left">{studentItem.centerName}</div>
                              )}
                              
                              {((exportWithName && studentItem.type) || studentItem.rankTarget) && (
                                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                  {exportWithName && studentItem.type && (
                                    <span className="text-[8px] font-black text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-100 uppercase tracking-widest font-mono">
                                      {studentItem.type}
                                    </span>
                                  )}
                                  {studentItem.rankTarget && (
                                    <span className="text-[8px] font-black text-amber-750 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 uppercase tracking-widest font-mono inline-flex items-center gap-0.5">
                                      <Target size={9} className="text-amber-600" />
                                      {studentItem.rankTarget}
                                      {studentItem.targetYear && (
                                        <span className="text-slate-400 font-mono font-medium text-[7px]">({studentItem.targetYear})</span>
                                      )}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Chronological Test Columns */}
                            {displayedTests.map((testMeta, tIdx) => {
                              const testRes = studentItem.testResults[testMeta.testId];
                              const isCurrentTest = tIdx === 0;
                              
                              if (!testRes) {
                                return (
                                  <React.Fragment key={testMeta.testId}>
                                    <td className="p-3 text-center align-middle border-r border-slate-100 text-slate-300 font-mono font-medium bg-slate-50/20">—</td>
                                    <td className="p-3 text-center align-middle border-r border-slate-100 text-slate-300 font-mono font-medium bg-slate-50/20">—</td>
                                    {isMedicalProgram ? (
                                      <>
                                        <td className="p-3 text-center align-middle border-r border-slate-100 text-slate-300 font-mono font-medium bg-slate-50/20">—</td>
                                        <td className="p-3 text-center align-middle border-r border-slate-100 text-slate-300 font-mono font-medium bg-slate-50/20">—</td>
                                      </>
                                    ) : (
                                      <td className="p-3 text-center align-middle border-r border-slate-100 text-slate-300 font-mono font-medium bg-slate-50/20">—</td>
                                    )}
                                    <td className="p-3 text-center align-middle border-r border-slate-100 bg-slate-50/30 text-slate-400 italic font-medium font-sans text-[10px]">Absent</td>
                                    <td className="p-3 text-center align-middle border-r-[3.5px] border-r-amber-700/70 bg-slate-50/40 text-slate-400 font-mono font-medium">—</td>
                                  </React.Fragment>
                                );
                              }

                              const phScore = getSubjectScore(testRes, 'Physics');
                              const chScore = getSubjectScore(testRes, 'Chemistry');
                              const botScore = getSubjectScore(testRes, 'Botany');
                              const zooScore = getSubjectScore(testRes, 'Zoology');
                              const mathScore = getSubjectScore(testRes, 'Math');

                              const scoreVal = testRes.isAbsent ? '—' : (testRes.score ?? '—');
                              const testObj = tests.find(t => t.id === testMeta.testId);
                              const maxScoreVal = testObj?.maxScore || testRes.maxScore || (testObj?.pattern === 'NEET' || isMedicalProgram ? 720 : 360);
                              const accuracyVal = testRes.isAbsent ? '—' : (testRes.accuracy != null ? `${Math.round(testRes.accuracy)}%` : '—');
                              const rankVal = testRes.rank ? `#${testRes.rank}` : '—';

                              return (
                                <React.Fragment key={testMeta.testId}>
                                  {/* Physics */}
                                  <td className="p-3 text-center align-middle border-r border-slate-200 hover:bg-slate-50 transition-colors">
                                    {testRes.isAbsent ? (
                                      <span className="text-slate-300 font-mono">—</span>
                                    ) : (
                                      <div className="space-y-1">
                                        <div className="font-extrabold text-[#0f172a] text-sm font-sans">{phScore}</div>
                                        <div className="flex justify-center items-center gap-1 text-[9.5px] font-bold font-mono">
                                          <span className="text-emerald-600" title="Correct">C:{getRawSubjectObj(testRes, 'Physics')?.correct ?? 0}</span>
                                          <span className="text-slate-300 font-normal">|</span>
                                          <span className="text-rose-500" title="Wrong">W:{getRawSubjectObj(testRes, 'Physics')?.wrong ?? getRawSubjectObj(testRes, 'Physics')?.incorrect ?? 0}</span>
                                          <span className="text-slate-300 font-normal">|</span>
                                          <span className="text-slate-500" title="Unattempted">U:{getRawSubjectObj(testRes, 'Physics')?.blank ?? getRawSubjectObj(testRes, 'Physics')?.unattempted ?? 0}</span>
                                        </div>
                                      </div>
                                    )}
                                  </td>

                                  {/* Chemistry */}
                                  <td className="p-3 text-center align-middle border-r border-slate-200 hover:bg-slate-50 transition-colors">
                                    {testRes.isAbsent ? (
                                      <span className="text-slate-300 font-mono">—</span>
                                    ) : (
                                      <div className="space-y-1">
                                        <div className="font-extrabold text-[#0f172a] text-sm font-sans">{chScore}</div>
                                        <div className="flex justify-center items-center gap-1 text-[9.5px] font-bold font-mono">
                                          <span className="text-emerald-600" title="Correct">C:{getRawSubjectObj(testRes, 'Chemistry')?.correct ?? 0}</span>
                                          <span className="text-slate-300 font-normal">|</span>
                                          <span className="text-rose-500" title="Wrong">W:{getRawSubjectObj(testRes, 'Chemistry')?.wrong ?? getRawSubjectObj(testRes, 'Chemistry')?.incorrect ?? 0}</span>
                                          <span className="text-slate-300 font-normal">|</span>
                                          <span className="text-slate-500" title="Unattempted">U:{getRawSubjectObj(testRes, 'Chemistry')?.blank ?? getRawSubjectObj(testRes, 'Chemistry')?.unattempted ?? 0}</span>
                                        </div>
                                      </div>
                                    )}
                                  </td>

                                  {/* Botany & Zoology or Maths */}
                                  {isMedicalProgram ? (
                                    <>
                                      {/* Botany Cell */}
                                      <td className="p-3 text-center align-middle border-r border-slate-200 hover:bg-slate-50 transition-colors">
                                        {testRes.isAbsent ? (
                                          <span className="text-slate-300 font-mono">—</span>
                                        ) : (
                                          <div className="space-y-1">
                                            <div className="font-extrabold text-[#0f172a] text-sm font-sans">{botScore}</div>
                                            <div className="flex justify-center items-center gap-1 text-[9.5px] font-bold font-mono">
                                              <span className="text-emerald-600" title="Correct">C:{getRawSubjectObj(testRes, 'Botany')?.correct ?? 0}</span>
                                              <span className="text-slate-300 font-normal">|</span>
                                              <span className="text-rose-500" title="Wrong">W:{getRawSubjectObj(testRes, 'Botany')?.wrong ?? getRawSubjectObj(testRes, 'Botany')?.incorrect ?? 0}</span>
                                              <span className="text-slate-300 font-normal">|</span>
                                              <span className="text-slate-500" title="Unattempted">U:{getRawSubjectObj(testRes, 'Botany')?.blank ?? getRawSubjectObj(testRes, 'Botany')?.unattempted ?? 0}</span>
                                            </div>
                                          </div>
                                        )}
                                      </td>

                                      {/* Zoology Cell */}
                                      <td className="p-3 text-center align-middle border-r border-slate-200 hover:bg-slate-50 transition-colors">
                                        {testRes.isAbsent ? (
                                          <span className="text-slate-300 font-mono">—</span>
                                        ) : (
                                          <div className="space-y-1">
                                            <div className="font-extrabold text-[#0f172a] text-sm font-sans">{zooScore}</div>
                                            <div className="flex justify-center items-center gap-1 text-[9.5px] font-bold font-mono">
                                              <span className="text-emerald-600" title="Correct">C:{getRawSubjectObj(testRes, 'Zoology')?.correct ?? 0}</span>
                                              <span className="text-slate-300 font-normal">|</span>
                                              <span className="text-rose-500" title="Wrong">W:{getRawSubjectObj(testRes, 'Zoology')?.wrong ?? getRawSubjectObj(testRes, 'Zoology')?.incorrect ?? 0}</span>
                                              <span className="text-slate-300 font-normal">|</span>
                                              <span className="text-slate-500" title="Unattempted">U:{getRawSubjectObj(testRes, 'Zoology')?.blank ?? getRawSubjectObj(testRes, 'Zoology')?.unattempted ?? 0}</span>
                                            </div>
                                          </div>
                                        )}
                                      </td>
                                    </>
                                  ) : (
                                    /* Math Cell */
                                    <td className="p-3 text-center align-middle border-r border-slate-200 hover:bg-slate-50 transition-colors">
                                      {testRes.isAbsent ? (
                                        <span className="text-slate-300 font-mono">—</span>
                                      ) : (
                                        <div className="space-y-1">
                                          <div className="font-extrabold text-[#0f172a] text-sm font-sans">{mathScore}</div>
                                          <div className="flex justify-center items-center gap-1 text-[9.5px] font-bold font-mono">
                                            <span className="text-emerald-600" title="Correct">C:{getRawSubjectObj(testRes, 'Math')?.correct ?? 0}</span>
                                            <span className="text-slate-300 font-normal">|</span>
                                            <span className="text-rose-500" title="Wrong">W:{getRawSubjectObj(testRes, 'Math')?.wrong ?? getRawSubjectObj(testRes, 'Math')?.incorrect ?? 0}</span>
                                            <span className="text-slate-300 font-normal">|</span>
                                            <span className="text-slate-500" title="Unattempted">U:{getRawSubjectObj(testRes, 'Math')?.blank ?? getRawSubjectObj(testRes, 'Math')?.unattempted ?? 0}</span>
                                          </div>
                                        </div>
                                      )}
                                    </td>
                                  )}

                                  {/* All Detail */}
                                  <td 
                                    className={cn(
                                      "p-3 text-center align-middle border-r border-slate-200 bg-blue-50/10 min-w-[105px] transition-colors relative group/cumulative-cell",
                                      !testRes.isAbsent && "cursor-pointer hover:bg-blue-100/60"
                                    )}
                                    onClick={() => {
                                      if (!testRes.isAbsent && onSelectResult) {
                                        onSelectResult(testRes);
                                      }
                                    }}
                                    title={!testRes.isAbsent ? "Click to view full result details breakdown" : undefined}
                                  >
                                    {testRes.isAbsent ? (
                                      <span className="text-slate-300 italic text-[10px] font-sans">Absent</span>
                                    ) : (
                                      <div className="space-y-1.5">
                                        <div className="font-extrabold text-slate-900 tracking-tighter group-hover/cumulative-cell:text-blue-700 transition-colors">
                                          <span className="text-sm font-black text-slate-900 font-sans">{scoreVal}</span>
                                          <span className="text-[10px] font-bold text-slate-400 font-sans">/{maxScoreVal}</span>
                                        </div>
                                        <div className="text-[10.5px] font-extrabold text-[#10b981] leading-none font-sans">
                                          {accuracyVal} Acc
                                        </div>
                                        <div className="flex justify-center items-center gap-1 text-[9.5px] font-extrabold font-mono py-0.5 px-1.5 bg-white/80 border border-slate-200 rounded text-slate-700 shadow-2xs mx-auto max-w-[95px]">
                                          <span className="text-emerald-600" title="Total Correct">C:{testRes.correct ?? 0}</span>
                                          <span className="text-slate-350 font-semibold font-sans">|</span>
                                          <span className="text-rose-500" title="Total Wrong/Incorrect">W:{testRes.wrong ?? testRes.incorrect ?? 0}</span>
                                          <span className="text-slate-350 font-semibold font-sans">|</span>
                                          <span className="text-slate-500" title="Total Unattempted">U:{testRes.blank ?? testRes.unattempted ?? 0}</span>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-center gap-1 mt-1">
                                          {(() => {
                                            const bucket = determineRankBucket(Number(scoreVal), Number(maxScoreVal), testObj?.pattern || testRes.testPattern);
                                            return bucket && bucket !== '—' && (
                                              <div className="text-[8px] font-black text-rose-700 bg-rose-50 border border-rose-100 rounded px-1.5 py-0.5 uppercase tracking-wide font-sans inline-block">
                                                {bucket}
                                              </div>
                                            );
                                          })()}
                                          {isCurrentTest && onPrintResult && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onPrintResult(testRes);
                                              }}
                                              title="Print PDF Scorecard"
                                              className="mt-1 py-0.5 px-2 text-red-650 bg-white hover:bg-red-50 border border-red-200 rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer shadow-sm mx-auto font-sans print:hidden"
                                            >
                                              <FileText size={10} strokeWidth={2.5} className="text-red-500" />
                                              <span className="text-[8.5px] font-black uppercase text-red-600 tracking-tight">PDF</span>
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                  {/* Rank */}
                                  <td className={cn(
                                    "p-3 text-center align-middle border-r-[3.5px] border-r-amber-700/70 font-black font-sans text-xs transition-colors",
                                    testRes.isAbsent ? "text-slate-305 bg-slate-50/40" :
                                    testRes.rank === 1 ? "bg-amber-100/70 text-amber-800" :
                                    testRes.rank === 2 ? "bg-slate-100 text-slate-600" :
                                    testRes.rank === 3 ? "bg-orange-100/70 text-orange-850" :
                                    "bg-slate-50/30 text-slate-600"
                                  )}>
                                    {testRes.isAbsent ? '—' : rankVal}
                                  </td>
                                </React.Fragment>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Grid Pagination / Bottom Stats footnote */}
              <div className="flex flex-col md:flex-row justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100 gap-3 print:hidden">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">
                  Gurukul Analytical Engine &copy; Multi-Student Cumulative Matrix
                </span>
                <span className="text-[10px] text-slate-500 font-extrabold font-mono">
                  Showing {comparisonGridData.students.length} Student rows across {displayedTests.length} tests. Scroll horizontally to view the full progression track.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeAnalysisView === 'center_comparison' && (
        <div className="space-y-8 animate-fade-in print-center-comparison">
          {/* Dashboard Subheader Switcher */}
          <div className="bg-slate-50 border border-slate-100 p-4 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-4 print:hidden">
            <div className="space-y-1">
              <h2 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-600 animate-pulse"></span>
                Combined Operations Dashboard
              </h2>
              <p className="text-[10px] text-slate-400 font-extrabold uppercase font-sans tracking-wide">
                Centre Matrix &bull; Max vs Avg Trends &bull; Progression Tracking
              </p>
            </div>
            
            <div className="flex flex-wrap bg-slate-200/60 p-1 rounded-2xl gap-0.5 animate-fade-in">
              {[
                { id: 'all', label: 'All Dashboard Sections' },
                { id: 'center', label: '🏢 Centre Performance' },
                { id: 'trends', label: '📈 Max vs Average Trends' },
                { id: 'progress', label: '👥 Student Progression' }
              ].map(sub => (
                <button
                  key={sub.id}
                  onClick={() => setCenterSubView(sub.id as any)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[11px] font-extrabold transition-all duration-200 cursor-pointer",
                    centerSubView === sub.id ? "bg-white text-purple-700 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-300/30"
                  )}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          </div>

          {/* 1. CENTRE PERFORMANCE SECTION */}
          {(centerSubView === 'all' || centerSubView === 'center') && (
            <div className="space-y-8 pt-2">
              <div className="flex items-center justify-between border-b border-indigo-50 pb-2">
                <h3 className="text-base font-black text-slate-800 tracking-tight flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 p-1.5 rounded-lg text-xs">🏢</span>
                  Centre-wise Performance Matrix
                </h3>
                <span className="text-[10px] font-black tracking-wider text-slate-400 uppercase font-mono">
                  Operational centers stats
                </span>
              </div>
              
              {/* Extended Operations Insight Board (New Section for More Analysis) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
                {/* Visual Quad / Insight diagnostic finder */}
                <Card className="p-6 bg-gradient-to-br from-slate-50 to-white border border-slate-200/60 rounded-[2.2rem] shadow-sm space-y-4 lg:col-span-1">
                  <div>
                    <span className="text-[10px] font-black tracking-widest text-indigo-600 uppercase font-sans flex items-center gap-1">
                      <Target size={12} /> Diagnostic Quadrant Analysis
                    </span>
                    <h4 className="text-sm font-black text-slate-705 mt-1">Operational Health Indicators</h4>
                  </div>
                  
                  <div className="space-y-3 pt-2">
                    {/* Consistently High Achievers */}
                    <div className="bg-emerald-50/40 p-3 rounded-2xl border border-emerald-100/50">
                      <h5 className="text-[11px] font-black text-emerald-800 uppercase tracking-tight flex items-center gap-1">
                        🏆 High-Efficiency Centers
                      </h5>
                      <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">Average accuracy exceeding 70%</span>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(() => {
                          const highAchievers = centerComparisonData.filter(c => c.avgAccuracy >= 70);
                          return highAchievers.length > 0 ? (
                            highAchievers.slice(0, 3).map((c, i) => (
                              <span key={i} className="text-[10px] font-black bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-100">{c.centerName}</span>
                            ))
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">No centers matching diagnostic criteria currently.</span>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Support centers */}
                    <div className="bg-rose-50/40 p-3 rounded-2xl border border-rose-100/50">
                      <h5 className="text-[11px] font-black text-rose-800 uppercase tracking-tight flex items-center gap-1">
                        ⚠️ Attention &amp; Support Required
                      </h5>
                      <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">Average accuracy lower than 60%</span>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(() => {
                          const supportRequired = centerComparisonData.filter(c => c.avgAccuracy < 60 && c.avgAccuracy > 0);
                          return supportRequired.length > 0 ? (
                            supportRequired.slice(0, 3).map((c, i) => (
                              <span key={i} className="text-[10px] font-black bg-rose-50 text-rose-700 px-2 py-0.5 rounded border border-rose-100">{c.centerName}</span>
                            ))
                          ) : (
                            <span className="text-[10px] text-emerald-600 font-extrabold">All centers stable &bull; Accuracy check passed</span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Toppers Across Centers Leaderboard */}
                <Card className="p-6 bg-white border border-slate-100 rounded-[2.2rem] shadow-sm space-y-4 lg:col-span-2">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                    <div>
                      <span className="text-[10px] font-black tracking-widest text-[#a855f7] uppercase font-sans">Cross-Centre Leaderboard</span>
                      <h4 className="text-sm font-black text-slate-800">Elite Competitors Standings</h4>
                    </div>
                    <Badge variant="blue">Top Scorers</Badge>
                  </div>
                  <div className="overflow-y-auto max-h-[196px] no-scrollbar">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                          <th className="pb-2">Student Name</th>
                          <th className="pb-2 text-center font-sans text-slate-400">Center Location</th>
                          <th className="pb-2 text-center font-sans text-slate-400">Achieved Score</th>
                          <th className="pb-2 text-right font-sans text-slate-400">Academic Acc %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-sans text-xs">
                        {outstandingCandidates.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-slate-400 italic font-sans animate-pulse">No candidates parsed. Try adjusting active filters.</td>
                          </tr>
                        ) : (
                          outstandingCandidates.slice(0, 4).map((cand, i) => (
                            <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-2.5 font-sans">
                                <div className="font-bold text-slate-900 text-xs">{cand.studentName}</div>
                                <div className="text-[9.5px] font-semibold text-slate-400 font-mono">{cand.regNo}</div>
                              </td>
                              <td className="py-2.5 text-center text-slate-500 font-bold font-sans">{cand.centerName}</td>
                              <td className="py-2.5 text-center font-black text-purple-700 font-sans">
                                {cand.score} <span className="text-[9px] font-normal text-slate-400 font-sans">/{cand.maxScore}</span>
                              </td>
                              <td className="py-2.5 text-right font-black text-emerald-650 font-mono">
                                {Math.round(cand.accuracy)}%
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              {/* Top Summary Widget Row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-6 bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-[2.2rem] shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-black tracking-widest text-indigo-500 uppercase font-sans">Active Centers</span>
                <h3 className="text-4xl font-extrabold text-slate-900 mt-2 font-sans tracking-tight">{centerComparisonData.length}</h3>
              </div>
              <p className="text-xs font-semibold text-slate-400 mt-4 leading-relaxed">Aggregated operational centers participating in selected examinations.</p>
            </Card>
            <Card className="p-6 bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-[2.2rem] shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-black tracking-widest text-emerald-500 uppercase font-sans">Top Performing Center</span>
                <h3 className="text-2xl font-extrabold text-slate-900 mt-2 font-sans tracking-tight truncate">
                  {centerComparisonData[0]?.centerName || '—'}
                </h3>
              </div>
              <p className="text-xs font-semibold text-slate-400 mt-4 leading-relaxed">
                Achieved highest performance with average core score of <strong className="text-emerald-600">{centerComparisonData[0]?.avgScore || 0}</strong>.
              </p>
            </Card>
            <Card className="p-6 bg-gradient-to-br from-purple-50 to-white border border-purple-100 rounded-[2.2rem] shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-black tracking-widest text-purple-500 uppercase font-sans">Global Score Range</span>
                <h3 className="text-2xl font-extrabold text-slate-900 mt-2 font-sans tracking-tight">
                  {centerComparisonData.length > 0 ? `${Math.min(...centerComparisonData.filter(c => c.avgScore > 0).map(c => c.avgScore)) || 0} - ${Math.max(...centerComparisonData.map(c => c.avgScore)) || 0}` : '—'}
                </h3>
              </div>
              <p className="text-xs font-semibold text-slate-400 mt-4 leading-relaxed">Spread of average scores across all participating centers.</p>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm space-y-4">
              <div>
                <h3 className="font-black text-lg text-slate-900 tracking-tight">Center Average Score Comparison</h3>
                <p className="text-xs text-slate-400 font-medium">Ranked score averages per center</p>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={centerComparisonData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="centerName" tick={{ fontSize: 9, fontWeight: 700 }} tickLine={false} axisLine={false} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 9, fontWeight: 700 }} tickLine={false} axisLine={false} stroke="#94a3b8" />
                    <RechartsTooltip 
                      contentStyle={{ background: '#0f172a', borderRadius: '1rem', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 'bold' }} 
                      itemStyle={{ color: '#38bdf8' }}
                    />
                    <Bar dataKey="avgScore" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Average Score" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm space-y-4">
              <div>
                <h3 className="font-black text-lg text-slate-900 tracking-tight">Accuracy vs Max Performance Matrix</h3>
                <p className="text-xs text-slate-400 font-medium font-sans">Average Accuracy % compared to Topper's Score</p>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={centerComparisonData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="centerName" tick={{ fontSize: 9, fontWeight: 700 }} tickLine={false} axisLine={false} stroke="#94a3b8" />
                    <YAxis yAxisId="left" tick={{ fontSize: 9, fontWeight: 700 }} tickLine={false} axisLine={false} stroke="#94a3b8" />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 9, fontWeight: 700 }} tickLine={false} axisLine={false} stroke="#10b981" />
                    <RechartsTooltip 
                      contentStyle={{ background: '#0f172a', borderRadius: '1rem', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 'bold' }} 
                    />
                    <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                    <Bar yAxisId="left" dataKey="maxScore" fill="#a855f7" radius={[6, 6, 0, 0]} name="Highest Score" />
                    <Line yAxisId="right" type="monotone" dataKey="avgAccuracy" stroke="#10b981" strokeWidth={3} name="Avg. Accuracy (%)" dot={{ r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Directory Grid */}
          <Card className="p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm space-y-6">
            <div>
              <h3 className="font-black text-xl text-slate-900 tracking-tight">Center Breakdown Directory</h3>
              <p className="text-xs text-slate-400 font-medium font-sans">Detailed performance statistics parsed across centers</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/20">
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Academic Center</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Topper Score</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Class Average</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Avg. Accuracy %</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Test Attempts</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Unique Students</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {centerComparisonData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-12 text-xs font-semibold text-slate-400 italic">
                        No center performance records found. Try adjusting active filters.
                      </td>
                    </tr>
                  ) : (
                    centerComparisonData.map((c, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-4 font-extrabold text-sm text-slate-900">{c.centerName}</td>
                        <td className="px-5 py-4 text-center font-black text-purple-600 text-sm">{c.maxScore}</td>
                        <td className="px-5 py-4 text-center font-black text-blue-600 text-sm">{c.avgScore}</td>
                        <td className="px-5 py-4 text-center font-extrabold text-[#10b981] text-xs">
                          <span className="bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-[6px]">{c.avgAccuracy}% Acc</span>
                        </td>
                        <td className="px-5 py-4 text-center font-bold text-slate-500 text-xs">{c.totalAttempts}</td>
                        <td className="px-5 py-4 text-right font-bold text-slate-500 text-xs">{c.uniqueStudents}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
            </div>
          )}

          {/* 2. MAX VS AVERAGE SCORE TREND SECTION */}
          {(centerSubView === 'all' || centerSubView === 'trends') && (
            <div className="space-y-8 pt-4 animate-fade-in">
              <div className="flex items-center justify-between border-b border-indigo-50 pb-2">
                <h3 className="text-base font-black text-slate-800 tracking-tight flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-700 p-1.5 rounded-lg text-xs">📈</span>
                  Chronological Score Dispersion (Topper vs Class Averages)
                </h3>
                <span className="text-[10px] font-black tracking-wider text-slate-400 uppercase font-mono">
                  Test progression tracking
                </span>
              </div>
          {/* Top Summary Widgets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6 bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-[2.2rem] shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-black tracking-widest text-blue-500 uppercase font-sans">Tests Analyzed</span>
                <h3 className="text-4xl font-extrabold text-slate-900 mt-2 font-sans tracking-tight">{testMaxAvgData.length}</h3>
              </div>
              <p className="text-xs font-semibold text-slate-400 mt-4 leading-relaxed">Chronological examination sequences loaded in database.</p>
            </Card>
            <Card className="p-6 bg-gradient-to-br from-rose-50 to-white border border-rose-100 rounded-[2.2rem] shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-black tracking-widest text-rose-500 uppercase font-sans">Highest Single Score Achieved</span>
                <h3 className="text-4xl font-extrabold text-[#e11d48] mt-2 font-sans tracking-tight">
                  {testMaxAvgData.length > 0 ? Math.max(...testMaxAvgData.map(t => t.maxScore)) : 0}
                </h3>
              </div>
              <p className="text-xs font-semibold text-slate-400 mt-4 leading-relaxed">Peak score achieved by a top candidate across all selected tests.</p>
            </Card>
          </div>

          {/* Test Performance Trend Chart */}
          <Card className="p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm space-y-4">
            <div>
              <h3 className="font-black text-xl text-slate-900 tracking-tight">Maximum vs. Average Score Trend</h3>
              <p className="text-xs text-slate-400 font-medium font-sans">Topper (Max Score) vs. Class Average over examinations trajectory</p>
            </div>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={testMaxAvgData} margin={{ top: 15, right: 20, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="testName" tick={{ fontSize: 9, fontWeight: 700 }} tickLine={false} axisLine={false} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 9, fontWeight: 700 }} tickLine={false} axisLine={false} stroke="#94a3b8" />
                  <RechartsTooltip 
                    contentStyle={{ background: '#0f172a', borderRadius: '1rem', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 'bold' }} 
                  />
                  <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                  <Line type="monotone" dataKey="maxScore" stroke="#ec4899" strokeWidth={3} name="Topper Max Score" activeDot={{ r: 8 }} dot={{ r: 5 }} />
                  <Line type="monotone" dataKey="avgScore" stroke="#3b82f6" strokeWidth={3} name="Class Average Score" dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Table Breakdown */}
          <Card className="p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm space-y-6">
            <div>
              <h3 className="font-black text-xl text-slate-900 tracking-tight">Examination Statistics Directory</h3>
              <p className="text-xs text-slate-400 font-medium font-sans">Topper of class score compared with global median benchmarks</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/20">
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Examination Name</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Date</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Topper (Max Score)</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Class Average Score</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Avg. Test Accuracy</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Student Attendance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {testMaxAvgData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-12 text-xs font-semibold text-slate-400 italic">
                        No test records matching active filters.
                      </td>
                    </tr>
                  ) : (
                    testMaxAvgData.map((t, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-4 font-extrabold text-sm text-slate-900">{t.testName}</td>
                        <td className="px-5 py-4 text-center text-xs font-bold text-slate-400 font-mono">{t.testDate}</td>
                        <td className="px-5 py-4 text-center font-black text-pink-600 text-sm">{t.maxScore}</td>
                        <td className="px-5 py-4 text-center font-black text-blue-600 text-sm">{t.avgScore}</td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded">
                            {t.avgAccuracy}% Accuracy
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right font-bold text-slate-500 text-xs">{t.attendance} Attendees</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
            </div>
          )}

          {/* 3. STUDENT PROGRESSION SECTION */}
          {(centerSubView === 'all' || centerSubView === 'progress') && (() => {
        const { list, progressedCount, declinedCount, stableCount, singleTestCount } = studentProgressData;
        const totalWithHistory = progressedCount + declinedCount + stableCount;
        
        let improvementPercent = totalWithHistory > 0 ? Math.round((progressedCount / totalWithHistory) * 100) : 0;

        const pieData = [
          { name: 'Progressed', value: progressedCount, color: '#10b981' },
          { name: 'Declined', value: declinedCount, color: '#ef4444' },
          { name: 'Stable', value: stableCount, color: '#f59e0b' }
        ].filter(d => d.value > 0);

        return (
          <div className="space-y-8 animate-fade-in">
            {/* Top Stat Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="p-6 bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-[2.2rem] shadow-sm flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-black tracking-widest text-[#10b981] uppercase font-sans">Progressed / Improved</span>
                  <p className="text-xs text-slate-400 font-semibold mt-1 font-sans">Change higher than +5 marks</p>
                  <h3 className="text-4xl font-extrabold text-emerald-600 mt-3 font-sans tracking-tight">{progressedCount}</h3>
                </div>
                <div className="text-[10px] font-black uppercase text-emerald-600 mt-4 tracking-wider">
                  {improvementPercent}% of compared
                </div>
              </Card>
              <Card className="p-6 bg-gradient-to-br from-rose-50 to-white border border-rose-100 rounded-[2.2rem] shadow-sm flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-black tracking-widest text-[#ef4444] uppercase font-sans">Decline / Critical Needs</span>
                  <p className="text-xs text-slate-400 font-semibold mt-1 font-sans">Score dropped more than -5 marks</p>
                  <h3 className="text-4xl font-extrabold text-rose-600 mt-3 font-sans tracking-tight">{declinedCount}</h3>
                </div>
                <div className="text-[10px] font-black uppercase text-rose-600 mt-4 tracking-wider">
                  {totalWithHistory > 0 ? Math.round((declinedCount / totalWithHistory) * 100) : 0}% of compared
                </div>
              </Card>
              <Card className="p-6 bg-gradient-to-br from-amber-50 to-white border border-amber-100 rounded-[2.2rem] shadow-sm flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-black tracking-widest text-[#f59e0b] uppercase font-sans">Stable Performers</span>
                  <p className="text-xs text-slate-400 font-semibold mt-1 font-sans">Marginal change within ±5 marks</p>
                  <h3 className="text-4xl font-extrabold text-amber-500 mt-3 font-sans tracking-tight">{stableCount}</h3>
                </div>
                <div className="text-[10px] font-black uppercase text-amber-500 mt-4 tracking-wider">
                  {totalWithHistory > 0 ? Math.round((stableCount / totalWithHistory) * 100) : 0}% of compared
                </div>
              </Card>
              <Card className="p-6 bg-slate-50 border border-slate-150 rounded-[2.2rem] shadow-sm flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-black tracking-widest text-slate-400 uppercase font-sans">Single Test Taken</span>
                  <p className="text-xs text-slate-400 font-semibold mt-1 font-sans">No comparison history available</p>
                  <h3 className="text-4xl font-extrabold text-slate-500 mt-3 font-sans tracking-tight">{singleTestCount}</h3>
                </div>
                <div className="text-[10px] font-black uppercase text-slate-400 mt-4 tracking-wider">
                  Awaiting second capture
                </div>
              </Card>
            </div>

            {/* Progression Distribution Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <Card className="p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm flex flex-col justify-between lg:col-span-1">
                <div>
                  <h3 className="font-black text-lg text-slate-900 tracking-tight text-center lg:text-left">Student Status Ratio</h3>
                  <p className="text-xs text-slate-400 font-medium text-center lg:text-left">Distribution split of matched student progression states</p>
                </div>
                {pieData.length === 0 ? (
                  <div className="text-center py-20 text-xs italic text-slate-400 font-sans">No comparisons available</div>
                ) : (
                  <div className="h-64 w-full flex flex-col justify-center">
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={75}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {pieData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap justify-center gap-4 text-[10px] font-black uppercase tracking-wider font-sans mt-4">
                      {pieData.map((d, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                          <span className="text-slate-600">{d.name} ({d.value})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

              {/* Top Improvers & Support List side-by-side */}
              <Card className="p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm lg:col-span-2 space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h3 className="font-black text-lg text-slate-900 tracking-tight">Steepest Trends Tracking</h3>
                    <p className="text-xs text-slate-400 font-medium font-sans">Students sorted by score progress margin</p>
                  </div>
                  <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-full tracking-wider font-sans">
                    TRACKING {totalWithHistory} COMPARED CANDIDATES
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* High Improvers */}
                  <div className="space-y-3">
                    <h4 className="text-[11px] font-black tracking-widest text-[#10b981] uppercase font-sans border-b border-emerald-50 pb-2">🚀 Top Academic Improvers</h4>
                    <div className="space-y-2 max-h-56 overflow-y-auto no-scrollbar">
                      {list.filter(s => s.status === 'Progressed').slice(0, 5).map((s, i) => (
                        <div key={i} className="flex justify-between items-center bg-emerald-50/20 border border-emerald-50/50 p-2.5 rounded-xl font-sans text-xs">
                          <div>
                            <div className="font-extrabold text-slate-900">{s.studentName}</div>
                            <div className="text-[10px] font-bold text-slate-400 font-mono mt-0.5">{s.regNo}</div>
                          </div>
                          <div className="text-right font-black text-[#10b981]">
                            <span>+{s.change} pts</span>
                            <span className="text-[9px] block text-slate-400 font-normal">({s.firstScore} → {s.lastScore})</span>
                          </div>
                        </div>
                      ))}
                      {list.filter(s => s.status === 'Progressed').length === 0 && (
                        <p className="text-slate-400 text-xs italic py-2">No students registered an increased score over comparison.</p>
                      )}
                    </div>
                  </div>

                  {/* support list (steepest drops) */}
                  <div className="space-y-3">
                    <h4 className="text-[11px] font-black tracking-widest text-[#ef4444] uppercase font-sans border-b border-rose-50 pb-2">⚠️ Steepest Academic Drops</h4>
                    <div className="space-y-2 max-h-56 overflow-y-auto no-scrollbar">
                      {[...list].filter(s => s.status === 'Declined').reverse().slice(0, 5).map((s, i) => (
                        <div key={i} className="flex justify-between items-center bg-rose-50/20 border border-rose-50/50 p-2.5 rounded-xl font-sans text-xs">
                          <div>
                            <div className="font-extrabold text-slate-900">{s.studentName}</div>
                            <div className="text-[10px] font-bold text-slate-400 font-mono mt-0.5">{s.regNo}</div>
                          </div>
                          <div className="text-right font-black text-[#ef4444]">
                            <span>{s.change} pts</span>
                            <span className="text-[9px] block text-slate-400 font-normal">({s.firstScore} → {s.lastScore})</span>
                          </div>
                        </div>
                      ))}
                      {list.filter(s => s.status === 'Declined').length === 0 && (
                        <p className="text-slate-400 text-xs italic py-2">No student performance declines recorded. Great job!</p>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Progression Directory Table */}
            <Card className="p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm space-y-6">
              <div>
                <h3 className="font-black text-xl text-slate-900 tracking-tight">Full Student Progression Directory</h3>
                <p className="text-xs text-slate-400 font-medium font-sans">Complete registry tracking of candidate trends alphabetically</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-sans">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/20">
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Candidate</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center font-sans">First Score</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center font-sans">Last Score</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center font-sans">Performance Margin</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center font-sans">Tests Taken</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right font-sans">Status Badge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans text-xs">
                    {list.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center p-12 text-xs font-semibold text-slate-400 italic">
                          No student records found to track.
                        </td>
                      </tr>
                    ) : (
                      list.map((s, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-5 py-4">
                            <div className="font-extrabold text-sm text-slate-900">{s.studentName}</div>
                            <div className="text-[10px] font-semibold text-slate-400 mt-1">{s.regNo} | {s.centerName} • {s.batchName}</div>
                          </td>
                          <td className="px-5 py-4 text-center font-bold text-slate-500">{s.firstScore}</td>
                          <td className="px-5 py-4 text-center font-bold text-slate-500">{s.lastScore}</td>
                          <td className={cn(
                            "px-5 py-4 text-center font-black text-sm",
                            s.change > 5 ? "text-emerald-600" :
                            s.change < -5 ? "text-rose-600" :
                            "text-slate-500"
                          )}>
                            {s.change > 0 ? `+${s.change}` : s.change}
                          </td>
                          <td className="px-5 py-4 text-center font-bold text-slate-500">{s.attemptsCount} tests</td>
                          <td className="px-5 py-4 text-right">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider font-sans",
                              s.status === 'Progressed' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                              s.status === 'Declined' ? "bg-rose-50 text-rose-700 border border-rose-100" :
                              s.status === 'Stable' ? "bg-amber-50 text-amber-700 border border-amber-100" :
                              "bg-slate-50 text-slate-400 border border-slate-100"
                            )}>
                              {s.status === 'Single Test' ? 'Single Test' : s.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      })()}
        </div>
      )}
        </>
      )}
    </div>
  );
}

function ResultDetail({ result, onBack, onUpdate, autoPrint, tests = [], setSelectedResult }: { result: any, onBack: () => void, onUpdate?: () => void, autoPrint?: boolean, tests?: any[], setSelectedResult?: (res: any) => void }) {
  const { role } = useAuth();
  const isAdmin = role === 'admin' || role === 'operator' || role === 'central_team' || role === 'central';
  const { qbgMap: qbgTopics } = useMetadata();
  const [exportWithName, setExportWithName] = useState<boolean>(true);
  const [test, setTest] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedPaper, setSelectedPaper] = useState<string>('');
  const [topicSort, setTopicSort] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [studentProfile, setStudentProfile] = useState<any>(null);
  const [allAttempts, setAllAttempts] = useState<any[]>([]);
  const [loadingAttempts, setLoadingAttempts] = useState(false);

  useEffect(() => {
    const fetchAllAttempts = async () => {
      if (!result.regNo) return;
      setLoadingAttempts(true);
      try {
        const q = query(
          collection(db, 'result_updated'),
          where('regNo', '==', result.regNo)
        );
        const snap = await getDocs(q);
        const attemptsData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const attemptsWithRanks = await Promise.all(
          attemptsData.map(async (attempt: any) => {
            if (attempt.isAbsent) {
              return { ...attempt, rank: '—' };
            }
            try {
              const testId = attempt.testId;
              if (!testId) return attempt;

              const qResults = query(
                collection(db, 'result_updated'),
                where('testId', '==', testId)
              );
              const resultSnap = await getDocs(qResults);
              const testGroup = resultSnap.docs.map(doc => doc.data() as any);

              const activeGroup = testGroup.filter((r: any) => !r.isAbsent);
              const studentScore = attempt.score !== undefined ? attempt.score : 0;
              const higherCount = activeGroup.filter((r: any) => (r.score || 0) > studentScore).length;
              const computedRank = higherCount + 1;

              return { ...attempt, rank: computedRank };
            } catch (err) {
              console.error("Error fetching rank for attempt: ", attempt.id, err);
              return attempt;
            }
          })
        );

        // Sort attempts newest first based on test date
        attemptsWithRanks.sort((a: any, b: any) => {
          const testA = tests.find((t: any) => t.id === a.testId);
          const testB = tests.find((t: any) => t.id === b.testId);
          const dateA = testA?.date || a.testDate || a.date || '';
          const dateB = testB?.date || b.testDate || b.date || '';
          return dateB.localeCompare(dateA);
        });
        setAllAttempts(attemptsWithRanks);
      } catch (err) {
        console.error("Failed to fetch student attempts:", err);
      } finally {
        setLoadingAttempts(false);
      }
    };
    fetchAllAttempts();
  }, [result.regNo, tests]);

  useEffect(() => {
    const fetchStudentProfile = async () => {
      if (result.regNo) {
        const regUpper = String(result.regNo).trim().toUpperCase();
        if (studentCache[regUpper]) {
          setStudentProfile(studentCache[regUpper]);
          return;
        }
        try {
          const q = query(collection(db, "students"), where("regNo", "==", result.regNo));
          const snap = await getDocs(q);
          if (!snap.empty) {
            const sData = snap.docs[0].data();
            const fullSData = { id: snap.docs[0].id, ...sData };
            studentCache[regUpper] = fullSData;
            setStudentProfile(fullSData);
          }
        } catch (e) {
          console.error("Failed to fetch student profile for scorecard CSV:", e);
        }
      }
    };
    fetchStudentProfile();
  }, [result.regNo]);

  useEffect(() => {
    if (autoPrint) {
      const timer = setTimeout(() => {
        window.print();
      }, 750);
      return () => clearTimeout(timer);
    }
  }, [autoPrint]);
  const [omrFilter, setOmrFilter] = useState<{ status: string, difficulty: string, subject: string }>({
    status: 'all',
    difficulty: 'all',
    subject: 'all'
  });

  // Live evaluation for display consistency
  const activeStats = useMemo(() => {
    return test ? evaluateResult(result.responsesJson || {}, test.answerKey || {}, qbgTopics, test.pattern) : null;
  }, [test, result.responsesJson, qbgTopics]);

  const normalizedResult = useMemo(() => {
    const source = activeStats ? {
      ...result,
      ...activeStats
    } : result;

    return {
      ...source,
      subjectStats: Array.isArray(source.subjectStats) 
        ? source.subjectStats.reduce((acc: any, s: any) => ({ ...acc, [s.name]: s }), {}) 
        : source.subjectStats,
      chapterStats: Array.isArray(source.chapterStats)
        ? source.chapterStats.reduce((acc: any, c: any) => ({ ...acc, [c.name]: c }), {})
        : source.chapterStats,
      difficultyStats: Array.isArray(source.difficultyStats)
        ? source.difficultyStats.reduce((acc: any, d: any) => ({ ...acc, [d.name]: d }), {})
        : source.difficultyStats
    };
  }, [result, activeStats]);

  const coreSubjects = useMemo(() => {
    const stats = normalizedResult.subjectStats || {};
    const pattern = (test?.pattern || '').toUpperCase();
    const hasBio = !!(stats.Botany || stats.Zoology || stats.Biology || stats.botany || stats.zoology || stats.biology);
    
    // If explicitly NEET or if it looks like a Bio/NEET test from the stats
    if (pattern === 'NEET' || hasBio) {
      const core = [
        { id: 'Physics', label: 'Physics', color: 'text-amber-500' },
        { id: 'Chemistry', label: 'Chemistry', color: 'text-indigo-500' }
      ];
      
      const hasBotany = !!(stats.Botany || stats.botany);
      const hasZoology = !!(stats.Zoology || stats.zoology);
      const hasBiology = !!(stats.Biology || stats.biology);
      
      if (hasBotany) core.push({ id: 'Botany', label: 'Botany', color: 'text-emerald-500' });
      if (hasZoology) core.push({ id: 'Zoology', label: 'Zoology', color: 'text-teal-500' });
      
      if (!hasBotany && !hasZoology && hasBiology) {
        core.push({ id: 'Biology', label: 'Biology', color: 'text-emerald-500' });
      } else if (!hasBotany && !hasZoology && !hasBiology) {
         // Fallback if no bio subjects found in stats but it IS expected to be NEET/Bio
         core.push({ id: 'Botany', label: 'Botany', color: 'text-emerald-500' });
         core.push({ id: 'Zoology', label: 'Zoology', color: 'text-teal-500' });
      }
      return core;
    }
    
    // Default to Physics, Chemistry, Math for everything else
    return [
      { id: 'Physics', label: 'Physics', color: 'text-amber-500' },
      { id: 'Chemistry', label: 'Chemistry', color: 'text-indigo-500' },
      { id: 'Math', label: 'Math', color: 'text-emerald-500', alt: ['Maths', 'Mathematics', 'MATH', 'MATHS', 'MATHEMATICS'] }
    ];
  }, [test?.pattern, normalizedResult.subjectStats]);

  const sortedTopicStats = useMemo(() => {
    if (!normalizedResult.topicStats) return [];
    
    let rawStats: any[] = [];
    if (Array.isArray(normalizedResult.topicStats)) {
      rawStats = normalizedResult.topicStats;
    } else {
      rawStats = Object.entries(normalizedResult.topicStats).map(([key, value]: [string, any]) => ({
        name: key,
        ...value
      }));
    }

    let list = rawStats.map((stats: any, index: number) => {
      const name = stats.name || stats.topic || '';
      const topicName = qbgTopics[name]?.topic || name || `Topic ${index + 1}`;
      return {
        id: name || String(index),
        ...stats,
        topicName,
        accuracy: (stats.total > 0 ? (stats.correct / stats.total) * 100 : 0)
      };
    });

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
      if (test && result && !isSyncing && activeStats) {
        const testVer = test.answerKeyVersion || 0;
        const resVer = result.answerKeyVersion || 0;
        
        // Auto-sync if version is stale OR if live evaluation score/counts do not match database counts (meaning rules updated)
        if (testVer > resVer || activeStats.score !== result.score || activeStats.correct !== result.correct || activeStats.wrong !== result.wrong) {
          console.log(`Auto-syncing scorecard: Mismatch detected or version stale. Live: ${activeStats.score} | DB: ${result.score}`);
          handleSync();
        }
      }
    };
    checkAutoSync();
  }, [test, result.id, activeStats]);

  const handleSync = async () => {
    if (!test || !result.id) return;
    try {
      setIsSyncing(true);
      const qbgMap = qbgTopics;
      
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

  // Prefer live evaluation if calculated, fallback to saved
  const evaluationToUse = activeStats?.mappedEvaluation || result.mappedEvaluation || [];
  
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

  const currentScore = activeStats !== null ? activeStats.score : (result.score || 0);

  const estRankBucket = useMemo(() => {
    if (result.isAbsent) return null;
    const computedMax = test?.maxScore || result.maxScore || (test?.pattern === 'NEET' ? 720 : 360);
    return determineRankBucket(currentScore, computedMax, test?.pattern || result.pattern || '');
  }, [test, result.isAbsent, result.maxScore, result.pattern, currentScore]);

  const currentCorrect = activeStats !== null ? activeStats.correct : (result.correct || 0);
  const currentWrong = activeStats !== null ? activeStats.wrong : (result.wrong || 0);
  const currentAccuracy = activeStats !== null ? activeStats.accuracy : (result.accuracy || 0);

  const handleExportDetail = () => {
    const sType = studentProfile?.type || result.type || '—';
    const sTarget = studentProfile?.rankTarget || result.rankTarget || '—';
    const sCenter = studentProfile?.centerName || result.centerName || '—';
    const sBatch = studentProfile?.batchName || result.batchName || '—';

    const testPattern = test?.pattern || result.pattern || '';
    const isMedical = testPattern === 'NEET' || String(testPattern).toLowerCase().includes('neet');

    const getSubjectStats = (subId: string) => {
      const stats = normalizedResult.subjectStats || {};
      if (stats[subId]) return stats[subId];
      const key = Object.keys(stats).find(k => k.toLowerCase().trim() === subId.toLowerCase().trim());
      if (key) return stats[key];
      if (subId === 'Math') {
        const altKey = Object.keys(stats).find(k => ['maths', 'mathematics'].includes(k.toLowerCase().trim()));
        if (altKey) return stats[altKey];
      }
      return null;
    };

    const phy = getSubjectStats('Physics');
    const chem = getSubjectStats('Chemistry');
    const bot = getSubjectStats('Botany');
    const zoo = getSubjectStats('Zoology');
    const bio = getSubjectStats('Biology');
    const math = getSubjectStats('Math');

    const phyScore = phy ? (phy.score ?? 0) : '—';
    const chemScore = chem ? (chem.score ?? 0) : '—';
    const botScore = bot ? (bot.score ?? 0) : '—';
    const zooScore = zoo ? (zoo.score ?? 0) : '—';
    const bioScore = bio ? (bio.score ?? 0) : '—';
    const mathScore = math ? (math.score ?? 0) : '—';

    const scoreVal = currentScore;
    const computedMax = test?.maxScore || result.maxScore || (isMedical ? 720 : 360);
    const percentScore = computedMax > 0 ? `${Math.round((scoreVal / computedMax) * 100)}%` : '—';
    const predictedRank = result.isAbsent ? '—' : determineRankBucket(scoreVal, computedMax, testPattern);

    const totalCorrect = currentCorrect;
    const totalWrong = currentWrong;
    const totalUnattempted = result.isAbsent ? 0 : (result.blank ?? (computedMax - totalCorrect - totalWrong));

    const row = {
      'Student Name': exportWithName ? result.studentName : `STUDENT_${result.regNo || 'ANON'}`,
      'Registration No': result.regNo,
      'Center': sCenter,
      'Batch': sBatch,
      'Student Type': sType,
      'Rank Target': sTarget,
      'Test Name': test?.name || result.testName || '—',
      'Test Date': test?.date || result.testDate || '—',
      
      'Physics Correct Qs': result.isAbsent ? '—' : (phy ? (phy.correct ?? 0) : 0),
      'Physics Incorrect Qs': result.isAbsent ? '—' : (phy ? (phy.wrong ?? 0) : 0),
      'Physics Unattempted Qs': result.isAbsent ? '—' : (phy ? (phy.blank ?? 0) : 0),
      'Physics Score': result.isAbsent ? '—' : phyScore,

      'Chemistry Correct Qs': result.isAbsent ? '—' : (chem ? (chem.correct ?? 0) : 0),
      'Chemistry Incorrect Qs': result.isAbsent ? '—' : (chem ? (chem.wrong ?? 0) : 0),
      'Chemistry Unattempted Qs': result.isAbsent ? '—' : (chem ? (chem.blank ?? 0) : 0),
      'Chemistry Score': result.isAbsent ? '—' : chemScore,

      'Botany Correct Qs': result.isAbsent ? '—' : (bot ? (bot.correct ?? 0) : 0),
      'Botany Incorrect Qs': result.isAbsent ? '—' : (bot ? (bot.wrong ?? 0) : 0),
      'Botany Unattempted Qs': result.isAbsent ? '—' : (bot ? (bot.blank ?? 0) : 0),
      'Botany Score': result.isAbsent ? '—' : botScore,

      'Zoology Correct Qs': result.isAbsent ? '—' : (zoo ? (zoo.correct ?? 0) : 0),
      'Zoology Incorrect Qs': result.isAbsent ? '—' : (zoo ? (zoo.wrong ?? 0) : 0),
      'Zoology Unattempted Qs': result.isAbsent ? '—' : (zoo ? (zoo.blank ?? 0) : 0),
      'Zoology Score': result.isAbsent ? '—' : zooScore,

      'Biology Correct Qs': result.isAbsent ? '—' : (bio ? (bio.correct ?? 0) : 0),
      'Biology Incorrect Qs': result.isAbsent ? '—' : (bio ? (bio.wrong ?? 0) : 0),
      'Biology Unattempted Qs': result.isAbsent ? '—' : (bio ? (bio.blank ?? 0) : 0),
      'Biology Score': result.isAbsent ? '—' : bioScore,

      'Mathematics Correct Qs': result.isAbsent ? '—' : (math ? (math.correct ?? 0) : 0),
      'Mathematics Incorrect Qs': result.isAbsent ? '—' : (math ? (math.wrong ?? 0) : 0),
      'Mathematics Unattempted Qs': result.isAbsent ? '—' : (math ? (math.blank ?? 0) : 0),
      'Mathematics Score': result.isAbsent ? '—' : mathScore,

      'Total Correct Qs': result.isAbsent ? '—' : totalCorrect,
      'Total Incorrect Qs': result.isAbsent ? '—' : totalWrong,
      'Total Unattempted Qs': result.isAbsent ? '—' : totalUnattempted,
      'Total Score': result.isAbsent ? '—' : scoreVal,
      '% Score': result.isAbsent ? '—' : percentScore,
      'Center Rank': result.isAbsent ? '—' : (result.rank || '—'),
      'Predicted Rank': predictedRank
    };

    const csv = Papa.unparse([row]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const sNameForFile = exportWithName ? result.studentName : `STUDENT_${result.regNo || 'ANON'}`;
    link.setAttribute('download', `${sNameForFile}_Result_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full p-6 md:p-10 space-y-10 relative print:p-0 print:m-0 print:space-y-6">
      {/* Printable Scorecard Brand Header */}
      <div className="hidden print:flex items-center justify-between border-b pb-4 mb-2 border-slate-200">
        <div className="space-y-1 text-left">
          <h1 className="text-xl font-black text-slate-900 tracking-tight">STUDENT EVALUATION REPORT</h1>
          <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Official Test Scorecard & Detailed Analytics</p>
        </div>
        <div className="text-right space-y-0.5">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Date Printed</p>
          <p className="text-xs font-bold text-slate-800">{new Date().toLocaleDateString()}</p>
        </div>
      </div>

      {isSyncing && <Loader fullScreen label="Synchronizing Scores..." />}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 print:hidden">
        <div className="flex items-center gap-6">
          <button onClick={onBack} className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 transition-colors">
            <ChevronLeft size={24} strokeWidth={3} className="text-slate-900" />
          </button>
          <div className="space-y-1">
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] pl-0.5">Final Result & Analytics</p>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none">
              {exportWithName ? result.studentName : `STUDENT_${result.regNo || 'ANON'}`}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
               <Badge variant="blue">{result.regNo}</Badge>
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Rank #{result.rank} • Test ID: {result.testId.slice(-6)}</span>
               {estRankBucket && estRankBucket !== '—' && (
                 <span className="text-[9px] font-black text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-100 uppercase tracking-wide font-mono inline-flex items-center gap-1">
                   <Award size={11} className="text-rose-500" />
                   Est. Rank: {estRankBucket}
                 </span>
               )}
               {result.type && (
                 <span className="text-[9px] font-black text-violet-700 bg-violet-50 px-2 py-0.5 rounded border border-violet-100 uppercase tracking-wide font-mono">
                   {result.type}
                 </span>
               )}
               {result.rankTarget && (
                 <span className="text-[9px] font-black text-amber-750 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 uppercase tracking-wide font-mono inline-flex items-center gap-1">
                   <Target size={11} className="text-amber-500" />
                   {result.rankTarget}
                   {result.targetYear && (
                     <span className="text-slate-400 font-normal">({result.targetYear})</span>
                   )}
                 </span>
               )}
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
      <div className="flex flex-wrap items-center justify-end gap-3 bg-white/50 backdrop-blur-sm p-2 rounded-2xl border border-slate-100/50 print:hidden">
          {/* Explicit Export Names Opt Toggle Selector for ResultDetail */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-100/80 rounded-xl p-1 shadow-sm font-sans h-9">
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest pl-2 select-none font-mono">
              Names:
            </span>
            <button
              type="button"
              onClick={() => setExportWithName(true)}
              className={cn(
                "px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer rounded-md h-full flex items-center",
                exportWithName ? "bg-blue-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-600"
              )}
            >
              Include
            </button>
            <button
              type="button"
              onClick={() => setExportWithName(false)}
              className={cn(
                "px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer rounded-md h-full flex items-center",
                !exportWithName ? "bg-amber-500 text-slate-950 shadow-sm" : "text-slate-400 hover:text-slate-600"
              )}
            >
              Anonymize
            </button>
          </div>

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

                        const qbgMap = qbgTopics;
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
          {coreSubjects.map((sub) => (
            <div key={sub.id} className="flex-1 px-8 text-center space-y-1">
              <p className={cn("text-[9px] font-black uppercase tracking-widest leading-none", sub.color)}>{sub.label}</p>
              <p className="text-2xl font-black text-white">
                {result.isAbsent ? '—' : (
                  normalizedResult.subjectStats?.[sub.id]?.score || 
                  (sub.alt ? sub.alt.reduce((acc, k) => acc || normalizedResult.subjectStats?.[k]?.score, 0) : 0) || 
                  0
                )}
              </p>
            </div>
          ))}
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

      {/* Student Metadata & Test Attempt History Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Student Metadata Card */}
        <Card className="xl:col-span-2 p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                  <UserIcon size={20} className="stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-lg leading-none mb-1">
                    {exportWithName ? (studentProfile?.name || result.studentName) : `STUDENT_${result.regNo || 'ANON'}`}
                  </h3>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{exportWithName ? `${result.regNo} • ` : ''}Student Master Record</p>
                </div>
              </div>
              <Badge variant="blue" className="bg-blue-50 text-blue-600 border-none uppercase tracking-widest text-[9px]">Verified Identity</Badge>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="space-y-1">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Academic Program</p>
                <p className="font-bold text-slate-900 text-xs truncate" title={result.programName}>{result.programName || '—'}</p>
                {exportWithName && (
                  <p className="text-[10px] font-black text-blue-600 uppercase truncate mt-0.5" title={result.batchCode || result.batchName}>{result.batchCode || result.batchName || '—'}</p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Center Location</p>
                <p className="font-bold text-slate-900 text-xs truncate" title={result.centerName}>{exportWithName ? (result.centerName || '—') : '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Contact Details</p>
                <p className="text-[11px] font-bold text-slate-800 truncate" title={studentProfile?.email || result.email}>{exportWithName ? (studentProfile?.email || result.email || 'No email profile') : '—'}</p>
                {exportWithName && (
                  <p className="text-[11px] font-mono font-bold text-slate-500 mt-0.5">{studentProfile?.phone || result.phone || 'No phone profile'}</p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Status & Mode</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <Badge variant={result.isAbsent ? 'slate' : 'green'} className="text-[9px] font-extrabold uppercase py-0.5 px-1.5">
                    {result.isAbsent ? 'ABSENT' : 'PRESENT'}
                  </Badge>
                  <Badge variant={result.testMode === 'online' ? 'blue' : 'slate'} className="text-[9px] font-extrabold uppercase py-0.5 px-1.5">
                    {result.testMode || 'offline'}
                  </Badge>
                </div>
              </div>

              {/* Extra row for student attributes */}
              <div className="space-y-1 pt-3 border-t border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Target Prep Year</p>
                <p className="font-extrabold text-slate-900 text-xs">
                  {studentProfile?.targetYear || result.targetYear || '—'}
                </p>
              </div>
              <div className="space-y-1 pt-3 border-t border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Rank Target Goal</p>
                <p className="font-extrabold text-blue-600 text-xs">
                  {studentProfile?.rankTarget || result.rankTarget || '—'}
                </p>
              </div>
              <div className="space-y-1 pt-3 border-t border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Enrollment Type</p>
                <span className="text-[8.5px] font-extrabold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase tracking-wide inline-block mt-0.5">
                  {exportWithName ? (studentProfile?.type || result.type || 'Standard') : '—'}
                </span>
              </div>
              <div className="space-y-1 pt-3 border-t border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Student Gender</p>
                <p className="font-bold text-slate-800 text-xs capitalize">
                  {exportWithName ? (studentProfile?.gender || '—') : '—'}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* OMR Attempts and History Card */}
        <Card className="xl:col-span-1 p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm flex flex-col justify-between max-h-[350px] xl:max-h-[400px]">
          <div>
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600">
                  <TrendingUp size={16} className="stroke-[2.5]" />
                </div>
                <div>
                  <h4 className="font-black text-slate-900 text-sm leading-tight">OMR Attempt History</h4>
                  <p className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wide">All test attempts tracked</p>
                </div>
              </div>
              <Badge variant="amber" className="bg-orange-50 text-orange-600 border-none font-bold text-[9px]">{allAttempts.length} Attempts</Badge>
            </div>

            {loadingAttempts ? (
              <div className="flex flex-col items-center justify-center py-10 space-y-2">
                <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loading history...</p>
              </div>
            ) : allAttempts.length > 0 ? (
              <div className="overflow-y-auto pr-1 space-y-2.5 max-h-[220px] xl:max-h-[260px] no-scrollbar">
                {allAttempts.map((attempt) => {
                  const matchT = tests?.find((t: any) => t.id === attempt.testId);
                  const tName = matchT?.testName || attempt.testName || 'Unknown OMR Test';
                  const tDate = matchT?.date || attempt.testDate || '—';
                  const tMax = matchT?.maxScore || attempt.testMaxScore || attempt.totalMarks || attempt.maxScore || '—';
                  const isCurrent = attempt.id === result.id;
                  
                  return (
                    <div 
                      key={attempt.id} 
                      onClick={() => {
                        if (!isCurrent) {
                          setSelectedResult?.(attempt);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                      }}
                      className={cn(
                        "p-3 rounded-2xl border transition-all flex flex-col justify-between gap-1",
                        isCurrent 
                          ? "bg-slate-900 border-slate-900 text-white shadow-md shadow-slate-200"
                          : "bg-slate-50 hover:bg-orange-50/50 border-transparent hover:border-orange-100 cursor-pointer"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-xs font-black truncate max-w-[140px] sm:max-w-[200px]", isCurrent ? "text-white" : "text-slate-800")}>
                          {tName}
                        </p>
                        <span className={cn("text-[8px] font-mono font-bold uppercase", isCurrent ? "text-orange-300" : "text-slate-400")}>
                          {tDate}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px]">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("font-black text-xs", isCurrent ? "text-orange-400" : "text-blue-600")}>
                            {attempt.isAbsent ? 'ABSENT' : `${attempt.score}/${tMax}`}
                          </span>
                          {!attempt.isAbsent && (
                            <span className={cn("text-[9px] font-extrabold", isCurrent ? "text-white/80" : "text-slate-500")}>
                              ({Math.round(attempt.accuracy || 0)}% Acc)
                            </span>
                          )}
                        </div>
                        {!attempt.isAbsent && (
                          <div className="flex flex-col items-end gap-1">
                            <span className={cn(
                              "px-2.5 py-1 rounded-[0.5rem] text-[9px] font-black leading-none",
                              isCurrent 
                                ? "bg-white/10 text-white" 
                                : "bg-slate-150 text-slate-700 border border-slate-200"
                            )}>
                              Rank: {attempt.rank && attempt.rank !== '—' && attempt.rank !== 0 ? `#${attempt.rank}` : '—'}
                            </span>
                            <span className={cn(
                              "text-[8px] font-black tracking-tight uppercase px-1.5 py-0.5 rounded-md leading-none",
                              isCurrent ? "bg-orange-500/25 text-orange-200" : "bg-amber-50 text-amber-600 border border-amber-100"
                            )}>
                              Est: {(() => {
                                const scoreVal = attempt.score !== undefined ? attempt.score : 0;
                                const maxVal = Number(tMax) || 360;
                                const patVal = matchT?.pattern || attempt.testPattern || '';
                                return determineRankBucket(scoreVal, maxVal, patVal);
                              })()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10">
                <p className="text-xs text-slate-400 italic font-medium">No other test attempts logged.</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 print:block print:space-y-6">
        <div className="lg:col-span-1 space-y-6">
          <Card className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-10 flex flex-col items-center justify-center space-y-4 shadow-xl shadow-blue-100 rounded-[3rem] relative overflow-hidden">
             <div className="relative z-10 w-20 h-20 bg-white/20 rounded-[2.5rem] flex items-center justify-center backdrop-blur-md">
               <Award size={36} strokeWidth={2.5} />
             </div>
             <div className="relative z-10 text-center">
               <p className="text-7xl font-black tracking-tighter leading-none mb-1">{result.isAbsent ? '—' : currentScore}</p>
               <p className="text-sm uppercase font-black text-blue-100 tracking-[0.3em] opacity-80">Aggregate Score</p>
               <p className="text-xs font-bold text-white/50 mt-4 tracking-widest uppercase">{result.isAbsent ? 'ABSENT' : `Rank #${result.rank}`}</p>
               {estRankBucket && estRankBucket !== '—' && (
                 <p className="text-[10px] font-black bg-white/15 border border-white/20 rounded-full px-3 py-1 text-white mt-3 uppercase tracking-wider font-mono inline-block">
                   Est. Rank: {estRankBucket}
                 </p>
               )}
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
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
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
          
          <Card className="p-8 bg-white border-slate-100 rounded-[3rem] shadow-sm space-y-10 print:hidden">
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
                                "min-w-10 px-2.5 h-10 rounded-full border-2 flex flex-col items-center justify-center text-[11px] font-bold transition-all relative",
                                ev.status === 'blank' ? "bg-slate-50 border-slate-200 text-slate-400" :
                                ev.status === 'correct' 
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-600" 
                                  : (ev.status === 'partial' ? "bg-amber-50 border-amber-200 text-amber-600" : "bg-rose-50 border-rose-200 text-rose-600")
                              )}>
                                <span className="leading-none whitespace-nowrap truncate max-w-[55px]">{ev.status === 'blank' ? '?' : ev.studentAns}</span>
                                {ev.status !== 'correct' && ev.status !== 'blank' && (
                                  <span className="text-[7px] opacity-60 font-black mt-0.5 border-t border-current pt-0.5 px-1 whitespace-nowrap truncate max-w-[65px]">{ev.correctAns}</span>
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

          <section className="space-y-6 print:break-inside-avoid">
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

          <section className="space-y-6 print:break-inside-avoid">
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
                                (subject === 'Botany' || subject === 'Biology') ? "bg-emerald-500" :
                                subject === 'Zoology' ? "bg-teal-500" :
                                (subject === 'Math' || subject === 'Mathematics') ? "bg-emerald-500" :
                                "bg-slate-400"
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

          <section className="space-y-6 print:break-inside-avoid">
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
                      const accuracy = Math.round(stats.accuracy || 0);
                      
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



