import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@specforge/backend/router";
import { getValidAccessToken } from "./lib/access-token-store";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const trpc = createTRPCReact<AppRouter>();

// The httpOnly refresh cookie must ride along with every request so the
// backend can read it; it never touches JS on either side.
function credentialedFetch(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  return fetch(url, { ...options, credentials: "include" });
}

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/trpc",
      fetch: credentialedFetch,
      headers: async () => {
        const token = await getValidAccessToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

/**
 * A second, header-free client used only for auth.refreshSession / auth.logout.
 * Those procedures authenticate via the httpOnly refresh cookie, not a bearer
 * token, so this client must NOT call getValidAccessToken() itself — doing so
 * would create infinite recursion (getValidAccessToken calling back into a
 * refresher that calls a client which calls getValidAccessToken...).
 */
export const rawTrpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/trpc", fetch: credentialedFetch })],
});
