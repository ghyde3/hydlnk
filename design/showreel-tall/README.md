# HYDLNK showreel, 4:5 cut (1080x1350)

Generated: edit `design/showreel/src/` and run `node src/build.mjs` there, which rewrites this
folder's `index.html` and copies `assets/` and the config files here. Preview, render and encode
instructions are in `design/showreel/README.md`.

```sh
npm run dev                                   # preview this cut
npx --yes hyperframes@0.8.111 render --quality standard --output renders/tall-master.mp4
```
