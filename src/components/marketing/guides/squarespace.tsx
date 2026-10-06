import type { GuideBody } from "./types";
import {
  CheckInHydlnk,
  REGISTRAR_TOC,
  SharedProblems,
  Sources,
  ValueNote,
} from "./registrar-parts";

export const connectADomainSquarespace: GuideBody = {
  toc: REGISTRAR_TOC,
  content: (
    <>
      <p>
        This is for a domain registered with Squarespace Domains, including domains that moved over
        from Google Domains. First add your domain in the HYDLNK editor under Domains and keep that
        screen open. It shows the record to add.
      </p>

      <h2 id="check">Check that your DNS is managed here</h2>
      <ol>
        <li>Open the domains dashboard and select your domain.</li>
        <li>Choose DNS, then Domain Nameservers.</li>
        <li>
          Squarespace’s own nameservers end in <code>.googledomains.com</code>,{" "}
          <code>.nsone.net</code>, <code>.squarespacedns.com</code> or <code>.systemdns.com</code>.
          If yours are custom nameservers, the records on this screen don’t apply. Add them at the
          company the nameservers belong to.
        </li>
      </ol>

      <h2 id="subdomain">Subdomain: add the CNAME</h2>
      <p>
        Use this for <code>links.yourbrand.com</code>, so your website keeps working.
      </p>
      <ol>
        <li>In the domains dashboard, select the domain, then DNS, then DNS Settings.</li>
        <li>
          Under Custom Records, select Add record. Squarespace asks for your password or a 2FA code.
        </li>
        <li>
          Set Type to <strong>CNAME</strong>.
        </li>
        <li>
          In Name, enter <code>links</code>.
        </li>
        <li>In Data, paste the target HYDLNK shows.</li>
        <li>
          Custom records default to a 4 hour TTL. You can lower it if you expect to change the
          record. Save the record.
        </li>
      </ol>
      <p>Don’t use the dashboard’s hosting presets. Enter the record HYDLNK shows.</p>
      <ValueNote />

      <h2 id="root">Root domain: add the A record</h2>
      <p>
        Use this for <code>yourbrand.com</code> itself.
      </p>
      <ol>
        <li>
          <strong>Delete the Squarespace Defaults first.</strong> Under DNS Settings, use the red
          trash can on the Squarespace Defaults. A domain can’t point anywhere else while they
          exist.
        </li>
        <li>Under Custom Records, select Add record.</li>
        <li>
          Set Type to <strong>A</strong> and Name to <code>@</code>.
        </li>
        <li>In the IP Address field, paste the address HYDLNK shows, then save.</li>
      </ol>
      <ValueNote />

      <h2 id="problems">Common problems at Squarespace</h2>
      <ul>
        <SharedProblems>
          <li>
            <strong>A record conflict message.</strong> Squarespace offers Replace record. Use it if
            the old record is one you no longer need.
          </li>
          <li>
            <strong>A forwarding rule is in the way.</strong> Remove a conflicting rule under Manage
            rules.
          </li>
          <li>
            <strong>Your records seem ignored.</strong> Check Domain Nameservers again. With custom
            nameservers, Squarespace’s records don’t apply.
          </li>
        </SharedProblems>
      </ul>

      <h2 id="time">How long it takes, then check in HYDLNK</h2>
      <p>Squarespace says changes can take 24 to 48 hours, though many appear sooner.</p>
      <CheckInHydlnk />

      <Sources
        items={[
          {
            href: "https://support.squarespace.com/hc/en-us/articles/31119879125645-DNS-records-for-web-hosting",
            title: "DNS records for web hosting",
          },
          {
            href: "https://support.squarespace.com/hc/en-us/articles/4404183898125-Making-changes-to-nameservers",
            title: "Making changes to nameservers",
          },
          {
            href: "https://support.squarespace.com/hc/en-us/articles/17131164996365-About-the-Google-Domains-migration-to-Squarespace",
            title: "About the Google Domains migration to Squarespace",
          },
          {
            href: "https://support.squarespace.com/hc/en-us/articles/360002101888-Edit-your-domain-s-DNS-records",
            title: "Edit your domain’s DNS records",
          },
          {
            href: "https://support.squarespace.com/hc/en-us/articles/215744668-Pointing-a-Squarespace-domain",
            title: "Pointing a Squarespace domain",
          },
          {
            href: "https://support.squarespace.com/hc/en-us/articles/42180412940429-DNS-record-conflicts",
            title: "DNS record conflicts",
          },
        ]}
      />
    </>
  ),
};
