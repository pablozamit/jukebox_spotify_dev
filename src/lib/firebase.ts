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

// Client-side check for environment variables (for debugging)
if (typeof window !== 'undefined') {
    console.log("Firebase Config Loaded (Client):", {
        apiKey: firebaseConfig.apiKey ? 'Exists' : 'MISSING',
        authDomain: firebaseConfig.authDomain || 'MISSING',
        databaseURL: firebaseConfig.databaseURL || 'MISSING',
        projectId: firebaseConfig.projectId || 'MISSING',
        // Add others if needed for debugging
    });
}


function initializeFirebaseApp(): { app: FirebaseApp | null, dbValid: boolean } {
    let app: FirebaseApp | null = null;
    let dbValid = true; // Assume valid initially

    // Ensure required config values are present for basic app initialization
    if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
        console.error("Firebase config is missing required fields (apiKey, authDomain, projectId). Check your .env file and ensure variables are prefixed with NEXT_PUBLIC_ if used client-side.");
        // Throw an error here because basic initialization will fail
        throw new Error("Firebase configuration is incomplete for core services.");
    }

    // Check databaseURL validity separately without throwing an error immediately
    if (!firebaseConfig.databaseURL || !firebaseConfig.databaseURL.startsWith('https://')) {
        console.warn(`Firebase NEXT_PUBLIC_FIREBASE_DATABASE_URL ("${firebaseConfig.databaseURL}") is missing or invalid in .env. It should start with 'https://'. Firebase Realtime Database features will be disabled.`);
        dbValid = false; // Mark database as invalid
    }

    try {
        if (!getApps().length) {
            console.log("Initializing Firebase App...");
            app = initializeApp(firebaseConfig);
            console.log("Firebase App Initialized.");
        } else {
            app = getApp();
            console.log("Using existing Firebase App instance.");
        }
    } catch (error) {
        console.error("Failed to initialize Firebase App:", error);
        throw new Error("Firebase App initialization failed."); // Throw if core init fails
    }

    return { app, dbValid };
}

let firebaseApp: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null; // Declaramos db como Database | null inicialmente
let isDbValid = false; // Track if DB config was valid during init

try {
    const initResult = initializeFirebaseApp();
    firebaseApp = initResult.app;
    isDbValid = initResult.dbValid;

    if (firebaseApp) {
        // Attempt to initialize Auth only if app is valid
        try {
            auth = getAuth(firebaseApp);
            console.log("Firebase Authentication Initialized.");
        } catch (authError) {
            console.error("Failed to initialize Firebase Authentication:", authError);
            // Decide if auth failure is critical. Here, we'll let the app continue but auth features won't work.
            auth = null;
        }

        // Only initialize Database if the app is valid AND the DB URL was valid during the check
        if (isDbValid && firebaseApp) { // Double check firebaseApp is not null
            try {
                db = getDatabase(firebaseApp);
                console.log("Firebase Realtime Database Initialized.");
            } catch (dbError) {
                console.error("Failed to initialize Firebase Realtime Database, even though URL seemed valid:", dbError);
                db = null;
                isDbValid = false;
            }
        } else if (!isDbValid) {
            console.log("Skipping Firebase Realtime Database initialization due to invalid DATABASE_URL config.");
        }
    }

} catch (error) {
    // Error during initializeFirebaseApp (config issues)
    // Error message already logged within initializeFirebaseApp
    // Set instances to null so checks elsewhere fail gracefully
    console.error("Critical error during Firebase initialization process.", error);
    firebaseApp = null;
    auth = null;
    db = null;
    isDbValid = false;
}


export { firebaseApp, auth, db, isDbValid };