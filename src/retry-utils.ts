/**
 * Retry utilities for voice agent API calls
 * Provides exponential backoff and timeout handling
 */

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: Error) => boolean;
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  timeoutMs: 10000,
  backoffMultiplier: 2,
  shouldRetry: (error: Error) => {
    // Retry on network errors, timeouts, and 5xx server errors
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('fetch') ||
      message.includes('econnrefused') ||
      message.includes('status 5')
    );
  },
};

/**
 * Sleep utility for delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  multiplier: number
): number {
  const delay = initialDelay * Math.pow(multiplier, attempt);
  return Math.min(delay, maxDelay);
}

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Retry a function with exponential backoff
 * 
 * @param fn - Async function to retry
 * @param options - Retry configuration options
 * @returns Result of the function
 * @throws Last error if all retries fail
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   async () => fetch('https://api.example.com/data'),
 *   { maxRetries: 3, initialDelayMs: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error;
  let attempt = 0;

  while (attempt <= opts.maxRetries) {
    try {
      console.log(
        `[Retry] Attempt ${attempt + 1}/${opts.maxRetries + 1}${attempt > 0 ? ' (retry)' : ''}`
      );

      // Execute function with timeout
      const result = await withTimeout(fn(), opts.timeoutMs);
      
      if (attempt > 0) {
        console.log(`[Retry] Success after ${attempt} retry(ies)`);
      }
      
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      console.error(`[Retry] Attempt ${attempt + 1} failed:`, lastError.message);

      // Check if we should retry
      if (attempt >= opts.maxRetries) {
        console.error(`[Retry] All ${opts.maxRetries + 1} attempts failed`);
        break;
      }

      // Check if error is retryable
      if (!opts.shouldRetry(lastError)) {
        console.error('[Retry] Error is not retryable, aborting');
        break;
      }

      // Calculate delay and wait
      const delay = calculateDelay(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier
      );
      
      console.log(`[Retry] Waiting ${delay}ms before retry ${attempt + 2}/${opts.maxRetries + 1}`);
      await sleep(delay);

      attempt++;
    }
  }

  // All retries failed
  throw lastError!;
}

/**
 * Format error for user-friendly TTS message
 * 
 * @param error - Error to format
 * @param operation - Operation that failed (e.g., "create task", "fetch tasks")
 * @returns User-friendly error message
 */
export function formatErrorForTTS(error: Error, operation: string): string {
  const message = error.message.toLowerCase();

  // Network/connection errors
  if (message.includes('network') || message.includes('fetch') || message.includes('econnrefused')) {
    return `I couldn't ${operation} due to a network error. Please check your connection and try again.`;
  }

  // Timeout errors
  if (message.includes('timeout')) {
    return `The request to ${operation} timed out. Please try again.`;
  }

  // Server errors (5xx)
  if (message.includes('status 5')) {
    return `The server encountered an error while trying to ${operation}. Please try again in a moment.`;
  }

  // Client errors (4xx)
  if (message.includes('status 4')) {
    // Check for specific 4xx errors
    if (message.includes('404') || message.includes('not found')) {
      return `I couldn't find that task. Please try a different description.`;
    }
    if (message.includes('400') || message.includes('invalid')) {
      return `The request to ${operation} was invalid. Please try rephrasing your command.`;
    }
    return `There was a problem with the request to ${operation}. Please try again.`;
  }

  // Generic error
  return `I couldn't ${operation}. Please try again.`;
}

/**
 * Retry-specific error class
 */
export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(message);
    this.name = 'RetryError';
  }
}
