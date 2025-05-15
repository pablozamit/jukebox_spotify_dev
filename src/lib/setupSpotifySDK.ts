// src/lib/setupSpotifySDK.ts
if (typeof window !== 'undefined' && !window.onSpotifyWebPlaybackSDKReady) {
    window.onSpotifyWebPlaybackSDKReady = () => {
      console.warn('[Spotify SDK] Llamado global sin efecto porque aún no hay manejador registrado.');
    };
  }
  