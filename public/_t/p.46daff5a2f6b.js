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
var COPY_MAX = 64;
var copying = new WeakMap();
function copied(button, status, word) {
var state = copying.get(button);
if (!state) {
state = { label: button.textContent, timer: 0 };
copying.set(button, state);
}
clearTimeout(state.timer);
button.textContent = word;
if (status) status.textContent = word;
state.timer = setTimeout(function () {
button.textContent = state.label;
if (status) status.textContent = "";
}, 2000);
}
function selectCode(block, status) {
var code = block && block.querySelector(".pg-discount-code");
var selection = window.getSelection && window.getSelection();
if (code && selection) {
var range = doc.createRange();
range.selectNodeContents(code);
selection.removeAllRanges();
selection.addRange(range);
}
if (status) status.textContent = "Select and copy the code.";
}
function copy(button) {
var value = (button.getAttribute("data-copy") || "").slice(0, COPY_MAX);
var word = button.getAttribute("data-copied") || "Copied";
var block = button.closest(".pg-discount");
var status = block && block.querySelector(".pg-discount-status");
var clipboard = navigator.clipboard;
if (!clipboard || !clipboard.writeText) return selectCode(block, status);
try {
clipboard.writeText(value).then(
function () {
copied(button, status, word);
},
function () {
selectCode(block, status);
}
);
} catch {
selectCode(block, status);
}
}
doc.addEventListener("click", function (event) {
var target = event.target;
var button = target && target.closest && target.closest("button.pg-embed-play[data-embed-src]");
if (button) return mount(button);
var copyButton = target && target.closest && target.closest("[data-copy]");
if (copyButton) copy(copyButton);
});
var blocks = doc.querySelectorAll(".pg-discount");
for (var i = 0; i < blocks.length; i++) blocks[i].setAttribute("data-js", "");
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
