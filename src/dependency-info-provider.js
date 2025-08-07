const fs = require('fs');
const path = require('path');
const Logger = require('./logger');
const fetch = require('node-fetch'); // **FIX:** Use node-fetch from dependencies

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
                
                if (cacheData && cacheData.dependencies) {
                    this.cache = new Map(Object.entries(cacheData.dependencies));
                    this.logger.info(`Loaded dependency cache with ${this.cache.size} entries`);
                }
            }
        } catch (error) {
            this.logger.error('Failed to load cache:', error);
            this.cache = new Map();
        }
    }

    async saveCache() {
        try {
            if (this.cache.size === 0) return;

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
            const content = fs.readFileSync(this.packageJsonPath, 'utf8');
            const lines = content.split('\n');
            const currentLine = lines[position.line];
            
            if (!currentLine) {
                return null;
            }

            const packageName = this.extractPackageNameFromLine(currentLine, position.character);
            if (!packageName) {
                return null;
            }

            if (!this.isInDependenciesSection(lines, position.line)) {
                return null;
            }

            const packageInfo = await this.getPackageInfo(packageName);
            if (!packageInfo) {
                return null;
            }

            return {
                contents: {
                    kind: 'markdown',
                    value: this.formatPackageInfo(packageName, packageInfo)
                },
                range: this.getPackageNameRange(currentLine, packageName, position.line)
            };

        } catch (error) {
            this.logger.error('Error getting hover info:', error);
            return null;
        }
    }

    extractPackageNameFromLine(line, character) {
        // **FIX:** Improved regex to be more robust
        const match = line.match(/"([^"]+)"\s*:/);
        if (!match) {
            return null;
        }

        const packageName = match[1];
        const packageStart = line.indexOf(`"${packageName}"`);
        const packageEnd = packageStart + packageName.length + 2;

        if (character >= packageStart && character <= packageEnd) {
            return packageName;
        }

        return null;
    }

    isInDependenciesSection(lines, lineNumber) {
        let inDependencies = false;
        for (let i = lineNumber; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.includes('"dependencies"') || line.includes('"devDependencies"') || 
                line.includes('"peerDependencies"') || line.includes('"optionalDependencies"')) {
                inDependencies = true;
                break;
            }
            if (line.match(/^}/) && i < lineNumber) { // End of a block before finding dependencies
                break;
            }
        }
        return inDependencies;
    }

    getPackageNameRange(line, packageName, lineNumber) {
        const packageStart = line.indexOf(`"${packageName}"`);
        if (packageStart === -1) {
            return null;
        }

        return {
            start: { line: lineNumber, character: packageStart + 1 },
            end: { line: lineNumber, character: packageStart + packageName.length + 1 }
        };
    }

    async getPackageInfo(packageName) {
        if (this.cache.has(packageName)) {
            const cachedInfo = this.cache.get(packageName);
            if (Date.now() - (cachedInfo.timestamp || 0) < 24 * 60 * 60 * 1000) {
                this.logger.debug(`Cache hit for ${packageName}`);
                return cachedInfo.data;
            }
        }

        const localInfo = await this.getLocalPackageInfo(packageName);
        if (localInfo) {
            this.cachePackageInfo(packageName, localInfo);
            return localInfo;
        }

        const registryInfo = await this.getNpmRegistryInfo(packageName);
        if (registryInfo) {
            this.cachePackageInfo(packageName, registryInfo);
            return registryInfo;
        }

        return null;
    }

    async getLocalPackageInfo(packageName) {
        const packageJsonPath = path.join(this.rootPath, 'node_modules', packageName, 'package.json');
        
        try {
            if (fs.existsSync(packageJsonPath)) {
                const content = fs.readFileSync(packageJsonPath, 'utf8');
                const packageData = JSON.parse(content);
                
                return {
                    name: packageData.name,
                    version: packageData.version,
                    description: packageData.description,
                    homepage: packageData.homepage,
                    license: packageData.license,
                    source: 'local'
                };
            }
        } catch (error) {
            this.logger.debug(`Failed to read local package.json for ${packageName}:`, error.message);
        }
        
        return null;
    }

    async getNpmRegistryInfo(packageName) {
        // **FIX:** Replaced manual https request with node-fetch for simplicity and robustness
        const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
        this.logger.debug(`Fetching from NPM registry: ${url}`);
        
        try {
            const response = await fetch(url, { timeout: 5000 });
            if (!response.ok) {
                throw new Error(`NPM registry returned ${response.status} ${response.statusText}`);
            }

            const packageData = await response.json();
            const latestVersion = packageData['dist-tags']?.latest;
            const versionData = packageData.versions?.[latestVersion];

            if (versionData) {
                return {
                    name: versionData.name,
                    version: latestVersion,
                    description: versionData.description,
                    homepage: versionData.homepage,
                    repository: versionData.repository,
                    license: versionData.license,
                    keywords: versionData.keywords,
                    author: versionData.author,
                    source: 'npm-registry'
                };
            }
            return null;
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

        // Save cache periodically
        if (this.cache.size % 5 === 0) {
            this.saveCache();
        }
    }

    formatPackageInfo(packageName, info) {
        const lines = [];
        
        lines.push(`### 📦 ${info.name}`);
        
        if (info.version) {
            lines.push(`**Version:** \`${info.version}\``);
        }

        if (info.description) {
            lines.push(`\n${info.description}`);
        }
        
        lines.push('---');

        if (info.license) {
            lines.push(`**License:** ${info.license}`);
        }

        if (info.homepage) {
            lines.push(`**Homepage:** [${info.homepage}](${info.homepage})`);
        }
        
        const sourceEmoji = info.source === 'local' ? '💾' : '🌐';
        lines.push(`\n*${sourceEmoji} Source: ${info.source}*`);

        return lines.join('\n');
    }
}

module.exports = DependencyInfoProvider;
