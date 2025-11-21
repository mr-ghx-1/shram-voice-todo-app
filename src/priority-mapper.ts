/**
 * Priority keyword mapping utilities for natural language priority handling
 * 
 * This module provides functions to convert between priority keywords (e.g., "high", "urgent")
 * and numeric values (1-5) for task management.
 */

/**
 * Priority mapping definition
 */
interface PriorityMapping {
  keywords: string[];
  value: number;
  label: string;
}

/**
 * Priority mappings with keyword arrays for each level
 * 1 = Low, 2 = Normal, 3 = High, 4 = Urgent, 5 = Critical
 */
export const PRIORITY_MAPPINGS: PriorityMapping[] = [
  { keywords: ['low', 'minor', 'optional'], value: 1, label: 'Low' },
  { keywords: ['normal', 'medium', 'standard', 'regular'], value: 2, label: 'Normal' },
  { keywords: ['high', 'important', 'elevated'], value: 3, label: 'High' },
  { keywords: ['urgent', 'pressing', 'time-sensitive', 'time sensitive'], value: 4, label: 'Urgent' },
  { keywords: ['critical', 'severe', 'blocking', 'emergency'], value: 5, label: 'Critical' },
];

/**
 * Convert priority keyword or number to numeric value (1-5)
 * 
 * @param input - Priority keyword (e.g., "high", "urgent") or numeric value
 * @returns Numeric priority value (1-5) or null if invalid
 * 
 * @example
 * parsePriority("high") // returns 3
 * parsePriority("urgent") // returns 4
 * parsePriority(2) // returns 2
 * parsePriority("5") // returns 5
 * parsePriority("invalid") // returns null
 */
export function parsePriority(input: string | number | null | undefined): number | null {
  // Handle null/undefined
  if (input === null || input === undefined) {
    return null;
  }

  // If already a number, validate and return
  if (typeof input === 'number') {
    return input >= 1 && input <= 5 ? input : null;
  }

  // Normalize input string
  const normalized = input.toLowerCase().trim();

  // Check if it's a numeric string
  const numericValue = parseInt(normalized, 10);
  if (!isNaN(numericValue) && numericValue >= 1 && numericValue <= 5) {
    return numericValue;
  }

  // Match against keywords
  for (const mapping of PRIORITY_MAPPINGS) {
    if (mapping.keywords.some(keyword => normalized.includes(keyword))) {
      return mapping.value;
    }
  }

  return null;
}

/**
 * Convert priority numeric value to keyword label for TTS responses
 * 
 * @param value - Numeric priority value (1-5)
 * @returns Priority keyword label (e.g., "High", "Urgent") or fallback string
 * 
 * @example
 * formatPriority(1) // returns "Low"
 * formatPriority(3) // returns "High"
 * formatPriority(5) // returns "Critical"
 * formatPriority(99) // returns "Priority 99"
 */
export function formatPriority(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const mapping = PRIORITY_MAPPINGS.find(m => m.value === value);
  return mapping?.label || `Priority ${value}`;
}
