// File: src/tsserver-proxy.js (VERSI FINAL)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const Logger = require('./logger');

class TSServerProxy extends EventEmitter {
    constructor(rootPath) {
        super();
        this.rootPath = rootPath;
        this.logger = new Logger('TSServerProxy');
        this.tsserver = null;
        this.requestId = 0;
        this.pendingRequests = new Map();
        this.buffer = '';
    }

    start() {
        this.logger.info('Starting TypeScript server...');
        const tsserverPath = this.findTSServer();
        if (!tsserverPath) {
            this.logger.error('TSServer executable not found. Please run: npm install -g typescript');
            return;
        }
        this.tsserver = spawn('node', [tsserverPath], { stdio: ['pipe', 'pipe', 'pipe'], cwd: this.rootPath });
        this.tsserver.stdout.on('data', (data) => this.handleTSServerOutput(data));
        this.tsserver.stderr.on('data', (data) => this.logger.error('TSServer stderr:', data.toString()));
        this.tsserver.on('exit', (code) => this.logger.warn(`TSServer exited with code ${code}`));
    }

    findTSServer() {
        const possiblePaths = [
            path.join(this.rootPath, 'node_modules', 'typescript', 'lib', 'tsserver.js'),
            path.join(__dirname, '..', 'node_modules', 'typescript', 'lib', 'tsserver.js'),
        ];
        try {
            const globalPath = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
            possiblePaths.push(path.join(globalPath, 'typescript', 'lib', 'tsserver.js'));
        } catch (error) { /* ignore */ }
        for (const p of possiblePaths) { if (fs.existsSync(p)) { this.logger.info(`Found TSServer at: ${p}`); return p; } }
        return null;
    }

    handleTSServerOutput(data) {
        this.buffer += data.toString();
        const responses = this.buffer.split('\r\n\r\n');
        this.buffer = responses.pop() || '';
        for (const responseStr of responses) {
            if (!responseStr.trim()) continue;
            const headerMatch = responseStr.match(/Content-Length: (\d+)/);
            if (headerMatch) {
                const contentLength = parseInt(headerMatch[1], 10);
                const jsonStr = responseStr.substring(responseStr.indexOf('{'));
                if (jsonStr.length >= contentLength) {
                    try {
                        const message = JSON.parse(jsonStr);
                        this.handleTSServerMessage(message);
                    } catch (e) { this.logger.error('JSON Parse Error:', e); }
                }
            }
        }
    }

    handleTSServerMessage(message) {
        if (message.type === 'response' && this.pendingRequests.has(message.request_seq)) {
            const { resolve, reject } = this.pendingRequests.get(message.request_seq);
            if (message.success) resolve(message.body);
            else reject(new Error(message.message));
            this.pendingRequests.delete(message.request_seq);
        } else if (message.type === 'event' && (message.event === 'semanticDiag' || message.event === 'syntaxDiag' || message.event === 'suggestionDiag')) {
            // **PERBAIKAN INTI:** Pastikan event diagnostik diproses dan dikirim
            if (message.body && message.body.file) {
                const diagnostics = message.body.diagnostics.map(diag => ({
                    range: {
                        start: { line: diag.start.line - 1, character: diag.start.offset - 1 },
                        end: { line: diag.end.line - 1, character: diag.end.offset - 1 }
                    },
                    severity: diag.category === 'error' ? 1 : 2,
                    source: 'tsserver',
                    message: diag.text,
                    code: diag.code
                }));
                this.emit('diagnostics', this.filePathToUri(message.body.file), diagnostics);
            }
        }
    }

    sendRequest(command, args) {
        return new Promise((resolve, reject) => {
            const seq = ++this.requestId;
            this.pendingRequests.set(seq, { resolve, reject });
            const request = { seq, type: 'request', command, arguments: args };
            this.tsserver.stdin.write(`Content-Length: ${JSON.stringify(request).length}\r\n\r\n${JSON.stringify(request)}`);
            setTimeout(() => {
                if (this.pendingRequests.has(seq)) {
                    reject(new Error(`Request ${seq} (${command}) timed out`));
                    this.pendingRequests.delete(seq);
                }
            }, 5000);
        });
    }

    filePathToUri(filePath) { return 'file://' + path.resolve(filePath).replace(/\\/g, '/'); }

    // Fungsi-fungsi lain yang memanggil sendRequest
    async openFile(uri, content) { await this.sendRequest('open', { file: uri.replace('file://', ''), fileContent: content }); }
    async updateFile(uri, content) { await this.sendRequest('change', { file: uri.replace('file://', ''), line: 1, offset: 1, endLine: 100000, endOffset: 1, insertString: content }); }
    async getHover(uri, position) { return this.sendRequest('quickinfo', { file: uri.replace('file://', ''), line: position.line + 1, offset: position.character + 1 }); }
    async getCompletions(uri, position) { return this.sendRequest('completions', { file: uri.replace('file://', ''), line: position.line + 1, offset: position.character + 1 }); }
}

module.exports = TSServerProxy;
