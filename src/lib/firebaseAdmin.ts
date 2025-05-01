// src/lib/firebaseAdmin.ts (Versión ADC + ProjectID explícito)
import * as admin from 'firebase-admin';

// Evita inicializaciones múltiples en desarrollo
if (!admin.apps.length) {
  try {
    // Lee las variables necesarias
    const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
    // Leemos también el Project ID para pasarlo explícitamente
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

    if (!databaseURL) {
        throw new Error("Missing Firebase DATABASE_URL in environment variables.");
    }
    if (!projectId) {
        throw new Error("Missing Firebase PROJECT_ID in environment variables.");
    }

    // Inicializa SIN credenciales explícitas (usa ADC),
    // PERO añadiendo el projectId que a veces ayuda.
    admin.initializeApp({
      databaseURL: databaseURL,
      projectId: projectId, // <--- AÑADIDO projectId EXPLÍCITO
      // NO incluimos la opción 'credential'
    });

    console.log('Firebase Admin SDK Initialized using ADC (with explicit projectId) (from lib/firebaseAdmin.ts)');

  } catch (error: any) {
     console.error("Firebase Admin SDK Initialization Error (using ADC + explicit projectId):", error.message);
     // Relanzamos el error para detener la ejecución si falla
     throw error;
  }
}

// Exporta solo los servicios que necesites desde el Admin SDK
let adminDbInstance: admin.database.Database;
try {
    adminDbInstance = admin.database();
} catch (error) {
    console.error("Failed to get Firebase Admin Database instance using ADC. Was initialization successful?", error);
    throw new Error("Could not get Firebase Admin Database instance (using ADC).");
}

export const adminDb = adminDbInstance;
// export const adminAuth = admin.auth();