#!/data/data/com.termux/files/usr/bin/bash

# Volt LSP Installation Script
# The Blazing-Fast, Termux-Native TypeScript Language Server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Emojis
ROCKET="🚀"
CHECK="✅"
WARNING="⚠️"
ERROR="❌"
INFO="ℹ️"
GEAR="⚙️"

print_header() {
    echo -e "${PURPLE}"
    echo "⚡ ====================================== ⚡"
    echo "   VOLT LSP INSTALLER"
    echo "   The Blazing-Fast, Termux-Native"
    echo "   TypeScript Language Server"
    echo "⚡ ====================================== ⚡"
    echo -e "${NC}"
}

print_step() {
    echo -e "${CYAN}${GEAR} $1${NC}"
}

print_success() {
    echo -e "${GREEN}${CHECK} $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}${WARNING} $1${NC}"
}

print_error() {
    echo -e "${RED}${ERROR} $1${NC}"
}

print_info() {
    echo -e "${BLUE}${INFO} $1${NC}"
}

check_termux() {
    if [[ ! -d "/data/data/com.termux" ]]; then
        print_error "This script is designed for Termux environment only!"
        exit 1
    fi
    print_success "Running in Termux environment"
}

check_command() {
    if command -v "$1" >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

install_package() {
    local package_name="$1"
    local display_name="${2:-$1}"
    
    if check_command "$package_name"; then
        print_success "$display_name is already installed"
        return 0
    fi
    
    print_step "Installing $display_name..."
    if pkg install -y "$package_name" >/dev/null 2>&1; then
        print_success "$display_name installed successfully"
        return 0
    else
        print_error "Failed to install $display_name"
        return 1
    fi
}

update_packages() {
    print_step "Updating package repositories..."
    if pkg update >/dev/null 2>&1 && pkg upgrade -y >/dev/null 2>&1; then
        print_success "Packages updated successfully"
    else
        print_warning "Package update failed, continuing anyway..."
    fi
}

install_prerequisites() {
    print_step "Installing prerequisites..."
    
    # Essential packages
    install_package "nodejs" "Node.js"
    install_package "git" "Git"
    install_package "termux-api" "Termux-API"
    
    # Optional but recommended
    if ! check_command "nvim"; then
        print_step "Neovim not found. Would you like to install it? (y/n)"
        read -r install_nvim
        if [[ "$install_nvim" =~ ^[Yy]$ ]]; then
            install_package "neovim" "Neovim"
        else
            print_warning "Neovim not installed. You'll need a compatible LSP client."
        fi
    else
        print_success "Neovim is already installed"
    fi
}

check_node_version() {
    if check_command "node"; then
        local node_version
        node_version=$(node --version | sed 's/v//')
        local major_version
        major_version=$(echo "$node_version" | cut -d. -f1)
        
        if [ "$major_version" -ge 14 ]; then
            print_success "Node.js version $node_version (compatible)"
            return 0
        else
            print_error "Node.js version $node_version is too old (minimum: v14.0.0)"
            return 1
        fi
    else
        print_error "Node.js not found"
        return 1
    fi
}

check_termux_api() {
    print_step "Checking Termux-API integration..."
    
    if check_command "termux-notification"; then
        # Test notification
        if termux-notification --title "Volt LSP" --content "Testing Termux-API integration" >/dev/null 2>&1; then
            print_success "Termux-API is working correctly"
            return 0
        else
            print_warning "Termux-API installed but not functioning"
            print_info "Please install Termux:API app from F-Droid and grant permissions"
            return 1
        fi
    else
        print_error "Termux-API not found"
        return 1
    fi
}

install_typescript() {
    print_step "Checking TypeScript installation..."
    
    if check_command "tsc"; then
        local ts_version
        ts_version=$(tsc --version | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
        print_success "TypeScript $ts_version is already installed"
        return 0
    fi
    
    print_step "Installing TypeScript globally..."
    if npm install -g typescript >/dev/null 2>&1; then
        print_success "TypeScript installed successfully"
        return 0
    else
        print_warning "Failed to install TypeScript globally"
        print_info "Volt LSP will try to use local TypeScript installations"
        return 1
    fi
}

create_project_structure() {
    print_step "Creating Volt LSP project structure..."
    
    local project_dir="$HOME/volt-lsp"
    
    # Create directory if it doesn't exist
    if [ ! -d "$project_dir" ]; then
        mkdir -p "$project_dir"
        print_success "Created project directory: $project_dir"
    else
        print_info "Project directory already exists: $project_dir"
    fi
    
    # Change to project directory
    cd "$project_dir"
    
    # Create necessary subdirectories
    mkdir -p bin src
    
    echo "$project_dir"
}

download_project_files() {
    local project_dir="$1"
    print_step "Setting up Volt LSP project files..."
    
    cd "$project_dir"
    
    # Note: In a real scenario, you would download from GitHub or copy files
    # For this demo, we'll create a simple indicator that files need to be copied
    
    cat > setup_instructions.txt << EOF
VOLT LSP SETUP INSTRUCTIONS
===========================

The project structure has been created in: $project_dir

Next steps:
1. Copy all the Volt LSP source files to this directory:
   - package.json
   - index.js
   - bin/volt-lsp
   - src/*.js files

2. Run: npm install

3. Run: npm link (to install globally)

4. Configure your editor (Neovim example in README.md)

Directory structure should look like:
$project_dir/
├── package.json
├── index.js
├── bin/volt-lsp
└── src/
    ├── lsp-connection.js
    ├── tsserver-proxy.js
    ├── termux-api-manager.js
    ├── task-runner.js
    ├── dependency-info-provider.js
    └── logger.js

EOF

    print_success "Setup instructions created: $project_dir/setup_instructions.txt"
}

install_npm_dependencies() {
    local project_dir="$1"
    
    if [ ! -f "$project_dir/package.json" ]; then
        print_warning "package.json not found. Skipping npm install."
        print_info "Please copy project files and run 'npm install' manually."
        return 1
    fi
    
    print_step "Installing npm dependencies..."
    cd "$project_dir"
    
    if npm install >/dev/null 2>&1; then
        print_success "Dependencies installed successfully"
        return 0
    else
        print_error "Failed to install dependencies"
        return 1
    fi
}

link_globally() {
    local project_dir="$1"
    
    if [ ! -f "$project_dir/package.json" ]; then
        print_warning "Cannot link globally: package.json not found"
        return 1
    fi
    
    print_step "Installing Volt LSP globally..."
    cd "$project_dir"
    
    if npm link >/dev/null 2>&1; then
        print_success "Volt LSP installed globally"
        return 0
    else
        print_error "Failed to install globally"
        return 1
    fi
}

test_installation() {
    print_step "Testing Volt LSP installation..."
    
    if check_command "volt-lsp"; then
        print_success "Volt LSP command is available"
        
        # Test if it can start (timeout after 5 seconds)
        if timeout 5 volt-lsp --help >/dev/null 2>&1; then
            print_success "Volt LSP is working correctly"
            return 0
        else
            print_warning "Volt LSP command found but may not be working correctly"
            return 1
        fi
    else
        print_error "Volt LSP command not found"
        print_info "You may need to restart your shell or run: source ~/.bashrc"
        return 1
    fi
}

create_neovim_config() {
    local nvim_dir="$HOME/.config/nvim"
    local lua_dir="$nvim_dir/lua"
    local volt_config="$lua_dir/volt-lsp-config.lua"
    
    if [ ! -d "$nvim_dir" ]; then
        print_step "Creating Neovim configuration directory..."
        mkdir -p "$lua_dir"
    fi
    
    if [ ! -f "$volt_config" ]; then
        print_step "Creating Volt LSP Neovim configuration..."
        
        cat > "$volt_config" << 'EOF'
-- Volt LSP Configuration for Neovim
-- Add this to your init.lua: require('volt-lsp-config')

local lspconfig = require('lspconfig')

-- Configure Volt LSP
lspconfig.volt_lsp = {
    default_config = {
        cmd = { 'volt-lsp' },
        filetypes = { 'typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'json' },
        root_dir = lspconfig.util.root_pattern('package.json', 'tsconfig.json', '.git'),
        single_file_support = true,
    },
}

-- Auto-start for supported file types
vim.api.nvim_create_autocmd('FileType', {
    pattern = { 'typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'json' },
    callback = function()
        lspconfig.volt_lsp.launch()
    end
})

-- Keymaps (customize as needed)
vim.keymap.set('n', '<space>ca', vim.lsp.buf.code_action, { desc = 'Code Actions' })
vim.keymap.set('n', 'K', vim.lsp.buf.hover, { desc = 'Hover Info' })
vim.keymap.set('n', 'gd', vim.lsp.buf.definition, { desc = 'Go to Definition' })

-- Volt LSP specific commands
vim.api.nvim_create_user_command('VoltTest', function()
    vim.lsp.buf.execute_command({ command = 'volt-lsp:runTest' })
end, {})

vim.api.nvim_create_user_command('VoltBuild', function()
    vim.lsp.buf.execute_command({ command = 'volt-lsp:runBuild' })
end, {})

vim.api.nvim_create_user_command('VoltClearCache', function()
    vim.lsp.buf.execute_command({ command = 'volt-lsp:clearCache' })
end, {})

print("⚡ Volt LSP configuration loaded!")
EOF

        print_success "Neovim configuration created: $volt_config"
        print_info "Add 'require(\"volt-lsp-config\")' to your init.lua to enable"
    else
        print_info "Volt LSP Neovim configuration already exists"
    fi
}

show_final_instructions() {
    echo
    echo -e "${PURPLE}⚡ ====================================== ⚡${NC}"
    echo -e "${GREEN}${ROCKET} INSTALLATION COMPLETED! ${NC}"
    echo -e "${PURPLE}⚡ ====================================== ⚡${NC}"
    echo
    
    print_info "Next steps:"
    echo "1. Copy all Volt LSP project files to: $(echo $HOME/volt-lsp)"
    echo "2. Run: cd ~/volt-lsp && npm install && npm link"
    echo "3. Configure your editor (see README.md)"
    echo "4. Start coding with lightning speed! ⚡"
    echo
    
    if check_command "nvim"; then
        print_info "For Neovim users:"
        echo "- Configuration file created at: ~/.config/nvim/lua/volt-lsp-config.lua"
        echo "- Add to your init.lua: require('volt-lsp-config')"
    fi
    
    echo
    print_info "Useful commands:"
    echo "- Test Volt LSP: volt-lsp --help"
    echo "- Check logs: tail -f ~/.volt-lsp.log"
    echo "- Clear cache: volt-lsp:clearCache"
    
    echo
    echo -e "${CYAN}Happy coding with Volt LSP! 🚀⚡${NC}"
}

main() {
    print_header
    
    # Check environment
    check_termux
    
    # Update packages
    update_packages
    
    # Install prerequisites
    install_prerequisites
    
    # Check versions
    check_node_version
    
    # Check Termux-API
    check_termux_api
    
    # Install TypeScript
    install_typescript
    
    # Create project structure
    project_dir=$(create_project_structure)
    
    # Download/setup project files
    download_project_files "$project_dir"
    
    # Install dependencies (if files exist)
    install_npm_dependencies "$project_dir"
    
    # Link globally (if files exist)
    link_globally "$project_dir"
    
    # Test installation
    test_installation
    
    # Create Neovim config
    if check_command "nvim"; then
        create_neovim_config
    fi
    
    # Show final instructions
    show_final_instructions
}

# Run main function
main "$@"
