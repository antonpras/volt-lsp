// File: src/lsp-connection.js (Versi Perbaikan Final)
const EventEmitter = require('events');
const Logger = require('./logger');

class LSPConnection extends EventEmitter {
    constructor() {
        super();
        this.logger = new Logger('LSPConnection');
        this.buffer = '';
    }

    start() {
        this.logger.info('Starting LSP connection on stdio');
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => this.handleIncomingData(chunk));
        process.stdin.on('end', () => this.emit('exit'));
    }

    handleIncomingData(chunk) {
        this.buffer += chunk;
        while (true) {
            const headerEndIndex = this.buffer.indexOf('\r\n\r\n');
            if (headerEndIndex === -1) break;
            const header = this.buffer.substring(0, headerEndIndex);
            const contentLengthMatch = header.match(/Content-Length: (\d+)/);
            if (!contentLengthMatch) {
                this.buffer = this.buffer.substring(headerEndIndex + 4);
                continue;
            }
            const contentLength = parseInt(contentLengthMatch[1], 10);
            const messageStart = headerEndIndex + 4;
            if (this.buffer.length < messageStart + contentLength) break;
            const messageContent = this.buffer.substring(messageStart, messageStart + contentLength);
            this.buffer = this.buffer.substring(messageStart + contentLength);
            try {
                const message = JSON.parse(messageContent);
                this.handleMessage(message);
            } catch (error) {
                this.logger.error('Error parsing JSON message:', error);
            }
        }
    }

    handleMessage(message) {
        this.logger.debug('Received message:', JSON.stringify(message, null, 2));
        if (message.method) {
            // **PERUBAHAN PENTING:** Kirim 'id' bersamaan dengan event
            this.emit(message.method, message.params || {}, message.id);
        } else if (message.id !== undefined) {
            // Penanganan response, jika diperlukan di masa depan
        }
    }

    sendResponse(id, result) {
        // **PERUBAHAN PENTING:** Gunakan 'id' yang diterima, jangan simpan di 'this'
        if (id === undefined || id === null) return;
        this.sendMessage({ jsonrpc: '2.0', id, result });
    }

    sendError(id, code, message) {
        if (id === undefined || id === null) return;
        this.sendMessage({ jsonrpc: '2.0', id, error: { code, message } });
    }

    sendNotification(method, params = {}) {
        this.sendMessage({ jsonrpc: '2.0', method, params });
    }

    sendMessage(message) {
        const content = JSON.stringify(message);
        const header = `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n`;
        this.logger.debug('Sending message:', content);
        process.stdout.write(header + content);
    }

    sendDiagnostics(uri, diagnostics = []) {
        this.sendNotification('textDocument/publishDiagnostics', { uri, diagnostics });
    }
}

module.exports = LSPConnection;
