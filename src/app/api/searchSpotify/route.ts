// src/app/api/searchSpotify/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  console.warn("DEPRECATED API ROUTE: /api/searchSpotify was called. This functionality has been moved to an Electron IPC handler.");
  return NextResponse.json(
    { 
      error: 'This API route is deprecated. Spotify search is now handled directly by the Electron application.',
      results: [] 
    }, 
    { status: 501 } // 501 Not Implemented
  );
}
