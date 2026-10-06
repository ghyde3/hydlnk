import type { GuideBody } from "./types";
import {
  CheckInHydlnk,
  REGISTRAR_TOC,
  SharedProblems,
  Sources,
  ValueNote,
} from "./registrar-parts";

export const connectADomainNamecheap: GuideBody = {
  toc: REGISTRAR_TOC,
  content: (
    <>
      <p>
        First add your domain in the HYDLNK editor under Domains and keep that screen open. It shows
        the record to add. This guide covers the Namecheap side.
      </p>

      <h2 id="check">Check that your DNS is managed here</h2>
      <p>
        Namecheap only shows Host Records when the domain uses Namecheap’s own DNS: BasicDNS,
        PremiumDNS or FreeDNS.
      </p>
      <ol>
        <li>Sign in to Namecheap and open Domain List.</li>
        <li>Select Manage next to your domain.</li>
        <li>
          Look at Nameservers. If it says Namecheap BasicDNS, PremiumDNS or FreeDNS, continue below.
          If it says Custom DNS, or the nameservers belong to Namecheap hosting, edit the records at
          that provider or in cPanel instead.
        </li>
        <li>Open the Advanced DNS tab. Host Records is the table you will edit.</li>
      </ol>

      <h2 id="subdomain">Subdomain: add the CNAME</h2>
      <p>
        Use this for <code>links.yourbrand.com</code>, so your website keeps working.
      </p>
      <ol>
        <li>Domain List, Manage, then Advanced DNS.</li>
        <li>Under Host Records, select Add New Record.</li>
        <li>
          Choose <strong>CNAME Record</strong> as the type.
        </li>
        <li>
          In Host, enter <code>links</code>. Namecheap adds your domain.
        </li>
        <li>In Value, paste the target HYDLNK shows.</li>
        <li>Leave TTL on Automatic, then select Save All Changes.</li>
      </ol>
      <ValueNote />

      <h2 id="root">Root domain: add the A record</h2>
      <p>
        Use this for <code>yourbrand.com</code> itself.
      </p>
      <ol>
        <li>
          <strong>Delete the defaults first.</strong> A new domain comes with a URL Redirect Record
          on <code>@</code> and a <code>www</code> CNAME that points to Namecheap’s parking page.
          Delete both with the trash icon, and any other record on <code>@</code>.
        </li>
        <li>
          Select Add New Record and choose <strong>A Record</strong>.
        </li>
        <li>
          In Host, enter <code>@</code>.
        </li>
        <li>In Value, paste the address HYDLNK shows, then select Save All Changes.</li>
      </ol>
      <p>
        Never put a CNAME on <code>@</code>. It breaks the email for your domain.
      </p>
      <ValueNote />

      <h2 id="problems">Common problems at Namecheap</h2>
      <ul>
        <SharedProblems>
          <li>
            <strong>No Host Records table.</strong> The domain isn’t on Namecheap DNS. Go back to
            Nameservers and either switch to Namecheap BasicDNS or edit where the nameservers point.
          </li>
          <li>
            <strong>The change didn’t stick.</strong> Select Save All Changes after you edit. Adding
            a row isn’t enough on its own.
          </li>
          <li>
            <strong>The old redirect still shows.</strong> A URL Redirect Record and an A record on
            the same host conflict. Delete the redirect.
          </li>
        </SharedProblems>
      </ul>

      <h2 id="time">How long it takes, then check in HYDLNK</h2>
      <p>
        Records usually show within about 30 minutes. If you changed nameservers, allow up to 48
        hours.
      </p>
      <CheckInHydlnk />

      <Sources
        items={[
          {
            href: "https://www.namecheap.com/support/knowledgebase/article.aspx/434/2237/how-do-i-set-up-host-records-for-a-domain/",
            title: "How do I set up host records for a domain?",
          },
          {
            href: "https://www.namecheap.com/support/knowledgebase/article.aspx/323/46/why-cant-i-modify-email-domain-redirect-and-host-records-in-my-namecheap-account/",
            title: "Why can’t I modify email, domain redirect and host records?",
          },
          {
            href: "https://www.namecheap.com/support/knowledgebase/article.aspx/9646/2237/how-to-create-a-cname-record-for-your-domain/",
            title: "How to create a CNAME record for your domain",
          },
          {
            href: "https://www.namecheap.com/support/knowledgebase/article.aspx/9837/46/how-to-connect-a-domain-to-a-server-or-hosting/",
            title: "How to connect a domain to a server or hosting",
          },
          {
            href: "https://www.namecheap.com/support/knowledgebase/article.aspx/319/2237/how-can-i-set-up-an-a-address-record-for-my-domain/",
            title: "How can I set up an A (address) record for my domain?",
          },
        ]}
      />
    </>
  ),
};
