import { describe, expect, it } from "vitest";
import { isBot } from "@/lib/analytics/ingest/bot";

describe("M4-23 isBot", () => {
  it.each([
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["bingbot", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
    ["facebookexternalhit", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
    ["Slackbot", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
    ["Twitterbot", "Twitterbot/1.0"],
    ["WhatsApp", "WhatsApp/2.23.20"],
    ["curl", "curl/8.4.0"],
    ["python-requests", "python-requests/2.31.0"],
    ["Go-http-client", "Go-http-client/2.0"],
    [
      "HeadlessChrome (Playwright's default)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36",
    ],
    ["LinkedInBot", "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)"],
    ["Discordbot", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
    ["Applebot", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (Applebot/0.1)"],
    ["GPTBot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)"],
    ["Lighthouse", "Mozilla/5.0 (Linux; Android 11) Chrome-Lighthouse"],
    ["wget", "Wget/1.21.4"],
    ["UptimeRobot", "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)"],
  ])("%s is a bot", (_name, ua) => {
    expect(isBot(ua)).toBe(true);
  });

  it.each([
    [
      "iPhone Safari",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ],
    [
      "iPad Safari",
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ],
    [
      "Android Chrome",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    ],
    [
      "desktop Chrome",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ],
    [
      "desktop Firefox",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    ],
    [
      "Instagram in-app browser",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.18.109 (iPhone14,5; iOS 17_0; en_US; en-US; scale=3.00; 1170x2532; 500000000)",
    ],
    [
      "Facebook in-app browser",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0.0.0.0;FBBV/1;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.0;FBLC/en_US;FBOP/5]",
    ],
    [
      "Pinterest in-app browser",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]",
    ],
    [
      "an Android phone from Cubot",
      "Mozilla/5.0 (Linux; Android 12; CUBOT KING KONG 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    ],
  ])("%s is a human", (_name, ua) => {
    expect(isBot(ua)).toBe(false);
  });

  it("a missing, null or empty user agent counts as a bot", () => {
    expect(isBot(undefined)).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot("   ")).toBe(true);
  });
});
