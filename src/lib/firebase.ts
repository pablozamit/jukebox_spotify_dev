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

function initializeFirebaseApp(): FirebaseApp {
    // Ensure required config values are present
    if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
        console.error("Firebase config is missing required fields (apiKey, authDomain, projectId). Check your .env file.");
        // Throw an error or return a dummy object to prevent further issues
        // depending on how gracefully you want the app to fail.
        throw new Error("Firebase configuration is incomplete.");
    }
    // Specifically check databaseURL as it caused the original error
     if (!firebaseConfig.databaseURL || !firebaseConfig.databaseURL.startsWith('https://')) {
         console.error("Firebase databaseURL is missing or invalid. Check your .env file. It should start with 'https://'.");
         throw new Error("Invalid Firebase databaseURL configuration.");
     }


    if (!getApps().length) {
        return initializeApp(firebaseConfig);
    } else {
        return getApp();
    }
}

let firebaseApp: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;

try {
    firebaseApp = initializeFirebaseApp();
    auth = getAuth(firebaseApp);
    // Only get database if URL is valid
    if (firebaseConfig.databaseURL) {
       db = getDatabase(firebaseApp);
    } else {
        console.warn("Firebase Database URL not configured, database features will be unavailable.");
    }

} catch (error) {
    console.error("Failed to initialize Firebase:", error);
    // Set instances to null so checks elsewhere fail gracefully
    firebaseApp = null;
    auth = null;
    db = null;
}


export { firebaseApp, auth, db };
