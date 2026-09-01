/* =====================================================================
   scene.js — the living background: spatial parallax + spring leaves on
   the wind that refuse to be pushed through the cursor.

   Two cooperating layers, deliberately built with different technologies
   because they have different costs:

     #scene-parallax   Three soft gradient blobs as DOM divs, moved with
                       CSS transforms only. Large radial gradients are
                       expensive to rasterise every frame, so these are
                       painted ONCE by the compositor and then only
                       translated — GPU work, not CPU work. This is what
                       gives the "spatial scene" depth as the mouse moves.

     #leaf-canvas      The leaves, on a 2D canvas. Dozens of small rotated
                       shapes per frame is exactly the case canvas wins and
                       DOM loses.

   Motion model, in layers, so it reads as weather rather than a loop:
     1. a slow base breeze
     2. summed sine "noise" for wandering
     3. discrete gusts that build and decay on their own schedule
     4. per-leaf flutter (a leaf spins and slips sideways as it falls)
     5. cursor repulsion, biased PERPENDICULAR to travel so a leaf goes
        over or under the pointer rather than stalling against it

   Everything is depth-weighted: near leaves are bigger, faster, more
   opaque and react much harder to the cursor than distant ones.
   ===================================================================== */
(function () {
  'use strict';

  var root = document.getElementById('scene-parallax');
  var canvas = document.getElementById('leaf-canvas');
  if (!canvas) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  /* ---------------- config ---------------- */

  // Spring-leaf palette. Sampled to sit with the site's Warm Ivory / Olive
  // Gold system rather than generic "leaf green", which reads as clip art
  // against this background.
  var GREENS = [
    '#7E8F4A', '#93A657', '#A9BC6E', '#6C7C3B',
    '#C0CB8C', '#879A4E', '#B2C07A', '#5D6B32'
  ];
  // A few warm ones, kept rare — a handful of amber leaves stops the drift
  // looking like a single flat colour field.
  var WARMS = ['#CA952B', '#B4A66E', '#A25F2C'];

  var DPR = Math.min(window.devicePixelRatio || 1, 2); // 2 is plenty; 3 just burns fill rate
  var W = 0, H = 0;

  // Particle budget scales with area, then gets clamped. A phone gets far
  // fewer both for fill rate and because the effect is barely visible at
  // that size anyway.
  function leafBudget() {
    var area = window.innerWidth * window.innerHeight;
    var n = Math.round(area / 23000);
    var cap = window.innerWidth < 700 ? 16 : 50;
    if ((navigator.hardwareConcurrency || 4) <= 4) cap = Math.min(cap, 26);
    return Math.max(8, Math.min(n, cap));
  }

  var leaves = [];
  var mouse = { x: -9999, y: -9999, active: false };
  var smooth = { x: 0, y: 0 };      // lerped pointer, drives the parallax
  var t = 0;                        // seconds of scene time

  /* ---------------- sizing ---------------- */

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var want = leafBudget();
    while (leaves.length < want) leaves.push(makeLeaf(true));
    if (leaves.length > want) leaves.length = want;
    orderDirty = true;
  }

  /* ---------------- leaves ---------------- */

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function makeLeaf(seeded) {
    // depth 0 = far, 1 = near. Squared so most leaves sit in the distance
    // and only a few big ones pass close to the viewer.
    var depth = Math.pow(Math.random(), 1.7);
    var warm = Math.random() < 0.16;
    return {
      depth: depth,
      // seeded leaves start scattered across the screen so the effect is
      // already alive on load; recycled ones enter from off-screen left.
      x: seeded ? rnd(-0.1 * W, 1.1 * W) : rnd(-140, -40),
      y: rnd(-0.15 * H, 1.05 * H),
      size: 6 + depth * 17,
      rot: rnd(0, Math.PI * 2),
      spin: rnd(-1.4, 1.4) * (0.35 + depth),
      // per-leaf flutter, so no two leaves share a rhythm
      fPhase: rnd(0, Math.PI * 2),
      fSpeed: rnd(0.55, 1.5),
      fAmp: rnd(8, 26) * (0.4 + depth),
      colour: warm ? WARMS[(Math.random() * WARMS.length) | 0]
                   : GREENS[(Math.random() * GREENS.length) | 0],
      // carried velocity from cursor deflection, decays on its own
      vx: 0, vy: 0,
      // which way this leaf prefers to dodge, so a leaf dead-centre on the
      // cursor still commits to a side instead of jittering
      bias: Math.random() < 0.5 ? -1 : 1
    };
  }

  /* ---------------- wind ---------------- */

  // Cheap smooth noise: summed sines at incommensurable rates. Good enough
  // for weather and far cheaper than real Perlin, which we would only be
  // sampling a couple of times per frame anyway.
  function noise(a, b, c) {
    return (Math.sin(a) + Math.sin(b * 1.7 + 1.3) + Math.sin(c * 0.43 + 2.7)) / 3;
  }

  var gust = 0;         // current gust strength 0..1
  var gustTarget = 0;
  var nextGust = 3;

  function windAt(y) {
    // Base breeze, always moving left to right.
    var base = 34;
    // Wandering component — makes the breeze breathe.
    var wander = noise(t * 0.21, t * 0.13, t * 0.07) * 16;
    // Height shear: air moves faster higher up, so the drift isn't a
    // uniform conveyor belt.
    var shear = (1 - y / Math.max(H, 1)) * 12;
    return base + wander + shear + gust * 120;
  }

  function updateWind(dt) {
    nextGust -= dt;
    if (nextGust <= 0) {
      gustTarget = rnd(0.25, 1);
      nextGust = rnd(2.5, 7.5);       // irregular, so it never feels looped
    }
    // Gusts rise faster than they fall — that asymmetry is what makes a gust
    // feel like a gust rather than a sine wave.
    var rate = gustTarget > gust ? 2.2 : 0.55;
    gust += (gustTarget - gust) * Math.min(1, rate * dt);
    if (gust > 0.02 && Math.abs(gustTarget - gust) < 0.03) gustTarget = 0;
  }

  /* ---------------- the cursor force field ---------------- */

  // Wayne's ask, precisely: a leaf must not push through the pointer — it
  // goes over or under. So the deflection is mostly PERPENDICULAR to the
  // wind (vertical), with only a small radial component. A purely radial
  // push would stall leaves head-on against the cursor and look like they
  // had hit glass.
  //
  // CRITICAL: this returns an INSTANTANEOUS velocity, it does not accumulate
  // into leaf.vx/vy. The first version added acceleration every frame the
  // leaf spent inside the radius, which integrated into enormous speeds —
  // measured at 400px of vertical launch, and the nearest leaf was thrown
  // off-screen without ever getting past the pointer. An instantaneous field
  // is bounded by construction: the arc can never exceed the values below,
  // however long a leaf loiters in it.
  var avoid = { x: 0, y: 0 };

  function deflect(leaf) {
    avoid.x = 0;
    avoid.y = 0;
    if (!mouse.active) return;

    var R = 80 + leaf.depth * 80;             // 80..160px, near leaves notice sooner
    var dx = leaf.x - mouse.x;
    var dy = leaf.y - mouse.y;
    var d2 = dx * dx + dy * dy;
    if (d2 > R * R) return;

    var d = Math.sqrt(d2) || 0.001;
    var f = 1 - d / R;
    f = f * f * (3 - 2 * f);                  // smoothstep: soft rim, firm core

    // Commit to a side — whichever side the leaf is already on, or its own
    // standing bias when it is level with the pointer. Without the bias a
    // dead-centre leaf jitters between up and down.
    var side = Math.abs(dy) > 4 ? (dy > 0 ? 1 : -1) : leaf.bias;

    avoid.y = side * (70 + 110 * leaf.depth) * f;
    avoid.x = (dx / d) * 45 * f;              // slight ease around, not a bounce
    leaf.spin += side * f * 0.9 * (1 / 60);   // being shoved makes it tumble

    // Hard clearance: the promise is that a leaf CANNOT pass through the
    // pointer. Steering alone is a strong tendency, not a guarantee — a fast
    // gust can still carry one in. So if it ever gets inside the clearance
    // radius, place it exactly on that radius. Positional, not force-based,
    // so it cannot be overpowered.
    var clear = 24 + leaf.depth * 20;
    if (d < clear) {
      leaf.x = mouse.x + (dx / d) * clear;
      leaf.y = mouse.y + (dy / d) * clear;
    }
  }

  /* ---------------- leaf shape ---------------- */

  function drawLeaf(leaf) {
    var s = leaf.size;
    ctx.save();
    ctx.translate(leaf.x, leaf.y);
    ctx.rotate(leaf.rot);
    // Foreshortening: a leaf spinning in 3D shows its edge periodically.
    // Squashing x by the cosine of its own spin phase fakes that convincingly
    // for a fraction of the cost of real 3D.
    var edge = Math.abs(Math.cos(leaf.fPhase * 0.7 + t * leaf.fSpeed));
    ctx.scale(0.35 + 0.65 * edge, 1);

    ctx.globalAlpha = 0.30 + leaf.depth * 0.55;
    ctx.fillStyle = leaf.colour;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.78, -s * 0.15, 0, s);
    ctx.quadraticCurveTo(-s * 0.78, -s * 0.15, 0, -s);
    ctx.fill();

    // Midrib. Only on leaves big enough for it to register — on a 6px far
    // leaf it is a wasted stroke.
    if (s > 11) {
      ctx.globalAlpha *= 0.5;
      ctx.strokeStyle = 'rgba(40,46,26,0.55)';
      ctx.lineWidth = Math.max(0.5, s * 0.055);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.85);
      ctx.lineTo(0, s * 0.85);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------- frame ---------------- */

  function step(dt) {
    updateWind(dt);

    for (var i = 0; i < leaves.length; i++) {
      var L = leaves[i];

      deflect(L);

      // A little carried inertia so leaving the force field eases out instead
      // of snapping back to pure wind. Heavily damped, and it only ever holds
      // a fraction of the avoidance velocity, so it cannot compound.
      L.vy += (avoid.y * 0.35 - L.vy) * Math.min(1, 5 * dt);
      L.vx += (avoid.x * 0.35 - L.vx) * Math.min(1, 5 * dt);

      var w = windAt(L.y) * (0.45 + L.depth * 0.9);
      // Flutter: sideways slip, perpendicular to the fall.
      L.fPhase += L.fSpeed * dt;
      var flutter = Math.sin(L.fPhase) * L.fAmp;

      L.x += (w + avoid.x + L.vx + flutter * 0.35) * dt;
      // Gentle settle downward, plus flutter bobbing.
      L.y += (10 + L.depth * 22 + avoid.y + L.vy + Math.cos(L.fPhase * 0.8) * 12) * dt;
      L.rot += (L.spin + flutter * 0.012) * dt;
      L.spin *= Math.pow(0.5, dt);       // spin bleeds off

      // Recycle once fully clear of the viewport.
      var m = L.size * 2 + 20;
      if (L.x > W + m || L.y > H + m || L.y < -H * 0.5) {
        leaves[i] = makeLeaf(false);
        orderDirty = true;      // a new depth entered the set; paint order changed
      }
    }
  }

  // Far leaves must paint first so near ones overlap them. Depth never changes
  // for a given leaf, so this order only needs recomputing when a leaf is
  // recycled — NOT every frame. Sorting `leaves` itself per frame also made
  // leaf identity unstable across frames (index i was a different leaf each
  // time), which is a trap for anything holding a reference.
  var order = [];
  var orderDirty = true;

  function reorder() {
    order = leaves.slice().sort(function (a, b) { return a.depth - b.depth; });
    orderDirty = false;
  }

  function draw() {
    if (orderDirty || order.length !== leaves.length) reorder();
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < order.length; i++) drawLeaf(order[i]);
    ctx.globalAlpha = 1;
  }

  /* ---------------- spatial parallax ---------------- */

  var blobs = root ? [].slice.call(root.querySelectorAll('.scene-blob')) : [];

  function parallax() {
    // Lerp toward the pointer so the scene glides instead of snapping. The
    // pointer is expressed as -1..1 from centre, so depth is just a
    // multiplier per layer.
    var tx = mouse.active ? (mouse.x / Math.max(W, 1)) * 2 - 1 : 0;
    var ty = mouse.active ? (mouse.y / Math.max(H, 1)) * 2 - 1 : 0;
    smooth.x += (tx - smooth.x) * 0.045;
    smooth.y += (ty - smooth.y) * 0.045;
    for (var i = 0; i < blobs.length; i++) {
      var d = parseFloat(blobs[i].dataset.depth || '1');
      blobs[i].style.transform =
        'translate3d(' + (-smooth.x * 34 * d).toFixed(2) + 'px,' +
        (-smooth.y * 26 * d).toFixed(2) + 'px,0)';
    }
  }

  /* ---------------- loop ---------------- */

  var last = 0, running = false, raf = 0, frames = 0;

  function frame(now) {
    if (!running) return;
    // Clamp dt. A backgrounded tab or a stalled main thread produces a huge
    // gap, and integrating that in one go teleports every leaf off-screen.
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    tick(dt);
    raf = requestAnimationFrame(frame);
  }

  // Split out from frame() so the simulation can be advanced deterministically
  // without waiting on requestAnimationFrame — which is what makes the motion
  // testable in a headless/hidden context, where rAF never fires at all.
  function tick(dt) {
    t += dt;
    frames++;
    step(dt);
    draw();
    parallax();
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ---------------- wiring ---------------- */

  window.addEventListener('resize', resize);

  // pointermove covers mouse, pen and touch-drag in one handler.
  window.addEventListener('pointermove', function (ev) {
    mouse.x = ev.clientX;
    mouse.y = ev.clientY;
    mouse.active = true;
  }, { passive: true });

  window.addEventListener('pointerleave', function () { mouse.active = false; }, { passive: true });
  window.addEventListener('blur', function () { mouse.active = false; });

  // Don't burn battery animating a tab nobody is looking at.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  resize();

  // Paint one frame immediately, before any requestAnimationFrame. Two reasons:
  // the canvas is otherwise empty for the first frame after load, and a tab
  // opened in the BACKGROUND gets no rAF at all — so without this the scene is
  // blank until the moment the visitor switches to it, then pops into being.
  draw();
  parallax();

  if (!reduced) start();   // reduced-motion keeps the single static frame above

  // Exposed for verification, and so a future page can retune without
  // editing this file.
  window.__scene = {
    get count() { return leaves.length; },
    get gust() { return gust; },
    get running() { return running; },
    get frames() { return frames; },
    get wind() { return windAt(H / 2); },
    leaves: leaves,
    setPointer: function (x, y) { mouse.x = x; mouse.y = y; mouse.active = true; },
    clearPointer: function () { mouse.active = false; },
    tick: tick,
    stop: stop,
    start: start
  };
})();
