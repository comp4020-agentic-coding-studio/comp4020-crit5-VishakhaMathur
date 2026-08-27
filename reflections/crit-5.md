# Crit 5 — A game

**What was the breakthrough that moved the work forward?**

Splitting `game-logic.ts` from `renderer.ts` early. Once entities, ticking,
clicks, and difficulty were plain functions over plain data — no DOM, no
canvas, no timers — the hardest part of the brief stopped being a design
problem and became a testable one. "A wrong move is possible, and play ends
somewhere" turned from a sentence I had to eyeball on screen into four unit
tests I could run in under a second: three unclicked spikes shatter the star,
clicking one first prevents the hit, popping a balloon costs a point, and
surviving long enough is a win. The frozen-opening-screen idea (teach by
forcing one interaction, say nothing) only became something I trusted once I
could assert "ticking before `startGame` moves nothing" directly, instead of
just eyeballing it in the browser and hoping.

**What did this work change about who I want to be as a developer?**

I used to treat "no instructions anywhere" as a UI constraint to satisfy last,
after the mechanics worked. This week it worked better as a design constraint
from the start: because the opening state had to teach by itself, the intro
spike's placement and the freeze/unfreeze logic became core game state rather
than a cosmetic overlay bolted on afterward. I want to keep starting from "what
does the state machine have to guarantee" before touching a canvas, because
every one of this week's real bugs (the balloon miscue doing nothing, the
intro screen not actually freezing) showed up as a missing case in
`game-logic.ts`, not as a rendering glitch.
