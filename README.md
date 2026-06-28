# 🏁 Vibe Climb Racing

Endless procedural hill climb game — vanilla JS, no frameworks, no dependencies.

## What is this?

A browser-based hill climb racer where the terrain generates **procedurally during play** — no two runs are the same. The track builds itself ahead of you using random-walk control points + Catmull-Rom spline interpolation, with surface types, weather, and special zones that change the driving experience every run. Pure vanilla JavaScript + Canvas, zero dependencies.

**Play it:** https://vcr.vibeops.de

## Features

- **Endless procedural terrain** — random-walk control points + Catmull-Rom splines, continuous generation while driving
- **Surface types** — grass, mud, ice, sand, gravel — each with different grip and max-speed physics
- **Weather system** — sunny, night, rain, snow, fog — changes visuals + grip, random per run
- **Special zones** — boost sections, coin fields, mountain passes, chaos zones every 2000-5000m
- **Terrain features** — kicker ramps, gaps, double-humps injected into random terrain
- **Custom 2D physics** — gravity, engine force, ground collision, slope alignment, air control, head-touch death model
- **3 vehicles** — Jeep (balanced), Truck (heavy/stable), Bike (light/agile) — each with unique physics
- **Upgrade system** — motor, tires, tank — per-vehicle, 5 levels each
- **Fuel system** — tank depletes, pick up fuel cans on the track (proportional refill)
- **Coins + loop bonus** — collect coins, earn 360° air-loop bonuses
- **Level system** — difficulty +35% per 1000m, level-up bonuses
- **Elevation profile** — game-over canvas shows your entire run's terrain heightmap + pickups + crash site
- **Adaptive render quality** — FPS-based DPR scaling for weak devices
- **Sound** — Web Audio API synth (engine drone, coin, fuel, crash) — zero audio assets
- **Fullscreen + PWA** — Android fullscreen API, iOS PWA standalone mode
- **Touch + keyboard controls** — independent input sources, no conflict
- **Save system** — localStorage: wallet, highscores, per-vehicle upgrades, unlocked vehicles
- **Zero dependencies** — no npm, no build step, no frameworks

## Controls

| Input | Action |
|---|---|
| **▶ Green button** / `→` / `D` | Gas (accelerate forward) |
| **◀ Red button** / `←` / `A` | Brake / reverse |
| Airborne + Gas | Tilt backward (wheelie) |
| Airborne + Brake | Tilt forward (endo) |
| `⛶` button | Fullscreen |
| `🔊` button | Mute toggle |

## Surface Types

| Surface | Grip | Max Speed | Feel |
|---|---|---|---|
| 🛣️ Gras | Normal | Normal | Baseline |
| 🟤 Matsch | Heavy friction | -15% | Sluggish, hard to maintain speed |
| ❄️ Eis | Very low friction | +10% | Slides forever, hard to brake |
| 🏜️ Sand | Heavy friction | -25% | Sinks, can't reach top speed |
| 🪨 Schotter | Slight friction | -5% | Slightly rougher than grass |

## Weather

| Weather | Visual | Grip Effect |
|---|---|---|
| ☀️ Sonnig | Blue sky, green hills | Normal |
| 🌙 Nacht | Dark sky, stars, headlight | Normal |
| 🌧️ Regen | Grey sky, rain particles | -15% grip |
| 🌨️ Schnee | White hills, snowflakes | -30% grip |
| 🌫️ Nebel | Limited visibility (fog circle) | -10% grip |

## Special Zones

Every 2000-5000m, a structured zone appears:

| Zone | What happens |
|---|---|
| 🚀 Boost | Flat speed section — open the throttle |
| 💰 Coinfield | Dense coin formation — collection party |
| 🏔️ Mountain | Steep mountain pass — tests engine power |
| 🌀 Chaos | Extreme jagged terrain — survival test |

## Tech Stack

| Layer | Tech |
|---|---|
| Rendering | HTML5 Canvas 2D |
| Physics | Custom 2D (gravity, collision, angular dynamics, surface friction) |
| Terrain | Random-walk + Catmull-Rom, surface regions, special zones, terrain features |
| Sound | Web Audio API synth (zero assets) |
| Save | localStorage |
| Language | Vanilla JS (ES6), no transpiler |

## File Structure

```
vcr/
├── index.html    # Markup, CSS, HUD, overlays, controls
├── game.js       # All game logic (~2200 lines)
└── README.md     # This file
```

## Quick Start

Just open `index.html` in a browser. That's it — no build step, no dependencies.

Or serve locally:

```bash
python3 -m http.server 8099
# open http://localhost:8099
```

## Deployment

Static files — any web server works. Example with Caddy:

```
vcr.example.com {
    root * /path/to/vcr
    file_server
}
```

## Roadmap

- [x] ~~Vehicle selection (Jeep/Truck/Bike)~~ ✅ v2606.2.0
- [x] ~~Upgrade system (motor, tires, tank)~~ ✅ v2606.2.4
- [x] ~~High score persistence (localStorage)~~ ✅
- [x] ~~Sound effects + engine audio~~ ✅
- [x] ~~Difficulty progression (terrain gets rougher)~~ ✅
- [x] ~~Surface types (mud, ice, sand, gravel)~~ ✅ v2606.3.0
- [x] ~~Weather system (rain, snow, night, fog)~~ ✅ v2606.3.0
- [x] ~~Special zones (boost, coinfield, mountain, chaos)~~ ✅ v2606.3.0
- [x] ~~Terrain features (kickers, gaps, double-humps)~~ ✅ v2606.3.0
- [ ] **Hall of Fame** — zentrales Leaderboard (Server-seitig, Top 10, Name + Distanz)
- [ ] Obstacles (rocks, logs, ramps, flying fuel)
- [ ] Daily Challenge (seeded terrain — gleiche Strecke für alle)
- [ ] More vehicles (Tank, Sports Car, Monster Truck)

## License

MIT

---

Made with ⛽ by [VibeOps](https://vibeops.de)