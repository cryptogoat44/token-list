/**
 * Résolution du pays d'origine d'une requête.
 *
 * En production, le pays est fourni par l'edge/CDN (Cloudflare, Vercel, etc.)
 * via un en-tête. On NE se fie PAS à une géoloc côté client. Si aucun en-tête
 * fiable n'est présent, le pays est `null` → la conformité refuse par prudence.
 */
import type { IncomingHttpHeaders } from "node:http";

const COUNTRY_HEADERS = [
  "cf-ipcountry", // Cloudflare
  "x-vercel-ip-country", // Vercel
  "x-appengine-country", // Google App Engine
  "x-country", // proxy générique
] as const;

/** Extrait un code pays ISO alpha-2 des en-têtes, ou null. */
export function countryFromHeaders(headers: IncomingHttpHeaders): string | null {
  for (const key of COUNTRY_HEADERS) {
    const v = headers[key];
    const s = Array.isArray(v) ? v[0] : v;
    if (s && /^[A-Za-z]{2}$/.test(s) && s.toUpperCase() !== "XX") {
      return s.toUpperCase();
    }
  }
  return null;
}
