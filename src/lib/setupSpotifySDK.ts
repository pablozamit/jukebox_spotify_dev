export {}; // 👈 Necesario para que esto sea un "external module"

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    __spotifySDK_ready_called?: boolean;
  }
}

  
  // Define una función global que Spotify pueda llamar de inmediato
  if (typeof window !== 'undefined') {
    window.__spotifySDK_ready_called = false;
  
    window.onSpotifyWebPlaybackSDKReady = () => {
      console.warn('[SDK] Llamado global sin efecto porque aún no hay manejador registrado.');
      window.__spotifySDK_ready_called = true;
    };
  }
  