import { qrSvg, type QrCode } from "./generate";
import { moduleRuns, qrLayout, type QrLayout } from "./layout";
import { isDefaultAppearance, requireHex, type QrAppearance } from "./style";

/**
 * The downloadable SVG of a styled QR code (M9-25), as a list of nodes that both the file and the
 * Share tab's preview are made from. DOM-free and pure: numbers, two validated colors, a validated
 * picture and one escaped line of text go in, one string comes out.
 *
 * The file is one `<svg xmlns viewBox>` of `<rect>`, `<path>`, `<text>` and, when there is a logo, one
 * `<image>` whose `href` is a `data:image/png;base64,...` address the browser made from the loaded
 * picture. It holds no script, `foreignObject`, style, event attribute, `xlink:href` or address of
 * anything else: no `://` anywhere but the namespace. A drawing in the default look is exactly the
 * M6-31 file (`qrSvg`), byte for byte.
 */

export interface QrPicture {
  /** `data:image/png;base64,...`, at most 256 pixels on a side. */
  dataUrl: string;
  width: number;
  height: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const PICTURE_ADDRESS = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
/** A 256 by 256 PNG of a photograph is well under this once encoded (base64). */
export const PICTURE_ADDRESS_MAX = 400_000;

export type SvgAttrs = readonly (readonly [name: string, value: string | number])[];
export interface SvgNode {
  tag: "rect" | "path" | "text" | "image";
  attrs: SvgAttrs;
  /** The text of a `<text>` node: raw here, escaped when the file is written. */
  text?: string;
}

/** Is `value` a picture address this module will put in a file? */
export function isPictureAddress(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= PICTURE_ADDRESS_MAX && PICTURE_ADDRESS.test(value)
  );
}

// Lone surrogates and the two non-characters are not allowed in an XML document.
const SURROGATE_HIGH = String.fromCharCode(0xd800) + "-" + String.fromCharCode(0xdbff);
const SURROGATE_LOW = String.fromCharCode(0xdc00) + "-" + String.fromCharCode(0xdfff);
const NOT_XML = new RegExp(
  `[${SURROGATE_HIGH}](?![${SURROGATE_LOW}])|(?<![${SURROGATE_HIGH}])[${SURROGATE_LOW}]|[${String.fromCharCode(0xfffe)}${String.fromCharCode(0xffff)}]`,
  "g",
);

/**
 * Text for an XML attribute or text node: the five markup characters become entities, characters
 * XML cannot hold are dropped, and a colon before two slashes becomes `&#58;`, so no text of a
 * user's can ever read as an address in the file (it is still the same text when the file is drawn).
 */
export function escapeXml(text: string): string {
  return text
    .replace(NOT_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/:(?=\/\/)/g, "&#58;");
}

export interface StyledOptions {
  /** The loaded logo; null while it loads or when there is none (no plate is drawn then). */
  picture: QrPicture | null;
  measureText?: (text: string, size: number) => number;
}

export interface StyledDrawing {
  layout: QrLayout;
  nodes: SvgNode[];
}

/**
 * The nodes of a drawing that is not in the default look. Throws for a color that is not a hex
 * color. Without a `picture` the logo's plate is left out (the preview shows the code while the
 * picture loads).
 */
export function qrStyledDrawing(
  code: QrCode,
  appearance: QrAppearance,
  options: StyledOptions,
): StyledDrawing {
  const ink = requireHex(appearance.code);
  const field = requireHex(appearance.background);
  const picture =
    appearance.logo && isPictureAddress(options.picture?.dataUrl) ? options.picture : null;
  const layout = qrLayout(code, {
    frame: appearance.frame,
    frameText: appearance.frameText,
    logo: picture !== null,
    picture,
    measureText: options.measureText,
  });

  const nodes: SvgNode[] = [
    {
      tag: "rect",
      attrs: [
        ["width", layout.width],
        ["height", layout.height],
        ["fill", field],
      ],
    },
  ];
  if (layout.frame) {
    const { inset, thickness, radius } = layout.frame;
    nodes.push({
      tag: "rect",
      attrs: [
        ["x", inset],
        ["y", inset],
        ["width", layout.width - 2 * inset],
        ["height", layout.height - 2 * inset],
        ["rx", radius],
        ["fill", "none"],
        ["stroke", ink],
        ["stroke-width", thickness],
      ],
    });
  }
  nodes.push({
    tag: "path",
    attrs: [
      ["fill", ink],
      ["shape-rendering", "crispEdges"],
      [
        "d",
        moduleRuns(code, layout)
          .map((r) => `M${r.x0} ${r.y0}H${r.x1}V${r.y1}H${r.x0}z`)
          .join(""),
      ],
    ],
  });
  if (layout.plate) {
    nodes.push({
      tag: "rect",
      attrs: [
        ["x", layout.plate.x],
        ["y", layout.plate.y],
        ["width", layout.plate.width],
        ["height", layout.plate.height],
        ["fill", field],
        ["shape-rendering", "crispEdges"],
      ],
    });
  }
  if (layout.picture && picture) {
    nodes.push({
      tag: "image",
      attrs: [
        ["href", picture.dataUrl],
        ["x", layout.picture.x],
        ["y", layout.picture.y],
        ["width", layout.picture.width],
        ["height", layout.picture.height],
        ["preserveAspectRatio", "xMidYMid meet"],
      ],
    });
  }
  if (layout.text) {
    const { x, y, size, textLength, content } = layout.text;
    nodes.push({
      tag: "text",
      attrs: [
        ["x", x],
        ["y", y],
        ["fill", ink],
        ["font-family", "sans-serif"],
        ["font-size", size],
        ["font-weight", "700"],
        ["text-anchor", "middle"],
        ...(textLength === null
          ? []
          : ([
              ["textLength", textLength],
              ["lengthAdjust", "spacingAndGlyphs"],
            ] as const)),
      ],
      text: content,
    });
  }
  return { layout, nodes };
}

/** One node as markup: every value escaped, the text of a `<text>` node escaped. */
function serializeNode(node: SvgNode): string {
  const attrs = node.attrs
    .map(([name, value]) => ` ${name}="${escapeXml(String(value))}"`)
    .join("");
  return node.text === undefined
    ? `<${node.tag}${attrs}/>`
    : `<${node.tag}${attrs}>${escapeXml(node.text)}</${node.tag}>`;
}

/** The file for a drawing. */
export function serializeSvg({ layout, nodes }: StyledDrawing): string {
  return (
    `<svg xmlns="${SVG_NS}" viewBox="0 0 ${layout.width} ${layout.height}" ` +
    `width="${layout.width}" height="${layout.height}">` +
    nodes.map(serializeNode).join("") +
    `</svg>`
  );
}

/**
 * The SVG file of `code` in `appearance`. The default look is the M6-31 file, untouched (`qrSvg`);
 * anything else is made by `qrStyledDrawing`.
 */
export function buildQrSvg(
  code: QrCode,
  appearance: QrAppearance,
  options: StyledOptions = { picture: null },
): string {
  if (isDefaultAppearance(appearance)) return qrSvg(code);
  return serializeSvg(qrStyledDrawing(code, appearance, options));
}
