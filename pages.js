// pages.js — explicit, ordered list of flipbook slides.
//
// PAGES[0] is slide 1. Page count is auto-derived from PAGES.length in flipbook.js.
// Each entry is { kind:'image', image } or { kind:'video', video }. A video entry may
// add { loop: true } to loop instead of playing once, and { overlay, overlayAlt } to
// composite a centered image on top of the slide (used for the Thank-You end card).

(function () {
  var CDN = 'https://d1j3fd6wolejlf.cloudfront.net/';
  function img(file, alt, extra) {
    return Object.assign({ kind: 'image', image: CDN + file, alt: alt || '' }, extra || {});
  }
  function vid(file, alt, extra) {
    return Object.assign({ kind: 'video', video: CDN + file, alt: alt || '' }, extra || {});
  }

  // Closed lookbook cover (landing screen before "EXCLUSIVE FIRST LOOK"). Separate
  // from the slides below.
  window.COVER_IMAGE_URL = CDN + 'ceano-book-cover-(1).png';

  window.PAGES = [
    /*  1 */ vid('Lv_CEANO_Slide_1.webm', 'Ceano opening motion'),
    /*  2 */ vid('Ceano-Logo-Animation_Final.mp4', 'Ceano logo animation'),
    /*  3 */ img('ceano_digital_preview_3.png', 'Ceano slide 3'),
    /*  4 */ img('ceano_digital_preview_4.png', 'Ceano slide 4'),
    /*  5 */ vid('Building-Sketch_with-signature.mp4', 'Building sketch with signature'),
    /*  6 */ img('ceano_digital_preview_6.png', 'Ceano slide 6'),
    /*  7 */ img('ceano_digital_preview_7.png', 'Ceano slide 7'),
    /*  8 */ img('ceano_digital_preview_8.png', 'Ceano slide 8'),
    /*  9 */ img('ceano_digital_preview_9.png', 'Ceano slide 9'),
    /* 10 */ img('Ceano-Facade.png', 'Ceano facade'),
    /* 11 */ img('ceano_digital_preview_10.png', 'Ceano slide 11'),
    /* 12 */ img('12.png', 'Ceano slide 12'),
    /* 13 */ img('ceano_digital_preview_12.png', 'Ceano slide 13'),
    /* 14 */ img('ceano_digital_preview_13.png', 'Ceano slide 14'),
    /* 15 */ img('ceano_digital_preview_14.png', 'Ceano slide 15'),
    /* 16 */ img('ceano_digital_preview_15.png', 'Ceano slide 16'),
    /* 17 */ img('ceano_digital_preview_16.png', 'Ceano slide 17'),
    /* 18 */ img('ceano_digital_preview_17.png', 'Ceano slide 18'),
    /* 19 */ img('ceano_digital_preview_18.png', 'Ceano slide 19'),
    /* 20 */ img('ceano_digital_preview_21.png', 'Ceano slide 20'),
    /* 21 */ img('ceano_digital_preview_23.png', 'Ceano slide 21'),
    // Slides 22–27 carry a printed "DOWNLOAD FLOOR PLAN" CTA in the top-right
    // corner. `download: true` activates an invisible click hotspot over it that
    // downloads that slide's image (see downloadSlide() in flipbook.js).
    /* 22 */ img('ceano_digital_preview_24.png', 'Ceano slide 22', { download: true }),
    /* 23 */ img('ceano_digital_preview_25.png', 'Ceano slide 23', { download: true }),
    /* 24 */ img('ceano_digital_preview_27.png', 'Ceano slide 24', { download: true }),
    /* 25 */ img('303.png', 'Ceano slide 25', { download: true }),
    /* 26 */ img('406.png', 'Ceano slide 26', { download: true }),
    /* 27 */ img('Villa-4.png', 'Ceano slide 27', { download: true }),
    /* 28 */ img('ceano_digital_preview_31.png', 'Ceano slide 28'),
    /* 29 */ vid('Waves-Background.mp4', 'Waves background', {
      loop: true,
      overlay: 'Thank%20You.svg', // local asset at the project root (note the %20)
      overlayAlt: 'Thank you',
    }),
  ];
})();
