import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, query, collection, where, getDocs } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  role: string | null;
  loading: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  isQuotaExceeded?: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
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
          if (roleDoc.exists()) {
            const data = roleDoc.data();
            if (data.isActive === false) {
              resolvedRole = 'unauthorized';
            } else {
              resolvedRole = String(data.role || 'user').toLowerCase();
            }
          } else {
            // 3. Try query (Fallback for random IDs)
            const q = query(collection(db, 'user_roles'), where('email', '==', user.email));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
              const data = querySnapshot.docs[0].data();
              if (data.isActive === false) {
                resolvedRole = 'unauthorized';
              } else {
                resolvedRole = String(data.role || 'user').toLowerCase();
              }
            } else {
              // 4. Fallback to bootstrap for dev emails
              const adminEmails = ["devansh.sharma@pw.live", "deepayan.nayak@pw.live", "gurukul.ops@pw.live"];
              if (adminEmails.includes(emailId)) {
                try {
                  await setDoc(doc(db, 'user_roles', emailId), {
                    role: 'admin',
                    email: user.email.toLowerCase(),
                    isActive: true,
                    createdAt: new Date()
                  });
                } catch (writeErr) {
                  console.warn("Bootstrap write skipped or failed:", writeErr);
                }
                resolvedRole = 'admin';
              } else {
                resolvedRole = 'unauthorized';
              }
            }
          }

          setRole(resolvedRole);
          localStorage.setItem(`cached_role_${emailId}`, resolvedRole);
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
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, signIn, logout, isQuotaExceeded }}>
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
