# AU Archive

Desktop application for archiving and documenting abandoned locations with media management, GPS-based organization, and interactive mapping.

## Quick Start

### Prerequisites

- **Node.js** 20+ LTS (22+ recommended)
- **pnpm** 8+ (10+ recommended)

### Installation

```bash
# Clone the repository
git clone https://github.com/bizzlechizzle/au-archive.git
cd au-archive

# Install dependencies (automatically builds core package)
pnpm install

# Start the development server
pnpm dev
```

### Common Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build for production |
| `pnpm build:core` | Build only the core package |
| `pnpm test` | Run tests |
| `pnpm lint` | Lint code |
| `pnpm format` | Format code with Prettier |
| `pnpm clean` | Remove all node_modules and dist folders |
| `pnpm reinstall` | Clean and reinstall everything |

## Troubleshooting

### "Electron failed to install correctly"

pnpm v10+ blocks native build scripts by default. Clean reinstall:

```bash
pnpm reinstall
```

### "Failed to resolve entry for package @au-archive/core"

The core package needs to be built (postinstall may have failed):

```bash
pnpm build:core
```

### "vite: command not found"

Dependencies not installed:

```bash
pnpm install
```

## Project Structure

```
au-archive/
├── packages/
│   ├── core/           # Shared business logic (framework-agnostic)
│   └── desktop/        # Electron + Svelte application
├── resources/          # Icons and bundled binaries
├── claude.md           # Technical specification
├── techguide.md        # Implementation guide
└── lilbits.md          # Script documentation
```

## Technology Stack

- **Desktop Framework**: Electron 35+
- **Frontend**: Svelte 5 + TypeScript
- **Database**: SQLite (better-sqlite3)
- **Build Tool**: Vite 5+
- **Package Manager**: pnpm (monorepo)
- **Mapping**: Leaflet.js
- **Metadata**: exiftool-vendored, fluent-ffmpeg

## Documentation

- [Technical Specification](claude.md) - Architecture and design decisions
- [Implementation Guide](techguide.md) - Development setup and API docs
- [Script Documentation](lilbits.md) - Per-file documentation

## License

Private - All rights reserved
