import { clientEnv } from "@/lib/env/client";
import { ClaimForm } from "../claim-form";
import type { GuideBody } from "./types";

export const choosingAHandle: GuideBody = {
  toc: [
    ["what", "What a handle is"],
    ["rules", "The rules"],
    ["reserved", "Reserved names"],
    ["good", "What makes a good handle"],
    ["try", "Try yours"],
  ],
  content: (
    <>
      <p>
        Your handle is the name people type, tap and remember. It’s worth a minute’s thought before
        you claim it.
      </p>

      <h2 id="what">What a handle is</h2>
      <p>
        A handle is the first part of your page’s address. The handle <code>wrenhaven</code> gives
        you <code>wrenhaven.hydlnk.com</code>. Each handle belongs to one site, so on Pro or Studio,
        where you can have more sites, each site has a handle of its own.
      </p>

      <h2 id="rules">The rules</h2>
      <ul>
        <li>Between 3 and 30 characters.</li>
        <li>
          Lowercase letters <code>a</code>–<code>z</code>, digits <code>0</code>–<code>9</code> and
          hyphens.
        </li>
        <li>It can’t start or end with a hyphen.</li>
        <li>First come, first served: one handle, one owner.</li>
      </ul>
      <p>
        You don’t have to type it perfectly. Capitals become lowercase and anything else is dropped,
        so <code>Wrenhaven_Roasters</code> becomes <code>wrenhavenroasters</code>. The sign-up page
        shows you the result and checks it as you type.
      </p>

      <h2 id="reserved">Reserved names</h2>
      <p>Some handles can’t be claimed by anyone. They fall into two groups:</p>
      <ul>
        <li>
          <strong>Names HYDLNK needs,</strong> such as <code>www</code>, <code>app</code>,{" "}
          <code>help</code> and <code>admin</code>, so nobody can pose as the platform.
        </li>
        <li>
          <strong>Names of well-known services and words like</strong> <code>secure</code> or{" "}
          <code>verify</code>, which are favorites for phishing.
        </li>
      </ul>
      <p>If the sign-up page says a name is reserved, it’s one of these. Try a variation.</p>

      <h2 id="good">What makes a good handle</h2>
      <ul>
        <li>
          <strong>Match your other profiles.</strong> If you’re @wrenhaven everywhere else, be
          wrenhaven here too. People already know it.
        </li>
        <li>
          <strong>Say it out loud.</strong> If you have to spell it for someone, simplify it.
          Hyphens are allowed, but people forget them.
        </li>
        <li>
          <strong>Avoid look-alikes.</strong> 0 and o, 1 and l are easy to confuse in a bio.
        </li>
        <li>
          <strong>Name the brand, not the campaign.</strong> Your handle should outlast this
          season’s launch.
        </li>
        <li>
          <strong>Short beats clever.</strong> Your handle appears in small type in bios and on
          printed cards.
        </li>
      </ul>

      <h2 id="try">Try yours</h2>
      <p>
        Type a handle and press Claim it. The sign-up page tells you straight away whether it’s
        free.
      </p>
      <div className="not-prose">
        <ClaimForm id="guide-handle" rootDomain={clientEnv.NEXT_PUBLIC_ROOT_DOMAIN} />
      </div>
    </>
  ),
};
