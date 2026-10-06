import { z } from "zod";
import { publishFormsEqual } from "@/lib/document";
import { MCP_SCOPES } from "../constants";
import { applyThemeToDoc } from "@/lib/themes/apply-theme";
import { commitDraft } from "../commit";
import { themeView } from "../doc-view";
import { MESSAGES, ToolFailure } from "../errors";
import { PageReadError, listUsableThemes, type ThemeEntry } from "../page-access";
import { FONT_ALLOWLIST } from "@/lib/theme";
import { mergeTokenOverrides, themeIssueMessage } from "../theme-input";
import type { ToolDefinition } from "../types";
import { DRAFT_ONLY, WRITE_IDEMPOTENT, ifRevField, pageIdField } from "./common";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hex = z.string().max(12);
// Loose on purpose: a key that is not a style setting reaches `mergeTokenOverrides`, which names the
// settable ones by their plain labels, and a background-image key gets its own sentence.
const overridesInput = z
  .looseObject({
    bg: hex.describe("Page background color, hex like #1A2B3C."),
    surface: hex.describe("Color of cards and panels."),
    text: hex.describe("Text color."),
    textMuted: hex.describe("Secondary text color."),
    accent: hex.describe("Accent color."),
    buttonBg: hex.describe("Button color."),
    buttonText: hex.describe("Button text color."),
    border: hex.describe("Color of lines and borders."),
    fontHeading: z
      .enum(FONT_ALLOWLIST, { error: themeIssueMessage("fontHeading") })
      .describe("Heading font."),
    fontBody: z
      .enum(FONT_ALLOWLIST, { error: themeIssueMessage("fontBody") })
      .describe("Body font."),
    scale: z.number().describe("Text size, 0.8 to 1.3."),
    weightHeading: z.number().describe("Heading boldness: 400, 500, 600 or 700."),
    letterCase: z.string().max(20).describe("Capital letters: normal, uppercase or lowercase."),
    radius: z.number().describe("Corner radius, 0 to 32."),
    borderWidth: z.number().describe("Border thickness, 0 to 4."),
    buttonStyle: z.string().max(20).describe("fill, outline, soft, shadow or pill."),
    density: z.string().max(20).describe("Space between blocks: compact, regular or airy."),
    maxWidth: z.number().describe("Page width, 360 to 720."),
    align: z.string().max(20).describe("Text alignment: left or center."),
    bgType: z.string().max(20).describe("Background: solid or gradient."),
    gradientAngle: z
      .number()
      .describe("Gradient direction in degrees: 0, 45, 90, 135, 180, 225, 270 or 315."),
    gradientFrom: z
      .union([hex, z.null()])
      .describe("Gradient start color, or null to follow the page."),
    gradientTo: z
      .union([hex, z.null()])
      .describe("Gradient end color, or null to follow the page."),
  })
  .partial();

const input = z
  .strictObject({
    pageId: pageIdField,
    ifRev: ifRevField,
    theme: z
      .union([z.string().max(100), z.null()])
      .optional()
      .describe(
        "A theme's name (any letter case) or id, from the system themes and your saved themes. null removes the theme and uses the default look. Applying a theme clears the page's own style values.",
      ),
    overrides: overridesInput
      .optional()
      .describe("Style values to set on top of the theme, key by key."),
    clearOverrides: z.boolean().optional().describe("Remove the page's own style values first."),
  })
  .refine(
    (value) =>
      value.theme !== undefined || value.overrides !== undefined || value.clearOverrides === true,
    { error: "Send a theme, overrides or clearOverrides." },
  );

/** The theme a name or an id points at, among the themes the caller may use. */
function pickTheme(themes: ThemeEntry[], wanted: string): ThemeEntry {
  const typed = wanted.trim();
  const shown = typed.length > 80 ? `${typed.slice(0, 80)}…` : typed;
  const usable = themes.slice(0, 25).map((theme) => theme.name);
  const available = `Available: ${[...new Set(usable)].join(", ")}.`;
  if (UUID.test(typed)) {
    const byId = themes.find((theme) => theme.id.toLowerCase() === typed.toLowerCase());
    if (byId) return byId;
    throw new ToolFailure("theme_not_found", `No theme with that id. ${available}`);
  }
  const named = themes.filter((theme) => theme.name.trim().toLowerCase() === typed.toLowerCase());
  if (named.length === 1) return named[0]!;
  if (named.length > 1) {
    const candidates = named.slice(0, 5).map((theme) => ({
      id: theme.id,
      name: theme.name,
      kind: theme.system ? "system" : "saved",
    }));
    throw new ToolFailure("invalid_input", `Two themes are called “${shown}”. Use an id.`, {
      issues: [{ path: "theme", message: `Two themes are called “${shown}”. Use an id.` }],
      details: { candidates },
    });
  }
  throw new ToolFailure("theme_not_found", `No theme called “${shown}”. ${available}`);
}

export const setTheme: ToolDefinition<typeof input> = {
  name: "set_theme",
  title: "Change the theme",
  description: `Applies a theme to the draft by name or id (system themes and your own saved themes), and can set style values such as colors, fonts and corner radius on top. Applying a theme clears the page's own style values first. Send overrides alone to change single values, or clearOverrides to remove them. It does not create, change or delete saved themes, and it cannot set a background image. ${DRAFT_ONLY} Errors: theme_not_found, invalid_input, conflict.`,
  scope: MCP_SCOPES.write,
  annotations: WRITE_IDEMPOTENT,
  input,
  page: "one",
  async handler(args, call) {
    let themes: ThemeEntry[];
    try {
      themes = await listUsableThemes(call.admin, call.userId);
    } catch (error) {
      if (error instanceof PageReadError)
        throw new ToolFailure("server_error", MESSAGES.serverError);
      throw error;
    }
    const picked = typeof args.theme === "string" ? pickTheme(themes, args.theme) : null;

    const result = await commitDraft(call, args.ifRev, (doc) => {
      let next = doc;
      if (args.theme !== undefined) next = applyThemeToDoc(next, picked ? picked.id : null);
      if (args.clearOverrides === true) next = { ...next, theme: { ...next.theme, overrides: {} } };
      if (args.overrides !== undefined) {
        const overrides = mergeTokenOverrides(next.theme.overrides, args.overrides);
        next = { ...next, theme: { ...next.theme, overrides } };
      }
      if (publishFormsEqual(next.theme, doc.theme)) {
        return { kind: "unchanged", value: next.theme };
      }
      return { kind: "write", doc: next, value: next.theme };
    });

    const theme = result.unchanged ? result.doc.theme : result.value;
    const row = theme.ref ? (themes.find((item) => item.id === theme.ref) ?? null) : null;
    const view = themeView(theme, row);
    const sentence = result.unchanged
      ? "Nothing changed. The page already uses that look."
      : args.theme === null
        ? "Removed the theme. The page uses the default look."
        : picked
          ? `Applied the ${picked.name} theme.`
          : args.clearOverrides === true && args.overrides === undefined
            ? "Cleared the page’s own style values."
            : "Changed the page’s style values.";
    return {
      sentence,
      data: {
        theme: { kind: view.kind, id: view.id, name: view.name },
        overrides: view.overrides,
        rev: result.rev,
        unchanged: result.unchanged,
      },
    };
  },
};
