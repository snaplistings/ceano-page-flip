// Flipbook — simple rigid-sheet page flip inside the Ceano binder.
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

  // Inner page well within the (already-cropped, 16:9) binder image.
  // binder.png is 3092 × 1739 after the iteration-8 crop; the page-area
  // pixel rect is (left 170, right 2980, top 69, bottom 1659).
  const PAGE_AREA = {
    left:   170 / 3092 * 100,
    top:    69  / 1739 * 100,
    right:  2980 / 3092 * 100,
    bottom: 1659 / 1739 * 100,
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
  function getPageImage(pageNum) {
    const list = window.PAGES || [];
    const cfg = list[pageNum - 1];
    return cfg && cfg.image;
  }

  // ───────────────────────── Closed-cover landing ─────────────────────────
  function ClosedCover({ imageUrl, onCTAClick }) {
    return h('div', { className: 'closed-cover' },
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

  // ─────────────────────── Static slide (background) ───────────────────────
  // Renders inside .page-area as the current/destination slide while a flip
  // is happening, or as the resting slide otherwise.
  function StaticSlide({ imageUrl }) {
    if (!imageUrl) return null;
    return h('div', {
      className: 'static-slide',
      style: { backgroundImage: 'url("' + imageUrl + '")' },
    });
  }

  // ─────────────────── Simple rigid-sheet flipping page ───────────────────
  // One element rotating around its left edge. Reused for both the cover-flip
  // (at .binder-wrap size) and slide-to-slide flips (at .page-area size).
  function SimpleFlippingPage({ frontImage, backImage, direction, durationMs, onDone }) {
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
      h('div', {
        className: 'flip-face flip-front',
        style: frontImage ? { backgroundImage: 'url("' + frontImage + '")' } : undefined,
      }),
      h('div', {
        className: 'flip-face flip-back',
        style: backImage ? { backgroundImage: 'url("' + backImage + '")' } : undefined,
      })
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
    const binderWrapRef = useRef(null);
    usePreloadNeighbors(current);

    const openCover = useCallback(() => {
      if (mode !== 'closed') return;
      setMode('opening');
    }, [mode]);

    // After the cover-flip lands, measure the binder-wrap rect and compute
    // a CONTAIN-FIT transform so the binder fills as much of the viewport
    // as possible while staying fully visible.
    const handleCoverFlipDone = useCallback(() => {
      const wrap = binderWrapRef.current;
      if (!wrap) { setMode('open'); return; }
      const rect = wrap.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scale = Math.min(vw / rect.width, vh / rect.height);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = vw / 2 - cx;
      const dy = vh / 2 - cy;
      setZoomStyle({
        transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')',
        transformOrigin: '50% 50%',
      });
      setMode('zooming');
    }, []);

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
    let staticImage;
    if (flip && flip.dir === 'forward') {
      staticImage = getPageImage(current + 1);
    } else {
      staticImage = getPageImage(current);
    }

    // Flipping faces:
    //   Forward (N → N+1): front = N (leaving), back = N+1.
    //   Backward (N → N-1): front = N-1 (arriving as the page returns), back = N.
    let flipFront = null, flipBack = null;
    if (flip) {
      if (flip.dir === 'forward') {
        flipFront = getPageImage(current);
        flipBack = getPageImage(current + 1);
      } else {
        flipFront = getPageImage(current - 1);
        flipBack = getPageImage(current);
      }
    }

    const binderWrapClass =
      'binder-wrap' +
      (mode === 'zooming' ? ' zooming' : '') +
      (mode === 'open' ? ' open' : '');

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

      h('div', { className: 'stage', ref: stageRef },
        h('div', {
          className: binderWrapClass,
          ref: binderWrapRef,
          style: zoomStyle || undefined,
        },
          // Binder artwork — bottom-most layer of the binder.
          h('img', { src: 'binder.png', className: 'binder-img', alt: '', draggable: false, fetchpriority: 'high' }),

          // Page-area: the inner page-well where slides live.
          h('div', { className: 'page-area', style: PAGE_AREA_STYLE },
            // Static slide (the resting slide or the destination during a flip).
            h(StaticSlide, { key: 'static-' + (flip ? flip.dir : 'rest') + '-' + current, imageUrl: staticImage }),

            // In-flight slide-to-slide flip (hinges at page-area's left edge).
            flip && h(SimpleFlippingPage, {
              key: 'slide-flip-' + current + '-' + flip.dir,
              frontImage: flipFront,
              backImage: flipBack,
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
            })
          ),

          // Rings overlay — sits on top of the page-area but below the cover.
          h('img', { src: 'rings-overlay.png', className: 'rings-img', alt: '', draggable: false, fetchpriority: 'high' }),

          // Cover-flip (when mode === 'opening') — hinges at binder-wrap's left edge.
          mode === 'opening' && h(SimpleFlippingPage, {
            key: 'cover-flip',
            frontImage: window.COVER_IMAGE_URL,
            backImage: getPageImage(1),
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
      )
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(Flipbook));
})();
