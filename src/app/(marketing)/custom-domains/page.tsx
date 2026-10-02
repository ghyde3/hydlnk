import type { Metadata } from "next";
import { CtaBand } from "@/components/marketing/cta-band";
import { DnsExample } from "@/components/marketing/domain-analytics";
import { DomainSetupMock } from "@/components/marketing/domain-setup-mock";
import { FaqList } from "@/components/marketing/faq";
import { FAQ_GROUPS } from "@/components/marketing/faq-data";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import {
  ArrowLink,
  Chip,
  H2,
  Section,
  SectionIntro,
} from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { guideHref } from "@/components/marketing/site-map";

export const metadata: Metadata = marketingMetadata({
  path: "/custom-domains",
  title: "Custom domains",
  description:
    "Serve your HYDLNK page from a domain you own, like links.yourbrand.com. Add one DNS record, we verify it and issue SSL automatically. How DNS, CNAME and A records work, step by step.",
  image: "domains",
});

const STEPS = [
  {
    title: "Add the domain in the editor",
    body: "Open Domains and type the address you want: a subdomain such as links.yourbrand.com, or the root domain yourbrand.com.",
  },
  {
    title: "Copy the record the editor shows you",
    body: "You get the exact DNS record for that domain: its type, its name and its value. A subdomain gets a CNAME record; a root domain gets an A record. The values come from our hosting platform for your domain, so always copy them from the editor rather than from a guide.",
  },
  {
    title: "Add the record where your DNS lives",
    body: "Sign in where your domain’s DNS is managed, usually the company you bought the domain from, open its DNS settings, add the record exactly as shown and save.",
  },
  {
    title: "We check it for you",
    body: "HYDLNK looks for the record and marks the domain Verified as soon as it finds it. Most changes show up within minutes; some providers take a few hours, and DNS can take up to 48 hours to reach everywhere. Check DNS now runs the check on demand.",
  },
  {
    title: "SSL is issued automatically",
    body: "Once the domain is verified, a certificate is issued so your page loads over https. Renewals are automatic too: there is nothing to buy, upload or remember.",
  },
] as const;

const TROUBLE = [
  {
    question: "It still says Waiting for DNS",
    answer:
      "Check the record’s name first: most providers add your domain for you, so the name is just links, not links.yourbrand.com. Then check the value for typos or a trailing space. If both match the editor, give it time and press Check DNS now later.",
  },
  {
    question: "There’s already a record with that name",
    answer:
      "A name that has a CNAME can’t have any other record. Edit or remove old A, AAAA or CNAME records for the same name, then add the one the editor shows.",
  },
  {
    question: "My DNS provider has a proxy or CDN switch on records",
    answer:
      "Turn it off for this record so it points straight at HYDLNK. With the proxy on, we can’t verify the domain or issue its certificate.",
  },
  {
    question: "The domain is verified but https isn’t working yet",
    answer:
      "Certificates usually arrive within minutes of verification. If your domain has CAA records, which limit who may issue certificates for it, they can block issuance. Contact support if https isn’t working an hour after verification.",
  },
  {
    question: "Will this affect my email?",
    answer:
      "No. Email uses MX records, which you don’t touch. A CNAME for links.yourbrand.com or an A record for the root leaves your mail exactly where it is.",
  },
];

export default function DomainsPage() {
  const domainFaq = FAQ_GROUPS.find((group) => group.id === "domains")?.items ?? [];
  return (
    <MarketingShell current="domains">
      <PageHero
        eyebrow={
          <span className="inline-flex items-center gap-2">
            Custom domains <Chip tone="brass">Pro</Chip>
          </span>
        }
        title="Your page, on your domain."
        lead="Every page has a free address at yourname.hydlnk.com. On Pro and Studio you can also serve it from a domain you own, like links.yourbrand.com, with an SSL certificate issued for you."
        secondary={{ href: guideHref("connecting-a-domain"), label: "Step-by-step guide" }}
        aside={<DomainSetupMock />}
      />

      <Section id="addresses" tone="page" labelledBy="addresses-title">
        <SectionIntro
          eyebrow="Two addresses"
          titleId="addresses-title"
          title="Start on ours. Move to yours when you’re ready."
        />
        <div className="mt-10 grid gap-3 min-[760px]:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-[22px]">
            <Chip tone="neutral" className="self-start">
              Every plan
            </Chip>
            <h3 className="font-mono text-lg">yourname.hydlnk.com</h3>
            <p className="text-[15px] leading-[1.6] text-text-2">
              Your handle is your address, live the moment you publish, over https. Nothing to
              set up and nothing to renew.
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-[22px]">
            <Chip tone="brass" className="self-start">
              Pro and Studio
            </Chip>
            <h3 className="font-mono text-lg">links.yourbrand.com</h3>
            <p className="text-[15px] leading-[1.6] text-text-2">
              A domain you already own, pointed at your page with one DNS record. Pro includes one
              custom domain and Studio fifteen; each custom domain serves one page. Click tracking
              stays on your domain too.
            </p>
          </div>
        </div>
      </Section>

      <Section id="steps" labelledBy="steps-title">
        <SectionIntro
          eyebrow="How it works"
          titleId="steps-title"
          title="Five steps, most of them automatic."
          lead="You add one record at your DNS provider. Verification and SSL happen on their own."
        />
        <ol className="mt-10 grid gap-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="grid gap-x-5 gap-y-2 rounded-md border border-line bg-surface p-[22px] min-[640px]:grid-cols-[48px_minmax(0,1fr)]"
            >
              <span className="flex size-10 items-center justify-center rounded-[50%] border border-ink font-mono text-sm">
                {index + 1}
              </span>
              <div>
                <h3 className="text-base font-semibold">{step.title}</h3>
                <p className="mt-1.5 max-w-[760px] text-[15px] leading-[1.65] text-text-2">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="dns" tone="page" labelledBy="dns-title">
        <SectionIntro
          eyebrow="DNS in plain words"
          titleId="dns-title"
          title="What you’re actually changing."
          lead="DNS is the internet’s address book: it turns a name like links.yourbrand.com into the server that answers for it. A record is one line in that book."
        />
        <div className="mt-10 grid gap-3 min-[1024px]:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-[22px]">
            <h3 className="text-base font-semibold">CNAME record: for a subdomain</h3>
            <p className="text-[15px] leading-[1.6] text-text-2">
              Points one name at another name. Use it for links.yourbrand.com, go.yourbrand.com or
              any other subdomain. Your main website at yourbrand.com keeps working as it is.
            </p>
            <DnsExample type="CNAME" name="links" />
            <span className="text-xs text-text-3">Example record. The value comes from your editor.</span>
          </div>
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-[22px]">
            <h3 className="text-base font-semibold">A record: for a root domain</h3>
            <p className="text-[15px] leading-[1.6] text-text-2">
              Points a name at an IP address. Root domains like yourbrand.com can’t use a CNAME at
              most providers, so they use an A record, written with the name @.
            </p>
            <DnsExample type="A" name="@" />
            <span className="text-xs text-text-3">Example record. The value comes from your editor.</span>
          </div>
        </div>
        <div className="mt-3 grid gap-3 min-[760px]:grid-cols-3">
          <div className="rounded-md border border-line bg-surface p-[20px]">
            <h3 className="text-[15px] font-semibold">Subdomain or root?</h3>
            <p className="mt-1.5 text-sm leading-[1.6] text-text-2">
              If a website already lives at yourbrand.com, use a subdomain. If the domain is only
              for your link page, the root works too.
            </p>
          </div>
          <div className="rounded-md border border-line bg-surface p-[20px]">
            <h3 className="text-[15px] font-semibold">TTL</h3>
            <p className="mt-1.5 text-sm leading-[1.6] text-text-2">
              How long other servers may remember a record. Your provider’s default is fine; a
              lower value only makes later changes spread faster.
            </p>
          </div>
          <div className="rounded-md border border-line bg-surface p-[20px]">
            <h3 className="text-[15px] font-semibold">Propagation</h3>
            <p className="mt-1.5 text-sm leading-[1.6] text-text-2">
              The time a change takes to reach DNS servers everywhere: often minutes, sometimes
              hours, at most about two days.
            </p>
          </div>
        </div>
      </Section>

      <Section id="troubleshooting" labelledBy="troubleshooting-title">
        <div className="flex flex-wrap gap-[clamp(24px,6vw,64px)]">
          <div className="flex-[1_1_300px]">
            <h2 id="troubleshooting-title" className={H2}>
              If it doesn’t verify
            </h2>
            <p className="mt-4 text-[15px] leading-[1.6] text-text-2">
              DNS mistakes are the usual cause, and they’re quick to fix.
            </p>
            <ArrowLink href={guideHref("connecting-a-domain")} className="mt-4">
              Connecting a domain, step by step
            </ArrowLink>
          </div>
          <div className="min-w-0 flex-[2_1_560px]">
            <FaqList items={TROUBLE} />
          </div>
        </div>
      </Section>

      <Section id="domain-faq" tone="page" labelledBy="domain-faq-title">
        <div className="flex flex-wrap gap-[clamp(24px,6vw,64px)]">
          <div className="flex-[1_1_300px]">
            <h2 id="domain-faq-title" className={H2}>
              Domain questions
            </h2>
          </div>
          <div className="min-w-0 flex-[2_1_560px]">
            <FaqList items={domainFaq} />
          </div>
        </div>
      </Section>

      <CtaBand
        title="Claim your name now. Bring your domain later."
        note="Your hydlnk.com address is free forever. Custom domains start at $5 a month."
      />
    </MarketingShell>
  );
}
