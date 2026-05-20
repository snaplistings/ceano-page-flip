// Flipbook — left-hinged photo binder with realistic strip-based page bend.
// Iteration 2: persistent left-stack of flipped pages, gravity sag on the
// free corner, variable-duration flips, and pointer-drag from the page corner.

(function () {
  const { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } = React;
  const h = React.createElement;

  const TOTAL_PAGES = (window.PAGES && window.PAGES.length) || 35;
  // 2D mesh: HSTRIPS columns × VSTRIPS rows. The bottom row bends MORE than
  // the top so the page's bottom-right corner curls further into the flip
  // than the top-right — the asymmetric arc you see in a real page turn.
  //
  // ROW_BEND_SCALE is intentionally non-linear: top and middle rows nearly
  // match (so the top half stays planar) and the bottom row carries most of
  // the extra curl. Localising the curl in the bottom third is what reads
  // as "the page curves in the bottom" rather than as a uniform droop.
  //
  // ROW_SAG_PX is kept uniform across rows. Per-row vertical-sag differences
  // would otherwise produce a visible Y-seam at the row boundary; differential
  // bend creates the curl in 3D depth without breaking Y-continuity.
  const HSTRIPS = 14;
  const VSTRIPS = 3;
  const BASE_TOTAL_BEND = 52;
  const ROW_BEND_SCALE = [1.0, 1.15, 1.7];
  const ROW_SAG_PX = [22, 22, 22];
  // Range used for auto-flips (keyboard/button/tap). Drag flips compute their
  // own release duration from pointer velocity.
  const AUTO_FLIP_MIN_MS = 720;
  const AUTO_FLIP_MAX_MS = 1080;

  // Inner blue page area within the binder image (as % of binder dimensions).
  const PAGE_AREA = {
    left:   170 / 3092 * 100,
    top:    280 / 2160 * 100,
    right:  2980 / 3092 * 100,
    bottom: 1870 / 2160 * 100,
  };
  const PAGE_AREA_STYLE = {
    left: PAGE_AREA.left + '%',
    top: PAGE_AREA.top + '%',
    width: (PAGE_AREA.right - PAGE_AREA.left) + '%',
    height: (PAGE_AREA.bottom - PAGE_AREA.top) + '%',
  };

  // ───────────────────────────── Easing ─────────────────────────────
  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ───────────────────────── Page content lookup ─────────────────────────
  function getPageConfig(pageNum) {
    const list = window.PAGES || [];
    return list[pageNum - 1] || null;
  }

  // ───────────────────────── Page face content ─────────────────────────
  // If `imageOverride` is set, render that image URL directly and skip the
  // pageNum-based lookup. Used for the closed-cover flip animation, which
  // doesn't correspond to any slide in PAGES.
  function PageFaceContent({ pageNum, withTexture = true, imageOverride }) {
    const cfg = imageOverride ? null : getPageConfig(pageNum);
    const isCover = cfg ? cfg.kind === 'cover' : pageNum === 1;
    const hasImage = imageOverride || (cfg && cfg.kind === 'image' && cfg.image);

    const children = [];
    if (withTexture) children.push(h('div', { key: 'tex', className: 'paper-tex' }));

    if (hasImage) {
      // Use a div with CSS background-image instead of <img>. Each strip
      // (and each face) gets its own .page-image, but a background-image
      // URL is decoded ONCE by the browser and the raster is shared across
      // all 84 strips of a flipping page — eliminating the "gray bars"
      // artifact where unpainted <img> tags showed the strip-face background.
      const url = imageOverride || cfg.image;
      children.push(
        h('div', {
          key: 'img',
          className: 'page-image',
          role: 'img',
          'aria-label': imageOverride ? 'Cover' : (cfg.alt || ''),
          style: { backgroundImage: 'url("' + url + '")' },
        })
      );
    } else if (isCover) {
      const title = (cfg && cfg.title) || 'COVER';
      const subtitle = (cfg && cfg.subtitle) || ('Volume 01 · ' + TOTAL_PAGES + ' pages');
      children.push(
        h('div', { key: 'cover', className: 'cover-content' },
          h('div', { className: 'cover-mark' }, '◆'),
          h('div', { className: 'cover-title' }, title),
          h('div', { className: 'cover-sub' }, subtitle)
        )
      );
    } else {
      children.push(
        h('div', { key: 'num', className: 'page-num-wrap' },
          h('div', { className: 'page-num' }, String(pageNum).padStart(2, '0')),
          h('div', { className: 'page-num-sub' }, 'page ' + pageNum + ' of ' + TOTAL_PAGES)
        )
      );
    }
    return h(React.Fragment, null, ...children);
  }

  // ─────────────────── Static (resting) right-side page ───────────────────
  function StaticPage({ pageNum, depth }) {
    const style = {
      transform: 'translate3d(0,0,' + (-depth * 0.6) + 'px)',
      zIndex: 100 - depth,
    };
    return h('div', { className: 'page static', style },
      h('div', { className: 'page-face is-front' },
        h(PageFaceContent, { pageNum }),
        h('div', { className: 'page-inner-shadow' }),
        h('div', { className: 'page-gutter-shadow' })
      )
    );
  }

  // ─────────────────── Left-stack page (already flipped) ───────────────────
  // Persistent depth: each flipped page rests pinned at the rings, rotated
  // 180° around the hinge, fanned slightly outward.
  //
  // Depth 0 (most recently flipped) renders the slide's own image inside a
  // counter-rotated wrapper, so the user keeps seeing the just-turned slide
  // on the left rather than a dark "back of paper" surface.
  // Deeper layers stay as the dark textured back — they're load-bearing only
  // for stack thickness.
  function LeftStackPage({ depth, pageNum }) {
    const fanDeg = -180 - depth * 1.4;
    const zOff = -1 - depth * 0.9;
    const yOff = depth * 0.6;
    const style = {
      transform:
        'translate3d(0,' + yOff + 'px,' + zOff + 'px) ' +
        'rotateY(' + fanDeg + 'deg)',
      zIndex: 10 - depth,
    };
    const inner = depth === 0 && pageNum
      ? h('div', { className: 'left-stack-content' },
          h(PageFaceContent, { pageNum }),
          h('div', { className: 'page-inner-shadow' })
        )
      : h('div', { className: 'left-stack-face' },
          h('div', { className: 'left-stack-tex' }),
          h('div', { className: 'left-stack-edge-shadow' })
        );
    return h('div', { className: 'page left-stack', style }, inner);
  }

  // ─────────────── Strip transform applier (shared by auto + drag) ───────────────
  // Iterates the 2D mesh j outer / i inner. Each row accumulates its own bend
  // (xPx, zPx, cum) independently, so the bottom row's free edge ends further
  // along the curl than the top row's at the same column index — that
  // differential is the bottom curl the user is after.
  function applyStripTransforms(outer, stripRefs, shadowEl, vp, direction, deltaFactors) {
    const parent = outer.parentElement; // .page-area
    const W = (parent && parent.getBoundingClientRect().width) || 800;

    const flipAngle = -180 * vp;
    const bendIntensity = Math.sin(Math.PI * vp); // 0→1→0 peak at mid-flip

    outer.style.transform = 'rotateY(' + flipAngle + 'deg)';
    const lift = bendIntensity * 42;
    outer.style.setProperty('--flip-lift', lift + 'px');

    const stripW = W / HSTRIPS;

    for (let j = 0; j < VSTRIPS; j++) {
      const totalBend = bendIntensity * BASE_TOTAL_BEND * ROW_BEND_SCALE[j];
      const sagMax = bendIntensity * ROW_SAG_PX[j];

      let cum = 0;
      let xPx = 0;
      let zPx = 0;

      for (let i = 0; i < HSTRIPS; i++) {
        const idx = j * HSTRIPS + i;
        const el = stripRefs.current[idx];
        if (el) {
          const tiltRad = cum * Math.PI / 180;
          const shade = Math.min(0.55, Math.abs(Math.sin(tiltRad)) * 0.55);
          const sheenAmt = Math.max(0, Math.cos(tiltRad)) * bendIntensity * 0.18;
          const tNorm = i / (HSTRIPS - 1);
          const sagPx = sagMax * tNorm * tNorm;
          el.style.transform =
            'translate3d(' + xPx + 'px,' + sagPx + 'px,' + (zPx + lift) + 'px) rotateY(' + cum + 'deg)';
          el.style.setProperty('--strip-shade', shade);
          el.style.setProperty('--strip-sheen', sheenAmt);
        }
        const rad = cum * Math.PI / 180;
        xPx += stripW * Math.cos(rad);
        zPx += -stripW * Math.sin(rad);
        cum += deltaFactors[i] * totalBend;
      }
    }

    if (shadowEl) {
      const op = bendIntensity * 0.55;
      const slide = vp * 65;
      shadowEl.style.opacity = op;
      shadowEl.style.setProperty('--shadow-x', slide + '%');
    }
  }

  // ─────────────── Strip-based flipping page (auto + drag) ───────────────
  const FlippingPage = forwardRef(function FlippingPage(props, ref) {
    const { frontPage, frontImage, direction, controlled, autoDurationMs, onDone } = props;
    const outerRef = useRef(null);
    const stripRefs = useRef([]);
    const shadowRef = useRef(null);
    const doneCalled = useRef(false);
    const vpRef = useRef(direction === 'forward' ? 0 : 1);
    const rafRef = useRef(0);

    const deltaFactors = useMemo(() => {
      const arr = [];
      let sum = 0;
      for (let i = 0; i < HSTRIPS; i++) {
        const t = i / (HSTRIPS - 1);
        const f = 0.25 + Math.pow(t, 1.4);
        arr.push(f);
        sum += f;
      }
      return arr.map(f => f / sum);
    }, []);

    const apply = useCallback((vp) => {
      vpRef.current = vp;
      if (!outerRef.current) return;
      applyStripTransforms(outerRef.current, stripRefs, shadowRef.current, vp, direction, deltaFactors);
    }, [direction, deltaFactors]);

    // Initial paint: position strips synchronously BEFORE the browser
    // commits the first frame, so the user never sees the un-styled stacked
    // strips. Especially important for the cover-flip, which starts mounted
    // at vp=0 with a large image.
    useLayoutEffect(() => {
      apply(direction === 'forward' ? 0 : 1);
    }, [apply, direction]);

    // Auto mode: run a single RAF flip from 0→1 (or 1→0 for backward).
    useEffect(() => {
      if (controlled) return;
      const dur = autoDurationMs || 900;
      const start = performance.now();
      const tick = (t) => {
        const elapsed = t - start;
        const p = Math.min(elapsed / dur, 1);
        const eased = easeInOutCubic(p);
        const vp = direction === 'forward' ? eased : 1 - eased;
        apply(vp);
        if (p < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else if (!doneCalled.current) {
          doneCalled.current = true;
          setTimeout(() => onDone('commit'), 20);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    }, [direction, controlled, autoDurationMs, apply, onDone]);

    useImperativeHandle(ref, () => ({
      setVp: (vp) => apply(clamp(vp, 0, 1)),
      release: (targetVp, velocityPerSec) => {
        cancelAnimationFrame(rafRef.current);
        const startVp = vpRef.current;
        const dist = Math.abs(targetVp - startVp);
        // Velocity is in vp-units / sec. Use it to size duration, with floors
        // so a slow-released drag still finishes promptly.
        const v = Math.max(0.4, Math.min(4.5, velocityPerSec));
        const durFromVel = (dist / v) * 1000;
        const dur = Math.max(180, Math.min(620, durFromVel));
        const start = performance.now();
        const tick = (t) => {
          const p = Math.min((t - start) / dur, 1);
          const eased = easeOutCubic(p);
          const vp = startVp + (targetVp - startVp) * eased;
          apply(vp);
          if (p < 1) {
            rafRef.current = requestAnimationFrame(tick);
          } else if (!doneCalled.current) {
            doneCalled.current = true;
            setTimeout(() => onDone(targetVp >= 0.5 ? 'commit' : 'cancel'), 20);
          }
        };
        rafRef.current = requestAnimationFrame(tick);
      },
    }), [apply, onDone]);

    const stripWPct = 100 / HSTRIPS;
    const cellHPct = 100 / VSTRIPS;
    const strips = [];
    for (let j = 0; j < VSTRIPS; j++) {
      for (let i = 0; i < HSTRIPS; i++) {
        const idx = j * HSTRIPS + i;
        strips.push(
          h('div', {
            key: idx,
            ref: el => (stripRefs.current[idx] = el),
            className: 'strip',
            style: {
              width: stripWPct + '%',
              height: cellHPct + '%',
              top: (j * cellHPct) + '%',
            },
          },
            h('div', { className: 'strip-face strip-front' },
              h('div', {
                className: 'strip-content',
                style: {
                  left: (-i * 100) + '%',
                  top: (-j * 100) + '%',
                  width: (HSTRIPS * 100) + '%',
                  height: (VSTRIPS * 100) + '%',
                },
              },
                h(PageFaceContent, { pageNum: frontPage, imageOverride: frontImage, withTexture: false })
              ),
              h('div', { className: 'strip-shade' }),
              h('div', { className: 'strip-sheen' }),
              h('div', { className: 'strip-crease' })
            ),
            h('div', { className: 'strip-face strip-back' },
              // Same slice as the front. Because .strip-back has rotateY(180°)
              // baked in and the parent strip reaches ~180° at flip end, the
              // back content's net rotation lands at 0° in viewer space — so
              // the slice renders identically to the front, no extra orientation
              // math needed. This is what eliminates the "page goes black at
              // 90°" moment.
              h('div', {
                className: 'strip-content',
                style: {
                  left: (-i * 100) + '%',
                  top: (-j * 100) + '%',
                  width: (HSTRIPS * 100) + '%',
                  height: (VSTRIPS * 100) + '%',
                },
              },
                h(PageFaceContent, { pageNum: frontPage, imageOverride: frontImage, withTexture: false })
              ),
              h('div', { className: 'strip-shade' })
            )
          )
        );
      }
    }

    return h(React.Fragment, null,
      h('div', { ref: shadowRef, className: 'flip-cast-shadow' }),
      h('div', { ref: outerRef, className: 'flipping-outer' }, ...strips)
    );
  });

  // ──────────────────── Preload next image (smoothness) ────────────────────
  function usePreloadNeighbors(current) {
    useEffect(() => {
      const list = window.PAGES || [];
      const urls = [current, current + 1, current + 2]
        .map(n => list[n - 1])
        .filter(p => p && p.kind === 'image' && p.image)
        .map(p => p.image);
      urls.forEach(url => {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
      });
    }, [current]);
  }

  // ───────────────────────── Closed-cover landing ─────────────────────────
  function ClosedCover({ imageUrl, dismissing, onCTAClick }) {
    return h('div', {
      className: 'closed-cover' + (dismissing ? ' dismissing' : ''),
      'aria-hidden': dismissing ? 'true' : 'false',
    },
      h('img', {
        className: 'cover-img',
        src: imageUrl,
        alt: 'Ceano lookbook cover',
        draggable: false,
        fetchpriority: 'high',
      }),
      h('button', {
        className: 'cta-button',
        onClick: onCTAClick,
        'aria-label': 'Open the lookbook — Exclusive First Look',
      },
        'Exclusive First Look →'
      )
    );
  }

  // ───────────────────────────── Main ─────────────────────────────
  function Flipbook() {
    // Entry state machine:
    //   closed   → landing screen with the suede cover + CTA
    //   opening  → cover-flip animation in progress (FlippingPage with the
    //              cover image, hinged on the viewport's left edge)
    //   zooming  → binder is scaling up to fill the viewport, chrome fading
    //   open     → full-screen flipbook; normal flipping behavior takes over
    const hasCover = !!window.COVER_IMAGE_URL;
    const [mode, setMode] = useState(hasCover ? 'closed' : 'open');
    const [current, setCurrent] = useState(1);
    // flip: null | { dir, from, mode: 'auto'|'drag', durationMs?: number }
    const [flip, setFlip] = useState(null);
    const [zoomStyle, setZoomStyle] = useState(null);
    const flipRef = useRef(null);
    const coverFlipRef = useRef(null);
    const binderWrapRef = useRef(null);
    const coverAreaRef = useRef(null);
    const [hintVisible, setHintVisible] = useState(() => {
      try { return !localStorage.getItem('fb-hint-seen'); } catch (e) { return true; }
    });
    const stageRef = useRef(null);
    usePreloadNeighbors(current);

    // CTA on the closed cover → start the cover-flip.
    const openCover = useCallback(() => {
      if (mode !== 'closed') return;
      setMode('opening');
    }, [mode]);

    // Called by the cover-flip's FlippingPage when its animation completes.
    // We measure the page-area's current viewport rect and compute the
    // scale+translate that puts the page-area exactly on the viewport.
    const handleCoverFlipDone = useCallback(() => {
      const wrap = binderWrapRef.current;
      if (!wrap) { setMode('open'); return; }
      const area = wrap.querySelector('.page-area');
      if (!area) { setMode('open'); return; }
      const wrapRect = wrap.getBoundingClientRect();
      const areaRect = area.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Cover-fit so the whole viewport is covered by the page-area; the
      // binder edges that leak off-screen are hidden by .fullscreen later.
      const scale = Math.max(vw / areaRect.width, vh / areaRect.height);
      const areaCx = areaRect.left + areaRect.width / 2;
      const areaCy = areaRect.top + areaRect.height / 2;
      const dx = vw / 2 - areaCx;
      const dy = vh / 2 - areaCy;
      const originX = ((areaCx - wrapRect.left) / wrapRect.width) * 100;
      const originY = ((areaCy - wrapRect.top) / wrapRect.height) * 100;
      setZoomStyle({
        transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')',
        transformOrigin: originX + '% ' + originY + '%',
      });
      setMode('zooming');
    }, []);

    // Advance zooming → open when the transform transition finishes.
    useEffect(() => {
      if (mode !== 'zooming') return;
      const wrap = binderWrapRef.current;
      if (!wrap) return;
      const onEnd = (e) => {
        if (e.propertyName === 'transform' && e.target === wrap) {
          setMode('open');
        }
      };
      wrap.addEventListener('transitionend', onEnd);
      // Fallback in case transitionend doesn't fire (e.g. page hidden).
      const t = setTimeout(() => setMode('open'), 900);
      return () => {
        wrap.removeEventListener('transitionend', onEnd);
        clearTimeout(t);
      };
    }, [mode]);

    const dismissHint = useCallback(() => {
      setHintVisible(false);
      try { localStorage.setItem('fb-hint-seen', '1'); } catch (e) {}
    }, []);

    // Navigation is gated until the cover has finished opening + zooming.
    const interactive = mode === 'open';
    const canGoNext = interactive && current < TOTAL_PAGES && !flip;
    const canGoPrev = interactive && current > 1 && !flip;

    useEffect(() => {
      // Defer the auto-dismiss timer until the user has actually reached
      // the flipbook view, otherwise the hint times out while they're
      // still looking at the cover.
      if (!hintVisible || !interactive) return;
      const t = setTimeout(() => dismissHint(), 6000);
      return () => clearTimeout(t);
    }, [hintVisible, dismissHint, interactive]);

    const randomDuration = () =>
      AUTO_FLIP_MIN_MS + Math.random() * (AUTO_FLIP_MAX_MS - AUTO_FLIP_MIN_MS);

    const goNext = useCallback(() => {
      if (!canGoNext) return;
      dismissHint();
      setFlip({ dir: 'forward', from: current, mode: 'auto', durationMs: randomDuration() });
    }, [canGoNext, current, dismissHint]);

    const goPrev = useCallback(() => {
      if (!canGoPrev) return;
      dismissHint();
      setFlip({ dir: 'backward', from: current - 1, mode: 'auto', durationMs: randomDuration() });
    }, [canGoPrev, current, dismissHint]);

    const onFlipDone = useCallback((outcome) => {
      setFlip(prev => {
        if (!prev) return null;
        if (outcome === 'commit') {
          if (prev.dir === 'forward') setCurrent(c => c + 1);
          else setCurrent(c => c - 1);
        }
        // 'cancel' simply leaves current page where it was.
        return null;
      });
    }, []);

    // Keyboard
    useEffect(() => {
      const onKey = (e) => {
        // Enter / Space on the closed cover opens the book.
        if (mode === 'closed' && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openCover();
          return;
        }
        // Other navigation is gated to the open flipbook.
        if (!interactive) return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
          e.preventDefault(); goNext();
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault(); goPrev();
        } else if (e.key === 'Home') {
          if (!flip) setCurrent(1);
        } else if (e.key === 'End') {
          if (!flip) setCurrent(TOTAL_PAGES);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [goNext, goPrev, flip, interactive, mode, openCover]);

    // ─────────── Pointer drag (right corner forward, left corner backward) ───────────
    const dragStateRef = useRef(null);
    const pageAreaRef = useRef(null);

    const startDrag = useCallback((e, dir) => {
      if (flip) return;
      if (dir === 'forward' && !(current < TOTAL_PAGES)) return;
      if (dir === 'backward' && !(current > 1)) return;
      const area = pageAreaRef.current;
      if (!area) return;
      const rect = area.getBoundingClientRect();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}

      dragStateRef.current = {
        dir,
        pointerId: e.pointerId,
        rect,
        startX: e.clientX,
        lastX: e.clientX,
        lastT: performance.now(),
        velocity: 0, // vp/sec
        vp: dir === 'forward' ? 0 : 1,
      };
      dismissHint();
      setFlip({
        dir,
        from: dir === 'forward' ? current : current - 1,
        mode: 'drag',
      });
    }, [flip, current, dismissHint]);

    const moveDrag = useCallback((e) => {
      const s = dragStateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      const now = performance.now();
      const dx = e.clientX - s.startX;
      // Forward: dragging LEFT (dx < 0) increases vp 0→1.
      // Backward: dragging RIGHT (dx > 0) decreases vp 1→0.
      let vp;
      if (s.dir === 'forward') vp = clamp(-dx / s.rect.width, 0, 1);
      else vp = clamp(1 - (dx / s.rect.width), 0, 1);

      // Track velocity (vp per second) over the most recent move.
      const dt = Math.max(0.001, (now - s.lastT) / 1000);
      const dvp = vp - s.vp;
      // EMA so a single jittery sample doesn't dominate.
      s.velocity = 0.7 * s.velocity + 0.3 * (dvp / dt);
      s.lastX = e.clientX;
      s.lastT = now;
      s.vp = vp;
      if (flipRef.current) flipRef.current.setVp(vp);
    }, []);

    const endDrag = useCallback((e) => {
      const s = dragStateRef.current;
      if (!s || (e && e.pointerId !== s.pointerId)) return;
      dragStateRef.current = null;
      try { e && e.currentTarget && e.currentTarget.releasePointerCapture(s.pointerId); } catch (_) {}

      const vp = s.vp;
      const vel = s.velocity; // vp per second (signed)
      // Commit / cancel decision: position OR velocity wins.
      let target;
      if (vel > 1.2) target = 1;
      else if (vel < -1.2) target = 0;
      else target = vp >= 0.5 ? 1 : 0;
      const speed = Math.max(0.6, Math.abs(vel));
      if (flipRef.current) flipRef.current.release(target, speed);
    }, []);

    // Touch swipe fallback (only when not dragging via pointer)
    useEffect(() => {
      const el = stageRef.current;
      if (!el) return;
      let sx = 0, sy = 0, tracking = false;
      const onStart = (e) => {
        if (dragStateRef.current) return; // already in pointer-drag
        const t = e.changedTouches ? e.changedTouches[0] : e;
        sx = t.clientX; sy = t.clientY; tracking = true;
      };
      const onEnd = (e) => {
        if (!tracking) return;
        tracking = false;
        if (dragStateRef.current) return;
        const t = e.changedTouches ? e.changedTouches[0] : e;
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0) goNext(); else goPrev();
        }
      };
      el.addEventListener('touchstart', onStart, { passive: true });
      el.addEventListener('touchend', onEnd, { passive: true });
      return () => {
        el.removeEventListener('touchstart', onStart);
        el.removeEventListener('touchend', onEnd);
      };
    }, [goNext, goPrev]);

    const renderStack = () => {
      // Left-side persistent stack: pages 1..leftStackTopPage, with depth 0 =
      // the most recently flipped slide and deeper depths receding behind it.
      //
      // During a BACKWARD flip, the page currently on top of the left stack
      // (page current-1) is in flight, so the stack effectively shrinks by 1.
      // For forward flips or no flip, the topmost left page is current-1.
      const leftStackTopPage = (flip && flip.dir === 'backward')
        ? current - 2
        : current - 1;
      const leftCount = Math.max(0, Math.min(leftStackTopPage, 6));

      const out = [];
      // In full-screen mode (post-zoom) the binder/rings are gone, so there's
      // nowhere for the left-stack to visually attach — skip it.
      if (mode !== 'open') {
        for (let i = 0; i < leftCount; i++) {
          const pageNum = leftStackTopPage - i;
          out.push(h(LeftStackPage, { key: 'ls-' + i, depth: i, pageNum }));
        }
      } else {
        // Reference so the linter sees the variable used; cheap no-op.
        void leftCount;
      }

      let topVisiblePage, flippingPageNum;
      if (flip) {
        if (flip.dir === 'forward') {
          flippingPageNum = current;
          topVisiblePage = current + 1;
        } else {
          flippingPageNum = current - 1;
          topVisiblePage = current;
        }
      } else {
        topVisiblePage = current;
      }

      const depthPages = [topVisiblePage, topVisiblePage + 1, topVisiblePage + 2]
        .filter(n => n >= 1 && n <= TOTAL_PAGES);
      depthPages.forEach((n, i) => {
        out.push(h(StaticPage, { key: 's-' + n, pageNum: n, depth: i }));
      });

      if (flip) {
        out.push(
          h(FlippingPage, {
            key: 'f-' + flip.from + '-' + flip.dir + '-' + flip.mode,
            ref: flipRef,
            frontPage: flippingPageNum,
            direction: flip.dir,
            controlled: flip.mode === 'drag',
            autoDurationMs: flip.durationMs,
            onDone: onFlipDone,
          })
        );
      }
      return out;
    };

    const chevronLeft = h('svg', { viewBox: '0 0 24 24', width: 22, height: 22 },
      h('path', { d: 'M15 5l-7 7 7 7', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })
    );
    const chevronRight = h('svg', { viewBox: '0 0 24 24', width: 22, height: 22 },
      h('path', { d: 'M9 5l7 7-7 7', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })
    );

    const binderWrapClass =
      'binder-wrap' +
      (mode === 'zooming' ? ' zooming' : '') +
      (mode === 'open' ? ' fullscreen' : '');

    // Cover-flip stage. Now lives INSIDE .binder-wrap so it has the same
    // bounding rect as the binder. The hinge (left edge of cover-page-area)
    // sits at the binder's left edge, so when the cover swings away the
    // rings appear from underneath in a natural "lookbook opening" motion.
    const coverStage = mode === 'opening' && h('div', { className: 'cover-stage', key: 'cover-stage' },
      h('div', { className: 'cover-page-area', ref: coverAreaRef },
        h(FlippingPage, {
          key: 'cover-flip',
          ref: coverFlipRef,
          frontImage: window.COVER_IMAGE_URL,
          direction: 'forward',
          autoDurationMs: 1100, // a touch slower than a normal flip for drama
          onDone: handleCoverFlipDone,
        })
      )
    );

    // Closed-cover overlay also lives inside .binder-wrap so it occupies
    // the exact binder rect (with the pale background visible around it).
    const closedCover = mode === 'closed' && h(ClosedCover, {
      key: 'closed-cover',
      imageUrl: window.COVER_IMAGE_URL,
      onCTAClick: openCover,
    });

    return h('div', { className: 'app' },
      h('button', {
        className: 'nav-btn nav-prev' + (interactive ? '' : ' hidden'),
        onClick: goPrev,
        disabled: !canGoPrev,
        tabIndex: interactive ? 0 : -1,
        'aria-hidden': interactive ? 'false' : 'true',
        'aria-label': 'Previous page',
      }, chevronLeft),

      h('div', { className: 'stage', ref: stageRef },
        h('div', {
          className: binderWrapClass,
          ref: binderWrapRef,
          style: zoomStyle || undefined,
        },
          h('img', { src: 'binder.png', className: 'binder-img', alt: '', draggable: false, fetchpriority: 'high' }),
          h('div', { className: 'page-area', style: PAGE_AREA_STYLE, ref: pageAreaRef },
            ...renderStack(),
            // Drag zones — wider than the click targets so the corner is grabbable.
            canGoNext && h('div', {
              key: 'drag-fwd',
              className: 'drag-zone drag-fwd',
              onPointerDown: (e) => startDrag(e, 'forward'),
              onPointerMove: moveDrag,
              onPointerUp: endDrag,
              onPointerCancel: endDrag,
            }),
            canGoPrev && h('div', {
              key: 'drag-bwd',
              className: 'drag-zone drag-bwd',
              onPointerDown: (e) => startDrag(e, 'backward'),
              onPointerMove: moveDrag,
              onPointerUp: endDrag,
              onPointerCancel: endDrag,
            }),
            // Tap-to-flip corners (kept for quick click affordance — only fire if no drag occurred).
            canGoNext && h(React.Fragment, { key: 'next-corners' },
              h('div', { className: 'corner-target tr', onClick: () => { if (!flip) goNext(); }, 'aria-label': 'Next' }),
              h('div', { className: 'corner-target br', onClick: () => { if (!flip) goNext(); }, 'aria-label': 'Next' })
            ),
            canGoPrev && h(React.Fragment, { key: 'prev-corners' },
              h('div', { className: 'corner-target tl', onClick: () => { if (!flip) goPrev(); }, 'aria-label': 'Previous' }),
              h('div', { className: 'corner-target bl', onClick: () => { if (!flip) goPrev(); }, 'aria-label': 'Previous' })
            )
          ),
          h('img', { src: 'rings-overlay.png', className: 'rings-img', alt: '', draggable: false, fetchpriority: 'high' }),
          // Cover overlays live inside .binder-wrap so they share its rect.
          // Order matters: cover-stage above binder/page-area/rings, closedCover
          // above everything (z-index in CSS handles stacking).
          coverStage,
          closedCover
        )
      ),

      h('button', {
        className: 'nav-btn nav-next' + (interactive ? '' : ' hidden'),
        onClick: goNext,
        disabled: !canGoNext,
        tabIndex: interactive ? 0 : -1,
        'aria-hidden': interactive ? 'false' : 'true',
        'aria-label': 'Next page',
      }, chevronRight),

      interactive && h('div', { className: 'chrome' },
        h('div', { className: 'counter' },
          h('span', { className: 'counter-num' }, String(current).padStart(2, '0')),
          h('span', { className: 'counter-sep' }, '/'),
          h('span', { className: 'counter-total' }, TOTAL_PAGES)
        )
      ),

      hintVisible && interactive && h('div', { className: 'hint', onClick: dismissHint },
        h('kbd', null, '←'),
        ' ',
        h('kbd', null, '→'),
        ' ',
        h('span', null, 'drag a corner, or'),
        ' ',
        h('span', null, 'to flip')
      )
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(Flipbook));
})();
