/* =====================================================================
   motion.js — two-tier block choreography with physics.

   THE MODEL (Wayne's rule, and it is the right one)
   A block is a coherent unit of information — the whole text column of an
   experience slide, for instance. On scroll in and out it moves as ONE
   THING, together. Inside it, each child gets a small distinct micro-motion
   so the block has internal life without coming apart.

     TIER 1  GROUP   one travel for the whole unit, in and out. Full
                     distance (up to 26px), capped so groups can never
                     overlap each other.
     TIER 2  MICRO   7px, per child, flavour chosen by what the child IS.
                     Starts just after its group. NO exit of its own —
                     children leave with their group, because that is what
                     "together" means.

   The previous version animated every leaf independently, so a slide
   arrived as five or six separate pieces. That is exactly what Wayne was
   pointing at: those pieces belong together.

   GROUPS ARE THE LAYOUT UNITS
   A multi-column content root (.hero-grid, .role-grid, .about-grid) has one
   group per column. Any other root is itself a single group. So a
   two-column slide moves as two units and a single-column slide as one.

   PHYSICS
     · NO OVERLAP — a group's travel is capped to the MEASURED gap to its
       neighbours, in both directions: it starts one full travel away from
       its destination AND overshoots past rest by OVERSHOOT of the travel.
       Both excursions have to clear.
     · IMPULSE — when a group passes a neighbour, that neighbour gets a
       short push the same way and springs back. Between GROUPS only: they
       are the things that actually travel through the layout.

   The impulse uses the independent `translate` property, NOT `transform`.
   The entrance keyframes own `transform`; `translate` composes with it
   rather than overwriting it.
   ===================================================================== */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Roots whose CHILDREN are the groups. Anything else is one group itself. */
  var MULTI_COL = '.hero-grid, .role-grid, .about-grid';

  /* Containers that count as a single micro unit — do not descend. */
  var ATOMIC = [
    '.about-photo', '.hero-card-wrap', '.role-side', '.contact-box',
    '.result-band', '.results-quote', '.tools-rows', '.work-grid',
    '.work-mini-list', '.hook-stats', '.stats-grid', '.anatomy', '.timeline',
    '.pillars-row', '.client-tags', '.chips', '.ctas', '.io-wrap',
    '.pipeline', '.doc-row', '.role-points', '.steps', '.social-row',
    '.review-row', '.tool-grid', '.hero-choice',
    // Small composites: each of these is ONE thing to a reader, so it must be
    // one micro unit. Without them the walker descended into .role-tool and
    // animated a tool's logo separately from its name — 11 micro units in the
    // side panel instead of 3, which is the block coming apart again just at a
    // smaller scale.
    '.role-tools', '.role-badge', '.role-tool', '.tool-badge', '.stat',
    '.pipe-step', '.work-mini', '.pillar-chip', '.tl-item', '.anat-card',
    '.doc-card', '.review-card', '.peer-quote', '.hero-card-tag'
  ].join(',');

  /* Text-flow elements are units in their own right — never descend into a
     paragraph and animate its inline spans separately. */
  var TEXT_LEVEL = 'p,h1,h2,h3,h4,h5,h6,span,a,li,cite,blockquote,figcaption,' +
                   'label,button,strong,em,b,i,time';

  /* A group's flavour comes from what it CONTAINS, so the unit's motion
     suits its content. */
  function groupFlavour(el) {
    try {
      if (el.matches('.about-photo, .hero-card-wrap, .role-side')) return 'tilt';
      if (el.querySelector('.about-photo, .hero-card-wrap, .contact-box, .result-band')) return 'tilt';
      if (el.matches('.tools-rows, .work-grid, .work-mini-list, .hook-stats, .stats-grid')) return 'zoom';
      if (el.querySelector('.tools-rows, .work-grid, .work-mini-list, .anatomy, .review-row, .doc-row')) return 'zoom';
    } catch (e) {}
    return 'rise';
  }

  /* A child's micro flavour comes from what the child IS. Subtle, but each
     kind of content still moves in its own way. */
  var MICRO = [
    ['.sec-label, .hero-kicker, .crumb, .role-side-label', 'swipe'],
    ['.sec-title, h1, h2, h3', 'rise'],
    ['.role-points, .timeline, .steps', 'swipe'],
    ['.tools-rows, .work-grid, .work-mini-list, .hook-stats, .stats-grid, ' +
     '.anatomy, .io-wrap, .pipeline, .doc-row, .review-row, .tool-grid', 'zoom'],
    ['.pillars-row, .client-tags, .chips, .ctas, .social-row, .hero-choice', 'fan'],
    ['a.btn, button, .scroll-cue', 'fan'],
    ['.about-photo, .hero-card-wrap, .contact-box, .result-band, .results-quote', 'tilt']
  ];

  function microFlavour(el) {
    for (var i = 0; i < MICRO.length; i++) {
      try { if (el.matches(MICRO[i][0])) return MICRO[i][1]; } catch (e) {}
    }
    return 'rise';
  }

  function collectGroups(slide) {
    var root = slide.querySelector('.wrap') || slide.querySelector('.hero-grid');
    if (!root) return [];
    var multi = false;
    try { multi = root.matches(MULTI_COL); } catch (e) {}
    if (multi) {
      return [].slice.call(root.children).filter(function (c) {
        if (c.tagName === 'SCRIPT' || c.tagName === 'STYLE' || c.hidden) return false;
        // An image-only column has NO text, and requiring text silently
        // dropped .about-photo — the About slide animated its text column and
        // left the portrait static. Same shape of bug as the class allowlist.
        return !!((c.textContent || '').trim() || c.querySelector('img') || c.tagName === 'IMG');
      });
    }
    return [root];
  }

  /* Card grids whose CHILDREN are themselves atomic. The walker is allowed one
     level deeper into these so each card arrives with its own spring instead of
     the grid scaling as a single slab - which is what "the info arriving" means
     to a reader. Every child type here already appears in ATOMIC, so the descent
     stops at the card and cannot split it further. */
  var GRID_SPLIT = [
    '.stats-grid', '.hook-stats', '.work-mini-list', '.doc-row', '.review-row',
    '.anatomy', '.timeline', '.pillars-row', '.pipeline', '.tool-grid', '.steps'
  ].join(',');
  var GRID_SPLIT_MAX = 6; // above this, staggering one card at a time runs too long

  /* Micro units inside one group: descend to leaves, stopping at anything
     atomic or text-level. */
  function collectMicro(group) {
    var out = [];
    (function walk(node) {
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (c.tagName === 'SCRIPT' || c.tagName === 'STYLE' || c.hidden) continue;
        var stop = false;
        try { stop = c.matches(ATOMIC) || c.matches(TEXT_LEVEL); } catch (e) {}
        // A small card grid is not really one thing: let its cards through.
        if (stop) {
          var splittable = false;
          try {
            splittable = c.matches(GRID_SPLIT) && c.children.length > 1 &&
                         c.children.length <= GRID_SPLIT_MAX;
          } catch (e) {}
          if (splittable) { walk(c); continue; }
        }
        if (stop) {
          if ((c.textContent || '').trim() || c.querySelector('img')) out.push(c);
          continue;
        }
        if (c.children.length) { walk(c); continue; }
        if ((c.textContent || '').trim() || c.tagName === 'IMG') out.push(c);
      }
    })(group);
    return out;
  }

  var DIR = {
    swipe: { x: 1, y: 0 },
    rise:  { x: 0, y: -1 },
    tilt:  { x: 0, y: -1 },
    fan:   { x: 0, y: -1 },
    zoom:  { x: 0, y: 0 }     // scales in place, so it pushes nothing
  };

  var MAX_TRAVEL = 32;
  var MIN_TRAVEL = 14;
  var IMPULSE = 6;
  var PROX = 30;
  var OVERSHOOT = 0.19;    // must match the 58% keyframe stop in work.css
  var CLEARANCE = 8;

  function prepare(slide) {
    var groups = collectGroups(slide);
    if (!groups.length) return null;

    var rects = groups.map(function (g) { return g.getBoundingClientRect(); });
    var plan = [];

    groups.forEach(function (g, i) {
      var fx = groupFlavour(g);
      g.dataset.fx = fx;
      g.style.setProperty('--i', i);
      // release any failsafe override, or the group would be stuck visible
      // and skip its entrance on the next visit
      g.style.removeProperty('opacity');
      g.style.removeProperty('transform');

      // Cap travel so groups can never overlap. Both excursions matter: a
      // group starts a full travel away from its destination, then
      // overshoots past rest by OVERSHOOT of the travel.
      var travel = MAX_TRAVEL;
      var d = DIR[fx];
      if (d && (d.x || d.y)) {
        var me = rects[i];
        for (var j = 0; j < rects.length; j++) {
          if (j === i) continue;
          var o = rects[j];
          var sameCol = o.right > me.left - PROX && o.left < me.right + PROX;
          var sameRow = o.bottom > me.top - PROX && o.top < me.bottom + PROX;
          if (d.y === -1 && sameCol) {
            if (o.top >= me.bottom) travel = Math.min(travel, Math.max(MIN_TRAVEL, o.top - me.bottom - CLEARANCE));
            if (o.bottom <= me.top) travel = Math.min(travel, Math.max(MIN_TRAVEL, (me.top - o.bottom - CLEARANCE) / OVERSHOOT));
          }
          if (d.x === 1 && sameRow) {
            if (o.right <= me.left) travel = Math.min(travel, Math.max(MIN_TRAVEL, me.left - o.right - CLEARANCE));
            if (o.left >= me.right) travel = Math.min(travel, Math.max(MIN_TRAVEL, (o.left - me.right - CLEARANCE) / OVERSHOOT));
          }
        }
      }
      g.style.setProperty('--travel', Math.round(travel) + 'px');

      // TIER 2 — the internal life of the group.
      var kids = collectMicro(g);
      kids.forEach(function (k, n) {
        k.dataset.micro = microFlavour(k);
        k.style.setProperty('--mi', n);
        k.style.removeProperty('opacity');
        k.style.removeProperty('transform');
      });

      plan.push({ el: g, fx: fx, rect: rects[i], travel: travel, index: i, kids: kids });
    });

    return plan;
  }

  function nudge(el, dx, dy) {
    el.style.transition = 'translate .16s cubic-bezier(.3,0,.4,1)';
    el.style.translate = dx.toFixed(1) + 'px ' + dy.toFixed(1) + 'px';
    setTimeout(function () {
      el.style.transition = 'translate .5s cubic-bezier(.34,1.4,.44,1)';
      el.style.translate = '0px 0px';
    }, 160);
  }

  var timers = [];
  function clearTimers() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
  }

  /* Nothing may stay invisible. If animations do not run for any reason — a
     throttled tab, a keyframe name broken by a later edit — show the content
     anyway. <noscript> does not cover this case, because JS did run. */
  function failsafe(plan) {
    return setTimeout(function () {
      plan.forEach(function (p) {
        [p.el].concat(p.kids).forEach(function (el) {
          if (parseFloat(getComputedStyle(el).opacity) < 0.9) {
            el.style.opacity = '1';
            el.style.transform = 'none';
          }
        });
      });
    }, 1900);
  }

  function run(slide) {
    clearTimers();
    var plan = prepare(slide);
    if (!plan) return;
    if (reduced) {
      plan.forEach(function (p) {
        p.el.style.opacity = '1';
        p.kids.forEach(function (k) { k.style.opacity = '1'; });
      });
      return;
    }
    timers.push(failsafe(plan));

    // Impulse between GROUPS: they are the units that travel through the
    // layout, so they are the only things that can push anything.
    plan.forEach(function (p) {
      var d = DIR[p.fx];
      if (!d || (!d.x && !d.y)) return;
      var delay = 50 + p.index * 90 + 300;
      plan.forEach(function (q) {
        if (q === p) return;
        var a = p.rect, b = q.rect, touching = false;
        if (d.y === -1) {
          touching = b.right > a.left - PROX && b.left < a.right + PROX &&
                     b.bottom <= a.top && a.top - b.bottom <= PROX + p.travel;
        } else if (d.x === 1) {
          touching = b.bottom > a.top - PROX && b.top < a.bottom + PROX &&
                     b.right <= a.left && a.left - b.right <= PROX + p.travel;
        }
        if (!touching) return;
        var scale = IMPULSE * Math.min(1, p.travel / MAX_TRAVEL);
        timers.push(setTimeout(function () { nudge(q.el, d.x * scale, d.y * scale); }, delay));
      });
    });
  }

  function observe() {
    var stage = document.getElementById('deck-stage');
    if (!stage) return;
    var slides = [].slice.call(stage.querySelectorAll('.slide'));
    if (!slides.length) return;

    var last = null;
    function check() {
      // During a slide change TWO slides are current at once: the outgoing one
      // is still finishing its exit while the incoming one has already started
      // arriving. Taking the first `.current` in DOM order picked whichever sat
      // earlier in the document, which on a forward move is the slide leaving.
      // Skip anything mid-exit; the incoming slide is the only real answer.
      var cur = null;
      for (var i = 0; i < slides.length; i++) {
        var c = slides[i].classList;
        if (!c.contains('current')) continue;
        if (c.contains('exiting-away') || c.contains('exiting-split') ||
            c.contains('exiting-corners')) continue;
        cur = slides[i]; break;
      }
      if (cur && cur !== last) { last = cur; run(cur); }
    }

    new MutationObserver(check).observe(stage, {
      subtree: true, attributes: true, attributeFilter: ['class']
    });

    // The gap caps are viewport-dependent, so a stale --travel could let a
    // group overlap after a resize or rotate.
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (last) prepare(last); }, 200);
    });

    check();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe);
  } else {
    observe();
  }

  window.__motion = {
    groups: collectGroups,
    micro: collectMicro,
    groupFlavour: groupFlavour,
    microFlavour: microFlavour,
    prepare: prepare,
    run: run
  };
})();
