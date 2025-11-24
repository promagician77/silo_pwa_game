#!/bin/bash

echo "Starting local web server for SILO DERPLES PWA..."
echo ""
echo "Server will be available at: http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Try Python 3 first
if command -v python3 &> /dev/null; then
    echo "Using Python 3 HTTP server..."
    python3 -m http.server 8000
    exit 0
fi

# Try Python 2
if command -v python2 &> /dev/null; then
    echo "Using Python 2 HTTP server..."
    python2 -m SimpleHTTPServer 8000
    exit 0
fi

# Try Node.js http-server
if command -v npx &> /dev/null; then
    echo "Using Node.js http-server..."
    npx --yes http-server -p 8000 -c-1
    exit 0
fi

echo "ERROR: No web server found!"
echo ""
echo "Please install one of the following:"
echo "  1. Python 3 (https://www.python.org/downloads/)"
echo "  2. Node.js (https://nodejs.org/)"
echo ""
echo "Or use VS Code Live Server extension"
exit 1


