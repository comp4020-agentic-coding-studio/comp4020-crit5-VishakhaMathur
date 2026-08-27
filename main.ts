// Bootstrap only — the game's rules live in game-logic.ts, the canvas
// drawing and input handling in renderer.ts.
import { start } from "./renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("#game canvas not found");
start(canvas);
