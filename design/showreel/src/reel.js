/*
 * HYDLNK showreel: one seamless 24 s loop, rendered at 16:9 ("wide") and 4:5 ("tall").
 *
 * Every visual state is a pure function of time. Each animated property is a keyframe track
 * (value + ease per segment); one GSAP tween drives `render(t)` across the whole duration, so any
 * frame can be rendered in any order. The state at t = 24 equals t = 0: frame 0 is the poster.
 *
 * Beats
 *   0.0 - 7.3   A  Theme morph: the token panel changes one token at a time; the page follows.
 *   7.3 - 13.0  B  Phone becomes a browser on links.yourbrand.com (SSL issued), sample analytics.
 *  12.8 - 15.0  C  Everything collapses into the brass diamond, which opens into the claim field.
 *  15.0 - 17.9  D  "yourname" is typed, it's available, Claim it; the field becomes the phone.
 *  17.9 - 24.0  E  The page is built block by block, published, and the panel returns (loop).
 */
(function () {
  "use strict";

  const FMT = window.REEL_FORMAT === "tall" ? "tall" : "wide";
  const DURATION = 24;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------------------
  // Layout (px on the canvas)
  // ---------------------------------------------------------------------------------------
  const L = {
    wide: {
      hl: { x: 120, y: 156, size: 104 },
      hlCenter: { y: 360, size: 96 },
      panel: { x: 120, y: 470, w: 600 },
      palette: { x: 120, y: 470, w: 600 },
      publish: { x: 120, y: 752, w: 600 },
      phone: { x: 1180, y: 88, w: 440, h: 904, k: 1.105 },
      browser: { x: 760, y: 120, w: 1060, h: 720, k: 0.97 },
      ana: { x: 560, y: 646, w: 600 },
      field: { cx: 960, cy: 620, w: 1080, h: 128 },
      avail: { x: 420, y: 712 },
      live: { cx: 1400, y: 22 },
      glowA: [1400, 540],
      glowB: [1290, 500],
      glowD: [960, 620],
    },
    tall: {
      hl: { x: 72, y: 80, size: 86 },
      hlCenter: { y: 470, size: 80 },
      ticker: { x: 72, y: 290, w: 936 },
      phone: { x: 315, y: 400, w: 450, h: 900, k: 1.131 },
      browser: { x: 54, y: 420, w: 972, h: 610, k: 0.95 },
      ana: { x: 120, y: 930, w: 840 },
      field: { cx: 540, cy: 700, w: 936, h: 120 },
      avail: { x: 72, y: 786 },
      live: { cx: 540, y: 316 },
      glowA: [540, 860],
      glowB: [540, 720],
      glowD: [540, 700],
    },
  }[FMT];

  // ---------------------------------------------------------------------------------------
  // Keyframe tracks
  // ---------------------------------------------------------------------------------------
  const easeCache = {};
  const ease = (name) => easeCache[name] || (easeCache[name] = gsap.parseEase(name));
  const lerp = (a, b, u) => a + (b - a) * u;
  function mix(a, b, u) {
    if (typeof a === "number") return lerp(a, b, u);
    if (Array.isArray(a)) return a.map((x, i) => lerp(x, b[i], u));
    return u < 1 ? a : b;
  }

  /** A track starts at v0 and holds each value until the next segment. Segments must be in order. */
  function track(v0) {
    const keys = [{ t: 0, v: v0, e: "none" }];
    const api = {
      to(t, dur, v, e) {
        const last = keys[keys.length - 1];
        if (t < last.t - 1e-6) throw new Error(`track segment at ${t}s starts before ${last.t}s`);
        if (t > last.t) keys.push({ t, v: last.v, e: "none" });
        keys.push({ t: t + Math.max(dur, 1e-4), v, e: e || "power2.inOut" });
        return api;
      },
      set(t, v) {
        return api.to(t, 1e-4, v, "none");
      },
      at(t) {
        if (t <= keys[0].t) return keys[0].v;
        for (let i = 1; i < keys.length; i += 1) {
          const k = keys[i];
          if (t < k.t) {
            const p = keys[i - 1];
            return mix(p.v, k.v, ease(k.e)((t - p.t) / (k.t - p.t)));
          }
        }
        return keys[keys.length - 1].v;
      },
    };
    return api;
  }

  /** Discrete value: the last entry whose time has passed. */
  function steps(list) {
    return (t) => {
      let v = list[0][1];
      for (const [at, value] of list) if (t >= at) v = value;
      return v;
    };
  }

  /** Seconds since the last change of a step list, and the previous value (for flips). */
  function stepInfo(list, t) {
    let i = 0;
    for (let j = 0; j < list.length; j += 1) if (t >= list[j][0]) i = j;
    return { value: list[i][1], prev: i > 0 ? list[i - 1][1] : list[i][1], since: t - list[i][0] };
  }

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgba = (h, a) => [...hex(h), a];
  const css = (c) =>
    c.length === 4
      ? `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3].toFixed(3)})`
      : `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // ---------------------------------------------------------------------------------------
  // Themes (HYDLNK system themes Ivory, Noir, Smoke, and a saved photo theme, "Kiln")
  // ---------------------------------------------------------------------------------------
  const THEMES = {
    ivory: { name: "Ivory", bg: "#F3EEE4", surface: "#E6DDCD", text: "#1B1814", muted: "#5E564B", accent: "#1B1814", btnBg: "#1B1814", btnText: "#F7F3EC", border: "#CCC7BF", font: "Fraunces", weight: 600, radius: 4, style: "fill", bgType: "solid", gap: 16 },
    noir: { name: "Noir", bg: "#16120E", surface: "#221B13", text: "#EFE8DC", muted: "#A79E90", accent: "#C9A86A", btnBg: "#C9A86A", btnText: "#15110B", border: "#3A342D", font: "Instrument Serif", weight: 400, radius: 12, style: "outline", bgType: "solid", gap: 12 },
    smoke: { name: "Smoke", bg: "#1C2023", surface: "#262C30", text: "#E6EAEC", muted: "#9AA4AA", accent: "#9DB3C4", btnBg: "#9DB3C4", btnText: "#15110B", border: "#404447", font: "Geist", weight: 600, radius: 20, style: "pill", bgType: "gradient", gap: 12 },
    kiln: { name: "Kiln", bg: "#17120D", surface: "#2A221A", text: "#F7F1E6", muted: "#DDD2C1", accent: "#E8D3B0", btnBg: "#E8D3B0", btnText: "#1A140E", border: "#5C4E40", font: "Fraunces", weight: 600, radius: 16, style: "soft", bgType: "image", gap: 12 },
  };
  const FONT_STACK = {
    Fraunces: '"Fraunces", serif',
    "Instrument Serif": '"Instrument Serif", serif',
    Geist: '"Geist", sans-serif',
  };
  const BTN_H = 62;

  function buttonVars(style, th, radius) {
    switch (style) {
      case "outline":
        return { bg: rgba(th.btnBg, 0), border: rgba(th.accent, 1), text: hex(th.text), radius, weight: 500 };
      case "soft":
        return { bg: rgba(th.btnBg, 0.2), border: rgba(th.btnBg, 0), text: hex(th.text), radius, weight: 500 };
      case "pill":
        return { bg: rgba(th.btnBg, 1), border: rgba(th.btnBg, 1), text: hex(th.btnText), radius: BTN_H / 2, weight: 600 };
      default:
        return { bg: rgba(th.btnBg, 1), border: rgba(th.btnBg, 1), text: hex(th.btnText), radius, weight: 600 };
    }
  }

  // Page variable tracks, starting in Ivory.
  const IV = THEMES.ivory;
  const ivBtn = buttonVars(IV.style, IV, IV.radius);
  const P = {
    bg: track(hex(IV.bg)),
    surface: track(hex(IV.surface)),
    text: track(hex(IV.text)),
    muted: track(hex(IV.muted)),
    accent: track(hex(IV.accent)),
    border: track(hex(IV.border)),
    scrim: track(rgba(IV.bg, 0.9)),
    radius: track(IV.radius),
    gap: track(IV.gap),
    btnBg: track(ivBtn.bg),
    btnBorder: track(ivBtn.border),
    btnText: track(ivBtn.text),
    btnRadius: track(ivBtn.radius),
    btnWeight: track(ivBtn.weight),
    glow: track(rgba(IV.accent, 0)),
    grad: track(0),
    photo: track(0),
    blur: track(14),
    overlay: track(0),
    headFade: track(1),
    headY: track(0),
  };

  const FONT_STEPS = [[0, IV.font]];
  const WEIGHT_STEPS = [[0, IV.weight]];

  // Panel values per row and the theme title, as step lists.
  const ROWS = ["accent", "fontHeading", "radius", "buttonStyle", "background"];
  const rowValue = (th, row) =>
    ({ accent: th.accent, fontHeading: th.font, radius: String(th.radius), buttonStyle: th.style, background: th.bgType })[row];
  const ROW_STEPS = Object.fromEntries(ROWS.map((row) => [row, [[0, rowValue(IV, row)]]]));
  const TITLE_STEPS = [[0, `Theme · ${IV.name}`]];
  const MARKER_STEPS = [[0, 0]]; // active row index
  const TICKER_STEPS = [[0, ["accent", IV.accent]]];

  // Selection boxes: the page element a token beat changes is outlined while it changes.
  const SEL = { name: track(0), card: track(0), links: track(0), bg: track(0) };
  const flashSel = (key, at, hold) => SEL[key].to(at - 0.06, 0.14, 1, "power2.out").to(at + hold, 0.28, 0, "power2.in");

  /** One theme change, token by token: colours, font, radius, button style, background. */
  function morph(T, from, to) {
    const C = 0.7;
    // 1. Colours (accent row)
    for (const key of ["bg", "surface", "text", "muted", "accent", "border"]) P[key].to(T, C, hex(to[key]), "power2.inOut");
    P.scrim.to(T, C, rgba(to.bg, 0.9), "power2.inOut");
    const keepStyle = buttonVars(from.style, to, from.style === "pill" ? BTN_H / 2 : from.radius);
    P.btnBg.to(T, C, keepStyle.bg, "power2.inOut");
    P.btnBorder.to(T, C, keepStyle.border, "power2.inOut");
    P.btnText.to(T, C, keepStyle.text, "power2.inOut");
    TITLE_STEPS.push([T, `Theme · ${to.name}`]);
    ROW_STEPS.accent.push([T, to.accent]);
    MARKER_STEPS.push([T, 0]);
    TICKER_STEPS.push([T, ["accent", `${from.accent} → ${to.accent}`]]);

    // 2. Heading font (fontHeading row)
    const F = T + 0.45;
    P.headFade.to(F, 0.16, 0, "power2.in").to(F + 0.17, 0.3, 1, "power2.out");
    P.headY.to(F, 0.16, -10, "power2.in").set(F + 0.165, 12).to(F + 0.17, 0.34, 0, "expo.out");
    FONT_STEPS.push([F + 0.165, to.font]);
    flashSel("name", F, 0.5);
    WEIGHT_STEPS.push([F + 0.165, to.weight]);
    ROW_STEPS.fontHeading.push([F + 0.12, to.font]);
    MARKER_STEPS.push([F, 1]);
    TICKER_STEPS.push([F, ["fontHeading", `${from.font} → ${to.font}`]]);

    // 3. Radius and density (radius row)
    const R = T + 0.9;
    P.radius.to(R, 0.5, to.radius, "expo.inOut");
    P.gap.to(R, 0.5, to.gap, "expo.inOut");
    P.btnRadius.to(R, 0.5, from.style === "pill" ? BTN_H / 2 : to.radius, "expo.inOut");
    ROW_STEPS.radius.push([R, String(to.radius)]);
    flashSel("card", R, 0.42);
    MARKER_STEPS.push([R, 2]);
    TICKER_STEPS.push([R, ["radius", `${from.radius} → ${to.radius}`]]);

    // 4. Button style (buttonStyle row)
    const B = T + 1.25;
    const next = buttonVars(to.style, to, to.radius);
    P.btnBg.to(B, 0.45, next.bg, "power2.inOut");
    P.btnBorder.to(B, 0.45, next.border, "power2.inOut");
    P.btnText.to(B, 0.45, next.text, "power2.inOut");
    P.btnRadius.to(R + 0.5, 0.45, next.radius, "expo.inOut");
    P.btnWeight.to(B, 0.45, next.weight, "power2.inOut");
    ROW_STEPS.buttonStyle.push([B, to.style]);
    flashSel("links", B, 0.45);
    MARKER_STEPS.push([B, 3]);
    TICKER_STEPS.push([B, ["buttonStyle", `${from.style} → ${to.style}`]]);

    // 5. Background (background row), when it changes
    if (to.bgType !== from.bgType) {
      const G = T + 1.6;
      P.glow.to(G, 0.6, rgba(to.accent, to.bgType === "gradient" ? 0.42 : 0), "power2.inOut");
      P.grad.to(G, 0.6, to.bgType === "gradient" ? 1 : 0, "power2.inOut");
      P.photo.to(G, 0.7, to.bgType === "image" ? 1 : 0, "power2.inOut");
      P.overlay.to(G, 0.7, to.bgType === "image" ? 0.56 : 0, "power2.inOut");
      P.blur.to(G, 0.9, to.bgType === "image" ? 5 : 14, "expo.out");
      ROW_STEPS.background.push([G, to.bgType]);
      flashSel("bg", G, 0.7);
      MARKER_STEPS.push([G, 4]);
      TICKER_STEPS.push([G, ["background", `${from.bgType} → ${to.bgType}`]]);
    }
  }

  const A1 = 0.8;
  const A2 = 3.0;
  const A3 = 5.2;
  morph(A1, THEMES.ivory, THEMES.noir);
  morph(A2, THEMES.noir, THEMES.smoke);
  morph(A3, THEMES.smoke, THEMES.kiln);

  // Reset the page to Ivory while it is out of sight (between the collapse and the build).
  const RESET = 15.0;
  for (const key of ["bg", "surface", "text", "muted", "accent", "border"]) P[key].set(RESET, hex(IV[key]));
  P.scrim.set(RESET, rgba(IV.bg, 0.9));
  P.radius.set(RESET, IV.radius);
  P.gap.set(RESET, IV.gap);
  P.btnBg.set(RESET, ivBtn.bg);
  P.btnBorder.set(RESET, ivBtn.border);
  P.btnText.set(RESET, ivBtn.text);
  P.btnRadius.set(RESET, ivBtn.radius);
  P.btnWeight.set(RESET, ivBtn.weight);
  P.glow.set(RESET, rgba(IV.accent, 0));
  P.grad.set(RESET, 0);
  P.photo.set(RESET, 0);
  P.overlay.set(RESET, 0);
  P.blur.set(RESET, 14);
  FONT_STEPS.push([RESET, IV.font]);
  WEIGHT_STEPS.push([RESET, IV.weight]);
  TITLE_STEPS.push([RESET, `Theme · ${IV.name}`]);
  for (const row of ROWS) ROW_STEPS[row].push([RESET, rowValue(IV, row)]);
  MARKER_STEPS.push([RESET, 0]);

  // ---------------------------------------------------------------------------------------
  // Headlines: each line rises out of a mask; exits upward.
  // ---------------------------------------------------------------------------------------
  const HEADLINES = {};
  function headline(id, schedule, startShown = false) {
    const lines = Array.from($(id).querySelectorAll(".hl-line > span"));
    HEADLINES[id] = lines.map((line, i) => {
      const y = track(startShown ? 0 : 135);
      for (const [kind, at] of schedule) {
        if (kind === "in") y.set(at + i * 0.08 - 0.002, 135).to(at + i * 0.08, 0.7, 0, "expo.out");
        else y.to(at + i * 0.05, 0.42, -150, "power3.in");
      }
      return { line, y };
    });
  }
  headline("hA", [["out", 7.3], ["in", 22.72]], true);
  headline("hB", [["in", 8.15], ["out", 12.5]]);
  headline("hD", [["in", 14.95], ["out", 17.0]]);
  headline("hE", [["in", 17.95], ["out", 22.25]]);

  // ---------------------------------------------------------------------------------------
  // Panel (wide), ticker (tall), palette (wide), publish, live chip
  // ---------------------------------------------------------------------------------------
  const panelO = track(1).to(7.25, 0.4, 0, "power2.in").to(22.8, 0.55, 1, "power2.out");
  const panelX = track(0).to(7.25, 0.45, -56, "power3.in").set(15, 40).to(22.8, 0.75, 0, "expo.out");

  const tickerO = track(1).to(7.25, 0.35, 0, "power2.in").to(17.95, 0.4, 1, "power2.out");
  const tickerY = track(0).to(7.25, 0.4, -20, "power3.in").set(15, 24).to(17.95, 0.6, 0, "expo.out");

  // Build order: [time, block id, palette chip id or null, ticker label]
  const BUILD = [
    [18.25, "pg-avatar", null, "+ Profile"],
    [18.35, "pg-name", null, null],
    [18.45, "pg-bio", null, null],
    [18.8, "pg-social", "chip-social", "+ Social"],
    [19.15, "pg-link1", "chip-link", "+ Link"],
    [19.47, "pg-link2", "chip-link", "+ Link"],
    [19.82, "pg-card", "chip-card", "+ Card"],
    [20.22, "pg-grid", "chip-grid", "+ Grid"],
  ];
  TICKER_STEPS.push([RESET, ["blocks", "Add a block"]]);
  for (const [at, , , label] of BUILD) if (label) TICKER_STEPS.push([at - 0.15, ["blocks", label]]);
  TICKER_STEPS.push([21.05, ["publish", "fennmoor.hydlnk.com ✓"]]);
  TICKER_STEPS.push([22.8, ["accent", IV.accent]]);

  const blockTracks = BUILD.map(([at, id]) => ({
    el: $(id),
    o: track(1).set(RESET, 0).to(at, 0.35, 1, "power2.out"),
    y: track(0).set(RESET, 30).to(at, 0.6, 0, "expo.out"),
    s: track(1).set(RESET, 0.94).to(at, 0.6, 1, "back.out(1.6)"),
  }));

  const chipIds = ["chip-link", "chip-card", "chip-header", "chip-text", "chip-image", "chip-social", "chip-embed", "chip-grid", "chip-divider"];
  const chipTracks = chipIds.map((id, i) => {
    const el = $(id);
    if (!el) return null;
    const flash = track(0);
    const windows = [];
    for (const [at, , chip] of BUILD) {
      if (chip !== id) continue;
      const last = windows[windows.length - 1];
      if (last && at - 0.22 <= last[1] + 0.35) last[1] = at + 0.3;
      else windows.push([at - 0.22, at + 0.3]);
    }
    for (const [on, off] of windows) flash.to(on, 0.12, 1, "power2.out").to(off, 0.35, 0, "power2.inOut");
    return {
      el,
      o: track(0).to(18.0 + i * 0.045, 0.35, 1, "power2.out").to(22.25 + i * 0.03, 0.3, 0, "power2.in"),
      y: track(24).to(18.0 + i * 0.045, 0.6, 0, "expo.out").to(22.25 + i * 0.03, 0.35, 16, "power2.in"),
      flash,
    };
  }).filter(Boolean);

  const publishO = track(0).to(20.7, 0.35, 1, "power2.out").to(22.25, 0.3, 0, "power2.in");
  const publishY = track(20).to(20.7, 0.55, 0, "expo.out");
  const publishS = track(1).to(21.0, 0.1, 0.95, "power2.out").to(21.1, 0.35, 1, "back.out(2)");
  const liveO = FMT === "wide" ? track(0).to(21.3, 0.3, 1, "power2.out").to(22.4, 0.35, 0, "power2.in") : track(0);
  const liveS = track(0.86).to(21.3, 0.5, 1, "back.out(2)");

  // ---------------------------------------------------------------------------------------
  // Device: phone -> browser -> collapse; reappears from the claim field
  // ---------------------------------------------------------------------------------------
  const ph = L.phone;
  const br = L.browser;
  const dev = {
    x: track(ph.x).to(7.75, 1.25, br.x, "expo.inOut").set(RESET, ph.x),
    y: track(ph.y).to(7.75, 1.25, br.y, "expo.inOut").set(RESET, ph.y),
    w: track(ph.w).to(7.75, 1.25, br.w, "expo.inOut").set(RESET, ph.w),
    h: track(ph.h).to(7.75, 1.25, br.h, "expo.inOut").set(RESET, ph.h),
    r: track(60).to(7.75, 1.25, 18, "expo.inOut").set(RESET, 60),
    inset: track(10).to(7.75, 1.25, 0, "expo.inOut").set(RESET, 10),
    top: track(10).to(7.75, 1.25, 64, "expo.inOut").set(RESET, 10),
    sr: track(50).to(7.75, 1.25, 0, "expo.inOut").set(RESET, 50),
    k: track(ph.k).to(7.75, 1.25, br.k, "expo.inOut").set(RESET, ph.k),
    chrome: track(0).to(8.55, 0.45, 1, "power2.out").set(RESET, 0),
    speaker: track(1).to(7.75, 0.3, 0, "power2.in").set(RESET, 1),
    // Collapse toward the mark at the field centre, then hidden until the claim field hands over.
    s: track(1).to(12.75, 0.75, 0.05, "power3.in").set(RESET, 1),
    o: track(1).to(13.15, 0.3, 0, "power2.in").set(17.9, 1),
  };
  const urlText = "links.yourbrand.com";
  const urlTyped = track(0).to(9.2, 0.95, urlText.length, "none").set(RESET, 0);
  const sslO = track(0).to(10.2, 0.3, 1, "power2.out").set(RESET, 0);
  const sslS = track(0.7).to(10.2, 0.5, 1, "back.out(2.2)").set(RESET, 0.7);

  // Analytics card (sample data)
  const anaO = track(0).to(10.45, 0.45, 1, "power2.out").to(12.5, 0.35, 0, "power2.in");
  const anaY = track(70).to(10.45, 0.8, 0, "expo.out").to(12.5, 0.4, 24, "power2.in");
  const KPIS = [
    ["kpi-views", 12480, (v) => Math.round(v).toLocaleString("en-US")],
    ["kpi-clicks", 3906, (v) => Math.round(v).toLocaleString("en-US")],
    ["kpi-ctr", 31.3, (v) => `${v.toFixed(1)}%`],
  ];
  const kpiTrack = track(0).to(10.75, 1.15, 1, "power3.out").set(RESET, 0);
  const BAR_HEIGHTS = [0.34, 0.46, 0.41, 0.58, 0.52, 0.66, 0.6, 0.72, 0.64, 0.81, 0.74, 0.88, 0.79, 1];
  const barTracks = BAR_HEIGHTS.map((h, i) => track(0).to(10.85 + i * 0.045, 0.6, h, "expo.out").set(RESET, 0));

  // ---------------------------------------------------------------------------------------
  // The mark: diamond -> claim field -> phone bezel
  // ---------------------------------------------------------------------------------------
  const F = L.field;
  const brass = rgba("#B8914F", 1);
  const claim = {
    o: track(0).set(13.28, 1).set(17.9, 0),
    s: track(0).to(13.28, 0.5, 1, "back.out(2.4)"),
    rot: track(45).to(13.28, 1.0, 225, "power3.inOut").to(14.3, 0.55, 360, "expo.inOut"),
    cx: track(F.cx).to(17.1, 0.8, ph.x + ph.w / 2, "expo.inOut"),
    cy: track(F.cy).to(17.1, 0.8, ph.y + ph.h / 2, "expo.inOut"),
    w: track(46).to(14.55, 0.6, F.w, "expo.inOut").to(17.1, 0.8, ph.w, "expo.inOut"),
    h: track(46).to(14.55, 0.6, F.h, "expo.inOut").to(17.1, 0.8, ph.h, "expo.inOut"),
    r: track(5).to(14.55, 0.6, 16, "expo.inOut").to(17.1, 0.8, 60, "expo.inOut"),
    bg: track(brass).to(14.5, 0.5, rgba("#242220", 1), "power2.inOut").to(17.1, 0.8, rgba("#0F0E0D", 1), "power2.inOut"),
    bw: track(0).to(14.5, 0.5, 3, "power2.inOut").to(17.1, 0.8, 2, "power2.inOut"),
    bc: track(brass).to(17.1, 0.8, rgba("#46423C", 1), "power2.inOut"),
    content: track(0).to(14.95, 0.3, 1, "power2.out").to(17.0, 0.18, 0, "power2.in"),
    screen: track(0).to(17.45, 0.4, 1, "power2.inOut"),
    btnS: track(1).to(16.68, 0.09, 0.93, "power2.out").to(16.77, 0.35, 1, "back.out(2.4)"),
  };
  const typed = "yourname";
  const claimTyped = track(0).to(15.38, 0.82, typed.length, "none");
  const ring = {
    o: track(0).set(13.82, 0.85).to(13.83, 0.74, 0, "power2.out"),
    s: track(1).to(13.82, 0.75, 4.2, "expo.out"),
  };
  const availO = track(0).to(16.32, 0.3, 1, "power2.out").to(17.0, 0.2, 0, "power2.in");
  const availY = track(12).to(16.32, 0.5, 0, "back.out(2)");

  // Background glow follows the action.
  const glowX = track(L.glowA[0]).to(7.6, 1.4, L.glowB[0]).to(12.7, 1.0, L.glowD[0]).to(17.1, 0.9, L.glowA[0]);
  const glowY = track(L.glowA[1]).to(7.6, 1.4, L.glowB[1]).to(12.7, 1.0, L.glowD[1]).to(17.1, 0.9, L.glowA[1]);

  // ---------------------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------------------
  const el = {
    root: $("root"),
    grid: $("grid"),
    glow: $("glow"),
    device: $("device"),
    chrome: $("chrome"),
    speaker: $("speaker"),
    screen: $("screen"),
    pg: $("pg"),
    col: $("pg-col"),
    grad: $("pg-gradient"),
    photo: $("pg-photo"),
    overlay: $("pg-overlay"),
    urlText: $("url-text"),
    ssl: $("ssl"),
    ana: $("ana"),
    bars: Array.from(document.querySelectorAll("#ana-bars i")),
    claim: $("claim"),
    claimRow: $("claim-row"),
    claimText: $("claim-text"),
    claimBtn: $("claim-btn"),
    claimScreen: $("claim-screen"),
    ring: $("ring"),
    avail: $("avail"),
    panel: $("panel"),
    panelTitle: $("panel-title"),
    rowHi: $("row-hi"),
    rowBar: $("row-bar"),
    ticker: $("ticker"),
    tickerK: $("tk-k"),
    tickerV: $("tk-v"),
    publish: $("publish"),
    live: $("live"),
    heads: Array.from(document.querySelectorAll(".pg-head")),
    sel: {
      name: Array.from(document.querySelectorAll("#pg-name > .sel")),
      card: Array.from(document.querySelectorAll("#pg-card > .sel")),
      links: Array.from(document.querySelectorAll(".pg-link > .sel")),
      bg: Array.from(document.querySelectorAll("#pg > .sel")),
    },
  };
  const rowValueEls = Object.fromEntries(ROWS.map((row) => [row, $(`v-${row}`)]));
  const rowSwatch = $("sw-accent");
  const fontAt = steps(FONT_STEPS);
  const weightAt = steps(WEIGHT_STEPS);
  const titleAt = steps(TITLE_STEPS);
  const markerAt = steps(MARKER_STEPS);

  function setVar(name, value) {
    el.pg.style.setProperty(name, value);
  }

  function render(t) {
    // Background: a one-cell grid drift and a slow circular glow drift, both whole cycles.
    const cycle = (t / DURATION) * Math.PI * 2;
    const gx = glowX.at(t) + Math.cos(cycle) * 40;
    const gy = glowY.at(t) + Math.sin(cycle) * 30;
    const gs = 1 + Math.sin(cycle * 2) * 0.05;
    el.glow.style.transform = `translate(${gx - 600}px, ${gy - 600}px) scale(${gs})`;

    // Page tokens
    setVar("--t-bg", css(P.bg.at(t)));
    setVar("--t-surface", css(P.surface.at(t)));
    setVar("--t-text", css(P.text.at(t)));
    setVar("--t-muted", css(P.muted.at(t)));
    setVar("--t-accent", css(P.accent.at(t)));
    setVar("--t-border", css(P.border.at(t)));
    setVar("--t-scrim", css(P.scrim.at(t)));
    setVar("--t-radius", `${P.radius.at(t).toFixed(2)}px`);
    setVar("--t-gap", `${P.gap.at(t).toFixed(2)}px`);
    setVar("--t-btn-bg", css(P.btnBg.at(t)));
    setVar("--t-btn-border", css(P.btnBorder.at(t)));
    setVar("--t-btn-text", css(P.btnText.at(t)));
    setVar("--t-btn-radius", `${P.btnRadius.at(t).toFixed(2)}px`);
    setVar("--t-btn-weight", String(Math.round(P.btnWeight.at(t))));
    setVar("--t-glow", css(P.glow.at(t)));
    setVar("--t-font-heading", FONT_STACK[fontAt(t)]);
    setVar("--t-weight", String(weightAt(t)));
    el.grad.style.opacity = String(P.grad.at(t));
    el.photo.style.opacity = String(P.photo.at(t));
    el.photo.style.filter = `blur(${P.blur.at(t).toFixed(2)}px)`;
    el.overlay.style.opacity = String(P.overlay.at(t));
    const hf = P.headFade.at(t);
    const hy = P.headY.at(t);
    for (const head of el.heads) {
      head.style.opacity = String(hf);
      head.style.transform = `translateY(${hy.toFixed(2)}px)`;
    }

    // Selection boxes
    for (const [key, nodes] of Object.entries(el.sel)) {
      const o = String(SEL[key].at(t));
      for (const node of nodes) node.style.opacity = o;
    }

    // Blocks
    for (const b of blockTracks) {
      b.el.style.opacity = String(b.o.at(t));
      b.el.style.transform = `translateY(${b.y.at(t).toFixed(2)}px) scale(${b.s.at(t).toFixed(4)})`;
    }

    // Device
    const dw = dev.w.at(t);
    const dh = dev.h.at(t);
    const dx = dev.x.at(t);
    const dy = dev.y.at(t);
    const ds = dev.s.at(t);
    // While collapsing, travel toward the field centre.
    const collapse = clamp01((t - 12.75) / 0.75);
    const pull = t >= RESET ? 0 : ease("power3.in")(collapse);
    const tx = (F.cx - (dx + dw / 2)) * pull;
    const ty = (F.cy - (dy + dh / 2)) * pull;
    Object.assign(el.device.style, {
      left: `${dx}px`,
      top: `${dy}px`,
      width: `${dw}px`,
      height: `${dh}px`,
      borderRadius: `${dev.r.at(t)}px`,
      opacity: String(dev.o.at(t)),
      transform: `translate(${tx}px, ${ty}px) scale(${ds})`,
    });
    const inset = dev.inset.at(t);
    Object.assign(el.screen.style, {
      left: `${inset}px`,
      right: `${inset}px`,
      bottom: `${inset}px`,
      top: `${dev.top.at(t)}px`,
      borderRadius: `${dev.sr.at(t)}px`,
    });
    el.chrome.style.opacity = String(dev.chrome.at(t));
    el.speaker.style.opacity = String(dev.speaker.at(t));
    el.col.style.transform = `scale(${dev.k.at(t).toFixed(4)})`;
    const n = Math.round(urlTyped.at(t));
    el.urlText.textContent = urlText.slice(0, n);
    el.ssl.style.opacity = String(sslO.at(t));
    el.ssl.style.transform = `scale(${sslS.at(t)})`;

    // Analytics
    el.ana.style.opacity = String(anaO.at(t));
    el.ana.style.transform = `translateY(${anaY.at(t)}px)`;
    const kp = kpiTrack.at(t);
    for (const [id, value, fmt] of KPIS) $(id).textContent = fmt(value * kp);
    el.bars.forEach((bar, i) => {
      bar.style.transform = `scaleY(${barTracks[i].at(t).toFixed(4)})`;
    });

    // Mark / claim field / bezel
    const cw = claim.w.at(t);
    const ch = claim.h.at(t);
    Object.assign(el.claim.style, {
      opacity: String(claim.o.at(t)),
      left: `${claim.cx.at(t) - cw / 2}px`,
      top: `${claim.cy.at(t) - ch / 2}px`,
      width: `${cw}px`,
      height: `${ch}px`,
      borderRadius: `${claim.r.at(t)}px`,
      background: css(claim.bg.at(t)),
      borderWidth: `${claim.bw.at(t)}px`,
      borderColor: css(claim.bc.at(t)),
      transform: `rotate(${claim.rot.at(t)}deg) scale(${claim.s.at(t)})`,
    });
    el.claimRow.style.opacity = String(claim.content.at(t));
    el.claimText.textContent = typed.slice(0, Math.round(claimTyped.at(t)));
    el.claimBtn.style.transform = `scale(${claim.btnS.at(t)})`;
    el.claimScreen.style.opacity = String(claim.screen.at(t));
    el.ring.style.opacity = String(ring.o.at(t));
    el.ring.style.transform = `rotate(45deg) scale(${ring.s.at(t)})`;
    el.avail.style.opacity = String(availO.at(t));
    el.avail.style.transform = `translateY(${availY.at(t)}px)`;

    // Headlines
    for (const id of Object.keys(HEADLINES)) {
      for (const { line, y } of HEADLINES[id]) {
        const v = y.at(t);
        line.style.transform = `translateY(${v.toFixed(2)}%) rotate(${(v * 0.035).toFixed(3)}deg)`;
      }
    }

    // Token panel (wide)
    if (el.panel) {
      el.panel.style.opacity = String(panelO.at(t));
      el.panel.style.transform = `translateX(${panelX.at(t)}px)`;
      el.panelTitle.textContent = titleAt(t);
      for (const row of ROWS) {
        const info = stepInfo(ROW_STEPS[row], t);
        const valueEl = rowValueEls[row];
        const u = clamp01(info.since / 0.32);
        const flip = info.since < 0.32 && info.value !== info.prev;
        valueEl.querySelector(".val").textContent = info.value;
        valueEl.style.transform = flip ? `translateY(${((1 - ease("expo.out")(u)) * 26).toFixed(2)}px)` : "";
        valueEl.style.opacity = flip ? String(0.25 + 0.75 * u) : "1";
      }
      rowSwatch.style.background = css(P.accent.at(t));
      const marker = markerAt(t);
      const mInfo = stepInfo(MARKER_STEPS, t);
      const mu = ease("expo.out")(clamp01(mInfo.since / 0.4));
      const fromY = mInfo.prev * 74;
      const toY = marker * 74;
      const my = lerp(fromY, toY, mu);
      el.rowHi.style.transform = `translateY(${my}px)`;
      el.rowBar.style.transform = `translateY(${my}px)`;
    }

    // Ticker (tall)
    if (el.ticker) {
      el.ticker.style.opacity = String(tickerO.at(t));
      const info = stepInfo(TICKER_STEPS, t);
      const [k, v] = info.value;
      el.tickerK.textContent = k;
      el.tickerV.textContent = v;
      const u = clamp01(info.since / 0.3);
      const changed = info.since < 0.3 && info.value !== info.prev;
      const lift = changed ? (1 - ease("expo.out")(u)) * 18 : 0;
      el.ticker.style.transform = `translateY(${(tickerY.at(t) + lift).toFixed(2)}px)`;
    }

    // Palette, publish, live (wide palette; publish and live in both where present)
    for (const c of chipTracks) {
      const f = c.flash.at(t);
      c.el.style.opacity = String(c.o.at(t));
      c.el.style.transform = `translateY(${c.y.at(t)}px)`;
      c.el.style.borderColor = css(mix(hex("#45413B"), hex("#B8914F"), f));
      c.el.style.background = css(mix(hex("#2A2825"), hex("#3B3226"), f));
    }
    if (el.publish) {
      el.publish.style.opacity = String(publishO.at(t));
      el.publish.style.transform = `translateY(${publishY.at(t)}px) scale(${publishS.at(t)})`;
    }
    el.live.style.opacity = String(liveO.at(t));
    el.live.style.transform = `translateX(-50%) scale(${liveS.at(t)})`;
  }

  // ---------------------------------------------------------------------------------------
  // Static layout from L, then the driver timeline.
  // ---------------------------------------------------------------------------------------
  function place(node, x, y, w) {
    if (!node) return;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    if (w !== undefined) node.style.width = `${w}px`;
  }
  for (const id of ["hA", "hB", "hE"]) {
    place($(id), L.hl.x, L.hl.y);
    $(id).style.fontSize = `${L.hl.size}px`;
  }
  const hD = $("hD");
  hD.style.left = "0px";
  hD.style.width = "100%";
  hD.style.top = `${L.hlCenter.y}px`;
  hD.style.fontSize = `${L.hlCenter.size}px`;
  if (L.panel) place(el.panel, L.panel.x, L.panel.y, L.panel.w);
  if (L.palette) place($("palette"), L.palette.x, L.palette.y, L.palette.w);
  if (L.publish) place(el.publish, L.publish.x, L.publish.y, L.publish.w);
  if (L.ticker) place(el.ticker, L.ticker.x, L.ticker.y, L.ticker.w);
  place(el.ana, L.ana.x, L.ana.y, L.ana.w);
  place(el.avail, L.avail.x, L.avail.y);
  el.live.style.left = `${L.live.cx}px`;
  el.live.style.top = `${L.live.y}px`;
  Object.assign(el.ring.style, {
    left: `${F.cx - 23}px`,
    top: `${F.cy - 23}px`,
    width: "46px",
    height: "46px",
  });
  Object.assign(el.claimScreen.style, { left: "10px", top: "10px", right: "10px", bottom: "10px", borderRadius: "50px" });

  const build = () => {
    const tl = gsap.timeline({ paused: true });
    const clock = { t: 0 };
    tl.to(clock, {
      t: DURATION,
      duration: DURATION,
      ease: "none",
      onUpdate: () => render(clock.t),
    });
    render(0);
    window.__timelines.main = tl;
  };

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
  else build();
})();
