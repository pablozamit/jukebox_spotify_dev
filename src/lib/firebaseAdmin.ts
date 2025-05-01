// src/lib/firebaseAdmin.ts
import * as admin from 'firebase-admin';

// Evita inicializaciones múltiples en desarrollo
if (!admin.apps.length) {
  try {
    // Asegúrate de que las variables de entorno del SERVIDOR estén disponibles aquí
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID; // Puedes usar NEXT_PUBLIC_ si ya lo tienes
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL; // Puedes usar NEXT_PUBLIC_ si ya lo tienes

    if (!projectId || !clientEmail || !privateKey || !databaseURL) {
        throw new Error("Missing Firebase Admin SDK credentials in server environment variables (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY, DATABASE_URL)");
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: projectId,
        clientEmail: clientEmail,
        // ¡IMPORTANTE! Reemplaza los \\n escapados del .env por \n reales
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
      databaseURL: databaseURL,
    });
    console.log('Firebase Admin SDK Initialized (from lib/firebaseAdmin.ts)');
  } catch (error: any) {
     console.error("Firebase Admin SDK Initialization Error in firebaseAdmin.ts:", error.message);
     // Puedes decidir si quieres lanzar el error o simplemente loggearlo
     // throw error;
  }
}

// Exporta solo los servicios que necesites desde el Admin SDK
// Asegúrate de que la inicialización haya ocurrido antes de intentar acceder a la DB
let adminDbInstance: admin.database.Database;
try {
    adminDbInstance = admin.database();
} catch (error) {
    console.error("Failed to get Firebase Admin Database instance. Was initialization successful?", error);
    // Lanza un error o maneja esto como prefieras, pero usar la DB fallará si la app no se inicializó.
    throw new Error("Could not get Firebase Admin Database instance.");
}

export const adminDb = adminDbInstance;
// export const adminAuth = admin.auth(); // Exporta si necesitas Auth de admin