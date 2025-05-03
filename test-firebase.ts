// test-firebase.ts

import * as admin from 'firebase-admin';

async function testFirebaseConnection() {
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
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
