import "server-only";
import { rateLimit } from "@/lib/rate-limit";
import type { AuthorizeDeps } from "./authorize";
import type { ConsentDeps } from "./consent";
import { oauthConfig } from "./config";
import { loadCimdClient } from "./cimd";
import { resolveClient } from "./clients";
import { defaultOauthStore } from "./store-supabase";

/**
 * The real dependencies of the authorize and consent routes: the secret-key store, the one rate
 * limiter, the clock and the deployment's own addresses (never a request header).
 */

const limit = (key: string, max: number, windowSeconds: number) =>
  rateLimit(key, max, windowSeconds);

export function authorizeDeps(clientKey: string): AuthorizeDeps {
  const config = oauthConfig();
  const store = defaultOauthStore();
  const now = Date.now;
  return {
    store,
    limit,
    now,
    issuer: config.issuer,
    resource: config.resource,
    resolveClient: (clientId) =>
      resolveClient(clientId, {
        store,
        now,
        loadCimdClient: (id) => loadCimdClient(id, clientKey),
      }),
  };
}

export function consentDeps(): ConsentDeps {
  const config = oauthConfig();
  return {
    store: defaultOauthStore(),
    limit,
    now: Date.now,
    appOrigin: config.appOrigin,
    issuer: config.issuer,
  };
}
