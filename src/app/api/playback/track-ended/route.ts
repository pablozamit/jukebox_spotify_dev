// src/app/api/playback/track-ended/route.ts
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
// No necesitamos importar get o remove de firebase-admin/database
// import { get, remove } from 'firebase-admin/database';


export async function POST(request: Request) {
  try {
    const { endedTrackId } = await request.json();

    if (!endedTrackId) {
      return NextResponse.json({ error: 'Missing endedTrackId' }, { status: 400 });
    }

    if (!adminDb) {
       console.error("Firebase Admin DB not initialized or is null.");
       return NextResponse.json({ error: 'Database not available' }, { status: 500 });
    }

    // Obtener una referencia a la cola
    const queueRef = adminDb.ref('/queue');

    // Leer los datos de la cola una vez
    const snapshot = await queueRef.once('value'); // <--- Usar once('value') en la referencia
    const queueData = snapshot.val() || {};

    let songIdToDelete: string | null = null;

    // Encontrar el ID de la entrada en la cola que coincida con el spotifyTrackId
    for (const key in queueData) {
      if (queueData[key].spotifyTrackId === endedTrackId) {
        songIdToDelete = key;
        break; // Asumimos que solo hay una instancia de cada canción en la cola
      }
    }

    if (songIdToDelete) {
      // Obtener una referencia a la canción específica y llamar a remove() en ella
      const songRef = adminDb.ref(`/queue/${songIdToDelete}`);
      await songRef.remove(); // <--- Usar remove() directamente en la referencia
      console.log(`Successfully removed track ${endedTrackId} from queue.`);
      return NextResponse.json({ success: true, removedTrackId: endedTrackId });
    } else {
      console.warn(`Track ${endedTrackId} not found in queue to remove.`);
      return NextResponse.json({ success: true, message: 'Track not found in queue, assumed already removed.' });
    }

  } catch (e: any) {
    console.error('[TrackEnded] Error processing track ended notification:', e.message || e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
