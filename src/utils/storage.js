/**
 * Utility functions for safe interactions with localStorage.
 * Handles JSON parsing/stringifying, quota limits, and private-browsing fallbacks.
 */

const STORAGE_PREFIX = 'cinemate_';

/**
 * Get item from localStorage with fallback value.
 * @template T
 * @param {string} key
 * @param {T} fallbackValue
 * @returns {T}
 */
export function getStorageItem(key, fallbackValue) {
  try {
    const rawValue = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (rawValue === null) {
      return fallbackValue;
    }
    return JSON.parse(rawValue);
  } catch (error) {
    console.warn(`[storage] Error reading key "${key}" from localStorage:`, error);
    return fallbackValue;
  }
}

/**
 * Save item into localStorage.
 * @param {string} key
 * @param {any} value
 * @returns {boolean} True if write succeeded, false otherwise.
 */
export function setStorageItem(key, value) {
  try {
    const serialized = JSON.stringify(value);
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, serialized);
    return true;
  } catch (error) {
    console.error(`[storage] Error writing key "${key}" to localStorage:`, error);
    return false;
  }
}

/**
 * Remove an item from localStorage.
 * @param {string} key
 */
export function removeStorageItem(key) {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch (error) {
    console.warn(`[storage] Error removing key "${key}" from localStorage:`, error);
  }
}
