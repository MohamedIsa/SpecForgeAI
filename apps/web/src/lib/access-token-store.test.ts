import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerAccessTokenRefresher,
  setAccessToken,
  clearAccessToken,
  peekAccessToken,
  getValidAccessToken,
} from "./access-token-store";

beforeEach(() => {
  clearAccessToken();
  registerAccessTokenRefresher(null);
});

describe("getValidAccessToken", () => {
  it("returns null when there is no token and no refresher registered", async () => {
    await expect(getValidAccessToken()).resolves.toBeNull();
  });

  it("returns the in-memory token without calling the refresher when it is fresh", async () => {
    setAccessToken("fresh-token", 3600);
    const refresher = vi.fn().mockResolvedValue(null);
    registerAccessTokenRefresher(refresher);

    await expect(getValidAccessToken()).resolves.toBe("fresh-token");
    expect(refresher).not.toHaveBeenCalled();
  });

  it("calls the refresher and returns the new token when the current one is missing", async () => {
    const refresher = vi.fn().mockResolvedValue({
      token: "refreshed-token",
      expiresAt: Date.now() + 3600_000,
    });
    registerAccessTokenRefresher(refresher);

    await expect(getValidAccessToken()).resolves.toBe("refreshed-token");
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(peekAccessToken()?.token).toBe("refreshed-token");
  });

  it("calls the refresher when the token is within the near-expiry skew window", async () => {
    // 10s TTL is inside the 30s refresh skew, so this must be treated as stale.
    setAccessToken("about-to-expire", 10);
    const refresher = vi.fn().mockResolvedValue({
      token: "rotated-token",
      expiresAt: Date.now() + 3600_000,
    });
    registerAccessTokenRefresher(refresher);

    await expect(getValidAccessToken()).resolves.toBe("rotated-token");
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it("returns null and clears the stored token when the refresher fails to produce one", async () => {
    setAccessToken("about-to-expire", 10);
    registerAccessTokenRefresher(vi.fn().mockResolvedValue(null));

    await expect(getValidAccessToken()).resolves.toBeNull();
    expect(peekAccessToken()).toBeNull();
  });

  it("shares a single in-flight refresh across concurrent callers", async () => {
    let resolveRefresh: ((value: { token: string; expiresAt: number }) => void) | undefined;
    const refresher = vi.fn(
      () =>
        new Promise<{ token: string; expiresAt: number }>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    registerAccessTokenRefresher(refresher);

    const first = getValidAccessToken();
    const second = getValidAccessToken();

    expect(refresher).toHaveBeenCalledTimes(1);
    resolveRefresh?.({ token: "shared-token", expiresAt: Date.now() + 3600_000 });

    await expect(first).resolves.toBe("shared-token");
    await expect(second).resolves.toBe("shared-token");
    expect(refresher).toHaveBeenCalledTimes(1);
  });
});

describe("clearAccessToken / peekAccessToken", () => {
  it("removes the stored token", () => {
    setAccessToken("some-token", 3600);
    expect(peekAccessToken()).not.toBeNull();
    clearAccessToken();
    expect(peekAccessToken()).toBeNull();
  });
});
