/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onRequest } from "firebase-functions/v2/https";  // Import v2 HTTP trigger
import { config } from "firebase-functions";           // Import config para leer variables de entorno seguras
import * as logger from "firebase-functions/logger";   // Import logger v2
import axios from "axios";                             // Import axios para llamadas HTTP
// import * as cors from "cors";                       // ELIMINADO - No es necesario con {cors: true}
// const corsHandler = cors({origin: true});           // ELIMINADO - No es necesario con {cors: true}

// Define la Cloud Function HTTP llamada searchSpotify usando v2 y habilitando CORS básico
export const searchSpotify = onRequest({ cors: true }, async (req, res) => {
  // La opción { cors: true } maneja CORS básico permitiendo peticiones desde cualquier origen.

  logger.info("Iniciando búsqueda en Spotify...");

  // 1. Obtener el término de búsqueda de la petición (?q=...)
  const query = req.query.q;
  if (!query || typeof query !== 'string') {
    logger.warn("Petición recibida sin término de búsqueda ('q').");
    res.status(400).send("Falta el parámetro de búsqueda 'q'.");
    return;
  }
  logger.info(`Término de búsqueda recibido: ${query}`);

  // 2. Obtener las credenciales de Spotify desde la config segura de Firebase
  const clientId = config().spotify?.client_id;
  const clientSecret = config().spotify?.client_secret;

  if (!clientId || !clientSecret) {
    logger.error("¡ERROR CRÍTICO! Client ID o Client Secret de Spotify no encontrados en la configuración de Firebase Functions.");
    res.status(500).send("Error de configuración del servidor.");
    return;
  }

  try {
    // --- LÓGICA PARA HABLAR CON SPOTIFY ---

    // 3. // TODO: Obtener Access Token de Spotify usando Client Credentials Flow
    logger.info("TODO: Implementar obtención de Access Token de Spotify.");
    const spotifyAccessToken = "TOKEN_FALSO_POR_AHORA"; // <-- Temporal

    if (spotifyAccessToken === "TOKEN_FALSO_POR_AHORA") {
        logger.warn("Usando token falso. Implementar paso 3.");
    }


    // 4. // TODO: Usar el Access Token para buscar canciones en Spotify API v1
    logger.info(`TODO: Implementar búsqueda en Spotify API con query: ${query}`);

    // Resultados de ejemplo mientras no implementamos el paso 4
    const cancionesDeEjemplo = [
      { spotifyTrackId: 'ejemplo1', title: `Resultado 1 para ${query}`, artist: 'Artista Ejemplo', albumArtUrl: null },
      { spotifyTrackId: 'ejemplo2', title: `Resultado 2 para ${query}`, artist: 'Artista Ejemplo', albumArtUrl: null },
    ];
    logger.info("Devolviendo datos de ejemplo.");


    // 5. Enviar los resultados (de ejemplo por ahora) de vuelta al navegador
    res.status(200).json(cancionesDeEjemplo);

  } catch (error) {
    logger.error("Error durante el proceso de búsqueda en Spotify:", error);
    if (axios.isAxiosError(error)) {
      logger.error("Detalles del error de Axios:", error.response?.data || error.message);
    }
    res.status(500).send("Error interno al buscar en Spotify.");
  }
}); // Fin de la función searchSpotify