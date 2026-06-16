import type { AisForecast } from './types';
import { AIS_FORECAST_OPTIONS } from './types';

// Maps raw Salesforce product strings to normalized display names.
// Raw values vary between CSV exports (e.g. 'ultimate_ar', 'zendesk_ar' both mean 'AI Agents').
export function normalizeProduct(raw: string): string {
  switch (raw.toLowerCase()) {
    case 'ultimate_ar':
    case 'ultimate':
    case 'zendesk_ar':
      return 'AI Agents';
    case 'ai_expert':
      return 'AI Expert';
    case 'wem':
      return 'WEM';
    default:
      return raw;
  }
}

// Maps any forecast string (including prefixed like "2 - Most Likely") to an AIS category.
export function mapForecast(raw: string | null | undefined): AisForecast | null {
  if (!raw?.trim()) return null;
  const lower = raw.toLowerCase();
  for (const opt of AIS_FORECAST_OPTIONS) {
    if (lower.includes(opt.toLowerCase())) return opt;
  }
  if (lower.includes('remaining')) return 'Remaining Pipe';
  return null;
}

// Maps stage name to base win rate for weighted pipe calculation
export function getStageWinRate(stage: string | null | undefined): number {
  if (!stage?.trim()) return 0;
  const lower = stage.toLowerCase();

  if (lower.includes('qualify need')) return 0.0;
  if (lower.includes('confirm need')) return 0.10;
  if (lower.includes('establish value')) return 0.15;
  if (lower.includes('demonstrate value')) return 0.30;
  if (lower.includes('secure commitment')) return 0.40;
  if (lower.includes('contracting')) return 0.70;
  if (lower.includes('signed') || lower.includes('closed')) return 1.0;

  return 0; // Default to 0% for unknown stages
}

// Calculate weighted pipe value for an opportunity
export function calculateWeightedPipe(arr: number, stage: string | null | undefined): number {
  return arr * getStageWinRate(stage);
}

// Fiscal year starts Feb 1; FY number = calendar year + 1 (except Jan which stays in same FY)
// e.g. Apr 16 2026 → 2027Q1, Nov 1 2026 → 2027Q4, Jan 15 2027 → 2027Q4, Feb 1 2027 → 2028Q1
export function toCloseQuarter(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const month = d.getMonth() + 1; // 1-12
  const year = d.getFullYear();

  let fiscalYear: number;
  let quarter: number;

  if (month === 1) {
    fiscalYear = year;
    quarter = 4;
  } else if (month <= 4) {
    fiscalYear = year + 1;
    quarter = 1;
  } else if (month <= 7) {
    fiscalYear = year + 1;
    quarter = 2;
  } else if (month <= 10) {
    fiscalYear = year + 1;
    quarter = 3;
  } else {
    fiscalYear = year + 1;
    quarter = 4;
  }

  return `${fiscalYear}Q${quarter}`;
}

// Get the Monday (start of week) for a given date
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? -6 : 1 - day; // Move to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Get all Monday-Friday week ranges for a fiscal quarter
// Returns array of { start: Date, end: Date, label: string }
export function getQuarterWeeks(quarter: string): Array<{ start: Date; end: Date; label: string }> {
  const match = quarter.match(/(\d{4})Q(\d)/);
  if (!match) return [];

  const fiscalYear = parseInt(match[1]);
  const q = parseInt(match[2]);

  // Determine quarter start and end dates
  let qStart: Date, qEnd: Date;
  const calendarYear = fiscalYear - 1;

  if (q === 1) {
    qStart = new Date(calendarYear, 1, 1); // Feb 1
    qEnd = new Date(calendarYear, 3, 30); // Apr 30
  } else if (q === 2) {
    qStart = new Date(calendarYear, 4, 1); // May 1
    qEnd = new Date(calendarYear, 6, 31); // Jul 31
  } else if (q === 3) {
    qStart = new Date(calendarYear, 7, 1); // Aug 1
    qEnd = new Date(calendarYear, 9, 31); // Oct 31
  } else {
    qStart = new Date(calendarYear, 10, 1); // Nov 1
    qEnd = new Date(fiscalYear, 0, 31); // Jan 31 (next calendar year)
  }

  const weeks: Array<{ start: Date; end: Date; label: string }> = [];
  const current = getWeekStart(qStart);

  while (current <= qEnd) {
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 6); // Sunday night (covers Mon-Sun)
    weekEnd.setHours(23, 59, 59, 999); // End of Sunday

    // Only include weeks that overlap with the quarter
    if (weekEnd >= qStart) {
      const label = `Week of ${current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      weeks.push({ start: new Date(current), end: new Date(weekEnd), label });
    }

    current.setDate(current.getDate() + 7); // Next Monday
  }

  return weeks;
}

// Format a date range as "Mar 10-14, 2026"
export function formatWeekRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth();
  const month = start.toLocaleDateString('en-US', { month: 'short' });
  const startDay = start.getDate();
  const endDay = end.getDate();
  const year = start.getFullYear();

  if (sameMonth) {
    return `${month} ${startDay}-${endDay}, ${year}`;
  } else {
    const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
    return `${month} ${startDay} - ${endMonth} ${endDay}, ${year}`;
  }
}
