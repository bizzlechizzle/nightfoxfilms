/**
 * Date Parser Service
 * Smart text recognition for flexible date input
 * Based on archival standards: EDTF, EAD, DACS
 */

import type { DatePrecision } from '@au-archive/core';

// Month names for parsing
const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Parsed date result
export interface ParsedDate {
  precision: DatePrecision;
  dateStart: string | null;
  dateEnd: string | null;
  display: string;
  edtf: string;
  dateSort: number;
  confidence: number; // 0-1 confidence in parsing
}

// Pattern definitions (order matters - most specific first)
interface PatternDef {
  regex: RegExp;
  precision: DatePrecision;
  parse: (match: RegExpMatchArray) => Partial<ParsedDate>;
}

const PATTERNS: PatternDef[] = [
  // ISO date: 2024-03-15
  {
    regex: /^(\d{4})-(\d{2})-(\d{2})$/,
    precision: 'exact',
    parse: (m) => {
      const [, year, month, day] = m;
      const monthNum = parseInt(month);
      const dayNum = parseInt(day);
      return {
        dateStart: `${year}-${month}-${day}`,
        display: `${MONTH_NAMES[monthNum]} ${dayNum}, ${year}`,
        edtf: `${year}-${month}-${day}`,
        dateSort: parseInt(`${year}${month}${day}`),
      };
    },
  },
  // US date: 3/15/2024 or 03/15/2024
  {
    regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    precision: 'exact',
    parse: (m) => {
      const [, month, day, year] = m;
      const mm = month.padStart(2, '0');
      const dd = day.padStart(2, '0');
      const monthNum = parseInt(month);
      const dayNum = parseInt(day);
      return {
        dateStart: `${year}-${mm}-${dd}`,
        display: `${MONTH_NAMES[monthNum]} ${dayNum}, ${year}`,
        edtf: `${year}-${mm}-${dd}`,
        dateSort: parseInt(`${year}${mm}${dd}`),
      };
    },
  },
  // Month Year: March 2024, Mar 2024
  {
    regex: /^([a-z]+)\s+(\d{4})$/i,
    precision: 'month',
    parse: (m) => {
      const [, monthStr, year] = m;
      const monthNum = MONTHS[monthStr.toLowerCase()];
      if (!monthNum) return {};
      const mm = monthNum.toString().padStart(2, '0');
      const monthName = MONTH_NAMES[monthNum];
      return {
        dateStart: `${year}-${mm}`,
        display: `${monthName} ${year}`,
        edtf: `${year}-${mm}`,
        dateSort: parseInt(`${year}${mm}01`),
      };
    },
  },
  // ISO month: 2024-03
  {
    regex: /^(\d{4})-(\d{2})$/,
    precision: 'month',
    parse: (m) => {
      const [, year, month] = m;
      const monthNum = parseInt(month);
      const monthName = MONTH_NAMES[monthNum];
      return {
        dateStart: `${year}-${month}`,
        display: `${monthName} ${year}`,
        edtf: `${year}-${month}`,
        dateSort: parseInt(`${year}${month}01`),
      };
    },
  },
  // Decade: 1920s, the 1920s
  {
    regex: /^(?:the\s+)?(\d{3})0s$/i,
    precision: 'decade',
    parse: (m) => {
      const [, prefix] = m;
      const year = parseInt(`${prefix}0`);
      return {
        dateStart: year.toString(),
        display: `${year}s`,
        edtf: `${prefix}X`,
        dateSort: parseInt(`${year}0101`),
      };
    },
  },
  // Century: 19th century, 20th century
  {
    regex: /^(\d{1,2})(?:st|nd|rd|th)\s+century$/i,
    precision: 'century',
    parse: (m) => {
      const [, centuryNum] = m;
      const century = parseInt(centuryNum);
      const startYear = (century - 1) * 100 + 1;
      const suffix = getSuffix(century);
      return {
        dateStart: century.toString(),
        display: `${centuryNum}${suffix} Century`,
        edtf: `${(century - 1).toString().padStart(2, '0')}XX`,
        dateSort: parseInt(`${startYear}0101`),
      };
    },
  },
  // Circa: ca 1920, circa 1920, ~1920, c. 1920, c 1920
  {
    regex: /^(?:ca\.?|circa|c\.?|~)\s*(\d{4})$/i,
    precision: 'circa',
    parse: (m) => {
      const [, year] = m;
      return {
        dateStart: year,
        display: `ca. ${year}`,
        edtf: `${year}~`,
        dateSort: parseInt(`${year}0101`),
      };
    },
  },
  // Range with dash: 1920-1925, 1920–1925, 1920—1925
  {
    regex: /^(\d{4})\s*[-–—]\s*(\d{4})$/,
    precision: 'range',
    parse: (m) => {
      const [, start, end] = m;
      return {
        dateStart: start,
        dateEnd: end,
        display: `${start}-${end}`,
        edtf: `${start}/${end}`,
        dateSort: parseInt(`${start}0101`),
      };
    },
  },
  // Range with "to": 1920 to 1925
  {
    regex: /^(\d{4})\s+to\s+(\d{4})$/i,
    precision: 'range',
    parse: (m) => {
      const [, start, end] = m;
      return {
        dateStart: start,
        dateEnd: end,
        display: `${start}-${end}`,
        edtf: `${start}/${end}`,
        dateSort: parseInt(`${start}0101`),
      };
    },
  },
  // Before: before 1950
  {
    regex: /^before\s+(\d{4})$/i,
    precision: 'before',
    parse: (m) => {
      const [, year] = m;
      return {
        dateEnd: year,
        display: `before ${year}`,
        edtf: `../${year}`,
        dateSort: parseInt(`${year}0101`),
      };
    },
  },
  // After: after 1945
  {
    regex: /^after\s+(\d{4})$/i,
    precision: 'after',
    parse: (m) => {
      const [, year] = m;
      return {
        dateStart: year,
        display: `after ${year}`,
        edtf: `${year}/..`,
        dateSort: parseInt(`${year}0101`),
      };
    },
  },
  // Early: early 1900s
  {
    regex: /^early\s+(\d{3})0s$/i,
    precision: 'early',
    parse: (m) => {
      const [, prefix] = m;
      const year = parseInt(`${prefix}0`);
      return {
        dateStart: year.toString(),
        display: `early ${year}s`,
        edtf: `${year}~/`, // Approximate start
        dateSort: parseInt(`${year}0101`),
      };
    },
  },
  // Mid: mid-1950s, mid 1950s
  {
    regex: /^mid[-\s]?(\d{3})0s$/i,
    precision: 'mid',
    parse: (m) => {
      const [, prefix] = m;
      const year = parseInt(`${prefix}0`);
      const midYear = year + 3; // Mid starts ~3 years in
      return {
        dateStart: midYear.toString(),
        display: `mid-${year}s`,
        edtf: `${year + 5}~`, // Approximate middle
        dateSort: parseInt(`${midYear}0101`),
      };
    },
  },
  // Late: late 1980s
  {
    regex: /^late\s+(\d{3})0s$/i,
    precision: 'late',
    parse: (m) => {
      const [, prefix] = m;
      const year = parseInt(`${prefix}0`);
      const lateYear = year + 7; // Late starts ~7 years in
      return {
        dateStart: lateYear.toString(),
        display: `late ${year}s`,
        edtf: `${lateYear}~/`, // Approximate late
        dateSort: parseInt(`${lateYear}0101`),
      };
    },
  },
  // Plain year: 1920
  {
    regex: /^(\d{4})$/,
    precision: 'year',
    parse: (m) => {
      const [, year] = m;
      return {
        dateStart: year,
        display: year,
        edtf: year,
        dateSort: parseInt(`${year}0101`),
      };
    },
  },
];

/**
 * Get ordinal suffix for a number
 */
function getSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * Parse a date string into structured date information
 * Auto-detects precision from natural input patterns
 */
export function parseDate(input: string): ParsedDate {
  const trimmed = input.trim();

  // Empty or dash = unknown
  if (!trimmed || trimmed === '—' || trimmed === '-') {
    return {
      precision: 'unknown',
      dateStart: null,
      dateEnd: null,
      display: '—',
      edtf: '',
      dateSort: 99999999,
      confidence: 1,
    };
  }

  // Try each pattern in order
  for (const pattern of PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      const parsed = pattern.parse(match);
      // Ensure all required fields are present
      if (parsed.display) {
        return {
          precision: pattern.precision,
          dateStart: parsed.dateStart ?? null,
          dateEnd: parsed.dateEnd ?? null,
          display: parsed.display,
          edtf: parsed.edtf ?? trimmed,
          dateSort: parsed.dateSort ?? 99999999,
          confidence: 1,
        };
      }
    }
  }

  // No pattern matched - treat as unknown with the raw input as display
  return {
    precision: 'unknown',
    dateStart: null,
    dateEnd: null,
    display: trimmed,
    edtf: '',
    dateSort: 99999999,
    confidence: 0,
  };
}

/**
 * Format a parsed date for display based on precision
 */
export function formatDateDisplay(
  precision: DatePrecision,
  dateStart: string | null,
  dateEnd: string | null
): string {
  switch (precision) {
    case 'unknown':
      return '—';

    case 'exact':
      // ISO 8601 format: YYYY-MM-DD (archival standard)
      return dateStart || '—';

    case 'month':
      // ISO 8601 format: YYYY-MM
      if (dateStart) {
        const parts = dateStart.split('-');
        if (parts.length >= 2) {
          return `${parts[0]}-${parts[1]}`;
        }
      }
      return '—';

    case 'year':
      return dateStart || '—';

    case 'decade':
      return dateStart ? `${dateStart}s` : '—';

    case 'century':
      if (dateStart) {
        const century = parseInt(dateStart);
        const suffix = getSuffix(century);
        return `${century}${suffix} Century`;
      }
      return '—';

    case 'circa':
      return dateStart ? `ca. ${dateStart}` : '—';

    case 'range':
      return dateStart && dateEnd ? `${dateStart}-${dateEnd}` : '—';

    case 'before':
      return dateEnd ? `before ${dateEnd}` : '—';

    case 'after':
      return dateStart ? `after ${dateStart}` : '—';

    case 'early':
      return dateStart ? `early ${dateStart}s` : '—';

    case 'mid':
      if (dateStart) {
        const decade = Math.floor(parseInt(dateStart) / 10) * 10;
        return `mid-${decade}s`;
      }
      return '—';

    case 'late':
      if (dateStart) {
        const decade = Math.floor(parseInt(dateStart) / 10) * 10;
        return `late ${decade}s`;
      }
      return '—';

    default:
      return dateStart || '—';
  }
}

/**
 * Calculate sortable date value (YYYYMMDD format)
 */
export function calculateDateSort(
  precision: DatePrecision,
  dateStart: string | null,
  dateEnd: string | null
): number {
  if (precision === 'unknown' || (!dateStart && !dateEnd)) {
    return 99999999;
  }

  // For 'before' precision, use the end date
  const dateStr = precision === 'before' ? dateEnd : dateStart;
  if (!dateStr) return 99999999;

  // Parse the date string
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    // Full date: YYYY-MM-DD
    return parseInt(dateStr.replace(/-/g, ''));
  } else if (dateStr.match(/^\d{4}-\d{2}$/)) {
    // Month: YYYY-MM
    return parseInt(dateStr.replace(/-/g, '') + '01');
  } else if (dateStr.match(/^\d{4}$/)) {
    // Year: YYYY
    return parseInt(dateStr + '0101');
  } else if (dateStr.match(/^\d{1,2}$/)) {
    // Century number
    const century = parseInt(dateStr);
    const startYear = (century - 1) * 100 + 1;
    return parseInt(`${startYear}0101`);
  }

  return 99999999;
}

/**
 * Convert to EDTF (Extended Date/Time Format) for archival interoperability
 */
export function toEdtf(
  precision: DatePrecision,
  dateStart: string | null,
  dateEnd: string | null
): string {
  switch (precision) {
    case 'unknown':
      return '';
    case 'exact':
    case 'month':
    case 'year':
      return dateStart || '';
    case 'decade':
      return dateStart ? `${dateStart.slice(0, 3)}X` : '';
    case 'century':
      if (dateStart) {
        const century = parseInt(dateStart);
        return `${(century - 1).toString().padStart(2, '0')}XX`;
      }
      return '';
    case 'circa':
      return dateStart ? `${dateStart}~` : '';
    case 'range':
      return dateStart && dateEnd ? `${dateStart}/${dateEnd}` : '';
    case 'before':
      return dateEnd ? `../${dateEnd}` : '';
    case 'after':
      return dateStart ? `${dateStart}/..` : '';
    case 'early':
    case 'mid':
    case 'late':
      return dateStart ? `${dateStart}~` : '';
    default:
      return '';
  }
}

/**
 * Get human-readable description of the precision type
 */
export function getPrecisionDescription(precision: DatePrecision): string {
  const descriptions: Record<DatePrecision, string> = {
    exact: 'Full date known',
    month: 'Month and year known',
    year: 'Year known',
    decade: 'Decade (e.g., 1920s)',
    century: 'Century (e.g., 19th Century)',
    circa: 'Approximate year',
    range: 'Date range',
    before: 'Before a certain year',
    after: 'After a certain year',
    early: 'Early part of decade',
    mid: 'Middle of decade',
    late: 'Late part of decade',
    unknown: 'Date unknown',
  };
  return descriptions[precision];
}
