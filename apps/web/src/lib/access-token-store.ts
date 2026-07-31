export interface AccessTokenState {
  token: string;
  expiresAt: number;
}

const REFRESH_SKEW_MS = 30_000;

let current: AccessTokenState | null = null;
let refreshPromise: Promise<AccessTokenState | null> | null = null;
let refresher: (() => Promise<AccessTokenState | null>) | null = null;

function isFresh(state: AccessTokenState | null): state is AccessTokenState {
  return state !== null && Date.now() < state.expiresAt - REFRESH_SKEW_MS;
}

/**
 * Registers the function used to obtain a fresh access token when the
 * in-memory one is missing or near expiry. Set once by AuthProvider so this
 * module never has to import auth-context.tsx directly (which would create a
 * circular import, since auth-context.tsx imports the tRPC client which in
 * turn needs this module to attach the Authorization header).
 */
export function registerAccessTokenRefresher(
  fn: (() => Promise<AccessTokenState | null>) | null,
): void {
  refresher = fn;
}

export function setAccessToken(token: string, expiresInSeconds: number): void {
  current = { token, expiresAt: Date.now() + expiresInSeconds * 1000 };
}

export function clearAccessToken(): void {
  current = null;
}

export function peekAccessToken(): AccessTokenState | null {
  return current;
}

/**
 * Returns a currently-valid access token, transparently refreshing it first
 * via the registered refresher if it is missing, expired, or near expiry.
 * Concurrent callers share a single in-flight refresh so a burst of requests
 * doesn't trigger a burst of refreshSession calls.
 */
export async function getValidAccessToken(): Promise<string | null> {
  if (isFresh(current)) return current.token;
  if (!refresher) return null;

  if (!refreshPromise) {
    const activeRefresher = refresher;
    refreshPromise = activeRefresher().finally(() => {
      refreshPromise = null;
    });
  }
  current = await refreshPromise;
  return current ? current.token : null;
}
