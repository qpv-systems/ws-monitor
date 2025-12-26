import { WebSocket } from 'ws';
import * as url from 'url';
import { IncomingMessage } from 'http';
import { ProxyState } from '../state';

export function handleWebSocketConnection(ws: WebSocket, req: IncomingMessage, state: ProxyState, proxyPort: number, maxClients: number = 0) {
    const parsedUrl = url.parse(req.url || '', true);

    // Check client limit before processing
    if (maxClients > 0 && state.getConnectionCount() >= maxClients) {
        const errorMsg = `Connection rejected: Maximum client limit reached (${maxClients} connections)`;
        console.log(`[WS] ${errorMsg}`);
        state.broadcastError(errorMsg);

        // Send error message to client before closing
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'error',
                message: errorMsg,
                code: 'MAX_CLIENTS_EXCEEDED',
                maxClients: maxClients,
                currentConnections: state.getConnectionCount()
            }));
        }

        ws.close(1008, errorMsg);
        return;
    }

    // Use activeTargetUrl if set, otherwise fallback to query param
    let targetUrl = state.activeTargetUrl || (parsedUrl.query.target as string);

    // Handle percent-encoded URLs
    if (targetUrl && typeof targetUrl === 'string' && targetUrl.includes('%')) {
        try {
            targetUrl = decodeURIComponent(targetUrl);
        } catch (e) {
            console.warn('Failed to decode targetUrl:', targetUrl, e);
        }
    }

    // Normalize targetUrl
    if (targetUrl) {
        targetUrl = targetUrl.trim();
        if (targetUrl.startsWith('http://')) targetUrl = targetUrl.replace('http://', 'ws://');
        if (targetUrl.startsWith('https://')) targetUrl = targetUrl.replace('https://', 'wss://');

        if (!targetUrl.includes('://')) {
            targetUrl = 'ws://' + targetUrl;
        }
    }

    if (!targetUrl) {
        const msg = 'Connection rejected: No target URL set';
        console.log(msg);
        state.broadcastError(msg);
        ws.close(1008, 'Target URL required');
        return;
    }

    if (state.activeProtocol !== 'ws') {
        const msg = 'Connection rejected: Protocol mismatch (expected ws)';
        console.log(msg);
        state.broadcastError(msg);
        ws.close(1008, 'Protocol mismatch');
        return;
    }

    // Prevent self-recursion
    const targetParsed = url.parse(targetUrl);
    const targetHost = targetParsed.hostname || 'localhost';
    const targetPort = targetParsed.port ? parseInt(targetParsed.port) : (targetParsed.protocol === 'wss:' ? 443 : 80);

    const isLocalhost = targetHost === 'localhost' || targetHost === '127.0.0.1' || targetHost === '::1';
    if (isLocalhost && targetPort === proxyPort) {
        const msg = `[WS] Connection rejected: Target is the proxy itself (${targetUrl})`;
        console.error(msg);
        state.broadcastError(msg);
        ws.close(1008, 'Recursive proxy loop detected');
        return;
    }

    // Extract session_id from query
    const sessionIdFromQuery = parsedUrl.query.session_id as string;

    console.log(`[WS] Proxying to ${targetUrl}`);

    // Create new session
    let targetWs: WebSocket;
    try {
        const options: any = {
            rejectUnauthorized: false, // CRITICAL for test servers
            handshakeTimeout: 10000,
            headers: {
                'Host': targetHost,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };
        targetWs = new WebSocket(targetUrl, options);
    } catch (err: any) {
        const msg = `[WS] Invalid Target URL: ${targetUrl} - ${err.message}`;
        console.error(msg);
        state.broadcastError(msg);
        ws.close(1008, 'Invalid Target URL');
        return;
    }
    const sessionId = state.createSession('ws', ws, targetWs, sessionIdFromQuery);

    const messageBuffer: any[] = [];

    // Heartbeat mechanism (30s)
    let isClientAlive = true;
    let isTargetAlive = true;

    const heartbeatInterval = setInterval(() => {
        // Check Client
        if (!isClientAlive) {
            console.log(`[WS] Client heartbeat timeout (Session: ${sessionId})`);
            return ws.terminate();
        }
        isClientAlive = false;
        ws.ping();

        // Check Target
        if (targetWs.readyState === WebSocket.OPEN) {
            if (!isTargetAlive) {
                console.log(`[WS] Target heartbeat timeout (Session: ${sessionId})`);
                return targetWs.terminate();
            }
            isTargetAlive = false;
            targetWs.ping();
        }
    }, 30000);

    ws.on('pong', () => { isClientAlive = true; });
    targetWs.on('pong', () => { isTargetAlive = true; });

    targetWs.on('open', () => {
        console.log(`[WS] Connected to target (Session: ${sessionId})`);
        state.broadcastStatus();
        messageBuffer.forEach(msg => targetWs.send(msg));
        messageBuffer.length = 0;
    });

    targetWs.on('message', (data, isBinary) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data, { binary: isBinary });
        }
        state.broadcastTraffic('server', data.toString(), sessionId);
    });

    targetWs.on('close', () => {
        console.log(`[WS] Target disconnected (Session: ${sessionId})`);
        clearInterval(heartbeatInterval);
        state.removeSession(sessionId);
        ws.close();
    });

    targetWs.on('error', (err) => {
        const msg = `[WS] Target error (Session: ${sessionId}): ${err.message}`;
        console.error(msg);
        clearInterval(heartbeatInterval);
        state.broadcastError(msg);
        ws.close();
        state.removeSession(sessionId);
    });

    ws.on('message', (data, isBinary) => {
        if (targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(data, { binary: isBinary });
        } else {
            messageBuffer.push(data);
        }
        state.broadcastTraffic('client', data.toString(), sessionId);
    });

    ws.on('close', () => {
        console.log(`[WS] Client disconnected (Session: ${sessionId})`);
        clearInterval(heartbeatInterval);
        state.removeSession(sessionId);
        targetWs.close();
    });

    ws.on('error', (err) => {
        console.error(`[WS] Client error (Session: ${sessionId}):`, err);
        clearInterval(heartbeatInterval);
        targetWs.close();
        state.removeSession(sessionId);
    });
}
