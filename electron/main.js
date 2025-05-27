const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const http = require('http')
const querystring = require('querystring')
const axios = require('axios') // Using axios for HTTP requests
const Store = require('electron-store')
const log = require('electron-log');

// Configure electron-log
log.transports.file.level = 'info'; 
log.transports.console.level = 'debug'; 
log.info('Electron main process started.');
// Replace console with electron-log functions
// console.log = log.log; // Can use log.log or log.info, log.debug etc.
// console.error = log.error;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// console.warn = log.warn;
// console.info = log.info;
// console.debug = log.debug;
// Or, more comprehensively:
Object.assign(console, log.functions);


// Initialize electron-store
const store = new Store({
  schema: {
    spotifyClientId: { type: 'string' },
    spotifyClientSecret: { type: 'string' },
    spotifyAccessToken: { type: 'string' },
    spotifyRefreshToken: { type: 'string' },
    spotifyExpiresAt: { type: 'number' },
    spotifyScope: { type: 'string' },
    spotifyTokenType: { type: 'string' },
    spotifyLoginState: { type: 'string' }, // For CSRF protection
    songQueue: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          spotifyTrackId: { type: 'string' },
          title: { type: 'string' },
          artist: { type: 'string' },
          albumArtUrl: { type: 'string' },
          addedAt: { type: 'number' }
        },
        required: ['spotifyTrackId', 'title', 'artist', 'addedAt']
      }
    },
    applicationSettings: {
      type: 'object',
      default: {
        searchMode: 'all', // 'all' or 'playlist'
        playlistId: null,  // string or null
        spotifyDeviceId: null // string or null
      },
      properties: {
        searchMode: { type: 'string', enum: ['all', 'playlist'] },
        playlistId: { type: ['string', 'null'] },
        spotifyDeviceId: { type: ['string', 'null'] }
      }
    }
  },
  // It's good practice to set defaults directly if schema defaults aren't picked up on first init for complex objects
  // However, electron-store should handle schema defaults. If issues arise, this is a place to ensure defaults.
  // defaults: {
  //   songQueue: [],
  //   applicationSettings: {
  //     searchMode: 'all',
  //     playlistId: null,
  //     spotifyDeviceId: null
  //   }
  // }
})

// Attempt to load Spotify credentials from electron-store
let SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
let SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const storedClientId = store.get('spotifyClientId');
const storedClientSecret = store.get('spotifyClientSecret');

if (storedClientId && storedClientId !== 'YOUR_SPOTIFY_CLIENT_ID' && storedClientId.trim() !== '') {
  SPOTIFY_CLIENT_ID = storedClientId;
  log.info('Loaded Spotify Client ID from electron-store.');
} else {
  log.info('Using default/environment variable for Spotify Client ID.');
  // Fallback to placeholder if not even in env
  if (!SPOTIFY_CLIENT_ID) {
    SPOTIFY_CLIENT_ID = 'YOUR_SPOTIFY_CLIENT_ID';
  }
}

if (storedClientSecret && storedClientSecret !== 'YOUR_SPOTIFY_CLIENT_SECRET' && storedClientSecret.trim() !== '') {
  SPOTIFY_CLIENT_SECRET = storedClientSecret;
  log.info('Loaded Spotify Client Secret from electron-store.');
} else {
  log.info('Using default/environment variable for Spotify Client Secret.');
  // Fallback to placeholder if not even in env
  if (!SPOTIFY_CLIENT_SECRET) {
    SPOTIFY_CLIENT_SECRET = 'YOUR_SPOTIFY_CLIENT_SECRET';
  }
}

// Log warnings if placeholders are still being used
if (SPOTIFY_CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID') {
  log.warn('SPOTIFY_CLIENT_ID is not set or loaded from store, using placeholder. Spotify authentication will likely fail.');
}
if (SPOTIFY_CLIENT_SECRET === 'YOUR_SPOTIFY_CLIENT_SECRET') {
  log.warn('SPOTIFY_CLIENT_SECRET is not set or loaded from store, using placeholder. Spotify authentication will likely fail.');
}
const SPOTIFY_REDIRECT_URI = 'http://localhost:9003/spotify-callback';
const REQUIRED_SCOPES = 'user-modify-playback-state user-read-playback-state';

const url = require('url'); // Added for production path loading
let mainWindow; // To keep a reference to the main window

function createWindow () {
  log.info('Creating main window...');
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Be cautious with this in production
      // preload: path.join(__dirname, 'preload.js') // Consider using a preload script
    }
  })

  // Load the Next.js app.
  if (process.env.NODE_ENV === 'development') {
    log.info('Development mode: Loading Next.js dev server URL: http://localhost:9002');
    mainWindow.loadURL('http://localhost:9002'); // Port 9002 is used by the Next.js dev server
  } else {
    const prodUrl = url.format({
      pathname: path.join(__dirname, '../out/index.html'), // Assumes 'out' is at project root, and main.js is in 'electron'
      protocol: 'file:',
      slashes: true
    });
    log.info(`Production mode: Loading Next.js build from: ${prodUrl}`);
    mainWindow.loadURL(prodUrl);
  }

  // Open DevTools.
  // mainWindow.webContents.openDevTools()
  log.info('Main window created and Next.js app loaded.');
}

// HTTP Server for Spotify Callback
let server;

function startCallbackServer() {
  if (server && server.listening) {
    log.info('Callback server already running.');
    return;
  }
  server = http.createServer(async (req, res) => {
    try {
      const urlParts = new URL(req.url, `http://${req.headers.host}`);
      if (urlParts.pathname === '/spotify-callback') {
        log.info('Spotify callback received:', req.url);
        const query = querystring.parse(urlParts.search.substring(1));
        const code = query.code;
        const receivedState = query.state;
        const storedState = store.get('spotifyLoginState');

        if (receivedState !== storedState) {
          log.error('State mismatch. CSRF attack suspected.');
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('State mismatch. Please try logging in again.');
          store.delete('spotifyLoginState'); // Clear the state
          return;
        }
        store.delete('spotifyLoginState'); // Clear the state after successful validation
        log.info('Spotify callback state validated.');

        // Exchange code for tokens
        log.info('Exchanging Spotify authorization code for tokens...');
        let tokenResponse;
        try {
          tokenResponse = await axios.post('https://accounts.spotify.com/api/token', querystring.stringify({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: SPOTIFY_REDIRECT_URI,
          }), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
            }
          });
          log.info('Spotify token exchange successful.');
        } catch (axiosError) {
          log.error('Spotify token exchange API call failed:', axiosError.message, axiosError.stack);
          let errorType = 'SPOTIFY_AUTH_ERROR';
          let errorMessage = 'Failed to authenticate with Spotify.';
          if (axiosError.response) {
            log.error('Spotify API Error Response:', axiosError.response.status, axiosError.response.data);
            errorMessage = `Spotify API Error: ${axiosError.response.status} - ${JSON.stringify(axiosError.response.data)}`;
          } else if (axiosError.request) {
            log.error('Spotify API No Response:', axiosError.request);
            errorType = 'SPOTIFY_API_UNAVAILABLE';
            errorMessage = 'No response from Spotify. Check internet connection.';
          } else {
            errorMessage = `Error setting up Spotify request: ${axiosError.message}`;
          }
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(errorMessage); // Send a more generic message to the user's browser tab
          // No need to send to mainWindow here as this is a direct browser interaction
          if (server && server.listening) server.close(() => log.info('Spotify callback server closed due to token exchange error.'));
          return;
        }
        
        const { access_token, refresh_token, expires_in, scope, token_type } = tokenResponse.data;
        const expiresAt = Date.now() + (expires_in * 1000);

        store.set('spotifyAccessToken', access_token);
        store.set('spotifyRefreshToken', refresh_token);
        store.set('spotifyExpiresAt', expiresAt);
        store.set('spotifyScope', scope);
        store.set('spotifyTokenType', token_type);
        store.set('spotifyClientId', SPOTIFY_CLIENT_ID); // Store credentials used
        store.set('spotifyClientSecret', SPOTIFY_CLIENT_SECRET);

        log.info('Spotify tokens stored successfully.');

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Login successful! You can close this tab.');

        if (mainWindow) {
          mainWindow.webContents.send('spotify-auth-success');
        }
        
        // Stop the server after successful authentication
        if (server) {
          server.close(() => {
            log.info('Spotify callback server closed.');
          });
        }

      } else {
        log.warn(`Callback server received request for unknown path: ${urlParts.pathname}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    } catch (error) {
      log.error('Error during Spotify callback:', error.response ? error.response.data : error.message, error.stack);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('An error occurred during login. Please try again.');
       // Ensure server is closed on error too
      if (server && server.listening) {
        server.close(() => {
            log.info('Spotify callback server closed due to error.');
        });
      }
    }
  });

  server.listen(9003, 'localhost', () => {
    log.info('Spotify callback server listening on http://localhost:9003');
  });

  server.on('error', (err) => {
    log.error('Callback server error:', err);
    if (err.code === 'EADDRINUSE') {
        log.warn('Port 9003 is already in use. The server might have been started by another process or a previous instance.');
    }
  });
}

// IPC Handler for Spotify Login
ipcMain.handle('spotify-login', async () => {
  const state = require('crypto').randomBytes(16).toString('hex');
  store.set('spotifyLoginState', state); // Store state for CSRF verification

  const authUrl = `https://accounts.spotify.com/authorize?${querystring.stringify({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: REQUIRED_SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state: state,
  })}`;

  try {
    await shell.openExternal(authUrl);
    startCallbackServer(); // Start the server when login is initiated
    return { success: true, url: authUrl };
  } catch (error) {
    console.error('Failed to open Spotify login URL:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-spotify-devices', async () => {
  console.log('IPC: get-spotify-devices called');
  
  // 1. Obtain a valid Spotify access token
  let accessToken = store.get('spotifyAccessToken');
  const expiresAt = store.get('spotifyExpiresAt');
  const refreshToken = store.get('spotifyRefreshToken');

  if (!refreshToken) {
    console.error('GetDevices: No Spotify refresh token found. User needs to login.');
    return { success: false, error: 'Spotify not connected. Please login.', devices: [] };
  }

  if (!accessToken || !expiresAt || Date.now() >= (expiresAt - 60000)) { // 60 seconds buffer
    console.log('GetDevices: Access token expired or missing, attempting refresh...');
    const refreshResult = await refreshSpotifyToken();
    if (refreshResult.success) {
      accessToken = refreshResult.accessToken;
    } else {
      console.error('GetDevices: Failed to refresh Spotify token:', refreshResult.error);
      if (mainWindow) {
          mainWindow.webContents.send('spotify-reauth-required');
      }
      return { success: false, error: 'Failed to refresh Spotify token. Please re-login.', devices: [] };
    }
  }

  if (!accessToken) {
    console.error('GetDevices: No valid access token after check/refresh.');
    return { success: false, error: 'Spotify not connected or token invalid.', devices: [] };
  }

  // 2. Make GET request to Spotify API
  try {
    const response = await axios.get('https://api.spotify.com/v1/me/player/devices', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    console.log('GetDevices: Successfully fetched devices from Spotify.');
    return { success: true, devices: response.data.devices || [] };
  } catch (error) {
    const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    log.error('GetDevices: Error fetching devices from Spotify:', errorMsg, error.stack);

    const isNetworkError = error.isAxiosError && !error.response;
    const isTimeoutError = error.code === 'ECONNABORTED';
    const specificNetworkErrorCodes = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH'];
    const isSpecificNetworkError = specificNetworkErrorCodes.includes(error.code);

    if (isNetworkError || isTimeoutError || isSpecificNetworkError) {
      log.error('GetDevices: Network/Timeout error detected.');
      if (mainWindow) mainWindow.webContents.send('spotify-api-unavailable', { context: 'fetching devices', message: 'Could not connect to Spotify. Check internet connection.' });
      return { success: false, error: 'Network error. Could not connect to Spotify.', devices: [] };
    }
    
    if (error.response) {
      if (error.response.status === 401) {
        if (mainWindow) mainWindow.webContents.send('spotify-reauth-required');
        return { success: false, error: 'Spotify token invalid. Please re-login.', devices: [] };
      }
      // Handle other Spotify API errors (e.g., 5xx)
      if (error.response.status >= 500) {
          log.error(`GetDevices: Spotify API server error: ${error.response.status}`);
          if (mainWindow) mainWindow.webContents.send('spotify-api-unavailable', { context: 'fetching devices (server error)', message: 'Spotify is temporarily unavailable.'});
          return { success: false, error: `Spotify API server error: ${error.response.status}`, devices: [] };
      }
    }
    return { success: false, error: `Failed to fetch devices: ${errorMsg}`, devices: [] };
  }
});

// --- Track Lifecycle IPC Handlers ---

ipcMain.handle('confirm-track-started', async (event, { spotifyTrackId }) => {
  if (!spotifyTrackId) {
    console.error('IPC: confirm-track-started: spotifyTrackId is required.');
    return { success: false, error: 'spotifyTrackId is required' };
  }
  try {
    console.log(`IPC: confirm-track-started called for track ${spotifyTrackId}`);
    let currentQueue = store.get('songQueue', []);
    const originalLength = currentQueue.length;
    
    // Remove the song that just started
    currentQueue = currentQueue.filter(song => song.spotifyTrackId !== spotifyTrackId);

    if (currentQueue.length < originalLength) {
      store.set('songQueue', currentQueue);
      console.log(`IPC: confirm-track-started: Track ${spotifyTrackId} removed from queue.`);
      if (mainWindow) {
        mainWindow.webContents.send('song-queue-updated', currentQueue);
      }
      return { success: true, queue: currentQueue };
    } else {
      console.warn(`IPC: confirm-track-started: Track ${spotifyTrackId} not found in queue or already removed.`);
      return { success: false, error: 'Track not found in queue or already removed', queue: currentQueue };
    }
  } catch (error) {
    console.error('IPC: confirm-track-started: Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('handle-track-ended', async () => {
  try {
    console.log('IPC: handle-track-ended called');
    // The queue should already reflect the removal of the song that just ended
    // if 'confirm-track-started' was called reliably.
    // This handler's main job is to determine what's next.
    const currentQueue = store.get('songQueue', []);
    
    if (currentQueue.length > 0) {
      const nextSong = currentQueue[0];
      console.log(`IPC: handle-track-ended: Next song is "${nextSong.title}".`);
      return { success: true, hasNextSong: true, nextSong: nextSong };
    } else {
      console.log('IPC: handle-track-ended: Queue is now empty.');
      return { success: true, hasNextSong: false, nextSong: null };
    }
  } catch (error) {
    console.error('IPC: handle-track-ended: Error:', error);
    return { success: false, error: error.message, hasNextSong: false, nextSong: null };
  }
});

ipcMain.handle('spotify-logout', async () => {
  try {
    console.log('IPC: spotify-logout called');
    store.delete('spotifyAccessToken');
    store.delete('spotifyRefreshToken');
    store.delete('spotifyExpiresAt');
    store.delete('spotifyScope');
    store.delete('spotifyTokenType');
    store.delete('spotifyClientId');
    store.delete('spotifyClientSecret');
    store.delete('spotifyLoginState'); // Also clear any pending login state

    console.log('IPC: spotify-logout: All Spotify tokens and credentials cleared from store.');

    if (mainWindow) {
      mainWindow.webContents.send('spotify-disconnected');
    }
    return { success: true, message: 'Successfully logged out from Spotify.' };
  } catch (error) {
    console.error('IPC: spotify-logout: Error:', error);
    return { success: false, error: error.message };
  }
});

// IPC Handler for setting Spotify Credentials
ipcMain.handle('set-spotify-credentials', async (event, { clientId, clientSecret }) => {
  log.info('IPC: set-spotify-credentials called');
  try {
    if (!clientId || typeof clientId !== 'string' || !clientSecret || typeof clientSecret !== 'string') {
      log.error('IPC: set-spotify-credentials: Client ID and Client Secret are required and must be strings.');
      return { success: false, error: 'Client ID and Client Secret are required and must be strings.' };
    }

    store.set('spotifyClientId', clientId);
    store.set('spotifyClientSecret', clientSecret);
    log.info('Spotify credentials updated and stored in electron-store.');

    // Update global variables for the current session
    SPOTIFY_CLIENT_ID = clientId;
    SPOTIFY_CLIENT_SECRET = clientSecret;
    log.info('Global SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET updated for current session.');

    // Log warnings if placeholders are still being used after update (e.g. if empty strings were passed)
    if (SPOTIFY_CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID' || SPOTIFY_CLIENT_ID.trim() === '') {
      log.warn('SPOTIFY_CLIENT_ID is effectively a placeholder after update. Authentication might fail.');
    }
    if (SPOTIFY_CLIENT_SECRET === 'YOUR_SPOTIFY_CLIENT_SECRET' || SPOTIFY_CLIENT_SECRET.trim() === '') {
      log.warn('SPOTIFY_CLIENT_SECRET is effectively a placeholder after update. Authentication might fail.');
    }
    
    // It might be good to notify the renderer that credentials have changed,
    // especially if this could affect UI elements or require a re-login prompt.
    if (mainWindow) {
      mainWindow.webContents.send('spotify-credentials-updated');
    }

    return { success: true, message: 'Spotify credentials stored successfully.' };
  } catch (error) {
    log.error('IPC: set-spotify-credentials: Error setting credentials:', error);
    return { success: false, error: error.message };
  }
});

// --- Spotify Playback Control IPC Handlers ---
ipcMain.handle('play-track-on-spotify', async (event, { trackUri, deviceId }) => {
  console.log(`IPC: play-track-on-spotify called for track URI ${trackUri} on device ${deviceId}`);

  if (!trackUri) {
    return { success: false, error: 'Track URI is required.' };
  }
  if (!deviceId) {
    return { success: false, error: 'Device ID is required.' };
  }

  // 1. Obtain a valid Spotify access token
  let accessToken = store.get('spotifyAccessToken');
  const expiresAt = store.get('spotifyExpiresAt');
  const refreshToken = store.get('spotifyRefreshToken');

  if (!refreshToken) {
    console.error('PlayTrack: No Spotify refresh token found. User needs to login.');
    return { success: false, error: 'Spotify not connected. Please login.' };
  }

  if (!accessToken || !expiresAt || Date.now() >= (expiresAt - 60000)) { // 60 seconds buffer
    console.log('PlayTrack: Access token expired or missing, attempting refresh...');
    const refreshResult = await refreshSpotifyToken();
    if (refreshResult.success) {
      accessToken = refreshResult.accessToken;
    } else {
      console.error('PlayTrack: Failed to refresh Spotify token:', refreshResult.error);
      if (mainWindow) {
          mainWindow.webContents.send('spotify-reauth-required');
      }
      return { success: false, error: 'Failed to refresh Spotify token. Please re-login.' };
    }
  }
  
  if (!accessToken) {
    console.error('PlayTrack: No valid access token after check/refresh.');
    return { success: false, error: 'Spotify not connected or token invalid.' };
  }

  // 2. Make PUT request to Spotify API
  try {
    await axios.put(
      `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
      { uris: [trackUri] },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`PlayTrack: Successfully requested playback of ${trackUri} on device ${deviceId}`);
    return { success: true };
  } catch (error) {
    const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    log.error('PlayTrack: Error playing track on Spotify:', errorMsg, error.stack);

    const isNetworkError = error.isAxiosError && !error.response;
    const isTimeoutError = error.code === 'ECONNABORTED';
    const specificNetworkErrorCodes = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH'];
    const isSpecificNetworkError = specificNetworkErrorCodes.includes(error.code);

    if (isNetworkError || isTimeoutError || isSpecificNetworkError) {
      log.error('PlayTrack: Network/Timeout error detected.');
      if (mainWindow) mainWindow.webContents.send('spotify-api-unavailable', { context: 'playing track', message: 'Could not connect to Spotify. Check internet connection.' });
      return { success: false, error: 'Network error. Could not connect to Spotify.', details: errorMsg };
    }

    if (error.response) {
      if (error.response.status === 401) {
          if (mainWindow) mainWindow.webContents.send('spotify-reauth-required');
          return { success: false, error: 'Spotify token invalid. Please re-login.', details: errorMsg };
      }
      if (error.response.status === 404) { // Device not found or other 404
          return { success: false, error: 'Spotify device not found or playback issue.', details: errorMsg };
      }
      if (error.response.status >= 500) { // Spotify server errors
          log.error(`PlayTrack: Spotify API server error: ${error.response.status}`);
          if (mainWindow) mainWindow.webContents.send('spotify-api-unavailable', { context: 'playing track (server error)', message: 'Spotify is temporarily unavailable.'});
          return { success: false, error: `Spotify API server error: ${error.response.status}`, details: errorMsg };
      }
    }
    // Other errors (e.g. 403 - player command failed: Premium required or no active device)
    return { success: false, error: `Failed to play track: ${errorMsg}`, details: errorMsg };
  }
});


// IPC Handler for Local Spotify Search
ipcMain.handle('search-spotify-locally', async (event, { searchTerm, searchMode, playlistId, offset = 0, limit = 20 }) => {
  console.log(`IPC: search-spotify-locally called with searchTerm: ${searchTerm}, mode: ${searchMode}, playlistId: ${playlistId}`);

  let accessToken = store.get('spotifyAccessToken');
  const expiresAt = store.get('spotifyExpiresAt');
  const refreshTokenFromStore = store.get('spotifyRefreshToken');

  if (!refreshTokenFromStore) {
    console.error('Search: No Spotify refresh token found. User needs to login.');
    return { success: false, errorType: 'SPOTIFY_AUTH_ERROR', message: 'Spotify not connected. Please login.', results: [] };
  }

  if (!accessToken || !expiresAt || Date.now() >= (expiresAt - 60000)) {
    console.log('Search: Access token expired or missing, attempting refresh...');
    const refreshResult = await refreshSpotifyToken();
    if (refreshResult.success) {
      accessToken = refreshResult.accessToken;
    } else {
      log.error('Search: Failed to refresh Spotify token during search:', refreshResult.message, refreshResult.details);
      if (mainWindow) {
          mainWindow.webContents.send('spotify-reauth-required');
      }
      return { success: false, errorType: refreshResult.errorType || 'SPOTIFY_AUTH_ERROR', message: refreshResult.message || 'Failed to refresh Spotify token. Please re-login.', results: [] };
    }
  }

  if (!accessToken) {
    console.error('Search: No valid access token after check/refresh.');
    return { success: false, errorType: 'SPOTIFY_AUTH_ERROR', message: 'Spotify not connected or token invalid.', results: [] };
  }

  try {
    let response;
    let items = [];

    if (searchMode === 'playlist' && playlistId) {
      console.log(`Search: Playlist mode for playlist ID ${playlistId}. Filtering for term: "${searchTerm}"`);
      let currentOffset = 0;
      let allPlaylistTracks = [];
      let keepFetching = true;
      const trackLimitPerRequest = 50;

      while(keepFetching) {
        response = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
          params: { 
            fields: 'items(track(id,name,artists(name),album(images,name),uri,preview_url)),limit,next,offset,total',
            limit: trackLimitPerRequest,
            offset: currentOffset
          }
        });
        
        if (response.data && response.data.items) {
          allPlaylistTracks.push(...response.data.items.map(item => item.track).filter(track => track && track.id));
          if (response.data.next) {
            currentOffset += trackLimitPerRequest;
          } else {
            keepFetching = false;
          }
        } else {
          keepFetching = false;
        }
        if (allPlaylistTracks.length >= 1000) {
          console.warn("Search: Reached 1000 tracks for playlist, stopping fetch to avoid excessive requests.")
          keepFetching = false;
        }
      }
      items = allPlaylistTracks;
      if (searchTerm && searchTerm.trim() !== '') {
        const lowerSearchTerm = searchTerm.toLowerCase();
        items = items.filter(track =>
          track.name.toLowerCase().includes(lowerSearchTerm) ||
          track.artists.some(artist => artist.name.toLowerCase().includes(lowerSearchTerm))
        );
      }
      items = items.slice(offset, offset + limit);
    } else { // 'all' search mode
      console.log(`Search: All mode for term: "${searchTerm}"`);
      response = await axios.get('https://api.spotify.com/v1/search', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        params: {
          q: searchTerm,
          type: 'track',
          limit: limit,
          offset: offset
        }
      });
      items = response.data.tracks.items;
    }

    const results = items.map(track => ({
      spotifyTrackId: track.id,
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      albumArtUrl: track.album && track.album.images && track.album.images.length > 0 ? track.album.images[0].url : null,
      // Potentially add other fields if needed by the frontend like 'uri' or 'preview_url'
    })).filter(track => track.spotifyTrackId); // Ensure only tracks with ID are returned

    console.log(`Search: Found ${results.length} tracks.`);
    return { success: true, results };

  } catch (error) {
    log.error('Error during Spotify search:', error.response ? error.response.data : error.message, error.stack);

    const isNetworkError = error.isAxiosError && !error.response;
    const isTimeoutError = error.code === 'ECONNABORTED';
    const specificNetworkErrorCodes = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH'];
    const isSpecificNetworkError = specificNetworkErrorCodes.includes(error.code);
    
    if (isNetworkError || isTimeoutError || isSpecificNetworkError) {
      log.error('Search: Network/Timeout error detected.');
      if (mainWindow) mainWindow.webContents.send('spotify-api-unavailable', { context: 'searching Spotify', message: 'Could not connect to Spotify. Check internet connection.' });
      return { success: false, errorType: 'SPOTIFY_API_UNAVAILABLE', message: 'Network error. Could not connect to Spotify.', results: [] };
    }

    if (error.response) {
      if (error.response.status === 401) {
          if (mainWindow) {
              mainWindow.webContents.send('spotify-reauth-required');
          }
          return { success: false, errorType: 'SPOTIFY_AUTH_ERROR', message: 'Spotify token invalid. Please re-login.', results: [] };
      }
      if (error.response.status === 429) {
          return { success: false, errorType: 'SPOTIFY_RATE_LIMIT', message: 'Rate limited by Spotify. Please try again later.', results: [] };
      }
      if (error.response.status >= 500) { // Spotify server errors
          log.error(`Search: Spotify API server error: ${error.response.status}`);
          if (mainWindow) mainWindow.webContents.send('spotify-api-unavailable', { context: 'searching Spotify (server error)', message: 'Spotify is temporarily unavailable.'});
          return { success: false, errorType: 'SPOTIFY_API_SERVER_ERROR', message: `Spotify API server error: ${error.response.status}`, results: [] };
      }
    }
    return { success: false, errorType: 'UNKNOWN_ERROR', message: error.message || 'Failed to search Spotify.', results: [] };
  }
});

// IPC Handler to get stored Spotify tokens
ipcMain.handle('get-spotify-tokens', async () => {
  return {
    accessToken: store.get('spotifyAccessToken'),
    refreshToken: store.get('spotifyRefreshToken'),
    expiresAt: store.get('spotifyExpiresAt'),
    clientId: store.get('spotifyClientId'), // Good to return client ID for context
  };
});

// Function to refresh Spotify token
async function refreshSpotifyToken(attempt = 1) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;

  const refreshToken = store.get('spotifyRefreshToken');
  const clientId = store.get('spotifyClientId');
  const clientSecret = store.get('spotifyClientSecret');

  if (!refreshToken || !clientId || !clientSecret) {
    console.error('Missing refresh token or client credentials for token refresh.');
    return { success: false, error: 'Missing refresh token or credentials.' };
  }

  log.info(`Attempting to refresh Spotify token (Attempt ${attempt}/${MAX_RETRIES})...`);
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token', querystring.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
      },
      // Add a timeout for the request
      timeout: 5000 // 5 seconds
    });
    log.info('Spotify token refreshed via API call successfully.');
    const { access_token, expires_in, scope, token_type, refresh_token: newRefreshToken } = response.data;
    const expiresAt = Date.now() + (expires_in * 1000);

    store.set('spotifyAccessToken', access_token);
    store.set('spotifyExpiresAt', expiresAt);
    store.set('spotifyScope', scope); // Update scope if it changed
    store.set('spotifyTokenType', token_type); // Update token type if it changed

    if (newRefreshToken) {
      store.set('spotifyRefreshToken', newRefreshToken);
      console.log('Spotify refresh token was updated.');
    }

    console.log('Spotify access token refreshed successfully.');
    return {
      success: true,
      accessToken: access_token,
      expiresAt: expiresAt,
      newRefreshTokenProvided: !!newRefreshToken
    };

  } catch (axiosError) {
    log.error(`Error refreshing Spotify token via API (Attempt ${attempt}/${MAX_RETRIES}):`, axiosError.message, axiosError.stack);
    
    const isNetworkError = axiosError.isAxiosError && !axiosError.response;
    const isTimeoutError = axiosError.code === 'ECONNABORTED'; // Axios specific timeout error code
    const specificNetworkErrorCodes = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH'];
    const isSpecificNetworkError = specificNetworkErrorCodes.includes(axiosError.code);

    if ((isNetworkError || isTimeoutError || isSpecificNetworkError) && attempt < MAX_RETRIES) {
      log.warn(`Network/Timeout error during token refresh (Attempt ${attempt}/${MAX_RETRIES}). Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await delay(RETRY_DELAY_MS);
      return refreshSpotifyToken(attempt + 1); // Recursive call for retry
    }

    let errorType = 'SPOTIFY_AUTH_ERROR';
    let clientMessage = 'Failed to refresh Spotify session.';
    const errorDetails = axiosError.response ? axiosError.response.data : axiosError.message;

    if (axiosError.response) {
      log.error('Spotify Refresh API Error Response:', axiosError.response.status, axiosError.response.data);
      if (axiosError.response.status === 400 || axiosError.response.status === 401) {
        log.error('Refresh token might be invalid or client authentication failed. User may need to re-login.');
        clientMessage = 'Spotify session invalid. Please log in again.';
        if (mainWindow) mainWindow.webContents.send('spotify-reauth-required');
      }
      // For other HTTP errors, don't necessarily emit spotify-api-unavailable unless it's a server-side issue (5xx)
      else if (axiosError.response.status >= 500) {
        log.error('Spotify API server error during token refresh.');
        errorType = 'SPOTIFY_API_SERVER_ERROR';
        clientMessage = 'Spotify is temporarily unavailable. Please try again later.';
        if (mainWindow) mainWindow.webContents.send('spotify-api-unavailable', { context: 'refreshing token (server error)', message: clientMessage });
      }
    } else if (isNetworkError || isTimeoutError || isSpecificNetworkError) { // Persistent network error after retries
      log.error('Persistent network/timeout error after all retries during token refresh.');
      errorType = 'SPOTIFY_API_UNAVAILABLE';
      clientMessage = 'Could not connect to Spotify to refresh session. Check internet connection.';
      if (mainWindow) mainWindow.webContents.send('spotify-api-unavailable', { context: 'refreshing token (network error)', message: clientMessage });
    } else {
      // Non-Axios error or unexpected error
      clientMessage = `Error setting up Spotify refresh request: ${axiosError.message}`;
    }
    return { success: false, errorType, message: clientMessage, details: errorDetails };
  }
}

// IPC Handler to get a valid Spotify access token, refreshing if necessary
ipcMain.handle('get-valid-spotify-access-token', async () => {
  let accessToken = store.get('spotifyAccessToken');
  const expiresAt = store.get('spotifyExpiresAt');
  const refreshToken = store.get('spotifyRefreshToken'); // Check if refresh token exists

  if (!refreshToken) { // If no refresh token, user definitely needs to login
    console.log('No Spotify refresh token found. User needs to login.');
    return { success: false, error: 'User not logged in or refresh token missing.', requiresLogin: true };
  }

  if (!accessToken || !expiresAt || Date.now() >= (expiresAt - 60000)) { // 60 seconds buffer
    console.log(accessToken ? 'Spotify access token expired or nearing expiry.' : 'No Spotify access token found, attempting refresh.');
    const refreshResult = await refreshSpotifyToken();
    if (refreshResult.success) {
      return { success: true, accessToken: refreshResult.accessToken };
    } else {
      console.error('Failed to refresh Spotify token:', refreshResult.error);
      // If refresh fails, it might be due to an invalid refresh token (e.g., revoked)
      // Notify the renderer that re-authentication is required.
      if (mainWindow) {
          mainWindow.webContents.send('spotify-reauth-required');
      }
      return { success: false, error: 'Failed to refresh token. User may need to re-authenticate.', requiresLogin: true };
    }
  }

  console.log('Returning existing valid Spotify access token.');
  return { success: true, accessToken: accessToken };
});

// --- Song Queue IPC Handlers ---

ipcMain.handle('get-song-queue', async () => {
  log.debug('IPC: get-song-queue called');
  try {
    const queue = store.get('songQueue');
    return { success: true, queue };
  } catch (error) {
    log.error('IPC: get-song-queue Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-song-to-queue', async (event, songObject) => {
  log.info('IPC: add-song-to-queue called with:', songObject.title);
  try {
    if (!songObject || !songObject.spotifyTrackId || !songObject.title || !songObject.artist) {
      log.error('IPC: add-song-to-queue: Invalid song object provided.');
      throw new Error('Invalid song object provided.');
    }
    const currentQueue = store.get('songQueue', []);
    
    // Check if song already exists in the queue
    const songExists = currentQueue.some(song => song.spotifyTrackId === songObject.spotifyTrackId);
    if (songExists) {
      log.warn(`IPC: add-song-to-queue: Attempted to add duplicate song: ${songObject.title} (ID: ${songObject.spotifyTrackId})`);
      return { success: false, error: 'Song already in queue.', queue: currentQueue };
    }

    const newSong = {
      ...songObject,
      addedAt: Date.now()
    };
    const updatedQueue = [...currentQueue, newSong];
    store.set('songQueue', updatedQueue);
    log.info(`IPC: add-song-to-queue: Song "${newSong.title}" added.`);
    if (mainWindow) {
      mainWindow.webContents.send('song-queue-updated', updatedQueue);
    }
    return { success: true, queue: updatedQueue };
  } catch (error) {
    log.error('IPC: add-song-to-queue Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-song-from-queue', async (event, spotifyTrackId) => {
  log.info(`IPC: remove-song-from-queue called for track ID: ${spotifyTrackId}`);
  try {
    if (!spotifyTrackId) {
      log.error('IPC: remove-song-from-queue: Spotify Track ID not provided.');
      throw new Error('Spotify Track ID not provided.');
    }
    const currentQueue = store.get('songQueue', []);
    const updatedQueue = currentQueue.filter(song => song.spotifyTrackId !== spotifyTrackId);

    if (currentQueue.length === updatedQueue.length) {
      log.warn(`IPC: remove-song-from-queue: Song with ID ${spotifyTrackId} not found in queue for removal.`);
      // Optionally return a specific status or error if song not found
      // return { success: false, error: 'Song not found' };
    } else {
      log.info(`IPC: remove-song-from-queue: Song with ID ${spotifyTrackId} removed.`);
    }

    store.set('songQueue', updatedQueue);
    if (mainWindow) {
      mainWindow.webContents.send('song-queue-updated', updatedQueue);
    }
    return { success: true, queue: updatedQueue };
  } catch (error) {
    log.error('IPC: remove-song-from-queue Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-next-song', async () => {
  log.debug('IPC: get-next-song called');
  try {
    const currentQueue = store.get('songQueue', []);
    if (currentQueue.length > 0) {
      return { success: true, song: currentQueue[0] };
    } else {
      return { success: true, song: null };
    }
  } catch (error) {
    log.error('IPC: get-next-song Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-song-queue', async () => {
  log.info('IPC: clear-song-queue called');
  try {
    store.set('songQueue', []);
    if (mainWindow) {
      mainWindow.webContents.send('song-queue-updated', []);
    }
    return { success: true };
  } catch (error) {
    log.error('IPC: clear-song-queue Error:', error);
    return { success: false, error: error.message };
  }
});

// --- Application Settings IPC Handlers ---

ipcMain.handle('get-application-settings', async () => {
  log.debug('IPC: get-application-settings called');
  try {
    const settings = store.get('applicationSettings');
    return { success: true, settings };
  } catch (error) {
    log.error('IPC: get-application-settings Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-application-settings', async (event, newSettings) => {
  log.info('IPC: update-application-settings called with:', newSettings);
  try {
    if (typeof newSettings !== 'object' || newSettings === null) {
      log.error('IPC: update-application-settings: Invalid settings object provided.');
      throw new Error('Invalid settings object provided.');
    }
    const currentSettings = store.get('applicationSettings', {}); // Get current or default
    const updatedSettings = { ...currentSettings, ...newSettings };

    // Validate and ensure only defined keys from schema are set (optional, but good for strictness)
    const schemaProps = store.schema.applicationSettings.properties;
    for (const key in updatedSettings) {
      if (!schemaProps.hasOwnProperty(key)) {
        delete updatedSettings[key]; // Remove any keys not in schema
      }
    }
    
    store.set('applicationSettings', updatedSettings);
    log.info('IPC: update-application-settings: Settings updated.');
    if (mainWindow) {
      mainWindow.webContents.send('application-settings-updated', updatedSettings);
    }
    return { success: true, settings: updatedSettings };
  } catch (error) {
    log.error('IPC: update-application-settings Error:', error);
    return { success: false, error: error.message };
  }
});


app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Proactive Spotify token refresh
  setInterval(async () => {
    log.info('Periodic Spotify token check running...');
    const expiresAt = store.get('spotifyExpiresAt');
    const refreshToken = store.get('spotifyRefreshToken');

    if (!refreshToken) {
      log.info('No refresh token found, skipping proactive refresh.');
      return;
    }

    // Check if token expires within the next 10 minutes
    if (expiresAt && (expiresAt - Date.now() < 10 * 60 * 1000)) {
      log.info('Spotify token nearing expiration, attempting proactive refresh.');
      refreshSpotifyToken()
        .then(refreshResult => {
          if (refreshResult.success) {
            log.info('Proactive Spotify token refresh successful.');
          } else {
            log.warn('Proactive Spotify token refresh failed:', refreshResult.message);
          }
        })
        .catch(error => {
          log.error('Error during proactive Spotify token refresh:', error);
        });
    } else {
      log.info('Spotify token is not nearing expiration, no proactive refresh needed.');
    }
  }, 15 * 60 * 1000); // Run every 15 minutes
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
  // Ensure callback server is closed when app quits
  if (server && server.listening) {
    server.close(() => {
      console.log('Spotify callback server closed on app quit.');
    });
  }
});

// Graceful shutdown for the callback server
app.on('before-quit', () => {
  if (server && server.listening) {
    console.log('Attempting to close callback server before quit...');
    server.close((err) => {
      if (err) {
        console.error('Error closing callback server:', err);
      } else {
        console.log('Callback server closed successfully.');
      }
    });
  }
});
