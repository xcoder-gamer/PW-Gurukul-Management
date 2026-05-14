import { collection, doc, getDoc, getDocs, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface AnswerKey {
  [questionNumber: string]: {
    correctAnswers: string[];
    isCancelled?: boolean;
    marks?: number;
    subject?: string;
    chapter?: string;
  };
}

export interface StudentResponse {
  studentId: string;
  answers: { [questionNumber: string]: string };
}

export async function evaluateResults(testId: string) {
  // 1. Fetch Test and Answer Key
  const testDoc = await getDoc(doc(db, 'tests', testId));
  if (!testDoc.exists()) throw new Error('Test not found');
  
  const testData = testDoc.data();
  const answerKey: AnswerKey = testData.answerKey;
  const totalQuestions = testData.totalQuestions;

  // 2. Fetch all responses for this test
  const responseQuery = query(collection(db, 'responses'), where('testId', '==', testId));
  const responseSnap = await getDocs(responseQuery);
  
  const batch = writeBatch(db);

  responseSnap.docs.forEach((respDoc) => {
    const data = respDoc.data() as StudentResponse;
    let score = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unattemptedCount = 0;

    for (let i = 1; i <= totalQuestions; i++) {
        const qNum = i.toString();
        const studentAns = data.answers[qNum];
        const key = answerKey[qNum];

        if (!key) continue;

        if (key.isCancelled) {
            // Full marks for cancelled OR skip marks
            score += (key.marks || 4);
            continue;
        }

        if (!studentAns) {
            unattemptedCount++;
            continue;
        }

        if (key.correctAnswers.includes(studentAns)) {
            correctCount++;
            score += (key.marks || 4);
        } else {
            wrongCount++;
            score -= 1; // Negative marking
        }
    }

    const accuracy = (correctCount / (correctCount + wrongCount || 1)) * 100;

    const resultId = `${testId}_${data.studentId}`;
    batch.set(doc(db, 'results', resultId), {
      testId,
      studentId: data.studentId,
      score,
      correctCount,
      wrongCount,
      unattemptedCount,
      accuracy,
      version: testData.answerKeyVersion || 1,
      evaluatedAt: serverTimestamp()
    });
  });

  await batch.commit();
}
