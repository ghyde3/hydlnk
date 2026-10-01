import type { NextConfig } from "next";

// Host routing lives in src/proxy.ts (local dev hosts need no allowedDevOrigins in Next.js 16).
//
// The www -> root redirect is declared here as well, and runs before the proxy does. The reason is
// local development: when the app is self-hosted (`next dev`, `next start`), Next.js rewrites any
// redirect that points at its own origin into a relative Location header. Redirecting
// www.localhost:3000 to localhost:3000 from the proxy would therefore answer "Location: /" and loop
// forever. A redirect declared in config keeps its absolute Location. The proxy keeps its own www
// branch as a fallback; on Vercel the platform redirects www before the app is reached.
const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim().toLowerCase() ?? "";
const rootHostname = rootDomain.split(":")[0] ?? "";
const isLocal = rootHostname === "localhost" || rootHostname.endsWith(".localhost");

const nextConfig: NextConfig = {
  async redirects() {
    if (!rootDomain) return [];
    return [
      {
        source: "/:path*",
        // The value is a regular expression and Next.js compares it with the hostname, port removed.
        has: [{ type: "host", value: `www\\.${rootHostname.replaceAll(".", "\\.")}` }],
        destination: `${isLocal ? "http" : "https"}://${rootDomain}/:path*`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
