import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, query, collection, where, getDocs } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  role: string | null;
  centerId: string | null;
  batchIds: string[] | null;
  loading: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  isQuotaExceeded?: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [batchIds, setBatchIds] = useState<string[] | null>(null);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user && user.email) {
        const emailId = user.email.toLowerCase().trim();
        try {
          // 1. Try direct email match as ID (New preferred way)
          let roleDoc = await getDoc(doc(db, 'user_roles', emailId));
          
          if (!roleDoc.exists()) {
             // 2. Try UID as ID (Old way)
             roleDoc = await getDoc(doc(db, 'user_roles', user.uid));
          }

          let resolvedRole = 'unauthorized';
          let docData: any = null;
          if (roleDoc.exists()) {
            docData = roleDoc.data();
            if (docData.isActive === false) {
              resolvedRole = 'unauthorized';
            } else {
              resolvedRole = String(docData.role || 'user').toLowerCase();
            }
          } else {
            // 3. Try query (Fallback for random IDs)
            const q = query(collection(db, 'user_roles'), where('email', '==', user.email));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
              docData = querySnapshot.docs[0].data();
              if (docData.isActive === false) {
                resolvedRole = 'unauthorized';
              } else {
                resolvedRole = String(docData.role || 'user').toLowerCase();
              }
            } else {
              // 4. Fallback to bootstrap for dev emails
              const adminEmails = ["devansh.sharma@pw.live", "deepayan.nayak@pw.live", "gurukul.ops@pw.live"];
              if (adminEmails.includes(emailId)) {
                try {
                  const payload = {
                    role: 'admin',
                    email: user.email.toLowerCase(),
                    isActive: true,
                    createdAt: new Date()
                  };
                  await setDoc(doc(db, 'user_roles', emailId), payload);
                  docData = payload;
                } catch (writeErr) {
                  console.warn("Bootstrap write skipped or failed:", writeErr);
                }
                resolvedRole = 'admin';
              } else {
                resolvedRole = 'unauthorized';
              }
            }
          }

          // Normalize and map role representations: 
          // central_team / operator / central -> central
          // center_level / center -> center
          if (resolvedRole === 'central_team' || resolvedRole === 'operator') {
            resolvedRole = 'central';
          }
          if (resolvedRole === 'center_level') {
            resolvedRole = 'center';
          }

          // Resolve Center Assignment: centerId
          let assignedCenterId: string | null = null;
          if (docData && docData.centerId) {
            assignedCenterId = String(docData.centerId);
          }
          setCenterId(assignedCenterId);

          // Resolve Batch Assignment: batchIds
          let activeBatchIds: string[] = [];
          if (docData && docData.batchIds) {
            if (Array.isArray(docData.batchIds)) {
              activeBatchIds = docData.batchIds.map(String);
            } else if (typeof docData.batchIds === 'string') {
              activeBatchIds = docData.batchIds.split(',').map((s: string) => s.trim()).filter(Boolean);
            }
          }
          if (docData && docData.batchId && !activeBatchIds.includes(String(docData.batchId))) {
            activeBatchIds.push(String(docData.batchId));
          }

          // Query mappings/teachers dynamically for 'teacher'
          if (resolvedRole === 'teacher') {
            try {
              const teachQ = query(collection(db, 'teachers'), where('email', '==', emailId));
              const teachSnap = await getDocs(teachQ);
              if (!teachSnap.empty) {
                const teacherId = teachSnap.docs[0].id;
                const mapQ = query(collection(db, 'mappings'), where('teacherId', '==', teacherId));
                const mapSnap = await getDocs(mapQ);
                mapSnap.docs.forEach(docSnap => {
                  const d = docSnap.data();
                  if (d.batchId && !activeBatchIds.includes(String(d.batchId))) {
                    activeBatchIds.push(String(d.batchId));
                  }
                });
              }
            } catch (err) {
              console.error("Failed resolving teacher mappings dynamically:", err);
            }
          }

          setBatchIds(activeBatchIds.length > 0 ? activeBatchIds : null);
          setRole(resolvedRole);
          localStorage.setItem(`cached_role_${emailId}`, resolvedRole);
          if (assignedCenterId) localStorage.setItem(`cached_center_${emailId}`, assignedCenterId);
          if (activeBatchIds.length > 0) localStorage.setItem(`cached_batches_${emailId}`, JSON.stringify(activeBatchIds));
          setIsQuotaExceeded(false);
        } catch (error: any) {
          const errStr = error instanceof Error ? error.message : String(error);
          console.error("Auth init fetch failed:", error);

          const isQuota = errStr.toLowerCase().includes('quota') || 
                          errStr.toLowerCase().includes('limit') || 
                          errStr.toLowerCase().includes('exceeded') ||
                          errStr.toLowerCase().includes('resource');

          if (isQuota) {
            setIsQuotaExceeded(true);
          }

          // Fallback to cache to ensure seamless local operation
          const cached = localStorage.getItem(`cached_role_${emailId}`);
          if (cached) {
            setRole(cached);
            const cachedCenter = localStorage.getItem(`cached_center_${emailId}`);
            if (cachedCenter) setCenterId(cachedCenter);
            const cachedBatches = localStorage.getItem(`cached_batches_${emailId}`);
            if (cachedBatches) setBatchIds(JSON.parse(cachedBatches));
            toast.warning("🔔 Firestore Quota Exceeded. Entered offline mode with cached role!", {
              description: "Reads and writes might be disabled until your daily Firebase free quota resets, or billing is upgraded.",
              duration: 8000,
            });
          } else {
            // Hard coded fallback for key admin emails to guarantee lock-out immunity during client reviews
            const adminEmails = ["devansh.sharma@pw.live", "deepayan.nayak@pw.live", "gurukul.ops@pw.live"];
            if (adminEmails.includes(emailId)) {
              setRole('admin');
              localStorage.setItem(`cached_role_${emailId}`, 'admin');
              toast.warning("🔔 Entered off-grid fallback admin mode due to Firestore quota limitations.", {
                description: "You have full client navigation, but Firestore operations will fail until limits reset.",
                duration: 8000,
              });
            } else {
              setRole('unauthorized');
              toast.error("⚠️ Firestore Database Quota Exceeded", {
                description: "Your session could not be authenticated online. Please try again after limits reset or contact support.",
                duration: 10000,
              });
            }
          }
        }
      } else {
        setRole(null);
        setCenterId(null);
        setBatchIds(null);
      }
      setLoading(false);
    });
  }, []);

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Sign in error:", error);
    }
  };

  const logout = async () => {
    // Clear all metadata cache values
    localStorage.removeItem('meta_cache_programs');
    localStorage.removeItem('meta_cache_centers');
    localStorage.removeItem('meta_cache_batches');
    localStorage.removeItem('meta_cache_test_patterns');
    localStorage.removeItem('meta_cache_qbg_library');
    localStorage.removeItem('meta_cache_timestamp');
    
    // Clear all user-specific role caches
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('cached_role_') || key.startsWith('cached_center_') || key.startsWith('cached_batches_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, role, centerId, batchIds, loading, signIn, logout, isQuotaExceeded }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
