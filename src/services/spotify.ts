// src/services/spotify.ts

export interface Song {
    /** El ID de la pista en Spotify */
    spotifyTrackId: string
    /** Título de la canción */
    title: string
    /** Artistas (concatenados en una cadena) */
    artist: string
    /** URL de la vista previa como “albumArtUrl” opcional */
    albumArtUrl?: string | null
  }
  
  export interface SpotifyConfig {
    searchMode: 'all' | 'playlist'
    playlistId?: string
    spotifyConnected: boolean
  }
  
  /**
   * Llama a tu API interna de Next.js en /api/searchSpotify
   */
  export async function searchSpotify(
    searchTerm: string,
    config: SpotifyConfig | null
  ): Promise<Song[]> {
    const mode = config?.searchMode ?? 'all'
    const playlistId = config?.playlistId
  
    // Monta la query string
    const params = new URLSearchParams({ q: searchTerm, mode })
    if (mode === 'playlist' && playlistId) {
      params.set('playlistId', playlistId)
    }
  
    const res = await fetch(`/api/searchSpotify?${params.toString()}`)
    const body = await res.json()
    if (!res.ok) {
      throw new Error(body.error || 'Error buscando en Spotify')
    }
  
    // Mapea el resultado de tu API al formato Song
    return (body.results as Array<{
      id: string
      name: string
      artists: string[]
      album: string
      uri: string
      preview_url: string | null
    }>).map(t => ({
      spotifyTrackId: t.id,
      title: t.name,
      artist: t.artists.join(', '),
      // Como preview_url no es imagen de álbum, lo dejamos en null o puedes usar t.preview_url
      albumArtUrl: t.preview_url,
    }))
  }
  