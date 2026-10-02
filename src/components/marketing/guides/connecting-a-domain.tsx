import Link from "next/link";
import { SUPPORT_EMAIL } from "../site-map";
import type { GuideBody } from "./types";

export const connectingADomain: GuideBody = {
  toc: [
    ["before", "Before you start"],
    ["which", "Subdomain or root domain"],
    ["steps", "Step by step"],
    ["providers", "Finding your way around a DNS provider"],
    ["trouble", "If it doesn’t verify"],
    ["remove", "Changing or removing a domain"],
  ],
  content: (
    <>
      <p>
        Your page always has its free address, <code>yourname.hydlnk.com</code>. On Pro and
        Studio you can also serve it from a domain you already own. It takes one DNS record, and
        the rest, including SSL, happens on its own.
      </p>

      <h2 id="before">Before you start</h2>
      <ul>
        <li>A Pro plan (one custom domain) or Studio (fifteen).</li>
        <li>
          A domain you already own, bought from any registrar. HYDLNK doesn’t sell or register
          domains.
        </li>
        <li>Access to the DNS settings for that domain, usually your registrar’s dashboard.</li>
      </ul>

      <h2 id="which">Subdomain or root domain</h2>
      <table>
        <thead>
          <tr>
            <th>You want</th>
            <th>Example</th>
            <th>Record</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>A subdomain</td>
            <td><code>links.yourbrand.com</code></td>
            <td>CNAME</td>
          </tr>
          <tr>
            <td>The root domain</td>
            <td><code>yourbrand.com</code></td>
            <td>A</td>
          </tr>
        </tbody>
      </table>
      <p>
        If your website already lives at <code>yourbrand.com</code>, use a subdomain such as{" "}
        <code>links</code>, <code>go</code> or <code>hello</code>, so the website keeps working.
        If the domain is only for your link page, the root domain is fine.
      </p>

      <h2 id="steps">Step by step</h2>
      <ol>
        <li>
          <strong>Add the domain.</strong> In the editor, open Domains and enter the domain you
          want to use.
        </li>
        <li>
          <strong>Copy the record.</strong> The editor shows the exact record to add: its type, its
          name and its value. The value is specific to your setup, so copy it from the editor,
          not from a screenshot or another guide.
        </li>
        <li>
          <strong>Add it at your DNS provider.</strong> Sign in where your domain’s DNS is managed,
          open the DNS settings, add a new record with the type, name and value from the editor, and
          save.
        </li>
        <li>
          <strong>Wait for verification.</strong> The editor shows Waiting for DNS until it finds
          the record, then Verified. Most changes appear within minutes; some take a few hours.
          Press Check DNS now to look again straight away.
        </li>
        <li>
          <strong>Let SSL arrive.</strong> After verification a certificate is issued
          automatically, and your page loads over https at your domain. Certificates renew on
          their own.
        </li>
      </ol>

      <h2 id="providers">Finding your way around a DNS provider</h2>
      <p>Every provider’s dashboard looks different, but the fields are the same:</p>
      <ul>
        <li>
          <strong>Type</strong>: choose CNAME or A, as the editor says.
        </li>
        <li>
          <strong>Name</strong> (sometimes Host): for <code>links.yourbrand.com</code> enter just{" "}
          <code>links</code>; most providers add your domain for you. For the root domain, enter{" "}
          <code>@</code> or leave it empty, whichever your provider asks for.
        </li>
        <li>
          <strong>Value</strong> (sometimes Target, Points to or Data): paste the value from the
          editor exactly, without spaces.
        </li>
        <li>
          <strong>TTL</strong>: leave the default.
        </li>
      </ul>

      <h2 id="trouble">If it doesn’t verify</h2>
      <ul>
        <li>
          <strong>Check the name.</strong> <code>links.yourbrand.com.yourbrand.com</code> is the
          most common mistake: enter only <code>links</code> if your provider appends the domain.
        </li>
        <li>
          <strong>Look for old records.</strong> A name with a CNAME can’t have any other record.
          Remove or edit existing A, AAAA or CNAME records for the same name.
        </li>
        <li>
          <strong>Turn off proxying.</strong> If your provider can proxy a record through its own
          network, switch that off for this record.
        </li>
        <li>
          <strong>Give it time.</strong> Changes can take up to 48 hours to reach every DNS
          server, though most are much faster.
        </li>
        <li>
          <strong>CAA records.</strong> If verification succeeds but https doesn’t start working,
          CAA records on your domain may be limiting who can issue certificates.
        </li>
      </ul>
      <p>
        Still stuck? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the domain
        and a screenshot of your DNS records.
      </p>

      <h2 id="remove">Changing or removing a domain</h2>
      <p>
        Remove the domain in the editor’s Domains tab whenever you like. Your page stays live at{" "}
        <code>yourname.hydlnk.com</code>. Then delete the record at your DNS provider so the name
        doesn’t point anywhere unexpected. To switch to a different domain, remove the old one and
        add the new one. For background on how DNS works, see{" "}
        <Link href="/custom-domains#dns">DNS in plain words</Link>.
      </p>
    </>
  ),
};
