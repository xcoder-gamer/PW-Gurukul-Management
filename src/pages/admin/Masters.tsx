import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Button, Input, Select, Badge } from '../../components/UI';
import { 
  Plus, 
  Search, 
  ChevronLeft, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  CheckCircle2, 
  XCircle,
  Save,
  X,
  FileSpreadsheet,
  Download,
  Upload
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import * as XLSX from 'xlsx';
import { addLog, LogAction, LogCategory } from '../../lib/logs';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';
import { 
  collection, 
  addDoc, 
  setDoc,
  getDocs, 
  updateDoc, 
  doc, 
  query, 
  where, 
  orderBy, 
  Timestamp,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';

type MasterType = 'programs' | 'centers' | 'batches' | 'teachers' | 'qbg' | 'mapping' | 'students' | 'user_roles';

export default function Masters() {
  const { user } = useAuth();
  const { type } = useParams<{ type: string }>() as { type: MasterType };
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Form states
  const [formData, setFormData] = useState<any>({});

  const masterConfig = {
    programs: {
      title: 'Academic Programs',
      collection: 'programs',
      fields: [
        { name: 'programName', label: 'Program Name', placeholder: 'e.g. JEE 2024', type: 'text' },
        { name: 'classLevel', label: 'Class/Level', type: 'select', options: ['8th', '9th', '10th', '11th', '12th', 'Dropper'] },
        { name: 'examType', label: 'Exam Type', type: 'select', options: ['JEE', 'NEET', 'FOUNDATION', 'OTHER'] },
        { name: 'isActive', label: 'Active', type: 'checkbox' }
      ]
    },
    centers: {
      title: 'Center Master',
      collection: 'centers',
      fields: [
        { name: 'centerName', label: 'Center Name', placeholder: 'e.g. Noida Sector 15', type: 'text' },
        { name: 'isActive', label: 'Active', type: 'checkbox' }
      ]
    },
    batches: {
      title: 'Batch Master',
      collection: 'batches',
      fields: [
        { name: 'batchName', label: 'Batch Name', placeholder: 'e.g. Alpha-1', type: 'text' },
        { name: 'batchCode', label: 'Batch Code', placeholder: 'e.g. JB-24-A', type: 'text' },
        { name: 'programId', label: 'Program', type: 'db-select', collection: 'programs', displayField: 'programName' },
        { name: 'centerId', label: 'Center', type: 'db-select', collection: 'centers', displayField: 'centerName' },
        { name: 'isActive', label: 'Active', type: 'checkbox' }
      ]
    },
    teachers: {
      title: 'Teacher Master',
      collection: 'teachers',
      fields: [
        { name: 'teacherName', label: 'Full Name', type: 'text' },
        { name: 'email', label: 'Email Address', type: 'email' },
        { name: 'subjects', label: 'Subjects (comma separated)', type: 'text' },
        { name: 'centerId', label: 'Assigned Center', type: 'db-select', collection: 'centers', displayField: 'centerName' },
        { name: 'isActive', label: 'Active', type: 'checkbox' }
      ]
    },
    students: {
      title: 'Student Database',
      collection: 'students',
      fields: [
        { name: 'name', label: 'Full Name', type: 'text' },
        { name: 'regNo', label: 'Registration No', type: 'text' },
        { name: 'batchId', label: 'Batch', type: 'db-select', collection: 'batches', displayField: 'batchName' },
        { name: 'centerId', label: 'Center', type: 'db-select', collection: 'centers', displayField: 'centerName' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'phone', label: 'Phone', type: 'text' },
        { name: 'isActive', label: 'Active', type: 'checkbox' }
      ]
    },
    qbg: {
      title: 'QBG (Hierarchy)',
      collection: 'qbgMaster',
      fields: [
        { name: 'subject', label: 'Subject', type: 'text' },
        { name: 'chapter', label: 'Chapter', type: 'text' },
        { name: 'topic', label: 'Topic', type: 'text' },
        { name: 'difficulty', label: 'Difficulty', type: 'select', options: ['Easy', 'Medium', 'Hard'] }
      ]
    },
    mapping: {
      title: 'Teacher-Batch Mapping',
      collection: 'mappings',
      fields: [
        { name: 'teacherId', label: 'Teacher', type: 'db-select', collection: 'teachers', displayField: 'teacherName' },
        { name: 'batchId', label: 'Batch', type: 'db-select', collection: 'batches', displayField: 'batchName' }
      ]
    },
    attendance: {
      title: 'Attendance Master',
      collection: 'attendance',
      fields: [
        { name: 'studentId', label: 'Student', type: 'db-select', collection: 'students', displayField: 'name' },
        { name: 'batchId', label: 'Batch', type: 'db-select', collection: 'batches', displayField: 'batchName' },
        { name: 'date', label: 'Date (YYYY-MM-DD)', type: 'text' },
        { name: 'status', label: 'Status', type: 'select', options: ['Present', 'Absent'] },
        { name: 'remarks', label: 'Remarks', type: 'text' }
      ]
    },
    user_roles: {
      title: 'User Roles',
      collection: 'user_roles',
      fields: [
        { name: 'email', label: 'User Email', type: 'email' },
        { name: 'role', label: 'Role', type: 'select', options: ['admin', 'central', 'center', 'teacher'] },
        { name: 'centerId', label: 'Assign Center (for Center Level)', type: 'db-select', collection: 'centers', displayField: 'centerName' },
        { name: 'batchIds', label: 'Assign Batches (comma separated for Teacher)', type: 'text', placeholder: 'e.g. BATCH1, BATCH2' },
        { name: 'isActive', label: 'Active', type: 'checkbox' }
      ]
    }
  };

  const config = masterConfig[type];

  // Helper for DB selects
  const [dbOptions, setDbOptions] = useState<Record<string, any[]>>({});

  useEffect(() => {
    fetchItems();
    fetchDbOptions();
  }, [type]);

  const fetchDbOptions = async () => {
    const options: Record<string, any[]> = {};
    for (const field of config.fields) {
      if (field.type === 'db-select' && 'collection' in field && field.collection) {
        const querySnapshot = await getDocs(collection(db, field.collection));
        options[field.collection] = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
    }
    setDbOptions(options);
  };

  const fetchItems = async () => {
    try {
      setLoading(true);
      const querySnapshot = await getDocs(collection(db, config.collection));
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setItems(data);
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    let sampleData: any[] = [];
    if (type === 'user_roles') {
      sampleData = [
        {
          email: 'sample.admin@pw.live',
          role: 'admin',
          centerId: 'All (Leave Blank)',
          batchIds: 'All (Leave Blank)',
          isActive: true
        },
        {
          email: 'kota.center@pw.live',
          role: 'center',
          centerId: 'Kota', // Center Name (importer resolves to ID)
          batchIds: 'All (Leave Blank)',
          isActive: true
        },
        {
          email: 'noida.center@pw.live',
          role: 'center',
          centerId: 'Noida Sect. 15', // Center Name (importer resolves to ID)
          batchIds: 'All (Leave Blank)',
          isActive: true
        },
        {
          email: 'physics.teacher@pw.live',
          role: 'teacher',
          centerId: 'Kota',
          batchIds: 'Alpha-1, Beta-2', // Comma-separated batch names/codes (importer resolves to IDs)
          isActive: true
        }
      ];
    } else {
      const headers = config.fields.map(f => f.name);
      sampleData = [Object.fromEntries(headers.map(h => [h, '']))];
    }
    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `${type}_template.xlsx`);
  };

  const handleExport = () => {
    if (items.length === 0) {
      toast.error('No data to export');
      return;
    }

    const exportData = items.map(item => {
      const row: any = {};
      config.fields.forEach(field => {
        let val = item[field.name];
        if (field.type === 'db-select') {
          const dbField = field as any;
          const collectionName = dbField.collection;
          if (collectionName && dbOptions[collectionName]) {
            const opt = dbOptions[collectionName].find((o: any) => o.id === val);
            if (opt) val = opt[dbField.displayField];
          }
        }
        row[field.label] = val;
      });
      row['Status'] = item.isActive ? 'Active' : 'Inactive';
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, `${type}_export_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success(`Exported ${exportData.length} records`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImporting(true);
      const reader = new FileReader();
      reader.onload = async (event) => {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        
        const colRef = collection(db, config.collection);
        let count = 0;

        // Pre-fetch centers and batches for intelligent text name -> ID resolutions!
        let fetchedCenters: any[] = [];
        let fetchedBatches: any[] = [];
        try {
          const centersSnap = await getDocs(collection(db, 'centers'));
          fetchedCenters = centersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const batchesSnap = await getDocs(collection(db, 'batches'));
          fetchedBatches = batchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (resolveErr) {
          console.warn("Failed fetching metadata for import resolution:", resolveErr);
        }
        
        for (const row of rows) {
          const payload = { ...row };

          // 1. Resolve human-written center name directly to real centerId
          const centerField = row.centerId || row.centerName || row.center || row.Center;
          if (centerField && centerField !== 'All (Leave Blank)') {
            const cleanC = String(centerField).trim().toLowerCase();
            const foundC = fetchedCenters.find(c => 
              c.id.toLowerCase() === cleanC || 
              String(c.centerName || '').trim().toLowerCase() === cleanC
            );
            if (foundC) {
              payload.centerId = foundC.id;
            }
          }

          // 2. Resolve human-written batch code list directly to batchIds list!
          const batchField = row.batchIds || row.batchCode || row.batchName || row.assignedBatches || row.batches || row.batch || row.Batch;
          if (batchField && batchField !== 'All (Leave Blank)') {
            const batchTokens = String(batchField).split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
            const resolvedIds: string[] = [];
            for (const t of batchTokens) {
              const foundB = fetchedBatches.find(b => 
                b.id.toLowerCase() === t ||
                String(b.batchCode || '').trim().toLowerCase() === t ||
                String(b.batchName || '').trim().toLowerCase() === t
              );
              if (foundB) resolvedIds.push(foundB.id);
            }
            if (resolvedIds.length > 0) {
              if (config.collection === 'user_roles') {
                payload.batchIds = resolvedIds;
              } else {
                payload.batchId = resolvedIds[0];
              }
            }
          }

          // 3. Email standardization
          const rawEmail = row.email || row.Email || row.userEmail;
          if (rawEmail) {
            payload.email = String(rawEmail).toLowerCase().trim();
          }

          // 4. Uniform Role normalization
          if (config.collection === 'user_roles') {
            let roleVal = String(row.role || row.Role || 'teacher').toLowerCase().trim();
            if (roleVal === 'center_level' || roleVal === 'center') {
              roleVal = 'center';
            } else if (roleVal === 'central_team' || roleVal === 'operator' || roleVal === 'central') {
              roleVal = 'central';
            }
            payload.role = roleVal;
          }

          payload.isActive = row.isActive ?? true;
          payload.createdAt = Timestamp.now();

          // Write records sequentially with correct Document IDs where expected!
          if (config.collection === 'user_roles' && payload.email) {
            const docId = payload.email;
            await setDoc(doc(db, 'user_roles', docId), payload);
          } else if (config.collection === 'teachers' && payload.email) {
            const docId = payload.email;
            await setDoc(doc(db, 'teachers', docId), payload);
          } else if (config.collection === 'mappings' && payload.teacherId && payload.batchId) {
            const docId = `${payload.teacherId}_${payload.batchId}`;
            await setDoc(doc(db, 'mappings', docId), payload);
          } else {
            if (row.id) {
              await setDoc(doc(db, config.collection, String(row.id)), payload);
            } else {
              await addDoc(colRef, payload);
            }
          }
          count++;
        }
        
        toast.success(`Successfully imported ${count} items!`);
        
        const categoryMapping: Record<string, LogCategory> = {
          programs: LogCategory.PROGRAM,
          centers: LogCategory.CENTER,
          batches: LogCategory.BATCH,
          qbg: LogCategory.QBG,
          students: LogCategory.STUDENT,
          user_roles: LogCategory.AUTH
        };
        
        await addLog({
          userId: user?.uid || 'system',
          userEmail: user?.email || 'unknown',
          action: LogAction.IMPORT,
          category: categoryMapping[type] || LogCategory.AUTH,
          resourceId: 'bulk',
          resourceName: `Bulk ${type} Import`,
          details: `Imported ${count} ${type} records via file upload`,
        });

        setShowImportModal(false);
        fetchItems();
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      console.error(err);
      toast.error('Import failed. Please check your file.');
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const categoryMapping: Record<string, LogCategory> = {
        programs: LogCategory.PROGRAM,
        centers: LogCategory.CENTER,
        batches: LogCategory.BATCH,
        qbg: LogCategory.QBG,
        students: LogCategory.STUDENT
      };
      const category = categoryMapping[type] || LogCategory.AUTH;

      if (editingItem) {
        await updateDoc(doc(db, config.collection, editingItem.id), {
          ...formData,
          updatedAt: Timestamp.now()
        });

        await addLog({
          userId: user?.uid || 'system',
          userEmail: user?.email || 'unknown',
          action: LogAction.UPDATE,
          category,
          resourceId: editingItem.id,
          resourceName: formData.programName || formData.centerName || formData.batchName || formData.name || type,
          details: `Updated ${type} record: ${editingItem.id}`,
          previousData: editingItem,
          newData: formData
        });
      } else {
        let docRef;
        if ((config.collection === 'user_roles' || config.collection === 'teachers') && formData.email) {
          // Use email as ID for user_roles and teachers to make security rules lookup easier
          const docId = formData.email.toLowerCase().trim();
          const targetColl = config.collection;
          await setDoc(doc(db, targetColl, docId), {
            ...formData,
            isActive: formData.isActive ?? true,
            createdAt: Timestamp.now()
          });
          docRef = { id: docId };
        } else if (config.collection === 'mappings' && formData.teacherId && formData.batchId) {
          // Use teacherId_batchId as ID for mappings
          const docId = `${formData.teacherId}_${formData.batchId}`;
          await setDoc(doc(db, 'mappings', docId), {
            ...formData,
            createdAt: Timestamp.now()
          });
          docRef = { id: docId };
        } else {
          docRef = await addDoc(collection(db, config.collection), {
            ...formData,
            isActive: formData.isActive ?? true,
            createdAt: Timestamp.now()
          });
        }

        await addLog({
          userId: user?.uid || 'system',
          userEmail: user?.email || 'unknown',
          action: LogAction.CREATE,
          category,
          resourceId: docRef.id,
          resourceName: formData.programName || formData.centerName || formData.batchName || formData.name || type,
          details: `Created new ${type} record`,
          newData: formData
        });
      }
      setShowAddModal(false);
      setEditingItem(null);
      setFormData({});
      toast.success('Record saved successfully');
      fetchItems();
    } catch (error: any) {
      console.error('Error saving item:', error);
      toast.error(error.message || 'Failed to save record. Check permissions.');
    }
  };

  const toggleStatus = async (item: any) => {
    const newStatus = !item.isActive;
    try {
      await updateDoc(doc(db, config.collection, item.id), { 
        isActive: newStatus,
        updatedAt: Timestamp.now()
      });
      
      const categoryMapping: Record<string, LogCategory> = {
        programs: LogCategory.PROGRAM,
        centers: LogCategory.CENTER,
        batches: LogCategory.BATCH,
        qbg: LogCategory.QBG,
        students: LogCategory.STUDENT
      };
      
      await addLog({
        userId: user?.uid || 'system',
        userEmail: user?.email || 'unknown',
        action: LogAction.UPDATE,
        category: categoryMapping[type] || LogCategory.AUTH,
        resourceId: item.id,
        resourceName: item.programName || item.centerName || item.batchName || item.name || type,
        details: `${newStatus ? 'Activated' : 'Inactivated'} ${type} record: ${item.id}`,
      });

      toast.success(`Record ${newStatus ? 'activated' : 'inactivated'} successfully`);
      fetchItems();
    } catch (error) {
      console.error('Error toggling status:', error);
      toast.error('Failed to update status');
    }
  };

  const hardDeleteItem = async (id: string) => {
    if (!window.confirm('CRITICAL: This will PERMANENTLY delete this record from the database. This CANNOT be undone. Are you sure?')) return;
    try {
      await deleteDoc(doc(db, config.collection, id));
      
      toast.success('Record permanently deleted');
      fetchItems();
    } catch (error) {
      console.error('Error deleting item:', error);
      toast.error('Failed to delete record');
      handleFirestoreError(error, OperationType.DELETE, `${config.collection}/${id}`);
    }
  };

  const startEdit = (item: any) => {
    setEditingItem(item);
    setFormData(item);
    setShowAddModal(true);
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredItems.map(i => i.id));
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Are you sure you want to PERMANENTLY delete ${selectedIds.length} records? This action cannot be undone.`)) return;
    
    setLoading(true);
    const toastId = toast.loading(`Deleting ${selectedIds.length} records...`);
    try {
      const chunks = [];
      const CHUNK_SIZE = 15; // smaller chunk size for parallel deletion requests to prevent hitting rate limits
      for (let i = 0; i < selectedIds.length; i += CHUNK_SIZE) {
        chunks.push(selectedIds.slice(i, i + CHUNK_SIZE));
      }

      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(id => deleteDoc(doc(db, config.collection, id)))
        );
      }

      const categoryMapping: Record<string, LogCategory> = {
        programs: LogCategory.PROGRAM,
        centers: LogCategory.CENTER,
        batches: LogCategory.BATCH,
        qbg: LogCategory.QBG,
        students: LogCategory.STUDENT
      };

      await addLog({
        userId: user?.uid || 'system',
        userEmail: user?.email || 'unknown',
        action: LogAction.DELETE,
        category: categoryMapping[type] || LogCategory.AUTH,
        resourceId: 'bulk',
        resourceName: 'Bulk Delete',
        details: `Permanently deleted ${selectedIds.length} records from ${type} master`,
      });

      toast.success(`${selectedIds.length} records deleted`, { id: toastId });
      setSelectedIds([]);
      fetchItems();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Bulk deletion failed', { id: toastId });
      handleFirestoreError(err, OperationType.DELETE, `${config.collection}_bulk`);
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items.filter(item => 
    Object.values(item).some(val => 
      String(val).toLowerCase().includes(search.toLowerCase())
    )
  );

  return (
    <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
      <header className="flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="secondary" size="sm" onClick={() => navigate('/more')} className="bg-white p-2 h-auto rounded-xl">
               <ChevronLeft size={20} />
            </Button>
            <h1 className="text-2xl font-black text-slate-900">{config.title}</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} className="p-2 h-auto rounded-xl border-emerald-100 text-emerald-600" title="Export Current Data">
               <FileSpreadsheet size={18} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowImportModal(true)} className="p-2 h-auto rounded-xl border-blue-100 text-blue-600" title="Bulk Import">
               <Upload size={18} />
            </Button>
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="p-2 h-auto rounded-xl border-slate-100 text-slate-400" title="Download Template">
               <Download size={18} />
            </Button>
          </div>
        </div>

        <div className="flex space-x-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <Input 
              placeholder="Search..." 
              className="pl-12 py-3" 
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button 
                variant="outline"
                className={cn("px-3 border-slate-100", selectedIds.length === filteredItems.length && filteredItems.length > 0 && "bg-blue-50 border-blue-200")}
                onClick={toggleSelectAll}
                title="Select All"
            >
                <div className={cn(
                    "w-5 h-5 rounded border-2 transition-colors flex items-center justify-center",
                    selectedIds.length === filteredItems.length && filteredItems.length > 0 ? "bg-blue-600 border-blue-600" : "bg-white border-slate-200"
                )}>
                    {selectedIds.length === filteredItems.length && filteredItems.length > 0 && <CheckCircle2 size={12} className="text-white" />}
                </div>
            </Button>
            <Button onClick={() => { setEditingItem(null); setFormData({}); setShowAddModal(true); }} className="px-5">
                <Plus size={20} />
            </Button>
          </div>
        </div>
      </header>

      <div className="space-y-3">
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-12 text-center space-y-4">
             <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                <Search size={32} className="text-slate-200" />
             </div>
             <p className="text-slate-400 font-bold">No items found</p>
          </div>
        ) : (
          filteredItems.map((item) => (
            <Card 
              key={item.id} 
              className={cn(
                "p-4 flex items-center group cursor-pointer hover:border-blue-200 active:scale-[0.99] transition-all relative overflow-hidden",
                selectedIds.includes(item.id) ? "bg-blue-50/50 border-blue-200" : ""
              )}
              onClick={() => startEdit(item)}
            >
              <div 
                className="mr-4 shrink-0 flex items-center justify-center"
                onClick={(e) => toggleSelect(item.id, e)}
              >
                <div className={cn(
                    "w-6 h-6 rounded-lg border-2 transition-all flex items-center justify-center shadow-sm",
                    selectedIds.includes(item.id) 
                        ? "bg-blue-600 border-blue-600 scale-110" 
                        : "bg-white border-slate-100 group-hover:border-blue-200"
                )}>
                    {selectedIds.includes(item.id) && <CheckCircle2 size={14} className="text-white" />}
                </div>
              </div>

              <div className="space-y-1 flex-1">
                <p className="font-black text-slate-800 break-all">
                  {type === 'user_roles' ? item.email : (item.programName || item.centerName || item.batchName || item.teacherName || item.name || item.subject || 'Item')}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={item.isActive ? 'green' : 'slate'}>
                    {item.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {type === 'user_roles' && item.role && (
                    <Badge variant={
                      item.role === 'admin' ? 'blue' :
                      item.role === 'central' ? 'amber' :
                      item.role === 'center' ? 'green' : 'slate'
                    }>
                      {item.role}
                    </Badge>
                  )}
                  {type === 'user_roles' && item.centerId && (
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">
                      Center: {item.centerId === 'all' ? 'All' : item.centerId}
                    </span>
                  )}
                  {type === 'user_roles' && item.batchIds && item.role === 'teacher' && (
                    <span className="text-[10px] font-bold text-emerald-605 bg-emerald-50 px-2 py-0.5 rounded-lg max-w-[12rem] truncate">
                      Batches: {item.batchIds === 'all' ? 'All' : item.batchIds}
                    </span>
                  )}
                  {item.regNo && <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{item.regNo}</span>}
                  {item.classLevel && <Badge variant="blue">{item.classLevel}</Badge>}
                  {item.examType && <Badge variant="slate">{item.examType}</Badge>}
                </div>
              </div>
              <div className="flex space-x-2 shrink-0">
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={(e) => { e.stopPropagation(); startEdit(item); }} 
                  className="w-10 h-10 p-0 rounded-2xl bg-blue-50 text-blue-600"
                  title="Edit"
                >
                  <Edit2 size={18} />
                </Button>
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={(e) => { e.stopPropagation(); toggleStatus(item); }} 
                  className={cn(
                    "w-10 h-10 p-0 rounded-2xl transition-all",
                    item.isActive ? "bg-amber-50 text-amber-500" : "bg-emerald-50 text-emerald-500"
                  )}
                  title={item.isActive ? "Deactivate" : "Activate"}
                >
                  {item.isActive ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
                </Button>
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={(e) => { e.stopPropagation(); hardDeleteItem(item.id); }} 
                  className="w-10 h-10 p-0 rounded-2xl bg-rose-50 text-rose-500"
                  title="Delete Permanently"
                >
                  <Trash2 size={18} />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-slate-900 text-white rounded-2xl px-6 py-3 shadow-2xl flex items-center gap-6 border border-white/10 backdrop-blur-md"
          >
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center font-black text-xs">
                {selectedIds.length}
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Selected</p>
            </div>
            
            <div className="h-6 w-px bg-white/10" />
            
            <button 
              onClick={handleBulkDelete}
              className="flex items-center gap-2 hover:text-red-400 transition-all font-black text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-lg hover:bg-white/5 active:scale-95"
            >
              <Trash2 size={14} />
              Delete All
            </button>

            <button 
              onClick={() => setSelectedIds([])}
              className="p-1 hover:bg-white/10 rounded-full transition-colors"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-lg bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 space-y-6 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-black text-slate-900">
                    {editingItem ? 'Edit' : 'Add New'} {type.slice(0, -1)}
                  </h2>
                  {editingItem && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        hardDeleteItem(editingItem.id);
                        setShowAddModal(false);
                      }}
                      className="border-rose-100 text-rose-500 hover:bg-rose-50 h-8 w-8 p-0"
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
                <Button variant="secondary" size="sm" onClick={() => setShowAddModal(false)} className="p-2 h-auto rounded-full bg-slate-50">
                  <X size={20} />
                </Button>
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                {type === 'user_roles' ? (
                  <UserRolesFormFields 
                    formData={formData} 
                    setFormData={setFormData} 
                    dbOptions={dbOptions} 
                  />
                ) : (
                  config.fields.map((field) => (
                    <div key={field.name} className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">
                        {field.label}
                      </label>
                      
                      {field.type === 'select' ? (
                        <Select 
                          value={formData[field.name] || ''} 
                          onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                          required
                        >
                          <option value="">Select Option</option>
                          {(field as any).options?.map((opt: any) => <option key={opt} value={opt}>{opt}</option>)}
                        </Select>
                      ) : field.type === 'db-select' ? (
                        <Select 
                          value={formData[field.name] || ''} 
                          onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                          required
                        >
                          <option value="">Select From DB</option>
                          {dbOptions[(field as any).collection]?.filter(opt => opt.isActive || opt.id === formData[field.name]).map(opt => (
                            <option key={opt.id} value={opt.id}>{opt[(field as any).displayField]}</option>
                          ))}
                        </Select>
                      ) : field.type === 'checkbox' ? (
                        <div className="flex items-center space-x-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <input 
                            type="checkbox" 
                            className="w-6 h-6 rounded-lg text-blue-600 focus:ring-blue-500 border-slate-200"
                            checked={formData[field.name] ?? true}
                            onChange={e => setFormData({ ...formData, [field.name]: e.target.checked })}
                          />
                          <span className="font-bold text-slate-700">Set as Active</span>
                        </div>
                      ) : (
                        <Input 
                          placeholder={(field as any).placeholder || field.label} 
                          type={field.type}
                          value={formData[field.name] || ''}
                          onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                          required
                        />
                      )}
                    </div>
                  ))
                )}

                <div className="pt-4 flex space-x-3">
                  <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-[2] space-x-2">
                    <Save size={20} />
                    <span>{editingItem ? 'Update changes' : 'Save & create'}</span>
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {showImportModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !importing && setShowImportModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-sm bg-white rounded-[2.5rem] p-8 space-y-6 shadow-2xl"
            >
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                  <FileSpreadsheet size={32} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-black text-slate-900">Bulk Import</h3>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest leading-none">Excel or CSV Only</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <input 
                    type="file" 
                    accept=".xlsx,.xls,.csv" 
                    className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                    onChange={handleImport}
                    disabled={importing}
                  />
                  <Button variant="primary" className="w-full py-4 space-x-2 shadow-lg shadow-blue-100">
                    <Upload size={18} />
                    <span>{importing ? 'Processing...' : 'Select File'}</span>
                  </Button>
                </div>
                <Button variant="ghost" onClick={downloadTemplate} className="w-full text-[10px] font-black underline text-slate-400 uppercase tracking-widest">
                  Download Sample Template
                </Button>
              </div>

              <Button variant="secondary" onClick={() => setShowImportModal(false)} className="w-full" disabled={importing}>
                Cancel
              </Button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserRolesFormFields({ formData, setFormData, dbOptions }: { formData: any; setFormData: any; dbOptions: any }) {
  const centers = dbOptions['centers'] || [];
  const batches = dbOptions['batches'] || [];

  const handleRoleChange = (role: string) => {
    if (role === 'admin' || role === 'central') {
      setFormData({
        ...formData,
        role,
        centerId: 'all',
        batchIds: 'all'
      });
    } else if (role === 'center') {
      setFormData({
        ...formData,
        role,
        centerId: '',
        batchIds: 'all' // Center level users have batch assignment "all" by default
      });
    } else {
      setFormData({
        ...formData,
        role,
        centerId: '',
        batchIds: ''
      });
    }
  };

  const handleCenterToggle = (centerIdVal: string) => {
    if (centerIdVal === 'all') {
      setFormData({
        ...formData,
        centerId: 'all'
      });
      return;
    }

    const currentCenters = formData.centerId || '';
    if (currentCenters === 'all') {
      setFormData({
        ...formData,
        centerId: centerIdVal
      });
      return;
    }

    const list = currentCenters.split(',').map((s: string) => s.trim()).filter(Boolean);
    let newList;
    if (list.includes(centerIdVal)) {
      newList = list.filter((id: string) => id !== centerIdVal);
    } else {
      newList = [...list, centerIdVal];
    }
    setFormData({
      ...formData,
      centerId: newList.join(',')
    });
  };

  const handleBatchToggle = (batchIdVal: string) => {
    const currentBatches = formData.batchIds || '';
    if (currentBatches === 'all') {
      setFormData({
        ...formData,
        batchIds: batchIdVal
      });
      return;
    }

    const list = typeof currentBatches === 'string'
      ? currentBatches.split(',').map((s: string) => s.trim()).filter(Boolean)
      : Array.isArray(currentBatches) ? currentBatches : [];
    
    let newList;
    if (list.includes(batchIdVal)) {
      newList = list.filter(id => id !== batchIdVal);
    } else {
      newList = [...list, batchIdVal];
    }
    setFormData({
      ...formData,
      batchIds: newList.join(',')
    });
  };

  const selectedCenterList = formData.centerId === 'all' 
    ? ['all'] 
    : (formData.centerId || '').split(',').map((s: string) => s.trim()).filter(Boolean);

  const selectedBatchList = formData.batchIds === 'all'
    ? ['all']
    : (formData.batchIds || '').split(',').map((s: string) => s.trim()).filter(Boolean);

  return (
    <div className="space-y-4 text-left">
      {/* User Email */}
      <div className="space-y-1">
        <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">
          User Email
        </label>
        <Input 
          type="email"
          placeholder="e.g. staff.member@pw.live"
          value={formData.email || ''}
          onChange={e => setFormData({ ...formData, email: e.target.value })}
          required
        />
      </div>

      {/* Role */}
      <div className="space-y-1">
        <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">
          Role
        </label>
        <Select 
          value={formData.role || ''} 
          onChange={e => handleRoleChange(e.target.value)}
          required
        >
          <option value="">Select Role Option</option>
          <option value="admin">admin</option>
          <option value="central">central</option>
          <option value="center">center</option>
          <option value="teacher">teacher</option>
        </Select>
      </div>

      {/* Dynamic Display for Admin/Central */}
      {(formData.role === 'admin' || formData.role === 'central') && (
        <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-2xl space-y-2">
          <p className="text-xs font-bold text-emerald-800 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Complete Access Enabled
          </p>
          <p className="text-[11px] text-emerald-600/80 leading-normal">
            Admin & Central users automatically have access to <strong>all centers</strong> and <strong>all batches</strong>. No Selective assignment is required.
          </p>
        </div>
      )}

      {/* Assign Center - Shown for Center level user or Teacher */}
      {(formData.role === 'center' || formData.role === 'teacher') && (
        <div className="space-y-2">
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1 flex justify-between items-center">
            <span>Assign Centers</span>
            <span className="text-[10px] text-slate-400 font-bold lowercase">
              {formData.role === 'center' ? '(supports multiple / all selection)' : '(single center selection)'}
            </span>
          </label>
          
          <div className="border border-slate-100 rounded-2xl bg-slate-50/50 p-2.5 max-h-48 overflow-y-auto space-y-1.5 list-none">
            {/* "All Centers" button/checkbox option (Shown only if role is 'center') */}
            {formData.role === 'center' && (
              <div 
                onClick={() => handleCenterToggle('all')}
                className={cn(
                  "flex items-center justify-between p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all",
                  selectedCenterList.includes('all') 
                    ? "bg-blue-50 border-blue-200 text-blue-700 shadow-sm" 
                    : "bg-white border-slate-100 text-slate-600 hover:border-slate-200"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px]",
                    selectedCenterList.includes('all') ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 bg-white"
                  )}>
                    {selectedCenterList.includes('all') && "✓"}
                  </div>
                  <span>All Centers (Universal Access)</span>
                </div>
                <Badge variant="blue">all</Badge>
              </div>
            )}

            {/* Individual Centers */}
            {centers.map((c: any) => {
              const isSelected = selectedCenterList.includes(c.id) || selectedCenterList.includes('all');
              const isClickable = !selectedCenterList.includes('all') || formData.role === 'teacher';
              return (
                <div 
                  key={c.id}
                  onClick={() => {
                    if (formData.role === 'teacher') {
                      setFormData({
                        ...formData,
                        centerId: c.id
                      });
                    } else if (isClickable) {
                      handleCenterToggle(c.id);
                    }
                  }}
                  className={cn(
                    "flex items-center justify-between p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all",
                    selectedCenterList.includes('all') && formData.role === 'center'
                      ? "bg-blue-50/40 border-blue-100/40 text-blue-400 cursor-not-allowed"
                      : isSelected && (formData.role === 'teacher' ? formData.centerId === c.id : true)
                        ? "bg-blue-50 border-blue-200 text-blue-700 shadow-sm"
                        : "bg-white border-slate-100 text-slate-600 hover:border-slate-200"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px]",
                      isSelected && (formData.role === 'teacher' ? formData.centerId === c.id : true) ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 bg-white"
                    )}>
                      {isSelected && (formData.role === 'teacher' ? formData.centerId === c.id : true) && "✓"}
                    </div>
                    <span>{c.centerName}</span>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400">ID: {c.id.slice(-6)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Assign Batches - Shown for Teacher */}
      {formData.role === 'teacher' && (
        <div className="space-y-2">
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">
            Assign Batches
          </label>
          <div className="border border-slate-100 rounded-2xl bg-slate-50/50 p-2.5 max-h-48 overflow-y-auto space-y-1.5 list-none">
            
            {/* "All Batches" option */}
            <div 
              onClick={() => handleBatchToggle('all')}
              className={cn(
                "flex items-center justify-between p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all",
                selectedBatchList.includes('all') 
                  ? "bg-blue-50 border-blue-200 text-blue-700 shadow-sm" 
                  : "bg-white border-slate-100 text-slate-600 hover:border-slate-200"
              )}
            >
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px]",
                  selectedBatchList.includes('all') ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 bg-white"
                )}>
                  {selectedBatchList.includes('all') && "✓"}
                </div>
                <span>All Batches (Full Classes)</span>
              </div>
              <Badge variant="blue">all</Badge>
            </div>

            {/* Individual active batches */}
            {batches
              .filter((b: any) => !formData.centerId || b.centerId === formData.centerId)
              .map((b: any) => {
                const isSelected = selectedBatchList.includes(b.id) || selectedBatchList.includes('all');
                const isClickable = !selectedBatchList.includes('all');
                return (
                  <div 
                    key={b.id}
                    onClick={() => isClickable && handleBatchToggle(b.id)}
                    className={cn(
                      "flex items-center justify-between p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all",
                      selectedBatchList.includes('all')
                        ? "bg-blue-50/40 border-blue-100/40 text-blue-400 cursor-not-allowed"
                        : isSelected
                          ? "bg-blue-50 border-blue-200 text-blue-700 shadow-sm"
                          : "bg-white border-slate-100 text-slate-600 hover:border-slate-200"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px]",
                        isSelected ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 bg-white"
                      )}>
                        {isSelected && "✓"}
                      </div>
                      <span>{b.batchName}</span>
                    </div>
                    <Badge variant="slate">{b.batchCode}</Badge>
                  </div>
                );
            })}
          </div>
        </div>
      )}

      {/* Set Active Status */}
      <div className="flex items-center space-x-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
        <input 
          type="checkbox" 
          className="w-6 h-6 rounded-lg text-blue-600 focus:ring-blue-500 border-slate-200"
          checked={formData.isActive ?? true}
          onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
        />
        <span className="font-bold text-slate-700 text-sm">Set as Active</span>
      </div>
    </div>
  );
}
