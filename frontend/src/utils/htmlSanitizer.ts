/**
 * HTML sanitization utilities for XSS prevention
 */

/**
 * Escape HTML special characters to prevent XSS
 *
 * Converts: < > & " ' to their HTML entity equivalents
 *
 * @param text - Text to escape
 * @returns HTML-safe text
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * Sanitize HTML attributes to prevent XSS
 *
 * Escapes quotes and special characters in attribute values
 *
 * @param value - Attribute value to sanitize
 * @returns Sanitized attribute value
 */
export function sanitizeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
