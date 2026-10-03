/** Why a preview-link call was refused. Shared by the actions, the dialog and the tests. */
export type PreviewLinkFailure =
  | "unauthorized"
  | "not_found"
  | "account_suspended"
  | "preview_link_limit"
  | "rate_limited"
  | "failed";

export interface PreviewLinkRefusal {
  ok: false;
  reason: PreviewLinkFailure;
  /** The HTTP status this refusal stands for (401, 404, 403, 409, 429, 500). */
  status: number;
  /** The sentence the dialog shows. */
  message: string;
}

/** A link as the owner sees it in the list: never the token, never the hash. */
export interface PreviewLinkSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export type CreatePreviewLinkResult =
  | {
      ok: true;
      id: string;
      /** The full address, http://app.localhost:3000/share/{token}: returned once, never stored. */
      url: string;
      expiresAt: string;
    }
  | PreviewLinkRefusal;

export type ListPreviewLinksResult = { ok: true; links: PreviewLinkSummary[] } | PreviewLinkRefusal;

export type RevokePreviewLinkResult = { ok: true } | PreviewLinkRefusal;
