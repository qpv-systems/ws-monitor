/**
 * CryptoService for browser - using Web Crypto API
 * Compatible with Node.js crypto.service.ts
 */
class BrowserCryptoService {
    constructor(encryptionKey, hmacKey) {
        this.algorithm = { name: 'AES-GCM', length: 256 };
        this.hmacAlgorithm = { name: 'HMAC', hash: 'SHA-256' };

        // Derive keys from strings using SHA-256 (matches Node.js implementation)
        this.encryptionKeyPromise = this.deriveKey(encryptionKey);
        this.hmacKeyPromise = this.deriveHMACKey(hmacKey);
    }

    /**
     * Derive encryption key from string
     */
    async deriveKey(keyString) {
        // Hash the string to get 32 bytes (SHA-256)
        const encoder = new TextEncoder();
        const data = encoder.encode(keyString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        // Import as AES-GCM key
        return await crypto.subtle.importKey(
            'raw',
            hashBuffer,
            this.algorithm,
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Derive HMAC key from string
     */
    async deriveHMACKey(keyString) {
        const encoder = new TextEncoder();
        const data = encoder.encode(keyString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        return await crypto.subtle.importKey(
            'raw',
            hashBuffer,
            this.hmacAlgorithm,
            false,
            ['sign']
        );
    }

    /**
     * Check if data is an encrypted payload
     */
    isEncryptedPayload(data) {
        return (
            typeof data === 'object' &&
            data !== null &&
            typeof data.encrypted === 'string' &&
            typeof data.iv === 'string' &&
            typeof data.hmac === 'string' &&
            typeof data.timestamp === 'number'
        );
    }

    /**
     * Convert hex string to ArrayBuffer
     */
    hexToArrayBuffer(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes.buffer;
    }

    /**
     * Convert ArrayBuffer to hex string
     */
    arrayBufferToHex(buffer) {
        const bytes = new Uint8Array(buffer);
        let hex = '';
        for (let i = 0; i < bytes.length; i++) {
            hex += bytes[i].toString(16).padStart(2, '0');
        }
        return hex;
    }

    /**
     * Encrypt data with AES-256-GCM and add HMAC signature
     */
    async encrypt(data) {
        try {
            const plaintext = JSON.stringify(data);
            const encoder = new TextEncoder();
            const plaintextBuffer = encoder.encode(plaintext);

            // Generate random IV (16 bytes)
            const iv = crypto.getRandomValues(new Uint8Array(16));

            // Get encryption key
            const encryptionKey = await this.encryptionKeyPromise;

            // Encrypt
            const encryptedBuffer = await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                    tagLength: 128 // 16 bytes = 128 bits
                },
                encryptionKey,
                plaintextBuffer
            );

            // Extract ciphertext and auth tag
            // Auth tag is last 16 bytes in GCM mode
            const authTagLength = 16;
            const ciphertextLength = encryptedBuffer.byteLength - authTagLength;
            const ciphertext = new Uint8Array(encryptedBuffer, 0, ciphertextLength);
            const authTag = new Uint8Array(encryptedBuffer, ciphertextLength, authTagLength);

            // Combine ciphertext + auth tag as hex
            const encryptedWithTag = this.arrayBufferToHex(ciphertext) + this.arrayBufferToHex(authTag);
            const ivHex = this.arrayBufferToHex(iv);
            const timestamp = Date.now();

            // Create HMAC
            const hmac = await this.createHMAC(encryptedWithTag, ivHex, timestamp);

            return {
                encrypted: encryptedWithTag,
                iv: ivHex,
                hmac: hmac,
                timestamp: timestamp
            };
        } catch (error) {
            console.error('Encryption failed:', error);
            throw new Error('Encryption failed: ' + error.message);
        }
    }

    /**
     * Verify HMAC and decrypt data
     */
    async decrypt(payload) {
        try {
            // Verify timestamp (prevent replay attacks - 5 minutes window)
            const now = Date.now();
            const timeDiff = now - payload.timestamp;
            if (timeDiff > 5 * 60 * 1000) {
                throw new Error('Message expired (timestamp too old)');
            }
            if (timeDiff < -60 * 1000) {
                throw new Error('Message timestamp is in the future');
            }

            // Verify HMAC
            const expectedHmac = await this.createHMAC(payload.encrypted, payload.iv, payload.timestamp);
            if (!this.constantTimeCompare(payload.hmac, expectedHmac)) {
                console.warn('HMAC verification failed - possible tampering detected');
                throw new Error('HMAC verification failed');
            }

            // Extract auth tag (last 32 hex chars = 16 bytes)
            const authTagLength = 32; // 16 bytes in hex
            const encryptedHex = payload.encrypted.slice(0, -authTagLength);
            const authTagHex = payload.encrypted.slice(-authTagLength);

            const ivBuffer = this.hexToArrayBuffer(payload.iv);
            const encryptedBuffer = this.hexToArrayBuffer(encryptedHex);
            const authTagBuffer = this.hexToArrayBuffer(authTagHex);

            // Combine ciphertext + auth tag
            const combinedLength = encryptedBuffer.byteLength + authTagBuffer.byteLength;
            const combined = new Uint8Array(combinedLength);
            combined.set(new Uint8Array(encryptedBuffer), 0);
            combined.set(new Uint8Array(authTagBuffer), encryptedBuffer.byteLength);

            // Get decryption key
            const encryptionKey = await this.encryptionKeyPromise;

            // Decrypt
            const decryptedBuffer = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: ivBuffer,
                    tagLength: 128
                },
                encryptionKey,
                combined
            );

            const decoder = new TextDecoder();
            const decrypted = decoder.decode(decryptedBuffer);
            const data = JSON.parse(decrypted);

            console.log('Decryption and HMAC verification successful');
            return data;
        } catch (error) {
            console.error('Decryption failed:', error);
            throw new Error('Decryption failed: ' + error.message);
        }
    }

    /**
     * Create HMAC signature
     */
    async createHMAC(encrypted, iv, timestamp) {
        const data = `${encrypted}:${iv}:${timestamp}`;
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);

        const hmacKey = await this.hmacKeyPromise;
        const signature = await crypto.subtle.sign('HMAC', hmacKey, dataBuffer);

        return this.arrayBufferToHex(signature);
    }

    /**
     * Constant-time string comparison to prevent timing attacks
     */
    constantTimeCompare(a, b) {
        if (a.length !== b.length) {
            return false;
        }

        // Use timing-safe comparison
        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }
}


const WS_ENCRYPTION_KEY = 'default-encryption-key-change-in-production-32bytes';
const WS_HMAC_KEY = 'default-hmac-key-change-in-production-secret';

const cryptoService = new BrowserCryptoService(
    WS_ENCRYPTION_KEY,
    WS_HMAC_KEY
);

/**
 * Custom decrypt function
 * @param {any} payload
 * @returns {Promise<any>}
 */
async function customDecrypt(payload) {
    let data = payload;

    // Nếu payload là string thì parse
    if (typeof payload === 'string') {
        try {
            data = JSON.parse(payload);
        } catch {
            return payload; // không phải JSON
        }
    }

    if (!cryptoService.isEncryptedPayload(data)) {
        return payload;
    }

    data = await cryptoService.decrypt(data);
    console.log(data);
    return JSON.stringify(data);
}