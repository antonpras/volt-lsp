const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline'); // **FIX:** Import readline for efficient file reading
const EventEmitter = require('events');

const LSPConnection = require('./src/lsp-connection');
const TSServerProxy = require('./src/tsserver-proxy');
const TermuxAPIManager = require('./src/termux-api-manager');
const TaskRunner = require('./src/task-runner');
const DependencyInfoProvider = require('./src/dependency-info-provider');
const Logger = require('./src/logger');

class VoltLSP extends EventEmitter {
    constructor() {
        super();
        this.logger = new Logger();
        this.connection = null;
        this.tsServerProxy = null;
        this.termuxAPI = null;
        this.taskRunner = null;
        this.dependencyInfo = null;
        this.rootPath = null;
        this.isInitialized = false;
    }

    start() {
        this.logger.info('🚀 Starting Volt LSP - The Blazing-Fast, Termux-Native TypeScript Language Server');
        
        try {
            this.connection = new LSPConnection();
            this.termuxAPI = new TermuxAPIManager();
            this.setupConnectionHandlers();
            this.connection.start();
        } catch (error) {
            this.logger.error('Failed to start Volt LSP:', error);
            process.exit(1);
        }
    }

    setupConnectionHandlers() {
        this.connection.on('initialize', (params) => this.handleInitialize(params));
        this.connection.on('initialized', () => this.handleInitialized());
        this.connection.on('textDocument/didOpen', (params) => this.handleDidOpenTextDocument(params));
        this.connection.on('textDocument/didChange', (params) => this.handleDidChangeTextDocument(params));
        this.connection.on('textDocument/didClose', (params) => this.handleDidCloseTextDocument(params));
        this.connection.on('textDocument/completion', (params) => this.handleCompletion(params));
        this.connection.on('textDocument/hover', (params) => this.handleHover(params));
        this.connection.on('textDocument/definition', (params) => this.handleDefinition(params));
        this.connection.on('textDocument/codeAction', (params) => this.handleCodeAction(params));
        this.connection.on('workspace/executeCommand', (params) => this.handleExecuteCommand(params));
        this.connection.on('shutdown', () => this.handleShutdown());
        this.connection.on('exit', () => this.handleExit());
    }

    handleInitialize(params) {
        this.rootPath = params.rootPath || params.rootUri?.replace('file://', '') || process.cwd();
        this.logger.info(`Initializing workspace at: ${this.rootPath}`);

        this.tsServerProxy = new TSServerProxy(this.rootPath);
        this.taskRunner = new TaskRunner(this.rootPath, this.termuxAPI);
        this.dependencyInfo = new DependencyInfoProvider(this.rootPath);

        const capabilities = {
            textDocumentSync: 1, // Full sync
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['.', '/', '"', "'", '@']
            },
            hoverProvider: true,
            definitionProvider: true,
            codeActionProvider: {
                codeActionKinds: [
                    'quickfix',
                    'refactor',
                    'volt.copy',
                    'volt.share'
                ]
            },
            executeCommandProvider: {
                commands: [
                    'volt-lsp:runTest',
                    'volt-lsp:runBuild',
                    'volt-lsp:copyToClipboard',
                    'volt-lsp:shareCode',
                    'volt-lsp:clearCache'
                ]
            }
        };

        this.connection.sendResponse({
            id: this.connection.currentRequestId,
            result: {
                capabilities,
                serverInfo: {
                    name: 'Volt LSP',
                    version: '0.2.0'
                }
            }
        });
    }

    handleInitialized() {
        this.isInitialized = true;
        this.logger.info('✅ Volt LSP initialized successfully');
        
        this.tsServerProxy.start();
        
        this.tsServerProxy.on('diagnostics', (uri, diagnostics) => {
            this.connection.sendDiagnostics(uri, diagnostics);
        });

        this.taskRunner.on('diagnostic', (diagnosticInfo) => {
            const uri = `file://${diagnosticInfo.file}`;
            this.connection.sendDiagnostics(uri, [diagnosticInfo]);
        });

        // **FIX:** Listen for tsserver restart events to notify the user
        this.tsServerProxy.on('restarting', () => {
            this.termuxAPI.notifyWarning('TSServer Down', 'TypeScript service stopped. Attempting to restart...');
            this.connection.sendShowMessage(2, 'Volt-LSP: TypeScript service stopped. Attempting to restart...');
        });

        this.tsServerProxy.on('restarted', () => {
            this.termuxAPI.notifySuccess('TSServer Ready', 'TypeScript service has been restarted.');
            this.connection.sendShowMessage(3, 'Volt-LSP: TypeScript service restarted successfully.');
        });
        
        this.termuxAPI.sendNotification(
            'Volt LSP Ready',
            'TypeScript Language Server is now active'
        );
    }

    handleDidOpenTextDocument(params) {
        const { textDocument } = params;
        this.tsServerProxy.openFile(textDocument.uri, textDocument.text);
    }

    handleDidChangeTextDocument(params) {
        const { textDocument, contentChanges } = params;
        if (contentChanges.length > 0) {
            // Send the full text for simplicity and robustness
            this.tsServerProxy.updateFile(textDocument.uri, contentChanges[0].text);
        }
    }

    handleDidCloseTextDocument(params) {
        const { textDocument } = params;
        this.tsServerProxy.closeFile(textDocument.uri);
    }

    async handleCompletion(params) {
        try {
            const completions = await this.tsServerProxy.getCompletions(
                params.textDocument.uri,
                params.position
            );
            this.connection.sendResponse({ id: this.connection.currentRequestId, result: completions });
        } catch (error) {
            this.logger.error('Error getting completions:', error.message);
            this.connection.sendResponse({ id: this.connection.currentRequestId, result: null });
        }
    }

    async handleHover(params) {
        try {
            let hoverInfo = null;
            const uri = params.textDocument.uri;
            if (uri.endsWith('package.json')) {
                hoverInfo = await this.dependencyInfo.getHoverInfo(uri, params.position);
            }

            if (!hoverInfo) {
                hoverInfo = await this.tsServerProxy.getHover(uri, params.position);
            }
            
            this.connection.sendResponse({ id: this.connection.currentRequestId, result: hoverInfo });
        } catch (error) {
            this.logger.error('Error getting hover info:', error.message);
            this.connection.sendResponse({ id: this.connection.currentRequestId, result: null });
        }
    }

    async handleDefinition(params) {
        try {
            const definition = await this.tsServerProxy.getDefinition(
                params.textDocument.uri,
                params.position
            );
            this.connection.sendResponse({ id: this.connection.currentRequestId, result: definition });
        } catch (error) {
            this.logger.error('Error getting definition:', error.message);
            this.connection.sendResponse({ id: this.connection.currentRequestId, result: null });
        }
    }

    async handleCodeAction(params) {
        try {
            const actions = [];

            const tsActions = await this.tsServerProxy.getCodeActions(
                params.textDocument.uri,
                params.range,
                params.context
            );
            if(tsActions) actions.push(...tsActions);

            if (params.range.start.line !== params.range.end.line || 
                params.range.start.character !== params.range.end.character) {
                
                actions.push({
                    title: '[Volt] Copy to Android Clipboard',
                    kind: 'volt.copy',
                    command: {
                        title: 'Copy',
                        command: 'volt-lsp:copyToClipboard',
                        arguments: [params.textDocument.uri, params.range]
                    }
                });

                actions.push({
                    title: '[Volt] Share Code Snippet',
                    kind: 'volt.share',
                    command: {
                        title: 'Share',
                        command: 'volt-lsp:shareCode',
                        arguments: [params.textDocument.uri, params.range]
                    }
                });
            }

            this.connection.sendResponse({ id: this.connection.currentRequestId, result: actions });
        } catch (error) {
            this.logger.error('Error getting code actions:', error.message);
            this.connection.sendResponse({ id: this.connection.currentRequestId, result: [] });
        }
    }

    async handleExecuteCommand(params) {
        try {
            const { command, arguments: args = [] } = params;

            switch (command) {
                case 'volt-lsp:runTest':
                    await this.taskRunner.runTest();
                    break;
                case 'volt-lsp:runBuild':
                    await this.taskRunner.runBuild();
                    break;
                case 'volt-lsp:copyToClipboard':
                    await this.handleCopyToClipboard(args[0], args[1]);
                    break;
                case 'volt-lsp:shareCode':
                    await this.handleShareCode(args[0], args[1]);
                    break;
                case 'volt-lsp:clearCache':
                    await this.dependencyInfo.clearCache();
                    this.termuxAPI.sendNotification('Cache Cleared', 'Dependency cache has been cleared');
                    break;
                default:
                    this.logger.warn(`Unknown command: ${command}`);
            }

            this.connection.sendResponse({ id: this.connection.currentRequestId, result: null });
        } catch (error) {
            this.logger.error('Error executing command:', error.message);
            this.connection.sendResponse({ id: this.connection.currentRequestId, result: null });
        }
    }

    async handleCopyToClipboard(uri, range) {
        const text = await this.getTextInRange(uri, range);
        if (text) {
            await this.termuxAPI.copyToClipboard(text);
            this.termuxAPI.sendNotification('Copied!', 'Code copied to Android clipboard');
        }
    }

    async handleShareCode(uri, range) {
        const text = await this.getTextInRange(uri, range);
        if (text) {
            await this.termuxAPI.shareText(text, 'Code Snippet');
        }
    }

    async getTextInRange(uri, range) {
        // **FIX:** Re-implemented with streams for memory efficiency
        try {
            const filePath = uri.replace('file://', '');
            const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity
            });

            let lines = [];
            let currentLine = 0;
            const startLine = range.start.line;
            const endLine = range.end.line;

            for await (const line of rl) {
                if (currentLine >= startLine && currentLine <= endLine) {
                    if (startLine === endLine) { // Selection is on a single line
                        lines.push(line.substring(range.start.character, range.end.character));
                        break;
                    }
                    if (currentLine === startLine) {
                        lines.push(line.substring(range.start.character));
                    } else if (currentLine === endLine) {
                        lines.push(line.substring(0, range.end.character));
                    } else {
                        lines.push(line);
                    }
                }
                if (currentLine > endLine) {
                    rl.close();
                    fileStream.destroy();
                    break;
                }
                currentLine++;
            }
            return lines.join('\n');
        } catch (error) {
            this.logger.error('Error getting text in range:', error);
            return null;
        }
    }

    handleShutdown() {
        this.logger.info('Shutting down Volt LSP...');
        if (this.dependencyInfo) {
            this.dependencyInfo.saveCache();
        }
        if (this.tsServerProxy) {
            this.tsServerProxy.shutdown();
        }
        this.connection.sendResponse({ id: this.connection.currentRequestId, result: null });
    }

    handleExit() {
        this.logger.info('Exiting Volt LSP');
        process.exit(0);
    }
}

module.exports = VoltLSP;
