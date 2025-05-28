
// Ensure you have Firebase installed: npm install firebase

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query as firestoreQuery,
  getDocs,
  updateDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadString,
  uploadBytes,
  getDownloadURL,
  type FirebaseStorage,
} from 'firebase/storage';
import { getAnalytics, type Analytics } from 'firebase/analytics';

import type { ComplianceSession, ResponseData, QuestionDefinition, UserProfile } from './types';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

let app: FirebaseApp | null = null;
export let isFirebaseInitialized: boolean = false;
let analytics: Analytics | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;


if (typeof window !== 'undefined') {
  if (!getApps().length) {
    if (firebaseConfig.apiKey && firebaseConfig.projectId) {
      try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        storage = getStorage(app);
        if (firebaseConfig.measurementId) {
          analytics = getAnalytics(app);
        }
        isFirebaseInitialized = true;
      } catch (e) {
        console.error("Error initializing Firebase:", e);
        isFirebaseInitialized = false;
        app = null; db = null; storage = null; analytics = null;
      }
    } else {
      console.error("Firebase configuration is missing. Firebase not initialized.");
      isFirebaseInitialized = false;
    }
  } else {
    app = getApp();
    db = getFirestore(app);
    storage = getStorage(app);
    if (firebaseConfig.measurementId && app) {
        analytics = getAnalytics(app);
    }
    isFirebaseInitialized = true;
  }
}

export { db, storage, app, analytics };


export const startNewComplianceSession = async (sessionData: ComplianceSession): Promise<string> => {
  if (!db) throw new Error("Firestore not initialized. Check Firebase configuration.");
  if (!sessionData.sessionId) throw new Error("Session ID is required to start a new session.");

  try {
    const sessionRef = doc(db, 'sessions', sessionData.sessionId);
    
    const { responses, ...sessionDocDataSansResponses } = sessionData;

    const baseDataForFirestore = {
      ...sessionDocDataSansResponses,
      userProfile: sessionData.userProfile,
      questions: sessionData.questions, // Store question definitions with the session
      currentQuestionIndex: sessionData.currentQuestionIndex,
      policyAreasToRate: sessionData.policyAreasToRate || [],
      currentRatingAreaIndex: sessionData.currentRatingAreaIndex || 0,
      policyScores: sessionData.policyScores || {},
      startTime: Timestamp.fromDate(new Date(sessionData.startTime)),
      lastSavedTime: sessionData.lastSavedTime ? Timestamp.fromDate(new Date(sessionData.lastSavedTime)) : Timestamp.now(),
      completedTime: sessionData.completedTime ? Timestamp.fromDate(new Date(sessionData.completedTime)) : null,
      status: sessionData.status,
      reportGenerated: sessionData.reportGenerated,
      reportUrl: sessionData.reportUrl || null,
    };

    await setDoc(sessionRef, baseDataForFirestore);
    return sessionData.sessionId;
  } catch (error) {
    console.error(`Firebase: Error starting new session ${sessionData.sessionId}:`, error);
    throw error;
  }
};

export const updateComplianceSession = async (
  sessionId: string,
  dataToUpdate: Partial<ComplianceSession>
): Promise<void> => {
  if (!db) throw new Error("Firestore not initialized. Check Firebase configuration.");
  if (!sessionId) throw new Error("Session ID is required to update a session.");

  try {
    const sessionRef = doc(db, 'sessions', sessionId);
    const updatePayload: Record<string, any> = { ...dataToUpdate };

    if (dataToUpdate.startTime && typeof dataToUpdate.startTime === 'string') {
      updatePayload.startTime = Timestamp.fromDate(new Date(dataToUpdate.startTime));
    }
    updatePayload.lastSavedTime = Timestamp.now();
    
    if (dataToUpdate.completedTime && typeof dataToUpdate.completedTime === 'string') {
      updatePayload.completedTime = Timestamp.fromDate(new Date(dataToUpdate.completedTime));
    }
    
    if (updatePayload.responses) delete updatePayload.responses; // Responses managed in subcollection

    await updateDoc(sessionRef, updatePayload);
  } catch (error) {
    console.error(`Firebase: Error updating session ${sessionId}:`, error);
    throw error;
  }
};

export const addResponseToSession = async (
  sessionId: string,
  responseData: ResponseData
): Promise<string> => {
  if (!db) throw new Error("Firestore not initialized. Check Firebase configuration.");
  if (!sessionId) throw new Error("Session ID is required to add a response.");
  if (!responseData.questionId) throw new Error("Question ID is required to add a response.");

  try {
    const responseRef = doc(db, 'sessions', sessionId, 'responses', responseData.questionId);
    const dataToSave = {
      ...responseData,
      timestamp: Timestamp.fromDate(new Date(responseData.timestamp)),
    };
    await setDoc(responseRef, dataToSave); // Use setDoc with questionId for idempotency
    
    await updateDoc(doc(db, 'sessions', sessionId), { lastSavedTime: Timestamp.now() });
    return responseData.questionId;
  } catch (error) {
    console.error(`Firebase: Error adding response to session ${sessionId} for question ${responseData.questionId}:`, error);
    throw error;
  }
};

export const getComplianceSession = async (sessionId: string): Promise<ComplianceSession | null> => {
  if (!db) throw new Error("Firestore not initialized. Check Firebase configuration.");
  if (!sessionId) return null;

  try {
    const sessionRef = doc(db, 'sessions', sessionId);
    const sessionSnap = await getDoc(sessionRef);

    if (!sessionSnap.exists()) {
      return null;
    }

    const dbData = sessionSnap.data();
    const baseSession: ComplianceSession = {
      sessionId: sessionSnap.id,
      userProfile: dbData.userProfile as UserProfile,
      questions: (dbData.questions || []) as QuestionDefinition[],
      currentQuestionIndex: (dbData.currentQuestionIndex || 0) as number,
      startTime: (dbData.startTime as Timestamp).toDate().toISOString(),
      lastSavedTime: dbData.lastSavedTime ? (dbData.lastSavedTime as Timestamp).toDate().toISOString() : undefined,
      completedTime: dbData.completedTime ? (dbData.completedTime as Timestamp).toDate().toISOString() : undefined,
      status: dbData.status as ComplianceSession['status'],
      reportGenerated: (dbData.reportGenerated || false) as boolean,
      reportUrl: dbData.reportUrl as string | undefined,
      responses: {}, 
      policyAreasToRate: (dbData.policyAreasToRate || []) as string[],
      currentRatingAreaIndex: (dbData.currentRatingAreaIndex || 0) as number,
      policyScores: (dbData.policyScores || {}) as Record<string, number>,
    };

    const responsesCollectionRef = collection(db, 'sessions', sessionId, 'responses');
    const responsesQueryInstance = firestoreQuery(responsesCollectionRef);
    const responsesSnap = await getDocs(responsesQueryInstance);

    const loadedResponses: Record<string, ResponseData> = {};
    responsesSnap.forEach((docSnap) => {
      const respData = docSnap.data();
      const response: ResponseData = {
        questionId: respData.questionId || docSnap.id,
        questionText: respData.questionText,
        answerText: respData.answerText,
        timestamp: (respData.timestamp as Timestamp).toDate().toISOString(),
        riskLevel: respData.riskLevel,
        nepraCategory: respData.nepraCategory,
      };
      loadedResponses[response.questionId] = response;
    });
    
    return {
        ...baseSession,
        responses: loadedResponses,
    };
  } catch (error) {
    console.error(`Firebase: Error getting session ${sessionId}:`, error);
    throw error;
  }
};

export const uploadReportToStorage = async (
  sessionId: string,
  reportContentOrFile: string | File,
  reportName?: string
): Promise<string> => {
  if (!storage) throw new Error("Firebase Storage not initialized. Check Firebase configuration.");
  if (!sessionId) throw new Error('Missing sessionId. Cannot upload report.');

  let fullReportName: string;
  let contentType: string | undefined;

  if (typeof reportContentOrFile === 'string') {
    fullReportName = reportName || `nepra_compliance_report_${sessionId}.md`;
    contentType = 'text/markdown';
  } else {
    fullReportName = reportName || reportContentOrFile.name || `nepra_compliance_report_${sessionId}.pdf`;
    contentType = reportContentOrFile.type || (fullReportName.endsWith('.pdf') ? 'application/pdf' : undefined);
  }

  const storageRef = ref(storage, `reports/${sessionId}/${fullReportName}`);

  try {
    if (typeof reportContentOrFile === 'string') {
      await uploadString(storageRef, reportContentOrFile, 'raw', contentType ? { contentType } : undefined);
    } else {
      await uploadBytes(storageRef, reportContentOrFile, contentType ? { contentType } : undefined);
    }
    const downloadURL = await getDownloadURL(storageRef);
    return downloadURL;
  } catch (error) {
    console.error(`Firebase: Error uploading report ${fullReportName} for session ${sessionId}:`, error);
    throw error;
  }
};

/*
Firestore Security Rules Suggestions:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Sessions Collection
    match /sessions/{sessionId} {
      // Allow create if the user is authenticated (e.g., anonymous auth).
      // For anonymous auth, request.auth.uid will exist.
      // If not using Firebase Auth, this rule needs adjustment, e.g., allow create: if true; (less secure).
      allow create: if request.auth != null; // Simplest for anonymous auth being active
                   // or if you embed a client-generated secret in sessionId and validate it here.

      // Allow read, update if the user "owns" the session.
      // This requires a way to link the request to the session owner.
      // If using anonymous auth, you could store request.auth.uid in the session document
      // as 'ownerUid' or similar during creation.
      // Example assuming 'ownerUid' field:
      // allow read, update: if request.auth != null && resource.data.ownerUid == request.auth.uid;
      
      // For a simpler, less secure model for rapid development if NOT using Firebase Auth yet:
      allow read, update: if true; // WARNING: Open access for testing. Secure this.

      // Restrict delete, perhaps to admins or specific conditions.
      // allow delete: if request.auth != null && request.auth.token.admin === true; // Example: Admins only
      allow delete: if false; // Generally, don't allow client-side deletion of sessions.

      // Responses Subcollection
      match /responses/{responseId} {
        // Allow create if the user owns the parent session (similar logic as above for session create/update).
        // allow create: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.ownerUid == request.auth.uid;
        // Simpler for testing:
        allow create: if true; // WARNING: Open access for testing. Secure this.
        
        // Allow read if the user owns the parent session.
        // allow read: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.ownerUid == request.auth.uid;
        // Simpler for testing:
        allow read: if true; // WARNING: Open access for testing. Secure this.
        
        // Allow update if the user owns the parent session (e.g., to correct an answer).
        // allow update: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.ownerUid == request.auth.uid;
        // Simpler for testing:
        allow update: if true; // WARNING: Open access for testing. Secure this.

        // Disallow delete of individual responses to maintain audit trail, unless by admin.
        allow delete: if false; // Or check for admin role
      }
    }
  }
}

Firebase Storage Security Rules Suggestions:

service firebase.storage {
  match /b/{bucket}/o {
    // Reports: reports/{sessionId}/{reportFilename}
    match /reports/{sessionId}/{reportFilename} {
      // Allow write (upload) if the user owns the session.
      // This requires verifying ownership, e.g., by checking Firestore.
      // Example assuming 'ownerUid' field in session document:
      // allow write: if request.auth != null &&
      //                exists(/databases/(default)/documents/sessions/$(sessionId)) &&
      //                get(/databases/(default)/documents/sessions/$(sessionId)).data.ownerUid == request.auth.uid;
      // Simpler for testing if not using auth or ownerUid:
      allow write: if true; // WARNING: Open access for testing. Secure this.

      // Allow read for admins or specific authenticated users.
      // For simplicity, if reports are not highly sensitive during dev, allow read: if request.auth != null;
      // For stricter access (e.g., only admins):
      // allow read: if request.auth != null && request.auth.token.admin === true;
      // Simpler for testing:
      allow read: if true; // WARNING: Open access for testing. Secure this.
    }
  }
}

NOTE: The simplified security rules (allow read, write: if true;) are for DEVELOPMENT & TESTING ONLY.
You MUST implement proper security rules based on your authentication strategy before deploying
to production or handling any sensitive data. Using Firebase Anonymous Authentication is a good
starting point for managing user-specific data without requiring explicit logins.
*/
