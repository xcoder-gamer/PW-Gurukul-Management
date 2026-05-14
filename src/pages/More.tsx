import React, { useState } from 'react';
import { Card, Button } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { collection, addDoc, Timestamp, getDocs, query, limit } from 'firebase/firestore';
import { 
  LogOut, 
  User, 
  Settings, 
  Shield, 
  HelpCircle, 
  ChevronRight, 
  Bell, 
  Layers, 
  MapPin, 
  Users, 
  BookOpen, 
  GraduationCap,
  Link as LinkIcon,
  Database,
  RefreshCw,
  CheckCircle2,
  FileSpreadsheet,
  Download,
  FileJson,
  FileText,
  Target
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';

export default function More() {
  const { user, role, logout } = useAuth();
  const navigate = useNavigate();
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);

  const isAdmin = role === 'admin' || role === 'operator' || role === 'central_team';

  const downloadStudentTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { 
        regNo: 'PW24001', 
        name: 'Student Name', 
        gender: 'Male',
        program: 'JEE Main',
        center: 'Kota Main',
        batch: 'Evening Batch',
        batchCode: 'JB-24-A',
        type: 'Hosteller',
        targetYear: '2025',
        rankTarget: 'Under 500',
        phone: '9876543210', 
        email: 'student@example.com' 
      }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "Students_Import_Template.xlsx");
  };

  const downloadAnswerKeyTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { Question: 1, Answer: 'A', 'correct answer': 4, 'wrong answer': -1, 'unattempt': 0, 'Partial Correct': 1 },
      { Question: 2, Answer: 'B', 'correct answer': 4, 'wrong answer': -1, 'unattempt': 0, 'Partial Correct': 2 }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "AnswerKey_Template.xlsx");
  };

  const downloadResponsesTemplate = () => {
    // Horizontal Template
    const templateData = [
      { regNo: 'PW24101', studentName: 'Aditya Vardhan', '1': 'A', '2': 'B', '3': 'C', '4': 'D' },
      { regNo: 'PW24102', studentName: 'Isha Mehra', '1': 'B', '2': 'C', '3': 'A', '4': 'D' }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Responses");
    XLSX.writeFile(wb, "StudentResponses_Template.xlsx");
  };

  const seedData = async () => {
    setIsSeeding(true);
    setSeedStatus('Seeding Masters...');
    try {
      // 1. Programs
      const programRefs: any[] = [];
      const programs = [
        { programName: 'JEE Advanced', programDescription: 'Target IIT 2025' },
        { programName: 'NEET UG', programDescription: 'Medical entrance focus' },
        { programName: 'Foundation (IX-X)', programDescription: 'Early conceptual building' }
      ];
      
      for (const p of programs) {
        const ref = await addDoc(collection(db, 'programs'), { ...p, createdAt: Timestamp.now() });
        programRefs.push({ id: ref.id, ...p });
      }

      // 2. Centers
      setSeedStatus('Seeding Centers...');
      const centerRefs: any[] = [];
      const centers = [
        { centerName: 'Kota Main', centerLocation: 'Indraprastha Ind. Area' },
        { centerName: 'Patna Center', centerLocation: 'Boring Road' },
        { centerName: 'Delhi North', centerLocation: 'Janakpuri' }
      ];
      
      for (const c of centers) {
        const ref = await addDoc(collection(db, 'centers'), { ...c, createdAt: Timestamp.now() });
        centerRefs.push({ id: ref.id, ...c });
      }

      // 3. Batches
      setSeedStatus('Seeding Batches...');
      const batchRefs: any[] = [];
      for (let i = 0; i < 4; i++) {
        const p = programRefs[i % programRefs.length];
        const c = centerRefs[i % centerRefs.length];
        const batch = {
          batchName: `${p.programName} - Batch ${String.fromCharCode(65 + i)}`,
          programId: p.id,
          centerId: c.id,
          isActive: true,
          createdAt: Timestamp.now()
        };
        const ref = await addDoc(collection(db, 'batches'), batch);
        batchRefs.push({ id: ref.id, ...batch });
      }

      // 4. Teachers
      setSeedStatus('Seeding Teachers...');
      const teachersData = [
        { name: 'Dr. R.K. Verma', subject: 'Physics', email: 'rk.verma@example.com' },
        { name: 'Prof. S. Gupta', subject: 'Chemistry', email: 's.gupta@example.com' },
        { name: 'Amit Sharma', subject: 'Mathematics', email: 'amit.maths@example.com' }
      ];
      for (const t of teachersData) {
        await addDoc(collection(db, 'teachers'), {
          ...t,
          isActive: true,
          createdAt: Timestamp.now()
        });
      }

      // 5. QBG Master
      setSeedStatus('Seeding Question Bank...');
      const subjects = [
        { subject: 'Physics', chapters: ['Kinematics', 'Electromagnetism', 'Optics'] },
        { subject: 'Chemistry', chapters: ['Organic Synthesis', 'Thermodynamics', 'Atomic Structure'] },
        { subject: 'Mathematics', chapters: ['Calculus', 'Complex Numbers', 'Coordinate Geometry'] }
      ];
      const qbgEntries: any[] = [];
      for (const sub of subjects) {
        for (const chap of sub.chapters) {
          const ref = await addDoc(collection(db, 'qbgMaster'), {
            subject: sub.subject,
            chapter: chap,
            createdAt: Timestamp.now()
          });
          qbgEntries.push({ id: ref.id, subject: sub.subject, chapter: chap });
        }
      }

      // 6. Students
      setSeedStatus('Seeding Students...');
      const studentsData = [
        { name: 'Aditya Vardhan', regNo: 'PW24101', email: 'aditya@example.com' },
        { name: 'Isha Mehra', regNo: 'PW24102', email: 'isha@example.com' },
        { name: 'Sameer Sen', regNo: 'PW24103', email: 'sameer@example.com' },
        { name: 'Priya Das', regNo: 'PW24104', email: 'priya@example.com' },
        { name: 'Arjun Gupta', regNo: 'PW24105', email: 'arjun@example.com' },
      ];

      const studentRefs: any[] = [];
      for (let i = 0; i < studentsData.length; i++) {
        const b = batchRefs[i % batchRefs.length];
        const s = {
          ...studentsData[i],
          batchId: b.id,
          programId: b.programId,
          centerId: b.centerId,
          status: 'active',
          createdAt: Timestamp.now()
        };
        const ref = await addDoc(collection(db, 'students'), s);
        studentRefs.push({ id: ref.id, ...s });
      }

      // 7. Tests
      setSeedStatus('Seeding Tests...');
      const testName = 'Phase 1 - JEE Mock 01';
      const answerKey: any = {};
      const numQuestions = 75; // 75 questions * 4 marks = 300 marks
      for (let i = 1; i <= numQuestions; i++) {
        const qbgIdx = (i - 1) % qbgEntries.length;
        const qbg = qbgEntries[qbgIdx];
        answerKey[i] = { 
          ans: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)], 
          type: 'SCQ', 
          correct: 4, 
          wrong: -1,
          qbgId: qbg.id,
          subject: qbg.subject,
          chapter: qbg.chapter
        };
      }

      const testData = {
        name: testName,
        date: new Date().toISOString().split('T')[0],
        batchIds: batchRefs.map(b => b.id),
        totalQuestions: numQuestions,
        maxScore: numQuestions * 4,
        answerKey,
        answerKeyVersion: 1,
        isActive: true,
        createdAt: Timestamp.now()
      };
      const testRef = await addDoc(collection(db, 'tests'), testData);

      // 8. Results
      setSeedStatus('Generating Results...');
      for (const student of studentRefs) {
        const correct = 40 + Math.floor(Math.random() * 20); // Random performance
        const wrong = 15;
        const score = (correct * 4) + (wrong * -1);
        const accuracy = (correct / (correct + wrong)) * 100;
        
        // Calculate chapter-wise stats for analytics
        const chapterStats: any = {};
        const responsesJson: any = {};
        Object.entries(answerKey).forEach(([qNum, qData]: [string, any]) => {
          const chapName = qData.chapter;
          if (!chapterStats[chapName]) {
            chapterStats[chapName] = { 
              total: 0, 
              correct: 0, 
              wrong: 0, 
              score: 0,
              subject: qData.subject 
            };
          }
          chapterStats[chapName].total++;
          
          // Weighted random performance per chapter
          if (Math.random() > 0.4) {
             chapterStats[chapName].correct++;
             chapterStats[chapName].score += 4;
             responsesJson[qNum] = qData.ans;
          } else {
             chapterStats[chapName].wrong++;
             chapterStats[chapName].score -= 1;
             responsesJson[qNum] = ['A', 'B', 'C', 'D'].find(a => a !== qData.ans);
          }
        });

        await addDoc(collection(db, 'result_updated'), {
          testId: testRef.id,
          testName: testName,
          testDate: testData.date,
          regNo: student.regNo,
          studentName: student.name,
          batchId: student.batchId,
          score,
          correct,
          wrong,
          blank: numQuestions - (correct + wrong),
          partial: 0,
          accuracy,
          chapterStats,
          responsesJson,
          evaluatedAt: Timestamp.now()
        });
      }

      setSeedStatus('Success!');
      setTimeout(() => setSeedStatus(null), 3000);
    } catch (err) {
      console.error(err);
      setSeedStatus('Failed!');
    } finally {
      setIsSeeding(false);
    }
  };

  const mastesItems = [
    { label: 'Academic Programs', icon: GraduationCap, color: 'text-indigo-600', path: '/masters/programs', desc: 'Manage 8th-12th, JEE/NEET' },
    { label: 'Staff Roles', icon: Shield, color: 'text-rose-600', path: '/masters/user_roles', desc: 'Manage admin & teacher permissions' },
    { label: 'Centers', icon: MapPin, color: 'text-rose-600', path: '/masters/centers', desc: 'Location management' },
    { label: 'Batches', icon: Layers, color: 'text-amber-600', path: '/masters/batches', desc: 'Group students by program/center' },
    { label: 'Teachers', icon: Users, color: 'text-blue-600', path: '/masters/teachers', desc: 'Faculty profiles' },
    { label: 'QBG (Hierarchy)', icon: Database, color: 'text-emerald-600', path: '/masters/qbg', desc: 'Subjects & Topics' },
    { label: 'Test Patterns', icon: Target, color: 'text-indigo-600', path: '/masters/patterns', desc: 'Manage exam scoring schemes' },
    { label: 'Teacher-Batch Mapping', icon: LinkIcon, color: 'text-violet-600', path: '/masters/mapping', desc: 'Assign batches to teachers' },
  ];

  const secondaryItems = [
    { label: 'Profile Settings', icon: User, color: 'text-slate-500' },
    { label: 'Notifications', icon: Bell, color: 'text-orange-500' },
    { label: 'System Configuration', icon: Settings, color: 'text-slate-400' },
    { label: 'Help & Support', icon: HelpCircle, color: 'text-teal-500' },
  ];

  return (
    <div className="p-4 space-y-8 max-w-lg mx-auto pb-32">
      <header className="flex flex-col items-center text-center space-y-4 pt-6">
        <div className="w-28 h-28 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-[2.5rem] flex items-center justify-center text-white text-5xl font-black shadow-2xl shadow-blue-100 relative group transition-transform hover:scale-105">
          {user?.displayName?.charAt(0) || 'U'}
          <div className="absolute -bottom-1 -right-1 w-10 h-10 bg-white rounded-2xl flex items-center justify-center shadow-lg border border-slate-100">
            <Shield size={20} className="text-blue-600" />
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">{user?.displayName || 'PW User'}</h1>
          <p className="text-blue-600 font-black text-[10px] uppercase tracking-[0.2em] bg-blue-50 px-4 py-1.5 rounded-xl inline-block mt-2">{role} Access</p>
          <p className="text-slate-400 text-xs mt-2 font-medium">{user?.email}</p>
        </div>
      </header>

      {isAdmin && (
        <section className="space-y-4">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] px-2">Master Management</h2>
          <div className="grid grid-cols-1 gap-3">
            {mastesItems.map((item) => (
              <Card 
                key={item.label} 
                className="flex items-center justify-between p-5 hover:bg-white active:scale-[0.98] transition-all group cursor-pointer"
                onClick={() => navigate(item.path)}
              >
                <div className="flex items-center space-x-4">
                  <div className={cn("p-3 rounded-2xl bg-slate-50 transition-colors group-hover:bg-white", item.color)}>
                    <item.icon size={22} strokeWidth={2.5} />
                  </div>
                  <div>
                    <span className="font-black text-slate-800 tracking-tight block">{item.label}</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{item.desc}</span>
                  </div>
                </div>
                <div className="p-2 bg-slate-50 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
                   <ChevronRight size={18} strokeWidth={3} />
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] px-2">Templates & Resources</h2>
        <div className="grid grid-cols-1 gap-3">
          <TemplateDownloadCard 
            title="Student Master Template" 
            desc="For bulk student registration" 
            icon={Users} 
            color="text-blue-600"
            onClick={downloadStudentTemplate}
          />
          <TemplateDownloadCard 
            title="Test Answer Key" 
            desc="For creating new test keys" 
            icon={FileJson} 
            color="text-emerald-600"
            onClick={downloadAnswerKeyTemplate}
          />
          <TemplateDownloadCard 
            title="OMR Result Template" 
            desc="For bulk result evaluation" 
            icon={FileSpreadsheet} 
            color="text-purple-600"
            onClick={downloadResponsesTemplate}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] px-2">Data Utility</h2>
        <Card className="p-6 space-y-4 overflow-hidden relative">
          <div className="flex items-center space-x-4">
             <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
               <RefreshCw size={24} className={cn(isSeeding && "animate-spin")} />
             </div>
             <div>
               <h3 className="font-black text-slate-800 tracking-tight">Test Data Generator</h3>
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Populate app with sample records</p>
             </div>
          </div>
          <Button 
            variant="outline" 
            size="md" 
            disabled={isSeeding}
            onClick={seedData}
            className="w-full relative z-10"
          >
            {isSeeding ? seedStatus : seedStatus === 'Success!' ? (
              <span className="flex items-center text-emerald-600">
                <CheckCircle2 size={18} className="mr-2" /> Data Seeded
              </span>
            ) : 'Seed Sample Data'}
          </Button>
          <div className="absolute right-[-10%] bottom-[-20%] opacity-5 text-blue-600 pointer-events-none">
             <Database size={120} />
          </div>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] px-2">Account & System</h2>
        <div className="space-y-3">
          {secondaryItems.map((item) => (
            <Card key={item.label} className="flex items-center justify-between p-5 py-4 active:scale-[0.99] transition-transform cursor-pointer">
              <div className="flex items-center space-x-4">
                <div className={cn("p-2.5 rounded-xl bg-slate-50", item.color)}>
                  <item.icon size={20} strokeWidth={2.5} />
                </div>
                <span className="font-bold text-slate-700">{item.label}</span>
              </div>
              <ChevronRight className="text-slate-300" size={18} strokeWidth={3} />
            </Card>
          ))}
        </div>
      </section>

      <Button 
        variant="secondary" 
        size="lg" 
        onClick={logout} 
        className="w-full py-5 text-red-600 bg-red-50 hover:bg-red-100 border-none flex items-center justify-center space-x-3 rounded-[2rem]"
      >
        <LogOut size={22} strokeWidth={2.5} />
        <span className="font-black uppercase tracking-widest text-xs">Logout Session</span>
      </Button>

      <div className="text-center space-y-1">
        <p className="text-[10px] text-slate-300 font-black uppercase tracking-[0.3em]">
          PW Gurukul v1.0 • Pro Edition
        </p>
        <div className="flex justify-center space-x-2">
          <div className="w-1 h-1 bg-slate-200 rounded-full" />
          <div className="w-1 h-1 bg-slate-200 rounded-full" />
          <div className="w-1 h-1 bg-slate-200 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function TemplateDownloadCard({ title, desc, icon: Icon, color, onClick }: any) {
  return (
    <Card 
      onClick={onClick}
      className="p-5 flex items-center justify-between hover:bg-white active:scale-[0.98] transition-all group cursor-pointer border-slate-100/50 shadow-sm"
    >
      <div className="flex items-center space-x-4 overflow-hidden">
        <div className={cn("p-3 rounded-2xl bg-slate-50 transition-colors group-hover:bg-white flex-shrink-0", color)}>
          <Icon size={22} strokeWidth={2.5} />
        </div>
        <div className="overflow-hidden">
          <span className="font-black text-slate-800 tracking-tight block truncate">{title}</span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block truncate">{desc}</span>
        </div>
      </div>
      <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all flex-shrink-0 ml-4 shadow-sm">
        <Download size={18} strokeWidth={3} />
      </div>
    </Card>
  );
}

