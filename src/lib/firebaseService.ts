
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
  writeBatch,
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
        if (firebaseConfig.measurementId && app) {
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
    
    // Separate responses as they will be stored in a subcollection
    const { responses, ...sessionDocDataSansResponses } = sessionData;

    const baseDataForFirestore = {
      ...sessionDocDataSansResponses,
      userProfile: sessionData.userProfile,
      questions: sessionData.questions, // Store question definitions with the session
      currentQuestionIndex: sessionData.currentQuestionIndex,
      // policyAreasToRate and currentRatingAreaIndex are from previous iteration, confirm if needed for new structure
      policyAreasToRate: sessionData.policyAreasToRate || [], // Kept for now
      currentRatingAreaIndex: sessionData.currentRatingAreaIndex || 0, // Kept for now
      policyScores: sessionData.policyScores || {}, // This was for overall department scores, now we have per-question scores
      startTime: Timestamp.fromDate(new Date(sessionData.startTime)),
      lastSavedTime: sessionData.lastSavedTime ? Timestamp.fromDate(new Date(sessionData.lastSavedTime)) : Timestamp.now(),
      completedTime: sessionData.completedTime ? Timestamp.fromDate(new Date(sessionData.completedTime)) : null,
      status: sessionData.status,
      reportGenerated: sessionData.reportGenerated,
      reportUrl: sessionData.reportUrl || null,
    };

    await setDoc(sessionRef, baseDataForFirestore);

    // If initial responses are provided (e.g., resuming an old session structure), save them
    if (responses && Object.keys(responses).length > 0) {
      const batch = writeBatch(db);
      Object.values(responses).forEach(response => {
        const responseRef = doc(db, 'sessions', sessionData.sessionId, 'responses', response.questionId);
        batch.set(responseRef, {
          ...response,
          timestamp: Timestamp.fromDate(new Date(response.timestamp)),
        });
      });
      await batch.commit();
    }

    return sessionData.sessionId;
  } catch (error) {
    console.error(`Firebase: Error starting new session ${sessionData.sessionId}:`, error);
    throw error;
  }
};

export const updateComplianceSession = async (
  sessionId: string,
  dataToUpdate: Partial<ComplianceSession> // Can include responses if needed for a full update
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
    
    // Handle responses separately if they are part of the update
    if (updatePayload.responses) {
      const responsesToUpdate = updatePayload.responses as Record<string, ResponseData>;
      delete updatePayload.responses; // Remove from main doc update payload

      const batch = writeBatch(db);
      Object.values(responsesToUpdate).forEach(response => {
        const responseRef = doc(db, 'sessions', sessionId, 'responses', response.questionId);
        batch.set(responseRef, { // Use set with merge option or ensure full response data
          ...response,
          timestamp: Timestamp.fromDate(new Date(response.timestamp)),
        }, { merge: true }); // Merge to update existing or create new
      });
      await batch.commit();
    }

    if (Object.keys(updatePayload).length > 0) {
      await updateDoc(sessionRef, updatePayload);
    }

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
    // Save response to the subcollection 'responses' using questionId as document ID
    const responseRef = doc(db, 'sessions', sessionId, 'responses', responseData.questionId);
    const dataToSave = {
      ...responseData, // Includes questionText, answerText, policyMaturityScore, practiceMaturityScore
      timestamp: Timestamp.fromDate(new Date(responseData.timestamp)),
    };
    await setDoc(responseRef, dataToSave); // Use setDoc to overwrite if exists, or create new
    
    // Update lastSavedTime on the main session document
    await updateDoc(doc(db, 'sessions', sessionId), { lastSavedTime: Timestamp.now() });
    return responseData.questionId;
  } catch (error) {
    console.error(`Firebase: Error adding/updating response to session ${sessionId} for question ${responseData.questionId}:`, error);
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
    // Construct the base session object from the document data
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
      responses: {}, // Initialize as empty, will be filled from subcollection
      // These are legacy, review if they are still needed with per-question scores
      policyAreasToRate: (dbData.policyAreasToRate || []) as string[],
      currentRatingAreaIndex: (dbData.currentRatingAreaIndex || 0) as number,
      policyScores: (dbData.policyScores || {}) as Record<string, number>,
    };

    // Fetch responses from the subcollection
    const responsesCollectionRef = collection(db, 'sessions', sessionId, 'responses');
    const responsesQueryInstance = firestoreQuery(responsesCollectionRef);
    const responsesSnap = await getDocs(responsesQueryInstance);

    const loadedResponses: Record<string, ResponseData> = {};
    responsesSnap.forEach((docSnap) => {
      const respData = docSnap.data();
      const response: ResponseData = {
        questionId: respData.questionId || docSnap.id, // Use docSnap.id as fallback
        questionText: respData.questionText,
        answerText: respData.answerText,
        policyMaturityScore: (respData.policyMaturityScore !== undefined) ? respData.policyMaturityScore : 0, // default to 0
        practiceMaturityScore: (respData.practiceMaturityScore !== undefined) ? respData.practiceMaturityScore : 0, // default to 0
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
  reportContentOrFile: string | File, // Can be Markdown string or PDF File object
  reportName?: string // e.g., "compliance_report.md" or "compliance_report.pdf"
): Promise<string> => {
  if (!storage) throw new Error("Firebase Storage not initialized. Check Firebase configuration.");
  if (!sessionId) throw new Error('Missing sessionId. Cannot upload report.');

  let fullReportName: string;
  let contentType: string | undefined;

  if (typeof reportContentOrFile === 'string') {
    // Assuming Markdown if string
    fullReportName = reportName || `nepra_compliance_report_${sessionId}.md`;
    contentType = 'text/markdown';
  } else {
    // It's a File object, likely a PDF
    fullReportName = reportName || reportContentOrFile.name || `nepra_compliance_report_${sessionId}.pdf`; // Use file name or default
    contentType = reportContentOrFile.type || (fullReportName.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
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
Firestore Security Rules Suggestions (Anonymous Auth Model):

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Sessions Collection
    // Assumes sessionId is unpredictable enough for initial "ownership" by creator.
    // For a more robust model with Firebase Auth (even anonymous), you'd store and check auth.uid.
    match /sessions/{sessionId} {
      // Allow create if the request is new (no existing document with this ID).
      // This is a basic protection; a truly secure model would involve user authentication.
      allow create: if request.resource.data.startTime == request.time; // Ensures startTime is server time on create

      // Allow read and update if the client "knows" the sessionId.
      // This is not truly secure without auth, as sessionIds could be guessed or leaked.
      // For anonymous auth: allow read, update: if request.auth != null && resource.data.ownerUid == request.auth.uid;
      // Simplified for initial dev without explicit auth UIDs:
      allow read: if true; // For testing, allows any client to read any session if ID is known
      allow update: if true; // For testing, allows any client to update any session if ID is known
                          // Consider adding: && request.resource.data.sessionId == sessionId

      // Generally, don't allow client-side deletion of sessions to preserve audit trails.
      allow delete: if false; // Admins might do this via a backend function.

      // Responses Subcollection
      match /responses/{responseId} {
        // Allow create/update if the client "knows" the parent sessionId.
        // Again, this relies on the obscurity of sessionId without stronger auth.
        // For anonymous auth: allow write: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.ownerUid == request.auth.uid;
        // Simplified for initial dev:
        allow write: if true; // create, update, delete individual responses

        // Allow read if client knows sessionId.
        // For anonymous auth: allow read: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.ownerUid == request.auth.uid;
        // Simplified for initial dev:
        allow read: if true;
      }
    }

    // (Optional) Admin-specific collections or roles would go here.
    // Example for an admin collection:
    // match /admins/{adminId} {
    //   allow read: if request.auth != null && request.auth.uid == adminId;
    // }
  }
}

Firebase Storage Security Rules Suggestions:

service firebase.storage {
  match /b/{bucket}/o {
    // Reports: reports/{sessionId}/{reportFilename}
    match /reports/{sessionId}/{reportFilename} {
      // Allow write (upload) if the client "knows" the sessionId.
      // This is weak without auth. For anonymous auth:
      // allow write: if request.auth != null &&
      //                exists(/databases/(default)/documents/sessions/$(sessionId)) &&
      //                get(/databases/(default)/documents/sessions/$(sessionId)).data.ownerUid == request.auth.uid;
      // Simplified for initial dev:
      allow write: if true; // Allows any client to upload reports if sessionId is known.

      // Restrict read access.
      // Option 1: Only authenticated users (if you implement Firebase Auth)
      // allow read: if request.auth != null;
      // Option 2: Only specific admin users (requires custom claims or checking Firestore admin collection)
      // allow read: if request.auth != null && request.auth.token.admin === true; (example custom claim)
      // Option 3 (Weak for sensitive data, but usable for dev): Allow read if sessionId is known
      allow read: if true; // For testing.
    }
  }
}

NOTE: The simplified security rules (allow ...: if true;) are for DEVELOPMENT & TESTING ONLY.
You MUST implement proper security rules based on your authentication strategy (e.g., Firebase Anonymous Auth)
before deploying to production or handling any sensitive data. Storing an `ownerUid` (from `request.auth.uid`)
in your session documents and checking against it in rules is a common pattern.
*/
