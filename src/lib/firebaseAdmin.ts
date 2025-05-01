// src/lib/firebaseAdmin.ts (Versión para usar Application Default Credentials)
import * as admin from 'firebase-admin';

// Evita inicializaciones múltiples en desarrollo
if (!admin.apps.length) {
  try {
    // Lee solo las variables necesarias que NO son credenciales explícitas
    const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;

    if (!databaseURL) {
        // databaseURL sigue siendo útil para la conexión RTDB
        throw new Error("Missing Firebase DATABASE_URL in environment variables.");
    }

    // Inicializa SIN especificar credenciales.
    // El SDK buscará automáticamente las Application Default Credentials (ADC)
    // configuradas mediante `gcloud auth application-default login`.
    admin.initializeApp({
      databaseURL: databaseURL,
      // NO incluimos la opción 'credential' aquí
    });

    console.log('Firebase Admin SDK Initialized using Application Default Credentials (ADC) (from lib/firebaseAdmin.ts)');

  } catch (error: any) {
     // Este catch ahora atrapará errores si ADC no está configurado o si hay otros problemas de inicialización
     console.error("Firebase Admin SDK Initialization Error (using ADC):", error.message);
     // Relanzamos el error para detener la ejecución si falla
     throw error;
  }
}

// Exporta solo los servicios que necesites desde el Admin SDK
let adminDbInstance: admin.database.Database;
try {
    // Intenta obtener la instancia de la base de datos
    // Esto fallará si initializeApp no tuvo éxito
    adminDbInstance = admin.database();
} catch (error) {
    console.error("Failed to get Firebase Admin Database instance using ADC. Was initialization successful?", error);
    throw new Error("Could not get Firebase Admin Database instance (using ADC).");
}

export const adminDb = adminDbInstance;
// export const adminAuth = admin.auth();