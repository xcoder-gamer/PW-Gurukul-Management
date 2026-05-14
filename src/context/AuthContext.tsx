import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, query, collection, where, getDocs } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  role: string | null;
  loading: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user && user.email) {
        try {
          const emailId = user.email.toLowerCase().trim();
          
          // 1. Try direct email match as ID (New preferred way)
          let roleDoc = await getDoc(doc(db, 'user_roles', emailId));
          
          if (!roleDoc.exists()) {
             // 2. Try UID as ID (Old way)
             roleDoc = await getDoc(doc(db, 'user_roles', user.uid));
          }

          if (roleDoc.exists()) {
            const data = roleDoc.data();
            if (data.isActive === false) {
              setRole('unauthorized');
            } else {
              setRole(String(data.role || 'user').toLowerCase());
            }
          } else {
            // 3. Try query (Fallback for random IDs)
            const q = query(collection(db, 'user_roles'), where('email', '==', user.email));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
              const data = querySnapshot.docs[0].data();
              if (data.isActive === false) {
                setRole('unauthorized');
              } else {
                setRole(String(data.role || 'user').toLowerCase());
              }
            } else {
              // 4. Fallback to bootstrap for dev emails
              const adminEmails = ["devansh.sharma@pw.live", "deepayan.nayak@pw.live", "gurukul.ops@pw.live"];
              if (adminEmails.includes(user.email.toLowerCase())) {
                await setDoc(doc(db, 'user_roles', emailId), {
                  role: 'admin',
                  email: user.email.toLowerCase(),
                  isActive: true,
                  createdAt: new Date()
                });
                setRole('admin');
              } else {
                setRole('unauthorized');
              }
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `user_roles/${user.email}`);
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
    <AuthContext.Provider value={{ user, role, loading, signIn, logout }}>
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
