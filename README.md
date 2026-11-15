# castle-valley

A playable three.js scene: you walk out of a dark forest, torch and sword in hand, toward a
village under a castle. It recreates this pixel-art clip: https://x.com/de5imulate/status/1947024682118488116

```bash
pnpm install
pnpm dev
```

| input | desktop | touch |
| --- | --- | --- |
| look | click, then move the mouse | drag the right half |
| walk | `WASD` or arrows, `shift` runs | drag the left half |
| swing | click or `space` | tap the right half |

## How it looks painted

The whole world is made of **dabs**: flat-coloured rectangles pinned to points in 3D. There is no filter on top
and no pixel grid on the screen. The idea is from https://patch.gg/blendi/oil-paint, with a much simpler brush.

```
under mesh ── coarse geometry in flat colours, so nothing shows between the dabs
dabs ──────── about 2 million instanced quads, one flat colour each
               face: a square that turns to the eye (leaves, rock, cloud, sky)
               lie:  a stroke that lies on its surface (ground, walls, bark)
```

- **Pinned to the world.** A dab never moves, so the paint stays on things when you walk or turn.
- **Colours are mixed once**, when the world is built: a tone from a small ramp, picked by light and chance.
  The ramps are measured from the reference video (`RAMPS` in `src/paint.ts`).
- **Far away, fewer and larger dabs.** Each dab has a fixed rank. With distance only the low ranks stay and
  grow to cover their neighbours, so strokes never swap.

The hands are **pixel sprites** cut from the reference frame and drawn over the world, like Doom weapons.

See `AGENTS.md` for the code layout.
