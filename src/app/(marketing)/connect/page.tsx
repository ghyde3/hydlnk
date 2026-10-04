import type { Metadata } from "next";
import { ConnectorAddress } from "@/components/marketing/connect-address";
import { ANALYTICS_HISTORY, CONNECTOR_ADDRESS } from "@/components/marketing/connect-facts";
import { marketingMetadata } from "@/components/marketing/metadata";
import { ArrowLink, Container, Eyebrow, H1, LEAD } from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { clientEnv } from "@/lib/env/client";
import {
  MCP_ACTIVITY_RETENTION_DAYS,
  MCP_PUBLISH_PER_HOUR,
  MCP_USER_PER_MINUTE,
} from "@/lib/mcp/constants";
import { appOrigin } from "@/lib/routing/urls";

/*
 * Setup steps, as read on 2026-10-04 (M10-34). The labels below are the vendors' own; when one
 * changes, change it here and re-read both pages:
 *
 *   Claude (custom connectors, including Team and Enterprise Owners and the Free plan limit):
 *     https://claude.com/docs/connectors/custom/add-unlisted
 *   Claude Code (`claude mcp add --transport http`, then /mcp and Authenticate):
 *     https://code.claude.com/docs/en/mcp-quickstart
 *   ChatGPT (developer mode, the Plugins page, a public endpoint, the tools menu):
 *     https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
 *
 * The two vendors' pages disagree with each other, and with older write-ups, on some words (Claude
 * says Customize and Connectors, ChatGPT says Plugins), so PROGRESS.md lists the re-check under
 * "Open for Gary". The ChatGPT page makes no claim about which plans can use developer mode, so
 * neither does this page.
 */

export const metadata: Metadata = marketingMetadata({
  path: "/connect",
  title: "Use HYDLNK from Claude or ChatGPT",
  description:
    "Connect HYDLNK to Claude or ChatGPT, then ask the AI to edit your draft, check your numbers or publish. Step-by-step setup, what it can and can’t do, and how to turn it off.",
  image: "features",
});

const SECTIONS = [
  ["what-it-does", "What it does"],
  ["can-do", "What it can do"],
  ["cant-do", "What it can’t do"],
  ["claude", "Connect Claude"],
  ["chatgpt", "Connect ChatGPT"],
  ["privacy", "Your privacy"],
  ["turn-off", "Turn it off"],
  ["good-to-know", "Good to know"],
] as const;

const CLAUDE_CODE_COMMAND = `claude mcp add --transport http hydlnk ${CONNECTOR_ADDRESS}`;

export default function ConnectPage() {
  const settingsHref = `${appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/settings`;

  return (
    <MarketingShell>
      <article aria-labelledby="page-title">
        <header className="border-b border-line bg-surface pt-[clamp(32px,7vw,64px)] pb-[clamp(36px,7vw,64px)]">
          <Container>
            <div className="mx-auto w-full max-w-[70ch]">
              <Eyebrow>Connect</Eyebrow>
              <h1 id="page-title" className={`mt-3 ${H1}`}>
                Use HYDLNK from Claude or ChatGPT
              </h1>
              <p className={`mt-5 ${LEAD}`}>
                Ask an AI app to add a link, reword your bio, switch your theme or check last week’s
                numbers. It works on your draft, and it publishes only when you allow it.
              </p>
              <ConnectorAddress address={CONNECTOR_ADDRESS} />
              <nav aria-label="On this page" className="mt-8">
                <ul className="flex flex-wrap gap-1.5">
                  {SECTIONS.map(([id, label]) => (
                    <li key={id}>
                      <a
                        href={`#${id}`}
                        className="inline-flex min-h-11 items-center rounded-sm border border-line-3 px-3 text-sm hover:border-ink"
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </Container>
        </header>

        <div className="border-b border-line bg-surface py-[clamp(24px,6vw,56px)]">
          <Container>
            <div className="prose-hl mx-auto min-w-0 [&>h2:first-child]:mt-0">
              <h2 id="what-it-does">What it does</h2>
              <p>
                HYDLNK has a connector for AI apps. Connect it once, then ask Claude or ChatGPT to
                work on your page in plain words, the way you would ask a person. For example:
              </p>
              <ul>
                <li>“Add a link to my new podcast episode.”</li>
                <li>“Reword my bio so it sounds friendlier.”</li>
                <li>“Switch my page to a darker theme.”</li>
                <li>“How many clicks did I get last week?”</li>
                <li>“Publish my page.”</li>
              </ul>
              <p>
                The AI works on your draft. Your live page changes only when a publish goes through,
                and publishing is something you allow separately when you connect.
              </p>
              <p>
                The connector uses MCP, short for Model Context Protocol: a standard way for AI apps
                to connect to other apps. It works the same way in every app that supports it.
              </p>

              <h2 id="can-do">What it can do</h2>
              <ul>
                <li>See your pages and your numbers: views, clicks and your top links.</li>
                <li>Edit your profile: your name, your bio and your photo options.</li>
                <li>Add, change, move and remove links and the other blocks on your page.</li>
                <li>Change your theme, by name or one setting at a time.</li>
                <li>Make a private preview link to your draft, good for 7 days.</li>
                <li>List your custom domains and show their status.</li>
                <li>Publish your page, if you allowed publishing when you connected.</li>
              </ul>

              <h2 id="cant-do">What it can’t do</h2>
              <ul>
                <li>Sign in as anyone else, or see other people’s pages.</li>
                <li>Change your plan or your billing.</li>
                <li>Add or remove custom domains.</li>
                <li>Upload new images. It can reuse images that are already on your pages.</li>
                <li>Edit your banner, your share card or your redirect settings.</li>
                <li>Delete anything except a block.</li>
                <li>Publish your page, unless you allowed it.</li>
              </ul>

              <h2 id="claude">Connect Claude</h2>
              <p>
                These are the steps in Claude’s own help pages as of October 2026. You need a HYDLNK
                account, and the sign-in happens on HYDLNK, not in Claude.
              </p>
              <ol>
                <li>
                  <strong>Open the connectors.</strong> In Claude, go to Customize, then Connectors.
                </li>
                <li>
                  <strong>Add a custom connector.</strong> Choose Add custom connector.
                </li>
                <li>
                  <strong>Enter the address.</strong> Paste <code>{CONNECTOR_ADDRESS}</code> as the
                  MCP server URL. If the dialog shows a sign-in choice, leave it on Sign in now. If
                  it shows an OAuth client setting, leave it on Use Claude’s published identity.
                </li>
                <li>
                  <strong>Add it.</strong> Choose Add, then choose Connect next to HYDLNK.
                </li>
                <li>
                  <strong>Sign in and allow.</strong> Sign in to HYDLNK, choose what to allow, and
                  choose Allow. Tick Publish your pages only if you want the AI to publish for you.
                </li>
              </ol>
              <p>
                To switch HYDLNK on or off in a single chat, choose the plus button in the chat,
                then Connectors.
              </p>
              <h3>Good to know about Claude</h3>
              <ul>
                <li>
                  The Add custom connector dialog differs between organizations. If yours shows a
                  name, a URL and Advanced settings on one screen, enter the address as the URL and
                  leave Advanced settings alone.
                </li>
                <li>
                  On Team and Enterprise plans, an Owner adds HYDLNK first, under Organization
                  settings, then Connectors (choose Add, then Custom, then Web). Each person then
                  finds HYDLNK under Customize, then Connectors, and chooses Connect.
                </li>
                <li>Claude’s Free plan allows one custom connector.</li>
              </ul>
              <h3>Claude Code</h3>
              <p>Claude Code has its own command. Run this in your terminal:</p>
              <pre>
                <code>{CLAUDE_CODE_COMMAND}</code>
              </pre>
              <p>
                Then start a session, type /mcp, choose hydlnk and choose Authenticate. Your browser
                opens so you can sign in to HYDLNK and choose what to allow.
              </p>

              <h2 id="chatgpt">Connect ChatGPT</h2>
              <p>
                These are the steps on OpenAI’s help page as of October 2026. ChatGPT’s menus change
                often. If a label differs, look for developer mode or custom connectors in your
                settings. Whether you can add a custom connector depends on your account and your
                workspace.
              </p>
              <ol>
                <li>
                  <strong>Turn on developer mode.</strong> In ChatGPT, open Settings, then Security
                  and login, and turn on Developer mode.
                </li>
                <li>
                  <strong>Start a new connection.</strong> Open the Plugins page and select the plus
                  button.
                </li>
                <li>
                  <strong>Name it.</strong> Give it a name, such as HYDLNK, and a short description.
                </li>
                <li>
                  <strong>Enter the address.</strong> Under Connection, choose a public endpoint and
                  enter <code>{CONNECTOR_ADDRESS}</code>, then create it.
                </li>
                <li>
                  <strong>Use it.</strong> Start a new chat and add HYDLNK from the tools menu. When
                  ChatGPT asks you to sign in to HYDLNK, choose what to allow and select Allow.
                </li>
              </ol>

              <h2 id="privacy">Your privacy</h2>
              <ul>
                <li>
                  The AI app can see what you allow and what you ask it to read: your page drafts,
                  your numbers and your list of custom domains.
                </li>
                <li>
                  HYDLNK keeps a record of each action the app takes: which action, which page,
                  when, and whether it worked. The record never holds your content, and we delete it
                  after {MCP_ACTIVITY_RETENTION_DAYS} days.
                </li>
                <li>
                  The company behind the AI app handles what its app reads, under its own privacy
                  policy.
                </li>
                <li>HYDLNK never sees your chats with the AI.</li>
              </ul>
              <ArrowLink href="/privacy#connected-apps">
                Connected AI apps in the privacy policy
              </ArrowLink>

              <h2 id="turn-off">Turn it off</h2>
              <p>You can end the connection in either place.</p>
              <ul>
                <li>
                  <strong>In HYDLNK:</strong> open Settings &amp; billing, find Connected apps and
                  choose Revoke next to the app. The app loses access at once.
                </li>
                <li>
                  <strong>In the AI app:</strong> remove HYDLNK from Claude or ChatGPT.
                </li>
              </ul>
              <ArrowLink href={settingsHref}>Open Settings &amp; billing</ArrowLink>

              <h2 id="good-to-know">Good to know</h2>
              <ul>
                <li>It works on every plan, Free included.</li>
                <li>
                  To keep things fair, an AI app can make about {MCP_USER_PER_MINUTE} requests a
                  minute for you, and can publish up to {MCP_PUBLISH_PER_HOUR} times an hour.
                </li>
                <li>
                  Analytics follow your plan. Free covers the last {ANALYTICS_HISTORY.free}. Pro and
                  Studio cover up to {ANALYTICS_HISTORY.paid}, with referrers, devices and
                  countries.
                </li>
                <li>
                  Changes the AI makes are saved to your draft straight away, so check the editor.
                  If you edit the same page at the same time, HYDLNK doesn’t overwrite your edit.
                  The AI is told to look again first.
                </li>
                <li>AI apps can make mistakes. Look over what changed before you publish.</li>
              </ul>
              <ArrowLink href="/faq#ai-apps">More questions about AI apps</ArrowLink>
            </div>
          </Container>
        </div>
      </article>
    </MarketingShell>
  );
}
