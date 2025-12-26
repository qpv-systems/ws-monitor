// Global state
let ws = null;
let socket = null;
let currentProtocol = 'ws'; // 'ws' or 'io'
let currentMessageType = 'encrypted'; // 'encrypted' or 'raw'
let currentInputMode = 'text'; // 'text' or 'json'
let cryptoService = null;
let messages = [];

// DOM elements
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const sendBtn = document.getElementById('sendBtn');
const wsUrlInput = document.getElementById('wsUrl');
const encryptionKeyInput = document.getElementById('encryptionKey');
const hmacKeyInput = document.getElementById('hmacKey');
const messageInput = document.getElementById('messageInput');
const connectionStatus = document.getElementById('connectionStatus');
const messagesList = document.getElementById('messagesList');
const protocolRadios = document.getElementsByName('protocol');
const messageTypeRadios = document.getElementsByName('messageType');
const inputModeRadios = document.getElementsByName('inputMode');

// Update URL placeholder when protocol changes
protocolRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        currentProtocol = e.target.value;
        if (currentProtocol === 'ws') {
            wsUrlInput.placeholder = 'ws://localhost:8080';
            wsUrlInput.value = 'ws://localhost:8080';
        } else {
            wsUrlInput.placeholder = 'http://localhost:4001';
            wsUrlInput.value = 'http://localhost:4001';
        }
    });
});

// Update message type state
messageTypeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        currentMessageType = e.target.value;
    });
});

// Update input mode state and placeholder
inputModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        currentInputMode = e.target.value;
        if (currentInputMode === 'text') {
            messageInput.placeholder = 'Enter your message here...';
        } else {
            messageInput.placeholder = 'Enter valid JSON here... (e.g. {"key": "value"})';
        }
    });
});

// Initialize crypto service
function initCryptoService() {
    const encKey = encryptionKeyInput.value || 'default-encryption-key-change-in-production-32bytes';
    const hmacKey = hmacKeyInput.value || 'default-hmac-key-change-in-production-secret';
    cryptoService = new BrowserCryptoService(encKey, hmacKey);
}

// Encode WebSocket URL - encode target parameter if present
function encodeWebSocketUrl(urlString) {
    if (!urlString) {
        return 'ws://localhost:8080';
    }

    try {
        const url = new URL(urlString);
        const targetParam = url.searchParams.get('target');

        if (targetParam) {
            // Encode the target parameter
            url.searchParams.set('target', encodeURIComponent(targetParam));
            return url.toString();
        }

        return urlString;
    } catch (error) {
        // If URL parsing fails, try manual parsing for WebSocket URLs
        const match = urlString.match(/^(ws[s]?:\/\/[^?]+)(\?target=)(.+)$/);
        if (match) {
            const baseUrl = match[1];
            const queryPrefix = match[2];
            const targetUrl = match[3];
            return baseUrl + queryPrefix + encodeURIComponent(decodeURIComponent(targetUrl));
        }

        return urlString;
    }
}

// Connect to Server
connectBtn.addEventListener('click', async () => {
    try {
        const rawUrl = wsUrlInput.value || (currentProtocol === 'ws' ? 'ws://localhost:8080' : 'http://localhost:4001');
        const url = encodeWebSocketUrl(rawUrl);

        initCryptoService();

        if (currentProtocol === 'ws') {
            connectWebSocket(url);
        } else {
            connectSocketIO(url);
        }
    } catch (error) {
        console.error('Connection error:', error);
        addSystemMessage('Connection error: ' + error.message, true);
    }
});

function onConnected() {
    console.log('Connected to server');
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'status connected';
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    sendBtn.disabled = false;
    messageInput.disabled = false;
    addSystemMessage(`Connected to server (${currentProtocol})`);
}

function onDisconnected() {
    console.log('Disconnected from server');
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.className = 'status disconnected';
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    sendBtn.disabled = true;
    messageInput.disabled = true;
    addSystemMessage('Disconnected from server');
    ws = null;
    socket = null;
}

function connectWebSocket(url) {
    ws = new WebSocket(url);

    ws.onopen = onConnected;

    ws.onmessage = async (event) => {
        await handleMessage(event.data);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        addSystemMessage('WebSocket error occurred', true);
    };

    ws.onclose = onDisconnected;
}

function connectSocketIO(url) {
    socket = io(url, {
        transports: ['websocket', 'polling']
    });

    socket.on('connect', onConnected);

    socket.on('message', async (data) => {
        // Socket.IO might return object directly, but our handleMessage expects string or object
        // If it's an object, we might need to stringify it if handleMessage expects string, 
        // OR we update handleMessage to handle both.
        // Let's update handleMessage to handle both.
        await handleMessage(data);
    });

    socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
        addSystemMessage('Connection error: ' + error.message, true);
    });

    socket.on('disconnect', onDisconnected);
}

async function handleMessage(rawData) {
    try {
        let data = rawData;
        if (typeof rawData === 'string') {
            try {
                data = JSON.parse(rawData);
            } catch (e) {
                // keep as string if not json
            }
        }

        // Store encrypted message
        const encryptedMessage = { ...data };

        let decryptedData = null;
        let isEncrypted = false;

        // Check if message is encrypted
        if (cryptoService.isEncryptedPayload(data)) {
            isEncrypted = true;
            try {
                decryptedData = await cryptoService.decrypt(data);
                console.log('Received encrypted message, decrypted:', decryptedData);
            } catch (error) {
                console.error('Failed to decrypt message:', error);
                addMessage('received', null, encryptedMessage, error.message);
                return;
            }
        } else {
            decryptedData = data;
            console.log('Received plain message:', decryptedData);
        }

        addMessage('received', decryptedData, isEncrypted ? encryptedMessage : null, null);
    } catch (error) {
        console.error('Error processing received message:', error);
        addSystemMessage('Error processing message: ' + error.message, true);
    }
}

// Disconnect from server
disconnectBtn.addEventListener('click', () => {
    if (ws) {
        ws.close();
        ws = null;
    }
    if (socket) {
        socket.disconnect();
        socket = null;
    }
});

// Send encrypted message
sendBtn.addEventListener('click', async () => {
    if ((!ws || ws.readyState !== WebSocket.OPEN) && (!socket || !socket.connected)) {
        alert('Not connected to server');
        return;
    }

    const messageText = messageInput.value.trim();
    if (!messageText) {
        alert('Please enter a message');
        return;
    }

    try {
        let messageData = null;

        if (currentInputMode === 'text') {
            messageData = {
                message: messageText,
                timestamp: new Date().toISOString()
            };
        } else {
            // JSON mode
            try {
                // Parse only for validation
                messageData = JSON.parse(messageText);
            } catch (e) {
                alert('Invalid JSON: ' + e.message);
                return;
            }
        }

        let payloadToSend = null;
        let encryptedPayload = null;

        if (currentMessageType === 'encrypted') {
            // Encrypt the message (always needs an object)
            encryptedPayload = await cryptoService.encrypt(messageData);
            payloadToSend = JSON.stringify(encryptedPayload);
        } else {
            // Send raw message
            // If in JSON mode, send the original text y chang như user nhập
            payloadToSend = currentInputMode === 'json' ? messageText : JSON.stringify(messageData);
        }

        // Store message before sending
        addMessage('sent', messageData, encryptedPayload, null);

        // Send message
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(payloadToSend);
        } else if (socket && socket.connected) {
            // Socket.IO's .emit(payload) will automatically parse it if it's a JSON string?
            // Actually, for Socket.IO we should emit the parsed object if we've parsed it,
            // but the user wants "y chang như thế".
            // If we emit a string, Socket.IO sends a string. 
            // If we emit an object, Socket.IO sends an object.
            // Let's send the object if it's JSON mode to keep it as an object on the server side,
            // OR if they really want the EXACT string (including whitespace), we emit the string.
            // Based on "websocket client gửi y chang như thế", sending the string is safer.
            socket.emit('message', currentInputMode === 'json' ? messageText : messageData);
        }

        // Clear input
        messageInput.value = '';
    } catch (error) {
        console.error('Error sending message:', error);
        addSystemMessage('Error sending message: ' + error.message, true);
    }
});

// Allow sending with Enter key (Ctrl+Enter or Shift+Enter)
messageInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.shiftKey) && e.key === 'Enter') {
        sendBtn.click();
    }
});

// Add message to the list
function addMessage(type, decrypted, encrypted, error) {
    const message = {
        id: Date.now() + Math.random(),
        type: type,
        decrypted: decrypted,
        encrypted: encrypted,
        error: error,
        timestamp: new Date()
    };

    messages.push(message);
    renderMessages();
}

// Add system message
function addSystemMessage(text, isError = false) {
    const message = {
        id: Date.now() + Math.random(),
        type: 'system',
        text: text,
        isError: isError,
        timestamp: new Date()
    };

    messages.push(message);
    renderMessages();
}

// Render all messages
function renderMessages() {
    messagesList.innerHTML = '';

    messages.forEach(msg => {
        const messageItem = document.createElement('div');
        messageItem.className = `message-item ${msg.type}${msg.isError ? ' error' : ''}`;

        if (msg.type === 'system') {
            messageItem.innerHTML = `
                <div class="message-header">
                    <span class="message-type">System</span>
                    <span class="message-time">${formatTime(msg.timestamp)}</span>
                </div>
                <div class="message-content">
                    <p>${msg.text}</p>
                </div>
            `;
        } else {
            const typeLabel = msg.type === 'sent' ? 'Sent' : 'Received';

            let contentHTML = '';

            if (msg.error) {
                contentHTML = `
                    <div class="message-section error">
                        <h4>Error</h4>
                        <pre>${escapeHtml(msg.error)}</pre>
                    </div>
                `;
            }

            if (msg.decrypted) {
                contentHTML += `
                    <div class="message-section decrypted">
                        <h4>Decrypted Message</h4>
                        <pre>${escapeHtml(JSON.stringify(msg.decrypted, null, 2))}</pre>
                    </div>
                `;
            }

            if (msg.encrypted) {
                contentHTML += `
                    <div class="message-section encrypted">
                        <h4>Encrypted Payload</h4>
                        <pre>${escapeHtml(JSON.stringify(msg.encrypted, null, 2))}</pre>
                    </div>
                `;
            }

            messageItem.innerHTML = `
                <div class="message-header">
                    <span class="message-type ${msg.type}">${typeLabel}</span>
                    <span class="message-time">${formatTime(msg.timestamp)}</span>
                </div>
                <div class="message-content">
                    ${contentHTML}
                </div>
            `;
        }

        messagesList.appendChild(messageItem);
    });

    // Scroll to bottom
    messagesList.scrollTop = messagesList.scrollHeight;
}

// Format time
function formatTime(date) {
    return date.toLocaleTimeString() + ' ' + date.toLocaleDateString();
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initCryptoService();
    renderMessages();
});
