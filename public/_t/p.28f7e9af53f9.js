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
var DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
var TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
function minutesOf(value) {
return TIME.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
}
function localParts(date, zone) {
var options = { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
var parts;
try {
options.timeZone = zone;
parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
} catch {
options.timeZone = "UTC";
parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
}
var found = {};
for (var p = 0; p < parts.length; p++) found[parts[p].type] = parts[p].value;
var day = DAYS.indexOf(String(found.weekday || "").toLowerCase());
return {
day: day < 0 ? 0 : day,
minute: (Number(found.hour) % 24) * 60 + Number(found.minute)
};
}
function rangesOf(text) {
var out = [];
var items = String(text || "").split(",");
for (var r = 0; r < items.length; r++) {
var pair = items[r].split("-");
var open = minutesOf(pair[0]);
var close = minutesOf(pair[1]);
if (pair.length === 2 && open !== null && close !== null && open !== close) out.push([open, close]);
}
return out;
}
function insideAny(ranges, test) {
for (var r = 0; r < ranges.length; r++) if (test(ranges[r][0], ranges[r][1])) return true;
return false;
}
function isOpen(days, day, minute) {
var today = insideAny(days[day], function (open, close) {
return open < close ? minute >= open && minute < close : minute >= open;
});
return today || insideAny(days[(day + 6) % 7], function (open, close) {
return close < open && minute < close;
});
}
function markHours(block, now) {
var rows = block.querySelectorAll("[data-day]");
var days = [[], [], [], [], [], [], []];
for (var r = 0; r < rows.length; r++) {
var index = DAYS.indexOf(rows[r].getAttribute("data-day"));
if (index >= 0) days[index] = rangesOf(rows[r].getAttribute("data-ranges"));
}
var at = localParts(now, block.getAttribute("data-tz") || "UTC");
for (var q = 0; q < rows.length; q++) {
if (rows[q].getAttribute("data-day") === DAYS[at.day]) rows[q].setAttribute("aria-current", "date");
else rows[q].removeAttribute("aria-current");
}
var open = isOpen(days, at.day, at.minute);
block.setAttribute("data-open", open ? "true" : "false");
var status = block.querySelector("[data-hours-status]");
if (status) status.textContent = open ? "Open now" : "Closed now";
}
var hours = doc.querySelectorAll(".pg-hours");
function markAllHours() {
var now = new Date();
for (var h = 0; h < hours.length; h++) markHours(hours[h], now);
}
if (hours.length > 0) {
markAllHours();
setInterval(markAllHours, 60000);
}
var pageId = doc.currentScript && doc.currentScript.getAttribute("data-page-id");
var subPageId = doc.currentScript && doc.currentScript.getAttribute("data-sub-page-id");
function beacon() {
try {
var body = { pageId: pageId, referrer: doc.referrer };
if (subPageId && UUID.test(subPageId)) body.subPageId = subPageId;
navigator.sendBeacon("/api/e", JSON.stringify(body));
} catch {
}
}
if (pageId && UUID.test(pageId)) {
if (doc.readyState === "complete") beacon();
else window.addEventListener("load", beacon, { once: true });
}
})();
