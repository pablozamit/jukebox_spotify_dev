# Bar Jukebox

Bar Jukebox is a Next.js application using Electron to allow users in a bar to queue songs using Spotify.

## Local Development

### Prerequisites

*   Node.js (v18 or later recommended)
*   npm

### Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-name>
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Spotify API Credentials:**
    *   Run the application once (see steps below).
    *   Navigate to the Admin panel (Settings icon on the main page).
    *   Enter your Spotify Client ID and Client Secret. These are obtained from the Spotify Developer Dashboard.
    *   Select your Spotify playback device.

### Running the Application

1.  **Start the Next.js development server:**
    ```bash
    npm run dev
    ```
    This will typically run the web application on `http://localhost:9002`.

2.  **Start the Electron application:**
    In a separate terminal:
    ```bash
    npm run start:electron
    ```
    This will open the Electron window, loading the Next.js app.

## Building the Executable

To build the application into a distributable format (e.g., an `.exe` installer for Windows):

```bash
npm run dist
```

The output will be located in the `dist_electron` directory. The build process uses `electron-builder` and includes creating an installer.

## Key Features

*   Spotify integration for song search and playback.
*   Song queue managed locally.
*   Admin panel for configuration (Spotify credentials, playlist mode, playback device).
*   Continuous playback: automatically plays the next song in the queue.
