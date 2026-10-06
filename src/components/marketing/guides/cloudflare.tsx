import type { GuideBody } from "./types";
import {
  CheckInHydlnk,
  REGISTRAR_TOC,
  SharedProblems,
  Sources,
  ValueNote,
} from "./registrar-parts";

export const connectADomainCloudflare: GuideBody = {
  toc: REGISTRAR_TOC,
  content: (
    <>
      <p>
        First add your domain in the HYDLNK editor under Domains and keep that screen open. It shows
        the record to add. This guide covers the Cloudflare side. The setting that matters most is
        Proxy status: it must be DNS only.
      </p>

      <h2 id="check">Check that your DNS is managed here</h2>
      <ol>
        <li>Sign in to Cloudflare and select your domain.</li>
        <li>
          Look at the domain’s status. It must say <strong>Active</strong>. Pending Nameserver
          Update means you haven’t switched your nameservers to Cloudflare yet, so records you add
          here don’t work.
        </li>
        <li>Open DNS, then Records. That page is where you add records.</li>
      </ol>

      <h2 id="subdomain">Subdomain: add the CNAME</h2>
      <p>
        Use this for <code>links.yourbrand.com</code>, so your website keeps working.
      </p>
      <ol>
        <li>On the domain’s DNS Records page, select Add record.</li>
        <li>
          Set Type to <strong>CNAME</strong>.
        </li>
        <li>
          In Name, enter <code>links</code>.
        </li>
        <li>In Target, paste the value HYDLNK shows.</li>
        <li>
          Set Proxy status to <strong>DNS only</strong> (the gray cloud), then select Save.
        </li>
      </ol>
      <ValueNote />

      <h2 id="root">Root domain: add the A record</h2>
      <p>
        Use this for <code>yourbrand.com</code> itself.
      </p>
      <ol>
        <li>
          Delete any existing A, AAAA or CNAME record on <code>@</code> that you no longer need.
        </li>
        <li>On the DNS Records page, select Add record.</li>
        <li>
          Set Type to <strong>A</strong> and Name to <code>@</code>.
        </li>
        <li>In IPv4 address, paste the address HYDLNK shows.</li>
        <li>
          Set Proxy status to <strong>DNS only</strong> (the gray cloud), then select Save.
        </li>
      </ol>
      <ValueNote />

      <h2 id="problems">Common problems at Cloudflare</h2>
      <ul>
        <SharedProblems>
          <li>
            <strong>The orange cloud.</strong> Records you add in the dashboard are proxied by
            default. Set every HYDLNK record to DNS only. With the orange cloud on, HYDLNK can’t
            verify the domain or issue its certificate.
          </li>
          <li>
            <strong>Too many redirects.</strong> This is the Flexible SSL mode of a proxied record.
            Turn the proxy off for the HYDLNK record and the loop ends.
          </li>
          <li>
            <strong>Pending Nameserver Update.</strong> The domain isn’t on Cloudflare yet. Finish
            switching the nameservers at your registrar.
          </li>
        </SharedProblems>
      </ul>

      <h2 id="time">How long it takes, then check in HYDLNK</h2>
      <p>
        DNS only records can use a TTL from 60 seconds to a day, and changes usually show within
        minutes.
      </p>
      <CheckInHydlnk />

      <Sources
        items={[
          {
            href: "https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/",
            title: "Create DNS records",
          },
          {
            href: "https://developers.cloudflare.com/dns/zone-setups/reference/domain-status/",
            title: "Domain status",
          },
          {
            href: "https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-subdomain/",
            title: "Create subdomain records",
          },
          {
            href: "https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-zone-apex/",
            title: "Create zone apex records",
          },
          { href: "https://developers.cloudflare.com/dns/proxy-status/", title: "Proxy status" },
          {
            href: "https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/",
            title: "Time to live (TTL)",
          },
        ]}
      />
    </>
  ),
};
