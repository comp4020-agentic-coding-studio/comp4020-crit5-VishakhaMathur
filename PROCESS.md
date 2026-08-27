# Process overview

This file is the shape; the course site's
[assessment page](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#what-you-submit)
is the requirement, and its
[word counts](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#word-counts)
cover every deliverable.

## What I built

**Balloon Shield**: a Glass Star sits at the center of the canvas; Spikes
approach from the edges and must be clicked/tapped before they connect, or the
star takes a hit — three hits and it shatters. Later, friendly Balloons also
approach; popping one is the wrong move and costs a point, but leaving it alone
to reach the star scores points instead. The whole thing teaches itself with no
on-screen or off-screen text: the opening screen is frozen with exactly one
spike hovering next to the star, and resolving that single spike is both the
tutorial and the trigger that starts the round.

## The moments that mattered

1. **The opening screen had to teach without saying anything.** The obvious
   move was a "click to start" label or a brief overlay explaining spikes vs.
   balloons. Instead I froze the whole game state (`started: false`) on exactly
   one spike hovering a couple of pixels from the star, so the single action
   that unfreezes the round — tapping that spike — is also the only thing a
   first-time player can do, and it teaches the entire mechanic by doing it. I
   checked this against contract tests that assert no how-to-play language
   anywhere in the shipped HTML, and against dedicated unit tests that the
   state stays frozen until that click resolves.
   [`02add3a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-VishakhaMathur/commit/02add3a)

2. **A wrong move needed real teeth, not just a missed opportunity.** My first
   pass at balloons just let a mis-click forfeit the points a balloon would
   have earned — functionally identical to ignoring it. The spec asks for "a
   wrong move is possible," so I changed popping a balloon to actively deduct a
   point, making it a genuine cost rather than a no-op. I verified this with a
   unit test asserting the score after a balloon mis-click is strictly lower
   than before, not just unchanged.
   [`3ff15da`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-VishakhaMathur/commit/3ff15da)

3. **Collision detection went into the harness, not just the feature.** Rather
   than leaving "did the tap land on this entity" as logic buried inside
   `isHit`, I pulled the actual geometry out into a standalone
   `checkCollision(x1, y1, r1, x2, y2, r2)` primitive with its own dedicated
   test block (overlapping, exactly-touching, apart, and one-inside-the-other
   cases). That split — and labeling `game-logic.ts` as the pure-math section
   the tests target — means every future entity or hit-test change gets
   checked against plain numbers in/out, with no jsdom or canvas required.
   [`078970f`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-VishakhaMathur/commit/078970f),
   [`0a5b0cf`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-VishakhaMathur/commit/0a5b0cf)

`pnpm check` is green (35 tests, typecheck, build) as of this submission.
