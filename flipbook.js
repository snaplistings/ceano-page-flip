// Flipbook — simple rigid-sheet page flip inside the Ceano binder.
//
// Slides are stills by default; a page may instead be { kind: 'video', video }
// (see pages.js), rendered as a muted <video> that plays through once. The
// clip starts only when its slide is the resting/landed slide — not while it
// sits behind an in-flight flip or rides along as a transient flip face.
//
// Iteration 10: restored the binder artwork (binder.png + rings-overlay.png)
// while keeping iteration-9's gains: single-element rotateY flip (no strip
// mesh / curl / drag / left-stack) and contain-fit zoom (no over-zoom on
// mobile).
//
// Two hinges:
//   • Cover-flip hinges at the binder-wrap's left edge (the cover spans the
//     full binder rect, so it swings open like a book cover).
//   • Slide-to-slide flips hinge at the page-area's left edge (right next
//     to the rings) — same as a real binder page pivoting on the rings.

(function () {
  const { useState, useEffect, useRef, useCallback } = React;
  const h = React.createElement;

  const TOTAL_PAGES = (window.PAGES && window.PAGES.length) || 1;
  const FLIP_MS = 800;          // slide-to-slide flip duration
  const COVER_FLIP_MS = 1000;   // cover-flip is a touch slower for drama
  const ZOOM_MS = 700;

  // Inner page well within the 16:9 binder tray (binder_1x.webp), as % of the
  // binder-wrap. Width% == height% so the well stays 16:9 and 1920×1080 slides
  // fit without distortion. Only briefly visible during the cover-flip before
  // the slide zooms to full-screen, so exact framing is not critical.
  const PAGE_AREA = {
    left:   9,
    top:    8.5,
    right:  92,
    bottom: 91.5,
  };
  const PAGE_AREA_STYLE = {
    left:   PAGE_AREA.left + '%',
    top:    PAGE_AREA.top + '%',
    width:  (PAGE_AREA.right - PAGE_AREA.left) + '%',
    height: (PAGE_AREA.bottom - PAGE_AREA.top) + '%',
  };

  // ───────────────────────────── Easing ─────────────────────────────
  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // ──────────────────────── Page content lookup ────────────────────────
  // Returns the full page config ({ kind, image | video, alt }) so callers
  // can render either a still or a video.
  function getPage(pageNum) {
    const list = window.PAGES || [];
    return list[pageNum - 1] || null;
  }

  // ─────────────────────────── Floor-plan CTA ───────────────────────────
  // Slides that set `download: true` show an invisible top-right hotspot over the
  // printed "DOWNLOAD FLOOR PLAN" pill. Clicking it opens that slide's residence
  // PDF (`page.downloadUrl`) in a new browser tab. We fire a target=_blank anchor
  // from the click gesture (rather than window.open) to avoid popup blockers.
  function openExternal(url) {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  function openFloorPlan(page) {
    if (page) openExternal(page.downloadUrl || page.image);
  }

  // On compact viewports (<=1366px: mobile or tablet) a slide may define a
  // `mobileImage`; swap it in for the desktop `image` so StaticSlide/FlipFace render
  // the mobile still with no change to those components (also covers flip faces).
  function resolvePage(page, isCompact) {
    if (isCompact && page && page.mobileImage) {
      return Object.assign({}, page, { image: page.mobileImage });
    }
    return page;
  }

  // ─────────────────────────── Slide video ───────────────────────────
  // Muted, inline. By default plays through once (no `controls`) and holds on its
  // final frame; pass `loop` to loop continuously instead (used for the Waves
  // end-card backdrop). Playback is gated on `active`: the clip starts from frame 0
  // only once the slide is the resting/landed slide — never while it's the
  // destination behind an in-flight flip or a transient flip face. This is why
  // a slide-2 video doesn't start until the page actually lands on slide 2.
  // We drive play/pause imperatively (not via the `autoPlay` attribute, which
  // would fire on mount) and force the `muted` DOM *property*, since React
  // doesn't reliably set it from the attribute and unmuted autoplay is blocked.
  function SlideVideo({ src, className, active, loop }) {
    const ref = useRef(null);
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      el.muted = true;
      if (active) {
        try { el.currentTime = 0; } catch (e) {}
        const p = el.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } else {
        el.pause();
      }
    }, [src, active]);
    return h('video', {
      ref: ref,
      src: src,
      className: className,
      muted: true,
      loop: !!loop,
      playsInline: true,
      preload: 'auto',
    });
  }

  // ───────────────────────── Closed-cover landing ─────────────────────────
  // The whole cover is a click target (onClick on the container), so clicking
  // anywhere flips the book open — not just the printed CTA. The inner button
  // stays for keyboard focus + an accessible name; its click harmlessly bubbles
  // to the same handler (openCover is guarded, so a double call is a no-op).
  function ClosedCover({ imageUrl, onCTAClick }) {
    return h('div', { className: 'closed-cover', onClick: onCTAClick },
      h('div', {
        className: 'closed-cover-image',
        role: 'img',
        'aria-label': 'Ceano lookbook cover',
        style: { backgroundImage: 'url("' + imageUrl + '")' },
      }),
      h('button', {
        className: 'cta-button',
        onClick: onCTAClick,
        'aria-label': 'Open the lookbook — Exclusive First Look',
      }, 'Exclusive First Look →')
    );
  }

  // Centered overlay image composited on top of a slide's fill (e.g. the cream
  // Thank-You emblem on the Waves end card). Returns null unless the page sets
  // `overlay`. pointer-events:none keeps the prev/next click targets clickable.
  function SlideOverlay({ page }) {
    if (!page || !page.overlay) return null;
    return h('img', {
      className: 'slide-overlay',
      src: page.overlay,
      alt: page.overlayAlt || '',
      draggable: false,
    });
  }

  // ─────────────────────── Static slide (background) ───────────────────────
  // Renders inside .page-area as the current/destination slide while a flip
  // is happening, or as the resting slide otherwise. When the page has an
  // `overlay`, the centered emblem is rendered as a sibling above the fill.
  function StaticSlide({ page, active }) {
    if (!page) return null;
    let fill = null;
    if (page.kind === 'video' && page.video) {
      fill = h(SlideVideo, { key: 'fill', src: page.video, className: 'static-slide', active: active, loop: page.loop });
    } else if (page.image) {
      fill = h('div', { key: 'fill', className: 'static-slide', style: { backgroundImage: 'url("' + page.image + '")' } });
    }
    if (!page.overlay) return fill;
    return [fill, h(SlideOverlay, { key: 'overlay', page: page })];
  }

  // One flip-page face — a still (background-image div) or a video. Flip faces
  // are transient (the page is mid-rotation), so their videos never autoplay;
  // playback is owned by the resting StaticSlide once the slide lands.
  function FlipFace({ page, faceClass }) {
    // Overlay pages: wrap the fill + centered emblem inside the rotating face so
    // the overlay stays glued to the slide through the flip. The face is
    // transform-style:flat with backface-visibility:hidden, so its children
    // flatten into and hide/show with the face plane (no pop-in on landing).
    if (page && page.overlay) {
      const fill = page.kind === 'video' && page.video
        ? h(SlideVideo, { key: 'fill', src: page.video, className: 'slide-fill', active: false, loop: page.loop })
        : h('div', { key: 'fill', className: 'slide-fill', style: page.image ? { backgroundImage: 'url("' + page.image + '")' } : undefined });
      return h('div', { className: faceClass }, fill, h(SlideOverlay, { key: 'overlay', page: page }));
    }
    if (page && page.kind === 'video' && page.video) {
      return h(SlideVideo, { src: page.video, className: faceClass, active: false, loop: page.loop });
    }
    return h('div', {
      className: faceClass,
      style: page && page.image ? { backgroundImage: 'url("' + page.image + '")' } : undefined,
    });
  }

  // ─────────────────── Simple rigid-sheet flipping page ───────────────────
  // One element rotating around its left edge. Reused for both the cover-flip
  // (at .binder-wrap size) and slide-to-slide flips (at .page-area size).
  function SimpleFlippingPage({ frontPage, backPage, direction, durationMs, onDone }) {
    const outerRef = useRef(null);
    const doneCalled = useRef(false);

    useEffect(() => {
      const apply = (vp) => {
        if (outerRef.current) {
          outerRef.current.style.transform = 'rotateY(' + (-180 * vp) + 'deg)';
        }
      };
      apply(direction === 'forward' ? 0 : 1);

      const start = performance.now();
      let raf;
      const tick = (t) => {
        const p = Math.min((t - start) / durationMs, 1);
        const eased = easeInOutCubic(p);
        const vp = direction === 'forward' ? eased : 1 - eased;
        apply(vp);
        if (p < 1) {
          raf = requestAnimationFrame(tick);
        } else if (!doneCalled.current) {
          doneCalled.current = true;
          setTimeout(onDone, 20);
        }
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [direction, durationMs, onDone]);

    return h('div', { ref: outerRef, className: 'simple-flip' },
      h(FlipFace, { page: frontPage, faceClass: 'flip-face flip-front' }),
      h(FlipFace, { page: backPage, faceClass: 'flip-face flip-back' })
    );
  }

  // ──────────────────── Preload neighbors (smooth flips) ────────────────────
  function usePreloadNeighbors(current) {
    useEffect(() => {
      const list = window.PAGES || [];
      const urls = [current, current + 1, current + 2]
        .map(n => list[n - 1])
        .filter(p => p && p.image)
        .map(p => p.image);
      urls.forEach(url => {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
      });
    }, [current]);
  }

  // ───────────────────────────── Main ─────────────────────────────
  function Flipbook() {
    const hasCover = !!window.COVER_IMAGE_URL;
    const [mode, setMode] = useState(hasCover ? 'closed' : 'open');
    const [current, setCurrent] = useState(1);
    // flip: null | { dir: 'forward'|'backward', durationMs }
    const [flip, setFlip] = useState(null);
    const [zoomStyle, setZoomStyle] = useState(null);
    const [isCompact, setIsCompact] = useState(function () {
      return typeof window !== 'undefined' && !!window.matchMedia &&
        window.matchMedia('(max-width: 1366px)').matches;
    });
    const binderWrapRef = useRef(null);
    usePreloadNeighbors(current);

    // Track the compact breakpoint (<=1366px: mobile or tablet) reactively. Drives the
    // floor-plan mobile-image swap and the "View Floor Plan" button vs the desktop hotspot.
    useEffect(() => {
      if (!window.matchMedia) return;
      const mq = window.matchMedia('(max-width: 1366px)');
      const onChange = (e) => setIsCompact(e.matches);
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else mq.addListener(onChange);
      return () => {
        if (mq.removeEventListener) mq.removeEventListener('change', onChange);
        else mq.removeListener(onChange);
      };
    }, []);

    const openCover = useCallback(() => {
      if (mode !== 'closed') return;
      setMode('opening');
    }, [mode]);

    // After the cover-flip lands, measure the binder-wrap rect and compute
    // a CONTAIN-FIT transform so the binder fills as much of the viewport
    // as possible while staying fully visible.
    // Contain-fit zoom: scale + translate the binder-wrap to fill the viewport.
    // Measures the binder-wrap's NATURAL (untransformed) rect by clearing any
    // existing transform first, so it's safe to recompute on resize/rotate.
    const computeZoom = useCallback(() => {
      const wrap = binderWrapRef.current;
      if (!wrap) return null;
      const prevTransform = wrap.style.transform;
      wrap.style.transform = 'none';
      const rect = wrap.getBoundingClientRect();
      wrap.style.transform = prevTransform;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scale = Math.min(vw / rect.width, vh / rect.height);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return {
        transform: 'translate(' + (vw / 2 - cx) + 'px,' + (vh / 2 - cy) + 'px) scale(' + scale + ')',
        transformOrigin: '50% 50%',
      };
    }, []);

    const handleCoverFlipDone = useCallback(() => {
      const z = computeZoom();
      if (!z) { setMode('open'); return; }
      setZoomStyle(z);
      setMode('zooming');
    }, [computeZoom]);

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
      const fallback = setTimeout(() => setMode('open'), ZOOM_MS + 200);
      return () => {
        wrap.removeEventListener('transitionend', onEnd);
        clearTimeout(fallback);
      };
    }, [mode]);

    // Keep the zoom transform fresh on resize / device rotation. Otherwise it's
    // computed once at open and goes stale — the slide ends up mis-sized and, on
    // iOS, the stale 3D state mis-composites. rAF-debounced; recompute again
    // shortly after orientationchange since iOS briefly reports stale dimensions.
    useEffect(() => {
      if (mode !== 'open') return;
      let raf = 0;
      const recompute = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const z = computeZoom();
          if (z) setZoomStyle(z);
        });
      };
      const onOrient = () => { recompute(); setTimeout(recompute, 300); };
      window.addEventListener('resize', recompute);
      window.addEventListener('orientationchange', onOrient);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', recompute);
        window.removeEventListener('orientationchange', onOrient);
      };
    }, [mode, computeZoom]);

    const interactive = mode === 'open';
    const canGoNext = interactive && current < TOTAL_PAGES && !flip;
    const canGoPrev = interactive && current > 1 && !flip;

    const goNext = useCallback(() => {
      if (!canGoNext) return;
      setFlip({ dir: 'forward', durationMs: FLIP_MS });
    }, [canGoNext]);

    const goPrev = useCallback(() => {
      if (!canGoPrev) return;
      setFlip({ dir: 'backward', durationMs: FLIP_MS });
    }, [canGoPrev]);

    const onFlipDone = useCallback(() => {
      setFlip(prev => {
        if (!prev) return null;
        if (prev.dir === 'forward') setCurrent(c => c + 1);
        else setCurrent(c => c - 1);
        return null;
      });
    }, []);

    // Keyboard
    useEffect(() => {
      const onKey = (e) => {
        if (mode === 'closed' && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openCover();
          return;
        }
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

    // Touch swipe (basic — no drag-to-flip)
    const stageRef = useRef(null);
    useEffect(() => {
      const el = stageRef.current;
      if (!el || !interactive) return;
      let sx = 0, sy = 0, tracking = false;
      const onStart = (e) => {
        const t = e.changedTouches ? e.changedTouches[0] : e;
        sx = t.clientX; sy = t.clientY; tracking = true;
      };
      const onEnd = (e) => {
        if (!tracking) return;
        tracking = false;
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
    }, [goNext, goPrev, interactive]);

    // Static slide layer (lives inside .page-area):
    //   - Forward flip: shows the DESTINATION (current+1) so when the
    //     flipping page rotates away, the next slide is already there.
    //   - Backward flip: shows the CURRENT slide so it remains visible
    //     until the incoming page covers it.
    //   - At rest: shows the current slide.
    // slideAt() resolves the mobile-image swap (resolvePage) on top of getPage.
    const slideAt = (n) => resolvePage(getPage(n), isCompact);
    let staticPage;
    if (flip && flip.dir === 'forward') {
      staticPage = slideAt(current + 1);
    } else {
      staticPage = slideAt(current);
    }

    // Flipping faces:
    //   Forward (N → N+1): front = N (leaving), back = N+1.
    //   Backward (N → N-1): front = N-1 (arriving as the page returns), back = N.
    let flipFront = null, flipBack = null;
    if (flip) {
      if (flip.dir === 'forward') {
        flipFront = slideAt(current);
        flipBack = slideAt(current + 1);
      } else {
        flipFront = slideAt(current - 1);
        flipBack = slideAt(current);
      }
    }

    // 3D context (perspective/preserve-3d) only while animating; a resting slide
    // is a flat 2D layer (fixes iOS Safari rendering resting slides sideways).
    const is3D = mode === 'opening' || mode === 'zooming' || !!flip;
    const binderWrapClass =
      'binder-wrap' +
      (mode === 'zooming' ? ' zooming' : '') +
      (mode === 'open' ? ' open' : '') +
      (is3D ? ' is-3d' : '');

    // Once the cover is open, the slide takes over the whole stage: the
    // page-area expands from its inset binder rect to fill the binder-wrap,
    // covering the binder tray. The inline value change animates because
    // .page-area defines a CSS transition.
    const expanded = mode === 'zooming' || mode === 'open';
    const pageAreaStyle = expanded
      ? { left: '0%', top: '0%', width: '100%', height: '100%' }
      : PAGE_AREA_STYLE;

    const chevronLeft = h('svg', { viewBox: '0 0 24 24', width: 22, height: 22 },
      h('path', { d: 'M15 5l-7 7 7 7', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })
    );
    const chevronRight = h('svg', { viewBox: '0 0 24 24', width: 22, height: 22 },
      h('path', { d: 'M9 5l7 7-7 7', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })
    );

    return h('div', { className: 'app' },
      h('button', {
        className: 'nav-btn nav-prev' + (interactive ? '' : ' hidden'),
        onClick: goPrev,
        disabled: !canGoPrev,
        tabIndex: interactive ? 0 : -1,
        'aria-hidden': interactive ? 'false' : 'true',
        'aria-label': 'Previous page',
      }, chevronLeft),

      h('div', { className: 'stage' + (is3D ? ' is-3d' : ''), ref: stageRef },
        h('div', {
          className: binderWrapClass,
          ref: binderWrapRef,
          style: zoomStyle || undefined,
        },
          // Binder artwork (hingeless tray). Shown during the cover-flip and on
          // slide 1; once slide 2 is active it fades to opacity 0 so the later
          // slides read full-bleed. Not rendered while closed.
          mode !== 'closed' && h('img', {
            src: 'binder_1x.webp',
            className: 'binder-img',
            alt: '',
            draggable: false,
            fetchpriority: 'high',
            style: { opacity: current >= 2 ? 0 : 1 },
          }),

          // Page-area: the inner page-well where slides live.
          h('div', { className: 'page-area', style: pageAreaStyle },
            // Static slide (the resting slide or the destination during a flip).
            // active only when open AND at rest → a video slide plays once it
            // has landed, never while a flip is still in flight.
            h(StaticSlide, { key: 'static-' + (flip ? flip.dir : 'rest') + '-' + current, page: staticPage, active: interactive && !flip }),

            // In-flight slide-to-slide flip (hinges at page-area's left edge).
            flip && h(SimpleFlippingPage, {
              key: 'slide-flip-' + current + '-' + flip.dir,
              frontPage: flipFront,
              backPage: flipBack,
              direction: flip.dir,
              durationMs: flip.durationMs,
              onDone: onFlipDone,
            }),

            // Half-page click targets (active only when fully open).
            interactive && canGoPrev && h('div', {
              key: 'click-prev',
              className: 'click-half click-half-prev',
              onClick: () => { if (!flip) goPrev(); },
              'aria-label': 'Previous',
            }),
            interactive && canGoNext && h('div', {
              key: 'click-next',
              className: 'click-half click-half-next',
              onClick: () => { if (!flip) goNext(); },
              'aria-label': 'Next',
            }),

            // Floor-plan hotspot (desktop only, >1366px) — invisible click target over
            // the printed top-right CTA on slides that set `download`; opens the PDF.
            // On mobile/tablet (<=1366px) it's replaced by the .floorplan-btn below the slide.
            !isCompact && interactive && !flip && getPage(current) && getPage(current).download && h('button', {
              key: 'download-cta',
              className: 'download-hotspot',
              onClick: (e) => { e.stopPropagation(); openFloorPlan(getPage(current)); },
              title: 'Open floor plan PDF',
              'aria-label': 'Open this residence floor plan PDF',
            })
          ),

          // Cover-flip (when mode === 'opening') — hinges at binder-wrap's left edge.
          mode === 'opening' && h(SimpleFlippingPage, {
            key: 'cover-flip',
            frontPage: { kind: 'image', image: window.COVER_IMAGE_URL },
            backPage: getPage(1),
            direction: 'forward',
            durationMs: COVER_FLIP_MS,
            onDone: handleCoverFlipDone,
          }),

          // Closed-cover overlay (mode === 'closed').
          mode === 'closed' && h(ClosedCover, {
            key: 'closed-cover',
            imageUrl: window.COVER_IMAGE_URL,
            onCTAClick: openCover,
          })
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

      // Mobile/tablet floor-plan CTA — fixed, centered, 24px above the counter.
      // Lives in .app (not .stage, whose `perspective` would trap a fixed child),
      // so `position: fixed` is viewport-relative. Opens the residence PDF.
      isCompact && interactive && !flip && getPage(current) && getPage(current).download && h('button', {
        key: 'floorplan-btn',
        className: 'floorplan-btn',
        onClick: () => { openFloorPlan(getPage(current)); },
        'aria-label': 'View this residence floor plan PDF',
      }, 'View Floor Plan')
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(Flipbook));
})();
