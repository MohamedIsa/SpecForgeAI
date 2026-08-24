import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { rawTrpcClient } from "../trpc";
import type { RouterOutputs } from "../trpc";
import {
  registerAccessTokenRefresher,
  setAccessToken,
  clearAccessToken,
  getValidAccessToken,
  type AccessTokenState,
} from "./access-token-store";

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
}

export interface AuthSession {
  user: AuthUser;
}

type SignInResult = RouterOutputs["auth"]["login"];

interface AuthContextValue {
  session: AuthSession | null;
  isHydrating: boolean;
  setSession: (result: SignInResult) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function silentRefresh(): Promise<SignInResult | null> {
  try {
    return await rawTrpcClient.auth.refreshSession.mutate();
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [session, setSessionState] = useState<AuthSession | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);

  // Called by access-token-store whenever the in-memory access token is
  // missing/expired and a request is about to be made — this is what makes
  // token refresh "silent": no visible logout, just a fresh token underneath.
  const refresh = useCallback(async (): Promise<AccessTokenState | null> => {
    const result = await silentRefresh();
    if (!result) {
      clearAccessToken();
      setSessionState(null);
      return null;
    }
    setSessionState({ user: result.user });
    return {
      token: result.accessToken,
      expiresAt: Date.now() + result.expiresInSeconds * 1000,
    };
  }, []);

  useEffect(() => {
    registerAccessTokenRefresher(refresh);
    let cancelled = false;
    // On mount there is no in-memory access token (it never persists across
    // reloads by design), so this immediately triggers `refresh()` above,
    // which attempts to hydrate the session from the httpOnly refresh cookie.
    void getValidAccessToken().finally(() => {
      if (!cancelled) setIsHydrating(false);
    });
    return () => {
      cancelled = true;
      registerAccessTokenRefresher(null);
    };
  }, [refresh]);

  const setSession = useCallback((result: SignInResult) => {
    setAccessToken(result.accessToken, result.expiresInSeconds);
    setSessionState({ user: result.user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await rawTrpcClient.auth.logout.mutate();
    } catch {
      // Best-effort: even if the server call fails (network error, already
      // expired session, etc.), the local session must still be cleared.
    } finally {
      clearAccessToken();
      setSessionState(null);
    }
  }, []);

  const value = useMemo(
    () => ({ session, isHydrating, setSession, logout }),
    [session, isHydrating, setSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
