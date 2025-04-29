// src/lib/firebase.ts
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getDatabase, Database } from 'firebase/database';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function initializeFirebaseApp(): { app: FirebaseApp | null, dbValid: boolean } {
    let app: FirebaseApp | null = null;
    let dbValid = true; // Assume valid initially

    // Ensure required config values are present for basic app initialization
    if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
        console.error("Firebase config is missing required fields (apiKey, authDomain, projectId). Check your .env file.");
        // Throw an error here because basic initialization will fail
        throw new Error("Firebase configuration is incomplete for core services.");
    }

    // Check databaseURL validity separately without throwing an error immediately
     if (!firebaseConfig.databaseURL || !firebaseConfig.databaseURL.startsWith('https://')) {
         console.warn("Firebase databaseURL is missing or invalid in .env. It should start with 'https://'. Firebase Realtime Database features will be disabled.");
         dbValid = false; // Mark database as invalid
     }

    try {
        if (!getApps().length) {
            app = initializeApp(firebaseConfig);
        } else {
            app = getApp();
        }
    } catch (error) {
        console.error("Failed to initialize Firebase App:", error);
        throw new Error("Firebase App initialization failed."); // Throw if core init fails
    }

    return { app, dbValid };
}

let firebaseApp: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;
let isDbValid = false; // Track if DB config was valid during init

try {
    const initResult = initializeFirebaseApp();
    firebaseApp = initResult.app;
    isDbValid = initResult.dbValid;

    if (firebaseApp) {
        auth = getAuth(firebaseApp); // Initialize Auth if app is valid

        // Only initialize Database if the app is valid AND the DB URL was valid
        if (isDbValid) {
           db = getDatabase(firebaseApp);
        }
    }

} catch (error) {
    // Error already logged in initializeFirebaseApp or during getAuth/getDatabase
    // Set instances to null so checks elsewhere fail gracefully
    firebaseApp = null;
    auth = null;
    db = null;
    isDbValid = false;
}


export { firebaseApp, auth, db, isDbValid }; // Export isDbValid if needed elsewhere
