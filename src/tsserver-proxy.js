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
        this.isRestarting = false; // **FIX:** Flag to prevent multiple restart attempts
    }

    start() {
        this.logger.info('Starting TypeScript server...');
        this._spawnTSServer();
    }
    
    _spawnTSServer() {
        if (this.tsserver) { // Clean up existing process if any
            this.tsserver.kill();
        }

        // Find tsserver executable
        const tsserverPath = this.findTSServer();
        if (!tsserverPath) {
            this.logger.error('TypeScript server not found. Please install the "typescript" package.');
            this.emit('error', new Error('TSServer executable not found.'));
            return;
        }

        // Start tsserver process
        this.tsserver = spawn('node', [tsserverPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: this.rootPath
        });

        this.logger.info(`TSServer process started with PID: ${this.tsserver.pid}`);

        this.tsserver.stdout.on('data', (data) => {
            this.handleTSServerOutput(data);
        });

        this.tsserver.stderr.on('data', (data) => {
            this.logger.error('TSServer stderr:', data.toString());
        });

        this.tsserver.on('exit', (code) => {
            this.logger.warn(`TSServer exited with code ${code}.`);
            this.tsserver = null; // Clear the process handle
            this.emit('exit', code);
            
            // **FIX:** Attempt to restart the server automatically
            this._handleUnexpectedExit();
        });

        this.tsserver.on('error', (error) => {
            this.logger.error('TSServer spawn error:', error);
            this.emit('error', error);
            this.tsserver = null;
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

        // Re-open any files that were open before the crash
        if (this.isRestarting) {
            this.logger.info('Re-opening previously opened files...');
            for (const [uri, content] of this.openFiles.entries()) {
                this.openFile(uri, content);
            }
            this.emit('restarted');
            this.isRestarting = false;
        }
    }
    
    async _handleUnexpectedExit() {
        if (this.isRestarting) return; // Already handling a restart
        
        this.isRestarting = true;
        this.emit('restarting');
        this.logger.warn('TSServer stopped unexpectedly. Attempting to restart in 5 seconds...');
        
        // Clear pending requests to avoid timeouts
        this.pendingRequests.forEach(req => req.reject(new Error('TSServer process exited.')));
        this.pendingRequests.clear();

        setTimeout(() => {
            this.logger.info('Restarting TSServer now...');
            this.start();
        }, 5000); // 5-second delay before restarting
    }


    findTSServer() {
        // Look for tsserver in various locations
        const possiblePaths = [
            path.join(this.rootPath, 'node_modules', 'typescript', 'lib', 'tsserver.js'),
            path.join(__dirname, '..', 'node_modules', 'typescript', 'lib', 'tsserver.js'),
        ];

        // Also try global installation
        try {
            const { execSync } = require('child_process');
            const globalPath = execSync('npm root -g', { encoding: 'utf8' }).trim();
            possiblePaths.push(path.join(globalPath, 'typescript', 'lib', 'tsserver.js'));
        } catch (error) {
            this.logger.warn('Could not determine global npm root path.');
        }
        
        // Add a final fallback to a common system path for tsserver
        const globalTsserver = require('fs').existsSync('/usr/lib/node_modules/typescript/lib/tsserver.js') ? '/usr/lib/node_modules/typescript/lib/tsserver.js' : null;
        if(globalTsserver) possiblePaths.push(globalTsserver);


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
        
        // The tsserver protocol uses two newlines to separate messages
        const separator = '\r\n\r\n';
        while(true) {
            const separatorIndex = this.buffer.indexOf(separator);
            if (separatorIndex === -1) {
                break;
            }
            
            const headerPart = this.buffer.substring(0, separatorIndex);
            const contentLengthMatch = /Content-Length: (\d+)/.exec(headerPart);

            if (contentLengthMatch) {
                const contentLength = parseInt(contentLengthMatch[1], 10);
                const messageStart = separatorIndex + separator.length;
                if (this.buffer.length >= messageStart + contentLength) {
                    const messagePart = this.buffer.substring(messageStart, messageStart + contentLength);
                    this.buffer = this.buffer.substring(messageStart + contentLength);
                    try {
                        const response = JSON.parse(messagePart);
                        this.handleTSServerResponse(response);
                    } catch (e) {
                        this.logger.error('Error parsing TSServer message:', e);
                    }
                } else {
                    break; 
                }
            } else {
                 // Fallback for older tsserver versions that might just use newline
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const response = JSON.parse(line);
                            this.handleTSServerResponse(response);
                        } catch (error) {
                            // This might not be a JSON line, can be ignored
                        }
                    }
                }
                break;
            }
        }
    }

    handleTSServerResponse(response) {
        // this.logger.debug('TSServer response:', JSON.stringify(response));

        if (response.type === 'response') {
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
            case 'projectLoadingFinish':
                this.logger.info('TSServer finished loading project.');
                break;
            default:
                // this.logger.debug('Unhandled TSServer event:', event.event);
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
                source: 'tsserver',
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
        if (!this.tsserver || this.isRestarting) {
            return Promise.reject(new Error('TSServer is not running or is restarting.'));
        }

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
        // Handle encoded characters in URI
        return decodeURIComponent(uri.replace('file://', ''));
    }

    filePathToUri(filePath) {
        if (!filePath) return null;
        // Ensure the path is absolute and properly encoded for a URI
        const absolutePath = path.resolve(filePath);
        return 'file://' + encodeURI(absolutePath.replace(/\\/g, '/'));
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

        // A more robust way to update is to use 'reload' for full content sync
        await this.sendTSServerRequest('reload', {
            file: filePath,
            tmpfile: filePath // Using the same file for simplicity
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
        
        const result = await this.sendTSServerRequest('completionInfo', {
            file: filePath,
            line: position.line + 1,
            offset: position.character + 1,
            includeExternalModuleExports: true,
            includeInsertTextCompletions: true
        });

        if (!result || !result.entries) {
            return { isIncomplete: false, items: [] };
        }

        const items = result.entries.map(entry => ({
            label: entry.name,
            kind: this.mapCompletionItemKind(entry.kind),
            detail: entry.kindModifiers || entry.kind,
            sortText: entry.sortText,
            insertText: entry.name,
        }));

        return { isIncomplete: !!result.isIncomplete, items };
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
        if (result.displayParts) {
            contents.push({ language: 'typescript', value: result.displayParts.map(p => p.text).join('') });
        }
        if (result.documentation) {
            contents.push(result.documentation.map(d => d.text).join('\n'));
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
        
        const result = await this.sendTSServerRequest('definitionAndBoundSpan', {
            file: filePath,
            line: position.line + 1,
            offset: position.character + 1
        });

        if (!result || !result.definitions || result.definitions.length === 0) {
            return null;
        }

        return result.definitions.map(def => ({
            uri: this.filePathToUri(def.file),
            range: {
                start: { line: def.start.line - 1, character: def.start.offset - 1 },
                end: { line: def.end.line - 1, character: def.end.offset - 1 }
            }
        }));
    }

    async getCodeActions(uri, range, context) {
        const filePath = this.uriToFilePath(uri);
        
        const errorCodes = context.diagnostics?.map(d => Number(d.code)).filter(c => !isNaN(c)) || [];
        if (errorCodes.length === 0) {
            return [];
        }

        const fixes = await this.sendTSServerRequest('getCodeFixes', {
            file: filePath,
            startLine: range.start.line + 1,
            startOffset: range.start.character + 1,
            endLine: range.end.line + 1,
            endOffset: range.end.character + 1,
            errorCodes: errorCodes
        });

        const actions = [];
        if (fixes && fixes.length) {
            for (const fix of fixes) {
                actions.push({
                    title: fix.description,
                    kind: 'quickfix',
                    diagnostics: context.diagnostics,
                    edit: this.convertTSServerChangesToWorkspaceEdit(fix.changes)
                });
            }
        }
        return actions;
    }

    convertTSServerChangesToWorkspaceEdit(changes) {
        const documentChanges = [];
        for (const change of changes) {
            const uri = this.filePathToUri(change.fileName);
            const textEdits = change.textChanges.map(tc => ({
                range: {
                    start: { line: tc.start.line - 1, character: tc.start.offset - 1 },
                    end: { line: tc.end.line - 1, character: tc.end.offset - 1 }
                },
                newText: tc.newText
            }));

            documentChanges.push({
                textDocument: { uri, version: null },
                edits: textEdits
            });
        }
        return { documentChanges };
    }

    mapCompletionItemKind(tsKind) {
        const LSPCompletionItemKind = {
            primitive_type: 14,
            keyword: 14,
            var: 6,
            local_var: 6,
            property: 10,
            let: 6,
            const: 21,
            function: 3,
            method: 2,
            class: 7,
            interface: 8,
            enum: 13,
            module: 9,
            alias: 18,
            script: 17,
            type_parameter: 25,
        };
        return LSPCompletionItemKind[tsKind] || 1; // Default to Text
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
