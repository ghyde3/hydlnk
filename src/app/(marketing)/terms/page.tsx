import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";
import { marketingMetadata } from "@/components/marketing/metadata";
import { POSTAL_ADDRESS, SUPPORT_EMAIL } from "@/components/marketing/site-map";

export const metadata: Metadata = marketingMetadata({
  path: "/terms",
  title: "Terms of service",
  description:
    "The terms for using HYDLNK: accounts and handles, your content, acceptable use, reports and suspension, plans and billing, custom domains, liability and contact.",
  image: "legal",
});

const TOC = [
  ["agreement", "Agreement"],
  ["eligibility", "Who can use HYDLNK"],
  ["accounts", "Your account and handle"],
  ["content", "Your content"],
  ["acceptable-use", "Acceptable use"],
  ["reports", "Reports and enforcement"],
  ["copyright", "Copyright complaints"],
  ["traffic", "Free plan traffic"],
  ["payments", "Plans, billing and refunds"],
  ["domains", "Custom domains"],
  ["service", "Changes to the service"],
  ["third-parties", "Other services"],
  ["ending", "Deleting your account"],
  ["disclaimers", "Disclaimers"],
  ["liability", "Limitation of liability"],
  ["indemnity", "Indemnity"],
  ["law", "Governing law"],
  ["changes", "Changes to these terms"],
  ["contact", "Contact"],
] as const;

const support = <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;

export default function TermsPage() {
  return (
    <LegalPage
      current="terms"
      title="Terms of service"
      toc={TOC}
      intro={
        <p>
          These terms are the agreement between you and HYDLNK for using hydlnk.com, the editor at
          app.hydlnk.com and the pages you publish. They’re written to be read: if anything is
          unclear, ask us.
        </p>
      }
    >
      <h2 id="agreement">Agreement</h2>
      <p>
        By creating an account or using HYDLNK, you agree to these terms and to our{" "}
        <Link href="/privacy">privacy policy</Link>. If you use HYDLNK for a business or another
        organisation, you agree on its behalf and confirm you’re allowed to. If you don’t agree,
        don’t use the service.
      </p>

      <h2 id="eligibility">Who can use HYDLNK</h2>
      <p>
        You must be at least 13 years old, or 16 if you live in the European Economic Area or the
        UK, and old enough to agree to these terms where you live. You can’t use HYDLNK if we’ve
        previously suspended you for breaking these terms, or if the law forbids it.
      </p>

      <h2 id="accounts">Your account and handle</h2>
      <ul>
        <li>Give us an email address you control, and keep access to it secure: anyone who can open your email can sign in as you.</li>
        <li>You’re responsible for what happens in your account. Tell us at {support} if you think someone else has access.</li>
        <li>Handles are first come, first served. Some are reserved, and we may reclaim or change a handle that impersonates someone, infringes someone’s rights or misleads visitors.</li>
        <li>You may not sell, transfer or rent out handles or accounts.</li>
      </ul>

      <h2 id="content">Your content</h2>
      <p>
        You own what you put on HYDLNK: your text, links, images and designs. To run the service,
        you give us a worldwide, non-exclusive, royalty-free licence to host, store, copy, display,
        resize and adapt (for example to create image sizes and preview images) and distribute your
        content, only as needed to operate, protect and improve HYDLNK. The licence ends when you
        delete the content or your account, except for copies in backups that are overwritten in
        the normal cycle.
      </p>
      <p>
        Published pages are public. You confirm that you have the right to publish everything on
        your pages and that it doesn’t break the law or these terms.
      </p>

      <h2 id="acceptable-use">Acceptable use</h2>
      <p>You may not use HYDLNK to publish, link to or do any of the following:</p>
      <ul>
        <li><strong>Phishing, scams or fraud</strong>, including pages that collect passwords or payment details under false pretences.</li>
        <li><strong>Malware</strong>, or links to software that harms devices or steals data.</li>
        <li><strong>Impersonation</strong> of a person, brand or organisation, including HYDLNK, in a way that misleads.</li>
        <li><strong>Illegal content</strong>, including child sexual abuse material, which we report to the authorities.</li>
        <li><strong>Content that exploits or endangers others</strong>: threats, harassment, incitement to violence, promotion of terrorism, or sexual content shared without consent.</li>
        <li><strong>Infringement</strong> of copyright, trademark or other rights.</li>
        <li><strong>Spam and deception</strong>, such as misleading redirects or links that hide where they go.</li>
        <li><strong>Abuse of the service</strong>: overloading or attacking it, scraping it beyond normal use, working around plan limits or security measures, or reselling access without our permission.</li>
      </ul>

      <h2 id="reports">Reports and enforcement</h2>
      <p>
        Every published page has a report link. Anyone can use it, and we review every report.
        Links are also checked against blocklists of known harmful sites when you save them.
      </p>
      <p>
        If we believe content or an account breaks these terms or the law, we may remove content,
        unpublish or suspend pages, or suspend or close the account. Where we can, we’ll tell you
        why. When there’s a risk of harm, such as phishing or malware, we may act first and explain
        afterwards. If you think we got it wrong, write to {support} and we’ll look again.
      </p>

      <h2 id="copyright">Copyright complaints</h2>
      <p>
        If you believe a page infringes your copyright, email {support} with: your contact
        details; the work you believe is infringed; the address of the page and what on it
        infringes; a statement that you believe in good faith the use isn’t authorised; and a
        statement, under penalty of perjury, that your notice is accurate and you’re the owner or
        authorised to act for the owner, with your physical or electronic signature. We may remove
        the content and tell the page’s owner, who can send a counter-notice. We close the accounts
        of repeat infringers.
      </p>

      <h2 id="traffic">Free plan traffic</h2>
      <p>
        Pages on every plan keep serving when traffic spikes. We review Free pages with unusually
        high traffic, roughly 100,000 views a month or more, to make sure they’re within these
        terms, and we may contact you about your plan. Your page keeps serving while we do.
      </p>

      <h2 id="payments">Plans, billing and refunds</h2>
      <ul>
        <li><strong>Prices.</strong> Paid plans cost what the <Link href="/pricing">pricing page</Link> shows when you subscribe, in US dollars, plus any tax that applies.</li>
        <li><strong>Billing.</strong> Payments are processed by Stripe. Subscriptions are billed in advance, monthly or yearly, and renew automatically until you cancel.</li>
        <li><strong>Cancelling.</strong> Cancel at any time in the billing portal. Your plan stays active until the end of the period you’ve paid for, and then your account moves to Free.</li>
        <li><strong>Refunds.</strong> If you’re not happy with a new subscription, ask us at {support} within 14 days of your first payment and we’ll refund it in full. Otherwise payments are non-refundable, except where the law requires a refund.</li>
        <li><strong>Moving to a smaller plan.</strong> Features the new plan doesn’t include, such as custom domains or extra pages, stop working when the change takes effect, and you can’t add more than the new plan allows.</li>
        <li><strong>Price changes.</strong> We’ll tell you at least 30 days before a price change applies to your subscription, so you can cancel first if you prefer.</li>
        <li><strong>No commerce fees.</strong> HYDLNK doesn’t take a share of anything you sell through your page.</li>
      </ul>

      <h2 id="domains">Custom domains</h2>
      <p>
        HYDLNK doesn’t sell or register domains. You may connect only domains you already own or
        are authorised to use, bought at any registrar. You’re responsible for your domain’s
        registration, renewal and DNS. We verify domains and arrange their SSL certificates
        through our hosting provider, but we can’t control DNS providers, registrars or how long
        changes take to spread. When you remove a domain or your plan no longer includes it, we stop
        serving your page on it.
      </p>

      <h2 id="service">Changes to the service</h2>
      <p>
        We’re always working on HYDLNK, so features will change. We aim to keep it available and
        fast, but we can’t promise it will be uninterrupted or free of errors. If we remove a
        feature you pay for, or stop offering HYDLNK, we’ll give you reasonable notice and a
        prorated refund for any period you’ve paid for and can’t use.
      </p>

      <h2 id="third-parties">Other services</h2>
      <p>
        HYDLNK works with services run by others, such as Stripe for payments, Google for
        sign-in, and YouTube and Spotify for embedded players. Their terms apply to your use of
        them, and we’re not responsible for them. Links on pages lead to sites we don’t control.
      </p>

      <h2 id="ending">Deleting your account</h2>
      <p>
        You can delete your account at any time in your account settings. Deleting it removes your
        pages, themes, domains and analytics and frees your handles; it can’t be undone. If you’re
        on a paid plan, cancel it in the billing portal first. We may close accounts that break
        these terms, as described above. The sections on content licences for backups, disclaimers,
        liability, indemnity and governing law continue after your account ends.
      </p>

      <h2 id="disclaimers">Disclaimers</h2>
      <p>
        HYDLNK is provided “as is” and “as available”. To the extent the law allows, we disclaim
        all warranties, express or implied, including merchantability, fitness for a particular
        purpose and non-infringement. Nothing in these terms limits rights you have as a consumer
        that can’t be limited by contract.
      </p>

      <h2 id="liability">Limitation of liability</h2>
      <p>
        To the extent the law allows, HYDLNK is not liable for indirect, incidental, special,
        consequential or punitive damages, or for lost profits, revenue, data or goodwill, arising
        from your use of the service. Our total liability for any claim relating to HYDLNK is
        limited to the greater of the amount you paid us in the 12 months before the claim and 50
        US dollars. These limits don’t apply to liability that can’t be limited by law, such as
        for fraud or for death or personal injury caused by negligence.
      </p>

      <h2 id="indemnity">Indemnity</h2>
      <p>
        If someone brings a claim against HYDLNK because of your content or your breach of these
        terms, you agree to cover the reasonable costs, damages and legal fees that result, to the
        extent the law allows. This doesn’t apply to consumers where the law forbids it.
      </p>

      <h2 id="law">Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Florida, United States, without
        regard to its conflict-of-law rules. Disputes will be heard in the state and federal courts
        located in Orange County, Florida, and you and HYDLNK both agree to their jurisdiction. If
        you’re a consumer, you also keep the protection of the mandatory laws of the country where
        you live, and you can bring proceedings in its courts.
      </p>

      <h2 id="changes">Changes to these terms</h2>
      <p>
        We may update these terms. The date at the top shows the latest version. If a change is
        significant, we’ll tell you by email or in the editor at least 30 days before it takes
        effect. Continuing to use HYDLNK after that means you accept the new terms; if you don’t,
        you can delete your account.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Questions about these terms, reports and complaints: {support}. Legal notices can also be
        sent by post to HYDLNK, {POSTAL_ADDRESS}. Privacy questions: see the{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    </LegalPage>
  );
}
