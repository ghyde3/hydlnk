import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { addPage, cleanupUsers, desktopOnly, rand, signedInUser } from "../fixtures/data";
import { appRaw, authCookies, cookieHeader } from "../fixtures/http";
import { failVercelStub, removalCalls, vercelIds } from "../fixtures/vercel-stub";
import { url } from "../helpers";

/**
 * The Vercel steps of M4-19 (delete a page) and M4-34 (delete the account): every custom domain is
 * taken off the hosting project through the Vercel API before the page or the user goes, and a
 * failure there aborts the whole delete with everything intact. The API here is the local stub
 * (tests/e2e/fixtures/vercel-stub-server.ts, started by playwright.config.ts) that the dev server
 * reaches through VERCEL_API_BASE_URL; the token, project and team ids are placeholders.
 *
 * Both flows are data flows, not layout (those are tests/e2e/m4/limits-pages.spec.ts and
 * billing-delete.spec.ts), so each runs on one project. The stub is shared by every worker, so an
 * injected failure names one hostname of its own (never a pattern other specs' domains would match)
 * and fires once.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 150_000 });

const hostname = (label: string) => `zq-${label}-${rand(6)}.example.test`;

async function addDomains(pageId: string, hosts: string[]): Promise<void> {
  const { error } = await adminClient()
    .from("domains")
    .insert(hosts.map((host) => ({ page_id: pageId, hostname: host })));
  if (error) throw new Error(`seeding domains failed: ${error.message}`);
}

async function domainRows(pageId: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .from("domains")
    .select("hostname")
    .eq("page_id", pageId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.hostname as string).sort();
}

async function pageExists(pageId: string): Promise<boolean> {
  const { data, error } = await adminClient().from("pages").select("id").eq("id", pageId);
  if (error) throw new Error(error.message);
  return (data ?? []).length === 1;
}

async function deletePage(context: BrowserContext, pageId: string, confirm: string) {
  const res = await appRaw(`/api/pages/${pageId}`, {
    method: "DELETE",
    cookie: cookieHeader(await authCookies(context)),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm }),
  });
  return { status: res.status, json: JSON.parse(res.body) as Record<string, unknown> };
}

/** Every removal for these hosts carries the placeholder token as a Bearer and the team id. */
async function expectRemoved(hosts: string[]): Promise<void> {
  const { team } = vercelIds();
  for (const host of hosts) {
    const calls = await removalCalls(host);
    expect(calls.length, `a removal request for ${host}`).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      expect(call.hasBearer, `${host} sent a bearer token`).toBe(true);
      expect(call.query.teamId, `${host} names the team`).toBe(team);
    }
  }
}

test.describe("M4-19 deleting a page removes its custom domains through the Vercel stub first", () => {
  test("M4-19 each domain is removed, a stub failure aborts with the page and domain rows intact, and the retry deletes", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const owner = await signedInUser(context, { label: "vd", plan: "studio" });
    const second = await addPage(owner.userId, `zq-vd2-${rand(5)}`);
    const secondHandle = (
      await adminClient().from("pages").select("handle").eq("id", second).single()
    ).data!.handle as string;
    const hosts = [hostname("vd-a"), hostname("vd-b")];
    await addDomains(second, hosts);

    // The second domain cannot be removed: the whole delete aborts and says so.
    await failVercelStub(hosts[1]!, 500, 1);
    const refused = await deletePage(context, second, secondHandle);
    expect(refused.status).toBe(502);
    expect(refused.json).toMatchObject({
      error: "domain_removal_failed",
      message: "Couldn’t remove its custom domain. Try again.",
    });
    expect(await pageExists(second)).toBe(true);
    expect(await domainRows(second)).toEqual([...hosts].sort());
    // The page is still live-able: it was not touched.
    expect(await pageExists(owner.pageId)).toBe(true);

    // The stub recovers: the retry removes every domain (the one already removed counts as done)
    // and then the page; its domain rows go with it.
    const done = await deletePage(context, second, secondHandle);
    expect(done.status).toBe(200);
    expect(await pageExists(second)).toBe(false);
    expect(await domainRows(second)).toEqual([]);
    await expectRemoved(hosts);
    // Never for the page that stayed.
    expect(await pageExists(owner.pageId)).toBe(true);
  });
});

const settings = () => url("app", "/settings");
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Delete your account?" });
const DOMAIN_MESSAGE = "We couldn’t remove your custom domain. Try again.";

async function userExists(id: string): Promise<boolean> {
  return (await adminClient().auth.admin.getUserById(id)).data.user !== null;
}

test.describe("M4-34 deleting the account removes its custom domains through the Vercel stub", () => {
  test("M4-34 a stub failure deletes nothing and the dialog says so; the retry removes the domains and the user", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await signedInUser(context, { label: "va", plan: "studio" });
    const hosts = [hostname("va-a"), hostname("va-b")];
    await addDomains(user.pageId, hosts);

    await failVercelStub(hosts[0]!, 500, 1);
    await page.goto(settings());
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = dialogOf(page);
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(DOMAIN_MESSAGE);
    await expect(page).toHaveURL(settings());

    // Intact: the user, the page and its domain rows.
    expect(await userExists(user.userId)).toBe(true);
    expect(await pageExists(user.pageId)).toBe(true);
    expect(await domainRows(user.pageId)).toEqual([...hosts].sort());

    // The stub recovers: the same dialog finishes the job.
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);
    expect(await userExists(user.userId)).toBe(false);
    expect(await domainRows(user.pageId)).toEqual([]);
    await expectRemoved(hosts);
  });

  test("M4-34 a wrong confirmation is refused before any Vercel call", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await signedInUser(context, { label: "vw", plan: "studio" });
    const host = hostname("vw");
    await addDomains(user.pageId, [host]);

    await page.goto(settings());
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = dialogOf(page);
    // The button stays disabled until the typed handle matches, so nothing is sent from the UI.
    await dialog.getByLabel("Type your handle to confirm").fill(`${user.handle}-nope`);
    await expect(dialog.getByRole("button", { name: "Delete account" })).toBeDisabled();
    expect(await removalCalls(host)).toEqual([]);
    expect(await userExists(user.userId)).toBe(true);
    expect(await domainRows(user.pageId)).toEqual([host]);
  });
});
