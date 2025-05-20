
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
import { getAnalytics, type Analytics } from 'firebase/analytics'; // Added for Firebase Analytics

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
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, // Added for Analytics
};

// Initialize Firebase
let app: FirebaseApp | null = null;
export let isFirebaseInitialized: boolean;
let analytics: Analytics | null = null; // Added for Firebase Analytics

if (typeof window !== 'undefined') { // Ensure this runs only in the client-side context
  if (!getApps().length) {
    if (firebaseConfig.apiKey && firebaseConfig.projectId) { // Basic check for config presence
      try {
        app = initializeApp(firebaseConfig);
        analytics = getAnalytics(app); // Initialize Analytics
        console.log("Firebase and Analytics initialized successfully.");
        isFirebaseInitialized = true;
      } catch (e) {
        console.error("Error initializing Firebase or Analytics:", e);
        isFirebaseInitialized = false;
        app = null; // Ensure app is null if init fails
        analytics = null; // Ensure analytics is null if init fails
      }
    } else {
      console.error("Firebase configuration is missing. Firebase not initialized.");
      isFirebaseInitialized = false;
      app = null;
      analytics = null;
    }
  } else {
    app = getApp(); // Get the default app if already initialized
    analytics = getAnalytics(app); // Initialize Analytics with existing app
    console.log("Firebase app already initialized, using existing instance. Analytics initialized.");
    isFirebaseInitialized = true; // If apps exist, assume it was successful before or by another part of the app
  }
} else {
  // Server-side or during build, Firebase might not be needed or initialized here
  console.warn("Firebase initialization skipped: not in a client-side context or Firebase already initialized by another means.");
  isFirebaseInitialized = getApps().length > 0;
  if (isFirebaseInitialized && !app) {
    app = getApp(); // Try to get app if already initialized
    if (app && typeof window !== 'undefined') { // Check window again before getAnalytics
        analytics = getAnalytics(app);
    }
  }
}


// Assign db and storage only if app was initialized
const db: Firestore = app ? getFirestore(app) : (null as unknown as Firestore);
const storage: FirebaseStorage = app ? getStorage(app) : (null as unknown as FirebaseStorage);


if (!app || !db || !storage) {
  if (isFirebaseInitialized && (typeof window !== 'undefined') ) { // Added window check for console.error
      console.error("Firebase services (Firestore/Storage) not available, despite app initialization. Check service setup.");
  }
}

export { db, storage, app, analytics }; // Export app and analytics as well


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
    // Create a serializable copy of sessionData
    const { responses, ...sessionDocDataSansResponses } = JSON.parse(JSON.stringify(sessionData));

    const firestoreReadySessionData = {
      ...sessionDocDataSansResponses,
      userProfile: sessionData.userProfile, // Already part of sessionData
      questions: sessionData.questions, // Already part of sessionData
      startTime: Timestamp.fromDate(new Date(sessionData.startTime)),
      lastSavedTime: sessionData.lastSavedTime ? Timestamp.fromDate(new Date(sessionData.lastSavedTime)) : Timestamp.now(),
      completedTime: sessionData.completedTime ? Timestamp.fromDate(new Date(sessionData.completedTime)) : null,
      currentQuestionIndex: sessionData.currentQuestionIndex, // Already part of sessionData
      status: sessionData.status, // Already part of sessionData
      reportGenerated: sessionData.reportGenerated, // Already part of sessionData
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
  dataToUpdate: Partial<Omit<ComplianceSession, 'responses'>> // Responses are handled by addResponseToSession
): Promise<void> => {
  if (!db) throw new Error("Firestore not initialized. Check Firebase configuration.");
  if (!sessionId) throw new Error("Session ID is required to update a session.");

  try {
    const sessionRef = doc(db, 'sessions', sessionId);
    // Create a shallow copy to avoid modifying the original object, especially for date conversions
    const updatePayload: Record<string, any> = { ...dataToUpdate };

    // Convert specific date fields from string to Firestore Timestamp if they exist
    if (dataToUpdate.startTime && typeof dataToUpdate.startTime === 'string') {
      updatePayload.startTime = Timestamp.fromDate(new Date(dataToUpdate.startTime));
    }
    // Always update lastSavedTime to current time on any update
    updatePayload.lastSavedTime = Timestamp.now();
    
    if (dataToUpdate.completedTime && typeof dataToUpdate.completedTime === 'string') {
      updatePayload.completedTime = Timestamp.fromDate(new Date(dataToUpdate.completedTime));
    }
    
    // If questions are part of the update, ensure they are correctly structured
    if (dataToUpdate.questions) {
        // Assuming questions are already in the correct QuestionDefinition[] format
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
 * Path: /sessions/{sessionId}/responses/{auto_generated_id_or_questionId}
 * Returns the ID of the newly created/updated response document.
 * This function now uses setDoc with questionId as the document ID for easier updates/overwrites if needed.
 */
export const addResponseToSession = async (
  sessionId: string,
  responseData: ResponseData
): Promise<string> => {
  if (!db) throw new Error("Firestore not initialized. Check Firebase configuration.");
  if (!sessionId) throw new Error("Session ID is required to add a response.");
  if (!responseData.questionId) throw new Error("Question ID is required to add a response.");

  try {
    // Use questionId as the document ID within the responses subcollection for idempotency
    const responseRef = doc(db, 'sessions', sessionId, 'responses', responseData.questionId);
    const dataToSave = {
      ...responseData,
      timestamp: Timestamp.fromDate(new Date(responseData.timestamp)),
    };
    await setDoc(responseRef, dataToSave); // Using setDoc to create or overwrite
    console.log(`Firebase: Response for session ${sessionId} (question ${responseData.questionId}) saved/updated.`);
    
    // Update the main session document's lastSavedTime
    await updateDoc(doc(db, 'sessions', sessionId), { lastSavedTime: Timestamp.now() });
    return responseData.questionId; // Return the questionId which is used as doc ID
  } catch (error) {
    console.error(`Firebase: Error adding response to session ${sessionId} for question ${responseData.questionId}:`, error);
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
    // Construct the base session object from Firestore data
    const baseSession: ComplianceSession = {
      sessionId: sessionSnap.id,
      userProfile: dbData.userProfile as UserProfile,
      questions: (dbData.questions || []) as QuestionDefinition[], // Ensure questions is an array
      currentQuestionIndex: (dbData.currentQuestionIndex || 0) as number,
      startTime: (dbData.startTime as Timestamp).toDate().toISOString(),
      lastSavedTime: dbData.lastSavedTime ? (dbData.lastSavedTime as Timestamp).toDate().toISOString() : undefined,
      completedTime: dbData.completedTime ? (dbData.completedTime as Timestamp).toDate().toISOString() : undefined,
      status: dbData.status as ComplianceSession['status'],
      reportGenerated: (dbData.reportGenerated || false) as boolean,
      reportUrl: dbData.reportUrl as string | undefined,
      responses: {} // Initialize responses, to be filled next
    };

    // Fetch responses from the subcollection
    const responsesCollectionRef = collection(db, 'sessions', sessionId, 'responses');
    const responsesQueryInstance = firestoreQuery(responsesCollectionRef); // No specific query needed if fetching all
    const responsesSnap = await getDocs(responsesQueryInstance);

    const loadedResponses: Record<string, ResponseData> = {};
    responsesSnap.forEach((docSnap) => {
      const respData = docSnap.data();
      const response: ResponseData = {
        questionId: respData.questionId || docSnap.id, // Use docSnap.id as fallback if questionId field is missing
        questionText: respData.questionText,
        answerText: respData.answerText,
        timestamp: (respData.timestamp as Timestamp).toDate().toISOString(),
        riskLevel: respData.riskLevel,
        nepraCategory: respData.nepraCategory,
      };
      // Key responses by their questionId for easy lookup
      loadedResponses[response.questionId] = response;
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
  reportContentOrFile: string | File, // Can be Markdown string or a File object for PDF
  reportName?: string // Optional: e.g., "compliance_report.md" or "compliance_report.pdf"
): Promise<string> => {
  if (!storage) throw new Error("Firebase Storage not initialized. Check Firebase configuration.");
  if (!sessionId) {
    throw new Error('Missing sessionId. Cannot upload report.');
  }

  let fullReportName: string;
  let contentType: string | undefined;

  if (typeof reportContentOrFile === 'string') {
    // Handling Markdown string
    fullReportName = reportName || `nepra_compliance_report_${sessionId}.md`;
    contentType = 'text/markdown';
  } else {
    // Handling File object (e.g., for PDF)
    fullReportName = reportName || reportContentOrFile.name || `nepra_compliance_report_${sessionId}.pdf`; // Default to .pdf if File and no name
    contentType = reportContentOrFile.type || (fullReportName.endsWith('.pdf') ? 'application/pdf' : undefined);
  }

  const storageRef = ref(storage, `reports/${sessionId}/${fullReportName}`);

  try {
    if (typeof reportContentOrFile === 'string') {
      await uploadString(storageRef, reportContentOrFile, 'raw', contentType ? { contentType } : undefined);
    } else {
      // Assuming reportContentOrFile is a File object
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
in your `sessions/{sessionId}` document as an `ownerUid` field or similar, or if the `sessionId` itself
is tied to the user's identity in a verifiable way (e.g., if sessionId IS the auth UID).

service cloud.firestore {
  match /databases/{database}/documents {

    // Sessions Collection
    match /sessions/{sessionId} {
      // Allow create if the user is authenticated (e.g., anonymously)
      // For a simple anonymous model, sessionId could be the request.auth.uid or a claim in a custom token.
      // If using Firebase Anonymous Auth, request.auth.uid would be the anonymous user's ID.
      // Assume session documents store an 'ownerUid' field matching request.auth.uid.
      allow create: if request.auth != null && request.resource.data.userProfile.uid == request.auth.uid;
                    // Ensure userProfile.uid is populated with Firebase Auth UID on client.

      // Allow read, update if the user "owns" the session.
      allow read, update: if request.auth != null && resource.data.userProfile.uid == request.auth.uid;

      // Optionally, allow admins to read/write (requires custom claims for admin role).
      // allow read, write: if request.auth != null && (resource.data.userProfile.uid == request.auth.uid || request.auth.token.admin === true);

      // Restrict delete, perhaps to admins or specific conditions.
      allow delete: if request.auth != null && request.auth.token.admin === true; // Example: Admins only

      // Responses Subcollection
      match /responses/{responseId} {
        // Allow create if the user owns the parent session.
        allow create: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid;
        
        // Allow read if the user owns the parent session.
        allow read: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid;
        
        // Allow update if the user owns the parent session (e.g., to correct an answer).
        // Consider if updates should be allowed or if responses are immutable once submitted.
        allow update: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid;

        // Disallow delete of individual responses to maintain audit trail, unless by admin.
        allow delete: if request.auth != null && request.auth.token.admin === true;
      }
    }

    // Optional 'questions' collection if you predefine them and want to manage them via Firestore
    // match /questions/{questionId} {
    //   allow read: if true; // Or `if request.auth != null;` if only authenticated users can see questions
    //   allow write: if request.auth != null && request.auth.token.admin === true; // Admins only
    // }
  }
}

=== Firebase Storage Security Rules Suggestions ===
service firebase.storage {
  match /b/{bucket}/o {
    // Reports: reports/{sessionId}/{reportFilename}
    match /reports/{sessionId}/{reportFilename} {
      // Allow write (upload) if the user owns the session.
      // This requires verifying ownership, e.g., by checking Firestore.
      allow write: if request.auth != null &&
                     exists(/databases/(default)/documents/sessions/$(sessionId)) &&
                     get(/databases/(default)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid;
                     // Ensure Firestore rules allow this read for the service.

      // Allow read if the user owns the session OR is an admin.
      allow read: if request.auth != null && (
                    (exists(/databases/(default)/documents/sessions/$(sessionId)) &&
                     get(/databases/(default)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid) ||
                    request.auth.token.admin === true // Example for admin access
                  );

      // Note: `request.auth.token.admin === true` assumes you have custom claims set up for admin users.
      // Replace `userProfile.uid` with how you store the Firebase Auth UID in your session document.
      // If not using Firebase Auth directly for user identification, adapt these rules for your auth mechanism.
    }
  }
}

NOTE: The security rules above are examples and need to be carefully tailored to your
specific authentication mechanism (anonymous, email/password, custom tokens) and authorization logic.
For anonymous sessions, managing "ownership" securely requires careful design. If using Firebase Anonymous Auth,
`request.auth.uid` can be used as a stable identifier. You would typically store this `uid`
in your `UserProfile` object (e.g., as `userProfile.uid`) within the `Session` document.
Then, rules would check `request.auth.uid == resource.data.userProfile.uid`.
The provided rules are a starting point and placeholder for robust security implementation.
You must also ensure your UserProfile type includes a 'uid' field if using this approach.
*/

