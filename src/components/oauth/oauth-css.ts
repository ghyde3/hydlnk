/**
 * The stylesheet of the OAuth screens (the consent screen and its message pages, M10-13). They are
 * route handlers that answer finished HTML (a handler can set the 303, the cookie and the 400 these
 * screens need, which a page cannot), and a handler cannot load the app's compiled Tailwind file or its
 * next/font files, so the few rules the screens use are written out here with the HYDLNK UI tokens of
 * docs/DESIGN.md. The values are the ones in src/app/globals.css (tests/unit/m10-oauth-consent-css.test.ts
 * fails when they drift). Tenant tokens never appear: this is HYDLNK's own UI.
 *
 * The font stack names Public Sans first (used when installed) and falls back to the system face; the
 * page makes no request to any other origin.
 */
export const OAUTH_CSS = `
:root{
  --hl-ink:#1c1b1a;
  --hl-text-2:#5e5a54;
  --hl-line:#e2dfd9;
  --hl-line-2:#d9d6d0;
  --hl-line-3:#c9c5be;
  --hl-page:#f4f3f0;
  --hl-track:#efede9;
  --hl-surface:#ffffff;
  --hl-brass:#b8914f;
  --hl-bad:#b23a2b;
  --hl-radius:6px;
  --hl-font-ui:"Public Sans",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --hl-font-mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--hl-page);color:var(--hl-ink);font-family:var(--hl-font-ui);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
:focus-visible{outline:2px solid var(--hl-brass);outline-offset:2px}
.page{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;padding:12px 16px 32px}
.top{width:100%;max-width:480px;min-height:44px;display:flex;align-items:center;margin-bottom:8px}
.brand{display:inline-flex;align-items:center;gap:10px;font-size:15px;font-weight:700;letter-spacing:.14em}
.brand i{display:inline-block;width:9px;height:9px;background:var(--hl-brass);transform:rotate(45deg)}
.card{width:100%;max-width:480px;background:var(--hl-surface);border:1px solid var(--hl-line);border-radius:var(--hl-radius);padding:20px 16px}
h1{margin:0;font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-.01em;overflow-wrap:anywhere}
p{margin:0}
.who{display:flex;align-items:center;gap:14px;margin-bottom:16px}
.avatar{flex:none;width:48px;height:48px;border-radius:50%;background:var(--hl-track);color:var(--hl-ink);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;overflow:hidden}
.avatar img{display:block;width:48px;height:48px}
.facts{margin:0 0 18px;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;color:var(--hl-text-2);font-size:15px;overflow-wrap:anywhere}
.facts li{margin:0}
.mono{font-family:var(--hl-font-mono);font-size:14px;color:var(--hl-ink);overflow-wrap:anywhere}
.notice{margin:0 0 16px;padding:12px;border:1px solid var(--hl-line-2);border-radius:var(--hl-radius);font-size:15px;color:var(--hl-ink);overflow-wrap:anywhere}
.notice.bad{border-color:var(--hl-bad);color:var(--hl-bad)}
.scopes{margin:0 0 12px;padding:0;border:0;min-width:0}
.scopes legend{padding:0;margin:0 0 8px;font-size:14px;font-weight:600;color:var(--hl-ink)}
.scope{position:relative;display:flex;gap:12px;align-items:flex-start;min-height:44px;margin:0 0 8px;padding:12px;background:var(--hl-surface);border:1px solid var(--hl-line-2);border-radius:var(--hl-radius);cursor:pointer}
.scope.fixed{cursor:default}
.scope input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:inherit}
.scope .box{flex:none;position:relative;width:20px;height:20px;margin-top:2px;border:1.5px solid var(--hl-line-3);border-radius:4px;background:var(--hl-surface)}
.scope input:checked + .box{background:var(--hl-ink);border-color:var(--hl-ink)}
.scope input:checked + .box::after{content:"";position:absolute;left:5px;top:1px;width:5px;height:10px;border:solid #f4f3f0;border-width:0 2px 2px 0;transform:rotate(45deg)}
.scope input:focus-visible + .box{outline:2px solid var(--hl-brass);outline-offset:2px}
.scope .text{display:flex;flex-direction:column;gap:2px;min-width:0}
.scope .title{font-size:15px;font-weight:600;overflow-wrap:anywhere}
.scope .hint{font-size:14px;color:var(--hl-text-2);overflow-wrap:anywhere}
.after{margin:4px 0 0;font-size:14px;color:var(--hl-text-2)}
.actions{display:flex;flex-direction:column;gap:12px;margin-top:20px}
.btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:48px;padding:0 16px;border-radius:var(--hl-radius);font:inherit;font-size:16px;font-weight:600;line-height:1.2;text-decoration:none;cursor:pointer}
.btn.primary{background:var(--hl-ink);color:#f4f3f0;border:1px solid var(--hl-ink)}
.btn.secondary{background:var(--hl-surface);color:var(--hl-ink);border:1px solid var(--hl-line-3)}
.stack{display:flex;flex-direction:column;gap:12px}
@media (min-width:760px){
  .page{justify-content:center;padding:48px 24px}
  .top{justify-content:center}
  .card{padding:28px 28px 24px}
  .actions{flex-direction:row-reverse;justify-content:flex-start}
  .btn{width:auto;min-width:120px}
}
`;
