// src/lib/firebaseAdmin.ts
console.log('Executing firebaseAdmin.ts');

import * as admin from 'firebase-admin';

console.log('Firebase Admin Init: Starting initialization...');
console.log('GOOGLE_APPLICATION_CREDENTIALS_JSON loaded:', !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
console.log('FIREBASE_DATABASE_URL:', process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL);

if (!admin.apps.length) {
  try {
    const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
    const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

    if (!databaseURL || !json) {
      throw new Error("Missing DATABASE_URL or GOOGLE_APPLICATION_CREDENTIALS_JSON.");
    }

    console.log('Raw GOOGLE_APPLICATION_CREDENTIALS_JSON:', json);
    const serviceAccount = JSON.parse(json);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL,
    });

    console.log('Parsed service account:', serviceAccount);
    console.log('✅ Firebase Admin SDK initialized successfully (from src/lib/firebaseAdmin.ts)');
  } catch (error: any) {
    console.error("🔥 Firebase Admin SDK Initialization Error:", error.message, error.stack);
  }
} else {
  console.log('Firebase Admin SDK already initialized.');
}

let adminDbInstance: admin.database.Database | null = null;

try {
  if (admin.apps.length > 0) {
    adminDbInstance = admin.database();
    console.log('✅ Firebase Admin Realtime Database instance ready.');
  } else {
    console.warn('⚠️ Firebase Admin SDK not initialized, cannot get DB instance.');
  }
} catch (error) {
  console.error("🔥 Failed to get Firebase Admin Database instance:", error);
}

export const adminDb = adminDbInstance;
