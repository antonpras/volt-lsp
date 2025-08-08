const fs = require('fs');
const path = require('path');

class Logger {
    constructor(component = 'VoltLSP') {
        this.component = component;
        this.logLevel = process.env.VOLT_LSP_LOG_LEVEL || 'info';
        this.logFile = process.env.VOLT_LSP_LOG_FILE || null;
        this.enableColors = process.env.VOLT_LSP_NO_COLORS !== '1';
        
        // Create log levels hierarchy
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };

        // Color codes for terminal output
        this.colors = {
            error: '\x1b[31m',   // Red
            warn: '\x1b[33m',    // Yellow
            info: '\x1b[36m',    // Cyan
            debug: '\x1b[90m',   // Gray
            reset: '\x1b[0m'     // Reset
        };

        // Emojis for different log levels
        this.emojis = {
            error: '❌',
            warn: '⚠️ ',
            info: 'ℹ️ ',
            debug: '🔧'
        };

        this.initializeLogFile();
    }

    initializeLogFile() {
        if (this.logFile) {
            try {
                // Ensure log directory exists
                const logDir = path.dirname(this.logFile);
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }

                // Write startup message
                this.writeToFile('info', 'Logger initialized', { 
                    timestamp: new Date().toISOString(),
                    component: this.component,
                    pid: process.pid
                });
            } catch (error) {
                console.error('Failed to initialize log file:', error.message);
                this.logFile = null;
            }
        }
    }

    shouldLog(level) {
        return this.levels[level] <= this.levels[this.logLevel];
    }

    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const emoji = this.emojis[level] || '';
        const componentTag = `[${this.component}]`;
        
        let formattedMessage = `${timestamp} ${emoji} ${level.toUpperCase()} ${componentTag} ${message}`;
        
        if (data) {
            if (typeof data === 'object') {
                formattedMessage += '\n' + JSON.stringify(data, null, 2);
            } else {
                formattedMessage += ` ${data}`;
            }
        }

        return formattedMessage;
    }

    formatConsoleMessage(level, message, data = null) {
        const timestamp = new Date().toTimeString().split(' ')[0];
        const emoji = this.emojis[level] || '';
        const componentTag = `[${this.component}]`;
        
        let color = '';
        let reset = '';
        
        if (this.enableColors) {
            color = this.colors[level] || '';
            reset = this.colors.reset;
        }

        let formattedMessage = `${color}${timestamp} ${emoji} ${level.toUpperCase()} ${componentTag} ${message}${reset}`;
        
        if (data) {
            if (typeof data === 'object') {
                formattedMessage += '\n' + JSON.stringify(data, null, 2);
            } else {
                formattedMessage += ` ${data}`;
            }
        }

        return formattedMessage;
    }

    writeToFile(level, message, data = null) {
        if (!this.logFile) return;

        try {
            const logEntry = this.formatMessage(level, message, data) + '\n';
            fs.appendFileSync(this.logFile, logEntry, 'utf8');
        } catch (error) {
            console.error('Failed to write to log file:', error.message);
        }
    }

    writeToConsole(level, message, data = null) {
        const formattedMessage = this.formatConsoleMessage(level, message, data);
        
        // Use appropriate console method
        switch (level) {
            case 'error':
                console.error(formattedMessage);
                break;
            case 'warn':
                console.warn(formattedMessage);
                break;
            case 'debug':
                console.debug(formattedMessage);
                break;
            default:
                console.log(formattedMessage);
        }
    }

    log(level, message, data = null) {
        if (!this.shouldLog(level)) {
            return;
        }

        // Always write to console
        this.writeToConsole(level, message, data);
        
        // Write to file if configured
        this.writeToFile(level, message, data);
    }

    error(message, data = null) {
        this.log('error', message, data);
    }

    warn(message, data = null) {
        this.log('warn', message, data);
    }

    info(message, data = null) {
        this.log('info', message, data);
    }

    debug(message, data = null) {
        this.log('debug', message, data);
    }

    // Performance logging
    time(label) {
        this._timers = this._timers || new Map();
        this._timers.set(label, Date.now());
        this.debug(`Timer started: ${label}`);
    }

    timeEnd(label) {
        this._timers = this._timers || new Map();
        const startTime = this._timers.get(label);
        
        if (startTime) {
            const duration = Date.now() - startTime;
            this._timers.delete(label);
            this.debug(`Timer finished: ${label}`, { duration: `${duration}ms` });
            return duration;
        } else {
            this.warn(`Timer not found: ${label}`);
            return null;
        }
    }

    // Memory logging
    logMemoryUsage(context = '') {
        if (!this.shouldLog('debug')) return;

        const memUsage = process.memoryUsage();
        const formatBytes = (bytes) => {
            return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
        };

        this.debug(`Memory usage${context ? ' (' + context + ')' : ''}`, {
            rss: formatBytes(memUsage.rss),
            heapTotal: formatBytes(memUsage.heapTotal),
            heapUsed: formatBytes(memUsage.heapUsed),
            external: formatBytes(memUsage.external)
        });
    }

    // Request/response logging
    logRequest(method, params = null, id = null) {
        const logData = { method };
        if (id !== null) logData.id = id;
        if (params) logData.params = this.sanitizeParams(params);
        
        this.debug('LSP Request', logData);
    }

    logResponse(id, result = null, error = null) {
        const logData = { id };
        if (error) {
            logData.error = error;
            this.debug('LSP Error Response', logData);
        } else {
            if (result) logData.result = this.sanitizeResult(result);
            this.debug('LSP Response', logData);
        }
    }

    // Sanitize sensitive data from logs
    sanitizeParams(params) {
        if (!params || typeof params !== 'object') return params;

        const sanitized = { ...params };
        
        // Remove potentially sensitive information
        const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
        
        for (const key of sensitiveKeys) {
            if (key in sanitized) {
                sanitized[key] = '[REDACTED]';
            }
        }

        // Truncate large text documents
        if (sanitized.textDocument && sanitized.textDocument.text) {
            const text = sanitized.textDocument.text;
            if (text.length > 200) {
                sanitized.textDocument.text = text.substring(0, 200) + '... [TRUNCATED]';
            }
        }

        return sanitized;
    }

    sanitizeResult(result) {
        if (!result || typeof result !== 'object') return result;

        // Truncate large results
        const resultStr = JSON.stringify(result);
        if (resultStr.length > 500) {
            return '[LARGE_RESULT_TRUNCATED]';
        }

        return result;
    }

    // Error tracking
    logException(error, context = '') {
        const errorData = {
            name: error.name,
            message: error.message,
            stack: error.stack,
            context
        };

        this.error('Exception occurred', errorData);
    }

    // Performance profiling
    profile(name) {
        const start = Date.now();
        return {
            start,
            end: () => {
                const duration = Date.now() - start;
                this.debug(`Profile: ${name}`, { duration: `${duration}ms` });
                return duration;
            }
        };
    }

    // Structured logging for LSP events
    logLSPEvent(event, data = {}) {
        const eventData = {
            event,
            timestamp: Date.now(),
            ...data
        };

        this.info(`LSP Event: ${event}`, eventData);
    }

    // File operation logging
    logFileOperation(operation, file, success = true, error = null) {
        const logData = {
            operation,
            file: path.basename(file), // Only log filename for privacy
            success
        };

        if (error) {
            logData.error = error.message;
            this.warn(`File operation failed: ${operation}`, logData);
        } else {
            this.debug(`File operation: ${operation}`, logData);
        }
    }

    // Cleanup old log files (if using file logging)
    rotateLogFile(maxSizeMB = 10) {
        if (!this.logFile || !fs.existsSync(this.logFile)) {
            return;
        }

        try {
            const stats = fs.statSync(this.logFile);
            const fileSizeMB = stats.size / (1024 * 1024);

            if (fileSizeMB > maxSizeMB) {
                const rotatedFile = `${this.logFile}.${Date.now()}.old`;
                fs.renameSync(this.logFile, rotatedFile);
                this.info('Log file rotated', { oldFile: rotatedFile });

                // Remove old rotated files (keep last 5)
                this.cleanupRotatedFiles();
            }
        } catch (error) {
            this.error('Failed to rotate log file:', error.message);
        }
    }

    cleanupRotatedFiles() {
        try {
            const logDir = path.dirname(this.logFile);
            const baseName = path.basename(this.logFile);
            const files = fs.readdirSync(logDir);
            
            const rotatedFiles = files
                .filter(file => file.startsWith(baseName) && file.endsWith('.old'))
                .map(file => ({
                    name: file,
                    path: path.join(logDir, file),
                    mtime: fs.statSync(path.join(logDir, file)).mtime
                }))
                .sort((a, b) => b.mtime - a.mtime);

            // Keep only the 5 most recent rotated files
            const filesToDelete = rotatedFiles.slice(5);
            
            for (const file of filesToDelete) {
                fs.unlinkSync(file.path);
                this.debug('Deleted old log file', { file: file.name });
            }
        } catch (error) {
            this.error('Failed to cleanup rotated files:', error.message);
        }
    }
}

module.exports = Logger;
