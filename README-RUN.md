# How to Run SILO DERPLES PWA

This PWA must be served from a web server (not opened directly as a file). Here are several ways to run it:

## Quick Start (Windows)

Double-click `start-server.bat` in the `web-build` folder, then open http://localhost:8000 in your browser.

## Quick Start (Mac/Linux)

Run in terminal:
```bash
cd web-build
chmod +x start-server.sh
./start-server.sh
```

Then open http://localhost:8000 in your browser.

## Manual Methods

### Option 1: Python (Recommended - Usually Pre-installed)

**Python 3:**
```bash
cd web-build
python -m http.server 8000
```

**Python 2:**
```bash
cd web-build
python2 -m SimpleHTTPServer 8000
```

Then open http://localhost:8000 in your browser.

### Option 2: Node.js http-server

```bash
cd web-build
npx http-server -p 8000 -c-1
```

The `-c-1` flag disables caching for development.

### Option 3: VS Code Live Server Extension

1. Install the "Live Server" extension in VS Code
2. Right-click on `index.html` in the `web-build` folder
3. Select "Open with Live Server"

### Option 4: PHP Built-in Server

```bash
cd web-build
php -S localhost:8000
```

## Testing PWA Features

Once the server is running:

1. **Open in Browser**: Navigate to http://localhost:8000
2. **Install PWA**: 
   - Chrome/Edge: Look for install icon in address bar
   - Or use the install button that appears on the page
3. **Test Offline**: 
   - Install the app
   - Turn off network
   - Reload - it should still work!

## Troubleshooting

- **Service Worker not working?** Make sure you're accessing via `http://localhost` (not `file://`)
- **Install button not showing?** The app must be served over HTTPS or localhost
- **Cached old version?** Clear browser cache or use incognito mode

## Production Deployment

For production, deploy the entire `web-build` folder to any static hosting service:
- Netlify
- Vercel
- GitHub Pages
- Firebase Hosting
- AWS S3 + CloudFront
- Any web server (Apache, Nginx, etc.)

Make sure to serve over HTTPS for full PWA features!


