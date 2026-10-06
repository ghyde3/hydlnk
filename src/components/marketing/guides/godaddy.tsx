import type { GuideBody } from "./types";
import {
  CheckInHydlnk,
  REGISTRAR_TOC,
  SharedProblems,
  Sources,
  ValueNote,
} from "./registrar-parts";

export const connectADomainGodaddy: GuideBody = {
  toc: REGISTRAR_TOC,
  content: (
    <>
      <p>
        You need two things from HYDLNK first: add your domain in the editor under Domains, and keep
        that screen open. It shows the record to add. This guide covers the GoDaddy side.
      </p>

      <h2 id="check">Check that your DNS is managed here</h2>
      <p>
        A domain registered at GoDaddy doesn’t always use GoDaddy’s DNS. If its nameservers point to
        another company, the records have to be added there instead.
      </p>
      <ol>
        <li>Sign in to GoDaddy and open Domain Portfolio.</li>
        <li>Select your domain to open Domain Settings, then choose DNS.</li>
        <li>
          Open Nameservers under DNS. If they belong to another company, add the records at that
          company, not here.
        </li>
      </ol>

      <h2 id="subdomain">Subdomain: add the CNAME</h2>
      <p>
        Use this for <code>links.yourbrand.com</code>, so your website keeps working.
      </p>
      <ol>
        <li>In Domain Portfolio, select the domain, then choose DNS.</li>
        <li>Select Add New Record.</li>
        <li>
          Set Type to <strong>CNAME</strong>.
        </li>
        <li>
          In Name, enter only the prefix, such as <code>links</code>. GoDaddy adds your domain.
        </li>
        <li>In Value, paste the target HYDLNK shows.</li>
        <li>Leave TTL at the default of 1 hour, then select Save.</li>
      </ol>
      <ValueNote />

      <h2 id="root">Root domain: add the A record</h2>
      <p>
        Use this for <code>yourbrand.com</code> itself.
      </p>
      <ol>
        <li>
          <strong>Clear what is in the way first.</strong> A parked domain has GoDaddy’s parking A
          records on <code>@</code>. You will replace them. If the domain uses GoDaddy forwarding,
          it locks the A record: open DNS, then Forwarding, and delete the forwarding first.
        </li>
        <li>
          Under DNS, edit the existing A record on <code>@</code>, or select Add New Record if there
          isn’t one.
        </li>
        <li>
          Set Type to <strong>A</strong> and Name to <code>@</code>.
        </li>
        <li>In Value, paste the address HYDLNK shows, then select Save.</li>
      </ol>
      <ValueNote />

      <h2 id="problems">Common problems at GoDaddy</h2>
      <ul>
        <SharedProblems>
          <li>
            <strong>A record won’t delete or change.</strong> Check Forwarding under DNS. A
            forwarding rule locks the record until you remove it.
          </li>
          <li>
            <strong>GoDaddy asks for a verification code when you save.</strong> That is Domain
            Protection. Enter the code it sends and save again.
          </li>
          <li>
            <strong>The Name came out wrong.</strong> Enter <code>links</code>, not{" "}
            <code>links.yourbrand.com</code>, or you get{" "}
            <code>links.yourbrand.com.yourbrand.com</code>.
          </li>
        </SharedProblems>
      </ul>

      <h2 id="time">How long it takes, then check in HYDLNK</h2>
      <p>GoDaddy says most changes take effect within an hour and can take up to 48 hours.</p>
      <CheckInHydlnk />

      <Sources
        items={[
          {
            href: "https://www.godaddy.com/help/add-a-cname-record-19236",
            title: "Add a CNAME record",
          },
          {
            href: "https://www.godaddy.com/help/change-my-domain-nameservers-664",
            title: "Change my domain’s nameservers",
          },
          {
            href: "https://www.godaddy.com/help/edit-an-a-record-19239",
            title: "Edit an A record",
          },
          {
            href: "https://www.godaddy.com/help/park-a-domain-registered-with-godaddy-23936",
            title: "Park a domain registered with GoDaddy",
          },
          {
            href: "https://www.godaddy.com/help/remove-my-domain-forwarding-19979",
            title: "Remove my domain forwarding",
          },
          {
            href: "https://www.godaddy.com/help/delete-dns-records-19210",
            title: "Delete DNS records",
          },
          { href: "https://www.godaddy.com/help/add-an-a-record-19238", title: "Add an A record" },
        ]}
      />
    </>
  ),
};
