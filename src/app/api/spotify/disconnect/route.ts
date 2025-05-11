export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON!)),
    databaseURL: process.env.FIREBASE_DATABASE_URL,

  });
}

export async function POST() {
  try {
    await admin.database().ref('/admin/spotify/tokens').remove();
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Error en /api/spotify/disconnect:', e);
    return NextResponse.json({ error: 'Failed to disconnect Spotify' }, { status: 500 });
  }
}
