-- HYDLNK Milestone 0: reference data that must exist in every environment.
-- This is a migration (not seed.sql) on purpose, so it reaches production.

-- ---------------------------------------------------------------------------
-- Reserved handles
--
-- Handles are subdomains (handle.hydlnk.com), so this covers hosts the platform
-- itself uses, mail and DNS conventions, product routes and pages, and a few brand
-- names that would make convincing phishing pages. Single letters (e, r, t) can
-- never pass the 3-30 character handle rule; they are listed because they are
-- internal path segments. Add to the list with a new migration, never by editing
-- this one.
-- ---------------------------------------------------------------------------

insert into public.reserved_handles (handle)
select unnest(array[
  -- platform hosts and routes
  'www', 'app', 'api', 'admin', 'auth', 'mail', 'email', 'help', 'support', 'status',
  'blog', 'docs', 'static', 'cdn', 'assets', 'sites', 'site', 'r', 'e', 't',
  'about', 'pricing', 'login', 'logout', 'signup', 'signin', 'register', 'dashboard',
  'settings', 'billing', 'account', 'terms', 'privacy', 'legal', 'security', 'abuse',
  'report', 'hydlnk', 'root', 'staging', 'dev', 'test', 'demo',
  'editor', 'design', 'domains', 'domain', 'analytics', 'stats', 'themes', 'theme',
  'templates', 'explore', 'discover', 'search', 'home', 'index', 'public', 'private',
  'internal', 'system', 'new', 'upgrade', 'plans', 'plan', 'pro', 'free', 'studio',
  'checkout', 'pay', 'payments', 'invoice', 'invoices', 'subscribe', 'unsubscribe',
  'callback', 'oauth', 'sso', 'webhook', 'webhooks', 'stripe', 'embed', 'preview',
  'ads', 'press', 'media', 'news', 'jobs', 'careers', 'contact', 'sales', 'team',
  'store', 'shop', 'download', 'downloads', 'feed', 'rss', 'sitemap', 'robots',
  'favicon', 'manifest', 'cname', 'dns', 'proxy', 'edge', 'origin', 'local',
  'localhost', 'beta', 'alpha', 'preprod', 'prod', 'production', 'sandbox',
  -- mail and DNS conventions
  'ftp', 'sftp', 'ssh', 'smtp', 'imap', 'pop', 'pop3', 'mx', 'ns', 'ns1', 'ns2',
  'postmaster', 'hostmaster', 'webmaster', 'noreply', 'no-reply', 'info', 'hello',
  'autoconfig', 'autodiscover',
  -- reserved words that break naive code
  'null', 'undefined', 'true', 'false', 'none', 'nan',
  -- providers this platform is built on
  'vercel', 'supabase', 'github', 'google',
  -- impersonation targets for open signup
  'paypal', 'apple', 'microsoft', 'amazon', 'facebook', 'instagram', 'tiktok',
  'youtube', 'twitter', 'linkedin', 'spotify', 'netflix', 'whatsapp', 'telegram',
  'discord', 'snapchat', 'bank', 'wallet', 'verify', 'secure', 'official'
]) as handle
on conflict (handle) do nothing;

-- ---------------------------------------------------------------------------
-- System themes (owner_id null): Noir, Ivory, Smoke
--
-- Complete TokenSets, derived from design/mockups/Design.dc.html (theme list) and
-- Public.dc.html (Noir as rendered on a tenant page). Fixed ids so seed data,
-- tests and fixtures can refer to them; the same ids exist in every environment.
--   Noir  00000000-0000-4000-8000-000000000001
--   Ivory 00000000-0000-4000-8000-000000000002
--   Smoke 00000000-0000-4000-8000-000000000003
--
-- Derivations: textMuted = the mockup's `muted`; buttonBg = accent;
-- buttonText = the mockup's button ink (dark ink on a light accent, light ink on
-- a dark accent); border = the Public.dc.html card border for Noir, and the
-- Design.dc.html line colour (text at 18% over bg) for Ivory and Smoke;
-- maxWidth 480 = the Public.dc.html column.
-- ---------------------------------------------------------------------------

insert into public.themes (id, owner_id, name, tokens)
values
  (
    '00000000-0000-4000-8000-000000000001', null, 'Noir',
    '{
      "bg": "#16120E",
      "surface": "#221B13",
      "text": "#EFE8DC",
      "textMuted": "#A79E90",
      "accent": "#C9A86A",
      "buttonBg": "#C9A86A",
      "buttonText": "#15110B",
      "border": "#3A342D",
      "fontHeading": "Instrument Serif",
      "fontBody": "Geist",
      "scale": 1,
      "weightHeading": 400,
      "letterCase": "none",
      "radius": 12,
      "borderWidth": 1,
      "buttonStyle": "outline",
      "density": "regular",
      "maxWidth": 480,
      "align": "center",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000002', null, 'Ivory',
    '{
      "bg": "#F3EEE4",
      "surface": "#E6DDCD",
      "text": "#1B1814",
      "textMuted": "#5E564B",
      "accent": "#1B1814",
      "buttonBg": "#1B1814",
      "buttonText": "#F7F3EC",
      "border": "#CCC7BF",
      "fontHeading": "Fraunces",
      "fontBody": "Geist",
      "scale": 1,
      "weightHeading": 600,
      "letterCase": "none",
      "radius": 4,
      "borderWidth": 1,
      "buttonStyle": "fill",
      "density": "airy",
      "maxWidth": 480,
      "align": "center",
      "bgType": "solid",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000003', null, 'Smoke',
    '{
      "bg": "#1C2023",
      "surface": "#262C30",
      "text": "#E6EAEC",
      "textMuted": "#9AA4AA",
      "accent": "#9DB3C4",
      "buttonBg": "#9DB3C4",
      "buttonText": "#15110B",
      "border": "#404447",
      "fontHeading": "Geist",
      "fontBody": "Geist",
      "scale": 1,
      "weightHeading": 600,
      "letterCase": "none",
      "radius": 20,
      "borderWidth": 1,
      "buttonStyle": "pill",
      "density": "regular",
      "maxWidth": 480,
      "align": "center",
      "bgType": "gradient",
      "bgImage": null,
      "overlayOpacity": 0,
      "blur": 0
    }'::jsonb
  )
on conflict (id) do nothing;
