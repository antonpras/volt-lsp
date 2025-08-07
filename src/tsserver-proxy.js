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
        this.openFiles = new Map();
    }

    start() {
        this.logger.info('Starting TypeScript server...');
        
        // Find tsserver executable
        const tsserverPath = this.findTSServer();
        if (!tsserverPath) {
            throw new Error('TypeScript server not found. Please install typescript package.');
        }

        // Start tsserver process
        this.tsserver = spawn('node', [tsserverPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: this.rootPath
        });

        this.tsserver.stdout.on('data', (data) => {
            this.handleTSServerOutput(data);
        });

        this.tsserver.stderr.on('data', (data) => {
            this.logger.error('TSServer stderr:', data.toString());
        });

        this.tsserver.on('exit', (code) => {
            this.logger.warn(`TSServer exited with code ${code}`);
            this.emit('exit', code);
        });

        this.tsserver.on('error', (error) => {
            this.logger.error('TSServer error:', error);
            this.emit('error', error);
        });

        // Configure tsserver
        this.sendTSServerRequest('configure', {
            hostInfo: 'volt-lsp',
            preferences: {
                includeCompletionsForModuleExports: true,
                includeCompletionsWithInsertText: true,
                allowTextChangesInNewFiles: true
            }
        });
    }

    findTSServer() {
        // Look for tsserver in various locations
        const possiblePaths = [
            path.join(this.rootPath, 'node_modules', 'typescript', 'lib', 'tsserver.js'),
            path.join(__dirname, '..', 'node_modules', 'typescript', 'lib', 'tsserver.js'),
            path.join(process.cwd(), 'node_modules', 'typescript', 'lib', 'tsserver.js')
        ];

        // Also try global installation
        try {
            const { execSync } = require('child_process');
            const globalPath = execSync('npm root -g', { encoding: 'utf8' }).trim();
            possiblePaths.push(path.join(globalPath, 'typescript', 'lib', 'tsserver.js'));
        } catch (error) {
            // Ignore error
        }

        for (const tsserverPath of possiblePaths) {
            if (fs.existsSync(tsserverPath)) {
                this.logger.info(`Found TSServer at: ${tsserverPath}`);
                return tsserverPath;
            }
        }

        return null;
    }

    handleTSServerOutput(data) {
        this.buffer += data.toString();
        
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const response = JSON.parse(line);
                    this.handleTSServerResponse(response);
                } catch (error) {
                    this.logger.debug('Non-JSON line from tsserver:', line);
                }
            }
        }
    }

    handleTSServerResponse(response) {
        this.logger.debug('TSServer response:', JSON.stringify(response, null, 2));

        if (response.request_seq !== undefined) {
            // This is a response to our request
            const pendingRequest = this.pendingRequests.get(response.request_seq);
            if (pendingRequest) {
                this.pendingRequests.delete(response.request_seq);
                
                if (response.success) {
                    pendingRequest.resolve(response.body);
                } else {
                    pendingRequest.reject(new Error(response.message || 'TSServer request failed'));
                }
            }
        } else if (response.type === 'event') {
            // Handle events (like diagnostics)
            this.handleTSServerEvent(response);
        }
    }

    handleTSServerEvent(event) {
        switch (event.event) {
            case 'semanticDiag':
            case 'syntaxDiag':
            case 'suggestionDiag':
                this.handleDiagnosticsEvent(event);
                break;
                
            default:
                this.logger.debug('Unhandled TSServer event:', event.event);
        }
    }

    handleDiagnosticsEvent(event) {
        const diagnostics = event.body?.diagnostics || [];
        const uri = this.filePathToUri(event.body?.file);
        
        if (uri) {
            const lspDiagnostics = diagnostics.map(diag => ({
                range: {
                    start: { line: diag.start.line - 1, character: diag.start.offset - 1 },
                    end: { line: diag.end.line - 1, character: diag.end.offset - 1 }
                },
                severity: this.mapTSServerSeverity(diag.category),
                source: 'volt-lsp',
                message: diag.text,
                code: diag.code
            }));

            this.emit('diagnostics', uri, lspDiagnostics);
        }
    }

    mapTSServerSeverity(category) {
        switch (category) {
            case 'error': return 1; // Error
            case 'warning': return 2; // Warning
            case 'suggestion': return 3; // Information
            default: return 4; // Hint
        }
    }

    sendTSServerRequest(command, args = {}) {
        const requestId = ++this.requestId;
        const request = {
            seq: requestId,
            type: 'request',
            command,
            arguments: args
        };

        const requestStr = JSON.stringify(request) + '\n';
        this.tsserver.stdin.write(requestStr);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`TSServer request timeout: ${command}`));
            }, 30000);

            this.pendingRequests.set(requestId, {
                resolve: (result) => {
                    clearTimeout(timeout);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
        });
    }

    uriToFilePath(uri) {
        return uri.replace('file://', '');
    }

    filePathToUri(filePath) {
        if (!filePath) return null;
        return 'file://' + filePath;
    }

    async openFile(uri, content) {
        const filePath = this.uriToFilePath(uri);
        this.openFiles.set(uri, content);

        await this.sendTSServerRequest('open', {
            file: filePath,
            fileContent: content
        });

        // Request initial diagnostics
        await this.sendTSServerRequest('geterr', {
            files: [filePath],
            delay: 0
        });
    }

    async updateFile(uri, content) {
        const filePath = this.uriToFilePath(uri);
        this.openFiles.set(uri, content);

        await this.sendTSServerRequest('change', {
            file: filePath,
            line: 1,
            offset: 1,
            endLine: 1000000,
            endOffset: 1,
            insertString: content
        });

        // Request diagnostics after change
        await this.sendTSServerRequest('geterr', {
            files: [filePath],
            delay: 100
        });
    }

    async closeFile(uri) {
        const filePath = this.uriToFilePath(uri);
        this.openFiles.delete(uri);

        await this.sendTSServerRequest('close', {
            file: filePath
        });
    }

    async getCompletions(uri, position) {
        const filePath = this.uriToFilePath(uri);
        
        const result = await this.sendTSServerRequest('completions', {
            file: filePath,
            line: position.line + 1,
            offset: position.character + 1
        });

        if (!result || !result.entries) {
            return { isIncomplete: false, items: [] };
        }

        const items = result.entries.map(entry => ({
            label: entry.name,
            kind: this.mapCompletionItemKind(entry.kind),
            detail: entry.kindModifiers || entry.kind,
            documentation: entry.documentation ? entry.documentation[0]?.text : undefined,
            insertText: entry.insertText || entry.name,
            sortText: entry.sortText
        }));

        return { isIncomplete: false, items };
    }

    async getHover(uri, position) {
        const filePath = this.uriToFilePath(uri);
        
        const result = await this.sendTSServerRequest('quickinfo', {
            file: filePath,
            line: position.line + 1,
            offset: position.character + 1
        });

        if (!result) {
            return null;
        }

        const contents = [];
        if (result.displayString) {
            contents.push({ language: 'typescript', value: result.displayString });
        }
        if (result.documentation) {
            contents.push(result.documentation);
        }

        return {
            contents,
            range: result.start && result.end ? {
                start: { line: result.start.line - 1, character: result.start.offset - 1 },
                end: { line: result.end.line - 1, character: result.end.offset - 1 }
            } : undefined
        };
    }

    async getDefinition(uri, position) {
        const filePath = this.uriToFilePath(uri);
        
        const result = await this.sendTSServerRequest('definition', {
            file: filePath,
            line: position.line + 1,
            offset: position.character + 1
        });

        if (!result || !result.length) {
            return null;
        }

        return result.map(def => ({
            uri: this.filePathToUri(def.file),
            range: {
                start: { line: def.start.line - 1, character: def.start.offset - 1 },
                end: { line: def.end.line - 1, character: def.end.offset - 1 }
            }
        }));
    }

    async getCodeActions(uri, range, context) {
        const filePath = this.uriToFilePath(uri);
        
        // Get quick fixes
        const fixes = await this.sendTSServerRequest('getCodeFixes', {
            file: filePath,
            startLine: range.start.line + 1,
            startOffset: range.start.character + 1,
            endLine: range.end.line + 1,
            endOffset: range.end.character + 1,
            errorCodes: context.diagnostics?.map(d => d.code).filter(Boolean) || []
        });

        const actions = [];

        if (fixes && fixes.length) {
            for (const fix of fixes) {
                actions.push({
                    title: fix.description,
                    kind: 'quickfix',
                    edit: this.convertTSServerChangesToWorkspaceEdit(fix.changes)
                });
            }
        }

        return actions;
    }

    convertTSServerChangesToWorkspaceEdit(changes) {
        const documentChanges = [];

        for (const change of changes) {
            const textEdits = change.textChanges.map(tc => ({
                range: {
                    start: { line: tc.start.line - 1, character: tc.start.offset - 1 },
                    end: { line: tc.end.line - 1, character: tc.end.offset - 1 }
                },
                newText: tc.newText
            }));

            documentChanges.push({
                textDocument: {
                    uri: this.filePathToUri(change.fileName),
                    version: null
                },
                edits: textEdits
            });
        }

        return { documentChanges };
    }

    mapCompletionItemKind(tsKind) {
        const kindMap = {
            'class': 7,
            'constructor': 4,
            'enum': 13,
            'field': 5,
            'file': 17,
            'function': 3,
            'interface': 8,
            'keyword': 14,
            'let': 6,
            'local function': 3,
            'local var': 6,
            'method': 2,
            'module': 9,
            'parameter': 6,
            'property': 10,
            'string': 15,
            'type': 25,
            'var': 6,
            'const': 21
        };

        return kindMap[tsKind] || 1; // Default to Text
    }

    shutdown() {
        this.logger.info('Shutting down TypeScript server...');
        
        if (this.tsserver) {
            this.tsserver.kill('SIGTERM');
            this.tsserver = null;
        }
        
        this.pendingRequests.clear();
    }
}

module.exports = TSServerProxy;
