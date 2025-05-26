// src/app/api/playback/track-ended/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  console.warn("DEPRECATED API ROUTE: /api/playback/track-ended was called. This functionality has been moved to an Electron IPC handler.");
  return NextResponse.json(
    { 
      error: 'This API route is deprecated. Track end handling is now managed directly by the Electron application via IPC.',
      success: false
    }, 
    { status: 501 } // 501 Not Implemented
  );
}

// Also deprecate GET if it was used, or any other methods.
export async function GET(request: Request) {
  console.warn("DEPRECATED API ROUTE: /api/playback/track-ended (GET) was called. This functionality has been moved to an Electron IPC handler.");
  return NextResponse.json(
    { 
      error: 'This API route is deprecated. Track end handling is now managed directly by the Electron application via IPC.',
      success: false
    }, 
    { status: 501 } // 501 Not Implemented
  );
}
