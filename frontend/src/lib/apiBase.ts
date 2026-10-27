/** Resolve the API base URL for the frontend.
 * When VITE_API_URL is unset (the default), the frontend keeps its
 * current behaviour: relative /api/v1/... calls, which a dev proxy or
 * a same-origin deployment can serve. When it is set, it is used as
 * the prefix (trailing slashes stripped) so a future live API host
 * can be pointed to without a code change. No host is set here. */
export function resolveApiBase(envValue: string | undefined): string {
  if (!envValue) return '';
  return envValue.replace(/\/+$/, '');
}
