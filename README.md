# 🏁 Vibe Climb Racing

Endless procedural hill climb game — vanilla JS, no frameworks, no dependencies.

**🎮 Play: [https://vcr.vibeops.de](https://vcr.vibeops.de)**

## What is this?

A browser-based hill climb racer where the terrain generates **procedurally during play** — no two runs are the same. The track builds itself ahead of you using layered sine noise and trims behind you as you drive. Pure vanilla JavaScript + Canvas, zero dependencies.

## Features

- **Endless procedural terrain** — layered sine noise, continuous generation while driving
- **Custom 2D physics** — gravity, engine force, ground collision, slope alignment, air control
- **Fuel system** — tank depletes, pick up fuel cans on the track
- **Coins** — collect for score, procedurally placed above terrain
- **Flip detection** — upside down for 2+ seconds = game over
- **Parallax background** — 3 layers (far hills, mid hills, clouds)
- **Touch + keyboard controls** — works on mobile and desktop
- **Zero dependencies** — no npm, no build step, no frameworks

## Controls

| Input | Action |
|---|---|
| **▶ Green button** / `→` / `D` | Gas (accelerate forward) |
| **◀ Red button** / `←` / `A` | Brake / reverse |
| Airborne + Gas | Tilt backward (wheelie) |
| Airborne + Brake | Tilt forward (endo) |

## Tech Stack

| Layer | Tech |
|---|---|
| Rendering | HTML5 Canvas 2D |
| Physics | Custom 2D (gravity, collision, angular dynamics) |
| Terrain | Layered sine noise, binary-search lookup |
| Language | Vanilla JS (ES6), no transpiler |
| Serving | Caddy (static file server via symlink) |

## File Structure

```
vcr/
├── index.html    # Markup, CSS, HUD, start/gameover screens, control buttons
├── game.js       # All game logic (~700 lines)
└── README.md     # This file
```

## Deployment

The repo lives at `/root/vcr` and is symlinked to `/var/www/vcr`, served by Caddy:

```
vcr.vibeops.de {
    root * /var/www/vcr
    file_server
}
```

To deploy changes:

```bash
cd /root/vcr
git add -A
git commit -m "your change"
# Caddy serves via symlink — live immediately
```

## Physics Tuning

Key constants in `game.js` → `Car.update()`:

| Constant | Default | Effect |
|---|---|---|
| `GRAVITY` | 0.55 | Downward acceleration |
| `ENGINE_FWD` | 0.35 | Gas pedal force |
| `ENGINE_BACK` | 0.45 | Brake/reverse force |
| `AIR_DRAG` | 0.995 | Horizontal velocity damping |
| `ANG_DAMP` | 0.96 | Angular velocity damping |
| `MAX_VX` | 14 | Max forward speed |

## Roadmap

- [ ] Vehicle selection (truck, bike, tank...)
- [ ] Upgrade system (engine, suspension, tires)
- [ ] High score persistence (localStorage)
- [ ] Sound effects + engine audio
- [ ] Difficulty progression (terrain gets rougher with distance)
- [ ] Multiplayer (split screen or online)

## License

MIT

---

Made with ⛽ by [VibeOps](https://vibeops.de)