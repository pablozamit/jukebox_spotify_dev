import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as admin from 'firebase-admin';

async function testFirebaseConnection() {
  try {
    const dbURL = process.env.FIREBASE_DATABASE_URL;

    if (!dbURL) {
      throw new Error('FIREBASE_DATABASE_URL no está definida en el entorno');
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: dbURL,
      });
    }

    const db = admin.database();
    const ref = db.ref('/__test__');

    await ref.set({
      timestamp: Date.now(),
      message: 'Conexión Firebase RTDB exitosa desde Admin SDK',
    });

    const snapshot = await ref.once('value');
    console.log('✅ Éxito:', snapshot.val());
  } catch (err) {
    console.error('❌ Error al conectar con Firebase Admin SDK:', err);
  }
}

testFirebaseConnection();
