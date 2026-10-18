// GalloFront: a self-hosted page without any account/matchmaking API.
// Read straight from BOOTSTRAP_CONFIG (not through ClientEnv) so that tests
// which mock ClientEnv with a partial object keep working, and so callers
// that run before ClientEnv is hydrated get a plain false.
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.BOOTSTRAP_CONFIG?.standalone === true;
}
