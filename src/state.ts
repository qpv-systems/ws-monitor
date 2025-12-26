import { WebSocket } from 'ws';
import { Socket as SocketIOSocket } from 'socket.io';
import { Socket as ClientSocket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

export interface Session {
    id: string;
    type: 'ws' | 'socketio';
    client: WebSocket | SocketIOSocket;
    target: WebSocket | ClientSocket;
    startTime: number;
}

export class ProxyState {
    // Active Session Configuration
    public activeTargetUrl: string | null = null;
    public activeProtocol: 'ws' | 'socketio' = 'ws';

    // Active Sessions
    private sessions = new Map<string, Session>();

    // Monitor Connections
    private monitors = new Set<WebSocket>();

    constructor() { }

    public addMonitor(ws: WebSocket) {
        this.monitors.add(ws);
        this.sendStatus(ws);
    }

    public removeMonitor(ws: WebSocket) {
        this.monitors.delete(ws);
    }

    public createSession(type: 'ws' | 'socketio', client: WebSocket | SocketIOSocket, target: WebSocket | ClientSocket, customSessionId?: string): string {
        const id = customSessionId || uuidv4();
        this.sessions.set(id, {
            id,
            type,
            client,
            target,
            startTime: Date.now()
        });
        this.broadcastStatus();
        return id;
    }

    public removeSession(id: string) {
        this.sessions.delete(id);
        this.broadcastStatus();
    }

    public disconnectAll() {
        this.sessions.forEach(session => {
            if (session.type === 'ws') {
                (session.client as WebSocket).close();
                (session.target as WebSocket).close();
            } else {
                (session.client as SocketIOSocket).disconnect(true);
                (session.target as ClientSocket).disconnect();
            }
        });
        this.sessions.clear();
        this.broadcastStatus();
    }

    public getConnectionCount(): number {
        return this.sessions.size;
    }

    public getStatus() {
        if (this.sessions.size > 0) {
            return `CONNECTED (${this.sessions.size})`;
        }
        if (this.activeTargetUrl) {
            return 'READY';
        }
        return 'IDLE';
    }

    public sendStatus(ws: WebSocket) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'status',
                status: this.getStatus(),
                target: this.activeTargetUrl,
                protocol: this.activeProtocol,
                connections: this.sessions.size
            }));
        }
    }

    public broadcastStatus() {
        const msg = JSON.stringify({
            type: 'status',
            status: this.getStatus(),
            target: this.activeTargetUrl,
            protocol: this.activeProtocol,
            connections: this.sessions.size
        });
        this.monitors.forEach(monitor => {
            if (monitor.readyState === WebSocket.OPEN) {
                monitor.send(msg);
            }
        });
    }

    public broadcastTraffic(source: 'client' | 'server', content: string, sessionId?: string) {
        const message = JSON.stringify({
            type: 'traffic',
            timestamp: Date.now(),
            source,
            content,
            protocol: this.activeProtocol,
            sessionId
        });
        this.monitors.forEach(monitor => {
            if (monitor.readyState === WebSocket.OPEN) {
                monitor.send(message);
            }
        });
    }

    public broadcastError(message: string) {
        const msg = JSON.stringify({
            type: 'error',
            message
        });
        this.monitors.forEach(monitor => {
            if (monitor.readyState === WebSocket.OPEN) {
                monitor.send(msg);
            }
        });
    }
}
