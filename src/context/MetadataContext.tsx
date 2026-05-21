import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from './AuthContext';

interface MetadataContextType {
  programs: any[];
  centers: any[];
  batches: any[];
  testPatterns: any[];
  loading: boolean;
  refreshMetadata: () => Promise<void>;
}

const MetadataContext = createContext<MetadataContextType | undefined>(undefined);

export function MetadataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [programs, setPrograms] = useState<any[]>([]);
  const [centers, setCenters] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [testPatterns, setTestPatterns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchMetadata = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [progSnap, centSnap, batchSnap, patternSnap] = await Promise.all([
        getDocs(collection(db, 'programs')),
        getDocs(collection(db, 'centers')),
        getDocs(collection(db, 'batches')),
        getDocs(collection(db, 'testPatterns'))
      ]);

      setPrograms(progSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCenters(centSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setBatches(batchSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setTestPatterns(patternSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoaded(true);
    } catch (error) {
       console.error("Error pre-fetching master metadata:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user && !loaded) {
      fetchMetadata();
    } else if (!user) {
      setPrograms([]);
      setCenters([]);
      setBatches([]);
      setTestPatterns([]);
      setLoaded(false);
    }
  }, [user, loaded, fetchMetadata]);

  const refreshMetadata = async () => {
    setLoaded(false);
    await fetchMetadata();
  };

  return (
    <MetadataContext.Provider value={{ programs, centers, batches, testPatterns, loading, refreshMetadata }}>
      {children}
    </MetadataContext.Provider>
  );
}

export function useMetadata() {
  const context = useContext(MetadataContext);
  if (context === undefined) {
    throw new Error('useMetadata must be used within a MetadataProvider');
  }
  return context;
}
