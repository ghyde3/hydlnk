import { choosingAHandle } from "./choosing-a-handle";
import { connectADomainCloudflare } from "./cloudflare";
import { connectingADomain } from "./connecting-a-domain";
import { designingYourPage } from "./designing-your-page";
import { connectADomainGodaddy } from "./godaddy";
import { gettingStarted } from "./getting-started";
import { connectADomainNamecheap } from "./namecheap";
import { plansAndBilling } from "./plans-and-billing";
import { connectADomainSquarespace } from "./squarespace";
import type { GuideBody } from "./types";
import { understandingAnalytics } from "./understanding-analytics";

/** Guide bodies by slug. Titles, summaries and order live in GUIDES (../site-map.ts). */
export const GUIDE_BODIES: Readonly<Record<string, GuideBody>> = {
  "getting-started": gettingStarted,
  "choosing-a-handle": choosingAHandle,
  "designing-your-page": designingYourPage,
  "connecting-a-domain": connectingADomain,
  "connect-a-domain-godaddy": connectADomainGodaddy,
  "connect-a-domain-namecheap": connectADomainNamecheap,
  "connect-a-domain-squarespace": connectADomainSquarespace,
  "connect-a-domain-cloudflare": connectADomainCloudflare,
  "understanding-analytics": understandingAnalytics,
  "plans-and-billing": plansAndBilling,
};
