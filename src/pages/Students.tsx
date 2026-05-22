import React, { useState, useEffect } from 'react';
import { Card, Button, Input, Select, Badge, Loader } from '../components/UI';
import { 
  Search, 
  Filter, 
  Plus, 
  Upload, 
  X, 
  Trash2,
  Archive,
  MoreVertical, 
  ChevronRight, 
  User, 
  GraduationCap, 
  Calendar, 
  MapPin, 
  Hash,
  Download,
  Share2,
  Mail,
  Smartphone,
  FileText,
  Edit2,
  ArrowUpDown
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, getDocs, query, where, Timestamp, serverTimestamp, orderBy, limit, updateDoc, doc, deleteDoc, writeBatch, setDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { useMetadata } from '../context/MetadataContext';
import { toast } from 'sonner';
import { addLog, LogAction, LogCategory } from '../lib/logs';
import { useAuth } from '../context/AuthContext';

// Simple module-level caching for students to prevent repetitive Firestore scans
let cachedStudents: any[] | null = null;
let lastFetchedTime: number = 0;
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes client cache

export const invalidateStudentCache = () => {
  cachedStudents = null;
  lastFetchedTime = 0;
};

export default function Students() {
  const { user, role } = useAuth();
  const isAdmin = role === 'admin' || role === 'operator' || role === 'central_team';
  const isViewOnly = role === 'center_level' || role === 'teacher';
  const canEdit = isAdmin;
  
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  const [sortField, setSortField] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkEditData, setBulkEditData] = useState({
    programId: '',
    centerId: '',
    batchId: '',
    batchCode: '',
    gender: '',
    type: '',
    targetYear: '',
    rankTarget: '',
    status: ''
  });
  
  useEffect(() => {
    console.log('Current selected IDs:', selectedIds);
  }, [selectedIds]);
  
  const [search, setSearch] = useState('');
  const { programs, centers, batches } = useMetadata();
  
  const [filters, setFilters] = useState({
    program: '',
    center: '',
    batch: '',
    gender: '',
    type: '',
    status: '',
    targetYear: '',
    rankTarget: '',
    showInactive: false
  });

  const [newStudent, setNewStudent] = useState({
    name: '',
    regNo: '',
    programId: '',
    centerId: '',
    batchId: '',
    batchCode: '',
    phone: '',
    email: '',
    status: 'active',
    gender: '',
    type: '',
    rankTarget: '',
    targetYear: ''
  });

  useEffect(() => {
    fetchStudents(true);
  }, [filters.batch, filters.center, filters.program]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'add') {
      setIsAddModalOpen(true);
    }
  }, []);

  const fetchStudents = async (forceUpdate = false) => {
    setLoading(true);
    try {
      let q;
      if (filters.batch) {
        q = query(collection(db, 'students'), where('batchId', '==', filters.batch));
      } else if (filters.center) {
        q = query(collection(db, 'students'), where('centerId', '==', filters.center), limit(1500));
      } else if (filters.program) {
        q = query(collection(db, 'students'), where('programId', '==', filters.program), limit(1500));
      } else {
        q = query(collection(db, 'students'), limit(2000));
      }
      
      const snap = await getDocs(q);
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // Deduplicate unique students based on registration number and student name
      const seen = new Set();
      const uniqueStudents: any[] = [];
      for (const s of fetched) {
        const normReg = String(s.regNo || s.regno || s.id || '').trim().toUpperCase();
        const normName = String(s.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const key = `${normReg}_${normName}`;
        if (normReg || normName) {
          if (!seen.has(key)) {
            seen.add(key);
            uniqueStudents.push(s);
          }
        }
      }
      setStudents(uniqueStudents);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'students');
    } finally {
      setLoading(false);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const docId = newStudent.regNo.trim().toUpperCase();
      await setDoc(doc(db, 'students', docId), {
        ...newStudent,
        regNo: docId,
        createdAt: Timestamp.now()
      });

      await addLog({
        userId: user?.uid || 'system',
        userEmail: user?.email || 'unknown',
        action: LogAction.CREATE,
        category: LogCategory.STUDENT,
        resourceId: docId,
        resourceName: newStudent.name,
        details: `Student ${newStudent.name} (${docId}) added manually`,
        newData: { name: newStudent.name, regNo: docId }
      });

      setIsAddModalOpen(false);
      setNewStudent({ 
        name: '', 
        regNo: '', 
        programId: '', 
        centerId: '', 
        batchId: '', 
        batchCode: '',
        phone: '', 
        email: '', 
        status: 'active',
        gender: '',
        type: '',
        rankTarget: '',
        targetYear: ''
      });
      fetchStudents(true);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'students');
    }
  };

  const handleExport = () => {
    if (filteredStudents.length === 0) {
      toast.error('No data to export');
      return;
    }

    const exportData = filteredStudents.map(s => ({
      'Reg No': s.regNo,
      'Name': s.name,
      'Gender': s.gender,
      'Phone': s.phone,
      'Email': s.email,
      'Program': programs.find(p => p.id === s.programId)?.programName || '',
      'Center': centers.find(c => c.id === s.centerId)?.centerName || '',
      'Batch': batches.find(b => b.id === s.batchId)?.batchName || '',
      'Batch Code': s.batchCode || '',
      'Type': s.type || '',
      'Rank Target': s.rankTarget || '',
      'Target Year': s.targetYear || '',
      'Status': s.status || 'active'
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, `Students_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success(`Exported ${exportData.length} records`);
  };

  const handleBulkUpload = async (results: any) => {
    const data = results.data;
    if (!data || data.length === 0) {
      toast.error('No data found in file');
      return;
    }

    setLoading(true);
    try {
      const batchSize = 500;
      let appends = 0;
      
      // Process in chunks of 500
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = data.slice(i, i + batchSize);
        let batchCount = 0;

        for (const row of chunk) {
          const normalizedRow: any = {};
          Object.entries(row).forEach(([key, val]) => {
            const normalizedKey = key.toLowerCase().replace(/\s+/g, '').replace(/[._]/g, '');
            normalizedRow[normalizedKey] = val;
          });

          const name = normalizedRow.name || normalizedRow.studentname || normalizedRow.fullname || '';
          const regNo = String(normalizedRow.regno || normalizedRow.registrationno || normalizedRow.rollno || '').trim().toUpperCase();

          if (name && regNo) {
            const studentDoc = doc(db, 'students', regNo);
            
            // Resolve program/center/batch names to IDs
            let progId = normalizedRow.programid || '';
            if (!progId && normalizedRow.program) {
               const found = programs.find(p => p.programName?.toLowerCase() === String(normalizedRow.program).toLowerCase());
               if (found) progId = found.id;
               else progId = String(normalizedRow.program).trim(); 
            }

            let centId = normalizedRow.centerid || '';
            if (!centId && (normalizedRow.center || normalizedRow.centername)) {
               const centerSearch = normalizedRow.center || normalizedRow.centername;
               const found = centers.find(c => c.centerName?.toLowerCase() === String(centerSearch).toLowerCase());
               if (found) centId = found.id;
               else centId = String(centerSearch).trim(); 
            }

            let bId = normalizedRow.batchid || '';
            if (!bId && (normalizedRow.batch || normalizedRow.batchname)) {
               const batchSearch = normalizedRow.batch || normalizedRow.batchname;
               const found = batches.find(b => b.batchName?.toLowerCase() === String(batchSearch).toLowerCase());
               if (found) bId = found.id;
               else bId = String(batchSearch).trim(); 
            }

            const sanitizedStudent: any = {
              name: String(name || '').trim(),
              regNo: regNo,
              programId: String(progId || ''),
              centerId: String(centId || ''),
              batchId: String(bId || ''),
              phone: String(normalizedRow.phone || normalizedRow.phoneno || normalizedRow.contact || '').trim(),
              email: String(normalizedRow.email || normalizedRow.mailid || normalizedRow.emailaddress || '').trim(),
              gender: String(normalizedRow.gender || '').trim(),
              batchCode: String(normalizedRow.batchcode || '').trim(),
              type: String(normalizedRow.type || '').trim(),
              rankTarget: String(normalizedRow.ranktarget || normalizedRow.rank || '').trim(),
              targetYear: String(normalizedRow.targetyear || '').trim(),
              updatedAt: Timestamp.now()
            };

            // Upsert student with set merge:true
            batch.set(studentDoc, { ...sanitizedStudent, status: 'active', createdAt: serverTimestamp() }, { merge: true });
            appends++;
            batchCount++;
          }
        }

        if (batchCount > 0) {
          await batch.commit();
        }
      }

      if (appends > 0) {
        toast.success(`Processed: ${appends} records`);
        
        await addLog({
          userId: user?.uid || 'system',
          userEmail: user?.email || 'unknown',
          action: LogAction.IMPORT,
          category: LogCategory.STUDENT,
          resourceId: 'bulk-upsert',
          resourceName: 'Bulk Student Upsert',
          details: `Bulk Import: ${appends} students processed via upsert.`,
        });

        setIsUploadModalOpen(false);
        fetchStudents(true);
      } else {
        toast.error('No valid records found to process.');
      }
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.WRITE, 'students_bulk');
    } finally {
      setLoading(false);
    }
  };

  // Memoize filtered students for stability
  const filteredStudents = React.useMemo(() => {
    return students.filter(s => {
      const name = s.name || '';
      const regNo = s.regNo || '';
      const status = s.status || 'active';
      
      const matchesSearch = name.toLowerCase().includes(search.toLowerCase()) || 
                            regNo.toLowerCase().includes(search.toLowerCase());
      const matchesProgram = !filters.program || s.programId === filters.program;
      const matchesCenter = !filters.center || s.centerId === filters.center;
      const matchesBatch = !filters.batch || s.batchId === filters.batch;
      const matchesGender = !filters.gender || s.gender === filters.gender;
      const matchesType = !filters.type || s.type === filters.type;
      const matchesTargetYear = !filters.targetYear || s.targetYear === filters.targetYear;
      const matchesRankTarget = !filters.rankTarget || s.rankTarget === filters.rankTarget;
      const matchesStatus = filters.status ? status === filters.status : (filters.showInactive ? true : status === 'active');
      
      return matchesSearch && matchesProgram && matchesCenter && matchesBatch && 
             matchesGender && matchesType && matchesTargetYear && matchesRankTarget && 
             matchesStatus;
    });
  }, [students, search, filters]);

  // Memoize sorted students
  const sortedStudents = React.useMemo(() => {
    const list = [...filteredStudents];
    if (!sortField) return list;

    return list.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      if (sortField === 'name') {
        valA = a.name || '';
        valB = b.name || '';
      } else if (sortField === 'gender') {
        valA = a.gender || '';
        valB = b.gender || '';
      } else if (sortField === 'batchCode') {
        const bA = batches.find(x => x.id === a.batchId);
        const bB = batches.find(x => x.id === b.batchId);
        valA = bA?.batchCode || bA?.batchName || a.batchCode || a.batchId || '';
        valB = bB?.batchCode || bB?.batchName || b.batchCode || b.batchId || '';
      } else if (sortField === 'center') {
        const cA = centers.find(x => x.id === a.centerId);
        const cB = centers.find(x => x.id === b.centerId);
        valA = cA?.centerName || a.centerId || '';
        valB = cB?.centerName || b.centerId || '';
      } else if (sortField === 'program') {
        const pA = programs.find(x => x.id === a.programId);
        const pB = programs.find(x => x.id === b.programId);
        valA = pA?.programName || a.programId || '';
        valB = pB?.programName || b.programId || '';
      } else if (sortField === 'type') {
        valA = a.type || '';
        valB = b.type || '';
      } else if (sortField === 'rankTarget') {
        valA = a.rankTarget || '';
        valB = b.rankTarget || '';
      } else if (sortField === 'targetYear') {
        valA = a.targetYear || '';
        valB = b.targetYear || '';
      }

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortDirection === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        if (valA === valB) return 0;
        if (sortDirection === 'asc') {
          return valA > valB ? 1 : -1;
        } else {
          return valA < valB ? 1 : -1;
        }
      }
    });
  }, [filteredStudents, sortField, sortDirection, batches, centers, programs]);

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleBulkUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const batchSize = 400;
      const updates: any = {};
      if (bulkEditData.programId) updates.programId = bulkEditData.programId;
      if (bulkEditData.centerId) updates.centerId = bulkEditData.centerId;
      if (bulkEditData.batchId) {
        updates.batchId = bulkEditData.batchId;
        const b = batches.find(x => x.id === bulkEditData.batchId);
        if (b) {
          updates.batchCode = b.batchCode || b.batchName || '';
        }
      }
      if (bulkEditData.gender) updates.gender = bulkEditData.gender;
      if (bulkEditData.type) updates.type = bulkEditData.type;
      if (bulkEditData.targetYear) updates.targetYear = bulkEditData.targetYear;
      if (bulkEditData.rankTarget) updates.rankTarget = bulkEditData.rankTarget;
      if (bulkEditData.status) updates.status = bulkEditData.status;

      if (Object.keys(updates).length === 0) {
        toast.error('No parameters to update. Select at least one field code.');
        setLoading(false);
        return;
      }

      for (let i = 0; i < selectedIds.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = selectedIds.slice(i, i + batchSize);
        chunk.forEach(id => {
          batch.update(doc(db, 'students', id), {
            ...updates,
            updatedAt: Timestamp.now()
          });
        });
        await batch.commit();
      }

      await addLog({
        userId: user?.uid || 'system',
        userEmail: user?.email || 'unknown',
        action: LogAction.UPDATE,
        category: LogCategory.STUDENT,
        resourceId: 'bulk',
        resourceName: 'Bulk Update',
        details: `Bulk updated ${selectedIds.length} students params: ${Object.keys(updates).join(', ')}`,
        newData: updates
      });

      toast.success(`Successfully updated ${selectedIds.length} students`);
      setIsBulkEditOpen(false);
      setSelectedIds([]);
      fetchStudents(true);
    } catch (err) {
      console.error('Error during bulk edit update:', err);
      handleFirestoreError(err, OperationType.WRITE, 'students_bulk_edit');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredStudents.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredStudents.map(s => s.id));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6 relative">
      {loading && <Loader fullScreen label="Processing Students..." />}
      
      {/* Directory Title and Buttons Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-0.5">Directory</p>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">Students</h1>
          <p className="text-slate-500 font-medium text-sm">
            Manage your student records, batches, and enrollment data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button 
            variant="outline" 
            size="md" 
            onClick={handleExport} 
            className="rounded-full border border-slate-200 hover:bg-slate-50 text-blue-600 font-bold text-xs h-11 px-5 flex items-center justify-center gap-2 shadow-sm transition-all bg-white"
          >
             <Download size={15} className="text-emerald-600 animate-pulse" />
             Export Data
          </Button>
          {isAdmin && (
            <>
              <Button 
                variant="outline" 
                size="md" 
                onClick={() => setIsUploadModalOpen(true)} 
                className="rounded-full border border-slate-200 hover:bg-slate-50 text-blue-600 font-bold text-xs h-11 px-5 flex items-center justify-center gap-2 shadow-sm transition-all bg-white"
              >
                 <Upload size={15} className="text-blue-500" />
                 Bulk Import
              </Button>
              <Button 
                variant="primary" 
                size="md" 
                onClick={() => setIsAddModalOpen(true)} 
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold text-xs h-11 px-6 flex items-center justify-center gap-1.5 shadow-md shadow-blue-100 transition-all"
              >
                 <Plus size={15} strokeWidth={3} />
                 Add Student
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Modern Search and Filter Row */}
      <div className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="flex-1 relative w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <Input 
            placeholder="Search by name, registration number or email..." 
            value={search} 
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 py-2.5 rounded-xl text-xs font-semibold border-slate-100 focus:border-blue-400 focus:ring-0 transition-all bg-white shadow-sm shadow-slate-100/20 h-11 text-slate-700"
          />
        </div>
        <Button 
          variant="secondary" 
          size="md" 
          onClick={() => setIsFilterOpen(true)} 
          className="bg-white border border-slate-200 text-slate-800 rounded-xl h-11 px-6 whitespace-nowrap shadow-sm font-bold text-xs uppercase tracking-wider hover:bg-slate-50 flex items-center gap-2 w-full sm:w-auto justify-center transition-all"
        >
          <Filter size={14} className="text-slate-400" />
          Advanced Filters
        </Button>
      </div>

      {/* Active Filter Pills Row */}
      {(filters.batch || filters.center || filters.program || filters.gender || filters.type || filters.status || filters.targetYear || filters.rankTarget) && (
        <div className="flex flex-wrap gap-2 items-center pl-1 py-1">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mr-1">Active Filters:</span>
          {filters.program && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-[10px] font-extrabold border border-blue-100/50">
              Prog: {programs.find(p => p.id === filters.program)?.programName || filters.program}
              <button onClick={() => setFilters({ ...filters, program: '' })} className="hover:text-blue-900 font-bold text-xs">×</button>
            </span>
          )}
          {filters.center && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 rounded-full text-[10px] font-extrabold border border-green-100/50">
              Center: {centers.find(c => c.id === filters.center)?.centerName || filters.center}
              <button onClick={() => setFilters({ ...filters, center: '' })} className="hover:text-green-900 font-bold text-xs">×</button>
            </span>
          )}
          {filters.batch && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-extrabold border border-indigo-100/50">
              Batch: {batches.find(b => b.id === filters.batch)?.batchName || filters.batch}
              <button onClick={() => setFilters({ ...filters, batch: '' })} className="hover:text-indigo-900 font-bold text-xs">×</button>
            </span>
          )}
          {filters.gender && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-[10px] font-extrabold border border-amber-100/50">
              Gender: {filters.gender}
              <button onClick={() => setFilters({ ...filters, gender: '' })} className="hover:text-amber-900 font-bold text-xs">×</button>
            </span>
          )}
          {filters.type && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-[10px] font-extrabold border border-purple-100/50">
              Type: {filters.type}
              <button onClick={() => setFilters({ ...filters, type: '' })} className="hover:text-purple-900 font-bold text-xs">×</button>
            </span>
          )}
          {filters.status && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-teal-50 text-teal-700 rounded-full text-[10px] font-extrabold border border-teal-100/50">
              Status: {filters.status}
              <button onClick={() => setFilters({ ...filters, status: '' })} className="hover:text-teal-900 font-bold text-xs">×</button>
            </span>
          )}
          {filters.targetYear && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-pink-50 text-pink-700 rounded-full text-[10px] font-extrabold border border-pink-100/50">
              Year: {filters.targetYear}
              <button onClick={() => setFilters({ ...filters, targetYear: '' })} className="hover:text-pink-900 font-bold text-xs">×</button>
            </span>
          )}
          {filters.rankTarget && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-50 text-orange-700 rounded-full text-[10px] font-extrabold border border-orange-100/50">
              Rank: {filters.rankTarget}
              <button onClick={() => setFilters({ ...filters, rankTarget: '' })} className="hover:text-orange-950 font-bold text-xs">×</button>
            </span>
          )}
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setFilters({
              program: '', center: '', batch: '', gender: '', type: '', 
              status: '', targetYear: '', rankTarget: '', showInactive: false
            })}
            className="text-rose-500 hover:bg-rose-50 font-extrabold text-[9px] uppercase tracking-wider rounded-lg py-1 px-2.5 h-auto transition-colors"
          >
            Clear All
          </Button>
        </div>
      )}

      {/* Primary Unified Flat Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100/80 overflow-hidden">
        {selectedIds.length > 0 && (
          <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-4 border-b border-slate-800 animate-fadeIn">
            <div className="flex items-center gap-2">
              <span className="bg-blue-600 text-white font-extrabold px-2 py-0.5 rounded-full text-xs animate-pulse">
                {selectedIds.length}
              </span>
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Selected</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                className="bg-white/10 hover:bg-white/20 text-white border-transparent text-xs font-bold py-1 h-8"
                onClick={() => {
                  const dataToExport = students.filter(s => selectedIds.includes(s.id));
                  const ws = XLSX.utils.json_to_sheet(dataToExport);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "Selected Students");
                  XLSX.writeFile(wb, "Selected_Students.xlsx");
                }}
              >
                <Download size={13} className="mr-1" /> Export
              </Button>
              {isAdmin && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-transparent text-xs font-bold py-1 h-8"
                    onClick={async () => {
                      if (confirm(`Archive ${selectedIds.length} students? They will be hidden from findings.`)) {
                        setLoading(true);
                        try {
                          const batchSize = 400;
                          for (let i = 0; i < selectedIds.length; i += batchSize) {
                            const batch = writeBatch(db);
                            const chunk = selectedIds.slice(i, i + batchSize);
                            chunk.forEach(id => {
                              batch.update(doc(db, 'students', id), { status: 'inactive' });
                            });
                            await batch.commit();
                          }
                          
                          await addLog({
                            userId: user?.uid || 'system',
                            userEmail: user?.email || 'unknown',
                            action: LogAction.UPDATE,
                            category: LogCategory.STUDENT,
                            resourceId: 'bulk',
                            resourceName: 'Bulk Archive',
                            details: `Archived ${selectedIds.length} students via bulk action`,
                          });

                          toast.success(`Archived ${selectedIds.length} students`);
                          setSelectedIds([]);
                          fetchStudents(true);
                        } catch (err) {
                          console.error('Bulk archive error:', err);
                          handleFirestoreError(err, OperationType.WRITE, 'students_bulk_archive');
                        } finally {
                          setLoading(false);
                        }
                      }
                    }}
                  >
                    <Archive size={13} className="mr-1" /> Archive
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-red-500/20 hover:bg-red-500/30 text-rose-300 border-transparent text-xs font-bold py-1 h-8"
                    onClick={async () => {
                      if (confirm(`PERMANENTLY DELETE ${selectedIds.length} students from Firebase? This cannot be undone.`)) {
                        setLoading(true);
                        try {
                          const batchSize = 400;
                          for (let i = 0; i < selectedIds.length; i += batchSize) {
                            const batch = writeBatch(db);
                            const chunk = selectedIds.slice(i, i + batchSize);
                            chunk.forEach(id => {
                              batch.delete(doc(db, 'students', id));
                            });
                            await batch.commit();
                          }
                          
                          await addLog({
                            userId: user?.uid || 'system',
                            userEmail: user?.email || 'unknown',
                            action: LogAction.DELETE,
                            category: LogCategory.STUDENT,
                            resourceId: 'bulk',
                            resourceName: 'Bulk Delete',
                            details: `Permanently deleted ${selectedIds.length} students`,
                          });

                          toast.success(`Successfully deleted ${selectedIds.length} students`);
                          setSelectedIds([]);
                          await fetchStudents(true);
                        } catch (err) {
                          console.error('Bulk delete failed', err);
                          handleFirestoreError(err, OperationType.WRITE, 'students_bulk_delete');
                        } finally {
                          setLoading(false);
                        }
                      }
                    }}
                  >
                    <Trash2 size={13} className="mr-1" /> Delete Bulk
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border-transparent text-xs font-bold py-1 h-8"
                    onClick={() => {
                      setBulkEditData({
                        programId: '',
                        centerId: '',
                        batchId: '',
                        batchCode: '',
                        gender: '',
                        type: '',
                        targetYear: '',
                        rankTarget: '',
                        status: ''
                      });
                      setIsBulkEditOpen(true);
                    }}
                  >
                    <Edit2 size={13} className="mr-1" /> Bulk Edit
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-white text-xs font-bold py-1 h-8"
                onClick={() => setSelectedIds([])}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50/40 border-b border-slate-100 select-none">
                <th className="pl-4 pr-1 py-2.5 text-center w-10">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
                    checked={filteredStudents.length > 0 && selectedIds.length === filteredStudents.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th 
                  onClick={() => toggleSort('name')}
                  className="px-2 py-2.5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:bg-slate-50/50 group"
                >
                  <div className="flex items-center gap-1">
                    Student Name
                    <ArrowUpDown size={11} className={cn("transition-colors", sortField === 'name' ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('gender')}
                  className="px-2 py-2.5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:bg-slate-50/50 group"
                >
                  <div className="flex items-center gap-1">
                    Gender
                    <ArrowUpDown size={11} className={cn("transition-colors", sortField === 'gender' ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('batchCode')}
                  className="px-2 py-2.5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:bg-slate-50/50 group"
                >
                  <div className="flex items-center gap-1">
                    Batch Code
                    <ArrowUpDown size={11} className={cn("transition-colors", sortField === 'batchCode' ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('center')}
                  className="px-2 py-2.5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:bg-slate-50/50 group"
                >
                  <div className="flex items-center gap-1">
                    Center
                    <ArrowUpDown size={11} className={cn("transition-colors", sortField === 'center' ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('program')}
                  className="px-2 py-2.5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:bg-slate-50/50 group"
                >
                  <div className="flex items-center gap-1">
                    Program
                    <ArrowUpDown size={11} className={cn("transition-colors", sortField === 'program' ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('type')}
                  className="px-2 py-2.5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:bg-slate-50/50 group"
                >
                  <div className="flex items-center gap-1">
                    Type
                    <ArrowUpDown size={11} className={cn("transition-colors", sortField === 'type' ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('rankTarget')}
                  className="px-2 py-2.5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:bg-slate-50/50 group"
                >
                  <div className="flex items-center gap-1">
                    Rank Target
                    <ArrowUpDown size={11} className={cn("transition-colors", sortField === 'rankTarget' ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('targetYear')}
                  className="px-2 py-2.5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:bg-slate-50/50 group"
                >
                  <div className="flex items-center gap-1">
                    Target Year
                    <ArrowUpDown size={11} className={cn("transition-colors", sortField === 'targetYear' ? "text-blue-600" : "text-slate-300 group-hover:text-slate-400")} />
                  </div>
                </th>
                <th className="pr-4 pl-1 py-2.5 text-right text-[11px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{isAdmin ? 'Action' : 'View'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                Array(6).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={10} className="px-8 py-6"><div className="h-10 bg-slate-50 rounded-xl w-full" /></td>
                  </tr>
                ))
              ) : sortedStudents.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-20 text-center space-y-4">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300 shadow-inner">
                       <User size={30} />
                    </div>
                    <p className="text-slate-400 font-black uppercase tracking-widest text-[9px]">No students found matching current view</p>
                  </td>
                </tr>
              ) : (
                sortedStudents.map(student => (
                  <StudentRow 
                    key={student.id} 
                    student={student} 
                    isAdmin={isAdmin}
                    selected={selectedIds.includes(student.id)}
                    onSelect={(e: React.MouseEvent) => toggleSelect(student.id, e)}
                    onClick={setSelectedStudent}
                    onEditClick={(s: any) => {
                      setSelectedStudent(s);
                      setIsEditMode(true);
                    }}
                    onDeleteClick={async (s: any) => {
                      const isInactive = s.status === 'inactive';
                      const message = isInactive 
                        ? `Are you sure you want to PERMANENTLY delete ${s.name} from Firebase? This cannot be undone.`
                        : `Are you sure you want to archive ${s.name}? The record will remain in Firebase but will be hidden from the active list.`;

                      if (confirm(message)) {
                        setLoading(true);
                        try {
                          if (isInactive) {
                            await deleteDoc(doc(db, 'students', s.id));
                            toast.success('Student permanently deleted');
                          } else {
                            await updateDoc(doc(db, 'students', s.id), { status: 'inactive' });
                            toast.success('Student archived successfully');
                          }
                          fetchStudents(true);
                        } catch (err) {
                          handleFirestoreError(err, OperationType.WRITE, 'students_row_delete');
                        } finally {
                          setLoading(false);
                        }
                      }
                    }}
                    programName={programs.find(p => p.id === student.programId)?.programName || student.programId}
                    centerName={centers.find(c => c.id === student.centerId)?.centerName || student.centerId}
                    batchName={batches.find(b => b.id === student.batchId)?.batchName || student.batchId}
                    batchCode={batches.find(b => b.id === student.batchId)?.batchCode || student.batchCode || '—'}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] bg-slate-900 text-white rounded-[2rem] px-8 py-4 shadow-2xl flex items-center gap-8 border border-white/10 backdrop-blur-xl"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center font-black text-sm">
                {selectedIds.length}
              </div>
              <p className="text-sm font-black text-slate-200 uppercase tracking-widest">selected</p>
            </div>
            
            <div className="h-8 w-px bg-white/10" />
            
            <div className="flex items-center gap-2">
              <button 
                type="button"
                className="flex items-center gap-2 hover:text-blue-400 transition-all active:scale-95 font-black text-[10px] uppercase tracking-widest px-3 py-2 rounded-xl hover:bg-white/5"
                onClick={() => {
                  if (confirm(`Export ${selectedIds.length} students to Excel?`)) {
                    const dataToExport = students.filter(s => selectedIds.includes(s.id));
                    const ws = XLSX.utils.json_to_sheet(dataToExport);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Selected Students");
                    XLSX.writeFile(wb, "Selected_Students.xlsx");
                  }
                }}
              >
                <Download size={14} />
                Export
              </button>

              {isAdmin && (
                <>
                  <button 
                    type="button"
                    className="flex items-center gap-2 hover:text-amber-400 transition-all active:scale-95 font-black text-[10px] uppercase tracking-widest px-3 py-2 rounded-xl hover:bg-white/5"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('Bulk Archive triggered');
                      if (confirm(`Archive ${selectedIds.length} students? They will be hidden from the active list but remain in the database.`)) {
                        setLoading(true);
                        try {
                          const batchSize = 400;
                          for (let i = 0; i < selectedIds.length; i += batchSize) {
                            const batch = writeBatch(db);
                            const chunk = selectedIds.slice(i, i + batchSize);
                            chunk.forEach(id => {
                              batch.update(doc(db, 'students', id), { status: 'inactive' });
                            });
                            await batch.commit();
                          }
                          
                          await addLog({
                            userId: user?.uid || 'system',
                            userEmail: user?.email || 'unknown',
                            action: LogAction.UPDATE,
                            category: LogCategory.STUDENT,
                            resourceId: 'bulk',
                            resourceName: 'Bulk Archive',
                            details: `Archived ${selectedIds.length} students via bulk action`,
                          });

                          toast.success(`Archived ${selectedIds.length} students`);
                          setSelectedIds([]);
                          fetchStudents(true);
                        } catch (err) {
                          console.error('Bulk archive error:', err);
                          handleFirestoreError(err, OperationType.WRITE, 'students_bulk_archive');
                        } finally {
                          setLoading(false);
                        }
                      }
                    }}
                  >
                    <Archive size={14} />
                    Archive
                  </button>

                  <button 
                    type="button"
                    className="flex items-center gap-2 hover:text-red-400 transition-all active:scale-95 font-black text-[10px] uppercase tracking-widest px-3 py-2 rounded-xl hover:bg-white/5"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('Bulk Delete process started');
                      if (confirm(`PERMANENTLY DELETE ${selectedIds.length} students from Firebase? This cannot be undone.`)) {
                        console.log(`Confirmed deletion of ${selectedIds.length} IDs`);
                        const toastId = toast.loading(`Deleting ${selectedIds.length} students...`);
                        setLoading(true);
                        try {
                          const batchSize = 400;
                          let successfullyDeleted = 0;
                          for (let i = 0; i < selectedIds.length; i += batchSize) {
                            const batch = writeBatch(db);
                            const chunk = selectedIds.slice(i, i + batchSize);
                            chunk.forEach(id => {
                              batch.delete(doc(db, 'students', id));
                            });
                            await batch.commit();
                            successfullyDeleted += chunk.length;
                            console.log(`Deleted ${successfullyDeleted}/${selectedIds.length}`);
                            if (selectedIds.length > batchSize) {
                               toast.loading(`Deleting... ${successfullyDeleted}/${selectedIds.length}`, { id: toastId });
                            }
                          }
                          
                          await addLog({
                            userId: user?.uid || 'system',
                            userEmail: user?.email || 'unknown',
                            action: LogAction.DELETE,
                            category: LogCategory.STUDENT,
                            resourceId: 'bulk',
                            resourceName: 'Bulk Delete',
                            details: `Permanently deleted ${selectedIds.length} students via bulk action`,
                          });

                          toast.success(`Successfully deleted ${selectedIds.length} students from Firebase`, { id: toastId });
                          setSelectedIds([]);
                          await fetchStudents(true);
                          console.log('Bulk delete finished successfully');
                        } catch (err) {
                          console.error('CRITICAL: Bulk delete failed', err);
                          toast.error('Bulk deletion failed', { id: toastId });
                          handleFirestoreError(err, OperationType.WRITE, 'students_bulk_delete');
                        } finally {
                          setLoading(false);
                        }
                      }
                    }}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>

                  <button 
                    type="button"
                    className="flex items-center gap-2 hover:text-blue-400 transition-all active:scale-95 font-black text-[10px] uppercase tracking-widest px-3 py-2 rounded-xl hover:bg-white/5"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setBulkEditData({
                        programId: '',
                        centerId: '',
                        batchId: '',
                        batchCode: '',
                        gender: '',
                        type: '',
                        targetYear: '',
                        rankTarget: '',
                        status: ''
                      });
                      setIsBulkEditOpen(true);
                    }}
                  >
                    <Edit2 size={14} />
                    Bulk Edit
                  </button>
                </>
              )}
            </div>
            
            <button 
              onClick={() => setSelectedIds([])}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedStudent && (
          <StudentProfile 
            student={selectedStudent} 
            onClose={() => { setSelectedStudent(null); setIsEditMode(false); }} 
            isEditMode={isEditMode}
            onEdit={() => setIsEditMode(true)}
            onDelete={async () => {
              const isInactive = selectedStudent.status === 'inactive';
              const message = isInactive 
                ? 'Permanently delete this student from Firebase? This cannot be undone.'
                : 'Archive this student? The document will remain in Firebase but hidden from active list.';
              
              if (confirm(message)) {
                try {
                  if (isInactive) {
                    await deleteDoc(doc(db, 'students', selectedStudent.id));
                    
                    await addLog({
                      userId: user?.uid || 'system',
                      userEmail: user?.email || 'unknown',
                      action: LogAction.DELETE,
                      category: LogCategory.STUDENT,
                      resourceId: selectedStudent.id,
                      resourceName: selectedStudent.name,
                      details: `Student ${selectedStudent.name} permanently deleted from database`,
                      previousData: selectedStudent
                    });

                    toast.success('Student permanently deleted');
                  } else {
                    await updateDoc(doc(db, 'students', selectedStudent.id), { status: 'inactive' });
                    
                    await addLog({
                      userId: user?.uid || 'system',
                      userEmail: user?.email || 'unknown',
                      action: LogAction.UPDATE,
                      category: LogCategory.STUDENT,
                      resourceId: selectedStudent.id,
                      resourceName: selectedStudent.name,
                      details: `Student ${selectedStudent.name} archived (marked as inactive)`,
                      previousData: selectedStudent,
                      newData: { status: 'inactive' }
                    });

                    toast.success('Student archived successfully');
                  }
                  setSelectedStudent(null);
                  fetchStudents(true);
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, 'students_profile_delete');
                }
              }
            }}
            onSave={async (updatedData) => {
              try {
                const studentRef = doc(db, 'students', selectedStudent.id);
                await updateDoc(studentRef, updatedData);
                
                await addLog({
                  userId: user?.uid || 'system',
                  userEmail: user?.email || 'unknown',
                  action: LogAction.UPDATE,
                  category: LogCategory.STUDENT,
                  resourceId: selectedStudent.id,
                  resourceName: selectedStudent.name,
                  details: `Student ${selectedStudent.name} (${selectedStudent.regNo}) details updated`,
                  previousData: selectedStudent,
                  newData: updatedData
                });

                setSelectedStudent({ ...selectedStudent, ...updatedData });
                setIsEditMode(false);
                fetchStudents(true);
                toast.success('Student updated successfully');
              } catch (err) {
                handleFirestoreError(err, OperationType.WRITE, 'students_update');
              }
            }}
            programs={programs}
            centers={centers}
            batches={batches}
          />
        )}
      </AnimatePresence>

      <BottomSheet isOpen={isFilterOpen} onClose={() => setIsFilterOpen(false)}>
        <div className="space-y-6 max-h-[80vh] overflow-y-auto px-1 no-scrollbar pb-10">
          <div className="flex items-center justify-between sticky top-0 bg-white z-10 pb-4">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Advanced Filters</h2>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setFilters({
                program: '', center: '', batch: '', gender: '', type: '', 
                status: '', targetYear: '', rankTarget: '', showInactive: false
              })}
              className="text-rose-500 font-bold"
            >Reset</Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-black">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Gender</label>
              <Select value={filters.gender} onChange={e => setFilters({...filters, gender: e.target.value})}>
                <option value="">All Genders</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Status</label>
              <Select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})}>
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Type</label>
              <Select value={filters.type} onChange={e => setFilters({...filters, type: e.target.value})}>
                <option value="">All Types</option>
                <option value="Day Boarding">Day Boarding</option>
                <option value="e-Gurukul">e-Gurukul</option>
                <option value="Hosteller">Hosteller</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Target Year</label>
              <Select value={filters.targetYear} onChange={e => setFilters({...filters, targetYear: e.target.value})}>
                <option value="">All Years</option>
                <option value="2026">2026</option>
                <option value="2027">2027</option>
                <option value="2028">2028</option>
                <option value="2029">2029</option>
                <option value="2030">2030</option>
                <option value="2031">2031</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Rank Target</label>
              <Select value={filters.rankTarget} onChange={e => setFilters({...filters, rankTarget: e.target.value})}>
                <option value="">All Ranks</option>
                <option value="Under 100">Under 100</option>
                <option value="Under 200">Under 200</option>
                <option value="Under 500">Under 500</option>
                <option value="Under 1000">Under 1000</option>
                <option value="Under 2000">Under 2000</option>
                <option value="Above 5000">Above 5000</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Batch Code</label>
              <Select value={filters.batch} onChange={e => setFilters({...filters, batch: e.target.value})}>
                <option value="">All Batch Codes</option>
                {batches.filter(b => b.isActive).map(b => (
                  (!filters.program || b.programId === filters.program) && 
                  (!filters.center || b.centerId === filters.center) &&
                  <option key={b.id} value={b.id}>{b.batchName}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Program</label>
              <Select value={filters.program} onChange={e => setFilters({...filters, program: e.target.value, batch: ''})}>
                <option value="">All Programs</option>
                {programs.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.programName}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Center</label>
              <Select value={filters.center} onChange={e => setFilters({...filters, center: e.target.value, batch: ''})}>
                <option value="">All Centers</option>
                {centers.filter(c => c.isActive).map(c => <option key={c.id} value={c.id}>{c.centerName}</option>)}
              </Select>
            </div>
          </div>
          <Button variant="primary" size="lg" className="w-full shadow-xl shadow-blue-100" onClick={() => setIsFilterOpen(false)}>Apply Filters</Button>
        </div>
      </BottomSheet>

      <BottomSheet isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)}>
        <form onSubmit={handleAddStudent} className="space-y-6 max-h-[70vh] overflow-y-auto px-1">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Add Student</h2>
          <div className="space-y-4 pb-4">
            <div className="grid grid-cols-2 gap-4">
              <Input placeholder="Registration No." value={newStudent.regNo} onChange={e => setNewStudent({...newStudent, regNo: e.target.value})} required />
              <Select value={newStudent.batchCode} onChange={e => {
                const code = e.target.value;
                const relatedBatch = batches.find(b => b.batchCode === code || b.batchName === code);
                setNewStudent({
                  ...newStudent, 
                  batchCode: code,
                  batchId: relatedBatch ? relatedBatch.id : newStudent.batchId,
                  programId: relatedBatch ? relatedBatch.programId : newStudent.programId,
                  centerId: relatedBatch ? relatedBatch.centerId : newStudent.centerId
                });
              }}>
                <option value="">Batch Code</option>
                {Array.from(new Set(batches.filter(b => b.isActive).map(b => b.batchCode || b.batchName))).sort().map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </Select>
            </div>
            <Input placeholder="Full Name" value={newStudent.name} onChange={e => setNewStudent({...newStudent, name: e.target.value})} required />
            <div className="grid grid-cols-2 gap-4">
              <Select value={newStudent.batchId} onChange={e => {
                const bId = e.target.value;
                const found = batches.find(b => b.id === bId);
                setNewStudent({
                  ...newStudent, 
                  batchId: bId,
                  batchCode: found?.batchCode || found?.batchName || newStudent.batchCode,
                  programId: found?.programId || newStudent.programId,
                  centerId: found?.centerId || newStudent.centerId
                });
              }} required>
                <option value="">Enroll in Batch</option>
                {batches.filter(b => b.isActive).map(b => (
                  (!newStudent.programId || b.programId === newStudent.programId) && 
                  (!newStudent.centerId || b.centerId === newStudent.centerId) &&
                  <option key={b.id} value={b.id}>{b.batchName}</option>
                ))}
              </Select>
              <Select value={newStudent.gender} onChange={e => setNewStudent({...newStudent, gender: e.target.value})}>
                <option value="">Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select value={newStudent.type} onChange={e => setNewStudent({...newStudent, type: e.target.value})}>
                <option value="">Type</option>
                <option value="Day Boarding">Day Boarding</option>
                <option value="e-Gurukul">e-Gurukul</option>
                <option value="Hosteller">Hosteller</option>
              </Select>
              <Select value={newStudent.targetYear} onChange={e => setNewStudent({...newStudent, targetYear: e.target.value})}>
                <option value="">Target Year</option>
                <option value="2026">2026</option>
                <option value="2027">2027</option>
                <option value="2028">2028</option>
                <option value="2029">2029</option>
                <option value="2030">2030</option>
                <option value="2031">2031</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select value={newStudent.rankTarget} onChange={e => setNewStudent({...newStudent, rankTarget: e.target.value})}>
                <option value="">Rank Target</option>
                <option value="Under 100">Under 100</option>
                <option value="Under 200">Under 200</option>
                <option value="Under 500">Under 500</option>
                <option value="Under 1000">Under 1000</option>
                <option value="Under 2000">Under 2000</option>
                <option value="Above 5000">Above 5000</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select value={newStudent.programId} onChange={e => setNewStudent({...newStudent, programId: e.target.value, batchId: ''})} required>
                <option value="">Program</option>
                {programs.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.programName}</option>)}
              </Select>
              <Select value={newStudent.centerId} onChange={e => setNewStudent({...newStudent, centerId: e.target.value, batchId: ''})} required>
                 <option value="">Center</option>
                 {centers.filter(c => c.isActive).map(c => <option key={c.id} value={c.id}>{c.centerName}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input placeholder="Phone Number" value={newStudent.phone} onChange={e => setNewStudent({...newStudent, phone: e.target.value})} />
              <Input placeholder="Email Address" type="email" value={newStudent.email} onChange={e => setNewStudent({...newStudent, email: e.target.value})} />
            </div>
          </div>
          <Button type="submit" variant="primary" size="lg" className="w-full shadow-xl shadow-blue-100">Add Student Record</Button>
        </form>
      </BottomSheet>

      <BottomSheet isOpen={isUploadModalOpen} onClose={() => setIsUploadModalOpen(false)}>
        <div className="space-y-6 text-center">
          <div className="w-20 h-20 bg-blue-50 rounded-[2rem] flex items-center justify-center text-blue-600 mx-auto">
             <Upload size={32} strokeWidth={3} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Bulk Upload</h2>
            <p className="text-sm text-slate-400 font-bold mt-2">Upload student CSV data instantly</p>
          </div>
          <div className="space-y-4">
            <div className="p-6 bg-[#F8FAFC] border-2 border-dashed border-slate-200 rounded-[2.5rem] relative group cursor-pointer hover:border-blue-200 transition-colors">
              <input 
                type="file" 
                accept=".csv,.xlsx,.xls" 
                className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.name.endsWith('.csv')) {
                      Papa.parse(file, {
                        header: true,
                        complete: handleBulkUpload
                      });
                    } else {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        const data = new Uint8Array(event.target?.result as ArrayBuffer);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                        const jsonData = XLSX.utils.sheet_to_json(worksheet);
                        handleBulkUpload({ data: jsonData } as any);
                      };
                      reader.readAsArrayBuffer(file);
                    }
                  }
                }}
              />
              <div className="space-y-2">
                <span className="block font-black text-slate-900">Click to select CSV/Excel</span>
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-widest">Required: regNo, name, phone, email, gender, batchCode, type, rankTarget, targetYear</span>
              </div>
            </div>

            <Button 
              variant="secondary" 
              size="md" 
              onClick={() => {
                const sampleRows = Array.from({ length: 10 }).map((_, i) => {
                  const activeProgs = programs.filter(p => p.isActive);
                  const activeCenters = centers.filter(c => c.isActive);
                  const activeBatches = batches.filter(b => b.isActive);
                  
                  const prog = activeProgs[i % activeProgs.length] || { programName: 'JEE Main', id: 'PROG001' };
                  const center = activeCenters[i % activeCenters.length] || { centerName: 'Kota Main', id: 'CENT001' };
                  const batch = activeBatches.find(b => b.programId === prog.id && b.centerId === center.id) || activeBatches[i % activeBatches.length] || { batchName: 'Alpha-1', id: 'BATCH001', batchCode: 'JB-26-A' };

                  return {
                    regNo: `PW${26000 + i + 1}`, 
                    name: `Student ${i + 1}`, 
                    gender: i % 2 === 0 ? 'Male' : 'Female',
                    program: prog.programName,
                    programId: prog.id,
                    center: center.centerName,
                    centerId: center.id,
                    batch: batch.batchName,
                    batchId: batch.id,
                    batchCode: batch.batchCode || batch.batchName,
                    type: i % 3 === 0 ? 'Hosteller' : 'Day Boarding',
                    targetYear: '2026',
                    rankTarget: 'Under 500',
                    phone: `98765432${10 + i}`, 
                    email: `student${i + 1}@example.com` 
                  };
                });
                const ws = XLSX.utils.json_to_sheet(sampleRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Students");
                XLSX.writeFile(wb, "Student_Upload_Template.xlsx");
              }}
              className="w-full bg-slate-50 border-slate-100"
            >
              <Download className="mr-2" size={18} />
              Download Excel Template
            </Button>
          </div>
          <Button variant="secondary" size="lg" className="w-full" onClick={() => setIsUploadModalOpen(false)}>Cancel</Button>
        </div>
      </BottomSheet>

      <BottomSheet isOpen={isBulkEditOpen} onClose={() => setIsBulkEditOpen(false)}>
        <form onSubmit={handleBulkUpdateSubmit} className="space-y-6 max-h-[70vh] overflow-y-auto px-1 font-black">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Bulk Edit ({selectedIds.length} Students)</h2>
          <p className="text-xs text-slate-400 font-bold mt-2 leading-relaxed">Select the fields you want to update for all selected students. Fields left blank or untouched will NOT be modified.</p>
          
          <div className="space-y-4 pb-4 font-black">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider font-extrabold px-1">Program</label>
                <Select value={bulkEditData.programId} onChange={e => setBulkEditData({...bulkEditData, programId: e.target.value, batchId: ''})}>
                  <option value="">Keep Current Program</option>
                  {programs.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.programName}</option>)}
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider font-extrabold px-1">Center</label>
                <Select value={bulkEditData.centerId} onChange={e => setBulkEditData({...bulkEditData, centerId: e.target.value, batchId: ''})}>
                  <option value="">Keep Current Center</option>
                  {centers.filter(c => c.isActive).map(c => <option key={c.id} value={c.id}>{c.centerName}</option>)}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider font-extrabold px-1">Batch</label>
                <Select value={bulkEditData.batchId} onChange={e => {
                  const bId = e.target.value;
                  const found = batches.find(b => b.id === bId);
                  setBulkEditData({
                    ...bulkEditData,
                    batchId: bId,
                    batchCode: found ? (found.batchCode || found.batchName) : ''
                  });
                }}>
                  <option value="">Keep Current Batch</option>
                  {batches.filter(b => b.isActive).map(b => (
                    (!bulkEditData.programId || b.programId === bulkEditData.programId) && 
                    (!bulkEditData.centerId || b.centerId === bulkEditData.centerId) &&
                    <option key={b.id} value={b.id}>{b.batchName}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider font-extrabold px-1">Gender</label>
                <Select value={bulkEditData.gender} onChange={e => setBulkEditData({...bulkEditData, gender: e.target.value})}>
                  <option value="">Keep Current Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider font-extrabold px-1">Type</label>
                <Select value={bulkEditData.type} onChange={e => setBulkEditData({...bulkEditData, type: e.target.value})}>
                  <option value="">Keep Current Type</option>
                  <option value="Day Boarding">Day Boarding</option>
                  <option value="e-Gurukul">e-Gurukul</option>
                  <option value="Hosteller">Hosteller</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider font-extrabold px-1">Target Year</label>
                <Select value={bulkEditData.targetYear} onChange={e => setBulkEditData({...bulkEditData, targetYear: e.target.value})}>
                  <option value="">Keep Current Year</option>
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                  <option value="2028">2028</option>
                  <option value="2029">2029</option>
                  <option value="2030">2030</option>
                  <option value="2031">2031</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider font-extrabold px-1">Rank Target</label>
                <Select value={bulkEditData.rankTarget} onChange={e => setBulkEditData({...bulkEditData, rankTarget: e.target.value})}>
                  <option value="">Keep Current Rank Target</option>
                  <option value="Under 100">Under 100</option>
                  <option value="Under 200">Under 200</option>
                  <option value="Under 500">Under 500</option>
                  <option value="Under 1000">Under 1000</option>
                  <option value="Under 2000">Under 2000</option>
                  <option value="Above 5000">Above 5000</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider font-extrabold px-1">Status</label>
                <Select value={bulkEditData.status} onChange={e => setBulkEditData({...bulkEditData, status: e.target.value})}>
                  <option value="">Keep Current Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-4 border-t border-slate-100 pb-10">
            <Button 
              type="button" 
              variant="secondary" 
              className="flex-1"
              onClick={() => setIsBulkEditOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              variant="primary" 
              className="flex-1 shadow-xl shadow-blue-100"
            >
              Apply Changes
            </Button>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}

function StudentRow({ student, selected, onSelect, onClick, onEditClick, onDeleteClick, programName, centerName, batchName, batchCode, isAdmin }: any) {
  return (
    <tr 
      className={cn(
        "group transition-all cursor-pointer text-xs border-b border-slate-100 hover:bg-slate-50/40 relative",
        selected ? "bg-blue-50/30" : ""
      )}
      onClick={() => onClick(student)}
    >
      <td className="pl-4 pr-1 py-1.5 w-10 text-center" onClick={e => e.stopPropagation()}>
        <input 
          type="checkbox" 
          checked={selected}
          onChange={onSelect as any}
          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
        />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap relative">
        {/* Subtle status left pill decoration */}
        <div className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r transition-colors",
          student.status === 'active' ? "bg-blue-500/80" : "bg-slate-300"
        )} />
        <span className="font-bold text-slate-800 text-xs tracking-tight block group-hover:text-blue-600 transition-colors">
          {student.name}
        </span>
      </td>
      <td className="px-2 py-1.5 text-slate-500 font-medium whitespace-nowrap text-xs">{student.gender || '—'}</td>
      <td className="px-2 py-1.5 text-slate-500 font-medium whitespace-nowrap text-xs">{batchCode || '—'}</td>
      <td className="px-2 py-1.5 text-slate-500 font-medium whitespace-nowrap text-xs">{centerName || '—'}</td>
      <td className="px-2 py-1.5 text-slate-500 font-medium whitespace-nowrap text-xs">{programName || '—'}</td>
      <td className="px-2 py-1.5 text-slate-400 font-semibold whitespace-nowrap text-[10px] uppercase tracking-wider">
        <span className={cn(
          "px-2 py-0.5 rounded-full text-[9px] font-extrabold",
          String(student.type).toLowerCase() === 'e-gurukul' ? "bg-indigo-50 text-indigo-600" : "bg-teal-50 text-teal-600"
        )}>
          {student.type || '—'}
        </span>
      </td>
      <td className="px-2 py-1.5 text-slate-500 font-medium whitespace-nowrap text-xs">{student.rankTarget || '—'}</td>
      <td className="px-2 py-1.5 text-slate-500 font-medium whitespace-nowrap text-xs">{student.targetYear || '—'}</td>
      <td className="pr-4 pl-1 py-1.5 text-right whitespace-nowrap">
        <div className="flex items-center justify-end space-x-1.5">
          {isAdmin && (
            <>
              <Button 
                variant="secondary" 
                size="sm" 
                className="w-7 h-7 p-0 bg-red-50 border border-transparent rounded-full hover:bg-red-100 text-red-500 transition-all flex items-center justify-center active:scale-90"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onDeleteClick(student);
                }}
              >
                 <Trash2 size={13} />
              </Button>
              <Button 
                variant="secondary" 
                size="sm" 
                className="w-7 h-7 p-0 bg-blue-50 border border-transparent rounded-full hover:bg-blue-100 text-blue-600 transition-all flex items-center justify-center active:scale-90"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onEditClick(student);
                }}
              >
                 <Edit2 size={13} />
              </Button>
            </>
          )}
          <Button 
            variant="secondary" 
            size="sm" 
            className="w-7 h-7 p-0 bg-white border border-slate-100/60 rounded-full hover:bg-slate-50 hover:border-slate-200 text-slate-400 hover:text-slate-600 transition-all flex items-center justify-center active:scale-90 shadow-sm"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onClick(student);
            }}
          >
             <ChevronRight size={14} strokeWidth={3} />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function StudentProfile({ 
  student, 
  onClose, 
  isEditMode, 
  onEdit, 
  onDelete,
  onSave,
  programs,
  centers,
  batches
}: { 
  student: any, 
  onClose: () => void, 
  isEditMode: boolean, 
  onEdit: () => void, 
  onDelete: () => Promise<void>,
  onSave: (data: any) => Promise<void>,
  programs: any[],
  centers: any[],
  batches: any[]
}) {
  const { role } = useAuth();
  const isAdmin = role === 'admin' || role === 'operator' || role === 'central_team';
  const [formData, setFormData] = useState({
    name: student.name || '',
    regNo: student.regNo || '',
    programId: student.programId || '',
    centerId: student.centerId || '',
    batchId: student.batchId || '',
    batchCode: student.batchCode || '',
    phone: student.phone || '',
    email: student.email || '',
    status: student.status || 'active',
    gender: student.gender || '',
    type: student.type || '',
    rankTarget: student.rankTarget || '',
    targetYear: student.targetYear || ''
  });

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setFormData({
      name: student.name || '',
      regNo: student.regNo || '',
      programId: student.programId || '',
      centerId: student.centerId || '',
      batchId: student.batchId || '',
      batchCode: student.batchCode || '',
      phone: student.phone || '',
      email: student.email || '',
      status: student.status || 'active',
      gender: student.gender || '',
    type: student.type || '',
    rankTarget: student.rankTarget || '',
      targetYear: student.targetYear || ''
    });
  }, [student]);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(formData);
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        className="relative w-full max-w-lg bg-white rounded-t-[3rem] sm:rounded-[3rem] shadow-2xl overflow-hidden min-h-[85vh]"
      >
        <div className="relative h-40 bg-gradient-to-br from-blue-600 to-indigo-700">
           <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-white/20 hover:bg-white/30 rounded-full text-white backdrop-blur-md transition-colors">
             <X size={24} />
           </button>
           <div className="absolute -bottom-16 left-8 flex items-end space-x-6">
              <div className="w-32 h-32 rounded-[2.5rem] bg-white p-2 shadow-2xl">
                 <div className="w-full h-full bg-blue-50 rounded-[2rem] flex items-center justify-center text-blue-600">
                    <User size={64} strokeWidth={1.5} />
                 </div>
              </div>
           </div>
        </div>

        <div className="pt-20 px-8 pb-32 space-y-8 overflow-y-auto max-h-[calc(85vh-40px)] no-scrollbar">
           {isEditMode && isAdmin ? (
             <div className="space-y-6">
                <div className="space-y-4">
                   <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Reg No.</label>
                         <Input value={formData.regNo} onChange={e => setFormData({...formData, regNo: e.target.value})} />
                      </div>
                       <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Batch Code</label>
                          <Select value={formData.batchCode} onChange={e => {
                            const code = e.target.value;
                            const relatedBatch = batches.find(b => b.batchCode === code || b.batchName === code);
                            setFormData({
                              ...formData, 
                              batchCode: code,
                              batchId: relatedBatch ? relatedBatch.id : formData.batchId,
                              programId: relatedBatch ? relatedBatch.programId : formData.programId,
                              centerId: relatedBatch ? relatedBatch.centerId : formData.centerId
                            });
                          }}>
                            <option value="">Select Code</option>
                            {Array.from(new Set(batches.filter(b => b.isActive).map(b => b.batchCode || b.batchName))).sort().map(code => (
                              <option key={code} value={code}>{code}</option>
                            ))}
                          </Select>
                       </div>
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                       <div className="space-y-1 col-span-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Academic Batch</label>
                          <Select value={formData.batchId} onChange={e => {
                             const bId = e.target.value;
                             const found = batches.find(b => b.id === bId);
                             setFormData({
                               ...formData, 
                               batchId: bId,
                               batchCode: found?.batchCode || found?.batchName || formData.batchCode,
                               programId: found?.programId || formData.programId,
                               centerId: found?.centerId || formData.centerId
                             });
                           }}>
                             <option value="">Select</option>
                             {batches.filter(b => b.isActive || b.id === formData.batchId).map(b => (
                               (!formData.programId || b.programId === formData.programId) && 
                               (!formData.centerId || b.centerId === formData.centerId) &&
                               <option key={b.id} value={b.id}>{b.batchName}</option>
                             ))}
                          </Select>
                       </div>
                   </div>
                   <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                      <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                   </div>
                   <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Gender</label>
                         <Select value={formData.gender} onChange={e => setFormData({...formData, gender: e.target.value})}>
                            <option value="">Select</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                         </Select>
                      </div>
                      <div className="space-y-1">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Type</label>
                         <Select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                            <option value="">Select</option>
                            <option value="Day Boarding">Day Boarding</option>
                            <option value="e-Gurukul">e-Gurukul</option>
                            <option value="Hosteller">Hosteller</option>
                         </Select>
                      </div>
                      <div className="space-y-1">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Year</label>
                         <Select value={formData.targetYear} onChange={e => setFormData({...formData, targetYear: e.target.value})}>
                             <option value="">Select</option>
                             <option value="2026">2026</option>
                             <option value="2027">2027</option>
                             <option value="2028">2028</option>
                             <option value="2029">2029</option>
                             <option value="2030">2030</option>
                             <option value="2031">2031</option>
                          </Select>
                      </div>
                   </div>
                   <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Rank Target</label>
                        <Select value={formData.rankTarget} onChange={e => setFormData({...formData, rankTarget: e.target.value})}>
                          <option value="">Select Rank</option>
                          <option value="Under 100">Under 100</option>
                          <option value="Under 200">Under 200</option>
                          <option value="Under 500">Under 500</option>
                          <option value="Under 1000">Under 1000</option>
                          <option value="Under 2000">Under 2000</option>
                          <option value="Above 5000">Above 5000</option>
                        </Select>
                      </div>
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Program</label>
                         <Select value={formData.programId} onChange={e => setFormData({...formData, programId: e.target.value, batchId: ''})}>
                            <option value="">Select</option>
                            {programs.filter(p => p.isActive || p.id === formData.programId).map(p => <option key={p.id} value={p.id}>{p.programName}</option>)}
                         </Select>
                      </div>
                      <div className="space-y-1">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Center</label>
                         <Select value={formData.centerId} onChange={e => setFormData({...formData, centerId: e.target.value, batchId: ''})}>
                            <option value="">Select</option>
                            {centers.filter(c => c.isActive || c.id === formData.centerId).map(c => <option key={c.id} value={c.id}>{c.centerName}</option>)}
                         </Select>
                      </div>
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Phone</label>
                         <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email</label>
                         <Input value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                      </div>
                   </div>
                </div>
                <div className="flex gap-4">
                   <Button variant="secondary" size="lg" className="flex-1" onClick={() => onEdit()}>Cancel</Button>
                   <Button variant="primary" size="lg" className="flex-1 shadow-xl shadow-blue-100" onClick={handleSave} disabled={isSaving}>
                      {isSaving ? 'Saving...' : 'Save Changes'}
                   </Button>
                </div>
             </div>
           ) : (
             <>
               <div className="flex items-center justify-between">
                  <div className="space-y-1">
                     <h2 className="text-3xl font-black text-slate-900 tracking-tight">{student.name}</h2>
                     <div className="flex items-center space-x-3">
                        <Badge variant="blue">{student.regNo}</Badge>
                        <span className="flex items-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
                           <Hash size={14} className="mr-1" /> {student.status || 'ACTIVE'}
                        </span>
                     </div>
                  </div>
                  <div className="flex gap-2">
                     {isAdmin && (
                       <>
                         <Button variant="secondary" size="sm" onClick={onDelete} className="rounded-2xl w-10 h-10 p-0 bg-red-50 hover:bg-red-100 border-none transition-all">
                            <Trash2 size={18} className="text-red-600" />
                         </Button>
                         <Button variant="secondary" size="sm" onClick={onEdit} className="rounded-2xl w-10 h-10 p-0 bg-slate-50">
                            <Edit2 size={18} className="text-blue-600" />
                         </Button>
                       </>
                     )}
                  </div>
               </div>

               <div className="grid grid-cols-1 gap-3">
                  <ProfileItem icon={GraduationCap} label="Program" val={programs.find(p => p.id === student.programId)?.programName || student.programId || 'N/A'} />
                  <ProfileItem icon={MapPin} label="Center" val={centers.find(c => c.id === student.centerId)?.centerName || student.centerId || 'N/A'} />
                  <ProfileItem icon={Hash} label="Batch" val={batches.find(b => b.id === student.batchId)?.batchName || student.batchId || '—'} />
                  <ProfileItem icon={Hash} label="Batch Code" val={student.batchCode || '—'} />
                  <ProfileItem icon={Calendar} label="Target Year" val={student.targetYear || '—'} />
               </div>

               <div className="space-y-4">
                  <h3 className="font-black text-[10px] text-slate-400 uppercase tracking-[0.2em] px-1">Quick Contacts</h3>
                  <div className="flex space-x-2">
                     <ContactBtn icon={Smartphone} label="Call" color="bg-blue-600" />
                     <ContactBtn icon={Mail} label="Email" color="bg-emerald-500" />
                     <ContactBtn icon={Share2} label="Share" color="bg-slate-900" />
                  </div>
               </div>

               <div className="space-y-4">
                  <h3 className="font-black text-[10px] text-slate-400 uppercase tracking-[0.2em] px-1">Academic Tools</h3>
                  <div className="grid grid-cols-2 gap-4">
                     <Card className="p-6 bg-slate-50 border-none flex flex-col items-center justify-center space-y-2 group cursor-pointer active:scale-95 transition-all">
                        <div className="p-3 bg-white rounded-2xl text-blue-600 shadow-sm group-hover:scale-110 transition-transform">
                           <Download size={24} />
                        </div>
                        <span className="text-[10px] font-black text-slate-900 uppercase">Identity Card</span>
                     </Card>
                     <Card className="p-6 bg-slate-50 border-none flex flex-col items-center justify-center space-y-2 group cursor-pointer active:scale-95 transition-all">
                        <div className="p-3 bg-white rounded-2xl text-purple-600 shadow-sm group-hover:scale-110 transition-transform">
                           <FileText size={24} />
                        </div>
                        <span className="text-[10px] font-black text-slate-900 uppercase">Score History</span>
                     </Card>
                  </div>
               </div>
             </>
           )}
        </div>
      </motion.div>
    </div>
  );
}

function ProfileItem({ icon: Icon, label, val }: any) {
  return (
    <div className="flex items-center space-x-4 p-5 bg-[#F8FAFC] rounded-3xl border border-slate-100/50">
       <div className="p-3 bg-white rounded-2xl text-blue-500 shadow-sm">
          <Icon size={20} strokeWidth={2.5} />
       </div>
       <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
          <p className="font-bold text-slate-800 break-all">{val}</p>
       </div>
    </div>
  );
}

function ContactBtn({ icon: Icon, label, color }: any) {
  return (
    <button className={cn("flex-1 py-4 rounded-2xl flex items-center justify-center space-x-2 text-white font-black uppercase tracking-widest text-[9px] shadow-lg active:scale-95 transition-all", color)}>
       <Icon size={14} strokeWidth={3} />
       <span>{label}</span>
    </button>
  );
}

export function BottomSheet({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-0">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        className="relative w-full max-w-lg bg-white rounded-t-[3rem] p-8 pb-32 space-y-6 shadow-2xl overflow-y-auto max-h-[90vh] no-scrollbar pb-safe"
      >
        <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto -mt-2 mb-4" />
        {children}
      </motion.div>
    </div>
  );
}
