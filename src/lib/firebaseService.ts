
// Ensure you have Firebase installed: npm install firebase

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  addDoc,
  collection,
  query as firestoreQuery,
  // where, // Not used in current functions, but useful for querying questions collection
  getDocs,
  updateDoc,
  Timestamp,
  // deleteDoc, // Not requested yet
  // writeBatch, // Not requested yet
  type Firestore,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadString,
  uploadBytes, // Kept for flexibility, though current primary use might be string
  getDownloadURL,
  // deleteObject, // Not requested yet
  type FirebaseStorage,
} from 'firebase/storage';

// Assuming these types are correctly defined in './types'
import type { ComplianceSession, ResponseData, QuestionDefinition, UserProfile } from './types';

// Firebase Configuration using environment variables
// Ensure NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, etc. are set in your .env.local or environment
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
let app: FirebaseApp | null = null;
export let isFirebaseInitialized: boolean;

if (typeof window !== 'undefined') { // Ensure this runs only in the client-side context
  if (!getApps().length) {
    if (firebaseConfig.apiKey && firebaseConfig.projectId) { // Basic check for config presence
      try {
        app = initializeApp(firebaseConfig);
        console.log("Firebase initialized successfully.");
        isFirebaseInitialized = true;
      } catch (e) {
        console.error("Error initializing Firebase:", e);
        isFirebaseInitialized = false;
      }
    } else {
      console.error("Firebase configuration is missing. Firebase not initialized.");
      isFirebaseInitialized = false;
    }
  } else {
    app = getApp(); // Get the default app if already initialized
    console.log("Firebase app already initialized, using existing instance.");
    isFirebaseInitialized = true; // If apps exist, assume it was successful before or by another part of the app
  }
} else {
  // Server-side or during build, Firebase might not be needed or initialized here
  // Or handle server-side initialization if required for your use case
  console.warn("Firebase initialization skipped: not in a client-side context or Firebase already initialized by another means.");
  // Check if already initialized, perhaps by a server-side process or admin SDK
  isFirebaseInitialized = getApps().length > 0;
  if (isFirebaseInitialized && !app) {
    app = getApp(); // Try to get app if already initialized
  }
}


// Assign db and storage only if app was initialized
const db: Firestore = app ? getFirestore(app) : (null as unknown as Firestore);
const storage: FirebaseStorage = app ? getStorage(app) : (null as unknown as FirebaseStorage);


if (!app || !db || !storage) {
  if (isFirebaseInitialized) {
      console.error("Firebase services (Firestore/Storage) not available, despite app initialization. Check service setup.");
  }
}

export { db, storage };


/**
 * Saves a complete new compliance session document in Firestore.
 * Collection path: /sessions/{sessionId}
 */
export const startNewComplianceSession = async (sessionData: ComplianceSession): Promise<string> => {
  if (!db) throw new Error("Firestore not initialized. Check Firebase configuration.");
  if (!sessionData.sessionId) throw new Error("Session ID is required to start a new session.");

  try {
    const sessionRef = doc(db, 'sessions', sessionData.sessionId);
    
    // Prepare data for Firestore: convert dates and handle complex objects
    const { responses, ...sessionDocDataSansResponses } = JSON.parse(JSON.stringify(sessionData));

    const firestoreReadySessionData = {
      ...sessionDocDataSansResponses,
      userProfile: sessionData.userProfile,
      questions: sessionData.questions,
      startTime: Timestamp.fromDate(new Date(sessionData.startTime)),
      lastSavedTime: sessionData.lastSavedTime ? Timestamp.fromDate(new Date(sessionData.lastSavedTime)) : Timestamp.now(),
      completedTime: sessionData.completedTime ? Timestamp.fromDate(new Date(sessionData.completedTime)) : null,
      currentQuestionIndex: sessionData.currentQuestionIndex,
      status: sessionData.status,
      reportGenerated: sessionData.reportGenerated,
      reportUrl: sessionData.reportUrl || null,
    };

    await setDoc(sessionRef, firestoreReadySessionData);
    console.log(`Firebase: Session ${sessionData.sessionId} successfully created.`);
    return sessionData.sessionId;
  } catch (error) {
    console.error(`Firebase: Error starting new session ${sessionData.sessionId}:`, error);
    throw error;
  }
};

/**
 * Updates specific fields in a session document in Firestore.
 * Path: /sessions/{sessionId}
 */
export const updateComplianceSession = async (
  sessionId: string,
  dataToUpdate: Partial<Omit<ComplianceSession, 'responses'>>
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
    
    if (dataToUpdate.questions) {
        updatePayload.questions = dataToUpdate.questions;
    }

    await updateDoc(sessionRef, updatePayload);
    console.log(`Firebase: Session ${sessionId} successfully updated.`);
  } catch (error) {
    console.error(`Firebase: Error updating session ${sessionId}:`, error);
    throw error;
  }
};

/**
 * Adds a response to a session's 'responses' subcollection in Firestore.
 * Path: /sessions/{sessionId}/responses/{auto_generated_id}
 * Returns the ID of the newly created response document.
 */
export const addResponseToSession = async (
  sessionId: string,
  responseData: ResponseData
): Promise<string> => {
  if (!db) throw new Error("Firestore not initialized. Check Firebase configuration.");
  if (!sessionId) throw new Error("Session ID is required to add a response.");

  try {
    const responsesCollectionRef = collection(db, 'sessions', sessionId, 'responses');
    const dataToSave = {
      ...responseData,
      timestamp: Timestamp.fromDate(new Date(responseData.timestamp)),
    };
    const docRef = await addDoc(responsesCollectionRef, dataToSave);
    console.log(`Firebase: Response for session ${sessionId} (question ${responseData.questionId}) saved with Firestore doc ID: ${docRef.id}.`);
    
    await updateDoc(doc(db, 'sessions', sessionId), { lastSavedTime: Timestamp.now() });
    return docRef.id;
  } catch (error) {
    console.error(`Firebase: Error adding response to session ${sessionId}:`, error);
    throw error;
  }
};

/**
 * Retrieves a compliance session and its responses from Firestore.
 * Session: /sessions/{sessionId}
 * Responses: /sessions/{sessionId}/responses/
 */
export const getComplianceSession = async (sessionId: string): Promise<ComplianceSession | null> => {
  if (!db) throw new Error("Firestore not initialized. Check Firebase configuration.");
  if (!sessionId) {
    console.warn("Firebase: getComplianceSession called with no sessionId.");
    return null;
  }

  try {
    const sessionRef = doc(db, 'sessions', sessionId);
    const sessionSnap = await getDoc(sessionRef);

    if (!sessionSnap.exists()) {
      console.warn(`Firebase: Session ${sessionId} not found.`);
      return null;
    }

    const dbData = sessionSnap.data();
    const baseSession: ComplianceSession = {
      sessionId: sessionSnap.id,
      userProfile: dbData.userProfile as UserProfile,
      questions: dbData.questions as QuestionDefinition[],
      currentQuestionIndex: dbData.currentQuestionIndex as number,
      startTime: (dbData.startTime as Timestamp).toDate().toISOString(),
      lastSavedTime: dbData.lastSavedTime ? (dbData.lastSavedTime as Timestamp).toDate().toISOString() : undefined,
      completedTime: dbData.completedTime ? (dbData.completedTime as Timestamp).toDate().toISOString() : undefined,
      status: dbData.status as ComplianceSession['status'],
      reportGenerated: dbData.reportGenerated as boolean,
      reportUrl: dbData.reportUrl as string | undefined,
      responses: {}
    };

    const responsesCollectionRef = collection(db, 'sessions', sessionId, 'responses');
    const responsesQueryInstance = firestoreQuery(responsesCollectionRef);
    const responsesSnap = await getDocs(responsesQueryInstance);

    const loadedResponses: Record<string, ResponseData> = {};
    responsesSnap.forEach((docSnap) => {
      const respData = docSnap.data();
      const response: ResponseData = {
        questionId: respData.questionId,
        questionText: respData.questionText,
        answerText: respData.answerText,
        timestamp: (respData.timestamp as Timestamp).toDate().toISOString(),
        riskLevel: respData.riskLevel,
        nepraCategory: respData.nepraCategory,
      };
      if (response.questionId) {
        loadedResponses[response.questionId] = response;
      } else {
        console.warn(`Response document ${docSnap.id} in session ${sessionId} is missing 'questionId'. Storing by doc ID.`);
        loadedResponses[docSnap.id] = { ...response, questionId: docSnap.id };
      }
    });
    
    const fullSession: ComplianceSession = {
        ...baseSession,
        responses: loadedResponses,
    };

    console.log(`Firebase: Session ${sessionId} and ${Object.keys(fullSession.responses).length} responses retrieved.`);
    return fullSession;
  } catch (error) {
    console.error(`Firebase: Error getting session ${sessionId}:`, error);
    throw error;
  }
};

/**
 * Uploads report content (Markdown string or a File object) to Firebase Storage.
 * Returns the download URL of the uploaded file.
 * Path example: reports/{sessionId}/your_report_name.md or .pdf
 */
export const uploadReportToStorage = async (
  sessionId: string,
  reportContentOrFile: string | File,
  reportName?: string
): Promise<string> => {
  if (!storage) throw new Error("Firebase Storage not initialized. Check Firebase configuration.");
  if (!sessionId) {
    throw new Error('Missing sessionId. Cannot upload report.');
  }

  let fullReportName: string;
  let contentType: string | undefined;

  if (typeof reportContentOrFile === 'string') {
    fullReportName = reportName || `nepra_compliance_report_${sessionId}.md`;
    contentType = 'text/markdown';
  } else {
    fullReportName = reportName || reportContentOrFile.name || `nepra_compliance_report_${sessionId}.pdf`; // Default to .pdf if File and no name
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
    console.log(`Firebase: Report for session ${sessionId} (${fullReportName}) uploaded to ${downloadURL}`);
    return downloadURL;
  } catch (error) {
    console.error(`Firebase: Error uploading report ${fullReportName} for session ${sessionId}:`, error);
    throw error;
  }
};

/*
=== Firestore Security Rules Suggestions ===
Ensure these are adapted to your specific authentication model (e.g., anonymous auth, custom tokens).
This example assumes you might use Firebase Anonymous Authentication and store `request.auth.uid`
in your `sessions/{sessionId}` document as an `ownerUid` field or similar.

service cloud.firestore {
  match /databases/{database}/documents {

    // Example 'questions' collection if you predefine them
    // match /questions/{questionId} {
    //   allow read: if true; // Allow public read
    //   allow write: if request.auth != null && request.auth.token.admin === true; // Admins only
    // }

    match /sessions/{sessionId} {
      // Allow create if the user is authenticated (e.g., anonymously)
      // and the request.auth.uid matches an 'ownerUid' being set in the document.
      // For a simpler model, if sessionId itself IS the anonymous user's UID:
      // allow create: if request.auth.uid == sessionId;
      // Or, more broadly for anonymous users to initiate:
      allow create: if request.auth != null;


      // Allow read, update if the user "owns" the session.
      // This implies storing request.auth.uid (e.g., as userProfile.uid or a top-level ownerUid)
      // in the session document when it's created.
      allow read, update: if request.auth != null && request.auth.uid == resource.data.userProfile.uid;
                          // Replace 'userProfile.uid' with the actual field storing the auth UID.
                          // If sessionId is the user's auth UID: allow read, update: if request.auth.uid == sessionId;

      // Restrict delete, perhaps to admins or specific conditions
      allow delete: if request.auth != null && request.auth.token.admin === true;


      match /responses/{responseId} {
        // Allow create if the user owns the parent session.
        allow create: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid;
        
        // Allow read if the user owns the parent session.
        allow read: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid;
        
        // Disallow direct update/delete of individual responses to maintain audit trail.
        allow update, delete: if false;
      }
    }
  }
}

=== Firebase Storage Security Rules Suggestions ===
service firebase.storage {
  match /b/{bucket}/o {
    // Reports: reports/{sessionId}/{reportFilename}
    match /reports/{sessionId}/{reportFilename} {
      // Allow write (upload) if the user owns the session.
      // This requires the client to be authenticated and for you to verify ownership.
      // A common pattern is to set custom metadata during upload containing the owner's UID.
      // request.resource.metadata.ownerUid == request.auth.uid
      // Alternatively, if uploads are done by a trusted backend (Firebase Function):
      // allow write: if request.auth.token.admin === true; // Or service account
      allow write: if request.auth != null && get(/databases/(default)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid;
                   // This rule reads Firestore to verify ownership. Ensure your Firestore rules allow this read for the service.

      // Allow read if the user owns the session or has an admin role.
      // Similar to write, can use custom metadata or Firestore lookup.
      allow read: if request.auth != null && 
                    (get(/databases/(default)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid ||
                     request.auth.token.admin === true); // Example for admin access

      // Note: `request.auth.token.admin === true` assumes you have custom claims set up for admin users.
      // Replace `userProfile.uid` with how you store the Firebase Auth UID in your session document.
    }
  }
}

NOTE: The security rules above are examples and need to be carefully tailored to your
specific authentication mechanism (anonymous, email/password, custom tokens) and authorization logic.
For anonymous sessions, managing "ownership" securely requires careful design. Often, session IDs
are generated server-side or linked to unguessable tokens. If using Firebase Anonymous Auth,
`request.auth.uid` can be used as a stable identifier for the anonymous user.
You would typically store this `uid` in your `UserProfile` or directly in the `Session` document as an `ownerUid`.
Then, rules would check `request.auth.uid == resource.data.ownerUid`.
The `userProfile.uid` in the example rules assumes you add a `uid` field to your `UserProfile` type
and populate it with `firebase.auth().currentUser.uid` (or equivalent for v9).
If `userProfile` is not tied to Firebase Auth UIDs, then rules based on `sessionId` claims
in custom tokens or other secure methods would be needed.
The provided rules are a starting point and placeholder for robust security implementation.
*/
