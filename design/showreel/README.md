# HYDLNK showreel (HyperFrames source)

The 24 s silent loop in the hero of the marketing home page (`src/components/marketing/showreel.tsx`).
One design, two cuts, each its own HyperFrames project (one root composition per project):

| Folder | Cut | Size | Used |
| --- | --- | --- | --- |
| `design/showreel/` | 16:9 | 1920x1080 | from 760px wide |
| `design/showreel-tall/` | 4:5 | 1080x1350 | phones |

The site serves the encoded files in `public/marketing/showreel/`:
`showreel-16x9.{mp4,webm}`, `showreel-4x5.{mp4,webm}` and a `-poster.webp` per cut (frame 0).
They are committed as they are; nothing here needs to run for the site to build.

## What is in the folders

- `src/reel.css`, `src/reel.js`: the whole design. Every visual state is a pure function of time
  (one GSAP tween drives `render(t)`), and the state at 24 s equals frame 0, so it loops and frame
  0 is the poster.
- `src/build.mjs`: writes `design/showreel/index.html` (16:9) **and** everything of
  `design/showreel-tall/` (4:5 `index.html`, plus a copy of `assets/` and the config files).
  Edit `src/`, then run it; never hand-edit either `index.html`. `showreel-tall/` is committed
  because HyperFrames needs it on disk to render, but it is generated.
- `assets/img/*.webp`: images of the fictional demo brands (no people, text or marks);
  `assets/fonts/*.woff2`: Public Sans and Geist Mono (HYDLNK UI), Fraunces, Instrument Serif and
  Geist (tenant fonts, inside the demo page only); `assets/vendor/gsap.min.js`: GSAP 3.14.2
  (GreenSock standard license), loaded by the composition.
- `BRIEF.md`, `design.md`, `hyperframes.json`, `package.json`, `meta.json`: the HyperFrames brief,
  design spec and project config. `package.json` only holds the `npx` scripts; nothing is installed
  and these folders are not part of the pnpm workspace (eslint and prettier ignore `design/`).
- Not committed: `renders/` (the ~19 MB masters), `snapshots/`, `render.log`.

Needs Node 24, a Chromium that HyperFrames downloads on first use, and `ffmpeg` with libx264 and
libvpx-vp9 (`brew install ffmpeg`), plus `cwebp` (`brew install webp`) for the posters.
Everything below runs from the repo root.

## Preview

```sh
cd design/showreel && npm run dev        # npx --yes hyperframes@0.8.111 preview   (16:9)
cd design/showreel-tall && npm run dev   # the 4:5 cut
npm run check                            # lint the composition
```

## Re-render the masters

```sh
cd design/showreel
node src/build.mjs                       # regenerates both index.html files
npx --yes hyperframes@0.8.111 render --quality standard --output renders/wide-master.mp4
cd ../showreel-tall
npx --yes hyperframes@0.8.111 render --quality standard --output renders/tall-master.mp4
```

Masters: H.264, 30 fps, 720 frames (24.0 s), SDR, BT.709, about 6.5 Mbit/s (19 MB). The site files
are encoded from them with ffmpeg 8.1.2 (libx264 core 165):

## Encode the site files

**MP4** (H.264, High profile, level 4.1, no audio). On the masters rendered above this reproduces
`showreel-16x9.mp4` and `showreel-4x5.mp4` byte for byte (checked 2026-10-02):

```sh
ffmpeg -i renders/wide-master.mp4 -an -c:v libx264 -preset veryslow -tune animation -crf 22 -g 60 \
  -profile:v high -level 4.1 -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -movflags +faststart showreel-16x9.mp4
# 4:5: the same command with renders/tall-master.mp4 and showreel-4x5.mp4
```

Without `-level 4.1`, x264 uses 16 reference frames and writes level 5.1, which is not what ships.

**WebM** (VP9, 8-bit 4:2:0, no audio): two-pass constant-quality libvpx-vp9. The committed files
were encoded with the first-pass stats of the original run (not kept), so the exact settings are
inferred: a CRF of about 27 for 16:9 and about 31 for 4:5 (the 2026-10-03 re-render, with plain-language copy, used 30 for 16:9 to stay near the old size) with `-cpu-used 1 -row-mt 1` lands within
1% of their sizes (1,541 KB against 1,532 KB, and 1,328 KB against 1,341 KB), but not byte for byte.

```sh
F="-an -c:v libvpx-vp9 -b:v 0 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -row-mt 1 -deadline good -cpu-used 1"
ffmpeg -y -i renders/wide-master.mp4 $F -crf 27 -pass 1 -passlogfile /tmp/hl-169 -f null /dev/null
ffmpeg    -i renders/wide-master.mp4 $F -crf 27 -pass 2 -passlogfile /tmp/hl-169 showreel-16x9.webm
# 4:5: renders/tall-master.mp4, -crf 31, showreel-4x5.webm
```

**Posters**: frame 0 of the master, resized and encoded as lossy WebP at quality 78: 1600 px wide for
16:9, 864 px wide for 4:5. The committed posters came from another WebP encoder build, so
`cwebp` 1.6.0 output is about 2% larger.

```sh
ffmpeg -i renders/wide-master.mp4 -frames:v 1 poster-16x9.png
cwebp -q 78 -resize 1600 0 poster-16x9.png -o showreel-16x9-poster.webp
ffmpeg -i renders/tall-master.mp4 -frames:v 1 poster-4x5.png        # in design/showreel-tall
cwebp -q 78 -resize 864 0 poster-4x5.png -o showreel-4x5-poster.webp
```

Copy the results to `public/marketing/showreel/` under the same names. Keep the files small: the
page loads the poster first and the video after `load`, and each cut is 1.3 to 2.4 MB today.
