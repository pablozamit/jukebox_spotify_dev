// src/lib/firebaseAdmin.ts
import * as admin from 'firebase-admin';

// Log environment variables at the start to ensure they are loaded
console.log('Firebase Admin Init: Checking Environment Variables...');
console.log('DATABASE_URL:', process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL);
console.log('PROJECT_ID:', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
// You might need GOOGLE_APPLICATION_CREDENTIALS if not using ADC automatically
console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

// Evita inicializaciones múltiples en desarrollo
if (!admin.apps.length) {
  try {
    // Lee las variables necesarias
    const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID; // Keep reading projectId for logging/potential use

    if (!databaseURL) {
      throw new Error("Missing Firebase DATABASE_URL in environment variables.");
    }
     if (!projectId) {
         // Log a warning but don't necessarily throw if ADC is expected to work
        console.warn("Firebase PROJECT_ID environment variable is missing. Relying solely on ADC or service account.");
     }

    // Inicializa SIN credenciales explícitas y SIN projectId explícito.
    // Rely purely on Application Default Credentials (ADC) or a service account key file
    // specified by GOOGLE_APPLICATION_CREDENTIALS environment variable.
    console.log('Attempting Firebase Admin SDK Initialization using ADC...');
    admin.initializeApp({
      databaseURL: databaseURL,
      // projectId: projectId, // REMOVED - Let ADC determine the project ID
      // NO incluimos la opción 'credential'
    });

    console.log('Firebase Admin SDK Initialized successfully (using ADC or GOOGLE_APPLICATION_CREDENTIALS) (from lib/firebaseAdmin.ts)');

  } catch (error: any) {
     console.error("Firebase Admin SDK Initialization Error:", error.message, error.stack);
     // Optionally re-throw or handle the error appropriately
     // Depending on the context, you might not want the server to crash
     // throw error; // Uncomment to make initialization failure fatal
  }
} else {
    console.log('Firebase Admin SDK already initialized.');
}

// Exporta solo los servicios que necesites desde el Admin SDK
let adminDbInstance: admin.database.Database | null = null; // Initialize as null
try {
    // Only attempt to get DB instance if initialization likely succeeded (apps array is not empty)
    if (admin.apps.length > 0) {
       adminDbInstance = admin.database();
       console.log('Successfully obtained Firebase Admin Database instance.');
    } else {
       console.warn('Skipping getting DB instance because Firebase Admin SDK might not be initialized.');
    }
} catch (error) {
    console.error("Failed to get Firebase Admin Database instance. Was initialization successful?", error);
    // Don't throw here, allow the app to potentially continue if DB is not strictly needed everywhere
    // throw new Error("Could not get Firebase Admin Database instance.");
}

export const adminDb = adminDbInstance;
// export const adminAuth = admin.auth(); // Uncomment if needed
