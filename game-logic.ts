// Pure game state for Balloon Shield: no DOM, no canvas, no timers. Entities
// travel outward-in along a fixed angle from progress 0 (spawned at the edge)
// to progress 1 (reaches the Glass Star at the center). Kept dependency-free
// so the rules can be unit-tested directly, without a canvas or jsdom.

export type EntityKind = "spike" | "balloon";

export interface Entity {
  id: number;
  kind: EntityKind;
  angle: number;
  progress: number;
  speed: number;
}

export interface GameState {
  entities: Entity[];
  hits: number;
  score: number;
  gameOver: boolean;
  won: boolean;
  elapsed: number;
  nextId: number;
  /** False only for the frozen opening screen built by createIntroState —
   *  tick() is a no-op until startGame() flips this. A state built directly
   *  by createInitialState() is already running. */
  started: boolean;
}

export const MAX_HITS = 3;
export const SPIKE_HIT_SCORE = 1;
export const BALLOON_ARRIVAL_SCORE = 3;
/** Popping a balloon is the wrong move: it costs points outright, not just
 *  the points it would have earned. */
export const BALLOON_MISCLICK_PENALTY = 1;
export const BALLOON_UNLOCK_SECONDS = 15;
/** A round must resolve inside 3 minutes: surviving this long is a win. */
export const WIN_SECONDS = 150;

export function createInitialState(): GameState {
  return {
    entities: [],
    hits: 0,
    score: 0,
    gameOver: false,
    won: false,
    elapsed: 0,
    nextId: 1,
    started: true,
  };
}

/** Appends an entity at an explicit progress (0 = spawned at the edge, 1 =
 *  at the star). spawnSpike/spawnBalloon are the progress-0 case used during
 *  normal play; createIntroState uses this directly to place the opening
 *  spike close in. */
export function spawnEntityAt(
  state: GameState,
  kind: EntityKind,
  angle: number,
  progress: number,
  speed: number,
): GameState {
  const entity: Entity = { id: state.nextId, kind, angle, progress, speed };
  return { ...state, entities: [...state.entities, entity], nextId: state.nextId + 1 };
}

function spawn(state: GameState, kind: EntityKind, angle: number, speed: number): GameState {
  return spawnEntityAt(state, kind, angle, 0, speed);
}

export function spawnSpike(state: GameState, angle: number, speed: number): GameState {
  return spawn(state, "spike", angle, speed);
}

export function spawnBalloon(state: GameState, angle: number, speed: number): GameState {
  return spawn(state, "balloon", angle, speed);
}

/** Flips the round from frozen to running — called once, when the player
 *  resolves the opening intro spike. */
export function startGame(state: GameState): GameState {
  return { ...state, started: true };
}

/** Advances every entity by `dtSeconds`; arrivals resolve as a hit (spike) or
 *  points (balloon). A no-op once the round is over, or before it has
 *  started — the opening screen stays frozen until the intro spike resolves. */
export function tick(state: GameState, dtSeconds: number): GameState {
  if (!state.started || state.gameOver) return state;

  const remaining: Entity[] = [];
  let hits = state.hits;
  let score = state.score;

  for (const entity of state.entities) {
    const progress = entity.progress + entity.speed * dtSeconds;
    if (progress < 1) {
      remaining.push({ ...entity, progress });
      continue;
    }
    if (entity.kind === "spike") {
      hits += 1;
    } else {
      score += BALLOON_ARRIVAL_SCORE;
    }
  }

  const elapsed = state.elapsed + dtSeconds;
  const lost = hits >= MAX_HITS;
  const won = !lost && elapsed >= WIN_SECONDS;

  return {
    ...state,
    entities: remaining,
    hits,
    score,
    gameOver: lost || won,
    won,
    elapsed: won ? WIN_SECONDS : elapsed,
  };
}

/** The player clicking/tapping an entity before it arrives: destroying a
 *  spike scores; popping a balloon is the wrong move and deducts points. */
export function resolveClick(state: GameState, entityId: number): GameState {
  if (state.gameOver) return state;

  const entity = state.entities.find((e) => e.id === entityId);
  if (!entity) return state;

  const entities = state.entities.filter((e) => e.id !== entityId);
  const score =
    entity.kind === "spike"
      ? state.score + SPIKE_HIT_SCORE
      : state.score - BALLOON_MISCLICK_PENALTY;
  return { ...state, entities, score };
}

export interface Difficulty {
  spawnIntervalMs: number;
  spikeSpeed: number;
  balloonSpeed: number;
  balloonsEnabled: boolean;
}

/** Spawn cadence and entity speed ramp with elapsed time, each clamped so the
 *  game neither idles forever nor becomes unplayable. The first spike starts
 *  slow — roughly six seconds to arrive — so its approach is obvious well
 *  inside the "ten seconds" affordance window, before the ramp tightens. */
export function difficultyFor(elapsedSeconds: number): Difficulty {
  const spawnIntervalMs = Math.max(450, 1400 - elapsedSeconds * 20);
  const spikeSpeed = Math.min(0.55, 0.16 + elapsedSeconds * 0.007);
  const balloonSpeed = Math.min(0.35, 0.16 + elapsedSeconds * 0.003);
  return {
    spawnIntervalMs,
    spikeSpeed,
    balloonSpeed,
    balloonsEnabled: elapsedSeconds >= BALLOON_UNLOCK_SECONDS,
  };
}

// --- Collision math -------------------------------------------------------
// Pure and isolated from rendering/DOM on purpose: this is the "did the
// player's tap land on an entity" check, and it needs to be testable with
// plain numbers in, a boolean/entity out — no canvas required.

export const SPIKE_RADIUS = 14;
export const BALLOON_RADIUS = 16;
export const HIT_TOLERANCE = 18;
/** The Glass Star's visual radius. Lives here, not in the renderer, because
 *  createIntroState needs it to place the opening spike a fixed gap away. */
export const GLASS_STAR_RADIUS = 30;

function entityVisualRadius(kind: EntityKind): number {
  return kind === "spike" ? SPIKE_RADIUS : BALLOON_RADIUS;
}

/** Where an entity currently sits in pixel space, given the play area's
 *  size. progress 0 = spawned at the edge; progress 1 = at the center. */
export function entityPosition(
  entity: Entity,
  width: number,
  height: number,
): { x: number; y: number } {
  const spawnRadius = (Math.min(width, height) / 2) * 1.15;
  const r = spawnRadius * (1 - entity.progress);
  return {
    x: width / 2 + Math.cos(entity.angle) * r,
    y: height / 2 + Math.sin(entity.angle) * r,
  };
}

/** Inverts entityPosition's radial formula: what progress puts an entity at
 *  exactly `radius` pixels from the center, for this play area's size? */
export function radiusToProgress(radius: number, width: number, height: number): number {
  const spawnRadius = (Math.min(width, height) / 2) * 1.15;
  return 1 - radius / spawnRadius;
}

/** The gap, in pixels, between the intro spike and the Glass Star's edge. */
export const INTRO_SPIKE_GAP = 2;
/** Straight up from the star — an arbitrary but fixed, deterministic choice. */
export const INTRO_SPIKE_ANGLE = -Math.PI / 2;

/** The frozen opening screen: no timers, no spawning, just the star and one
 *  spike hovering INTRO_SPIKE_GAP pixels from it. The whole game is paused
 *  (`started: false`) until the player resolves that one spike — that tap is
 *  what teaches the entire game, with zero on-screen text. */
export function createIntroState(width: number, height: number): GameState {
  const state: GameState = { ...createInitialState(), started: false };
  const progress = radiusToProgress(
    GLASS_STAR_RADIUS + SPIKE_RADIUS + INTRO_SPIKE_GAP,
    width,
    height,
  );
  return spawnEntityAt(state, "spike", INTRO_SPIKE_ANGLE, progress, 0);
}

/** Pure circle-circle overlap test: two circles collide when the distance
 *  between their centers is no more than the sum of their radii. No DOM, no
 *  canvas, no entities — just numbers in, a boolean out. */
export function checkCollision(
  x1: number,
  y1: number,
  radius1: number,
  x2: number,
  y2: number,
  radius2: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance <= radius1 + radius2;
}

/** The collision check: does a tap/click at (x, y) land on this entity?
 *  Modeled as a zero-radius circle (the tap point) against the entity's
 *  visual circle, padded by HIT_TOLERANCE for touch-friendliness. */
export function isHit(
  entity: Entity,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const pos = entityPosition(entity, width, height);
  const radius = entityVisualRadius(entity.kind) + HIT_TOLERANCE;
  return checkCollision(x, y, 0, pos.x, pos.y, radius);
}

/** Which entity (if any) a tap/click at (x, y) hits. Later entities are
 *  checked first, so a click on overlapping entities resolves to the most
 *  recently spawned — the one drawn on top. */
export function findEntityAt(
  entities: Entity[],
  x: number,
  y: number,
  width: number,
  height: number,
): Entity | undefined {
  for (let i = entities.length - 1; i >= 0; i--) {
    if (isHit(entities[i], x, y, width, height)) return entities[i];
  }
  return undefined;
}
