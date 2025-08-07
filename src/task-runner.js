const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const Logger = require('./logger');

class TaskRunner extends EventEmitter {
    constructor(rootPath, termuxAPI) {
        super();
        this.rootPath = rootPath;
        this.termuxAPI = termuxAPI;
        this.logger = new Logger('TaskRunner');
        this.runningTasks = new Map();
        this.packageJsonPath = path.join(rootPath, 'package.json');
        this.loadPackageJson();
    }

    loadPackageJson() {
        try {
            if (fs.existsSync(this.packageJsonPath)) {
                const content = fs.readFileSync(this.packageJsonPath, 'utf8');
                this.packageJson = JSON.parse(content);
                this.logger.info('Loaded package.json successfully');
            } else {
                this.packageJson = null;
                this.logger.warn('No package.json found in workspace');
            }
        } catch (error) {
            this.logger.error('Failed to load package.json:', error);
            this.packageJson = null;
        }
    }

    getAvailableScripts() {
        if (!this.packageJson || !this.packageJson.scripts) {
            return [];
        }

        return Object.keys(this.packageJson.scripts);
    }

    async runScript(scriptName, args = []) {
        if (!this.packageJson || !this.packageJson.scripts) {
            throw new Error('No package.json or scripts found');
        }

        const script = this.packageJson.scripts[scriptName];
        if (!script) {
            throw new Error(`Script "${scriptName}" not found in package.json`);
        }

        this.logger.info(`Running script: ${scriptName}`);
        
        const taskId = `${scriptName}-${Date.now()}`;
        const startTime = Date.now();

        try {
            await this.termuxAPI.notifySuccess('Task Started', `Running ${scriptName}...`);

            const result = await this.executeScript(script, args, taskId);
            const duration = Date.now() - startTime;

            this.logger.info(`Script "${scriptName}" completed in ${duration}ms`);
            await this.termuxAPI.notifySuccess(
                'Task Completed', 
                `${scriptName} finished successfully in ${(duration / 1000).toFixed(1)}s`
            );

            this.emit('taskCompleted', {
                taskId,
                scriptName,
                success: true,
                duration,
                output: result.stdout
            });

            return result;

        } catch (error) {
            const duration = Date.now() - startTime;
            
            this.logger.error(`Script "${scriptName}" failed:`, error);
            await this.termuxAPI.notifyError(
                'Task Failed', 
                `${scriptName} failed: ${error.message}`
            );

            this.emit('taskFailed', {
                taskId,
                scriptName,
                success: false,
                duration,
                error: error.message,
                output: error.stdout || '',
                errorOutput: error.stderr || ''
            });

            throw error;
        } finally {
            this.runningTasks.delete(taskId);
        }
    }

    executeScript(script, args = [], taskId) {
        return new Promise((resolve, reject) => {
            // Determine the appropriate command to run the script
            const isWindows = process.platform === 'win32';
            const shell = isWindows ? 'cmd' : 'bash';
            const shellFlag = isWindows ? '/c' : '-c';

            // Build the full command
            const fullCommand = `${script} ${args.join(' ')}`.trim();
            
            this.logger.debug(`Executing: ${fullCommand}`);

            const child = spawn(shell, [shellFlag, fullCommand], {
                cwd: this.rootPath,
                stdio: ['inherit', 'pipe', 'pipe'],
                env: { ...process.env, NODE_ENV: 'development' }
            });

            this.runningTasks.set(taskId, child);

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                this.logger.debug(`[${taskId}] stdout:`, chunk);
                
                // Parse output for specific patterns
                this.parseOutput(taskId, chunk, 'stdout');
            });

            child.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                this.logger.debug(`[${taskId}] stderr:`, chunk);
                
                // Parse output for specific patterns
                this.parseOutput(taskId, chunk, 'stderr');
            });

            child.on('close', (code) => {
                this.runningTasks.delete(taskId);
                
                if (code === 0) {
                    resolve({
                        code,
                        stdout,
                        stderr,
                        success: true
                    });
                } else {
                    const error = new Error(`Process exited with code ${code}`);
                    error.code = code;
                    error.stdout = stdout;
                    error.stderr = stderr;
                    reject(error);
                }
            });

            child.on('error', (error) => {
                this.runningTasks.delete(taskId);
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            });
        });
    }

    parseOutput(taskId, output, stream) {
        // Parse Jest test results
        if (output.includes('FAIL') || output.includes('PASS')) {
            this.parseJestOutput(taskId, output);
        }
        
        // Parse TypeScript compiler output
        if (output.includes('.ts(') && output.includes('error TS')) {
            this.parseTypeScriptOutput(taskId, output);
        }

        // Parse ESLint output
        if (output.includes('✖') || output.includes('warning') || output.includes('error')) {
            this.parseESLintOutput(taskId, output);
        }

        // Parse build tool output
        if (output.includes('Build failed') || output.includes('Compilation failed')) {
            this.parseBuildOutput(taskId, output);
        }
    }

    parseJestOutput(taskId, output) {
        const lines = output.split('\n');
        
        for (const line of lines) {
            // Match test failures
            const failMatch = line.match(/^\s*FAIL\s+(.+)$/);
            if (failMatch) {
                this.emit('testResult', {
                    taskId,
                    type: 'test-fail',
                    file: failMatch[1],
                    message: 'Test failed'
                });
                continue;
            }

            // Match test passes
            const passMatch = line.match(/^\s*PASS\s+(.+)$/);
            if (passMatch) {
                this.emit('testResult', {
                    taskId,
                    type: 'test-pass',
                    file: passMatch[1],
                    message: 'Test passed'
                });
                continue;
            }

            // Match specific test case failures
            const testFailMatch = line.match(/\s+●\s+(.+)/);
            if (testFailMatch) {
                this.emit('testResult', {
                    taskId,
                    type: 'test-case-fail',
                    testName: testFailMatch[1],
                    message: 'Test case failed'
                });
            }
        }
    }

    parseTypeScriptOutput(taskId, output) {
        const lines = output.split('\n');
        
        for (const line of lines) {
            // Match TypeScript error format: file.ts(line,col): error TSxxxx: message
            const tsMatch = line.match(/(.+\.tsx?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)/);
            if (tsMatch) {
                const [, file, line, character, severity, code, message] = tsMatch;
                
                this.emit('diagnostic', {
                    taskId,
                    type: 'typescript',
                    file: path.resolve(this.rootPath, file),
                    severity: severity === 'error' ? 1 : 2,
                    line: parseInt(line) - 1,
                    character: parseInt(character) - 1,
                    code: `TS${code}`,
                    message: message.trim()
                });
            }
        }
    }

    parseESLintOutput(taskId, output) {
        const lines = output.split('\n');
        
        for (const line of lines) {
            // Match ESLint format: file:line:col  severity  message  rule
            const eslintMatch = line.match(/^\s*(.+):(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(.+)$/);
            if (eslintMatch) {
                const [, file, line, character, severity, message, rule] = eslintMatch;
                
                this.emit('diagnostic', {
                    taskId,
                    type: 'eslint',
                    file: path.resolve(this.rootPath, file),
                    severity: severity === 'error' ? 1 : 2,
                    line: parseInt(line) - 1,
                    character: parseInt(character) - 1,
                    code: rule,
                    message: message.trim()
                });
            }
        }
    }

    parseBuildOutput(taskId, output) {
        // Generic build error parsing
        const lines = output.split('\n');
        
        for (const line of lines) {
            if (line.toLowerCase().includes('error') && !line.startsWith(' ')) {
                this.emit('buildError', {
                    taskId,
                    type: 'build-error',
                    message: line.trim()
                });
            }
        }
    }

    async runTest() {
        const availableTestScripts = ['test', 'test:unit', 'test:watch', 'jest'];
        let scriptToRun = null;

        for (const script of availableTestScripts) {
            if (this.packageJson?.scripts?.[script]) {
                scriptToRun = script;
                break;
            }
        }

        if (!scriptToRun) {
            // Try to detect if jest is available globally or in node_modules
            if (await this.isCommandAvailable('jest')) {
                return this.executeScript('jest', ['--no-watch', '--no-coverage'], 'test-manual');
            } else {
                throw new Error('No test script found. Please add a "test" script to package.json or install Jest.');
            }
        }

        return this.runScript(scriptToRun);
    }

    async runBuild() {
        const availableBuildScripts = ['build', 'build:prod', 'compile', 'tsc'];
        let scriptToRun = null;

        for (const script of availableBuildScripts) {
            if (this.packageJson?.scripts?.[script]) {
                scriptToRun = script;
                break;
            }
        }

        if (!scriptToRun) {
            // Try to detect if tsc is available
            if (await this.isCommandAvailable('tsc')) {
                return this.executeScript('tsc', ['--noEmit'], 'build-manual');
            } else {
                throw new Error('No build script found. Please add a "build" script to package.json or install TypeScript.');
            }
        }

        return this.runScript(scriptToRun);
    }

    async runLint() {
        const availableLintScripts = ['lint', 'lint:check', 'eslint'];
        let scriptToRun = null;

        for (const script of availableLintScripts) {
            if (this.packageJson?.scripts?.[script]) {
                scriptToRun = script;
                break;
            }
        }

        if (!scriptToRun) {
            if (await this.isCommandAvailable('eslint')) {
                return this.executeScript('eslint', ['.', '--ext', '.js,.ts,.tsx'], 'lint-manual');
            } else {
                throw new Error('No lint script found. Please add a "lint" script to package.json or install ESLint.');
            }
        }

        return this.runScript(scriptToRun);
    }

    async isCommandAvailable(command) {
        return new Promise((resolve) => {
            exec(`which ${command}`, (error) => {
                resolve(!error);
            });
        });
    }

    async killTask(taskId) {
        const task = this.runningTasks.get(taskId);
        if (task) {
            task.kill('SIGTERM');
            this.runningTasks.delete(taskId);
            this.logger.info(`Killed task: ${taskId}`);
            return true;
        }
        return false;
    }

    async killAllTasks() {
        const taskIds = Array.from(this.runningTasks.keys());
        
        for (const taskId of taskIds) {
            await this.killTask(taskId);
        }

        this.logger.info(`Killed ${taskIds.length} running tasks`);
        return taskIds.length;
    }

    getRunningTasks() {
        return Array.from(this.runningTasks.keys());
    }

    isTaskRunning(taskId) {
        return this.runningTasks.has(taskId);
    }
}

module.exports = TaskRunner;
