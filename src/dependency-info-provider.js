const fs = require('fs');
const path = require('path');
const Logger = require('./logger');

class DependencyInfoProvider {
    constructor(rootPath) {
        this.rootPath = rootPath;
        this.logger = new Logger('DependencyInfo');
        this.cache = new Map();
        this.packageJsonPath = path.join(rootPath, 'package.json');
        this.cacheFile = path.join(rootPath, '.volt-lsp-cache.json');
        this.packageJson = null;
        
        this.loadPackageJson();
        this.loadCache();
    }

    loadPackageJson() {
        try {
            if (fs.existsSync(this.packageJsonPath)) {
                const content = fs.readFileSync(this.packageJsonPath, 'utf8');
                this.packageJson = JSON.parse(content);
                this.logger.info('Loaded package.json for dependency analysis');
            }
        } catch (error) {
            this.logger.error('Failed to load package.json:', error);
        }
    }

    loadCache() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const content = fs.readFileSync(this.cacheFile, 'utf8');
                const cacheData = JSON.parse(content);
                
                // Convert plain object back to Map
                this.cache = new Map(Object.entries(cacheData.dependencies || {}));
                
                this.logger.info(`Loaded dependency cache with ${this.cache.size} entries`);
            }
        } catch (error) {
            this.logger.error('Failed to load cache:', error);
            this.cache = new Map();
        }
    }

    async saveCache() {
        try {
            const cacheData = {
                timestamp: Date.now(),
                dependencies: Object.fromEntries(this.cache)
            };

            fs.writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2));
            this.logger.debug('Cache saved successfully');
        } catch (error) {
            this.logger.error('Failed to save cache:', error);
        }
    }

    async clearCache() {
        this.cache.clear();
        
        try {
            if (fs.existsSync(this.cacheFile)) {
                fs.unlinkSync(this.cacheFile);
            }
            this.logger.info('Cache cleared successfully');
        } catch (error) {
            this.logger.error('Failed to clear cache:', error);
        }
    }

    async getHoverInfo(uri, position) {
        if (!this.packageJson) {
            return null;
        }

        try {
            // Read the current package.json content
            const content = fs.readFileSync(this.packageJsonPath, 'utf8');
            const lines = content.split('\n');
            
            // Get the line at the cursor position
            const currentLine = lines[position.line];
            if (!currentLine) {
                return null;
            }

            // Extract package name from the line
            const packageName = this.extractPackageNameFromLine(currentLine, position.character);
            if (!packageName) {
                return null;
            }

            // Check if this is in dependencies or devDependencies section
            if (!this.isInDependenciesSection(lines, position.line)) {
                return null;
            }

            // Get package information
            const packageInfo = await this.getPackageInfo(packageName);
            if (!packageInfo) {
                return null;
            }

            return {
                contents: [
                    {
                        language: 'markdown',
                        value: this.formatPackageInfo(packageName, packageInfo)
                    }
                ],
                range: this.getPackageNameRange(currentLine, packageName, position.line)
            };

        } catch (error) {
            this.logger.error('Error getting hover info:', error);
            return null;
        }
    }

    extractPackageNameFromLine(line, character) {
        // Match package name in quotes: "package-name": "version"
        const match = line.match(/"([^"]+)":\s*"([^"]+)"/);
        if (!match) {
            return null;
        }

        const [, packageName] = match;
        const packageStart = line.indexOf(`"${packageName}"`);
        const packageEnd = packageStart + packageName.length + 2;

        // Check if cursor is over the package name
        if (character >= packageStart && character <= packageEnd) {
            return packageName;
        }

        return null;
    }

    isInDependenciesSection(lines, lineNumber) {
        // Look backwards for dependencies section
        for (let i = lineNumber; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.includes('"dependencies"') || line.includes('"devDependencies"') || 
                line.includes('"peerDependencies"') || line.includes('"optionalDependencies"')) {
                return true;
            }
            // If we hit another top-level section, stop
            if (line.match(/^"[^"]+"\s*:\s*{/) && !line.includes('dependencies')) {
                return false;
            }
        }
        return false;
    }

    getPackageNameRange(line, packageName, lineNumber) {
        const packageStart = line.indexOf(`"${packageName}"`);
        if (packageStart === -1) {
            return null;
        }

        return {
            start: { line: lineNumber, character: packageStart },
            end: { line: lineNumber, character: packageStart + packageName.length + 2 }
        };
    }

    async getPackageInfo(packageName) {
        // Check cache first
        if (this.cache.has(packageName)) {
            const cachedInfo = this.cache.get(packageName);
            // Check if cache is not too old (24 hours)
            if (Date.now() - cachedInfo.timestamp < 24 * 60 * 60 * 1000) {
                this.logger.debug(`Cache hit for ${packageName}`);
                return cachedInfo.data;
            }
        }

        // Try to get info from local node_modules first
        const localInfo = await this.getLocalPackageInfo(packageName);
        if (localInfo) {
            this.cachePackageInfo(packageName, localInfo);
            return localInfo;
        }

        // Fallback to npm registry
        const registryInfo = await this.getNpmRegistryInfo(packageName);
        if (registryInfo) {
            this.cachePackageInfo(packageName, registryInfo);
            return registryInfo;
        }

        return null;
    }

    async getLocalPackageInfo(packageName) {
        const packageJsonPaths = [
            path.join(this.rootPath, 'node_modules', packageName, 'package.json'),
            path.join(process.cwd(), 'node_modules', packageName, 'package.json')
        ];

        for (const packageJsonPath of packageJsonPaths) {
            try {
                if (fs.existsSync(packageJsonPath)) {
                    const content = fs.readFileSync(packageJsonPath, 'utf8');
                    const packageData = JSON.parse(content);
                    
                    return {
                        name: packageData.name,
                        version: packageData.version,
                        description: packageData.description,
                        homepage: packageData.homepage,
                        repository: packageData.repository,
                        license: packageData.license,
                        keywords: packageData.keywords,
                        author: packageData.author,
                        source: 'local'
                    };
                }
            } catch (error) {
                this.logger.debug(`Failed to read local package.json for ${packageName}:`, error.message);
            }
        }

        return null;
    }

    async getNpmRegistryInfo(packageName) {
        // Only try npm registry if we have internet connection
        // This is a simplified implementation - in production, you might want to check connectivity first
        try {
            const https = require('https');
            const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Request timeout'));
                }, 5000);

                const req = https.get(url, (res) => {
                    let data = '';

                    res.on('data', (chunk) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        clearTimeout(timeout);
                        try {
                            const packageData = JSON.parse(data);
                            const latestVersion = packageData['dist-tags']?.latest;
                            const versionData = packageData.versions?.[latestVersion];

                            if (versionData) {
                                resolve({
                                    name: versionData.name,
                                    version: latestVersion,
                                    description: versionData.description,
                                    homepage: versionData.homepage,
                                    repository: versionData.repository,
                                    license: versionData.license,
                                    keywords: versionData.keywords,
                                    author: versionData.author,
                                    source: 'npm-registry'
                                });
                            } else {
                                resolve(null);
                            }
                        } catch (error) {
                            reject(error);
                        }
                    });
                });

                req.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });

                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Request timeout'));
                });
            });

        } catch (error) {
            this.logger.debug(`Failed to fetch npm registry info for ${packageName}:`, error.message);
            return null;
        }
    }

    cachePackageInfo(packageName, info) {
        this.cache.set(packageName, {
            timestamp: Date.now(),
            data: info
        });

        // Save cache periodically (every 10 packages)
        if (this.cache.size % 10 === 0) {
            this.saveCache();
        }
    }

    formatPackageInfo(packageName, info) {
        const lines = [];
        
        lines.push(`# 📦 ${info.name}`);
        
        if (info.version) {
            lines.push(`**Version:** ${info.version}`);
        }

        if (info.description) {
            lines.push(`\n**Description:** ${info.description}`);
        }

        if (info.license) {
            lines.push(`\n**License:** ${info.license}`);
        }

        if (info.author) {
            const authorStr = typeof info.author === 'string' ? info.author : 
                             info.author.name || info.author.email || JSON.stringify(info.author);
            lines.push(`\n**Author:** ${authorStr}`);
        }

        if (info.keywords && info.keywords.length > 0) {
            lines.push(`\n**Keywords:** ${info.keywords.slice(0, 5).join(', ')}${info.keywords.length > 5 ? '...' : ''}`);
        }

        if (info.homepage) {
            lines.push(`\n**Homepage:** ${info.homepage}`);
        }

        if (info.repository) {
            const repoUrl = typeof info.repository === 'string' ? info.repository :
                           info.repository.url || JSON.stringify(info.repository);
            lines.push(`\n**Repository:** ${repoUrl}`);
        }

        // Add installation command
        lines.push(`\n**Install:** \`npm install ${packageName}\``);

        // Add source indicator
        const sourceEmoji = info.source === 'local' ? '💾' : '🌐';
        lines.push(`\n*${sourceEmoji} Source: ${info.source}*`);

        return lines.join('\n');
    }

    async getPackageVersions(packageName) {
        const cacheKey = `${packageName}:versions`;
        
        if (this.cache.has(cacheKey)) {
            const cachedInfo = this.cache.get(cacheKey);
            if (Date.now() - cachedInfo.timestamp < 60 * 60 * 1000) { // 1 hour cache
                return cachedInfo.data;
            }
        }

        try {
            const https = require('https');
            const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;

            const versions = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Request timeout'));
                }, 5000);

                const req = https.get(url, (res) => {
                    let data = '';

                    res.on('data', (chunk) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        clearTimeout(timeout);
                        try {
                            const packageData = JSON.parse(data);
                            const versions = Object.keys(packageData.versions || {});
                            resolve(versions.slice(-10)); // Last 10 versions
                        } catch (error) {
                            reject(error);
                        }
                    });
                });

                req.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

            this.cache.set(cacheKey, {
                timestamp: Date.now(),
                data: versions
            });

            return versions;

        } catch (error) {
            this.logger.debug(`Failed to fetch versions for ${packageName}:`, error.message);
            return [];
        }
    }

    async suggestUpdates() {
        if (!this.packageJson) {
            return [];
        }

        const suggestions = [];
        const dependencies = {
            ...this.packageJson.dependencies,
            ...this.packageJson.devDependencies
        };

        for (const [packageName, currentVersion] of Object.entries(dependencies)) {
            try {
                const packageInfo = await this.getPackageInfo(packageName);
                if (packageInfo && packageInfo.version) {
                    const cleanCurrentVersion = currentVersion.replace(/^[\^~]/, '');
                    if (packageInfo.version !== cleanCurrentVersion) {
                        suggestions.push({
                            package: packageName,
                            current: currentVersion,
                            latest: packageInfo.version
                        });
                    }
                }
            } catch (error) {
                this.logger.debug(`Failed to check updates for ${packageName}:`, error.message);
            }
        }

        return suggestions;
    }
}

module.exports = DependencyInfoProvider;
