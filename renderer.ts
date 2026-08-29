// Canvas rendering, input handling and the animation loop for Planetary
// Defense. Everything here is the "how"; the rules it draws and reacts to,
// including the collision math, live in game-logic.ts and are what's tested.
import {
  type Difficulty,
  type GameState,
  BALLOON_RADIUS,
  GLASS_STAR_RADIUS,
  MAX_HITS,
  SPIKE_RADIUS,
  createIntroState,
  difficultyFor,
  entityPosition,
  findEntityAt,
  resolveClick,
  spawnBalloon,
  spawnSpike,
  startGame,
  tick,
} from "./game-logic";
import { playBalloonMiss, playHitTaken, playMeteorExplosion, playPlanetDestroyed, playWin } from "./sound";

// A purely visual radius, deliberately decoupled from GLASS_STAR_RADIUS (the
// tested collision constant in game-logic.ts) — scaling it here only makes
// the planet and its shield ring (sized relative to STAR_RADIUS below) read
// bigger on screen, without touching any hit/arrival math.
const STAR_RADIUS = GLASS_STAR_RADIUS * 1.3;

// animClock drives pulsing/bobbing/sparkle — a real-time clock, independent
// of state.elapsed, so the opening screen's spike can still pulse and beg to
// be tapped while the game itself is frozen.
// The shield: a ring orbiting the planet, drawn relative to the planet's own
// (0, 0)-centered coordinate space — called from inside drawPlanet's
// translate. It's full and solid at 0 hits, and each hit taken thins its
// stroke and opens its dashes into wider gaps, so "the shield is failing"
// reads visually with no HUD text required. Once critical (one hit from
// game over) it also flickers, borrowing the HUD's warm red warning color.
function drawShieldRing(ctx: CanvasRenderingContext2D, hits: number, animClock: number): void {
  const health = Math.max(0, 1 - hits / MAX_HITS);
  const ringRadius = STAR_RADIUS * 1.55;
  const critical = hits >= MAX_HITS - 1;
  const flicker = critical ? 0.55 + 0.45 * Math.sin(animClock * 16) : 1;

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
  // Dashes grow sparser (shorter segments, wider gaps) as health drops, so
  // the ring itself looks increasingly broken rather than just thinner.
  const dash = 4 + health * 22;
  const gap = 3 + (1 - health) * 26;
  ctx.setLineDash([dash, gap]);
  ctx.lineDashOffset = -animClock * 6;
  ctx.lineWidth = 1 + health * 4.5;
  const color = critical ? "255, 120, 100" : "150, 210, 255";
  ctx.strokeStyle = `rgba(${color}, ${(0.35 + health * 0.45) * flicker})`;
  ctx.shadowColor = `rgba(${color}, ${0.8 * flicker})`;
  ctx.shadowBlur = 10 + health * 6;
  ctx.stroke();
  ctx.restore();
}

function drawPlanet(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  hits: number,
  animClock: number,
): void {
  const cx = width / 2;
  const cy = height / 2;
  ctx.save();
  ctx.translate(cx, cy);

  // A slow, calm atmospheric glow behind the planet — a "breathing" halo,
  // gentle enough not to compete with a meteor's urgent pulse.
  const breath = 0.5 + 0.5 * Math.sin(animClock * 1.2);
  const haloRadius = STAR_RADIUS * (2.2 + breath * 0.3);
  const halo = ctx.createRadialGradient(0, 0, STAR_RADIUS * 0.6, 0, 0, haloRadius);
  halo.addColorStop(0, `rgba(120, 220, 210, ${0.18 + breath * 0.08})`);
  halo.addColorStop(1, "rgba(120, 220, 210, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
  ctx.fill();

  drawShieldRing(ctx, hits, animClock);

  // The planet body: a blue/green sphere, lit from the upper-left so it
  // reads as a globe rather than a flat disc.
  const globe = ctx.createRadialGradient(
    -STAR_RADIUS * 0.35,
    -STAR_RADIUS * 0.4,
    STAR_RADIUS * 0.1,
    0,
    0,
    STAR_RADIUS,
  );
  globe.addColorStop(0, "#bdf2d8");
  globe.addColorStop(0.4, "#3ec2b0");
  globe.addColorStop(0.75, "#1f6fa8");
  globe.addColorStop(1, "#0d3a66");
  ctx.beginPath();
  ctx.arc(0, 0, STAR_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = globe;
  ctx.fill();

  // A few fixed landmass blobs, clipped to the globe, for a lived-in look.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, STAR_RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(60, 140, 70, 0.55)";
  const landmasses = [
    { x: -STAR_RADIUS * 0.35, y: -STAR_RADIUS * 0.1, r: STAR_RADIUS * 0.32 },
    { x: STAR_RADIUS * 0.3, y: STAR_RADIUS * 0.25, r: STAR_RADIUS * 0.24 },
    { x: STAR_RADIUS * 0.05, y: -STAR_RADIUS * 0.45, r: STAR_RADIUS * 0.16 },
  ];
  for (const land of landmasses) {
    ctx.beginPath();
    ctx.arc(land.x, land.y, land.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // A thin bright rim traces the atmosphere's edge against space.
  ctx.beginPath();
  ctx.arc(0, 0, STAR_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(180, 240, 255, 0.65)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // A few twinkling sparkle points orbiting the planet, each on its own
  // phase — distant satellites/debris catching the light.
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI * 2 * i) / 4 + animClock * 0.3;
    const twinkle = 0.5 + 0.5 * Math.sin(animClock * 3 + i * 1.7);
    const sx = Math.cos(angle) * STAR_RADIUS * 1.5;
    const sy = Math.sin(angle) * STAR_RADIUS * 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 1.5 + twinkle * 1.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + twinkle * 0.5})`;
    ctx.fill();
  }

  ctx.restore();
}

// Meteors (the "spike" entity kind — see game-logic.ts) pulse with a fiery
// glow — an urgent, "touch me" cue — while escape pods drift calmly. The
// contrast is the affordance: no text says which to tap, but one shape
// visibly wants attention and the other doesn't. `intensity` lets the very
// first meteor (the frozen opening screen's only entity) pulse harder than
// meteors do during normal play, since it's the one thing the player must
// notice with no other cue on screen. `angle` is the entity's travel angle
// (see entityPosition in game-logic.ts) — the flame trail points back along
// it, away from the planet it's falling toward.
function drawMeteor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  pulse: number,
  intensity = 1,
): void {
  ctx.save();
  ctx.translate(x, y);

  const glowRadius = SPIKE_RADIUS * (1.5 + pulse * 0.6) * intensity;
  const glow = ctx.createRadialGradient(0, 0, SPIKE_RADIUS * 0.5, 0, 0, glowRadius);
  glow.addColorStop(0, `rgba(255, 110, 40, ${(0.35 + pulse * 0.25) * Math.min(intensity, 1.3)})`);
  glow.addColorStop(1, "rgba(255, 110, 40, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  if (intensity > 1) {
    // A crisp ring on top of the soft glow, to draw the eye harder for the
    // opening screen's one interactive shape.
    const ringRadius = SPIKE_RADIUS * (1.7 + pulse * 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 200, 150, ${0.35 + pulse * 0.45})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // The flame trail: a tapering streak pointing away from the planet, along
  // the entity's spawn angle (entityPosition places it at
  // center + r*(cos angle, sin angle), so +angle is "outward").
  ctx.save();
  ctx.rotate(angle);
  const trailLength = SPIKE_RADIUS * (2.4 + pulse * 0.8);
  const trail = ctx.createLinearGradient(0, 0, trailLength, 0);
  trail.addColorStop(0, "rgba(255, 190, 90, 0.6)");
  trail.addColorStop(1, "rgba(255, 80, 20, 0)");
  ctx.beginPath();
  ctx.moveTo(0, -SPIKE_RADIUS * 0.5);
  ctx.quadraticCurveTo(trailLength * 0.5, 0, trailLength, 0);
  ctx.quadraticCurveTo(trailLength * 0.5, 0, 0, SPIKE_RADIUS * 0.5);
  ctx.closePath();
  ctx.fillStyle = trail;
  ctx.fill();
  ctx.restore();

  // The rocky body: a jagged (but fixed, non-flickering) polygon so it reads
  // as a tumbling chunk of rock rather than a smooth ball.
  const body = ctx.createRadialGradient(
    -SPIKE_RADIUS * 0.3,
    -SPIKE_RADIUS * 0.3,
    SPIKE_RADIUS * 0.1,
    0,
    0,
    SPIKE_RADIUS,
  );
  body.addColorStop(0, "#918577");
  body.addColorStop(0.6, "#59524a");
  body.addColorStop(1, "#2c2723");

  const vertexCount = 8;
  ctx.beginPath();
  for (let i = 0; i < vertexCount; i++) {
    const vertexAngle = (Math.PI * 2 * i) / vertexCount;
    const wobble = 0.78 + 0.22 * Math.sin(i * 2.4);
    const r = SPIKE_RADIUS * wobble;
    const px = Math.cos(vertexAngle) * r;
    const py = Math.sin(vertexAngle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = `rgba(255, 150, 70, ${0.55 + pulse * 0.3})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // A few fixed craters for surface detail.
  ctx.fillStyle = "rgba(25, 17, 13, 0.55)";
  const craters = [
    { x: -SPIKE_RADIUS * 0.3, y: -SPIKE_RADIUS * 0.1, r: SPIKE_RADIUS * 0.22 },
    { x: SPIKE_RADIUS * 0.25, y: SPIKE_RADIUS * 0.3, r: SPIKE_RADIUS * 0.16 },
    { x: SPIKE_RADIUS * 0.1, y: -SPIKE_RADIUS * 0.35, r: SPIKE_RADIUS * 0.12 },
  ];
  for (const crater of craters) {
    ctx.beginPath();
    ctx.arc(crater.x, crater.y, crater.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// Escape Pods (the "balloon" entity kind — see game-logic.ts): friendly
// craft to let through, not pop. A gold capsule with a glowing green
// porthole and a small thruster flame trailing beneath it, in place of the
// old balloon's string, so it reads as powered flight rather than drift.
function drawEscapePod(ctx: CanvasRenderingContext2D, x: number, y: number, bob: number): void {
  ctx.save();
  ctx.translate(x, y + bob);

  const podW = BALLOON_RADIUS * 0.8;
  const podH = BALLOON_RADIUS;

  const flame = ctx.createLinearGradient(0, podH * 0.85, 0, podH * 1.6);
  flame.addColorStop(0, "rgba(255, 225, 150, 0.75)");
  flame.addColorStop(1, "rgba(255, 225, 150, 0)");
  ctx.beginPath();
  ctx.moveTo(-podW * 0.3, podH * 0.85);
  ctx.quadraticCurveTo(0, podH * 1.6, podW * 0.3, podH * 0.85);
  ctx.closePath();
  ctx.fillStyle = flame;
  ctx.fill();

  const body = ctx.createLinearGradient(-podW, -podH, podW, podH);
  body.addColorStop(0, "#fff3c4");
  body.addColorStop(0.5, "#ffcc33");
  body.addColorStop(1, "#b8860b");
  ctx.beginPath();
  ctx.ellipse(0, 0, podW, podH, 0, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const window = ctx.createRadialGradient(0, -podH * 0.15, 1, 0, -podH * 0.15, podW * 0.42);
  window.addColorStop(0, "#eafff0");
  window.addColorStop(1, "#3ddc5a");
  ctx.beginPath();
  ctx.arc(0, -podH * 0.15, podW * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = window;
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

// The distant starfield backdrop — twinkling points behind everything else.
// Deliberately drawn before the shake translate below: it's meant to read as
// far-off space, unmoved by the shield's own shake.
interface Star {
  x: number;
  y: number;
  radius: number;
  phase: number;
  twinkleSpeed: number;
  baseAlpha: number;
}

function createStars(width: number, height: number): Star[] {
  const count = Math.round((width * height) / 6000);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 0.5 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.4 + Math.random() * 1.6,
      baseAlpha: 0.25 + Math.random() * 0.35,
    });
  }
  return stars;
}

function drawStarfield(ctx: CanvasRenderingContext2D, stars: Star[], animClock: number): void {
  for (const star of stars) {
    const twinkle = 0.5 + 0.5 * Math.sin(animClock * star.twinkleSpeed + star.phase);
    const alpha = Math.min(1, star.baseAlpha + twinkle * 0.5);
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
    ctx.fill();
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  animClock: number,
  stars: Star[],
  shakeX = 0,
  shakeY = 0,
): void {
  // The background clear/fill always covers the full canvas, untransformed —
  // shake only displaces what's drawn on top of it, so a jittering offset
  // never leaves a sliver of the previous frame visible at the edges.
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, width, height);
  drawStarfield(ctx, stars, animClock);

  ctx.save();
  ctx.translate(shakeX, shakeY);

  drawPlanet(ctx, width, height, state.hits, animClock);

  const pulse = 0.5 + 0.5 * Math.sin(animClock * 6);
  // Before the first tap, the only entity on screen is the intro spike —
  // give it the amplified glow so it's unmistakably the thing to touch.
  const introIntensity = !state.started ? 1.8 : 1;
  for (const entity of state.entities) {
    const { x, y } = entityPosition(entity, width, height);
    if (entity.kind === "spike") {
      drawMeteor(ctx, x, y, entity.angle, pulse, introIntensity);
    } else {
      const bob = Math.sin(animClock * 2 + entity.id) * 4;
      drawEscapePod(ctx, x, y, bob);
    }
  }

  ctx.restore();
}

function pickAngle(): number {
  return Math.random() * Math.PI * 2;
}

// The "pop" — a decorative particle burst whenever a meteor or escape pod is
// clicked. Purely visual, so it lives here rather than in game-logic's
// testable state machine. Color signals the kind: a big fiery orange/red
// blast — pulverized rock — for a destroyed meteor (the successful,
// intended tap), gold for a popped escape pod (the wrong move).
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  radius: number;
}

// A one-off expanding, fading ring — the "shockwave" that sells a meteor
// destruction as a bigger, higher-energy event than a normal particle pop.
interface Shockwave {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  maxRadius: number;
  color: string;
}

const SPIKE_POP_COLORS = ["255, 210, 60", "255, 122, 0", "220, 40, 20"];
const BALLOON_POP_COLOR = "255, 205, 80";
// Gold/green, matching the escape pods — the friendly, celebratory palette
// for the win effect, in contrast to the fiery reds/oranges of a loss.
const VICTORY_COLORS = ["255, 215, 90", "80, 220, 120"];

// A short, decaying screen shake — triggered once when the round ends,
// win or lose.
const SHAKE_DURATION = 0.4;
const SHAKE_MAGNITUDE = 10;

export function start(canvas: HTMLCanvasElement): void {
  const rawCtx = canvas.getContext("2d");
  if (!rawCtx) throw new Error("2d canvas context unavailable");
  const ctx: CanvasRenderingContext2D = rawCtx;

  // The score/hits HUD and the game-over card are real DOM elements layered
  // over the canvas (see index.html/styles.css) rather than drawn text, so
  // they can use backdrop-filter glass styling. Nothing here changes what
  // the tested game-logic state machine does — only how it's presented.
  const hudScore = document.querySelector<HTMLElement>("#hud-score");
  const hudHits = document.querySelector<HTMLElement>("#hud-hits");
  const gameOverEl = document.querySelector<HTMLElement>("#game-over");
  const gameOverTitle = document.querySelector<HTMLElement>("#game-over-title");
  const gameOverScore = document.querySelector<HTMLElement>("#game-over-score");

  function syncHud(state: GameState): void {
    if (hudScore) hudScore.textContent = `${state.score}`;
    if (hudHits) {
      hudHits.textContent = `${state.hits} / ${MAX_HITS}`;
      hudHits.classList.toggle("is-critical", state.hits >= MAX_HITS - 1);
    }
    if (!gameOverEl) return;
    gameOverEl.classList.toggle("is-visible", state.gameOver);
    if (!state.gameOver) return;
    if (gameOverTitle) gameOverTitle.textContent = state.won ? "You Win!" : "Game Over";
    if (gameOverScore) gameOverScore.textContent = `Score: ${state.score}`;
  }

  let width = 0;
  let height = 0;
  let stars: Star[] = [];

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = createStars(width, height);
  }
  window.addEventListener("resize", resize);
  resize();

  let state: GameState = createIntroState(width, height);
  let spawnAccumulator = 0;
  let difficulty: Difficulty = difficultyFor(0);
  let particles: Particle[] = [];
  let shockwaves: Shockwave[] = [];

  interface PopOptions {
    count: number;
    speedMin: number;
    speedMax: number;
    life: number;
    radiusMin: number;
    radiusMax: number;
  }

  const BALLOON_POP: PopOptions = {
    count: 14,
    speedMin: 60,
    speedMax: 120,
    life: 0.6,
    radiusMin: 3,
    radiusMax: 3,
  };

  // Bigger, faster, longer-lived, and with size variety — a "massive,
  // high-energy" burst rather than a small pop, for the tap the game
  // actually wants: destroying a meteor.
  const SPIKE_POP: PopOptions = {
    count: 48,
    speedMin: 90,
    speedMax: 320,
    life: 0.8,
    radiusMin: 2,
    radiusMax: 6,
  };

  // Bigger again, and longer-lived — the planet itself going up, on the
  // third hit that ends the round, rather than just another meteor popping.
  const PLANET_POP: PopOptions = {
    count: 90,
    speedMin: 120,
    speedMax: 420,
    life: 1.1,
    radiusMin: 3,
    radiusMax: 8,
  };

  // A festive burst for surviving the full timer — as big as the planet
  // explosion, but slower and longer-hanging, so it reads as fireworks
  // rather than a blast.
  const VICTORY_POP: PopOptions = {
    count: 90,
    speedMin: 80,
    speedMax: 300,
    life: 1.4,
    radiusMin: 3,
    radiusMax: 7,
  };

  function popParticles(x: number, y: number, colors: string[], opts: PopOptions): void {
    for (let i = 0; i < opts.count; i++) {
      const angle = (Math.PI * 2 * i) / opts.count + Math.random() * 0.3;
      const speed = opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin);
      const radius = opts.radiusMin + Math.random() * (opts.radiusMax - opts.radiusMin);
      const color = colors[Math.floor(Math.random() * colors.length)];
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: opts.life,
        maxLife: opts.life,
        color,
        radius,
      });
    }
  }

  function spawnShockwave(x: number, y: number, color: string): void {
    shockwaves.push({ x, y, life: 0.35, maxLife: 0.35, maxRadius: 70, color });
  }

  function updateParticles(dt: number): void {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // A little drag so the burst decelerates rather than flying out at a
      // constant speed — reads as an explosion losing energy, not a spray.
      p.vx *= 1 - Math.min(1, dt * 2.2);
      p.vy *= 1 - Math.min(1, dt * 2.2);
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const s of shockwaves) s.life -= dt;
    shockwaves = shockwaves.filter((s) => s.life > 0);
  }

  function drawParticles(shakeX: number, shakeY: number): void {
    for (const s of shockwaves) {
      const t = 1 - s.life / s.maxLife;
      const radius = s.maxRadius * t;
      const alpha = 1 - t;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x + shakeX, s.y + shakeY, radius, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(${s.color}, ${alpha})`;
      ctx.shadowColor = `rgba(${s.color}, ${alpha})`;
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.restore();
    }

    for (const p of particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.shadowColor = `rgba(${p.color}, ${alpha})`;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x + shakeX, p.y + shakeY, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color}, ${alpha})`;
      ctx.fill();
      ctx.restore();
    }
  }

  function pointerPosition(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (event) => {
    const { x, y } = pointerPosition(event);
    if (state.gameOver) {
      state = createIntroState(width, height);
      spawnAccumulator = 0;
      return;
    }
    const target = findEntityAt(state.entities, x, y, width, height);
    if (!target) return;

    const pos = entityPosition(target, width, height);
    if (target.kind === "spike") {
      popParticles(pos.x, pos.y, SPIKE_POP_COLORS, SPIKE_POP);
      spawnShockwave(pos.x, pos.y, SPIKE_POP_COLORS[0]);
      playMeteorExplosion();
    } else {
      popParticles(pos.x, pos.y, [BALLOON_POP_COLOR], BALLOON_POP);
      playBalloonMiss();
    }

    if (!state.started) {
      // Frozen opening screen: only a tap that actually lands on the intro
      // meteor does anything — it pops, and that's what starts the round.
      state = startGame(resolveClick(state, target.id));
      return;
    }
    state = resolveClick(state, target.id);
  });

  let lastTimestamp = 0;
  let animClock = 0;
  let shakeTimeRemaining = 0;
  let wasGameOver = false;

  function frame(timestamp: number): void {
    const dt = lastTimestamp === 0 ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.1);
    lastTimestamp = timestamp;
    animClock += dt;
    updateParticles(dt);

    if (state.started && !state.gameOver) {
      const hitsBefore = state.hits;
      state = tick(state, dt);
      if (state.hits > hitsBefore) playHitTaken();
      difficulty = difficultyFor(state.elapsed);

      spawnAccumulator += dt * 1000;
      if (spawnAccumulator >= difficulty.spawnIntervalMs) {
        spawnAccumulator = 0;
        const spawnBalloonThisRound = difficulty.balloonsEnabled && Math.random() < 0.3;
        state = spawnBalloonThisRound
          ? spawnBalloon(state, pickAngle(), difficulty.balloonSpeed)
          : spawnSpike(state, pickAngle(), difficulty.spikeSpeed);
      }
    }

    // A one-shot shake and stinger the instant the round ends — win or lose.
    // A win gets a gold/green fireworks-style particle burst (state.entities
    // is already cleared by tick() the instant WIN_SECONDS is reached, so
    // no meteor/pod is left mid-flight behind it); a loss instead blows up
    // the planet itself with a fiery burst and a deeper explosion sound.
    if (state.gameOver && !wasGameOver) {
      shakeTimeRemaining = SHAKE_DURATION;
      if (state.won) {
        popParticles(width / 2, height / 2, VICTORY_COLORS, VICTORY_POP);
        spawnShockwave(width / 2, height / 2, VICTORY_COLORS[0]);
        spawnShockwave(width / 2, height / 2, VICTORY_COLORS[1]);
        playWin();
      } else {
        popParticles(width / 2, height / 2, SPIKE_POP_COLORS, PLANET_POP);
        spawnShockwave(width / 2, height / 2, SPIKE_POP_COLORS[1]);
        playPlanetDestroyed();
      }
    }
    wasGameOver = state.gameOver;

    let shakeX = 0;
    let shakeY = 0;
    if (shakeTimeRemaining > 0) {
      shakeTimeRemaining = Math.max(0, shakeTimeRemaining - dt);
      const intensity = SHAKE_MAGNITUDE * (shakeTimeRemaining / SHAKE_DURATION);
      shakeX = (Math.random() * 2 - 1) * intensity;
      shakeY = (Math.random() * 2 - 1) * intensity;
    }

    draw(ctx, state, width, height, animClock, stars, shakeX, shakeY);
    drawParticles(shakeX, shakeY);
    syncHud(state);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
