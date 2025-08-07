const { spawn, exec } = require('child_process');
const Logger = require('./logger');

class TermuxAPIManager {
    constructor() {
        this.logger = new Logger('TermuxAPI');
        this.isAvailable = false;
        this.checkAvailability();
    }

    async checkAvailability() {
        try {
            await this.executeCommand('termux-notification', ['--help']);
            this.isAvailable = true;
            this.logger.info('✅ Termux API is available');
        } catch (error) {
            this.isAvailable = false;
            this.logger.warn('⚠️  Termux API not available. Some features will be limited.');
            this.logger.warn('Install termux-api package and Termux:API app for full functionality.');
        }
    }

    executeCommand(command, args = []) {
        return new Promise((resolve, reject) => {
            const process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
            
            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Command failed with code ${code}: ${stderr}`));
                }
            });

            process.on('error', (error) => {
                reject(error);
            });
        });
    }

    async sendNotification(title, message, priority = 'default') {
        if (!this.isAvailable) {
            this.logger.info(`Notification: ${title} - ${message}`);
            return;
        }

        try {
            const args = [
                '--title', title,
                '--content', message,
                '--priority', priority,
                '--sound'
            ];

            await this.executeCommand('termux-notification', args);
            this.logger.debug(`Notification sent: ${title}`);
        } catch (error) {
            this.logger.error('Failed to send notification:', error);
        }
    }

    async copyToClipboard(text) {
        if (!this.isAvailable) {
            this.logger.info(`Copy to clipboard: ${text.substring(0, 50)}...`);
            return;
        }

        try {
            const process = spawn('termux-clipboard-set', [], { stdio: ['pipe', 'pipe', 'pipe'] });
            process.stdin.write(text);
            process.stdin.end();

            await new Promise((resolve, reject) => {
                process.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Clipboard operation failed with code ${code}`));
                    }
                });

                process.on('error', reject);
            });

            this.logger.debug('Text copied to clipboard successfully');
        } catch (error) {
            this.logger.error('Failed to copy to clipboard:', error);
            throw error;
        }
    }

    async getClipboard() {
        if (!this.isAvailable) {
            return '';
        }

        try {
            const result = await this.executeCommand('termux-clipboard-get');
            return result.trim();
        } catch (error) {
            this.logger.error('Failed to get clipboard content:', error);
            return '';
        }
    }

    async shareText(text, subject = 'Code Snippet') {
        if (!this.isAvailable) {
            this.logger.info(`Share: ${subject} - ${text.substring(0, 50)}...`);
            return;
        }

        try {
            const args = [
                '--content-type', 'text/plain',
                '--subject', subject
            ];

            const process = spawn('termux-share', args, { stdio: ['pipe', 'pipe', 'pipe'] });
            process.stdin.write(text);
            process.stdin.end();

            await new Promise((resolve, reject) => {
                process.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Share operation failed with code ${code}`));
                    }
                });

                process.on('error', reject);
            });

            this.logger.debug('Text shared successfully');
        } catch (error) {
            this.logger.error('Failed to share text:', error);
            throw error;
        }
    }

    async getBatteryStatus() {
        if (!this.isAvailable) {
            return { percentage: 100, status: 'unknown' };
        }

        try {
            const result = await this.executeCommand('termux-battery-status');
            const batteryInfo = JSON.parse(result);
            return {
                percentage: batteryInfo.percentage,
                status: batteryInfo.status,
                plugged: batteryInfo.plugged,
                temperature: batteryInfo.temperature
            };
        } catch (error) {
            this.logger.error('Failed to get battery status:', error);
            return { percentage: 100, status: 'unknown' };
        }
    }

    async showToast(message, duration = 'short') {
        if (!this.isAvailable) {
            this.logger.info(`Toast: ${message}`);
            return;
        }

        try {
            const args = [message];
            if (duration === 'long') {
                args.push('-s');
            }

            await this.executeCommand('termux-toast', args);
            this.logger.debug(`Toast shown: ${message}`);
        } catch (error) {
            this.logger.error('Failed to show toast:', error);
        }
    }

    async vibrate(duration = 1000) {
        if (!this.isAvailable) {
            return;
        }

        try {
            await this.executeCommand('termux-vibrate', ['-d', duration.toString()]);
            this.logger.debug(`Vibrated for ${duration}ms`);
        } catch (error) {
            this.logger.error('Failed to vibrate:', error);
        }
    }

    async getTTSEngines() {
        if (!this.isAvailable) {
            return [];
        }

        try {
            const result = await this.executeCommand('termux-tts-engines');
            return JSON.parse(result);
        } catch (error) {
            this.logger.error('Failed to get TTS engines:', error);
            return [];
        }
    }

    async speak(text, engine = null, language = 'en') {
        if (!this.isAvailable) {
            this.logger.info(`TTS: ${text}`);
            return;
        }

        try {
            const args = [text, '-l', language];
            if (engine) {
                args.push('-e', engine);
            }

            await this.executeCommand('termux-tts-speak', args);
            this.logger.debug(`Spoke: ${text.substring(0, 50)}...`);
        } catch (error) {
            this.logger.error('Failed to speak text:', error);
        }
    }

    async openURL(url) {
        if (!this.isAvailable) {
            this.logger.info(`Open URL: ${url}`);
            return;
        }

        try {
            await this.executeCommand('termux-open-url', [url]);
            this.logger.debug(`Opened URL: ${url}`);
        } catch (error) {
            this.logger.error('Failed to open URL:', error);
        }
    }

    async sendSMS(number, text) {
        if (!this.isAvailable) {
            this.logger.info(`SMS to ${number}: ${text}`);
            return;
        }

        try {
            await this.executeCommand('termux-sms-send', ['-n', number, text]);
            this.logger.debug(`SMS sent to ${number}`);
        } catch (error) {
            this.logger.error('Failed to send SMS:', error);
        }
    }

    async getWifiInfo() {
        if (!this.isAvailable) {
            return { connected: false };
        }

        try {
            const result = await this.executeCommand('termux-wifi-connectioninfo');
            return JSON.parse(result);
        } catch (error) {
            this.logger.error('Failed to get WiFi info:', error);
            return { connected: false };
        }
    }

    async getLocationInfo() {
        if (!this.isAvailable) {
            return null;
        }

        try {
            const result = await this.executeCommand('termux-location', ['-p', 'gps', '-r', 'once']);
            return JSON.parse(result);
        } catch (error) {
            this.logger.error('Failed to get location info:', error);
            return null;
        }
    }

    // Utility method to check if a specific Termux API command is available
    async isCommandAvailable(command) {
        try {
            await this.executeCommand('which', [command]);
            return true;
        } catch (error) {
            return false;
        }
    }

    // Error notification with vibration
    async notifyError(title, message) {
        await Promise.all([
            this.sendNotification(title, message, 'high'),
            this.vibrate(500),
            this.showToast(`❌ ${title}`)
        ]);
    }

    // Success notification
    async notifySuccess(title, message) {
        await Promise.all([
            this.sendNotification(title, message, 'default'),
            this.showToast(`✅ ${title}`)
        ]);
    }

    // Warning notification
    async notifyWarning(title, message) {
        await Promise.all([
            this.sendNotification(title, message, 'default'),
            this.showToast(`⚠️ ${title}`)
        ]);
    }
}

module.exports = TermuxAPIManager;
