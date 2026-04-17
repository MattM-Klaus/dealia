# Phase 2: Database & Import Layer Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Achieve 80% overall test coverage by adding comprehensive integration tests for database and import layers, plus fix TypeScript type errors.

**Architecture:** Build on Phase 1's testing infrastructure to add integration tests for SQLite database operations and data import pipelines. Use in-memory databases for fast, isolated tests. Fix window.api type definitions to resolve TypeScript errors.

**Tech Stack:** Vitest 4.1.4, TypeScript 6.0.3, better-sqlite3 (in-memory), happy-dom, existing import modules

---

## Phase 2 Scope

**Coverage Goal:** 80% overall (currently ~3% from Phase 1 utils tests)

**Key Areas:**
1. Database layer integration tests (database.ts CRUD operations)
2. Import layer tests (CSV, Commission imports)
3. TypeScript type fixes (complete window.api definitions - 42 missing methods)

**Estimated Impact:**
- Database tests: +30% coverage
- Import tests: +30% coverage  
- Utils (Phase 1): 100% (already complete)
- Total: ~80% coverage

---

## Implementation Approach

**Test Strategy:**
- Use in-memory SQLite databases (fast, isolated)
- Create test database helper with production schema
- Follow TDD workflow (test → fail → implement → pass → commit)
- Test both happy paths and edge cases

**TypeScript Strategy:**
- Add missing API method type definitions to preload.ts
- Resolve "Property does not exist on window.api" errors (42 total)
- Keep strict mode enabled
- Document remaining non-critical errors for Phase 3

---

## Execution Plan

**Recommended:** Use **subagent-driven-development** skill for task-by-task execution with reviews between each task.

**Alternative:** Use **executing-plans** skill for batch execution with checkpoints.

---

## Task Breakdown

### Task 1: Setup Test Database Helper
**Estimated:** 10 minutes

Create reusable in-memory SQLite database helper for integration tests.

**Files:**
- Create: `src/main/__tests__/helpers/testDatabase.ts`
- Create: `src/main/__tests__/helpers/testDatabase.test.ts`

**Deliverable:** Test database helper that mimics production schema, resets between tests.

---

### Task 2: Database CRUD Tests
**Estimated:** 20 minutes

Test account CRUD operations (create, read, update, delete).

**Files:**
- Create: `src/main/__tests__/database.test.ts`
- Modify: `src/main/database.ts` (export testable functions)

**Tests:** 15+ tests covering getAllAccounts, getAccountById, createAccount, updateAccount, deleteAccount

---

### Task 3: Fix TypeScript Type Errors
**Estimated:** 15 minutes

Complete window.api type definitions in preload.ts.

**Files:**
- Modify: `src/preload.ts` (add 17 missing API method types)

**Impact:** Resolve 42 TypeScript errors, reduce total from 64 to ~22

**Missing methods:**
- getClosedLostOpps, getSnapshotsBetweenDates, updateClosedWonBookings
- getCommissionPeriods, importTableauCommissions, importXactlyCommissions
- getWeeklyNotes, setWeeklyNotes, resetAisArrToTableau
- And 8 more...

---

### Task 4: CSV Import Tests
**Estimated:** 20 minutes

Test CSV parsing, validation, and import error handling.

**Files:**
- Create: `src/main/__tests__/csv-import.test.ts`
- Modify: `src/main/csv-import.ts` (export testable functions)

**Tests:** 10+ tests covering parseAccountsCsv, importAccountsFromCsv, error cases

---

### Task 5: Commission Import Tests
**Estimated:** 20 minutes

Test commission import from Tableau and Xactly CSV sources.

**Files:**
- Create: `src/main/__tests__/commission-import.test.ts`
- Modify: `src/main/commission-import.ts` (export testable functions)

**Tests:** 15+ tests covering both Tableau and Xactly formats, validation, quarter normalization

---

### Task 6: Verify Coverage Goal
**Estimated:** 5 minutes

Run full test suite and verify 80% coverage achieved.

**Commands:**
- npm test -- --run
- npm run test:coverage -- --run

**Deliverable:** Coverage report showing ~80% overall coverage

---

### Task 7: Create Phase 2 PR
**Estimated:** 10 minutes

Create pull request with comprehensive summary.

**Branch:** feature/phase2-database-import-tests
**PR Title:** feat: Phase 2 Database & Import Layer Testing + TypeScript Fixes

---

## Success Criteria

- [ ] 80% overall test coverage achieved
- [ ] All tests passing (130+ tests total)
- [ ] TypeScript errors reduced from 64 to ~22
- [ ] CI pipeline passes
- [ ] PR created and ready for review

---

## Detailed Implementation Steps

For complete step-by-step implementation with exact code examples, test cases, and commands, the team will use either:

1. **subagent-driven-development** skill (recommended) - Fresh subagent per task with reviews
2. **executing-plans** skill - Batch execution with checkpoints

Each task follows TDD workflow:
- Write failing test
- Run to verify failure
- Implement minimal code
- Run to verify pass
- Commit

---

## Next Steps After Phase 2

**Phase 3 Scope (Future):**
- Snowflake sync integration tests
- Forecast import tests
- Tableau API mocked tests
- Remaining TypeScript type errors (~22)
- Target: 90-95% coverage

