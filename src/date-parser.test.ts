import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseNaturalDate, formatDateForDisplay } from './date-parser.js';

describe('parseNaturalDate', () => {
  // Use a fixed reference date for consistent testing
  const referenceDate = new Date('2024-01-15T10:00:00Z'); // Monday, January 15, 2024

  it('should parse "today" correctly', () => {
    const result = parseNaturalDate('today', referenceDate);
    const parsed = new Date(result);
    
    assert.strictEqual(parsed.getUTCFullYear(), 2024);
    assert.strictEqual(parsed.getUTCMonth(), 0); // January
    assert.strictEqual(parsed.getUTCDate(), 15);
    assert.strictEqual(parsed.getUTCHours(), 12); // Noon
  });

  it('should parse "tomorrow" correctly', () => {
    const result = parseNaturalDate('tomorrow', referenceDate);
    const parsed = new Date(result);
    
    assert.strictEqual(parsed.getUTCFullYear(), 2024);
    assert.strictEqual(parsed.getUTCMonth(), 0);
    assert.strictEqual(parsed.getUTCDate(), 16);
    assert.strictEqual(parsed.getUTCHours(), 12);
  });

  it('should parse "in 3 days" correctly', () => {
    const result = parseNaturalDate('in 3 days', referenceDate);
    const parsed = new Date(result);
    
    assert.strictEqual(parsed.getUTCFullYear(), 2024);
    assert.strictEqual(parsed.getUTCMonth(), 0);
    assert.strictEqual(parsed.getUTCDate(), 18);
  });

  it('should parse "in 2 weeks" correctly', () => {
    const result = parseNaturalDate('in 2 weeks', referenceDate);
    const parsed = new Date(result);
    
    assert.strictEqual(parsed.getUTCFullYear(), 2024);
    assert.strictEqual(parsed.getUTCMonth(), 0);
    assert.strictEqual(parsed.getUTCDate(), 29);
  });

  it('should parse "next Monday" correctly', () => {
    const result = parseNaturalDate('next Monday', referenceDate);
    const parsed = new Date(result);
    
    // Next Monday from Jan 15 (Monday) should be Jan 22
    assert.strictEqual(parsed.getUTCFullYear(), 2024);
    assert.strictEqual(parsed.getUTCMonth(), 0);
    assert.strictEqual(parsed.getUTCDate(), 22);
  });

  it('should parse "Friday" correctly', () => {
    const result = parseNaturalDate('Friday', referenceDate);
    const parsed = new Date(result);
    
    // Next Friday from Jan 15 (Monday) should be Jan 19
    assert.strictEqual(parsed.getUTCFullYear(), 2024);
    assert.strictEqual(parsed.getUTCMonth(), 0);
    assert.strictEqual(parsed.getUTCDate(), 19);
  });

  it('should pass through valid ISO 8601 dates', () => {
    const isoDate = '2024-12-25T10:00:00Z';
    const result = parseNaturalDate(isoDate, referenceDate);
    
    assert.strictEqual(result, new Date(isoDate).toISOString());
  });

  it('should throw error for past dates', () => {
    const pastDate = '2024-01-10T10:00:00Z';
    
    assert.throws(
      () => parseNaturalDate(pastDate, referenceDate),
      /Cannot schedule tasks in the past/
    );
  });

  it('should throw error for invalid date expressions', () => {
    assert.throws(
      () => parseNaturalDate('invalid date', referenceDate),
      /I couldn't understand the date/
    );
  });

  it('should handle case-insensitive input', () => {
    const result1 = parseNaturalDate('TOMORROW', referenceDate);
    const result2 = parseNaturalDate('Tomorrow', referenceDate);
    const result3 = parseNaturalDate('tomorrow', referenceDate);
    
    assert.strictEqual(result1, result2);
    assert.strictEqual(result2, result3);
  });
});

describe('formatDateForDisplay', () => {
  it('should format today as "today"', () => {
    const now = new Date();
    assert.strictEqual(formatDateForDisplay(now), 'today');
  });

  it('should format tomorrow as "tomorrow"', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.strictEqual(formatDateForDisplay(tomorrow), 'tomorrow');
  });

  it('should format other dates with weekday and month', () => {
    const date = new Date('2024-12-25T10:00:00Z');
    const formatted = formatDateForDisplay(date);
    
    assert.ok(formatted.includes('December'));
    assert.ok(formatted.includes('25'));
  });
});
