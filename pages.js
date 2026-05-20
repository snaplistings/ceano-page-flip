// pages.js — per-page content for the flipbook.
//
// Each entry corresponds to one page (PAGES[0] is page 1).
// Page count is auto-derived from PAGES.length in flipbook.js.

// Closed lookbook cover, shown as the landing screen before the user clicks
// "EXCLUSIVE FIRST LOOK". Separate from the 32 slides.
window.COVER_IMAGE_URL = 'https://d1j3fd6wolejlf.cloudfront.net/ceano-book-cover-(1).png';

window.PAGES = Array.from({ length: 32 }, function (_, i) {
  return {
    kind: 'image',
    image: 'https://d1j3fd6wolejlf.cloudfront.net/ceano_digital_preview_' + (i + 1) + '.png',
    alt: 'Ceano slide ' + (i + 1),
  };
});
