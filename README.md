# Dealia - Deal Tracking & Pipeline Management App

Electron-based desktop application for managing sales deals and pipeline tracking for Zendesk Sales.

## Development Setup

### Prerequisites

- Node.js (v18 or higher)
- npm

### Installation

```bash
npm install
```

### Running in Development

Simply run:

```bash
npm start
```

This will automatically:
1. Start the Vite dev server
2. Wait for it to be ready
3. Launch the Electron app

Both processes run concurrently and will automatically restart when you make changes.

### Building for Production

```bash
npm run package
```

### Making Distributables

```bash
npm run make
```

## Project Structure

- `src/main/` - Main process code (Node.js/Electron)
- `src/renderer/` - Renderer process code (React/TypeScript)
- `src/preload.ts` - Preload script for IPC communication
- `src/shared/` - Shared types and utilities

## Technologies

- **Electron** - Desktop application framework
- **React** - UI framework
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework
- **better-sqlite3** - SQLite database

## License

MIT
