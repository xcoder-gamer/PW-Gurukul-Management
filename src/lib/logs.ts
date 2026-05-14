import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

export enum LogAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  IMPORT = 'IMPORT',
  LOGIN = 'LOGIN',
  REUPLOAD_KEY = 'REUPLOAD_KEY'
}

export enum LogCategory {
  TEST = 'TEST',
  STUDENT = 'STUDENT',
  BATCH = 'BATCH',
  CENTER = 'CENTER',
  PROGRAM = 'PROGRAM',
  QBG = 'QBG',
  AUTH = 'AUTH'
}

interface LogData {
  userId: string;
  userEmail: string;
  action: LogAction;
  category: LogCategory;
  resourceId: string;
  resourceName: string;
  details: string;
  previousData?: any;
  newData?: any;
}

export async function addLog(data: LogData) {
  try {
    await addDoc(collection(db, 'logs'), {
      ...data,
      timestamp: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'logs');
  }
}
