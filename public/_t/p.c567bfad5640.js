(function () {
"use strict";
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
}
}
if (pageId && UUID.test(pageId)) {
if (doc.readyState === "complete") beacon();
else window.addEventListener("load", beacon, { once: true });
}
})();
