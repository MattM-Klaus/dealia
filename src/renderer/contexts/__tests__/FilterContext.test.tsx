// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  FILTER_STORAGE_KEY,
  FilterProvider,
  deserializeFilters,
  getDefaultFilters,
  serializeFilters,
  useFilters,
  type AllFilters,
} from '../FilterContext';

beforeEach(() => {
  sessionStorage.clear();
});

describe('FilterContext default shape', () => {
  it('exposes one default slice per page (11 total)', () => {
    const defaults = getDefaultFilters();
    expect(Object.keys(defaults).sort()).toEqual(
      [
        'accounts',
        'analyticsChanges',
        'analyticsForecast',
        'analyticsOverview',
        'closedLost',
        'closedWon',
        'commissionReconciliation',
        'dashboard',
        'forecastDashboard',
        'pipeline',
        'weeklyTrends',
      ].sort(),
    );
  });

  it('initializes Set-typed slices as real Set instances', () => {
    const defaults = getDefaultFilters();
    expect(defaults.weeklyTrends.selectedManagers).toBeInstanceOf(Set);
    expect(defaults.commissionReconciliation.filterIssueTypes).toBeInstanceOf(Set);
    expect(defaults.commissionReconciliation.filterInvestigations).toBeInstanceOf(Set);
    expect(defaults.pipeline.managerFilter).toBeInstanceOf(Set);
  });

  it('seeds CommissionReconciliation issue/investigation filters with the expected defaults', () => {
    const defaults = getDefaultFilters();
    expect([...defaults.commissionReconciliation.filterIssueTypes].sort()).toEqual(
      ['arr_mismatch', 'match', 'missing_in_xactly'],
    );
    expect([...defaults.commissionReconciliation.filterInvestigations].sort()).toEqual(
      [
        'Send to Commish Team',
        'Xactly Correct - OTD',
        'Xactly Correct - Other',
        'Xactly Correct - Renewal',
        'not_investigated',
      ].sort(),
    );
  });

  it('starts WeeklyTrends with selectedWeekIndex null so the page falls back to the current week', () => {
    expect(getDefaultFilters().weeklyTrends.selectedWeekIndex).toBeNull();
  });
});

describe('serializeFilters / deserializeFilters', () => {
  it('round-trips Set instances through JSON', () => {
    const defaults = getDefaultFilters();
    const populated: AllFilters = {
      ...defaults,
      pipeline: {
        ...defaults.pipeline,
        managerFilter: new Set(['Alice', 'Bob']),
        quarterFilter: new Set(['2026-Q1']),
      },
      weeklyTrends: {
        ...defaults.weeklyTrends,
        selectedWeekIndex: 3,
        selectedRegion: 'LATAM',
        selectedManagers: new Set(['Carol']),
        expandedSection: 'closedWon',
      },
      commissionReconciliation: {
        ...defaults.commissionReconciliation,
        selectedPeriod: '2026-04',
        sortColumn: 'variance',
        sortDirection: 'desc',
        filterIssueTypes: new Set(['arr_mismatch']),
        filterInvestigations: new Set(['Send to Commish Team']),
      },
      closedLost: {
        searchQuery: 'acme',
        managerFilter: 'Alice',
        quarterFilter: '2026-Q2',
        monthFilter: 'Apr 2026',
        aiAeFilter: 'AI-AE',
      },
      accounts: { search: 'globex' },
    };

    const json = serializeFilters(populated);
    const decoded = deserializeFilters(json);

    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.pipeline.managerFilter).toBeInstanceOf(Set);
    expect([...decoded.pipeline.managerFilter].sort()).toEqual(['Alice', 'Bob']);
    expect(decoded.weeklyTrends.selectedManagers).toBeInstanceOf(Set);
    expect([...decoded.weeklyTrends.selectedManagers]).toEqual(['Carol']);
    expect(decoded.commissionReconciliation.filterIssueTypes).toBeInstanceOf(Set);
    expect([...decoded.commissionReconciliation.filterIssueTypes]).toEqual(['arr_mismatch']);
    expect(decoded.weeklyTrends.selectedWeekIndex).toBe(3);
    expect(decoded.weeklyTrends.expandedSection).toBe('closedWon');
    expect(decoded.closedLost).toEqual(populated.closedLost);
    expect(decoded.accounts).toEqual(populated.accounts);
  });

  it('returns null for invalid JSON instead of throwing', () => {
    expect(deserializeFilters('not-json')).toBeNull();
  });
});

describe('FilterProvider rehydration', () => {
  function Probe() {
    const { filters, updateClosedLostFilters, updateAccountsFilters, updateWeeklyTrendsFilters } =
      useFilters();
    return (
      <div>
        <span data-testid="closed-lost-search">{filters.closedLost.searchQuery}</span>
        <span data-testid="accounts-search">{filters.accounts.search}</span>
        <span data-testid="weekly-region">{filters.weeklyTrends.selectedRegion}</span>
        <span data-testid="weekly-managers">
          {[...filters.weeklyTrends.selectedManagers].join(',')}
        </span>
        <button
          type="button"
          data-testid="set-closed-lost"
          onClick={() => updateClosedLostFilters({ searchQuery: 'acme corp' })}
        >
          set closed-lost search
        </button>
        <button
          type="button"
          data-testid="set-accounts"
          onClick={() => updateAccountsFilters({ search: 'globex' })}
        >
          set accounts search
        </button>
        <button
          type="button"
          data-testid="set-weekly"
          onClick={() =>
            updateWeeklyTrendsFilters({
              selectedRegion: 'LATAM',
              selectedManagers: new Set(['Carol', 'Dan']),
            })
          }
        >
          set weekly trends
        </button>
      </div>
    );
  }

  it('persists newly-added slices through unmount + remount via sessionStorage', () => {
    const first = render(
      <FilterProvider>
        <Probe />
      </FilterProvider>,
    );

    act(() => {
      screen.getByTestId('set-closed-lost').click();
      screen.getByTestId('set-accounts').click();
      screen.getByTestId('set-weekly').click();
    });

    expect(screen.getByTestId('closed-lost-search')).toHaveTextContent('acme corp');
    expect(screen.getByTestId('accounts-search')).toHaveTextContent('globex');
    expect(screen.getByTestId('weekly-region')).toHaveTextContent('LATAM');
    expect(screen.getByTestId('weekly-managers')).toHaveTextContent('Carol,Dan');

    // sessionStorage must contain the serialized state at this point.
    const stored = sessionStorage.getItem(FILTER_STORAGE_KEY);
    expect(stored).not.toBeNull();

    first.unmount();

    // Fresh provider mount should rehydrate every slice (including the Set).
    render(
      <FilterProvider>
        <Probe />
      </FilterProvider>,
    );

    expect(screen.getByTestId('closed-lost-search')).toHaveTextContent('acme corp');
    expect(screen.getByTestId('accounts-search')).toHaveTextContent('globex');
    expect(screen.getByTestId('weekly-region')).toHaveTextContent('LATAM');
    expect(screen.getByTestId('weekly-managers')).toHaveTextContent('Carol,Dan');
  });
});
