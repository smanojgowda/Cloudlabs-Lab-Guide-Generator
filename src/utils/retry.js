/**
 * Generic retry utility with exponential backoff
 */
import logger from './logger.js';

/**
 * @param {Function} fn - async function to retry
 * @param {object} opts
 * @param {number} opts.retries - max attempts (default 3)
 * @param {number} opts.delayMs - base delay in ms (default 1000)
 * @param {number} opts.factor - backoff multiplier (default 2)
 * @param {string} opts.label - log label
 * @returns {Promise<*>}
 */
export async function retry(fn, { retries = 3, delayMs = 1000, factor = 2, label = 'operation' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const wait = delayMs * Math.pow(factor, attempt - 1);
        logger.warn(`${label} failed (attempt ${attempt}/${retries}): ${err.message}. Retrying in ${wait}ms…`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastError;
}

/**
 * Wait for a condition to become true, polling at interval
 */
export async function waitFor(conditionFn, { timeoutMs = 15000, intervalMs = 500, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await conditionFn();
    if (result) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for ${label} after ${timeoutMs}ms`);
}
