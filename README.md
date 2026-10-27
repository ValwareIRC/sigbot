# sigbot

A userscript autopilot and multibox team for [Sigmally](https://one.sigmally.com), an agar.io-style browser game,
plus the tools used to build and test it: a fast simulator on the real server code, a local arena, and analysis
scripts for recorded games.

> Unofficial fan project. Automating a game may be against its rules; use it at your own risk. The bot plays through
> the normal game connection only: no captcha solving, no proxies, nothing beyond what a player's own client sends.

## What the bot does

- **Plays on its own**: grazes, hunts what it can eat, dodges what can eat it, escapes by splitting only when a much
  bigger player is on top of it or its split is flying in.
- **Smart splits**: works out split kills with the server's exact eating rule, including double splits and pairs of
  targets, and skips long splits a moving target would dodge.
- **Mines viruses**: from 2,300 mass it feeds the nearest virus ahead until it splits, eats it, and moves on along the
  same line, down to a 2,000 floor. Shooting a virus is an investment (5 shots make a new 100-mass virus).
- **Plays as a team**: bots in several tabs (same squad name) see as one, merge into each other when chased, feed a
  teammate to make a kill or get out of reach, guard the player's cell, and follow orders from the tab you play in.
- **Pack tactics**: slipping between a player's pieces to eat a small one behind them, swarming players whose pieces
  are locked apart after a split or a virus pop, pinning prey at walls, baiting giants just outside their split
  reach, and joining a teammate's virus shot.
- **Player helpers** for the tab you play yourself (bot off): an on-screen overlay, threat rings, a guardian that
  takes the wheel for a moment when you head into death, and a hold-to-mine key.

## Install

1. Install a userscript manager (Tampermonkey or Violentmonkey).
2. Open [`userscript/sigmally-mega-bot.user.js`](userscript/sigmally-mega-bot.user.js) "Raw" and install it.
3. Open Sigmally. The bot starts off; press **B** to turn it on.

`userscript/sigmally-smart-split.user.js` is the small standalone smart-split script the bot grew out of. Don't run
both.

### Multiboxing

Open the game in several browsers or profiles (one connection each, as the server allows). Every tab running the
bot with the same squad name (default `me`) plays on the same team. Play in one tab with the bot off: that tab is the
**captain**, and the bots follow your orders.

## Keys

| Key | What it does |
|---|---|
| B | bot on / off |
| G | smart split on / off |
| T | split only on players flagged as teaming |
| V | virus shots into big enemies on / off |
| X | manual smart split (only if it's safe and worth it) |
| L / U | tag a player as friend or enemy / pick a VIP (click them) |
| H | hide the banner |
| M | big intel map |
| Y | "watch me": you play, the bot records |
| **Bot off (you playing):** | |
| I / O / K | intel on screen / overlay / guardian |
| E (hold) | mine: shoot the virus nearest your cursor, every tick, walking onto it |
| A (hold) | shoot backward (with Shift: at the cursor) |
| Shift (hold) | lock your heading |
| 1-7, 0 | team orders: follow, protect, flank, orbit, farm, trade, carry, free |
| Tab | "feed me": every bot pours its mass into you |

With the SigMod client installed, toggles that clash with its keys move (B → N, G → J,
T → P, V → C, Y → F10); the banner shows where.

Settings can also be changed from the browser console: `megaBot.set('mineMinMass', 2500)`, `megaBot.cfg`,
`megaBot.reset()`.

## The Lab (Prism gadgets)

`.prism/gadgets/` holds panels for the Prism IDE:

- **Sigmally Lab**: the bridge every bot tab connects to (ws://127.0.0.1:47800). Live view of each bot, death
  replays, live settings, hot-swapping a new userscript into running tabs, and a local **arena** that runs the real
  server code with server bots, headless Mega Bots and aggressive hunter bots.
- **Arena viewer**: watch the arena live.
- **Tab status**: which tabs run which version.
- **Friends & foes**: shared friend / enemy / VIP lists.
- **Sim viewer**: run a test scene and play it back.

Set up once: `cd .prism/gadgets/sigmally-lab && npm install`.

## Simulator

`sim/frsim.js` runs a scene (`sim/rscenes.js`) on the real Sigmally server code, stepping it tick by tick as fast as
the computer can, with the bots' game connections in memory. `sim/frbatch.js` runs many seeds in parallel and
summarises them: everyone alive, team mass, travel speed, splits, wobble and frozen time.

```sh
git clone https://github.com/8y8x/sig-server      # the server code, next to the scripts
cd .prism/gadgets/sigmally-lab && npm install && cd ../../..
node sim/frbatch.js userscript/sigmally-mega-bot.user.js escape 8 25 8
#                   <userscript>                        <scene> <seeds> <seconds> <parallel>
```

`SIG_SERVER` and `LAB_DIR` point the sims somewhere else; `CFG='{"key":value}'` overrides settings for a run;
`TRACE=1` prints what each bot is doing.

Scenes include escape, rally (surrounded and split up), turnaround, boost kill, pair kill, mines, slip-through and
more; each has a description of the right move.

The sim's players are scripted and don't react the way people do. Live games decide; the sim is for checking that a
change doesn't break something else, comparing versions on the same seeds.

## Analysis tools

`tools/` reads what the Lab records (deaths with the frames before them, the team journal, the leaderboard):
`killstats.js` (how we get eaten), `livestats.js`, `topmass.js`, `splitdist.js`, `deathview.js`, `modes.js`. They read
Prism's gadget data folder, or `LAB_DATA`.

## How it thinks

[docs/GAME-MATHS.md](docs/GAME-MATHS.md) lists the server rules the bot is built on (eating, splitting, merging,
viruses, speed) and the edges that come out of them.
