# Ceano Page Flip

Interactive lookbook for Ceano Residences — a left-hinged 3D binder with a realistic page-curl animation, drag-to-flip gestures, and a full-screen slide viewer.

## What it is

- A single static `index.html` (no build step) deployable as-is to Vercel or any static host.
- React 18 via UMD + plain JavaScript (no JSX runtime, no bundler).
- Page curl is rendered as a **14 × 3 cell mesh** of CSS 3D transforms — each strip rotates independently around the hinge, with a non-linear bend distribution that concentrates the curl at the bottom of the page (real-paper "gravity sag" feel).
- Cover-flip + zoom + full-screen flipbook state machine: lands on a closed-cover image, clicks the CTA to flip it open, zooms the binder up to fullscreen, then flips slide-to-slide.

## Files

| Path | Purpose |
|---|---|
| `index.html` | Page shell, all CSS, React + ReactDOM UMD script tags |
| `flipbook.js` | The flipbook component (plain React.createElement) |
| `pages.js` | Cover URL + 32-slide CDN URL array — the *only* file to edit when swapping content |
| `binder.png` | Binder artwork (5.4 MB) |
| `rings-overlay.png` | Ring binder hardware overlay (332 KB) |

## Running locally

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Deploying

It's a static site — drop it on Vercel, Netlify, GitHub Pages, S3, anything.

```bash
vercel deploy
```

## Controls

- Click "Exclusive First Look →" on the cover to open the book.
- Then: `→` / `←` arrows, click corners of the page, swipe on touch, or drag a corner with the mouse to flip.
- `Home` / `End` jump to first / last slide.

## Editing the slides

Open [`pages.js`](pages.js) and replace the CDN URLs (or `window.COVER_IMAGE_URL`). `TOTAL_PAGES` auto-derives from the array length.
