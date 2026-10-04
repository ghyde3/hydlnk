import { z } from "zod";
import { clientEnv } from "@/lib/env/client";
import { createPreviewLinkCore } from "@/lib/previews/core";
import { PREVIEW_LINK_MESSAGES } from "@/lib/previews/messages";
import { appOrigin } from "@/lib/routing/urls";
import { ACCOUNT_SUSPENDED_MESSAGE } from "@/lib/admin/suspension";
import { MCP_SCOPES } from "../constants";
import { MESSAGES, ToolFailure } from "../errors";
import type { ToolDefinition } from "../types";
import { WRITE_NOT_IDEMPOTENT, pageIdField } from "./common";

const input = z.strictObject({ pageId: pageIdField });

export const createPreviewLink: ToolDefinition<typeof input> = {
  name: "create_preview_link",
  title: "Create a preview link",
  description:
    "Creates a private link that shows the saved draft of one page to anyone who has it, for 7 days, without signing in. Use it to let the person look at changes before publishing. The link is returned once, in this result only, and cannot be read again. A page can have 5 active links, and turning one off is done in the Share tab of the editor. It changes no page content. Not idempotent: each call makes a new link. Errors: preview_link_limit, rate_limited, not_found.",
  scope: MCP_SCOPES.write,
  annotations: WRITE_NOT_IDEMPOTENT,
  input,
  page: "one",
  async handler(_args, call) {
    const result = await createPreviewLinkCore(
      {
        admin: call.admin,
        isSuspended: call.deps.isSuspended,
        limit: call.deps.limit,
        appOrigin: appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN),
      },
      call.userId,
      call.page!.id,
    );
    if (!result.ok) {
      switch (result.reason) {
        case "not_found":
        case "unauthorized":
          throw new ToolFailure("not_found", MESSAGES.not_found);
        case "account_suspended":
          throw new ToolFailure("account_suspended", ACCOUNT_SUSPENDED_MESSAGE);
        case "preview_link_limit":
          throw new ToolFailure("preview_link_limit", PREVIEW_LINK_MESSAGES.preview_link_limit);
        case "rate_limited":
          throw new ToolFailure("rate_limited", PREVIEW_LINK_MESSAGES.rate_limited);
        default:
          throw new ToolFailure("server_error", MESSAGES.serverError);
      }
    }
    return {
      sentence: "Preview link created. It shows your saved draft for 7 days.",
      data: { url: result.url, expiresAt: result.expiresAt },
    };
  },
};
