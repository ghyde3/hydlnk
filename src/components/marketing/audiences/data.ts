import type { FaqItem } from "../faq-data";
import type { TryPreset } from "../try/try-builder";

/**
 * The link-in-bio landing pages: one entry per platform or kind of creator. Everything the page
 * template, the hub, the home page strip, the footer and the sitemap show comes from this list, so
 * a page cannot be linked in one place and missing from another.
 *
 * Every claim here has to be true of the product today (see plans.ts, block-catalog.tsx and
 * faq-data.ts): embeds are YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music and
 * Twitch (not Bandcamp or Apple Podcasts), the social icon row has Twitch, Spotify, Discord and
 * five more (since Wave K), the Grid block holds linked tiles without pictures, HYDLNK takes no payments and
 * has no booking tool, and referrers, devices and countries are Pro and Studio. The platform steps
 * were checked against each platform's own help text where it could be read; where a platform
 * decides who gets a feature, the copy says so and sends people to the platform's help center.
 *
 * Copy rules (Gary, 2026-10-03): American English, plain words about what the visitor gets, no
 * jargon, no exclamation marks. tests/unit/audience-copy.test.ts enforces the mechanical ones.
 */

export type AudienceKind = "platform" | "creator";

/** The block types from block-catalog.tsx, used for the icon and the block's name. */
export type BlockId =
  | "link"
  | "card"
  | "header"
  | "text"
  | "image"
  | "social"
  | "embed"
  | "grid"
  | "divider"
  | "faq"
  | "contact"
  | "discount"
  | "book"
  | "apps"
  | "map";

/** A feature card's icon: one of the fifteen blocks, or a general one. */
export type FitIcon = BlockId | "design" | "phone" | "chart" | "domain" | "preview" | "tag";

export interface AudienceStep {
  title: string;
  body: string;
  /** An internal link that continues the step, such as the TikTok page from "put it in your bio". */
  link?: { href: string; label: string };
}

export interface AudienceFit {
  icon: FitIcon;
  title: string;
  body: string;
}

export interface AudienceStarterBlock {
  block: BlockId;
  title: string;
  body: string;
}

export interface Audience {
  slug: string;
  kind: AudienceKind;
  /** Short name for lists and links: "TikTok", "Musicians". */
  name: string;
  /** One sentence for cards on the hub, the home page strip and "more pages" links. */
  blurb: string;
  /** The page's h1, written to match what people search for. */
  h1: string;
  /** Page title before " | HYDLNK". */
  title: string;
  /** Meta description and Open Graph description. */
  description: string;
  lead: string;
  stepsTitle: string;
  steps: AudienceStep[];
  /** A short caveat under the steps: who can use the platform feature, or what to check. */
  stepsNote?: string;
  fitTitle: string;
  fits: AudienceFit[];
  starterTitle: string;
  starter: AudienceStarterBlock[];
  tryTitle: string;
  faq: FaqItem[];
  /** Other audience slugs worth reading next. */
  related: string[];
  /** Learn guide slugs shown under the questions. */
  guides: string[];
  /** Where the demo builder starts: theme, name, blocks and labels that fit this audience. */
  preset: TryPreset;
}

export const AUDIENCES: readonly Audience[] = [
  {
    slug: "tiktok",
    kind: "platform",
    name: "TikTok",
    blurb: "Add a link to your TikTok bio and send viewers to your shop, videos and more.",
    h1: "Link in bio for TikTok",
    title: "Link in bio for TikTok",
    description:
      "How to add a link to your TikTok bio, and what to put behind it. Build a page that looks like your videos, free, in a few minutes.",
    lead: "Your TikTok profile can hold a link. Point it at one page that sends viewers to your shop, your newest video, your newsletter and everything else, each one a tap away.",
    stepsTitle: "How to add your link to your TikTok bio",
    steps: [
      {
        title: "Build your page",
        body: "Claim your handle and add a few blocks. It’s free and takes a few minutes. Your page will live at yourname.hydlnk.com.",
      },
      {
        title: "Open Edit profile",
        body: "In the TikTok app, go to your profile and tap Edit profile.",
      },
      {
        title: "Add the link",
        body: "Find Links, tap Add, choose the website option and paste your HYDLNK address. Save, and the link appears on your profile.",
      },
      {
        title: "Tap it yourself",
        body: "Open your profile the way a visitor would and tap the link to make sure it opens your page.",
      },
    ],
    stepsNote:
      "TikTok decides who sees the link option, and it isn’t offered in every region. TikTok has said that accounts with 1,000 or more followers and business accounts can add one. If you don’t see it yet, check TikTok’s help center for the current rules. Until it appears, write your short address in your bio so people can still find your page.",
    fitTitle: "Why TikTok creators use HYDLNK",
    fits: [
      {
        icon: "phone",
        title: "Made for phones first",
        body: "Most people reach your link from the TikTok app on a phone. Every HYDLNK page is designed for that screen first, with large buttons, and published pages are stored close to your visitors so they open quickly.",
      },
      {
        icon: "design",
        title: "The page looks like your videos",
        body: "Choose your colors, fonts and button style, or add your own background image. The tap from your video to your page feels like the same place.",
      },
      {
        icon: "card",
        title: "The thing people asked about goes first",
        body: "A Card block gives a product, a recipe or your newest video a picture, a title and a caption, and the whole card is the link. Drag it to the top whenever a video makes it the question in your comments.",
      },
      {
        icon: "embed",
        title: "Show a TikTok right on the page",
        body: "An Embed block takes a TikTok video address and plays it on your page when a visitor taps it. Nothing from TikTok loads until then.",
      },
      {
        icon: "chart",
        title: "See what people tap",
        body: "Every link gets view and click counts. Free shows the clicks on each link over the last 30 days. Pro adds a year of history with referrers, devices and countries.",
      },
    ],
    starterTitle: "A first TikTok page, block by block",
    starter: [
      {
        block: "card",
        title: "Your newest video or product",
        body: "A picture, a short title and a one-line caption. Swap it each time you post something people ask about.",
      },
      {
        block: "link",
        title: "Shop, newsletter, booking",
        body: "One button each. Make the one you care about most a filled button and the rest outlined.",
      },
      {
        block: "header",
        title: "“Links from my videos”",
        body: "A heading that groups the things viewers ask for in the comments.",
      },
      {
        block: "text",
        title: "Two lines about you",
        body: "For people who landed here from one video and haven’t seen the others.",
      },
      {
        block: "social",
        title: "Instagram, YouTube and the rest",
        body: "A row of up to eight icons, so someone who likes your videos can follow you elsewhere.",
      },
    ],
    tryTitle: "Try a TikTok page",
    faq: [
      {
        question: "Why don’t I see a link option on my TikTok profile?",
        answer:
          "TikTok decides who gets it, and it isn’t offered in every region. TikTok has said that accounts with 1,000 or more followers and business accounts can add a website link. Check Edit profile again once you qualify, and see TikTok’s help center for the current rules.",
      },
      {
        question: "Can I use HYDLNK before I have 1,000 followers?",
        answer:
          "Yes. Your page is live at yourname.hydlnk.com the moment you publish, and you can share that address anywhere: another profile, a message, a flyer, or written in your TikTok bio. The TikTok link field is one place for it, not the only one.",
      },
      {
        question: "How do I make my page match my TikTok style?",
        answer:
          "Pick colors, heading and body fonts, a button style, a corner shape and a background, which can be a solid color, a gradient or your own image. Save a look as a theme to reuse it later. The free plan holds three saved themes.",
      },
      {
        question: "Does HYDLNK take a cut if I sell through my link?",
        answer:
          "No. We never take a cut of your sales, on any plan. Your link goes to your own shop or checkout, so the sale happens there.",
      },
    ],
    related: ["instagram", "youtube", "small-business"],
    guides: ["getting-started", "designing-your-page"],
    preset: {
      theme: "ember",
      name: "Kai Brennan",
      bio: "Quick recipes for busy people. New video most days.",
      blocks: ["card", "link", "link", "social"],
      socials: ["instagram", "youtube", "email"],
      linkLabels: ["Shop the kitchen tools", "Get the recipe newsletter"],
    },
  },

  {
    slug: "instagram",
    kind: "platform",
    name: "Instagram",
    blurb: "Put one link in your Instagram bio that opens a page as polished as your feed.",
    h1: "Link in bio for Instagram",
    title: "Link in bio for Instagram",
    description:
      "How to put a link in your Instagram bio, and how to make the page behind it match your feed. Free to start, set up in minutes.",
    lead: "Links in Instagram captions aren’t tappable, so the link in your profile does all the work. Make it a page that’s as polished as your feed.",
    stepsTitle: "How to put a link in your Instagram bio",
    steps: [
      {
        title: "Build your page",
        body: "Claim your handle, add your blocks and pick a look. Your page will live at yourname.hydlnk.com.",
      },
      {
        title: "Open Edit profile",
        body: "In the Instagram app, go to your profile and tap Edit profile.",
      },
      {
        title: "Add an external link",
        body: "Tap Links, then Add external link. Paste your HYDLNK address, add a title if you like and tap Done.",
      },
      {
        title: "Check it",
        body: "Visit your profile and tap the link to make sure it opens your page.",
      },
    ],
    stepsNote:
      "Instagram lets you add more than one link, but visitors see one first and have to tap to reveal the rest. A single link to a single page is simpler to share, and you can change what’s behind it without opening Instagram again.",
    fitTitle: "Why Instagram accounts use HYDLNK",
    fits: [
      {
        icon: "design",
        title: "As polished as your grid",
        body: "Set your colors, fonts and background to match your feed, then open the page with an Image block: one photo you’re proud of, with alt text so everyone can read it.",
      },
      {
        icon: "header",
        title: "Say what each link is for",
        body: "Link labels hold up to 80 characters, and Header blocks group them under words like Latest, Shop and Book. People should know what a tap does before they make it.",
      },
      {
        icon: "social",
        title: "Your other accounts in one row",
        body: "A Social block holds up to eight icons. Choose from Instagram, TikTok, YouTube, X, Facebook, LinkedIn, GitHub, Threads, Reddit, Snapchat, Pinterest, Discord, Twitch, Spotify, email and your website.",
      },
      {
        icon: "preview",
        title: "Change it without touching your bio",
        body: "The address in your Instagram profile never changes, so you never have to edit it again. Edit your page, check the phone preview and press Publish when it’s ready. Visitors see the last version you published until then.",
      },
    ],
    starterTitle: "A first Instagram page, block by block",
    starter: [
      {
        block: "image",
        title: "One photo to open the page",
        body: "Your strongest recent shot, with a line of alt text describing it.",
      },
      {
        block: "link",
        title: "What you want people to do first",
        body: "Shop, book or read: one button, filled, right under the photo.",
      },
      {
        block: "card",
        title: "Your latest post or reel",
        body: "Use the post’s picture and title it with what people will find when they tap.",
      },
      {
        block: "header",
        title: "A heading for each group",
        body: "Latest, Shop, Book. Short words that sort your links so nobody has to hunt.",
      },
      {
        block: "social",
        title: "The other places to follow you",
        body: "Up to eight icons, from TikTok to your own website.",
      },
    ],
    tryTitle: "Try an Instagram page",
    faq: [
      {
        question: "How do I put a link in my Instagram bio?",
        answer:
          "Go to your profile and tap Edit profile, then Links, then Add external link, and paste your address. Instagram’s help center has the current steps if your app looks different.",
      },
      {
        question: "Can I make my link page match my Instagram look?",
        answer:
          "Yes. Colors, fonts, button shapes and backgrounds are all yours to set, and all of them are on the free plan.",
      },
      {
        question: "Can I use my own domain instead of hydlnk.com?",
        answer:
          "Yes, on Pro. Connect a domain you already own, such as links.yourname.com. HYDLNK doesn’t sell domains, so you buy yours from any registrar, and we issue the SSL certificate for you.",
      },
      {
        question: "Can I remove the “Made with HYDLNK” badge?",
        answer:
          "Free pages carry a small “Made with HYDLNK” badge in the footer. Pro and Studio remove it.",
      },
    ],
    related: ["tiktok", "artists", "small-business"],
    guides: ["getting-started", "designing-your-page"],
    preset: {
      theme: "ivory",
      name: "Lena Hart",
      bio: "Photographer and plant person. Slow mornings, soft light.",
      blocks: ["image", "link", "card", "social"],
      socials: ["instagram", "tiktok", "website"],
      linkLabels: ["Book a session", "Shop prints"],
    },
  },

  {
    slug: "youtube",
    kind: "platform",
    name: "YouTube",
    blurb: "Keep your channel links, sponsors and merch in one page you can update in one place.",
    h1: "Link in bio for YouTube",
    title: "Link in bio for YouTube",
    description:
      "How to add links to your YouTube channel and video descriptions, and how one page keeps them all current. Play your videos right on it.",
    lead: "A YouTube channel can show up to 14 links, and every video description can hold more. Point them all at one page, and when a sponsor or a shop link changes you fix it once.",
    stepsTitle: "How to add your link to your YouTube channel",
    steps: [
      {
        title: "Build your page",
        body: "Claim your handle and add the links you want viewers to have. Your page will live at yourname.hydlnk.com.",
      },
      {
        title: "Open your channel profile",
        body: "Sign in to YouTube Studio and choose Customization, then Profile.",
      },
      {
        title: "Add the link",
        body: "Under Links, select Add link, enter a title and paste your HYDLNK address.",
      },
      {
        title: "Publish",
        body: "Select Publish. Your first link gets the most prominent spot, near the subscribe button, so put your HYDLNK page first.",
      },
      {
        title: "Use it in descriptions too",
        body: "Paste the same address near the top of your video descriptions. When your links change, the description stays right.",
      },
    ],
    stepsNote:
      "YouTube’s help center says a channel can show up to 14 links, and every link has to follow YouTube’s external links policy.",
    fitTitle: "Why YouTube channels use HYDLNK",
    fits: [
      {
        icon: "embed",
        title: "Play your videos on the page",
        body: "An Embed block shows a YouTube video right on your page. It loads only when someone presses play, so the page stays quick.",
      },
      {
        icon: "link",
        title: "Update once, not in every description",
        body: "Move a link, rename it or add a new sponsor on your HYDLNK page, and every description and channel link that points to it is already current.",
      },
      {
        icon: "chart",
        title: "Know which links get tapped",
        body: "Each link has its own click count, so you can see whether the merch or the membership link is working. Pro adds a year of history with referrers, devices and countries.",
      },
      {
        icon: "design",
        title: "Match your channel’s look",
        body: "Use your channel colors and fonts, or a background image from your banner, so the page feels like part of the channel.",
      },
    ],
    starterTitle: "A first YouTube page, block by block",
    starter: [
      {
        block: "embed",
        title: "Your newest or best video",
        body: "Paste the video’s address and it plays on the page. Change it whenever you upload.",
      },
      {
        block: "header",
        title: "“Support the channel”",
        body: "A heading above the links that bring in income or members.",
      },
      {
        block: "link",
        title: "Membership, merch, sponsor offers",
        body: "One button each, with labels that say what the viewer gets.",
      },
      {
        block: "card",
        title: "A playlist or a course",
        body: "A picture and a caption for the one thing you most want watched next.",
      },
      {
        block: "social",
        title: "Your other accounts",
        body: "TikTok, Instagram, X and the rest in one row of icons.",
      },
    ],
    tryTitle: "Try a YouTube page",
    faq: [
      {
        question: "How many links can a YouTube channel have?",
        answer:
          "YouTube’s help center says up to 14 on your channel’s Home tab, with the first one shown near the subscribe button. Every link has to follow YouTube’s external links policy.",
      },
      {
        question: "Should I link my page in every video description?",
        answer:
          "It’s the easiest way to keep descriptions current. Put one address near the top of each description, then change what’s behind it as your sponsors, merch and offers change.",
      },
      {
        question: "Can I show my videos on my HYDLNK page?",
        answer:
          "Yes, with the Embed block. YouTube videos load only when a visitor presses play. Vimeo, TikTok, Instagram and Twitch can play on the page too.",
      },
      {
        question: "Is the free plan enough for a channel?",
        answer:
          "For most channels, yes. Free gives you one page with every block and the full set of design choices. Pro adds your own domain, three pages and the removal of the “Made with HYDLNK” badge.",
      },
    ],
    related: ["twitch", "podcasters", "tiktok"],
    guides: ["getting-started", "connecting-a-domain"],
    preset: {
      theme: "paper",
      name: "Theo Lang",
      bio: "Weekly videos about building things with your hands.",
      blocks: ["embed", "header", "link", "link", "social"],
      socials: ["youtube", "instagram", "x"],
      linkLabels: ["Join the channel", "Get the tool list", "Merch shop"],
    },
  },

  {
    slug: "twitch",
    kind: "platform",
    name: "Twitch",
    blurb: "Send viewers from your Twitch channel to your Discord, socials, videos and tip link.",
    h1: "Link in bio for Twitch",
    title: "Link in bio for Twitch",
    description:
      "How to add a link to your Twitch channel page, and what to put behind it: Discord, socials, highlights and more. Free for streamers.",
    lead: "Your Twitch channel page has room for social links and clickable panels. Point them at one page, and your Discord, your socials, your latest video and your tip link are all in one place.",
    stepsTitle: "How to add your link to your Twitch channel",
    steps: [
      {
        title: "Build your page",
        body: "Claim your handle and add the links your viewers ask for most. Your page will live at yourname.hydlnk.com.",
      },
      {
        title: "Open your channel settings",
        body: "In your Creator Dashboard, open Settings, then Channel, and find the social links.",
      },
      {
        title: "Add a link",
        body: "Add a link with a label such as “All my links” and paste your HYDLNK address. Save it.",
      },
      {
        title: "Add a panel for a bigger target",
        body: "On your channel page, turn on Edit Panels under the stream, add a panel and give it an image that links to your HYDLNK page.",
      },
    ],
    stepsNote:
      "Twitch moves these settings around from time to time. If you can’t find them, search Twitch’s help center for social links and panels. If you use a chat bot, you can also add a command that replies with your address.",
    fitTitle: "Why streamers use HYDLNK",
    fits: [
      {
        icon: "link",
        title: "A button for every place your viewers go",
        body: "Merch, your tip page and sponsor links each get a Link block with a label you write. Discord and Twitch have icons in the social row too, so one tap reaches your server or your channel.",
      },
      {
        icon: "embed",
        title: "Show your best moment",
        body: "Embed a YouTube highlight or a Twitch clip so a new visitor can watch it without leaving the page. It plays when they tap it.",
      },
      {
        icon: "design",
        title: "Matches your stream",
        body: "Use your overlay’s colors and fonts, or a background image with a dark layer over it, so your page and your stream look like the same brand.",
      },
      {
        icon: "phone",
        title: "Quick on a phone",
        body: "Plenty of viewers open your link from the mobile app. HYDLNK pages are designed phone first, load fast and set no cookies.",
      },
    ],
    starterTitle: "A first Twitch page, block by block",
    starter: [
      {
        block: "card",
        title: "Watch live",
        body: "A picture from your stream, a title and a caption. The whole card links to your Twitch channel.",
      },
      {
        block: "link",
        title: "Discord and your tip page",
        body: "One button each. Put the one that matters most first.",
      },
      {
        block: "embed",
        title: "A highlight or your stream",
        body: "A YouTube video or a Twitch channel, video or clip, playing right on the page when someone taps it.",
      },
      {
        block: "text",
        title: "When you go live",
        body: "“Weeknights, 7 to 10 Eastern.” A few words, up to 600 characters if you need them.",
      },
      {
        block: "social",
        title: "TikTok, YouTube, X and Instagram",
        body: "Icons for TikTok, YouTube, X, Instagram and Discord, next to buttons for the rest.",
      },
    ],
    tryTitle: "Try a Twitch page",
    faq: [
      {
        question: "Can I link my Discord server?",
        answer:
          "Yes. Add a Discord icon to a Social block, or add a Link block with your server’s invite address and a label like “Join the Discord”. The button is easier to spot.",
      },
      {
        question: "Can I embed my live stream on the page?",
        answer:
          "Yes. Paste your Twitch channel address into an Embed block and visitors can tap to watch. Videos and clips work the same way. Nothing from Twitch loads until someone taps.",
      },
      {
        question: "Where do I put the link on Twitch?",
        answer:
          "In your Creator Dashboard under Settings, then Channel, there’s a place for social links, and your channel page has panels you can edit. Twitch changes these screens now and then, so check its help center if something looks different.",
      },
      {
        question: "Can I use my own domain, like links.yourname.com?",
        answer:
          "Yes, on Pro. Connect a domain you already own and add the record we show you at your domain provider. HYDLNK doesn’t sell domains.",
      },
    ],
    related: ["youtube", "tiktok", "x"],
    guides: ["getting-started", "designing-your-page"],
    preset: {
      theme: "midnight",
      name: "Nico Vale",
      bio: "Live most weeknights. Cozy games and chaotic builds.",
      blocks: ["card", "link", "link", "embed", "social"],
      socials: ["youtube", "tiktok", "x", "instagram"],
      linkLabels: ["Join the Discord", "Support the stream", "Merch"],
    },
  },

  {
    slug: "x",
    kind: "platform",
    name: "X (Twitter)",
    blurb: "Make the one website field on your X profile count with a page that holds the rest.",
    h1: "Link in bio for X (Twitter)",
    title: "Link in bio for X (Twitter)",
    description:
      "How to add a link to your X profile, and how to use that one website field to share your newsletter, projects and everything else.",
    lead: "Your X profile has one website field and a short bio. Make the field count: point it at a page that holds everything you’d otherwise try to squeeze into 160 characters.",
    stepsTitle: "How to add your link to your X profile",
    steps: [
      {
        title: "Build your page",
        body: "Claim your handle and add your links. Your page will live at yourname.hydlnk.com, short enough to read out loud.",
      },
      {
        title: "Open Edit profile",
        body: "On X, open your profile and select Edit profile.",
      },
      {
        title: "Fill in the website field",
        body: "Paste your HYDLNK address, including https://, into the Website field and select Save.",
      },
      {
        title: "Pin a post",
        body: "Write a post that says what the link is for, include the address and pin it to your profile, so the first thing people see points to your page.",
      },
    ],
    stepsNote:
      "X gives you one website field, so one page that holds many links is the way to get more than one destination into your profile.",
    fitTitle: "Why people on X use HYDLNK",
    fits: [
      {
        icon: "link",
        title: "One field, everything behind it",
        body: "Your newsletter, your latest project, your podcast and your contact details each get a button, in the order you choose. Reorder them whenever your week changes.",
      },
      {
        icon: "preview",
        title: "A link that looks like you when it’s shared",
        body: "Each published page gets its own preview image, so when you or anyone else posts your address, the link comes with a picture instead of a bare URL.",
      },
      {
        icon: "tag",
        title: "A short address",
        body: "Your address is your handle plus .hydlnk.com. Handles run from 3 to 30 letters, numbers and hyphens, so it fits in a bio, a pinned post or a slide.",
      },
      {
        icon: "text",
        title: "Room to say more than 160 characters",
        body: "A Text block holds up to 600 characters, with your line breaks kept. Use it for the longer version of what you do.",
      },
    ],
    starterTitle: "A first X page, block by block",
    starter: [
      {
        block: "text",
        title: "The longer bio",
        body: "Who you are and what you post about, in a few sentences that don’t have to fit in 160 characters.",
      },
      {
        block: "link",
        title: "Your newsletter",
        body: "The one thing you’d like every follower to do. Make it a filled button.",
      },
      {
        block: "card",
        title: "Your best thread or project",
        body: "A picture, a title and a caption, with the whole card linking to it.",
      },
      {
        block: "header",
        title: "“Elsewhere”",
        body: "A heading for the links that aren’t the main event.",
      },
      {
        block: "social",
        title: "Your other accounts",
        body: "X, LinkedIn, GitHub, Threads, YouTube and email, up to eight icons.",
      },
    ],
    tryTitle: "Try a page for your X profile",
    faq: [
      {
        question: "How many links can I put in my X profile?",
        answer:
          "One website field. A HYDLNK page lets that one link lead to as many destinations as you like, up to 50 blocks on a page.",
      },
      {
        question: "Will my link look good when I post it?",
        answer:
          "Every published page gets a preview image of its own, which apps can show when someone shares your address. What each app displays is up to the app.",
      },
      {
        question: "Can I link my X account from my HYDLNK page?",
        answer:
          "Yes. The Social block includes an X icon, alongside Instagram, TikTok, YouTube, Facebook, LinkedIn, GitHub, Threads, Reddit, Snapchat, Pinterest, Discord, Twitch, Spotify, email and your website.",
      },
      {
        question: "Does it cost anything?",
        answer:
          "Free gives you one page with every block and the full design options, with no time limit and no card. Pro adds your own domain and removes the small “Made with HYDLNK” badge.",
      },
    ],
    related: ["instagram", "youtube", "coaches"],
    guides: ["getting-started", "choosing-a-handle"],
    preset: {
      theme: "paper",
      name: "Priya Nair",
      bio: "Writing about products and the people who build them.",
      blocks: ["text", "link", "card", "social"],
      socials: ["x", "linkedin", "github", "email"],
      linkLabels: ["Read the newsletter", "My latest essay"],
    },
  },

  {
    slug: "musicians",
    kind: "creator",
    name: "Musicians",
    blurb:
      "Put your music, videos, shows and merch on one page, and let listeners play it right there.",
    h1: "Link in bio for musicians",
    title: "Link in bio for musicians",
    description:
      "A link in bio page for musicians: a Spotify player, your newest video, shows and merch, in colors that fit the record. Free to start.",
    lead: "A new single, a video, a run of shows and a merch table: you have more to point at than one link allows. Put your music on the page itself, and let listeners choose where else to follow you.",
    stepsTitle: "Set up your musician page in six steps",
    steps: [
      {
        title: "Claim your artist name",
        body: "Handles use lowercase letters, numbers and hyphens, so “the-midnight-hours” works. Use the name people search for.",
      },
      {
        title: "Add a player",
        body: "Paste a Spotify track, album, playlist or artist address into an Embed block and people can listen without leaving your page.",
      },
      {
        title: "Add your newest video",
        body: "A second Embed block plays a YouTube video, and it loads only when someone presses play.",
      },
      {
        title: "Add buttons for everywhere else",
        body: "SoundCloud and Apple Music have their own players, so add them the same way. Bandcamp and your ticket page go in as Link blocks.",
      },
      {
        title: "List your shows and merch",
        body: "A Grid block holds two to six tiles, each with a title, a short line and a link. Use one for dates and one for the merch table.",
      },
      {
        title: "Put the address in every bio",
        body: "Add it to Instagram, TikTok and YouTube, then pick your colors and press Publish.",
        link: { href: "/link-in-bio/instagram", label: "Link in bio for Instagram" },
      },
    ],
    fitTitle: "Why musicians use HYDLNK",
    fits: [
      {
        icon: "embed",
        title: "Listeners can play it on the page",
        body: "Spotify, SoundCloud and Apple Music play in an Embed block. Someone who finds you on a short video can hear the record before they decide anything.",
      },
      {
        icon: "grid",
        title: "Shows and merch in a grid",
        body: "Each tile takes a title of up to 40 characters, a line of up to 60 and a link, which is enough for “Oct 18 · Denver” and a ticket page.",
      },
      {
        icon: "design",
        title: "A look that fits the record",
        body: "Set your colors and fonts, or use your cover art as the background with a layer over it so the text stays readable. Make the newest release a filled button and keep the rest outlined.",
      },
      {
        icon: "chart",
        title: "See which store wins",
        body: "Each link has its own click count. On Pro you also see where visitors come from and which countries they’re in, which helps when you’re planning a tour.",
      },
    ],
    starterTitle: "A first musician page, block by block",
    starter: [
      {
        block: "embed",
        title: "Your newest release",
        body: "A Spotify player right at the top, so the music is the first thing on the page.",
      },
      {
        block: "link",
        title: "Tickets or the pre-save",
        body: "A link goes to any web address, so a pre-save link from your distributor works like any other.",
      },
      {
        block: "grid",
        title: "Shows",
        body: "Dates and cities as tiles, each one linking to its ticket page.",
      },
      {
        block: "embed",
        title: "Your latest video",
        body: "A YouTube video that plays on the page when someone presses play.",
      },
      {
        block: "link",
        title: "Merch, Bandcamp, Apple Music",
        body: "One button each, in the order your listeners use them.",
      },
    ],
    tryTitle: "Try a musician page",
    faq: [
      {
        question: "Can I put my music on the page?",
        answer:
          "Yes. Spotify, SoundCloud and Apple Music play in an Embed block, and so do YouTube and Vimeo videos. Bandcamp goes in as a link button.",
      },
      {
        question: "Can I use a pre-save link?",
        answer:
          "Yes. A Link block goes to any web address that starts with http or https, so a pre-save link works like any other link.",
      },
      {
        question: "Do I have to pay to make it look good?",
        answer:
          "No. Every block and every design choice is on the free plan. Pro is for your own domain, more pages, no badge and a year of analytics.",
      },
      {
        question: "Can my band and my label each have a page?",
        answer:
          "Free includes one page, Pro includes three and Studio includes 15, so an artist page, a release page and a tour page can each have their own address.",
      },
    ],
    related: ["podcasters", "youtube", "instagram"],
    guides: ["designing-your-page", "connecting-a-domain"],
    preset: {
      theme: "noir",
      name: "Hollow Pines",
      bio: "Indie folk from a basement in Ohio. New album out now.",
      blocks: ["link", "embed", "grid", "link", "social"],
      socials: ["instagram", "tiktok", "youtube", "email"],
      linkLabels: ["Buy tickets", "Merch table", "Join the mailing list"],
    },
  },

  {
    slug: "podcasters",
    kind: "creator",
    name: "Podcasters",
    blurb:
      "Let listeners play an episode, pick their app and find your sponsors, all from one link.",
    h1: "Link in bio for podcasters",
    title: "Link in bio for podcasters",
    description:
      "A link in bio page for podcasters: play an episode on the page, link every listening app and show your sponsors. Free to start.",
    lead: "Your listeners are on different apps, and your sponsors want to be seen. One page lets people play an episode, pick their app and find your newsletter and your other shows.",
    stepsTitle: "Set up your podcast page in six steps",
    steps: [
      {
        title: "Claim a handle for the show",
        body: "Use the show’s name, so the address matches what listeners say out loud at the end of an episode.",
      },
      {
        title: "Add an episode player",
        body: "An Embed block takes a Spotify show or episode address and plays it right on your page.",
      },
      {
        title: "Add a button for each other app",
        body: "Apple Podcasts, Overcast, Pocket Casts and your RSS feed each get a Link block. These are links, not players.",
      },
      {
        title: "Embed your video episodes",
        body: "If you publish on YouTube, a second Embed block plays your newest episode there.",
      },
      {
        title: "Add your sponsors",
        body: "A Card block gives a sponsor a picture, a title and a caption. A Text block holds the promo code in plain words, up to 600 characters.",
      },
      {
        title: "Say the address out loud",
        body: "Put it in your show notes and mention it in each episode. It’s short enough to say once and remember.",
        link: { href: "/link-in-bio/youtube", label: "Link in bio for YouTube" },
      },
    ],
    fitTitle: "Why podcasters use HYDLNK",
    fits: [
      {
        icon: "embed",
        title: "Play an episode on the page",
        body: "Spotify shows and episodes play in an Embed block, and YouTube videos play too. A new visitor can hear one episode before deciding to follow.",
      },
      {
        icon: "link",
        title: "Every listening app in one list",
        body: "Each app is one button. Check the click counts to see which apps your listeners use, and move that one to the top.",
      },
      {
        icon: "card",
        title: "Sponsors with a picture and a number",
        body: "Give each sponsor a Card with their image, and each link its own click count, so you can tell a sponsor how many people tapped.",
      },
      {
        icon: "domain",
        title: "A page for each show",
        body: "Free includes one page, Pro includes three and Studio includes 15. On Pro you can use a domain you own, like links.yourshow.com.",
      },
    ],
    starterTitle: "A first podcast page, block by block",
    starter: [
      {
        block: "embed",
        title: "Your latest episode",
        body: "A Spotify episode player at the top, so visitors can press play straight away.",
      },
      {
        block: "header",
        title: "“Listen on”",
        body: "A heading above the buttons for every other app.",
      },
      {
        block: "link",
        title: "Apple Podcasts, Overcast, Pocket Casts, RSS",
        body: "One button each, ordered by what your click counts say people use.",
      },
      {
        block: "card",
        title: "A sponsor",
        body: "Their image, a title and a caption. The whole card is the link.",
      },
      {
        block: "text",
        title: "The promo code",
        body: "Written out in plain words, so someone can read it back from memory.",
      },
    ],
    tryTitle: "Try a podcast page",
    faq: [
      {
        question: "Apple Podcasts, Spotify or both?",
        answer:
          "Both. Spotify shows and episodes can play right on your page. Apple Podcasts and other apps go in as link buttons, so listeners who prefer them tap through.",
      },
      {
        question: "Can I put my RSS feed on the page?",
        answer:
          "Yes, as a Link block. It helps listeners who add shows to their app by pasting a feed address.",
      },
      {
        question: "Can I use my podcast’s own domain?",
        answer:
          "Yes, on Pro. Connect a domain you own, such as links.yourshow.com, and we issue the SSL certificate. HYDLNK doesn’t sell domains.",
      },
      {
        question: "Can I make a page for each show?",
        answer:
          "Free includes one page, Pro includes three and Studio includes 15, so a network or a studio with several shows can give each its own address.",
      },
    ],
    related: ["musicians", "youtube", "coaches"],
    guides: ["getting-started", "understanding-analytics"],
    preset: {
      theme: "sage",
      name: "Slow Lunch",
      bio: "Conversations about food, work and how we spend our days.",
      blocks: ["header", "embed", "link", "link", "link", "card"],
      linkLabels: ["Apple Podcasts", "Overcast", "Pocket Casts", "RSS feed"],
    },
  },

  {
    slug: "artists",
    kind: "creator",
    name: "Artists and photographers",
    blurb: "Open with your work, keep the rest quiet and send people to buy, book or commission.",
    h1: "Link in bio for artists and photographers",
    title: "Link in bio for artists and photographers",
    description:
      "A link in bio page for artists and photographers: lead with your work, then send people to your shop, your bookings and your full portfolio.",
    lead: "Your work should be the first thing people see, not a stack of buttons. Open with a picture, keep the rest quiet, and send people to where they can buy, book or commission.",
    stepsTitle: "Set up your portfolio page in five steps",
    steps: [
      {
        title: "Claim your name",
        body: "Your own name or your studio’s. Whatever you sign your work with is the one people will look for.",
      },
      {
        title: "Open with one strong image",
        body: "An Image block takes a JPEG, PNG or WebP. Write alt text for it. It’s required, and it lets screen readers describe your work.",
      },
      {
        title: "Give each series a card",
        body: "A Card block is a picture, a title and a caption, and the whole card is the link. Use one each for your print shop, your commissions and your newest series.",
      },
      {
        title: "Keep the colors quiet",
        body: "Pick a background and fonts that stay out of the work’s way. A dark background suits photography. A warm off-white suits drawing.",
      },
      {
        title: "Link to the full portfolio",
        body: "Your own site, your shop and your booking page go in as Link buttons, so this page is the front door and the rest stays where it lives.",
        link: { href: "/link-in-bio/instagram", label: "Link in bio for Instagram" },
      },
    ],
    stepsNote:
      "Free includes 10 MB of uploads, enough for a few images. Pro includes 100 MB and Studio 1 GB. For a full portfolio, use this page as the front door and link out to the rest.",
    fitTitle: "Why artists and photographers use HYDLNK",
    fits: [
      {
        icon: "image",
        title: "Your best piece first",
        body: "An Image block puts one picture on its own, with alt text so people who can’t see it still know what it shows.",
      },
      {
        icon: "card",
        title: "Cards for prints, commissions and series",
        body: "Each card pairs a picture with a title and a caption, and the whole card is the link. It reads like a small shop window.",
      },
      {
        icon: "design",
        title: "Colors that stay out of the way",
        body: "Set eight colors, fonts, corner shapes and a background that can be a solid color, a gradient or your own image with a layer over it. You can also change the look of a single block.",
      },
      {
        icon: "domain",
        title: "Your name as the address",
        body: "On Pro, connect a domain you own, like links.yourname.com, so your page sits on your own name. HYDLNK doesn’t sell domains.",
      },
    ],
    starterTitle: "A first portfolio page, block by block",
    starter: [
      {
        block: "image",
        title: "Your strongest piece",
        body: "On its own at the top, with a line of alt text that says what it shows.",
      },
      {
        block: "text",
        title: "A short artist statement",
        body: "Two or three sentences about what you make and how. Up to 600 characters.",
      },
      {
        block: "card",
        title: "Prints",
        body: "A picture from the collection, a title and a caption, linking to your shop.",
      },
      {
        block: "card",
        title: "Commissions or bookings",
        body: "A card that says whether you’re taking work, linking to your booking page.",
      },
      {
        block: "link",
        title: "Your full portfolio",
        body: "A single button to the site that holds everything else.",
      },
    ],
    tryTitle: "Try a portfolio page",
    faq: [
      {
        question: "How many images can I put on the page?",
        answer:
          "A page holds up to 50 blocks, and uploaded images count toward your plan’s upload space: 10 MB on Free, 100 MB on Pro and 1 GB on Studio. For a full portfolio, link out to your own site.",
      },
      {
        question: "Is there a gallery block?",
        answer:
          "No. Use an Image block for your best piece, Cards for series or collections, and a Link to your portfolio site for the rest.",
      },
      {
        question: "Is alt text required for images?",
        answer:
          "Yes, for Image blocks. It describes the picture to people using screen readers, and Publish asks for it.",
      },
      {
        question: "Can I sell prints through HYDLNK?",
        answer:
          "HYDLNK doesn’t process payments. Link to your own shop or checkout page. We never take a cut of your sales, on any plan.",
      },
    ],
    related: ["instagram", "small-business", "tiktok"],
    guides: ["designing-your-page", "getting-started"],
    preset: {
      theme: "ivory",
      name: "Ines Calder",
      bio: "Ink and watercolor. Prints and commissions.",
      blocks: ["image", "text", "card", "card", "link"],
      linkLabels: ["See the full portfolio"],
    },
  },

  {
    slug: "small-business",
    kind: "creator",
    name: "Small businesses",
    blurb:
      "Put what you sell, when you’re open and how to order on one page that looks like your shop.",
    h1: "Link in bio for small businesses",
    title: "Link in bio for small businesses",
    description:
      "A link in bio page for small businesses and shops: what you sell, your hours and how to order, on one page that looks like your brand.",
    lead: "Customers find you on Instagram or TikTok and want three things: what you sell, when you’re open and how to order. Put all three on one page that looks like your shop.",
    stepsTitle: "Set up your shop page in five steps",
    steps: [
      {
        title: "Claim your business name",
        body: "Your page will live at yourshop.hydlnk.com, short enough to print on a receipt, a flyer or the window.",
      },
      {
        title: "Say what you do and when",
        body: "Start with a Header and a Text block: what you sell, where you are and your hours. Text holds up to 600 characters and keeps your line breaks.",
      },
      {
        title: "Add the actions",
        body: "Link blocks for ordering online, booking and directions. Each one goes to a web address you already have, such as your order page or a map link.",
      },
      {
        title: "List what you offer",
        body: "A Grid block holds two to six tiles, each with a title, a short line and a link. Use it for services, product lines or this week’s specials.",
      },
      {
        title: "Share it everywhere",
        body: "Put the address in your Instagram and TikTok bios and on your printed materials.",
        link: { href: "/link-in-bio/instagram", label: "Link in bio for Instagram" },
      },
    ],
    fitTitle: "Why small businesses use HYDLNK",
    fits: [
      {
        icon: "text",
        title: "Everything a customer asks, in one place",
        body: "Hours in a Text block, directions and ordering in Link blocks, services in a Grid. When your hours change, edit the text and press Publish.",
      },
      {
        icon: "design",
        title: "Your brand, not ours",
        body: "Your colors, your fonts and your button style. Free pages carry a small “Made with HYDLNK” badge, and Pro removes it and lets you use a domain you own.",
      },
      {
        icon: "tag",
        title: "No cut of your sales",
        body: "We never take a cut of your sales, on any plan. Your links go to your own checkout, so what you earn there is yours.",
      },
      {
        icon: "map",
        title: "Directions and a discount code",
        body: "A Map location block shows your address with an Open in Maps button. A Discount code block gives customers a code to tap and copy, and you can link it to your shop.",
      },
      {
        icon: "chart",
        title: "See what customers tap",
        body: "Every link has its own click count. Free shows the last 30 days, and Pro keeps a year with referrers, devices and countries.",
      },
    ],
    starterTitle: "A first shop page, block by block",
    starter: [
      {
        block: "image",
        title: "A photo of the shop or your best product",
        body: "One strong picture, with alt text, at the top of the page.",
      },
      {
        block: "text",
        title: "Hours and location",
        body: "“Tuesday to Saturday, 8 to 4. 214 Mill Street.” Plain text, easy to change.",
      },
      {
        block: "link",
        title: "Order or book",
        body: "A filled button that goes to your ordering or booking page.",
      },
      {
        block: "grid",
        title: "Services or product lines",
        body: "Two to six tiles, each with a title, a short line and a link.",
      },
      {
        block: "link",
        title: "Directions",
        body: "A button that opens your location on a map.",
      },
    ],
    tryTitle: "Try a shop page",
    faq: [
      {
        question: "Can customers order or pay on the page?",
        answer:
          "Not on the page itself. HYDLNK doesn’t take payments or bookings. A Link block sends customers to your own ordering, booking or checkout page.",
      },
      {
        question: "Do I need a website already?",
        answer:
          "No. Your HYDLNK page can be your first web page, and when you build a bigger site later you can link to it from the same page.",
      },
      {
        question: "Can I use my shop’s own domain?",
        answer:
          "Yes, on Pro. Connect a domain you own, such as links.yourshop.com, and we issue the SSL certificate. HYDLNK doesn’t sell domains.",
      },
      {
        question: "How fast can I change my hours?",
        answer:
          "Edit the Text block and press Publish. Your live page changes when you publish, and not before, so you can fix a typo in a draft without anyone seeing it half done.",
      },
    ],
    related: ["coaches", "instagram", "artists"],
    guides: ["getting-started", "connecting-a-domain"],
    preset: {
      theme: "sage",
      name: "Alder Street Bakery",
      bio: "Small-batch bread and pastry. Tuesday to Saturday, 7 to 3.",
      blocks: ["image", "text", "link", "grid", "link", "social"],
      socials: ["instagram", "tiktok", "website"],
      linkLabels: ["Order for pickup", "Get directions"],
    },
  },

  {
    slug: "coaches",
    kind: "creator",
    name: "Coaches and consultants",
    blurb: "Say what you do and make booking a call the obvious next tap.",
    h1: "Link in bio for coaches and consultants",
    title: "Link in bio for coaches and consultants",
    description:
      "A link in bio page for coaches and consultants: say what you do, show your services and make booking a call the obvious next step.",
    lead: "People who find you on LinkedIn, Instagram or a podcast want one clear next step. Give them a page that says what you do and makes booking a call the obvious thing to tap.",
    stepsTitle: "Set up your coaching page in five steps",
    steps: [
      {
        title: "Claim your name",
        body: "When you work one to one, your own name usually beats a business name. It’s what people type after you’ve been recommended.",
      },
      {
        title: "Introduce yourself in two lines",
        body: "A Text block says who you help and how, in up to 600 characters. Add a short intro video with a YouTube Embed block if you have one.",
      },
      {
        title: "Make booking the main button",
        body: "Add a Link block to your booking page and make it a filled button while the others stay outlined. Any link can have its own button style.",
      },
      {
        title: "List your services",
        body: "A Grid block holds two to six tiles, each with a title, a short line and a link. Use it for your programs, your workshops or your packages.",
      },
      {
        title: "Add proof and a next step",
        body: "A client quote in a Text block, your newsletter in a Link, and LinkedIn and Instagram in a Social row.",
        link: { href: "/link-in-bio/instagram", label: "Link in bio for Instagram" },
      },
    ],
    fitTitle: "Why coaches and consultants use HYDLNK",
    fits: [
      {
        icon: "link",
        title: "One button that stands out",
        body: "Any link or card can override the page’s colors, button style and corner shape, so “Book a call” can be filled while everything else is outlined.",
      },
      {
        icon: "design",
        title: "As polished as your brand",
        body: "Your colors and fonts, with heading and body type chosen separately from 18 fonts. A page that looks careful makes the work look careful.",
      },
      {
        icon: "embed",
        title: "Your intro, on video",
        body: "An Embed block plays a YouTube video on the page. It loads only when someone presses play, so the page stays quick.",
      },
      {
        icon: "domain",
        title: "Your own domain on Pro",
        body: "Use a domain you own, like links.yourname.com, with the SSL certificate issued for you. HYDLNK doesn’t sell domains, so you buy it anywhere.",
      },
    ],
    starterTitle: "A first coaching page, block by block",
    starter: [
      {
        block: "text",
        title: "Who you help",
        body: "“I help first-time managers run their first team without burning out.” Short and specific.",
      },
      {
        block: "link",
        title: "Book a call",
        body: "A filled button to your booking page. Everything else on the page is outlined.",
      },
      {
        block: "grid",
        title: "Your services",
        body: "Two to six tiles: a program, a workshop, a one-off session, each with a link.",
      },
      {
        block: "embed",
        title: "A short intro video",
        body: "You, saying what you do and who it’s for, in a minute or less. Visitors press play when they’re curious.",
      },
      {
        block: "social",
        title: "LinkedIn and Instagram",
        body: "A row of icons, plus your email and your website.",
      },
    ],
    tryTitle: "Try a coaching page",
    faq: [
      {
        question: "Can clients book on the page?",
        answer:
          "Not inside the page. HYDLNK has no booking tool, so your Book a call button goes to the booking page you already use.",
      },
      {
        question: "Can I make one button stand out?",
        answer:
          "Yes. Any link or card can override the page’s colors, button style and corner shape, so one button can be filled while the rest are outlined.",
      },
      {
        question: "Can I use my own domain?",
        answer:
          "Yes, on Pro. Connect a domain you own, such as links.yourname.com, or your root domain. HYDLNK doesn’t sell domains.",
      },
      {
        question: "Can I keep a separate page for a program or workshop?",
        answer:
          "Free includes one page, Pro includes three and Studio includes 15, so each program can have its own address.",
      },
    ],
    related: ["small-business", "podcasters", "x"],
    guides: ["getting-started", "connecting-a-domain"],
    preset: {
      theme: "paper",
      name: "Dana Whitfield",
      bio: "Career coach for people stepping into their first leadership role.",
      blocks: ["text", "link", "grid", "embed", "social"],
      socials: ["linkedin", "instagram", "email"],
      linkLabels: ["Book a free intro call", "Join the newsletter"],
    },
  },
];

export const PLATFORM_AUDIENCES: readonly Audience[] = AUDIENCES.filter(
  (audience) => audience.kind === "platform",
);

export const CREATOR_AUDIENCES: readonly Audience[] = AUDIENCES.filter(
  (audience) => audience.kind === "creator",
);

export function audienceBySlug(slug: string): Audience | undefined {
  return AUDIENCES.find((audience) => audience.slug === slug);
}

/** Root-relative path of the hub, or of one page when a slug is given. */
export function audienceHref(slug?: string): string {
  return slug ? `/link-in-bio/${slug}` : "/link-in-bio";
}

/** The hub's own questions, also the source of its FAQPage structured data. */
export const HUB_FAQ: readonly FaqItem[] = [
  {
    question: "What is a link in bio?",
    answer:
      "One web address you put in your social profile, where an app lets you add only a link or two. It opens a page of buttons, videos, music and text, so a single link can lead to everything you want to share.",
  },
  {
    question: "How do I put a link in my bio?",
    answer:
      "Make your page, then paste its address into your profile’s link or website field. Each app puts that field in a slightly different place, and the pages above show where it is on TikTok, Instagram, YouTube, Twitch and X.",
  },
  {
    question: "Is a HYDLNK link in bio page free?",
    answer:
      "Yes. The free plan has one page with every block and the full set of design choices, with no time limit and no card on file. Pro adds your own domain, more pages and a year of analytics.",
  },
  {
    question: "Can I use the same page on more than one app?",
    answer:
      "Yes. One address works everywhere. Paste it into each profile, and when you change your page and press Publish, every profile that points to it shows the new version.",
  },
];
