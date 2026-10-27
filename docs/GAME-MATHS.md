# The game's maths

What the bot is built on, from the server code ([sig-server](https://github.com/8y8x/sig-server), a fork of OgarII)
and from measuring the live game. Where live differs from the code's defaults, live wins.

Sizes are radii; mass = size² / 100.

## Rules

| Rule | Numbers |
|---|---|
| **Eating** | A eats B when A's size > 1.14 × B's (about 1.3× the mass) **and** A's centre is within A − B/3 of B's centre. Touching isn't enough. |
| **Moving** | Every tick (40 ms) a cell moves min(speed, distance to the mouse) straight at the mouse: no momentum, it can stop dead or turn instantly. Speed ∝ size^−0.44, so half the size is about 1.36× faster. |
| **Splitting** | Every piece of size ≥ 128 halves its mass toward the mouse; the new piece starts 60 ahead with a 780 boost that loses 1/9 a tick (88% done in 0.75 s). At most 16 pieces. |
| **Merging** | A piece can merge after 30 s plus size/50 s (bigger pieces wait longer). Before that a player's pieces push each other apart until they just touch; for 13 ticks after a split they don't. |
| **Ejecting (W)** | Every piece ≥ 100 shoots one blob per press. Live accepts a press every tick. The blob comes out at the piece's edge within ±17° of the aim and flies about 840. No size rule to eat one. |
| **Viruses** | Pop a cell 1.14× their size, but only if its owner has a free piece slot. 5 hits split a virus: the new one flies 880 along the line of the last blob that hit. The live server has no virus limit. |
| **Border** | Cells are stopped half their size from the edge. |

## Edges that come out of them

1. **The lane between a player's pieces.** Being eaten needs the eater's centre on you, and a player's pieces are
   pushed apart until they just touch, so between two of them there is always a gap about 2/3 of your size wide where
   neither can eat you. Players have no momentum either, though: a lane only counts if it's wider than how far they
   can move toward you while you're in it.
2. **16 pieces can't split.** A player at the piece limit has no split reach and walks straight through viruses.
3. **Locked-apart pieces.** After a split or a pop, every piece stays separate for 30 s + size/50: a window to eat
   the small ones.
4. **Exact split reach.** 60 + the boost + the half's size − your size/3. Sit just outside it.
5. **Shooting is lossless and has no size rule.** Mass can go uphill to a bigger teammate by W; by splitting only to
   one at least 1.14× the half's size. (So two bots can't relay mass back and forth by splitting: once the receiver
   is the bigger one, its halves are too big for the other to eat.)
6. **Mining pays.** 5 hits into a virus (50 mass live) make a new 100-mass virus. Fire every tick.
7. **Shots spread.** ±17° is ±250 wide at full range; shoot from within ~400.
8. **Walls halve a way out, corners quarter it.**
9. **Teamers reach further.** A partner feeding mid-chase extends a split; live kills by teamers start ~200 further
   out than other players' (90th percentile).
