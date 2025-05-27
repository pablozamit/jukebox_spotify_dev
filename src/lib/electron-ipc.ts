// src/lib/electron-ipc.ts

// Type definitions for the song and settings objects, mirroring electron/main.js
export interface Song {
  spotifyTrackId: string;
  title: string;
  artist: string;
  albumArtUrl?: string; // Optional as per schema
  addedAt: number;
}

export interface ApplicationSettings {
  searchMode: 'all' | 'playlist';
  playlistId: string | null;
  spotifyDeviceId: string | null;
}

// Helper to safely get ipcRenderer
function getIpcRenderer() {
  if (typeof window !== 'undefined' && window.require) {
    const electron = window.require('electron');
    if (electron && electron.ipcRenderer) {
      return electron.ipcRenderer;
    }
  }
  console.warn('ipcRenderer is not available. Ensure you are in an Electron environment.');
  return null;
}

// --- Spotify Auth ---
export async function loginToSpotify(): Promise<{ success: boolean; url?: string; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('spotify-login');
}

export async function getValidSpotifyAccessToken(): Promise<{ success: boolean; accessToken?: string; error?: string; requiresLogin?: boolean }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available', requiresLogin: true };
  return ipcRenderer.invoke('get-valid-spotify-access-token');
}

// Listen for Spotify auth success
export function onSpotifyAuthSuccess(callback: () => void): () => void {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return () => {};
  const handler = () => callback();
  ipcRenderer.on('spotify-auth-success', handler);
  return () => ipcRenderer.removeListener('spotify-auth-success', handler);
}

// Listen for Spotify re-auth required
export function onSpotifyReauthRequired(callback: () => void): () => void {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return () => {};
  const handler = () => callback();
  ipcRenderer.on('spotify-reauth-required', handler);
  return () => ipcRenderer.removeListener('spotify-reauth-required', handler);
}

export async function setSpotifyCredentials(clientId: string, clientSecret: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('set-spotify-credentials', { clientId, clientSecret });
}

// Listen for Spotify credentials updated
export function onSpotifyCredentialsUpdated(callback: () => void): () => void {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return () => {};
  const handler = () => callback();
  ipcRenderer.on('spotify-credentials-updated', handler);
  return () => ipcRenderer.removeListener('spotify-credentials-updated', handler);
}

// --- Song Queue ---
export async function getSongQueue(): Promise<{ success: boolean; queue?: Song[]; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('get-song-queue');
}

export async function addSongToQueue(song: Omit<Song, 'addedAt'>): Promise<{ success: boolean; queue?: Song[]; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('add-song-to-queue', song);
}

export async function removeSongFromQueue(spotifyTrackId: string): Promise<{ success: boolean; queue?: Song[]; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('remove-song-from-queue', spotifyTrackId);
}

export async function getNextSong(): Promise<{ success: boolean; song?: Song | null; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('get-next-song');
}

export async function clearSongQueue(): Promise<{ success: boolean; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('clear-song-queue');
}

export function onSongQueueUpdated(callback: (queue: Song[]) => void): () => void {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return () => {};
  // electron-store sends the updated queue as the argument
  const handler = (event: any, queue: Song[]) => callback(queue);
  ipcRenderer.on('song-queue-updated', handler);
  return () => ipcRenderer.removeListener('song-queue-updated', handler);
}

// --- Application Settings ---
export async function getApplicationSettings(): Promise<{ success: boolean; settings?: ApplicationSettings; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('get-application-settings');
}

export async function updateApplicationSettings(newSettings: Partial<ApplicationSettings>): Promise<{ success: boolean; settings?: ApplicationSettings; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('update-application-settings', newSettings);
}

export function onApplicationSettingsUpdated(callback: (settings: ApplicationSettings) => void): () => void {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return () => {};
  // electron-store sends the updated settings as the argument
  const handler = (event: any, settings: ApplicationSettings) => callback(settings);
  ipcRenderer.on('application-settings-updated', handler);
  return () => ipcRenderer.removeListener('application-settings-updated', handler);
}

// Helper to check if running in Electron
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.require && !!window.require('electron').ipcRenderer;
}

// --- Spotify Search (New) ---
export async function searchSpotifyLocally(params: { 
  searchTerm: string, 
  searchMode: 'all' | 'playlist', 
  playlistId?: string | null, 
  offset?: number, 
  limit?: number 
}): Promise<{ success: boolean; results?: Song[]; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available', results: [] };
  return ipcRenderer.invoke('search-spotify-locally', params);
}

// --- Track Lifecycle (New) ---
export async function confirmTrackStarted(spotifyTrackId: string): Promise<{ success: boolean; error?: string; queue?: Song[] }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('confirm-track-started', { spotifyTrackId });
}

export async function handleTrackEnded(): Promise<{ success: boolean; error?: string; hasNextSong?: boolean; nextSong?: Song | null }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('handle-track-ended');
}

// --- Spotify Logout (New) ---
export async function spotifyLogout(): Promise<{ success: boolean; message?: string; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('spotify-logout');
}

export function onSpotifyDisconnected(callback: () => void): () => void {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return () => {};
  const handler = () => callback();
  ipcRenderer.on('spotify-disconnected', handler);
  return () => ipcRenderer.removeListener('spotify-disconnected', handler);
}

// --- Spotify Playback Control (New) ---
export interface SpotifyDevice {
  id: string | null; // Can be null if no device ID
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  name: string;
  type: string; // e.g., "computer", "speaker"
  volume_percent: number | null; // Can be null
}

export async function playTrackOnSpotify(trackUri: string, deviceId: string): Promise<{ success: boolean; error?: string; details?: any }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('play-track-on-spotify', { trackUri, deviceId });
}

export async function getSpotifyDevices(): Promise<{ success: boolean; devices?: SpotifyDevice[]; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available', devices: [] };
  return ipcRenderer.invoke('get-spotify-devices');
}

// --- Log Viewing (New) ---
export async function getLogFilePath(): Promise<{ success: boolean; path?: string; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('get-log-file-path');
}

export async function openPathInShell(filePath: string): Promise<{ success: boolean; error?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('open-path-in-shell', filePath);
}

// --- Spotify Playback Info (New IPC handlers) ---
export interface CurrentlyPlayingTrack {
  isPlaying: boolean;
  spotifyTrackId?: string;
  title?: string;
  artist?: string;
  albumArtUrl?: string | null;
  progress_ms?: number;
  duration_ms?: number;
  uri?: string;
}

export async function getCurrentPlaying(): Promise<{ success: boolean; data?: CurrentlyPlayingTrack; error?: string; errorType?: string; message?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('get-current-playing');
}

export interface PlaylistDetails {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  externalUrl: string | null;
}

export async function getPlaylistDetails(playlistId: string): Promise<{ success: boolean; data?: PlaylistDetails; error?: string; errorType?: string; message?: string }> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return { success: false, error: 'ipcRenderer not available' };
  return ipcRenderer.invoke('get-playlist-details', { playlistId });
}
