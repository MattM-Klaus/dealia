# Changelog

## [1.5.0] - 2026-04-17

### Added
- Comprehensive testing infrastructure with Vitest
- 187 integration and unit tests for database and import layers
- Test database helper for in-memory SQLite testing
- CSV import tests (48 tests, 98.96% coverage)
- Commission import tests (22 tests for Xactly and Tableau reconciliation)
- Database CRUD tests (19 tests)
- Cross-platform test script for Node.js/Bun compatibility

### Fixed
- 34 TypeScript strict mode errors across backend and frontend
- Type definitions in global.d.ts for window.api
- Missing properties in forecast and commission import types
- Type guards for date range union types in Analytics
- UPSERT logic in commission import functions

### Changed
- Upgraded to TypeScript 5.x with strict mode enabled
- Improved type safety across codebase
- CI/CD pipeline updated with test coverage reporting

### Infrastructure
- GitHub Actions CI with automated testing
- Vitest configuration with Node.js runtime support
- Test coverage thresholds and reporting
