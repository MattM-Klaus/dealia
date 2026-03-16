import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Define filter types for all pages
export interface PipelineFilters {
  searchQuery: string;
  managerFilter: Set<string>;
  quarterFilter: Set<string>;
  productFilter: Set<string>;
  regionFilter: Set<string>;
  vpFcstFilter: Set<string>;
  aisFcstFilter: Set<string>;
  aiAeFilter: Set<string>;
  minOppArr: number;
  topDealOnly: boolean;
}

export interface ClosedWonFilters {
  searchQuery: string;
  managerFilter: string;
  quarterFilter: string;
  aiAeFilter: string;
}

export interface ForecastDashboardFilters {
  quarterFilter: Set<string>;
  regionFilter: Set<string>;
  managerFilter: Set<string>;
  aiAeFilter: Set<string>;
}

export interface DashboardFilters {
  managerFilter: string;
  productFilter: string;
  aiAeFilter: string;
}

export interface AnalyticsOverviewFilters {
  quarterFilter: Set<string>;
  managerFilter: Set<string>;
  aiAeFilter: Set<string>;
  regionFilter: Set<string>;
  segmentFilter: Set<string>;
}

export interface AnalyticsChangesFilters {
  changesTab: 'all' | 'alerts' | 'arr' | 'dates' | 'stages' | 'forecast' | 'new_dropped';
  aiAeFilter: Set<string>;
  managerFilter: Set<string>;
  regionFilter: Set<string>;
  segmentFilter: Set<string>;
  importFilter: string;
  chDatePreset: 'latest' | 'last7' | 'last14' | 'this_month' | 'custom';
  chCustomFrom: string;
  chCustomTo: string;
}

export interface AnalyticsForecastFilters {
  datePreset: 'this_qtr' | 'next_qtr' | 'custom';
  customFrom: string;
  customTo: string;
  regionFilter: Set<string>;
  managerFilter: Set<string>;
  segmentFilter: Set<string>;
  aiAeFilter: Set<string>;
  forecastType: 'ais' | 'vp';
  changesQtrScope: 'this_qtr' | 'next_qtr' | 'all';
  arrFilter: 'all' | '50k_plus';
  newOppFilter: 'all' | '50k_plus';
}

export interface AllFilters {
  pipeline: PipelineFilters;
  closedWon: ClosedWonFilters;
  forecastDashboard: ForecastDashboardFilters;
  dashboard: DashboardFilters;
  analyticsOverview: AnalyticsOverviewFilters;
  analyticsChanges: AnalyticsChangesFilters;
  analyticsForecast: AnalyticsForecastFilters;
}

// Default values (all filters empty/off)
const getDefaultFilters = (): AllFilters => ({
  pipeline: {
    searchQuery: '',
    managerFilter: new Set(),
    quarterFilter: new Set(),
    productFilter: new Set(),
    regionFilter: new Set(),
    vpFcstFilter: new Set(),
    aisFcstFilter: new Set(),
    aiAeFilter: new Set(),
    minOppArr: 0,
    topDealOnly: false,
  },
  closedWon: {
    searchQuery: '',
    managerFilter: '',
    quarterFilter: '',
    aiAeFilter: '',
  },
  forecastDashboard: {
    quarterFilter: new Set(),
    regionFilter: new Set(),
    managerFilter: new Set(),
    aiAeFilter: new Set(),
  },
  dashboard: {
    managerFilter: '',
    productFilter: '',
    aiAeFilter: '',
  },
  analyticsOverview: {
    quarterFilter: new Set(),
    managerFilter: new Set(),
    aiAeFilter: new Set(),
    regionFilter: new Set(),
    segmentFilter: new Set(),
  },
  analyticsChanges: {
    changesTab: 'all',
    aiAeFilter: new Set(),
    managerFilter: new Set(),
    regionFilter: new Set(),
    segmentFilter: new Set(),
    importFilter: '',
    chDatePreset: 'latest',
    chCustomFrom: '',
    chCustomTo: '',
  },
  analyticsForecast: {
    datePreset: 'this_qtr',
    customFrom: '',
    customTo: '',
    regionFilter: new Set(),
    managerFilter: new Set(),
    segmentFilter: new Set(),
    aiAeFilter: new Set(),
    forecastType: 'ais',
    changesQtrScope: 'this_qtr',
    arrFilter: '50k_plus',
    newOppFilter: '50k_plus',
  },
});

// Helper functions for sessionStorage serialization
const serializeFilters = (filters: AllFilters): string => {
  return JSON.stringify(filters, (_key, value) => {
    if (value instanceof Set) {
      return { _type: 'Set', values: Array.from(value) };
    }
    return value;
  });
};

const deserializeFilters = (json: string): AllFilters | null => {
  try {
    return JSON.parse(json, (_key, value) => {
      if (value && value._type === 'Set') {
        return new Set(value.values);
      }
      return value;
    });
  } catch {
    return null;
  }
};

interface FilterContextType {
  filters: AllFilters;
  updatePipelineFilters: (updates: Partial<PipelineFilters>) => void;
  updateClosedWonFilters: (updates: Partial<ClosedWonFilters>) => void;
  updateForecastDashboardFilters: (updates: Partial<ForecastDashboardFilters>) => void;
  updateDashboardFilters: (updates: Partial<DashboardFilters>) => void;
  updateAnalyticsOverviewFilters: (updates: Partial<AnalyticsOverviewFilters>) => void;
  updateAnalyticsChangesFilters: (updates: Partial<AnalyticsChangesFilters>) => void;
  updateAnalyticsForecastFilters: (updates: Partial<AnalyticsForecastFilters>) => void;
  resetAllFilters: () => void;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

const STORAGE_KEY = 'dealia_filters';

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<AllFilters>(() => {
    // Try to load from sessionStorage
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = deserializeFilters(stored);
      if (parsed) {
        return parsed;
      }
    }
    return getDefaultFilters();
  });

  // Save to sessionStorage whenever filters change
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, serializeFilters(filters));
  }, [filters]);

  const updatePipelineFilters = (updates: Partial<PipelineFilters>) => {
    setFilters((prev) => ({
      ...prev,
      pipeline: { ...prev.pipeline, ...updates },
    }));
  };

  const updateClosedWonFilters = (updates: Partial<ClosedWonFilters>) => {
    setFilters((prev) => ({
      ...prev,
      closedWon: { ...prev.closedWon, ...updates },
    }));
  };

  const updateForecastDashboardFilters = (updates: Partial<ForecastDashboardFilters>) => {
    setFilters((prev) => ({
      ...prev,
      forecastDashboard: { ...prev.forecastDashboard, ...updates },
    }));
  };

  const updateDashboardFilters = (updates: Partial<DashboardFilters>) => {
    setFilters((prev) => ({
      ...prev,
      dashboard: { ...prev.dashboard, ...updates },
    }));
  };

  const updateAnalyticsOverviewFilters = (updates: Partial<AnalyticsOverviewFilters>) => {
    setFilters((prev) => ({
      ...prev,
      analyticsOverview: { ...prev.analyticsOverview, ...updates },
    }));
  };

  const updateAnalyticsChangesFilters = (updates: Partial<AnalyticsChangesFilters>) => {
    setFilters((prev) => ({
      ...prev,
      analyticsChanges: { ...prev.analyticsChanges, ...updates },
    }));
  };

  const updateAnalyticsForecastFilters = (updates: Partial<AnalyticsForecastFilters>) => {
    setFilters((prev) => ({
      ...prev,
      analyticsForecast: { ...prev.analyticsForecast, ...updates },
    }));
  };

  const resetAllFilters = () => {
    const defaults = getDefaultFilters();
    setFilters(defaults);
    sessionStorage.setItem(STORAGE_KEY, serializeFilters(defaults));
  };

  return (
    <FilterContext.Provider
      value={{
        filters,
        updatePipelineFilters,
        updateClosedWonFilters,
        updateForecastDashboardFilters,
        updateDashboardFilters,
        updateAnalyticsOverviewFilters,
        updateAnalyticsChangesFilters,
        updateAnalyticsForecastFilters,
        resetAllFilters,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('useFilters must be used within a FilterProvider');
  }
  return context;
}
