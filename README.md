# Dealia - Deal Tracking & Pipeline Management App

Electron-based desktop application for managing sales deals and pipeline tracking for Zendesk Sales.

## What's New in v1.5.0

### Testing Infrastructure 🧪
- Comprehensive test suite with 187 passing tests
- Vitest testing framework with full TypeScript support
- 98.96% coverage on CSV imports, 100% on utilities
- CI/CD integration with automated testing

### Quality Improvements ✨
- TypeScript 5.x with strict mode enabled
- 34 type errors fixed across the codebase
- Improved type safety for better developer experience
- Cross-platform test compatibility (macOS/Linux CI)

### Developer Experience 🛠️
- In-memory SQLite test database helper
- Comprehensive test coverage for database operations
- UPSERT logic improvements in commission imports

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

## Development

### Running Tests
```bash
npm test                  # Run all tests
npm run test:ui          # Run tests with UI
npm run test:coverage    # Generate coverage report
```

### Test Structure
- Database CRUD tests (19 tests)
- CSV import tests (48 tests, 98.96% coverage)
- Commission import tests (22 tests)
- Shared utilities tests (100% coverage)

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
