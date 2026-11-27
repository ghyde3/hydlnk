import "server-only";
import { createElement } from "react";
import { render } from "react-email";
import { FormLimit } from "@/emails/form-limit";
import { FormMessage, messageEmailText, type FormMessageProps } from "@/emails/form-message";
import { PLAN_LABELS, PLAN_LIMITS, type PlanId } from "@/lib/limits";

/**
 * The words of the two form emails (M17-10, M17-02), rendered by react-email (src/emails/). The
 * subjects are fixed strings: nothing a visitor typed ever reaches a header.
 */

export const FORM_MESSAGE_SUBJECT = "New message from your HYDLNK form";
export const FORM_LIMIT_SUBJECT = "Your forms reached this month’s limit";

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

async function both(element: ReturnType<typeof createElement>) {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}

/** The message email: the HTML from react-email, the text part line by line (`messageEmailText`). */
export async function messageEmailContent(props: FormMessageProps): Promise<EmailContent> {
  return {
    subject: FORM_MESSAGE_SUBJECT,
    html: await render(createElement(FormMessage, props)),
    text: messageEmailText(props),
  };
}

export async function limitEmailContent(plan: PlanId, audienceUrl: string): Promise<EmailContent> {
  const limit = PLAN_LIMITS[plan].formSubmissionsPerMonth.toLocaleString("en-US");
  const sentence = `You’ve reached this month’s limit of ${limit} form submissions on ${PLAN_LABELS[plan]}.`;
  return {
    subject: FORM_LIMIT_SUBJECT,
    ...(await both(createElement(FormLimit, { sentence, audienceUrl }))),
  };
}
