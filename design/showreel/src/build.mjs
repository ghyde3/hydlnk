// Builds index.html (16:9, 1920x1080) and tall.html (4:5, 1080x1350) from the shared CSS and
// script. Run: node src/build.mjs
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SRC, "..");
const fonts = readFileSync(join(ROOT, "assets/fonts/fonts.css"), "utf8");
const css = readFileSync(join(SRC, "reel.css"), "utf8");
const js = readFileSync(join(SRC, "reel.js"), "utf8");

const icon = {
  link: '<rect x="3.5" y="8" width="17" height="8" rx="2"/><path d="M8 12h8"/>',
  card: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 13.5h17M7 16.5h6"/>',
  header: '<path d="M6 5v14M18 5v14M6 12h12"/>',
  text: '<path d="M4 6.5h16M4 11h16M4 15.5h11"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8 8"/>',
  social: '<circle cx="6" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="18" cy="12" r="2.5"/>',
  embed: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M10.5 9.5v5l4.5-2.5z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  divider: '<path d="M3.5 12h17"/>',
};
const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const check = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';

const page = `
<div class="pg" id="pg" data-layout-ignore="true">
  <div class="pg-gradient" id="pg-gradient"></div>
  <div class="pg-photo" id="pg-photo"></div>
  <div class="pg-overlay" id="pg-overlay"></div>
  <i class="sel"><b></b><b></b><b></b><b></b></i>
  <div class="pg-col" id="pg-col">
    <div class="pg-avatar" id="pg-avatar"><img src="assets/img/fennmoor-avatar.webp" alt="" /></div>
    <div class="pg-name" id="pg-name"><span class="pg-head">Fennmoor Ceramics</span><i class="sel"><b></b><b></b><b></b><b></b></i></div>
    <div class="pg-bio" id="pg-bio">Small-batch stoneware, thrown and glazed by hand.</div>
    <div class="pg-social" id="pg-social">
      <i>${svg('<rect x="5" y="5" width="14" height="14" rx="4"/><circle cx="12" cy="12" r="3.2"/>')}</i>
      <i>${svg('<circle cx="12" cy="12" r="7.5"/><path d="M4.5 12h15M12 4.5c2 2.2 3 4.7 3 7.5s-1 5.3-3 7.5c-2-2.2-3-4.7-3-7.5s1-5.3 3-7.5z"/>')}</i>
      <i>${svg('<rect x="4.5" y="6.5" width="15" height="11" rx="1.5"/><path d="M5 7.5l7 5.5 7-5.5"/>')}</i>
    </div>
    <div class="pg-blocks">
      <div class="pg-link" id="pg-link1">Shop the spring kiln opening<i class="sel"><b></b><b></b><b></b><b></b></i></div>
      <div class="pg-link" id="pg-link2">Book a wheel class<i class="sel"><b></b><b></b><b></b><b></b></i></div>
      <div class="pg-card" id="pg-card"><i class="sel"><b></b><b></b><b></b><b></b></i>
        <div class="pg-card-banner"><div class="pg-card-scrim"></div><div class="pg-card-title"><span class="pg-head">Spring kiln</span></div></div>
        <div class="pg-card-foot"><span>New celadon and iron glazes</span><b>→</b></div>
      </div>
      <div class="pg-grid" id="pg-grid">
        <div class="pg-cell"><div class="pg-cell-t"><span class="pg-head">Classes</span></div><div class="pg-cell-s">Saturday mornings</div></div>
        <div class="pg-cell"><div class="pg-cell-t"><span class="pg-head">Commissions</span></div><div class="pg-cell-s">Open in May</div></div>
      </div>
    </div>
  </div>
</div>`;

const panel = `
<div class="panel" id="panel">
  <div class="panel-head"><span class="panel-title" id="panel-title">Theme · Ivory</span><span class="panel-count">Style</span></div>
  <div style="position:relative">
    <div class="row-hi" id="row-hi"></div>
    <div class="row-bar" id="row-bar"></div>
    <div class="row"><span class="row-k">Color</span><span class="row-v" id="v-accent"><span class="swatch" id="sw-accent"></span><span class="val">Ink</span></span></div>
    <div class="row"><span class="row-k">Font</span><span class="row-v" id="v-fontHeading"><span class="val">Fraunces</span></span></div>
    <div class="row"><span class="row-k">Corners</span><span class="row-v" id="v-radius"><span class="val">4 px</span></span></div>
    <div class="row"><span class="row-k">Buttons</span><span class="row-v" id="v-buttonStyle"><span class="val">Filled</span></span></div>
    <div class="row"><span class="row-k">Background</span><span class="row-v" id="v-background"><span class="val">Solid</span></span></div>
  </div>
</div>`;

const palette = `
<div class="palette" id="palette">
  ${["link", "card", "header", "text", "image", "social", "embed", "grid", "divider"]
    .map((k) => `<div class="chip" id="chip-${k}">${svg(icon[k])}${k[0].toUpperCase()}${k.slice(1)}</div>`)
    .join("\n  ")}
</div>
<div class="publish" id="publish">Publish</div>`;

const ticker = `
<div class="ticker" id="ticker"><span class="dot"></span><span class="tk-k" id="tk-k">Color</span><span class="tk-v" id="tk-v">Ink</span></div>`;

// alpha: the transparent cut for the site's "How it works" band. The base colour, dot grid, glow
// and vignette are hidden (the page paints them as CSS); every UI element stays.
const ALPHA_CSS = `
      html, body, #root { background: transparent !important; }
      #bg { display: none !important; }`;

function html({ format, width, height, alpha = false }) {
  const wide = format === "wide";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>HYDLNK showreel ${wide ? "16:9" : "4:5"}</title>
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
${fonts}
${css}
      html, body { width: ${width}px; height: ${height}px; }${alpha ? ALPHA_CSS : ""}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="24" data-width="${width}" data-height="${height}" data-fps="30">
      <div id="stage" class="clip" data-start="0" data-duration="24" data-track-index="0" data-layout-allow-overflow="true">
        <div id="bg"><div id="grid"></div><div id="glow"></div><div id="vignette"></div></div>

        <div class="hl" id="hA" data-layout-ignore="true"><div class="hl-line"><span>Make it look</span></div><div class="hl-line"><span>like <em>you.</em></span></div></div>
        <div class="hl" id="hB" data-layout-ignore="true"><div class="hl-line"><span>Your page.</span></div><div class="hl-line"><span><em>Your domain.</em></span></div></div>
        <div class="hl hl-center" id="hD" data-layout-ignore="true"><div class="hl-line"><span>Claim your <em>name.</em></span></div></div>
        <div class="hl" id="hE" data-layout-ignore="true"><div class="hl-line"><span>Build it</span></div><div class="hl-line"><span><em>with blocks.</em></span></div></div>
${wide ? panel + palette : ticker}

        <div class="device" id="device">
          <div class="speaker" id="speaker"></div>
          <div class="chrome" id="chrome">
            <div class="dots"><i></i><i></i><i></i></div>
            <div class="url">${svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>')}<span id="url-text"></span><span class="caret"></span></div>
            <div class="ssl" id="ssl">${svg(check)}SSL issued</div>
          </div>
          <div class="screen" id="screen">${page}
          </div>
        </div>

        <div class="ana" id="ana">
          <div class="ana-eyebrow"><span>Last 30 days</span><span>Sample data</span></div>
          <div class="ana-kpis">
            <div class="ana-kpi"><span>Views</span><b id="kpi-views">0</b></div>
            <div class="ana-kpi"><span>Clicks</span><b id="kpi-clicks">0</b></div>
            <div class="ana-kpi"><span>Click-through</span><b id="kpi-ctr">0.0%</b></div>
          </div>
          <div class="ana-bars" id="ana-bars">${"<i></i>".repeat(14)}</div>
        </div>

        <div class="live" id="live"><span class="led"></span>Live · fennmoor.hydlnk.com</div>

        <div class="ring" id="ring"></div>
        <div class="claim" id="claim">
          <div class="claim-screen" id="claim-screen"></div>
          <div class="claim-row" id="claim-row"><span class="claim-text" id="claim-text"></span><span class="claim-caret"></span><span class="claim-suffix">.hydlnk.com</span><span class="claim-btn" id="claim-btn">Claim it</span></div>
        </div>
        <div class="avail" id="avail">${svg(check)}Available</div>
      </div>
    </div>
    <script>
      window.REEL_FORMAT = "${format}";
${js}
    </script>
  </body>
</html>
`;
}

writeFileSync(join(ROOT, "index.html"), html({ format: "wide", width: 1920, height: 1080 }));
// Transparent variants, rendered with `render -c alpha.html` (see README).
writeFileSync(join(ROOT, "alpha.html"), html({ format: "wide", width: 1920, height: 1080, alpha: true }));
// The 4:5 cut is its own project (one root composition per project), sharing the assets.
const TALL = join(ROOT, "..", "showreel-tall");
mkdirSync(TALL, { recursive: true });
cpSync(join(ROOT, "assets"), join(TALL, "assets"), { recursive: true });
for (const file of ["hyperframes.json", "package.json", "design.md", "BRIEF.md"]) cpSync(join(ROOT, file), join(TALL, file));
writeFileSync(join(TALL, "index.html"), html({ format: "tall", width: 1080, height: 1350 }));
writeFileSync(join(TALL, "alpha.html"), html({ format: "tall", width: 1080, height: 1350, alpha: true }));
console.log("built index.html and ../showreel-tall/index.html");
