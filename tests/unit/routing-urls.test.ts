import { describe, expect, it } from "vitest";
import { appOrigin, protocolFor, rootOrigin } from "@/lib/routing/urls";

/** M1-23: every landing link takes its origin from NEXT_PUBLIC_ROOT_DOMAIN, never a hard-coded host. */
describe("origins from the root domain", () => {
  it.each([
    ["hydlnk.com", "https://hydlnk.com", "https://app.hydlnk.com"],
    ["localhost:3000", "http://localhost:3000", "http://app.localhost:3000"],
    ["staging.example.com", "https://staging.example.com", "https://app.staging.example.com"],
  ])("%s", (rootDomain, root, app) => {
    expect(rootOrigin(rootDomain)).toBe(root);
    expect(appOrigin(rootDomain)).toBe(app);
  });

  it("uses plain http only for local development hosts", () => {
    expect(protocolFor("localhost:3000")).toBe("http");
    expect(protocolFor("dev.localhost:3000")).toBe("http");
    expect(protocolFor("hydlnk.com")).toBe("https");
    expect(protocolFor("notlocalhost.com")).toBe("https");
  });
});
