const EventEmitter = require('events');
const Logger = require('./logger');

class LSPConnection extends EventEmitter {
    constructor() {
        super();
        this.logger = new Logger('LSPConnection');
        this.buffer = '';
        this.messageQueue = [];
        this.isProcessing = false;
        this.requestId = 0;
    }

    start() {
        this.logger.info('Starting LSP connection on stdio');
        
        // Set up stdin/stdout for JSON-RPC communication
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            this.handleIncomingData(chunk);
        });

        process.stdin.on('end', () => {
            this.emit('exit');
        });

        process.on('SIGTERM', () => {
            this.emit('shutdown');
        });

        process.on('SIGINT', () => {
            this.emit('shutdown');
        });
    }

    handleIncomingData(chunk) {
        this.buffer += chunk;
        
        while (true) {
            const headerEndIndex = this.buffer.indexOf('\r\n\r\n');
            if (headerEndIndex === -1) {
                break; // Need more data
            }

            const header = this.buffer.substring(0, headerEndIndex);
            const contentLengthMatch = header.match(/Content-Length: (\d+)/);
            
            if (!contentLengthMatch) {
                this.logger.error('Invalid header: missing Content-Length');
                break;
            }

            const contentLength = parseInt(contentLengthMatch[1]);
            const messageStart = headerEndIndex + 4;
            
            if (this.buffer.length < messageStart + contentLength) {
                break; // Need more data
            }

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
            // This is a request or notification
            this.currentRequestId = message.id;
            this.emit(message.method, message.params || {});
        } else if (message.id !== undefined) {
            // This is a response
            this.emit(`response:${message.id}`, message.result, message.error);
        }
    }

    sendResponse(result, error = null) {
        if (this.currentRequestId === undefined) {
            // This was a notification, no response needed
            return;
        }

        const response = {
            jsonrpc: '2.0',
            id: this.currentRequestId,
            result: error ? undefined : result,
            error: error
        };

        this.sendMessage(response);
        this.currentRequestId = undefined;
    }

    sendRequest(method, params = {}) {
        const id = ++this.requestId;
        const request = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        this.sendMessage(request);
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Request timeout: ${method}`));
            }, 30000);

            this.once(`response:${id}`, (result, error) => {
                clearTimeout(timeout);
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    }

    sendNotification(method, params = {}) {
        const notification = {
            jsonrpc: '2.0',
            method,
            params
        };

        this.sendMessage(notification);
    }

    sendMessage(message) {
        const content = JSON.stringify(message);
        const header = `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n`;
        
        this.logger.debug('Sending message:', content);
        process.stdout.write(header + content);
    }

    sendDiagnostics(uri, diagnostics = []) {
        this.sendNotification('textDocument/publishDiagnostics', {
            uri,
            diagnostics
        });
    }

    sendLogMessage(type, message) {
        this.sendNotification('window/logMessage', {
            type, // 1=Error, 2=Warning, 3=Info, 4=Log
            message
        });
    }

    sendShowMessage(type, message) {
        this.sendNotification('window/showMessage', {
            type, // 1=Error, 2=Warning, 3=Info, 4=Log
            message
        });
    }
}

module.exports = LSPConnection;
