
// import { initializeApp, getApp, FirebaseApp } from 'firebase/app';
// import { getFirestore, doc, setDoc, getDoc, Firestore, updateDoc, collection, addDoc } from 'firebase/firestore';
// import { getStorage, ref, uploadString, getDownloadURL, FirebaseStorage } from 'firebase/storage';
import type { NepraSessionData, UserProfile, NepraAnswer } from './types';

// TODO: Add your Firebase configuration here
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// let app: FirebaseApp;
// let db: Firestore;
// let storage: FirebaseStorage;

// try {
//   app = getApp();
// } catch (e) {
//   app = initializeApp(firebaseConfig);
// }

// db = getFirestore(app);
// storage = getStorage(app);

/**
 * NOTE: These are placeholder functions.
 * You will need to install and configure the Firebase SDK for these to work.
 * Example: `npm install firebase`
 * And then uncomment the imports and Firebase initialization code above.
 * Ensure your Firebase project has Firestore and Storage enabled and configured
 * with appropriate security rules.
 */

// Firestore Service Stubs

/**
 * Saves or updates a user's session data in Firestore.
 * The document ID will be the session.sessionId.
 * Collection path: /departments/{department}/roles/{role}/sessions/{sessionId}
 * Or a simpler path: /nepraSessions/{sessionId}
 */
export const saveSessionToFirestore = async (sessionData: NepraSessionData): Promise<void> => {
  console.log('Mock Firestore: Attempting to save session', sessionData.sessionId, sessionData);
  if (!sessionData.userProfile.department || !sessionData.userProfile.role || !sessionData.sessionId) {
    console.error('Mock Firestore: Missing department, role, or sessionId. Cannot save.');
    return Promise.reject(new Error('Missing department, role, or sessionId.'));
  }
  // const sessionDocRef = doc(db, 'departments', sessionData.userProfile.department, 'roles', sessionData.userProfile.role, 'sessions', sessionData.sessionId);
  // For simplicity, using a single collection for all sessions:
  // const sessionDocRef = doc(db, 'nepraSessions', sessionData.sessionId);
  // await setDoc(sessionDocRef, sessionData, { merge: true });
  console.log(`Mock Firestore: Session ${sessionData.sessionId} data would be saved/merged.`);
  return Promise.resolve();
};

/**
 * Loads a user's session data from Firestore using the sessionId.
 */
export const loadSessionFromFirestore = async (sessionId: string): Promise<NepraSessionData | null> => {
  console.log('Mock Firestore: Attempting to load session', sessionId);
  // This is a mock. In a real scenario, you'd query Firestore.
  // Example structure of a path, adjust as per your Firestore structure:
  // const sessionDocRef = doc(db, 'nepraSessions', sessionId);
  // const docSnap = await getDoc(sessionDocRef);
  // if (docSnap.exists()) {
  //   return docSnap.data() as NepraSessionData;
  // }
  console.warn(`Mock Firestore: Session ${sessionId} not found. Returning null.`);
  return Promise.resolve(null);
};

/**
 * Adds a single answer to a session's answers array/map in Firestore.
 * This might be more efficient than saving the whole session object each time.
 */
export const addAnswerToSessionInFirestore = async (
  sessionId: string,
  department: string,
  role: string,
  questionIndex: number,
  answer: NepraAnswer
): Promise<void> => {
  console.log(`Mock Firestore: Adding answer to session ${sessionId}, qIndex ${questionIndex}`, answer);
  // const sessionDocRef = doc(db, 'departments', department, 'roles', role, 'sessions', sessionId);
  // const sessionDocRef = doc(db, 'nepraSessions', sessionId);
  // Field path for map: `answers.${questionIndex}`
  // await updateDoc(sessionDocRef, {
  //   [`answers.${questionIndex}`]: answer,
  //   lastSavedTime: new Date().toISOString(),
  // });
  console.log(`Mock Firestore: Answer for question ${questionIndex} in session ${sessionId} would be updated.`);
  return Promise.resolve();
};


// Firebase Storage Service Stubs

/**
 * Uploads the generated report content (Markdown string) to Firebase Storage.
 * Returns the download URL of the uploaded file.
 * Path: reports/{sessionId}/{reportName}.md
 */
export const uploadReportToStorage = async (
  sessionId: string,
  reportContent: string,
  reportName: string = `nepra_compliance_report_${sessionId}.md`
): Promise<string> => {
  console.log('Mock Storage: Attempting to upload report for session', sessionId);
  if (!sessionId) {
    console.error('Mock Storage: Missing sessionId. Cannot upload report.');
    return Promise.reject(new Error('Missing sessionId for report upload.'));
  }
  // const reportRef = ref(storage, `reports/${sessionId}/${reportName}`);
  // await uploadString(reportRef, reportContent, 'raw'); // 'raw' for string, or use 'data_url' if it's base64
  // const downloadURL = await getDownloadURL(reportRef);
  const mockDownloadURL = `https://storage.example.com/reports/${sessionId}/${reportName}`;
  console.log(`Mock Storage: Report for session ${sessionId} would be uploaded. Mock URL: ${mockDownloadURL}`);
  // return downloadURL;
  return Promise.resolve(mockDownloadURL);
};

// You might also want functions to list reports for an admin panel, etc.
// These are highly dependent on your Firestore structure and admin requirements.

console.log("Mock Firebase Services Initialized (Stubs)");
// To enable real Firebase:
// 1. Fill firebaseConfig with your project details (ideally from .env.local).
// 2. Uncomment Firebase SDK imports and initialization code at the top.
// 3. Ensure Firebase is set up in your project (`npm install firebase`).
// 4. Configure Firestore/Storage rules in the Firebase console.
