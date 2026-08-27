import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  GLASS_STAR_RADIUS,
  INTRO_SPIKE_GAP,
  MAX_HITS,
  SPIKE_RADIUS,
  WIN_SECONDS,
  createInitialState,
  createIntroState,
  entityPosition,
  findEntityAt,
  isHit,
  resolveClick,
  spawnBalloon,
  spawnSpike,
  startGame,
  tick,
} from "../game-logic";

// Contract tests for crits/05-game (see the course website for the full
// spec). Lines only a person can judge at the crit — whether a stranger
// reaches an ending inside five minutes, whether the opening screen's
// affordance is actually obvious — aren't testable here and aren't attempted.

const DIST = resolve("dist");

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const shipped = files();
const htmlFiles = shipped.filter((path) => path.endsWith(".html"));

describe("game: teaches itself, no instructions anywhere", () => {
  it("has no how-to-play language on any shipped page", () => {
    const instructionLanguage =
      /how to play|instructions|tutorial|read the rules|click here to begin/i;
    for (const path of htmlFiles) {
      const doc = new JSDOM(readFileSync(path, "utf8")).window.document;
      expect(
        doc.body.textContent ?? "",
        `${path} contains instruction-like text — the brief asks the opening screen to teach by playing, not by explaining`,
      ).not.toMatch(instructionLanguage);
    }
  });

  it("ships no dedicated instructions/help page", () => {
    const instructionPageName = /instructions|tutorial|help|how-?to-?play/i;
    for (const path of htmlFiles) {
      expect(
        path,
        `${path} looks like a dedicated instructions page — the brief asks for none`,
      ).not.toMatch(instructionPageName);
    }
  });
});

describe("game: opens frozen on a single intro spike", () => {
  // The brief: the opening screen teaches by playing, not by explaining.
  // Concretely: the round starts paused with exactly one spike hovering a
  // couple of pixels from the star, and nothing moves or spawns until the
  // player resolves that one spike.
  const width = 400;
  const height = 400;

  it("starts unstarted, with exactly one spike hovering just off the star", () => {
    const state = createIntroState(width, height);
    expect(state.started).toBe(false);
    expect(state.entities).toHaveLength(1);

    const [spike] = state.entities;
    expect(spike.kind).toBe("spike");
    const { x, y } = entityPosition(spike, width, height);
    const distanceFromCenter = Math.hypot(x - width / 2, y - height / 2);
    const expectedGap = GLASS_STAR_RADIUS + SPIKE_RADIUS + INTRO_SPIKE_GAP;
    expect(distanceFromCenter).toBeCloseTo(expectedGap, 5);
  });

  it("stays frozen: ticking before startGame moves nothing", () => {
    let state = createIntroState(width, height);
    const before = state.entities[0].progress;
    state = tick(state, 5);
    expect(state.entities[0].progress).toBe(before);
    expect(state.elapsed).toBe(0);
  });

  it("resolving the intro spike and calling startGame unfreezes normal play", () => {
    let state = createIntroState(width, height);
    const [spike] = state.entities;
    state = startGame(resolveClick(state, spike.id));
    expect(state.started).toBe(true);
    expect(state.entities).toHaveLength(0);

    state = spawnSpike(state, 0, 10);
    state = tick(state, 1);
    expect(state.elapsed).toBeGreaterThan(0);
  });
});

describe("game: it can be lost", () => {
  // The brief: "a wrong move is possible, and play ends somewhere — a win, a
  // loss or a finish." The rule: the Glass Star takes MAX_HITS un-clicked
  // spikes before it shatters. This is the one focused rule the spec asks
  // for, tested directly against the pure state machine — no canvas needed.
  it("shatters the star after enough unclicked spikes reach it", () => {
    let state = createInitialState();
    for (let i = 0; i < MAX_HITS; i++) {
      state = spawnSpike(state, 0, 10); // speed 10/s -> arrives well inside 1s
      state = tick(state, 1);
    }
    expect(state.hits).toBe(MAX_HITS);
    expect(state.gameOver).toBe(true);
    expect(state.won).toBe(false);
  });

  it("clicking a spike before it arrives prevents that hit", () => {
    let state = createInitialState();
    state = spawnSpike(state, 0, 0.1);
    const [spike] = state.entities;
    state = resolveClick(state, spike.id);
    state = tick(state, 1);
    expect(state.hits).toBe(0);
    expect(state.gameOver).toBe(false);
  });

  it("popping a friendly balloon is the wrong move: it deducts points, not the star", () => {
    let state = createInitialState();
    state = spawnBalloon(state, 0, 0.1);
    const [balloon] = state.entities;
    const scoreBefore = state.score;
    state = resolveClick(state, balloon.id);
    expect(state.entities).toHaveLength(0);
    expect(state.score).toBeLessThan(scoreBefore);
    expect(state.hits).toBe(0);
  });
});

describe("game: it can be won", () => {
  // The round must resolve inside 3 minutes: surviving WIN_SECONDS without
  // the star shattering is a win, guaranteeing an ending either way.
  it("surviving WIN_SECONDS without a shattered star is a win", () => {
    let state = createInitialState();
    state = tick(state, WIN_SECONDS);
    expect(state.gameOver).toBe(true);
    expect(state.won).toBe(true);
    expect(state.hits).toBeLessThan(MAX_HITS);
  });

  it("a loss takes priority over a win at the same tick", () => {
    let state = createInitialState();
    for (let i = 0; i < MAX_HITS; i++) {
      state = spawnSpike(state, 0, 1);
    }
    state = tick(state, WIN_SECONDS); // every spike arrives AND the clock runs out
    expect(state.gameOver).toBe(true);
    expect(state.won).toBe(false);
  });
});

describe("game: collision math (isHit / findEntityAt)", () => {
  // Pure and isolated from rendering on purpose: plain numbers in, a
  // boolean/entity out — no canvas, no DOM, easy to extend with more cases.
  const width = 400;
  const height = 400;

  it("hits an entity when the tap lands on its current position", () => {
    const state = spawnSpike(createInitialState(), 0, 0); // angle 0, no movement
    const [spike] = state.entities;
    const { x, y } = { x: width / 2 + (Math.min(width, height) / 2) * 1.15, y: height / 2 };
    expect(isHit(spike, x, y, width, height)).toBe(true);
  });

  it("misses when the tap is far from the entity", () => {
    const state = spawnSpike(createInitialState(), 0, 0);
    const [spike] = state.entities;
    expect(isHit(spike, 0, 0, width, height)).toBe(false);
  });

  it("findEntityAt resolves overlapping entities to the most recently spawned", () => {
    let state = spawnSpike(createInitialState(), 0, 0);
    state = spawnBalloon(state, 0, 0); // same angle/progress as the spike above
    const [, balloon] = state.entities;
    const { x, y } = { x: width / 2 + (Math.min(width, height) / 2) * 1.15, y: height / 2 };
    expect(findEntityAt(state.entities, x, y, width, height)?.id).toBe(balloon.id);
  });

  it("findEntityAt returns undefined when nothing is under the tap", () => {
    const state = spawnSpike(createInitialState(), 0, 0);
    expect(findEntityAt(state.entities, 0, 0, width, height)).toBeUndefined();
  });
});
