import Link from "next/link";
import { SUPPORT_EMAIL } from "../site-map";
import type { GuideBody } from "./types";

export const plansAndBilling: GuideBody = {
  toc: [
    ["plans", "The three plans"],
    ["upgrade", "Upgrading"],
    ["manage", "Managing billing"],
    ["cancel", "Cancelling"],
    ["limits", "How limits work"],
    ["delete", "Deleting your account"],
  ],
  content: (
    <>
      <p>
        HYDLNK is free for one page with every block and the full theme system. You pay when you
        want your own domain, more pages or more history, never to make your page look good.
      </p>

      <h2 id="plans">The three plans</h2>
      <table>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Price</th>
            <th>Main differences</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Free</td>
            <td>$0</td>
            <td>1 page, 3 saved themes, per-link clicks for 30 days, 10 MB of uploads, a small “Made with HYDLNK” badge</td>
          </tr>
          <tr>
            <td>Pro</td>
            <td>$5 a month or $48 a year</td>
            <td>1 custom domain, 3 pages, no badge, unlimited saved themes, a year of analytics with referrers, devices and countries, 100 MB of uploads</td>
          </tr>
          <tr>
            <td>Studio</td>
            <td>$15 a month</td>
            <td>15 pages and 15 custom domains, themes shared across pages, 1 GB of uploads</td>
          </tr>
        </tbody>
      </table>
      <p>
        See <Link href="/pricing#compare">the full comparison</Link>. There are no commerce fees
        on any plan.
      </p>

      <h2 id="upgrade">Upgrading</h2>
      <p>
        Choose a plan in your account settings and you’ll go to Stripe Checkout to pay. Stripe
        handles the card details; HYDLNK never sees your card number. Your new plan applies as soon
        as the payment goes through.
      </p>

      <h2 id="manage">Managing billing</h2>
      <p>Manage billing in your account settings opens Stripe’s customer portal, where you can:</p>
      <ul>
        <li>update your card,</li>
        <li>download invoices and receipts,</li>
        <li>switch Pro between monthly and yearly billing,</li>
        <li>cancel your plan.</li>
      </ul>

      <h2 id="cancel">Cancelling</h2>
      <p>
        Cancel at any time in the portal. Your paid plan stays active until the end of the period
        you’ve already paid for; after that, your account moves to Free. The{" "}
        <Link href="/terms#payments">terms</Link> cover payments and refunds in full.
      </p>

      <h2 id="limits">How limits work</h2>
      <p>
        Plan limits (pages, saved themes, custom domains and upload storage) are checked on our
        side whenever you create or upload something. If you reach one, you’ll see a message when
        you try to add more.
      </p>

      <h2 id="delete">Deleting your account</h2>
      <p>
        You can delete your account from your account settings. To confirm, you type your handle.
        Deleting your account deletes your pages, themes, domains and analytics, frees your
        handles and signs you out on every device. It can’t be undone.
      </p>
      <p>
        If you’re on a paid plan, cancel it in the billing portal first. Questions about a charge?
        Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </>
  ),
};
