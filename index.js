const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
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
            // Initialize LSP connection (stdio)
            this.connection = new LSPConnection();
            
            // Initialize Termux API manager
            this.termuxAPI = new TermuxAPIManager();
            
            // Set up connection event handlers
            this.setupConnectionHandlers();
            
            // Start the connection
            this.connection.start();
            
        } catch (error) {
            this.logger.error('Failed to start Volt LSP:', error);
            process.exit(1);
        }
    }

    setupConnectionHandlers() {
        this.connection.on('initialize', (params) => {
            this.handleInitialize(params);
        });

        this.connection.on('initialized', () => {
            this.handleInitialized();
        });

        this.connection.on('textDocument/didOpen', (params) => {
            this.handleDidOpenTextDocument(params);
        });

        this.connection.on('textDocument/didChange', (params) => {
            this.handleDidChangeTextDocument(params);
        });

        this.connection.on('textDocument/didClose', (params) => {
            this.handleDidCloseTextDocument(params);
        });

        this.connection.on('textDocument/completion', (params) => {
            this.handleCompletion(params);
        });

        this.connection.on('textDocument/hover', (params) => {
            this.handleHover(params);
        });

        this.connection.on('textDocument/definition', (params) => {
            this.handleDefinition(params);
        });

        this.connection.on('textDocument/codeAction', (params) => {
            this.handleCodeAction(params);
        });

        this.connection.on('workspace/executeCommand', (params) => {
            this.handleExecuteCommand(params);
        });

        this.connection.on('shutdown', () => {
            this.handleShutdown();
        });

        this.connection.on('exit', () => {
            this.handleExit();
        });
    }

    handleInitialize(params) {
        this.rootPath = params.rootPath || params.rootUri?.replace('file://', '') || process.cwd();
        this.logger.info(`Initializing workspace at: ${this.rootPath}`);

        // Initialize TypeScript server proxy
        this.tsServerProxy = new TSServerProxy(this.rootPath);
        
        // Initialize task runner
        this.taskRunner = new TaskRunner(this.rootPath, this.termuxAPI);
        
        // Initialize dependency info provider
        this.dependencyInfo = new DependencyInfoProvider(this.rootPath);

        const capabilities = {
            textDocumentSync: 1, // Full sync
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['.', '/', '"', "'"]
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
            capabilities,
            serverInfo: {
                name: 'Volt LSP',
                version: '0.2.0'
            }
        });
    }

    handleInitialized() {
        this.isInitialized = true;
        this.logger.info('✅ Volt LSP initialized successfully');
        
        // Start tsserver
        this.tsServerProxy.start();
        
        // Send notification to Termux
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
        // For full sync, we just take the full text
        if (contentChanges.length > 0) {
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
            this.connection.sendResponse(completions);
        } catch (error) {
            this.logger.error('Error getting completions:', error);
            this.connection.sendResponse(null);
        }
    }

    async handleHover(params) {
        try {
            // Check if this is a package.json file and we're hovering over a dependency
            const uri = params.textDocument.uri;
            if (uri.endsWith('package.json')) {
                const hoverInfo = await this.dependencyInfo.getHoverInfo(uri, params.position);
                if (hoverInfo) {
                    this.connection.sendResponse(hoverInfo);
                    return;
                }
            }

            // Otherwise, delegate to tsserver
            const hover = await this.tsServerProxy.getHover(uri, params.position);
            this.connection.sendResponse(hover);
        } catch (error) {
            this.logger.error('Error getting hover info:', error);
            this.connection.sendResponse(null);
        }
    }

    async handleDefinition(params) {
        try {
            const definition = await this.tsServerProxy.getDefinition(
                params.textDocument.uri,
                params.position
            );
            this.connection.sendResponse(definition);
        } catch (error) {
            this.logger.error('Error getting definition:', error);
            this.connection.sendResponse(null);
        }
    }

    async handleCodeAction(params) {
        try {
            const actions = [];

            // Get standard TypeScript code actions
            const tsActions = await this.tsServerProxy.getCodeActions(
                params.textDocument.uri,
                params.range,
                params.context
            );
            actions.push(...tsActions);

            // Add Volt-specific code actions
            if (params.range.start.line !== params.range.end.line || 
                params.range.start.character !== params.range.end.character) {
                
                actions.push({
                    title: '[Volt] Copy to Android Clipboard',
                    kind: 'volt.copy',
                    command: {
                        command: 'volt-lsp:copyToClipboard',
                        arguments: [params.textDocument.uri, params.range]
                    }
                });

                actions.push({
                    title: '[Volt] Share Code Snippet',
                    kind: 'volt.share',
                    command: {
                        command: 'volt-lsp:shareCode',
                        arguments: [params.textDocument.uri, params.range]
                    }
                });
            }

            this.connection.sendResponse(actions);
        } catch (error) {
            this.logger.error('Error getting code actions:', error);
            this.connection.sendResponse([]);
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

            this.connection.sendResponse(null);
        } catch (error) {
            this.logger.error('Error executing command:', error);
            this.connection.sendResponse(null);
        }
    }

    async handleCopyToClipboard(uri, range) {
        // Get the text content for the range
        const text = await this.getTextInRange(uri, range);
        if (text) {
            await this.termuxAPI.copyToClipboard(text);
            this.termuxAPI.sendNotification('Copied!', 'Code copied to Android clipboard');
        }
    }

    async handleShareCode(uri, range) {
        // Get the text content for the range
        const text = await this.getTextInRange(uri, range);
        if (text) {
            await this.termuxAPI.shareText(text, 'Code Snippet');
        }
    }

    async getTextInRange(uri, range) {
        // This is a simplified implementation
        // In a real scenario, you'd maintain document state or read from file
        try {
            const filePath = uri.replace('file://', '');
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            
            if (range.start.line === range.end.line) {
                return lines[range.start.line].substring(range.start.character, range.end.character);
            } else {
                const result = [];
                for (let i = range.start.line; i <= range.end.line; i++) {
                    if (i === range.start.line) {
                        result.push(lines[i].substring(range.start.character));
                    } else if (i === range.end.line) {
                        result.push(lines[i].substring(0, range.end.character));
                    } else {
                        result.push(lines[i]);
                    }
                }
                return result.join('\n');
            }
        } catch (error) {
            this.logger.error('Error getting text in range:', error);
            return null;
        }
    }

    handleShutdown() {
        this.logger.info('Shutting down Volt LSP...');
        
        if (this.tsServerProxy) {
            this.tsServerProxy.shutdown();
        }
        
        this.connection.sendResponse(null);
    }

    handleExit() {
        this.logger.info('Exiting Volt LSP');
        process.exit(0);
    }
}

module.exports = VoltLSP;
