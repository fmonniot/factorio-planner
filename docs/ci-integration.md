# CI integration notes

## Build pipeline

`npm run build` produces a fully optimized `dist/` ready for static hosting.
No additional commands are required.

```
tsc -b
vite build              # → dist/ with PNG icons copied from public/
node scripts/build-icons.mjs   # postbuild hook (auto-runs)
```

The postbuild step ([scripts/build-icons.mjs](../scripts/build-icons.mjs)) walks
every `dist/data/**/*.png`, writes a sibling `.webp`, and re-encodes the PNG
with palette quantization. It runs in parallel sized to available CPU cores;
expect ~10–30 s for ~3000 icons.

It logs a final size summary, e.g.:

```
[build-icons] 2950/2950 ok
[build-icons] PNG  33.90 MB → 18.42 MB (45.7% smaller)
[build-icons] WebP 9.84 MB (71.0% smaller than source PNG)
```

## What CI needs to do

Just `npm ci && npm run build`, then publish `dist/` to GitHub Pages. Nothing
else — the icon optimization is wired into the standard build.

The `sharp` package is already in `devDependencies` (used by the icon-compositor
during data prep), so no extra install steps are needed.

## What's intentionally NOT here

- **Service worker / aggressive HTTP caching**: deferred. GitHub Pages caps
  `Cache-Control` at `max-age=600` and offers no header customization. Revisit
  with `vite-plugin-pwa` if repeat-visit speed becomes a complaint.
- **Generated `.webp` files committed to git**: they only live in `dist/`,
  built fresh on every CI run. The source `public/data/**/*.png` files stay
  untouched.
