# ⚡ Volt LSP
**The Blazing-Fast, Termux-Native TypeScript Language Server**

![Version](https://img.shields.io/badge/version-0.2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Termux%2FAndroid-orange)

---

## 🚀 Visi Proyek

Volt LSP hadir untuk menghancurkan batasan pengembangan perangkat lunak modern di perangkat mobile. Dirancang khusus untuk lingkungan Termux yang luar biasa, Volt LSP menyediakan pengalaman pengembangan TypeScript/JavaScript kelas satu yang tidak hanya berjalan di Termux, tetapi dilahirkan untuk Termux.

**Kami percaya bahwa performa bukanlah sebuah kemewahan, melainkan sebuah hak.**

## ✨ Fitur Utama

- 🚀 **Performa Super Ringan**: Waktu startup instan dan penggunaan RAM minimal
- 🤖 **Integrasi Termux-API Mendalam**: Notifikasi error, aksi salin & bagikan ke aplikasi Android lain
- ⚡ **Inline Task Runner**: Jalankan `npm test` atau `npm run build` dan lihat hasilnya langsung di editor
- 🌐 **Info Dependensi & Cache Offline**: Hover pada dependensi di package.json untuk melihat deskripsi
- 💡 **Aksi Kode Cerdas**: Workflow efisien untuk menyalin dan membagikan kode
- 🛠 **Zero-Config Philosophy**: Install dan langsung gunakan dengan konfigurasi minimal

## 📋 Prasyarat

Pastikan sistem Termux Anda memiliki paket-paket berikut:

```bash
# Update sistem
pkg update && pkg upgrade

# Install Node.js (LTS direkomendasikan)
pkg install nodejs

# Install Git
pkg install git

# Install Termux API (PENTING untuk fitur unggulan!)
pkg install termux-api

# Install Neovim (v0.8+)
pkg install neovim
```

**Penting**: Pastikan aplikasi [Termux:API](https://f-droid.org/packages/com.termux.api/) terinstall di Android Anda dan telah dijalankan sekali untuk mengaktifkan integrasi.

## 🔧 Instalasi

### Instalasi Global (Direkomendasikan)

```bash
npm install -g volt-lsp
```

### Instalasi dari Source

```bash
# Clone repository
git clone https://github.com/volt-lsp/volt-lsp.git
cd volt-lsp

# Install dependencies
npm install

# Link secara global
npm link
```

## ⚙️ Konfigurasi Neovim

Tambahkan konfigurasi berikut ke file `~/.config/nvim/init.lua`:

```lua
-- Konfigurasi Volt LSP
local lspconfig = require('lspconfig')

-- Setup Volt LSP
lspconfig.volt_lsp = {
    default_config = {
        cmd = { 'volt-lsp' },
        filetypes = { 'typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'json' },
        root_dir = lspconfig.util.root_pattern('package.json', 'tsconfig.json', '.git'),
        single_file_support = true,
    },
}

-- Auto-start untuk file yang didukung
vim.api.nvim_create_autocmd('FileType', {
    pattern = { 'typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'json' },
    callback = function()
        lspconfig.volt_lsp.launch()
    end
})

-- Keymaps (opsional tapi direkomendasikan)
vim.keymap.set('n', '<space>ca', vim.lsp.buf.code_action, { desc = 'Code Actions' })
vim.keymap.set('n', 'K', vim.lsp.buf.hover, { desc = 'Hover Info' })
vim.keymap.set('n', 'gd', vim.lsp.buf.definition, { desc = 'Go to Definition' })
```

## 🎯 Panduan Penggunaan

### 1. Inline Task Runner

Jalankan tugas npm langsung dari dalam editor:

```vim
:LspExecuteCommand volt-lsp:runTest
:LspExecuteCommand volt-lsp:runBuild
```

**Hasil error akan muncul sebagai diagnostic di editor Anda!**

### 2. Aksi Kode Cerdas

1. Seleksi kode dalam mode Visual
2. Tekan `<space>ca` (atau keymap code action Anda)
3. Pilih `[Volt] Copy to Android Clipboard` atau `[Volt] Share Code Snippet`
4. Kode akan disalin/dibagikan melalui Termux-API

### 3. Info Dependensi Offline

1. Buka `package.json`
2. Hover cursor pada nama dependensi 
3. Info paket akan muncul dengan deskripsi, versi, dan detail lainnya
4. Bekerja offline setelah cache terbangun!

### 4. Notifikasi Termux

Volt LSP akan mengirim notifikasi Android untuk:
- Task completion/failure
- Error diagnostics
- Status updates

## 🔧 Perintah yang Tersedia

| Perintah | Deskripsi |
|----------|-----------|
| `volt-lsp:runTest` | Menjalankan test suite proyek |
| `volt-lsp:runBuild` | Menjalankan build/compile |
| `volt-lsp:copyToClipboard` | Salin kode terpilih ke clipboard Android |
| `volt-lsp:shareCode` | Bagikan kode melalui aplikasi Android |
| `volt-lsp:clearCache` | Bersihkan cache dependensi |

## 📁 Struktur Proyek

```
volt-lsp/
├── package.json                 # Package configuration
├── bin/
│   └── volt-lsp                 # Executable script
├── src/
│   ├── lsp-connection.js        # LSP protocol handler
│   ├── tsserver-proxy.js        # TypeScript server proxy
│   ├── termux-api-manager.js    # Termux API integration
│   ├── task-runner.js           # Inline task execution
│   ├── dependency-info-provider.js # Package info provider
│   └── logger.js                # Logging system
├── index.js                     # Main server entry point
└── README.md                    # Documentation
```

## 🛠 Konfigurasi Environment

Volt LSP mendukung konfigurasi melalui environment variables:

```bash
# Log level (error, warn, info, debug)
export VOLT_LSP_LOG_LEVEL=info

# Log file path (opsional)
export VOLT_LSP_LOG_FILE="/data/data/com.termux/files/home/.volt-lsp.log"

# Disable colors in console output
export VOLT_LSP_NO_COLORS=1
```

## 🧪 Testing

```bash
# Run tests
npm test

# Run with development mode
npm run dev
```

## 📊 Performance

Volt LSP dioptimalkan untuk lingkungan terbatas:

- **Memory Usage**: ~50MB (vs ~200MB untuk LSP standar)
- **Startup Time**: <2 detik
- **Battery Impact**: Minimal dengan sleep mode otomatis

## 🔍 Troubleshooting

### LSP tidak bisa connect
```bash
# Cek apakah volt-lsp tersedia
which volt-lsp

# Test manual
volt-lsp --help
```

### Termux-API tidak berfungsi
```bash
# Cek instalasi termux-api
pkg list-installed | grep termux-api

# Test API
termux-notification --title "Test" --content "Working"
```

### TypeScript server error
```bash
# Install/update TypeScript
npm install -g typescript

# Cek tsserver
which tsserver
```

### Cache issues
```bash
# Clear cache manual
rm ~/.volt-lsp-cache.json

# Atau via LSP command
:LspExecuteCommand volt-lsp:clearCache
```

## 🗺️ Roadmap

### ✅ v0.2.x (Current Release)
- ✅ Fondasi LSP yang stabil
- ✅ Inline Task Runner (Jest & tsc parser)
- ✅ Aksi Kode (Salin & Bagikan)
- ✅ Info Dependensi dengan Cache Offline
- ✅ Notifikasi Diagnostik via Termux-API

### 🎯 v0.3.x (Next: Expansion & Stability)
- 🔄 Dukungan parser untuk test runner lain (Vitest, Mocha)
- 🔄 Peningkatan logika parsing error
- 🔄 Perintah kustom tambahan
- 🔄 Optimasi performa lebih lanjut

### 🚀 v0.4.x (Future: Advanced Features)
- 🔮 Fitur refactoring dasar
- 🔮 Integrasi git untuk info blame
- 🔮 Pengaturan yang dapat dikustomisasi

### 🌌 Visi Jangka Panjang
- 🔮 Dukungan bahasa lain (Python, Go, Rust)
- 🔮 Menjadi standar de-facto untuk development mobile

## 🤝 Contributing

Kontribusi sangat diterima! Silakan:

1. Fork repository ini
2. Buat feature branch (`git checkout -b feature/amazing-feature`)
3. Commit perubahan (`git commit -m 'Add amazing feature'`)
4. Push ke branch (`git push origin feature/amazing-feature`)
5. Buat Pull Request

## 📝 License

Proyek ini dilisensikan di bawah [MIT License](LICENSE).

## 🙏 Acknowledgments

- Tim TypeScript untuk tsserver yang luar biasa
- Komunitas Termux untuk platform yang menakjubkan
- Kontributor LSP specification

## 📞 Support

- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/volt-lsp/volt-lsp/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/volt-lsp/volt-lsp/discussions)
- 📧 **Email**: volt-lsp@example.com

---

**Dibuat dengan ❤️ untuk komunitas developer mobile**

> "Performa bukan kemewahan, tapi hak setiap developer" - Volt LSP Team
