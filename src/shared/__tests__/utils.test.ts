import { describe, it, expect } from 'vitest';
import {
  normalizeProduct,
  mapForecast,
  getStageWinRate,
  calculateWeightedPipe,
  toCloseQuarter,
  getWeekStart,
  getQuarterWeeks,
  formatWeekRange,
} from '../utils';

describe('normalizeProduct', () => {
  it('should normalize ultimate_ar to AI Agents', () => {
    // Arrange
    const input = 'ultimate_ar';

    // Act
    const result = normalizeProduct(input);

    // Assert
    expect(result).toBe('AI Agents');
  });

  it('should normalize ultimate to AI Agents', () => {
    // Arrange
    const input = 'ultimate';

    // Act
    const result = normalizeProduct(input);

    // Assert
    expect(result).toBe('AI Agents');
  });

  it('should normalize zendesk_ar to AI Agents', () => {
    // Arrange
    const input = 'zendesk_ar';

    // Act
    const result = normalizeProduct(input);

    // Assert
    expect(result).toBe('AI Agents');
  });

  it('should normalize ULTIMATE_AR (uppercase) to AI Agents', () => {
    // Arrange
    const input = 'ULTIMATE_AR';

    // Act
    const result = normalizeProduct(input);

    // Assert
    expect(result).toBe('AI Agents');
  });

  it('should normalize ai_expert to AI Expert', () => {
    // Arrange
    const input = 'ai_expert';

    // Act
    const result = normalizeProduct(input);

    // Assert
    expect(result).toBe('AI Expert');
  });

  it('should normalize wem to WEM', () => {
    // Arrange
    const input = 'wem';

    // Act
    const result = normalizeProduct(input);

    // Assert
    expect(result).toBe('WEM');
  });

  it('should normalize WEM (uppercase) to WEM', () => {
    // Arrange
    const input = 'WEM';

    // Act
    const result = normalizeProduct(input);

    // Assert
    expect(result).toBe('WEM');
  });

  it('should return original string for unknown product', () => {
    // Arrange
    const input = 'unknown_product';

    // Act
    const result = normalizeProduct(input);

    // Assert
    expect(result).toBe('unknown_product');
  });

  it('should return empty string when given empty string', () => {
    // Arrange
    const input = '';

    // Act
    const result = normalizeProduct(input);

    // Assert
    expect(result).toBe('');
  });
});

describe('mapForecast', () => {
  it('should map "Commit" to Commit', () => {
    // Arrange
    const input = 'Commit';

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBe('Commit');
  });

  it('should map "Best Case" to Best Case', () => {
    // Arrange
    const input = 'Best Case';

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBe('Best Case');
  });

  it('should map "Most Likely" to Most Likely', () => {
    // Arrange
    const input = 'Most Likely';

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBe('Most Likely');
  });

  it('should map "Remaining Pipe" to Remaining Pipe', () => {
    // Arrange
    const input = 'Remaining Pipe';

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBe('Remaining Pipe');
  });

  it('should map prefixed forecast "2 - Most Likely" to Most Likely', () => {
    // Arrange
    const input = '2 - Most Likely';

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBe('Most Likely');
  });

  it('should map lowercase "commit" to Commit', () => {
    // Arrange
    const input = 'commit';

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBe('Commit');
  });

  it('should map "remaining" to Remaining Pipe', () => {
    // Arrange
    const input = 'remaining';

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBe('Remaining Pipe');
  });

  it('should return null for null input', () => {
    // Arrange
    const input = null;

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBeNull();
  });

  it('should return null for undefined input', () => {
    // Arrange
    const input = undefined;

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    // Arrange
    const input = '';

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBeNull();
  });

  it('should return null for whitespace-only string', () => {
    // Arrange
    const input = '   ';

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBeNull();
  });

  it('should return null for unknown forecast category', () => {
    // Arrange
    const input = 'Unknown Category';

    // Act
    const result = mapForecast(input);

    // Assert
    expect(result).toBeNull();
  });
});

describe('getStageWinRate', () => {
  it('should return 0.0 for qualify need stage', () => {
    // Arrange
    const input = 'Qualify Need';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0.0);
  });

  it('should return 0.10 for confirm need stage', () => {
    // Arrange
    const input = 'Confirm Need';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0.10);
  });

  it('should return 0.15 for establish value stage', () => {
    // Arrange
    const input = 'Establish Value';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0.15);
  });

  it('should return 0.30 for demonstrate value stage', () => {
    // Arrange
    const input = 'Demonstrate Value';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0.30);
  });

  it('should return 0.40 for secure commitment stage', () => {
    // Arrange
    const input = 'Secure Commitment';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0.40);
  });

  it('should return 0.70 for contracting stage', () => {
    // Arrange
    const input = 'Contracting';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0.70);
  });

  it('should return 1.0 for signed stage', () => {
    // Arrange
    const input = 'Signed';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(1.0);
  });

  it('should return 1.0 for closed stage', () => {
    // Arrange
    const input = 'Closed Won';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(1.0);
  });

  it('should handle case-insensitive stage names', () => {
    // Arrange
    const input = 'CONTRACTING';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0.70);
  });

  it('should return 0 for null stage', () => {
    // Arrange
    const input = null;

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0);
  });

  it('should return 0 for undefined stage', () => {
    // Arrange
    const input = undefined;

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0);
  });

  it('should return 0 for empty string', () => {
    // Arrange
    const input = '';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0);
  });

  it('should return 0 for whitespace-only string', () => {
    // Arrange
    const input = '   ';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0);
  });

  it('should return 0 for unknown stage', () => {
    // Arrange
    const input = 'Unknown Stage';

    // Act
    const result = getStageWinRate(input);

    // Assert
    expect(result).toBe(0);
  });
});

describe('calculateWeightedPipe', () => {
  it('should calculate weighted pipe for contracting stage', () => {
    // Arrange
    const arr = 100000;
    const stage = 'Contracting';

    // Act
    const result = calculateWeightedPipe(arr, stage);

    // Assert
    expect(result).toBe(70000);
  });

  it('should calculate weighted pipe for qualify need stage', () => {
    // Arrange
    const arr = 50000;
    const stage = 'Qualify Need';

    // Act
    const result = calculateWeightedPipe(arr, stage);

    // Assert
    expect(result).toBe(0);
  });

  it('should calculate weighted pipe for signed stage', () => {
    // Arrange
    const arr = 200000;
    const stage = 'Signed';

    // Act
    const result = calculateWeightedPipe(arr, stage);

    // Assert
    expect(result).toBe(200000);
  });

  it('should return 0 for null stage', () => {
    // Arrange
    const arr = 100000;
    const stage = null;

    // Act
    const result = calculateWeightedPipe(arr, stage);

    // Assert
    expect(result).toBe(0);
  });

  it('should return 0 for unknown stage', () => {
    // Arrange
    const arr = 100000;
    const stage = 'Unknown';

    // Act
    const result = calculateWeightedPipe(arr, stage);

    // Assert
    expect(result).toBe(0);
  });

  it('should handle zero ARR', () => {
    // Arrange
    const arr = 0;
    const stage = 'Contracting';

    // Act
    const result = calculateWeightedPipe(arr, stage);

    // Assert
    expect(result).toBe(0);
  });

  it('should handle negative ARR', () => {
    // Arrange
    const arr = -50000;
    const stage = 'Contracting';

    // Act
    const result = calculateWeightedPipe(arr, stage);

    // Assert
    expect(result).toBe(-35000);
  });
});

describe('toCloseQuarter', () => {
  it('should return 2027Q1 for Feb 1 2026', () => {
    // Arrange
    const input = '2026-02-01';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('2027Q1');
  });

  it('should return 2027Q1 for Apr 16 2026', () => {
    // Arrange
    const input = '2026-04-16';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('2027Q1');
  });

  it('should return 2027Q2 for May 1 2026', () => {
    // Arrange
    const input = '2026-05-01';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('2027Q2');
  });

  it('should return 2027Q2 for Jul 31 2026', () => {
    // Arrange
    const input = '2026-07-31';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('2027Q2');
  });

  it('should return 2027Q3 for Aug 1 2026', () => {
    // Arrange
    const input = '2026-08-01';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('2027Q3');
  });

  it('should return 2027Q3 for Oct 31 2026', () => {
    // Arrange
    const input = '2026-10-31';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('2027Q3');
  });

  it('should return 2027Q4 for Nov 1 2026', () => {
    // Arrange
    const input = '2026-11-01';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('2027Q4');
  });

  it('should return 2027Q4 for Jan 15 2027', () => {
    // Arrange
    const input = '2027-01-15';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('2027Q4');
  });

  it('should return 2028Q1 for Feb 1 2027', () => {
    // Arrange
    const input = '2027-02-01';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('2028Q1');
  });

  it('should return empty string for null input', () => {
    // Arrange
    const input = null;

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('');
  });

  it('should return empty string for undefined input', () => {
    // Arrange
    const input = undefined;

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('');
  });

  it('should return empty string for invalid date', () => {
    // Arrange
    const input = 'invalid-date';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('');
  });

  it('should return empty string for empty string', () => {
    // Arrange
    const input = '';

    // Act
    const result = toCloseQuarter(input);

    // Assert
    expect(result).toBe('');
  });
});

describe('getWeekStart', () => {
  it('should return Monday for a Tuesday date', () => {
    // Arrange
    const input = new Date(2026, 3, 7); // Tuesday, April 7, 2026

    // Act
    const result = getWeekStart(input);

    // Assert
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(6); // April 6 is Monday
  });

  it('should return Monday for a Monday date', () => {
    // Arrange
    const input = new Date(2026, 3, 6); // Monday, April 6, 2026

    // Act
    const result = getWeekStart(input);

    // Assert
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(6); // Same day
  });

  it('should return Monday for a Sunday date', () => {
    // Arrange
    const input = new Date(2026, 3, 12); // Sunday, April 12, 2026

    // Act
    const result = getWeekStart(input);

    // Assert
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(6); // Previous Monday
  });

  it('should return Monday for a Friday date', () => {
    // Arrange
    const input = new Date(2026, 3, 10); // Friday, April 10, 2026

    // Act
    const result = getWeekStart(input);

    // Assert
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(6); // April 6 is Monday
  });

  it('should reset time to midnight', () => {
    // Arrange
    const input = new Date(2026, 3, 7, 15, 30, 45);

    // Act
    const result = getWeekStart(input);

    // Assert
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });
});

describe('getQuarterWeeks', () => {
  it('should return weeks for 2027Q1', () => {
    // Arrange
    const input = '2027Q1';

    // Act
    const result = getQuarterWeeks(input);

    // Assert
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('start');
    expect(result[0]).toHaveProperty('end');
    expect(result[0]).toHaveProperty('label');
  });

  it('should return weeks for 2027Q2', () => {
    // Arrange
    const input = '2027Q2';

    // Act
    const result = getQuarterWeeks(input);

    // Assert
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return weeks for 2027Q3', () => {
    // Arrange
    const input = '2027Q3';

    // Act
    const result = getQuarterWeeks(input);

    // Assert
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return weeks for 2027Q4', () => {
    // Arrange
    const input = '2027Q4';

    // Act
    const result = getQuarterWeeks(input);

    // Assert
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return empty array for invalid quarter format', () => {
    // Arrange
    const input = 'invalid';

    // Act
    const result = getQuarterWeeks(input);

    // Assert
    expect(result).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    // Arrange
    const input = '';

    // Act
    const result = getQuarterWeeks(input);

    // Assert
    expect(result).toEqual([]);
  });

  it('should have Monday as start day for all weeks', () => {
    // Arrange
    const input = '2027Q1';

    // Act
    const result = getQuarterWeeks(input);

    // Assert
    result.forEach(week => {
      expect(week.start.getDay()).toBe(1); // Monday
    });
  });

  it('should have Sunday as end day for all weeks', () => {
    // Arrange
    const input = '2027Q1';

    // Act
    const result = getQuarterWeeks(input);

    // Assert
    result.forEach(week => {
      expect(week.end.getDay()).toBe(0); // Sunday
    });
  });

  it('should have label starting with "Week of"', () => {
    // Arrange
    const input = '2027Q1';

    // Act
    const result = getQuarterWeeks(input);

    // Assert
    result.forEach(week => {
      expect(week.label).toMatch(/^Week of /);
    });
  });
});

describe('formatWeekRange', () => {
  it('should format range within same month', () => {
    // Arrange
    const start = new Date(2026, 2, 10); // March 10, 2026
    const end = new Date(2026, 2, 14); // March 14, 2026

    // Act
    const result = formatWeekRange(start, end);

    // Assert
    expect(result).toBe('Mar 10-14, 2026');
  });

  it('should format range across different months', () => {
    // Arrange
    const start = new Date(2026, 2, 30); // March 30, 2026
    const end = new Date(2026, 3, 5); // April 5, 2026

    // Act
    const result = formatWeekRange(start, end);

    // Assert
    expect(result).toBe('Mar 30 - Apr 5, 2026');
  });

  it('should format range at start of month', () => {
    // Arrange
    const start = new Date(2026, 3, 1); // April 1, 2026
    const end = new Date(2026, 3, 5); // April 5, 2026

    // Act
    const result = formatWeekRange(start, end);

    // Assert
    expect(result).toBe('Apr 1-5, 2026');
  });

  it('should format range at end of month', () => {
    // Arrange
    const start = new Date(2026, 3, 26); // April 26, 2026
    const end = new Date(2026, 3, 30); // April 30, 2026

    // Act
    const result = formatWeekRange(start, end);

    // Assert
    expect(result).toBe('Apr 26-30, 2026');
  });

  it('should format range across December and January', () => {
    // Arrange
    const start = new Date(2026, 11, 28); // December 28, 2026
    const end = new Date(2027, 0, 3); // January 3, 2027

    // Act
    const result = formatWeekRange(start, end);

    // Assert
    expect(result).toBe('Dec 28 - Jan 3, 2026');
  });
});
