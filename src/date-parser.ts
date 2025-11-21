/**
 * Natural language date parsing utility
 * Converts phrases like "tomorrow", "next Monday", "in 3 days" to ISO 8601 datetime strings
 */

/**
 * Parse natural language date expressions into ISO 8601 datetime strings
 * 
 * Supported formats:
 * - "today" / "tonight"
 * - "tomorrow"
 * - "next Monday" / "next week" / "next month"
 * - "in 3 days" / "in 2 weeks" / "in 1 month"
 * - "Monday" / "Tuesday" (next occurrence)
 * - ISO 8601 strings (passed through)
 * 
 * @param input - Natural language date expression
 * @param referenceDate - Reference date for calculations (defaults to now)
 * @returns ISO 8601 datetime string
 * @throws Error if the date expression cannot be parsed or is in the past
 */
export function parseNaturalDate(input: string, referenceDate: Date = new Date()): string {
  const normalized = input.toLowerCase().trim();
  
  // If it's already an ISO 8601 string, validate and return it
  if (isISO8601(input)) {
    const date = new Date(input);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date format');
    }
    
    // Validate it's not in the past
    if (date < referenceDate) {
      throw new Error('Cannot schedule tasks in the past. Please choose a future date.');
    }
    
    return date.toISOString();
  }
  
  let targetDate: Date;
  
  // Handle "today" / "tonight"
  if (normalized === 'today' || normalized === 'tonight') {
    targetDate = new Date(referenceDate);
    if (normalized === 'tonight') {
      targetDate.setUTCHours(20, 0, 0, 0); // 8 PM UTC
    } else {
      targetDate.setUTCHours(12, 0, 0, 0); // Noon UTC
    }
  }
  // Handle "tomorrow"
  else if (normalized === 'tomorrow') {
    targetDate = new Date(referenceDate);
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
    targetDate.setUTCHours(12, 0, 0, 0); // Noon UTC
  }
  // Handle "next week"
  else if (normalized === 'next week') {
    targetDate = new Date(referenceDate);
    targetDate.setUTCDate(targetDate.getUTCDate() + 7);
    targetDate.setUTCHours(12, 0, 0, 0);
  }
  // Handle "next month"
  else if (normalized === 'next month') {
    targetDate = new Date(referenceDate);
    targetDate.setUTCMonth(targetDate.getUTCMonth() + 1);
    targetDate.setUTCHours(12, 0, 0, 0);
  }
  // Handle "in X days/weeks/months"
  else if (normalized.match(/^in \d+ (day|days|week|weeks|month|months)$/)) {
    targetDate = parseRelativeDate(normalized, referenceDate);
  }
  // Handle "next [weekday]" (e.g., "next Monday")
  else if (normalized.match(/^next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/)) {
    const weekday = normalized.replace('next ', '');
    targetDate = getNextWeekday(weekday, referenceDate, true);
  }
  // Handle weekday names (e.g., "Monday" means next Monday)
  else if (isWeekdayName(normalized)) {
    targetDate = getNextWeekday(normalized, referenceDate, false);
  }
  // Handle "this [weekday]"
  else if (normalized.match(/^this (monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/)) {
    const weekday = normalized.replace('this ', '');
    targetDate = getNextWeekday(weekday, referenceDate, false);
  }
  else {
    throw new Error(
      `I couldn't understand the date "${input}". Try phrases like "tomorrow", "next Monday", "in 3 days", or a specific date.`
    );
  }
  
  // Validate the parsed date is not in the past
  if (targetDate < referenceDate) {
    throw new Error('Cannot schedule tasks in the past. Please choose a future date.');
  }
  
  return targetDate.toISOString();
}

/**
 * Check if a string is in ISO 8601 format
 */
function isISO8601(str: string): boolean {
  // Basic ISO 8601 pattern check
  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;
  return iso8601Pattern.test(str);
}

/**
 * Parse relative date expressions like "in 3 days", "in 2 weeks"
 */
function parseRelativeDate(input: string, referenceDate: Date): Date {
  const match = input.match(/^in (\d+) (day|days|week|weeks|month|months)$/);
  
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid relative date format: ${input}`);
  }
  
  const amount = parseInt(match[1], 10);
  const unit = match[2];
  
  const targetDate = new Date(referenceDate);
  targetDate.setUTCHours(12, 0, 0, 0); // Set to noon UTC
  
  if (unit === 'day' || unit === 'days') {
    targetDate.setUTCDate(targetDate.getUTCDate() + amount);
  } else if (unit === 'week' || unit === 'weeks') {
    targetDate.setUTCDate(targetDate.getUTCDate() + amount * 7);
  } else if (unit === 'month' || unit === 'months') {
    targetDate.setUTCMonth(targetDate.getUTCMonth() + amount);
  }
  
  return targetDate;
}

/**
 * Check if a string is a weekday name
 */
function isWeekdayName(str: string): boolean {
  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  return weekdays.includes(str.toLowerCase());
}

/**
 * Get the next occurrence of a specific weekday
 * 
 * @param weekday - Name of the weekday (e.g., "monday")
 * @param referenceDate - Reference date
 * @param forceNext - If true, always get next week's occurrence even if today is that weekday
 * @returns Date object for the next occurrence
 */
function getNextWeekday(weekday: string, referenceDate: Date, forceNext: boolean): Date {
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDayIndex = weekdays.indexOf(weekday.toLowerCase());
  
  if (targetDayIndex === -1) {
    throw new Error(`Invalid weekday: ${weekday}`);
  }
  
  const currentDayIndex = referenceDate.getUTCDay();
  const targetDate = new Date(referenceDate);
  targetDate.setUTCHours(12, 0, 0, 0); // Set to noon UTC
  
  let daysUntilTarget = targetDayIndex - currentDayIndex;
  
  // If the target day is today or in the past this week, move to next week
  if (daysUntilTarget <= 0 || forceNext) {
    daysUntilTarget += 7;
  }
  
  targetDate.setUTCDate(targetDate.getUTCDate() + daysUntilTarget);
  
  return targetDate;
}

/**
 * Format a date for user-friendly display
 * Used for error messages and confirmations
 */
export function formatDateForDisplay(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Check if it's today
  if (date.toDateString() === now.toDateString()) {
    return 'today';
  }
  
  // Check if it's tomorrow
  if (date.toDateString() === tomorrow.toDateString()) {
    return 'tomorrow';
  }
  
  // Format as readable date
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  };
  
  return date.toLocaleDateString('en-US', options);
}
