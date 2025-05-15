// src/app/api/playback/track-ended/route.ts
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export async function POST(request: Request) {
  try {
    const { endedTrackId } = await request.json();

    if (!endedTrackId) {
      return NextResponse.json({ error: 'Missing endedTrackId' }, { status: 400 });
    }

    if (!adminDb) {
      console.error('Firebase Admin DB not initialized or is null.');
      return NextResponse.json({ error: 'Database not available' }, { status: 500 });
    }

    // Verificar que coincida con el nowPlayingId
    const nowPlayingSnap = await adminDb.ref('/admin/spotify/nowPlayingId').once('value');
    const nowPlaying = nowPlayingSnap.val();

    if (!nowPlaying || nowPlaying.id !== endedTrackId) {
      console.warn(`TrackEnded: ID recibido (${endedTrackId}) no coincide con nowPlayingId (${nowPlaying?.id || 'null'}). Se omite eliminación.`);
      return NextResponse.json({
        success: false,
        message: 'Track ID does not match nowPlayingId. Skipping deletion.',
      });
    }

    // Buscar la canción en la cola
    const queueSnap = await adminDb.ref('/queue').once('value');
    const queueData = queueSnap.val() || {};

    let songIdToDelete: string | null = null;
    for (const key in queueData) {
      if (queueData[key].spotifyTrackId === endedTrackId) {
        songIdToDelete = key;
        break;
      }
    }

    if (songIdToDelete) {
      await adminDb.ref(`/queue/${songIdToDelete}`).remove();
      console.log(`Successfully removed track ${endedTrackId} from queue.`);
      return NextResponse.json({ success: true, removedTrackId: endedTrackId });
    } else {
      console.warn(`Track ${endedTrackId} not found in queue to remove.`);
      return NextResponse.json({ success: true, message: 'Track not found in queue, assumed already removed.' });
    }

  } catch (e: any) {
    console.error('[TrackEnded] Error processing track ended notification:', e.message || e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
