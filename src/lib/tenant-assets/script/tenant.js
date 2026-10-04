/*
 * The one script of a published page (M8-05, M8-06). Plain browser JavaScript: no modules, no
 * framework, no build step beyond hashing (scripts/build-tenant-assets.ts strips comments and
 * indentation and names the file after the hash of the result). It is loaded as
 * <script src defer data-page-id="...">, and it does two things:
 *
 * 1. Tap to play. Every embed is a <button class="pg-embed-play" data-embed-*> that the server
 *    wrote (src/components/page/embed-facade-markup.tsx). One delegated click listener replaces
 *    the tapped button with the provider's iframe. The script has no per-provider table: the
 *    player URL, title, allow list, full-screen flag and height all arrive as data attributes,
 *    and the only thing it adds is Twitch's `parent`, read from window.location.hostname.
 *    Nothing is requested before a tap.
 *
 * 2. The view beacon (M4-21): once per page load, after `load`, one
 *    navigator.sendBeacon('/api/e', {pageId, referrer}) to the host that served the page. The page
 *    id comes from this script element's own data-page-id attribute and must be a UUID. Nothing is
 *    stored and nothing identifies the visitor: the server derives an anonymous daily hash from the request.
 *
 * Defense in depth (the policy in src/lib/routing/tenant-headers.ts is the first wall): before
 * mounting, the origin of data-embed-src must be one of the nine frame origins below, over https.
 * Anything else, and any Twitch hostname that is not plain letters, digits, dots and dashes, mounts
 * nothing and shows the same short notice the React facade shows.
 *
 * Comments sit on their own lines (the build drops those lines). Keep it that way.
 */
(function () {
  "use strict";

  // The `frame-src` list of the tenant policy. A test pins that the two lists are the same.
  var ORIGINS = [
    "https://www.youtube-nocookie.com",
    "https://open.spotify.com",
    "https://player.vimeo.com",
    "https://www.tiktok.com",
    "https://www.instagram.com",
    "https://w.soundcloud.com",
    "https://embed.music.apple.com",
    "https://player.twitch.tv",
    "https://clips.twitch.tv"
  ];
  var HOSTNAME = /^[a-z0-9.-]{1,253}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var doc = document;

  function unavailable(button) {
    var note = doc.createElement("p");
    note.className = "pg-embed-unavailable";
    note.setAttribute("role", "status");
    note.textContent = "This embed can\u2019t load here.";
    button.replaceWith(note);
  }

  function mount(button) {
    var url;
    try {
      url = new URL(button.getAttribute("data-embed-src"));
    } catch {
      return unavailable(button);
    }
    if (url.protocol !== "https:" || ORIGINS.indexOf(url.origin) < 0) return unavailable(button);
    var src = url.href;
    // Twitch plays only inside a site it knows: the hostname the visitor is on, nothing else.
    if (/\.twitch\.tv$/.test(url.hostname)) {
      var parent = window.location.hostname;
      if (!HOSTNAME.test(parent)) return unavailable(button);
      src += "&parent=" + parent;
    }
    var frame = doc.createElement("iframe");
    frame.className = "pg-embed-iframe";
    frame.setAttribute("src", src);
    frame.setAttribute("title", button.getAttribute("data-embed-title") || "");
    frame.setAttribute("allow", button.getAttribute("data-embed-allow") || "");
    if (button.hasAttribute("data-embed-fullscreen")) frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    var height = parseInt(button.getAttribute("data-embed-height"), 10);
    if (height > 0 && height < 2000) {
      frame.style.height = height + "px";
      frame.style.aspectRatio = "auto";
    }
    button.replaceWith(frame);
    frame.focus();
  }

  doc.addEventListener("click", function (event) {
    var target = event.target;
    var button = target && target.closest && target.closest("button.pg-embed-play[data-embed-src]");
    if (button) mount(button);
  });

  var pageId = doc.currentScript && doc.currentScript.getAttribute("data-page-id");

  function beacon() {
    try {
      navigator.sendBeacon("/api/e", JSON.stringify({ pageId: pageId, referrer: doc.referrer }));
    } catch {
      // Absent or refused: a view that is not counted. Nothing else depends on it.
    }
  }

  if (pageId && UUID.test(pageId)) {
    if (doc.readyState === "complete") beacon();
    else window.addEventListener("load", beacon, { once: true });
  }
})();
