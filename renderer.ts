// Canvas rendering, input handling and the animation loop for Balloon
// Shield. Everything here is the "how"; the rules it draws and reacts to,
// including the collision math, live in game-logic.ts and are what's tested.
import {
  type Difficulty,
  type GameState,
  BALLOON_RADIUS,
  GLASS_STAR_RADIUS,
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

const STAR_RADIUS = GLASS_STAR_RADIUS;
const MAX_CRACKS = 3;

// animClock drives pulsing/bobbing/sparkle — a real-time clock, independent
// of state.elapsed, so the opening screen's spike can still pulse and beg to
// be tapped while the game itself is frozen.
function drawStar(
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

  // A slow, calm ambient glow behind the star — a "breathing" halo, gentle
  // enough not to compete with a spike's urgent pulse.
  const breath = 0.5 + 0.5 * Math.sin(animClock * 1.2);
  const haloRadius = STAR_RADIUS * (2.2 + breath * 0.3);
  const halo = ctx.createRadialGradient(0, 0, STAR_RADIUS * 0.6, 0, 0, haloRadius);
  halo.addColorStop(0, `rgba(150, 200, 255, ${0.18 + breath * 0.08})`);
  halo.addColorStop(1, "rgba(150, 200, 255, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
  ctx.fill();

  function starPath(radius: number): void {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const outerAngle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      const innerAngle = outerAngle + Math.PI / 5;
      const outer = { x: Math.cos(outerAngle) * radius, y: Math.sin(outerAngle) * radius };
      const inner = { x: Math.cos(innerAngle) * radius * 0.5, y: Math.sin(innerAngle) * radius * 0.5 };
      if (i === 0) ctx.moveTo(outer.x, outer.y);
      else ctx.lineTo(outer.x, outer.y);
      ctx.lineTo(inner.x, inner.y);
    }
    ctx.closePath();
  }

  // Glassy fill: a gradient standing in for a highlight/refraction, instead
  // of a flat tint.
  const glass = ctx.createRadialGradient(
    -STAR_RADIUS * 0.3,
    -STAR_RADIUS * 0.4,
    STAR_RADIUS * 0.1,
    0,
    0,
    STAR_RADIUS,
  );
  glass.addColorStop(0, "rgba(240, 250, 255, 0.95)");
  glass.addColorStop(0.55, "rgba(190, 225, 255, 0.85)");
  glass.addColorStop(1, "rgba(140, 190, 250, 0.75)");
  starPath(STAR_RADIUS);
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // A faint inner star traces the highlight, for a faceted-glass look.
  ctx.save();
  ctx.globalAlpha = 0.5;
  starPath(STAR_RADIUS * 0.55);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Cracks accumulate with hits taken, so the glass visibly weakens.
  ctx.strokeStyle = "rgba(40, 60, 90, 0.6)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < hits; i++) {
    const crackAngle = (Math.PI * 2 * i) / MAX_CRACKS + 0.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(crackAngle) * STAR_RADIUS * 0.9, Math.sin(crackAngle) * STAR_RADIUS * 0.9);
    ctx.stroke();
  }

  // A few twinkling sparkle points orbiting the star, each on its own phase.
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

// Spikes pulse — an urgent, "touch me" glow — while balloons drift calmly.
// The contrast is the affordance: no text says which to tap, but one shape
// visibly wants attention and the other doesn't. `intensity` lets the very
// first spike (the frozen opening screen's only entity) pulse harder than
// spikes do during normal play, since it's the one thing the player must
// notice with no other cue on screen.
function drawSpike(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pulse: number,
  intensity = 1,
): void {
  ctx.save();
  ctx.translate(x, y);

  const glowRadius = SPIKE_RADIUS * (1.5 + pulse * 0.6) * intensity;
  const glow = ctx.createRadialGradient(0, 0, SPIKE_RADIUS * 0.5, 0, 0, glowRadius);
  glow.addColorStop(0, `rgba(255, 90, 60, ${(0.35 + pulse * 0.25) * Math.min(intensity, 1.3)})`);
  glow.addColorStop(1, "rgba(255, 90, 60, 0)");
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

  ctx.fillStyle = "#c0392b";
  ctx.beginPath();
  ctx.moveTo(0, -SPIKE_RADIUS);
  ctx.lineTo(SPIKE_RADIUS * 0.9, SPIKE_RADIUS * 0.8);
  ctx.lineTo(-SPIKE_RADIUS * 0.9, SPIKE_RADIUS * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBalloon(ctx: CanvasRenderingContext2D, x: number, y: number, bob: number): void {
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.fillStyle = "#e67e22";
  ctx.beginPath();
  ctx.ellipse(0, 0, BALLOON_RADIUS * 0.8, BALLOON_RADIUS, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, BALLOON_RADIUS);
  ctx.lineTo(0, BALLOON_RADIUS + 10);
  ctx.stroke();
  ctx.restore();
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  animClock: number,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, width, height);

  drawStar(ctx, width, height, state.hits, animClock);

  const pulse = 0.5 + 0.5 * Math.sin(animClock * 6);
  // Before the first tap, the only entity on screen is the intro spike —
  // give it the amplified glow so it's unmistakably the thing to touch.
  const introIntensity = !state.started ? 1.8 : 1;
  for (const entity of state.entities) {
    const { x, y } = entityPosition(entity, width, height);
    if (entity.kind === "spike") {
      drawSpike(ctx, x, y, pulse, introIntensity);
    } else {
      const bob = Math.sin(animClock * 2 + entity.id) * 4;
      drawBalloon(ctx, x, y, bob);
    }
  }

  ctx.fillStyle = "#f4f6fb";
  ctx.font = "16px system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(`Score: ${state.score}`, 12, 12);
  ctx.fillText(`Hits: ${state.hits} / 3`, 12, 34);

  if (state.gameOver) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "28px system-ui, sans-serif";
    ctx.fillText(state.won ? "You Win!" : "Game Over", width / 2, height / 2 - 30);
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText(`Score: ${state.score}`, width / 2, height / 2 + 6);
    ctx.fillText("Click to play again", width / 2, height / 2 + 34);
    ctx.textAlign = "left";
  }
}

function pickAngle(): number {
  return Math.random() * Math.PI * 2;
}

// The intro spike's "pop" — a decorative particle burst. Purely visual, so
// it lives here rather than in game-logic's testable state machine.
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export function start(canvas: HTMLCanvasElement): void {
  const rawCtx = canvas.getContext("2d");
  if (!rawCtx) throw new Error("2d canvas context unavailable");
  const ctx: CanvasRenderingContext2D = rawCtx;

  let width = 0;
  let height = 0;

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  let state: GameState = createIntroState(width, height);
  let spawnAccumulator = 0;
  let difficulty: Difficulty = difficultyFor(0);
  let particles: Particle[] = [];

  function popParticles(x: number, y: number): void {
    const count = 14;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = 60 + Math.random() * 60;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.6,
        maxLife: 0.6,
      });
    }
  }

  function updateParticles(dt: number): void {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  function drawParticles(): void {
    for (const p of particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 150, 100, ${alpha})`;
      ctx.fill();
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
    if (!state.started) {
      // Frozen opening screen: only a tap that actually lands on the intro
      // spike does anything — it pops, and that's what starts the round.
      if (target) {
        const pos = entityPosition(target, width, height);
        popParticles(pos.x, pos.y);
        state = startGame(resolveClick(state, target.id));
      }
      return;
    }
    if (target) state = resolveClick(state, target.id);
  });

  let lastTimestamp = 0;
  let animClock = 0;

  function frame(timestamp: number): void {
    const dt = lastTimestamp === 0 ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.1);
    lastTimestamp = timestamp;
    animClock += dt;
    updateParticles(dt);

    if (state.started && !state.gameOver) {
      state = tick(state, dt);
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

    draw(ctx, state, width, height, animClock);
    drawParticles();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
