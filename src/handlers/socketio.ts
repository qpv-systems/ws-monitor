import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO } from 'socket.io-client';
import { ProxyState } from '../state';
import * as url from 'url';

export function setupSocketIO(io: SocketIOServer, state: ProxyState, proxyPort: number, maxClients: number = 0) {
    // Standard namespace and any dynamic namespaces (e.g. /ws, /chat, etc.)
    // In Socket.IO 4.x, we can use a regex to match multiple namespaces
    const dynamicNsp = io.of(/^\/.*$/);

    dynamicNsp.on('connection', (socket) => {
        const nspName = socket.nsp.name;
        console.log(`[SIO] Client connected to namespace: ${nspName}`);

        // Check client limit before processing
        if (maxClients > 0 && state.getConnectionCount() >= maxClients) {
            const errorMsg = `Connection rejected: Maximum client limit reached (${maxClients} connections)`;
            console.log(`[SIO] ${errorMsg}`);
            state.broadcastError(errorMsg);

            // Send error message to client before disconnecting
            socket.emit('error', {
                type: 'error',
                message: errorMsg,
                code: 'MAX_CLIENTS_EXCEEDED',
                maxClients: maxClients,
                currentConnections: state.getConnectionCount()
            });

            socket.disconnect(true);
            return;
        }

        if (state.activeProtocol !== 'socketio' || !state.activeTargetUrl) {
            const msg = '[SIO] Connection rejected: Not in Socket.IO mode or no target';
            console.log(msg);
            state.broadcastError(msg);
            socket.disconnect(true);
            return;
        }

        // Prevent self-recursion
        const targetParsed = url.parse(state.activeTargetUrl);
        const targetHost = targetParsed.hostname || 'localhost';
        const targetPort = targetParsed.port ? parseInt(targetParsed.port) : (targetParsed.protocol === 'https:' ? 443 : 80);

        const isLocalhost = targetHost === 'localhost' || targetHost === '127.0.0.1' || targetHost === '::1';
        if (isLocalhost && targetPort === proxyPort) {
            const msg = `[SIO] Connection rejected: Target is the proxy itself (${state.activeTargetUrl})`;
            console.error(msg);
            state.broadcastError(msg);
            socket.disconnect(true);
            return;
        }

        // Extract session_id from handshake
        const sessionIdFromQuery = socket.handshake.query.session_id as string;

        console.log(`[SIO] Proxying to ${state.activeTargetUrl}`);

        // Create new session
        const targetSocket = ClientIO(state.activeTargetUrl, {
            transports: ['websocket', 'polling'],
            reconnection: false,
            rejectUnauthorized: false, // Allow testing with self-signed target certs
        });
        const sessionId = state.createSession('socketio', socket, targetSocket, sessionIdFromQuery);

        state.broadcastStatus();

        // Forward Client -> Target
        socket.onAny((event, ...args) => {
            if (targetSocket.connected) {
                targetSocket.emit(event, ...args);
            }
            state.broadcastTraffic('client', JSON.stringify({ event, args }), sessionId);
        });

        // Forward Target -> Client
        targetSocket.onAny((event, ...args) => {
            if (socket.connected) {
                socket.emit(event, ...args);
            }
            state.broadcastTraffic('server', JSON.stringify({ event, args }), sessionId);
        });

        targetSocket.on('connect', () => {
            console.log(`[SIO] Connected to target (Session: ${sessionId})`);
            state.broadcastStatus();
        });

        targetSocket.on('disconnect', () => {
            console.log(`[SIO] Target disconnected (Session: ${sessionId})`);
            state.removeSession(sessionId);
            socket.disconnect();
        });

        targetSocket.on('connect_error', (err) => {
            const msg = `[SIO] Target connection error (Session: ${sessionId}): ${err.message}`;
            console.error(msg);
            state.broadcastError(msg);
            socket.disconnect();
            state.removeSession(sessionId);
        });

        socket.on('disconnect', () => {
            console.log(`[SIO] Client disconnected (Session: ${sessionId})`);
            state.removeSession(sessionId);
            targetSocket.disconnect();
        });
    });
}
