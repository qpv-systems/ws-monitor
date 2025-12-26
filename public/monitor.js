const messageList = document.getElementById('messageList');
const detailContent = document.getElementById('detailContent');
const detailMetadata = document.getElementById('detailMetadata');
const msgCount = document.getElementById('msgCount');
const connectionStatus = document.getElementById('connectionStatus');
const proxyStatusBadge = document.getElementById('proxyStatusBadge');
const copyBtn = document.getElementById('copyBtn');
const filterByFieldInput = document.getElementById('filterByField');
const testBtn = document.getElementById('testBtn');
const targetUrlInput = document.getElementById('targetUrl');
const proxyUrlDisplay = document.getElementById('proxyUrlDisplay');
const mainContainer = document.getElementById('mainContainer');
const popupTemplate = document.getElementById('popupTemplate');
const toastContainer = document.getElementById('toastContainer');
const scriptModal = document.getElementById('scriptModal');
const scriptEditor = document.getElementById('scriptEditor');
const embedModal = document.getElementById('embedModal');
const embedHtmlInput = document.getElementById('embedHtml');
const embedCssInput = document.getElementById('embedCss');
const embedJsInput = document.getElementById('embedJs');
const embedHtmlFile = document.getElementById('embedHtmlFile');
const embedCssFile = document.getElementById('embedCssFile');
const embedJsFile = document.getElementById('embedJsFile');
const sessionIdInput = document.getElementById('sessionIdInput');
const filterBySessionIdCheckbox = document.getElementById('filterBySessionId');
const proxyHostInput = document.getElementById('proxyHost');

let messages = [];
let selectedMessageIndex = -1;
let monitorWs = null;
let activeProtocol = 'ws'; // Default
let customDecryptFunction = null;

// Initialize Proxy Host
if (!proxyHostInput.value) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Default to current host
    let domain = window.location.host;
    proxyHostInput.value = `${protocol}//${domain}`;
}

// Initialize Session ID
if (!sessionIdInput.value) {
    generateNewSessionId();
}

function generateNewSessionId() {
    sessionIdInput.value = getUUID();
    updateProxyUrlDisplay();
    rerenderList();
}

function getUUID() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    // fallback cho browser cũ
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

sessionIdInput.addEventListener('input', () => {
    updateProxyUrlDisplay();
    rerenderList();
});

// --- Monitor Connection ---
function connectMonitor() {
    // Use manually configured proxy host, or fallback to current location
    let wsUrl = proxyHostInput.value.trim();

    if (!wsUrl) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}`;
    }

    console.log({ wsUrl })
    // Ensure monitor endpoint
    if (wsUrl.endsWith('/')) wsUrl = wsUrl.slice(0, -1);
    if (!wsUrl.endsWith('/monitor')) {
        // If it ends with /ws (Nginx path), we need to replace it or append
        if (wsUrl.endsWith('/ws')) {
            wsUrl = wsUrl.replace(/\/ws$/, '/monitor');
        } else {
            wsUrl += '/monitor';
        }
    }

    console.log('Connecting to Monitor WS:', wsUrl);
    monitorWs = new WebSocket(wsUrl);

    monitorWs.onopen = () => {
        connectionStatus.textContent = 'UI: CONNECTED';
        connectionStatus.className = 'status-badge status-connected';
    };

    monitorWs.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'status') {
                updateStatus(data);
            } else if (data.type === 'traffic') {
                await addMessage(data);
            } else if (data.type === 'error') {
                showToast(data.message, 'error');
            }
        } catch (e) {
            console.error('Error parsing monitor message:', e);
        }
    };

    monitorWs.onclose = () => {
        connectionStatus.textContent = 'UI: DISCONNECTED';
        connectionStatus.className = 'status-badge status-idle';
        setTimeout(connectMonitor, 2000);
    };

    monitorWs.onerror = (err) => {
        console.error('Monitor WS Error:', err);
        monitorWs.close();
    };
}

function updateStatus(data) {
    const status = data.status; // IDLE, READY, CONNECTED
    proxyStatusBadge.textContent = 'PROXY: ' + status;

    if (status.startsWith('CONNECTED')) {
        proxyStatusBadge.className = 'status-badge status-connected';
    } else if (status === 'READY') {
        proxyStatusBadge.className = 'status-badge status-ready';
    } else {
        proxyStatusBadge.className = 'status-badge status-idle';
    }

    // Update Active Target Display
    const activeTargetDisplay = document.getElementById('activeTargetDisplay');
    if (data.target) {
        activeTargetDisplay.textContent = `${data.target} (${data.protocol || 'ws'})`;
        activeTargetDisplay.style.color = '#4ec9b0';
    } else {
        activeTargetDisplay.textContent = 'None';
        activeTargetDisplay.style.color = '#aaa';
    }

    // Update local protocol state if server sends it
    if (data.protocol) {
        activeProtocol = data.protocol;
        document.getElementById('protocolSelect').value = activeProtocol;
        updateProxyUrlDisplay();
    }
}

function setTarget() {
    const target = targetUrlInput.value.trim();
    const protocol = document.getElementById('protocolSelect').value;

    if (!target) {
        showToast('Please enter a Target URL', 'error');
        return;
    }

    const validSchemes = ['ws://', 'wss://', 'http://', 'https://'];
    const isValid = validSchemes.some(scheme => target.startsWith(scheme));

    if (!isValid) {
        showToast('Invalid URL scheme. Must start with ws://, wss://, http://, or https://', 'error');
        return;
    }

    if (monitorWs && monitorWs.readyState === WebSocket.OPEN) {
        monitorWs.send(JSON.stringify({
            type: 'SET_TARGET',
            url: target,
            protocol: protocol
        }));
        showToast('Target update sent to server...', 'info');
        activeProtocol = protocol;
        updateProxyUrlDisplay();
    } else {
        showToast('Monitor not connected', 'error');
    }
}

function updateProxyUrlDisplay() {
    const sessionId = sessionIdInput.value;
    const selectedProtocol = document.getElementById('protocolSelect').value;
    let baseUrl = proxyHostInput.value.trim();

    if (!baseUrl) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        baseUrl = `${protocol}//${window.location.host}`;
    }

    let url = baseUrl;

    if (sessionId) {
        const separator = url.includes('?') ? '&' : '?';
        url += `${separator}session_id=${encodeURIComponent(sessionId)}`;
    }

    proxyUrlDisplay.value = url;
}

function copyProxyUrl(btn) {
    const url = proxyUrlDisplay.value;
    navigator.clipboard.writeText(url).then(() => {
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('copied');
        }, 2000);
    });
}

async function addMessage(data) {
    // Apply custom decryption if defined
    if (customDecryptFunction) {
        try {
            const decrypted = await customDecryptFunction(data.content);
            if (typeof decrypted === 'string') {
                data.content = decrypted;
            } else {
                data.content = JSON.stringify(decrypted);
            }
            data.decrypted = true;
        } catch (e) {
            console.error('Decryption failed:', e);
            data.decryptionError = e.message;
        }
    }

    messages.unshift(data);
    if (messages.length > 1000) messages.pop(); // Limit history
    rerenderList();
}

function rerenderList() {
    messageList.innerHTML = '';
    const filterText = filterByFieldInput.value.trim();
    const filterTextLower = filterText.toLowerCase();
    const filterSessionId = filterBySessionIdCheckbox.checked ? sessionIdInput.value : null;

    let visibleCount = 0;

    messages.forEach((msg, index) => {
        // Filter by Session ID
        if (filterSessionId && msg.sessionId && msg.sessionId !== filterSessionId) {
            return;
        }

        // // Filter by Content
        // if (filterTextLower) {
        //     const content = msg.content.toLowerCase();
        //     if (!content.includes(filterTextLower)) {
        //         return;
        //     }
        // }

        visibleCount++;

        const div = document.createElement('div');
        div.className = 'message-item';
        if (index === selectedMessageIndex) div.classList.add('selected');

        div.onclick = () => selectMessage(index);
        div.draggable = true;
        div.ondragstart = (e) => drag(e, index);
        div.ondblclick = (e) => spawnMessagePopup(msg, e.clientX, e.clientY);

        const time = new Date(msg.timestamp).toLocaleTimeString() + '.' + String(new Date(msg.timestamp).getMilliseconds()).padStart(3, '0');
        const preview = msg.content.substring(0, 150) + (msg.content.length > 150 ? '...' : '');

        // Badge Logic
        let badgeHtml = '';
        if (filterText) {
            try {
                const json = JSON.parse(msg.content);
                if (json && json[filterText] !== undefined) {
                    badgeHtml += `<span class="msg-badge visible" style="background-color: #e14d27; margin-right: 5px;">${escapeHtml(String(json[filterText]))}</span>`;
                }
            } catch (e) { }
        }

        if (msg.decrypted) {
            badgeHtml += '<span class="msg-badge visible">DEC</span>';
        }

        div.innerHTML = `
            <div class="msg-meta">
                <span>#${messages.length - index}</span>
                <span>${time}</span>
            </div>
            <div style="display:flex; align-items:center; justify-content: space-between;">
                <span class="msg-source ${msg.source === 'client' ? 'source-client' : 'source-server'}">${msg.source.toUpperCase()}</span>
                <span style="font-size:0.8rem; color:#666;">${msg.content.length}B</span>
            </div>
            <div class="msg-preview">
                ${badgeHtml}
                ${escapeHtml(preview)}
            </div>
        `;
        messageList.appendChild(div);
    });

    msgCount.textContent = visibleCount;
}

function selectMessage(index) {
    selectedMessageIndex = index;
    rerenderList();

    const msg = messages[index];
    if (!msg) return;

    // Render Details
    detailMetadata.innerHTML = '';
    detailContent.innerHTML = '';

    // Metadata
    const meta = [
        { label: 'Timestamp', value: new Date(msg.timestamp).toISOString() },
        { label: 'Source', value: msg.source.toUpperCase() },
        { label: 'Protocol', value: msg.protocol || 'WS' },
        { label: 'Session ID', value: msg.sessionId || 'N/A' },
        { label: 'Length', value: msg.content.length + ' bytes' },
        { label: 'Decrypted', value: msg.decrypted ? 'Yes' : 'No' }
    ];

    meta.forEach(m => {
        const item = document.createElement('div');
        item.className = 'meta-item';
        item.innerHTML = `<span class="meta-label">${m.label}</span><span class="meta-value">${m.value}</span>`;
        detailMetadata.appendChild(item);
    });
    detailMetadata.style.display = 'grid';
    copyBtn.style.display = 'block';

    // Content
    // Try to format as JSON
    try {
        const json = JSON.parse(msg.content);
        detailContent.innerHTML = syntaxHighlight(json);
    } catch (e) {
        detailContent.textContent = msg.content;
    }
}

function clearLog() {
    messages = [];
    selectedMessageIndex = -1;
    rerenderList();
    detailMetadata.style.display = 'none';
    detailContent.innerHTML = '<div class="empty-state">Select a message to view details</div>';
    copyBtn.style.display = 'none';
}

function testConnection() {
    const target = targetUrlInput.value.trim();
    if (!target) {
        showToast('Please enter a Target URL first', 'error');
        return;
    }

    const protocol = document.getElementById('protocolSelect').value;
    const sessionId = sessionIdInput.value;
    const proxyUrl = proxyUrlDisplay.value;

    showToast(`Testing connection to Proxy...`, 'info');
    if (protocol === 'ws') {
        try {
            const ws = new WebSocket(proxyUrl);
            ws.onopen = () => {
                showToast('Test: Connected to Proxy!', 'success');
                ws.send('Hello from Test Client');
                setTimeout(() => ws.close(), 1000);
            };
            ws.onerror = (err) => {
                showToast('Test: Connection Failed', 'error');
                console.error(err);
            };
        } catch (e) {
            showToast('Test: Error creating WebSocket', 'error');
        }
    } else {
        if (typeof io === 'undefined') {
            showToast('Socket.IO client library not loaded.', 'error');
            return;
        }

        const socket = io(proxyUrl, {
            transports: ['websocket', 'polling'],
            reconnection: false,
            query: { session_id: sessionId }
        });

        socket.on('connect', () => {
            showToast('Test: Connected to Proxy (Socket.IO)!', 'success');
            socket.emit('test_event', { msg: 'Hello from Test Client' });
            setTimeout(() => socket.disconnect(), 1000);
        });

        socket.on('connect_error', (err) => {
            showToast('Test: Connection Failed: ' + err.message, 'error');
        });
    }
}

// --- Helpers ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function syntaxHighlight(json) {
    if (typeof json != 'string') {
        json = JSON.stringify(json, undefined, 2);
    }
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        var cls = 'json-number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'json-key';
            } else {
                cls = 'json-string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'json-boolean';
        } else if (/null/.test(match)) {
            cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
    });
}

function copyToClipboard() {
    const msg = messages[selectedMessageIndex];
    if (!msg) return;
    navigator.clipboard.writeText(msg.content).then(() => {
        showToast('Content copied to clipboard', 'success');
    });
}

// --- Scripting ---
function openScriptModal() {
    scriptModal.classList.add('visible');
    const savedScript = localStorage.getItem('customScript');
    if (savedScript) {
        scriptEditor.value = savedScript;
    }
}

function closeScriptModal() {
    scriptModal.classList.remove('visible');
}

function saveScript() {
    const code = scriptEditor.value;
    try {
        // Evaluate to check for syntax errors
        // We wrap it in a function to avoid polluting global scope immediately
        const func = new Function('payload', code + '\nreturn customDecrypt(payload);');

        // If successful, save and apply
        localStorage.setItem('customScript', code);

        // Create the actual function to be used
        // We create a function that executes the user's code and calls customDecrypt
        customDecryptFunction = async (payload) => {
            // Create a new function context for each execution or reuse?
            // Reusing is better. We need to extract the customDecrypt function from the code.
            // A simple way is to eval the code in global scope or use a closure.
            // Let's use a closure approach:
            const userCode = code + '\nreturn customDecrypt;';
            const factory = new Function(userCode);
            const decrypt = factory();
            return decrypt(payload);
        };

        showToast('Script saved and applied!', 'success');
        closeScriptModal();
    } catch (e) {
        showToast('Error in script: ' + e.message, 'error');
    }
}

// Load saved script on startup
const savedScript = localStorage.getItem('customScript');
if (savedScript) {
    try {
        const userCode = savedScript + '\nreturn customDecrypt;';
        const factory = new Function(userCode);
        customDecryptFunction = factory();
        console.log('Custom script loaded');
    } catch (e) {
        console.error('Failed to load saved script:', e);
    }
}

// --- Embed ---
function openEmbedModal() {
    embedModal.classList.add('visible');
}

function closeEmbedModal() {
    embedModal.classList.remove('visible');
}

function applyEmbed() {
    const html = embedHtmlInput.value;
    const css = embedCssInput.value;
    const js = embedJsInput.value;

    // Create a new popup window or use the main container?
    // The user wants to "Embed Page". Let's replace the main container content or add a tab?
    // For now, let's open a popup.

    const popup = document.createElement('div');
    popup.className = 'popup';
    popup.style.width = '800px';
    popup.style.height = '600px';
    popup.style.top = '100px';
    popup.style.left = '100px';

    popup.innerHTML = `
        <div class="popup-header" onmousedown="startDrag(event, this.parentElement)">
            <span class="popup-title">Embedded View</span>
            <button class="popup-close" onclick="closePopup(this)">×</button>
        </div>
        <div class="popup-content" style="padding:0; overflow:hidden;">
            <iframe style="width:100%; height:100%; border:none;"></iframe>
        </div>
    `;

    mainContainer.appendChild(popup);

    const iframe = popup.querySelector('iframe');
    const doc = iframe.contentWindow.document;

    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <style>${css}</style>
        </head>
        <body>
            ${html}
            <script>${js}<\/script>
        </body>
        </html>
    `);
    doc.close();

    closeEmbedModal();
}

// File inputs for Embed
function handleFileSelect(evt, targetInput) {
    const file = evt.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        targetInput.value = e.target.result;
    };
    reader.readAsText(file);
}

embedHtmlFile.addEventListener('change', (e) => handleFileSelect(e, embedHtmlInput));
embedCssFile.addEventListener('change', (e) => handleFileSelect(e, embedCssInput));
embedJsFile.addEventListener('change', (e) => handleFileSelect(e, embedJsInput));

// --- Playground ---
function openPlayground() {
    const popup = document.createElement('div');
    popup.className = 'popup';
    popup.style.width = '800px';
    popup.style.height = '600px';
    popup.style.top = '100px';
    popup.style.left = '100px';

    const playgroundUrl = '/simulator/';

    popup.innerHTML = `
        <div class="popup-header" onmousedown="startDrag(event, this.parentElement)">
            <div style="display:flex; align-items:center; overflow:hidden;">
                <span class="popup-title">Playground (Test Client)</span>
            </div>
            <div>
                <button class="secondary" style="margin-right:6px; padding:4px 8px; font-size:0.8rem;" 
                    onclick="window.open('${playgroundUrl}', '_blank')">Open in New Tab</button>
                <button class="popup-close" onclick="closePopup(this)">×</button>
            </div>
        </div>
        <div class="popup-content" style="padding:0; overflow:hidden;">
            <iframe src="${playgroundUrl}" style="width:100%; height:100%; border:none;"></iframe>
        </div>
    `;

    mainContainer.appendChild(popup);

    // Bring to front
    document.querySelectorAll('.popup').forEach(p => p.style.zIndex = 1000);
    popup.style.zIndex = 1001;
}


// --- Popup Management ---
function closePopup(btn) {
    btn.closest('.popup').remove();
}

function closeAllPopups() {
    document.querySelectorAll('.popup').forEach(p => p.remove());
}

function copyPopupContent(btn) {
    const content = btn.closest('.popup').querySelector('.popup-content').textContent;
    navigator.clipboard.writeText(content).then(() => {
        showToast('Copied!', 'success');
    });
}

// Dragging Logic
let isDragging = false;
let currentPopup = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

function startDrag(e, popup) {
    isDragging = true;
    currentPopup = popup;
    dragOffsetX = e.clientX - popup.offsetLeft;
    dragOffsetY = e.clientY - popup.offsetTop;

    // Bring to front
    document.querySelectorAll('.popup').forEach(p => p.style.zIndex = 1000);
    popup.style.zIndex = 1001;
}

document.addEventListener('mousemove', (e) => {
    if (isDragging && currentPopup) {
        currentPopup.style.left = (e.clientX - dragOffsetX) + 'px';
        currentPopup.style.top = (e.clientY - dragOffsetY) + 'px';
    }
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    currentPopup = null;
});

// Drag and Drop for Messages (to open in popup)
function drag(ev, index) {
    ev.dataTransfer.setData("text/plain", index);
}

function allowDrop(ev) {
    ev.preventDefault();
}

function drop(ev) {
    ev.preventDefault();
    // Only handle drops on the main container background, not inside other elements if possible
    // But event bubbling makes this tricky.
    // Let's check if we dropped on a specific area or just anywhere.
    // For now, allow dropping anywhere on main container to spawn a popup.

    const index = ev.dataTransfer.getData("text/plain");
    if (index === "") return; // Not a message drag

    const msg = messages[index];
    if (!msg) return;

    spawnMessagePopup(msg, ev.clientX, ev.clientY);
}

function spawnMessagePopup(msg, x, y) {
    const clone = popupTemplate.content.cloneNode(true);
    const popup = clone.querySelector('.popup');
    const content = clone.querySelector('.popup-content');
    const popupTitle = clone.querySelector('.popup-title');
    const popupTime = clone.querySelector('.popup-time');

    popup.style.left = x + 'px';
    popup.style.top = y + 'px';

    // Get filterText to extract highlight name
    const filterText = filterByFieldInput.value.trim();
    let highlightName = null;

    // Try to extract highlight name from JSON (same logic as badge)
    if (filterText) {
        try {
            const json = JSON.parse(msg.content);
            if (json && json[filterText] !== undefined) {
                highlightName = String(json[filterText]);
            }
        } catch (e) { }
    }

    // Set popup title to highlight name if available, otherwise default
    const popupHeader = clone.querySelector('.popup-header');
    if (highlightName) {
        popupTitle.textContent = highlightName;
        popupTitle.classList.add('highlighted');
        popupHeader.classList.add('has-highlight');
    } else {
        popupTitle.textContent = 'Message Details';
        popupTitle.classList.remove('highlighted');
        popupHeader.classList.remove('has-highlight');
    }

    // Set timestamp
    if (msg.timestamp) {
        const date = new Date(msg.timestamp);
        popupTime.textContent = date.toLocaleTimeString() + '.' + String(date.getMilliseconds()).padStart(3, '0');
        popupTime.title = date.toLocaleString();
    }

    // Format content
    try {
        const json = JSON.parse(msg.content);
        content.innerHTML = syntaxHighlight(json);
    } catch (e) {
        content.textContent = msg.content;
    }

    mainContainer.appendChild(popup);
}

// Start
openPlayground();
connectMonitor();
