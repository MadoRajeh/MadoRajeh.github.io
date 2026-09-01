/* =====================================================================
   Work section behaviour: category filtering and the document lightbox.

   Deliberately standalone rather than shared with main.js. main.js drives
   the homepage deck — it takes over wheel, touch and key events to move
   between slides — and loading it on an ordinary scrolling page would
   hijack scrolling on a document that is supposed to scroll normally.
   These pages need two small things, so they get two small things.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------- category filter ---------------- */
  var grid = document.getElementById('work-grid');
  if (grid) {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('.filter-btn'));
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.work-card'));
    var countEl = document.getElementById('filter-count');
    var total = cards.length;

    /* `force` reveals whatever the filter just made visible.
       Cards carry .reveal, and main.js's IntersectionObserver only adds .in
       when a card crosses into view. A card sitting behind `hidden` never
       intersects, so after a filter change it would come back at opacity 0 —
       a grid of blank cards. On a filter CLICK we therefore mark the visible
       ones revealed outright. The very first call passes force=false so the
       page still animates in on load like every other page on the site. */
    function apply(kind, force) {
      var shown = 0;
      cards.forEach(function (card) {
        var match = kind === 'all' || card.getAttribute('data-kind') === kind;
        card.hidden = !match;
        if (match) {
          shown++;
          if (force) card.classList.add('in');
        }
      });
      buttons.forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-filter') === kind ? 'true' : 'false');
      });
      if (countEl) {
        countEl.textContent = kind === 'all'
          ? total + ' projects'
          : shown + ' of ' + total + ' projects';
      }
    }

    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        apply(b.getAttribute('data-filter'), true);
      });
    });
    apply('all', false);
  }

  /* ---------------- document lightbox ---------------- */
  var box = document.getElementById('lightbox');
  if (!box) return;
  var img = document.getElementById('lightbox-img');
  var vid = document.getElementById('lightbox-video');
  var closeBtn = document.getElementById('lightbox-close');
  var lastFocus = null;

  function open(src, caption) {
    lastFocus = document.activeElement;
    if (vid) { vid.pause(); vid.hidden = true; vid.removeAttribute('src'); }
    img.src = src;
    img.alt = caption || '';
    img.hidden = false;
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    box.hidden = true;
    img.hidden = true;
    img.removeAttribute('src');
    document.body.style.overflow = '';
    // Returning focus matters here: the trigger is a <button> inside a card,
    // and without this a keyboard user lands back at the top of the document.
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('click', function (ev) {
    var shot = ev.target.closest ? ev.target.closest('.doc-shot') : null;
    if (shot) {
      ev.preventDefault();
      open(shot.getAttribute('data-img'), shot.getAttribute('data-caption'));
      return;
    }
    if (ev.target.closest && ev.target.closest('[data-close], .lightbox-close')) {
      close();
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !box.hidden) close();
  });
})();
