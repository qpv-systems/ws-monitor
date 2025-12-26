import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { Server as SocketIOServer } from 'socket.io';
import * as url from 'url';
import 'dotenv/config';
import { ProxyState } from './state';
import { handleWebSocketConnection } from './handlers/websocket';
import { setupSocketIO } from './handlers/socketio';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8000;
const MAX_CLIENTS = process.env.MAX_CLIENTS ? parseInt(process.env.MAX_CLIENTS) : 0; // 0 = unlimited

// Helper to serve static files
const serveStatic = (res: http.ServerResponse, baseDir: string, relPath: string) => {
    if (relPath === '/' || relPath === '') relPath = '/index.html';
    const filePath = path.join(__dirname, '..', baseDir, relPath);

    // Prevent directory traversal
    const absoluteBase = path.join(__dirname, '..', baseDir);
    if (!filePath.startsWith(absoluteBase)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
};

// HTTP Server
const server = http.createServer((req, res) => {
    const urlParts = url.parse(req.url || '', true);
    const safeUrl = urlParts.pathname || '/';

    // Skip Socket.IO requests - they are handled by the io server instance
    if (safeUrl.startsWith('/socket.io/')) {
        return;
    }

    // 1. Redirect Root to Monitor UI
    if (safeUrl === '/') {
        res.writeHead(301, { Location: '/playground/' });
        res.end();
    }
    // 2. Monitor UI (Playground URL)
    else if (safeUrl === '/playground') {
        res.writeHead(301, { Location: '/playground/' });
        res.end();
    }
    else if (safeUrl.startsWith('/playground/')) {
        const relPath = safeUrl.replace('/playground/', '/');
        serveStatic(res, 'public', relPath);
    }
    // 3. Simulator UI (The Popup content)
    else if (safeUrl === '/simulator') {
        res.writeHead(301, { Location: '/simulator/' });
        res.end();
    }
    else if (safeUrl.startsWith('/simulator/')) {
        const relPath = safeUrl.replace('/simulator/', '/');
        serveStatic(res, 'frontend', relPath);
    }
    // 4. Fallback for 404
    else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// WebSocket Server (Raw)
const wss = new WebSocketServer({ noServer: true });

// Socket.IO Server
const io = new SocketIOServer(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingInterval: 30000,
    pingTimeout: 5000
});

// Initialize State
const state = new ProxyState();

// Setup Socket.IO Handler
setupSocketIO(io, state, PORT, MAX_CLIENTS);

// Handle Upgrade Requests Manually to avoid conflict with Socket.IO
server.on('upgrade', (request, socket, head) => {
    const parsedUrl = url.parse(request.url || '', true);
    const pathname = parsedUrl.pathname;

    // If it's a Socket.IO request, let Socket.IO handle it
    if (pathname?.startsWith('/socket.io/')) {
        return;
    }

    if (pathname !== "/" && pathname !== "/ws" && pathname !== "/monitor") {
        socket.destroy();
        return;
    }

    // Otherwise, handle as Raw WebSocket (Monitor or Proxy)
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// --- Monitor & Proxy Handling ---
wss.on('connection', (ws, req) => {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname;

    // UI Monitor Connection
    if (pathname === '/monitor') {
        handleMonitorConnection(ws);
        return;
    }

    // Proxy Client Connection (Raw WS)
    handleWebSocketConnection(ws, req, state, PORT, MAX_CLIENTS);
});

function handleMonitorConnection(ws: WebSocket) {
    state.addMonitor(ws);
    console.log('Monitor connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'SET_TARGET') {
                state.activeTargetUrl = data.url;
                state.activeProtocol = data.protocol || 'ws'; // Default to ws
                console.log(`Target set to: ${state.activeTargetUrl} (${state.activeProtocol})`);
                state.broadcastStatus();
            } else if (data.type === 'DISCONNECT') {
                console.log('Disconnecting active session...');
                state.disconnectAll();
                state.broadcastStatus();
            }
        } catch (e) {
            console.error('Error parsing monitor message:', e);
        }
    });

    ws.on('close', () => state.removeMonitor(ws));
}

server.listen(PORT, () => {
    console.log(`Proxy Server running on http://localhost:${PORT}`);
});
