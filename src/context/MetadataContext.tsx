import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from './AuthContext';

interface MetadataContextType {
  programs: any[];
  centers: any[];
  batches: any[];
  testPatterns: any[];
  qbgLibrary: any[];
  qbgMap: Record<string, any>;
  qbgFlatList: any[];
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
  const [qbgLibrary, setQbgLibrary] = useState<any[]>([]);
  const [qbgMap, setQbgMap] = useState<Record<string, any>>({});
  const [qbgFlatList, setQbgFlatList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchMetadata = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [progSnap, centSnap, batchSnap, patternSnap, qbgSnap] = await Promise.all([
        getDocs(collection(db, 'programs')),
        getDocs(collection(db, 'centers')),
        getDocs(collection(db, 'batches')),
        getDocs(collection(db, 'testPatterns')),
        getDocs(collection(db, 'qbgLibrary'))
      ]);

      setPrograms(progSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCenters(centSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setBatches(batchSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setTestPatterns(patternSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      const qbgDocs = qbgSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      setQbgLibrary(qbgDocs);

      // Pre-compute map and flatlist
      const map: Record<string, any> = {};
      const qbgList: any[] = [];

      qbgDocs.forEach((sData: any) => {
        const sId = sData.id;
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
                map[tId] = { topic: t.name, chapter: ch.name, subject: sName };
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
                    map[stId] = { topic: st.name, chapter: ch.name, subject: sName };
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

      setQbgMap(map);
      setQbgFlatList(qbgList);

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
      setQbgLibrary([]);
      setQbgMap({});
      setQbgFlatList([]);
      setLoaded(false);
    }
  }, [user, loaded, fetchMetadata]);

  const refreshMetadata = async () => {
    setLoaded(false);
    await fetchMetadata();
  };

  return (
    <MetadataContext.Provider value={{ programs, centers, batches, testPatterns, qbgLibrary, qbgMap, qbgFlatList, loading, refreshMetadata }}>
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
