import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize author-supplied HTML before injecting it via
 * `dangerouslySetInnerHTML`. Strips <script>, event-handler attributes,
 * and javascript: URLs while keeping the rich-text markup the contract
 * and document editors emit. Works on both server and client.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
