
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
let app: FirebaseApp;
if (!getApps().length) {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) { // Basic check for config presence
    app = initializeApp(firebaseConfig);
    console.log("Firebase initialized successfully.");
  } else {
    console.error("Firebase configuration is missing. Firebase not initialized.");
    // @ts-ignore
    app = null; // Ensure app is null if not initialized
  }
} else {
  app = getApp(); // Get the default app if already initialized
  console.log("Firebase app already initialized, using existing instance.");
}

// Assign db and storage only if app was initialized
const db: Firestore = app ? getFirestore(app) : (null as unknown as Firestore);
const storage: FirebaseStorage = app ? getStorage(app) : (null as unknown as FirebaseStorage);


if (!app || !db || !storage) {
  console.error("Firebase services (Firestore/Storage) not available. Check Firebase initialization and configuration.");
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
    
    // Prepare data for Firestore: convert dates and exclude client-side 'responses' map
    const { responses, ...sessionDocDataSansResponses } = JSON.parse(JSON.stringify(sessionData));

    const firestoreReadySessionData = {
      ...sessionDocDataSansResponses,
      userProfile: sessionData.userProfile, // ensure userProfile is included
      questions: sessionData.questions, // ensure questions are included
      startTime: Timestamp.fromDate(new Date(sessionData.startTime)),
      lastSavedTime: sessionData.lastSavedTime ? Timestamp.fromDate(new Date(sessionData.lastSavedTime)) : Timestamp.now(),
      completedTime: sessionData.completedTime ? Timestamp.fromDate(new Date(sessionData.completedTime)) : null,
      // Ensure all other fields from ComplianceSession (like status, reportGenerated, etc.) are present
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
    throw error; // Re-throw to be handled by caller
  }
};

/**
 * Updates specific fields in a session document in Firestore.
 * Path: /sessions/{sessionId}
 */
export const updateComplianceSession = async (
  sessionId: string,
  dataToUpdate: Partial<Omit<ComplianceSession, 'responses'>> // Exclude responses from direct update here
): Promise<void> => {
  if (!db) throw new Error("Firestore not initialized. Check Firebase configuration.");
  if (!sessionId) throw new Error("Session ID is required to update a session.");

  try {
    const sessionRef = doc(db, 'sessions', sessionId);
    const updatePayload: Record<string, any> = { ...dataToUpdate };

    // Convert any date strings in dataToUpdate to Firestore Timestamps
    if (dataToUpdate.startTime && typeof dataToUpdate.startTime === 'string') {
      updatePayload.startTime = Timestamp.fromDate(new Date(dataToUpdate.startTime));
    }
    // Always update lastSavedTime on any substantive update
    updatePayload.lastSavedTime = Timestamp.now();
    
    if (dataToUpdate.completedTime && typeof dataToUpdate.completedTime === 'string') {
      updatePayload.completedTime = Timestamp.fromDate(new Date(dataToUpdate.completedTime));
    }
    
    // If 'questions' are being updated (e.g., after AI generates them)
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
      ...responseData, // Includes questionId, questionText, answerText, etc.
      timestamp: Timestamp.fromDate(new Date(responseData.timestamp)), // Convert ISO string to Firestore Timestamp
    };
    const docRef = await addDoc(responsesCollectionRef, dataToSave);
    console.log(`Firebase: Response for session ${sessionId} (question ${responseData.questionId}) saved with Firestore doc ID: ${docRef.id}.`);
    
    // Update the parent session's lastSavedTime
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
      questions: dbData.questions as QuestionDefinition[], // Ensure questions are stored/retrieved correctly
      currentQuestionIndex: dbData.currentQuestionIndex as number,
      startTime: (dbData.startTime as Timestamp).toDate().toISOString(),
      lastSavedTime: dbData.lastSavedTime ? (dbData.lastSavedTime as Timestamp).toDate().toISOString() : undefined,
      completedTime: dbData.completedTime ? (dbData.completedTime as Timestamp).toDate().toISOString() : undefined,
      status: dbData.status as ComplianceSession['status'],
      reportGenerated: dbData.reportGenerated as boolean,
      reportUrl: dbData.reportUrl as string | undefined,
      responses: {} // Initialize responses, to be populated from subcollection
    };

    // Fetch responses from the subcollection
    const responsesCollectionRef = collection(db, 'sessions', sessionId, 'responses');
    const responsesQueryInstance = firestoreQuery(responsesCollectionRef); // Consider orderBy('timestamp')
    const responsesSnap = await getDocs(responsesQueryInstance);

    const loadedResponses: Record<string, ResponseData> = {};
    responsesSnap.forEach((docSnap) => {
      const respData = docSnap.data();
      const response: ResponseData = {
        questionId: respData.questionId, // This is the ID of the question definition
        questionText: respData.questionText,
        answerText: respData.answerText,
        timestamp: (respData.timestamp as Timestamp).toDate().toISOString(),
        riskLevel: respData.riskLevel,
        nepraCategory: respData.nepraCategory,
      };
      // Key responses by their questionId for easy lookup as per ComplianceSession type
      if (response.questionId) {
        loadedResponses[response.questionId] = response;
      } else {
         // Fallback or error if questionId is missing in a response document
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
  reportContentOrFile: string | File, // Content as string (e.g., Markdown) or File object (e.g., PDF)
  reportName?: string // Recommended: e.g., "nepra_compliance_report.md" or "nepra_compliance_report.pdf"
): Promise<string> => {
  if (!storage) throw new Error("Firebase Storage not initialized. Check Firebase configuration.");
  if (!sessionId) {
    throw new Error('Missing sessionId. Cannot upload report.');
  }

  let fullReportName: string;
  let contentType: string | undefined; // Let uploadBytes/uploadString infer if possible, or set explicitly

  if (typeof reportContentOrFile === 'string') {
    fullReportName = reportName || `nepra_compliance_report_${sessionId}.md`;
    contentType = 'text/markdown';
  } else { // Assumes File object
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

service cloud.firestore {
  match /databases/{database}/documents {

    // Questions Collection (if you have one for predefined questions)
    // match /questions/{questionId} {
    //   allow read: if true; // Example: Allow public read if questions are not sensitive
    //   allow write: if request.auth != null && request.auth.token.admin === true; // Only admins can write
    // }

    // Sessions Collection
    match /sessions/{sessionId} {
      // Allow create if the user is creating their "own" session.
      // For anonymous auth, request.auth.uid would be the anonymous user's ID.
      // You might use this as the sessionId or store it in the session document.
      // If sessionId is client-generated and truly random, this rule might be more open initially,
      // but then read/write should be tightened.
      allow create: if request.auth != null; // Simplistic: user must be (anonymously) authenticated
                                          // Or, if sessionId is derived from request.auth.uid:
                                          // allow create: if request.auth.uid == sessionId;

      // Allow read, update if the user "owns" the session.
      // This typically means matching request.auth.uid with an 'ownerId' field in the document.
      // Or, if sessionId is linked to the user in a secure way (e.g., custom claim).
      allow read, update: if request.auth != null && request.auth.uid == resource.data.userProfile.uid; // Assuming userProfile.uid stores auth UID
                               // OR for a simpler anonymous model if sessionId itself is the key:
                               // allow read, update: if request.auth.uid == sessionId (if sessionId is the anon UID)
                               // Delete might be more restrictive.
      allow delete: if request.auth != null && request.auth.token.admin === true; // Only admins can delete sessions


      // Responses Subcollection
      match /responses/{responseId} {
        // User can create (add) responses to a session they own.
        allow create: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid;
        
        // User can read responses for a session they own.
        allow read: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid;
        
        // Generally, disallow direct update/delete of individual responses to maintain audit trail.
        allow update, delete: if false;
      }
    }
  }
}

=== Firebase Storage Security Rules Suggestions ===
service firebase.storage {
  match /b/{bucket}/o {
    match /reports/{sessionId}/{reportFilename} {
      // Allow creating (writing) reports if the user owns the session (similar to Firestore rules).
      // This assumes the client uploads the report, which might not be ideal for security.
      // Often, a Firebase Function with elevated privileges would write reports.
      // allow write: if request.auth != null && request.auth.uid == resource.metadata.ownerId; // Requires custom metadata on upload

      // A more common pattern for reports generated by backend/functions:
      allow write: if request.auth != null && request.auth.token.admin === true; // Or allow if written by a service account

      // Allow reading reports if the user owns the session or is an admin.
      // If reports are sensitive, direct client read might be disabled in favor of access via a Function.
      allow read: if request.auth != null && (request.auth.token.admin === true || request.auth.uid == resource.metadata.ownerId);
                  // (Requires ownerId to be set in custom metadata during upload)
                  // Or, if session doc has a flag:
                  // allow read: if request.auth != null && get(/databases/$(database)/documents/sessions/$(sessionId)).data.userProfile.uid == request.auth.uid;


      // Example rule if reports are uploaded by a trusted function (service account):
      // allow write: if false; // Client cannot write directly
      // allow read: if request.auth != null && request.auth.token.role == 'sps_analyst'; // Custom claim for analysts
    }
  }
}

NOTE: The security rules above are examples and need to be carefully tailored to your
specific authentication mechanism (anonymous, email/password, custom tokens) and authorization logic.
For anonymous sessions, managing "ownership" securely requires careful design. Often, session IDs
are generated server-side or linked to unguessable tokens. If using Firebase Anonymous Auth,
`request.auth.uid` can be used as a stable identifier for the anonymous user.
You would typically store this `uid` in your `UserProfile` or directly in the `Session` document as an `ownerId`.
Then, rules would check `request.auth.uid == resource.data.ownerId`.
The `userProfile.uid` in the example rules assumes you add a `uid` field to your `UserProfile` type
and populate it with `firebase.auth().currentUser.uid` (or equivalent for v9).
If `userProfile` is not tied to Firebase Auth UIDs, then rules based on `sessionId` claims
in custom tokens or other secure methods would be needed.
The provided rules are a starting point and placeholder for robust security implementation.
*/

// The old getNepraQuestions stub has been removed as it's not part of this update request
// and the app currently relies on AI for question generation.

    