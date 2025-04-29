# **App Name**: Bar Jukebox

## Core Features:

- Búsqueda y visualización de canciones: Mostrar una lista de canciones de Spotify donde se pueda buscar.
- Cola de canciones en tiempo real: Permitir añadir canciones a una cola, que se muestra en tiempo real a todos los clientes. Impedir que un usuario proponga otra cancion hasta que la suya haya sonado.
- Controles de administrador: Panel de administración con veto/eliminación de canciones y gestión de la conexión de Spotify (OAuth).

## Style Guidelines:

- Color primario: Azul oscuro (#192841) para transmitir un ambiente relajado.
- Color secundario: Gris claro (#CCD6DD) para proporcionar un buen contraste con el tema oscuro.
- Acento: Verde lima (#A3E47B) para elementos interactivos y CTA.
- Fuentes limpias y sans-serif para facilitar la lectura.
- Iconos simples y modernos para una fácil navegación.
- Diseños limpios e intuitivos optimizados tanto para escritorio como para dispositivos móviles.

## Original User Request:
Okay, aquí tienes un prompt detallado y meticuloso diseñado para Firebase Studio (la herramienta de IA que mostraste). Intenta cubrir todos los aspectos del proyecto que hemos discutido, desde la concepción hasta detalles técnicos relevantes, y finaliza pidiendo su opinión sobre el enfoque.

Prompt para Firebase Studio:

"Hola, necesito crear una aplicación web completa llamada 'Bar Jukebox'. El objetivo es permitir a los clientes de un bar buscar canciones en Spotify y añadirlas a una cola de reproducción compartida, que luego el dueño del bar puede gestionar y que se reproducirá en el sistema de sonido del bar a través de la cuenta de Spotify del bar.

Usuarios y Roles:

Cliente del Bar: Usuario anónimo dentro del bar que puede ver la cola, buscar canciones y añadir canciones a la cola.
Dueño del Bar (Admin): Usuario autenticado que gestiona la cola, configura las opciones y conecta la aplicación a la cuenta de Spotify del bar.
Componentes Principales a Generar:

Frontend para Clientes: Una página web simple (HTML, CSS, JavaScript moderno).
Frontend para Admin: Una página web separada (HTML, CSS, JavaScript moderno) protegida por autenticación.
Base de Datos: Utilizar Firebase Realtime Database para almacenar la cola de canciones y la configuración, permitiendo actualizaciones en tiempo real para todos los usuarios.
Backend Logic: Utilizar Cloud Functions for Firebase (Node.js) para toda la lógica del servidor, especialmente para interactuar de forma segura con la API de Spotify y gestionar la autenticación OAuth.
Autenticación: Utilizar Firebase Authentication (método Email/Contraseña) para proteger el acceso al panel de administración.
Hosting: Preparar la aplicación para ser desplegada en Firebase Hosting bajo un subdominio personalizado (ej: jukebox.nombredelbar.com).
Funcionalidad Detallada - Frontend Cliente:

Mostrar una lista ordenada que represente la cola de canciones actual (/queue en Realtime Database). La lista debe mostrar al menos el título y el artista de cada canción y actualizarse automáticamente cuando cambie la cola.
Incluir una barra de búsqueda de texto.
Al escribir en la búsqueda, debe llamar a una Cloud Function (searchSpotify) que buscará canciones en Spotify (según la configuración del admin).
Mostrar los resultados de la búsqueda debajo de la barra.
Al hacer clic en un resultado de búsqueda, la canción seleccionada (con su ID de Spotify, título, artista) debe añadirse al final de la lista /queue en Realtime Database.
Funcionalidad Detallada - Frontend Admin:

Requerir inicio de sesión a través de Firebase Authentication (Email/Password).
Mostrar la misma lista/cola de canciones (/queue) en tiempo real que ven los clientes.
Para cada canción en la cola, incluir:
Un botón "Vetar" o "Eliminar" que elimine la canción de la lista /queue en Realtime Database.
(Opcional, si es viable) Botones o funcionalidad drag-and-drop para "Mover Arriba" / "Mover Abajo" para reordenar las canciones directamente en la lista /queue de Realtime Database.
Incluir una sección de configuración para:
Seleccionar la fuente de las canciones: "Buscar en todo Spotify" vs. "Usar Playlist específica".
Si se selecciona "Usar Playlist", un campo para introducir el ID de la Playlist de Spotify.
Guardar esta configuración en Realtime Database (ej: en /config).
Incluir un botón o sección para gestionar la conexión con Spotify: iniciar el proceso de autorización OAuth para que la aplicación pueda controlar la reproducción de la cuenta de Spotify del bar. Mostrar el estado de la conexión (conectado/desconectado).
Estructura de Datos (Firebase Realtime Database):

/queue: Una lista ordenada (posiblemente un array o un objeto con prioridades numéricas) que contenga objetos de canción. Cada objeto debe tener al menos: spotifyTrackId, title, artist, timestampAdded.
/config: Un objeto que almacene la configuración del admin: searchMode (valores: 'all' o 'playlist'), playlistId (string, si searchMode es 'playlist'), y potencialmente el estado de la conexión de Spotify.
/secureData/spotifyTokens (Opcional, Firestore podría ser mejor para esto por seguridad/reglas): Un lugar seguro para almacenar los tokens de OAuth de Spotify (access_token, refresh_token) asociados a la cuenta del bar. ¡Esto es muy sensible!
Lógica del Backend (Cloud Functions - Node.js):

searchSpotify (HTTPS Trigger):
Recibe el término de búsqueda del frontend cliente.
Lee la configuración /config/searchMode y /config/playlistId de Realtime Database.
Si searchMode es 'all', usa las credenciales de la app de Spotify (Client ID/Secret guardados de forma segura como variables de entorno en la función) para buscar en la API pública de Spotify.
Si searchMode es 'playlist', usa las credenciales o el token del bar para obtener las canciones de la playlist especificada (/config/playlistId) desde la API de Spotify.
Devuelve la lista de canciones encontradas al frontend.
addSongToSpotifyPlaybackQueue (Puede ser HTTPS Trigger o Database Trigger):
Necesita activarse cuando una canción deba añadirse a la reproducción real de Spotify (¿la primera de la cola /queue?).
Recupera de forma segura los tokens OAuth (access_token, refresh_token) guardados de la cuenta del bar.
Si el access_token ha caducado, usa el refresh_token para obtener uno nuevo y lo guarda actualizado.
Usa el access_token válido para llamar al endpoint de la API de Spotify /me/player/queue con el spotifyTrackId de la canción correspondiente.
Maneja posibles errores (ej: no hay dispositivo activo, token inválido).
spotifyOAuthLogin (HTTPS Trigger):
Inicia el flujo de autorización OAuth 2.0 de Spotify (Authorization Code Flow).
Redirige al admin a la página de autorización de Spotify solicitando los scopes necesarios (ej: user-modify-playback-state, playlist-read-private).
spotifyOAuthCallback (HTTPS Trigger):
Configurada como Redirect URI en la app de Spotify.
Recibe el code de autorización de Spotify.
Usa el code, Client ID y Client Secret (de las variables de entorno) para intercambiarlos por access_token y refresh_token.
Guarda estos tokens de forma segura (idealmente en Firestore con reglas de seguridad estrictas, o en Realtime Database protegida).
Redirige al admin de vuelta a la página de administración con un mensaje de éxito/error.
Consideraciones Adicionales:

Seguridad: Es crítico manejar las credenciales de la API de Spotify (Client Secret) y los tokens OAuth del usuario de forma segura, usando variables de entorno de Cloud Functions y reglas de seguridad estrictas en Firebase Database/Firestore. No exponerlas nunca en el código del frontend.
Flujo de Reproducción: Definir claramente cuándo una canción de la cola de Firebase se añade a la cola real de Spotify. ¿Automáticamente la primera? ¿Manualmente por el admin? Para el prototipo, quizás un botón "Añadir siguiente a Spotify" en el panel de admin sea lo más simple.
Interfaz de Usuario: Mantenerla simple y clara para ambos tipos de usuarios.

¿consideras que este enfoque general es correcto y viable utilizando las herramientas de Firebase y la API de Spotify? ¿Identificas algún desafío técnico importante o alguna parte que sea particularmente difícil de implementar según lo descrito? ¿Hay alguna ambigüedad en mi descripción o necesitas hacerme alguna pregunta antes de generar el código para asegurar el mejor resultado posible?"
  