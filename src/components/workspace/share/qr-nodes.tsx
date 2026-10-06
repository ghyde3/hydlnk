import { createElement, type ReactNode } from "react";
import type { SvgNode } from "@/lib/qr/styled-svg";

/**
 * The preview of a styled QR code (M9-25): the same nodes the downloadable SVG is written from
 * (`qrStyledDrawing`), as React elements, so what the card shows is what the file holds. Only the
 * four tags the maker produces exist, attribute names that React spells differently are mapped, and
 * the text of a `<text>` node goes in as React text (escaped by React, never as markup).
 */

const REACT_NAME: Record<string, string> = {
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "text-anchor": "textAnchor",
  "stroke-width": "strokeWidth",
  "shape-rendering": "shapeRendering",
  preserveAspectRatio: "preserveAspectRatio",
  lengthAdjust: "lengthAdjust",
  textLength: "textLength",
};

export function QrNodes({ nodes }: { nodes: readonly SvgNode[] }): ReactNode {
  return nodes.map((node, index) => {
    const props: Record<string, string | number> = { key: index };
    for (const [name, value] of node.attrs) props[REACT_NAME[name] ?? name] = value;
    return createElement(node.tag, props, node.text);
  });
}
