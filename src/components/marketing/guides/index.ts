import { choosingAHandle } from "./choosing-a-handle";
import { connectingADomain } from "./connecting-a-domain";
import { designingYourPage } from "./designing-your-page";
import { gettingStarted } from "./getting-started";
import { plansAndBilling } from "./plans-and-billing";
import type { GuideBody } from "./types";
import { understandingAnalytics } from "./understanding-analytics";

/** Guide bodies by slug. Titles, summaries and order live in GUIDES (../site-map.ts). */
export const GUIDE_BODIES: Readonly<Record<string, GuideBody>> = {
  "getting-started": gettingStarted,
  "choosing-a-handle": choosingAHandle,
  "designing-your-page": designingYourPage,
  "connecting-a-domain": connectingADomain,
  "understanding-analytics": understandingAnalytics,
  "plans-and-billing": plansAndBilling,
};
