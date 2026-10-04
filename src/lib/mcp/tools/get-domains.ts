import { z } from "zod";
import { listDomainsForAccount } from "@/lib/domains/queries";
import { PLAN_LIMITS } from "@/lib/limits";
import { MCP_SCOPES } from "../constants";
import { MESSAGES, ToolFailure } from "../errors";
import { PageReadError, loadAccountPlan } from "../page-access";
import type { ToolDefinition } from "../types";
import { READ_ONLY } from "./common";

const input = z.strictObject({});

export const getDomains: ToolDefinition<typeof input> = {
  name: "get_domains",
  title: "List custom domains",
  description:
    "Lists the custom domains of this account: hostname, the page it points at, status (pending, verified or error), when it was verified, and for a pending domain the DNS records to add at the person's DNS provider, exactly as the app shows them. Also gives how many domains the plan allows. If the records can't be loaded it says so instead of guessing. It reads only and never starts a check. Custom domains are on Pro and Studio. Errors: server_error.",
  scope: MCP_SCOPES.read,
  annotations: READ_ONLY,
  input,
  page: "none",
  async handler(_args, call) {
    let views, plan;
    try {
      [views, plan] = await Promise.all([
        listDomainsForAccount(call.userId),
        loadAccountPlan(call.admin, call.userId),
      ]);
    } catch (error) {
      if (error instanceof PageReadError || error instanceof Error) {
        throw new ToolFailure("server_error", MESSAGES.serverError);
      }
      throw error;
    }
    const domains = views.map((view) => ({
      hostname: view.hostname,
      pageId: view.pageId,
      status: view.status,
      verifiedAt: view.verifiedAt,
      misconfigured: view.misconfigured,
      ...(view.status !== "verified" && !view.recordsUnavailable
        ? {
            dnsRecords: view.records.map((record) => ({
              type: record.type,
              name: record.name,
              value: record.value,
            })),
          }
        : {}),
      recordsUnavailable: view.recordsUnavailable,
      note: view.message,
    }));
    const max = PLAN_LIMITS[plan].customDomains;
    const sentence =
      domains.length === 0
        ? max === 0
          ? "Custom domains are on Pro and Studio."
          : "You have no custom domains."
        : `You have ${domains.length} custom ${domains.length === 1 ? "domain" : "domains"}: ${domains
            .map((domain) => `${domain.hostname} (${domain.status})`)
            .join(", ")}.`;
    return {
      sentence,
      data: { domains, limits: { customDomains: { used: domains.length, max } } },
    };
  },
};
