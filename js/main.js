// Portfolio v2 — a slide deck, not a scrolling page. The page itself never
// scrolls; advancing (wheel tick, swipe, arrow key, or a dot click) triggers a
// single discrete "go to slide N" state change, and CSS animates the swap.
// That's deliberately NOT continuous scroll-position math — this session's
// earlier bugs (runaway easing, phase-drift) all came from accumulating error
// in continuous scroll math. A discrete index can't drift the same way.

(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // "Unlock" reveal: the page loads with body.locking set (in the HTML, so
  // there's no flash of the unlocked state before JS runs), #scene-bg pinned
  // to a dark "powered off" colour, and the hero content pre-faded/blurred.
  // Removing the class a beat later lets all of that cross-fade in together —
  // background lightening, hero content staggering in — like the page turning
  // itself on, rather than everything just being static on arrival.
  if (reduced) {
    document.body.classList.remove('locking');
  } else {
    requestAnimationFrame(() => {
      setTimeout(() => document.body.classList.remove('locking'), 220);
    });
    // Belt and braces: requestAnimationFrame does not fire in a background or
    // non-composited tab, and without this the page could sit in its "locked"
    // state indefinitely. A plain timer always fires.
    setTimeout(() => document.body.classList.remove('locking'), 900);
  }

  /* ---------- Slides: discrete scene changes + dot nav + wheel/touch/keyboard ---------- */
  const slides = document.querySelectorAll('.slide');
  const dotsNav = document.getElementById('slide-dots');
  const sceneBg = document.getElementById('scene-bg');
  const deckStage = document.getElementById('deck-stage');
  if (slides.length) {
    let current = 0;
    let animating = false;
    const PUSH_MS = 340; // matches .slide's CSS transition duration

    // The deck is only the first 100vh of the page now; everything below it is
    // an ordinary scrolling case study. "Docked" means the deck still fills the
    // viewport, so wheel/touch/keys should drive slide changes instead of
    // scrolling the page. Once the user scrolls past it, this goes false and
    // those handlers get out of the way entirely, letting native scroll run
    // the rest of the page exactly like any other site. Scrolling back UP into
    // the deck's range flips it true again automatically, since it's just a
    // scrollY check, not a one-way latch.
    const isDocked = () => !deckStage || window.scrollY < window.innerHeight - 2;

    const dots = [];
    if (dotsNav) {
      slides.forEach((el, i) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'dot';
        dot.setAttribute('aria-label', el.dataset.label || ('Slide ' + (i + 1)));
        dot.addEventListener('click', () => goTo(i));
        dotsNav.appendChild(dot);
        dots.push(dot);
      });
    }

    function setDots(index) {
      dots.forEach((d, i) => d.classList.toggle('active', i === index));
    }

    // Move a slide to a parked position with NO animation. Every reposition that
    // isn't the actual visible push has to go through this, or the base .slide
    // transition animates the reposition too and a phantom slide sweeps across
    // the screen.
    function parkInstantly(el, above) {
      el.style.transition = 'none';
      el.classList.toggle('stage-above', above);
      void el.offsetHeight; // force the parked position to paint before the transition is restored
      el.style.transition = '';
    }

    // Park every non-current slide on the side it should enter from next:
    // earlier slides wait above, later slides wait below (their CSS default).
    function parkAll() {
      slides.forEach((el, i) => {
        if (i === current) return;
        el.classList.remove('pop-stage');
        parkInstantly(el, i < current);
      });
    }

    // Stage a slide for the "pop" entrance: centred (no translate) at zero
    // scale, set instantly so the scale-up itself is the only visible motion.
    function popStage(el) {
      el.style.transition = 'none';
      el.classList.remove('stage-above');
      el.classList.add('pop-stage');
      void el.offsetHeight;
      el.style.transition = '';
    }

    // Retire a slide instantly, with no animated travel. Used by the custom
    // exits, where the content has already animated itself away, so letting
    // the empty panel slide to its parked spot would drag a phantom across
    // the screen.
    function retireInstantly(el) {
      el.style.transition = 'none';
      el.classList.remove('current');
      el.classList.add('stage-above');
      void el.offsetHeight;
      el.style.transition = '';
    }

    function goTo(index) {
      if (index < 0 || index >= slides.length || index === current) return;
      if (animating && !reduced) return;
      const forward = index > current;
      const outgoing = slides[current];
      const incoming = slides[index];

      // The "interactive background changing" effect: each slide declares its
      // own scene colour via data-bg, and #scene-bg's own CSS transition turns
      // every slide change into a smooth cross-fade instead of a hard cut.
      if (sceneBg && incoming.dataset.bg) sceneBg.style.background = incoming.dataset.bg;

      incoming.setAttribute('aria-hidden', 'false');
      outgoing.setAttribute('aria-hidden', 'true');

      if (reduced) {
        outgoing.classList.remove('current');
        incoming.classList.add('current');
        current = index;
        setDots(index);
        return;
      }

      animating = true;

      // Per-slide choreography, opted into from the HTML rather than hardcoded
      // by index: a slide may declare data-exit="corners"|"split" for how its
      // own content leaves when scrolling forward off it, and data-enter="pop"
      // for how it arrives. Anything that declares neither uses the plain
      // connected push in the else-branch below, unchanged.
      // Only forward moves are choreographed; scrolling back always pushes, so
      // reversing is predictable rather than replaying a bespoke animation.
      const rawExit = forward ? outgoing.dataset.exit : null;
      // "push" is not a content-only exit: it takes the connected-push branch
      // below, where both PANELS travel together, so it must not be treated as
      // an exitKind here or it would go down the crossfade path instead.
      const pushOut = rawExit === 'push';
      const exitKind = pushOut ? null : rawExit;
      const popIn = forward && incoming.dataset.enter === 'pop';

      if (exitKind || popIn) {
        const item = outgoing.querySelector('.deck-item');
        if (exitKind) {
          outgoing.classList.add('exiting-' + exitKind); // drives the kicker, which sits outside .deck-item
          if (item) item.classList.add(exitKind === 'split' ? 'splitting-out' : 'corner-out');
        }
        // EXIT_MS is only when the (by then empty) outgoing PANEL is retired; it
        // is not when the incoming slide starts. The incoming pop deliberately
        // begins almost immediately, overlapping the outgoing content's exit, so
        // the new scene growing outward reads as the thing shoving the old one
        // out to the corners. Waiting for the exit to finish first made the two
        // look like unrelated, sequential events.
        const EXIT_MS = exitKind ? 120 : 0;

        if (popIn) {
          popStage(incoming); // centred at zero scale: invisible, so staging it now costs nothing
          // Deliberately a separate task before going current. In the same task
          // the browser can coalesce "stage at zero scale" and "become current"
          // into one style recalculation, so the scale-up either never starts or
          // starts from the wrong value.
          setTimeout(() => incoming.classList.add('current'), exitKind ? 100 : 20);
        }

        // SIMULTANEOUS, not sequential. The incoming slide goes current partway
        // through the outgoing one's exit, so for the overlap window the old
        // content is leaving while the new content is already coming in. Both
        // slides carry .current during that window - motion.js knows to ignore
        // the one that is mid-exit, and .entering keeps the newcomer painted on
        // top whichever direction we are moving.
        const OVERLAP_MS = exitKind ? 25 : 0;   // 25ms into a 110ms exit:
        // the new card is arriving while the old one is barely a fifth gone.
        if (!popIn) {
          setTimeout(() => {
            incoming.classList.add('current', 'entering');
          }, OVERLAP_MS);
        }

        setTimeout(() => {
          // The outgoing content has already animated itself away, so the panel
          // is visually empty: retire it instantly rather than letting it travel.
          retireInstantly(outgoing);
          if (!popIn) incoming.classList.add('current');
        }, EXIT_MS);

        setTimeout(() => {
          if (exitKind) {
            outgoing.classList.remove('exiting-' + exitKind);
            if (item) item.classList.remove('splitting-out', 'corner-out');
          }
          incoming.classList.remove('entering');
          parkAll(); // also clears pop-stage
          animating = false;
        }, EXIT_MS + 240);
      } else {
        // Connected push: the incoming slide always starts exactly one
        // slide-height away from resting (below when moving forward, above
        // when moving back), and both slides move by that same distance at
        // the same time, so the incoming scene visibly shoves the outgoing
        // one off instead of the two fading independently.
        // The contents fan out while the panel is being pushed off, so the slide
        // does not leave as one rigid slab.
        if (pushOut) outgoing.classList.add('exiting-push');

        if (!forward) parkInstantly(incoming, true); // park above, instead of its default "below"

        // A short setTimeout instead of requestAnimationFrame here: rAF can be paused
        // by the browser for a backgrounded/inactive tab (e.g. the user switches apps
        // mid-transition on their phone), which would leave the swap stuck forever.
        // setTimeout always fires, so the transition can never get permanently wedged.
        setTimeout(() => {
          incoming.classList.remove('stage-above');
          incoming.classList.add('current');
          outgoing.classList.remove('current');
          if (forward) outgoing.classList.add('stage-above'); // push it up and off, not down
        }, 20);
        setTimeout(() => {
          // Re-park every off-screen slide for whichever direction comes next,
          // ALWAYS with the transition suppressed. Doing this with the
          // transition live is what produced the ghost: the slide that had just
          // been pushed up to -100% would animate all the way back down to
          // +100%, sweeping a full-screen phantom downward through the viewport
          // after every single scroll.
          outgoing.classList.remove('exiting-push');
          parkAll();
          animating = false;
        }, PUSH_MS);
      }

      current = index;
      setDots(index);
    }

    // Arriving with a hash that names a slide (e.g. another page linking to
    // index.html#contact) must land on that slide. The deck does not scroll,
    // so the browser's native anchor jump does nothing here and the visitor
    // would silently get slide 0 instead of the section they clicked.
    function jumpToHash() {
      var id = (location.hash || '').slice(1);
      if (!id) return;
      var idx = -1;
      for (var h = 0; h < slides.length; h++) if (slides[h].id === id) { idx = h; break; }
      if (idx === -1) return;
      // Undo the browser's own scroll-to-anchor before switching slides.
      // The slides live inside #deck-stage, which is overflow:hidden — and an
      // overflow:hidden box is still SCROLLABLE programmatically, which is
      // exactly what the browser does to bring an anchor into view. It had
      // been setting deckStage.scrollTop to a full viewport, so every slide
      // sat one screen out of position and content from several slides
      // overlapped in the middle of the page. Affects any index.html#slide
      // link, including the "Book a call" badge in the nav.
      resetDeckScroll();
      if (idx > 0) goTo(idx);
    }

    function resetDeckScroll() {
      if (deckStage) { deckStage.scrollTop = 0; deckStage.scrollLeft = 0; }
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
    }
    window.addEventListener('hashchange', jumpToHash);

    // First slide starts visible; every other slide starts hidden from
    // assistive tech until it becomes current.
    slides.forEach((el, i) => el.setAttribute('aria-hidden', i === 0 ? 'false' : 'true'));
    setDots(0);
    if (sceneBg && slides[0].dataset.bg) sceneBg.style.background = slides[0].dataset.bg;
    setTimeout(jumpToHash, 60);   // after the initial parking settles

    const advance = (delta) => goTo(current + delta);

    // Explicit "keep scrolling" cue in the hero — a direct, discoverable way
    // to move on for anyone who doesn't realise this page responds to
    // wheel/swipe/keys rather than a normal scrollbar.
    const scrollCue = document.getElementById('scroll-cue');
    if (scrollCue) scrollCue.addEventListener('click', () => advance(1));

    // Each slide is now exactly one screenful (overflow:hidden, content
    // compacted at small sizes), so there is no per-slide inner scrolling to
    // defer to any more: a scroll gesture ALWAYS shifts slides immediately.
    // The old "let the slide's own content scroll first" guard is gone — that
    // deferral was the visible bug, a stray scrollbar racing to the bottom of
    // the slide before anything advanced.

    // Scrolling past the last slide (or back up from the case study into the
    // first) hands off to a real page scroll instead of doing nothing once
    // there's no next/previous slide to go to.
    function handOff(dir) {
      if (dir > 0 && current === slides.length - 1) {
        const story = document.getElementById('story-start');
        if (story) story.scrollIntoView({ behavior: 'smooth' });
        return true;
      }
      if (dir < 0 && current === 0) return true; // nothing above the first slide; let it no-op natively
      return false;
    }

    // Wheel: one tick of real intent = one slide. Trackpads fire many tiny
    // deltaY events per gesture, so `animating` (or the reduced-motion no-op
    // above) is what keeps a single swipe from skipping several slides.
    window.addEventListener('wheel', (e) => {
      if (!isDocked()) return; // scrolled past the deck: this is just the page scrolling now
      const lightbox = document.getElementById('lightbox');
      if (lightbox && !lightbox.hidden) return;
      if (Math.abs(e.deltaY) < 4) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      if (handOff(dir)) return; // not preventDefault-ed: this IS a real scroll now
      e.preventDefault();
      advance(dir);
    }, { passive: false });

    // Touch: swipe up = next (matches Stories/Reels), swipe down = previous.
    let touchStartY = null;
    window.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
    window.addEventListener('touchend', (e) => {
      if (!isDocked()) return;
      const lightbox = document.getElementById('lightbox');
      if (lightbox && !lightbox.hidden) { touchStartY = null; return; }
      if (touchStartY === null) return;
      const dy = touchStartY - e.changedTouches[0].clientY;
      touchStartY = null;
      if (Math.abs(dy) <= 44) return;
      const dir = dy > 0 ? 1 : -1;
      if (handOff(dir)) return;
      advance(dir);
    }, { passive: true });

    // Keyboard: arrow/page keys and spacebar, presentation-clicker style.
    document.addEventListener('keydown', (e) => {
      if (!isDocked()) return;
      const lightbox = document.getElementById('lightbox');
      if (lightbox && !lightbox.hidden) return;
      if (['ArrowDown', 'PageDown', ' '].includes(e.key)) {
        if (handOff(1)) return;
        e.preventDefault(); advance(1);
      } else if (['ArrowUp', 'PageUp'].includes(e.key)) {
        if (handOff(-1)) return;
        e.preventDefault(); advance(-1);
      }
    });

    // Nav links point either at a slide id (jump the deck to it directly
    // instead of letting the browser try to scroll, since the deck doesn't
    // natively scroll) or at a normal case-study section id below the deck
    // (e.g. #about, #contact), which just falls through to the browser's
    // ordinary anchor-jump behaviour, unmodified.
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      const id = a.getAttribute('href').slice(1);
      const idx = [...slides].findIndex((s) => s.id === id);
      if (idx === -1) return;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        // goTo() only swaps which slide carries .current — it never scrolls
        // the page. If you're already down in the case study when you click
        // this, the deck (still up at the very top of the document) would
        // switch slides completely out of view, so nothing looked like it
        // happened. Scrolling back up first is what actually brings it back
        // on screen; goTo() then does its normal job once it's visible again.
        resetDeckScroll();
        goTo(idx);
      });
    });
  }

  /* ---------- Case study: reveal-on-scroll ----------
     The deck's slides fade/pop/split because JS decides the exact moment one
     replaces another. Ordinary page scroll has no such moment, so everything
     below the deck uses the standard pattern instead: .reveal starts faded
     down slightly, and gets .in added the first time it crosses into view. */
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if (reduced || !('IntersectionObserver' in window)) {
      revealEls.forEach((el) => el.classList.add('in'));
    } else {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target); // once revealed, stays revealed
          }
        });
      }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
      revealEls.forEach((el) => io.observe(el));
    }
  }

  /* ---------- Tools ring: build once, position each logo around the circle ---------- */
  const ring = document.getElementById('ring');
  if (ring) {
    const tools = [
      ['adobe-after-effects.png', 'After Effects'], ['adobe-premiere.png', 'Premiere Pro'],
      ['canva.png', 'Canva'], ['capcut.png', 'CapCut'], ['zapier.png', 'Zapier'],
      ['make.png', 'Make.com'], ['n8n.png', 'n8n'], ['google.png', 'Google Workspace'],
      ['microsoft.png', 'Microsoft 365'], ['wordpress.png', 'WordPress'], ['notion.png', 'Notion']
    ];
    const radius = 190; // px — distance each logo sits from the ring's centre, out along Z
    const step = 360 / tools.length;
    tools.forEach(([file, name], i) => {
      const item = document.createElement('div');
      item.className = 'ring-item';
      item.style.transform = 'rotateY(' + (i * step) + 'deg) translateZ(' + radius + 'px)';
      const img = document.createElement('img');
      img.src = 'img/tools/' + file;
      img.alt = name;
      img.width = 42; img.height = 42;
      item.appendChild(img);
      ring.appendChild(item);
    });
  }

  /* ---------- Lightbox: view a project image or video full-size ---------- */
  const lightbox = document.getElementById('lightbox');
  if (lightbox) {
    const lbVideo = document.getElementById('lightbox-video');
    const lbImg = document.getElementById('lightbox-img');
    const lbClose = document.getElementById('lightbox-close');
    let lastFocused = null;
    const open = (btn) => {
      lastFocused = btn;
      if (btn.dataset.video) {
        lbImg.hidden = true; lbImg.removeAttribute('src');
        lbVideo.hidden = false;
        lbVideo.src = btn.dataset.video;
        lbVideo.play().catch(() => {});
      } else {
        lbVideo.hidden = true; lbVideo.pause(); lbVideo.removeAttribute('src'); lbVideo.load();
        lbImg.hidden = false;
        lbImg.src = btn.dataset.img;
        lbImg.alt = btn.dataset.caption || '';
      }
      lightbox.hidden = false;
      document.body.style.overflow = 'hidden';
      lbClose.focus();
    };
    const close = () => {
      lightbox.hidden = true;
      lbVideo.pause();
      lbVideo.removeAttribute('src');
      lbVideo.load();
      lbImg.removeAttribute('src');
      document.body.style.overflow = '';
      if (lastFocused) lastFocused.focus();
    };
    document.querySelectorAll('.deck-media .play, .deck-media .zoom, .creative-item').forEach((btn) => {
      btn.addEventListener('click', () => open(btn));
    });
    lbClose.addEventListener('click', close);
    lightbox.querySelector('.lightbox-bg').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lightbox.hidden) close(); });
  }
})();
