---
workflow: general-video
flow: automation
storyboard: no
message: "Every choice on a HYDLNK page is a token: claim a name, build with blocks, restyle it in one change, take it to your own domain"
destination: website-hero
aspect: 1920x1080 + 1080x1350
language: en
length: 24s
angle: showreel
---

## Intent

The hero intro of the HYDLNK marketing site (hydlnk.com). A seamless 24 s motion-graphics loop
that works as a motion designer's showreel: kinetic type, the brass diamond mark, a link-in-bio
page that assembles block by block and then morphs through theme tokens (colour, type, radius,
button style, background), a phone-to-desktop device transition with a custom domain and sample
analytics, and the handle claim ("yourname.hydlnk.com"). Silent, autoplaying, muted.

## Assets

- assets/img/*.webp — photographs generated for the site's fictional demo brands (no people, text or marks).
- assets/fonts/* — Public Sans, Geist Mono (HYDLNK UI); Fraunces, Instrument Serif, Geist (tenant theme fonts, demo page only).

## Customizations

- Two cuts from one source: 16:9 (1920x1080) for desktop, 4:5 (1080x1350) for phones.
- Loop seam: the state at 24 s equals frame 0; frame 0 is the poster.

## Notes

- Brand: charcoal #1C1B1A stage, brass #B8914F highlights, light surfaces #F4F3F0, 6-10 px corners.
- No stock clichés, no fabricated claims: analytics numbers are labelled sample data.
- No audio track. Final encodes (H.264 MP4 + VP9 WebM) are done with ffmpeg outside HyperFrames.
