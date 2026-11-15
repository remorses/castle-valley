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

The whole world is made of **dabs**: single marks of a bristle brush, pinned to points in 3D. No filter makes
the strokes. The painter follows https://patch.gg/blendi/oil-paint.

```
under ── coarse geometry in flat colours: the underpainting, so nothing shows between the dabs
dabs ─── about 2.5 million instanced cards, each one mark of the brush sheet in one mixed colour
          face: turns to the eye and runs along a direction (leaves, bark, boughs, grass, cloud)
          lie:  lies on its surface and runs along its grain (ground, walls, roofs, rock)
```

- **Pinned to the world.** A dab never moves, so the paint stays on things when you walk or turn.
- **The brush** is a sheet of eight marks made in code (`src/brush.ts`): long strokes that run dry, curved
  strokes, pressed dabs. A light from the upper left rakes across the thick paint.
- **Colours are mixed once**, when the world is built: a tone from a ramp, picked by light and chance. The ramps
  are measured from the reference video (`RAMPS` in `src/paint.ts`).
- **Each kind of thing has its painter** (`src/things.ts`): lobes of leaves round a dark core, bark up a trunk,
  boughs that hang from a fir, strokes along the grain of a wall, flicks of grass.
- **Sun and shade.** The valley's shade is drawn once from the sun. A dab takes sun or shade whole, so the
  edge of a shadow is a ragged line of whole dabs.
- **Mist** puts distance between one row of things and the next: each dab fades by its distance from you.
- **The finish** runs once over the picture (`src/main.ts`): a colour grade that leans the shade to violet and
  the light to warm yellow, the weave of the canvas, and a little varnish. It changes colours only.
- **Far away, fewer and larger dabs.** Each dab has a fixed rank. With distance only the low ranks stay and
  grow to cover their neighbours, so strokes never swap.

The hands are **pixel sprites** cut from the reference frame and drawn over the world, like Doom weapons.

See `AGENTS.md` for the code layout.
