// File: index.js (Versi Perbaikan Final)
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
        this.connection = new LSPConnection();
        this.rootPath = process.cwd();
    }

    start() {
        this.logger.info('🚀 Starting Volt LSP...');
        this.setupConnectionHandlers();
        this.connection.start();
    }

    setupConnectionHandlers() {
        // **PERUBAHAN PENTING:** Kita sekarang meneruskan 'id' dari setiap permintaan
        this.connection.on('initialize', (params, id) => this.handleInitialize(params, id));
        this.connection.on('textDocument/completion', (params, id) => this.handleCompletion(params, id));
        this.connection.on('textDocument/hover', (params, id) => this.handleHover(params, id));
        this.connection.on('textDocument/definition', (params, id) => this.handleDefinition(params, id));
        this.connection.on('textDocument/codeAction', (params, id) => this.handleCodeAction(params, id));
        this.connection.on('workspace/executeCommand', (params, id) => this.handleExecuteCommand(params, id));

        // Notifikasi tidak punya 'id' dan tidak butuh balasan
        this.connection.on('initialized', () => this.handleInitialized());
        this.connection.on('textDocument/didOpen', (params) => this.tsServerProxy.openFile(params.textDocument.uri, params.textDocument.text));
        this.connection.on('textDocument/didChange', (params) => this.tsServerProxy.updateFile(params.textDocument.uri, params.contentChanges[0].text));
        this.connection.on('textDocument/didClose', (params) => this.tsServerProxy.closeFile(params.textDocument.uri));
        this.connection.on('shutdown', () => this.handleShutdown());
        this.connection.on('exit', () => this.handleExit());
    }

    handleInitialize(params, id) {
        this.rootPath = params.rootPath || params.rootUri?.replace('file://', '') || process.cwd();
        this.logger.info(`Workspace initialized at: ${this.rootPath}`);

        this.termuxAPI = new TermuxAPIManager();
        this.tsServerProxy = new TSServerProxy(this.rootPath);
        this.taskRunner = new TaskRunner(this.rootPath, this.termuxAPI);
        this.dependencyInfo = new DependencyInfoProvider(this.rootPath);

        const result = {
            capabilities: {
                textDocumentSync: 1,
                completionProvider: { triggerCharacters: ['.', '/', '"', "'", '@'] },
                hoverProvider: true,
                definitionProvider: true,
                codeActionProvider: true,
                executeCommandProvider: { commands: ['volt-lsp:runTest', 'volt-lsp:runBuild', 'volt-lsp:copyToClipboard', 'volt-lsp:shareCode', 'volt-lsp:clearCache'] }
            },
            serverInfo: { name: 'Volt LSP', version: '0.2.0' }
        };

        // **PERUBAHAN PENTING:** Kirim balasan dengan ID yang sudah kita "ingat"
        this.connection.sendResponse(id, result);
    }

    handleInitialized() {
        this.logger.info('✅ Volt LSP initialized successfully');
        this.tsServerProxy.start();
        this.tsServerProxy.on('diagnostics', (uri, diagnostics) => this.connection.sendDiagnostics(uri, diagnostics));
        this.taskRunner.on('diagnostic', (diagnostic) => this.connection.sendDiagnostics(diagnostic.uri, [diagnostic]));
        this.termuxAPI.sendNotification('Volt LSP Ready', 'TypeScript Language Server is now active');
    }

    async handleCompletion(params, id) {
        const result = await this.tsServerProxy.getCompletions(params.textDocument.uri, params.position);
        this.connection.sendResponse(id, result);
    }

    async handleHover(params, id) {
        let hoverInfo = null;
        if (params.textDocument.uri.endsWith('package.json')) {
            hoverInfo = await this.dependencyInfo.getHoverInfo(params.textDocument.uri, params.position);
        }
        if (!hoverInfo) {
            hoverInfo = await this.tsServerProxy.getHover(params.textDocument.uri, params.position);
        }
        this.connection.sendResponse(id, hoverInfo);
    }

    async handleDefinition(params, id) {
        const result = await this.tsServerProxy.getDefinition(params.textDocument.uri, params.position);
        this.connection.sendResponse(id, result);
    }

    async handleCodeAction(params, id) {
        const actions = [];
        const tsActions = await this.tsServerProxy.getCodeActions(params.textDocument.uri, params.range, params.context);
        if (tsActions) actions.push(...tsActions);
        if (params.range.start.line !== params.range.end.line || params.range.start.character !== params.range.end.character) {
            actions.push({ title: '[Volt] Copy to Android Clipboard', command: { command: 'volt-lsp:copyToClipboard', arguments: [params.textDocument.uri, params.range] } });
            actions.push({ title: '[Volt] Share Code Snippet', command: { command: 'volt-lsp:shareCode', arguments: [params.textDocument.uri, params.range] } });
        }
        this.connection.sendResponse(id, actions);
    }

    async handleExecuteCommand(params, id) {
        const { command, arguments: args = [] } = params;
        try {
            switch (command) {
                case 'volt-lsp:runTest': await this.taskRunner.runTest(); break;
                case 'volt-lsp:runBuild': await this.taskRunner.runBuild(); break;
                // Implementasi lain...
            }
            this.connection.sendResponse(id, null); // Kirim balasan sukses
        } catch (error) {
            this.logger.error(`Error executing command ${command}:`, error.message);
            this.connection.sendError(id, -32000, error.message); // Kirim balasan error
        }
    }

    handleShutdown() { /* ... */ }
    handleExit() { /* ... */ }
}

const server = new VoltLSP();
server.start();
module.exports = VoltLSP;
