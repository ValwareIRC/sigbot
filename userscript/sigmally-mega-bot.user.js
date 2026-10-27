// ==UserScript==
// @name         Sigmally Mega Bot
// @namespace    https://github.com/ValwareIRC/sigbot
// @version      3.54.5
// @description  Autopilot for one.sigmally.com: farms, hunts, dodges, smart-splits (teamers first), flanks, shoots viruses, baits bots, intercepts teamers, multiboxes as a squad. Replaces "Sigmally Smart Split".
// @match        https://one.sigmally.com/*
// @match        https://*.sigmally.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ValwareIRC/sigbot/main/userscript/sigmally-mega-bot.user.js
// @downloadURL  https://raw.githubusercontent.com/ValwareIRC/sigbot/main/userscript/sigmally-mega-bot.user.js
// ==/UserScript==

(function () {
    'use strict';

    const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const VERSION = '3.54.5';
    // Hot swap: a newer copy injected with __megaHandoff set takes over the running one (its live game
    // connection and state) instead of bowing out, so updates need no reload (and no captcha).
    const prevBot = W.__megaHandoff ? W.megaBot : null;
    if (W.__sigMegaBot && !prevBot) return;
    W.__megaHandoff = false;
    W.__sigMegaBot = true;
    let retired = false;
    // the newest copy owns the page (3.36.3): in Firefox the script manager's copy runs in the extension's scope and
    // a hot-swapped copy can't call its retire(); switched off by hand instead, that old copy SAVED its switched-off
    // settings (HUD off, smart split off, bot off), and every reload brought them back. Copies that see another
    // owner act retired (no keys, no saving); the owner re-saves its settings if an old copy overwrites them.
    const MY_ID = VERSION + ':' + Math.random().toString(36).slice(2);
    W.__megaOwner = MY_ID;
    const notOwner = () => { try { return W.__megaOwner !== MY_ID; } catch (_) { return false; } };

    // ---------------------------------------------------------------- config
    // Game constants mirror sig-server's Settings.js (Sigmally's server).
    const GAME = {
        eatMult: 1.140175425099138,  // size ratio needed to eat (mass ratio 1.3)
        eatOverlapDiv: 3,            // must overlap until dist <= a - b/3
        minSplitSize: 128,
        minEjectSize: 100,
        maxCells: 16,                // sig-server default; the live server uses CFG.maxCells (learned upward)
        splitDistance: 60,
        splitBoost: 780,
        boostDecay: 8 / 9,           // boost moves d/9 per tick
        moveMult: 2.5,
        virusSize: 100,
        virusFeedTimes: 5,
        virusSplitBoost: 880,
        ejectSize: 40,
        ejectBoost: 880,             // ejected blob launch boost (ejectedCellBoost); coasts ~880 in all
        ejectLoss: 40,
        tickMs: 40,
    };

    const DEFAULTS = {
        bot: false,             // autopilot (B)
        autoSplit: true,        // smart split onto targets (G) — works with or without the bot
        record: false,          // "watch me": with the bot off, record what we see and what the player does for the Lab
        teamersOnly: false,     // only split onto players flagged as teaming (T)
        virusShots: true,       // bot feeds viruses into big enemies (V)
        escapeSplits: true,     // bot may split away from a threat it can't outrun
        autoRespawn: true,
        hud: true,

        // smart split
        maxSplits: 4,
        pairSplits: true,       // also try aiming between two targets side by side (eat both with one split)
        pairSplitGap: 500,      // ...targets this close (edge to edge)
        delayedDouble: true,    // also plan human-style double splits (second press a few ticks later: longer reach)
        simTicks: 20,
        minGainMass: 40,
        minGainFrac: 0.01,      // (arena 2026-10-20: 0.02 beat 0.04 by 58%, then 0.01 beat 0.02 by 29%)
        splitCostFrac: 0.025,
        lingerRisk: 0.12,       // cost of staying split near big players (x my mass x how likely they can eat a piece)
        riskWeight: 0.6,        // (arena 2026-10-20: 0.6 beat 1.0, team top 3331 vs 2589)
        splitThreatWeight: 0.65,
        reactTicks: 8,
        enemyReactTicks: 3,     // ticks before a big cell starts moving onto my flying piece
        targetReactTicks: 5,    // ticks before a target starts running from my pieces (punishes long splits)
        maxLockMs: 1000,        // longest we hold the aim on a split target
        blockUserInput: true,   // while the bot drives, drop the client's own split/eject (incl. SigMod macros)
        splitEatMargin: 12,     // split look-ahead: a piece must reach this far inside the eat line (was a duplicate "eatMargin" key, overwritten by 1.04 below - splits looked surer than they were)
        dangerMargin: 15,       // extra distance kept from bigger cells while pieces fly
        marginPerTick: 2.5,
        teamerBonus: 1.35,
        lockMs: 260,
        cooldownMs: 320,
        defaultRttMs: 90,
        ignoreSameClan: true,

        // autopilot
        dirs: 36,
        horizon: 15,            // ticks looked ahead for movement (600ms)
        step: 3,
        pursuit: 0.85,          // assume threats chase straight at me at this fraction of their speed
        dangerWeight: 3.0,
        splitDangerWeight: 0.8,
        foodDiscount: 0.94,
        foodFieldWeight: 1.0,   // smooth pull toward headings that pass near visible food
        switchMargin: 4,        // when safe, only change heading if the new one is this much better (+10%)
        dangerCommit: false,    // (arena 2026-10-20: on lost 2852 vs 3356 team top) under danger too: keep the way out we are on unless another is clearly safer (no jitter)
        dangerCommitRatio: 1.15, // ...the current way may have up to this much of the best one's danger
        dangerCommitFrac: 0.12,  // ...and score within this fraction of it
        exploreWeight: 4,       // pull toward a roaming waypoint
        stuckMs: 4000,          // no real progress for this long (and safe) -> head somewhere new
        preyWeight: 1.0,
        virusPopCost: 0.6,      // cost of popping on a virus (fraction of that cell's mass)
        virusMargin: 35,        // keep this much clear of the pop distance
        consolidate: true,      // when in many pieces and safe, feed them all into the biggest one
        consolidateMinCells: 4,
        consolidateDoneShare: 0.8, // stop once the biggest piece holds this share of my mass
        dashFeed: true,         // when chased with a clear path ahead, shoot mass forward: lighter = faster
        dashMinMass: 2000,      // ...but only once we're this big (below it, shooting costs more than it gains)
        dashMinMassFrac: 0.55,  // stop shooting once this much of my mass is still in my body
        dashMaxMs: 4000,
        dashCorridor: 1500,     // how far ahead the path must be clear of players/viruses/the wall
        flank: true,            // circle a big threat to eat the small bits trailing behind it
        flankClear: 220,        // gap kept outside the big part's eating range while circling
        flankMaxMs: 6000,
        flankMinGain: 100,
        collectWeight: 3,       // how much more the mass we shot ourselves is worth to go back for
        collectMs: 7000,        // give up collecting after this long
        hysteresis: 3,
        hysteresisMass: 0.03,   // heading inertia per unit of our mass
        fleeCommit: 0.15,       // escaping: keep the way we picked unless another is clearly (~30%) safer
        wallFleeWeight: 8,      // with threats around: heading toward a wall within wallFleeRange costs this x our mass (x nearness x straightness)
        wallFleeRange: 2500,
        escapeWallTime: 0.4,    // escape look-ahead: a second pinned at a wall counts like this many seconds in split range
        escapeWeight: 25,       // escape look-ahead: a way out that gets our biggest piece caught within ~9 s costs this x our mass (sooner = more)
        escapeSecs: 9,          // ...how far it looks
        longDangerWeight: 1.5,  // 3 s escape-route look-ahead (walls): how much a doomed route costs
        wallWeight: 1.2,        // walls: cost (x our mass) of a heading the border would slow to a stop, while threatened
        wallCalm: 0.15,         // ...and the share of that when nothing threatens us
        counterBonus: 0.8,      // eating an attacker: worth this share of the mass of ours it could have eaten
        fleePreyWeight: 1.5,    // escaping: a heading onto a player we can eat is worth this x its mass (x5 if it makes us safe)
        sidestepWeight: 0.05,   // running dead straight away from a player that could split onto us costs this (x danger weight x mass)
        headOnWeight: 2,        // a heading straight at a player that could eat us: cost (x danger weight x our mass) at 0 distance
        headOnRange: 1500,      // ...fading out by this edge distance
        teamPump: true,         // the pump kill: teammates pour their mass into the one beside a big player so it can eat it
        pumpReach: 2200,        // ...donors within this of the anchor count
        huntPull: 1.6,          // (arena: 1.6 beat 0.8, team top 3325 vs 2963) long-range hunt: pull toward the best thing in view our biggest piece can eat (x its mass)
        huntMinFrac: 0.03,      // ...worth at least this share of our mass (and 150)
        routePulls: true,       // pulls go round threats / virus clusters instead of being given up
        routeMaxDetour: 2.5,    // ...longest detour (x the straight way) worth taking
        friends: [],            // exact player names we team with: never targeted (set in the Friends & foes panel, or L in game)
        enemies: [],            // exact player names to go after: preferred targets, split on even in teamers-only mode, feared like killers
        trustFriends: false,
        vipName: '',            // a player (exact name, usually a friend) all bots work for...
        vipMode: '',            // ...'feed': every bot keeps diving into them | 'protect': guard them | '' off    // ...and don't run from friends either (only if they really are friendly)
        foeHuntMult: 2,         // ...an enemy on the list counts this much more as a hunt target
        foeGainMult: 1.5,       // ...and a split onto one is worth this much more
        teamOrders: true,
        carryDefault: true,     // carry mode: the captain's standing order (no key) - bots graze near it and feed it their mass
        carryBots: false,       // (3.40.0: off - bots without a captain fast-travel together instead of feeding one carrier)        // ...and with no captain on, the biggest bot is carried by the others
        carryFeedAt: 250,       // ...a feeder W-feeds the carrier once it has this much (dying with 200 costs little)
        carryKeep: 115,         // ...down to this (a cell under 100 can't shoot)
        carryLeash: 1600,       // ...grazing within this of the carrier's edge
        carryMinCarrier: 500,   // ...a bot carrier needs this much (else everyone grows on their own)
        feedMeMs: 6000,         // ...how long one Tab press keeps everyone pouring into the captain       // bots obey the captain (the tab you play in): number keys 1-5 / 0, Tab = feed me
        minimapMates: true,     // teammates on the minimap
        intelMap: true,         // every player any of us has seen (and remembers, 30 s) on the minimap; M = big map
        intelMemoryMs: 5000,    // ...unseen players fade out over this (then they're gone)
        mateGlow: true,         // the player's screen: a gold glow round every teammate cell, drawn into the game's frame
        intelInject: true,      // the player's screen: players teammates see / we remember, drawn by the game itself (I)
        overlay: true,          // the player's screen: threat rings, outlines, teamer tags, merge timers, split preview, way out (O)
        backShotEveryMs: 40,    // the player's A key: a backward shot every tick - live takes a press every tick (was 80 from the local server code's 2-tick rule). Extra
                                // presses in between are DROPPED, not queued (live test 2026-10-17). 80: ~11 shots/s, about standing still;
                                // 200: 5/s, still moving at ~45%. Each piece shoots its own blob per shot, so more pieces = more blobs.
        mineMacroEveryMs: 20,   // the player's hold-E mining macro: TWO W presses a tick - the server shoots at most once a tick and drops extras, so this never misses a tick (one a tick drifted against the server clock and lost shots)
        backShotHoldMs: 45,     // ...and the mouse stays on the shot point this long (a tick; 30 sent some the wrong way)
        guardian: false,        // the player's screen: the bot takes the wheel for a moment when the player heads into death (K)
        guardianMargin: 0.3,    // ...when the player's heading is this much (x our mass) more dangerous than the bot's best
        teamTrap: true,         // the trap: the planner works out a prey's escapes and posts teammates on them, then the driver closes in
        trapMinMass: 300,       // ...prey at least this big (and 4% of the hunter's mass); biggest first
        trapReach: 4500,        // ...teammates within this of the prey take part
        trapSetupMs: 6000,      // ...longest the driver waits for the posts to be taken before closing in anyway
        trapWeight: 1.1,        // ...pull to a post / hold point (x our mass)
        trapStrike: 650,        // ...a blocker leaves its post for the prey once it's this close to being eaten
        counterAttack: true,    // take over steering to eat a small attacker when our biggest piece leads
        counterPull: 2.5,       // ...and the pull toward such an attacker (x the mass of ours it threatens)
        escapeDangerFrac: 0.25, // consider an escape split when catch-by-moving danger exceeds this × my mass
        shieldTrustMaxRatio: 4, // a virus shields us only from players under this x our mass (and never from teamers)
        punishSplit: 0.35,      // a player whose split halves one of our pieces would eat: its split chance x this (max 0.45)
        punishRange: 900,       // ...that piece this close to it (edges)
        splitFloor: 0.08,       // least chance we assume any human splits onto us, however tiny we are
        cohesionWeight: 10,     // when split, prefer moves that keep pieces together (x3 once they can merge)
        virusMinValue: 40,
        respawnDelayMs: 1200,
        directRespawnMs: 4000,  // still dead this long after respawnDelayMs: send the spawn packet ourselves (hidden windows)
        stallMs: 15000,         // alive, then no game updates this long = the site's ~1 h session drop
        autoReload: true,       // ...and reload the page then (installed userscript only; injected copies ask instead)
        lab: true,              // talk to the "Sigmally Lab" gadget if it's running on this computer
        labUrl: 'ws://127.0.0.1:47800',

        maxCells: 16,           // piece limit on the live server (16, measured); a fresh tab used to assume 8 until it saw more
        virusFeast: false,      // (off 2026-10-20: live blobs are 10 mass and 16 pieces fire per press - shooting viruses at the limit is a net loss) at the piece limit viruses can't pop us
        virusFeastWeight: 2.5,  // ...how much more an edible virus counts than its raw mass in the look-ahead
        virusFeastPull: 0.4,    // ...pull toward edible viruses beyond the look-ahead (x virus mass)
        virusFarm: true,        // 2k+ mass and nobody around: eat viruses (popping is fine) and shoot them to make more
        nearMineFrac: 0.75,     // ...from this share of it (with viruses around) a bot keeps its mass to get there
        scavengeMaxDanger: 0.2, // scavenge fights while our danger is under this share of our mass
        teamEvenOut: false,     // calm: the bigger bot feeds the smaller until level (off: let mass concentrate)
        mineKeepFrac: 0.8,      // ...once mining, keep at it down to this share of mineMinMass
        mineKeepMass: 2000,     // ...keep mining down to this (the user: 2000 is the hard floor, 2300 the safe start)
        mineRange: 2600,        // ...viruses this far count as the field
        mineShotEveryTicks: 1,  // ...fire every tick while mining: the server's max (the user: 5 shots = 50 mass make a 100-mass virus, shooting is investment)
        virusOursMs: 4000,      // the user (2026-10-21): never eat a virus we are not shooting - one we pressed W at this recently counts
        slipThrough: true,      // walk the lane between a player's touching pieces to eat its small piece behind them (server eat rule)
        slipRange: 2600,        // ...prey this close (edge): far enough to consolidate on the way
        slipMinFrac: 0.02,      // ...worth at least this share of our mass
        slipMargin: 15,         // ...kept clear of every eat line on top of their movement in our lag
        slipMaxMs: 3000,
        slipBanMs: 20000,       // ...a player we found no safe lane past: left alone this long
        slipReactTicks: 0,      // ...ticks we assume a human takes to turn onto us in the lane. 0 = worst case: live (2026-10-25) a third of real deaths were slips the target turned on; 8 still lost them in the sim once the lane took 30+ ticks        // (was 5000: lingering in a lane let them react)
        slipFeed: true,         // ...our other pieces shoot into the lead on the way when most blobs would land in it
        lockSwarmMult: 1.5,     // pack: a piece locked apart for 10 s+ more (exact server merge timer) is worth this much more to chase
        harvestTicks: 750,      // pack: after a player pops, swarm its pieces while they are locked apart (was 3 s)
        maxPieceHuntMult: 1.3,  // pack: players at 16 pieces can't split away - their pieces are worth this much more
        pinWallDist: 800,       // pack: prey this close to a wall is pinned (the border holds cells at half their size)
        wallHuntMult: 1.35,     // ...worth this much more at a wall
        cornerHuntMult: 1.8,    // ...and this in a corner
        reachBait: true,        // pack: park just outside a giant's exact split reach with a teammate behind us that eats its halves
        reachBaitGap: 120,      // ...this far outside the reach
        reachBaitSpeed: 1.25,   // ...only when we walk at least this much faster than it
        reachBaitMs: 12000,
        reachBaitCooldownMs: 20000,
        lockstepWall: true,     // pack: run level beside a teammate that is chasing something, eat lines overlapping
        lockstepWeight: 0.8,    // ...pull (x the prey's mass)
        crossfire: true,        // pack: join a teammate's virus shot on the same line
        mineAimMin: 400,        // mining: only viruses at least this clear of every cell of ours and of our mass centre (the user: it aimed at ones too close)
        mineFlowPast: 300,      // ...aim this far past the virus once a piece is at it: keep moving (the user: stopping beside it got us eaten)
        mineParkMs: 1000,
        mineSweepIdleMs: 3000,  // ...sweeping our missed blobs: give up after this long without collecting one       // ...at the target this long without eating it: drop it and move on
        splitMaxEdge: 900,      // smart split: no target further than this (edge to edge) unless it stands still (live: 50% landed beyond)
        escapeSplitBigRatio: 2.5, // escape split only if a player this many times our piece's mass overlaps it, or its split is flying at us
        mineMinMass: 2300,      // the user: viruses are food only from this mass up (then mine relentlessly); below, avoid them
        virusFarmMinMass: 800,  // (arena 2026-10-20: 800 beat 1500 - team top 3918 vs 3276)
        virusFarmPieceMargin: 500,   // (arena: 500 beat 900, team top 2735 vs 2331) ...off while something that could eat one of our pieces is this close (edge)
        virusFarmBigMargin: 700,     // (arena: 700 beat 1200, team top 3753 vs 2612) ...off while a bigger player is this close (edge)
        virusFarmSplitMargin: 300,   // ...off while we're within someone's split reach plus this
        virusFarmMateDist: 4000,
        virusFarmWallGap: 1500,      // ...off within this of the border (16 pieces against a wall can't get away)     // ...off while the teammate is farther than this (regroup first)
        consolidateThreatExtra: 0,   // self-feeding stops when a threat is within its reach plus this
        virusFarmShoot: true,
        virusFarmStyle: 'shoot',
        virusFarmAimPast: 300,
        virusMemoryMs: 45000,
        virusCollectMinMass: 300,    // ...collecting viruses close by (or ours) keeps the farm on down to this mass
        virusFarmShootMinMass: 1000, // ...only shoot into viruses with at least this much mass (below: just collect)        // ...viruses we shot out stay targets this long, even out of view
        virusOverlapBonus: 1500,
        virusShotBonus: 3000,        // ...a virus lined up with a big player beyond it (our shots launch a virus into it)     // ...a virus touching other viruses: this much distance worth of bonus per neighbour
        virusClusterMinMass: 900,    // ...farm a cluster of overlapping viruses from this mass (relaxed margins)
        virusFarmFireRange: 700,     // ...only shoot once one of our pieces is this close to the virus (edge)
        dare: 1,                // 0 = the old caution, 1 = bold: opportunities (food, prey, viruses) keep pulling until danger is
                                //   (0.15 + 0.35 x dare) of our mass, and popped at the mines we stay while nothing can reach us
        mineCommitSecs: 2,      // ...popped at the mines: only leave for a player that can touch one of our pieces within this long,
        mineEscapeMult: 0.3,    // ...meanwhile the 9 s escape look-ahead counts this much (16 pieces always look "exposed")
        virusFarmKeepMs: 15000,      // ...once mining, keep going (relaxed margins) for this long after it was last on
        mineLaneBeyond: 1000,        // ...the lane we tell the team about runs this far past the virus (new viruses launch there)
        mineLaneWidth: 220,          // ...a teammate this close to the lane (edge) is in the way       // ...aim this far beyond the virus on the same line (full speed through it)
        virusFarmDenseR: 800,        // ...next target: count the viruses within this of each candidate
        virusFarmDenseWeight: 600,   // ...each virus packed around a candidate is worth this much distance     // 'shoot': run the lane firing into the viruses and eat them (the user's split-mining); 'eat': eat existing ones first
        virusFarmShootBelow: 3,      // ...but only shoot while fewer than this many viruses are within 1500 (else just eat them)   // ...shooting continuously at the virus we're moving into; next target within 45 deg ahead
        virusFeastShoot: false, // ...and shoot into them (measured: +132 mass vs +876 just eating them; off until the technique is better). Off: each 5th hit wipes 80 mass to make a 100-mass
                                //    virus 880 away (+20 if you catch it); in sims eating alone gained more
        virusFeastMinMass: 2300,
        virusFeastRange: 450,   // ...only fire when most pieces are this close (edge to virus) so blobs land

        // masters: anyone whose name contains one of these gets all our mass (never attacked, never fled)
        serveMaster: true,
        masters: [],

        // squad (multiboxing): our own players in other tabs / connections are one team
        multibox: true,
        squad: 'me',            // players running the bot with the same squad name team up
        squadFeedAt: 300,       // a support player starts shooting its mass into the leader at this mass...
        squadKeepMass: 150,     // ...and stops when it's down to this; then farms beside the leader and goes again
        squadRange: 600,        // support: stays this close to the leader (edge to edge), farming alongside it
        squadCollectWeight: 4,  // a teammate's blobs are worth this much more than other food (go and eat the feed)
        teamRespawnNear: true,  // spawned far from a teammate (and still small): leave and respawn until we land near
        teamRespawnRange: 3500,
        teamRescueMaxMass: 1e9, // (the user 2026-10-22: no size limit - was 350) jump into a teammate whole to save it only when we are this small (both should survive)
        teamSplitEscape: true,  // chased, with a teammate in split reach away from the chaser: split into it
        teamRelay: false,       // the old DNA relay (replaced by pairMove)
        fastTravel: false,       // the user's fast travel: one breaks up forward, the other eats 90% of it splitting, swap (see stepFastTravel)
        ftThreatGap: 1500,      // ...off while anything that could eat one of our pieces is this close (edge)
        ftMaxApart: 2200,       // ...the two must be this close (centres) to start / keep going
        ftAimAhead: 1500,       // ...breaking up: split toward this far ahead on the course
        ftWaitAhead: 400,       // ...broken up: keep drifting this far ahead (slowly, the partner comes through)
        ftWaitMs: 6000,         // ...a stage that takes longer than this ends (no deadlock)
        ftEatMs: 6000,
        ftClear: 220,           // ...our kept pieces step this far out of reach of the eater's pieces (edge)
        ftMode: 'cannon',       // fast travel: 'cannon' = the relay cannon (split forward, shoot everything into the next bot);    // fast travel: the rebuilt simple loop ('snake' = the old turn machine)
        virusShootMaxPieces: 16, // feed viruses in any number of pieces (was 2: "each press costs 10 mass PER piece" - backwards, shooting viruses is investment)
        virusShotEveryTicks: 1, // ...a press every tick, the server max (was 4)
        virusMaxPresses: 100000, // ...no limit per virus (was 14: feed it until it is eaten)
        virusCap: false,        // live has NO virus cap: never pause feeding because a virus "didn't take" our shots (a miss isn't a cap)
        virusCapPauseMs: 30000, // a virus that doesn't grow from our shots: the map is at its virus cap - no feeding for this long
        ffSplitAim: 1200,       // ...the loaded bot splits toward a point this far ahead (pieces bunch there)
        ffShootRange: 840,      // ...pieces shoot once half of them are within this of the receiver (blobs fly ~840)
        ffRecvAhead: 350,       // ...the receiver stands this far beyond the front piece while they shoot
        ffSideOff: 900,         // ...and this far beside the lane while they split
        ffRunAhead: 2600,       // ...the other bots run this far ahead of the loaded one
        ffKeep: 1,              // ...the unloaded bot keeps this many pieces (stays alive)
        ffMinLoad: 1000,        // ...and a bot needs this much to be loaded (below, pieces barely shoot - walk together)
        ffPieceMin: 220,        // ...but only into pieces of at least this mass (they shoot down to 100)
        ffPieces: 16,           // ...the runner splits up to this many pieces
        ffSplitMs: 250,         // ...one split every this long
        ffFeedMs: 2000,         // ...then shoots into the catcher for at most this long
        ffCatchBehind: 250,     // ...the catcher keeps this far behind the runner's rearmost piece (edge to edge)
        ftMinTeamMass: 1200,    // ...only when the pair has at least this much (smaller pieces just feed strangers)
        lfWaitGap: 400,         // ...the splitter turns back when its eater has fallen this far behind its rearmost piece
        lfDangerGap: 700,       // ...stop when a stranger that could eat one of our pieces is this close (or in its split reach)
        ftSplitMs: 300,         // ...one split every this often (the user: "A splits once per 0.25 s")
        ftTailSplits: 3,        // ...the lead splits this many more times into the follower's tail, then hands over
        ftHunt: false,          // (off 2026-10-20: it snaked toward a target in pieces smaller than the target - the user watched them get eaten)           // ...fast travel hunts: up to a target, one pours into the other, it kills
        ftHuntRatio: 2.6,       // ...a target the team outweighs this much (after the pour, the striker's half eats it)
        ftHuntMin: 150,         // ...and at least this big (and 4% of the team)
        ftHuntRange: 3500,      // ...within this of the pair
        ftHuntPourAt: 1100,     // ...the pour starts when one of us is this close to it (edge)
        ftCourseDist: 5000,     // ...the pair heads for a point this far ahead...
        ftCourseMs: 15000,       // ...re-picked this often (or near a wall)
        ftCurveSplits: 3,       // ...snake: splits curving round the partner's head per turn
        ftFeedSplits: 1,        // ...then this many splitting our tail into its head
        ftCurveGap: 150,
        ftFeedWaitMs: 1500,
        feedGap: 300,           // feeding a teammate by shooting: back off (no shot) inside this of swallowing it     // ...W-feeding the partner's head before a feed split gives up after this        // ...how far outside the partner's head the curve runs (tight)
        ftKeepShare: 0.45,
        ftBalanceLow: 0.35,     // ...a partner below this share of the pair gets fed by the bigger one (the loop needs mass on both sides)       // ...never eat the partner below this share of the pair
        ftFeedUpTo: 0.55,
        ftFeedMaxAfter: 0.65,   // ...a feed split only if afterwards the partner holds at most this share       // ...no feed split while the partner already holds this share
        ftEatTo: 0.6,           // ...the follower eats only until it holds this share of the pair (the lead keeps enough to eat its tail)      // ...the follower never eats the lead below this share of the pair
        ftDipClear: 350,        // ...dipping our small pieces back into the partner: our head stays this far clear of its head
        ftKeepPieces: 2,        // ...the eater leaves the partner this many pieces (~90% eaten after a 16-piece break)
        ftEatSplitMax: 4,       // ...splits into the partner's pieces only while it has this few (else sweeps them up)
        pairMove: false,        // (off 2026-10-20: split-to-travel can't work under the 1.14x rule - see fast travel) two bots move as one, like the best pairs on the server: the heavier splits into the lighter, ahead
        pairGap: 2200,          // ...further apart than this (centre to centre): close up first
        pairSplitEveryMs: 450,  // ...the body splits into the runner at most this often
        pairBehindOk: 1,      // ...the smaller one may be this many of its radii behind the bigger one's centre when it splits
        pairSweep: 1.6,         // ...and this many split lengths from where the pieces land (it sweeps them up)
        pairKeepClear: 160,     // ...our cells that could eat the partner's main cell keep at least this much clear of its eat line
        pairMaxK: 2,            // ...at most this many splits per handoff (more leaves the giver too small for the next one)
        mateGuard: true,        // bots never steer a cell that could eat a teammate's main cell into it (unless it's diving / feeding in)
        mateGuardClear: 220,    // ...keeping at least this much clear of the eat line
        observe: true,          // every bot logs the big players it sees (3/s) for the Lab's study of the server's teams
        observeMinMass: 400,
        pairStrike: false,      // ...pour and strike (off: live 22:16 it lost 662 mass a try to enemies for 125 killed)
        pairStrikeRange: 2200,  // ...targets within this of the pair
        pairStrikeMs: 4000,     // ...give up a strike after this long
        pairGroupGap: 2500,     // ...a pair further than this from our other bots heads for them
        pairGiveMs: 2500,       // ...after a handoff split we keep handing pieces over this long (live: at 2.5 s only 28% got eaten)
        pairCatchDanger: 0.5,   // ...pieces handed to us are still caught under this much danger (x our mass); live, 24% of handoffs were dropped at 0.25
        pairMinMass: 500,      // ...no handoff splits below this pair mass (small pieces in crowds just feed strangers)
        pairClearR: 900,       // ...nor with anyone who could eat a piece within this of its flight
        pairEase: 0.4,          // ...the bigger one's speed (share of full) while the smaller one is behind it
        pairRunAhead: 450,      // ...the smaller one keeps this far ahead of the bigger one's centre, beside it
        pairTurn: 0.015,         // ...the pair's course turns at most this much a tick (radians)
        pairDangerMax: 0.25,    // ...not while something threatens this share of our mass (the escape logic decides then)
        pairMinBody: 250,       // ...no pair mode below this mass (tiny bots crossing crowds to close up were the wobblers)
        pairOffMs: 1500,        // ...and once danger pushed pair mode out, it stays out this long
        relayRounds: 8,
        relayHandoffMs: 600,    // after our splits, wait this long before handing the turn over (so the partner sees our pieces)
        relaySplitGapMs: 160,
        relayAdvanceGapMs: 450,
        relayWeave: true,       // DNA as a weave (the user's demo): both split on a rhythm, paths swinging in opposite phase
        weavePeriod: 3.2,       // ...seconds for one full swing (one weave)
        weaveAmp: 55,           // ...how far across (toward the partner's side) a weave split goes, from the travel direction (degrees)
        weaveGap: 0.4,          // ...seconds between one bot's splits
        weaveOffset: 0.6,       // ...the second bot starts this long after the first
        weaveLoops: 6,          // ...weaves in a row before taking a break (x weavePeriod = how long the weave runs)
        weaveCrossLead: -1,     // ...no tail in reach: drift toward this far ahead of the partner (paths cross)
        weaveEatRange: 1800,    // ...lean into partner tail pieces this close
        weaveEatCone: -0.3,     // ...within this cone of the travel direction (cosine; -0.5 = up to 120 deg off)
        weaveTurn: 0.6,         // ...seconds per turn: one splits across, then the other
        weaveSplitsPerTurn: 2,  // ...splits across per turn (0.18 s apart) // the stepper's forward splits: one about every half second along the curve
        relayTravelMinMass: 350, // DNA travel only once both are this big (smaller cells move faster on their own)
        helpDangerRatio: 1.3,   // go to help a teammate unless our own danger is this much worse than its
        crown: true,            // the team together beats leaderboard #1 (as last seen): everyone merges into our biggest
        crownMargin: 1.1,       // ...by this much
        crownMinMass: 4000,     // ...and the team has at least this much
        crownSeenMs: 180000,    // ...#1's mass seen by one of us within this
        crownRange: 5000,       // ...counting teammates this close to the biggest
        crownMs: 25000,         // ...the merge-up gets this long
        boostMate: true,        // split into a teammate's piece that is in an even fight, so it wins
        boostMateFightGap: 250, // ...the stranger this close to its piece (edges)
        boostMateGapMs: 700,    // ...at most one boost split per this long
        snackBreak: true,       // a stranger we can eat close by: fast travel / pairing step aside so we eat it
        snackDist: 500,         // ...within this of one of our pieces (edge)
        snackStillDist: 1800,   // ...or this, if it is standing still (frozen / disconnected)
        ownBlobPull: 1.2,       // pull toward our own / teammates' shot mass lying around within 2500 (x its mass)
        stillPreyWeight: 1.5,   // pull toward a still player we can eat (per mass of it)
        teamRally: true,        // split up near a teammate with a stranger close: become one cell (biggest piece = anchor)
        rallyRange: 1800,       // ...teammate this close (centres, plus our biggest pieces)
        rallyThreatDist: 1100,  // ...a stranger that can eat one of our pieces within this (edge)
        rallyMergeable: 0.6,    // ...only if one side can actually swallow this share of the other (1.14x size rule)
        rallyHoldMs: 2000,      // ...keep the roles at least this long (no flip-flopping)
        rallyMaxMs: 30000,      // (was 3000; the user: no limit - 30 s is the merge time) ...but a rally lasts at most this long
        rallyCooldownMs: 0,     // (was 5000) ...and doesn't start again for this long after it ends
        teamPool: true,        // split up and under pressure near a teammate: eat each other's small pieces into the big ones
        teamHelpWeight: 0.8,
        teamRescueWeight: 0.5,  // go to a teammate in danger when we're the safer one (x my mass, up to x1.6)
        teamTogetherWeight: 0.2,
        teamBrain: true,
        pullMemoryMs: 1500,     // a team pull that just switched off keeps pulling, fading over this long
        teamMeetWeight: 0.6,    // calm and apart: pull to meet the teammate (x my mass)
        teamMeetFirst: true,    // don't start virus farming while the teammate is alive and far away
        teamSplitBoost: true,   // ask the teammate for the mass that lets our split half eat a fleeing prey
        bigSplitGuardMass: 2000, // (kept 2026-10-22: off, the sim rally team fell 5916 -> 2224 - big bots split near hunters and lost pieces) from this mass: no split attacks with a player a third our size within ~2 split lengths
        teamJournal: true,      // log every team action and how it turned out (to the Lab: lab_teamlog)
        moveGate: true,         // (kept on 2026-10-22: off, the sim lost 7 of 8 escapes - these moves measured live at -207..-465 mass a try) attacking team moves (pump kill, kill with cover, boost asks, pour+strike) pause while they lose mass
        moveRetryMs: 600000,    // ...and a paused one gets one retry this often, to re-measure
        scavenge: true,         // wait just outside two fighting big players' reach for their spilled pieces...
        scavengeGap: 500,       // ...this far beyond the longer of their split reaches
        scavengeWeight: 0.4,    // ...a gentle pull (x our mass)
        tickBudgetMs: 12,       // decision time per tick (average) above which the expensive planners slow down
        quietWeight: 15,        // wandering avoids the parts of the map where giants were seen lately (any of us)...
        quietMemoryMs: 90000,   // ...fading over this long
        spawnCautionMs: 5000,   // this long after spawning, every player that could split onto us is assumed to
        pourAhead: true,        // a cell other pieces of its team are flying into counts at its size after they land
        killerMemoryMs: 600000, // anyone who killed one of us this recently (shared by all bots)...
        killerSplitFloor: 0,    // (was 0.85: fear, removed 2026-10-22) ...is assumed to split at us at least this likely
        killerReachExtra: 0,    // (was 400) ...with this much more reach
        enemyMaxSplits: 4,      // how many chained splits we assume a player can throw at us (reach grows ~660 per split)
        giantReachExtra: 0,     // (was 500: fear, removed 2026-10-22) extra split reach for players more than twice our size
        relayTravel: true,      // DNA relay is how the team travels when it's calm (along the plan's heading)
        eatMargin: 1.04,        // only go for cells clearly over the eating line (1.14x size): barely-edible ones end in hovering        // one plan for the whole team (heading, formation, who eats whose pieces, kills worth finishing) // stay together: pull to the spot beside the teammate (x my mass, full at 1000 apart)    // a teammate asks for mass: go to it (x my mass; x1.5 when it's urgent)
        teamFleeWeight: 0.5,    // under pressure, the smaller follows the bigger one's escape line (x my mass)
        teamBalanceBelow: 0.25, // calm: feed the smaller one when it has under this share of the team's mass (up to ~a third)
        teamBalanceAt: 2.2,     // calm: once one of us has this many times the other's mass, it feeds the other until we're level
        squadNearWeight: 3,     // support: pull to stay within feeding range of the leader
        squadRunWeight: 0.6,    // support, when chased: pull toward a mate that can eat the chaser (x my mass)
        squadDefendWeight: 1.5, // leader: pull onto whatever is chasing a mate (x herdWeight x its mass)
        squadHerdWeight: 1.2,   // support: get behind the leader's prey so it runs into the leader

        // other players' tricks
        revengeBonus: 1.4,      // value multiplier on players who killed us twice or betrayed us
        baitSplitChance: 0.7,   // someone bigger shooting mass toward us is baiting: assume they'll split
        baitMs: 10000,
        teamThreatWeight: 0.6,
        teamerReachExtra: 250,  // (live 2026-10-25: removing it raised teamer split-kills from ~32% to ~41% of deaths; their kills start ~220 further out than others at p90 - 1000 was too much) extra split reach assumed for teamers: fed mid-chase and chained splits (live: 1 in 10 split pieces flies 1,200+ beyond normal)  // a teaming pair counts as one bigger threat (the feeder can top up the chaser)
        crowdWeight: 0,         // (was 0.12: "leaving the crowd" fought the team pulls - live 2026-10-25 it was in 80 of 149 wobbles; sim: squeeze 7/8 vs 6/8, rally +9%) drift away from where several bigger players gather
        phases: true,           // size-phase game plans (small: survive; big: don't risk it on small gains)

        // boss moves
        virusShield: 0.35,      // #1 danger multiplier when a virus that would pop the chaser sits between us
        punishBonus: 1.3,       // #2/#5/#7 value multiplier on pieces of a player inside their merge lock
        dodgeAfterTicks: 2,
        sidestep: true,         // split danger by the line a split flies along (aimed where we were), not by distance
        splitReact: 6,          // ...ticks between where they see us and the split leaving (reaction + network)
        splitFlight: 7,         // ...ticks the split takes to get to us
        splitMissSigma: 90,     // ...how fast the danger falls off past the split's eating radius     // #2 a flying split piece only starts steering after its boost is mostly spent
        feedKill: true,         // #3 pump mass into a piece that's just short of eating a target
        feedKillMaxNeed: 160,   // ...if it needs at most this much mass
        herdWeight: 0.3,        // #4 pin prey against walls: open-side approach, then drive in (x prey mass)
        mergeSoonTicks: 75,     // #5 treat a split player as its merged size this long before it can merge
        streamWeight: 6,        // #6 pull onto someone else's feeding line, per blob in flight
        harvestWeight: 0.4,     // (was 0.05 for 3 s: the swarm after a pop - the user's pack hunting)    // #7 pull toward a freshly popped player's pieces (x edible mass)
        botBait: true,          // #8 lure bots into split range with ejected mass
        bailout: true,          // #9 a doomed piece shoots its mass into a safe piece of mine
        oneMind: true,          // close together: the biggest leads, the rest follow its heading (no tug-of-war)
        oneMindRange: 1500,     // ...this close (edge to edge)
        oneMindWeight: 1.2,     // ...how hard followers follow
        pullSmoothMs: 0,        // team pulls fade in / out over this (0 = off: 500 cost fast-travel pairs 2-3 of 24 in the sim)
        virusTryMs: 3000,       // a virus our eater piece hasn't reached in this long: leave it
        virusBanMs: 8000,       // ...for this long
        ghostMs: 8000,          // #10 remember enemies that walked out of view this long
        ghostFullMs: 3000,      // ...at full weight for this long (fading after): no left-right-left at the screen edge
        ghostWeight: 0.6,
        threatNear: 1200,       // a bigger player counts as a threat only this close (its edge) or within its split reach

        keys: {
            toggleBot: 'KeyB', toggleAuto: 'KeyG', toggleTeamers: 'KeyT',
            manual: 'KeyX', tagPlayer: 'KeyL', vipPlayer: 'KeyU', toggleHud: 'KeyH', toggleVirus: 'KeyV', watchMe: 'KeyY', bigMap: 'KeyM', intel: 'KeyI', overlay: 'KeyO', guardian: 'KeyK', mineMacro: 'KeyE',
        },
    };

    // Only real preferences are kept between sessions: the toggles, keys, masters, squad, what the bot has
    // learned about the server (maxCells), and settings deliberately changed (Lab / megaBot.set). Everything
    // else follows DEFAULTS, so tuning in new versions reaches everyone. (Old versions saved the whole
    // object, freezing old defaults: such saves keep only the preferences.)
    const STORE = 'sigMegaBot.cfg';
    const PREF_KEYS = ['bot', 'autoSplit', 'teamersOnly', 'virusShots', 'escapeSplits', 'autoRespawn', 'hud', 'lab', 'labUrl',
        'maxCells', 'serveMaster', 'masters', 'multibox', 'squad', 'autoReload', 'keys'];
    const customKeys = new Set();
    const keyMoves = [];
    const CFG = (() => {
        try {
            const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
            const legacy = !saved._custom && 'dirs' in saved && 'horizon' in saved; // a full dump from an old version
            for (const k of saved._custom || []) customKeys.add(k);
            const out = { ...DEFAULTS };
            for (const k of Object.keys(saved)) {
                if (k === '_custom' || !(k in DEFAULTS)) continue;
                if (legacy && !PREF_KEYS.includes(k)) continue;
                out[k] = saved[k];
                if (!legacy && !PREF_KEYS.includes(k)) customKeys.add(k);
            }
            out.keys = { ...DEFAULTS.keys, ...(saved.keys || {}) };
            return out;
        } catch (_) { return { ...DEFAULTS, keys: { ...DEFAULTS.keys } }; }
    })();
    GAME.maxCells = CFG.maxCells;
    // SigMod's keys win (3.37.1): with SigMod installed, its macro keys (b respawn, g quad split, t line, v menu, y location...)
    // also hit our toggles - quad-splitting with G flipped smart split, respawning with B turned the bot on in the
    // captain's tab, T turned "teamers only" on. Our toggles on a SigMod key move to a free one (for this page only).
    try {
        const sm = JSON.parse(localStorage.getItem('SigModClient-settings') || 'null');
        const used = new Set();
        const walk = o => { if (!o || typeof o !== 'object') return; for (const v of Object.values(o)) { if (typeof v === 'string' && v.length === 1) used.add('Key' + v.toUpperCase()); else walk(v); } };
        if (sm && sm.macros) walk(sm.macros.keys);
        const alt = { toggleBot: ['KeyN', 'F6'], toggleAuto: ['KeyJ', 'F7'], toggleTeamers: ['KeyP', 'F8'], toggleVirus: ['KeyC', 'F9'], watchMe: ['F10'], mineMacro: ['KeyE', 'Backquote'], manual: ['KeyX', 'F4'],
            toggleHud: ['KeyH', 'F2'], tagPlayer: ['KeyL', 'F3'], vipPlayer: ['KeyU', 'F11'] };
        const taken = () => new Set(Object.values(CFG.keys));
        for (const [k, opts] of Object.entries(alt)) {
            if (!used.has(CFG.keys[k] || '')) continue;
            const t = taken(), pickKey = opts.find(o => !used.has(o) && !t.has(o));
            if (pickKey) { CFG.keys[k] = pickKey; keyMoves.push(k + ' -> ' + pickKey.replace('Key', '')); }
        }
    } catch (_) { }
    // the banner always starts visible (3.36.2): a saved "hidden" kept coming back in the captain's tab after
    // reloads and nobody knew why. H still hides it - until the page reloads.
    CFG.hud = true;
    const saveCfg = () => {
        if (retired || notOwner()) return;
        const out = { _custom: [...customKeys] };
        for (const k of PREF_KEYS.concat(out._custom)) if (k in CFG) out[k] = CFG[k];
        try { localStorage.setItem(STORE, JSON.stringify(out)); } catch (_) { }
    };
    setInterval(() => {
        if (retired || notOwner()) return;
        try {
            const st = JSON.parse(localStorage.getItem(STORE) || '{}');
            if (['bot', 'autoSplit', 'teamersOnly', 'virusShots', 'lab'].some(k => k in st && st[k] !== CFG[k])) saveCfg();
        } catch (_) { }
    }, 2000);
    // friends / enemies: keep them here, and (from a key press) tell the Lab, which hands them to every other tab
    function setVip(name, mode, announce) {
        CFG.vipName = mode ? name : ''; CFG.vipMode = mode || '';
        customKeys.add('vipName'); customKeys.add('vipMode'); saveCfg();
        if (announce) try { lab.send({ type: 'lists', friends: CFG.friends, enemies: CFG.enemies, vipName: CFG.vipName, vipMode: CFG.vipMode }); } catch (_) { }
    }
    function setLists(friends, enemies, announce) {
        CFG.friends = [...new Set(friends.filter(x => typeof x === 'string' && x))];
        CFG.enemies = [...new Set(enemies.filter(x => typeof x === 'string' && x && !CFG.friends.includes(x)))];
        customKeys.add('friends'); customKeys.add('enemies'); saveCfg();
        if (announce) try { lab.send({ type: 'lists', friends: CFG.friends, enemies: CFG.enemies, vipName: CFG.vipName, vipMode: CFG.vipMode }); } catch (_) { }
    }
    // console / Lab: change a setting and keep it
    const setCfg = (k, v) => { if (!(k in DEFAULTS)) return false; CFG[k] = v; if (!PREF_KEYS.includes(k)) customKeys.add(k); if (k === 'maxCells') GAME.maxCells = v; saveCfg(); return true; };
    const resetCfg = () => { localStorage.removeItem(STORE); location.reload(); };

    // ---------------------------------------------------------------- helpers
    const now = () => performance.now();
    const moveSpeed = s => 88 * Math.pow(s, -0.4396754) * GAME.moveMult;
    const mass = s => s * s / 100;
    const canEat = (a, b) => a > b * GAME.eatMult;
    const isStill = (e, tick) => e.player !== false && tick - (e.movedAt ?? tick) > 25;   // hasn't moved for a second
    const SQRT2 = Math.SQRT2;
    const R = GAME.boostDecay;
    const UTF8 = new TextDecoder();
    const isFast = (vx, vy, s) => Math.hypot(vx, vy) > moveSpeed(s) * 1.5 + 3;
    // soft penalty: 1 at the edge of the danger zone, growing linearly deeper in (so backing out always helps), decaying outside
    const zone = (gap, sigma) => gap <= 0 ? 1 - gap / sigma : Math.exp(-gap / sigma);

    // How far (centre to centre) an enemy of size es can split-kill my cell of size ms.
    // `delayed`: humans do the second split a moment later, from the half that's already flying, so
    // it carries on another ~split boost (about 1,600 units in all, not the ~900 of an instant double).
    function splitReach(es, ms, ownerCells, maxK = 2, delayed = false) {
        let best = -Infinity, s = es, n = ownerCells || 1;
        for (let k = 1; k <= maxK; k++) {
            if (s < GAME.minSplitSize || n >= GAME.maxCells) break;
            s /= SQRT2; n *= 2;
            if (!canEat(s, ms)) break;
            // chained presses: every split after the first goes on from the flying front piece (~0.85 boost more)
            const travel = k === 1 || !delayed ? GAME.splitDistance * k + GAME.splitBoost * 0.95
                : k * GAME.splitDistance + GAME.splitBoost * 0.95 + (k - 1) * GAME.splitBoost * 0.85;
            best = travel + s - ms / GAME.eatOverlapDiv;
        }
        return best;
    }

    // Server bots (sig-server PlayerBot, names from Settings.worldPlayerBotNames). Their split rule is
    // exact: only with <= 2 cells, only a single split, and only when prey.size * 2 > their size.
    const BOT_NAMES = new Set(['Valeriy', 'Mtch', 'Messi', 'Michael', 'LadyInRed', 'Slava', 'Migel', 'Mik', 'Moon',
        'Ignasio', 'Cos', 'Bred', 'Krishtianu', 'Varpat', 'Monica', 'Loli', 'Corat', 'Sun', 'ChaCha', 'Voron', 'Baby', 'Mimi']);
    // Settings.worldPlayerBotSkins: every bot gets one of these (and never a clan)
    const BOT_SKINS = new Set(['1%Alexander', '1%Celia', '1%Chip', '1%Dale', '1%Hardscrabble', '1%Harley', '1%Rocky',
        '1%Lenny', '1%Chet', '1%Proctor', '1%Roz', '1%Art', '1%Bile', '1%Boo', '1%Brandywine', '1%Carlton', '1%Derek',
        '1%Fungus', '1%George']);
    // Names alone can be copied by humans, so anyone bot-named who does something PlayerBot's code never
    // does (shoots mass; has 5+ pieces without having hit a virus) is remembered as human.
    const provenHuman = new Set();
    const isBot = e => BOT_NAMES.has(e.name) && !e.clan && !provenHuman.has(e.key) && (!e.skin || BOT_SKINS.has(e.skin));

    // How likely is enemy cell e to actually split onto my cell of size ms?
    // A split exposes half their cell for whatever they catch, so the bigger they are relative to me,
    // the less it's worth it: nobody sane splits a 10k cell to catch a 200.
    function splitLikelihood(e, ms, ownerCells, S) {
        if (isBot(e)) return ownerCells <= 2 && ms * 2 > e.s && !botSplitBlocked(e, S) ? 1 : 0;
        const ratio = (ms * ms) / (e.s * e.s);                    // my mass / theirs
        // what we know of them: split at us before, killed us, betrayed us -> likelier
        const ag = book.aggression(e.name);
        const floor = Math.min(0.6, (isTeamer(e.key) ? 0.3 : CFG.splitFloor) * ag); // teamers take silly risks
        // real players split for surprisingly little: ~10% of their mass is plenty (seen in recorded deaths)
        let lk = Math.max(floor, Math.min(1, ag * (ratio - 0.015) / (0.1 - 0.015)));
        if (recentKiller(e.name) || isFoe(e)) lk = Math.max(lk, CFG.killerSplitFloor);
        // just spawned (3.36.0): many deaths come at ~100 mass seconds after spawning - assume everyone splits
        if (S && S.conn && now() - (S.conn.spawnedAt || -1e9) < CFG.spawnCautionMs) lk = Math.max(lk, CFG.killerSplitFloor);
        // W-bait: someone bigger shooting mass toward us wants us to come closer, to split on us
        if (S && S.conn && (S.conn.baiters.get(e.key) || 0) > now()) lk = Math.max(lk, CFG.baitSplitChance);
        // punished: one of our pieces (or a teammate's) close by eats their split half - a real player doesn't throw a
        // split into that (live: a 5800 bot in 16 pieces stopped mining and ran from a 2900 whose halves its two big
        // pieces would have eaten)
        if (S && CFG.punishSplit > 0) {
            const half = e.s / SQRT2;
            const ours = S.mine.concat(S.mates || []);
            if (ours.some(c => canEat(c.s, half * 1.02) && Math.hypot(c.x - e.x, c.y - e.y) < e.s + c.s + CFG.punishRange))
                lk = Math.min(lk * CFG.punishSplit, 0.45);
        }
        return lk;
    }
    // split reach that respects bots only ever single-splitting
    // (a teamer's partner can top it up mid-chase, so its split reaches further than its size says)
    const enemySplitReach = (e, ms, oc) => {
        if (isBot(e)) return splitReach(e.s, ms, oc, 1);
        // 3.36.0: giants triple and quad split. Of 371 recorded split-kills by players 3x+ our size, 119 started
        // beyond the double-split reach, only 40 beyond the quad-split reach (CFG.enemyMaxSplits)
        let r = splitReach(e.s, ms, oc, CFG.enemyMaxSplits, true);
        const r2 = splitReach(e.s, ms, oc, 2, true);
        // giants: their double-split pieces keep chasing after landing (a 14k player caught us from ~2600 out)
        if (r > -Infinity && e.s > ms * 2) r = Math.max(r, r2 + CFG.giantReachExtra);
        if (r > -Infinity && (recentKiller(e.name) || isFoe(e))) r += CFG.killerReachExtra;
        return r > -Infinity && isTeamer(e.key) ? r + CFG.teamerReachExtra : r;
    };

    // #8: PlayerBot.update() sets splitkillObstacleNearby (and then refuses to split at all) when any
    // cell it can see is bigger than its biggest cell, or any virus is inside its split-kill range.
    // So: a bot next to a virus, or with any bigger cell around (us included), is split-proof.
    function botSplitBlocked(e, S) {
        if (!S) return false;
        if (!S.botBlock) S.botBlock = new Map();
        if (S.botBlock.has(e.key)) return S.botBlock.get(e.key);
        let bs = 0, bx = e.x, by = e.y;
        for (const c of S.enemies) if (c.key === e.key && c.s > bs) { bs = c.s; bx = c.x; by = c.y; }
        let blocked = false;
        for (const c of S.enemies.concat(S.mine)) {
            if (c.key === e.key || !canEat(c.s, bs)) continue;
            if (Math.abs(c.x - bx) < 1800 && Math.abs(c.y - by) < 1100) { blocked = true; break; } // ~ its view
        }
        if (!blocked) for (const v of S.viruses) {
            // PlayerBot.canSplitkill(cell.size, virus.size, d): reach = max(size/sqrt2, splitBoost)
            if (canEat(bs / SQRT2, v.s) && Math.hypot(v.x - bx, v.y - by) - Math.max(bs / SQRT2, GAME.splitBoost) <= bs - v.s / GAME.eatOverlapDiv) { blocked = true; break; }
        }
        S.botBlock.set(e.key, blocked);
        return blocked;
    }

    // #2/#5/#7: a player who split or popped within the merge window can't merge their pieces back
    const MERGE_LOCK_TICKS = 25 * 60;   // own pieces merge after ~60 s here
    function ownerLocked(S, key) {
        const o = S.conn.owners.get(key);
        return !!o && S.tick - o.splitTick < MERGE_LOCK_TICKS;
    }
    const lockBonus = (S, key, e) => {
        if (e && e.key !== undefined) { const left = pieceLockLeft(S, e); return left > 0 ? CFG.punishBonus * (left > 250 ? CFG.lockSwarmMult : 1) : 1; }
        return ownerLocked(S, key) ? CFG.punishBonus : 1;
    };

    // Masters: matched anywhere in the name, case-sensitively ('YOM', not 'yom'). Anyone can type these names.
    const isMaster = c => CFG.serveMaster && !!c.name && CFG.masters.some(n => n && c.name.includes(n));

    // ---------------------------------------------------------------- teamer tracking
    // Owners are identified by name + colour (the protocol carries no owner id).
    const teamers = new Map();
    const HALF_LIFE = 45000;
    function flagTeamer(key, name, mateKey, amount) {
        if (!key) return;
        let e = teamers.get(key);
        const t = now();
        if (!e) teamers.set(key, e = { score: 0, t, name, mates: new Set() });
        e.score = e.score * Math.pow(0.5, (t - e.t) / HALF_LIFE) + amount;
        e.t = t;
        e.name = name || e.name;
        if (mateKey) e.mates.add(mateKey);
    }
    function teamerScore(key) {
        const e = teamers.get(key);
        return e ? e.score * Math.pow(0.5, (now() - e.t) / HALF_LIFE) : 0;
    }
    const isTeamer = key => teamerScore(key) >= 1;
    const clanMemory = new Map(); // clan tag -> { keys (owners seen wearing it), t }

    // ---------------------------------------------------------------- player book
    // What we've seen each player do, by name (colours change every spawn, names mostly don't), kept
    // across sessions: how often they split, split *at us*, double split, kill us, team, feed us, and
    // whether they turned on us after feeding. Server bots are left out (their rules are exact).
    const BOOK_STORE = 'sigMegaBot.players';
    const book = {
        data: (() => { try { return JSON.parse(localStorage.getItem(BOOK_STORE) || '{}'); } catch (_) { return {}; } })(),
        dirty: false, savedAt: 0,
        get(name, create) {
            if (!name || BOT_NAMES.has(name)) return null;
            let r = this.data[name];
            if (!r && create) r = this.data[name] = { splits: 0, atUs: 0, doubles: 0, kills: 0, team: 0, fedUs: 0, betrayals: 0, seen: 0, last: 0 };
            return r || null;
        },
        note(name, field, amount = 1) {
            const r = this.get(name, true);
            if (!r) return;
            r[field] = (r[field] || 0) + amount;
            r.last = Date.now();
            this.dirty = true;
        },
        save() {
            if (!this.dirty || now() - this.savedAt < 20000) return;
            this.savedAt = now(); this.dirty = false;
            // keep the 400 most recently met
            const names = Object.keys(this.data);
            if (names.length > 400) {
                names.sort((a, b) => this.data[b].last - this.data[a].last);
                for (const n of names.slice(400)) delete this.data[n];
            }
            try { localStorage.setItem(BOOK_STORE, JSON.stringify(this.data)); } catch (_) { }
        },
        // how much more (or less) likely than a typical player they are to split onto us
        aggression(name) {
            const r = this.get(name);
            if (!r) return 1;
            return Math.min(2.5, 1 + 0.25 * Math.min(4, r.atUs) + 0.4 * Math.min(3, r.kills) + 0.5 * Math.min(2, r.betrayals));
        },
        hostile(name) { const r = this.get(name); return !!r && (r.betrayals > 0 || r.kills >= 2); },
    };

    // tagged players' positions from SigMod (3.37.3): nick -> { x, y, mass, t }; ours (from the captain's tab, which runs
    // SigMod logged in to a clan / tag) plus what teammates pass on in their squad messages. Lets the bots find the VIP
    // anywhere on the map, not only when one of us sees her.
    const tagPos = new Map(), tagScore = new Map();
    function readSigMod(data) {
        try {
            const txt = typeof data === 'string' ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(new Uint8Array(data)) : null;
            if (!txt || txt[0] !== '{') return;
            const o = JSON.parse(txt), c = o && o.content;
            if (!c) return;
            if (o.type === 'score-tag' && c.id) tagScore.set(c.id, +c.score || 0);
            else if (o.type === 'minimap-data' && c.nick && isFinite(c.x) && isFinite(c.y)) {
                // SigMod's positions are on the server our game tab is on
                const g = [...conns.values()].find(k => k.ready && !k.isSigMod);
                tagPos.set(c.nick, { x: +c.x, y: +c.y, mass: tagScore.get(c.sid) || 0, t: Date.now(), server: g ? serverOf(g.ws) : '' });
            }
        } catch (_) { }
    }
    const freshTag = (name, srv) => { const p = tagPos.get(name); return p && Date.now() - p.t < 3000 && (!p.server || p.server === srv) ? p : null; };

    // recent killers (3.36.0), shared by the whole squad: anyone who killed one of us in the last CFG.killerMemoryMs
    // gets a sure split (likelihood floor) and CFG.killerReachExtra more reach. Live: one player killed us 6 times
    // in 3 minutes - each bot learned it separately, if at all.
    const killers = new Map();  // name -> Date.now() of the last kill
    const noteKiller = (name, t) => { if (name && !BOT_NAMES.has(name) && (killers.get(name) || 0) < t) killers.set(name, t); };
    const recentKiller = name => !!name && Date.now() - (killers.get(name) || 0) < CFG.killerMemoryMs;

    // hidden tabs (3.36.0): browsers slow setTimeout to ~1 s there (measured live: a 50 ms timer took 700-1000 ms in
    // the hidden Chrome and Opera bots). Message-channel tasks aren't slowed: short waits go through them instead.
    function fastTimeout(fn, ms) {
        if (typeof document === 'undefined' || !document.hidden || typeof MessageChannel === 'undefined') return setTimeout(fn, ms);
        const until = performance.now() + ms, ch = new MessageChannel();
        ch.port1.onmessage = () => { if (performance.now() >= until) { ch.port1.close(); fn(); } else ch.port2.postMessage(0); };
        ch.port2.postMessage(0);
    }

    // ---------------------------------------------------------------- allies, baiters
    // Someone feeding us is offering to team. We take the mass and never split on them, but they stay a
    // threat like anyone else (plenty of "teamers" are baiting). Betray us (split at us, eat a piece of
    // ours) and they're hostile for good: revenge bonus on them from then on.
    const allies = new Map();   // name -> { fed, t }
    const ALLY_MASS = 64;       // fed us at least this much (4 blobs) in the last minute
    function allyFed(name, m) {
        if (!name) return;
        const a = allies.get(name) || { fed: 0, t: now() };
        a.fed = a.fed * Math.pow(0.5, (now() - a.t) / 60000) + m; a.t = now();
        if (a.fed >= ALLY_MASS && (!allies.get(name) || allies.get(name).fed < ALLY_MASS) && !book.hostile(name)) hud.flash(`${name} is feeding us: treating them as a friend (still watching them)`);
        allies.set(name, a);
        book.note(name, 'fedUs', m);
    }
    // the player's lists (3.37.0): exact names, shared by every tab through the Lab
    const onList = (list, name) => !!name && Array.isArray(list) && list.includes(name);
    const isFriend = e => !!e && (onList(CFG.friends, e.name) || (!!CFG.vipMode && !!e.name && e.name === CFG.vipName));   // the VIP is a friend too
    const isFoe = e => !!e && onList(CFG.enemies, e.name);
    const isAlly = e => { if (isFriend(e)) return true; const a = allies.get(e.name); return !!a && !book.hostile(e.name) && a.fed * Math.pow(0.5, (now() - a.t) / 60000) >= ALLY_MASS; };
    function betrayed(name, how) {
        if (!name) return;
        const wasAlly = allies.has(name);
        allies.delete(name);
        if (wasAlly) { book.note(name, 'betrayals'); hud.flash(`${name} ${how} after feeding us: hostile now`); }
    }
    const revenge = e => (book.hostile(e.name) ? CFG.revengeBonus : 1);

    // Bait cell: a small cell hanging around a bigger teammate (or a baiter) that could eat our split
    // halves. Splitting on it hands the teammate our pieces.
    function isBaitCell(S, e) {
        const tm = teamers.get(e.key);
        const t = now();
        for (const o of S.enemies) {
            if (o.key === e.key || !canEat(o.s, S.maxMine / SQRT2) || Math.hypot(o.x - e.x, o.y - e.y) > o.s + 1400) continue;
            if ((tm && tm.mates.has(o.key) && teamerScore(e.key) >= 0.5) || (S.conn.baiters.get(o.key) || 0) > t) return true;
            // two known teamers side by side are almost always partners, seen feeding each other or not
            if (isTeamer(e.key) && isTeamer(o.key)) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- squad (multiboxing)
    // Our own players working as one team: several game connections in this tab (multibox), other tabs
    // of this browser (BroadcastChannel), or other processes (relayed by the Lab gadget on this computer).
    // ~12 times a second each member tells the others which cells are its own, how big it is, what it
    // wants (mass, a hunt, to be swallowed) and the enemies and viruses it can see. Mates are never
    // targets or threats; the biggest leads, the others feed it, run to it when chased, and herd prey.
    const SQUAD_STALE_MS = 1500;
    const serverOf = ws => String((ws && ws.url) || '').split('?')[0];
    const squad = {
        members: new Map(),   // member id -> its latest message (+ rx = when it arrived)
        knownNames: new Map(), // teammate name -> { t, server }: kept a minute, so a late message never turns a teammate into a stranger
        bc: null,
        init() {
            if (this.bc !== null) return;
            this.bc = false;
            try {
                if (typeof BroadcastChannel !== 'undefined') {
                    this.bc = new BroadcastChannel('sigMegaSquad');
                    this.bc.onmessage = ev => this.receive(ev.data);
                    if (this.bc.unref) this.bc.unref(); // Node (arena bots, tests): don't keep the process alive
                }
            } catch (_) { this.bc = false; }
        },
        receive(m) {
            if (retired || !CFG.multibox || !m || m.type !== 'squad' || m.squad !== CFG.squad) return;
            for (const c of conns.values()) if (c.memberId === m.from) return; // our own, echoed back
            m.rx = now();
            if (m.name) this.knownNames.set(m.name, { t: m.rx, server: m.server });
            if (Array.isArray(m.teamers)) for (const [k, sc, mates] of m.teamers) {
                const have = teamerScore(k);
                if (sc > have + 0.05) flagTeamer(k, k.slice(0, k.lastIndexOf('|')), null, sc - have);
                const e = teamers.get(k); if (e && Array.isArray(mates)) for (const mk of mates) e.mates.add(mk);
            }
            if (Array.isArray(m.killers)) for (const [n, kt] of m.killers) noteKiller(n, kt);
            if (Array.isArray(m.seenTop)) for (const [n, ms, st] of m.seenTop) { const cur = nameSeen.get(n); if (!cur || cur.t < st) nameSeen.set(n, { m: ms, t: st }); }
            if (Array.isArray(m.tagPos)) for (const [n, x, y, ms, pt, sv] of m.tagPos) { const cur = tagPos.get(n); if (!cur || cur.t < pt) tagPos.set(n, { x, y, mass: ms, t: pt, server: sv || m.server }); }
            this.members.set(m.from, m);
        },
        publish(conn) {
            if (!CFG.multibox) return;
            this.init();
            const mine = conn.myCells();
            const t = now();
            // alive: ~12 a second; dead: twice a second, so the others know we're out
            if (t - (conn.squadSent || 0) < (mine.length ? 75 : 500)) return;
            conn.squadSent = t;
            const seen = [];
            if (mine.length) for (const c of conn.cells.values()) {
                if (conn.mine.has(c.id) || !(c.player || c.virus) || c.remote) continue;
                seen.push([c.id, Math.round(c.x), Math.round(c.y), Math.round(c.s), Math.round(c.vx * 10), Math.round(c.vy * 10),
                    c.virus ? '' : c.name, c.color, c.virus ? 1 : 0]);
                if (seen.length >= 90) break;
            }
            let ms = 0;
            for (const c of mine) ms += mass(c.s);
            const msg = { type: 'squad', squad: CFG.squad, from: conn.memberId, server: serverOf(conn.ws), t: Date.now(),
                name: mine.length ? (conn.myName = mine[0].name) : (conn.myName || ''), key: mine.length ? mine[0].key : '', color: conn.myColor,
                cells: mine.map(c => [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.s)]), mass: Math.round(ms),
                danger: Math.round(conn.danger), dir: isNaN(conn.botDir) ? null : +conn.botDir.toFixed(3), intent: { need: conn.squadNeed || null, hunt: conn.squadHunt || null, merge: !!conn.squadMerge, rally: !!(conn.rally && !conn.rally.anchor), pool: !!conn.teamPool, feeding: !!conn.squadFeeding, feedingTo: conn.feedingTo || null }, seen };
            msg.relay = conn.relay || null;
            msg.tagPos = [...tagPos.entries()].filter(([, p]) => Date.now() - p.t < 2000).slice(0, 30).map(([n, p]) => [n, Math.round(p.x), Math.round(p.y), Math.round(p.mass), p.t, p.server || '']);
            msg.killers = [...killers.entries()].filter(([, kt]) => Date.now() - kt < CFG.killerMemoryMs).slice(-20);
            msg.isBot = !!CFG.bot;
            msg.ftHunt = conn.ftHuntT || 0;
            msg.crown = conn.crown && conn.crown.until > Date.now() ? { anchor: conn.crown.anchor, target: conn.crown.target, need: conn.crown.need, until: conn.crown.until } : null;
            // what we've seen of the leaderboard's top names (for the crown: one bot's sighting counts for the team)
            if (conn.lb && conn.lb.names) msg.seenTop = conn.lb.names.slice(0, 3).map(n => { const v = nameSeen.get(n); return v ? [n, v.m, v.t] : null; }).filter(Boolean);
            msg.ft = conn.ft ? { role: conn.ft.role || null, phase: conn.ft.phase || null, recv: conn.ft.recv || 0, cycleAt: conn.ft.cycleAt || 0, doneAt: conn.ft.doneAt || 0, goal: conn.ft.goal ? [Math.round(conn.ft.goal.x), Math.round(conn.ft.goal.y)] : null, active: !!conn.ft.active, idx: conn.ft.idx || 0, len: (conn.ft.plan || []).length, first: !!conn.ft.first, turn: conn.ft.turn || 0, dir: isFinite(conn.ftDir) ? +conn.ftDir.toFixed(3) : null } : null;
            msg.pair = conn.pair ? { role: conn.pair.role, with: conn.pair.with, strike: conn.pair.strike || null, keep: conn.pair.keep || null } : null;
            msg.busy = conn.virusFarming ? 'farm' : conn.relay && conn.relay.active ? 'relay' : null;
            // with no order key pressed the captain's standing order is 'carry' (CFG.carryDefault): the bots grow it
            msg.order = !CFG.bot && mine.length && (captain.mode || CFG.carryDefault || now() - captain.feedAt < CFG.feedMeMs)
                ? { mode: captain.mode || (CFG.carryDefault ? 'carry' : 'free'), feedAt: captain.feedWall, aim: [Math.round(conn.mouse.x), Math.round(conn.mouse.y)] } : null;
            if (!mine.length && captain.mode && captain.mode !== 'free') { captain.mode = null; }   // orders end when the captain dies
            msg.plan = conn.teamPlan || null;
            msg.mineLane = conn.mineLane && now() - conn.mineLane.at < 600 ? conn.mineLane.seg : null;
            msg.pump = conn.pump && now() - conn.pump.at < 700 ? conn.pump.plan : null;
            msg.vshot = conn.vshot ? { v: conn.vshot.vId, t: conn.vshot.tId } : null;   // crossfire: teammates join our virus shot
            msg.hunt = conn.huntMsg && now() - conn.huntMsg.at < 700 ? conn.huntMsg.h : null;   // lockstep wall: what we chase
            msg.wp = conn.waypoint ? [Math.round(conn.waypoint.x), Math.round(conn.waypoint.y)] : null;
            msg.mining = !!conn.mining;
            msg.relayPhase = conn.relay && conn.relay.active && conn.relay.stepper === conn.memberId ? (conn.relaySplits < (conn.relayK || 1) ? 'split' : 'park') : null;
            if (t - (conn.teamersSent || 0) > 2000) {
                conn.teamersSent = t;
                msg.teamers = [...teamers.entries()].map(([k, e]) => [k, Math.round(teamerScore(k) * 100) / 100, [...e.mates]]).filter(r => r[1] >= 0.5).slice(0, 40);
            }
            this.members.set(conn.memberId, { ...msg, rx: t });             // the other connections in this tab
            if (this.bc) try { this.bc.postMessage(msg); } catch (_) { }      // other tabs
            lab.send(msg);                                                    // other processes, via the Lab
        },
        // names of every teammate on this server, alive or (re)spawning: right after a respawn a teammate has a
        // new colour and new cell ids, and for a moment only its name tells us it's ours
        mateNames(conn, myName) {
            const t = now(), out = new Set(), srv = serverOf(conn.ws);
            for (const [n, k] of this.knownNames) if (t - k.t < 60000 && k.server === srv && n !== myName) out.add(n);
            for (const [id, m] of this.members) {
                if (t - m.rx > SQUAD_STALE_MS || id === conn.memberId || m.server !== srv || !m.name || m.name === myName) continue;
                if ((conn.squadMismatch.get(id) || 0) > t) continue;
                out.add(m.name);
            }
            return out;
        },
        // living mates of this connection on the same server
        mates(conn) {
            const t = now(), out = [], srv = serverOf(conn.ws);
            for (const [id, m] of this.members) {
                if (t - m.rx > SQUAD_STALE_MS) { this.members.delete(id); continue; }
                if (id === conn.memberId || !m.cells.length || m.server !== srv) continue;
                if ((conn.squadMismatch.get(id) || 0) > t) continue;            // provably in another world
                out.push(m);
            }
            return out;
        },
    };

    // ---------------------------------------------------------------- connection state
    const conns = new Map();
    let pendingTakeover = -1e9; // when we last reconnected a game we couldn't read (see maybeRespawn)
    const seenSockets = new Set();
    let activeConn = null;
    const NativeWS = W.WebSocket;
    // the browser's own send, even when an older copy of the bot has already wrapped it
    function pristineSend() {
        try {
            const f = document.createElement('iframe');
            f.style.display = 'none';
            (document.body || document.documentElement).appendChild(f);
            return f.contentWindow.WebSocket.prototype.send;
        } catch (_) { return NativeWS.prototype.send; }
    }
    const nativeSend = W.__megaNativeSend || (prevBot ? pristineSend() : NativeWS.prototype.send);
    W.__megaNativeSend = nativeSend;

    class Conn {
        constructor(ws) {
            this.ws = ws;
            this.ready = false;
            this.shuf = new Uint8Array(256);   // logical opcode -> wire byte
            this.unshuf = new Uint8Array(256); // wire byte -> logical opcode
            this.cells = new Map();
            this.mine = new Set();
            this.tick = 0;
            this.border = null;
            this.mouse = { x: 0, y: 0 };       // last mouse position the game client sent
            this.lockUntil = 0;
            this.lockTargetId = 0;
            this.lockOvershoot = 0;
            this.lockAim = null;
            this.lastAction = -Infinity;
            this.pendingSplitAt = 0;
            this.rtt = CFG.defaultRttMs;
            this.lastPlan = null;
            // autopilot state
            this.botAim = null;
            this.botDir = NaN;
            this.mode = '';
            this.danger = 0;
            this.vshot = null;
            this.waypoint = null;
            this.exploreUntil = 0;
            this.trail = [];
            this.vshotBan = new Map(); // virus id -> time until we may try it again
            this.consol = null;
            this.consolCooldown = 0;
            this.dash = null;            // forward-feeding run
            this.dashEjects = new Set(); // ids of mass we shot during a dash, until we've eaten it back
            this.collectUntil = 0;
            this.dashCooldown = 0;
            this.dirHist = [];           // recent headings, to know we're running straight
            this.flank = null;           // circling a big cell to eat the bits behind it
            this.flankBan = new Map();   // owner key -> time until we may try flanking them again
            this.owners = new Map();     // owner key -> { count, splitTick, popTick, popAt }
            this.ghosts = new Map();     // enemy cells that walked out of view: id -> { cell, t, tick }
            this.viewBox = null;         // roughly what the server lets us see this tick
            this.foodGrid = new Map();   // remembered pellet density per 1000x1000 square
            this.feedKill = null;
            this.bait = null;
            this.baitBan = new Map();    // bot key -> time until we may bait it again
            this.bailout = null;
            this.feast = null;           // shooting viruses while at the piece limit
            this.myColor = -1;
            this.everAlive = false;
            this.diedAt = 0;
            this.lastRespawn = 0;
            // squad
            this.memberId = Math.random().toString(36).slice(2, 10);
            this.squadMismatch = new Map(); // member id -> until when we ignore it (its cells don't match our world)
            this.squadLeadId = '';
            this.squadRole = 'solo';
            this.squadNeed = null;          // leader: mass it asks the squad for
            this.squadHunt = null;          // leader: the prey it's going for
            this.squadMerge = false;        // support: about to be eaten, diving into the leader instead
            this.squadFeeding = false;
            this.mateKeys = new Set();
            this.mateIds = new Set();
            this.baiters = new Map();       // owner key -> until when we treat them as baiting us
            this.baiterColors = new Set();
            ws.addEventListener('message', ev => {
                try { this.onMessage(ev.data); } catch (err) { console.error('[MegaBot]', err); }
            });
            ws.addEventListener('close', ev => {
                conns.delete(ws); if (activeConn === this) activeConn = null;
                // why the game connection ended (for the Lab: the server kicking us looks like a crash)
                (W.__megaCloses = W.__megaCloses || []).push({ t: Date.now(), code: ev && ev.code, reason: ev && ev.reason, clean: ev && ev.wasClean, url: ws.url, alive: this.mine.size, tick: this.tick, mode: this.mode });
                try { lab.event('game connection closed: code ' + (ev && ev.code) + (ev && ev.reason ? ' (' + ev.reason + ')' : '') + ', ' + this.mine.size + ' pieces alive, mode ' + this.mode); } catch (e) { }
            });
        }

        raw(buf) { if (this.ws.readyState === 1) nativeSend.call(this.ws, buf); }
        sendMouse(x, y) {
            if (CFG.bot && CFG.mateGuard && CFG.multibox) { const g = this.mateGuard(x, y); x = g.x; y = g.y; }
            this.lastMouse = { x, y };
            const dv = new DataView(new ArrayBuffer(13));
            dv.setUint8(0, this.shuf[16]);
            dv.setInt32(1, Math.round(x), true);
            dv.setInt32(5, Math.round(y), true);
            this.raw(dv.buffer);
        }
        // never roll over a teammate's main cell by accident (live: 1 in 3 bot deaths was a teammate swallowing a
        // freshly respawned or 'beside' bot). A teammate that's diving / feeding / pumping / handing pieces to us is let in.
        mateGuard(x, y) {
            const mine = this.myCells(); if (!mine.length) return { x, y };
            const t = now();
            for (const m of this.vipGuard ? squad.mates(this).concat([this.vipGuard]) : squad.mates(this)) {
                if (!m.cells || !m.cells.length || t - m.rx > 1000) continue;
                if (m.intent && (m.intent.merge || m.intent.feeding)) continue;
                const giving = !!(m.pump || (m.pair && m.pair.role === 'giver'));
                const live = m.cells.map(r => { const c = this.cells.get(r[0]); return c ? { id: r[0], x: c.x, y: c.y, s: c.s } : { id: r[0], x: r[1], y: r[2], s: r[3] }; });
                const top = live.reduce((a, c) => (c.s > a.s ? c : a));
                for (const k of live) {
                    if (giving ? !(m.pair && m.pair.keep === k.id) : k.s < top.s * 0.95) continue;
                    for (const c of mine) {
                        if (!canEat(c.s, k.s)) continue;
                        const dx = c.x - k.x, dy = c.y - k.y, d = Math.hypot(dx, dy) || 1;
                        const edge = c.s - k.s / 3 + CFG.mateGuardClear;
                        if (d >= edge) continue;
                        // heading in (the mouse is on its side of us): steer off it, keeping the sideways part of the move
                        const ax = x - c.x, ay = y - c.y, ux = dx / d, uy = dy / d, toward = -(ax * ux + ay * uy);
                        if (toward <= 0 && d > edge - 120) continue;
                        this.mateGuarded = (this.mateGuarded || 0) + 1;
                        const sx = ax + ux * Math.max(0, toward), sy = ay + uy * Math.max(0, toward);
                        return { x: c.x + sx + ux * 400, y: c.y + sy + uy * 400 };
                    }
                }
            }
            // victim side (3.36.0): live, 196 of 500 deaths were our bots swallowed by a teammate - mostly a small bot
            // walking into a big teammate (collecting its pieces, closing up, beside it). Unless we mean to go in
            // (feeding / diving / pouring / giving), never steer one of our cells into a teammate cell that can eat it.
            if (!this.meansToFeed()) {
                for (const m of squad.mates(this)) {
                    if (!m.cells || !m.cells.length || t - m.rx > 1000) continue;
                    for (const r of m.cells) {
                        const lc = this.cells.get(r[0]); const k = lc ? { x: lc.x, y: lc.y, s: lc.s } : { x: r[1], y: r[2], s: r[3] };
                        for (const c of mine) {
                            if (!canEat(k.s, c.s)) continue;
                            const dx = c.x - k.x, dy = c.y - k.y, d = Math.hypot(dx, dy) || 1;
                            const edge = k.s - c.s / 3 + CFG.mateGuardClear;
                            if (d >= edge) continue;
                            const ax = x - c.x, ay = y - c.y, ux = dx / d, uy = dy / d, toward = -(ax * ux + ay * uy);
                            if (toward <= 0 && d > edge - 120) continue;
                            this.mateGuarded = (this.mateGuarded || 0) + 1; this.mateDodged = (this.mateDodged || 0) + 1;
                            const sx = ax + ux * Math.max(0, toward), sy = ay + uy * Math.max(0, toward);
                            return { x: c.x + sx + ux * 400, y: c.y + sy + uy * 400 };
                        }
                    }
                }
            }
            return { x, y };
        }
        // are we on purpose going into a teammate right now (feeding, diving, pouring, handing pieces, captain feed)?
        meansToFeed() {
            const t = now();
            if (this.pump || this.squadDiving || this.squadDumping || this.feedingTo || this.squadFeeding || this.squadMerge) return true;
            if (this.pair && this.pair.role === 'giver') return true;
            if (this.ft && this.ft.active && (this.ft.plan || [])[this.ft.idx] === 'feed') return true;   // fast travel: our feed split only
            if (this.ftPoured && now() - this.ftPoured < 1500) return true;                                // hunting: just poured in
            if (this.diveHold && this.diveHold.until > t) return true;
            return /feed|dive|pour|pump|giv|hand|split.?in|suicide|merg|dump|boost/i.test(this.mode || '');
        }
        sendSplit(n) {
            const b = new Uint8Array([this.shuf[17]]);
            for (let i = 0; i < n; i++) this.raw(b);
            this.pendingSplitAt = now();
        }
        sendEject() { this.raw(new Uint8Array([this.shuf[21]])); }

        // Loaded after the game connected: we missed the greeting that carries the opcode table. The server
        // makes that table once at startup and gives every connection the same one, so open our own short
        // connection to the same server, read it there, and close it. (Checked against the client's next
        // mouse packet; our own cells are only announced when created, so we drive from the next spawn.)
        learnShuffle() {
            this.probing = true;
            let p;
            try { p = new NativeWS(this.ws.url); } catch (_) { this.probing = false; return; }
            p.binaryType = 'arraybuffer';
            let finished = false;
            const done = () => { if (finished) return; finished = true; try { p.close(); } catch (_) { } };
            p.addEventListener('open', () => { try { nativeSend.call(p, new TextEncoder().encode('SIG 0.0.1 ')); } catch (_) { done(); } });
            p.addEventListener('message', ev => {
                if (!(ev.data instanceof ArrayBuffer)) return;
                const dv = new DataView(ev.data);
                let o = 0, txt = '';
                while (o < dv.byteLength) { const c = dv.getUint8(o++); if (!c) break; txt += String.fromCharCode(c); }
                if (txt.startsWith('SIG') && dv.byteLength >= o + 256 && !this.ready) {
                    for (let i = 0; i < 256; i++) { this.shuf[i] = dv.getUint8(o + i); this.unshuf[this.shuf[i]] = i; }
                    this.ready = true;
                    this.midJoin = true;
                    hud.flash('joined a running game: read the protocol from the server, taking over from the next spawn');
                }
                done();
            });
            p.addEventListener('error', () => { this.probing = false; done(); });
            setTimeout(done, 8000);
        }

        // Spawned far from a living teammate: leave the world and spawn again (the same packet the game sent),
        // until we land close enough to regroup quickly. Only while small and unthreatened (little to lose), and
        // only below the server's 5,500 score limit for leaving a world.
        rerollNearTeam(S) {
            if (!CFG.teamRespawnNear || !S.squad.length || !this.spawnPacket || this.ws.readyState !== 1) return false;
            if (S.myMass > 300 || (this.rerolls || 0) >= 20 || now() - (this.lastReroll || 0) < 1500) return false;
            const others = S.squad.filter(m => m.cells.length);
            if (!others.length) return false;
            const near = others.some(m => { const c = memberCenter(m); return Math.hypot(c.x - S.center.x, c.y - S.center.y) < CFG.teamRespawnRange; });
            if (near || this.danger > 0.05 * S.myMass + 1 || threatNear(S, 300)) return false;
            this.lastReroll = now();
            this.rerolls = (this.rerolls || 0) + 1;
            const msg = new TextEncoder().encode('/leaveworld');
            const chat = new Uint8Array(msg.length + 3);
            chat[0] = this.shuf[0x63]; chat.set(msg, 2);
            this.raw(chat);
            const pkt = this.spawnPacket;
            this.raw(pkt);                                   // back into the matchmaker
            fastTimeout(() => { if (!retired) this.raw(pkt); }, 60); // then spawn (after a tick)
            this.mode = `team: respawning nearer the team (try ${this.rerolls})`;
            hud.flash(`team: spawned far from ${others[0].name || 'the team'} — respawning closer (try ${this.rerolls})`);
            return true;
        }

        // returns false to drop the client's packet
        onOutgoing(data) {
            if (!this.ready) {
                // a fresh connection starts with the client's "SIG" greeting: the server's answer brings the table
                if (!this.sawHello && !this.probing) {
                    const u = typeof data === 'string' ? null : data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
                    if ((typeof data === 'string' && data.startsWith('SIG')) || (u && u.length >= 3 && u[0] === 83 && u[1] === 73 && u[2] === 71)) this.sawHello = true;
                    else if (/sigmally.com/i.test(String(this.ws.url))) this.learnShuffle(); // game servers only (not SigMod etc.)
                    else this.probing = true;
                }
                return true;
            }
            let u8;
            if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
            else if (ArrayBuffer.isView(data)) u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            else return true;
            if (u8.length === 0) return true;
            // a table learned on the side must match what the client actually uses
            if (this.midJoin && !this.verified && u8.length === 13) {
                if (u8[0] === this.shuf[16]) this.verified = true;
                else { this.ready = false; this.probing = true; hud.flash('could not read this game connection: reload the page'); return true; }
            }
            const op = this.unshuf[u8[0]];
            if (op === 0 && u8.length > 2) { this.spawnPacket = u8.slice(); this.spawnedAt = now(); this.rerolls = 0; }
            if (op === 16 && u8.length === 13) {
                const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
                this.mouse.x = dv.getInt32(1, true);
                this.mouse.y = dv.getInt32(5, true);
                if (CFG.record && !CFG.bot) (this.recIn = this.recIn || []).push([Date.now(), 'm', this.mouse.x, this.mouse.y]);
                activeConn = this;
                if (CFG.bot && this.mine.size) return false; // the bot is driving
                if (!CFG.bot && now() < (this.guardUntil || 0) && this.mine.size) return false;   // guardian has the wheel
                if (!CFG.bot && this.mine.size && (aimCtl.lock || aimCtl.shoot || aimCtl.mine || now() < aimCtl.holdUntil)) return false;   // Shift / A steer
                if (now() < this.lockUntil) return false;    // a smart split is steering
            } else if (op === 17 || op === 21) {
                if (CFG.record && !CFG.bot) (this.recIn = this.recIn || []).push([Date.now(), op === 17 ? 'split' : 'feed']);
                if (CFG.bot && CFG.blockUserInput && this.mine.size) return false;
                if (op === 17) this.pendingSplitAt = now();
            }
            return true;
        }

        onMessage(data) {
            if (retired) return;
            // SigMod's own server (3.37.3): positions of everyone sharing our tag / clan ("minimap-data") and their scores
            if (this.isSigMod === undefined) this.isSigMod = /czrsd.com/.test(this.ws.url || '');
            if (this.isSigMod) { readSigMod(data); return; }
            if (!(data instanceof ArrayBuffer)) return;
            if (INJECTED.has(data)) return;
            const dv = new DataView(data);
            if (!this.ready) {
                let o = 0, s = '';
                while (o < dv.byteLength) { const c = dv.getUint8(o++); if (!c) break; s += String.fromCharCode(c); }
                if (!s.startsWith('SIG')) return;
                for (let i = 0; i < 256; i++) {
                    this.shuf[i] = dv.getUint8(o + i);
                    this.unshuf[this.shuf[i]] = i;
                }
                this.ready = true;
                return;
            }
            const op = this.unshuf[dv.getUint8(0)];
            switch (op) {
                case 16: this.parseUpdate(dv); this.updAt = performance.now(); stall.seen(this); this.afterUpdate(); break;
                case 99: {
                    try {
                        const u = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
                        let o = 1; const flags = u[o++]; const color = (u[o] << 16) | (u[o + 1] << 8) | u[o + 2]; o += 3;
                        const zt = () => { const st = o; while (o < u.length && u[o] !== 0) o++; const str = new TextDecoder().decode(u.subarray(st, o)); o++; return str; };
                        const name = zt(), text = zt();
                        if (!this.chatRawSent || this.chatRawSent < 3) { this.chatRawSent = (this.chatRawSent || 0) + 1; lab.send({ type: 'chatraw', hex: [...u.slice(0, 80)].map(b => b.toString(16).padStart(2, '0')).join('') }); }
                        lab.send({ type: 'chat', t: Date.now(), server: serverOf(this.ws), fromServer: !!(flags & 128), name, color, text, me: this.myName || '' });
                    } catch (_) { }
                    break;
                }
                case 49: {
                    // FFA leaderboard: count u32, then per row: highlighted u32 (1 = us), name\0, our place u32, sub u32
                    try {
                        const u = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
                        if (!this.lbRawSent) { this.lbRawSent = 1; lab.send({ type: 'lbraw', hex: [...u.slice(0, 120)].map(b => b.toString(16).padStart(2, '0')).join('') }); }
                        let o = 1; const n = dv.getUint32(o, true); o += 4;
                        const names = []; let pos = 0;
                        for (let i = 0; i < n && i < 20 && o < u.length; i++) {
                            const hi = dv.getUint32(o, true); o += 4;
                            const st = o; while (o < u.length && u[o] !== 0) o++;
                            const name = new TextDecoder().decode(u.subarray(st, o)); o++;
                            const p = dv.getUint32(o, true); o += 8;
                            names.push(name);
                            if (hi) pos = i + 1; else if (p && !pos) pos = p;
                        }
                        this.lb = { t: now(), names, pos };
                        if (!this.lbSentAt || now() - this.lbSentAt > 5000) { this.lbSentAt = now(); lab.send({ type: 'lb', names, pos, me: this.myName || '' }); }
                    } catch (_) { }
                    break;
                }
                case 18: this.cells.clear(); break;
                case 20: this.mine.clear(); break;
                case 32: {
                    this.mine.add(dv.getUint32(1, true));
                    this.everAlive = true;
                    if (this.pendingSplitAt) {
                        const sample = now() - this.pendingSplitAt;
                        if (sample > 5 && sample < 600) this.rtt = this.rtt * 0.7 + sample * 0.3;
                        this.pendingSplitAt = 0;
                    }
                    break;
                }
                case 64:
                    if (dv.byteLength >= 33) this.border = {
                        minX: dv.getFloat64(1, true), minY: dv.getFloat64(9, true),
                        maxX: dv.getFloat64(17, true), maxY: dv.getFloat64(25, true),
                    };
                    break;
            }
        }

        parseUpdate(dv) {
            let o = 1;
            const u8 = () => dv.getUint8(o++);
            const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
            const i16 = () => { const v = dv.getInt16(o, true); o += 2; return v; };
            const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
            const str = () => {
                const start = o;
                while (o < dv.byteLength && dv.getUint8(o) !== 0) o++;
                const bytes = new Uint8Array(dv.buffer, dv.byteOffset + start, o - start);
                o++;
                return bytes.length ? UTF8.decode(bytes) : '';
            };
            this.tick++;
            const tick = this.tick;
            const hadCells = this.mine.size > 0;

            const nEat = u16();
            for (let i = 0; i < nEat; i++) {
                const eater = this.cells.get(u32()), eatenId = u32(), eaten = this.cells.get(eatenId);
                if (eater && eaten) this.onEat(eater, eaten);
                // one of mine eaten by someone else: remember who and how, for the death report
                if (eater && eaten && this.mine.has(eatenId) && !this.mine.has(eater.id))
                    this.lastLoss = { tick, name: eater.name, s: eater.s, key: eater.key, fast: isFast(eater.vx, eater.vy, eater.s), master: isMaster(eater),
                        teamer: isTeamer(eater.key), bot: isBot(eater), mate: this.mateKeys.has(eater.key), mine: eaten.s, x: eaten.x, y: eaten.y };
                this.cells.delete(eatenId);
                this.mine.delete(eatenId);
            }
            for (; ;) {
                const id = u32();
                if (id === 0) break;
                const x = i16(), y = i16(), s = u16(), flags = u8();
                u8(); u8(); u8(); // isUpdate, isPlayer, isSub
                const clan = str();
                let color = null, name = null, skin = null;
                if (flags & 2) color = (u8() << 16) | (u8() << 8) | u8();
                if (flags & 4) skin = str();
                if (flags & 8) name = str();
                let c = this.cells.get(id);
                if (!c) {
                    c = { id, x, y, s, vx: 0, vy: 0, vt: tick, born: tick, movedAt: tick, color: 0, name: '', clan: '', key: '' };
                    // appearing well inside the view (not walking in at the edge) = just created,
                    // so `born` is its real birth tick and its merge timer can be trusted
                    const vb = this.viewBox;
                    c.fresh = !!vb && x > vb.minX + 250 && x < vb.maxX - 250 && y > vb.minY + 250 && y < vb.maxY - 250;
                    this.cells.set(id, c);
                    this.ghosts.delete(id);
                    // ejected mass in my colour appearing mid-dash is ours to collect afterwards
                    if ((this.dash || this.feast) && (flags & 0x20) && color === this.myColor) this.dashEjects.add(id);
                } else {
                    if (Math.hypot(x - c.x, y - c.y) > 3) c.movedAt = tick;    // still cells (frozen / disconnected) are free food
                    const dt = Math.max(1, tick - c.vt);
                    const nvx = (x - c.x) / dt, nvy = (y - c.y) / dt;
                    const k = isFast(nvx, nvy, s) ? 1 : 0.6;
                    c.vx = c.vx * (1 - k) + nvx * k;
                    c.vy = c.vy * (1 - k) + nvy * k;
                    c.vt = tick;
                }
                c.x = x; c.y = y; c.s = s; c.flags = flags; c.clan = clan;
                if (color !== null) c.color = color;
                if (name !== null) c.name = name;
                if (skin !== null) c.skin = skin;
                c.virus = !!(flags & 1);
                c.eject = !!(flags & 0x20);
                c.player = !c.virus && !c.eject && s > 40;
                c.key = c.player ? c.name + '|' + c.color : '';
                if (this.mine.has(id)) this.myColor = c.color;
            }
            const nDel = u16();
            for (let i = 0; i < nDel; i++) {
                const id = u32();
                // deleted without being eaten = it left our view: remember enemy players as ghosts (#10)
                const c = this.cells.get(id);
                if (c && c.player && !this.mine.has(id)) this.ghosts.set(id, { cell: { ...c }, t: now(), tick });
                this.cells.delete(id);
                this.mine.delete(id);
            }
            if (hadCells && this.mine.size === 0) {
                this.diedAt = now(); this.vshot = null;
                const L = this.lastLoss;
                if (L && tick - L.tick < 50 && !L.mate && !L.master) { book.note(L.name, 'kills'); noteKiller(L.name, Date.now()); }
                // leaving the world on purpose (respawning nearer the team) isn't a death
                if (now() - (this.lastReroll || 0) > 2500 || (L && tick - L.tick < 10)) lab.death(this);
                else lab.ring = [];
            }
            this.afterParse(tick);
        }

        // bookkeeping that several boss moves rely on
        afterParse(tick) {
            // what we can see right now (the server sends everything inside our view area)
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const counts = new Map();
            for (const c of this.cells.values()) {
                if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
                if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
                if (c.player && !this.mine.has(c.id)) counts.set(c.key, (counts.get(c.key) || 0) + 1);
            }
            this.viewBox = this.cells.size > 20 ? { minX, minY, maxX, maxY } : null;
            // the piece limit is whatever the server actually lets us have: if we ever hold more
            // pieces than we thought possible, the limit is higher (and viruses would pop us below it)
            if (this.mine.size > GAME.maxCells) {
                GAME.maxCells = this.mine.size > 8 ? Math.max(16, this.mine.size) : this.mine.size;
                CFG.maxCells = GAME.maxCells;
                saveCfg();
                hud.flash(`piece limit is at least ${GAME.maxCells} here`);
            }
            // a new piece of a player born inside our view = they just split (or popped): their pieces
            // are locked apart for the merge timer (#2, #5, #7). (Pieces walking in at the edge don't count.)
            for (const [key, n] of counts) {
                let o = this.owners.get(key);
                if (!o) this.owners.set(key, o = { count: n, splitTick: -1e9, popTick: -1e9, seen: tick });
                o.count = n; o.seen = tick;
            }
            for (const c of this.cells.values()) {
                if (c.born !== tick || !c.fresh || this.mine.has(c.id)) continue;
                if (c.eject) {
                    // a bot-named player shooting mass is a human (PlayerBot never ejects)
                    for (const e of this.cells.values())
                        if (e.player && e.color === c.color && BOT_NAMES.has(e.name) && Math.hypot(e.x - c.x, e.y - c.y) < e.s + 120) provenHuman.add(e.key);
                    this.spotBait(c);
                    continue;
                }
                if (!c.player) continue;
                const o = this.owners.get(c.key);
                if (o && o.count > 1 && o.splitTick !== tick) {
                    const nm = c.name;
                    if (tick - o.splitTick < 15 && tick - o.popTick > 2) book.note(nm, 'doubles');
                    if (tick - o.popTick > 2) { book.note(nm, 'splits'); o.checkAtUs = tick + 3; }
                    o.splitTick = tick;
                }
            }
            // ...and so is one with 5+ pieces that didn't just hit a virus (bots split only with <= 2 cells)
            for (const [key, n] of counts) {
                const o = this.owners.get(key);
                if (n > 4 && o && tick - o.popTick > MERGE_LOCK_TICKS && BOT_NAMES.has(key.slice(0, key.lastIndexOf('|')))) provenHuman.add(key);
            }
            const t = now();
            for (const [id, g] of this.ghosts) if (t - g.t > CFG.ghostMs) this.ghosts.delete(id);
            if (tick % 10 === 0) this.rememberFood(); // #10
            // a few ticks after someone split: did the pieces fly at us?
            for (const [key, o] of this.owners) {
                if (o.checkAtUs !== tick) continue;
                const mine = this.myCells();
                const nm = key.slice(0, key.lastIndexOf('|'));
                let at = false;
                for (const c of this.cells.values()) {
                    if (c.key !== key || !isFast(c.vx, c.vy, c.s)) continue;
                    for (const m of mine) {
                        const dx = m.x - c.x, dy = m.y - c.y, d = Math.hypot(dx, dy) || 1, v = Math.hypot(c.vx, c.vy) || 1;
                        if (d < 1800 && (dx * c.vx + dy * c.vy) / (d * v) > 0.85) { at = true; break; }
                    }
                    if (at) break;
                }
                if (at) { book.note(nm, 'atUs'); betrayed(nm, 'split at us'); }
            }
            if (tick % 50 === 0) this.spotClans();
            if (tick % 25 === 0) {
                const t = now();
                this.baiterColors.clear();
                for (const [k, until] of this.baiters) { if (until < t) this.baiters.delete(k); else this.baiterColors.add(+k.slice(k.lastIndexOf('|') + 1)); }
            }
            if (tick % 250 === 0) book.save();
        }

        // Clan tags: players whose names start with the same tag ("NØX メ ...", "【Řβ】...", "{Wisp}...") team up.
        // Flag them as teamers (and each other's mates) as soon as two are about, not only after seeing them feed.
        spotClans() {
            const tagOf = n => {
                if (!n) return '';
                const t = n.normalize('NFKC').trim();
                const br = /^([\[【{(<«][^\]】})>»]{1,8}[\]】})>»])/.exec(t);
                if (br) return br[1].toUpperCase();
                const first = t.split(/\s+/)[0];
                const up = first ? first.toUpperCase() : '';
                if (/^(THE|MR.?|MRS.?|MS.?|DR.?|MY|NO|YT|TEAM|MISS|LORD|KING|QUEEN|BIG|LIL|LITTLE|SIR|EL|LA|LE|DE|EU|US|UK|TTV|AN|IM|I'M)$/.test(up)) return ''; // ordinary words, not clan tags
                return first && first.length >= 2 && first.length <= 8 && t.length > first.length + 1 ? up : '';
            };
            const byTag = new Map();
            for (const c of this.cells.values()) {
                if (!c.player || this.mine.has(c.id) || this.mateKeys.has(c.key) || BOT_NAMES.has(c.name)) continue;
                const tag = tagOf(c.name);
                if (!tag) continue;
                if (!byTag.has(tag)) byTag.set(tag, new Set());
                byTag.get(tag).add(c.key);
            }
            // remember who wore each tag (10 min): a lone member of a clan we've seen before still counts
            const t = now();
            for (const [tag, keys] of byTag) {
                let m = clanMemory.get(tag);
                if (!m || t - m.t > 600000) clanMemory.set(tag, m = { keys: new Set(), t });
                for (const k of keys) m.keys.add(k);
                m.t = t;
                if (m.keys.size >= 2) for (const k of m.keys) keys.add(k);
            }
            for (const [tag, keys] of byTag) {
                if (keys.size < 2) continue;
                const list = [...keys];
                for (const k of list) {
                    const others = list.filter(o => o !== k);
                    if (teamerScore(k) < 1.2) flagTeamer(k, k.slice(0, k.lastIndexOf('|')), others[0], 0.6);
                    const e = teamers.get(k); if (e) for (const o of others) e.mates.add(o);
                }
            }
        }

        // W-bait: a player bigger than us shooting mass in our direction (not into a teammate) wants us
        // to come for it. Assume they'll split on us for a while, and don't value that mass much.
        spotBait(blob) {
            const mine = this.myCells();
            if (!mine.length || blob.color === this.myColor) return;
            let shooter = null;
            for (const e of this.cells.values())
                if (e.player && e.color === blob.color && !this.mine.has(e.id) && Math.hypot(e.x - blob.x, e.y - blob.y) < e.s + 150) { shooter = e; break; }
            if (!shooter || this.mateKeys.has(shooter.key) || isMaster(shooter)) return;
            const small = mine.reduce((a, m) => (m.s < a.s ? m : a));
            const c = centroid(mine);
            const ux = blob.x - shooter.x, uy = blob.y - shooter.y, ul = Math.hypot(ux, uy) || 1;
            const mx = c.x - shooter.x, my = c.y - shooter.y, ml = Math.hypot(mx, my) || 1;
            if (ml > 2200 || (ux * mx + uy * my) / (ul * ml) < 0.7) return;
            if (!canEat(shooter.s, small.s) && !canEat(shooter.s / SQRT2, small.s)) return;
            if ((this.baiters.get(shooter.key) || 0) < now()) hud.flash(`${shooter.name || 'someone'} is shooting mass at us: bait, keeping clear`);
            this.baiters.set(shooter.key, now() + CFG.baitMs);
            this.baiterColors.add(shooter.color);
        }

        // #10: remembered pellet density per 1000x1000 square, from squares fully inside the view
        rememberFood() {
            const vb = this.viewBox;
            if (!vb) return;
            const G = 1000, counts = new Map();
            for (const c of this.cells.values()) {
                if (c.player || c.virus) continue;
                const k = Math.floor(c.x / G) + ',' + Math.floor(c.y / G);
                counts.set(k, (counts.get(k) || 0) + mass(c.s));
            }
            const t = now();
            for (let gx = Math.ceil(vb.minX / G); (gx + 1) * G <= vb.maxX; gx++)
                for (let gy = Math.ceil(vb.minY / G); (gy + 1) * G <= vb.maxY; gy++)
                    this.foodGrid.set(gx + ',' + gy, { food: counts.get(gx + ',' + gy) || 0, t });
        }

        // Teaming signals: a player cell that flies into another player's cell,
        // or ejected mass of one colour fed to a different player.
        onEat(eater, eaten) {
            teamlog.onEat(this, eater, eaten);
            // someone else's mass landing in us: they're offering to team (our squad's doesn't count)
            if (this.mine.has(eater.id) && eaten.eject && eaten.color !== this.myColor) {
                for (const c of this.cells.values())
                    if (c.player && c.color === eaten.color && !this.mine.has(c.id) && !this.mateKeys.has(c.key)) { allyFed(c.name, mass(GAME.ejectLoss)); break; }
            }
            if (this.mine.has(eaten.id) && eater.player && !this.mine.has(eater.id) && !this.mateKeys.has(eater.key)) betrayed(eater.name, 'ate a piece of ours');
            if (!eater.player || this.mine.has(eater.id) || this.mine.has(eaten.id)) return;
            // our own squad passing mass around isn't someone else's teaming
            if (this.mateKeys.has(eater.key) || this.mateKeys.has(eaten.key)) return;
            // #7: the server tells us exactly when someone eats a virus: they've just popped
            if (eaten.virus) {
                let o = this.owners.get(eater.key);
                if (!o) this.owners.set(eater.key, o = { count: 1, splitTick: -1e9, popTick: -1e9, seen: this.tick });
                o.popTick = o.splitTick = this.tick;
                o.popAt = { x: eaten.x, y: eaten.y };
                return;
            }
            if (eaten.player && eaten.key !== eater.key) {
                const dx = eater.x - eaten.x, dy = eater.y - eaten.y;
                const toward = eaten.vx * dx + eaten.vy * dy;
                const flying = isFast(eaten.vx, eaten.vy, eaten.s);
                if (toward > 0 && (flying || eaten.s > eater.s * 0.45)) {
                    const amt = flying ? 1 : 0.5;
                    flagTeamer(eaten.key, eaten.name, eater.key, amt);
                    flagTeamer(eater.key, eater.name, eaten.key, amt);
                }
            } else if (eaten.eject && eaten.color !== eater.color) {
                flagTeamer(eater.key, eater.name, null, 0.15);
                for (const c of this.cells.values())
                    if (c.player && c.color === eaten.color && c.key !== eater.key) { flagTeamer(c.key, c.name, eater.key, 0.15); break; }
            }
        }

        leadTicks() { return this.rtt / GAME.tickMs + 0.5; }
        myCells() {
            const out = [];
            for (const id of this.mine) { const c = this.cells.get(id); if (c) out.push(c); }
            return out;
        }
        // where the server will think my mouse is when nobody intervenes
        intendedAim() { return CFG.bot && this.botAim ? this.botAim : this.mouse; }

        // ------------------------------------------------------------ per-tick control
        // CPU per tick (3.36.0): the decision's cost is tracked; over CFG.tickBudgetMs on average the expensive planners
        // (escape look-ahead, trap) re-think less often, so a busy PC with 4 game tabs doesn't fall behind the server
        afterUpdate() {
            const t0 = performance.now();
            try { return this.afterUpdateInner(); }
            finally {
                const dt = performance.now() - t0;
                this.tickCost = this.tickCost === undefined ? dt : this.tickCost * 0.95 + dt * 0.05;
                this.tickCostMax = Math.max((this.tickCostMax || 0) * 0.999, dt);
                const was = !!this.heavy;
                this.heavy = this.tickCost > CFG.tickBudgetMs * (was ? 0.7 : 1);
                if (this.heavy !== was) hud.flash(this.heavy ? 'busy computer: thinking lighter (' + this.tickCost.toFixed(1) + ' ms a tick)' : 'thinking at full detail again');
            }
        }
        afterUpdateInner() {
            const t = now();
            if (retired) return;
            if (!this.mine.size && t - (this.respawnTickAt || 0) > 400) { this.respawnTickAt = t; try { this.maybeRespawn(); } catch (_) { } }
            squad.publish(this);
            // one connection is the one you're looking at; with multiboxing the bot drives every one of ours
            const viewing = !activeConn || this === activeConn;
            if (!viewing && !(CFG.multibox && CFG.bot && this.mine.size)) return;
            if (viewing) lab.tick(this);
            this.squadMerge = now() < (this.mergeUntil || 0);

            // a smart split is in flight: keep steering onto the moving target
            // eaten (or gone from view): stop chasing, hand control back right away
            if (t < this.lockUntil && this.lockTargetId && (!this.cells.has(this.lockTargetId) || (this.mateSeen && this.mateSeen.has(this.lockTargetId)))) this.lockUntil = t;
            if (t < this.lockUntil) {
                if (this.splitAgainTick && this.tick >= this.splitAgainTick) { this.splitAgainTick = 0; this.sendSplit(1); }
                const tgt = this.cells.get(this.lockTargetId);
                if (tgt) {
                    const p = predict(tgt, this.leadTicks(), this.tick);
                    const c = centroid(this.myCells());
                    const d = Math.hypot(p.x - c.x, p.y - c.y) || 1;
                    this.sendMouse(p.x + (p.x - c.x) / d * this.lockOvershoot, p.y + (p.y - c.y) / d * this.lockOvershoot);
                } else if (this.lockAim) {
                    this.sendMouse(this.lockAim.x, this.lockAim.y);
                }
                hud.update(this);
                return;
            } else if (this.lockUntil) {
                this.lockUntil = 0;
                this.lockTargetId = 0;
                this.lockAim = null;
                this.splitAgainTick = 0;
                if (!CFG.bot) this.sendMouse(this.mouse.x, this.mouse.y);
            }

            const mine = this.myCells();
            if (!mine.length) { this.mode = this.midJoin && !this.everAlive ? 'joined mid-game: takes over at the next spawn' : 'dead'; this.lastPlan = null; hud.update(this); return; }
            const S = snapshot(this, mine);

            // 0. a master is around: everything we have is theirs
            if (CFG.bot && CFG.serveMaster && stepServe(this, S)) { hud.update(this); return; }
            // squad: the leader works out what to ask its mates for
            this.squadNeed = CFG.bot ? teamNeed(S) : null;
            if (!S.squad.length) this.squadHunt = null;

            // 1. smart split
            const ready = t - this.lastAction > CFG.cooldownMs;
            const plan = (CFG.autoSplit || CFG.hud) && (this.tick > 15 || !S.squad.length) ? splitPlan(S, this.intendedAim()) : null;
            this.lastPlan = plan;
            if (plan && CFG.autoSplit && ready && worthIt(plan)) {
                this.vshot = null;
                this.executeSplit(plan, 'auto');
                hud.update(this);
                return;
            }

            if (!CFG.bot) {
                this.mode = 'assist';
                // the bot's opinion (it doesn't steer): for the way-out arrow and guardian
                if ((CFG.overlay || CFG.guardian) && this.tick % 2 === 0) {
                    try {
                        const mv = steer(this, S);
                        this.advice = { aim: mv.aim, danger: mv.danger, t, scored: this.lastScored, center: S.center, mass: S.myMass };
                    } catch (_) { this.advice = null; }
                }
                const adv = this.advice;
                if (CFG.guardian && adv && t - adv.t < 200 && adv.scored && adv.scored.length) {
                    // how dangerous the way the player is heading is, against the bot's best way
                    const ua = Math.atan2(this.mouse.y - S.center.y, this.mouse.x - S.center.x);
                    let mineH = null, md = Infinity;
                    for (const sc of adv.scored) { if (sc.gather) continue; const d = Math.abs(Math.atan2(Math.sin(sc.a - ua), Math.cos(sc.a - ua))); if (d < md) { md = d; mineH = sc; } }
                    if (mineH && mineH.danger - adv.danger > CFG.guardianMargin * S.myMass && mineH.danger > 0.25 * S.myMass) {
                        if (!(t < (this.guardUntil || 0))) hud.flash('GUARDIAN: taking the wheel');
                        this.guardUntil = t + 700;
                        this.raw((() => { const dv = new DataView(new ArrayBuffer(13)); dv.setUint8(0, this.shuf[16]); dv.setInt32(1, Math.round(adv.aim.x), true); dv.setInt32(5, Math.round(adv.aim.y), true); return dv.buffer; })());
                        this.mode = 'GUARDIAN';
                    } else if (this.guardUntil && t >= this.guardUntil) { this.guardUntil = 0; this.raw((() => { const dv = new DataView(new ArrayBuffer(13)); dv.setUint8(0, this.shuf[16]); dv.setInt32(1, Math.round(this.mouse.x), true); dv.setInt32(5, Math.round(this.mouse.y), true); return dv.buffer; })()); }
                }
                if (CFG.intelInject) { try { intelInject(this); } catch (_) { } }
                hud.update(this); return;
            }

            // mass we shot during a dash: forget pieces that are gone (eaten / out of view)
            if (this.dashEjects.size) {
                for (const id of this.dashEjects) if (!this.cells.has(id)) this.dashEjects.delete(id);
                if (!this.dash) {
                    if (!this.dashEjects.size) hud.flash('collected all the mass we shot');
                    else if (t > this.collectUntil) { this.dashEjects.clear(); hud.flash('collect: gave up on the rest'); }
                }
            }
            // virus feast: at the piece limit with plenty of mass, shoot the nearest virus and eat it
            // (every 5th hit launches a new one: more 100-mass meals). Strays get collected afterwards.
            if (CFG.virusFeast && CFG.virusFeastShoot && !this.dash) {
                if (!this.feast && !this.dashEjects.size && this.tick % 4 === 0) this.feast = findFeast(S);
                if (this.feast && stepFeast(this, S)) { hud.update(this); return; }
            } else this.feast = null;

            const busy = this.dash || this.dashEjects.size; // dashing or collecting: don't start other plans

            // squad support: dive into the leader rather than be eaten; feed the leader
            this.teamPool = teamPoolWanted(this, S);
            teamlog.tick(this, S);
            wobbleCheck(this, S);
            if (!busy && this.rerollNearTeam(S)) { hud.update(this); return; }
            // the captain's Tab ("feed me") comes first, even mid-dash (live 2026-10-27: broken up right next to the captain
            // with someone coming, Tab pressed - it was dashing away, "busy", and never looked at the order; both got eaten)
            const tabNow = S.captain && S.captain.order && S.captain.order.feedAt && Date.now() - S.captain.order.feedAt < CFG.feedMeMs;
            if (tabNow && busy) { this.dash = null; this.dashEjects.clear(); }
            if ((!busy || tabNow) && stepOrders(this, S)) { hud.update(this); return; }
            // mining comes before every team routine (the user: once mining, mine relentlessly - 'follow the leader' used
            // to drag a freshly popped bot off the field it had just split a virus on)
            if (!busy && now() >= (this.miningOffUntil || 0) && stepMine(this, S)) { hud.update(this); return; }
            if (!busy && stepSlip(this, S)) { hud.update(this); return; }
            if (!busy && stepReachBait(this, S)) { hud.update(this); return; }
            if (!busy && stepCrown(this, S)) { hud.update(this); return; }
            // mid fast-travel both partners are committed: a boost / rally / snack must not pull one away while the other
            // is dipping its pieces into it (real escapes still win - fast travel hands those over itself)
            const ftBusy = !!(this.ft && now() - (this.ftStepAt || 0) < 600);
            if (!busy && !ftBusy && stepBoostMate(this, S)) { hud.update(this); return; }
            if (!busy && !ftBusy && stepRally(this, S)) { hud.update(this); return; }
            if (!busy && CFG.teamPump && stepPump(this, S) && !popsOnTheWay(this, S)) { hud.update(this); return; }
            if (!busy && CFG.teamRelay && stepRelay(this, S)) { hud.update(this); return; }
            const snack = !ftBusy && snackNear(this, S);
            if (!busy && !snack && (CFG.ftMode === 'cannon' ? stepRelayCannon(this, S) : CFG.ftMode === 'feed' ? stepFeedTravel(this, S) : CFG.ftMode === 'leapfrog' ? stepLeapfrog(this, S) : stepFastTravel(this, S))) { this.ftStepAt = now(); hud.update(this); return; }
            if (!busy && !snack && stepPair(this, S)) { hud.update(this); return; }
            if (!busy && stepSquad(this, S) && !popsOnTheWay(this, S)) { hud.update(this); return; }

            // counter-attack: our biggest piece leads, the attacker is coming for our small ones: eat it
            if (CFG.counterAttack && stepCounter(this, S)) { hud.update(this); return; }
            // #9 a piece about to be swallowed shoots its mass into a safe piece (emergency: always on)
            if (CFG.bailout) {
                if (!this.bailout) this.bailout = findBailout(S);
                if (this.bailout && stepBailout(this, S)) { hud.update(this); return; }
            }
            // #3 one of my pieces is just short of eating someone: pump mass into it
            if (CFG.feedKill && !busy) {
                if (!this.feedKill && this.tick % 3 === 0) this.feedKill = findFeedKill(S);
                if (this.feedKill && stepFeedKill(this, S)) { hud.update(this); return; }
            } else this.feedKill = null;
            // #8 lure a bot that's just out of split range with a blob of mass
            if (CFG.botBait && !busy) {
                if (!this.bait && this.tick % 10 === 0) this.bait = findBait(S);
                if (this.bait && stepBait(this, S)) { hud.update(this); return; }
            } else this.bait = null;

            // 2. flank: go around a big threat and eat the small bits trailing behind it
            if (CFG.flank && !busy) {
                if (!this.flank && this.tick % 5 === 0) this.flank = findFlank(S);
                if (this.flank && stepFlank(this, S)) { hud.update(this); return; }
            } else this.flank = null;

            // 3. virus shot in progress / new opportunity
            if (CFG.virusShots && !busy) {
                if (!this.vshot && this.tick % 4 === 0) this.vshot = findVirusShot(S) || joinMateShot(S);
                if (this.vshot && stepVirusShot(this, S)) { hud.update(this); return; }
            } else this.vshot = null;

            // 3. many small pieces and it's calm: feed them all into the biggest one
            // (not while virus farming: being in many pieces is the point there)
            if (CFG.consolidate && !busy && !S.virusFarm && stepConsolidate(this, S)) { hud.update(this); return; }

            // 4. movement (escape splits, dash-feeding, collecting)
            const move = steer(this, S);
            if (move.split && ready) {
                this.dash = null;
                this.sendMouse(move.aim.x, move.aim.y);
                this.sendSplit(1);
                this.lastAction = t;
                this.lockUntil = t + 160;
                this.lockTargetId = 0;
                this.lockAim = move.aim;
                this.botAim = move.aim;
                hud.flash(`escape split (danger ${Math.round(move.dangerBefore)} → ${Math.round(move.danger)})`);
            } else if (!(CFG.dashFeed && stepDash(this, S, move))) {
                this.sendMouse(move.aim.x, move.aim.y);
                this.botAim = move.aim;
                if (this.dashEjects.size && !this.dash && this.mode !== 'evade') this.mode = `collect (${this.dashEjects.size} left)`;
            }
            this.dirHist.push(this.botDir);
            if (this.dirHist.length > 10) this.dirHist.shift();
            hud.update(this);
        }

        executeSplit(plan, why) {
            this.sendMouse(plan.aim.x, plan.aim.y);
            this.sendSplit(plan.k);
            this.splitAgainTick = plan.delay ? this.tick + plan.delay : 0; // human-style double: second press later
            this.lastAction = now();
            // hold the aim until the simulated catch (plus network lead), so the pieces
            // aren't pulled back toward wherever we were heading before the split
            const holdMs = (this.leadTicks() + plan.eatTick + 2) * GAME.tickMs;
            this.lockUntil = now() + Math.max(CFG.lockMs, Math.min(CFG.maxLockMs, holdMs));
            this.lockTargetId = plan.targetId;
            this.lockOvershoot = plan.overshoot;
            this.lockAim = plan.aim;
            this.mode = 'split';
            hud.flash(`${why}: ${plan.delay ? 'delayed double' : plan.k + 'x'} split → +${Math.round(plan.gain)} mass` +
                (plan.risk > 1 ? ` (risk ${Math.round(plan.risk)})` : '') + (plan.teamer ? ' [teamer]' : ''));
        }

        // After a death the site shows a stats screen with a Continue button; only after that is the
        // Play button visible. Click Continue, then Play; if the menu still covers the game right after
        // spawning, close it with Esc like a player would. Captchas are left to the human.
        maybeRespawn() {
            if (!this.mine.size) teamlog.tick(this, null);   // close journal entries of a dead connection too
            if (retired || !CFG.bot || !CFG.autoRespawn) return;
            const t = now();
            const vis = el => !!el && el.offsetParent !== null && el.offsetParent !== undefined;
            // Loaded after this game connection opened and couldn't learn its opcode table (the live server
            // gives each connection its own): at the death screen, close it so the game reconnects through us.
            // Nothing is lost there, and Continue + Play below then work as usual.
            if (!this.ready) {
                if (/sigmally\.com/i.test(String(this.ws.url)) && this.ws.readyState === 1 && vis(document.getElementById('continue_button')) &&
                    t - (this.reconnectAt || 0) > 10000) {
                    this.reconnectAt = t;
                    hud.flash('taking over: reconnecting the game through the bot at the death screen');
                    try { this.ws.close(); } catch (_) { }
                    pendingTakeover = t;
                }
                return;
            }
            if (this.mine.size) {
                const menu = document.getElementById('menu-wrapper');
                if (vis(menu) && t - this.lastRespawn < 10000) {
                    this.menuSince = this.menuSince || t;
                    if (t - this.menuSince > 1200 && t - (this.lastEsc || 0) > 2500) {
                        this.lastEsc = t;
                        // the site tracks held keys and ignores a key until it's released: send down + up
                        for (const type of ['keydown', 'keyup']) {
                            const ev = new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true });
                            Object.defineProperty(ev, 'keyCode', { get: () => 27 });
                            Object.defineProperty(ev, 'which', { get: () => 27 });
                            W.dispatchEvent(ev);
                        }
                    }
                } else this.menuSince = 0;
                return;
            }
            const cont = document.getElementById('continue_button');
            // joined mid-game: we never knew our cells, so the death screen is how we know we died
            if (this.midJoin && !this.everAlive && vis(cont)) { this.everAlive = true; this.diedAt = t; }
            if (!this.everAlive && t - pendingTakeover < 30000) { this.everAlive = true; this.diedAt = t - CFG.respawnDelayMs; }
            if (!this.everAlive || t - this.diedAt < CFG.respawnDelayMs) return;
            // the menu route hasn't brought us back (hidden window: no menu drawn, timers slowed): spawn directly
            if (this.spawnPacket && this.ws.readyState === 1 && t - this.diedAt > CFG.respawnDelayMs + CFG.directRespawnMs && t - (this.directSpawnAt || 0) > 4000 &&
                !document.getElementById('cf-turnstile') && !document.getElementById('g-recaptcha')) {
                this.directSpawnAt = t; this.lastRespawn = t;
                this.raw(this.spawnPacket);
                lab.event('respawned directly (the menu route did not work - hidden window?)');
                return;
            }
            if (t - this.lastRespawn < 3000) return;
            if (vis(cont)) { cont.click(); this.lastRespawn = t - 2400; return; } // Play follows ~0.6 s later
            if (document.getElementById('cf-turnstile') || document.getElementById('g-recaptcha')) {
                if (t - (this.captchaFlash || 0) > 10000) { this.captchaFlash = t; hud.flash('respawn needs the captcha: please click it'); }
                return;
            }
            const btn = document.getElementById('play-btn');
            if (btn && !btn.disabled && vis(btn)) { this.lastRespawn = t; this.menuSince = 0; btn.click(); hud.flash('respawning'); }
        }
    }

    // ---------------------------------------------------------------- world snapshot
    function snapshot(conn, mine) {
        const tick = conn.tick, L = conn.leadTicks();
        const center = centroid(mine);
        let myMass = 0, maxMine = 0;
        for (const c of mine) { myMass += mass(c.s); if (c.s > maxMine) maxMine = c.s; }
        const myKeys = new Set(mine.map(c => c.key));
        const S = {
            conn, tick, L, mine, center, myMass, maxMine, myKeys, myClan: mine[0].clan,
            enemies: [], viruses: [], food: [], ownerCount: new Map(), border: conn.border, masters: [],
            mates: [], squad: [], squadLeader: null, squadRole: 'solo', mergeKeys: new Set(), poolKeys: new Set(), mateColors: new Set(), matesFeeding: [],
            // size phase: small = survive and grow, big = don't gamble it on small gains
            phase: !CFG.phases ? 'mid' : myMass < 400 ? 'small' : myMass > 6000 ? 'big' : 'mid',
        };
        // squad: which cells are our mates' (by id, and by name+colour for pieces they've only just split off)
        const team = CFG.multibox ? squad.mates(conn) : [];
        const mateIds = new Set(), mateKeys = new Set(), mateById = new Map();
        const t = now();
        for (const m of team) {
            // same server isn't always the same world: if a cell we can see has one of their ids but is
            // somewhere else entirely, they're not here with us
            // (only viruses: they stand still. Players' pieces, a teammate's freshly split ones above all, can be
            // far from where a message a few hundred ms old put them; that once made us drop a teammate for 10 s)
            let clashes = 0;
            for (const r of m.seen || []) {
                if (!(r[8] & 1)) continue;
                const c = conn.cells.get(r[0]);
                if (c && c.virus && Math.hypot(c.x - r[1], c.y - r[2]) > 400 && Math.abs(c.s - r[3]) > 20) clashes++;
            }
            if (clashes >= 2) { conn.squadMismatch.set(m.from, t + 10000); continue; }
            S.squad.push(m);
            for (const r of m.cells) { mateIds.add(r[0]); mateById.set(r[0], m); }
            if (m.key) mateKeys.add(m.key);
            if (m.intent && m.intent.merge && m.key) S.mergeKeys.add(m.key);
            // a teammate's small bits are ours to take only while it has bits to spare (3+ pieces; never its biggest),
            // or during a relay (its tail) - never its last pieces
            const mMass = m.mass || m.cells.reduce((a2, r) => a2 + r[3] * r[3] / 100, 0);
            const lopsided = myMass > 0.62 * (myMass + mMass) && !((m.danger || 0) > 0.1 * mMass) && !(m.intent && m.intent.feeding) && !conn.squadNeed;
            if ((m.cells.length >= 2 && !lopsided) || (m.relay && m.relay.active) || (conn.relay && conn.relay.active)) S.poolKeys.add(m.key);
            // how much of it we may take before we'd hold 60%+ of the team
            const poolFree = ((m.danger || 0) > 0.1 * mMass) || (m.intent && m.intent.feeding) || conn.squadNeed;
            (S.poolRoom = S.poolRoom || new Map()).set(m.key, poolFree ? Infinity : Math.max(0, 0.6 * (myMass + mMass) - myMass));
            if (m.color >= 0) S.mateColors.add(m.color);
            if (m.intent && m.intent.feeding) S.matesFeeding.push(m);
        }
        conn.mateIds = mateIds; conn.mateKeys = mateKeys;
        S.mateBiggest = new Map(); // teammate key -> id of its biggest piece we can see
        const mateNames = CFG.multibox ? squad.mateNames(conn, mine[0].name) : new Set();
        // a team of equals: no leader, just "team" (or on our own)
        S.squadRole = S.squad.length ? 'team' : 'solo';
        if (S.squadRole !== conn.squadRole)
            hud.flash(S.squad.length ? `team: playing with ${S.squad.map(m => m.name || 'a teammate').join(', ')}` : 'team: on our own');
        conn.squadRole = S.squadRole;

        for (const c of conn.cells.values()) {
            if (conn.mine.has(c.id)) continue;
            if (c.virus) { S.viruses.push(c); continue; }
            // our mates first: even one whose name makes it a master gets squad play, not "give it everything"
            const byId = mateById.get(c.id);
            const idFits = byId && (c.key === byId.key || (c.name ? c.name === byId.name : (byId.color < 0 || c.color === byId.color)));
            if (c.player && !myKeys.has(c.key) && (idFits || mateKeys.has(c.key) || (c.name && mateNames.has(c.name)))) {
                if (!mateKeys.has(c.key)) mateKeys.add(c.key);
                S.mates.push(c);
                const bi = S.mateBiggest.get(c.key), bc = bi !== undefined && conn.cells.get(bi);
                if (!bc || c.s > bc.s) S.mateBiggest.set(c.key, c.id);
                continue;
            }
            // masters aren't enemies: nothing targets them or runs from them
            if (c.player && isMaster(c)) { S.masters.push(c); continue; }
            if (c.player && !myKeys.has(c.key)) {
                S.enemies.push(c);
                S.ownerCount.set(c.key, (S.ownerCount.get(c.key) || 0) + 1);
            } else if (!c.player) S.food.push(c);
        }
        // shared sight: players and viruses our mates can see that we can't, moved on by their speed
        S.remoteIds = new Set();
        for (const m of S.squad) {
            const age = (t - m.rx) / GAME.tickMs + 1;
            for (const r of m.seen || []) {
                const [id, x, y, s, vx10, vy10, name, color, fl] = r;
                if (conn.cells.has(id) || mateIds.has(id) || S.remoteIds.has(id)) continue;
                S.remoteIds.add(id);
                const vx = vx10 / 10, vy = vy10 / 10, f = Math.min(age, 12);
                const c = { id, x: x + vx * f, y: y + vy * f, s, vx, vy, vt: tick, born: -1e9, fresh: false, name: name || '', color,
                    clan: '', skin: '', virus: !!(fl & 1), eject: false, player: !(fl & 1), remote: true };
                c.key = c.player ? c.name + '|' + c.color : '';
                if (c.virus) { S.viruses.push(c); continue; }
                if (myKeys.has(c.key) || mateKeys.has(c.key) || isMaster(c)) continue;
                S.enemies.push(c);
                S.ownerCount.set(c.key, (S.ownerCount.get(c.key) || 0) + 1);
            }
        }
        conn.mateSeen = new Set(S.mates.map(m => m.id));
        // viruses we shot out (new ones appearing near the virus we were feeding) are remembered, so a distraction doesn't
        // make us forget them; overlapping viruses (clusters) are flagged
        {
            const K = conn.virusMem = conn.virusMem || new Map(), t = now();
            const seen = new Set();
            const tgt = conn.vfTarget && conn.cells.get(conn.vfTarget);
            const shooting = conn.vfShotAt && t - conn.vfShotAt < 1500;
            for (const v of S.viruses) {
                if (v.remote) continue;
                seen.add(v.id);
                const old = K.get(v.id);
                const ours = (old && old.ours) || (!old && shooting && conn.vfShotPos && Math.hypot(v.x - conn.vfShotPos.x, v.y - conn.vfShotPos.y) < 1800);
                K.set(v.id, { id: v.id, x: v.x, y: v.y, s: v.s, t, ours });
            }
            const viewR = 1300 + S.maxMine * 2;
            for (const [id, m] of K) {
                if (seen.has(id)) continue;
                if (t - m.t > CFG.virusMemoryMs || Math.hypot(m.x - S.center.x, m.y - S.center.y) < viewR * 0.7) K.delete(id);   // gone (we're there and it isn't)
            }
            S.virusMemory = [...K.values()].filter(m => m.ours && !seen.has(m.id));
            S.virusCluster = S.viruses.some(v => !v.remote && S.viruses.some(o => o !== v && !o.remote && Math.hypot(o.x - v.x, o.y - v.y) < v.s + o.s));
        }
        // pieces flying into another player (feeding it / diving into it): not prey
        for (const e of S.enemies) {
            e.feeding = null;
            if (e.remote) continue;
            // which way is it flying? from its speed once we have it; a piece that only just appeared: straight out from
            // the piece of the same player it split from (a split launches it that way) - so we know at the very first tick
            let ux = 0, uy = 0;
            if (e.vt >= S.tick - 1 && isFast(e.vx, e.vy, e.s)) { const sp = Math.hypot(e.vx, e.vy) || 1; ux = e.vx / sp; uy = e.vy / sp; }
            else if (S.tick - e.born <= 3) {
                const par = S.enemies.filter(o => o !== e && o.key === e.key && o.s >= e.s * 0.9 && Math.hypot(o.x - e.x, o.y - e.y) < o.s + e.s + 150)
                    .reduce((a2, o) => (!a2 || Math.hypot(o.x - e.x, o.y - e.y) < Math.hypot(a2.x - e.x, a2.y - e.y) ? o : a2), null);
                if (!par) continue;
                const dx = e.x - par.x, dy = e.y - par.y, dl = Math.hypot(dx, dy); if (dl < 1) continue;
                ux = dx / dl; uy = dy / dl;
            } else continue;
            const L = 1000;
            for (const o of S.enemies) {
                if (o === e || o.key === e.key || !canEat(o.s, e.s)) continue;
                if ((o.x - e.x) * ux + (o.y - e.y) * uy <= 0) continue;   // ahead of it
                if (segDist(o.x, o.y, e.x, e.y, e.x + ux * L, e.y + uy * L) < o.s) { e.feeding = o; break; }
            }
        }
        // a team pouring into one cell (3.36.0): count the pour as already landed, so the receiver's size - and split
        // reach - is what it will be in a moment, not what it was (their pour + split is how the pairs kill us).
        // A copy in S.enemies: the cell objects are shared with conn.cells and must keep the server's size.
        if (CFG.pourAhead) {
            const inc = new Map();
            for (const e of S.enemies) if (e.feeding && !e.feeding.remote) inc.set(e.feeding, (inc.get(e.feeding) || 0) + e.s * e.s);
            for (const [o, add] of inc) {
                if (add < 0.1 * o.s * o.s) continue;
                const i = S.enemies.indexOf(o); if (i < 0) continue;
                S.enemies[i] = Object.assign({}, o, { s: Math.sqrt(o.s * o.s + add), pourFrom: o.s });
            }
        }
        if (conn.tick % 10 === 0) noteBigPlayers(S);
        S.virusFarm = virusFarmOn(S);
        S.captain = captainOf(S, conn);
        S.plan = teamPlanFor(conn, S);
        if (S.virusFarm !== !!conn.virusFarming) { conn.virusFarming = S.virusFarm; hud.flash(S.virusFarm ? 'virus farm: nobody around — eating and shooting viruses' : 'virus farm: stopped' + (S.farmOffWhy ? ' (' + S.farmOffWhy + ')' : '')); }
        return S;
    }

    // Virus farm: 2k+ mass, a virus close by, and nobody that could eat even one of the small pieces a pop leaves
    // us in. Then viruses are food whether they pop us or not: each pop brings us closer to the piece limit,
    // and at the limit they can't pop us at all (just 100+ mass each). Shooting one makes more.

    // would heading for the last mouse we sent run one of our pieces into a virus that pops it (within ~0.5 s)?
    function popsOnTheWay(conn, S) {
        const aim = conn.lastMouse;
        if (!aim || S.virusFarm || S.mine.length >= CFG.maxCells || !S.viruses.length) return false;
        const al = Math.hypot(aim.x - S.center.x, aim.y - S.center.y);
        if (al < 1) return false;
        const ux = (aim.x - S.center.x) / al, uy = (aim.y - S.center.y) / al;
        const hit = S.mine.some(q => {
            if (!canEat(q.s, GAME.virusSize)) return false;
            const L = Math.min(al, moveSpeed(q.s) * 14 + 60);
            return S.viruses.some(v => segDist(v.x, v.y, q.x, q.y, q.x + ux * L, q.y + uy * L) < q.s - GAME.virusSize / GAME.eatOverlapDiv + 40);
        });
        if (hit && now() - (conn.popGuardAt || 0) > 3000) { conn.popGuardAt = now(); hud.flash('a virus in the way: steering round it'); }
        return hit;
    }
    // Aim to eat a virus with one particular piece. Not at the virus: our pieces all run to the mouse, and the small
    // fast ones got there first and sat on it (they can't eat it; our own pieces push each other apart), so the big
    // one never reached it (the user: "they just sit there. and get eaten"). Aim THROUGH it from the eater, far past:
    // every piece runs on its own line, only the eater's line crosses the virus. And never the same virus forever.
    function virusAimFor(conn, S, v, eater) {
        const t = now(), vb = conn.vBan || (conn.vBan = new Map());
        if (conn.vTry && conn.vTry.id === v.id) {
            if (t - conn.vTry.t > CFG.virusTryMs) { vb.set(v.id, t + CFG.virusBanMs); conn.vTry = null; hud.flash('virus: could not get our big piece onto it, leaving it'); }
        } else conn.vTry = { id: v.id, t };
        const vp = v.remembered ? { x: v.x, y: v.y } : predict(v, S.L, S.tick);
        if (!eater || S.mine.length < 2) return vp;
        const dx = vp.x - eater.x, dy = vp.y - eater.y, dl = Math.hypot(dx, dy) || 1;
        return { x: vp.x + dx / dl * 600, y: vp.y + dy / dl * 600 };
    }
    // a virus we are shooting (pressed W at it lately): the only kind we may eat
    const virusOurs = (conn, v) => { const at = conn.vHit && conn.vHit.get(v.id); return !!at && now() - at < CFG.virusOursMs; };
    const markVirusHit = (conn, id) => { const m = conn.vHit || (conn.vHit = new Map()); m.set(id, now()); if (m.size > 200) for (const [k, at] of m) if (now() - at > CFG.virusOursMs) m.delete(k); };
    // which virus to mine next (the user, 2026-10-21): the one closest to any of our cells among those AHEAD of where
    // we are going (dir: a unit-ish vector); only if nothing is ahead, the closest at our side, then any
    function mineTargetAhead(mine, viruses, dir, allowBehind = true) {
        let cx = 0, cy = 0, w = 0; for (const c of mine) { const m = c.s * c.s; cx += c.x * m; cy += c.y * m; w += m; } cx /= w; cy /= w;
        const dl = Math.hypot(dir.x, dir.y), ux = dl > 1e-6 ? dir.x / dl : 0, uy = dl > 1e-6 ? dir.y / dl : 0;
        const best = [null, null, null], bd = [Infinity, Infinity, Infinity];
        for (const v of viruses) {
            let d = Infinity; for (const c of mine) d = Math.min(d, Math.hypot(v.x - c.x, v.y - c.y) - c.s);
            const vx = v.x - cx, vy = v.y - cy, vl = Math.hypot(vx, vy) || 1, cos = dl > 1e-6 ? (vx * ux + vy * uy) / vl : 1;
            const tier = cos > 0.5 ? 0 : cos > 0 ? 1 : 2;   // within 60 deg of our heading, within 90, behind
            if (d < bd[tier]) { bd[tier] = d; best[tier] = v; }
        }
        return best[0] || best[1] || (allowBehind ? best[2] : null);
    }
    // a locked virus we have gone past without eating it (all our cells beyond it along the shooting line, none on it):
    // let it go, or we turn round for it (the user, 2026-10-22: "locks on to targets that are now behind us")
    function mineBehind(mine, v, dir) {
        if (!dir || mine.some(c => Math.hypot(v.x - c.x, v.y - c.y) < c.s + v.s + 30)) return false;
        let cx = 0, cy = 0, w = 0; for (const c of mine) { const m = c.s * c.s; cx += c.x * m; cy += c.y * m; w += m; }
        return (v.x - cx / w) * dir.x + (v.y - cy / w) * dir.y < -(v.s + 60);
    }
    // the next virus to lock onto (the user, 2026-10-21): never one touching any of our cells (it blocks us and our
    // shots can't reach it); after eating one, the one BEHIND it along the line we were shooting (nearest to where it
    // was, within 60 deg of that line); only with nothing there, the closest one ahead of our heading
    function mineNextTarget(mine, viruses, heading, last, allowBehind = true) {
        let free = viruses.filter(v => mine.every(c => Math.hypot(v.x - c.x, v.y - c.y) > c.s + v.s + 30));
        if (!free.length) return null;
        // (the user, 2026-10-25) not one right in front of us: shooting it parks every piece on it and we stall - prefer
        // ones at least CFG.mineAimMin clear of all our cells, the very close ones get eaten in passing
        let cx = 0, cy = 0, w = 0; for (const c of mine) { const m = c.s * c.s; cx += c.x * m; cy += c.y * m; w += m; } cx /= w; cy /= w;
        const bigS = mine.reduce((a, c) => Math.max(a, c.s), 0);
        const roomy = free.filter(v => mine.every(c => Math.hypot(v.x - c.x, v.y - c.y) - c.s - v.s > CFG.mineAimMin) &&
            Math.hypot(v.x - cx, v.y - cy) - bigS - v.s > CFG.mineAimMin);
        if (roomy.length) free = roomy;
        if (last) {
            let best = null, bd = Infinity;
            for (const v of free) {
                const ox = v.x - last.x, oy = v.y - last.y, od = Math.hypot(ox, oy);
                if (od < 1 || (ox * last.dx + oy * last.dy) / od < 0.5) continue;
                if ((v.x - cx) * last.dx + (v.y - cy) * last.dy <= 0) continue;   // and still in front of us (we roll on past the eaten one)
                if (od < bd) { bd = od; best = v; }
            }
            if (best) return best;
        }
        return mineTargetAhead(mine, free, heading, allowBehind);
    }
    // SLIP-THROUGH (the user, 2026-10-22; server maths): a cell is only eaten once the eater's CENTRE is within
    // size - ours/3 of ours, and a player's own pieces are pushed apart until they just touch (rigid, after 13 ticks).
    // So between two touching pieces of one player there is always a lane 2/3 of our size wide where we overlap both
    // and neither can eat us. When a chaser's small piece sits behind its big ones, we walk that lane, tick by tick,
    // keeping our centre outside every eat line (with their movement and our lag added), and eat the small one.
    // Only against players who can't split onto us there: at 16 pieces (the server refuses the split), or whose
    // halves are too small to eat us. In pieces too (the user, 2026-10-22): our piece that can eat the prey walks the
    // lane (only it is kept safe - losing a small piece on the way is still worth it), and the others shoot their mass
    // into it on the way (a press only when more of it lands in the lead than is thrown away). Other players around
    // don't stop it: that is when it pays most.
    function stepSlip(conn, S) {
        if (!CFG.slipThrough || !CFG.bot) { conn.slip = null; return false; }
        const t = now();
        let m = conn.slip ? S.mine.find(c => c.id === conn.slip.lead) : null;
        if (conn.slip && !m) { conn.slip = null; conn.slipOffUntil = t + 1500; return false; }
        if (!m) m = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        const lag = ((performance.now() - (conn.updAt || performance.now())) + conn.rtt / 2) / GAME.tickMs + 1;
        const hostile = e => e.player && !e.remote && !isAlly(e) && !conn.mateKeys.has(e.key);
        // can this player split onto us right now? (at the piece limit the server won't split them at all)
        const canSplitOnUs = e => (S.ownerCount.get(e.key) || 1) < GAME.maxCells && e.s >= GAME.minSplitSize && canEat(e.s / SQRT2, m.s);
        let P = conn.slip;
        if (P && (t - P.since > CFG.slipMaxMs || !conn.cells.has(P.prey))) {
            if (!conn.cells.has(P.prey)) hud.flash('slip-through: ate it');
            conn.slip = P = null; conn.slipOffUntil = t + 500;
        }
        if (!P) {
            if (t < (conn.slipOffUntil || 0) || conn.tick % 2) return false;
            // a prey piece of a player whose other pieces could eat us: the normal hunt shies away from those
            let best = null, bs = 0;
            for (const q of S.enemies) {
                if (!hostile(q) || !canEat(m.s, q.s * CFG.eatMargin)) continue;
                if (conn.slipBan && (conn.slipBan.get(q.key) || 0) > t) continue;
                const dq = Math.hypot(q.x - m.x, q.y - m.y) - m.s;
                if (dq > CFG.slipRange) continue;
                const gain = mass(q.s);
                if (gain < Math.max(30, S.myMass * CFG.slipMinFrac)) continue;
                const owners = S.enemies.filter(e => e.key === q.key && e.id !== q.id);
                const blockers = owners.filter(e => canEat(e.s, m.s));
                if (!blockers.length) continue;   // nothing in the way: the normal hunt does this one
                if (owners.some(canSplitOnUs)) continue;
                if (owners.some(e => e.fresh && S.tick - e.born < 15)) continue;   // just split: their pieces overlap for 13 ticks, no lane
                const sc = gain / (1 + dq / 600);
                if (sc > bs) { bs = sc; best = q; }
            }
            if (!best) return false;
            P = conn.slip = { prey: best.id, key: best.key, lead: m.id, since: t, startTick: S.tick };
            hud.flash('slip-through: going between ' + (best.name || 'their') + ' pieces for a ' + Math.round(mass(best.s)));
        }
        const q = conn.cells.get(P.prey);
        if (!q || !canEat(m.s, q.s)) { conn.slip = null; conn.slipOffUntil = t + 1500; return false; }
        const owners = S.enemies.filter(e => e.key === P.key && e.id !== q.id);
        if (owners.some(e => e.fresh && S.tick - e.born < 15)) { conn.mode = 'slip-through: waiting (they just split, the lane is shut for half a second)'; return false; }
        if (owners.some(canSplitOnUs)) { hud.flash('slip-through: off (they can split onto us now)'); conn.slip = null; conn.slipOffUntil = t + 3000; return false; }
        // every cell that could eat us, with where it will be; viruses that would pop us
        const eaters = S.enemies.filter(e => !isAlly(e) && !conn.mateKeys.has(e.key) && e.id !== q.id && canEat(e.s, m.s) && Math.hypot(e.x - m.x, e.y - m.y) < e.s + 1500);
        const pops = S.mine.length < GAME.maxCells ? S.viruses.filter(v => canEat(m.s, v.s) && Math.hypot(v.x - m.x, v.y - m.y) < m.s + 600) : [];
        const sp = moveSpeed(m.s), K = 6, qp = predict(q, K + lag, S.tick);
        let bestH = null, bestD = Infinity;
        for (let i = 0; i < 48; i++) {
            const a = i / 48 * 2 * Math.PI, ux = Math.cos(a), uy = Math.sin(a);
            let ok = true;
            for (let k = 1; k <= K && ok; k++) {
                const px = m.x + ux * sp * k, py = m.y + uy * sp * k;
                for (const e of eaters) {
                    // WORST CASE (live 2026-10-25: 21 of 63 deaths were slips - the target turned its big piece onto us):
                    // players have no momentum either, so from where it is now it can come straight at us at full speed
                    // every tick of our lag and of the step. Only a lane wider than that is a lane.
                    // ...but a human needs ~CFG.slipReactTicks to see us and turn: until then they carry on as they were.
                    // One already coming at us has reacted. So: their velocity for the unreacted part, full speed at us after.
                    const es = moveSpeed(e.s), T = k + lag;
                    const coming = closingOn(e, m) > es * 0.5;
                    const exposed = coming ? T : Math.max(0, Math.min(T, S.tick - P.startTick + T - CFG.slipReactTicks));
                    const ep = predict(e, T - exposed, S.tick);
                    if (Math.hypot(px - ep.x, py - ep.y) <= e.s - m.s / GAME.eatOverlapDiv + es * exposed + CFG.slipMargin) { ok = false; break; }
                }
                if (ok) for (const v of pops) if (Math.hypot(px - v.x, py - v.y) <= m.s - v.s / GAME.eatOverlapDiv + 20) { ok = false; break; }
            }
            if (!ok) continue;
            const d = Math.hypot(m.x + ux * sp * K - qp.x, m.y + uy * sp * K - qp.y);
            if (d < bestD) { bestD = d; bestH = { x: ux, y: uy }; }
        }
        const dNow = Math.hypot(m.x - qp.x, m.y - qp.y);
        if (!bestH || bestD > dNow + sp * 2) {   // no safe step that keeps us closing in: let the normal logic take over
            // and leave this player alone for a while: retrying every 2 s kept us loitering beside it (sim: eaten when its pieces merged)
            (conn.slipBan || (conn.slipBan = new Map())).set(P.key, t + CFG.slipBanMs);
            hud.flash('slip-through: no safe lane'); conn.slip = null; conn.slipOffUntil = t + 2000; return false;
        }
        // close enough to land on it: aim at it exactly (the server moves us at most a step toward the mouse)
        const aim = bestD < sp * K && dNow < sp * 3 ? { x: qp.x, y: qp.y } : { x: m.x + bestH.x * 400, y: m.y + bestH.y * 400 };
        conn.sendMouse(aim.x, aim.y); conn.botAim = aim;
        // consolidate on the way: every piece shoots toward the mouse; a press pays when the blobs flying through the
        // lead (from pieces behind it) outweigh the ones that miss it (the lead's own go forward and are lost)
        let fed = 0;
        // (only while still far from them: the lead's own blobs land short of the enemy and we walk over them)
        const farOff = eaters.every(e => Math.hypot(e.x - m.x, e.y - m.y) - e.s > 950) && Math.hypot(q.x - m.x, q.y - m.y) - q.s > 950;
        if (CFG.slipFeed && S.mine.length > 1 && farOff) {
            let gain = 0, loss = 0;
            for (const c of S.mine) {
                if (c.s < GAME.minEjectSize) continue;
                if (c === m) { loss++; continue; }
                const dx = aim.x - c.x, dy = aim.y - c.y, dl = Math.hypot(dx, dy) || 1;
                const sx = c.x + dx / dl * c.s, sy = c.y + dy / dl * c.s;
                // blobs spread +-17 deg: only count it when the lead is close ahead on its line (within 400) and the
                // line goes through its middle; the lead is moving, so far shots miss it
                const along = (m.x - sx) * dx / dl + (m.y - sy) * dy / dl;
                if (along > -m.s * 0.5 && along < 400 && segDist(m.x, m.y, sx, sy, sx + dx / dl * 840, sy + dy / dl * 840) < m.s * 0.5 - along * 0.3) gain++; else loss++;
            }
            if (gain > loss && S.tick - (P.shotTick || -9) >= 1) { conn.sendEject(); P.shotTick = S.tick; fed = gain; }
        }
        conn.mode = (fed ? 'slip-through (feeding the lead x' + fed + '): lane to ' : 'slip-through: lane to ') + (q.name || 'a piece') + ' (' + Math.round(mass(q.s)) + ')';
        return true;
    }
    // ---------------------------------------------------------------- pack tactics (the user, 2026-10-22; server maths)
    // How long a piece of theirs stays locked apart: the server lets a piece merge once its own age reaches the merge
    // time plus half its size in ticks (bigger pieces wait longer). From when we saw it born, else their last split/pop.
    function pieceLockLeft(S, e) {
        const o = S.conn.owners.get(e.key);
        const from = e.fresh && e.born > -1e8 ? e.born : (o ? o.splitTick : -1e9);
        return from + MERGE_TICKS(e.s) - S.tick;
    }
    // EXACT-REACH BAIT (strategy 8): a giant whose halves our teammate can eat, but whose halves could eat us. We park
    // just outside its exact split reach on the line to the teammate (cells have no momentum: we stop exactly there).
    // If it splits at us its halves fly toward our teammate, who eats them (they're then locked apart).
    // how fast cell e is coming at point p (units a tick; 0 when it's moving away or we don't know)
    const closingOn = (e, p) => { if (!e.vx && !e.vy) return 0; const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1; return Math.max(0, ((e.vx || 0) * dx + (e.vy || 0) * dy) / d); };
    function stepReachBait(conn, S) {
        if (!CFG.reachBait || !CFG.bot || !S.squad.length || S.mine.length > 2) { conn.rbait = null; return false; }
        const t = now(), big = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        if (conn.rbait && t > conn.rbait.until) { conn.rbait = null; conn.rbaitOffUntil = t + CFG.reachBaitCooldownMs; }
        if (!conn.rbait && (t < (conn.rbaitOffUntil || 0) || conn.tick % 4)) return false;
        const hostile = e => e.player && !e.remote && !isAlly(e) && !conn.mateKeys.has(e.key);
        let G = conn.rbait ? conn.cells.get(conn.rbait.g) : null, mate = conn.rbait ? S.squad.find(m => m.from === conn.rbait.mate) : null;
        if (!G || !mate) {
            G = null; mate = null; let bs = 0;
            for (const e of S.enemies) {
                if (!hostile(e) || (S.ownerCount.get(e.key) || 1) >= GAME.maxCells || e.s < GAME.minSplitSize) continue;
                const half = e.s / SQRT2;
                if (!canEat(half, big.s) || Math.hypot(e.x - big.x, e.y - big.y) > 2600) continue;
                if (moveSpeed(big.s) < moveSpeed(e.s) * CFG.reachBaitSpeed) continue;   // we must out-walk it
                if (closingOn(e, big) > 1.5 || S.squad.some(m => m.cells.length && closingOn(e, memberCenter(m)) > 1.5)) continue;   // it's chasing one of us: that's the escape code's job
                for (const m of S.squad) {
                    if (!m.cells.length || !canEat(memberBig(m), half * CFG.eatMargin)) continue;
                    const mc = memberCenter(m);
                    if (Math.hypot(mc.x - e.x, mc.y - e.y) > 2400) continue;
                    if (canEat(e.s, memberBig(m)) && Math.hypot(mc.x - e.x, mc.y - e.y) < e.s + 400) continue;
                    const sc = mass(half);
                    if (sc > bs) { bs = sc; G = e; mate = m; }
                }
            }
            if (!G) return false;
            // nobody else around who could eat us while we stand still
            if (S.enemies.some(e => hostile(e) && e.key !== G.key && canEat(e.s, big.s) && Math.hypot(e.x - big.x, e.y - big.y) - e.s < 1500)) return false;
            conn.rbait = { g: G.id, mate: mate.from, until: t + CFG.reachBaitMs };
            hud.flash('bait: sitting just outside ' + (G.name || 'a giant') + "'s split reach for " + (mate.name || 'our teammate'));
        }
        // it split (fast pieces) or our teammate can no longer eat its halves: done - getting away is the escape code's job
        const fast = S.enemies.some(e => e.key === G.key && isFast(e.vx, e.vy, e.s));
        if (fast || !mate.cells.length || !canEat(memberBig(mate), G.s / SQRT2 * CFG.eatMargin)) {
            if (fast) hud.flash('bait: they split - teammate, eat the halves');
            conn.rbait = null; conn.rbaitOffUntil = t + CFG.reachBaitCooldownMs; return false;
        }
        const oc = S.ownerCount.get(G.key) || 1, reach = enemySplitReach(G, big.s, oc);
        // it came for us, or we're inside its reach already: stop baiting, get away
        if (closingOn(G, big) > 1.5 || Math.hypot(G.x - big.x, G.y - big.y) < reach + CFG.reachBaitGap * 0.4) {
            hud.flash('bait: off (it is coming for us)'); conn.rbait = null; conn.rbaitOffUntil = t + CFG.reachBaitCooldownMs; return false;
        }
        const mc = memberCenter(mate), dx = mc.x - G.x, dy = mc.y - G.y, dl = Math.hypot(dx, dy) || 1;
        const gp = predict(G, S.L, S.tick);
        const P = { x: gp.x + dx / dl * (reach + CFG.reachBaitGap), y: gp.y + dy / dl * (reach + CFG.reachBaitGap) };
        conn.sendMouse(P.x, P.y); conn.botAim = P;
        conn.mode = 'bait: just outside ' + (G.name || 'the giant') + "'s split reach, " + (mate.name || 'teammate') + ' behind us';
        return true;
    }
    // CROSSFIRE (strategy 10): a teammate is feeding a virus into a big player; we join on the same line (the new virus
    // flies along the last blob that hit it, so both of us on that line keep the aim and it goes off twice as fast)
    function joinMateShot(S) {
        if (!CFG.crossfire) return null;
        const shooters = S.mine.filter(c => c.s >= GAME.minEjectSize);
        if (!shooters.length || shooters.length > 4) return null;
        const M = shooters.reduce((a, b) => (b.s > a.s ? b : a)), t = now();
        for (const m of S.squad) {
            if (!m.vshot || !m.cells.length) continue;
            const v = S.conn.cells.get(m.vshot.v), T = S.conn.cells.get(m.vshot.t);
            if (!v || !T || (S.conn.vshotBan.get(v.id) || 0) > t) continue;
            if (S.mine.some(c => c !== M && canEat(c.s, v.s))) continue;
            const dMV = Math.hypot(v.x - M.x, v.y - M.y);
            if (dMV > 1400 + M.s) continue;
            const reachMs = 800 + dMV / moveSpeed(M.s) * GAME.tickMs;
            return { score: 1, vId: v.id, tId: T.id, until: t + reachMs + 2000, alignBy: t + reachMs, vSize: v.s, startSize: v.s, shots: 0, firing: false, join: true };
        }
        return null;
    }
    const virusBanned = (conn, v) => { const u = conn.vBan && conn.vBan.get(v.id); return !!u && now() < u; };
    // MINING - the user's loop (2026-10-20): at 2300+ (keep going down to 2000), aim at the NEAREST virus and fire at it
    // while walking onto it; eating it pops us - fine, popped all the way is the goal (then viruses are only food).
    // Each 5 hits spit out a new virus (100 mass for ~50 shot): pure gain. Keep feeding the same one until it's eaten,
    // then the next nearest, recursively, until the field is empty; then sweep up the missed blobs. Whole or popped
    // makes no difference. Once started we COMMIT (the user, 2026-10-21): a player coming at us never ends it - we
    // launch a virus or two into them if one is lined up, and keep mining.
    // Sweeping up our missed blobs: go for the NEAREST one (the middle of blobs scattered all round is where we
    // already are - sim 2026-10-27: 30 s "sweeping up 66 missed blobs" standing still while the mass decayed), and give
    // up when nothing has been collected for a few seconds (then they no longer count as ours).
    function sweepAim(conn, S, M, blobs, t) {
        if (M.sweepN === undefined || blobs.length < M.sweepN) { M.sweepN = blobs.length; M.sweepAt = t; }
        if (t - M.sweepAt > CFG.mineSweepIdleMs) { M.sweepGaveUp = true; hud.flash('mining: leaving the rest of our blobs'); return null; }
        const big = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        let best = null, bd = Infinity;
        for (const f of blobs) { const d = Math.hypot(f.x - big.x, f.y - big.y); if (d < bd) { bd = d; best = f; } }
        if (!best) return null;
        // aim through it (a mouse right on it stops us there)
        const dx = best.x - big.x, dy = best.y - big.y, dl = Math.hypot(dx, dy) || 1;
        return { x: best.x + dx / dl * 200, y: best.y + dy / dl * 200 };
    }
    function stepMine(conn, S) {
        if (!CFG.virusFarm || !CFG.bot) { conn.mining = null; return false; }
        if (ordered(S) && S.captain.order.mode !== 'farm') { conn.mining = null; return false; }
        const c0 = S.center, t = now(), big = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        const line = conn.mining ? CFG.mineKeepMass : CFG.mineMinMass;
        const viruses = S.viruses.filter(v => !v.remote && Math.hypot(v.x - c0.x, v.y - c0.y) < CFG.mineRange && wallGap(S, v) > 300);
        const blobs = conn.mining && conn.mining.sweepGaveUp ? [] : S.food.filter(f => f.eject && f.color === conn.myColor && Math.hypot(f.x - c0.x, f.y - c0.y) < 2500);
        // our blobs on the floor are still ours (we sweep them up): count them, so our own shooting can't end the run
        const floor = blobs.reduce((a, f) => a + mass(f.s), 0), eff = S.myMass + floor;
        if (eff < line || (!viruses.length && blobs.length < 3)) { if (conn.mining) hud.flash('mining: done' + (S.myMass < line ? ' (under ' + line + ')' : ' (field empty)')); conn.mining = null; return false; }
        // a player that could eat one of our pieces, within half a viewport: stop (launch a virus into it first if lined up)
        const vb = S.conn.viewBox; const half = (vb ? Math.min(vb.maxX - vb.minX, vb.maxY - vb.minY) : 3000) / 2;
        const small = S.mine.reduce((a, c) => Math.min(a, c.s), Infinity);
        // ('scaled half the viewport TOWARDS us': it has to be coming at us, or already right on top of the field)
        const foe = S.enemies.find(e => { if (!e.player || e.remote || isAlly(e) || conn.mateKeys.has(e.key) || !canEat(e.s, small)) return false;
            const dx = c0.x - e.x, dy = c0.y - e.y, d = Math.hypot(dx, dy) || 1, gap = d - e.s;
            const closing = e.vt >= S.tick - 2 && (e.vx * dx + e.vy * dy) / d > 1.5;
            return gap < 900 || (gap < half && closing); });
        if (!conn.mining) { conn.mining = { since: t, launched: 0 }; hud.flash('mining: ' + viruses.length + ' viruses in reach'); }
        const M = conn.mining;
        if (foe) {
            // a virus between us and the foe, within a launch (880) of it: shoot through it so the new virus flies into them
            const v = viruses.find(v => { const d = Math.hypot(foe.x - v.x, foe.y - v.y) - foe.s; const ang = Math.abs(Math.atan2(v.y - c0.y, v.x - c0.x) - Math.atan2(foe.y - c0.y, foe.x - c0.x)); return d < 850 && d > 0 && Math.min(ang, 2 * Math.PI - ang) < 0.25 && Math.hypot(v.x - c0.x, v.y - c0.y) < 900; });
            if (v && M.launched < 2 && canEat(foe.s, v.s)) {
                const p = predict(foe, S.L + 3, S.tick); conn.sendMouse(p.x, p.y); conn.botAim = p;
                if (S.tick % 2 === 0) { conn.sendEject(); M.shotAt = t; }
                if (!M.launchV || M.launchV !== v.id) { M.launchV = v.id; M.launchN = (M.launchN || 0) + 1; if (M.launchN > 1) M.launched++; }
                conn.mode = 'mining: launching a virus into ' + (foe.name || 'a player');
                return true;
            }
            // (the user, 2026-10-21: once mining, COMMIT - mining is how we get big; a player nearby never ends it)
        }
        if (!viruses.length || (S.myMass < CFG.mineKeepMass && blobs.length >= 3)) {
            // field empty - or we've shot ourselves down to the floor: sweep up what we shot and missed (it's ours)
            const p = sweepAim(conn, S, M, blobs, t);
            if (!p) { conn.mining = null; conn.miningOffUntil = t + 3000; return false; }
            conn.sendMouse(p.x, p.y); conn.botAim = p; conn.mode = 'mining: sweeping up ' + blobs.length + ' missed blobs'; return true;
        }
        // locked onto one virus until it's eaten (gone from view): never switch to another meanwhile
        let v = M.target ? conn.cells.get(M.target) : null;
        if (v && (!v.virus || mineBehind(S.mine, v, M.dir))) v = null;
        if (v) {
            // (the user, 2026-10-27: it walked right up, stopped beside the virus while shooting, and got eaten)
            const atIt = S.mine.some(c => Math.hypot(c.x - v.x, c.y - v.y) - c.s - v.s < 60);
            if (!atIt) M.atSince = 0; else if (!M.atSince) M.atSince = t;
            if (M.atSince && t - M.atSince > CFG.mineParkMs) {
                (conn.vBan || (conn.vBan = new Map())).set(v.id, t + 5000); M.atSince = 0;
                viruses.splice(viruses.indexOf(v), 1); v = null;
            }
        }
        if (!v) {
            // heading: where our cells are actually moving (mass-weighted), else where we were aiming
            let hx = 0, hy = 0; for (const c of S.mine) if (c.vt >= S.tick - 2) { const m = c.s * c.s; hx += (c.vx || 0) * m; hy += (c.vy || 0) * m; }
            if (Math.hypot(hx, hy) < 1e-6 && conn.botAim) { hx = conn.botAim.x - c0.x; hy = conn.botAim.y - c0.y; }
            v = mineNextTarget(S.mine, viruses, { x: hx, y: hy }, M.last);
            if (!v) {   // every virus left is touching us: sweep up our blobs meanwhile (walking on frees them up)
                if (blobs.length) { const p = sweepAim(conn, S, conn.mining, blobs, t); if (!p) { conn.mining = null; conn.miningOffUntil = t + 3000; return false; } conn.sendMouse(p.x, p.y); conn.botAim = p; conn.mode = 'mining: sweeping (viruses all touching us)'; return true; }
                const hl = Math.hypot(hx, hy), p = hl > 1e-6 ? { x: c0.x + hx / hl * 600, y: c0.y + hy / hl * 600 } : { x: c0.x + 600, y: c0.y }; conn.sendMouse(p.x, p.y); conn.botAim = p; conn.mode = 'mining: moving clear of the viruses touching us'; return true;
            }
            M.target = v.id; M.presses = 0;
            // the line we shoot along is fixed when we lock on (from our middle to it): re-aiming from whichever cell
            // is closest made the aim point spin once a cell reached the virus, and the shots sprayed everywhere
            const lx = v.x - c0.x, ly = v.y - c0.y, ll = Math.hypot(lx, ly) || 1; M.dir = { x: lx / ll, y: ly / ll };
        }
        // where it is and the line we shoot along: for picking the one behind it once it's eaten
        M.last = { x: v.x, y: v.y, dx: M.dir.x, dy: M.dir.y };
        const vp = predict(v, S.L, S.tick);
        // too close to the floor to keep firing: never walk on and eat it unshot (the user) - sweep up our blobs, or stop
        if (eff < CFG.mineKeepMass && S.mine.some(c => Math.hypot(c.x - vp.x, c.y - vp.y) < 840)) {
            if (blobs.length >= 3) { const p = sweepAim(conn, S, conn.mining, blobs, t); if (!p) { conn.mining = null; conn.miningOffUntil = t + 3000; return false; } conn.sendMouse(p.x, p.y); conn.botAim = p; conn.mode = 'mining: low, sweeping up ' + blobs.length + ' blobs'; return true; }
            hud.flash('mining: done (too low to keep shooting)'); conn.mining = null; conn.miningOffUntil = t + 3000; return false;
        }
        // walk onto it with the biggest piece (aim through it from that piece: small fast pieces don't sit on it first)
        const eater = S.mine.length >= GAME.maxCells ? big : (canEat(big.s, v.s) ? big : null);
        // aim just past its centre along the fixed line: every piece shoots at the mouse, so a point 400 past made the
        // streams of pieces either side cross beyond the virus and miss it (the user, 2026-10-22); half a virus past,
        // every stream goes through it, and the pieces still walk onto it
        // once a piece is right at it, aim on through (the pieces otherwise pile up on the aim point and jam: we stall)
        const nearEdge = S.mine.reduce((a, c) => Math.min(a, Math.hypot(c.x - vp.x, c.y - vp.y) - c.s - v.s), Infinity);
        const past = nearEdge < CFG.mineAimMin ? CFG.mineFlowPast : v.s * 0.5;
        const aim = { x: vp.x + M.dir.x * past, y: vp.y + M.dir.y * past };
        conn.sendMouse(aim.x, aim.y); conn.botAim = aim;
        // fire while any piece that can shoot is within a blob's flight of it
        // fire only with a margin above the floor (a 16-piece bot shoots 1900 mass/s - most of it lands around the virus
        // and comes back when we sweep, but not before the run would have ended)
        // (the user: retarget without ceasing fire - so once firing, keep firing at the next one even if it is further off)
        const inRange = S.mine.some(c => c.s >= GAME.minEjectSize && Math.hypot(c.x - vp.x, c.y - vp.y) < 840);
        // (no margin above the floor: our blobs on the floor count, shooting is investment - the user)
        const canFire = eff >= CFG.mineKeepMass && S.mine.some(c => c.s >= GAME.minEjectSize) && (inRange || S.tick - (M.lastTick || -99) <= 4);
        if (canFire && S.tick - (M.lastTick || 0) >= CFG.mineShotEveryTicks) { conn.sendEject(); M.lastTick = S.tick; M.presses++; M.shotAt = t; conn.vfShotAt = t; markVirusHit(conn, v.id); }
        conn.mode = 'mining: ' + viruses.length + ' viruses, ' + S.mine.length + ' pieces' + (canFire ? ', firing' : ', closing in');
        return true;
    }
    function stepVirusFarmShoot(conn, S) {
        if (!CFG.virusFarmShoot || !S.virusFarm) { conn.vfTarget = 0; conn.vfDir = undefined; return false; }
        if (ordered(S) && S.captain.order.mode !== 'farm') { conn.vfTarget = 0; return false; }
        if (S.plan && S.plan.trap && S.plan.trap.roles && S.plan.trap.roles[conn.memberId]) { conn.vfTarget = 0; return false; }
        // (was 0.15: popped into pieces, any passing mid-size player crossed it and we left a field of free food)
        if (conn.danger > (conn.vfShooting ? 0.5 : 0.3) * S.myMass + 1) { conn.vfTarget = 0; conn.vfDir = undefined; conn.vfShooting = null; return false; }
        const c0 = S.center;
        const near = S.viruses.filter(x => !x.remote && Math.hypot(x.x - c0.x, x.y - c0.y) < 2600 && wallGap(S, x) > CFG.virusFarmWallGap * 0.8);
        // only viruses one of our pieces can eat (after a pop the pieces can be too small: then there's nothing to farm)
        for (let i = near.length - 1; i >= 0; i--) if (!S.mine.some(c => canEat(c.s, near[i].s * CFG.eatMargin)) || virusBanned(conn, near[i])) near.splice(i, 1);
        if (!near.length && !(S.virusMemory || []).length) { conn.vfTarget = 0; return false; }
        // the ones we shot out and haven't collected (out of view now): still ours to go and get
        for (const m of S.virusMemory || []) if (Math.hypot(m.x - c0.x, m.y - c0.y) < 6000 && wallGap(S, m) > CFG.virusFarmWallGap * 0.8) near.push({ ...m, virus: true, remembered: true });
        if (!near.length) { conn.vfTarget = 0; return false; }
        const dist = x => Math.hypot(x.x - c0.x, x.y - c0.y);
        const bearing = x => Math.atan2(x.y - c0.y, x.x - c0.x);
        // which viruses have already split from our shots (a new virus appearing next to the one we're shooting): those
        // are food; an unshot one gets shot first (the user: popping on an unshot virus throws its multiplication away)
        const shot = conn.vShot || (conn.vShot = new Map());
        { const seen = conn.vSeen || new Set(), cur = new Set(), tg = conn.vfTarget && S.viruses.find(x => x.id === conn.vfTarget);
          for (const v of S.viruses) { cur.add(v.id); if (!seen.has(v.id) && tg && now() - (conn.vfShotAt || 0) < 1500 && Math.hypot(v.x - tg.x, v.y - tg.y) < 1100) shot.set(tg.id, now()); }
          conn.vSeen = cur; for (const [id, at] of shot) if (now() - at > 120000) shot.delete(id); }
        const atMaxP = S.mine.length >= GAME.maxCells;
        const unshot = near.filter(v => !v.remembered && !shot.has(v.id));
        const edible = near.filter(x => !x.remembered && S.mine.some(m => canEat(m.s, x.s)) && virusOurs(conn, x));   // (the user: never eat one we are not shooting)
        // nothing left to shoot (or at the piece limit, where a virus is just 100+ mass): EAT, nearest first, relentlessly
        if ((!unshot.length || atMaxP || S.myMass < CFG.virusFarmShootMinMass) && edible.length) {
            let best = null, bestM = null, bd = Infinity;
            for (const x of edible) for (const m of S.mine) { if (!canEat(m.s, x.s)) continue; const d = Math.hypot(x.x - m.x, x.y - m.y) - m.s; if (d < bd) { bd = d; best = x; bestM = m; } }
            const aim = virusAimFor(conn, S, best, bestM);
            conn.sendMouse(aim.x, aim.y); conn.botAim = aim; conn.vfTarget = 0;
            conn.mode = 'virus farm: eating viruses (' + edible.length + ' left, ' + S.mine.length + ' pieces)';
            return true;
        }
        // below the piece limit: EAT viruses to split up toward 16 pieces (no ejecting => no sprayed-mass mess).
        // At a big cell, eating a virus pops it into pieces; repeat until we're at the limit and viruses are free mass.
        if (false && CFG.virusFarmStyle === 'eat' && S.mine.length < GAME.maxCells) {   // (eating unshot viruses: against the user's rule)
            const big = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
            const eatable = near.filter(v => canEat(big.s, v.s));
            const v = (eatable.length ? eatable : near).reduce((a, x) => (!a || dist(x) < dist(a) ? x : a));
            const aim = virusAimFor(conn, S, v, canEat(big.s, v.s) ? big : null);
            conn.sendMouse(aim.x, aim.y); conn.botAim = aim; conn.vfTarget = v.id;
            conn.mode = 'virus farm: eating viruses to split up (' + S.mine.length + '/' + GAME.maxCells + ')';
            return true;
        }
        // plenty of viruses around: just eat them, nearest first (shooting throws mass away; eating them is free mass)
        {
            const close = near.filter(x => dist(x) < 1500 && S.mine.some(m => canEat(m.s, x.s)));
            if (false && close.length >= CFG.virusFarmShootBelow) {
                // the nearest one to any of our pieces that can eat it
                let best = null, bestM = null, bd = Infinity;
                for (const x of close) for (const m of S.mine) { if (!canEat(m.s, x.s)) continue; const d = Math.hypot(x.x - m.x, x.y - m.y) - m.s; if (d < bd) { bd = d; best = x; bestM = m; } }
                const aim = virusAimFor(conn, S, best, bestM);
                conn.sendMouse(aim.x, aim.y); conn.botAim = aim; conn.vfTarget = 0;
                conn.mode = 'virus farm: eating viruses (' + close.length + ' close, ' + S.mine.length + ' pieces)';
                return true;
            }
        }
        // commit a sweep direction (toward the nearest virus to begin with)
        if (typeof conn.vfDir !== 'number') conn.vfDir = bearing(near.reduce((a, x) => (!a || dist(x) < dist(a) ? x : a)));
        // keep feeding the current virus while it exists; otherwise pick the nearest one in a ~70 deg forward cone
        // (so we keep sweeping the same way), falling back to the nearest overall and swinging the sweep toward it
        let v = conn.vfTarget && (conn.cells.get(conn.vfTarget) || (S.virusMemory || []).map(m => ({ ...m, virus: true, remembered: true })).find(m => m.id === conn.vfTarget));
        if (!v || !v.virus || shot.has(v.id)) {
            // head for where the viruses are packed densest (weighed against distance; a little bonus for the lane)
            let best = null, bs = -Infinity;
            for (const x of unshot.length ? unshot : near) {
                let dense = 0, overlap = 0;
                for (const o of S.viruses) if (o !== x && o.id !== x.id) { const dd = Math.hypot(o.x - x.x, o.y - x.y); if (dd < CFG.virusFarmDenseR) dense++; if (dd < o.s + x.s) overlap++; }
                if (x.remembered) dense += 1.5;   // ours to collect
                // a teammate in the lane to it: only if nothing else is clear
                const bx = x.x - c0.x, by = x.y - c0.y, bl = Math.hypot(bx, by) || 1, ex = x.x + bx / bl * CFG.mineLaneBeyond, ey = x.y + by / bl * CFG.mineLaneBeyond;
                const blocked = S.mates.some(c => segDist(c.x, c.y, c0.x, c0.y, ex, ey) < c.s + CFG.mineLaneWidth);
                // a big player beyond it on our line through it, inside a launched virus's reach: shoot the virus into it
                let shot = 0, shotAt = null;
                { const ux = bx / bl, uy = by / bl;
                  for (const T of S.enemies) {
                      if (T.remote || !canEat(T.s, x.s) || T.s < 180 || (S.ownerCount.get(T.key) || 1) >= GAME.maxCells) continue;
                      const along = (T.x - x.x) * ux + (T.y - x.y) * uy, perp = Math.abs((T.x - x.x) * uy - (T.y - x.y) * ux);
                      if (along <= 0 || along > GAME.virusSplitBoost * 0.9 + T.s || perp > T.s * 0.8) continue;
                      const b = CFG.virusShotBonus + mass(T.s) * 0.3;
                      if (b > shot) { shot = b; shotAt = T; }
                  } }
                x.shotAt = shotAt;
                const sc = dense * CFG.virusFarmDenseWeight + overlap * CFG.virusOverlapBonus + shot - dist(x) + (angDiff(bearing(x), conn.vfDir) <= 0.79 ? 300 : 0) - (blocked ? 100000 : 0);
                if (sc > bs) { bs = sc; best = x; }
            }
            v = best; conn.vfDir = bearing(v);
            conn.vfTarget = v.id;
            conn.vfShooting = best.shotAt ? { id: best.shotAt.id, name: best.shotAt.name || '' } : null;
        }
        // always feed it: aim at the virus and shoot every tick. Blobs feed it until it splits; the new virus
        // launches on past it (down our lane), and we move through to eat the pieces. Continuous, one direction.
        // aim past it on the same line: full speed through it, shots down the lane
        const vp = v.remembered ? { x: v.x, y: v.y } : predict(v, S.L, S.tick);
        const lx = vp.x - c0.x, ly = vp.y - c0.y, ll = Math.hypot(lx, ly) || 1;
        // collecting (not shooting): right on it, so our pieces converge onto it and eat it; shooting: past it, full speed
        // SHOOT FROM A STANDOFF, never run through it (the user: popping on an unshot virus throws its multiplication away):
        // come within fire range, then hold with the mouse just ahead of our shooter toward the virus - the cell barely
        // moves, the shots fly at it. It gets eaten only once it has split (the eat path above).
        const shooter = S.mine.reduce((a2, c) => (c.s > a2.s ? c : a2));
        const gapV = Math.hypot(vp.x - shooter.x, vp.y - shooter.y) - shooter.s - v.s;
        let aim;
        if (gapV < CFG.virusFarmFireRange * 0.8) { const sx = vp.x - shooter.x, sy = vp.y - shooter.y, sl = Math.hypot(sx, sy) || 1; aim = { x: shooter.x + sx / sl * 40, y: shooter.y + sy / sl * 40 }; }
        else aim = { x: vp.x, y: vp.y };
        const past = 0;
        if (!past) {
            const eater = S.mine.filter(c => canEat(c.s, v.s)).reduce((a, c) => (!a || Math.hypot(c.x - vp.x, c.y - vp.y) < Math.hypot(a.x - vp.x, a.y - vp.y) ? c : a), null);
            aim = virusAimFor(conn, S, v, eater);
        }
        const shotT = conn.vfShooting && conn.cells.get(conn.vfShooting.id);
        if (shotT) { // the shots push the virus toward where we aim: aim at the big player, through the virus
            const tx = shotT.x - vp.x, ty = shotT.y - vp.y, tl = Math.hypot(tx, ty) || 1;
            aim = { x: vp.x + tx / tl * CFG.virusFarmAimPast, y: vp.y + ty / tl * CFG.virusFarmAimPast };
        } else conn.vfShooting = null;
        // our lane - from us through the virus and on past it (where new viruses launch) - goes out to the team
        const lane = [Math.round(c0.x), Math.round(c0.y), Math.round(vp.x + lx / ll * CFG.mineLaneBeyond), Math.round(vp.y + ly / ll * CFG.mineLaneBeyond)];
        conn.mineLane = { seg: lane, at: now() };
        // a teammate in the lane: hold short of the virus, no shooting, until it has stepped out
        const mining = new Set(S.squad.filter(m => m.mineLane).map(m => m.key));
        const inLane = S.mates.filter(c => !mining.has(c.key) && segDist(c.x, c.y, lane[0], lane[1], lane[2], lane[3]) < c.s + CFG.mineLaneWidth);
        if (inLane.length && !(conn.mineWaitSince && now() - conn.mineWaitSince > 2000)) {
            if (!conn.mineWaitSince) conn.mineWaitSince = now();
            const stop = Math.max(0, ll - v.s - S.maxMine - 250);
            const hold = { x: c0.x + lx / ll * Math.min(stop, 200), y: c0.y + ly / ll * Math.min(stop, 200) };
            conn.sendMouse(hold.x, hold.y); conn.botAim = hold;
            const who = S.squad.find(m => m.key === inLane[0].key);
            conn.mode = 'virus farm: waiting for ' + ((who && who.name) || 'a teammate') + ' to clear the lane';
            return true;
        }
        if (inLane.length) { conn.vfTarget = 0; conn.mineWaitSince = 0; }   // waited long enough: another virus next time
        else conn.mineWaitSince = 0;
        // never into a teammate's main piece (we'd eat it, or it us): go round it
        {
            const myBigF = S.mine.reduce((a2, c) => (c.s > a2.s ? c : a2));
            for (const m of S.squad) {
                const cells = S.mates.filter(c => c.key === m.key); if (!cells.length) continue;
                const main = cells.reduce((a2, c) => (c.s > a2.s ? c : a2));
                if (!S.mine.some(q => canEat(q.s, main.s * 0.95)) && !canEat(main.s, myBigF.s * 0.95)) continue;
                const d = Math.hypot(main.x - myBigF.x, main.y - myBigF.y);
                if (segDist(main.x, main.y, myBigF.x, myBigF.y, aim.x, aim.y) < myBigF.s + main.s * 0.4 + 80 || d < myBigF.s + main.s + 60) {
                    const ax = (myBigF.x - main.x) / (d || 1), ay = (myBigF.y - main.y) / (d || 1);
                    aim = { x: myBigF.x + ax * 500 + (aim.x - myBigF.x) * 0.3, y: myBigF.y + ay * 500 + (aim.y - myBigF.y) * 0.3 };
                    break;
                }
            }
        }
        conn.sendMouse(aim.x, aim.y);
        const closeEnough = S.mine.some(c => Math.hypot(c.x - vp.x, c.y - vp.y) - c.s - v.s < CFG.virusFarmFireRange);
        // shoot only while at least half our pieces can still eat a virus (else we couldn't collect what we make)
        const eaters = S.mine.filter(c => canEat(c.s, GAME.virusSize * 1.15 * CFG.eatMargin)).length;
        // the server ignores shots into viruses while the map is at its virus cap (virusMaxCount): the shots just lie
        // there (the user: "they try to farm, it doesn't work, they leave their ejected waste behind"). If the virus we're
        // shooting hasn't grown after a burst, the map is full: stop shooting for a while (collect the blobs instead).
        const vNow = conn.cells.get(v.id);
        if (conn.vCapCheck && conn.vCapCheck.id === v.id && vNow) {
            if (vNow.s > conn.vCapCheck.s + 3) conn.vCapCheck = null;                                       // it grew: feeding works
            else if ((conn.vfShots || 0) - conn.vCapCheck.shots >= 25) { if (CFG.virusCap) conn.virusCapUntil = now() + CFG.virusCapPauseMs; conn.vCapCheck = null; hud.flash('this virus is not taking our shots: leaving it for a while'); }
        } else if (vNow) conn.vCapCheck = { id: v.id, s: vNow.s, shots: conn.vfShots || 0 };
        const capped = now() < (conn.virusCapUntil || 0);
        if (capped) {
            // our shots lying around: pick them up before anything else (mining steers us itself, so the general pull can't)
            let bx = 0, by = 0, bm = 0;
            for (const f of S.food) { if (!f.eject || f.color !== conn.myColor) continue; const d = Math.hypot(f.x - c0.x, f.y - c0.y); if (d > 2000) continue; const fm = mass(f.s); bx += f.x * fm; by += f.y * fm; bm += fm; }
            if (bm >= 50) return false;      // normal steering collects them (it steers round viruses; a straight aim here popped us on one)
        }
        // LIVE: a blob is 10 mass, every piece shoots on every press, presses go every tick. In 16 pieces that's 4000
        // mass a second into a virus that needs 5 hits (the user watched a 5000 bot shoot itself down to 900). So: feed
        // viruses only while WHOLE (1-2 pieces: 10-20 mass a press), one press every few ticks, a hard cap per virus.
        const vpress = conn.vPress || (conn.vPress = new Map());
        const pressed = vpress.get(v.id) || 0;
        if (pressed >= CFG.virusMaxPresses) { (conn.vBan || (conn.vBan = new Map())).set(v.id, now() + CFG.virusBanMs); conn.vfTarget = 0; }
        const canShoot = !capped && S.mine.length <= CFG.virusShootMaxPieces && pressed < CFG.virusMaxPresses && S.tick - (conn.vfLastShotTick || 0) >= CFG.virusShotEveryTicks && S.myMass >= CFG.virusFarmShootMinMass && !S.virusCollect && eaters >= Math.max(1, S.mine.length / 2);
        if (closeEnough && canShoot && S.mine.some(c => c.s >= GAME.minEjectSize)) { conn.vfShots = (conn.vfShots || 0) + 1; conn.vfLastShotTick = S.tick; vpress.set(v.id, pressed + 1); conn.sendEject(); conn.vfShotAt = now(); markVirusHit(conn, v.id); conn.vfShotPos = { x: vp.x, y: vp.y }; }
        conn.botAim = aim;
        conn.mode = !canShoot ? 'virus farm: collecting viruses' : shotT ? 'virus farm: shooting viruses at ' + (conn.vfShooting.name || 'a big one') : closeEnough ? 'virus farm: feeding viruses (' + S.mine.length + ' pieces)' : v.remembered ? 'virus farm: going back for the viruses we shot' : 'virus farm: running to a virus';
        return true;
    }

    // The best thing in view our biggest piece can eat: worth its mass, scaled by how catchable it is and how far.
    function bestHunt(S) {
        if (S.huntCache !== undefined) return S.huntCache;
        const big = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        const mySp = moveSpeed(big.s);
        // our typical piece: when we're split, that's what the chase exposes (the user: 'our biggest piece is the same size
        // as their whole self - it still chases, and they eat all our little bits')
        const szs = S.mine.map(c => c.s).sort((a, b) => a - b), typ = szs[Math.floor(szs.length / 2)];
        let best = null;
        for (const e of S.enemies) {
            if (e.remote || isAlly(e) || e.feeding || !canEat(big.s, e.s * CFG.eatMargin)) continue;
            // anything at the target (its own other cells, its teammate, the target itself) that eats our typical piece: no
            // (a player at 16 pieces can't split: its own big pieces only threaten by walking - the lane between them is safe)
            const walker = o => o.key === e.key && (S.ownerCount.get(o.key) || 1) >= GAME.maxCells;
            if (S.enemies.some(o => !o.remote && canEat(o.s, typ * 0.97) && Math.hypot(o.x - e.x, o.y - e.y) < o.s + e.s + (walker(o) ? 150 : 700))) continue;
            const m = mass(e.s);
            if (m < Math.max(150, CFG.huntMinFrac * S.myMass)) continue;
            const d = Math.hypot(e.x - S.center.x, e.y - S.center.y);
            // catchable: slower than us, or not much faster; a split (half our size can eat it) reaches further
            const catchK = Math.max(0.25, Math.min(1.3, mySp / moveSpeed(e.s))) * (canEat(big.s / SQRT2, e.s * CFG.eatMargin) ? 1.3 : 1);
            // pinned: the server stops a cell half its size from the border, so at a wall its way out is halved, in a corner quartered
            let pinK = 1;
            if (S.border) { const b = S.border, nx = Math.min(e.x - b.minX, b.maxX - e.x) < CFG.pinWallDist, ny = Math.min(e.y - b.minY, b.maxY - e.y) < CFG.pinWallDist;
                pinK = nx && ny ? CFG.cornerHuntMult : nx || ny ? CFG.wallHuntMult : 1; }
            const maxK = (S.ownerCount.get(e.key) || 1) >= GAME.maxCells ? CFG.maxPieceHuntMult : 1;   // can't split away from us
            const w = CFG.huntPull * m * catchK * lockBonus(S, e.key, e) * pinK * maxK * (isFoe(e) ? CFG.foeHuntMult : 1) / (1 + d / 2500);
            if (!best || w > best.w) best = { e, w, m, d };
        }
        return S.huntCache = best;
    }

    // ---------------------------------------------------------------- the pump kill
    // How a donor gives: whole (the anchor can eat it) or in k splits (pieces the anchor can eat).
    function pumpSplits(donorBigS, anchorS) {
        for (let k = 0; k <= 4; k++) if (canEat(anchorS, donorBigS / Math.pow(SQRT2, k) * CFG.eatMargin)) return k;
        return -1;
    }
    function findPump(conn, S) {
        if (!S.squad.length || S.mine.length > 3) return null;
        const A = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        let best = null;
        for (const T of S.enemies) {
            // a much bigger player: one that could eat one of us (us, or a teammate close by), that we can't eat yet
            if (T.remote || canEat(A.s, T.s)) continue;
            if (!canEat(T.s, A.s) && !S.squad.some(m => m.cells.length && canEat(T.s, memberBig(m)) && Math.hypot(memberCenter(m).x - T.x, memberCenter(m).y - T.y) < T.s + 2000)) continue;
            // a teammate that could eat it on its own: that's a normal kill, not a pump
            if (S.squad.some(m => m.cells.length && canEat(memberBig(m), T.s * CFG.eatMargin))) continue;
            const d = Math.hypot(T.x - A.x, T.y - A.y);
            if (d > T.s + A.s + 1500) continue;
            if (canEat(T.s / SQRT2, A.s * 0.97)) continue;                      // it could split-kill us while we wait: no
            // nobody else near that could join in
            if (S.enemies.some(o => o !== T && o.key !== T.key && canEat(o.s, A.s * 0.9) && Math.hypot(o.x - A.x, o.y - A.y) < o.s + 1300)) continue;
            const donors = [];
            let add = 0;
            for (const m of S.squad) {
                if (!m.cells.length || (m.danger || 0) > 0.2 * m.mass) continue;
                const mc = memberCenter(m), md = Math.hypot(mc.x - A.x, mc.y - A.y);
                if (md > CFG.pumpReach + A.s) continue;
                if (m.mass > S.myMass) continue;   // the one that grows is the biggest of us (a bigger teammate plans its own)
                const k = pumpSplits(memberBig(m), A.s);
                if (k < 0 || m.cells.length * Math.pow(2, k) > GAME.maxCells) continue;
                donors.push({ id: m.from, k }); add += m.mass * 0.95;
            }
            if (!donors.length) continue;
            const newS = Math.sqrt(A.s * A.s + add * 100);
            // big enough with margin, and able to eat it from where we safely wait (no chase after)
            if (!canEat(newS, T.s * CFG.eatMargin * 1.02)) continue;
            // safeD: as close as we can wait (no limit if it can't eat us); strikeD: where our new size eats it
            const safeD = canEat(T.s, A.s * 0.97) ? T.s - A.s / GAME.eatOverlapDiv + 35 : 0, strikeD = newS - T.s / GAME.eatOverlapDiv - 20;
            if (strikeD <= safeD + 20) continue;
            const gain = mass(T.s);
            if (!best || gain > best.gain) best = { target: T.id, tname: T.name || '', anchor: conn.memberId, donors, newS: Math.round(newS), safeD: Math.round(safeD), strikeD: Math.round(strikeD), gain };
        }
        return best;
    }
    function stepPump(conn, S) {
        const t = now();
        // a donor in someone else's plan?
        const lead = S.squad.find(m => m.pump && m.pump.donors && m.pump.donors.some(d => d.id === conn.memberId));
        if (lead && !(conn.pump && conn.pump.plan.anchor === conn.memberId)) return pumpDonor(conn, S, lead, lead.pump);
        // our own plan (as the anchor)
        if (!conn.pump || t - conn.pump.at > 700) {
            if (S.tick % 5) return false;
            if (!moves.allowed('pump kill')) { conn.pump = null; return false; }
            const plan = findPump(conn, S);
            if (!plan) { conn.pump = null; return false; }
            conn.pump = { plan: { ...plan, phase: 'stage', t0: Date.now() }, at: t };
            hud.flash('team: pump kill on ' + (plan.tname || 'a big one') + ' (' + plan.donors.length + ' giving)');
            teamlog.start(conn, S, 'pump kill', { prey: plan.tname, donors: plan.donors.length }, '', '', 6000);
        }
        return pumpAnchor(conn, S);
    }
    function pumpAnchor(conn, S) {
        const t = now(), P = conn.pump.plan;
        const T = conn.cells.get(P.target);
        const A = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        const end = why => { conn.pump = null; if (why) hud.flash('team: pump kill ' + why); return false; };
        if (!T) return end(P.phase === 'go' ? 'done' : 'lost it');
        if (Date.now() - P.t0 > 12000) return end('took too long');
        if (P.phase === 'go') {
            // the mass is coming / has come: once we can eat it, go onto it
            conn.pump.at = t;
            const tp = predict(T, S.L, S.tick);
            if (canEat(A.s, T.s)) { conn.sendMouse(tp.x, tp.y); conn.botAim = tp; conn.mode = 'team: pump kill - eating ' + (P.tname || 'it'); }
            else { // hold (drifting a little away from it - never toward it) until our size arrives
                const dx = A.x - tp.x, dy = A.y - tp.y, dl = Math.hypot(dx, dy) || 1;
                const aim = { x: A.x + dx / dl * 160, y: A.y + dy / dl * 160 };
                conn.sendMouse(aim.x, aim.y); conn.botAim = aim; conn.mode = 'team: pump kill - filling up';
            }
            if (Date.now() - P.goAt > 2500) return end(canEat(A.s, T.s) ? 'ran out of time' : 'mass never came');
            return true;
        }
        // stage: still worth it with what we see now?
        const fresh = findPump(conn, S);
        if (!fresh || fresh.target !== P.target) return end('called off');
        Object.assign(P, { donors: fresh.donors, newS: fresh.newS, safeD: fresh.safeD, strikeD: fresh.strikeD });
        conn.pump.at = t;
        // where will it be when the donations land (~0.3 s for split pieces, longer if a donor must walk in)?
        const walk = P.donors.some(d => d.k === 0);
        const arrive = walk ? 12 : 7;
        const tp = predict(T, S.L + arrive, S.tick);
        const dNow = Math.hypot(T.x - A.x, T.y - A.y), dThen = Math.hypot(tp.x - A.x, tp.y - A.y);
        if (dNow < P.safeD - 10 || dThen < P.safeD - 40) return end('too close - pulling out');
        // everyone in place (touching us on the far side)?
        const ready = P.donors.every(d => { const m = S.squad.find(x => x.from === d.id); if (!m || !m.cells.length) return false;
            const mc = memberCenter(m); return Math.hypot(mc.x - A.x, mc.y - A.y) - A.s - memberBig(m) < 260; });
        if (ready && dThen <= P.strikeD && dThen > P.safeD - 20) {
            P.phase = 'go'; P.goAt = Date.now();
            hud.flash('team: pump kill - GO');
            relayTell(conn, 'split', { seq: 0, stage: 'pump go' });
            return pumpAnchor(conn, S);
        }
        // wait just outside its reach; if it isn't coming, ease toward it (never inside safeD)
        const dx = A.x - T.x, dy = A.y - T.y, dl = Math.hypot(dx, dy) || 1;
        const want = Math.max(P.safeD + 40, Math.min(P.strikeD + 120, dNow));
        const aim = { x: T.x + dx / dl * (want + (dNow > want + 60 ? -150 : 150)), y: T.y + dy / dl * (want + (dNow > want + 60 ? -150 : 150)) };
        conn.sendMouse(aim.x, aim.y); conn.botAim = aim;
        conn.mode = 'team: pump kill - waiting for ' + (P.tname || 'the big one') + (ready ? '' : ' (teammates lining up)');
        return true;
    }
    function pumpDonor(conn, S, lead, P) {
        const ac = memberCenter(lead), aBig = memberBig(lead);
        const T = conn.cells.get(P.target);
        const me = P.donors.find(d => d.id === conn.memberId);
        if (!T || !me) return false;
        const myBig = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        // never into the big one ourselves
        const away = { x: ac.x - T.x, y: ac.y - T.y }, al = Math.hypot(away.x, away.y) || 1;
        if (P.phase === 'go') {
            // into the anchor through its far side from the big one (never past the big one's reach)
            const aim = { x: ac.x + away.x / al * aBig * 0.5, y: ac.y + away.y / al * aBig * 0.5 };
            conn.sendMouse(aim.x, aim.y); conn.botAim = aim;
            const k = pumpSplits(myBig.s, aBig);
            // all k splits in the same tick: the pieces launch already small enough for the anchor to eat (one at a time,
            // the first halves were too big for it, flew straight past and into the big one)
            if (k > 0 && !conn.pumpSplitDone && S.mine.length < GAME.maxCells) {
                conn.sendSplit(k); conn.pumpSplitDone = k; conn.pumpSplitAt = now();
                conn.lockUntil = now() + 150; conn.lockTargetId = 0; conn.lockAim = aim;
            }
            conn.mode = 'team: pump kill - giving everything to ' + (lead.name || 'our teammate');
            return true;
        }
        conn.pumpSplitDone = 0;
        // line up touching the anchor on its far side from the big one (spread a little if several of us)
        const idx = P.donors.findIndex(d => d.id === conn.memberId), n = P.donors.length;
        const ang = Math.atan2(away.y, away.x) + (n > 1 ? (idx - (n - 1) / 2) * 0.6 : 0);
        const touch = aBig + myBig.s + (canEat(aBig, myBig.s) ? -(myBig.s / GAME.eatOverlapDiv) + 120 : 60);
        const spot = { x: ac.x + Math.cos(ang) * touch, y: ac.y + Math.sin(ang) * touch };
        conn.sendMouse(spot.x, spot.y); conn.botAim = spot;
        conn.mode = 'team: pump kill - lining up behind ' + (lead.name || 'our teammate');
        return true;
    }

    function stepCounter(conn, S) {
        if (S.mine.length < 2) return false;
        const big = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        let best = null;
        for (const e of S.enemies) {
            if (e.remote || !canEat(big.s, e.s * CFG.eatMargin)) continue;
            const db = Math.hypot(e.x - big.x, e.y - big.y);
            if (db - big.s > 700) continue;
            const small = S.mine.filter(q => q !== big && canEat(e.s, q.s));
            if (!small.length) continue;
            // our biggest leads: nearer to it than every piece it could eat
            if (small.some(q => Math.hypot(e.x - q.x, e.y - q.y) < db)) continue;
            // it's coming (closing on us) or already close
            const ep = predict(e, S.L + 6, S.tick);
            if (Math.hypot(ep.x - big.x, ep.y - big.y) > db + 20 && db - big.s > 250) continue;
            // nobody bigger near our biggest
            if (S.enemies.some(o => o !== e && canEat(o.s, big.s * 0.95) && Math.hypot(o.x - big.x, o.y - big.y) < threatReach(S, o, big.s) + 500)) continue;
            if (!best || db < best.db) best = { e, ep, db };
        }
        if (!best) { conn.counterOn = false; return false; }
        if (!conn.counterOn) { conn.counterOn = true; hud.flash('counter-attack: eating ' + (best.e.name || 'an attacker')); }
        conn.sendMouse(best.ep.x, best.ep.y); conn.botAim = best.ep;
        conn.mode = 'counter-attack: eating ' + (best.e.name || 'an attacker');
        return true;
    }
    // distance from a point to the nearest border
    // close to mining (the user: viruses are food from mineMinMass up): a bot this near it with viruses around keeps
    // its mass - no fast travel, no evening-out feeds - so it reaches the line and mines (mines scene: Lead 2,411 fed
    // Help down to 2,209 and the team never mined at all)
    function nearMine(S) {
        if (!CFG.virusFarm || S.myMass < CFG.mineMinMass * CFG.nearMineFrac) return false;
        // (a field worth stopping the convoy for: 2+ viruses - a lone one gets eaten in passing)
        return S.viruses.filter(v => !v.remote && Math.hypot(v.x - S.center.x, v.y - S.center.y) < 2500).length >= 2 || !!S.conn.virusFarming;
    }
    function wallGap(S, p) { const b = S.border; return b ? Math.min(p.x - b.minX, b.maxX - p.x, p.y - b.minY, b.maxY - p.y) : Infinity; }
    function virusFarmOn(S) {
        // already mining (recently): keep at it unless something could really get at us now
        const keep = S.conn.virusFarming && now() - (S.conn.virusFarmOnAt || 0) < CFG.virusFarmKeepMs;
        const r = virusFarmCheck(S, keep);
        if (r) S.conn.virusFarmOnAt = now();
        return r;
    }
    function virusFarmCheck(S, keep) {
        const why = w => { S.farmOffWhy = w; S.mineCommitted = false; return false; };
        const k = keep ? 0.5 : 1;
        S.mineCommitted = false;
        // the user's rule: a virus is food only from mineMinMass up (then popping breaks us up all the way and we mine
        // relentlessly). Below it, viruses are something to steer round - no mining, collecting or cluster exceptions.
        // once mining, keep going down to mineKeepFrac of the line (relentless; shooting into viruses costs mass)
        const mineLine = S.conn.virusFarming ? CFG.mineKeepMass : CFG.mineMinMass;   // (was 0.8 x 2300 = 1840: under the user's 2000 floor)
        if (S.myMass < mineLine) { S.virusCollect = false; return why('under ' + CFG.mineMinMass + ' mass: viruses are to avoid'); }
        // committed (3.39.0, the user: "they pop, the view widens, they see big players far off and run - leaving a field
        // of easy food"): popped (6+ pieces) right at edible viruses, we stay as long as nobody can actually get a
        // piece soon - touch within mineCommitSecs, or a split they'd really throw at a piece that size. Far-off big
        // players (the wider view after popping shows lots) and teammates being away don't count.
        if (CFG.virusFarm && CFG.dare > 0 && keep && S.mine.length >= 6) {
            const edibleNear = S.viruses.some(v => !v.remote && Math.hypot(v.x - S.center.x, v.y - S.center.y) < 1600 + S.maxMine && S.mine.some(c => canEat(c.s, v.s * CFG.eatMargin)));
            if (edibleNear && wallGap(S, S.center) >= CFG.virusFarmWallGap * 0.5) {
                const pieces = S.mine.map(c => c.s).sort((a, b) => a - b), mid = pieces[Math.floor(pieces.length / 2)];
                for (const e of S.enemies) {
                    if (e.remote || !canEat(e.s, mid)) continue;
                    let dMin = Infinity; for (const c of S.mine) dMin = Math.min(dMin, Math.hypot(e.x - c.x, e.y - c.y) - e.s - c.s / GAME.eatOverlapDiv);
                    const secs = Math.max(0, dMin) / (moveSpeed(e.s) * 1000 / GAME.tickMs);
                    if (secs < CFG.mineCommitSecs * (1.3 - 0.6 * CFG.dare)) return why((e.name || 'someone') + ' about to reach our pieces');
                    const sr = enemySplitReach(e, mid, S.ownerCount.get(e.key) || 1);
                    if (sr > -Infinity && dMin + e.s < sr && splitLikelihood(e, mid, S.ownerCount.get(e.key) || 1, S) >= 0.5) return why('in ' + (e.name || 'someone') + "'s split range");
                }
                S.mineCommitted = true; S.virusCollect = S.myMass < CFG.virusFarmMinMass;
                return true;
            }
        }
        // collecting: viruses right here (or ones we shot) are food whatever our mass - only something on top of us stops it
        {
            const bigEaters = S.enemies.filter(e => e.player && canEat(e.s, S.maxMine * 0.9));
            const clearOf = v => !bigEaters.some(e => Math.hypot(e.x - v.x, e.y - v.y) < e.s + S.maxMine + 900);
            const here = S.viruses.some(v => !v.remote && Math.hypot(v.x - S.center.x, v.y - S.center.y) < 1500 + S.maxMine && clearOf(v)) ||
                (S.virusMemory && S.virusMemory.some(m => Math.hypot(m.x - S.center.x, m.y - S.center.y) < 6000));
            const canEatOne = S.viruses.some(v => !v.remote && Math.hypot(v.x - S.center.x, v.y - S.center.y) < 2600 && S.mine.some(c => canEat(c.s, v.s * CFG.eatMargin)));
            if (here && !canEatOne && !(S.virusMemory && S.virusMemory.length && S.mine.some(c => canEat(c.s, 100 * CFG.eatMargin)))) S.farmOffWhy = 'pieces too small to eat viruses';
            else if (CFG.virusFarm && here && S.myMass >= CFG.virusCollectMinMass && S.myMass < (keep ? Math.min(1200, CFG.virusFarmMinMass) : CFG.virusFarmMinMass) &&
                wallGap(S, S.center) >= CFG.virusFarmWallGap * 0.7) {
                const myBig = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
                const pieces = S.mine.map(c => c.s).sort((a, b) => a - b), mid = pieces[Math.floor(pieces.length / 2)];
                for (const e of S.enemies) {
                    const d = Math.hypot(e.x - S.center.x, e.y - S.center.y);
                    if (canEat(e.s, myBig.s * 0.9) && d < e.s + S.maxMine + 600) return why('a big player close by');
                    if (canEat(e.s, mid) && d < e.s + S.maxMine + 250) return why((e.name || 'someone') + ' on top of our pieces');
                    if (canEat(e.s, mid) && !e.remote && d - e.s - S.maxMine < moveSpeed(e.s) * 1000 / GAME.tickMs * 2.5) return why((e.name || 'someone') + ' closing in on our pieces');
                }
                S.virusCollect = true;
                return true;
            }
        }
        // a cluster of overlapping viruses (or ours to collect): worth it from a lower mass, with relaxed margins
        if ((S.virusCluster || (S.virusMemory && S.virusMemory.length)) && S.myMass >= CFG.virusClusterMinMass && !keep) return virusFarmCheck(S, true);
        if (!CFG.virusFarm || S.myMass < (keep ? Math.min(1200, CFG.virusFarmMinMass) : CFG.virusFarmMinMass)) return why('too small to farm');
        if (!S.viruses.some(v => !v.remote && Math.hypot(v.x - S.center.x, v.y - S.center.y) < 2500 && wallGap(S, v) > CFG.virusFarmWallGap) &&
            !(S.virusMemory && S.virusMemory.some(m => Math.hypot(m.x - S.center.x, m.y - S.center.y) < 6000))) return why('no viruses');
        if (wallGap(S, S.center) < CFG.virusFarmWallGap) return why('too near the border');
        // a living teammate far away: regroup first (farming leaves us in pieces for 30 s+, no team play, no DNA)
        { const live = S.squad.filter(m => m.cells.length);
          if (!keep && CFG.teamMeetFirst && live.length && live.every(m => Math.hypot(memberCenter(m).x - S.center.x, memberCenter(m).y - S.center.y) > CFG.virusFarmMateDist)) return why('teammates far'); }
        const piece = Math.sqrt(S.myMass / GAME.maxCells * 100); // about what each piece is after popping to the limit
        // a big player anywhere near: farming leaves us in pieces for 30 s+, and big players split from far away
        const myBig = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        // a big player with a virus between it and us is shielded: it can't come through without popping
        const shielded = e => S.viruses.some(v => !v.remote && canEat(e.s, v.s) && Math.hypot(v.x - S.center.x, v.y - S.center.y) < Math.hypot(e.x - S.center.x, e.y - S.center.y) &&
            segDist(v.x, v.y, e.x, e.y, S.center.x, S.center.y) < v.s + e.s * 0.3);
        const near = e => Math.hypot(e.x - S.center.x, e.y - S.center.y) < e.s + S.maxMine + 350;
        if (S.enemies.some(e => canEat(e.s, myBig.s * 0.9) && Math.hypot(e.x - S.center.x, e.y - S.center.y) < e.s + CFG.virusFarmBigMargin * k && (near(e) || !shielded(e)))) return why('a big player close by');
        // (the user: "it stopped mining because something was in split distance - we were the biggest thing around,
        // nothing was". It judged against an imagined 1/16 piece from our centre, counted players only teammates saw,
        // and any split at all. Now: the pieces we really have once mining, distance to our nearest piece, and only a
        // split they'd really throw.)
        const sorted = S.mine.map(c => c.s).sort((a, b) => a - b);
        const pieceNow = keep && S.mine.length > 1 ? sorted[Math.floor(sorted.length / 2)] : piece;
        for (const e of S.enemies) {
            if (e.remote || isAlly(e) || (S.conn.mateKeys && S.conn.mateKeys.has(e.key))) continue;
            if (!near(e) && shielded(e)) continue;
            let d = Infinity; for (const c of S.mine) d = Math.min(d, Math.hypot(e.x - c.x, e.y - c.y) - c.s + S.maxMine);
            // ("nobody around" = nobody that could get at our pieces soon; 3500 out was never true on a busy server)
            if (canEat(e.s, pieceNow) && d < CFG.virusFarmPieceMargin * k + e.s) return why((e.name || 'someone') + ' near our pieces');
            const oc = S.ownerCount.get(e.key) || 1;
            const sr = enemySplitReach(e, pieceNow, oc);
            if (sr > -Infinity && d < sr + (keep ? 0 : CFG.virusFarmSplitMargin) && splitLikelihood(e, pieceNow, oc, S) >= 0.5) return why('in ' + (e.name || 'someone') + "'s split range");
        }
        return true;
    }

    function centroid(cells) {
        let x = 0, y = 0, m = 0;
        for (const c of cells) { const w = c.s * c.s; x += c.x * w; y += c.y * w; m += w; }
        return m ? { x: x / m, y: y / m } : { x: 0, y: 0 };
    }

    // Where a cell will be in n ticks. Boosting cells decay like the server's boost.
    function predict(c, n, tick) {
        if (c.vt < tick - 1) return { x: c.x, y: c.y };
        // ejected mass, viruses and pellets never steer: they only coast on a decaying boost
        const coasting = !c.player || isFast(c.vx, c.vy, c.s);
        const f = coasting ? R * (1 - Math.pow(R, n)) / (1 - R) : Math.min(n, 30);
        return { x: c.x + c.vx * f, y: c.y + c.vy * f };
    }

    // Leading a feeding shot (3.38.0, the user: "shoot it into our teammate's path, not into the teammate"): a blob
    // starts at our edge and coasts ~880, fast at first and slowing (8/9 per tick), so it takes n ticks to cover D.
    // Aim where the teammate will be after our lag + n ticks; no shot if it can't get there (it would be left behind).
    function leadShot(S, target) {
        const shooters = S.mine.filter(c => c.s >= GAME.minEjectSize);
        if (!shooters.length) return null;
        const src = shooters.reduce((a, c) => (c.s > a.s ? c : a));
        let p = predict(target, S.L, S.tick), n = 0;
        for (let i = 0; i < 4; i++) {
            const reach = Math.hypot(p.x - src.x, p.y - src.y) - src.s - target.s * 0.5;  // to inside their edge
            const frac = reach / GAME.ejectBoost;
            if (frac >= 0.95) return { ok: false, pt: p, n };
            n = frac <= 0 ? 0 : Math.log(1 - frac) / Math.log(GAME.boostDecay);
            p = predict(target, S.L + n, S.tick);
        }
        return { ok: true, pt: p, n };
    }
    // the captain's / carrier's / VIP's biggest cell, live (with its speed) when we can see it
    function capTarget(conn, cap) {
        const r = cap.cells.reduce((a, c) => (c[3] > a[3] ? c : a));
        const live = conn.cells.get(r[0]);
        return live || { x: r[1], y: r[2], s: r[3], vx: 0, vy: 0, vt: -1e9, player: true };
    }
    // feeding a teammate by shooting, safely: every shot pulls us a step toward the mouse, so a cell of ours that could
    // swallow it backs off when it's within feedGap (no shot) - frsim deaths: Help walked into Lead while "feeding" it
    function feedShoot(conn, S, tgt, all, tight) {
        // tight: the small one hovers at our edge on purpose (the user's grow-back) - only back off / hold fire when one
        // of our pieces is actually about to swallow it, not within the usual safety gap
        const gap = tight ? 60 : CFG.feedGap, icept = tight ? 40 : 250;
        // (all: every piece of theirs - the big pair's death: our head rolled over their other crumbs while 'feeding')
        let close = null, from = tgt;
        for (const k of all || [tgt]) for (const c of S.mine) {
            if (canEat(c.s, k.s) && Math.hypot(c.x - k.x, c.y - k.y) < c.s - k.s / GAME.eatOverlapDiv + gap) { close = c; from = k; break; }
            // the other way too: the one we're feeding grows, and our piece next to it becomes its food (frsim death)
            if (canEat(k.s * 1.1, c.s) && Math.hypot(c.x - k.x, c.y - k.y) < k.s * 1.1 - c.s / GAME.eatOverlapDiv + 120) { close = c; from = k; break; }
        }
        // one of our own pieces close to them catches the blobs and grows - then eats them (frsim: 213 -> 332 in half a
        // second, then it swallowed Help): hold fire and move off while any of ours is that close
        if (!close) for (const k of all || [tgt]) for (const c of S.mine) if (canEat(c.s * 1.15, k.s) && Math.hypot(c.x - k.x, c.y - k.y) < c.s + k.s + icept) { close = c; from = k; break; }
        if (close) {
            const d = Math.hypot(close.x - from.x, close.y - from.y) || 1;
            const b = { x: close.x + (close.x - from.x) / d * 600, y: close.y + (close.y - from.y) / d * 600 };
            conn.sendMouse(b.x, b.y); conn.botAim = b;
            return false;
        }
        return shootAt(conn, S, tgt);
    }
    // aim the shot at where the target will be and fire if it can land; false: held fire (mouse still on the lead point)
    function shootAt(conn, S, tgt) {
        const L = leadShot(S, tgt);
        const pt = L ? L.pt : { x: tgt.x, y: tgt.y };
        conn.sendMouse(pt.x, pt.y); conn.botAim = pt;
        if (!L || !L.ok) { conn.heldShots = (conn.heldShots || 0) + 1; return false; }
        conn.sendEject(); conn.ledShots = (conn.ledShots || 0) + 1;
        return true;
    }

    // my cells as simulation pieces, moved forward by the network lead
    function startPieces(S) {
        return S.mine.map(c => {
            const sp = Math.hypot(c.vx, c.vy), ms = moveSpeed(c.s);
            const boosting = sp > ms * 1.5 + 3;
            const p = predict(c, S.L, S.tick);
            return { x: p.x, y: p.y, s: c.s, b: boosting ? (sp - ms) * 9 * Math.pow(R, S.L) : 0,
                bx: boosting ? c.vx / sp : 0, by: boosting ? c.vy / sp : 0, dead: false };
        });
    }

    // the server's split, applied to simulation pieces
    function applySplits(pieces, aim, k) {
        let count = pieces.length;
        for (let step = 0; step < k; step++) {
            const n = pieces.length;
            for (let i = 0; i < n; i++) {
                if (count >= GAME.maxCells) break;
                const p = pieces[i];
                if (p.dead || p.s < GAME.minSplitSize) continue;
                let dx = aim.x - p.x, dy = aim.y - p.y;
                const d = Math.hypot(dx, dy);
                if (d < 1) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
                const ns = p.s / SQRT2;
                p.s = ns;
                pieces.push({ x: p.x + GAME.splitDistance * dx, y: p.y + GAME.splitDistance * dy, s: ns,
                    b: GAME.splitBoost, bx: dx, by: dy, dead: false });
                count++;
            }
        }
        return pieces;
    }

    function movePiece(p, aim, border) {
        if (p.b >= 1) { const d = p.b / 9; p.x += p.bx * d; p.y += p.by * d; p.b -= d; }
        const dx = aim.x - p.x, dy = aim.y - p.y, d = Math.hypot(dx, dy);
        if (d >= 1) { const m = Math.min(moveSpeed(p.s), d); p.x += dx / d * m; p.y += dy / d * m; }
        if (border) {
            p.x = Math.max(border.minX, Math.min(border.maxX, p.x));
            p.y = Math.max(border.minY, Math.min(border.maxY, p.y));
        }
    }

    // ---------------------------------------------------------------- smart split solver
    function worthIt(plan) {
        const need = Math.max(CFG.minGainMass, CFG.minGainFrac * plan.myMass) * (plan.phase === 'big' ? 1.5 : 1);
        return plan.score >= need && plan.risk <= plan.gain * 0.5 && plan.lost <= plan.gain * 0.25;
    }

    function splitPlan(S, currentAim) {
        const { mine, center, myMass, maxMine, tick, L } = S;
        if (maxMine < GAME.minSplitSize || mine.length >= GAME.maxCells) return null;
        const reach = GAME.splitDistance * CFG.maxSplits + GAME.splitBoost + moveSpeed(maxMine) * CFG.simTicks + maxMine;

        const enemies = [], viruses = [], targets = [];
        for (const c of S.viruses) if (Math.hypot(c.x - center.x, c.y - center.y) < reach + 200) viruses.push(c);
        for (const c of S.enemies) {
            const d = Math.hypot(c.x - center.x, c.y - center.y);
            if (d > reach + 1400) continue;
            enemies.push(c);
            if (d > reach || c.remote) continue; // only what we can see ourselves can be locked onto
            if (!canEat(maxMine / SQRT2, c.s)) continue;
            if (CFG.ignoreSameClan && S.myClan && c.clan === S.myClan) continue;
            if (CFG.teamersOnly && !isTeamer(c.key) && !isFoe(c)) continue;
            if (isAlly(c) || isBaitCell(S, c)) continue; // friends aren't food; bait cells are traps
            if (c.feeding) continue;                     // flying into someone else: not ours to get
            // live 2026-10-25: our splits landed 90%+ up to 900 (edge to edge) and 3 in 6 beyond - the target sees it
            // coming and steps aside, leaving us split for nothing. Beyond that only at someone standing still.
            const edge = S.mine.reduce((a, m) => Math.min(a, Math.hypot(c.x - m.x, c.y - m.y) - m.s), Infinity);
            if (edge > CFG.splitMaxEdge && Math.hypot(c.vx || 0, c.vy || 0) > 2) continue;
            targets.push(c);
        }
        if (!targets.length) return null;
        // big cells split only with nobody dangerous around (3.36.0): the user's 55k life ended split into 8-13 pieces
        // next to a team. From bigSplitGuardMass: no split at all with a player of a third of our mass or more within
        // ~2 split lengths; and next to a known teamer never more than 4 pieces in total.
        let maxK = CFG.maxSplits;
        if (myMass >= CFG.bigSplitGuardMass) {
            for (const e of S.enemies) {
                if (!e.player) continue;
                const d = Math.hypot(e.x - center.x, e.y - center.y) - e.s - maxMine;
                const oc = S.ownerCount.get(e.key) || 1;
                if (mass(e.s) * Math.min(oc, 4) >= myMass / 3 && d < 2 * (GAME.splitBoost + 200)) return null;
                if (isTeamer(e.key) && d < 3000) maxK = Math.min(maxK, Math.max(0, Math.floor(Math.log2(4 / Math.max(1, mine.length)))));
            }
            if (maxK < 1) return null;
        }

        // when (if ever) is each enemy cell absorbed by someone else (its teammate)?
        const ctx = { tick, L, enemies, viruses, border: S.border, deadline: new Map() };
        for (const e of enemies) {
            for (const big of enemies) {
                if (big === e || big.key === e.key || !canEat(big.s, e.s)) continue;
                for (let n = 0; n <= CFG.simTicks; n += 2) {
                    const a = predict(e, L + n, tick), b = predict(big, L + n, tick);
                    if (Math.hypot(a.x - b.x, a.y - b.y) <= big.s - e.s / GAME.eatOverlapDiv) {
                        const prev = ctx.deadline.get(e.id);
                        if (prev === undefined || n < prev.n) ctx.deadline.set(e.id, { n, by: big.id });
                        break;
                    }
                }
            }
        }

        const score0 = c => mass(c.s) * (isFoe(c) ? 3 : 1) / (300 + Math.hypot(c.x - center.x, c.y - center.y));
        targets.sort((a, b) => score0(b) - score0(a));
        targets.length = Math.min(targets.length, 10);

        // Pieces stay apart for 30+ s after a split. Big players around could pick them off any time in that
        // window, not just in the 0.8 s the simulation covers: charge for that, per split level.
        const nearBig = S.enemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) < 2600);
        const lingerRisk = k => {
            const piece = maxMine / Math.pow(SQRT2, k);
            let worst = 0;
            for (const e of nearBig) {
                const oc = S.ownerCount.get(e.key) || 1;
                const lk = canEat(e.s, piece) ? 1 : enemySplitReach(e, piece, oc) > -Infinity ? splitLikelihood(e, piece, oc, S) : 0;
                const near = Math.max(0.2, Math.min(1, 1 - (Math.hypot(e.x - center.x, e.y - center.y) - 900) / 1700));
                if (lk * near > worst) worst = lk * near;
            }
            return worst * CFG.lingerRisk * myMass * (S.phase === 'big' ? 1.3 : 1);
        };
        const base = simulateSplit(S, currentAim, 0, ctx);
        const basePenalty = base.lost + CFG.riskWeight * base.risk;
        let best = null;
        for (const tgt of targets) {
            for (let k = 1; k <= maxK; k++) {
                const aimInfo = interceptAim(S, tgt, k, ctx);
                if (!aimInfo) continue;
                const r = simulateSplit(S, aimInfo.aim, k, ctx);
                if (!r.eaten.has(tgt.id) && r.gain <= 0) continue;
                const penalty = Math.max(0, r.lost + CFG.riskWeight * r.risk - basePenalty);
                const score = r.gain * (isFoe(tgt) && r.eaten.has(tgt.id) ? CFG.foeGainMult : 1) - penalty - CFG.splitCostFrac * myMass * k - (r.virus ? myMass : 0) - lingerRisk(k);
                if (!best || score > best.score) {
                    best = { score, gain: r.gain, risk: r.risk, lost: r.lost, k, aim: aimInfo.aim, overshoot: aimInfo.overshoot,
                        targetId: tgt.id, teamer: isTeamer(tgt.key), myMass, eaten: r.eaten.size, phase: S.phase,
                        eatTick: r.eatTick.get(tgt.id) ?? CFG.simTicks };
                }
                if (r.eaten.has(tgt.id) && r.lost === 0) break; // fewer splits already lands it cleanly: stay big
            }
            // the human double split: second press a few ticks later, from the flying half (reaches further)
            if (CFG.delayedDouble && maxK >= 2 && !(best && best.targetId === tgt.id && best.lost === 0 && best.k <= 2)) {
                const aimInfo = interceptAim(S, tgt, 2, ctx);
                if (aimInfo) for (const delay of [4, 8]) {
                    const r = simulateSplit(S, aimInfo.aim, 2, ctx, delay);
                    if (!r.eaten.has(tgt.id)) continue;
                    const penalty = Math.max(0, r.lost + CFG.riskWeight * r.risk - basePenalty);
                    const score = r.gain - penalty - CFG.splitCostFrac * myMass * 2.2 - (r.virus ? myMass : 0) - lingerRisk(2);
                    if (!best || score > best.score)
                        best = { score, gain: r.gain, risk: r.risk, lost: r.lost, k: 1, delay, aim: aimInfo.aim, overshoot: aimInfo.overshoot,
                            targetId: tgt.id, teamer: isTeamer(tgt.key), myMass, eaten: r.eaten.size, phase: S.phase,
                            eatTick: r.eatTick.get(tgt.id) ?? CFG.simTicks };
                }
            }
        }
        // two targets side by side: also aim between them, so our flying pieces can take both at once (the user: "two
        // players the same size next to us - we could have split to eat both at the same time but didn't"; every aim
        // above was at one target, so a pair was only ever eaten by luck)
        if (CFG.pairSplits) {
            for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
                const a = targets[i], b = targets[j];
                if (a.key === b.key && (S.ownerCount.get(a.key) || 1) > 2) continue;      // one split player's pieces: fine, but not 10s of them
                if (Math.hypot(a.x - b.x, a.y - b.y) > a.s + b.s + CFG.pairSplitGap) continue;
                const mid = { id: -1000 - i * 20 - j, key: '', s: Math.max(a.s, b.s), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
                    vx: ((a.vx || 0) + (b.vx || 0)) / 2, vy: ((a.vy || 0) + (b.vy || 0)) / 2, vt: Math.min(a.vt ?? tick, b.vt ?? tick) };
                for (let k = 1; k <= Math.min(2, maxK); k++) for (const far of [0, 800, 2500]) {
                    const ai0 = interceptAim(S, mid, k, ctx);
                    if (!ai0) continue;
                    // each piece splits toward the mouse from where IT is: aiming at the midpoint makes the halves
                    // converge and fly through the gap between the two. Far past it, they fly nearly parallel, each
                    // on its own side (sim: midpoint aims ate nothing)
                    const ddx = ai0.aim.x - center.x, ddy = ai0.aim.y - center.y, ddl = Math.hypot(ddx, ddy) || 1;
                    const aimInfo = { ...ai0, aim: { x: ai0.aim.x + ddx / ddl * far, y: ai0.aim.y + ddy / ddl * far } };
                    const r = simulateSplit(S, aimInfo.aim, k, ctx);
                    const both = r.eaten.has(a.id) && r.eaten.has(b.id);
                    if (!both && r.gain <= 0) continue;
                    const penalty = Math.max(0, r.lost + CFG.riskWeight * r.risk - basePenalty);
                    const score = r.gain - penalty - CFG.splitCostFrac * myMass * k - (r.virus ? myMass : 0) - lingerRisk(k);
                    if (!best || score > best.score) {
                        const main = r.eaten.has(a.id) ? a : b;
                        best = { score, gain: r.gain, risk: r.risk, lost: r.lost, k, aim: aimInfo.aim, overshoot: aimInfo.overshoot,
                            targetId: main.id, teamer: isTeamer(main.key), myMass, eaten: r.eaten.size, phase: S.phase, pair: both,
                            eatTick: r.eatTick.get(main.id) ?? CFG.simTicks };
                    }
                }
            }
        }
        // never through a teammate (3.36.0: a bot's flying piece swallowed the captain): any of our splitting cells'
        // flight line passing over a teammate cell the piece could eat cancels the split
        if (best && S.squad && S.squad.length) {
            const t = now();
            for (const c of mine) {
                const ps = c.s / Math.pow(SQRT2, best.k);
                if (ps < GAME.minSplitSize / SQRT2) continue;
                const dx = best.aim.x - c.x, dy = best.aim.y - c.y, dl = Math.hypot(dx, dy) || 1;
                const len = GAME.splitDistance * best.k + GAME.splitBoost * (1 + (best.delay ? 0.85 : 0)) + c.s;
                const ex = c.x + dx / dl * len, ey = c.y + dy / dl * len;
                for (const m of S.squad) {
                    if (!m.cells || t - m.rx > 1500) continue;
                    for (const r of m.cells) if (canEat(ps, r[3]) && segDist(r[1], r[2], c.x, c.y, ex, ey) < ps + 60) return null;
                }
            }
        }
        return best;
    }

    // Pick the aim point so the front piece meets the target where it will be.
    function interceptAim(S, tgt, k, ctx) {
        const div = Math.pow(SQRT2, k);
        let src = null, bestD = Infinity;
        for (const c of S.mine) {
            if (c.s / Math.pow(SQRT2, k - 1) < GAME.minSplitSize || !canEat(c.s / div, tgt.s)) continue;
            const d = Math.hypot(c.x - tgt.x, c.y - tgt.y);
            if (d < bestD) { bestD = d; src = c; }
        }
        if (!src) return null;
        const ps = src.s / div;
        const sp = predict(src, ctx.L, ctx.tick);
        let aim = null;
        for (let n = 1; n <= CFG.simTicks; n++) {
            const tp = predict(tgt, ctx.L + n, ctx.tick);
            const travel = GAME.splitDistance * k + GAME.splitBoost * (1 - Math.pow(R, n)) + moveSpeed(ps) * n;
            if (travel >= Math.hypot(tp.x - sp.x, tp.y - sp.y) - (ps - tgt.s / GAME.eatOverlapDiv)) { aim = tp; break; }
        }
        if (!aim) aim = predict(tgt, ctx.L + CFG.simTicks, ctx.tick);
        const d = Math.hypot(aim.x - sp.x, aim.y - sp.y) || 1;
        const overshoot = 120;
        return { aim: { x: aim.x + (aim.x - sp.x) / d * overshoot, y: aim.y + (aim.y - sp.y) / d * overshoot }, overshoot };
    }

    // Replays the server's split + boost + move + eat rules for my cells, tick by tick.
    // A piece that touches a bigger enemy mid-flight is eaten (that's the "flew through
    // their big half to reach the small one" suicide), and its mass counts as lost.
    // delay: a human-style double split, the second press `delay` ticks after the first (k must be 2)
    function simulateSplit(S, aim, k, ctx, delay = 0) {
        const { L, tick, enemies, viruses, deadline } = ctx;
        const pieces = applySplits(startPieces(S), aim, delay ? 1 : k);
        const eaten = new Set();
        const eatTick = new Map();
        let gain = 0, lost = 0, virus = false, risk = 0;
        const T = CFG.simTicks;
        // Prey dodges: it keeps its current motion for targetReactTicks, then runs straight away
        // from the nearest piece that can eat it. Boosting cells (fed pieces) keep their boost too.
        // #8 bots re-steer every tick, so they start running immediately
        const reactOf = e => (isBot(e) ? 1 : CFG.targetReactTicks);
        const flee = new Map();
        const b = ctx.border;
        const preyPos = (e, t) => {
            const base = predict(e, L + (isFast(e.vx, e.vy, e.s) ? t : Math.min(t, reactOf(e))), tick);
            const f = flee.get(e.id);
            let x = f ? base.x + f.x : base.x, y = f ? base.y + f.y : base.y;
            // #4 pinned: running away stops at the wall
            if (b) { x = Math.max(b.minX, Math.min(b.maxX, x)); y = Math.max(b.minY, Math.min(b.maxY, y)); }
            return { x, y };
        };
        for (let t = 1; t <= T; t++) {
            if (delay && t === delay) applySplits(pieces, aim, 1); // the flying half splits again, further out
            for (const p of pieces) if (!p.dead) movePiece(p, aim, ctx.border);
            if (k > 0) {
                for (const e of enemies) {
                    if (t <= reactOf(e)) continue;
                    if (eaten.has(e.id)) continue;
                    const ep = preyPos(e, t - 1);
                    let near = null, nd = Infinity;
                    for (const p of pieces) {
                        if (p.dead || !canEat(p.s, e.s)) continue;
                        const d = Math.hypot(ep.x - p.x, ep.y - p.y);
                        if (d < nd) { nd = d; near = p; }
                    }
                    if (!near) continue;
                    const f = flee.get(e.id) || { x: 0, y: 0 }, sp = moveSpeed(e.s), d = nd || 1;
                    f.x += (ep.x - near.x) / d * sp;
                    f.y += (ep.y - near.y) / d * sp;
                    flee.set(e.id, f);
                }
            }
            // deaths first: on the server a bigger cell's eat check can win the same tick
            for (const p of pieces) {
                if (p.dead) continue;
                for (const e of enemies) {
                    if (eaten.has(e.id) || !canEat(e.s, p.s)) continue;
                    const ep = predict(e, L + t, tick);
                    const chase = moveSpeed(e.s) * Math.max(0, t - CFG.enemyReactTicks);
                    if (Math.hypot(p.x - ep.x, p.y - ep.y) - chase <= e.s - p.s / GAME.eatOverlapDiv + CFG.dangerMargin) {
                        p.dead = true;
                        lost += mass(p.s);
                        break;
                    }
                }
            }
            if (k === 0) continue;
            const margin = CFG.splitEatMargin + CFG.marginPerTick * t;
            for (const e of enemies) {
                if (eaten.has(e.id)) continue;
                const dl = deadline.get(e.id);
                if (dl && dl.n < t) continue; // already swallowed by its teammate
                const ep = preyPos(e, t);
                for (const p of pieces) {
                    if (p.dead || !canEat(p.s, e.s)) continue;
                    if (Math.hypot(p.x - ep.x, p.y - ep.y) <= p.s - e.s / GAME.eatOverlapDiv - margin) {
                        p.s = Math.sqrt(p.s * p.s + e.s * e.s);
                        eaten.add(e.id);
                        eatTick.set(e.id, t);
                        gain += mass(e.s) * (isTeamer(e.key) ? CFG.teamerBonus : 1) * lockBonus(S, e.key, e) * revenge(e);
                        break;
                    }
                }
            }
            for (const v of viruses) {
                for (const p of pieces) {
                    if (!p.dead && canEat(p.s, v.s) &&
                        Math.hypot(p.x - v.x, p.y - v.y) <= p.s - v.s / GAME.eatOverlapDiv + CFG.virusMargin * 0.5) virus = true;
                }
            }
            // a split that would swallow a master is as bad as one into a virus (rejected)
            for (const m of S.masters) for (const p of pieces)
                if (!p.dead && canEat(p.s, m.s) && Math.hypot(p.x - m.x, p.y - m.y) <= p.s - m.s / GAME.eatOverlapDiv + 30) virus = true;
            // ...and so is one that swallows a mate who didn't ask for it
            // (a teammate's spare pieces are fair game; only its biggest one counts)
            for (const m of S.mates) if (!S.mergeKeys.has(m.key) && !(S.poolKeys.has(m.key) && !(S.mateBiggest && S.mateBiggest.get(m.key) === m.id) && !((S.conn.cells.get(S.mateBiggest.get(m.key)) || m).s * 0.85 < m.s))) for (const p of pieces)
                if (!p.dead && canEat(p.s, m.s) && Math.hypot(p.x - m.x, p.y - m.y) <= p.s - m.s / GAME.eatOverlapDiv + 30) virus = true;
        }

        // Risk: after the move, who can catch each surviving piece? (enemies grow by what their teammates absorb)
        const grown = new Map();
        for (const [id, dl] of deadline) {
            if (eaten.has(id)) continue;
            const e = enemies.find(c => c.id === id);
            if (e) grown.set(dl.by, (grown.get(dl.by) || 0) + e.s * e.s);
        }
        const pieceRisk = new Float64Array(pieces.length);
        for (const e of enemies) {
            if (eaten.has(e.id)) continue;
            const dl = deadline.get(e.id);
            if (dl && dl.n < T) continue;
            const es = Math.sqrt(e.s * e.s + (grown.get(e.id) || 0));
            const ep = predict(e, L + T, tick);
            const chase = moveSpeed(es) * CFG.reactTicks;
            for (let i = 0; i < pieces.length; i++) {
                const p = pieces[i];
                if (p.dead || !canEat(es, p.s)) continue;
                const d = Math.hypot(p.x - ep.x, p.y - ep.y);
                let w = 0;
                if (d <= es - p.s / GAME.eatOverlapDiv + chase) w = 1;
                else if (d <= enemySplitReach({ ...e, s: es }, p.s, S.ownerCount.get(e.key) || 1) + chase) // their single or double split
                    // a teamer (or baiter) guarding the cells we just went for will split: that's the trap
                    w = isTeamer(e.key) || (S.conn.baiters.get(e.key) || 0) > now() ? 1
                        : CFG.splitThreatWeight * splitLikelihood(e, p.s, S.ownerCount.get(e.key) || 1, S);
                if (w * mass(p.s) > pieceRisk[i]) pieceRisk[i] = w * mass(p.s);
            }
        }
        for (const r of pieceRisk) risk += r;
        return { gain, lost, risk, virus, eaten, eatTick };
    }

    // ---------------------------------------------------------------- autopilot: movement
    // Tries CFG.dirs headings, simulates my cells for CFG.horizon ticks, and scores
    // food + prey + virus effects against threat proximity (threats assumed to chase me).
    function evalMove(S, pieces, aim, ctx) {
        const H = CFG.horizon, step = CFG.step;
        const { threats, food, prey, viruses, foodMark, preyMark } = ctx;
        const stamp = ++ctx.stamp;
        const nT = threats.length, nP = pieces.length;
        const worst = new Float64Array(nP * nT);
        const worstMove = new Float64Array(nP * nT);
        const popped = new Uint8Array(nP);
        const virusWorst = new Float64Array(nP);
        const virusTaken = new Set();
        const atMax = nP >= GAME.maxCells;
        let foodGain = 0, preyGain = 0, virusGain = 0, virusCost = 0;
        const startMass = pieces.map(p => mass(p.s));
        const path = CFG.sidestep ? pieces.map(p => [[p.x, p.y]]) : null;   // positions at t = 0, step, 2 step...

        for (let t = step; t <= H; t += step) {
            for (const p of pieces) for (let k = 0; k < step; k++) movePiece(p, aim, S.border);
            if (path) for (let i = 0; i < pieces.length; i++) path[i].push([pieces[i].x, pieces[i].y]);
            const disc = Math.pow(CFG.foodDiscount, t);

            for (let i = 0; i < food.length; i++) {
                if (foodMark[i] === stamp) continue;
                const f = food[i];
                // ejected mass is still flying for ~a second: test where it will be, not where it is
                const fp = f.moving ? predict(f, S.L + t, S.tick) : f;
                for (const p of pieces) {
                    const r = p.s - f.s / GAME.eatOverlapDiv, dx = p.x - fp.x, dy = p.y - fp.y;
                    if (r > 0 && dx * dx + dy * dy <= r * r && canEat(p.s, f.s)) {
                        foodGain += mass(f.s) * disc * f.w;
                        foodMark[i] = stamp;
                        break;
                    }
                }
            }
            // pooling with a teammate: its pieces we can swallow are ours to collect (fewer, bigger pieces for both)
            if (S.poolKeys.size) for (const m of S.mates) {
                if (!S.poolKeys.has(m.key) || (ctx.mateMark && ctx.mateMark.get(m.id) === stamp)) continue;
                if (S.mateBiggest && S.mateBiggest.get(m.key) === m.id) continue; // never its last big piece
                const mb = S.mateBiggest && S.conn.cells.get(S.mateBiggest.get(m.key));
                if (mb && m.s > mb.s * 0.85) continue; // a piece about as big as its biggest is a main piece too
                if (S.poolRoom && mass(m.s) > (S.poolRoom.get(m.key) ?? Infinity)) continue; // (keep the team even)
                for (const p of pieces) {
                    if (!canEat(p.s, m.s)) continue;
                    // eating this would let us swallow its biggest piece right there: leave it
                    if (mb) { const gs = Math.sqrt(p.s * p.s + m.s * m.s); if (canEat(gs, mb.s) && Math.hypot(mb.x - m.x, mb.y - m.y) < gs - mb.s / GAME.eatOverlapDiv + 120) continue; }
                    const r = p.s - m.s / GAME.eatOverlapDiv;
                    if ((p.x - m.x) ** 2 + (p.y - m.y) ** 2 <= r * r) { foodGain += mass(m.s) * disc; (ctx.mateMark = ctx.mateMark || new Map()).set(m.id, stamp); break; }
                }
            }
            for (let i = 0; i < prey.length; i++) {
                if (preyMark[i] === stamp) continue;
                const e = prey[i];
                // prey runs straight away from me: humans at about half speed, bots at full speed from
                // the first tick (#8: PlayerBot re-steers every tick) -- but walls stop it (#4 pinning)
                const ep = predict(e, S.L + t, S.tick);
                const flee = isStill(e, S.tick) ? 0 : moveSpeed(e.s) * t * (isBot(e) ? 1 : 0.5);   // a still cell stays put
                for (const p of pieces) {
                    if (!canEat(p.s, e.s)) continue;
                    const dx = ep.x - p.x, dy = ep.y - p.y, d = Math.hypot(dx, dy) || 1;
                    let fx = ep.x + dx / d * flee, fy = ep.y + dy / d * flee;
                    if (S.border) {
                        fx = Math.max(S.border.minX, Math.min(S.border.maxX, fx));
                        fy = Math.max(S.border.minY, Math.min(S.border.maxY, fy));
                    }
                    if (Math.hypot(p.x - fx, p.y - fy) <= p.s - e.s / GAME.eatOverlapDiv) {
                        preyGain += mass(e.s) * disc * (isTeamer(e.key) ? CFG.teamerBonus : 1) * lockBonus(S, e.key, e) * revenge(e) * (e.baitCell ? 0.3 : 1);
                        preyMark[i] = stamp;
                        // an attacker: eating it saves the pieces of ours it could eat
                        let saved = 0;
                        for (const q of pieces) if (q !== p && canEat(e.s, q.s)) saved += mass(q.s);
                        if (saved) { preyGain += CFG.counterBonus * Math.min(saved, S.myMass) * disc; (ctx.threatGone = ctx.threatGone || new Map()).set(e.id, stamp * 1000 + t); }
                        break;
                    }
                    // pincer: running from us takes it into a mate that can eat it (the squad's gain)
                    let caught = false;
                    for (const m of S.mates) {
                        if (canEat(m.s, e.s) && Math.hypot(m.x - fx, m.y - fy) <= m.s - e.s / GAME.eatOverlapDiv + 40) { caught = true; break; }
                    }
                    if (caught) {
                        preyGain += 0.7 * mass(e.s) * disc;
                        preyMark[i] = stamp;
                        break;
                    }
                }
            }
            for (const v of viruses) {
                for (let i = 0; i < nP; i++) {
                    const p = pieces[i];
                    if (!canEat(p.s, v.s)) continue;
                    // gap to the point where the server pops us (centre distance <= mySize - virus/3)
                    const gap = Math.hypot(p.x - v.x, p.y - v.y) - (p.s - v.s / GAME.eatOverlapDiv);
                    // the user (2026-10-21): a virus is food only while we are shooting it; any other one is kept clear of,
                    // even at the piece limit where it can't pop us
                    if (virusOurs(S.conn, v) && (atMax || S.virusFarm || S.myMass >= CFG.mineMinMass)) {
                        // at the piece limit the server can't pop us: the virus is just food (100+ mass)
                        if (gap <= 0 && !popped[i] && !virusTaken.has(v)) {
                            popped[i] = 1; virusTaken.add(v);
                            virusGain += mass(v.s) * disc * (CFG.virusFeast ? CFG.virusFeastWeight : 1);
                        }
                    } else {
                        // smooth: keep a real margin (lag, rigid pushes from my own cells), worst moment counts
                        // near it: smooth and capped; actually popping costs double the cap
                        const c = gap <= 0 ? 3 : Math.min(1.5, zone(gap - CFG.virusMargin, 60));
                        if (c > virusWorst[i]) virusWorst[i] = c;
                    }
                }
            }
            for (let j = 0; j < nT; j++) {
                const e = threats[j];
                // eaten by one of our pieces earlier in this look-ahead: no longer a threat
                if (ctx.threatGone) { const g = ctx.threatGone.get(e.id); if (g !== undefined && Math.floor(g / 1000) === stamp && g % 1000 < t) continue; }
                // #2 dodge: a piece that's flying (just split at us) goes where its boost takes it and
                // can only start steering once the boost is mostly spent, so sidestepping its line works
                const ep = e.fast ? predict(e, S.L + t, S.tick) : e;
                const steerT = e.fast ? Math.max(0, t + S.L - CFG.dodgeAfterTicks) : t + S.L;
                const chase = moveSpeed(e.s) * steerT * CFG.pursuit;
                for (let i = 0; i < nP; i++) {
                    const p = pieces[i];
                    const d = Math.hypot(p.x - ep.x, p.y - ep.y) - chase;
                    // #1 virus shield: a virus between us that would pop them (and their split pieces)
                    let shield = 1, splitShield = 1;
                    for (const v of e.shieldV) {
                        const vdx = v.x - p.x, vdy = v.y - p.y, edx = ep.x - p.x, edy = ep.y - p.y;
                        if (vdx * vdx + vdy * vdy >= edx * edx + edy * edy) continue; // not between
                        if (segDist(v.x, v.y, ep.x, ep.y, p.x, p.y) > v.s + e.s * 0.35) continue;
                        shield = CFG.virusShield;
                        // their split halves only pop if splitting still leaves them a free slot
                        if (canEat(e.s / SQRT2, v.s) && (e.ownerCells || 1) * 2 < GAME.maxCells) splitShield = CFG.virusShield;
                        break;
                    }
                    let c = 0;
                    // caught by plain movement
                    if (canEat(e.s, p.s)) c = zone(d - (e.s - p.s / GAME.eatOverlapDiv), 120) * shield * e.w;
                    if (c > worstMove[i * nT + j]) worstMove[i * nT + j] = c;
                    // split onto, weighted by whether they'd bother. A piece still flying from a split can split
                    // AGAIN (the delayed double), from where it's heading: a teamer's second split killed us that way
                    if ((!e.fast || !isBot(e)) && !(CFG.sidestep && !e.fast)) {
                        const sr = enemySplitReach(e, p.s, e.ownerCells);
                        if (sr > -Infinity) {
                            const lk = splitLikelihood(e, p.s, e.ownerCells, S);
                            if (lk > 0) c = Math.max(c, CFG.splitDangerWeight * lk * zone(d - sr, 150) * splitShield * e.w);
                        }
                    }
                    if (c > worst[i * nT + j]) worst[i * nT + j] = c;
                }
            }
        }

        // split danger by the flight line: launched at tl, aimed at where the piece was at tl - react, landing at
        // tl + flight; danger by how close the piece then is to that line (out to the split's reach)
        if (path && nT) {
            const R = CFG.splitReact, FL = CFG.splitFlight, st = step;
            const posAt = (i, tt) => {
                const P = path[i], n = P.length - 1;
                if (tt <= 0) return P[0];
                const f = tt / st;
                if (f <= n) { const a = Math.floor(f), b = Math.min(n, a + 1), w = f - a; return [P[a][0] + (P[b][0] - P[a][0]) * w, P[a][1] + (P[b][1] - P[a][1]) * w]; }
                const vx = n ? (P[n][0] - P[n - 1][0]) / st : 0, vy = n ? (P[n][1] - P[n - 1][1]) / st : 0, ex = tt - n * st;
                return [P[n][0] + vx * ex, P[n][1] + vy * ex];
            };
            for (let j = 0; j < nT; j++) {
                const e = threats[j];
                if (e.fast) continue;
                const chaseSp = moveSpeed(e.s) * CFG.pursuit;
                for (let i = 0; i < nP; i++) {
                    const p = pieces[i];
                    const sr = enemySplitReach(e, p.s, e.ownerCells);
                    if (sr === -Infinity) continue;
                    const lk = splitLikelihood(e, p.s, e.ownerCells, S);
                    if (lk <= 0) continue;
                    const hitR = Math.max(40, e.s / SQRT2 - p.s / GAME.eatOverlapDiv);
                    let hit = 0;
                    for (let tl = 0; tl <= H; tl += st) {
                        const a = posAt(i, tl - R), l = posAt(i, tl + FL);
                        // where it is when it launches: closing in on us since now
                        let dx = a[0] - e.x, dy = a[1] - e.y, dl = Math.hypot(dx, dy) || 1;
                        const mv = Math.min(Math.max(0, dl - e.s), chaseSp * (tl + (S.L || 0)));
                        const ex = e.x + dx / dl * mv, ey = e.y + dy / dl * mv;
                        dx = a[0] - ex; dy = a[1] - ey; dl = Math.hypot(dx, dy) || 1;
                        const miss = segDist(l[0], l[1], ex, ey, ex + dx / dl * sr, ey + dy / dl * sr) - hitR;
                        const h = Math.min(1.5, zone(miss, CFG.splitMissSigma));
                        if (h > hit) hit = h;
                    }
                    const c = CFG.splitDangerWeight * lk * hit * e.w;
                    if (c > worst[i * nT + j]) worst[i * nT + j] = c;
                }
            }
        }
        // how spread out my pieces end up (mass-weighted distance from their centre)
        let spread = 0;
        if (nP > 1) {
            let mx = 0, my = 0, mm = 0;
            for (const p of pieces) { const w = p.s * p.s; mx += p.x * w; my += p.y * w; mm += w; }
            mx /= mm; my /= mm;
            for (const p of pieces) spread += Math.hypot(p.x - mx, p.y - my) * p.s * p.s / mm;
        }

        if (!S.popEaters) S.popEaters = S.enemies.filter(e => e.player && Math.hypot(e.x - S.center.x, e.y - S.center.y) < e.s + 3500);
        for (let i = 0; i < nP; i++) {
            if (!virusWorst[i]) continue;
            const ps = Math.sqrt(startMass[i] * 100) / 3, p0 = pieces[i];
            const bad = S.popEaters.some(e => canEat(e.s, ps) && Math.hypot(e.x - p0.x, e.y - p0.y) < e.s + 1500);
            virusCost += CFG.virusPopCost * startMass[i] * virusWorst[i] * (bad ? 3 : 1);
        }
        // never eat a master: any piece of mine big enough to swallow one must keep clear of it
        let masterCost = 0;
        for (const m of S.masters) for (const p of pieces) {
            if (!canEat(p.s, m.s)) continue;
            const gap = Math.hypot(p.x - m.x, p.y - m.y) - (p.s - m.s / GAME.eatOverlapDiv);
            masterCost = Math.max(masterCost, 3 * (mass(m.s) + mass(p.s)) * Math.min(2, zone(gap - 60, 60)));
        }
        // mates: swallowing one (or being swallowed) keeps the mass in the squad, but kills that player.
        // Fine when it asked for it (diving in to escape a killer); otherwise keep apart.
        const merging = S.mergeKeys.size > 0 || S.conn.squadMerge;
        const myBigP = pieces.reduce((a, q) => (q.s > a.s ? q : a));
        for (const m of S.mates) {
            if (merging && (S.mergeKeys.has(m.key) || S.conn.squadMerge)) continue;
            const mbc = S.mateBiggest && S.conn.cells.get(S.mateBiggest.get(m.key));
            if (S.poolKeys.has(m.key) && !(S.mateBiggest && S.mateBiggest.get(m.key) === m.id) && !(mbc && m.s > mbc.s * 0.85)) {
                // its small pieces are fair game, but our biggest piece must not be swallowed by it either
                const myBig = pieces.reduce((a, q) => (q.s > a.s ? q : a));
                if (!canEat(m.s, myBig.s)) continue;
            }
            const mIsBig = (S.mateBiggest && S.mateBiggest.get(m.key) === m.id) || (mbc && m.s > mbc.s * 0.85);
            for (const p of pieces) {
                // two biggest pieces: keep clear a little before either could eat the other
                const both = mIsBig && p === myBigP && !canEat(p.s, m.s) && !canEat(m.s, p.s), near = both ? 1.08 : 1;
                const big = canEat(p.s * near, m.s) ? p : canEat(m.s * near, p.s) ? m : null;
                if (!big) continue;
                const small = big === p ? m : p;
                // our smaller pieces going into the teammate: that's the team pooling mass, not a loss
                if (big === m && p !== myBigP && p.s <= myBigP.s * 0.85 && pieces.length >= 2) continue;
                const gap = Math.hypot(p.x - m.x, p.y - m.y) - (big.s - small.s / GAME.eatOverlapDiv) - (both ? 60 : 0);
                // a teammate's biggest piece (or ours, when theirs could take it) is its life: as off-limits as a master
                const vital = (mIsBig && big === p) || (big === m && (p === myBigP || p.s > myBigP.s * 0.85));
                // collecting this owner's spare pieces: get right up to its main piece (never inside its eating range)
                const collecting = vital && big === p && S.collectKeys && S.collectKeys.has(m.key);
                masterCost = Math.max(masterCost, (vital ? 3 * (mass(m.s) + mass(p.s)) : 0.5 * mass(small.s) + 40) *
                    Math.min(2, collecting ? zone(gap - 25, 30) : zone(gap - (vital ? 80 : 40), 60)));
            }
        }
        let danger = 0, moveDanger = 0;
        for (let i = 0; i < nP; i++) {
            let sum = 0, sumMove = 0;
            for (let j = 0; j < nT; j++) { sum += worst[i * nT + j]; sumMove += worstMove[i * nT + j]; }
            danger += startMass[i] * sum;
            moveDanger += startMass[i] * sumMove;
        }
        // being pinned on the wall while threatened is how good players die
        let wall = 0;
        if (S.border && danger > 0) {
            for (const p of pieces) {
                const gap = Math.min(p.x - S.border.minX, S.border.maxX - p.x, p.y - S.border.minY, S.border.maxY - p.y) - p.s;
                wall += mass(p.s) * 0.1 * Math.exp(-Math.max(0, gap) / 200);
            }
        }
        return { foodGain, preyGain, virusGain, virusCost: virusCost + masterCost, danger, moveDanger, wall, spread };
    }

    function steer(conn, S) {
        const { center, maxMine } = S;
        const range = moveSpeed(Math.min(maxMine, 200)) * CFG.horizon + maxMine + 300;
        // small: don't be drawn to food sitting inside a virus cluster we can't safely enter (it pops us)
        if (S.myMass < CFG.virusFarmMinMass && S.viruses.length) {
            for (const f of S.food) {
                f.avoid = false;
                for (const v of S.viruses) {
                    if (v.remote) continue;
                    if ((f.x - v.x) ** 2 + (f.y - v.y) ** 2 < (v.s + maxMine + 50) ** 2) { f.avoid = true; break; }
                }
            }
        }

        const threats = [], prey = [], food = [], viruses = [];
        const isThreat = e => S.mine.some(m => canEat(e.s, m.s) || enemySplitReach(e, m.s, e.ownerCells) > -Infinity);
        for (const e of S.enemies) {
            const d = Math.hypot(e.x - center.x, e.y - center.y);
            e.ownerCells = S.ownerCount.get(e.key) || 1;
            e.fast = e.vt >= S.tick - 1 && isFast(e.vx, e.vy, e.s);
            e.w = 1;
            const farReach = S.mine.reduce((a, m) => Math.max(a, enemySplitReach(e, m.s, e.ownerCells)), -Infinity);
            if (CFG.trustFriends && isFriend(e)) continue;
            // (the user: "when we spawn EVERY player is bigger than us - we can't run from them all; be daring". Only
            // what could actually get to us soon counts: near its edge, or within its split reach. A big, slow player
            // across the screen used to steer us as if it was on top of us.)
            const near = d - e.s < CFG.threatNear || d < farReach + 600;
            if (near && isThreat(e)) threats.push(e);
            // (a still cell - frozen, disconnected - can't run: just over the eat line is enough, and worth a detour.
            // The user: three of ours scooted past a frozen cell any one of them could have eaten)
            else if (!isAlly(e) && !e.feeding && (isStill(e, S.tick) ? d < 2500 && S.mine.some(m => canEat(m.s, e.s * 1.005)) : d < range + 200 && S.mine.some(m => canEat(m.s, e.s * CFG.eatMargin)))) { e.baitCell = isBaitCell(S, e); prey.push(e); }
        }
        const pk = S.plan && S.plan.kill;
        if (pk && pk.eater === conn.memberId) for (const e of threats) if (pk.cover.includes(e.id)) e.w = 0.15;
        // #10 ghosts: threats that just walked out of view are still out there, roughly where they were going
        for (const g of conn.ghosts.values()) {
            const age = S.tick - g.tick, c = g.cell;
            if (isMaster(c) || S.remoteIds.has(g.cell.id) || conn.mateKeys.has(c.key)) continue;
            const gx = c.x + c.vx * Math.min(age, 40), gy = c.y + c.vy * Math.min(age, 40);
            // full weight for a while after it leaves view, then fading (live: it left the screen -> weight dropped ->
            // we turned back -> it came back on screen -> we turned away: left, right, left, forever)
            const gAge = now() - g.t;
            const e = { ...c, x: gx, y: gy, vx: 0, vy: 0, vt: -1, fast: false, ghost: true,
                ownerCells: S.ownerCount.get(c.key) || 1,
                w: gAge < CFG.ghostFullMs ? 1 : CFG.ghostWeight * Math.max(0, 1 - (gAge - CFG.ghostFullMs) / (CFG.ghostMs - CFG.ghostFullMs)) };
            const gReach = S.mine.reduce((a, m) => Math.max(a, enemySplitReach(e, m.s, e.ownerCells)), -Infinity);
            const gd = Math.hypot(gx - center.x, gy - center.y);
            if (e.w > 0.05 && (gd - e.s < CFG.threatNear || gd < gReach + 600) && isThreat(e)) threats.push(e);
        }
        // #5 a split player whose pieces are about to merge back counts as its merged size, at their centre
        const groups = new Map();
        for (const e of S.enemies) { if (!groups.has(e.key)) groups.set(e.key, []); groups.get(e.key).push(e); }
        for (const [key, g] of groups) {
            if (g.length < 2) continue;
            const o = conn.owners.get(key);
            const ready = g.filter(c => S.tick - (c.fresh ? c.born : (o ? o.splitTick : -1e9)) >= MERGE_TICKS(c.s) - CFG.mergeSoonTicks);
            if (ready.length < 2) continue;
            const ms = Math.sqrt(ready.reduce((a, c) => a + c.s * c.s, 0)), mc = centroid(ready);
            const v = { id: -1, key, name: g[0].name, s: ms, x: mc.x, y: mc.y, vx: 0, vy: 0, vt: -1, fast: false,
                virtual: true, ownerCells: g.length - ready.length + 1, w: 0.5 };
            if (Math.hypot(mc.x - center.x, mc.y - center.y) < range + 1800 && isThreat(v)) threats.push(v);
        }
        // a teaming pair is one bigger threat: the feeder can top the chaser up past our size in seconds
        for (const [key, g] of groups) {
            const tm = teamers.get(key);
            if (!tm || teamerScore(key) < 1) continue;
            const A = g.reduce((a, c) => (c.s > a.s ? c : a));
            let feed = 0;
            for (const mk of tm.mates) {
                const mg = groups.get(mk);
                if (!mg) continue;
                for (const c of mg) if (Math.hypot(c.x - A.x, c.y - A.y) < 1500 + A.s) feed += c.s * c.s;
            }
            if (!feed) continue;
            const v = { id: -2, key, name: A.name, s: Math.sqrt(A.s * A.s + CFG.teamThreatWeight * feed), x: A.x, y: A.y, vx: 0, vy: 0, vt: -1,
                fast: false, virtual: true, ownerCells: g.length, w: 0.5 };
            if (Math.hypot(v.x - center.x, v.y - center.y) < range + 1800 && isThreat(v)) threats.push(v);
        }
        // Food: pellets (mass 4) and ejected mass (mass 16, often still flying). Judge each by where it
        // will come to rest, and weight mass we shot ourselves during a dash so we go back for it.
        for (const f of S.food) {
            f.moving = f.vt >= S.tick - 1 && isFast(f.vx, f.vy, f.s);
            f.land = f.moving ? predict(f, S.L + 30, S.tick) : f;
            // our shot blobs are worth going back for, but not once anything dangerous is around
            f.w = conn.dashEjects.has(f.id) && conn.danger < 0.05 * S.myMass + 1 ? CFG.collectWeight : 1;
            if (f.eject && conn.baiterColors.has(f.color)) f.w = 0.25; // bait
            if (f.eject && S.mateColors.has(f.color)) f.w = CFG.squadCollectWeight; // a mate's feed: ours to eat
            f.dist = Math.hypot(f.land.x - center.x, f.land.y - center.y);
            if (f.dist < range) food.push(f);
        }
        for (const v of S.viruses) if (Math.hypot(v.x - center.x, v.y - center.y) < range + 200) viruses.push(v);
        if (food.length > 300) {
            // keep the most valuable, not just the nearest: one ejected blob is worth four pellets
            food.sort((a, b) => (a.dist + 100) / (mass(a.s) * a.w) - (b.dist + 100) / (mass(b.s) * b.w));
            food.length = 300;
        }

        // Roaming waypoint: always kept, so with nothing nearby we still drift somewhere useful.
        // If we haven't really moved for stuckMs while safe, pick a far waypoint and pull hard toward it.
        const t = now();
        conn.trail.push({ t, x: center.x, y: center.y });
        while (conn.trail.length && t - conn.trail[0].t > CFG.stuckMs) conn.trail.shift();
        const first = conn.trail[0];
        const safe = conn.danger < 0.05 * S.myMass + 1;
        if (safe && t > conn.exploreUntil && first && t - first.t > CFG.stuckMs * 0.9 &&
            Math.hypot(center.x - first.x, center.y - first.y) < Math.max(300, maxMine * 2)) {
            conn.waypoint = pickWaypoint(S, 3000);
            conn.exploreUntil = t + 3000;
            conn.trail.length = 0;
            hud.flash('not getting anywhere: roaming');
        }
        if (!conn.waypoint || Math.hypot(conn.waypoint.x - center.x, conn.waypoint.y - center.y) < 500 || t - conn.waypoint.t > 15000)
            conn.waypoint = pickWaypoint(S, 1500);
        if (S.plan && !(S.plan.pressed && S.plan.pressed !== conn.memberId)) conn.waypoint = { x: center.x + Math.cos(S.plan.dir) * 3000, y: center.y + Math.sin(S.plan.dir) * 3000, t };
        // one team, one destination: the teammate with the lowest id (that's near) picks where we're all heading
        else if (S.squad.length) {
            const chooser = S.squad.filter(m => m.wp && m.from < conn.memberId && Math.hypot(memberCenter(m).x - center.x, memberCenter(m).y - center.y) < 4000)
                .reduce((a, m) => (!a || m.from < a.from ? m : a), null);
            if (chooser) conn.waypoint = { x: chooser.wp[0], y: chooser.wp[1], t };
        }
        const exploreW = CFG.exploreWeight * (t < conn.exploreUntil ? 8 : 1);

        // Pulls: places worth heading for that the short look-ahead can't see the value of by itself.
        const pulls = [];
        // our own (and teammates') shot mass lying around: go back for it (the user: "they abandoned a massive amount of
        // food after shooting a virus, split up, no enemies" - only blobs inside the short look-ahead counted as food)
        if (CFG.ownBlobPull > 0 && conn.danger < 0.15 * S.myMass + 1) {
            let bx = 0, by = 0, bm = 0;
            for (const f of S.food) {
                if (!f.eject || !(f.color === conn.myColor || S.mateColors.has(f.color)) || conn.baiterColors.has(f.color)) continue;
                const d = Math.hypot(f.x - center.x, f.y - center.y);
                if (d > 2500) continue;
                const fm = mass(f.s); bx += f.x * fm; by += f.y * fm; bm += fm;
            }
            if (bm >= 60) pulls.push({ x: bx / bm, y: by / bm, noCalm: true, w: CFG.ownBlobPull * bm, label: 'collecting our shot mass' });
        }
        // still prey (frozen / disconnected): it won't run, so it's worth the walk even from well outside the look-ahead
        for (const e of prey) {
            if (!isStill(e, S.tick)) continue;
            const eater = S.mine.filter(m => canEat(m.s, e.s * 1.005)).reduce((a, m) => (!a || Math.hypot(e.x - m.x, e.y - m.y) < Math.hypot(e.x - a.x, e.y - a.y) ? m : a), null);
            if (!eater) continue;
            const d = Math.hypot(e.x - eater.x, e.y - eater.y);
            pulls.push({ x: e.x, y: e.y, noCalm: true, w: CFG.stillPreyWeight * mass(e.s) * Math.min(1, 1500 / Math.max(300, d)),
                label: 'going for ' + (e.name || 'a player') + ' (standing still)' });
        }
        const b = S.border;
        // #4 pin: prey near a wall (or in a corner). Not pinned yet: get on its open-field side, so running
        // from us means running into the edge. Pinned: it can't get away any more, so just drive in and
        // eat it (no split needed). Server bots flee straight away from us and never slide along walls,
        // so they're the best targets for this.
        if (b) {
            let bestPin = null;
            for (const e of S.enemies) {
                const byMoving = S.mine.some(m => canEat(m.s, e.s * CFG.eatMargin));
                if (!byMoving && !S.mine.some(m => canEat(m.s / SQRT2, e.s * CFG.eatMargin))) continue;
                const d = Math.hypot(e.x - center.x, e.y - center.y);
                if (d > 2500) continue;
                // inward normal of every wall it's close to (two near a corner)
                let nx = 0, ny = 0, gap = Infinity;
                const walls = [[e.x - b.minX, 1, 0], [b.maxX - e.x, -1, 0], [e.y - b.minY, 0, 1], [b.maxY - e.y, 0, -1]];
                // pincer: a mate that can eat it is a wall too (running from us means running into the mate)
                for (const m of S.mates) {
                    if (!canEat(m.s, e.s)) continue;
                    const dx = e.x - m.x, dy = e.y - m.y, dm = Math.hypot(dx, dy) || 1;
                    walls.push([Math.max(0, dm - (m.s - e.s / GAME.eatOverlapDiv)), dx / dm, dy / dm]);
                }
                for (const [g, wx, wy] of walls) {
                    if (g < 1200) { nx += wx * (1 - g / 1200); ny += wy * (1 - g / 1200); }
                    gap = Math.min(gap, g);
                }
                const nl = Math.hypot(nx, ny);
                if (!nl) continue;
                nx /= nl; ny /= nl;
                const pinned = gap < e.s * 0.6 + 60;
                // Where it's going (a pinned cell slides along the wall, away from us, if we come at it
                // at an angle). Only come in straight out from the wall: then its escape points into the
                // wall and it's stuck. Off that line, get back on it first.
                const ep = predict(e, S.L + 8, S.tick);
                const rx = center.x - ep.x, ry = center.y - ep.y, rl = Math.hypot(rx, ry) || 1;
                const aligned = (rx * nx + ry * ny) / rl > 0.9;
                const off = pinned && aligned ? 0 : e.s + maxMine + (pinned ? 100 : 200);
                const w = CFG.herdWeight * mass(e.s) * lockBonus(S, e.key, e) * (isBot(e) ? 1.5 : 1) *
                    (pinned ? (byMoving ? 2 : 1.2) : 1 - gap / 1500);
                if (!bestPin || w / (d + 300) > bestPin.w / (bestPin.d + 300))
                    bestPin = { x: ep.x + nx * off, y: ep.y + ny * off, w, d, e, label: pinned ? (aligned ? 'pin (closing in)' : 'pin (cutting off)') : 'pin' };
            }
            if (bestPin) pulls.push(bestPin);
            // the leader tells the squad what it's going for
            conn.squadHunt = bestPin && S.squad.length && !bestPin.e.remote
                ? { id: bestPin.e.id, x: Math.round(bestPin.e.x), y: Math.round(bestPin.e.y), s: Math.round(bestPin.e.s) } : null;
        }
        // long-range hunt: the best thing in view our biggest piece can eat (big cells see far; prey used to count only
        // within the short look-ahead radius, so a huge cell ignored the big players on screen)
        const huntT = CFG.huntPull > 0 ? bestHunt(S) : null;
        if (huntT) { const ep = predict(huntT.e, S.L + 10, S.tick); pulls.push({ x: ep.x, y: ep.y, w: huntT.w, huntId: huntT.e.id, label: 'hunt: ' + (huntT.e.name || 'a player') }); }
        conn.huntMsg = huntT && !huntT.e.remote ? { h: { id: huntT.e.id }, at: now() } : null;
        if (CFG.lockstepWall) for (const m of S.squad) {
            // a teammate chasing something: run beside it, level with it, close enough that our eat lines overlap - no
            // lane for the prey between us (cells have no momentum, so we can hold the spot exactly)
            if (!m.hunt || !m.cells.length) continue;
            const e = conn.cells.get(m.hunt.id); if (!e) continue;
            const big = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
            if (canEat(e.s, big.s * 0.95)) continue;
            const mc = memberCenter(m), ms = memberBig(m), ux0 = e.x - mc.x, uy0 = e.y - mc.y, ul = Math.hypot(ux0, uy0) || 1, ux = ux0 / ul, uy = uy0 / ul;
            if (ul > 2200 || Math.hypot(big.x - mc.x, big.y - mc.y) > 2500) continue;
            const side = ((big.x - mc.x) * -uy + (big.y - mc.y) * ux) >= 0 ? 1 : -1;
            const L = Math.max(ms + big.s * 0.5, ms + big.s - e.s * 0.8);
            const msp = moveSpeed(ms) * 6;
            const P = { x: mc.x + ux * msp + -uy * L * side, y: mc.y + uy * msp + ux * L * side };
            pulls.push({ x: P.x, y: P.y, w: CFG.lockstepWeight * mass(e.s), label: 'pack: lockstep wall beside ' + (m.name || 'a teammate') });
        }
        // counter-attack: an attacker our biggest piece can eat, going after our smaller pieces: eat it
        {
            const big = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
            let bestC = null;
            for (const e of S.enemies) {
                if (e.remote || !canEat(big.s, e.s * CFG.eatMargin)) continue;
                const d = Math.hypot(e.x - big.x, e.y - big.y) - big.s;
                if (d > 1400) continue;
                let threatened = 0;
                for (const q of S.mine) if (q !== big && canEat(e.s, q.s) && Math.hypot(e.x - q.x, e.y - q.y) < 1500 + e.s) threatened += mass(q.s);
                if (!threatened) continue;
                const ep = predict(e, S.L + 6, S.tick);
                // nobody that could eat our biggest on the way (or right where it is)
                const blocked = S.enemies.some(o => { if (o === e || !canEat(o.s, big.s * 0.95)) return false; const r = threatReach(S, o, big.s);
                    return r > -Infinity && segDist(o.x, o.y, big.x, big.y, ep.x, ep.y) < r + 200; });
                if (blocked) continue;
                const w = CFG.counterPull * Math.min(threatened, S.myMass) * (1 - d / 2000);
                if (!bestC || w > bestC.w) bestC = { x: ep.x, y: ep.y, w, noCalm: true, label: 'counter-attack: eating ' + (e.name || 'an attacker') };
            }
            if (bestC) pulls.push(bestC);
        }
        squadPulls(conn, S, pulls, threats);
        trapPulls(conn, S, pulls);
        orderPulls(conn, S, pulls);
        scavengePulls(conn, S, pulls);
        // something worth eating in view: regrouping / formation wait (a big bot used to go and meet a far teammate)
        if (huntT && huntT.m >= 0.1 * S.myMass) for (const p of pulls) if (p.label && /meeting up|in formation|regroup/.test(p.label)) p.w *= /meeting up/.test(p.label) ? 0 : 0.1;
        // team pull memory: a team pull that switched off a moment ago keeps pulling (fading), so conditions that flicker
        // as we move don't turn into going to and fro; real danger clears it (getting away comes first)
        {
            const mem = conn.pullMem = conn.pullMem || new Map(), tn = now(), live = new Set();
            if (conn.danger > 0.15 * S.myMass + 1) mem.clear();
            else {
                for (const p of pulls) {
                    if (!p.label || !/^team/.test(p.label)) continue;
                    const key = p.label.replace(/\s*\(.*$/, '');
                    live.add(key);
                    // remember it relative to the teammate it's about (targets move with the teammate, not stay put)
                    let mate = null, md = 2500;
                    for (const sq of S.squad) { if (!sq.cells.length) continue; const c = memberCenter(sq), dd = Math.hypot(c.x - p.x, c.y - p.y); if (dd < md) { md = dd; mate = sq; } }
                    const mc0 = mate ? memberCenter(mate) : null;
                    mem.set(key, { ox: mc0 ? p.x - mc0.x : p.x, oy: mc0 ? p.y - mc0.y : p.y, mate: mate ? mate.from : null, w: p.w, noCalm: p.noCalm, label: p.label, t: tn });
                }
                for (const [key, m] of mem) {
                    if (live.has(key)) continue;
                    const age = tn - m.t;
                    if (age > CFG.pullMemoryMs) { mem.delete(key); continue; }
                    const sq = m.mate ? S.squad.find(q => q.from === m.mate && q.cells.length) : null;
                    if (m.mate && !sq) { mem.delete(key); continue; }
                    const c = sq ? memberCenter(sq) : { x: 0, y: 0 };
                    const tx = c.x + m.ox, ty = c.y + m.oy;
                    if (Math.hypot(tx - S.center.x, ty - S.center.y) < 250) { mem.delete(key); continue; }   // got there
                    pulls.push({ x: tx, y: ty, w: m.w * (1 - age / CFG.pullMemoryMs), noCalm: m.noCalm, label: m.label });
                }
            }
        }
        // Crowds: small cells mostly die in pockets of several bigger players, by the time the 3 s look-ahead
        // sees it every way out is taken. With 2+ bigger players around, drift away from where they gather.
        if (S.phase !== 'big' && CFG.crowdWeight > 0) {
            let wx = 0, wy = 0, n = 0;
            for (const e of threats) {
                if (e.virtual) continue;
                const dx = e.x - center.x, dy = e.y - center.y, d = Math.hypot(dx, dy) || 1;
                if (d > 3500) continue;
                const w = e.w * Math.min(3, e.s / maxMine) / (1 + d / 800);
                wx += dx / d * w; wy += dy / d * w; n++;
            }
            const wl = Math.hypot(wx, wy);
            if (n >= 2 && wl > 0)
                pulls.push({ x: center.x - wx / wl * 1500, y: center.y - wy / wl * 1500, noCalm: true,
                    w: CFG.crowdWeight * S.myMass * Math.min(1, (n - 1) / 3) * Math.min(1, wl), label: 'leaving the crowd' });
        }
        // #6 stream: another player's blobs flying into a different player = a feeding line; stand in it
        const streams = new Map();
        for (const f of S.food) if (f.eject && f.moving && f.color !== conn.myColor) {
            if (!streams.has(f.color)) streams.set(f.color, []);
            streams.get(f.color).push(f);
        }
        for (const [color, blobs] of streams) {
            if (blobs.length < 2) continue;
            const c0 = centroid(blobs);
            let vx = 0, vy = 0;
            for (const f of blobs) { vx += f.vx; vy += f.vy; }
            const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
            let recv = null, ra = Infinity;
            for (const e of S.enemies) {
                if (e.color === color) continue;
                const rx = e.x - c0.x, ry = e.y - c0.y, ahead = rx * vx + ry * vy;
                if (ahead <= 0 || ahead > 1600 || Math.abs(rx * vy - ry * vx) > e.s + 200) continue;
                if (ahead < ra) { ra = ahead; recv = e; }
            }
            if (!recv) continue;
            const src = S.enemies.filter(e => e.color === color).reduce((a, e) => (!a || Math.hypot(e.x - c0.x, e.y - c0.y) < Math.hypot(a.x - c0.x, a.y - c0.y) ? e : a), null);
            if (src) { flagTeamer(src.key, src.name, recv.key, 0.05); flagTeamer(recv.key, recv.name, src.key, 0.05); }
            // closest point on the line to us, but not inside the receiver's reach
            const ax = src ? src.x : c0.x, ay = src ? src.y : c0.y;
            const lx = recv.x - ax, ly = recv.y - ay, len = Math.hypot(lx, ly) || 1;
            let k = ((center.x - ax) * lx + (center.y - ay) * ly) / (len * len);
            k = Math.max(0.15, Math.min(Math.max(0.15, 1 - (recv.s + maxMine + 200) / len), k));
            pulls.push({ x: ax + lx * k, y: ay + ly * k, w: CFG.streamWeight * blobs.length, label: 'intercept' });
        }
        // #7 harvest: a player who just popped on a virus is scattered, boosting and locked apart
        for (const [key, o] of conn.owners) {
            const age = S.tick - o.popTick;
            if (age > CFG.harvestTicks) continue;
            const edible = S.enemies.filter(e => e.key === key && S.mine.some(m => canEat(m.s, e.s) || canEat(m.s / SQRT2, e.s)));
            if (!edible.length) continue;
            const em = edible.reduce((a, e) => a + mass(e.s), 0), ec = centroid(edible);
            pulls.push({ x: ec.x, y: ec.y, w: CFG.harvestWeight * em * (1 - age / CFG.harvestTicks), label: 'harvest (popped, locked apart)' });
        }
        // virus feast: at the piece limit, viruses we're big enough to eat are free 100+ mass
        if (CFG.virusFeast && (S.mine.length >= GAME.maxCells || S.virusFarm)) {
            for (const v of S.viruses) {
                if (!S.mine.some(m => canEat(m.s, v.s))) continue;
                const d = Math.hypot(v.x - center.x, v.y - center.y);
                if (d > 2500) continue;
                pulls.push({ x: v.x, y: v.y, w: CFG.virusFeastPull * (S.mineCommitted ? 2.5 : 1) * mass(v.s) / (1 + d / 800), noCalm: !!S.mineCommitted, label: 'feast' });
            }
        }
        // opportunities only count while it's calm: none of them is worth walking into danger for
        const calm = Math.max(0, 1 - conn.danger / ((0.15 + 0.35 * CFG.dare) * S.myMass + 1));
        // a pull's way must be clear: no going through (or to) a spot in reach of a player that could eat us
        const wayThreats = [];
        {
            const bigW = S.mine.reduce((a2, c) => (c.s > a2.s ? c : a2));
            for (const e of S.enemies) {
                if (e.remote) continue;
                let size = 0;
                if (canEat(e.s, bigW.s * 0.95)) size = bigW.s;
                else { let m = 0, sz = 0; for (const q of S.mine) if (canEat(e.s, q.s)) { m += mass(q.s); sz = Math.max(sz, q.s); } if (m > S.myMass / 3) size = sz; }
                if (!size) continue;
                const r = threatReach(S, e, size);
                if (r > -Infinity) wayThreats.push({ x: e.x, y: e.y, r: r + 150 });
            }
        }
        // obstacles for routing: each threat's reach, and virus clusters that would pop our biggest piece
        let routeObs = null;
        const routeObstacles = () => {
            if (routeObs) return routeObs;
            const bigW = S.mine.reduce((a2, c) => (c.s > a2.s ? c : a2));
            routeObs = wayThreats.map(t => [{ x: t.x, y: t.y, r: t.r }]);
            if (S.mine.length < CFG.maxCells && canEat(bigW.s, GAME.virusSize) && !S.virusFarm)
                routeObs.push(...trapClusters(S.viruses.filter(v => Math.hypot(v.x - center.x, v.y - center.y) < 4000), bigW.s - GAME.virusSize / GAME.eatOverlapDiv + 60));
            return routeObs;
        };
        // ONE MIND (the user's team rule; live: ~400 'stuck wobbling' an hour, nearly all with the team pulls - going to
        // help, fleeing with, meeting up, regroup, formation, running to - switching on and off and fighting). Close
        // together, the biggest of us leads: it steers by its own judgement, and the rest follow ITS heading, beside
        // it, instead of each adding up their own tug-of-war. Danger is still scored per bot (nobody follows into a mouth).
        if (CFG.oneMind && S.squad.length && !conn.ft) {     // (fast travel coordinates the pair itself)
            const FIGHT = /^(team: going to help|team: fleeing with|team: meeting up|team: regroup|team plan: in formation|team: running to|team: coming to help)/;
            // the whole squad follows ONE leader - the biggest of all of us, near or far (the user: "they keep meeting up in
            // pairs instead of meeting all four"; every bot used to regroup with its own nearest teammate)
            const near = S.squad.filter(m => m.cells.length && now() - m.rx < 1500);
            if (near.length) {
                const lead = near.reduce((a, m) => (!a || m.mass > a.mass || (m.mass === a.mass && m.from < a.from) ? m : a), null);
                const iLead = S.myMass > lead.mass || (S.myMass === lead.mass && conn.memberId < lead.from);
                // (the leader keeps its help pulls: the biggest is the one that can save a teammate)
                for (let i = pulls.length - 1; i >= 0; i--) if (pulls[i].label && FIGHT.test(pulls[i].label) && !(iLead && /help/.test(pulls[i].label))) pulls.splice(i, 1);
                if (!iLead && typeof lead.dir === 'number') {
                    // beside the leader (our side of it, clear of its eating range), and on along its heading
                    const lc = memberCenter(lead), lb = memberBig(lead);
                    const dx = center.x - lc.x, dy = center.y - lc.y, dl = Math.hypot(dx, dy) || 1;
                    const gap = lb + maxMine + 250;
                    const tx = lc.x + dx / dl * gap + Math.cos(lead.dir) * 900, ty = lc.y + dy / dl * gap + Math.sin(lead.dir) * 900;
                    // only where WE survive: the leader is big and safe beside players that eat us (live: a 159 follower was
                    // led between Moon and ChaCha next to its big leader and eaten)
                    const myB = S.mine.reduce((a2, q) => (q.s > a2.s ? q : a2));
                    // (only for a follower much smaller than its leader: equal teammates under threat stay together - rally scene)
                    const unsafe = S.myMass < lead.mass * 0.5 && S.enemies.some(e => { const r = threatReach(S, e, myB.s); return r > -Infinity &&
                        (segDist(e.x, e.y, center.x, center.y, tx, ty) < r + 200 || Math.hypot(e.x - tx, e.y - ty) < r + 300); });
                    // not safe beside it, but it can swallow us and the way in is clear: go INTO it (mass stays in the team,
                    // and we're out of danger at once)
                    if (unsafe) {
                        const lBig = lead.cells.reduce((a2, r) => (r[3] > a2[3] ? r : a2));
                        const lb2 = conn.cells.get(lBig[0]) || { x: lBig[1], y: lBig[2], s: lBig[3] };
                        const lane = !S.enemies.some(e => { const r = threatReach(S, e, myB.s); return r > -Infinity && segDist(e.x, e.y, myB.x, myB.y, lb2.x, lb2.y) < r + 60; });
                        if (canEat(lb2.s, myB.s * CFG.eatMargin) && lane && Math.hypot(lb2.x - myB.x, lb2.y - myB.y) - lb2.s < 1500) {
                            conn.squadMerge = true; conn.mergeUntil = now() + 600;
                            pulls.push({ x: lb2.x, y: lb2.y, noCalm: true, w: 2.5 * S.myMass, label: 'team: into ' + (lead.name || 'our leader') + ' for safety' });
                        }
                    }
                    if (!unsafe) pulls.push({ x: tx, y: ty, noCalm: true, w: CFG.oneMindWeight * S.myMass, label: 'team: following ' + (lead.name || 'our leader') });
                }
                conn.oneMind = iLead ? 'lead' : 'follow';
            } else {
                conn.oneMind = null;
                // spread out: regroup with ONE teammate, not one pull toward each (teammates in different directions
                // pulled us back and forth - live: 'team: regroup' was in 123 of 165 wobbles)
                const RG = /^(team: regroup|team: meeting up|team plan: in formation)/;
                const rg = pulls.filter(p => p.label && RG.test(p.label));
                if (rg.length > 1) { const keep = rg.reduce((a, p) => (p.w > a.w ? p : a)); for (let i = pulls.length - 1; i >= 0; i--) if (RG.test(pulls[i].label || '') && pulls[i] !== keep) pulls.splice(i, 1); }
            }
        }
        // escape first, regroup on the way out: a team pull pointing back into the crowd we're leaving goes (live: 'leaving
        // the crowd' against 'regroup' / 'following' / 'running to' was the top wobble - away, back, away...)
        {
            const crowd = pulls.find(p => p.label === 'leaving the crowd');
            if (crowd) {
                const ca = Math.atan2(crowd.y - center.y, crowd.x - center.x);
                const TEAM = /^(team: regroup|team: meeting up|team: following|team: running to|team plan: in formation|team: fleeing with)/;
                for (let i = pulls.length - 1; i >= 0; i--) {
                    const p = pulls[i];
                    if (!p.label || !TEAM.test(p.label)) continue;
                    if (Math.cos(Math.atan2(p.y - center.y, p.x - center.x) - ca) < 0) pulls.splice(i, 1);
                }
            }
        }
        for (const p of pulls) {
            if (!p.noCalm) p.w *= calm;
            if (wayThreats.length && wayThreats.some(t => segDist(t.x, t.y, center.x, center.y, p.x, p.y) < t.r)) {
                const inReach = wayThreats.some(t => Math.hypot(t.x - p.x, t.y - p.y) < t.r);
                let routed = false;
                if (CFG.routePulls && !inReach) {
                    const straight = Math.hypot(p.x - center.x, p.y - center.y);
                    const r = trapRoute(center.x, center.y, p.x, p.y, routeObstacles(), 0);
                    if (r[0] <= straight * CFG.routeMaxDetour && Math.hypot(r[1] - center.x, r[2] - center.y) > 50) {
                        p.to = { x: p.x, y: p.y }; p.x = r[1]; p.y = r[2]; p.routed = true; routed = true;
                    }
                }
                if (!routed) { p.w *= 0.1; p.blocked = true; }
            }
            p.a = Math.atan2(p.y - center.y, p.x - center.x);
        }
        // Team pulls switch on and off at their own thresholds (teammate's danger > 10%, gap > 800...), so their sum
        // flipped direction every few ticks: live, ~400 'stuck wobbling' an hour, nearly all with team pulls fighting.
        // Smooth them (fade in / out over ~0.5 s). Real danger is scored separately and stays instant.
        if (CFG.pullSmoothMs > 0) {
            const sm = conn.pullSm || (conn.pullSm = new Map());
            const tn = now(), dt = Math.min(500, tn - (conn.pullSmAt || tn)); conn.pullSmAt = tn;
            if (dt > 150) sm.clear();     // normal movement wasn't driving (a team step was): start fresh, no stale pulls
            const k = 1 - Math.exp(-Math.max(16, dt) / CFG.pullSmoothMs);
            const seen = new Set();
            for (const p of pulls) {
                if (!p.label || !/^(team: going to help|team: fleeing with|team: meeting up|team: regroup|team plan: in formation|team: running to|leaving the crowd)/.test(p.label)) continue;
                seen.add(p.label);
                let s = sm.get(p.label);
                if (!s) { s = { ux: Math.cos(p.a), uy: Math.sin(p.a), w: 0 }; sm.set(p.label, s); }
                s.ux += (Math.cos(p.a) - s.ux) * k; s.uy += (Math.sin(p.a) - s.uy) * k; s.w += (p.w - s.w) * k;
                p.a = Math.atan2(s.uy, s.ux); p.w = s.w;
            }
            for (const [label, s] of sm) {
                if (seen.has(label)) continue;
                s.w *= 1 - k;
                if (s.w < 0.5) { sm.delete(label); continue; }
                const a = Math.atan2(s.uy, s.ux);
                pulls.push({ x: center.x + Math.cos(a) * 800, y: center.y + Math.sin(a) * 800, a, w: s.w, noCalm: true, label, fading: true });
            }
        }

        // #1: which viruses could ever shield us from each threat (would pop it, and are on our side of it)
        for (const e of threats) {
            const ex = e.x - center.x, ey = e.y - center.y, de = Math.hypot(ex, ey) || 1;
            // no shield from teamers (the partner feeds the popped one back) or giants (a pop costs them little next
            // to us) - live: a 3,100 bot sat 10 s behind a virus while a 13,900 teamer walked up and split-killed it
            // and none from a player with no free piece slot: the server only pops a cell when its owner can take more
            // pieces (distributeCellMass), so at 16 pieces they walk straight through viruses (live 2026-10-25: 12 of 40
            // deaths in 30 min were "evade (virus shield)")
            const noShield = isTeamer(e.key) || mass(e.s) > CFG.shieldTrustMaxRatio * S.myMass || (S.ownerCount.get(e.key) || 1) >= GAME.maxCells;
            e.shieldV = noShield ? [] : viruses.filter(v => {
                if (!canEat(e.s, v.s)) return false;
                const vx = v.x - center.x, vy = v.y - center.y, dv = Math.hypot(vx, vy) || 1;
                // roughly in the threat's direction and nearer than it (we only move ~400 in the look-ahead)
                return dv < de + 200 && (vx * ex + vy * ey) / (dv * de) > 0.3 - 400 / dv;
            });
        }

        // Coarse 3 s look-ahead for escape routes. My main body heads one way and slides along the wall
        // where the server stops it; each threat chases straight at me at its real speed. The closest any
        // of them gets to its eating range (or split range, if it'd bother) is what a heading costs.
        const bigP = S.mine.reduce((a, b) => (b.s > a.s ? b : a));
        // threats to a piece of a given size: how close they need to get (eat by moving, or split if they'd bother)
        const threatsFor = size => threats.filter(e => !e.fast).map(e => {
            const direct = canEat(e.s, size) ? e.s - size / GAME.eatOverlapDiv : -Infinity;
            const split = splitLikelihood(e, size, e.ownerCells, S) >= 0.5 ? enemySplitReach(e, size, e.ownerCells) : -Infinity;
            return { x: e.x, y: e.y, sp: moveSpeed(e.s), reach: Math.max(direct, split), w: e.w, reachSize: e.s };
        }).filter(e => e.reach > -Infinity && Math.hypot(e.x - center.x, e.y - center.y) < e.reach + moveSpeed(size) * 75 + 1500);
        const longThreats = threatsFor(bigP.s);
        // escape look-ahead: for each of 12 ways out, how long (and how deep) each of our main pieces (the biggest, and up
        // to two more of 12%+ of our mass) spends in someone's split range over the next ~9 s, being caught by touch
        // counting as the rest of the time in it; weighted by the pieces' mass (null = nothing near)
        let escT = null;
        if (CFG.escapeWeight > 0) {
            const ec = conn.escCache;
            if (ec && S.tick - ec.tick < (conn.heavy ? 6 : 3) && ec.n === S.mine.length) escT = ec.t;
            else {
                const main = S.mine.filter(c => c === bigP || mass(c.s) >= 0.12 * S.myMass).sort((a2, b2) => b2.s - a2.s).slice(0, 3);
                const shareSum = main.reduce((a2, c) => a2 + mass(c.s), 0);
                for (const q0 of main) {
                    const hs = [];
                    for (const e of threats) {
                        if ((e.w || 1) < 0.5 || e.fast) continue;
                        // run down by touch, or (one that can only split onto it) just its split range
                        const reach = canEat(e.s, q0.s) ? e.s - q0.s / GAME.eatOverlapDiv : -1e9, sreach = threatReach(S, e, q0.s);
                        if (sreach === -Infinity) continue;
                        const v = moveSpeed(e.s) * 1000 / GAME.tickMs;
                        if (Math.hypot(e.x - q0.x, e.y - q0.y) - sreach > v * CFG.escapeSecs + 600) continue;
                        hs.push({ id: e.id, pieces: [{ x: e.x, y: e.y, v, reach, sreach, cl: [] }] });
                    }
                    if (!hs.length) continue;
                    const pops = S.mine.length < CFG.maxCells && canEat(q0.s, GAME.virusSize);
                    const vir = pops ? S.viruses.filter(v => Math.hypot(v.x - q0.x, v.y - q0.y) < 3000) : [];
                    const env = { P: { x: q0.x, y: q0.y, s: q0.s }, b: S.border, hunters: hs, pv: moveSpeed(q0.s) * 1000 / GAME.tickMs, setup: 0, fleeR: 1e9,
                        eaters: [], fencesP: pops ? trapClusters(vir, q0.s - GAME.virusSize / GAME.eatOverlapDiv).filter(cl => cl.length >= 2) : [],
                        steps: Math.round(CFG.escapeSecs / TRAP_DT), wallTime: CFG.escapeWallTime };
                    escT = escT || new Array(12).fill(0);
                    for (let i = 0; i < 12; i++) { env.force = { a: i / 12 * 2 * Math.PI, steps: 2 }; escT[i] += trapRollout(env, {}).expo * mass(q0.s) / shareSum; }
                }
                conn.escCache = { tick: S.tick, n: S.mine.length, t: escT };
            }
            if (escT && escT.every(x => x < 0.05)) escT = null;
        }
        // its cost for a heading: caught sooner = more, in between the 12 directions blended
        const escapeCost = a => {
            if (!escT) return 0;
            const f = ((a / (2 * Math.PI)) * 12 % 12 + 12) % 12, i0 = Math.floor(f), w = f - i0;
            return (S.mineCommitted ? CFG.mineEscapeMult : 1) * CFG.escapeWeight * S.myMass * (escT[i0] * (1 - w) + escT[(i0 + 1) % 12] * w) / CFG.escapeSecs;
        };
        const LB = S.border;
        // worst closeness (0 = safe, 1 = at its reach, more = inside) over 3 s for a piece of `size` starting at
        // (sx, sy) heading (ux, uy); `head` = ticks the threats already had to close in
        const simLong = (list, sx, sy, size, ux, uy, head) => {
            const sp = moveSpeed(size), inset = size * 0.5;
            let px = sx, py = sy, worst = 0;
            const es = list.map(e => {
                const dx = sx - e.x, dy = sy - e.y, d = Math.hypot(dx, dy) || 1, step = Math.min(e.sp * head, d);
                return { ...e, x: e.x + dx / d * step, y: e.y + dy / d * step };
            });
            for (let t = 5; t <= 75; t += 5) {
                px += ux * sp * 5; py += uy * sp * 5;
                if (LB) { px = Math.max(LB.minX + inset, Math.min(LB.maxX - inset, px)); py = Math.max(LB.minY + inset, Math.min(LB.maxY - inset, py)); }
                for (const e of es) {
                    const dx = px - e.x, dy = py - e.y, d = Math.hypot(dx, dy) || 1, step = Math.min(e.sp * 5, d);
                    e.x += dx / d * step; e.y += dy / d * step;
                    const c = zone(Math.hypot(px - e.x, py - e.y) - e.reach, 250) * e.w;
                    if (c > worst) worst = c;
                }
            }
            return worst;
        };
        // each big piece (20%+ of our mass, up to 3) along its own path, from where it is to our aim point
        const bigPieces = S.mine.filter(c => c === bigP || mass(c.s) >= 0.2 * S.myMass).sort((a2, b2) => b2.s - a2.s).slice(0, 3)
            .map(c => ({ c, threats: c === bigP ? longThreats : threatsFor(c.s) })).filter(x => x.threats.length);
        const longDangerTo = (ax, ay) => {
            let sum = 0;
            for (const { c, threats } of bigPieces) {
                const dx = ax - c.x, dy = ay - c.y, dl = Math.hypot(dx, dy);
                const ux = dl > 30 ? dx / dl : 0, uy = dl > 30 ? dy / dl : 0;
                sum += simLong(threats, c.x, c.y, c.s, ux, uy, 0) * mass(c.s);
            }
            return sum;
        };
        const longDanger = (ux, uy) => simLong(longThreats, center.x, center.y, bigP.s, ux, uy, 0) * mass(bigP.s);
        // a heading into the border: we stop (head-on) or slide at the along-the-wall part of our speed (at an angle)
        const threatened = (conn.danger || 0) > 0.05 * S.myMass + 1 || longThreats.length > 0;
        // escaping toward food: players our biggest piece can eat, with no bigger player on the way
        const fleePrey = [];
        if (threatened && CFG.fleePreyWeight > 0) {
            const chasers = S.enemies.filter(e => !e.remote && canEat(e.s, bigP.s));
            for (const e of S.enemies) {
                if (e.remote || !canEat(bigP.s, e.s * CFG.eatMargin)) continue;
                const d = Math.hypot(e.x - center.x, e.y - center.y);
                if (d - bigP.s > 1500) continue;
                if (chasers.some(o => { const r = threatReach(S, o, bigP.s); return r > -Infinity && segDist(o.x, o.y, center.x, center.y, e.x, e.y) < r + 120; })) continue;
                const grown = Math.sqrt(bigP.s * bigP.s + e.s * e.s);
                const saves = chasers.length && chasers.every(o => !canEat(o.s, grown) || Math.hypot(o.x - center.x, o.y - center.y) > 2500);
                fleePrey.push({ a: Math.atan2(e.y - center.y, e.x - center.x), w: CFG.fleePreyWeight * mass(e.s) * (saves ? 5 : 1) * (1 - Math.max(0, d - bigP.s) / 1500) });
            }
        }
        // players we must never run at: anything that could eat our biggest piece, or pieces holding a third of our mass
        const headOn = [];
        if (CFG.headOnWeight > 0) for (const e of S.enemies) {
            if (e.remote) continue;
            let at = 0;
            if (canEat(e.s, bigP.s)) at = S.myMass;
            else { let m = 0; for (const q of S.mine) if (canEat(e.s, q.s)) m += mass(q.s); if (m > S.myMass / 3) at = m; }
            if (!at) continue;
            const d = Math.hypot(e.x - center.x, e.y - center.y), edge = d - e.s - bigP.s;
            if (edge > CFG.headOnRange) continue;
            headOn.push({ a: Math.atan2(e.y - center.y, e.x - center.x), w: CFG.headOnWeight * CFG.dangerWeight * at * (1 - Math.max(0, edge) / CFG.headOnRange) });
        }
        // sidestep (3.36.0): the player's recordings dodge at ~90 deg to a threat, the bot ran ~40 deg off straight away -
        // and a straight line is what a split hits. Running dead straight away from anyone who could split onto us costs
        // a little (sharp: cos^6, so 30-40 deg off is nearly free); the look-ahead still decides the real escape
        const straightAway = [];
        if (CFG.sidestepWeight > 0) for (const e of S.enemies) {
            if (e.remote) continue;
            const r = threatReach(S, e, bigP.s);
            if (!(r > -Infinity)) continue;
            const d = Math.hypot(e.x - center.x, e.y - center.y);
            if (d > r + 600 || d < e.s) continue;
            const near = 1 - Math.max(0, d - r) / 600;
            straightAway.push({ a: Math.atan2(center.y - e.y, center.x - e.x), w: CFG.sidestepWeight * CFG.dangerWeight * S.myMass * near });
        }
        let spread0 = 0; for (const c of S.mine) spread0 = Math.max(spread0, Math.hypot(c.x - center.x, c.y - center.y)); spread0 *= 0.5;
        const wallCost = (ux, uy) => {
            const sp = moveSpeed(bigP.s), inset = maxMine * 0.6 + spread0;
            let px = center.x, py = center.y, lost = 0, minGap = Infinity;
            for (let t = 5; t <= 50; t += 5) {
                const nx = Math.max(LB.minX + inset, Math.min(LB.maxX - inset, px + ux * sp * 5));
                const ny = Math.max(LB.minY + inset, Math.min(LB.maxY - inset, py + uy * sp * 5));
                lost += 1 - Math.hypot(nx - px, ny - py) / (sp * 5);
                px = nx; py = ny;
                minGap = Math.min(minGap, px - LB.minX - inset, LB.maxX - inset - px, py - LB.minY - inset, LB.maxY - inset - py);
            }
            const slow = lost / 10, near = Math.exp(-Math.max(0, minGap) / 350);
            return CFG.wallWeight * (threatened ? 1 : CFG.wallCalm) * S.myMass * (slow + 0.4 * near * (slow > 0.02 ? 1 : 0.5));
        };

        const ctx = { threats, food, prey, viruses, stamp: 0,
            foodMark: new Uint32Array(food.length), preyMark: new Uint32Array(prey.length) };
        const base = startPieces(S);
        let spread = 0;
        for (const p of base) spread = Math.max(spread, Math.hypot(p.x - center.x, p.y - center.y));
        const aimDist = 300 + maxMine + spread;
        const wx = conn.waypoint.x - center.x, wy = conn.waypoint.y - center.y, wl = Math.hypot(wx, wy) || 1;

        const split = base.length > 1;
        // server merge timer ("old" merge version): 30s + size * 0.02s, from the piece's birth
        const mergeReady = S.mine.filter(c => S.tick - c.born >= 25 * 60 + Math.round(c.s * 0.5)).length >= 2;
        const cohesionW = CFG.cohesionWeight * (mergeReady ? 3 : 1);
        // in pieces, getting back together beats wandering toward a random waypoint
        const exploreHere = split && t >= conn.exploreUntil ? exploreW * 0.5 : exploreW;
        const scoreOf = (r, a, gather) => {
            const ux = Math.cos(a), uy = Math.sin(a);
            // a gather aim barely moves the group, so it only gets part of the heading-based pulls
            const headingW = gather ? 0.3 : 1;
            let score = r.foodGain + r.preyGain * CFG.preyWeight + r.virusGain - r.virusCost - r.wall
                - CFG.dangerWeight * (S.phase === 'small' ? 1.25 : 1) * r.danger;
            score += headingW * CFG.foodFieldWeight * foodField(S, ux, uy, maxMine);
            score += headingW * exploreHere * (ux * wx + uy * wy) / wl;
            for (const p of pulls) score += headingW * p.w * Math.cos(a - p.a);
            // walls: a heading that's fine for 0.6 s can still run us into the edge a second later
            // a gather aim barely moves us: it pays the long-range danger of staying put (it used to pay none)
            if (bigPieces.length) score -= CFG.longDangerWeight * (r.aimPt ? longDangerTo(r.aimPt.x, r.aimPt.y) : (gather ? longDanger(0, 0) : longDanger(Math.cos(a), Math.sin(a))));
            // walls: the speed the border takes off this heading over the next 2 s, and ending up at the edge
            if (LB && !gather) score -= wallCost(ux, uy);
            // the border is never a way out: with threats around, any heading toward a near wall costs a lot
            if (LB && !gather && (escT || conn.danger > 0.03 * S.myMass)) {
                const R = CFG.wallFleeRange;
                for (const [g, nx, ny] of [[center.x - LB.minX, -1, 0], [LB.maxX - center.x, 1, 0], [center.y - LB.minY, 0, -1], [LB.maxY - center.y, 0, 1]]) {
                    if (g >= R) continue;
                    const out = ux * nx + uy * ny;
                    if (out > 0) score -= CFG.wallFleeWeight * S.myMass * (1 - g / R) * out;
                }
            }
            // the escape look-ahead (a gather aim stays put: it pays the worst of the ways out)
            if (escT) score -= gather ? (S.mineCommitted ? CFG.mineEscapeMult : 1) * CFG.escapeWeight * S.myMass * Math.max(...escT) / CFG.escapeSecs : escapeCost(a);
            // escaping onto food
            if (!gather) for (const f of fleePrey) { const c = Math.cos(a - f.a); if (c > 0.5) score += f.w * (c - 0.5) / 0.5; }
            // never straight at a player that could eat us
            if (!gather) for (const h of headOn) { const c = Math.cos(a - h.a); if (c > 0.3) score -= h.w * (c - 0.3) / 0.7; }
            if (!gather) for (const h of straightAway) { const c = Math.cos(a - h.a); if (c > 0.5) score -= h.w * Math.pow(c, 6); }
            // pieces only merge by touching after their merge timer, so keep them close
            if (split) score -= cohesionW * r.spread / 100;
            if (!isNaN(conn.botDir)) score += (CFG.hysteresis + CFG.hysteresisMass * S.myMass + CFG.fleeCommit * CFG.dangerWeight * (conn.danger || 0)) * Math.cos(a - conn.botDir);
            return score;
        };
        const scored = [];
        const tryAim = (a, dist, gather) => {
            const aim = { x: center.x + Math.cos(a) * dist, y: center.y + Math.sin(a) * dist };
            const r = evalMove(S, base.map(p => ({ ...p })), aim, ctx);
            r.aimPt = aim;
            scored.push({ a, aim, score: scoreOf(r, a, gather), danger: r.danger, r, gather });
        };
        for (let i = 0; i < CFG.dirs; i++) tryAim(i / CFG.dirs * Math.PI * 2, aimDist, false);
        // when split: short aims near my own centre pull the pieces together while drifting
        if (split) {
            let ms = 0, mm = 0;
            for (const p of base) { ms += Math.hypot(p.x - center.x, p.y - center.y) * p.s * p.s; mm += p.s * p.s; }
            const gatherDist = Math.max(60, 0.4 * ms / mm);
            // (not while in real danger: drawing the pieces together nearly stops us - running is what saves us then)
            if (!(conn.danger > 0.1 * S.myMass + 1)) for (let i = 0; i < 8; i++) tryAim(i / 8 * Math.PI * 2, gatherDist, true);
        }
        scored.sort((x, y) => y.score - x.score);
        let best = scored[0];

        // commitment: while safe, stick with the current heading unless something is clearly better
        if (!isNaN(conn.botDir) && best.danger < 0.05 * S.myMass + 1) {
            let prev = null, pd = Infinity;
            for (const s of scored) {
                let d = Math.abs(s.a - conn.botDir) % (2 * Math.PI);
                if (d > Math.PI) d = 2 * Math.PI - d;
                if (d < pd) { pd = d; prev = s; }
            }
            if (prev && prev.danger < 0.05 * S.myMass + 1 &&
                prev.score >= best.score - (CFG.switchMargin + 0.1 * Math.abs(best.score))) best = prev;
        } else if (!isNaN(conn.botDir) && CFG.dangerCommit) {
            // ...and under danger too (live: 229 of 341 wobbles in an hour had danger - two near-equal ways out, picked
            // in turn every tick = going nowhere until caught). Keep the way out we're on unless another is clearly
            // less dangerous; a nearly-as-good way out taken now beats the best one taken half the time.
            let prev = null, pd = Infinity;
            for (const s of scored) {
                if (s.gather) continue;
                let d = Math.abs(s.a - conn.botDir) % (2 * Math.PI);
                if (d > Math.PI) d = 2 * Math.PI - d;
                if (d < pd) { pd = d; prev = s; }
            }
            if (prev && prev !== best && prev.danger <= best.danger * CFG.dangerCommitRatio + 0.02 * S.myMass &&
                prev.score >= best.score - (CFG.switchMargin + CFG.dangerCommitFrac * Math.abs(best.score))) best = prev;
        }
        const out = { aim: best.aim, split: false, danger: best.danger, dangerBefore: best.danger };

        // Escape split: only when something can actually catch us by *moving* on every heading.
        // Split threats aren't a reason: splitting away from one just hands it two smaller targets,
        // and huge, slow cells are better outrun than split from.
        // (the user, 2026-10-25) and only when it's real: a much bigger player overlapping one of our pieces, or its
        // split flying at us. Splitting away from someone who merely COULD catch the pieces just broke us up.
        const hostileE = e => e.player && !e.remote && !isAlly(e) && !S.conn.mateKeys.has(e.key);
        const overlapped = S.mine.some(m => S.enemies.some(e => hostileE(e) && canEat(e.s, m.s) && mass(e.s) >= CFG.escapeSplitBigRatio * mass(m.s) &&
            Math.hypot(e.x - m.x, e.y - m.y) < e.s + m.s));
        const splitIncoming = !overlapped && S.enemies.some(e => hostileE(e) && isFast(e.vx, e.vy, e.s) &&
            S.mine.some(m => canEat(e.s, m.s) && Math.hypot(e.x - m.x, e.y - m.y) - e.s - m.s < 1000 && closingOn(e, m) > moveSpeed(e.s) * 1.5));
        if (CFG.escapeSplits && (overlapped || splitIncoming) && !S.mergeKeys.size && best.r.moveDanger > CFG.escapeDangerFrac * S.myMass && S.mine.length < GAME.maxCells &&
            S.mine.some(c => c.s >= GAME.minSplitSize)) {
            const top = scored.filter(c => !c.gather).slice(0, 5);
            // Truly trapped? Only if something catches us by plain *movement* within 3 s on every one of the
            // best headings (walls, corners, faster players all round). If we can outrun them, never split.
            const catchers = longThreats.map(e => ({ ...e, reach: canEat(e.reachSize, bigP.s) ? e.reachSize - bigP.s / GAME.eatOverlapDiv : -Infinity }))
                .filter(e => e.reach > -Infinity);
            const trapped = catchers.length && Math.min(...top.map(c => simLong(catchers, center.x, center.y, bigP.s, Math.cos(c.a), Math.sin(c.a), 0))) >= 1;
            // how cornered we are over the next 3 s if we just run (best heading)
            const stayLong = Math.min(...top.map(c => simLong(longThreats, center.x, center.y, bigP.s, Math.cos(c.a), Math.sin(c.a), 0)));
            const halfS = bigP.s / SQRT2, halfThreats = threatsFor(halfS);
            for (const cand of trapped ? top : []) {
                const pieces = applySplits(base.map(p => ({ ...p })), cand.aim, 1);
                const r = evalMove(S, pieces, cand.aim, ctx);
                const score = r.foodGain + r.preyGain - r.virusCost - r.wall - CFG.dangerWeight * r.danger - CFG.splitCostFrac * S.myMass;
                // The 0.6 s look can't see what happens after the halves land: smaller halves can be eaten by
                // more players, and with threats on both sides there may be nowhere to land. Check the front
                // half's next 3 s from where it lands; only split if that's clearly safer than staying whole.
                const ux = Math.cos(cand.a), uy = Math.sin(cand.a), hop = GAME.splitDistance + GAME.splitBoost * 0.9;
                const halfLong = simLong(halfThreats, center.x + ux * hop, center.y + uy * hop, halfS, ux, uy, 12);
                if (halfLong > Math.max(0.6, 0.5 * stayLong)) continue;
                // a split only saves the front half (the rear one often still dies), so just require
                // it to be clearly better overall; the gate above already rules out outrunnable threats
                if (score > best.score + 0.1 * S.myMass) {
                    out.aim = cand.aim; out.split = true; out.danger = r.danger; out.dangerBefore = best.danger;
                    best = { ...cand, score };
                }
            }
        }

        conn.botDir = best.a;
        conn.danger = out.danger;
        out.best = best;
        out.scored = scored;
        conn.lastScored = scored; conn.lastThreats = threats; conn.lastPulls = pulls; // for debugging (deathcheck, wobble log)
        const topPull = pulls.reduce((a, p) => (!a || p.w > a.w ? p : a), null);
        const shielded = threats.length && best.danger > 0.05 * S.myMass && S.viruses.some(v =>
            threats.some(e => canEat(e.s, v.s) && segDist(v.x, v.y, e.x, e.y, center.x, center.y) < v.s + e.s * 0.35 &&
                Math.hypot(v.x - center.x, v.y - center.y) < Math.hypot(e.x - center.x, e.y - center.y)));
        conn.mode = out.split ? 'escape' : best.danger > 0.15 * S.myMass ? (shielded ? 'evade (virus shield)' : 'evade')
            : topPull && topPull.w > 8 && Math.cos(best.a - topPull.a) > 0.5 ? topPull.label
            : best.r.preyGain > best.r.foodGain ? 'hunt' : best.gather ? 'regroup' : S.food.length ? 'farm' : 'roam';
        return out;
    }

    // Smooth food attraction: every visible pellet pulls toward headings that pass near it,
    // fading with sideways offset and distance ahead. Continuous in the heading, so food
    // entering/leaving view can't flip the decision back and forth.
    function foodField(S, ux, uy, radius) {
        let v = 0;
        const cx = S.center.x, cy = S.center.y;
        for (const f of S.food) {
            const fp = f.land || f;
            const rx = fp.x - cx, ry = fp.y - cy;
            const ahead = rx * ux + ry * uy;
            if (ahead < -radius) continue;
            const side = Math.abs(rx * uy - ry * ux);
            if (f.avoid) continue;
            v += mass(f.s) * (f.w || 1) * Math.exp(-Math.max(0, side - radius) / 200) * Math.exp(-Math.max(0, ahead) / 1200);
        }
        return v;
    }

    // #10 Map memory: choose roaming targets from what we've seen: squares that had lots of food
    // (pellets regrow, so old memories drift back to "average"), away from where threats were last seen.
    // where the big players have been (3.36.0): a coarse 2000-unit grid of giant mass seen by any of us (shared sight
    // included), fading over CFG.quietMemoryMs, so wandering picks the quiet part of the map, not just what's in view
    const bigGrid = new Map();   // "gx,gy" -> { m, t }
    function noteBigPlayers(S) {
        const t = now(), seen = new Set();
        for (const e of S.enemies) {
            if (!e.player || seen.has(e.id)) continue; seen.add(e.id);
            const m = mass(e.s); if (m < Math.max(1000, S.myMass * 2)) continue;
            const k = Math.floor(e.x / 2000) + ',' + Math.floor(e.y / 2000);
            const g = bigGrid.get(k), old = g ? g.m * Math.exp(-(t - g.t) / CFG.quietMemoryMs) : 0;
            bigGrid.set(k, { m: old + m * 0.1, t });
        }
    }
    const bigAt = (x, y) => {
        let v = 0; const t = now(), gx = Math.floor(x / 2000), gy = Math.floor(y / 2000);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const g = bigGrid.get((gx + i) + ',' + (gy + j)); if (g) v += g.m * Math.exp(-(t - g.t) / CFG.quietMemoryMs) * (i || j ? 0.4 : 1); }
        return v;
    };
    function pickWaypoint(S, minDist) {
        const b = S.border || { minX: -7000, minY: -7000, maxX: 7000, maxY: 7000 };
        const conn = S.conn, t = now();
        let sum = 0, n = 0;
        for (const g of conn.foodGrid.values()) { sum += g.food; n++; }
        const prior = n ? sum / n : 30;
        const bigThreats = [...conn.ghosts.values()].map(g => g.cell)
            .concat(S.enemies).filter(e => S.mine.some(m => canEat(e.s, m.s)));
        let best = null;
        for (let i = 0; i < 24; i++) {
            const x = b.minX + (b.maxX - b.minX) * (0.1 + 0.8 * Math.random());
            const y = b.minY + (b.maxY - b.minY) * (0.1 + 0.8 * Math.random());
            const d = Math.hypot(x - S.center.x, y - S.center.y);
            if (d < minDist && i < 23) continue;
            const g = conn.foodGrid.get(Math.floor(x / 1000) + ',' + Math.floor(y / 1000));
            const fresh = g ? Math.exp(-(t - g.t) / 60000) : 0;
            const food = g ? g.food * fresh + prior * (1 - fresh) : prior * 1.1; // unexplored: slight bonus
            let score = food - d / 400;
            for (const e of bigThreats) score -= 40 * Math.exp(-Math.hypot(e.x - x, e.y - y) / 1500);
            if (CFG.quietWeight) score -= CFG.quietWeight * Math.log1p(bigAt(x, y) / 2000);
            if (!best || score > best.score) best = { x, y, t, score };
        }
        return best;
    }

    // ---------------------------------------------------------------- autopilot: virus shots
    // 5 ejected-mass hits on a virus launch a new one along the last hit's direction (±0.3 rad).
    // We stop on the line behind the virus, then fire down that line at the server's max eject rate.
    function findVirusShot(S) {
        if (now() < (S.conn.virusCapUntil || 0)) return null;
        const shooters = S.mine.filter(c => c.s >= GAME.minEjectSize);
        if (!shooters.length || shooters.length > 2) return null;
        const M = shooters.reduce((a, b) => (b.s > a.s ? b : a));
        let best = null;
        const t = now();
        for (const v of S.viruses) {
            if (v.remote || (S.conn.vshotBan.get(v.id) || 0) > t) continue;
            // every piece heads for the same stand-off point, so only the shooter may be big enough to pop
            if (S.mine.some(c => c !== M && canEat(c.s, v.s))) continue;
            const dMV = Math.hypot(v.x - M.x, v.y - M.y);
            if (dMV > 900 + M.s) continue;
            const fed = Math.max(0, Math.min(GAME.virusFeedTimes - 1, Math.round((v.s * v.s - GAME.virusSize ** 2) / GAME.ejectSize ** 2)));
            const need = GAME.virusFeedTimes - fed;
            for (const T of S.enemies) {
                if (T.remote || !canEat(T.s, v.s) || T.s < 180) continue;
                const oc = S.ownerCount.get(T.key) || 1;
                if (oc >= GAME.maxCells) continue;
                const dVT = Math.hypot(T.x - v.x, T.y - v.y);
                if (dVT > GAME.virusSplitBoost * 0.9 + T.s - 60 || dVT < T.s * 0.6 + 100) continue;
                const ux = (T.x - v.x) / dVT, uy = (T.y - v.y) / dVT;
                // I must already be on the far side of the virus (or small enough to pass through it)
                if (canEat(M.s, v.s) && ((M.x - v.x) * -ux + (M.y - v.y) * -uy) < 0) continue;
                let val = 0;
                if (canEat(T.s, M.s) && Math.hypot(T.x - M.x, T.y - M.y) < 1600) val += mass(M.s) * 0.6;
                const pieceSize = T.s / Math.sqrt(Math.min(GAME.maxCells - oc + 1, 8));
                if (canEat(M.s, pieceSize)) val += mass(T.s) * 0.35;
                if (S.captain && S.captain.order.mode === 'protect') { const cc = memberCenter(S.captain), cb = memberBig(S.captain);
                    if (Math.hypot(T.x - cc.x, T.y - cc.y) < T.s + cb + 1500 && T.s > cb * 0.8) val += mass(T.s) * 0.6; }
                const cost = need * mass(GAME.ejectLoss) * shooters.length + dMV * 0.02;
                const score = val - cost;
                if (score > CFG.virusMinValue && (!best || score > best.score))
                {
                    const reachMs = 800 + dMV / moveSpeed(M.s) * GAME.tickMs; // time to get into position
                    best = { score, vId: v.id, tId: T.id, until: t + reachMs + 2000, alignBy: t + reachMs,
                        vSize: v.s, startSize: v.s, shots: 0, firing: false };
                }
            }
        }
        return best;
    }

    // returns true while it is controlling the cell
    function stepVirusShot(conn, S) {
        const vs = conn.vshot;
        const v = conn.cells.get(vs.vId), T = conn.cells.get(vs.tId);
        const M = S.mine.filter(c => c.s >= GAME.minEjectSize).sort((a, b) => b.s - a.s)[0];
        // any ending other than a successful shot bans this virus for a while, so we can't
        // hover next to it retrying the same shot over and over
        const end = (msg, ok) => {
            conn.vshot = null;
            if (!ok) conn.vshotBan.set(vs.vId, now() + 8000);
            if (msg) hud.flash(msg);
            return false;
        };
        if (!v || !T || !M) return end('');
        if (now() > vs.until || (!vs.shots && now() > vs.alignBy)) return end(vs.shots ? 'virus shot: gave up' : 'virus shot: couldn\'t line up');
        if (vs.shots && v.s < vs.vSize - 5) return end('virus shot fired at ' + (T.name || 'enemy'), true);
        vs.vSize = Math.max(vs.vSize, v.s);
        // the server ignores feeding when it's at its virus cap: mass flies straight through.
        // That's server-wide, so pause all virus shots for a while rather than trying the next virus.
        // (we request every tick but the server only ejects every 2nd, and hits show up after the lag)
        if (vs.firing && conn.tick - vs.fireTick >= Math.ceil(S.L) + 8 && v.s <= vs.startSize + 1) {
            if (CFG.virusCap) conn.virusCapUntil = now() + 20000;
            return end('virus shot: viruses aren\'t taking mass (server at virus cap?)', true);
        }

        // abort if someone else (or a team) can split-kill me where I'm standing
        for (const Tm of teamBlobs(S)) {
            if (Tm.key === T.key) continue;
            const reach = Math.max(canEat(Tm.s, M.s) ? Tm.s + 600 : -Infinity, splitReach(Tm.s, M.s, 1, 2, true) + CFG.teamerReachExtra);
            if (Math.hypot(Tm.x - M.x, Tm.y - M.y) < reach + 100) return end('virus shot: aborted (a team is close)');
        }
        for (const e of S.enemies) {
            if (e.id === T.id) continue;
            const oc = S.ownerCount.get(e.key) || 1;
            const sr = splitLikelihood(e, M.s, oc, S) >= 0.5 ? enemySplitReach(e, M.s, oc) : -Infinity;
            const reach = Math.max(sr, canEat(e.s, M.s) ? e.s + 250 : -Infinity);
            if (Math.hypot(e.x - M.x, e.y - M.y) < reach + 100) return end('virus shot: aborted (threat)');
        }

        // The server ejects along (mouse - cell centre). A mouse parked just in front of the cell makes
        // that direction hostage to any error in where we think the cell is, so instead the mouse goes
        // far down the firing line, and we accept that the cell drifts toward the virus while firing:
        // start far enough back that every shot we still need is out before we get near pop distance.
        const dVT = Math.hypot(T.x - v.x, T.y - v.y) || 1;
        const ux = (T.x - v.x) / dVT, uy = (T.y - v.y) / dVT;
        const m = predict(M, S.L, S.tick);
        const sp = moveSpeed(M.s);
        const fed = Math.max(0, Math.round((v.s * v.s - GAME.virusSize ** 2) / GAME.ejectSize ** 2));
        const need = Math.max(1, GAME.virusFeedTimes - fed);
        const edge = Math.hypot(v.x - m.x, v.y - m.y) - M.s;           // my edge -> virus centre
        // closest the edge may get: pop line (centre dist <= M.s - v.s/3), plus margin, plus lag drift
        const stopAt = canEat(M.s, v.s) ? -v.s / GAME.eatOverlapDiv + CFG.virusMargin + sp * S.L : -Infinity;
        // ejects come out every 2 ticks; spawn closer than ~300 to the virus so the ±0.3 rad spread still hits
        const fireFrom = Math.min(320, Math.max(stopAt, 0) + sp * (2 * need + 1) + 15);
        const far = { x: v.x + ux * 1500, y: v.y + uy * 1500 };
        if (!shrinkSafe(S, S.mine, need * mass(GAME.ejectLoss))) return end('virus shot: called off, the shots would make us catchable');
        conn.mode = 'virus shot';
        if (vs.firing) {
            if (edge <= stopAt) return end('virus shot: ran out of room');
            conn.sendMouse(far.x, far.y);
            conn.sendEject();
            conn.botAim = far;
            vs.shots++;
            return true;
        }
        // staging: stop on the firing line, fireFrom back from the virus
        const stage = { x: v.x - ux * (M.s + fireFrom), y: v.y - uy * (M.s + fireFrom) };
        const cross = Math.abs((m.x - v.x) * uy - (m.y - v.y) * ux);
        const off = Math.hypot(stage.x - m.x, stage.y - m.y);
        if (off <= Math.max(25, M.s * 0.1) && cross <= Math.max(12, M.s * 0.04)) {
            vs.firing = true;
            vs.fireTick = conn.tick;
            vs.until = Math.max(vs.until, now() + (2 * need + 6) * GAME.tickMs + CFG.defaultRttMs * 2);
            conn.sendMouse(far.x, far.y);
            conn.sendEject();
            conn.botAim = far;
            vs.shots++;
        } else {
            conn.sendMouse(stage.x, stage.y); // arrives and stops there (server moves min(speed, distance))
            conn.botAim = stage;
        }
        return true;
    }

    // ---------------------------------------------------------------- autopilot: flank
    // A big player is in front of us with a tail of small bits behind it (fed pieces, split leftovers).
    // Going straight would mean going through the big part, so we curve around it on a tangent,
    // keeping flankClear outside its eating range, then eat the bits. Only taken when eating what we
    // can reach makes us bigger than half its big part (so one split from it can't eat us after),
    // and when that big part can't, or won't bother to, split onto us on the way.
    const segDist = (px, py, ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        return Math.hypot(px - ax - k * dx, py - ay - k * dy);
    };
    const MERGE_TICKS = s => 25 * 60 + Math.round(s * 0.5); // server merge timer (~60 s on this server)

    function flankBits(S, group, B, M, etaTicks) {
        // bits we can eat by moving, that won't have merged back into the big part before we arrive
        return group.filter(c => c !== B && canEat(M.s, c.s) &&
            S.tick - c.born + etaTicks < MERGE_TICKS(c.s) && Math.hypot(c.x - B.x, c.y - B.y) < 1600 + B.s);
    }

    function findFlank(S) {
        const t = now();
        // circling a big player is a calm-time move: not while something is already after us
        if (S.conn.danger > 0.15 * S.myMass) return null;
        const M = S.mine.reduce((a, b) => (b.s > a.s ? b : a));
        const groups = new Map();
        for (const e of S.enemies) { if (!groups.has(e.key)) groups.set(e.key, []); groups.get(e.key).push(e); }
        let best = null;
        for (const [key, group] of groups) {
            if (group.length < 3 || (S.conn.flankBan.get(key) || 0) > t) continue;
            const B = group.reduce((a, b) => (b.s > a.s ? b : a));
            if (!canEat(B.s, M.s)) continue; // the big part isn't a threat: normal hunting handles it
            const dPB = Math.hypot(B.x - M.x, B.y - M.y);
            if (dPB > 2600) continue;
            const oc = group.length;
            // it must not be able (max cells) or want (we're not worth it) to split onto us while we circle
            if (oc < GAME.maxCells && splitLikelihood(B, M.s, oc, S) >= 0.5 && enemySplitReach(B, M.s, oc) > -Infinity) continue;
            const Rs = B.s - M.s / GAME.eatOverlapDiv + CFG.flankClear;
            // rough path: reach the safe circle, go round a quarter of it, then on to the bits
            const etaTicks = (Math.max(0, dPB - Rs) + Math.PI / 2 * Rs + 600) / moveSpeed(M.s);
            if (etaTicks * GAME.tickMs > CFG.flankMaxMs) continue;
            const bits = flankBits(S, group, B, M, etaTicks);
            if (!bits.length) continue;
            // only worth a special move if the big part actually blocks the way to some of them
            if (!bits.some(c => segDist(B.x, B.y, M.x, M.y, c.x, c.y) < Rs)) continue;
            const gain = bits.reduce((a, c) => a + mass(c.s), 0);
            if (gain < Math.max(CFG.flankMinGain, 0.15 * S.myMass)) continue;
            // the point of it: afterwards we're bigger than half of their big part
            if (S.myMass + gain * 0.8 <= mass(B.s) / 2) continue;
            const C = centroid(bits);
            // go round on the side the bits are on
            const side = Math.sign((B.x - M.x) * (C.y - M.y) - (B.y - M.y) * (C.x - M.x)) || 1;
            const score = gain / (etaTicks + 20);
            if (!best || score > best.score)
                best = { score, key, side, gain, until: t + etaTicks * GAME.tickMs * 1.6 + 1500, startMass: S.myMass, bName: B.name };
        }
        if (best) hud.flash(`flank: going round ${best.bName || 'them'} for ~${Math.round(best.gain)} mass of bits`);
        return best;
    }

    // returns true while it is controlling the cells
    function stepFlank(conn, S) {
        const f = conn.flank, t = now();
        const end = (msg, ban) => {
            conn.flank = null;
            if (ban) conn.flankBan.set(f.key, t + 8000);
            if (msg) hud.flash(msg);
            return false;
        };
        const group = S.enemies.filter(e => e.key === f.key);
        if (group.length < 2) return end(S.myMass > f.startMass ? `flank: done (+${Math.round(S.myMass - f.startMass)})` : '');
        const B = group.reduce((a, b) => (b.s > a.s ? b : a));
        const M = S.mine.reduce((a, b) => (b.s > a.s ? b : a));
        const m = predict(M, S.L, S.tick);
        const bits = flankBits(S, group, B, M, 0);
        if (!bits.length) return end(`flank: done (+${Math.round(S.myMass - f.startMass)})`);
        if (t > f.until) return end('flank: took too long', true);
        if (!canEat(B.s, M.s)) return end(''); // we outgrew it: normal play (and smart split) takes over
        // safety: the big part closing in, or anyone else who could eat us
        const gap = Math.hypot(B.x - m.x, B.y - m.y) - (B.s - M.s / GAME.eatOverlapDiv);
        if (gap < CFG.flankClear * 0.35) return end('flank: aborted (too close)', true);
        const oc = group.length;
        if (oc < GAME.maxCells && splitLikelihood(B, M.s, oc, S) >= 0.5 && gap < enemySplitReach(B, M.s, oc) - (B.s - M.s / GAME.eatOverlapDiv))
            return end('flank: aborted (they can split on us now)', true);
        for (const e of S.enemies) {
            if (e.key === f.key) continue;
            for (const c of S.mine) {
                const reach = Math.max(canEat(e.s, c.s) ? e.s - c.s / GAME.eatOverlapDiv + moveSpeed(e.s) * 8 : -Infinity,
                    splitLikelihood(e, c.s, S.ownerCount.get(e.key) || 1, S) >= 0.5 ? enemySplitReach(e, c.s, S.ownerCount.get(e.key) || 1) : -Infinity);
                if (reach > -Infinity && Math.hypot(e.x - c.x, e.y - c.y) < reach + 150) return end('flank: aborted (other threat)', true);
            }
        }
        // nearest bit (where it will be), and whether the big part is in the way
        let tgt = null, td = Infinity;
        for (const c of bits) {
            const p = predict(c, S.L + 5, S.tick), d = Math.hypot(p.x - m.x, p.y - m.y);
            if (d < td) { td = d; tgt = p; }
        }
        const Rs = B.s - M.s / GAME.eatOverlapDiv + CFG.flankClear;
        let heading;
        if (segDist(B.x, B.y, m.x, m.y, tgt.x, tgt.y) < Rs) {
            const dx = B.x - m.x, dy = B.y - m.y, d = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
            // Tangent to the safe ring on our side. A pure tangent has no outward speed, so a big part
            // coming at us would close the gap at its full speed: angle outward by asin(closing / my
            // speed) to hold the distance, and push back out harder if we've drifted inside the ring.
            const closing = Math.max(0, -(B.vx * dx + B.vy * dy) / (d || 1)); // B's speed toward us
            const beta = Math.asin(Math.min(0.95, closing / moveSpeed(M.s)));
            const corr = Math.max(0, Math.min(0.8, 1.5 * (Rs - d) / Rs));
            // (side +1 = the bits are counter-clockwise of the big part, so we pass it on that side)
            heading = th + f.side * ((d > Rs ? Math.asin(Rs / d) : Math.PI / 2) + beta + corr);
            conn.mode = 'flank (circling)';
        } else {
            heading = Math.atan2(tgt.y - m.y, tgt.x - m.x);
            conn.mode = `flank (eating, ${bits.length} left)`;
        }
        const aim = { x: m.x + Math.cos(heading) * 700, y: m.y + Math.sin(heading) * 700 };
        conn.sendMouse(aim.x, aim.y);
        conn.botAim = aim;
        conn.botDir = heading;
        return true;
    }

    // ---------------------------------------------------------------- boss moves: actions
    // Every cell >= minEjectSize shoots along (mouse - its centre), so the mouse is how we pick the target.

    // segment a->b is clear of viruses and enemy cells (blobs would feed them)
    function lineClear(S, ax, ay, bx, by, exceptKey) {
        const len = Math.hypot(bx - ax, by - ay), slack = GAME.ejectSize + 10 + 0.15 * len;
        for (const v of S.viruses) if (segDist(v.x, v.y, ax, ay, bx, by) < v.s + slack) return false;
        for (const e of S.enemies) if (e.key !== exceptKey && segDist(e.x, e.y, ax, ay, bx, by) < e.s + slack) return false;
        return true;
    }

    // #9 Mass bailout: one of my pieces is about to be swallowed and can't get away -> it shoots its mass
    // into a safe piece of mine. Each shot moves 16 mass, every 2 ticks: the killer gets less, and the
    // doomed piece gets lighter (= faster), which sometimes saves it outright.
    function findBailout(S) {
        if (S.mine.length < 2) return null;
        // (no "whole group under threat" stop any more: a piece about to be eaten is exactly when its mass should go to a
        // safe piece, and the aim at that safe piece - checked clear of threats below - moves the group away anyway)
        for (const P of S.mine) {
            // a piece that can still split should escape-split instead (saves half its mass at once)
            if (P.s < GAME.minEjectSize || (P.s >= GAME.minSplitSize && S.mine.length < GAME.maxCells)) continue;
            let doomed = null;
            for (const e of S.enemies) {
                if (!canEat(e.s, P.s)) continue;
                const gap = Math.hypot(e.x - P.x, e.y - P.y) - (e.s - P.s / GAME.eatOverlapDiv);
                const fast = e.vt >= S.tick - 1 && isFast(e.vx, e.vy, e.s);
                const closing = fast ? Math.hypot(e.vx, e.vy) * 3 : Math.max(0, moveSpeed(e.s) - moveSpeed(P.s)) * 4 + 25;
                if (gap < closing) { doomed = e; break; }
            }
            if (!doomed) continue;
            // a safe receiver: nobody near it can eat it, and the line to it is clear
            const safe = S.mine.filter(Q => Q !== P && !S.enemies.some(e => canEat(e.s, Q.s) &&
                Math.hypot(e.x - Q.x, e.y - Q.y) < e.s + 400) && Math.hypot(Q.x - P.x, Q.y - P.y) - P.s - Q.s < GAME.virusSplitBoost * 0.85 &&
                lineClear(S, P.x, P.y, Q.x, Q.y, doomed.key));
            if (!safe.length) continue;
            const Q = safe.reduce((a, q) => (q.s > a.s ? q : a));
            hud.flash(`bailout: piece under attack shoots its mass into a safe piece`);
            return { pId: P.id, qId: Q.id, until: now() + 1200 };
        }
        return null;
    }
    function stepBailout(conn, S) {
        const bo = conn.bailout;
        const P = conn.cells.get(bo.pId), Q = conn.cells.get(bo.qId);
        if (!P || !Q || !conn.mine.has(bo.pId) || !conn.mine.has(bo.qId) || now() > bo.until || P.s < GAME.minEjectSize) {
            conn.bailout = null;
            return false;
        }
        // mouse just past the receiver along P->Q: P's blobs fly into Q
        const d = Math.hypot(Q.x - P.x, Q.y - P.y) || 1;
        const aim = { x: Q.x + (Q.x - P.x) / d * Q.s * 0.5, y: Q.y + (Q.y - P.y) / d * Q.s * 0.5 };
        conn.sendMouse(aim.x, aim.y);
        conn.sendEject();
        conn.botAim = aim;
        conn.mode = 'bailout';
        return true;
    }

    // #3 Feed for the kill: a piece of mine is bigger than an enemy cell but not by the 1.3x mass it
    // needs to eat it. My other pieces pump blobs into it until it can, then normal play eats it.
    function findFeedKill(S) {
        if (S.mine.length < 3) return null;
        // players who could reach one of my pieces soon (feeding means standing still)
        const dangerKeys = new Set();
        for (const e of S.enemies) for (const m of S.mine)
            if (canEat(e.s, m.s) && Math.hypot(e.x - m.x, e.y - m.y) < e.s - m.s / GAME.eatOverlapDiv + 400) { dangerKeys.add(e.key); break; }
        if (dangerKeys.size > 1) return null;
        let best = null;
        for (const P of S.mine) {
            // blobs start at the feeder's edge and must reach P's edge
            const feeders = S.mine.filter(c => c !== P && c.s >= GAME.minEjectSize &&
                Math.hypot(c.x - P.x, c.y - P.y) - c.s - P.s < GAME.virusSplitBoost * 0.85 && lineClear(S, c.x, c.y, P.x, P.y));
            // P shoots too (into the feeders, who shoot it back), so it needs at least 2 feeders to gain
            if (feeders.length < (P.s >= GAME.minEjectSize ? 2 : 1)) continue;
            const perRound = GAME.ejectLoss ** 2 / 100 * (feeders.length - (P.s >= GAME.minEjectSize ? 1 : 0)) * 0.85;
            for (const T of S.enemies) {
                if (T.remote || canEat(P.s, T.s) || T.s >= P.s) continue;            // already can, or never will cheaply
                const need = mass(T.s * GAME.eatMult * 1.02) - mass(P.s);
                if (need > CFG.feedKillMaxNeed) continue;
                const gap = Math.hypot(T.x - P.x, T.y - P.y) - (P.s - T.s / GAME.eatOverlapDiv);
                if (gap > 220) continue;                                 // must be right there
                const awaySpeed = (T.vx * (T.x - P.x) + T.vy * (T.y - P.y)) / (Math.hypot(T.x - P.x, T.y - P.y) || 1);
                if (awaySpeed > 6) continue;                             // running off: we'd never catch it
                // nobody else may be able to reach one of my pieces (the target is about to be eaten)
                if (dangerKeys.size && !dangerKeys.has(T.key)) continue;
                const rounds = Math.ceil(need / perRound);
                const value = mass(T.s) * lockBonus(S, T.key, T) - rounds * 16;
                if (value > 0 && (!best || value > best.value))
                    best = { value, pId: P.id, tId: T.id, until: now() + (rounds * 2 + 8) * GAME.tickMs + CFG.defaultRttMs * 2, need };
            }
        }
        if (best) hud.flash(`feed for the kill: pumping ~${Math.round(best.need)} mass into one piece`);
        return best;
    }
    function stepFeedKill(conn, S) {
        const fk = conn.feedKill;
        const P = conn.cells.get(fk.pId), T = conn.cells.get(fk.tId);
        const end = msg => { conn.feedKill = null; if (msg) hud.flash(msg); return false; };
        if (!P || !T || !conn.mine.has(fk.pId)) return end('');
        if (canEat(P.s, T.s * 1.01)) return end('feed for the kill: big enough, going in');
        if (now() > fk.until) return end('feed for the kill: gave up');
        const feeders = S.mine.filter(c => c !== P && c.s >= GAME.minEjectSize);
        if (!shrinkSafe(S, feeders, SHOTS_LOSS)) return end('feed for the kill: stopped, a feeder would get catchable');
        const pp = predict(P, S.L, S.tick);
        const fc = feeders.length ? feeders.reduce((a, f) => (Math.hypot(f.x - pp.x, f.y - pp.y) < Math.hypot(a.x - pp.x, a.y - pp.y) ? f : a)) : P;
        const d = Math.hypot(fc.x - pp.x, fc.y - pp.y) || 1;
        // Aim inside P but half its radius toward the nearest feeder: their blobs still land in P, and P's own
        // blobs reliably go toward the feeders (and come back) instead of spraying out from a dead-centre
        // aim, where any position error points them anywhere.
        const off = Math.min(P.s * 0.5, d * 0.5);
        const aim = { x: pp.x + (fc.x - pp.x) / d * off, y: pp.y + (fc.y - pp.y) / d * off };
        conn.sendMouse(aim.x, aim.y);
        conn.sendEject();
        conn.botAim = aim;
        conn.mode = 'feed for the kill';
        return true;
    }

    // #8 Bot baiting. PlayerBot weights ejected mass at log10(its mass) x (number of cells it can see),
    // i.e. far above pellets and on par with running from us: a blob dropped between us and a bot that's
    // just out of split range pulls it straight in. (Its other rules are in botSplitBlocked/reactOf.)
    function findBait(S) {
        const t = now();
        for (const B of S.enemies) {
            if (B.remote || !isBot(B) || (S.conn.baitBan.get(B.key) || 0) > t) continue;
            if (S.mine.some(m => canEat(B.s, m.s))) continue;            // it could eat us: not bait material
            const M = S.mine.filter(m => m.s >= GAME.minSplitSize && canEat(m.s / SQRT2, B.s))
                .reduce((a, m) => (!a || m.s > a.s ? m : a), null);
            if (!M) continue;
            const d = Math.hypot(B.x - M.x, B.y - M.y);
            const reach = GAME.splitDistance + GAME.splitBoost * 0.95 + M.s / SQRT2 - B.s / GAME.eatOverlapDiv;
            const landAt = M.s + GAME.virusSplitBoost * 0.95;                // where our blob comes to rest
            if (d <= reach || d > landAt + 900 || landAt > d - B.s * 0.5) continue; // in reach already / too far / would land on it
            if (!lineClear(S, M.x, M.y, B.x, B.y, B.key)) continue;
            if (threatNear(S, 400)) return null;
            hud.flash(`bait: dropping mass to lure ${B.name} into split range`);
            return { bId: B.id, key: B.key, shots: 0, until: t + 400 };
        }
        return null;
    }
    function stepBait(conn, S) {
        const bt = conn.bait, B = conn.cells.get(bt.bId);
        if (!B || now() > bt.until || bt.shots >= 3) {
            conn.baitBan.set(bt.key, now() + 6000);
            conn.bait = null;
            return false;
        }
        if (!shrinkSafe(S, S.mine, SHOTS_LOSS)) { conn.bait = null; return false; }
        const p = predict(B, S.L, S.tick);
        conn.sendMouse(p.x, p.y);
        conn.sendEject();
        conn.botAim = p;
        conn.mode = 'bait';
        bt.shots++;
        return true;
    }

    // ---------------------------------------------------------------- serving a master
    // Go to the master and shoot every bit of mass at them. If they can eat us, drive in (and split
    // in when they can eat the halves) so they get the lot. If we're big enough to eat *them*, we
    // must never touch: fire from just outside our eating range and back off if we get too close.
    // Real threats nearby come first; we go back to serving once they're dealt with.
    function stepServe(conn, S) {
        const t = now();
        let master = null, bestScore = -Infinity;
        for (const m of S.masters) {
            const sc = m.s / (Math.hypot(m.x - S.center.x, m.y - S.center.y) + 500);
            if (sc > bestScore) { bestScore = sc; master = m; }
        }
        if (threatNear(S, 200)) return false;
        if (!master) {
            // a master who just walked out of view: follow where they were going
            let g = null;
            // (a teammate whose name makes it a master isn't followed as one: team play handles it)
            for (const gh of conn.ghosts.values()) if (isMaster(gh.cell) && !conn.mateKeys.has(gh.cell.key) && (!g || gh.t > g.t)) g = gh;
            if (!g) return false;
            const age = Math.min(S.tick - g.tick, 40);
            const aim = { x: g.cell.x + g.cell.vx * age, y: g.cell.y + g.cell.vy * age };
            conn.sendMouse(aim.x, aim.y);
            conn.botAim = aim;
            conn.mode = `serve (following ${g.cell.name})`;
            return true;
        }
        return feedInto(conn, S, master, `serving ${master.name}`, { splitIn: true });
    }

    // Shoot our mass into `target` (a master, or the squad leader). Never touch it with a piece that
    // could swallow it. splitIn: when it can eat all of us, also split our halves straight into it.
    // standoff: stay put just outside its reach while shooting (a mate shouldn't be eaten, only fed).
    function feedInto(conn, S, target, label, { splitIn = false, standoff = false, clearLine = false, prey = null } = {}) {
        const t = now();
        const P = predict(target, S.L, S.tick);
        let gap = Infinity, eatGap = Infinity, eatenGap = Infinity;
        for (const p of S.mine) {
            const d = Math.hypot(p.x - target.x, p.y - target.y);
            gap = Math.min(gap, d - p.s - target.s);                                                  // edge to edge
            if (canEat(p.s, target.s)) eatGap = Math.min(eatGap, d - (p.s - target.s / GAME.eatOverlapDiv)); // we'd eat them
            if (canEat(target.s, p.s)) eatenGap = Math.min(eatenGap, d - (target.s - p.s / GAME.eatOverlapDiv)); // they'd eat us
        }
        let aim = P, fire = gap < GAME.virusSplitBoost * 0.8; // blobs fly ~880 from our edge
        // feeding a mate must not make us catchable (a master gets everything regardless)
        if (standoff && fire && !shrinkSafe(S, S.mine, SHOTS_LOSS)) fire = false;
        if (clearLine && fire && !lineClear(S, S.center.x, S.center.y, P.x, P.y, null)) fire = false;
        if (eatGap < 120) {
            // too close for a piece that could swallow them: back off, don't shoot this tick
            const dx = S.center.x - P.x, dy = S.center.y - P.y, d = Math.hypot(dx, dy) || 1;
            aim = { x: S.center.x + dx / d * 600, y: S.center.y + dy / d * 600 };
            fire = false;
        } else if (standoff) {
            // Feeding a teammate: one spot to shoot from, on our side of it, ~250 edge to edge and outside
            // anything that could swallow either of us. Get there without shooting; once there, hold still
            // and fire (the server moves a cell min(speed, distance to the mouse) and ejects toward the mouse,
            // so a mouse just in front of us aims at the teammate without moving us). Never fire otherwise:
            // shots while repositioning go everywhere but the teammate.
            const big = S.mine.reduce((a, b) => (b.s > a.s ? b : a));
            const want = Math.max(target.s + big.s + 250,
                canEat(target.s, big.s) ? target.s - big.s / GAME.eatOverlapDiv + 300 : 0,
                canEat(big.s, target.s) ? big.s - target.s / GAME.eatOverlapDiv + 300 : 0);
            const dx = big.x - P.x, dy = big.y - P.y, d = Math.hypot(dx, dy) || 1;
            if (S.mine.length > 1) {
                // in pieces: aim at the teammate (every piece shoots toward the mouse), only while all are clear of it
                aim = P;
                if (eatenGap < 250 || eatGap < 250) { aim = { x: S.center.x + dx / d * 500, y: S.center.y + dy / d * 500 }; fire = false; }
                // every piece >= 100 shoots: only once all of them are close enough for their blobs to land
                const far = S.mine.some(c => c.s >= GAME.minEjectSize && Math.hypot(c.x - P.x, c.y - P.y) - c.s - target.s > GAME.virusSplitBoost * 0.3);
                if (far) fire = false;
            } else {
                // One cell: fire with the mouse on the teammate itself, so the direction is right whatever the lag
                // (a mouse parked a few units in front of us, to hold still, points anywhere once our idea of
                // where we are is a few units off). That pulls us in while firing, so: fire from the far end of
                // the band while drifting in, and at the near end back off to the far end without firing.
                // Feed on the move: the teammate keeps farming, we follow behind with the mouse on it and fire.
                // Too close: just stop (mouse on ourselves, no shot) and let it pull ahead again; no backing off.
                // ...but a teammate that's standing still (it asked us for mass and waits for it) never pulls ahead: both
                // froze on top of each other (live 2026-10-27, "asking for 65 mass" while nothing moved). Then back off
                // to the shooting band ourselves.
                const still = Math.hypot(target.vx || 0, target.vy || 0) < 2;
                if (d < want - 60 || eatGap < 200 || eatenGap < 200) {
                    aim = still ? { x: P.x + dx / d * (want + 120), y: P.y + dy / d * (want + 120) } : { x: big.x + (target.vx || 0) * 12, y: big.y + (target.vy || 0) * 12 };
                    fire = false;
                }
                else aim = P;
            }
        }
        // a kill assist with the prey right against our teammate: shots would land in the prey as well, so split in
        const preyClose = prey && Math.hypot(prey.x - target.x, prey.y - target.y) < prey.s + target.s + 150;
        if (preyClose) {
            fire = false;
            if (splitIn) {
                const big = S.mine.reduce((a, b) => (b.s > a.s ? b : a));
                if (Math.hypot(big.x - P.x, big.y - P.y) > target.s + big.s + 60) aim = P; // walk in; nothing to fear from it
            }
        }
        if (splitIn && eatGap === Infinity && t - conn.lastAction > 1500) {
            // they can eat all of us: split in when they can eat the halves and they're in range
            const big = S.mine.reduce((a, b) => (b.s > a.s ? b : a));
            const d = Math.hypot(big.x - target.x, big.y - target.y);
            // the half has to reach our teammate's near edge; the prey behind it doesn't block that
            const ex = target.x + (big.x - target.x) / (d || 1) * target.s * 0.6, ey = target.y + (big.y - target.y) / (d || 1) * target.s * 0.6;
            const behind = prey && Math.hypot(prey.x - big.x, prey.y - big.y) > d - target.s * 0.3 &&
                Math.hypot(prey.x - ex, prey.y - ey) - Math.hypot(target.x - ex, target.y - ey) > 120;
            if (prey && preyClose && !behind) splitIn = false;
            if (big.s >= GAME.minSplitSize && S.mine.length < GAME.maxCells && canEat(target.s, big.s / SQRT2) &&
                d < (preyClose ? target.s + 480 : GAME.splitDistance + GAME.splitBoost * 0.9 + target.s) && lineClear(S, big.x, big.y, ex, ey, behind ? prey.key : undefined)) {
                conn.mergeUntil = now() + 1500; // our half is for the teammate: let it be swallowed
                conn.sendMouse(P.x, P.y);
                conn.sendSplit(1);
                conn.lastAction = t;
                teamlog.start(conn, S, 'split into teammate (feed' + (prey ? ' for kill' : '') + ')', { dist: Math.round(d - target.s), prey: prey ? prey.name || '' : '' }, target.key, prey ? prey.key : '');
                // the server splits toward the LAST mouse position it has: keep it on the teammate for a moment
                conn.lockUntil = t + 250; conn.lockTargetId = 0; conn.lockAim = P;
                aim = P; fire = false;
            }
        }
        // lead the shot: aim where the teammate will be when the blobs arrive (3.38.0)
        if (fire) { const L = leadShot(S, target); if (L && L.ok) { aim = L.pt; conn.ledShots = (conn.ledShots || 0) + 1; } else { fire = false; conn.heldShots = (conn.heldShots || 0) + 1; } }
        conn.sendMouse(aim.x, aim.y);
        if (fire && S.mine.some(c => c.s >= GAME.minEjectSize)) {
            conn.sendEject();
            // journal: a team feed counts from the first shot (not while still walking over)
            if (/^team: feeding/.test(label)) { const why = /\(([^)]*)\)$/.exec(label); teamlog.start(conn, S, 'feed teammate (' + (why ? why[1] : 'balance') + ')', { dist: Math.round(gap) }, target.key, '', 3000); }
        }
        conn.botAim = aim;
        conn.mode = label;
        return true;
    }

    // ---------------------------------------------------------------- team play (multibox)
    // Our players are a team of equals. Each one works out, every tick, what it needs (mass to make a kill,
    // or to get out of a chaser's reach) and what it can give. A teammate who asks gets fed (split straight
    // in when it's urgent); when nobody asks, the smaller one pumps its spare mass into the bigger one, which
    // comes over and eats it. They stick together, run to each other when chased, swallow a doomed teammate
    // rather than let a stranger have it, go for whatever is chasing the other, and corner prey between them.
    const memberCenter = m => centroid(m.cells.map(r => ({ x: r[1], y: r[2], s: r[3] })));
    const memberBig = m => m.cells.reduce((a, r) => Math.max(a, r[3]), 0);

    // Is there mass the team could give us that changes a fight right now? The cheapest of: enough to eat a
    // cell that's just too big for us; enough that a chaser can't eat us by touching; enough that its split
    // halves can't. (Becoming un-catchable flips a chase around.)
    function teamNeed(S) {
        if (!S.squad.length) return null;
        const P = S.mine.reduce((a, b) => (b.s > a.s ? b : a));
        // what the team can hand over: a teammate small enough for us to swallow can jump in and give it all
        // only teammates that can get here soon and aren't in trouble themselves
        const helpers = S.squad.filter(m => m.cells.length && !((m.danger || 0) > 0.1 * m.mass) && (() => { const c = memberCenter(m); return Math.hypot(c.x - P.x, c.y - P.y) < 1800 + P.s + memberBig(m); })());
        const avail = helpers.reduce((a, m) => a + (canEat(P.s, memberBig(m)) ? m.mass * 0.9 : Math.max(0, m.mass - CFG.squadKeepMass) * 0.8), 0);
        if (avail < 20) return null;
        let best = null;
        for (const e of S.enemies) {
            const d = Math.hypot(e.x - P.x, e.y - P.y);
            if (d > e.s + P.s + 1500) continue;
            const oc = S.ownerCount.get(e.key) || 1, cands = [];
            // (not a piece whose owner has another piece right there that could eat us: that's bait)
            const baited = S.enemies.some(o => o.key === e.key && o !== e && canEat(o.s, P.s) && Math.hypot(o.x - e.x, o.y - e.y) < o.s + 1200);
            if (!e.remote && !baited && !canEat(P.s, e.s) && !canEat(e.s, P.s * 1.02) && e.s < P.s * 1.3 && d - (P.s - e.s / GAME.eatOverlapDiv) < 900)
                cands.push([e.s * GAME.eatMult * 1.02, 'to eat ' + (e.name || 'a cell'), d - (P.s - e.s / GAME.eatOverlapDiv) < 600, e.id]);
            // split-kill boost: our half can't eat it yet, a bit more mass would let it; it's within split range
            if (!e.remote && !baited && CFG.teamSplitBoost && P.s >= GAME.minSplitSize && !canEat(e.s, P.s) &&
                !canEat(P.s / SQRT2, e.s * CFG.eatMargin) && e.s * GAME.eatMult * CFG.eatMargin * SQRT2 < P.s * 1.5 &&
                d - P.s < GAME.splitBoost * 0.85)
                cands.push([e.s * GAME.eatMult * CFG.eatMargin * SQRT2 * 1.02, 'to split-kill ' + (e.name || 'a cell'), d - P.s < GAME.splitBoost * 0.6, e.id]);
            if (canEat(e.s, P.s)) cands.push([e.s / GAME.eatMult * 1.03, 'out of ' + (e.name || 'a chaser') + '\'s reach', d < e.s + 900, e.id]);
            else {
                const sr = enemySplitReach(e, P.s, oc);
                if (sr > -Infinity) cands.push([e.s / SQRT2 / GAME.eatMult * 1.03, 'safe from ' + (e.name || 'a') + '\'s split', d < sr + 400, e.id]);
            }
            // an ask that brought nothing for a while: leave that target alone
            const nb = S.conn.needBlock = S.conn.needBlock || new Map();
            if (nb.has(e.id) && now() < nb.get(e.id)) continue;
            for (const [size, why, urgent, target] of cands) {
                // both of us after the same kill: the bigger one asks, the other one feeds (no asking each other)
                if (/^to (eat|split-kill)/.test(why) && S.squad.some(m => { const n = m.intent && m.intent.need; return n && n.target === target && /^to (eat|split-kill)/.test(n.why) && (m.mass > S.myMass || (m.mass === S.myMass && m.from < S.conn.memberId)); })) continue;
                const need = mass(size) - mass(P.s);
                if (need <= 0 || need > avail) continue;
                if (!best || need < best.amount) best = { cellId: P.id, amount: Math.round(need), urgent, why, target: target || 0 };
            }
        }
        // asks for a kill that bring no mass within 4 s are dropped (helpers busy / too far after all)
        if (best && /^to split-kill/.test(best.why) && !moves.allowed('ask boost to split-kill')) best = null;
        if (best) {   // (all asks, not only kill asks: an "out of X's reach" ask that nobody answered held a bot still forever)
            const nt = S.conn.needTrack;
            if (!nt || nt.target !== best.target) S.conn.needTrack = { target: best.target, since: now(), mass0: S.myMass };
            else if (now() - nt.since > 4000 && S.myMass < nt.mass0 + best.amount * 0.3) {
                (S.conn.needBlock = S.conn.needBlock || new Map()).set(best.target, now() + 10000);
                S.conn.needTrack = null; hud.flash('team: no help came, leaving it');
                return null;
            }
        } else S.conn.needTrack = null;
        if (best && (!S.conn.squadNeed || S.conn.squadNeed.why !== best.why)) {
            hud.flash(`team: asking for ${best.amount} mass (${best.why})`);
            if (/^to split-kill/.test(best.why)) { const pe = S.enemies.find(e => e.id === best.target); teamlog.start(S.conn, S, 'ask boost to split-kill', { prey: pe ? pe.name || '' : '', need: best.amount }, '', pe ? pe.key : '', 6000); }
        }
        return best;
    }


    // ---------------------------------------------------------------- team brain
    function planMembers(conn, S) {
        const self = { id: conn.memberId, name: S.mine[0] && S.mine[0].name, cells: S.mine.map(c => ({ id: c.id, x: c.x, y: c.y, s: c.s })),
            mass: S.myMass, danger: conn.danger || 0, dir: conn.botDir, asks: !!(conn.squadNeed && conn.squadNeed.urgent && !/^to eat/.test(conn.squadNeed.why)),
            busy: S.virusFarm ? 'farm' : conn.relay && conn.relay.active ? 'relay' : null };
        const out = [self];
        for (const m of S.squad) {
            if (!m.cells.length) continue;
            const mc = memberCenter(m);
            if (Math.hypot(mc.x - S.center.x, mc.y - S.center.y) > 4000) continue;
            // their cells as we see them (fresher than the message) where we can, else as they told us
            const seen = S.mates.filter(c => c.key === m.key);
            const cells = seen.length ? seen.map(c => ({ id: c.id, x: c.x, y: c.y, s: c.s })) : m.cells.map(r => ({ id: r[0], x: r[1], y: r[2], s: r[3] }));
            out.push({ id: m.from, name: m.name, cells, mass: m.mass, danger: m.danger || 0, dir: m.dir, asks: !!(m.intent && m.intent.need && m.intent.need.urgent && !/^to eat/.test(m.intent.need.why)), busy: m.busy || null });
        }
        for (const x of out) {
            x.big = x.cells.reduce((a, c) => (!a || c.s > a.s ? c : a), null);
            x.center = centroid(x.cells);
        }
        return out.filter(x => x.big);
    }

    function makeTeamPlan(conn, S) {
        const mem = planMembers(conn, S);
        if (mem.length < 2) return null;
        const tc = centroid(mem.map(x => ({ x: x.center.x, y: x.center.y, s: Math.sqrt(x.mass * 100) })));
        // heading: run the way the one in the most trouble runs; otherwise one destination for all
        const pressed = mem.filter(x => (x.danger > 0.1 * x.mass || x.asks) && typeof x.dir === 'number' && !isNaN(x.dir))
            .reduce((a, x) => (!a || x.danger / x.mass > a.danger / a.mass ? x : a), null);
        const wp = conn.waypoint || { x: tc.x + 1, y: tc.y };
        const dir = pressed ? pressed.dir : Math.atan2(wp.y - tc.y, wp.x - tc.x);
        // formation: side by side across the heading, in id order, a comfortable gap apart
        const order = mem.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
        const radii = order.map(x => x.big.s);
        const spacing = Math.max(...radii) * 2 + 250;
        const px = Math.cos(dir + Math.PI / 2), py = Math.sin(dir + Math.PI / 2);
        const slots = {};
        order.forEach((x, i) => { const k = (i - (order.length - 1) / 2) * spacing; slots[x.id] = [Math.round(px * k), Math.round(py * k)]; });
        // eat: each spare piece (not its owner's biggest) goes to the nearest teammate's biggest that can take it
        // without then being able to swallow the owner's biggest; only between bodies that aren't in a fight,
        // and not to make an already much bigger one bigger still (unless the owner is in trouble)
        const eat = [], flow = new Map();   // mass already on its way to (+) / from (-) each body
        for (const B of mem) {
            const bPressed = B.danger > 0.1 * B.mass;
            for (const c of B.cells) {
                if (c === B.big || c.s > B.big.s * 0.85) continue;
                let best = null, bd = Infinity;
                for (const A of mem) {
                    if (A === B) continue;
                    const clear = canEat(A.big.s, c.s * CFG.eatMargin);
                    const nearly = !clear && canEat(A.big.s * 1.12, c.s);          // within ~12% of the line: feedable
                    if (!clear && !nearly) continue;
                    if (A.danger > 0.15 * A.mass) continue;
                    // calm: pieces only flow from the heavier body to the lighter, while the gap is real (15%+) - both ways at once
                    // was mass ping-pong: each kept eating the other's pieces back. Under pressure: consolidate either way.
                    const teamPressed = mem.some(x => x.danger > 0.1 * x.mass);
                    const cm = c.s * c.s / 100, am = A.mass + (flow.get(A.id) || 0), bm = B.mass + (flow.get(B.id) || 0);
                    // (2026-10-20: calm pieces flow to the HEAVIER body - mass concentrates; and a body at the mining line keeps
                    // its mass - handing pieces out took the miner below 2300 and ended its mining)
                    if (!bPressed && !teamPressed && am < bm) continue;
                    if (!bPressed && bm >= CFG.mineMinMass * CFG.nearMineFrac) continue;
                    const d = Math.hypot(A.big.x - c.x, A.big.y - c.y);
                    if (d > 1600) continue;
                    if (S.enemies.some(e => canEat(e.s, A.big.s) && Math.hypot(e.x - c.x, e.y - c.y) < e.s + 2500)) continue;
                    const grown = Math.sqrt(A.big.s * A.big.s + c.s * c.s);
                    if (canEat(grown, B.big.s) && Math.hypot(B.big.x - c.x, B.big.y - c.y) < grown - B.big.s / GAME.eatOverlapDiv + 120) continue;
                    // reaching it would put our main piece inside the owner's main piece's safety zone: unreachable, skip
                    if (canEat(A.big.s * 1.08, B.big.s) && Math.hypot(B.big.x - c.x, B.big.y - c.y) - (A.big.s - B.big.s / GAME.eatOverlapDiv) < 100) continue;
                    if (d < bd) { bd = d; best = A; best.feedFirst = !clear; }
                }
                if (best) { eat.push([best.id, c.id, best.feedFirst ? 1 : 0]); const cm = c.s * c.s / 100; flow.set(best.id, (flow.get(best.id) || 0) + cm); flow.set(B.id, (flow.get(B.id) || 0) - cm); }
            }
        }
        // sticky swaps: keep an assignment we made in the last 2 s while it's still valid (piece there, eater safe and
        // still able to take it, no big enemy by the piece) - the plan is rebuilt 5x a second, and pieces near a
        // threshold used to flick in and out ("eating our pieces > farm > eating our pieces")
        {
            const sticky = conn.eatSticky = conn.eatSticky || new Map(), tn = now();
            const assigned = new Set(eat.map(e => e[1]));
            for (const [cid, st] of sticky) {
                if (tn > st.until) { sticky.delete(cid); continue; }
                if (assigned.has(cid)) continue;
                const B = mem.find(x => x.cells.some(c => c.id === cid)), A = mem.find(x => x.id === st.eater);
                const c = B && B.cells.find(x => x.id === cid);
                if (!B || !A || !c || c === B.big || A.danger > 0.15 * A.mass || !canEat(A.big.s * 1.12, c.s) ||
                    S.enemies.some(e => canEat(e.s, A.big.s) && Math.hypot(e.x - c.x, e.y - c.y) < e.s + 2000)) { sticky.delete(cid); continue; }
                eat.push([A.id, cid, canEat(A.big.s, c.s * CFG.eatMargin) ? 0 : 1]);
            }
            for (const e of eat) if (!sticky.has(e[1])) sticky.set(e[1], { eater: e[0], until: tn + 2000 });
        }
        // kill with cover: a body can eat a cell now (by touch soon, or a split); a bigger player that could eat that
        // body doesn't make us run if (a) we get the kill well before it gets to us and (b) afterwards, pooled with a
        // teammate, we're too big for it
        let kill = null;
        if (moves.allowed('kill with cover')) for (const X of mem) {
            const xb = X.big, xMass = mass(xb.s);
            for (const P of S.enemies) {
                if (P.remote) continue;
                const dP = Math.hypot(P.x - xb.x, P.y - xb.y);
                const byTouch = canEat(xb.s, P.s) && dP - (xb.s - P.s / GAME.eatOverlapDiv) < 500;
                const bySplit = xb.s >= GAME.minSplitSize && canEat(xb.s / SQRT2, P.s) && dP - xb.s < GAME.splitBoost * 0.8;
                if (!byTouch && !bySplit) continue;
                const tP = bySplit && !byTouch ? 8 : Math.max(0, dP - (xb.s - P.s / GAME.eatOverlapDiv)) / moveSpeed(xb.s);
                const after = xMass + mass(P.s);
                const others = mem.filter(o => o !== X);
                const pool = others.length ? Math.max(...others.map(o => Math.max(after + o.mass * 0.8, o.mass + after * 0.45))) : after;
                const cover = [];
                let ok = true;
                for (const F of S.enemies) {
                    if (F === P || F.remote) continue;
                    const dF = Math.hypot(F.x - xb.x, F.y - xb.y);
                    if (dF > F.s + 3000) continue;
                    const reach = Math.max(canEat(F.s, xb.s) ? F.s - xb.s / GAME.eatOverlapDiv : -Infinity, enemySplitReach(F, xb.s, S.ownerCount.get(F.key) || 1));
                    if (reach === -Infinity) continue;                       // can't hurt X anyway
                    const tF = Math.max(0, dF - reach) / moveSpeed(F.s);
                    const safeAfter = !canEat(F.s, Math.sqrt(pool * 100) * 1.05);
                    if (safeAfter && tP + 10 < tF) cover.push(F.id);
                    else { ok = false; break; }
                }
                if (!ok || !cover.length) continue; // nothing to cover: the normal hunting handles it
                const gain = mass(P.s);
                if (!kill || gain > kill.gain) kill = { eater: X.id, prey: P.id, cover, gain: Math.round(gain), preyName: P.name || '', coverName: (S.enemies.find(e => e.id === cover[0]) || {}).name || '' };
            }
        }
        // pool for safety: the biggest threat near that could eat each of us alone, but would find the two of us pooled
        // much harder (not edible by touch, or only just): the smaller body dives into the bigger now
        let pool = null;
        if (mem.length >= 2) {
            const byMass = mem.slice().sort((a, b) => b.mass - a.mass), host = byMass[0], diver = byMass[1];
            const pooled = Math.sqrt((host.mass + diver.mass * 0.85) * 100);
            for (const F of S.enemies) {
                if (F.remote) continue;
                const d = Math.min(Math.hypot(F.x - host.big.x, F.y - host.big.y), Math.hypot(F.x - diver.big.x, F.y - diver.big.y));
                const reach = Math.max(F.s - host.big.s / GAME.eatOverlapDiv, enemySplitReach(F, host.big.s, S.ownerCount.get(F.key) || 1));
                if (d > reach + 700) continue;
                const eatsEach = (canEat(F.s, host.big.s) || enemySplitReach(F, host.big.s, S.ownerCount.get(F.key) || 1) > -Infinity) && canEat(F.s, diver.big.s);
                if (!eatsEach) continue;
                if (canEat(F.s * 0.97, pooled)) continue;      // pooling wouldn't save us from this one: run
                if (Math.hypot(host.big.x - diver.big.x, host.big.y - diver.big.y) > 1700) continue;
                pool = { diver: diver.id, host: host.id, threat: F.id, threatName: F.name || '' };
                break;
            }
        }
        // defend split: a body whose split half can eat what's chasing another body, in split range of it
        let dsplit = null;
        for (const A of mem) {
            if (!(A.danger > 0.1 * A.mass || A.asks)) continue;
            for (const F of S.enemies) {
                if (F.remote || !canEat(F.s, A.big.s * 0.95) || Math.hypot(F.x - A.big.x, F.y - A.big.y) > F.s + 1500) continue;
                for (const B of mem) {
                    if (B === A || B.cells.length > 2 || B.big.s < GAME.minSplitSize) continue;
                    const half = B.big.s / SQRT2;
                    if (!canEat(half, F.s * CFG.eatMargin)) continue;
                    const dBF = Math.hypot(F.x - B.big.x, F.y - B.big.y);
                    if (dBF - B.big.s > GAME.splitBoost * 0.75) continue;
                    // nobody else that could eat the half sits around F
                    if (S.enemies.some(o => o !== F && canEat(o.s, half) && Math.hypot(o.x - F.x, o.y - F.y) < o.s + 500)) continue;
                    dsplit = { splitter: B.id, victim: A.id, threat: F.id, threatName: F.name || '' };
                    break;
                }
                if (dsplit) break;
            }
            if (dsplit) break;
        }
        const trap = CFG.teamTrap && !ordered(S) ? makeTrap(conn, S, mem) : null;
        return { by: conn.memberId, seq: (conn.teamPlan ? conn.teamPlan.seq : 0) + 1, dir: +dir.toFixed(3), slots, eat, kill, pool, dsplit, trap, pressed: pressed ? pressed.id : null };
    }

    // ---------------------------------------------------------------- the trap: hunting as one
    // ---------------------------------------------------------------- the trap: hunting as one
    // The planner (one of us, for all of us) thinks the chase through: it plays the next 27 s forward with the prey
    // running the way a sensible player would (away from whichever of our pieces could get to it soonest, along walls,
    // between viruses it fits through and we don't, never into a player that could eat it) and our pieces moving by a
    // plan, round the viruses that would pop them. It tries plans - each of us chasing, chasing but waiting until the
    // others are in place, or standing on a post (past a virus gap, down the wall it'd slide along, across its way out)
    // and taking it when it comes - one teammate at a time, keeps whatever catches it soonest, and sends it out.
    // It sees through everyone's eyes (shared sight), and every piece of ours that could eat the prey counts.
    // viruses as discs a cell this size pops on; discs that touch are one obstacle (a fence it can't get between)
    function trapClusters(viruses, r) {
        if (r <= 0 || !viruses.length) return [];
        const d = viruses.map(v => ({ x: v.x, y: v.y, r, g: -1 }));
        let g = 0;
        for (let i = 0; i < d.length; i++) {
            if (d[i].g >= 0) continue;
            d[i].g = g; const st = [d[i]];
            while (st.length) { const a = st.pop(); for (const q of d) if (q.g < 0 && Math.hypot(q.x - a.x, q.y - a.y) < 2 * r) { q.g = g; st.push(q); } }
            g++;
        }
        const out = []; for (let k = 0; k < g; k++) out.push(d.filter(x => x.g === k));
        return out;
    }
    // the way from a to b for a cell that pops on these clusters: [length, first waypoint x, y] (straight, or round
    // the first one in the way, past its far edge on one side or the other)
    function trapRoute(ax, ay, bx, by, clusters, depth) {
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 1 || !clusters.length) return [L, bx, by];
        const ux = (bx - ax) / L, uy = (by - ay) / L;
        let hit = null, ht = Infinity;
        for (const cl of clusters) for (const q of cl) {
            if (segDist(q.x, q.y, ax, ay, bx, by) >= q.r) continue;
            const tq = (q.x - ax) * ux + (q.y - ay) * uy;
            if (tq < ht) { ht = tq; hit = cl; }
        }
        if (!hit) return [L, bx, by];
        if (depth >= 2) return [L * 2.2, bx, by];
        let lo = Infinity, hi = -Infinity, al = 0;
        for (const q of hit) { const n = -(q.x - ax) * uy + (q.y - ay) * ux; lo = Math.min(lo, n - q.r); hi = Math.max(hi, n + q.r); al += (q.x - ax) * ux + (q.y - ay) * uy; }
        al = Math.max(0, al / hit.length);
        let best = null;
        for (const n of [lo - 80, hi + 80]) {
            const wx = ax + ux * al - uy * n, wy = ay + uy * al + ux * n;
            const a = trapRoute(ax, ay, wx, wy, clusters, depth + 1), b = trapRoute(wx, wy, bx, by, clusters, depth + 1);
            if (!best || a[0] + b[0] < best[0]) best = [a[0] + b[0], a[1], a[2]];
        }
        return best;
    }
    const trapInside = (x, y, clusters) => clusters.some(cl => cl.some(q => Math.hypot(q.x - x, q.y - y) < q.r + 40));
    const TRAP_DT = 0.6, TRAP_STEPS = 45, TRAP_HEAD = 12;
    // play it forward: when (s) one of our pieces gets it, by plan opts (member id -> {kind: chase|patient|post, x, y})
    function trapRollout(env, opts) {
        const { P, b } = env;
        const hs = env.hunters.map(h => ({ id: h.id, o: opts[h.id] || { kind: 'chase' }, ps: h.pieces.map(q => ({ x: q.x, y: q.y, v: q.v * TRAP_DT, reach: q.reach, cl: q.cl })) }));
        let px = P.x, py = P.y, gap = Infinity;
        const pv = env.pv * TRAP_DT, m = P.s * 0.4;
        let expo = 0;
        for (let k = 1; k <= (env.steps || TRAP_STEPS); k++) {
            const t = k * TRAP_DT;
            const pending = t < env.setup && hs.some(x => x.o.kind === 'post' && Math.hypot(x.ps[0].x - x.o.x, x.ps[0].y - x.o.y) > 350);
            for (const x of hs) {
                const q0 = x.ps[0];
                let tx = px, ty = py;
                if (x.o.kind === 'post' && Math.hypot(px - q0.x, py - q0.y) - q0.reach > CFG.trapStrike) { tx = x.o.x; ty = x.o.y; }
                else if (x.o.kind === 'patient' && pending) continue;
                for (const q of x.ps) {
                    const r = trapRoute(q.x, q.y, tx, ty, q.cl, 0);
                    const dx = r[1] - q.x, dy = r[2] - q.y, dl = Math.hypot(dx, dy);
                    if (dl > 1) { const st = Math.min(dl, q.v); q.x += dx / dl * st; q.y += dy / dl * st; }
                }
            }
            // the prey: of 12 headings, the one that keeps it furthest from being caught over the next 1.2 s
            let near = false;
            for (const x of hs) for (const q of x.ps) if (Math.hypot(q.x - px, q.y - py) < env.fleeR + q.reach) near = true;
            if (near) {
                let best = -Infinity, nx0 = px, ny0 = py;
                const forced = env.force && k <= env.force.steps;
                for (let i = 0; i < (forced ? 1 : TRAP_HEAD); i++) {
                    const a = forced ? env.force.a : (i + (k & 1) * 0.5) / TRAP_HEAD * 2 * Math.PI, ux = Math.cos(a), uy = Math.sin(a);
                    let x = px, y = py, sc = Infinity, fx = px, fy = py, pen = 0;
                    for (let j = 1; j <= 3; j++) {
                        let nx = x + ux * pv, ny = y + uy * pv;
                        if (b) { const cx = Math.max(b.minX + m, Math.min(b.maxX - m, nx)), cy = Math.max(b.minY + m, Math.min(b.maxY - m, ny)); if (cx !== nx || cy !== ny) pen++; nx = cx; ny = cy; }
                        if (env.fencesP.length && env.fencesP.some(cl => cl.some(v => segDist(v.x, v.y, x, y, nx, ny) < v.r))) { nx = x; ny = y; pen++; }
                        x = nx; y = ny; if (j === 1) { fx = x; fy = y; }
                        for (const hx of hs) for (const q of hx.ps) sc = Math.min(sc, Math.hypot(q.x - x, q.y - y) - (q.sreach || q.reach) - q.v * j);
                        for (const e of env.eaters) sc = Math.min(sc, Math.hypot(e.x - x, e.y - y) - e.s - 150);
                    }
                    sc -= pen * 60;
                    if (sc > best) { best = sc; nx0 = fx; ny0 = fy; }
                }
                px = nx0; py = ny0;
            }
            for (const x of hs) for (const q of x.ps) {
                const d0 = Math.hypot(q.x - px, q.y - py), d = d0 - q.reach;
                if (d <= 0) return { t, by: x.id, gap: 0, expo: expo + ((env.steps || TRAP_STEPS) - k + 1) * TRAP_DT };
                if (d < gap) gap = d;
                if (q.sreach > q.reach && d0 < q.sreach) expo += TRAP_DT * Math.min(1, (q.sreach - d0) / Math.min(q.sreach - q.reach, 800) + 0.3);
            }
            if (env.wallTime && b && Math.min(px - b.minX, b.maxX - px, py - b.minY, b.maxY - py) < P.s + 250) expo += TRAP_DT * env.wallTime;
        }
        return { t: Infinity, gap, expo };
    }
    function makeTrap(conn, S, mem) {
        const st = conn.trapState = conn.trapState || { prey: null, opts: {} };
        const tn = now();
        // re-think every 600 ms; in between the last plan stands (with its "posts taken yet?" brought up to date)
        if (tn - (st.lastAt || 0) < (conn.heavy ? 1500 : 600)) return st.last ? trapRefresh(st, mem, tn) : null;
        st.lastAt = tn;
        const t0 = performance.now();
        try { return makeTrapInner(conn, S, mem, st, tn); } finally { conn.trapMs = +(performance.now() - t0).toFixed(1); }
    }
    function makeTrapInner(conn, S, mem, st, tn) {
        // our pieces that could eat a candidate, member by member (piece by piece: a split teammate counts as its pieces)
        const huntersFor = P => {
            const out = [];
            for (const X of mem) {
                if (X.danger > 0.1 * X.mass) continue;
                if (X.busy === 'relay' || (X.busy === 'farm' && mass(P.s) < 0.2 * X.mass)) continue;
                const elig = X.cells.filter(c => canEat(c.s, P.s * CFG.eatMargin)).sort((a, b) => b.s - a.s).slice(0, 2);
                if (!elig.length) continue;
                if (Math.hypot(X.center.x - P.x, X.center.y - P.y) > CFG.trapReach) continue;
                const capped = X.cells.length >= CFG.maxCells;
                const pieces = elig.map(c => {
                    const splitOk = c.s >= GAME.minSplitSize && !capped && canEat(c.s / SQRT2, P.s * CFG.eatMargin);
                    const reach = Math.max(c.s - P.s / GAME.eatOverlapDiv, splitOk ? 0.75 * (c.s / SQRT2 + GAME.splitBoost * 0.8) : 0);
                    return { x: c.x, y: c.y, s: c.s, v: moveSpeed(c.s) * 1000 / GAME.tickMs, reach, cl: [], pops: !capped && canEat(c.s, GAME.virusSize) };
                });
                out.push({ id: X.id, name: X.name || '', mass: X.mass, X, pieces });
            }
            return out;
        };
        let pick = null; const why = {};
        for (const P of S.enemies) {
            if (!P.player || isAlly(P) || P.feeding || isBaitCell(S, P)) continue;
            const m = mass(P.s);
            if (m < CFG.trapMinMass) { why['too small'] = 1; continue; }
            if (st.cool && st.cool.id === P.id && tn < st.cool.until) continue;
            const H = huntersFor(P);
            if (H.length < 2) { why[H.length ? 'only one of us can eat it' : 'none of us can eat it'] = 1; continue; }
            if (m < 0.04 * Math.max(...H.map(h => h.mass))) { why['too small'] = 1; continue; }
            const risky = S.enemies.some(F => F.key !== P.key && F.player && H.some(h => { const r = threatReach(S, F, h.X.big.s);
                return r > -Infinity && Math.hypot(F.x - P.x, F.y - P.y) < r + 1200; }));
            if (risky) { why['a bigger player is near it'] = 1; continue; }
            const dmin = Math.min(...H.map(h => Math.hypot(h.pieces[0].x - P.x, h.pieces[0].y - P.y)));
            // the biggest prey first
            const score = m * (1 + 0.15 * (H.length - 2)) / (1 + dmin / 4000) * (st.prey === P.id ? 1.6 : 1);
            if (!pick || score > pick.score) pick = { P, H, score };
        }
        if (!pick) { conn.trapWhy = Object.keys(why).join(', ') || 'no prey'; st.prey = null; st.last = null; return null; }
        const { P, H } = pick;
        if (st.prey !== P.id) { st.prey = P.id; st.t0 = tn; st.opts = {}; }
        if (tn - st.t0 > 30000) { st.cool = { id: P.id, until: tn + 10000 }; st.prey = null; st.last = null; conn.trapWhy = 'gave up on ' + (P.name || 'it'); return null; }
        // the world as the prey and each of our pieces see it
        const viruses = S.viruses.filter(v => Math.hypot(v.x - P.x, v.y - P.y) < 4000);
        const clCache = new Map();
        for (const h of H) for (const q of h.pieces) if (q.pops) {
            const r = Math.round((q.s - GAME.virusSize / GAME.eatOverlapDiv + 25) / 20) * 20;
            if (!clCache.has(r)) clCache.set(r, trapClusters(viruses, r));
            q.cl = clCache.get(r);
        }
        const pPops = canEat(P.s, GAME.virusSize) && (S.ownerCount.get(P.key) || 1) < CFG.maxCells;
        const env = { P, b: S.border, hunters: H, pv: moveSpeed(P.s) * 1000 / GAME.tickMs, setup: CFG.trapSetupMs / 1000, fleeR: 2200,
            eaters: S.enemies.filter(e => e.player && e.key !== P.key && canEat(e.s, P.s)),
            fencesP: pPops ? trapClusters(viruses, P.s - GAME.virusSize / GAME.eatOverlapDiv).filter(cl => cl.length >= 2) : [] };
        const score = o => { const r = trapRollout(env, o); return r.t < Infinity ? r.t : 40 + r.gap / 300; };
        // posts: a ring of spots round it (inside the walls, clear of viruses that pop us, nowhere something could eat us)
        const b = S.border, ring = [];
        for (let i = 0; i < 12; i++) for (const R of [700, 1400, 2200]) {
            const a = i / 12 * 2 * Math.PI, x = P.x + Math.cos(a) * (R + P.s), y = P.y + Math.sin(a) * (R + P.s);
            if (b && (x < b.minX + 150 || x > b.maxX - 150 || y < b.minY + 150 || y > b.maxY - 150)) continue;
            ring.push({ x, y });
        }
        // and along the walls it would run into (chases end at walls and in corners): level with it and further along
        if (b) {
            const inset = 500;
            for (const [gap, horiz, wallC] of [[P.y - b.minY, true, b.minY + inset], [b.maxY - P.y, true, b.maxY - inset], [P.x - b.minX, false, b.minX + inset], [b.maxX - P.x, false, b.maxX - inset]]) {
                if (gap > 4500) continue;
                for (const off of [-3500, -2000, -900, 0, 900, 2000, 3500]) {
                    const x = horiz ? P.x + off : wallC, y = horiz ? wallC : P.y + off;
                    if (x < b.minX + inset || x > b.maxX - inset || y < b.minY + inset || y > b.maxY - inset) continue;
                    ring.push({ x, y });
                }
            }
            for (const x of [b.minX + 700, b.maxX - 700]) for (const y of [b.minY + 700, b.maxY - 700]) if (Math.hypot(x - P.x, y - P.y) < 7000) ring.push({ x, y });
        }
        const postsFor = h => ring.filter(pt => {
            const q = h.pieces[0];
            if (b && (pt.x < b.minX + q.s * 0.6 || pt.x > b.maxX - q.s * 0.6 || pt.y < b.minY + q.s * 0.6 || pt.y > b.maxY - q.s * 0.6)) return false;
            if (trapInside(pt.x, pt.y, q.cl)) return false;
            if (S.enemies.some(F => F.key !== P.key && F.player && (() => { const rr = threatReach(S, F, h.X.big.s); return rr > -Infinity && Math.hypot(F.x - pt.x, F.y - pt.y) < rr + 700; })())) return false;
            return trapRoute(q.x, q.y, pt.x, pt.y, q.cl, 0)[0] / q.v < 16;
        }).map(pt => ({ kind: 'post', x: pt.x, y: pt.y }));
        const sticky = (id, c) => { const o = st.opts[id]; return o && o.kind === c.kind && (c.kind !== 'post' || Math.hypot(o.x - c.x, o.y - c.y) < 450); };
        // start from everyone chasing; then, one teammate at a time, the job that gets it soonest
        const opts = {}; for (const h of H) opts[h.id] = { kind: 'chase' };
        const base = score(opts);
        let cur = base - (H.every(h => sticky(h.id, opts[h.id])) ? 0.4 : 0);
        const budget = performance.now() + 20;   // at most ~20 ms of thinking (we're one tick of the game)
        for (let round = 0; round < 2 && performance.now() < budget; round++) {
            let changed = false;
            for (const h of H.slice().sort((a, b2) => b2.mass - a.mass)) {
                const keep = opts[h.id];
                let best = keep, bs = cur;
                for (const c of [{ kind: 'chase' }, { kind: 'patient' }, ...postsFor(h)]) {
                    if (c.kind === keep.kind && c.x === keep.x && c.y === keep.y) continue;
                    if (performance.now() > budget) break;
                    opts[h.id] = c;
                    const sc = score(opts) - (sticky(h.id, c) ? 0.4 : 0);
                    if (sc < bs - 0.05) { bs = sc; best = c; }
                }
                opts[h.id] = best;
                if (best !== keep) { cur = bs; changed = true; }
            }
            if (!changed) break;
        }
        const res = trapRollout(env, opts);
        const useful = res.t < Infinity && Object.values(opts).some(o => o.kind !== 'chase') && (base >= 40 || res.t <= base - 0.8);
        if (!useful) { conn.trapWhy = res.t < Infinity ? 'chasing it is as good (' + (P.name || 'it') + ')' : 'no plan catches ' + (P.name || 'it'); st.last = null; return null; }
        conn.trapWhy = 'trap on ' + (P.name || 'it') + ': caught in ~' + res.t.toFixed(1) + ' s' + (base < 40 ? ' (chasing: ' + base.toFixed(1) + ' s)' : ' (chasing: never)');
        st.opts = {}; for (const id in opts) st.opts[id] = opts[id];
        // what each post is for: past a virus fence a chaser can't follow through, down a wall, or across its way out
        const chasers = H.filter(h => opts[h.id].kind !== 'post');
        const roles = {};
        for (const h of H) {
            const o = opts[h.id];
            if (o.kind !== 'post') { roles[h.id] = { kind: o.kind }; continue; }
            const pastFence = chasers.some(c => c.pieces[0].cl.length && c.pieces[0].cl.some(cl => cl.some(v => segDist(v.x, v.y, P.x, P.y, o.x, o.y) < v.r)));
            const along = !pastFence && b && wallGap(S, o) < P.s + 700;
            roles[h.id] = { kind: 'post', x: Math.round(o.x), y: Math.round(o.y), why: pastFence ? 'past the viruses' : along ? 'along the wall' : 'on its way out' };
        }
        st.last = { prey: P.id, name: P.name || '', key: P.key, px: Math.round(P.x), py: Math.round(P.y), ps: Math.round(P.s), members: H.map(h => h.id),
            roles, eta: +res.t.toFixed(1), chase: base < 40 ? +base.toFixed(1) : null, by: res.by };
        return trapRefresh(st, mem, tn);
    }
    // the plan as it stands, with "are the posts taken yet" from where we all are now
    function trapRefresh(st, mem, tn) {
        const T = st.last;
        if (!T) return null;
        const pending = tn - st.t0 < CFG.trapSetupMs && Object.keys(T.roles).some(id => {
            const r = T.roles[id]; if (r.kind !== 'post') return false;
            const X = mem.find(x => x.id === id); return X && Math.hypot(X.big.x - r.x, X.big.y - r.y) > 350; });
        return { ...T, pending, at: tn - st.t0 | 0 };
    }

    // what the trap asks of us: chase it, chase it once the others are in place, or stand on a post and take it when
    // it comes; pulls that would take us off the job are dropped
    function trapPulls(conn, S, pulls) {
        const T = S.plan && S.plan.trap;
        const R = T && T.roles && T.roles[conn.memberId];
        if (!R) { if (conn.trapRole) { hud.flash('trap: over'); conn.trapRole = null; } conn.trapLabel = ''; return; }
        const P = S.enemies.find(e => e.id === T.prey) || { id: T.prey, x: T.px, y: T.py, s: T.ps, vx: 0, vy: 0, vt: -1, name: T.name, key: T.key, player: true };
        const eater = S.mine.filter(c => canEat(c.s, P.s * CFG.eatMargin)).reduce((a, c) => (!a || c.s > a.s ? c : a), null);
        if (!eater) return;
        const name = P.name || 'it', ep = predict(P, S.L + 6, S.tick);
        for (let i = pulls.length - 1; i >= 0; i--) {
            const l = pulls[i].label || '';
            if (/^team: (herding|regroup|meeting up)|^team plan: in formation/.test(l)) pulls.splice(i, 1);
            else if (R.kind !== 'chase' && ((pulls[i].e && pulls[i].e.id === P.id) || pulls[i].huntId === P.id)) pulls.splice(i, 1);
        }
        const W = CFG.trapWeight * S.myMass;
        const close = Math.hypot(P.x - eater.x, P.y - eater.y) - (eater.s - P.s / GAME.eatOverlapDiv);
        // the way there goes round viruses that would pop us (straight at a post past a fence ran us into it)
        const popsMe = S.mine.length < CFG.maxCells && canEat(eater.s, GAME.virusSize);
        const cl = popsMe ? trapClusters(S.viruses.filter(v => Math.hypot(v.x - eater.x, v.y - eater.y) < 3500), eater.s - GAME.virusSize / GAME.eatOverlapDiv + 60) : [];
        const via = (x, y) => { if (!cl.length) return { x, y }; const r = trapRoute(eater.x, eater.y, x, y, cl, 0); return { x: r[1], y: r[2] }; };
        const posted = Object.keys(T.roles).filter(id => T.roles[id].kind === 'post').length;
        let label;
        if (R.kind === 'post') {
            if (close < CFG.trapStrike) { label = 'trap: taking ' + name; pulls.push({ ...via(ep.x, ep.y), noCalm: true, w: W * 1.3, label }); }
            else { label = 'trap: waiting for ' + name + ' ' + R.why; pulls.push({ ...via(R.x, R.y), noCalm: true, w: W, label }); }
        } else if (R.kind === 'patient' && T.pending) {
            // hold off (where we are, or a little further out) until the posts are taken
            const dx = S.center.x - P.x, dy = S.center.y - P.y, dl = Math.hypot(dx, dy) || 1, r = Math.max(dl, P.s + eater.s + 900);
            label = 'trap: holding off ' + name + ' until the others are in place';
            pulls.push({ ...via(P.x + dx / dl * r, P.y + dy / dl * r), noCalm: true, w: W, label });
        } else {
            label = posted ? 'trap: driving ' + name + ' toward ' + posted + ' teammate' + (posted > 1 ? 's' : '') : 'trap: closing in on ' + name;
            pulls.push({ ...via(ep.x, ep.y), noCalm: true, w: W * 1.2, label });
        }
        const key = R.kind + ':' + T.prey + ':' + (T.pending ? 1 : 0);
        if (conn.trapRole !== key) { hud.flash(label + (T.eta ? ' (plan: caught in ~' + T.eta + ' s)' : '')); conn.trapRole = key; }
        conn.trapLabel = label;
        teamlog.start(conn, S, 'trap', { prey: name, role: R.kind, why: R.why || '', eta: T.eta, chase: T.chase }, '', P.key, 4000);
    }


    // ---------------------------------------------------------------- orders from the captain (the tab you play in)
    const captain = { mode: null, feedAt: 0, feedWall: 0 };
    const ORDER_KEYS = { Digit1: 'follow', Digit2: 'protect', Digit3: 'flank', Digit4: 'orbit', Digit5: 'farm', Digit6: 'trade', Digit7: 'carry', Digit0: 'free' };
    const ORDER_NAMES = { follow: 'follow me', protect: 'protect me', flank: 'flank me', orbit: 'orbit me', farm: 'go farm', trade: 'trade mass with me', carry: 'carry me (graze near me, feed me)', free: 'free play' };
    function captainOf(S, conn) {
        if (conn) { conn.isCarrier = false; conn.vipGuard = null; }
        if (!CFG.teamOrders || !CFG.bot) return null;
        const vip = conn && vipMember(S, conn);
        if (vip) return vip;
        const t = now();
        let best = null;
        for (const m of S.squad) if (m.order && m.cells.length && t - m.rx < 1500 && (!best || m.from < best.from)) best = m;
        if (best || !CFG.carryBots || !conn) return best;
        return botCarrier(S, conn);
    }
    // the VIP (3.37.0): another player all our bots work for, as if it were our captain. 'feed' = a standing
    // "feed me now" (every bot races in and splits into it, W when too big to split in); 'protect' = the protect order
    // (body-block the biggest threat, pop the mines in its way). Seen by any of us (shared sight), or where it was
    // last seen (30 s). Our cells that could eat it keep off its main cell (mateGuard, like a teammate's).
    function vipMember(S, conn) {
        if (!CFG.vipName || (CFG.vipMode !== 'feed' && CFG.vipMode !== 'protect')) return null;
        const t = now();
        const seen = S.enemies.concat(S.masters || []).filter(e => e.player && e.name === CFG.vipName);
        let cells = seen.map(c => [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.s)]), key = seen.length ? seen[0].key : '';
        const tp = !cells.length && freshTag(CFG.vipName, serverOf(conn.ws));
        if (cells.length) conn.vipLast = { cells, t, key };
        else if (tp) { cells = [[-1, Math.round(tp.x), Math.round(tp.y), Math.round(Math.sqrt(Math.max(100, tp.mass || 2000) * 100))]]; key = (conn.vipLast && conn.vipLast.key) || ''; }
        else if (conn.vipLast && t - conn.vipLast.t < 30000) { cells = conn.vipLast.cells; key = conn.vipLast.key; }
        else return null;
        const big = seen.length ? seen.reduce((a, c) => (c.s > a.s ? c : a)) : null;
        const cx = cells.reduce((a, r) => a + r[1], 0) / cells.length, cy = cells.reduce((a, r) => a + r[2], 0) / cells.length;
        const aim = big && (big.vx || big.vy) ? [Math.round(cx + big.vx * 40), Math.round(cy + big.vy * 40)] : null;
        conn.vipGuard = { cells, rx: t, intent: null, name: CFG.vipName };
        return { from: 'vip:' + CFG.vipName, name: CFG.vipName, key, cells, mass: Math.round(cells.reduce((a, r) => a + r[3] * r[3] / 100, 0)), rx: t, isBot: false, vip: true,
            order: CFG.vipMode === 'feed' ? { mode: 'follow', feedAt: Date.now(), aim } : { mode: 'protect', feedAt: 0, aim } };
    }
    // carry mode with no captain on (3.36.0): the biggest bot is grown by the others. Switching needs 1.5x the
    // current carrier's mass (no flip-flopping); every bot computes the same answer from the same squad messages.
    function botCarrier(S, conn) {
        const t = now();
        const cands = [{ from: conn.memberId, mass: S.myMass, self: true }];
        for (const m of S.squad) if (m.isBot && m.cells && m.cells.length && t - m.rx < 1500) cands.push({ from: m.from, mass: m.mass || 0, m });
        let top = null; for (const c of cands) if (!top || c.mass > top.mass || (c.mass === top.mass && c.from < top.from)) top = c;
        const cur = cands.find(c => c.from === conn.carrierFrom);
        let pick = cur && cur.mass >= CFG.carryMinCarrier * 0.6 && !(top.mass > cur.mass * 1.5) ? cur : top;
        if (!pick || pick.mass < CFG.carryMinCarrier) { conn.carrierFrom = null; return null; }
        conn.carrierFrom = pick.from;
        if (pick.self) { conn.isCarrier = true; return null; }
        const m = pick.m, cc = memberCenter(m);
        const aim = m.dir === null || m.dir === undefined ? null : [Math.round(cc.x + Math.cos(m.dir) * 1000), Math.round(cc.y + Math.sin(m.dir) * 1000)];
        return Object.assign({}, m, { order: { mode: 'carry', feedAt: 0, aim }, botCarrier: true });
    }
    const ordered = S => !!(S.captain && S.captain.order.mode !== 'free');
    // which of the captain's helpers we are (the same order on every bot: by member id)
    function orderSlot(conn, S) {
        const ids = [conn.memberId, ...S.squad.filter(m => m.cells.length && (!S.captain || m.from !== S.captain.from)).map(m => m.from)].sort();
        return { k: ids.indexOf(conn.memberId), n: ids.length };
    }
    function captainHeading(cap) {
        const cc = memberCenter(cap), a = cap.order.aim;
        if (a && Math.hypot(a[0] - cc.x, a[1] - cc.y) > 80) { cap.lastHeading = Math.atan2(a[1] - cc.y, a[0] - cc.x); }
        return cap.lastHeading !== undefined ? cap.lastHeading : 0;
    }
    // the mines that could pop the captain: next to it, or on its way
    function captainMines(S) {
        const cap = S.captain; if (!cap) return [];
        const cc = memberCenter(cap), cb = memberBig(cap), h = captainHeading(cap), hx = Math.cos(h), hy = Math.sin(h);
        if (!canEat(cb, GAME.virusSize) || cap.cells.length >= CFG.maxCells) return [];
        return S.viruses.filter(v => {
            const d = Math.hypot(v.x - cc.x, v.y - cc.y);
            if (d < cb + 700) return true;
            const ahead = (v.x - cc.x) * hx + (v.y - cc.y) * hy;
            return ahead > 0 && ahead < 2200 && segDist(v.x, v.y, cc.x, cc.y, cc.x + hx * 2200, cc.y + hy * 2200) < cb + 150;
        }).sort((a, b) => Math.hypot(a.x - cc.x, a.y - cc.y) - Math.hypot(b.x - cc.x, b.y - cc.y));
    }
    // direct control: Tab feed, popping the captain's mines, handing it our small pieces afterwards
    function stepOrders(conn, S) {
        const cap = S.captain;
        if (!cap) { conn.orderMode = null; return false; }
        const mode = cap.order.mode;
        if (conn.orderMode !== mode) { conn.orderMode = mode; hud.flash('team order: ' + (ORDER_NAMES[mode] || mode) + ' (' + (cap.name || 'captain') + ')'); }
        if (mode !== 'free' && conn.relay && conn.relay.active) endRelay(conn, conn.relay, 'following orders', 3000, 'orders');
        const cc = memberCenter(cap), cb = memberBig(cap);
        const myBig = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        const dCap = Math.hypot(cc.x - myBig.x, cc.y - myBig.y);
        // Tab: everything into the captain, as fast as possible
        const fa = cap.order.feedAt || 0;
        if (fa && Date.now() - fa < CFG.feedMeMs && dCap < 6000) {
            const t = now(), who = cap.name || 'the captain';
            const k = pumpSplits(myBig.s, cb);                       // splits it takes for our pieces to be edible (-1: never)
            const gap = dCap - cb - myBig.s;
            const canW = S.mine.some(c => c.s >= GAME.minEjectSize);
            // far off: drive straight in if the way to the captain is clear of anything that could eat us (a chaser
            // behind the captain doesn't count: getting into the captain is the escape); else travel under steering
            if (gap > (k < 0 ? 1100 : GAME.splitBoost * 0.75)) {
                const blocked = S.enemies.some(e => !e.remote && e.player && e.key !== cap.key && S.mine.some(q => canEat(e.s, q.s)) &&
                    segDist(e.x, e.y, myBig.x, myBig.y, cc.x, cc.y) < e.s + myBig.s + 100 &&
                    Math.hypot(e.x - myBig.x, e.y - myBig.y) < Math.hypot(cc.x - myBig.x, cc.y - myBig.y));
                if (blocked) return travel(conn, S, cc.x, cc.y, 'team: racing to feed ' + who + ' (round a threat)');
                conn.sendMouse(cc.x, cc.y); conn.botAim = { x: cc.x, y: cc.y };
                if (canW && gap < 1200) shootAt(conn, S, capTarget(conn, cap));
                conn.mode = 'team: racing to feed ' + who;
                return true;
            }
            conn.sendMouse(cc.x, cc.y); conn.botAim = { x: cc.x, y: cc.y };
            // (before the "someone in the way" check: right beside them, walking in IS the escape)
            // every piece of ours is already small enough for them to eat: dive in, all of us, now
            if (S.mine.every(c => canEat(cb, c.s * CFG.eatMargin)) && (gap < 500 || S.mine.length >= CFG.maxCells || !S.mine.some(c => c.s >= GAME.minSplitSize))) {
                conn.sendMouse(cc.x, cc.y); conn.botAim = { x: cc.x, y: cc.y };
                conn.mergeUntil = now() + 1500;
                conn.mode = 'team: diving into ' + who + ' (Tab)';
                return true;
            }
            if (k < 0) { if (canW && gap < 1200) return feedInto(conn, S, capTarget(conn, cap), 'team: feeding ' + who + ' (W, too big to split in)', { standoff: true }); conn.mode = 'team: feeding ' + who + ' (W, too big to split in)'; return true; }
            // never across a big player's path: W-feed from here instead
            const pieceS = myBig.s / Math.pow(SQRT2, Math.max(1, k));
            const lane = S.enemies.find(e => !e.remote && e.key !== cap.key && canEat(e.s, pieceS) && segDist(e.x, e.y, myBig.x, myBig.y, cc.x, cc.y) < e.s + 150);
            if (lane) {
                if (conn.fedHold !== fa) { conn.fedHold = fa; hud.flash('team: not splitting into ' + who + ' - ' + (lane.name || 'a big player') + ' is in the way'); }
                if (canW && gap < 1200) shootAt(conn, S, capTarget(conn, cap));
                conn.mode = 'team: feeding ' + who + ' (W, ' + (lane.name || 'a big player') + ' in the way)';
                return true;
            }
            const splittable = S.mine.filter(c => c.s >= GAME.minSplitSize).length;
            const room = CFG.maxCells - S.mine.length;
            const inRange = gap < GAME.splitBoost * 0.75;
            if (inRange && splittable && room > 0 && t - (conn.feedSplitAt || 0) > 200) {
                // as many splits as the piece limit allows (smaller pieces are still edible); at least the k it takes
                let n = 0, pcs = S.mine.length;
                while (n < 4 && pcs < CFG.maxCells) { pcs = Math.min(CFG.maxCells, pcs + S.mine.filter(c => c.s / Math.pow(SQRT2, n) >= GAME.minSplitSize).length); n++; }
                n = Math.max(n, Math.min(k, 4));
                conn.sendSplit(n);
                conn.feedSplitAt = t; conn.lockUntil = t + 350; conn.lockTargetId = 0; conn.lockAim = { x: cc.x, y: cc.y };
                teamlog.start(conn, S, 'feed the captain (Tab)', { splits: n }, cap.key, '', 4000);
                conn.mode = 'team: split-feeding ' + who;
                return true;
            }
            // in range with no splits left: pour with W from a stand-off spot on our side of them, backing off when on top
            // of them (live 2026-10-27: "pouring into" drove onto the captain's centre and sat there - 44 of 54 freezes,
            // its shots going out of its own middle in any direction)
            if (inRange && canW) return feedInto(conn, S, capTarget(conn, cap), 'team: pouring into ' + who, { standoff: true });
            // out of split range: race in, W-feeding from close enough
            if (canW && gap < 1200) shootAt(conn, S, capTarget(conn, cap));
            conn.mode = (inRange ? 'team: pouring into ' : 'team: racing to feed ') + who;
            return true;
        }
        if (mode === 'trade') return stepTrade(conn, S, cap, cc, cb, myBig);
        if (mode === 'carry' && stepCarry(conn, S, cap, cc, cb, myBig, dCap)) return true;
        if (mode !== 'protect' && mode !== 'carry') return false;
        if (conn.danger > 0.3 * S.myMass + 1) return false;      // our own life first when it's really close
        // in pieces after popping a mine: hand the captain our small pieces, keep our one big cell out
        const spare = S.mine.filter(c => c !== myBig && canEat(cb, c.s * CFG.eatMargin));
        if (spare.length && S.mine.length > 1 && dCap < 3500) {
            const edge = dCap - cb - myBig.s;
            if (edge > 900) return travel(conn, S, cc.x, cc.y, 'team: bringing ' + (cap.name || 'the captain') + ' our small pieces');
            let ax = cc.x, ay = cc.y;
            if (canEat(cb, myBig.s * 0.95) && edge < 250) { const ux = (myBig.x - cc.x) / (dCap || 1), uy = (myBig.y - cc.y) / (dCap || 1); ax = myBig.x + ux * 500 - uy * 300; ay = myBig.y + uy * 500 + ux * 300; }
            conn.sendMouse(ax, ay); conn.botAim = { x: ax, y: ay };
            conn.mode = 'team: feeding ' + (cap.name || 'the captain') + ' our small pieces';
            teamlog.start(conn, S, 'protect: hand pieces', { pieces: spare.length }, cap.key, '', 3000);
            return true;
        }
        // pop the mines next to the captain / in its way: the bot nearest each mine takes it
        const mines = captainMines(S);
        if (mines.length && S.mine.length < CFG.maxCells && canEat(myBig.s, GAME.virusSize)) {
            const helpers = [{ id: conn.memberId, c: myBig }, ...S.squad.filter(m => m.cells.length && m !== cap && m.order == null).map(m => ({ id: m.from, c: { x: memberCenter(m).x, y: memberCenter(m).y, s: memberBig(m) } }))]
                .filter(h => canEat(h.c.s, GAME.virusSize));
            const taken = new Set();
            let mine = null;
            for (const v of mines) {
                let best = null, bd = Infinity;
                for (const h of helpers) { if (taken.has(h.id)) continue; const d = Math.hypot(h.c.x - v.x, h.c.y - v.y); if (d < bd) { bd = d; best = h; } }
                if (!best) break;
                taken.add(best.id);
                if (best.id === conn.memberId) { mine = v; break; }
            }
            if (mine && Math.hypot(mine.x - myBig.x, mine.y - myBig.y) < 3000) {
                if (Math.hypot(mine.x - myBig.x, mine.y - myBig.y) - myBig.s > 700) return travel(conn, S, mine.x, mine.y, 'team: going to pop the mine in ' + (cap.name || 'the captain') + "'s way");
                conn.sendMouse(mine.x, mine.y); conn.botAim = { x: mine.x, y: mine.y };
                conn.mode = 'team: popping the mine in ' + (cap.name || 'the captain') + "'s way";
                teamlog.start(conn, S, 'protect: pop mine', {}, cap.key, '', 3000);
                return true;
            }
        }
        return false;
    }
    // carry (3.36.0): one big cell gets on the leaderboard, four small ones never do. Live, feeding the captain was
    // the one team move that clearly paid (+867 mass a try, 96%). A feeder grazes near the carrier (orderPulls leash)
    // and, from carryFeedAt, W-feeds it down to carryKeep - small feeders lose little when they die.
    function stepCarry(conn, S, cap, cc, cb, myBig, dCap) {
        if (conn.danger > 0.3 * S.myMass + 1) return false;      // our own escape first (a dive into the carrier is one)
        const who = cap.name || 'the carrier';
        const canW = S.mine.some(c => c.s >= GAME.minEjectSize);
        const st = conn.carryFeed || (conn.carryFeed = { on: false });
        if (!st.on && S.myMass >= CFG.carryFeedAt && canW) st.on = true;
        if (st.on && (S.myMass < CFG.carryKeep || !canW)) st.on = false;
        if (!st.on) return false;
        const gap = dCap - cb - myBig.s;
        if (gap > 2500) { st.on = S.myMass >= CFG.carryFeedAt; return false; }   // far: graze our way back (leash pull)
        // nothing that could eat us between us and the carrier (a W lane through a big player just feeds it)
        const lane = S.enemies.find(e => !e.remote && e.player && e.key !== cap.key && (canEat(e.s, myBig.s) || canEat(e.s, 40)) &&
            segDist(e.x, e.y, myBig.x, myBig.y, cc.x, cc.y) < e.s + 120 && Math.hypot(e.x - myBig.x, e.y - myBig.y) < dCap);
        if (lane && canEat(lane.s, myBig.s)) return false;
        if (gap > 650) return travel(conn, S, cc.x, cc.y, 'carry: bringing ' + Math.round(S.myMass) + ' mass to ' + who);
        // close: shoot into it, hovering 250-650 off its edge. Every shot moves us a step toward it (the server moves
        // to the mouse before it shoots), so inside 250 we back off without shooting, and come in again from 450
        if (gap < 250) st.back = true; else if (gap > 450) st.back = false;
        if (st.back) {
            const ux = (myBig.x - cc.x) / (dCap || 1), uy = (myBig.y - cc.y) / (dCap || 1);
            const bx = myBig.x + ux * 600, by = myBig.y + uy * 600;
            conn.sendMouse(bx, by); conn.botAim = { x: bx, y: by };
            conn.mode = 'carry: backing off ' + who + ' (too close to feed)';
            return true;
        }
        if (lane) { conn.sendMouse(cc.x, cc.y); conn.botAim = { x: cc.x, y: cc.y }; }
        else shootAt(conn, S, capTarget(conn, cap));
        conn.mode = 'carry: feeding ' + who + (lane ? ' (waiting: ' + (lane.name || 'someone') + ' in the lane)' : '');
        teamlog.start(conn, S, 'carry: feed', { mass: Math.round(S.myMass) }, cap.key, '', 3000);
        return true;
    }
    // trade: eat the captain's small pieces; feed it (W) while we're bigger than it
    function stepTrade(conn, S, cap, cc, cb, myBig) {
        if (conn.danger > 0.2 * S.myMass + 1) return false;
        const capCells = cap.cells.map(r => ({ id: r[0], x: r[1], y: r[2], s: r[3] }));
        const capBig = capCells.reduce((a, c) => (c.s > a.s ? c : a));
        // the captain's pieces we can take: not its biggest, nothing near that size, and growing must not let us
        // swallow its big cell right there
        let best = null, bd = Infinity;
        for (const c of capCells) {
            if (c === capBig || c.s > capBig.s * 0.85 || !canEat(myBig.s, c.s * CFG.eatMargin)) continue;
            const grown = Math.sqrt(myBig.s * myBig.s + c.s * c.s);
            if (canEat(grown, capBig.s) && Math.hypot(capBig.x - c.x, capBig.y - c.y) < grown - capBig.s / GAME.eatOverlapDiv + 150) continue;
            if (canEat(myBig.s * 1.05, capBig.s) && segDist(capBig.x, capBig.y, myBig.x, myBig.y, c.x, c.y) < myBig.s + 60) continue;
            if (S.enemies.some(e => canEat(e.s, myBig.s) && Math.hypot(e.x - c.x, e.y - c.y) < e.s + 600)) continue;
            const d = Math.hypot(c.x - myBig.x, c.y - myBig.y);
            if (d < bd) { bd = d; best = c; }
        }
        if (best && bd < 2500) {
            const live = conn.cells.get(best.id) || best;
            if (bd - myBig.s > 600) return travel(conn, S, live.x, live.y, 'team: going for ' + (cap.name || 'the captain') + "'s small pieces");
            conn.sendMouse(live.x, live.y); conn.botAim = { x: live.x, y: live.y };
            conn.mode = 'team: eating ' + (cap.name || 'the captain') + "'s small pieces";
            teamlog.start(conn, S, 'trade: eat captain pieces', {}, cap.key, '', 3000);
            return true;
        }
        // bigger than the captain: feed it until it's about our size
        const capMass = cap.mass || capCells.reduce((a, c) => a + mass(c.s), 0);
        const dCap = Math.hypot(cc.x - myBig.x, cc.y - myBig.y) - cb - myBig.s;
        if (S.myMass > capMass * 1.08 && dCap < 900 && S.mine.some(c => c.s >= GAME.minEjectSize)) {
            // not so close that our cell runs into it (or it into us)
            if (dCap > 120) shootAt(conn, S, capTarget(conn, cap)); else { conn.sendMouse(cc.x, cc.y); conn.botAim = { x: cc.x, y: cc.y }; }
            conn.mode = 'team: feeding ' + (cap.name || 'the captain') + ' to even us out';
            teamlog.start(conn, S, 'trade: feed captain', {}, cap.key, '', 3000);
            return true;
        }
        return false;
    }
    // where the order wants us: follow / flank / orbit / protect (body-block); pulls drop that would take us away
    // on the way to an order's target: a strong pull this tick, steering does the rest (and keeps us alive)
    function travel(conn, S, x, y, label) {
        conn.orderTravel = { x, y, label, tick: S.tick };
        return false;
    }
    function orderPulls(conn, S, pulls) {
        const cap = S.captain;
        const tr = conn.orderTravel;
        if (tr && tr.tick === S.tick) {
            for (let i = pulls.length - 1; i >= 0; i--) if (/^team: (herding|regroup|meeting up)|^team plan: in formation|^trap:/.test(pulls[i].label || '')) pulls.splice(i, 1);
            pulls.push({ x: tr.x, y: tr.y, noCalm: true, w: 2 * S.myMass, label: tr.label });
            return;
        }
        if (!ordered(S) || cap.order.mode === 'farm') {
            if (cap && cap.order.mode === 'farm') for (let i = pulls.length - 1; i >= 0; i--) if (/^team: (regroup|meeting up)|^team plan: in formation/.test(pulls[i].label || '')) pulls.splice(i, 1);
            return;
        }
        for (let i = pulls.length - 1; i >= 0; i--) if (/^team: (herding|regroup|meeting up)|^team plan: in formation|^trap:/.test(pulls[i].label || '')) pulls.splice(i, 1);
        const mode = cap.order.mode, cc = memberCenter(cap), cb = memberBig(cap), h = captainHeading(cap);
        const hx = Math.cos(h), hy = Math.sin(h), px = -hy, py = hx;
        const myBig = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        if (mode === 'carry') {
            // graze freely near the carrier; outside the leash, head back. A threat to the carrier: the bigger
            // feeders stand in its way (they're cheap, the carrier isn't)
            const d = Math.hypot(cc.x - myBig.x, cc.y - myBig.y) - cb;
            if (d > CFG.carryLeash) { pulls.push({ x: cc.x, y: cc.y, noCalm: true, w: (d > CFG.carryLeash * 2 ? 1.6 : 0.9) * S.myMass, label: 'carry: back to ' + (cap.name || 'the carrier') }); return; }
            let thr = null;
            for (const e of S.enemies) {
                if (!e.player || e.remote || e.key === cap.key || !cap.cells.some(r => canEat(e.s, r[3]))) continue;
                const de = Math.hypot(e.x - cc.x, e.y - cc.y);
                if (de > e.s + cb + 2000) continue;
                if (!thr || e.s / (de + 500) > thr.s / (thr.d + 500)) thr = { e, s: e.s, d: de };
            }
            if (thr && S.myMass >= 150 && conn.danger < 0.2 * S.myMass + 1) {
                const ux = (thr.e.x - cc.x) / (thr.d || 1), uy = (thr.e.y - cc.y) / (thr.d || 1), along = Math.min(thr.d * 0.6, cb + myBig.s + 300);
                pulls.push({ x: cc.x + ux * along, y: cc.y + uy * along, noCalm: true, w: 0.7 * S.myMass, label: 'carry: standing between ' + (cap.name || 'the carrier') + ' and ' + (thr.e.name || 'a big player') });
            }
            return;
        }
        const { k, n } = orderSlot(conn, S);
        const R = cb + myBig.s + 250;
        let tx, ty, label;
        if (mode === 'follow') {
            const off = (k - (n - 1) / 2) * (myBig.s * 2 + 150);
            tx = cc.x - hx * (R + 250) + px * off; ty = cc.y - hy * (R + 250) + py * off; label = 'order: following ' + (cap.name || 'the captain');
        } else if (mode === 'orbit') {
            const a = (Date.now() / 1000) * 0.5 + 2 * Math.PI * k / Math.max(1, n), r = R + 450;
            tx = cc.x + Math.cos(a) * r; ty = cc.y + Math.sin(a) * r; label = 'order: orbiting ' + (cap.name || 'the captain');
        } else {
            // flank (and protect when nothing's threatening): one each side, further rows beyond
            const side = k % 2 ? -1 : 1, row = Math.floor(k / 2), closeIn = mode === 'trade' ? -150 : 0;
            tx = cc.x + px * side * (R + closeIn + row * (myBig.s * 2 + 200)) + hx * 150; ty = cc.y + py * side * (R + closeIn + row * (myBig.s * 2 + 200)) + hy * 150;
            label = mode === 'trade' ? 'order: trading with ' + (cap.name || 'the captain') : 'order: flanking ' + (cap.name || 'the captain');
            if (mode === 'protect') {
                // body-block the biggest player that could eat the captain (or a good part of it)
                let thr = null;
                for (const e of S.enemies) {
                    if (!e.player || e.key === cap.key || !cap.cells.some(r => canEat(e.s, r[3]))) continue;
                    const d = Math.hypot(e.x - cc.x, e.y - cc.y);
                    if (d > e.s + cb + 2500) continue;
                    if (!thr || e.s / (d + 500) > thr.s / (thr.d + 500)) thr = { e, s: e.s, d };
                }
                if (thr) {
                    const ux = (thr.e.x - cc.x) / (thr.d || 1), uy = (thr.e.y - cc.y) / (thr.d || 1), along = cb + myBig.s + 150 + k * (myBig.s * 2 + 100);
                    tx = cc.x + ux * along + (k % 2 ? -1 : 1) * -uy * (k ? myBig.s : 0); ty = cc.y + uy * along + (k % 2 ? -1 : 1) * ux * (k ? myBig.s : 0);
                    label = 'order: guarding ' + (cap.name || 'the captain') + ' from ' + (thr.e.name || 'a big player');
                } else label = 'order: protecting ' + (cap.name || 'the captain');
            }
        }
        pulls.push({ x: tx, y: ty, noCalm: true, w: 1.3 * S.myMass, label });
    }

    // scavenging (3.36.0): the player's recordings got 47% of their growth from other players' split pieces. Two big
    // players fighting (close together, one able to eat the other) spill pieces: wait just outside the reach of
    // both (CFG.scavengeGap beyond it) on the side nearest us; the prey logic eats what comes our way. Only calm.
    function scavengePulls(conn, S, pulls) {
        // (was 5% danger: next to a fight is never that calm, so it never ran. It waits outside both fighters' reach)
        if (!CFG.scavenge || conn.danger > CFG.scavengeMaxDanger * S.myMass + 1 || S.myMass < 150) return;
        if (S.captain && S.captain.order.mode !== 'free' && S.captain.order.mode !== 'carry') return;
        const big = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        const fighters = S.enemies.filter(e => e.player && !e.remote && canEat(e.s, big.s) && Math.hypot(e.x - S.center.x, e.y - S.center.y) < 3500);
        let best = null;
        for (let i = 0; i < fighters.length; i++) for (let j = i + 1; j < fighters.length; j++) {
            const a = fighters[i], b = fighters[j];
            if (a.key === b.key || (teamers.get(a.key) && teamers.get(a.key).mates.has(b.key)) || (teamers.get(b.key) && teamers.get(b.key).mates.has(a.key))) continue;   // teammates don't fight
            if (!canEat(a.s, b.s) && !canEat(b.s, a.s)) continue;
            const dab = Math.hypot(a.x - b.x, a.y - b.y);
            if (dab > a.s + b.s + 900) continue;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const ra = Math.max(0, threatReach(S, a, big.s)), rb = Math.max(0, threatReach(S, b, big.s));
            const R = Math.max(ra + Math.hypot(a.x - mx, a.y - my), rb + Math.hypot(b.x - mx, b.y - my)) + CFG.scavengeGap;
            const dx = S.center.x - mx, dy = S.center.y - my, dl = Math.hypot(dx, dy) || 1;
            const px = mx + dx / dl * R, py = my + dy / dl * R;
            // nobody else who could eat us near that spot
            if (S.enemies.some(e => e !== a && e !== b && canEat(e.s, big.s) && Math.hypot(e.x - px, e.y - py) < Math.max(0, threatReach(S, e, big.s)) + 600)) continue;
            const d = Math.hypot(px - S.center.x, py - S.center.y);
            if (!best || d < best.d) best = { px, py, d, a, b };
        }
        if (!best) return;
        pulls.push({ x: best.px, y: best.py, w: CFG.scavengeWeight * S.myMass, label: 'scavenging: ' + (best.a.name || '?') + ' vs ' + (best.b.name || '?') });
    }
    // the plan this connection follows: its own if it's the planner, else the planner's (if fresh)
    function teamPlanFor(conn, S) {
        if (!CFG.bot || !CFG.teamBrain || !S.squad.length || !S.mine.length) return null;
        const near = S.squad.filter(m => m.cells.length && Math.hypot(memberCenter(m).x - S.center.x, memberCenter(m).y - S.center.y) < 4000);
        if (!near.length) return null;
        const planner = [conn.memberId, ...near.map(m => m.from)].sort()[0];
        if (planner === conn.memberId) {
            if (!conn.teamPlan || now() - (conn.teamPlanAt || 0) > 200) { conn.teamPlan = makeTeamPlan(conn, S); conn.teamPlanAt = now(); }
            return conn.teamPlan;
        }
        conn.teamPlan = null;
        const m = near.find(x => x.from === planner);
        return m && m.plan && now() - m.rx < 1500 ? m.plan : null;
    }

    // CROWN (the goal: #1 on the leaderboard at least once). Leaderboard #1 is often a 9-25k player between giants;
    // our bots together often hold that much. When the team's combined mass beats the mass we last saw the current #1
    // at (any of us, within crownSeenMs) by crownMargin, everyone merges into our biggest bot: that cell is #1.
    const nameSeen = new Map();     // player name -> { m: total mass when last seen, t }
    function crownNoteSeen(S) {
        const by = new Map();
        for (const e of S.enemies) if (e.player && !e.remote && e.name) by.set(e.name, (by.get(e.name) || 0) + mass(e.s));
        const t = now();
        for (const [n, m] of by) nameSeen.set(n, { m: Math.round(m), t });
    }
    function stepCrown(conn, S) {
        if (!CFG.bot || !CFG.crown || !S.mine.length) { conn.crown = null; return false; }
        crownNoteSeen(S);
        const t = now();
        const live = S.squad.filter(m => m.cells.length && t - m.rx < 1500);
        // an order from a teammate (the first to see the chance gives it)
        if (!conn.crown) for (const m of live) if (m.crown && m.crown.until > Date.now()) { conn.crown = { ...m.crown, adopted: true }; break; }
        const lb = conn.lb && t - conn.lb.t < 6000 ? conn.lb : null;
        if (lb && lb.pos === 1) {
            if (!conn.wasFirst) { conn.wasFirst = true; hud.flash('👑 WE ARE #1 ON THE LEADERBOARD'); try { lab.send({ type: 'event', t: Date.now(), text: '👑 #1 on the leaderboard' }); } catch (_) { } }
        } else conn.wasFirst = false;
        if (!conn.crown && lb && lb.names.length && lb.pos !== 1) {
            const n1 = lb.names[0];
            const ours = new Set([conn.myName, ...live.map(m => m.name)].filter(Boolean));
            const seen = nameSeen.get(n1);
            const team = S.myMass + live.reduce((a, m) => a + (m.mass || 0), 0);
            if (!ours.has(n1) && seen && Date.now() - seen.t < CFG.crownSeenMs && live.length >= 1 && team >= seen.m * CFG.crownMargin && team >= CFG.crownMinMass) {
                // the anchor: our biggest (ties: lowest id); everyone must be close enough to get there in time
                const all = [{ from: conn.memberId, mass: S.myMass, c: S.center }, ...live.map(m => ({ from: m.from, mass: m.mass || 0, c: memberCenter(m) }))];
                const anchor = all.reduce((a, b) => (b.mass > a.mass || (b.mass === a.mass && b.from < a.from) ? b : a));
                const far = all.filter(b => Math.hypot(b.c.x - anchor.c.x, b.c.y - anchor.c.y) > CFG.crownRange);
                const reach = team - far.reduce((a, b) => a + b.mass, 0);
                if (reach >= seen.m * CFG.crownMargin) {
                    conn.crown = { anchor: anchor.from, target: n1, need: seen.m, until: Date.now() + CFG.crownMs };
                    hud.flash(`👑 crown: ${Math.round(reach)} together beats #1 ${n1} (${seen.m}) - all into the biggest`);
                    try { teamlog.start(conn, S, 'crown (all into the biggest for #1)', { target: n1, need: seen.m, team: Math.round(reach) }, '', '', CFG.crownMs); } catch (_) { }
                }
            }
        }
        const cr = conn.crown;
        if (!cr) return false;
        if (cr.until < Date.now() || (lb && lb.pos === 1 && t - (cr.firstAt || (cr.firstAt = t)) > 8000)) { conn.crown = null; return false; }
        if (lb && lb.pos !== 1) cr.firstAt = 0;
        const aim = p => { conn.sendMouse(p.x, p.y); conn.botAim = p; };
        if (cr.anchor === conn.memberId) {
            // the anchor: meet the divers (their centre), unless that walks us into danger - then normal play
            if (conn.danger > 0.25 * S.myMass + 1) return false;
            const others = live.filter(m => m.crown || true);
            if (!others.length) return false;
            const pc = centroid(others.map(m => memberCenter(m)).map(c => ({ ...c, s: 1 })));
            aim({ x: (S.center.x + pc.x) / 2, y: (S.center.y + pc.y) / 2 });
            conn.mode = '👑 crown: the team comes into us (to beat ' + cr.target + ')';
            return true;
        }
        const A = live.find(m => m.from === cr.anchor);
        if (!A) { conn.crown = null; return false; }
        // a diver: everything into the anchor's biggest piece, fast (split in when it lands in it)
        conn.squadMerge = true; conn.mergeUntil = t + 600;
        const rows = A.cells.map(r => { const c = conn.cells.get(r[0]); return c ? { id: c.id, x: c.x, y: c.y, s: c.s } : { id: r[0], x: r[1], y: r[2], s: r[3] }; });
        const tgt = rows.reduce((a, c) => (c.s > a.s ? c : a));
        aim({ x: tgt.x, y: tgt.y });
        const myBig = S.mine.reduce((a, c) => (c.s > a.s ? c : a)), half = myBig.s / SQRT2;
        const gap = Math.hypot(tgt.x - myBig.x, tgt.y - myBig.y) - tgt.s;
        const lane = !S.enemies.some(e => !conn.mateKeys.has(e.key) && e.player && canEat(e.s, half * 0.95) && segDist(e.x, e.y, myBig.x, myBig.y, tgt.x, tgt.y) < e.s + half + 120);
        if (myBig.s >= GAME.minSplitSize && S.mine.length < CFG.maxCells && canEat(tgt.s, half * 1.03) && gap < GAME.splitDistance + GAME.splitBoost * 0.7 && lane && t - (conn.crownSplit || 0) > 450) {
            conn.sendSplit(1); conn.crownSplit = t; conn.lastAction = t; conn.lockUntil = t + 250; conn.lockTargetId = 0; conn.lockAim = { x: tgt.x, y: tgt.y };
        }
        conn.mode = '👑 crown: into ' + (A.name || 'our biggest') + ' (to beat ' + cr.target + ')';
        return true;
    }

    // Boost a teammate's piece in an even fight (the user: "blue was split in two, someone went for one piece, same
    // size so it didn't work - green could have dived into the blue part and we'd have eaten them"). A stranger right
    // at a teammate's piece, neither able to eat the other: split our half into that piece - it lands, the piece is
    // suddenly big enough, and it eats the stranger.
    function stepBoostMate(conn, S) {
        if (!CFG.bot || !CFG.boostMate || !S.mates.length || !S.mine.length) return false;
        const t = now();
        if (t - (conn.boostAt || 0) < CFG.boostMateGapMs) return false;
        let best = null;
        for (const P of S.mates) {
            if (!conn.mateKeys.has(P.key)) continue;
            for (const E of S.enemies) {
                if (!E.player || E.remote || isAlly(E) || conn.mateKeys.has(E.key) || isMaster(E)) continue;
                if (canEat(P.s, E.s * CFG.eatMargin) || canEat(E.s, P.s * 1.1)) continue;          // not an even fight
                const dPE = Math.hypot(P.x - E.x, P.y - E.y) - P.s - E.s;
                if (dPE > CFG.boostMateFightGap) continue;                                          // not at each other
                for (const c of S.mine) for (let k = 1; k <= 2; k++) {
                    // k splits: our pieces become c.s / sqrt2^k - small enough for their piece to eat (a bigger
                    // teammate splits twice)
                    if (c.s / Math.pow(SQRT2, k - 1) < GAME.minSplitSize || S.mine.length * Math.pow(2, k) > CFG.maxCells + S.mine.length) continue;
                    const half = c.s / Math.pow(SQRT2, k);
                    if (!canEat(P.s, half * 1.04)) continue;                                        // they must eat our piece
                    if (!canEat(Math.sqrt(P.s * P.s + half * half), E.s * 1.03)) continue;         // and then win
                    const gap = Math.hypot(P.x - c.x, P.y - c.y) - P.s;
                    if (gap > GAME.splitDistance + GAME.splitBoost * 0.7) continue;                 // in range
                    // the half flies past nothing that eats it on the way (the stranger first of all)
                    if (S.enemies.some(o => o.player && !conn.mateKeys.has(o.key) && canEat(o.s, half * 0.97) && segDist(o.x, o.y, c.x, c.y, P.x, P.y) < o.s + half * 0.6)) continue;
                    const score = mass(E.s) - gap - k * 50;
                    if (!best || score > best.score) best = { P, E, c, k, score };
                }
            }
        }
        if (!best) return false;
        const p = predict(best.P, S.L + 2, S.tick);
        // deliberate, but only for the split itself: our other half must NOT be fair game for their piece (live: the
        // first boost, the teammate ate our remaining half too)
        conn.squadMerge = true; conn.mergeUntil = t + 250;
        conn.mode = 'team: boosting ' + (best.P.name || 'teammate') + ' to eat ' + (best.E.name || 'them');
        conn.sendMouse(p.x, p.y); conn.botAim = p;
        conn.sendSplit(best.k); conn.boostAt = t; conn.lastAction = t; conn.lockUntil = t + 250; conn.lockTargetId = 0; conn.lockAim = p;
        hud.flash(conn.mode);
        try { teamlog.start(conn, S, 'boost teammate in an even fight', { vs: best.E.name || '' }, best.P.key, best.E.key, 3000); } catch (_) { }
        return true;
    }

    // A stranger we can eat right here: team routines (fast travel, pairing) step aside so normal play eats it.
    // (the user: "a player smaller than us - let's not bother chasing it. No wonder this never wins")
    function snackNear(conn, S) {
        if (!CFG.snackBreak || !S.mine.length) return false;
        for (const e of S.enemies) {
            if (!e.player || e.remote || isAlly(e) || e.feeding || conn.mateKeys.has(e.key) || isMaster(e)) continue;
            const still = isStill(e, S.tick);
            for (const m of S.mine) {
                if (!canEat(m.s, e.s * (still ? 1.005 : CFG.eatMargin))) continue;
                if (Math.hypot(e.x - m.x, e.y - m.y) - m.s < (still ? CFG.snackStillDist : CFG.snackDist)) return true;
            }
        }
        return false;
    }

    // Rally (the user: "they're all broken up into little bits travelling around together and not eating each other /
    // combining when there are threats... just wobbling around the same area"): split up near a teammate with a
    // stranger close that could eat our pieces -> become one cell, decisively. The one with the biggest piece is
    // the anchor and goes at the other; the other sends everything into the anchor's biggest piece (splitting in
    // when it reaches). The roles stick for a while so it never flips back and forth. Runs before evading.
    function stepRally(conn, S) {
        if (!CFG.bot || !CFG.teamRally || !S.squad.length || !S.mine.length) { conn.rally = null; return false; }
        const t = now();
        const rows = m => m.cells.map(r => { const c = conn.cells.get(r[0]); return c ? { id: c.id, x: c.x, y: c.y, s: c.s } : { id: r[0], x: r[1], y: r[2], s: r[3] }; });
        let m = null, md = Infinity;
        for (const q of S.squad) {
            if (!q.cells.length || (conn.rally && conn.rally.mate !== q.from && t < conn.rally.until)) continue;
            const c = memberCenter(q), d = Math.hypot(c.x - S.center.x, c.y - S.center.y);
            if (d < md) { md = d; m = q; }
        }
        if (!m || md > CFG.rallyRange + S.maxMine + memberBig(m)) { conn.rally = null; return false; }
        // never a trap (live: a bot sat 10 s in 'kept a piece beside' while jeblina walked up and ate it - the rally
        // ran before evading): short, with a cooldown, and it hands back to normal play whenever that matters more
        if (t < (conn.rallyCooldown || 0)) return false;
        const end = () => { conn.rally = null; conn.rallyCooldown = t + CFG.rallyCooldownMs; return false; };
        if (conn.rally && t - conn.rally.since > CFG.rallyMaxMs) return end();
        const theirs = rows(m), all = S.mine.concat(theirs);
        if (S.mine.length < 3 && theirs.length < 3) { conn.rally = null; return false; }
        const big = cs => cs.reduce((a, c) => (c.s > a.s ? c : a));
        const myBig = big(S.mine), pBig = big(theirs);
        const press = S.enemies.find(e => e.player && !isAlly(e) && !conn.mateKeys.has(e.key) &&
            all.some(q => canEat(e.s, q.s) && Math.hypot(e.x - q.x, e.y - q.y) - e.s < CFG.rallyThreatDist));
        if (!press && !(conn.rally && t < conn.rally.until)) { conn.rally = null; return false; }
        // something that can eat the whole team as one cell: rallying just feeds it - the normal escape decides
        const teamS = Math.sqrt(all.reduce((a, c) => a + mass(c.s), 0) * 100);
        if (press && canEat(press.s, teamS) && Math.hypot(press.x - S.center.x, press.y - S.center.y) - press.s < 900) { conn.rally = null; return false; }
        // a merge only happens where a piece is 1.14x the size of what it swallows (the user: "same size throughout - we
        // CANNOT merge like this... they sat there trying to merge doing nothing while they got eaten"). Rally only if
        // one side's biggest piece can take most of the other's mass (whole, or as split halves landing in it);
        // otherwise there's nothing to rally to - normal escape.
        const takes = (big, cs) => {
            let m = 0, tot = 0;
            for (const c of cs) { tot += mass(c.s); if (canEat(big.s, c.s * CFG.eatMargin) || (c.s >= GAME.minSplitSize && canEat(big.s, c.s / SQRT2 * CFG.eatMargin))) m += mass(c.s); }
            return tot ? m / tot : 0;
        };
        const iTake = takes(myBig, theirs.filter(c => c !== pBig).concat([pBig])), theyTake = takes(pBig, S.mine);
        if (!conn.rally && Math.max(iTake, theyTake) < CFG.rallyMergeable) return false;
        if (!conn.rally || conn.rally.mate !== m.from) {
            // the anchor is whichever side ends up as the BIGGEST SINGLE CELL (the user: a broken-up player pours into the
            // teammate's one whole cell - one big cell can eat the chaser; topping up one piece of a broken-up player saves
            // nothing)
            const theirMassR = theirs.reduce((a2, c) => a2 + mass(c.s), 0);
            const iEnd = mass(myBig.s) + iTake * theirMassR, theyEnd = mass(pBig.s) + theyTake * S.myMass;
            const anchor = iEnd > theyEnd * 1.03 || (Math.abs(iEnd - theyEnd) <= theyEnd * 0.03 && conn.memberId < m.from);
            conn.rally = { mate: m.from, anchor, since: t };
            hud.flash(anchor ? `team: rally - ${m.name || 'teammate'} comes into us` : `team: rally - into ${m.name || 'teammate'}`);
        }
        conn.rally.until = t + CFG.rallyHoldMs;
        const aim = p => { conn.sendMouse(p.x, p.y); conn.botAim = p; };
        if (conn.rally.anchor) {
            // prey we can eat right here (live: jeblina): normal play hunts it. (Not for things that can eat us: the
            // anchor bailing on the rally left the diver chasing it - rally scene wiped out 2/8.)
            if (S.enemies.some(e => e.player && !conn.mateKeys.has(e.key) && !isAlly(e) && Math.hypot(e.x - myBig.x, e.y - myBig.y) - e.s < 1200 &&
                canEat(myBig.s, e.s * CFG.eatMargin))) return end();
            // only once they've confirmed they're diving in (mines: Lead charged as the anchor at a Help that was still
            // farming - and ate it, 7 of 24 runs)
            if (!(m.intent && m.intent.rally)) {
                if (t - conn.rally.since > 1200) return end();
                return false;
            }
            // go at them (their pieces come into ours), leaning away from the threat
            const pc = centroid(theirs);
            const ax = press ? (S.center.x - press.x) : 0, ay = press ? (S.center.y - press.y) : 0, al = Math.hypot(ax, ay) || 1;
            aim({ x: pc.x + ax / al * 150, y: pc.y + ay / al * 150 });
            conn.mode = 'team: rally - ' + (m.name || 'teammate') + ' coming into us';
            return true;
        }
        // the diver keeps one piece (the user's rule: never eat each other out, both survive): down to one piece, or
        // most of our mass poured in -> stop diving (the teammate guard protects what's left) and stay beside them
        if (!conn.rally.startMass) conn.rally.startMass = S.myMass;
        // (small pieces are faster and get there first; our big one turns aside before it reaches their eat line)
        const pcNow = conn.cells.get(pBig.id) || pBig;
        const bigClose = canEat(pcNow.s, myBig.s) && Math.hypot(myBig.x - pcNow.x, myBig.y - pcNow.y) < pcNow.s - myBig.s / GAME.eatOverlapDiv + 260;
        // poured what we could: done - normal play (evading included) looks after the piece we kept
        if (S.mine.length <= 1 || S.myMass < conn.rally.startMass * 0.15 || bigClose) return end();
        // the diver: everything into their biggest piece (marked as a deliberate dive FIRST: the teammate guard in
        // sendMouse steers anything else off a teammate that could eat it - that's what kept them from ever touching)
        conn.squadMerge = true;
        conn.mode = 'team: rally - merging into ' + (m.name || 'teammate');
        const tgt = conn.cells.get(pBig.id) || pBig;
        const p = { x: tgt.x, y: tgt.y };
        const gap = Math.hypot(p.x - myBig.x, p.y - myBig.y) - tgt.s;
        const half = myBig.s / SQRT2;
        // a piece their biggest can't eat (about its size) just bumps it: the user - "it should have split up further
        // or fed it with ejected mass". Split smaller first; if we can't split any more, shoot mass in.
        const edibleAny = S.mine.some(c => canEat(tgt.s, c.s * CFG.eatMargin));
        const splitEdible = myBig.s >= GAME.minSplitSize && S.mine.length < CFG.maxCells && canEat(tgt.s, half * 1.03);
        if (!edibleAny && !splitEdible) {
            // can't merge now: shooting mass takes seconds - never with a stranger near (that's how both died)
            if (press && Math.hypot(press.x - S.center.x, press.y - S.center.y) - press.s < 1500) return end();
            if (S.mine.some(c => c.s >= GAME.minEjectSize)) feedShoot(conn, S, tgt, theirs);
            else aim({ x: tgt.x, y: tgt.y });
            conn.mode = 'team: rally - shooting mass into ' + (m.name || 'teammate') + ' (too big to be eaten)';
            conn.mergeUntil = t + 600;
            return true;
        }
        if (!edibleAny && gap < GAME.splitDistance + GAME.splitBoost * 0.7) {
            // in split range with pieces it can't eat: don't push in, hold here and split (below)
            const ux2 = (myBig.x - tgt.x) / (gap + tgt.s || 1), uy2 = (myBig.y - tgt.y) / (gap + tgt.s || 1);
            aim({ x: myBig.x - ux2 * 30, y: myBig.y - uy2 * 30 });
        } else aim(p);
        const lane = !S.enemies.some(e => !conn.mateKeys.has(e.key) && e.player && canEat(e.s, half * 0.95) && segDist(e.x, e.y, myBig.x, myBig.y, p.x, p.y) < e.s + half + 120);
        if (myBig.s >= GAME.minSplitSize && S.mine.length < CFG.maxCells && canEat(tgt.s, half * 1.03) && gap < GAME.splitDistance + GAME.splitBoost * 0.7 &&
            lane && t - (conn.rallySplit || 0) > 450) {
            conn.sendSplit(1); conn.rallySplit = t; conn.lastAction = t; conn.lockUntil = t + 250; conn.lockTargetId = 0; conn.lockAim = p;
        }
        conn.mergeUntil = t + 600;  // keeps squadMerge on between ticks, so the anchor's guard lets us in too
        return true;
    }

    // Pool pieces with a teammate: we're near each other, one of us is in several pieces, and one of us is under
    // pressure. Then both close in and each one's big pieces swallow the other's small ones: fewer, bigger
    // pieces for both (big pieces are what a chaser can't eat), and none of the mass leaves the team.
    function teamPoolWanted(conn, S) {
        if (!CFG.bot || !CFG.teamPool || !S.squad.length) return false;
        for (const m of S.squad) {
            const mc = memberCenter(m);
            if (Math.hypot(mc.x - S.center.x, mc.y - S.center.y) > 1600 + S.maxMine + memberBig(m)) continue;
            const split = S.mine.length >= 3 || m.cells.length >= 3;
            const pressed = conn.danger > 0.1 * S.myMass || m.danger > 0.1 * m.mass;
            if (split && pressed) {
                if (!conn.teamPool) hud.flash(`team: pooling pieces with ${m.name || 'our teammate'}`);
                return true;
            }
        }
        return false;
    }

    // ---------------------------------------------------------------- DNA relay
    // Two teammates leapfrog like a DNA strand. The stepper splits forward along a curve (first diagonal toward
    // the partner's side, then straight, then diagonal back), only as often as it takes for the partner to be
    // able to eat the pieces it leaves; it parks its head (the piece furthest along) so the tail bunches behind
    // it; the partner eats the tail, never the head. Then the partner steps, curving the mirror way, and the head
    // eats ITS tail. Strictly alternating, so mass flows back and forth and the pair moves forward fast.
    // pairs for the relay: every one of us computes the same pairing (closest two first, then the next closest two...)
    // from the positions we all share; a pair that's mid-relay is kept while it's still close enough
    const relayPartner = S => {
        const live = S.squad.filter(m => m.cells.length);
        if (!live.length) return null;
        const conn = S.conn, myId = conn.memberId;
        const keep = conn.relay && conn.relay.active && conn.relayPartnerId && live.find(m => m.from === conn.relayPartnerId);
        if (keep) { const c = memberCenter(keep); if (Math.hypot(c.x - S.center.x, c.y - S.center.y) < 4000) return keep; }
        const pts = [{ id: myId, x: S.center.x, y: S.center.y, m: null }, ...live.map(m => { const c = memberCenter(m); return { id: m.from, x: c.x, y: c.y, m }; })];
        const pairs = [];
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) pairs.push([Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y), pts[i], pts[j]]);
        pairs.sort((a, b) => a[0] - b[0] || (String(a[1].id) + a[2].id < String(b[1].id) + b[2].id ? -1 : 1));
        const used = new Set();
        for (const [d, a, b] of pairs) {
            if (used.has(a.id) || used.has(b.id)) continue;
            used.add(a.id); used.add(b.id);
            if (a.id === myId || b.id === myId) { if (d > 6000) return null; const o = a.id === myId ? b : a; conn.relayPartnerId = o.id; return o.m; }
        }
        return null;
    };
    const relayActive = conn => !!(conn.relay && conn.relay.active);
    const RELAY_TURNS = [[0], [Math.PI / 4, -Math.PI / 4], [Math.PI / 4, 0, -Math.PI / 4]];
    // relay telemetry for the Lab's Relay watch
    function relayTell(conn, ev, data) {
        try { lab.send({ type: 'relay', ev, t: Date.now(), v: VERSION, member: conn.memberId || '', ...data }); } catch (_) { }
    }
    function relaySample(conn) {
        const t = now();
        if (t - (conn.relaySampleAt || 0) < 500) return;
        conn.relaySampleAt = t;
        const why = relayActive(conn) ? 'relay running' : String(conn.relayWhy || 'not checked').replace(/^started .*/, 'relay running')
            .replace(/\(\d+\)/, '').replace(/pieces \d+\/\d+/, 'too many pieces').replace(/^company: .*/, 'someone near').trim();
        const b = conn.relayBlocks = conn.relayBlocks || {};
        b[why] = (b[why] || 0) + 1;
        if (t - (conn.relayBlocksAt || 0) >= 5000) { conn.relayBlocksAt = t; relayTell(conn, 'blocks', { counts: b }); conn.relayBlocks = {}; }
    }
    function endRelay(conn, R, why, cooldown, tag) {
        if (R && R.active) relayTell(conn, 'end', { seq: R.seq, why: tag || why || 'ended', rounds: R.round || 1, relayWhy: R.why });
        conn.relay = { ...R, active: false, seq: R.seq + 1 };
        conn.relayCooldown = now() + cooldown;
        if (why) hud.flash('team relay: ' + why);
        return false;
    }
    // how many splits (1-3) it takes for pieces of a cell this big to be edible by 'eater', keeping pieces >= 140
    function relaySplitsFor(stepperS, eaterS) {
        for (let k = 1; k <= 3; k++) {
            const piece = stepperS / Math.pow(SQRT2, k);
            if (piece * GAME.eatMult < eaterS * 0.97) return piece >= 140 ? k : 0;
        }
        return 0;
    }

    // how far from a cell an enemy could get at it soon: its eating edge or its split reach, plus a margin
    function threatReach(S, e, size) {
        const direct = canEat(e.s, size) ? e.s - size / GAME.eatOverlapDiv : -Infinity;
        const split = enemySplitReach(e, size, S.ownerCount.get(e.key) || 1);
        return Math.max(direct, split);
    }
    function relaySafeToStart(conn, S, P) {
        const pc = memberCenter(P), pbig = memberBig(P);
        if (Math.hypot(pc.x - S.center.x, pc.y - S.center.y) - S.maxMine - pbig > 1300) { conn.relaySafeWhy = 'too far apart'; return false; }
        if (conn.danger > 0.05 * S.myMass + 1 || P.danger > 0.05 * P.mass + 1) { conn.relaySafeWhy = 'danger'; return false; }
        const small = Math.min(S.maxMine, pbig) / 2;
        const bad = S.enemies.find(e => { const r = threatReach(S, e, small); return r > -Infinity && Math.hypot(e.x - S.center.x, e.y - S.center.y) < r + 800; });
        conn.relaySafeWhy = bad ? 'company: ' + (bad.name || 'someone') : '';
        return !bad;
    }
    function relayNo(conn, why) { conn.relayWhy = why; return null; }
    function relayStart(conn, S, P) {
        if (S.plan && S.plan.trap && S.plan.trap.roles && S.plan.trap.roles[conn.memberId]) return relayNo(conn, 'hunting together');
        if (ordered(S)) return relayNo(conn, 'following orders');
        { const h = CFG.huntPull > 0 ? bestHunt(S) : null; if (h && h.m >= 0.1 * S.myMass) return relayNo(conn, 'hunting'); }
        if (conn.memberId > P.from) return relayNo(conn, 'partner decides'); if (now() < (conn.relayCooldown || 0)) return relayNo(conn, 'cooldown'); // one of us decides
        { const mySplittable = S.mine.filter(c => c.s >= GAME.minSplitSize).length, theirSplittable = P.cells.filter(r => r[3] >= GAME.minSplitSize).length;
          if (mySplittable > 6 || theirSplittable > 6 || S.mine.length > 10 || P.cells.length > 10) return relayNo(conn, 'pieces ' + S.mine.length + '/' + P.cells.length); } if (!relaySafeToStart(conn, S, P)) return relayNo(conn, conn.relaySafeWhy || 'not safe');
        // not while pieces are being swapped, and not touching (a split from there leaves both halves in its reach)
        if (S.plan && S.plan.eat && S.plan.eat.length) return relayNo(conn, 'swapping pieces');
        { const pb = P.cells.reduce((a, r) => (!a || r[3] > a[3] ? r : a), null), mb = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
          if (pb && Math.hypot(pb[1] - mb.x, pb[2] - mb.y) < Math.max(pb[3], mb.s)) return relayNo(conn, 'touching'); }
        const pc = memberCenter(P), pbig = memberBig(P), myBig = S.maxMine;
        // with a team plan the heading is decided (and shared): travel along it; otherwise wait until we go straight
        const straight = (S.plan && CFG.relayTravel) || (!isNaN(conn.botDir) && conn.dirHist.length >= 8 && !conn.dirHist.some(h => angDiff(h, conn.botDir) > 0.35));
        const imbalance = Math.max(S.myMass, P.mass) / Math.min(S.myMass, P.mass);
        const why = imbalance > 1.8 ? 'redistribute' : straight && Math.min(S.myMass, P.mass) >= CFG.relayTravelMinMass ? 'travel' : null;
        if (!why) return relayNo(conn, Math.min(S.myMass, P.mass) < CFG.relayTravelMinMass ? 'too small (' + Math.round(Math.min(S.myMass, P.mass)) + ')' : 'no reason (not straight)');
        const me = { id: conn.memberId, x: S.center.x, y: S.center.y, s: myBig, mass: S.myMass, dir: conn.botDir };
        const them = { id: P.from, x: pc.x, y: pc.y, s: pbig, mass: P.mass, dir: typeof P.dir === 'number' ? P.dir : conn.botDir };
        let st, ea, dir;
        if (why === 'redistribute') {
            st = me.mass >= them.mass ? me : them; ea = st === me ? them : me;
            dir = !isNaN(ea.dir) ? ea.dir : Math.atan2(ea.y - st.y, ea.x - st.x);
        } else {
            dir = S.plan && CFG.relayTravel ? S.plan.dir : conn.botDir;
            const ux = Math.cos(dir), uy = Math.sin(dir);
            st = (me.x * ux + me.y * uy) <= (them.x * ux + them.y * uy) ? me : them; ea = st === me ? them : me;
        }
        const ux = Math.cos(dir), uy = Math.sin(dir);
        if (!CFG.relayWeave && (st.x - ea.x) * ux + (st.y - ea.y) * uy > 250) return relayNo(conn, 'stepper ahead');  // the stepper must not be ahead
        if (!CFG.relayWeave && !relaySplitsFor(st.s, ea.s)) return relayNo(conn, 'sizes (no split works)');
        // the stepper's first halves must not be able to swallow the partner (a 2700/480 "redistribute" relay ate it)
        if (canEat(st.s / SQRT2, ea.s * 0.95)) return relayNo(conn, 'too lopsided');
        const side = ((ea.x - st.x) * uy - (ea.y - st.y) * ux) > 0 ? -1 : 1; // first diagonal toward the partner
        conn.relayWhy = 'started ' + why;
        if (CFG.relayWeave) {
            const A = me.mass >= them.mass ? me : them, Bm = A === me ? them : me;
            if (!eatsSixteenths(Bm.s, A.mass)) return relayNo(conn, "partner can't eat our sixteenths");
            const rx = Math.cos(dir + Math.PI / 2), ry = Math.sin(dir + Math.PI / 2);
            const sideA = ((Bm.x - A.x) * rx + (Bm.y - A.y) * ry) >= 0 ? 1 : -1;   // +1: the partner is on A's right
            conn.relayWhy = 'started ' + why;
            return { seq: (conn.relay ? conn.relay.seq : 0) + 1, active: true, dir, stepper: A.id, side, sideA, why, round: 1, started: now(), t0: Date.now(), weave: true };
        }
        return { seq: (conn.relay ? conn.relay.seq : 0) + 1, active: true, dir, stepper: st.id, side, why, round: 1, started: now() };
    }
    // ---------------------------------------------------------------- the pair (see CFG.pairMove)
    // bots pair up by member id: 1st+2nd, 3rd+4th (the captain plays alone)
    function pairOf(conn, S, force) {
        if ((!CFG.pairMove && !force) || !CFG.bot || !CFG.multibox) return null;
        const t = now();
        const bots = S.squad.filter(m => m.isBot && m.cells && m.cells.length && t - m.rx < 1500);
        const ids = [conn.memberId, ...bots.map(m => m.from)].sort();
        const j = ids.indexOf(conn.memberId) ^ 1;
        return j < ids.length ? bots.find(m => m.from === ids[j]) || null : null;
    }
    // where the runner must be for the body's split: close enough for the pieces to reach it, far enough that once it has
    // eaten them it can't reach what the body keeps (that swallowed the old body whole in the sim)
    function pairWindow(bodyS, runS) {
        let k = 1;
        while (k < 4 && !canEat(runS, bodyS / Math.pow(SQRT2, k) * 1.03)) k++;
        const keep = bodyS / Math.pow(SQRT2, k);                       // what the body is left with
        const grown = Math.sqrt(runS * runS + bodyS * bodyS * (1 - Math.pow(0.5, k)));
        const lo = grown - keep / 3 + 260, hi = GAME.splitBoost * 0.85 + runS * 0.6;
        return { k, lo, hi, mid: Math.min(hi - 40, Math.max(lo + 40, (lo + hi) / 2)), ok: lo + 60 < hi && canEat(runS, keep * 1.03 / 1) === canEat(runS, keep * 1.03) };
    }
    // ---------------------------------------------------------------- fast travel (3.40.0, the user's design, 2026-10-20)
    // "One player splits until they can no longer split, then the other eats 90% of their teammate while splitting to eat
    // them. If the teammate is so small it can't eat their smallest piece, they feed them until they can, then they eat
    // them, then they split up, then they get eaten..." Every break throws most of the team's mass forward by split
    // boost; every eat makes the pieces big enough to break again. Per bot, one role at a time (shared in msg.ft):
    //   break: split forward along the course, every other tick, until no piece can split (16 pieces / too small) -> wait
    //   wait:  keep running the course; if the partner can't eat our smallest piece, feed it (W at it) until it can;
    //          once the partner has eaten all but our main piece -> trail
    //   trail: follow the partner (off its main piece) until it has finished breaking (wait) -> eat
    //   eat:   eat the partner's pieces (all but its main), nearest first, splitting into them when our half can eat
    //          them and they're in split range; when only its main is left -> break
    // Our main (biggest) piece is never the partner's to eat and vice versa (mateGuard). Off as soon as anything that
    // could eat a piece of ours is near; both start over afterwards.
    const FT_SPLIT = () => GAME.minSplitSize;
    // FAST TRAVEL, rebuilt (the user approved, 2026-10-20 - the old turn machine spent ~1% of its time actually splitting
    // forward and the rest waiting, feeding, hovering). The bigger one (by mass, with some hysteresis) splits forward
    // along the course every ftSplitMs until it can't; the other follows right behind and eats the splitter's rear
    // pieces - only ones it can swallow (1.14x) - splitting onto them when they're in range. The eater grows, becomes
    // the bigger one and starts splitting: roles swap by themselves. No W-feeding, hovering or balancing. A stranger that
    // could eat one of our (or the partner's) pieces within its reach: both stop (the partner sees our ft go) and the
    // normal escape takes over.
    function stepLeapfrog(conn, S) {
        if (!CFG.fastTravel || !CFG.bot || !CFG.multibox) { conn.ft = null; return false; }
        if (S.virusFarm || conn.virusFarming || nearMine(S)) { conn.ft = null; return false; }
        if (S.captain && S.captain.order && S.captain.order.mode !== 'free') { conn.ft = null; return false; }
        const P = pairOf(conn, S, true);
        if (!P || !S.mine.length) { conn.ft = null; return false; }
        const t = now();
        if (t < (conn.ftOffUntil || 0)) return false;
        // the partner stopped: stop too
        if (conn.ft && t - conn.ft.since > 1200 && !P.ft) { conn.ft = null; conn.ftOffUntil = t + 1500; hud.flash('fast travel: ' + (P.name || 'partner') + ' stopped - stopping too'); return false; }
        const live = r => { const c = conn.cells.get(r[0]); return c ? { id: c.id, x: c.x, y: c.y, s: c.s, vx: c.vx, vy: c.vy, vt: c.vt } : { id: r[0], x: r[1], y: r[2], s: r[3], vx: 0, vy: 0, vt: -1e9 }; };
        const theirs = P.cells.map(live), mine = S.mine;
        if (!theirs.length) { conn.ft = null; return false; }
        const cM = centroid(mine), cP = centroid(theirs);
        if (Math.hypot(cM.x - cP.x, cM.y - cP.y) > CFG.ftMaxApart * 1.6) { conn.ft = null; return false; }
        const all = mine.concat(theirs);
        // a stranger that can eat any of our pieces, within its reach (split reach + a margin): stop, escape
        const danger = S.enemies.find(e => e.player && !e.remote && !isAlly(e) && !conn.mateKeys.has(e.key) &&
            all.some(q => canEat(e.s, q.s) && Math.hypot(e.x - q.x, e.y - q.y) - e.s < Math.max(CFG.lfDangerGap, enemySplitReach(e, q.s, S.ownerCount.get(e.key) || 1) + 300)));
        if (danger) { if (conn.ft) hud.flash('fast travel: stopping - ' + (danger.name || 'someone') + ' could eat our pieces'); conn.ft = null; conn.ftOffUntil = t + 2500; return false; }
        const myMass = S.myMass, theirMass = theirs.reduce((a, c) => a + mass(c.s), 0);
        const ft = conn.ft || (conn.ft = { active: true, idx: 0, plan: [], turn: 0, since: t, role: null });
        ft.active = true;
        // roles: the bigger splits; switch only when the other is clearly bigger (hysteresis), ties by id
        // agreed: if the partner says it's splitting and we're not clearly bigger, we eat (both splitting at once = both in
        // bits with nobody eating - sim); a clear size difference decides; otherwise keep our role / lower id splits
        const pRole = P.ft && P.ft.role;
        let iBigger;
        // swap only once the tail is gone - both back to one piece (the user: 'they eat some and then run off and the other
        // one can't eat them' - roles flipped on mass halfway through a tail)
        const settled = mine.length === 1 && theirs.length === 1;
        if (ft.role && !settled) iBigger = ft.role === 'split';
        else if (myMass > theirMass * 1.15) iBigger = true;
        else if (theirMass > myMass * 1.15) iBigger = false;
        else if (pRole === 'split') iBigger = false;
        else if (pRole === 'eat') iBigger = true;
        else iBigger = ft.role ? ft.role === 'split' : (myMass > theirMass || (myMass === theirMass && conn.memberId < P.from));
        const role = iBigger ? 'split' : 'eat';
        if (role !== ft.role) { ft.role = role; ft.turn++; }
        const dir = ftCourse(conn, S, P), ux = Math.cos(dir), uy = Math.sin(dir);
        const aim = p => { conn.sendMouse(p.x, p.y); conn.botAim = p; };
        const myHead = mine.reduce((a, c) => (c.s > a.s ? c : a));
        const eHeadS = () => theirs.reduce((a, c) => Math.max(a, c.s), 0);
        if (role === 'split') {
            // forward, far ahead (full speed); a split every ftSplitMs while we can and the lane ahead is clear
            let ahead = { x: cM.x + ux * 1600, y: cM.y + uy * 1600 };
            // our tail runs to our mouse (small pieces are fast) - away from the eater. When it's fallen behind our rearmost
            // piece, turn back toward it so the tail comes to it (sim: the gap grew 195 -> 1400 and nothing was eaten)
            const eHead = theirs.reduce((a, c) => (c.s > a.s ? c : a));
            const myRear = mine.reduce((a, c) => (((c.x - cM.x) * ux + (c.y - cM.y) * uy) < ((a.x - cM.x) * ux + (a.y - cM.y) * uy) ? c : a));
            const lag = Math.hypot(eHead.x - myRear.x, eHead.y - myRear.y) - eHead.s - myRear.s;
            const waiting = mine.length > 2 && lag > CFG.lfWaitGap;
            if (waiting) ahead = { x: eHead.x, y: eHead.y };
            aim(ahead);
            // ONE split at a time, and only as one whole cell again (its half was eaten): splitting every piece made 16 equal
            // pieces nobody could eat (1.14x rule) - the user watched them devour each other or leave mass behind
            const canSplit = mine.length === 1 && myHead.s >= GAME.minSplitSize && canEat(eHeadS(), myHead.s / SQRT2 * CFG.eatMargin);
            const half = myHead.s / SQRT2, ex = myHead.x + ux * (GAME.splitBoost + myHead.s), ey = myHead.y + uy * (GAME.splitBoost + myHead.s);
            const lane = !S.enemies.some(e => !conn.mateKeys.has(e.key) && canEat(e.s, half * 0.98) && segDist(e.x, e.y, myHead.x, myHead.y, ex, ey) < e.s + half + 200) &&
                !theirs.some(k => canEat(half, k.s * 0.97) && segDist(k.x, k.y, myHead.x, myHead.y, ex, ey) < half + k.s * 0.5);   // our halves never eat their pieces
            if (canSplit && lane && !waiting && t - (ft.splitAt || 0) >= CFG.ftSplitMs) {
                conn.sendSplit(1); ft.splitAt = t; ft.idx++; conn.lastAction = t; conn.lockUntil = t + 150; conn.lockTargetId = 0; conn.lockAim = ahead;
            }
            // ('feeding' in the mode: our own victim guard lets the eater have our tail - without it the tail dodged the eater
            // (the user, arena viewer). squadFeeding stays off, so the eater's guard still keeps it off our head)
            conn.mode = waiting ? 'fast travel: bringing our tail back, feeding it to ' + (P.name || 'partner') : 'fast travel: splitting forward, feeding our tail to ' + (P.name || 'partner');     // ('feed' in meansToFeed: let them eat our tail)
            return true;
        }
        // the eater: the splitter's rear pieces our head can swallow - never its biggest (its head), never through its
        // pieces that could eat us
        const theirHead = theirs.reduce((a, c) => (c.s > a.s ? c : a));
        const along = c => (c.x - cP.x) * ux + (c.y - cP.y) * uy;
        const risky = theirs.filter(k => canEat(k.s, myHead.s * 0.97));
        const food = theirs.filter(c => c.id !== theirHead.id && canEat(myHead.s, c.s * CFG.eatMargin) &&
            risky.every(d => d === c || segDist(d.x, d.y, myHead.x, myHead.y, c.x, c.y) > d.s + myHead.s * 0.5 + 40));
        if (!food.length) {
            // nothing we can swallow: stay right behind them, on course (their pieces will come back to us as they move)
            // just behind their rearmost piece (the old aim measured from their centre and then went 900 forward: straight into
            // their bigger pieces - every follower death in the sim)
            const rear = theirs.reduce((a, c) => (along(c) < along(a) ? c : a));
            const back = rear.s + myHead.s + CFG.ftClear;
            aim({ x: rear.x - ux * back, y: rear.y - uy * back });
            conn.mode = 'fast travel: following ' + (P.name || 'partner');
            return true;
        }
        // rearmost first (they're left behind), then nearest
        const tg = food.reduce((a, c) => (along(c) - Math.hypot(c.x - myHead.x, c.y - myHead.y) * 0.3 < along(a) - Math.hypot(a.x - myHead.x, a.y - myHead.y) * 0.3 ? c : a));
        const p = predict(tg, S.L + 2, S.tick);
        aim(p);
        const gap = Math.hypot(p.x - myHead.x, p.y - myHead.y) - myHead.s;
        const hh = myHead.s / SQRT2;
        const splitLane = !theirs.some(k => k !== tg && canEat(k.s, hh * 0.97) && segDist(k.x, k.y, myHead.x, myHead.y, p.x, p.y) < k.s + hh * 0.5) &&
            !S.enemies.some(e => !conn.mateKeys.has(e.key) && canEat(e.s, hh * 0.97) && segDist(e.x, e.y, myHead.x, myHead.y, p.x, p.y) < e.s + hh + 150);
        if (gap > 150 && gap < GAME.splitBoost * 0.75 && myHead.s >= GAME.minSplitSize && canEat(hh, tg.s * CFG.eatMargin) && mine.length < CFG.maxCells &&
            splitLane && t - (ft.splitAt || 0) >= CFG.ftSplitMs) {
            conn.sendSplit(1); ft.splitAt = t; conn.lastAction = t; conn.lockUntil = t + 200; conn.lockTargetId = tg.id; conn.lockAim = p;
        }
        conn.mode = 'fast travel: eating ' + (P.name || 'partner') + "'s tail";
        return true;
    }
    // FEED-POWERED FAST TRAVEL (2026-10-20). Splitting moves mass forward fast (each split launches pieces ~780 ahead, and
    // small pieces move ~1.8x faster), but split halves can't be handed back and forth (the 1.14x eat rule). Shooting
    // can: W is lossless (16 out, 16 in), there's no size rule for eating it, and EVERY piece shoots at once - a bot in
    // 16 pieces moves ~3000 mass a second into its partner. So: the runner splits forward into pieces, then shoots
    // everything from all pieces into the catcher (a whole cell, a little ahead on the course); the catcher is then the
    // big one and runs next. The runner's leftover small pieces (<100 mass can't shoot) follow and merge on their own.
    function stepFeedTravel(conn, S) {
        if (!CFG.fastTravel || !CFG.bot || !CFG.multibox) { conn.ft = null; return false; }
        if (S.virusFarm || conn.virusFarming || nearMine(S)) { conn.ft = null; return false; }
        if (S.captain && S.captain.order && S.captain.order.mode !== 'free') { conn.ft = null; return false; }
        const P = pairOf(conn, S, true);
        if (!P || !S.mine.length) { conn.ft = null; return false; }
        const t = now();
        if (t < (conn.ftOffUntil || 0)) return false;
        if (conn.ft && t - conn.ft.since > 1500 && !P.ft) { conn.ft = null; conn.ftOffUntil = t + 1500; hud.flash('fast travel: ' + (P.name || 'partner') + ' stopped - stopping too'); return false; }
        const live = r => { const c = conn.cells.get(r[0]); return c ? { id: c.id, x: c.x, y: c.y, s: c.s, vx: c.vx, vy: c.vy, vt: c.vt } : { id: r[0], x: r[1], y: r[2], s: r[3], vx: 0, vy: 0, vt: -1e9 }; };
        const theirs = P.cells.map(live), mine = S.mine;
        if (!theirs.length) { conn.ft = null; return false; }
        const cM = centroid(mine), cP = centroid(theirs);
        if (Math.hypot(cM.x - cP.x, cM.y - cP.y) > CFG.ftMaxApart * 1.6) { conn.ft = null; return false; }
        const all = mine.concat(theirs);
        const danger = S.enemies.find(e => e.player && !e.remote && !isAlly(e) && !conn.mateKeys.has(e.key) &&
            all.some(q => canEat(e.s, q.s) && Math.hypot(e.x - q.x, e.y - q.y) - e.s < Math.max(CFG.lfDangerGap, enemySplitReach(e, q.s, S.ownerCount.get(e.key) || 1) + 300)));
        if (danger) { if (conn.ft) hud.flash('fast travel: stopping - ' + (danger.name || 'someone') + ' could eat our pieces'); conn.ft = null; conn.ftOffUntil = t + 2500; return false; }
        const myMass = S.myMass, theirMass = theirs.reduce((a, c) => a + mass(c.s), 0);
        if (myMass + theirMass < CFG.ftMinTeamMass) { conn.ft = null; return false; }
        const ft = conn.ft || (conn.ft = { active: true, idx: 0, plan: [], turn: 0, since: t, role: null, phase: 'split', phaseAt: t });
        ft.active = true;
        const myBig = mine.reduce((a, c) => (c.s > a.s ? c : a)), pBig = theirs.reduce((a, c) => (c.s > a.s ? c : a));
        // roles: the runner is whoever holds the bigger single cell; we keep our role until our run is done (runner) or the
        // partner says it's running (catcher). The partner's role decides when we disagree; ties: lower id runs.
        const pRole = P.ft && P.ft.role;
        if (!ft.role) ft.role = pRole === 'run' ? 'catch' : pRole === 'catch' ? 'run' : (myBig.s > pBig.s * 1.02 || (Math.abs(myBig.s - pBig.s) <= pBig.s * 0.02 && conn.memberId < P.from)) ? 'run' : 'catch';
        if (ft.role === 'catch' && pRole !== 'run' && pRole !== null && myBig.s > pBig.s * 1.3) { ft.role = 'run'; ft.phase = 'split'; ft.phaseAt = t; ft.turn++; }
        if (ft.role === 'run' && pRole === 'run' && (myBig.s < pBig.s || (myBig.s === pBig.s && conn.memberId > P.from))) { ft.role = 'catch'; }
        const dir = ftCourse(conn, S, P), ux = Math.cos(dir), uy = Math.sin(dir);
        const aim = p => { conn.sendMouse(p.x, p.y); conn.botAim = p; };
        if (ft.role === 'catch') {
            // BEHIND the runner on the course: its splits fly away from us, its shots come back to us (880 reach). Ahead, its
            // split pieces landed on us and were eaten (sim)
            const rear = theirs.reduce((a, c) => (((c.x - cP.x) * ux + (c.y - cP.y) * uy) < ((a.x - cP.x) * ux + (a.y - cP.y) * uy) ? c : a));
            const back = rear.s + myBig.s + CFG.ffCatchBehind;
            aim({ x: rear.x - ux * back, y: rear.y - uy * back });
            conn.mode = 'fast travel: catching ' + (P.name || 'partner') + "'s feed";
            return true;
        }
        // ---- runner
        if (ft.phase === 'split') {
            const target = { x: cM.x + ux * 1600, y: cM.y + uy * 1600 };
            aim(target);
            const canSplit = mine.length < CFG.ffPieces && myBig.s >= GAME.minSplitSize;
            const half = myBig.s / SQRT2, ex = myBig.x + ux * (GAME.splitBoost + myBig.s), ey = myBig.y + uy * (GAME.splitBoost + myBig.s);
            const lane = !theirs.some(k => canEat(k.s, half * 0.97) && segDist(k.x, k.y, myBig.x, myBig.y, ex, ey) < k.s + half * 0.6);
            if (canSplit && lane && t - (ft.splitAt || 0) >= CFG.ffSplitMs) { conn.sendSplit(1); ft.splitAt = t; conn.lastAction = t; conn.lockUntil = t + 100; conn.lockTargetId = 0; conn.lockAim = target; }
            if (!canSplit || t - ft.phaseAt > 1500) { ft.phase = 'feed'; ft.phaseAt = t; }
            conn.mode = 'fast travel: splitting forward (' + mine.length + ' pieces)';
            return true;
        }
        // feed: every piece shoots into the catcher's biggest cell
        const tgt = predict(conn.cells.get(pBig.id) || pBig, S.L + 3, S.tick);
        aim(tgt);
        const shooters = mine.filter(c => c.s >= GAME.minEjectSize);
        if (shooters.length) conn.sendEject();
        if (!shooters.length || t - ft.phaseAt > CFG.ffFeedMs) {
            // done: now the partner is the big one - it runs next, we catch
            ft.role = 'catch'; ft.phase = 'split'; ft.phaseAt = t; ft.turn++;
        }
        // (no 'feed' in the mode: our own guard keeps our pieces off the catcher while we shoot - with it off, they walked in)
        conn.mode = 'fast travel: shooting everything into ' + (P.name || 'partner') + ' (' + shooters.length + ' pieces)';
        return true;
    }
    // THE RELAY CANNON (2026-10-20, from live measurements: W blobs are 10 mass, lossless, fly ~840, one press per tick,
    // EVERY piece shoots - a bot in 16 pieces moves 4000 mass/s). Any number of bots. The LOADED bot (biggest single cell)
    // splits forward 4x toward a point ~1200 ahead (the pieces bunch there instead of stringing out 3000 wide), the
    // RECEIVER (any teammate, whole) steps in just beyond the front piece, every piece shoots everything into it, then
    // the <100-mass leftovers dive in (all but ffKeep - the bot stays alive, tiny and fast). The receiver is now one
    // whole loaded cell and goes next. No merge timers, no 1.14x problem (W mass has no size rule), scales to N.
    function stepRelayCannon(conn, S) {
        if (!CFG.fastTravel || !CFG.bot || !CFG.multibox) { conn.ft = null; return false; }
        if (S.virusFarm || conn.virusFarming || nearMine(S)) { conn.ft = null; return false; }
        if (S.captain && S.captain.order && S.captain.order.mode !== 'free') { conn.ft = null; return false; }
        const t = now();
        if (t < (conn.ftOffUntil || 0) || !S.mine.length) { if (!S.mine.length) conn.ft = null; return false; }
        const live = r => { const c = conn.cells.get(r[0]); return c ? { id: c.id, x: c.x, y: c.y, s: c.s, vx: c.vx, vy: c.vy, vt: c.vt } : { id: r[0], x: r[1], y: r[2], s: r[3], vx: 0, vy: 0, vt: -1e9 }; };
        const big = cs => cs.reduce((a, c) => (c.s > a.s ? c : a));
        const mine = S.mine, myBig = big(mine), cM = centroid(mine);
        const mates = S.squad.filter(m => m.isBot && m.cells && m.cells.length && t - m.rx < 1500 &&
            Math.hypot(memberCenter(m).x - cM.x, memberCenter(m).y - cM.y) < CFG.ftMaxApart * 2);
        if (!mates.length) { conn.ft = null; return false; }
        const all = mine.concat(mates.flatMap(m => m.cells.map(live)));
        // a stranger that can eat any of our pieces within its reach: everyone stops, normal play escapes
        const danger = S.enemies.find(e => e.player && !e.remote && !isAlly(e) && !conn.mateKeys.has(e.key) &&
            all.some(q => canEat(e.s, q.s) && Math.hypot(e.x - q.x, e.y - q.y) - e.s < Math.max(CFG.lfDangerGap, enemySplitReach(e, q.s, S.ownerCount.get(e.key) || 1) + 300)));
        if (danger) { if (conn.ft) hud.flash('fast travel: stopping - ' + (danger.name || 'someone') + ' could eat our pieces'); conn.ft = null; conn.ftOffUntil = t + 2500; return false; }
        const team = S.myMass + mates.reduce((a, m) => a + (m.mass || 0), 0);
        if (team < CFG.ftMinTeamMass) { conn.ft = null; return false; }
        // nobody big enough to be worth loading (pieces must be able to shoot most of themselves): walk together instead
        if (cand => false) {}
        const ft = conn.ft || (conn.ft = { active: true, idx: 0, plan: [], turn: 0, since: t, role: null, phase: null, phaseAt: t, recv: 0 });
        ft.active = true;
        // who is loaded: the biggest single cell in the team; one that says it's loaded keeps it through its cycle
        const cand = [{ from: conn.memberId, big: myBig.s, ft: conn.ft, me: true }, ...mates.map(m => ({ from: m.from, big: m.cells.reduce((a, r) => Math.max(a, r[3]), 0), ft: m.ft, m }))];
        // (a bot that just unloaded isn't loaded again for a while unless it's whole - its leftovers aren't a load)
        const eligible = cand.filter(c => !(c.ft && c.ft.phase === 'done' && Date.now() - (c.ft.doneAt || 0) < 5000 && (c.me ? mine.length : c.m.cells.length) > 1));
        let loaded = (eligible.length ? eligible : cand).reduce((a, c) => (c.big > a.big || (c.big === a.big && c.from < a.from) ? c : a));
        const loadedMass = loaded.me ? S.myMass : (loaded.m.mass || 0);
        if (loadedMass < CFG.ffMinLoad && !(loaded.ft && loaded.ft.role === 'loaded' && loaded.ft.phase !== 'done')) { conn.ft = null; return false; }
        // a bot mid-cycle stays loaded whatever its pieces look like (its big cell vanishes the moment it splits); if two
        // claim it, the earlier cycle wins
        const claims = cand.filter(c => c.ft && c.ft.role === 'loaded' && (c.ft.phase === 'split' || c.ft.phase === 'shoot' || c.ft.phase === 'dump'));
        if (claims.length) loaded = claims.reduce((a, c) => (((c.ft.cycleAt || 0) < (a.ft.cycleAt || 0) || ((c.ft.cycleAt || 0) === (a.ft.cycleAt || 0) && c.from < a.from)) ? c : a));
        const iLoaded = !!loaded.me;
        // ONE course for the whole convoy, held by the lowest id (a new loaded bot picking its own each cycle zigzagged)
        const minMate = mates.reduce((a, m) => (!a || m.from < a.from ? m : a), null);
        const dir = ftCourse(conn, S, conn.memberId < minMate.from ? { from: Infinity, ft: null } : { from: -Infinity, ft: minMate.ft || null });
        const ux = Math.cos(dir), uy = Math.sin(dir), px = -uy, py = ux;
        const aim = p => { conn.sendMouse(p.x, p.y); conn.botAim = p; };
        // a runner's / receiver's way to its spot must not pass through a teammate cell that could eat it - or could in a
        // moment (the receiver grows as it eats: a teammate 3% too small to eat a runner ate it the next tick). Step aside.
        const safeAim = p => {
            const others = mates.flatMap(m => m.cells.map(live));
            for (const k of others) {
                if (!canEat(k.s * 1.3, myBig.s)) continue;
                const r = k.s + myBig.s + 300;
                if (segDist(k.x, k.y, cM.x, cM.y, p.x, p.y) >= r) continue;
                const dx = p.x - cM.x, dy = p.y - cM.y, dl = Math.hypot(dx, dy) || 1;
                const sgn = ((k.x - cM.x) * -dy + (k.y - cM.y) * dx) >= 0 ? -1 : 1;     // step to the side away from it
                return { x: cM.x + dx / dl * 500 + (-dy / dl) * sgn * 700, y: cM.y + dy / dl * 500 + (dx / dl) * sgn * 700 };
            }
            return p;
        };
        const along = (c, o) => (c.x - o.x) * ux + (c.y - o.y) * uy;
        const side0 = ((cM.x - (mates[0] ? memberCenter(mates[0]).x : cM.x)) * px + (cM.y - (mates[0] ? memberCenter(mates[0]).y : cM.y)) * py) >= 0 ? 1 : -1;
        if (iLoaded) {
            if (ft.role !== 'loaded') { ft.role = 'loaded'; ft.phase = 'split'; ft.phaseAt = t; ft.cycleAt = Date.now(); ft.turn++; ft.recv = 0; ft.goal = null; }
            // the receiver: the teammate nearest the spot ahead (kept for the whole cycle)
            if (!ft.recv || !mates.find(m => m.from === ft.recv)) {
                // the receiver: one that can eat our pieces as they'll be (whole and big enough) beats one that needs topping
                // up; then the one furthest ahead on the course, nearest to us
                const pieceS = Math.sqrt(S.myMass / Math.min(CFG.ffPieces, Math.max(1, Math.pow(2, Math.floor(Math.log2(S.myMass / CFG.ffPieceMin))))) * 100);
                ft.recv = mates.map(m => { const c = memberCenter(m), bigS = m.cells.reduce((a2, r) => Math.max(a2, r[3]), 0);
                    return { from: m.from, score: (along(c, cM) > 150 ? 1000000 : 0) + (canEat(bigS, pieceS * 1.05) ? 100000 : 0) + (m.cells.length === 1 ? 20000 : 0) + Math.min(1500, along(c, cM)) - Math.hypot(c.x - cM.x, c.y - cM.y) * 0.5 }; })
                    .reduce((a, m) => (!a || m.score > a.score ? m : a), null).from;
            }
            const R = mates.find(m => m.from === ft.recv), rc = R.cells.map(live), rBig = big(rc);
            if (ft.phase === 'split') {
                // not before the receiver is in front of us (it's small and fast): splitting with it behind sent the mass backwards
                const rCen = centroid(rc), rAlong = along(rCen, cM), rDist = Math.hypot(rCen.x - cM.x, rCen.y - cM.y);
                const rEats = canEat(rBig.s, myBig.s / SQRT2 * 1.05);
                if (!rEats && !(rAlong > 150 && rDist < 1800) && t - ft.phaseAt < 1200) {
                    ft.waitedUntil = t;
                    aim({ x: cM.x + ux * 25, y: cM.y + uy * 25 });        // a small receiver must get beside the lane first (it's fast)
                    conn.mode = 'fast travel: waiting for ' + (R.name || 'teammate') + ' to get in front';
                    return true;
                }
                if (ft.waitedUntil) { ft.phaseAt = t; ft.waitedUntil = 0; }      // the split budget starts once the wait is over
                if (!ft.goal) ft.goal = { x: cM.x + ux * CFG.ffSplitAim, y: cM.y + uy * CFG.ffSplitAim };
                aim(ft.goal);
                // as many pieces as still leave each one ffPieceMin mass (a 1500 bot in 16 pieces of 94 can't shoot at all)
                const want = Math.min(CFG.ffPieces, Math.pow(2, Math.max(0, Math.floor(Math.log2(S.myMass / CFG.ffPieceMin)))));
                const canSplit = mine.length < want && myBig.s >= GAME.minSplitSize;
                // every piece splits toward the goal: none of their halves may fly into a teammate cell they could eat
                const lane = !mine.some(c => c.s >= GAME.minSplitSize && all.some(k => !mine.includes(k) && canEat(c.s / SQRT2, k.s * 0.97) && segDist(k.x, k.y, c.x, c.y, ft.goal.x, ft.goal.y) < k.s + c.s / SQRT2 * 0.7));   // (a receiver that eats our halves is never 'in the way': canEat fails for it)
                if (!lane) ft.blockedMs = (ft.blockedMs || 0) + 40;
                if (canSplit && lane && t - (ft.splitAt || 0) >= CFG.ffSplitMs) { conn.sendSplit(1); ft.splitAt = t; conn.lastAction = t; conn.lockUntil = t + 80; conn.lockTargetId = 0; conn.lockAim = ft.goal; }
                if (!canSplit || t - ft.phaseAt > 1500 + Math.min(3000, ft.blockedMs || 0)) { ft.phase = 'shoot'; ft.phaseAt = t; ft.blockedMs = 0; }
                conn.mode = 'fast travel: splitting forward (' + mine.length + ' pieces)';
                return true;
            }
            if (ft.phase === 'shoot') {
                const shooters = mine.filter(c => c.s >= GAME.minEjectSize);
                const rLive = conn.cells.get(rBig.id) || rBig, tgt = predict(rLive, S.L + 2, S.tick);
                const myMax = mine.reduce((a, c) => Math.max(a, c.s), 0);
                if (canEat(rLive.s, myMax * 1.03)) aim(tgt);       // it can take our pieces: straight at it (touching = transfer too)
                else {
                    // it can't yet: our mouse 400 ahead of our cloud toward it - the pieces bunch and walk, never reach it;
                    // the shots carry on 840 past the mouse into the receiver standing 700 ahead
                    const dx = tgt.x - cM.x, dy = tgt.y - cM.y, dl = Math.hypot(dx, dy) || 1;
                    aim({ x: cM.x + dx / dl * 300, y: cM.y + dy / dl * 300 });
                }
                // fire when any piece is in range (blobs from the far ones fall short in the lane and get picked up again)
                if (shooters.some(c => Math.hypot(c.x - tgt.x, c.y - tgt.y) - rBig.s < CFG.ffShootRange)) conn.sendEject();
                // shooting is only the top-up: as soon as the receiver can eat our pieces it eats them by touch (the dump) -
                // that way the kept piece is a big one (~1/16 of us), big enough to be the next receiver
                if (!shooters.length || canEat(rLive.s, myMax * 1.03) || t - ft.phaseAt > CFG.ffFeedMs) { ft.phase = 'dump'; ft.phaseAt = t; }
                conn.mode = 'fast travel: shooting ' + shooters.length + ' pieces into ' + (R.name || 'teammate');
                return true;
            }
            if (ft.phase === 'dump') {
                // the leftovers (< 100 mass each, can't shoot) bunch at a fixed point and hold still; the receiver walks into
                // the ball and eats it from its side. We declare one piece as kept (pair.keep): the receiver's guard steers it
                // off that one. And when only the kept ones are left, they run (they're far faster than the receiver).
                const tgt = conn.cells.get(rBig.id) || rBig;
                { const bx = cM.x - tgt.x, by = cM.y - tgt.y, bl = Math.hypot(bx, by) || 1; ft.ball = { x: tgt.x + bx / bl * (tgt.s + 380), y: tgt.y + by / bl * (tgt.s + 380) }; }
                if (!ft.keepId) { const K = mine.reduce((a2, c) => (Math.hypot(c.x - tgt.x, c.y - tgt.y) > Math.hypot(a2.x - tgt.x, a2.y - tgt.y) ? c : a2)); ft.keepId = K.id; }
                if (!mine.find(c => c.id === ft.keepId)) ft.keepId = mine.reduce((a2, c) => (Math.hypot(c.x - tgt.x, c.y - tgt.y) > Math.hypot(a2.x - tgt.x, a2.y - tgt.y) ? c : a2)).id;
                if (mine.length <= CFG.ffKeep + 2 || t - ft.phaseAt > 6000) {     // (+2: the server is a couple of ticks ahead of what we see)
                    ft.role = 'runner'; ft.phase = 'done'; ft.phaseAt = t; ft.doneAt = Date.now(); ft.ball = null; ft.keepId = 0; conn.pair = null;
                    const sx = cM.x - tgt.x, sy = cM.y - tgt.y, sl = Math.hypot(sx, sy) || 1;
                    aim({ x: cM.x + sx / sl * 800, y: cM.y + sy / sl * 800 });
                    conn.mode = 'fast travel: kept ' + mine.length + ' piece(s), running';
                    return true;
                }
                if (!canEat(tgt.s, mine.reduce((a2, c) => Math.max(a2, c.s), 0) * 1.03)) {
                    // it can't eat our pieces (yet): top it up with shots from here (the ball holds, the mouse points at it)
                    const rp = predict(tgt, S.L + 2, S.tick);
                    aim(rp);
                    if (mine.some(c => c.s >= GAME.minEjectSize && Math.hypot(c.x - rp.x, c.y - rp.y) - tgt.s < CFG.ffShootRange)) conn.sendEject();
                    conn.mode = 'fast travel: topping up ' + (R.name || 'teammate') + ' so it can eat our pieces';
                    return true;
                }
                conn.pair = { role: 'giver', with: R.from, keep: ft.keepId };
                aim(ft.ball);
                conn.mode = 'fast travel: ' + (mine.length - 1) + ' leftover pieces for ' + (R.name || 'teammate') + ' to eat';
                return true;
            }
        }
        if (conn.pair && conn.pair.role === 'giver' && conn.pair.keep) conn.pair = null;
        // ---- not loaded (or just unloaded): receiver, or a runner ahead; leftover pieces still dive into the loaded one
        const L = loaded.m, lc = L.cells.map(live), lBig = big(lc), lCen = centroid(lc);
        const lFront = lc.reduce((a, c) => (along(c, lCen) > along(a, lCen) ? c : a));
        const lPhase = (L.ft && L.ft.phase) || '';
        const iRecv = L.ft && L.ft.recv === conn.memberId;
        if (ft.role === 'loaded') ft.role = 'runner';
        // which side of the lane are we on (stay there - no crossing through the pieces)
        const side = ((cM.x - lCen.x) * px + (cM.y - lCen.y) * py) >= 0 ? 1 : -1;
        // (no generic 'leftovers dive in' here: the dump phase is the only diving - this branch ate the kept pieces too)
        if (iRecv) {
            let spot;
            if (lPhase === 'shoot') {
                // beyond the front piece: close once we're big enough that no piece can eat us, else out of their reach (the
                // blobs fly 840 - we still get the front pieces' shots and grow into range)
                // big enough that no piece can eat us: just ahead of the cloud's centre (every piece within 840, the ones that
                // walk into us are eaten - that's transfer too); else beyond the front piece, out of their reach
                const lMax = lc.reduce((a, c) => Math.max(a, c.s), 0);
                if (canEat(myBig.s, lMax * 1.03)) spot = { x: lCen.x + ux * 600, y: lCen.y + uy * 600 };
                else { const off = canEat(lMax, myBig.s) ? 900 : 550; spot = { x: lCen.x + px * side * off + ux * 300, y: lCen.y + py * side * off + uy * 300 }; }   // too small to be among them: beside the cloud; the near pieces' shots reach us
            } else if (lPhase === 'dump') spot = { x: lCen.x, y: lCen.y };                                   // walk into the ball and eat it (the guard spares its kept piece)
            else {
                // while it splits: the point its pieces fly to (shared). Big enough to eat its halves: stand right there - the
                // halves fly into us (that IS the transfer). Too small: beside that point, out of their way.
                const g = L.ft && L.ft.goal ? { x: L.ft.goal[0], y: L.ft.goal[1] } : { x: lFront.x + ux * 450, y: lFront.y + uy * 450 };
                const eatsHalves = canEat(myBig.s, lBig.s / SQRT2 * 1.05);
                spot = eatsHalves ? g : { x: g.x + px * side * CFG.ffSideOff, y: g.y + py * side * CFG.ffSideOff };
            }
            aim(lPhase === 'dump' ? spot : safeAim(spot));
            conn.mode = 'fast travel: receiving from ' + (L.name || 'teammate');
            return true;
        }
        aim(safeAim({ x: lCen.x + ux * CFG.ffRunAhead + px * side * 800, y: lCen.y + uy * CFG.ffRunAhead + py * side * 800 }));
        conn.mode = 'fast travel: running ahead of ' + (L.name || 'teammate');
        return true;
    }
    function ftCourse(conn, S, P) {
        // the pair's course: the lower id holds a destination ~ftCourseDist ahead (picked from its own steering, i.e.
        // food / away from danger) for ftCourseMs, re-picked early near a wall; the heading turns slowly toward it.
        // The other reads it from msg.ft.dir. (Re-picking every tick swung the course 150 deg in a few seconds.)
        const lead = conn.memberId < P.from;
        if (!lead && P.ft && isFinite(P.ft.dir)) return P.ft.dir;
        const c = S.center, t = now(), B = S.border;
        const nearWall = g => B && (g.x < B.minX + 1500 || g.x > B.maxX - 1500 || g.y < B.minY + 1500 || g.y > B.maxY - 1500);
        const goal = conn.ftGoal;
        if (!goal || t - goal.at > CFG.ftCourseMs || Math.hypot(goal.x - c.x, goal.y - c.y) < 1200 || nearWall({ x: c.x + Math.cos(conn.ftDir || 0) * 1500, y: c.y + Math.sin(conn.ftDir || 0) * 1500 })) {
            const mv = steer(conn, S);
            let a = Math.atan2(mv.aim.y - c.y, mv.aim.x - c.x); if (!isFinite(a)) a = conn.ftDir ?? 0;
            let g = { x: c.x + Math.cos(a) * CFG.ftCourseDist, y: c.y + Math.sin(a) * CFG.ftCourseDist };
            if (B) { g.x = Math.max(B.minX + 2000, Math.min(B.maxX - 2000, g.x)); g.y = Math.max(B.minY + 2000, Math.min(B.maxY - 2000, g.y)); }
            conn.ftGoal = { ...g, at: t };
        }
        const want = Math.atan2(conn.ftGoal.y - c.y, conn.ftGoal.x - c.x);
        if (conn.ftDir === undefined || !isFinite(conn.ftDir)) conn.ftDir = want;
        let dd = want - conn.ftDir; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
        conn.ftDir += Math.max(-0.015, Math.min(0.015, dd));        // ~20 deg a second at most
        return conn.ftDir;
    }
    // the hunt: lower id picks (and keeps) the target, shared in msg.ft.hunt. Far: fast travel heads for it. Close: the
    // one further from it pours itself into the one nearer (split everything in, keeping one cell), then that one
    // splits onto it. Afterwards the normal fast-travel turns (eat / feed) even the mass out again.
    function ftHunt(conn, S, P, mine, theirs, myMass, theirMass) {
        if (!CFG.ftHunt) return null;
        const team = myMass + theirMass, t = now();
        const pf = P.ft || {};
        const edible = e => e.player && !e.remote && !isAlly(e) && !e.feeding && mass(e.s) >= Math.max(CFG.ftHuntMin, team * 0.04) &&
            team >= mass(e.s) * CFG.ftHuntRatio &&
            !S.enemies.some(o => o !== e && o.player && o.key !== e.key && canEat(o.s, Math.sqrt(team * 100) * 0.6) && Math.hypot(o.x - e.x, o.y - e.y) < o.s + 1500);
        const cM = centroid(mine), cP = centroid(theirs), mid = { x: (cM.x + cP.x) / 2, y: (cM.y + cP.y) / 2 };
        let T = null;
        if (conn.memberId < P.from) {
            T = conn.ftHuntT && S.enemies.find(e => e.id === conn.ftHuntT && edible(e));
            if (!T) { let bd = Infinity; for (const e of S.enemies) if (edible(e)) { const d = Math.hypot(e.x - mid.x, e.y - mid.y) - e.s; if (d < CFG.ftHuntRange && d < bd) { bd = d; T = e; } } }
        } else if (P.ftHunt) T = S.enemies.find(e => e.id === P.ftHunt && edible(e));
        conn.ftHuntT = T ? T.id : 0;
        if (!T) return null;
        const big = cs => cs.reduce((x, c) => (c.s > x.s ? c : x));
        const myBig = big(mine), pBig = big(theirs);
        const dMe = Math.hypot(T.x - myBig.x, T.y - myBig.y) - T.s, dP = Math.hypot(T.x - pBig.x, T.y - pBig.y) - T.s;
        const striker = dMe < dP || (Math.abs(dMe - dP) < 50 && conn.memberId < P.from);
        if (Math.min(dMe, dP) > CFG.ftHuntPourAt) return { T };             // still far: fast travel toward it
        // close: pour + strike
        const say = m => { conn.mode = 'hunt: ' + m + ' ' + (T.name || 'a player'); };
        return { T, step: () => {
            if (striker) {
                const p = predict(T, S.L + 4, S.tick);
                const canKill = canEat(myBig.s / SQRT2, T.s * CFG.eatMargin) && myBig.s >= GAME.minSplitSize && mine.length < CFG.maxCells;
                const inRange = dMe < GAME.splitDistance + GAME.splitBoost * 0.85;
                if (canKill && inRange && t - (conn.ftHuntSplit || 0) > 400) {
                    conn.sendMouse(p.x, p.y); conn.botAim = p; conn.sendSplit(1); conn.ftHuntSplit = t;
                    conn.lastAction = t; conn.lockUntil = t + 250; conn.lockTargetId = T.id; conn.lockAim = p;
                    say('splitting onto');
                    return true;
                }
                // not big enough yet (being poured into) or not in range: go at it
                conn.sendMouse(p.x, p.y); conn.botAim = p;
                say(canEat(myBig.s / SQRT2, T.s * CFG.eatMargin) ? 'closing on' : 'being poured into, then');
                return true;
            }
            // the giver: everything into the striker's big piece, from within split range of it, keeping one cell
            const k = pumpSplits(myBig.s, pBig.s);
            const gap = Math.hypot(pBig.x - myBig.x, pBig.y - myBig.y) - pBig.s - myBig.s;
            const pp = predict(pBig, S.L + 4, S.tick);
            conn.sendMouse(pp.x, pp.y); conn.botAim = pp;
            const poured = conn.ftPoured && t - conn.ftPoured < 1500;
            if (!poured && k >= 0 && gap < GAME.splitBoost * 0.7 && mine.length < CFG.maxCells && myBig.s >= GAME.minSplitSize) {
                const n = Math.max(1, Math.min(4, k + 2));
                conn.sendSplit(n); conn.ftPoured = t;
                conn.lastAction = t; conn.lockUntil = t + 350; conn.lockTargetId = 0; conn.lockAim = pp;
                say('pouring into ' + (P.name || 'partner') + ' to kill');
                return true;
            }
            if (k < 0 && mine.some(c => c.s >= GAME.minEjectSize) && gap < 900) feedShoot(conn, S, conn.cells.get(pBig.id) || pBig, theirs);
            say(poured ? 'poured; following' : 'getting into pouring range for');
            return true;
        } };
    }
    function stepFastTravel(conn, S) {
        // The snake (the user's design, 2026-10-20). Two teammates side by side take turns. A turn, one split every
        // ftSplitMs: [eat the partner's tail] -> curve tightly round the partner's head (either side, ending in front,
        // the way the pair is going) -> split our own tail straight into the partner's head. Our head (front piece -
        // biggest too: it eats the map's food on the way) stays in front. The next turn starts while this one is still
        // going (its first split lines up with our third). The very first turn: two free splits forward first.
        // Before starting: a partner under 1/16 of us is fed (W) until it can take our pieces; if it's far behind we
        // turn back to it. Only something bigger than the whole team is a threat: then the snake goes away from it.
        // Shared in msg.ft: { active, idx (splits done this turn), turn (number), dir }.
        if (!CFG.fastTravel || !CFG.bot || !CFG.multibox) { conn.ft = null; return false; }
        // never instead of mining (the user: once mining, keep mining) - mines scene grew less with fast travel on
        if (S.virusFarm || conn.virusFarming || nearMine(S)) { conn.ft = null; return false; }
        // the captain's (or a VIP's) order comes first: carrying / feeding / protecting, not travelling with each other
        if (S.captain && S.captain.order && S.captain.order.mode !== 'free') { conn.ft = null; return false; }
        const P = pairOf(conn, S, true);
        if (!P || !S.mine.length) { conn.ft = null; return false; }
        const t = now(), t0 = t;
        // the partner dropped out (escaping, mining, an order...): stop too, at once. Live (the user, 12 hours of it): one
        // kept dipping its pieces / hovering for a partner that had left, and was eaten
        if (conn.ft && conn.ft.since && t - conn.ft.since > 1200 && !P.ft) { hud.flash('fast travel: ' + (P.name || 'partner') + ' stopped - stopping too'); conn.ft = null; conn.ftOffUntil = t + 1500; return false; }
        if (t < (conn.ftOffUntil || 0)) return false;
        const live = r => { const c = conn.cells.get(r[0]); return c ? { id: c.id, x: c.x, y: c.y, s: c.s, vx: c.vx, vy: c.vy, vt: c.vt, player: true } : { id: r[0], x: r[1], y: r[2], s: r[3], vx: 0, vy: 0, vt: -1e9, player: true }; };
        const theirs = P.cells.map(live), mine = S.mine;
        // the other teammates (four bots = two pairs): their pieces are never ours to eat or to be eaten by - every
        // check below counts them too (fast4: the pairs ran through each other)
        const others = S.squad.filter(m => m.from !== P.from && m.cells && m.cells.length && t0 - m.rx < 1500).flatMap(m => m.cells.map(live));
        const cM = centroid(mine), cP = centroid(theirs);
        const myMass = S.myMass, theirMass = theirs.reduce((x, c) => x + mass(c.s), 0), team = myMass + theirMass;
        // a threat is only something bigger than the whole team
        const teamS = Math.sqrt(team * 100);
        let threat = S.enemies.find(e => e.player && canEat(e.s, teamS * 0.9) && Math.hypot(e.x - cM.x, e.y - cM.y) < e.s + 3000);
        const apart = Math.hypot(cM.x - cP.x, cM.y - cP.y);
        if (apart > CFG.ftMaxApart * 1.6) { conn.ft = null; return false; }    // far apart: normal play brings us together
        // the user's rule decides what we fast-travel AWAY from (bigger than the whole team). On top: anything about
        // to reach one of our main pieces (or our partner's) pauses the snake - the normal escape (dive into the
        // teammate etc.) takes over. (Escape scene: a 1700 hunter, not bigger than the team, ate Lead mid-snake.)
        {
            // mains, and our typical (median) pieces: a mid-size player that can eat those eats our split pieces one
            // by one (boost kill: the Runner grew 784 -> 1496 on our fast-travel pieces)
            const med = cs => cs.map(c => c.s).sort((p, q) => p - q)[Math.floor(cs.length / 2)];
            const all = mine.concat(theirs);
            const mains = [mine.reduce((x, c) => (c.s > x.s ? c : x)), theirs.reduce((x, c) => (c.s > x.s ? c : x))];
            const typical = Math.min(med(mine), med(theirs));
            const close = S.enemies.find(e => e.player && (
                mains.some(q => canEat(e.s, q.s) && Math.hypot(e.x - q.x, e.y - q.y) - e.s < Math.max(0, enemySplitReach(e, q.s, S.ownerCount.get(e.key) || 1)) + 400) ||
                (canEat(e.s, typical) && all.some(q => canEat(e.s, q.s) && Math.hypot(e.x - q.x, e.y - q.y) - e.s < Math.max(0, enemySplitReach(e, q.s, S.ownerCount.get(e.key) || 1)) + 250))));
            // the user: "why pause when he's close - do it more, towards the away direction": keep snaking, away from it
            // ...except a split onto one of our main pieces about to land: that's the emergency escape's job (escape
            // scene: snaking in front of a 1700 hunter already in split range lost Lead 24/24)
            const onMain = close && mains.some(q => canEat(close.s, q.s) && Math.hypot(close.x - q.x, close.y - q.y) - close.s < Math.max(0, enemySplitReach(close, q.s, S.ownerCount.get(close.key) || 1)) + 400);
            const teamSize = close && canEat(close.s, teamS * 0.9);      // could take the whole team: escape together
            if ((onMain || teamSize) && !(conn.ft && conn.ft.active && (conn.ft.plan || [])[conn.ft.idx] === 'feed')) { if (conn.ft) hud.flash('fast travel: escaping ' + (close.name || 'someone')); conn.ft = null; return false; }
            if (close && !threat && close.id !== conn.ftHuntT) threat = close;      // (not the one we're hunting)
        }
        let dir = ftCourse(conn, S, P);
        if (threat) dir = Math.atan2(cM.y - threat.y, cM.x - threat.x);      // snake away from it
        // ---------------------------------------------- hunting: a stranger the team can kill once poured into one cell
        const hunt = !threat && ftHunt(conn, S, P, mine, theirs, myMass, theirMass);
        if (hunt && hunt.step) return hunt.step();
        if (hunt) dir = Math.atan2(hunt.T.y - (cM.y + cP.y) / 2, hunt.T.x - (cM.x + cP.x) / 2);
        const ux = Math.cos(dir), uy = Math.sin(dir);
        const along = (c, o) => (c.x - o.x) * ux + (c.y - o.y) * uy;
        // the head: the biggest piece (the user: it should be both the biggest and in front - food doesn't make that
        // so on its own, and the two bots disagreeing about which piece it is fed Help into the wrong one); front on ties
        const head = cs => cs.reduce((x, c) => (c.s > x.s * 1.03 || (c.s >= x.s * 0.97 && along(c, cM) > along(x, cM)) ? c : x));
        const rear = cs => cs.reduce((x, c) => (along(c, cM) < along(x, cM) ? c : x));
        const myHead = head(mine), pHead = head(theirs), pRear = rear(theirs);
        // the partner's pieces our head may go for: ones it can eat, not their head, and never at or along a line past
        // ANY of their pieces that could eat our head (frsim: Lead walked past Help's 184s to a small piece and went)
        const safeFood = () => {
            // never eat them down: their two biggest pieces stay theirs, and nothing at all below ftKeepShare of the pair
            if (theirMass / team < CFG.ftKeepShare) return [];
            const keep = new Set(theirs.slice().sort((p, q) => q.s - p.s).slice(0, 2).map(c => c.id));
            const danger = theirs.concat(others).filter(c => canEat(c.s, myHead.s * 0.97));
            return theirs.filter(c => !keep.has(c.id) && canEat(myHead.s, c.s * CFG.eatMargin) &&
                danger.every(d => segDist(d.x, d.y, myHead.x, myHead.y, c.x, c.y) > d.s + myHead.s * 0.6 + 60 && Math.hypot(d.x - c.x, d.y - c.y) > d.s + myHead.s + 60 &&
                    // ...and not inside the keep-clear zone (the user, arena viewer: "go to eat a tail, get close, pull away, 5-6 times")
                    Math.hypot(d.x - c.x, d.y - c.y) - d.s > CFG.ftClear + myHead.s * 0.5 + 30));
        };
        // a split toward pt is safe if no stranger that could eat one of the halves is near where they fly
        // (boost kill: the opening splits flew at the Runner, which ate two 444-mass halves)
        const laneSafe = (pt, intoPartner) => {
            for (const c of mine) {
                if (c.s < GAME.minSplitSize) continue;
                const half = c.s / SQRT2, dx = pt.x - c.x, dy = pt.y - c.y, dl = Math.hypot(dx, dy) || 1;
                const ex = c.x + dx / dl * (GAME.splitBoost + c.s), ey = c.y + dy / dl * (GAME.splitBoost + c.s);
                for (const e of S.enemies) if (e.player && canEat(e.s, half * 0.98) && segDist(e.x, e.y, c.x, c.y, ex, ey) < e.s + half + 150) return false;
                // a travel split must not run its halves through partner pieces they could eat (frsim: 'split ahead'
                // halves of 224 ate Lead's last 137-167s)
                // (their pieces may split while ours fly: count them at half their size too)
                if (!intoPartner) for (const k of theirs) if (canEat(half, Math.min(k.s, k.s >= GAME.minSplitSize ? k.s / SQRT2 : k.s) * 0.97) && segDist(k.x, k.y, c.x, c.y, ex, ey) < half + k.s * 0.5 + 60) return false;
                for (const k of others) if ((canEat(half, Math.min(k.s, k.s >= GAME.minSplitSize ? k.s / SQRT2 : k.s) * 0.97) || canEat(k.s, half * 0.97)) && segDist(k.x, k.y, c.x, c.y, ex, ey) < half + k.s * 0.6 + 80) return false;
            }
            return true;
        };
        const nearestOf = list => { let tg = null, bd = Infinity; for (const c of list) { const d = Math.hypot(c.x - myHead.x, c.y - myHead.y); if (d < bd) { bd = d; tg = c; } } return tg; };
        const canSplit = mine.length < CFG.maxCells && mine.some(c => c.s >= GAME.minSplitSize);
        const pf = P.ft || {};
        const D = conn.ftDiag || (conn.ftDiag = { turns: 0, splits: 0, tail: 0, curve: 0, feedHead: 0, fedSmall: 0 });
        const say = m => { conn.mode = 'fast travel: ' + m + (threat ? ' (away from ' + (threat.name || 'a giant') + ')' : ''); };
        let ft = conn.ft || (conn.ft = { active: false, idx: 0, plan: [], splitAt: 0, turn: 0, seen: -1, idleSince: t, since: t });
        const aimAt = p => { conn.sendMouse(p.x, p.y); conn.botAim = p; };
        // ---------------------------------------------- not our turn: keep our head out of reach of their big pieces
        // (all remaining frsim deaths: the small one 'being fed' / 'side by side' drifted into a piece that ate it)
        if (!ft.active) {
            let thr = null, td = Infinity;
            for (const c of theirs.concat(others)) if (canEat(c.s, myHead.s * 0.97)) { const d = Math.hypot(c.x - myHead.x, c.y - myHead.y) - c.s; if (d < td) { td = d; thr = c; } }
            if (thr && td < CFG.ftClear + myHead.s * 0.5) {
                const dx = myHead.x - thr.x, dy = myHead.y - thr.y, dl = Math.hypot(dx, dy) || 1;
                aimAt({ x: myHead.x + dx / dl * 700 + ux * 200, y: myHead.y + dy / dl * 700 + uy * 200 });
                say('keeping clear of ' + (P.name || 'partner') + "'s big piece");
                return true;
            }
        }
        // ---------------------------------------------- the partner is too small to take our pieces: feed it first
        if (!ft.active && theirMass * 16 < myMass && mine.some(c => c.s >= GAME.minEjectSize)) {
            const far = along(pHead, myHead) < -(myHead.s + 600);
            if (far && apart > 1200) { aimAt({ x: pHead.x, y: pHead.y }); say('going back for ' + (P.name || 'partner')); return true; }
            feedShoot(conn, S, conn.cells.get(pHead.id) || pHead, theirs); D.fedSmall++;
            say('feeding ' + (P.name || 'partner') + ' until it can take our pieces');
            return true;
        }
        // ---------------------------------------------- start a turn
        // how many more splits we can afford: every split halves every piece that can split; below split size or
        // over the piece limit there's nothing left to throw
        const affordable = () => {
            const top = mass(mine.reduce((x, c) => Math.max(x, c.s), 0)), minM = mass(GAME.minSplitSize);
            let k = 0, pcs = mine.length, m = top;
            while (m / 2 >= minM * 0.98 && pcs < CFG.maxCells) { m /= 2; pcs = Math.min(CFG.maxCells, pcs * 2); k++; }
            return k;
        };
        const plan = first => {
            // splits of a turn; each is aimed when it's due (positions move)
            const k = affordable(), p = [];
            if (first) { for (let i = 0; i < Math.min(3, k); i++) p.push('fwd'); return p; }      // the opening: free splits forward
            if (k <= 0) return ['eat'];                                     // nothing to throw: rebuild a head first
            // their head can swallow our split halves: feed it first (it becomes the biggest thing around), then their
            // tail, then round them. Too small (they just broke up): their tail first, round them, feed last
            const halves = Math.max(...mine.map(c => (c.s >= GAME.minSplitSize ? c.s / SQRT2 : c.s)));
            const feedFirst = canEat(pHead.s, halves * 1.02);
            const tail = theirs.length > 1 && k >= 2 ? 1 : 0;
            const curve = Math.max(0, Math.min(CFG.ftCurveSplits, k - 1 - tail));
            if (feedFirst) p.push('feed');
            if (tail) p.push('tail');
            for (let i = 0; i < curve; i++) p.push('curve' + i + '/' + curve);
            if (!feedFirst) p.push('feed');
            return p;
        };
        if (!ft.active) {
            // our turn: the opening (their first turn: we come in on their third split) or their turn is on its last split
            const theyGo = pf.turn !== ft.seen && pf.turn > 0 &&
                (pf.active ? (pf.first ? pf.idx >= 2 : pf.idx >= Math.max(1, (pf.len || 1) - 1)) : true);   // (a finished turn hands over too)
            const nobody = !pf.active && t - ft.idleSince > CFG.ftSplitMs * 4;
            const pCan = theirs.length < CFG.maxCells && theirs.some(c => c.s >= GAME.minSplitSize);
            const iStart = (canSplit && !pCan) || (canSplit && (myMass > theirMass * 1.02 || (Math.abs(myMass - theirMass) <= theirMass * 0.02 && conn.memberId < P.from)));
            if (theyGo || (nobody && iStart && canSplit)) {
                ft.first = !theyGo && D.turns === 0 && !(pf.turn > 0);
                ft.active = true; ft.idx = 0; ft.turn++; ft.seen = pf.turn; ft.splitAt = 0; ft.plan = plan(ft.first);
                D.turns++;
            }
        }
        if (!ft.active && !canSplit && !(theirs.length < CFG.maxCells && theirs.some(c => c.s >= GAME.minSplitSize)) && !pf.active) {
            // nobody can split: the user's rule - the bigger feeds the smaller until it can eat the bigger's smallest
            // piece; then the smaller eats the bigger's small pieces (never its head) until it can split again
            const myHeadM = myHead, pHeadM = pHead;
            if (myMass >= theirMass) {
                const spare = mine.filter(c => c.id !== myHeadM.id);
                const minSpare = spare.length ? Math.min(...spare.map(c => c.s)) : Infinity;
                if (spare.length && !canEat(pHeadM.s, minSpare * CFG.eatMargin) && mine.some(c => c.s >= GAME.minEjectSize)) {
                    feedShoot(conn, S, conn.cells.get(pHeadM.id) || pHeadM, theirs); D.fedSmall++;
                    say('feeding ' + (P.name || 'partner') + ' until it can eat our pieces');
                    return true;
                }
                aimAt({ x: myHeadM.x + ux * 80, y: myHeadM.y + uy * 80 }); say('letting ' + (P.name || 'partner') + ' eat our small pieces');
                return true;
            }
            const tg = nearestOf(safeFood());
            if (tg) { aimAt(predict(tg, S.L + 4, S.tick)); say('eating ' + (P.name || 'partner') + "'s small pieces (to split again)"); return true; }
            const bf = pHeadM.s + CFG.ftClear + myHeadM.s * 0.5 + 40;    // just outside the keep-clear zone
            aimAt({ x: pHeadM.x - ux * bf, y: pHeadM.y - uy * bf }); say('being fed by ' + (P.name || 'partner'));
            return true;
        }
        // ---------------------------------------------- grow back (the user: "I eject mass into the smaller one while it
        // hovers at my edge, circling to find the piece it'll be able to eat first, and eats it when it's big enough")
        if (myMass / team < CFG.ftBalanceLow && theirs.length > 1 && theirMass / team > CFG.ftKeepShare) {
            ft.active = false;
            const reachOf = k => Math.hypot(k.x - myHead.x, k.y - myHead.y) - k.s;
            // their pieces that could eat us: keep out of their reach while we circle
            const danger = theirs.concat(others).filter(k => canEat(k.s, myHead.s * 0.97));
            // (outside the keep-clear zone above - live: hovering inside it, keep-clear pushed us off and the hover pulled
            // us back, frozen for good)
            const clearR = CFG.ftClear + myHead.s * 0.5 + 40;
            const safeSpot = p => danger.every(k => Math.hypot(k.x - p.x, k.y - p.y) > k.s + clearR - 20);
            // the piece of theirs we can eat soonest: smallest first, then nearest
            const cand = theirs.filter(k => k.id !== pHead.id).sort((a2, b2) => a2.s - b2.s || reachOf(a2) - reachOf(b2));
            // (the way there must be clear for ALL our pieces - calm: Help's head went for a piece, its smaller pieces
            // following behind ran into Lead's 143s and Help was eaten bit by bit)
            const minMine = Math.min(...mine.map(c => c.s));
            const dangerAny = theirs.concat(others).filter(k => canEat(k.s, minMine * 0.97));
            const tg = cand.find(k => canEat(myHead.s, k.s * CFG.eatMargin) && danger.every(d => d === k || segDist(d.x, d.y, myHead.x, myHead.y, k.x, k.y) > d.s + myHead.s * 0.5 + 60) &&
                dangerAny.every(d => d === k || mine.every(c => segDist(d.x, d.y, c.x, c.y, k.x, k.y) > d.s + c.s * 0.5 + 40)));
            if (tg) { aimAt(predict(tg, S.L + 4, S.tick)); say('eating ' + (P.name || 'partner') + "'s small piece (growing back)"); return true; }
            // not big enough yet: hover at the edge of their smallest piece, on the side away from their other pieces
            const k0 = cand[0] || pHead;
            const ax = k0.x - cP.x, ay = k0.y - cP.y, al = Math.hypot(ax, ay) || 1;
            const hov = canEat(k0.s, myHead.s * 0.97) ? k0.s + clearR : k0.s + myHead.s * 0.5;
            let spot = { x: k0.x + ax / al * hov, y: k0.y + ay / al * hov };
            if (!safeSpot(spot)) { const sx = cM.x - cP.x, sy = cM.y - cP.y, sl = Math.hypot(sx, sy) || 1; spot = { x: cM.x + sx / sl * 400, y: cM.y + sy / sl * 400 }; }
            aimAt(spot); say('hovering at ' + (P.name || 'partner') + "'s edge, being fed");
            return true;
        }
        if (!ft.active && theirMass / team < CFG.ftBalanceLow && mine.some(c => c.s >= GAME.minEjectSize)) {
            // the pair is lopsided (we hold most of it): even it out - the loop needs mass on both sides
            feedShoot(conn, S, conn.cells.get(pHead.id) || pHead, theirs, true); D.fedSmall++;
            say('evening us out: feeding ' + (P.name || 'partner'));
            return true;
        }
        if (!ft.active) {
            // waiting: eat the partner's small pieces our head can take - never near a piece of theirs that could eat us
            const food = safeFood();
            if (food.length) {
                const tg = nearestOf(food), bd = Math.hypot(tg.x - myHead.x, tg.y - myHead.y);
                if (bd < 1500) { aimAt(predict(tg, S.L + 4, S.tick)); say('eating ' + (P.name || 'partner') + "'s tail"); return true; }
            }
        }
        if (!ft.active) {
            // waiting for our turn: side by side with the partner, heading the same way
            const px = -uy, py = ux, side = ((cM.x - cP.x) * px + (cM.y - cP.y) * py) >= 0 ? 1 : -1;
            const gap = pHead.s + myHead.s + 200;
            // level with their head, beside it, but aiming well ahead: full speed along the course (aiming only 400 ahead
            // made the faster one keep waiting - 35% of the time was spent 'side by side')
            const spot = { x: pHead.x + px * side * gap + ux * 1400, y: pHead.y + py * side * gap + uy * 1400 };
            aimAt(spot); say(pf.active ? 'waiting for my turn (' + (P.name || 'partner') + ' splitting)' : 'side by side with ' + (P.name || 'partner'));
            return true;
        }
        // ---------------------------------------------- our turn: one split every ftSplitMs
        const step = ft.plan[ft.idx];
        if (!step || (step !== 'eat' && !canSplit && t - ft.splitAt > CFG.ftSplitMs * 2)) { ft.active = false; ft.idleSince = t; return stepFastTravel(conn, S); }
        const half = myHead.s / SQRT2;
        let target = null, why = '';
        // safety: after this split, could any of our pieces still eat their head? then feed it more first
        const bigAfter = Math.max(...mine.map(c => (c.s >= GAME.minSplitSize ? c.s / SQRT2 : c.s)));
        const wide = step.startsWith('curve') && canEat(bigAfter, pHead.s * 0.97);   // could eat their head: go round wide
        if (step === 'eat') {
            // no splits left: consolidate (the user's rule). Big at the piece limit with a partner too small to eat our
            // pieces: shoot mass into its head until it can, then hold steady while it eats our small ones; small and
            // stuck: walk our head through their rear pieces. Ends when we can split twice again (or 3 s).
            if (affordable() >= 2 || t - (ft.eatSince || (ft.eatSince = t)) > 3000) { ft.eatSince = 0; ft.idx++; return stepFastTravel(conn, S); }
            const spare = mine.filter(c => c.id !== myHead.id);
            // both stuck (pieces about the same size, neither can split or eat the other's): consolidate into our own
            // head by shooting at it (the user: "consolidate our mass by shooting into our center") - our own blobs are
            // ours to eat - until our head can eat their typical piece
            {
                const pMed = theirs.map(c => c.s).sort((p, q) => p - q)[Math.floor(theirs.length / 2)];
                const pStuck = !(theirs.length < CFG.maxCells && theirs.some(c => c.s >= GAME.minSplitSize));
                const minSpare0 = spare.length ? Math.min(...spare.map(c => c.s)) : Infinity;
                if (spare.length >= 3 && pStuck && !canEat(pHead.s, minSpare0 * CFG.eatMargin) && !canEat(myHead.s, pMed * CFG.eatMargin) &&
                    spare.some(c => c.s >= GAME.minEjectSize)) {
                    const a = { x: myHead.x + ux * 25, y: myHead.y + uy * 25 };
                    aimAt(a); conn.sendEject(); D.selfFeed = (D.selfFeed || 0) + 1;
                    say('shooting into our own head (consolidating)');
                    return true;
                }
            }
            if (myMass >= theirMass && spare.length) {
                const minSpare = Math.min(...spare.map(c => c.s));
                if ((!canEat(pHead.s, minSpare * CFG.eatMargin) || theirMass / team < CFG.ftBalanceLow) && mine.some(c => c.s >= GAME.minEjectSize)) {
                    feedShoot(conn, S, conn.cells.get(pHead.id) || pHead, theirs, theirMass / team < CFG.ftBalanceLow); D.fedSmall++;
                    say('feeding ' + (P.name || 'partner') + ' so it can eat our pieces');
                    return true;
                }
                // the user's idea: dip our small pieces backwards into their head (it can eat them) - while our own head
                // stays clear of it; if our head gets close, carry on forward instead
                // every one of our pieces must stay out of reach of their pieces it could eat or be eaten by - except our
                // small ones going into their head (frsim: Lead's 439 non-head pieces dipped into Help and ate it)
                const headSafe = mine.every(c => {
                    if (c.id !== myHead.id && canEat(pHead.s, c.s * CFG.eatMargin)) return true;           // a piece we're giving them
                    return theirs.concat(others).every(k => !(canEat(c.s, k.s * 0.97) || canEat(k.s, c.s * 0.97)) || Math.hypot(c.x - k.x, c.y - k.y) - Math.max(c.s, k.s) > Math.min(c.s, k.s) + CFG.ftDipClear);
                });
                if (headSafe) { const ph = predict(pHead, S.L + 4, S.tick); aimAt(ph); say('dipping our small pieces into ' + (P.name || 'partner')); return true; }
                // away from their pieces (forward along the course could be straight into them - frsim lagged death)
                // sideways away from them, and forward too unless forward leads into them
                const px = -uy, py = ux, side = ((cM.x - cP.x) * px + (cM.y - cP.y) * py) >= 0 ? 1 : -1;
                const fwdIntoThem = ((cP.x - cM.x) * ux + (cP.y - cM.y) * uy) > 0;
                const fw = fwdIntoThem ? 0 : 450;
                aimAt({ x: cM.x + px * side * 600 + ux * fw, y: cM.y + py * side * 600 + uy * fw }); say('holding our head clear of ' + (P.name || 'partner'));
                return true;
            }
            const food = safeFood();
            if (!food.length) { ft.eatSince = 0; ft.idx++; return stepFastTravel(conn, S); }
            const tg = nearestOf(food);
            if (!tg) { ft.eatSince = 0; ft.idx++; return stepFastTravel(conn, S); }
            aimAt(predict(tg, S.L + 4, S.tick)); say('eating ' + (P.name || 'partner') + "'s small pieces (to split again)");
            return true;
        }
        if (step === 'fwd') { target = { x: myHead.x + ux * 1200, y: myHead.y + uy * 1200 }; why = 'splitting forward'; }
        else if (step === 'tail') {
            // only if our halves can eat their tail piece; else skip it
            if (mine.some(c => c.s >= GAME.minSplitSize && canEat(c.s / SQRT2, pRear.s * CFG.eatMargin)) && pRear.id !== pHead.id &&
                (canEat(pHead.s, half) || segDist(pHead.x, pHead.y, myHead.x, myHead.y, pRear.x, pRear.y) > pHead.s + half + 60)) { target = predict(pRear, S.L + 8, S.tick); why = 'eating ' + (P.name || 'partner') + "'s tail"; }
            else { ft.idx++; return stepFastTravel(conn, S); }
        } else if (step.startsWith('curve')) {
            // a tight arc round their head, from where we are to in front of it
            const [kk, nn] = step.slice(5).split('/').map(Number), k = kk + 1, n = nn || 1;
            const a0 = Math.atan2(myHead.y - pHead.y, myHead.x - pHead.x);
            let da = dir - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
            const ang = a0 + da * k / n, R = pHead.s + half + CFG.ftCurveGap + (wide ? half * 2 + 300 : 0);
            const ph = predict(pHead, S.L + 10, S.tick);
            target = { x: ph.x + Math.cos(ang) * R + ux * 250, y: ph.y + Math.sin(ang) * R + uy * 250 }; why = 'curving round ' + (P.name || 'partner') + ' (' + k + '/' + n + ')';
        } else if (step === 'feed' && (theirMass / team >= CFG.ftFeedUpTo || myMass / team < 0.5)) {
            ft.idx++; return stepFastTravel(conn, S);                         // they have plenty already: no feed
        } else if (step === 'feed') {
            // our tail straight into their head (our head, in front, keeps half and stays in front) - only if their head
            // can swallow our split halves; else shoot mass at it until it can (or ftFeedWaitMs), then split
            // only the halves that can reach their head matter (a split half flies ~800 + our size): our own head out in
            // front, further than that, keeps its half to itself
            const reach = c => Math.hypot(c.x - pHead.x, c.y - pHead.y) - pHead.s < GAME.splitBoost + c.s + 120;
            const halves = Math.max(0, ...mine.filter(reach).map(c => (c.s >= GAME.minSplitSize ? c.s / SQRT2 : c.s)));
            if (halves > 0 && !canEat(pHead.s, halves * 1.02)) {
                if (!ft.wFeedSince) ft.wFeedSince = t;
                if (t - ft.wFeedSince < CFG.ftFeedWaitMs) {
                    // our splits would land halves big enough to eat its head; our small pieces (too small to split anyway)
                    // are its to eat: slow down and offer them (it comes for them). Shooting mass only for a tiny partner
                    if (theirMass * 16 < myMass && mine.some(c => c.s >= GAME.minEjectSize)) { feedShoot(conn, S, conn.cells.get(pHead.id) || pHead, theirs); D.fedSmall++; say('feeding ' + (P.name || 'partner') + ' (tiny)'); return true; }
                    // split forward AWAY from their head instead: our big halves fly ahead, our small tail stays behind
                    // for them to eat (the user: split round them, the tail left behind gets eaten)
                    const px2 = -uy, py2 = ux, away2 = ((cM.x - pHead.x) * px2 + (cM.y - pHead.y) * py2) >= 0 ? 1 : -1;
                    const a2 = { x: myHead.x + ux * 1000 + px2 * away2 * 400, y: myHead.y + uy * 1000 + py2 * away2 * 400 };
                    if (canSplit && t - ft.splitAt >= CFG.ftSplitMs && laneSafe(a2)) {
                        aimAt(a2); conn.sendSplit(1); ft.splitAt = t; D.splits++;
                        conn.lastAction = t; conn.lockUntil = t + 120; conn.lockTargetId = 0; conn.lockAim = a2;
                        say('splitting ahead, leaving our tail for ' + (P.name || 'partner'));
                        ft.wFeedSince = 0; ft.idx++;
                        return true;
                    }
                    aimAt({ x: cM.x + ux * 60, y: cM.y + uy * 60 }); say('offering ' + (P.name || 'partner') + ' our tail');
                    return true;
                }
                ft.wFeedSince = 0; ft.idx++; return stepFastTravel(conn, S);        // gave up on this split
            }
            ft.wFeedSince = 0;
            const handed = mine.filter(reach).filter(c => c.s >= GAME.minSplitSize).reduce((x, c) => x + mass(c.s) / 2, 0);
            if ((theirMass + handed) / team > CFG.ftFeedMaxAfter) { ft.idx++; return stepFastTravel(conn, S); }   // would overshoot
            target = predict(pHead, S.L + 6, S.tick); why = 'splitting our tail into ' + (P.name || 'partner') + "'s head";
        }
        if (t - ft.splitAt >= CFG.ftSplitMs && canSplit && !laneSafe(target, step === 'tail' || step === 'feed')) { aimAt({ x: cM.x + ux * 300, y: cM.y + uy * 300 }); say('holding a split (a stranger in the lane)'); if (t - ft.splitAt > 2000) { ft.idx++; } return true; }
        if (t - ft.splitAt >= CFG.ftSplitMs && canSplit) {
            aimAt(target); conn.sendSplit(1); ft.splitAt = t; ft.idx++; D.splits++;
            if (step === 'tail') D.tail++; else if (step === 'feed') D.feedHead++; else if (step.startsWith('curve')) D.curve++;
            conn.lastAction = t; conn.lockUntil = t + 120; conn.lockTargetId = 0; conn.lockAim = target;
            say(why);
            return true;
        }
        aimAt(target); say(why);
        return true;
    }
    function stepPair(conn, S) {
        if (CFG.fastTravel) { conn.pair = null; return false; }
        if (CFG.carryDefault && ((S.captain && S.captain.order.mode === 'carry') || conn.isCarrier)) { conn.pair = null; return false; }
        const P = pairOf(conn, S);
        if (!P || !S.mine.length) { conn.pair = null; return false; }
        const D = conn.pairDiag || (conn.pairDiag = { since: Date.now(), handedToUs: 0, ate: 0, noFood: 0, danger: 0, eatOff: 0, far: 0 });
        const handedToUs = P.pair && P.pair.role === 'giver' && P.pair.with === conn.memberId;
        if (handedToUs) D.handedToUs++;
        const t = now();
        // 3.36.0 wobble fix (817 'stuck wobbling' logs in 3 h: pair vs evade/farm flipping as danger crossed one line):
        // pair mode needs a body worth pairing (pairMinBody), and once danger pushes it out it stays out pairOffMs,
        // and it comes back only below 60% of the danger line (hysteresis)
        if (!handedToUs && (S.myMass < CFG.pairMinBody || t < (conn.pairOffUntil || 0))) { conn.pair = null; conn.pairOn = false; return false; }
        const dLine = handedToUs ? CFG.pairCatchDanger : CFG.pairDangerMax * (conn.pairOn ? 1 : 0.6);
        // escapes first - but pieces being handed to us are caught up to pairCatchDanger: swallowing them is what makes us safe
        if (conn.danger > dLine * S.myMass + 1) { if (handedToUs) D.danger++; else conn.pairOffUntil = t + CFG.pairOffMs; conn.pair = null; conn.pairOn = false; return false; }
        conn.pairOn = true;
        const live = r => { const c = conn.cells.get(r[0]); return c ? { id: c.id, x: c.x, y: c.y, s: c.s } : { id: r[0], x: r[1], y: r[2], s: r[3] }; };
        const theirs = P.cells.map(live), mine = S.mine;
        const big = cs => cs.reduce((a, c) => (c.s > a.s ? c : a));
        const B0 = big(mine), R0 = big(theirs);
        const cM = centroid(mine), cP = centroid(theirs);
        const who = P.name || 'my partner';
        const st = conn.pairState || (conn.pairState = { splitAt: 0, side: 1 });
        const say = (role, mode, extra) => { conn.pair = Object.assign({ role, with: P.from }, extra || {}); conn.mode = 'pair: ' + mode; };
        // together first
        if (Math.hypot(cM.x - cP.x, cM.y - cP.y) > CFG.pairGap) {
            if (handedToUs) D.far++;
            say('closing', 'closing up on ' + who);
            return travel(conn, S, cP.x, cP.y, conn.mode);
        }
        // the pair's course: the leader's (bigger one's) own choice, turning slowly; the other reads it from the leader
        const lead = B0.s > R0.s * 1.002 || (Math.abs(B0.s - R0.s) <= R0.s * 0.002 && conn.memberId < P.from);
        if (lead) {
            const mv = steer(conn, S);
            const ax = mv.aim.x - B0.x, ay = mv.aim.y - B0.y, al = Math.hypot(ax, ay);
            let want = al > 1 ? Math.atan2(ay, ax) : (st.dir ?? 0);
            // all of us together: a pair that's far from the other bots heads for them (safety in numbers)
            const others = S.squad.filter(m => m.isBot && m.from !== P.from && m.cells && m.cells.length && t - m.rx < 1500);
            if (others.length) {
                let ox = 0, oy = 0, om = 0;
                for (const m of others) for (const r of m.cells) { const w = r[3] * r[3]; ox += r[1] * w; oy += r[2] * w; om += w; }
                ox /= om; oy /= om;
                const pcx = (cM.x + cP.x) / 2, pcy = (cM.y + cP.y) / 2;
                if (Math.hypot(ox - pcx, oy - pcy) > CFG.pairGroupGap && conn.danger < 0.1 * S.myMass + 1) { want = Math.atan2(oy - pcy, ox - pcx); st.grouping = true; } else st.grouping = false;
            }
            if (st.dir === undefined) st.dir = want;
            let dd = want - st.dir; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
            st.dir += Math.max(-CFG.pairTurn, Math.min(CFG.pairTurn, dd));
        } else if (typeof P.dir === 'number') st.dir = P.dir;
        else if (st.dir === undefined) st.dir = Math.atan2(cP.y - cM.y, cP.x - cM.x);
        conn.botDir = st.dir;
        const dir = { x: Math.cos(st.dir), y: Math.sin(st.dir) }, perp = { x: -dir.y, y: dir.x };
        const along = c => (c.x - cM.x) * dir.x + (c.y - cM.y) * dir.y;
        // the hard rule: never swallow the partner's main cell. If one of ours that could eat it is getting close, we go
        // straight away from it this tick, whatever else we were doing
        const keepsP = theirs.filter(c => c.s >= R0.s * 0.95);
        const go = (x, y) => {
            outer: for (const keepP of keepsP) for (const c of mine) {
                if (!canEat(c.s, keepP.s)) continue;
                const dx = c.x - keepP.x, dy = c.y - keepP.y, dd = Math.hypot(dx, dy) || 1;
                if (dd < c.s - keepP.s / 3 + CFG.pairKeepClear) { x = c.x + dx / dd * 800; y = c.y + dy / dd * 800; conn.pairDodge = (conn.pairDodge || 0) + 1; break outer; }
            }
            // ...and the other way round: our main cell keeps clear of any of theirs that could eat it
            for (const c of theirs) {
                if (!canEat(c.s, B0.s)) continue;
                const dx = B0.x - c.x, dy = B0.y - c.y, dd = Math.hypot(dx, dy) || 1;
                if (dd < c.s - B0.s / 3 + CFG.pairKeepClear) { x = B0.x + dx / dd * 800; y = B0.y + dy / dd * 800; conn.pairDodge = (conn.pairDodge || 0) + 1; break; }
            }
            conn.sendMouse(x, y); conn.botAim = { x, y };
        };
        // 0. POUR AND STRIKE (the best pairs' kill): a stranger neither of us can split-kill alone, but our combined mass
        // split once can: the smaller pours nearly everything into the bigger, the bigger splits onto it
        if (CFG.pairStrike && !handedToUs) {
            const theirMass = theirs.reduce((a, c) => a + c.s * c.s / 100, 0);
            const combS = Math.sqrt((S.myMass + theirMass * 0.95) * 100), bigS = Math.max(B0.s, R0.s);
            const pc = { x: (cM.x + cP.x) / 2, y: (cM.y + cP.y) / 2 };
            if (lead) {
                let tg = st.strike && t - st.strike.at < CFG.pairStrikeMs ? S.enemies.find(e => e.id === st.strike.id && !e.remote) : null;
                if (!tg) {
                    tg = null; st.strike = null;
                    for (const e of S.enemies) {
                        if (!e.player || e.remote || (conn.mateKeys && conn.mateKeys.has(e.key))) continue;
                        if (!canEat(combS / SQRT2 * 0.99, e.s) || canEat(e.s, combS * 0.9)) continue;      // even together not / too big to go near
                        if (Math.hypot(e.x - pc.x, e.y - pc.y) > CFG.pairStrikeRange) continue;
                        // nothing else around that could eat the striker's halves
                        if (S.enemies.some(o => o !== e && o.player && !o.remote && canEat(o.s, combS / SQRT2) && Math.hypot(o.x - e.x, o.y - e.y) < o.s + 1800)) continue;
                        if (!tg || e.s > tg.s) tg = e;
                    }
                    if (tg) st.strike = { id: tg.id, at: t };
                }
                if (tg) {
                    const dx = tg.x - B0.x, dy = tg.y - B0.y, d = Math.hypot(dx, dy) || 1;
                    if (canEat(B0.s / SQRT2, tg.s) && d - B0.s < GAME.splitBoost * 1.2 && mine.length < CFG.maxCells) {
                        // the mass is in: strike, through the smart-split planner (it aims where the target will be)
                        const plan = splitPlan(S, { x: tg.x, y: tg.y });
                        if ((!plan || plan.score <= 0) && d - B0.s < GAME.splitBoost * 0.7) {
                            // the planner passed but it's well within reach: lead it by its speed and go
                            const lt = 8, ax = tg.x + (tg.vx || 0) * lt, ay = tg.y + (tg.vy || 0) * lt;
                            go(ax, ay); conn.sendSplit(1);
                            conn.lockUntil = t + 350; conn.lockTargetId = tg.id; conn.lockAim = { x: ax, y: ay };
                            teamlog.start(conn, S, 'pair pour and strike', { target: tg.name || '', dist: Math.round(d), direct: 1 }, P.key, tg.key, 3000);
                            st.strike = null;
                            say('striker', 'striking ' + (tg.name || 'it') + ' with ' + who + "'s mass");
                            return true;
                        }
                        if (plan && plan.score > 0 && plan.lost === 0) {
                            teamlog.start(conn, S, 'pair pour and strike', { target: tg.name || '', dist: Math.round(d) }, P.key, tg.key, 3000);
                            conn.executeSplit(plan, 'pair strike');
                            st.strike = null;
                            say('striker', 'striking ' + (tg.name || 'it') + ' with ' + who + "'s mass");
                            return true;
                        }
                    }
                    // wait for the mass: close in, but out of its reach while it could still eat us
                    const hold = canEat(tg.s, B0.s) ? tg.s + B0.s + 350 : B0.s + GAME.splitBoost * 0.6;
                    if (d > hold) go(tg.x, tg.y); else go(B0.x - dx / d * 400, B0.y - dy / d * 400);
                    // the pour lands in ~0.5 s: ask for it only once the target is (nearly) within our split's reach
                    const needPour = !canEat(B0.s / SQRT2, tg.s) && d - B0.s < GAME.splitBoost * 1.1;
                    say('striker', 'lining up on ' + (tg.name || 'it') + (needPour ? ', ' + who + ' pours in' : ''), { strike: needPour ? tg.id : null });
                    return true;
                }
            } else if (t - (st.pourAt || 0) < 600) {
                say('giver', 'pouring into ' + who + ' to strike', { keep: st.keepId });
                return true;
            } else if (t - (st.pourAt || 0) < 2500) {
                // poured: our pieces are its now; keep our last cell clear of it while it strikes
                go(cM.x - (R0.x - cM.x), cM.y - (R0.y - cM.y));
                say('runner', 'poured into ' + who + ', clearing the way');
                return true;
            } else if (P.pair && P.pair.role === 'striker' && P.pair.with === conn.memberId && P.pair.strike) {
                // pour: everything into the striker (it can eat the pieces), keeping one small cell
                const dx = R0.x - B0.x, dy = R0.y - B0.y, d = Math.hypot(dx, dy) || 1;
                // as many splits as the piece limit allows: ~94% goes over (each split sends half of every piece)
                let k = 0, pcs = mine.length;
                while (k < 4 && pcs * 2 <= CFG.maxCells && B0.s / Math.pow(SQRT2, k + 1) >= GAME.minEjectSize * 0.9) { k++; pcs *= 2; }
                k = Math.max(1, k);
                // the piece we keep stays where we are: out of the striker's reach, or it swallows us whole
                // (it grows as it eats our pieces: its edge comes out to meet the one we keep)
                const keepS = B0.s / Math.pow(SQRT2, k), grownS = Math.sqrt(R0.s * R0.s + B0.s * B0.s * (1 - Math.pow(0.5, k)));
                const minD = grownS - keepS / 3 + 260;
                if (d < minD) { go(B0.x - dx / d * 600, B0.y - dy / d * 600); say('giver', 'making room to pour into ' + who); return true; }
                if (d - R0.s < GAME.splitBoost * 0.8 && t - (st.pourAt || 0) > 600 && mine.length < CFG.maxCells) {
                    st.keepId = B0.id;
                    conn.pair = { role: 'giver', with: P.from, keep: B0.id };   // its mate guard lets the pieces in, never this one
                    go(R0.x, R0.y); conn.sendSplit(k);
                    st.pourAt = t; st.splitAt = t;
                    conn.lockUntil = t + 300; conn.lockTargetId = 0; conn.lockAim = { x: R0.x, y: R0.y };
                    teamlog.start(conn, S, 'pair pour into partner', { splits: k }, P.key, '', 3000);
                    conn.mode = 'pair: pouring into ' + who + ' to strike';
                    return true;
                }
                go(R0.x, R0.y);
                say('giver', 'joining ' + who + ' to pour in');
                return true;
            }
        }
        // 1. EAT: the partner's spare pieces (all but its rearmost, which it keeps) that we can swallow
        // (a chase that isn't getting anywhere - e.g. the piece sits by the partner's main cell - is dropped for a while)
        if (st.eatFrom && t - st.eatFrom > 2000 && S.myMass < st.eatMass * 1.02) { st.eatOff = t + 3000; st.eatFrom = 0; }
        // only what it's handing us: a partner in pieces for its own reasons (escaping) isn't ours to eat
        const handing = P.pair && P.pair.role === 'giver' && P.pair.with === conn.memberId;
        if (handing && t <= (st.eatOff || 0)) D.eatOff++;
        if (handing && theirs.length > 1 && t > (st.eatOff || 0)) {
            const rear = theirs.reduce((a, c) => (along(c) < along(a) ? c : a));
            // what it keeps: its rearmost piece while it's handing over (split halves are equal: 'biggest' could be the one
            // flying to us); otherwise its biggest as well
            const giving = P.pair && P.pair.role === 'giver';
            const keepId = P.pair && P.pair.keep;
            const keep = (keepId && theirs.find(c => c.id === keepId)) || (giving ? rear : big(theirs));
            const food = theirs.filter(c => c !== rear && c !== keep && canEat(B0.s, c.s * 1.02) && Math.hypot(c.x - B0.x, c.y - B0.y) < 2500 &&
                // never through the piece it keeps
                ![rear, keep].some(r => canEat(B0.s, r.s) && (segDist(r.x, r.y, B0.x, B0.y, c.x, c.y) < B0.s - r.s / 3 + 30 || Math.hypot(r.x - c.x, r.y - c.y) < B0.s)));
            if (food.length) {
                const f = food.reduce((a, c) => (Math.hypot(c.x - B0.x, c.y - B0.y) / c.s < Math.hypot(a.x - B0.x, a.y - B0.y) / a.s ? c : a));
                // aim a little past it: we sweep through, not stop on it
                const fx = f.x - B0.x, fy = f.y - B0.y, fl = Math.hypot(fx, fy) || 1;
                go(f.x + fx / fl * 300, f.y + fy / fl * 300);
                D.ate++;
                if (!st.eatFrom || S.myMass > st.eatMass * 1.02) { st.eatFrom = t; st.eatMass = S.myMass; }
                say('eater', 'eating ' + who + "'s pieces (" + food.length + ')');
                return true;
            }
        }
        if (handing && theirs.length > 1 && t > (st.eatOff || 0)) D.noFood++;
        // 2. GIVE: we're in pieces and the partner's big cell can eat them: keep going along the course (they're ahead of us)
        // (the partner beside us needs ~2.5 s to reach where the pieces land; they can't re-merge for 30+ s anyway)
        if (mine.length > 1 && t - st.splitAt < CFG.pairGiveMs && mine.some(c => c !== B0 && canEat(R0.s, c.s * 1.02))) {
            go(cM.x + dir.x * 1000, cM.y + dir.y * 1000);
            const myRear = mine.reduce((a, c) => (along(c) < along(a) ? c : a));
            say('giver', 'handing ' + who + ' our pieces', { keep: myRear.id });
            return true;
        }
        // 3. both whole. The smaller one keeps level with the bigger, beside it (just out of its reach), so it can run onto
        // the pieces the moment they land; the bigger one splits forward along the course when it's there.
        if (!lead) {
            const eatR = canEat(R0.s, B0.s) ? R0.s - B0.s / 3 + 140 : R0.s * 0.6;
            const side = (B0.x - R0.x) * perp.x + (B0.y - R0.y) * perp.y >= 0 ? 1 : -1;
            const off = eatR + B0.s * 0.5 + 60;
            const spot = { x: R0.x + perp.x * side * off + dir.x * CFG.pairRunAhead, y: R0.y + perp.y * side * off + dir.y * CFG.pairRunAhead };
            const d0 = Math.hypot(B0.x - R0.x, B0.y - R0.y) || 1;
            if (eatR && d0 < eatR) go(B0.x + (B0.x - R0.x) / d0 * 500, B0.y + (B0.y - R0.y) / d0 * 500);   // too close: off it
            else { const sx = spot.x - B0.x, sy = spot.y - B0.y, sl = Math.hypot(sx, sy) || 1; go(B0.x + sx / sl * Math.max(sl, 600), B0.y + sy / sl * Math.max(sl, 600)); }
            say('runner', 'beside ' + who);
            return true;
        }
        const Rn = R0;
        let k = 1;
        while (k < CFG.pairMaxK && !canEat(Rn.s, B0.s / Math.pow(SQRT2, k) * 1.03)) k++;
        const piece = B0.s / Math.pow(SQRT2, k);
        const tooSmall = !canEat(Rn.s, piece * 1.03);                // too lopsided to hand over sustainably: just travel
        const landing = { x: B0.x + dir.x * GAME.splitBoost * 0.9, y: B0.y + dir.y * GAME.splitBoost * 0.9 };
        const rel = { a: (Rn.x - B0.x) * dir.x + (Rn.y - B0.y) * dir.y };
        // the runner must get to the pieces quickly (it's level with us or ahead) and be able to eat them
        const ready = canEat(Rn.s, piece * 1.03) && rel.a > -Rn.s * CFG.pairBehindOk && Math.hypot(Rn.x - landing.x, Rn.y - landing.y) < GAME.splitBoost * CFG.pairSweep;
        const confirmed = P.pair && P.pair.role === 'runner' && P.pair.with === conn.memberId;
        const room = CFG.maxCells - mine.length;
        const canSplit = mine.length <= 4 && B0.s >= GAME.minSplitSize && room >= Math.pow(2, k) - 1 && piece >= GAME.minEjectSize * 0.9;
        // live: at 300-700 mass in crowds a third of the handed-over pieces went to strangers. The best pairs do this big,
        // with nothing around that could take a piece: so only from pairMinMass, and nobody who could eat a piece near
        const pairMass = S.myMass + theirs.reduce((a, c) => a + c.s * c.s / 100, 0);
        const unsafe = pairMass < CFG.pairMinMass || S.enemies.some(e => e.player && canEat(e.s, piece) &&
            segDist(e.x, e.y, B0.x, B0.y, landing.x, landing.y) < e.s + piece + CFG.pairClearR);
        if (confirmed && ready && canSplit && !unsafe && t - st.splitAt > CFG.pairSplitEveryMs) {
            go(B0.x + dir.x * 1000, B0.y + dir.y * 1000);
            conn.sendSplit(k);
            st.splitAt = t; conn.feedSplitAt = t;
            conn.lockUntil = t + 250; conn.lockTargetId = 0; conn.lockAim = { x: B0.x + dir.x * 1000, y: B0.y + dir.y * 1000 };
            teamlog.start(conn, S, 'pair split forward for partner', { splits: k }, P.key, '', 3000);
            say('body', 'splitting forward for ' + who + ' (x' + k + ')', { split: k });
            return true;
        }
        // the partner has fallen behind: ease off a little so it can come level (never a crawl: the pair keeps moving)
        const ease = rel.a < -Rn.s * 0.3 && !tooSmall ? moveSpeed(B0.s) * CFG.pairEase : 1000;
        go(B0.x + dir.x * ease, B0.y + dir.y * ease);
        const wait = !confirmed ? 'partner not ready' : !canEat(Rn.s, piece * 1.03) ? 'partner too small' : !ready ? 'partner not in place' : !canSplit ? 'can\'t split' : unsafe ? (pairMass < CFG.pairMinMass ? 'too small to hand over' : 'someone could snipe the pieces') : 'cooldown';
        say('body', 'leading ' + who + ' (' + wait + ')', { wait });
        return true;
    }
    function stepRelay(conn, S) { const r = stepRelayInner(conn, S); if (CFG.bot && CFG.teamRelay) relaySample(conn); return r; }
    function stepRelayInner(conn, S) {
        if (!CFG.bot || !CFG.teamRelay) return false;
        const P = relayPartner(S);
        // the newer state wins: that's how the turn passes back and forth
        if (P && P.relay && (!conn.relay || P.relay.seq > conn.relay.seq)) {
            conn.relay = { ...P.relay, started: now() };   // (its started is the other tab's clock)
            conn.relaySplits = 0; conn.relayLastSplit = 0; conn.relayK = 0; conn.relayStuck = 0; conn.relayStage = null;
            if (!P.relay.active) conn.relayCooldown = Math.max(conn.relayCooldown || 0, now() + 3000);
        }
        let R = conn.relay;
        if (!P) { conn.relayWhy = 'no partner near'; return relayActive(conn) ? endRelay(conn, R, '', 5000, 'partner gone') : false; }
        // a teammate asking for help (or us asking) comes first: no relay then
        const rescue = n => n && n.urgent && !/^to (eat|split-kill)/.test(n.why || '');
        // at the mines (and it's safe to farm): mine, don't weave - DNA is for getting places
        if (S.virusFarm) { conn.relayWhy = 'mining'; return relayActive(conn) ? endRelay(conn, R, '', 3000, 'reached the mines') : false; }
        const anyRescue = S.squad.some(m => m.cells.length && rescue(m.intent && m.intent.need) && Math.hypot(memberCenter(m).x - S.center.x, memberCenter(m).y - S.center.y) < 2500);
        if (rescue(P.intent && P.intent.need) || rescue(conn.squadNeed) || anyRescue) { conn.relayWhy = 'someone needs help'; return relayActive(conn) ? endRelay(conn, R, '', 2000, 'someone needs help') : false; }
        if (!relayActive(conn)) {
            const n = relayStart(conn, S, P);
            if (!n) return false;
            conn.relay = R = n;
            conn.relaySplits = 0; conn.relayLastSplit = 0; conn.relayK = 0; conn.relayStuck = 0; conn.relayStage = null;
            hud.flash(`team relay: ${n.why} with ${P.name || 'our teammate'}`);
            relayTell(conn, 'start', { seq: n.seq, why: n.why, stepper: n.stepper === conn.memberId ? 'us' : 'them', mass: Math.round(S.myMass), mateMass: Math.round(P.mass || 0) });
            teamlog.start(conn, S, 'DNA relay (' + n.why + ')', { stepper: n.stepper === conn.memberId ? 'us' : 'them' }, P.key, '', 5000);
        }
        const big = S.mine.reduce((a, b) => (b.s > a.s ? b : a));
        if (S.enemies.some(e => { const r = threatReach(S, e, big.s / 2); return r > -Infinity && Math.hypot(e.x - big.x, e.y - big.y) < r + 650; })) return endRelay(conn, R, 'stopped (company)', 15000, 'someone near');
        if (!R.weave && now() - R.started > 4000) return endRelay(conn, R, '', 3000, 'turn took too long');
        const ux = Math.cos(R.dir), uy = Math.sin(R.dir);
        let theirs = S.mates.filter(c => c.key === P.key);
        if (!theirs.length) theirs = P.cells.map(r => ({ id: r[0], x: r[1], y: r[2], s: r[3], key: P.key }));
        if (!theirs.length) return relayActive(conn) ? endRelay(conn, R, '', 3000, 'partner out of sight') : false;
        const theirHead = theirs.reduce((a, c) => (!a || c.x * ux + c.y * uy > a.x * ux + a.y * uy ? c : a), null);
        if (theirHead) S.mateBiggest.set(P.key, theirHead.id); // their head is what must survive
        if (R.weave) return stepWeave(conn, S, P, R, theirs);
        if (R.stepper !== conn.memberId) {
            // not our turn: keep going the way we're all going (our tail is about to be eaten by the partner's splits)
            const myHead = S.mine.reduce((a, c) => (c.x * ux + c.y * uy > a.x * ux + a.y * uy ? c : a));
            let a2 = { x: myHead.x + ux * 400, y: myHead.y + uy * 400 };
            conn.mode = 'team relay: ' + (P.name || 'our teammate') + "'s turn";
            // close in on its tail - the pieces our split halves will eat on our turn
            const tail = theirs.filter(c => c !== theirHead && canEat(big.s / SQRT2, c.s * 1.04));
            if (tail.length) {
                let gx = 0, gy = 0, gw = 0;
                for (const c of tail) { const w = c.s * c.s; gx += c.x * w; gy += c.y * w; gw += w; }
                gx /= gw; gy /= gw;
                const dd = Math.hypot(gx - big.x, gy - big.y);
                if (dd - big.s > 380) {
                    // to a point ~330 short of it (inside split range, not touching), moving along with it
                    const stop = big.s + 330, fx = (big.x - gx) / dd, fy = (big.y - gy) / dd;
                    a2 = { x: gx + fx * stop + ux * 250, y: gy + fy * stop + uy * 250 };
                    // never into a piece of theirs that could eat us
                    if (!theirs.some(c => canEat(c.s, big.s) && segDist(c.x, c.y, big.x, big.y, a2.x, a2.y) < c.s + 60))
                        conn.mode = 'team relay: closing in on ' + (P.name || 'our teammate') + "'s tail";
                    else a2 = { x: myHead.x + ux * 400, y: myHead.y + uy * 400 };
                }
            }
            conn.sendMouse(a2.x, a2.y); conn.botAim = a2;
            return true;
        }
        // our turn: how many splits? enough that our new pieces can eat the partner's leftover tail pieces (if any),
        // at least one; keep pieces a decent size and within the piece limit
        // ---- our turn, split-run style
        const myHalf = big.s / SQRT2;
        const moveOn = () => { const hd = S.mine.reduce((a, c) => (c.x * ux + c.y * uy > a.x * ux + a.y * uy ? c : a)); const a2 = { x: hd.x + ux * 500, y: hd.y + uy * 500 }; conn.sendMouse(a2.x, a2.y); conn.botAim = a2; };
        const headSafe = (cx, cy) => !theirHead || S.mine.every(pc => {
            const ns = pc.s / SQRT2;
            if (pc.s < GAME.minSplitSize || !canEat(ns, theirHead.s)) return true;
            return segDist(theirHead.x, theirHead.y, pc.x, pc.y, pc.x + cx * 950, pc.y + cy * 950) > ns - theirHead.s / GAME.eatOverlapDiv + 60;
        });
        if (!conn.relayStage) conn.relayStage = 'eat';
        const massOf = cs => cs.reduce((a, c) => a + c.s * c.s / 100, 0);
        const myM = massOf(S.mine), pM = massOf(theirs);
        // 1) EAT the partner's tail: ONE split straight at the nearest cluster of its pieces our halves can eat
        if (conn.relayStage === 'eat') {
            const edible = theirs.filter(c => c !== theirHead && canEat(myHalf, c.s * 1.04) && Math.hypot(c.x - big.x, c.y - big.y) - big.s < GAME.splitBoost * 0.8);
            const gain = massOf(edible);
            if (!edible.length || big.s < GAME.minSplitSize || S.mine.length >= GAME.maxCells ||
                myM + gain > 0.68 * (myM + pM)) conn.relayStage = 'advance';   // (keep the team even)
            else if (now() - (conn.relayLastSplit || 0) < CFG.relaySplitGapMs) { moveOn(); return true; }
            else {
                const nearest = edible.reduce((a, c) => (!a || Math.hypot(c.x - big.x, c.y - big.y) < Math.hypot(a.x - big.x, a.y - big.y) ? c : a), null);
                let gx = 0, gy = 0, gw = 0;
                for (const c of edible) if (Math.hypot(c.x - nearest.x, c.y - nearest.y) < 400) { const w = c.s * c.s; gx += c.x * w; gy += c.y * w; gw += w; }
                const tp = predict({ ...nearest, x: gx / gw, y: gy / gw }, S.L, S.tick);
                const ang = Math.atan2(tp.y - big.y, tp.x - big.x);
                const reach = theirs.filter(c => canEat(myHalf, c.s * 1.04) && Math.hypot(c.x - big.x, c.y - big.y) - big.s < GAME.splitBoost * 1.1);
                const worst = pM - massOf(reach);   // what the partner keeps if we took all of that
                const cx = Math.cos(ang), cy = Math.sin(ang);
                // our halves must not fly into (or land in) a piece of theirs that could eat them
                const pathSafe = S.mine.every(pc => pc.s < GAME.minSplitSize || theirs.every(tc => { const hs = pc.s / SQRT2;
                    return !canEat(tc.s, hs * 0.97) || segDist(tc.x, tc.y, pc.x, pc.y, pc.x + cx * 950, pc.y + cy * 950) > tc.s - hs / GAME.eatOverlapDiv + 150; }));
                if (!pathSafe || (worst < 0.35 * (myM + pM) && !headSafe(cx, cy))) conn.relayStage = 'advance';
                else {
                    const aim = { x: big.x + Math.cos(ang) * 800, y: big.y + Math.sin(ang) * 800 };
                    conn.sendMouse(aim.x, aim.y); conn.sendSplit(1); relayTell(conn, 'split', { seq: R.seq, stage: 'eat' });
                    conn.relayLastSplit = now(); conn.lastAction = now(); conn.botAim = aim;
                    conn.lockUntil = now() + 250; conn.lockTargetId = 0; conn.lockAim = aim;   // (the server splits toward the last mouse)
                    conn.relayStage = 'advance'; conn.relayAdvanceAt = now() + 450;           // let the halves land and eat first
                    conn.mode = 'team relay: eating ' + (P.name || 'our teammate') + "'s tail";
                    return true;
                }
            }
        }
        // 2) ADVANCE: split forward enough times that the partner's single split can eat our tail pieces next turn
        if (conn.relayStage === 'advance') {
            if (now() < (conn.relayAdvanceAt || 0)) { moveOn(); conn.mode = 'team relay: eating ' + (P.name || 'our teammate') + "'s tail"; return true; }
            if (!conn.relayK) {
                const pBig = theirs.reduce((a, c) => Math.max(a, c.s), 0), pHalf = pBig / SQRT2;
                const splittable = S.mine.filter(c => c.s >= GAME.minSplitSize).length;
                // heavier: the fewest splits that leave pieces its halves can eat (mass flows to it);
                // lighter: one split, pieces it can't eat (we just travel)
                const give = myM > pM * 1.1;
                let k = 0;
                for (let j = 1; j <= 3; j++) {
                    const piece = big.s / Math.pow(SQRT2, j);
                    if (piece < 130 || S.mine.length + splittable * (Math.pow(2, j) - 1) > GAME.maxCells) break;
                    const edibleByIt = pHalf > piece * GAME.eatMult * 1.04 || (!give && pBig > piece * GAME.eatMult * 0.97);
                    if (!give) { if (!edibleByIt) k = j; break; }
                    k = j;
                    if (edibleByIt) break;
                }
                if (!k) conn.relayStage = 'done'; else { conn.relayK = k; conn.relayGive = give; }
            }
            if (conn.relayStage === 'advance') {
                if (conn.relaySplits < conn.relayK) {
                    if (now() - (conn.relayLastSplit || 0) >= (conn.relaySplits ? CFG.relayAdvanceGapMs : CFG.relaySplitGapMs)) {
                        const base = R.dir + (RELAY_TURNS[conn.relayK - 1][conn.relaySplits] || 0) * R.side * 0.5;
                        const front = S.mine.reduce((a, c) => (c.x * ux + c.y * uy > a.x * ux + a.y * uy ? c : a));
                        let ang = null;
                        for (const extra of [0, 0.26, -0.26, 0.52, -0.52]) {
                            const cand = base + extra * R.side, cx = Math.cos(cand), cy = Math.sin(cand);
                            const ns = front.s / SQRT2, lx = front.x + cx * 900, ly = front.y + cy * 900;
                            const landSafe = theirs.every(tc => !canEat(tc.s, ns) || Math.hypot(lx - tc.x, ly - tc.y) > tc.s - ns / GAME.eatOverlapDiv + 200) &&
                                (conn.relayGive || S.mine.every(pc => pc.s < GAME.minSplitSize || theirs.every(tc => { const hs = pc.s / SQRT2;
                                    return !canEat(tc.s, hs * 0.97) || segDist(tc.x, tc.y, pc.x, pc.y, pc.x + cx * 900, pc.y + cy * 900) > tc.s - hs / GAME.eatOverlapDiv + 120; })));
                            if (headSafe(cx, cy) && landSafe) { ang = cand; break; }
                        }
                        if (ang === null) {
                            if (++conn.relayStuck > 25) return endRelay(conn, R, '', 3000, 'no safe split');
                            moveOn(); conn.mode = 'team relay: lining up'; return true;
                        }
                        const aim = { x: big.x + Math.cos(ang) * 800, y: big.y + Math.sin(ang) * 800 };
                        conn.sendMouse(aim.x, aim.y); conn.sendSplit(1); relayTell(conn, 'split', { seq: R.seq, stage: 'advance' });
                        conn.relaySplits++; conn.relayLastSplit = now(); conn.lastAction = now(); conn.botAim = aim;
                        conn.lockUntil = now() + 200; conn.lockTargetId = 0; conn.lockAim = aim;
                    } else moveOn();
                    conn.mode = `team relay: advancing (${conn.relaySplits}/${conn.relayK})`;
                    return true;
                }
                conn.relayStage = 'done';
            }
        }
        // done splitting: keep moving along; once our pieces have flown, the partner takes its turn (mirror side)
        const head = S.mine.reduce((a, c) => (c.x * ux + c.y * uy > a.x * ux + a.y * uy ? c : a));
        let a2 = { x: head.x + ux * 400, y: head.y + uy * 400 };
        conn.mode = 'team relay: over to ' + (P.name || 'our teammate');
        // hold our tail for the partner: mouse on the middle of our pieces, a little ahead (the tail pieces are smaller
        // and faster - dragged along at the head they'd outrun the partner)
        const pBigR = theirs.reduce((a, c) => (c.s > a.s ? c : a));
        const myTail = S.mine.filter(c => c !== head && canEat(pBigR.s / SQRT2, c.s * 1.04));
        const inReach = myTail.some(c => Math.hypot(c.x - pBigR.x, c.y - pBigR.y) - pBigR.s < GAME.splitBoost * 0.75);
        if (myTail.length && S.mine.length > 1) {
            let gx = 0, gy = 0, gw = 0;
            for (const c of S.mine) { const w = c.s * c.s; gx += c.x * w; gy += c.y * w; gw += w; }
            a2 = { x: gx / gw + ux * 150, y: gy / gw + uy * 150 };
            conn.mode = 'team relay: holding our tail for ' + (P.name || 'our teammate');
        }
        conn.sendMouse(a2.x, a2.y); conn.botAim = a2;
        if (now() - conn.relayLastSplit > CFG.relayHandoffMs && (!myTail.length || inReach || now() - conn.relayLastSplit > 1500)) {
            if ((R.round || 1) >= CFG.relayRounds || !relaySafeToStart(conn, S, P)) return endRelay(conn, R, (R.round || 1) >= CFG.relayRounds ? 'done' : '', 4000, (R.round || 1) >= CFG.relayRounds ? 'all rounds done' : 'not safe any more') || true;
            const empty = conn.relayLastSplit >= R.started ? 0 : (R.empty || 0) + 1;
            if (empty >= 2) return endRelay(conn, R, '', 4000, 'nothing to swap') || true;
            conn.relay = { ...R, seq: R.seq + 1, stepper: P.from, side: -R.side, round: (R.round || 1) + 1, started: now(), empty };
            conn.relaySplits = 0; conn.relayK = 0; conn.relayStuck = 0; conn.relayStage = null;
        }
        return true;
    }

    // Can the follower (its biggest piece of size eatS) drift into the leader's sixteenths and eat them?
    const eatsSixteenths = (eatS, leaderMass) => canEat(eatS, Math.sqrt(leaderMass / GAME.maxCells * 100) * CFG.eatMargin);

    // One bot's part in the DNA weave (the user's pattern): take turns splitting across the partner's path; eat the
    // partner's tail as we run over it.
    function stepWeave(conn, S, P, R, theirs) {
        const tw = (Date.now() - R.t0) / 1000;
        if (tw > CFG.weaveLoops * CFG.weavePeriod) return endRelay(conn, R, 'done', 5000, 'weave done') || true;
        const myM = S.myMass, pM = P.mass || theirs.reduce((a, c) => a + c.s * c.s / 100, 0), tot = myM + pM;
        if (myM < 0.2 * tot || pM < 0.2 * tot) return endRelay(conn, R, '', 4000, 'too lopsided') || true;
        const pBig = theirs.reduce((a, c) => (c.s > a.s ? c : a));
        const myBig = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
        const ux = Math.cos(R.dir), uy = Math.sin(R.dir), t = now();
        const pc = memberCenter(P);
        const side = ((pc.x - S.center.x) * -uy + (pc.y - S.center.y) * ux) >= 0 ? 1 : -1;   // partner on our right: +1
        // what we may eat: nearest first, never its biggest, only while it keeps 30% of the team
        let budget = pM - 0.3 * tot;
        const edible = [];
        for (const c of theirs.filter(c => c !== pBig && S.mine.some(q => canEat(q.s, c.s * CFG.eatMargin)))
            .sort((a, b) => Math.hypot(a.x - S.center.x, a.y - S.center.y) - Math.hypot(b.x - S.center.x, b.y - S.center.y))) {
            const m = c.s * c.s / 100;
            if (m > budget) break;
            budget -= m; edible.push(c);
        }
        const keepOff = theirs.filter(c => !edible.includes(c) && S.mine.some(q => canEat(q.s, c.s * 0.97)));
        const enemySafe = (q, lx, ly, ns) => S.enemies.every(e => !canEat(e.s, ns) || segDist(e.x, e.y, q.x, q.y, lx, ly) > e.s - ns / GAME.eatOverlapDiv + 250);
        const popsOn = ns => S.mine.length < CFG.maxCells && canEat(ns, GAME.virusSize);
        const virusSafe = (q, lx, ly, ns) => !popsOn(ns) || S.viruses.every(v => segDist(v.x, v.y, q.x, q.y, lx, ly) > ns - GAME.virusSize / GAME.eatOverlapDiv + 60);
        const pathOk = (hx, hy) => S.mine.every(q => { if (q.s < GAME.minSplitSize) return true; const ns = q.s / SQRT2, lx = q.x + hx * 800, ly = q.y + hy * 800;
            return enemySafe(q, lx, ly, ns) && virusSafe(q, lx, ly, ns) &&
                theirs.every(tc => !canEat(tc.s, ns * 0.97) || tc === pBig && edible.length === 0 ? true : !canEat(tc.s, ns * 0.97) || segDist(tc.x, tc.y, q.x, q.y, lx, ly) > tc.s + 120) &&
                keepOff.every(tc => !canEat(ns, tc.s * 0.97) || segDist(tc.x, tc.y, q.x, q.y, lx, ly) > ns + tc.s + 150); });
        const canSplit = S.mine.length < GAME.maxCells && myBig.s >= GAME.minSplitSize && t - (conn.weaveSplitAt || 0) > 180;
        const split = (hx, hy, what) => {
            const aim = { x: S.center.x + hx * 900, y: S.center.y + hy * 900 };
            conn.sendMouse(aim.x, aim.y); conn.sendSplit(1); conn.weaveSplitAt = t; conn.relayLastSplit = t; conn.lastAction = t;
            conn.lockUntil = t + 120; conn.lockTargetId = 0; conn.lockAim = aim; conn.botAim = aim;
            relayTell(conn, 'split', { seq: R.seq, stage: what });
        };
        // whose turn: the one that started (R.stepper) on even turns, the other on odd turns
        const turnLen = CFG.weaveTurn, k = Math.floor(tw / turnLen), inTurn = tw - k * turnLen;
        const myTurn = (k % 2 === 0) === (R.stepper === conn.memberId);
        // 1) our turn: split across, once at the start of the turn and once more a moment later, while the partner's
        //    biggest piece can eat what we leave behind
        // how many splits this turn: as many as it takes (up to 3) for the partner's biggest piece to eat what we leave
        let need = 0;
        for (let n = 1; n <= 3; n++) if (canEat(pBig.s, myBig.s / Math.pow(SQRT2, n) * CFG.eatMargin)) { need = n; break; }
        const splitsThisTurn = need ? Math.max(need, CFG.weaveSplitsPerTurn) : 0;
        if (myTurn && canSplit && need && (conn.weaveTurnK !== k || (conn.weaveTurnSplits || 0) < splitsThisTurn) && inTurn < turnLen * 0.8) {
            if (conn.weaveTurnK !== k) { conn.weaveTurnK = k; conn.weaveTurnSplits = 0; }
            {
                const h = R.dir + side * CFG.weaveAmp * Math.PI / 180, hx = Math.cos(h), hy = Math.sin(h);
                if (pathOk(hx, hy)) {
                    split(hx, hy, 'across');
                    conn.weaveTurnSplits++;
                    conn.mode = 'team DNA: splitting across ' + (P.name || 'our teammate') + "'s path";
                    return true;
                }
            }
        }
        // 2) split-eat a tail piece in range (halves that can eat it, a safe way)
        if (canSplit && edible.length) {
            let best = null;
            for (const q of S.mine) {
                if (q.s < GAME.minSplitSize) continue;
                for (const c of edible) {
                    if (!canEat(q.s / SQRT2, c.s * CFG.eatMargin)) continue;
                    const d = Math.hypot(c.x - q.x, c.y - q.y) - q.s;
                    if (d < 0 || d > GAME.splitBoost * 0.7) continue;
                    // only ahead of us (eating the tail as we go, not turning back for it)
                    if ((c.x - S.center.x) * ux + (c.y - S.center.y) * uy < -200) continue;
                    if (!best || d < best.d) best = { q, c, d };
                }
            }
            if (best) {
                const cp = predict(best.c, S.L, S.tick), dx = cp.x - best.q.x, dy = cp.y - best.q.y, dl = Math.hypot(dx, dy) || 1;
                if (pathOk(dx / dl, dy / dl)) { split(dx / dl, dy / dl, 'eat'); conn.mode = 'team DNA: split-eating ' + (P.name || 'our teammate') + "'s tail"; return true; }
            }
        }
        // 3) drift forward, leaning into the nearest tail pieces near our way
        // no tail to eat: drift toward a point ahead of the partner, so our paths keep crossing (the braid)
        let aim = CFG.weaveCrossLead < 0 ? { x: S.center.x + ux * 900, y: S.center.y + uy * 900 } : { x: pc.x + ux * CFG.weaveCrossLead, y: pc.y + uy * CFG.weaveCrossLead }, what = 'weaving with ' + (P.name || 'our teammate');
        const onWay = edible.filter(c => { const dx = c.x - S.center.x, dy = c.y - S.center.y, d = Math.hypot(dx, dy) || 1; return d < CFG.weaveEatRange && (dx * ux + dy * uy) / d > CFG.weaveEatCone; });
        if (onWay.length) {
            const nearest = onWay[0];
            let gx = 0, gy = 0, gw = 0;
            for (const c of onWay) if (Math.hypot(c.x - nearest.x, c.y - nearest.y) < 450) { const w = c.s * c.s; gx += c.x * w; gy += c.y * w; gw += w; }
            const tp = predict({ ...nearest, x: gx / gw, y: gy / gw }, S.L, S.tick);
            aim = { x: tp.x + ux * 250, y: tp.y + uy * 250 }; what = 'eating ' + (P.name || 'our teammate') + "'s tail";
        }
        // never touch a partner piece we could eat but mustn't: go round it
        for (const c of keepOff) {
            const q = S.mine.reduce((a2, m) => (canEat(m.s, c.s * 0.97) && (!a2 || Math.hypot(m.x - c.x, m.y - c.y) < Math.hypot(a2.x - c.x, a2.y - c.y)) ? m : a2), null);
            if (!q) continue;
            const d = Math.hypot(q.x - c.x, q.y - c.y);
            if (segDist(c.x, c.y, q.x, q.y, aim.x, aim.y) < q.s + 120 || d < q.s + c.s + 150) {
                const ax = (q.x - c.x) / (d || 1), ay = (q.y - c.y) / (d || 1);
                aim = { x: q.x + ax * 600 + ux * 400, y: q.y + ay * 600 + uy * 400 }; what = 'keeping off ' + (P.name || 'our teammate') + "'s main piece";
                break;
            }
        }
        // a piece of ours about to run into a virus that would pop it: stop weaving, normal steering goes round it
        {
            const al = Math.hypot(aim.x - S.center.x, aim.y - S.center.y) || 1, ax = (aim.x - S.center.x) / al, ay = (aim.y - S.center.y) / al;
            if (S.mine.some(q => popsOn(q.s) && S.viruses.some(v => segDist(v.x, v.y, q.x, q.y, q.x + ax * 450, q.y + ay * 450) < q.s - GAME.virusSize / GAME.eatOverlapDiv + 120)))
                return endRelay(conn, R, 'a virus in the way', 4000, 'virus in the way');
        }
        conn.sendMouse(aim.x, aim.y); conn.botAim = aim;
        conn.mode = 'team DNA: ' + what;
        return true;
    }

    // Pulls for team play, added to the steering pulls.
    function squadPulls(conn, S, pulls, threats) {
        if (!S.squad.length) return;
        // a teammate is mining: if we're in its lane, step out of it sideways (the near side), quickly
        for (const m of S.squad) {
            const L = m.mineLane; if (!L || !m.cells.length) continue;
            const big = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
            const d = segDist(big.x, big.y, L[0], L[1], L[2], L[3]);
            if (d > big.s + CFG.mineLaneWidth + 150) continue;
            const dx = L[2] - L[0], dy = L[3] - L[1], dl = Math.hypot(dx, dy) || 1;
            let nx = -dy / dl, ny = dx / dl;   // perpendicular; take the side we're already on
            if ((S.center.x - L[0]) * nx + (S.center.y - L[1]) * ny < 0) { nx = -nx; ny = -ny; }
            pulls.push({ x: S.center.x + nx * 900, y: S.center.y + ny * 900, noCalm: true, w: 1.2 * S.myMass, label: 'team: out of ' + (m.name || 'a teammate') + "'s mining lane" });
        }
        const { center, maxMine } = S;
        const plan = S.plan;
        if (plan) {
            // formation: our slot beside the others, a little ahead along the heading
            const all = [{ x: center.x, y: center.y, s: Math.sqrt(S.myMass * 100) }, ...S.squad.filter(m => m.cells.length).map(m => { const c = memberCenter(m); return { x: c.x, y: c.y, s: Math.sqrt(m.mass * 100) }; })];
            const tc = centroid(all), sl = plan.slots[conn.memberId];
            if (sl && !(plan.pressed && plan.pressed !== conn.memberId)) {
                let tx = tc.x + sl[0] + Math.cos(plan.dir) * 400, ty = tc.y + sl[1] + Math.sin(plan.dir) * 400;
                // never backwards along the heading: if we're ahead of our slot, only correct sideways and keep going
                { const hx = Math.cos(plan.dir), hy = Math.sin(plan.dir), along = (tx - center.x) * hx + (ty - center.y) * hy;
                  if (along < 150) { tx += hx * (250 - along); ty += hy * (250 - along); } }
                const off = Math.hypot(tx - center.x, ty - center.y);
                // never toward a spot next to a teammate piece that could swallow us (or that we could swallow)
                const mb = S.mine.reduce((a2, c) => (c.s > a2.s ? c : a2));
                const clash = S.mates.some(c => (canEat(c.s, mb.s * 0.9) || canEat(mb.s, c.s * 0.9)) &&
                    (Math.hypot(c.x - tx, c.y - ty) < c.s + mb.s + 250 || segDist(c.x, c.y, mb.x, mb.y, tx, ty) < c.s + mb.s * 0.5 + 100));
                if (!clash) pulls.push({ x: tx, y: ty, noCalm: off > 700, w: CFG.teamTogetherWeight * S.myMass * Math.min(1.5, off / 700), label: 'team plan: in formation' });
            }
            // eat: the pieces assigned to us; hand over ours that are assigned to someone else
            const mineIds = new Set(S.mine.map(c => c.id));
            const myBig = S.mine.reduce((a, c) => (c.s > a.s ? c : a));
            let tgt = null, td = Infinity;
            for (const [eater, cid] of plan.eat) {
                if (eater === conn.memberId) {
                    const c = conn.cells.get(cid);
                    if (c) { const d = Math.hypot(c.x - myBig.x, c.y - myBig.y); if (d < td) { td = d; tgt = c; } }
                } else if (mineIds.has(cid)) {
                    const em = S.squad.find(m => m.from === eater);
                    const eb = em && S.mates.filter(c => c.key === em.key).reduce((a, c) => (!a || c.s > a.s ? c : a), null);
                    const mine = conn.cells.get(cid);
                    // (the user: "it keeps trying to feed a piece the same size as the one it feeds it to" - a piece
                    // they can't eat yet gets shot over with W, it isn't pushed into them)
                    const edible = eb && mine && canEat(eb.s, mine.s * CFG.eatMargin);
                    if (eb && mine && !edible && conn.danger < 0.3 * S.myMass + 1 &&
                        Math.hypot(eb.x - mine.x, eb.y - mine.y) - eb.s < 700 && S.mine.some(c => c.s >= GAME.minEjectSize)) {
                        conn.feedAcross = { x: eb.x, y: eb.y, until: now() + 300 }; // stepSquad fires it
                    }
                    // its size once it has eaten everything we're handing it (that's when our biggest must still be safe)
                    const given = plan.eat.filter(e => e[0] === eater && mineIds.has(e[1])).reduce((a2, e) => { const q = conn.cells.get(e[1]); return a2 + (q && q !== myBig ? q.s * q.s : 0); }, 0);
                    const ebGrown = eb ? Math.sqrt(eb.s * eb.s + given) : 0;
                    if (!edible) { /* not walked in: fed across (above) until it can eat it */ }
                    else if (eb && !canEat(ebGrown, myBig.s * 0.95)) pulls.push({ x: eb.x, y: eb.y, noCalm: true, w: 0.35 * S.myMass, label: 'team plan: handing pieces to ' + (em.name || 'a teammate') });
                    else if (eb && mine && Math.hypot(eb.x - mine.x, eb.y - mine.y) < Math.hypot(eb.x - myBig.x, eb.y - myBig.y) - 150 &&
                        Math.hypot(eb.x - myBig.x, eb.y - myBig.y) - (ebGrown - myBig.s / GAME.eatOverlapDiv) > 320)
                        pulls.push({ x: eb.x, y: eb.y, noCalm: true, w: 0.3 * S.myMass, label: 'team plan: handing pieces to ' + (em.name || 'a teammate') });
                }
            }
            if (tgt) { pulls.push({ x: tgt.x, y: tgt.y, noCalm: true, w: 0.7 * S.myMass, label: 'team plan: eating our pieces' });
                teamlog.start(conn, S, 'collect teammate pieces', { dist: Math.round(Math.hypot(tgt.x - myBig.x, tgt.y - myBig.y)) }, tgt.key, '', 3000); }
            S.collectKeys = new Set(plan.eat.filter(e => e[0] === conn.memberId).map(e => { const c = conn.cells.get(e[1]); return c && c.key; }).filter(Boolean));
            // defend split: the chased one steps off the line, the other splits through it onto the chaser
            if (plan.dsplit) {
                const F = conn.cells.get(plan.dsplit.threat);
                const sm = S.squad.find(m => m.from === (plan.dsplit.victim === conn.memberId ? plan.dsplit.splitter : plan.dsplit.victim));
                if (F && sm) {
                    const oc = memberCenter(sm);
                    if (plan.dsplit.victim === conn.memberId) {
                        // perpendicular to the splitter->chaser line, away from it
                        const lx = F.x - oc.x, ly = F.y - oc.y, ll = Math.hypot(lx, ly) || 1;
                        let px = -ly / ll, py = lx / ll;
                        if ((center.x - oc.x) * px + (center.y - oc.y) * py < 0) { px = -px; py = -py; }
                        pulls.push({ x: center.x + px * 600 - lx / ll * 200, y: center.y + py * 600 - ly / ll * 200, noCalm: true, w: 0.9 * S.myMass, label: 'team plan: clearing the line for ' + (sm.name || 'our teammate') });
                    }
                }
            }
            // kill with cover: go for it
            if (plan.kill && plan.kill.eater === conn.memberId) {
                const P = conn.cells.get(plan.kill.prey);
                if (P) { pulls.push({ x: P.x, y: P.y, noCalm: true, w: 1.2 * S.myMass, label: 'team plan: eating ' + (P.name || 'it') + ' (then we outweigh ' + (plan.kill.coverName || 'the big one') + ')' });
                    teamlog.start(conn, S, 'kill with cover', { prey: P.name || '', cover: plan.kill.coverName || '' }, '', P.key, 4000); }
            }
        }
        // we asked for mass to eat something: stay on it (keep it pinned) until the help arrives - wandering off
        // to farm meant the help came for nothing
        const nd0 = conn.squadNeed;
        if (nd0 && nd0.target && /^to (eat|split-kill)/.test(nd0.why)) {
            const prey = conn.cells.get(nd0.target);
            if (prey) {
                // sit on the side of it that faces our helper, so what the helper sends lands in us, not in it
                const helper = S.squad.filter(m => m.cells.length).map(m => memberCenter(m)).reduce((a, c) => (!a || Math.hypot(c.x - prey.x, c.y - prey.y) < Math.hypot(a.x - prey.x, a.y - prey.y) ? c : a), null) || center;
                const hx = helper.x - prey.x, hy = helper.y - prey.y, hl = Math.hypot(hx, hy) || 1;
                const tx = prey.x + hx / hl * prey.s * 0.45, ty = prey.y + hy / hl * prey.s * 0.45;
                pulls.push({ x: tx, y: ty, noCalm: true, w: CFG.teamHelpWeight * S.myMass, label: 'team: keeping ' + (prey.name || 'it') + ' pinned' });
            }
        }
        for (const m of S.squad) {
            const mc = memberCenter(m), mbig = memberBig(m);
            const d = Math.hypot(mc.x - center.x, mc.y - center.y), gap = d - maxMine - mbig;
            // feeding us: go to it and hold there while the blobs arrive
            // stick together: head for a spot beside the teammate (on our side of it, a comfortable gap away), never
            // its centre, so "come closer" and "don't touch" can't fight each other into a jitter
            const ux = d > 1 ? (center.x - mc.x) / d : 1, uy = d > 1 ? (center.y - mc.y) / d : 0;
            const beside = { x: mc.x + ux * (mbig + maxMine + 200), y: mc.y + uy * (mbig + maxMine + 200) };
            // continuous (no on/off at a threshold, which made them drift apart and lunge back): grows with the gap
            if (gap > 250 && !plan) pulls.push({ x: beside.x, y: beside.y, noCalm: gap > 900 && conn.danger < 0.05 * S.myMass + 1, label: 'team: regroup',
                w: Math.max(CFG.squadNearWeight * Math.min(25, (gap - 250) / 120), CFG.teamTogetherWeight * S.myMass * Math.min(1, (gap - 250) / 1000)) });
            // calm and far apart: meet up (nearer the bigger, slower one) - being together is what makes team play possible
            const calmBoth = conn.danger < 0.05 * S.myMass + 1 && (m.danger || 0) < 0.05 * m.mass + 1;
            if (CFG.teamMeetWeight > 0 && calmBoth && gap > 800) {   // (ramps in smoothly from 800 apart: an on/off threshold makes them lunge and back off)
                const t2 = S.myMass >= m.mass ? 0.35 : 0.65;
                let mx = center.x + (mc.x - center.x) * t2, my = center.y + (mc.y - center.y) * t2;
                if (CFG.routePulls) {
                    const lowFirst = conn.memberId < m.from, A = lowFirst ? center : mc, B = lowFirst ? mc : center;
                    const small = Math.min(maxMine, mbig);
                    const obs = S.enemies.filter(e => !e.remote && canEat(e.s, small * 0.95)).map(e => { const r = threatReach(S, e, small); return r > -Infinity ? [{ x: e.x, y: e.y, r: r + 200 }] : null; }).filter(Boolean);
                    const bigS = Math.max(maxMine, mbig);
                    if (S.mine.length < CFG.maxCells && canEat(bigS, GAME.virusSize) && !S.virusFarm) obs.push(...trapClusters(S.viruses.filter(v => segDist(v.x, v.y, A.x, A.y, B.x, B.y) < 1500), bigS - GAME.virusSize / GAME.eatOverlapDiv + 60));
                    if (obs.length) {
                        const rt = trapRoute(A.x, A.y, B.x, B.y, obs, 0);
                        const straight = Math.hypot(B.x - A.x, B.y - A.y);
                        if (rt[0] > straight * 1.02 && Math.hypot(rt[1] - B.x, rt[2] - B.y) > 300) { mx = rt[1]; my = rt[2]; }
                    }
                }
                pulls.push({ x: mx, y: my, noCalm: true, w: CFG.teamMeetWeight * S.myMass * Math.min(2.5, (gap - 800) / 1000), label: 'team: meeting up with ' + (m.name || 'our teammate') });
            }
            // it's feeding us: its shot blobs are ours - collect them; until they land, hold toward the feeder
            if (m.intent && m.intent.feeding && m.intent.feedingTo === conn.memberId && conn.danger < 0.15 * S.myMass) {
                const blobs = S.food.filter(f => f.eject && S.mateColors.has(f.color) && Math.hypot(f.x - center.x, f.y - center.y) < 1600);
                if (blobs.length) {
                    let bx = 0, by = 0; for (const f of blobs) { bx += f.x; by += f.y; } bx /= blobs.length; by /= blobs.length;
                    pulls.push({ x: bx, y: by, noCalm: true, w: 0.6 * S.myMass, label: 'team: collecting what ' + (m.name || 'our teammate') + ' shot us' });
                }
            }
            // flee together: when either of us is under pressure, the smaller (faster) one follows the bigger one's
            // escape line instead of picking its own way out (two ways out = two lone targets)
            const pressed = conn.danger > 0.1 * S.myMass || m.danger > 0.1 * m.mass;
            const helping = now() - (conn.helpingMate || 0) < 300;   // (the help pull covers this)
            if (!helping && pressed && d < 3000 && typeof m.dir === 'number' && (S.myMass < m.mass || (S.myMass === m.mass && conn.memberId > m.from))) {
                const ahead = { x: beside.x + Math.cos(m.dir) * 900, y: beside.y + Math.sin(m.dir) * 900 };
                pulls.push({ x: ahead.x, y: ahead.y, w: CFG.teamFleeWeight * S.myMass, noCalm: true, label: 'team: fleeing with ' + (m.name || 'a teammate') });
            }
            // chased, and this teammate can eat what's chasing us: run to it (the chaser follows us into its mouth)
            if (conn.danger > 0.1 * S.myMass && threats.some(e => !e.virtual && canEat(mbig, e.s)))
                pulls.push({ x: mc.x, y: mc.y, w: CFG.squadRunWeight * S.myMass, noCalm: true, label: 'team: running to ' + (m.name || 'a teammate') });
            // a teammate in real danger and we're the safer one: go to it so it can dive / split-feed into us and we
            // flee together. Works even against a giant we can't eat - being a safe body to merge into is the help.
            const helpOn = now() - (conn.helpingMate || 0) < 1000;
            const helpRV = (() => { // the meeting point: just ahead of it on its escape line
                const md = typeof m.dir === 'number' ? m.dir : Math.atan2(mc.y - center.y, mc.x - center.x);
                return { x: mc.x + Math.cos(md) * Math.min(600, Math.max(0, gap)), y: mc.y + Math.sin(md) * Math.min(600, Math.max(0, gap)) };
            })();
            // the way there must stay clear of anything that could eat us (else we'd just be walking into its danger and
            // turning back over and over); a little more slack once we're already on our way
            const myBigH = S.mine.reduce((a2, q) => (q.s > a2.s ? q : a2));
            const wayClear = !S.enemies.some(e => { const r = threatReach(S, e, myBigH.s); return r > -Infinity && segDist(e.x, e.y, center.x, center.y, helpRV.x, helpRV.y) < r + (helpOn ? 100 : 350); });
            // (the user: 'green ran away when it could have saved blue'. It used to help only when it was in LESS danger
            // than the one in trouble; now unless clearly worse off - the way there must still be clear)
            if (m.danger > (helpOn ? 0.06 : 0.12) * m.mass && conn.danger < Math.max(m.danger * CFG.helpDangerRatio, 0.15 * S.myMass) && d < 3800 && wayClear) {
                const ax = helpRV.x, ay = helpRV.y;
                conn.helpingMate = now();
                pulls.push({ x: ax, y: ay, noCalm: true, w: CFG.teamRescueWeight * S.myMass * Math.min(1.6, m.danger / (0.12 * m.mass)), label: 'team: going to help ' + (m.name || 'a teammate') });
            }
            // pooling pieces under pressure: close in, so each one's big pieces take the other's small ones
            if (false && conn.teamPool && d < 2000) pulls.push({ x: mc.x, y: mc.y, w: 0.12 * S.myMass, noCalm: true, label: 'team: pooling pieces with ' + (m.name || 'a teammate') });
            // a teammate diving into us to escape: meet it
            if (m.intent && m.intent.merge) { pulls.push({ x: mc.x, y: mc.y, w: 0.5 * m.mass, noCalm: true, label: 'team: catching ' + (m.name || 'a teammate') }); continue; }
            // a teammate's prey we can eat too: get on the far side, so running from it means running into us
            const h = m.intent && m.intent.hunt;
            if (h && canEat(maxMine, h.s)) {
                const c = conn.cells.get(h.id) || h;
                const mine = conn.squadHunt && conn.squadHunt.id === h.id;
                // both after the same one: the nearer one hunts, the other herds
                if (!mine || Math.hypot(c.x - center.x, c.y - center.y) > Math.hypot(c.x - mc.x, c.y - mc.y)) {
                    const herders = [conn.memberId, ...S.squad.filter(o => o.from !== m.from).map(o => o.from)].sort();
                    const n = herders.length, idx = herders.indexOf(conn.memberId);
                    const off = n > 1 ? -0.96 + 1.92 * idx / (n - 1) : 0;
                    const base = Math.atan2(c.y - mc.y, c.x - mc.x) + off, r = c.s + maxMine + 150;
                    if (Math.hypot(c.x - center.x, c.y - center.y) < 3000)
                        pulls.push({ x: c.x + Math.cos(base) * r, y: c.y + Math.sin(base) * r, w: CFG.squadHerdWeight * CFG.herdWeight * mass(c.s), label: 'team: herding' });
                }
            }
            // a teammate asking for mass (to make a kill, or to get out of a chaser's reach): go to it, from wherever we
            // are, if we can spare enough to matter - then the feeding/splitting in happens when we're there
            const nd = m.intent && m.intent.need;
            // (if what it needs saving from is something we can eat, we go for that instead: the defend pull below)
            const ndT = nd && nd.target && S.enemies.find(e => e.id === nd.target);
            const weEatIt = ndT && S.mine.some(q => canEat(q.s, ndT.s) || (q.s >= GAME.minSplitSize && canEat(q.s / SQRT2, ndT.s)));
            if (nd && !conn.squadNeed && S.myMass - CFG.squadKeepMass >= nd.amount * 0.5 && conn.danger < 0.15 * S.myMass) {
                const nc = m.cells.find(r => r[0] === nd.cellId);
                const tx = nc ? nc[1] : mc.x, ty = nc ? nc[2] : mc.y;
                pulls.push({ x: tx, y: ty, noCalm: true, w: CFG.teamHelpWeight * S.myMass * (nd.urgent ? 1.5 : 1), label: 'team: coming to help ' + (m.name || 'a teammate') + ' (' + nd.why + ')' });
            }
            // gathering: the teammate is in pieces; its spare ones (not its biggest) that our biggest can eat are ours
            // to collect - when we're not the much bigger one already, or it's under pressure (then pooling saves mass)
            if (!plan) {
                const myBigC = S.mine.reduce((a2, q) => (q.s > a2.s ? q : a2));
                const theirs = S.mates.filter(c => c.key === m.key);
                const theirBig = theirs.reduce((a2, c) => (!a2 || c.s > a2.s ? c : a2), null);
                const calmish = conn.danger < 0.15 * S.myMass;
                if (calmish && theirs.length >= 2 && (S.myMass <= m.mass * 1.5 || m.danger > 0.1 * m.mass)) {
                    let best = null, bd = Infinity;
                    for (const c of theirs) {
                        if (c === theirBig || !canEat(myBigC.s, c.s)) continue;
                        const grown = Math.sqrt(myBigC.s * myBigC.s + c.s * c.s);
                        if (theirBig && canEat(grown, theirBig.s) && Math.hypot(theirBig.x - c.x, theirBig.y - c.y) < grown - theirBig.s / GAME.eatOverlapDiv + 120) continue;
                        const dd = Math.hypot(c.x - myBigC.x, c.y - myBigC.y);
                        if (dd < 1800 && dd < bd) { bd = dd; best = c; }
                    }
                    if (best) pulls.push({ x: best.x, y: best.y, noCalm: true, w: 0.7 * S.myMass, label: 'team: collecting ' + (m.name || 'a teammate') + "'s pieces" });
                }
                // and the other way round: we're in pieces and its biggest can take our spare ones: steer them in
                const mineSpare = S.mine.filter(q => q !== myBigC && theirBig && canEat(theirBig.s, q.s));
                if (calmish && theirBig && mineSpare.length && !canEat(theirBig.s, myBigC.s * 0.95) && (m.mass <= S.myMass * 1.5 || conn.danger > 0.1 * S.myMass) &&
                    Math.hypot(theirBig.x - S.center.x, theirBig.y - S.center.y) < 1800)
                    pulls.push({ x: theirBig.x, y: theirBig.y, noCalm: true, w: 0.4 * S.myMass, label: 'team: handing pieces to ' + (m.name || 'a teammate') });
            }
            // a teammate in trouble: go for whatever is after it (if we can eat that)
            if (m.danger > 0.1 * m.mass) {
                const small = m.cells.reduce((a, r) => Math.min(a, r[3]), Infinity);
                let best = null;
                for (const e of S.enemies) {
                    if (!canEat(e.s, small) || Math.hypot(e.x - mc.x, e.y - mc.y) > e.s + 1500) continue;
                    if (!S.mine.some(p => canEat(p.s, e.s) || (p.s >= GAME.minSplitSize && canEat(p.s / SQRT2, e.s)))) continue;
                    // the way there must be clear of anything that could eat us (live: a 3,800 bot walked 'defending'
                    // toward a 32,000 teamer and was eaten - this pull had no path check at all)
                    const myBigD = S.mine.reduce((a2, q) => (q.s > a2.s ? q : a2));
                    if (S.enemies.some(o => { if (o === e) return false; const r = threatReach(S, o, myBigD.s);
                        return r > -Infinity && (segDist(o.x, o.y, center.x, center.y, e.x, e.y) < r + 250 || Math.hypot(o.x - e.x, o.y - e.y) < r + o.s); })) continue;
                    const w = Math.max(CFG.squadDefendWeight * CFG.herdWeight * mass(e.s), 1.2 * S.myMass);
                    if (!best || w > best.w) best = { x: e.x, y: e.y, w, noCalm: conn.danger < 0.15 * S.myMass, label: 'team: defending ' + (m.name || 'a teammate') };
                }
                if (best) pulls.push(best);
            }
        }
    }

    // Returns true while team play is controlling the cells (diving into a teammate, or feeding one).
    function stepSquad(conn, S) {
        const stop = () => { conn.squadFeeding = false; conn.feedingTo = null; return false; };
        // just split into a teammate: keep every piece heading into it until they've landed (pieces left to the
        // usual steering for a moment drift back - "pulling back before any of its parts reach the other")
        if (conn.diveHold && now() < conn.diveHold.until && S.mine.length > 1) {
            const tgt = S.mates.filter(c => c.key === conn.diveHold.key).reduce((a, c) => (!a || c.s > a.s ? c : a), null);
            if (tgt) {
                const pt = predict(tgt, S.L, S.tick);
                conn.sendMouse(pt.x, pt.y); conn.botAim = pt;
                conn.mode = 'team: following the split into ' + conn.diveHold.name;
                return true;
            }
        }
        if (!CFG.bot || !S.squad.length) { conn.squadDiving = false; return stop(); }
        const big = S.mine.reduce((a, b) => (b.s > a.s ? b : a));
        // 1. about to be eaten with a teammate right there that could swallow us: dive into it (mass stays ours)
        const host = S.mates.filter(c => canEat(c.s, big.s))
            .reduce((a, c) => (!a || Math.hypot(c.x - big.x, c.y - big.y) - c.s < Math.hypot(a.x - big.x, a.y - big.y) - a.s ? c : a), null);
        if (host) {
            const hostGap = Math.hypot(host.x - big.x, host.y - big.y) - (host.s - big.s / GAME.eatOverlapDiv);
            const killer = S.enemies.find(e => canEat(e.s, big.s) &&
                Math.hypot(e.x - big.x, e.y - big.y) - (e.s - big.s / GAME.eatOverlapDiv) < Math.max(160, moveSpeed(e.s) * 6));
            if (killer && hostGap < 900 && (conn.squadDiving || conn.danger > 0.3 * S.myMass)) {
                if (!conn.squadDiving) { hud.flash(`team: ${killer.name || 'someone'} is about to eat us — diving into ${host.name || 'a teammate'}`);
                    teamlog.start(conn, S, 'dive into teammate', { threat: killer.name || '', gap: Math.round(hostGap) }, host.key, killer.key, 4000); }
                conn.squadDiving = true;
                conn.squadMerge = true;
                const p = predict(host, S.L, S.tick);
                conn.sendMouse(p.x, p.y);
                conn.botAim = p;
                conn.mode = 'team: diving into ' + (host.name || 'a teammate');
                return true;
            }
        }
        conn.squadDiving = false;
        // 1b. doomed and no teammate can swallow us: shoot our mass into the nearest safe teammate first, so the
        //     killer only gets the scraps (it's ours either way, and lighter we might even get away)
        {
            const killer = S.enemies.find(e => canEat(e.s, big.s) &&
                Math.hypot(e.x - big.x, e.y - big.y) - (e.s - big.s / GAME.eatOverlapDiv) < Math.max(220, moveSpeed(e.s) * 8));
            // really doomed: it's flying at us (a split) or at least as fast as we are. A slower chaser can be outrun,
            // and standing still to shoot is what lets it catch us
            const catching = killer && (isFast(killer.vx, killer.vy, killer.s) || moveSpeed(killer.s) >= moveSpeed(big.s) * 0.97);
            if (killer && catching && conn.danger > 0.3 * S.myMass && S.mine.some(c => c.s >= GAME.minEjectSize)) {
                const safe = S.mates.filter(c => !canEat(killer.s, c.s) || Math.hypot(killer.x - c.x, killer.y - c.y) > killer.s + 900)
                    .filter(c => Math.hypot(c.x - big.x, c.y - big.y) - c.s - big.s < GAME.virusSplitBoost * 0.8)
                    .reduce((a, c) => (!a || Math.hypot(c.x - big.x, c.y - big.y) < Math.hypot(a.x - big.x, a.y - big.y) ? c : a), null);
                if (safe) {
                    if (!conn.squadDumping) hud.flash(`team: ${killer.name || 'someone'} is about to eat us — shooting our mass into ${safe.name || 'a teammate'}`);
                    conn.squadDumping = true;
                    return feedInto(conn, S, safe, 'team: dumping mass into ' + (safe.name || 'a teammate'), {});
                }
            }
            conn.squadDumping = false;
        }
        // 1c. chased by something that can eat us, a teammate within split reach and NOT toward the chaser: split
        //     into the teammate. It swallows that half (saved, and it grows), and our remaining half is lighter and
        //     faster. (Splitting fires every piece, so only from one or two pieces.)
        // (only from a single cell: splitting fires every piece, and with two the teammate ends up eating all four)
        const ds = S.plan && S.plan.dsplit;
        if (ds && ds.splitter === conn.memberId && now() - conn.lastAction > 700 && S.mine.length <= 2) {
            const F = conn.cells.get(ds.threat);
            const half = big.s / SQRT2;
            if (F && canEat(half, F.s * CFG.eatMargin)) {
                const p2 = predict(F, S.L + 2, S.tick);
                // the line must miss the teammate (and anything else our half shouldn't touch)
                const clear = S.mates.every(c => segDist(c.x, c.y, big.x, big.y, p2.x, p2.y) > c.s + half * 0.6 + 40);
                if (clear && Math.hypot(p2.x - big.x, p2.y - big.y) - big.s < GAME.splitBoost * 0.75) {
                    conn.sendMouse(p2.x, p2.y);
                    conn.sendSplit(1);
                    conn.lastAction = now();
                    conn.lockUntil = now() + 250; conn.lockTargetId = 0; conn.lockAim = p2;
                    conn.botAim = p2;
                    conn.mode = 'team plan: split onto ' + (F.name || 'the chaser') + ' to save our teammate';
                    teamlog.start(conn, S, 'split onto chaser (defend)', { threat: F.name || '', dist: Math.round(Math.hypot(p2.x - big.x, p2.y - big.y) - big.s) }, '', F.key);
                    hud.flash('team: split onto ' + (F.name || 'the chaser') + ' to save our teammate');
                    return true;
                }
            }
        }
        if (conn.feedAcross && now() < conn.feedAcross.until) {
            const fa = conn.feedAcross;
            conn.sendMouse(fa.x, fa.y);
            if (S.tick % 2 === 0) conn.sendEject();
            conn.botAim = fa; conn.mode = 'team plan: feeding across the line';
            return true;
        }
        if (CFG.teamSplitEscape && big.s >= GAME.minSplitSize && now() - conn.lastAction > 900 && S.mine.length <= 2) {
            // about to be eaten: by touch soon, or by its split
            const chaser = S.enemies.filter(e => {
                const d = Math.hypot(e.x - big.x, e.y - big.y);
                if (canEat(e.s, big.s) && d - (e.s - big.s / GAME.eatOverlapDiv) < 650) return true;
                const sr = enemySplitReach(e, big.s, S.ownerCount.get(e.key) || 1);
                return sr > -Infinity && d < sr + 250;
            }).reduce((a, e) => (!a || Math.hypot(e.x - big.x, e.y - big.y) < Math.hypot(a.x - big.x, a.y - big.y) ? e : a), null);
            const poolNow = S.plan && S.plan.pool && S.plan.pool.diver === conn.memberId ? S.enemies.find(e => e.id === S.plan.pool.threat) : null;
            const chaser2 = chaser || poolNow;
            if (chaser2 && (conn.danger > 0.25 * S.myMass || poolNow)) {
                const chaser = chaser2;
                const cx = chaser.x - big.x, cy = chaser.y - big.y, cl = Math.hypot(cx, cy) || 1;
                let pick = null;
                for (const T of S.mates) {
                    const tx = T.x - big.x, ty = T.y - big.y, tl = Math.hypot(tx, ty) || 1;
                    if ((tx * cx + ty * cy) / (tl * cl) > 0.3) continue;              // not toward the chaser
                    const D = tl - T.s * 0.6;                                          // our front piece has to get inside it
                    let k = 0;
                    for (let j = 1; j <= 4; j++) {
                        if (big.s / Math.pow(SQRT2, j - 1) < GAME.minSplitSize) break;
                        if (S.mine.length * Math.pow(2, j) > GAME.maxCells + S.mine.length) break;
                        if (GAME.splitDistance * j + GAME.splitBoost * 0.85 >= D) { k = j; break; }
                    }
                    if (!k) continue;
                    const front = big.s / Math.pow(SQRT2, k);
                    if (!canEat(T.s, front * 1.03)) continue;
                    if (!lineClear(S, big.x, big.y, T.x, T.y, conn.mateKeys.has(T.key) ? T.key : null)) continue;
                    if (!pick || k < pick.k || (k === pick.k && T.s > pick.T.s)) pick = { T, k };
                }
                if (pick) {
                    const T = pick.T, p = predict(T, S.L, S.tick);
                    conn.sendMouse(p.x, p.y);
                    conn.sendSplit(pick.k);
                    conn.lastAction = now();
                    conn.lockUntil = now() + 400; conn.lockTargetId = 0; conn.lockAim = p;
                    conn.diveHold = { until: now() + 1200, key: T.key, name: T.name || 'our teammate' };
                    // (no merge flag: our pieces are spare pieces to the teammate, but our biggest stays protected)
                    conn.botAim = p;
                    teamlog.start(conn, S, 'split into teammate (escape)', { k: pick.k, dist: Math.round(Math.hypot(T.x - big.x, T.y - big.y) - T.s), threat: chaser.name || '' }, T.key, chaser.key);
                    conn.mode = 'team: split x' + pick.k + ' into ' + (T.name || 'a teammate') + ' to escape ' + (chaser.name || 'a chaser');
                    hud.flash(`team: split x${pick.k} into ${T.name || 'our teammate'} to get away from ${chaser.name || 'a chaser'}`);
                    return true;
                }
            }
        }
        if (false) {
            // a chaser that can actually catch us soon (not a big player still well away)
            const chaser = S.enemies.filter(e => canEat(e.s, big.s / SQRT2) && Math.hypot(e.x - big.x, e.y - big.y) - (e.s - big.s / GAME.eatOverlapDiv) < 500)
                .reduce((a, e) => (!a || Math.hypot(e.x - big.x, e.y - big.y) < Math.hypot(a.x - big.x, a.y - big.y) ? e : a), null);
            const tooClose = chaser && Math.hypot(chaser.x - big.x, chaser.y - big.y) < chaser.s - big.s / GAME.eatOverlapDiv + 450;
            if (chaser && !tooClose && conn.danger > 0.2 * S.myMass) {
                const reach = GAME.splitDistance + GAME.splitBoost * 0.9;
                const cx = chaser.x - big.x, cy = chaser.y - big.y, cl = Math.hypot(cx, cy) || 1;
                const T = S.mates.filter(c => canEat(c.s, big.s / SQRT2 * 1.03))
                    // a bit away from us (250+ edge to edge), so only the half that flies over gets eaten, not the half that stays
                    .filter(c => { const tx = c.x - big.x, ty = c.y - big.y, tl = Math.hypot(tx, ty) || 1; return tl - c.s < reach && tl - c.s - big.s >= 250 && (tx * cx + ty * cy) / (tl * cl) < 0; })
                    .filter(c => lineClear(S, big.x, big.y, c.x, c.y, conn.mateKeys.has(c.key) ? c.key : null))
                    .reduce((a, c) => (!a || c.s > a.s ? c : a), null);
                if (T) {
                    const p = predict(T, S.L, S.tick);
                    conn.sendMouse(p.x, p.y);
                    conn.sendSplit(1);
                    conn.lastAction = now();
                    conn.lockUntil = now() + 200; conn.lockTargetId = 0; conn.lockAim = p;
                    conn.mergeUntil = now() + 1500; // let the teammate swallow our half without flinching
                    conn.botAim = p;
                    conn.mode = 'team: split into ' + (T.name || 'a teammate') + ' to escape ' + (chaser.name || 'a chaser');
                    hud.flash(`team: split into ${T.name || 'our teammate'} to get away from ${chaser.name || 'a chaser'}`);
                    return true;
                }
            }
        }
        const mateAsks = S.squad.some(m => m.intent && m.intent.need && m.intent.need.urgent);
        if (!mateAsks && (relayActive(conn) || now() < (conn.relayCooldown || 0) - 2000)) return stop(); // the relay moves our mass then
        // carry mode: the carrier never gives mass away (it's the one being grown)
        if (conn.isCarrier) return stop();
        // 2. who gets our mass? A teammate that asks (urgent first) unless we need it more ourselves;
        //    otherwise the bigger teammate, while we have spare (the smaller one pumps into the bigger)
        const canShoot = S.mine.some(c => c.s >= GAME.minEjectSize);
        if (!canShoot) return stop();
        let to = null, need = null;
        for (const m of S.squad) {
            const n = m.intent && m.intent.need;
            if (!n || (conn.squadNeed && (conn.squadNeed.urgent || !n.urgent))) continue;
            // a kill we can make ourselves (by touching or one split) isn't worth handing our mass over for, and
            // nor is escaping something we can eat: we go and eat it instead (the defend pull)
            const T = n.target && S.enemies.find(e => e.id === n.target);
            if (T && /^to split-kill/.test(n.why)) { if (S.mine.some(p => p.s >= GAME.minSplitSize && canEat(p.s / SQRT2, T.s * CFG.eatMargin) && Math.hypot(T.x - p.x, T.y - p.y) - p.s < GAME.splitBoost * 0.8)) continue; } // (a split-kill request: only if we could split-kill it ourselves right now; catching a fast one by touch doesn't count)
            else if (T && S.mine.some(p => canEat(p.s, T.s) || (p.s >= GAME.minSplitSize && canEat(p.s / SQRT2, T.s)))) continue;
            if (!need || (n.urgent && !need.urgent) || (n.urgent === need.urgent && n.amount < need.amount)) { need = n; to = m; }
        }
        if (to) {
            if (S.myMass <= CFG.squadKeepMass + (need.urgent ? 0 : 40)) return stop();
        } else {
            // (the user, 2026-10-20: stop evening out - bigger cells mine, hunt and reach the leaderboard; even teams
            // kept everyone under the 2300 mining line). Off unless teamEvenOut.
            if (!CFG.teamEvenOut) return stop();
            // calm: keep the team even. The bigger one shoots mass into the smaller until they're about level
            // (a team of two mid-size cells covers more, dodges better, and can still pool mass for a kill)
            const smaller = S.squad.filter(m => m.cells.length && m.mass < S.myMass).reduce((a, m) => (!a || m.mass < a.mass ? m : a), null);
            if (!smaller) return stop();
            // the smaller one is being chased: go and deal with that first (the defend pull), balance later
            if (smaller.danger > 0.1 * smaller.mass) return stop();
            // ...or anything that could eat it is about: feeding it now just makes a better meal
            {
                const sc = memberCenter(smaller), ss = memberBig(smaller);
                const going = conn.squadFeeding && conn.feedingTo === smaller.from;   // already at it: stop only for clearly more
                if (S.enemies.some(e => canEat(e.s, ss) && Math.hypot(e.x - sc.x, e.y - sc.y) < (going ? 1300 : 1800) + e.s)) return stop();
            }
            const even = (S.myMass + smaller.mass) / 2;
            { const going = conn.squadFeeding && conn.feedingTo === smaller.from;
              if (conn.danger > (going ? 0.08 : 0.03) * S.myMass + 1 || threatNear(S, going ? 700 : 1200) || nearMine(S)) return stop(); }
            const total = S.myMass + smaller.mass;
            if (conn.squadFeeding && conn.feedingTo === smaller.from) { if (smaller.mass >= total * 0.34 || S.myMass <= even * 1.08) { conn.balanceCooldown = now() + 30000; return stop(); } }
            else if (now() < (conn.balanceCooldown || 0)) return stop();
            else if (smaller.mass > total * CFG.teamBalanceBelow || S.myMass - even < 150) return stop();
            // something worth eating in view: hunt first, hand mass out later
            { const h = bestHunt(S); if (h && h.m >= 0.1 * S.myMass) return stop(); }
            to = smaller;
        }
        // a teammate about to be caught: if a split's worth won't save it and it can swallow us, jump in whole
        // (it gets all our mass at once and is out of the chaser's reach; the mass stays in the team)
        if (need && need.urgent && to) {
            const hostCells = S.mates.filter(c => c.key === to.key && canEat(c.s, big.s));
            const host = hostCells.find(c => c.id === need.cellId) || hostCells[0];
            const half = S.mine.reduce((a, c) => a + (c.s >= GAME.minSplitSize ? mass(c.s) / 2 : 0), 0);
            // worth it when swallowing us makes it safe (we respawn; the mass lives on in the teammate), and only if
            // the way there doesn't take us past the chaser
            const chaser = need.target && S.enemies.find(e => e.id === need.target);
            const pathClear = !chaser || !host || segDist(chaser.x, chaser.y, big.x, big.y, host.x, host.y) > chaser.s + big.s;
            // (never into one piece of a broken-up teammate: that piece gets bigger, the player doesn't get saved - it should
            // pour into US instead; the user, 2026-10-20)
            const toBroken = to.cells.length >= 3 && host && mass(host.s) < 0.5 * (to.mass || 1);
            if (host && !toBroken && (half < need.amount || S.mine.length >= GAME.maxCells) && S.myMass * 0.9 >= need.amount && pathClear &&
                Math.hypot(host.x - big.x, host.y - big.y) - host.s < 1500) {
                if (!conn.squadRescuing) hud.flash(`team: jumping into ${to.name || 'our teammate'} to save it (${need.why})`);
                conn.squadRescuing = true;
                conn.squadMerge = true;
                const p = predict(host, S.L, S.tick);
                conn.sendMouse(p.x, p.y);
                conn.botAim = p;
                conn.mode = 'team: jumping in to save ' + (to.name || 'a teammate');
                return true;
            }
        }
        conn.squadRescuing = false;
        // suicide-to-save: it can't swallow us whole, but our pieces it can - split everything into it at once
        if (need && need.urgent && to && !/^to (eat|split-kill)/.test(need.why) && S.myMass * 0.9 >= need.amount && conn.danger < 0.35 * S.myMass + 1) {
            const cellsT = S.mates.filter(c => c.key === to.key);
            const tgtC = cellsT.find(c => c.id === need.cellId) || cellsT.reduce((a, c) => (!a || c.s > a.s ? c : a), null);
            const chaser = need.target && S.enemies.find(e => e.id === need.target);
            // only for a teammate about to be eaten (not just 'near a split'), and only when we can't simply swallow it
            // (then it dives into us - the better move)
            const close = chaser && tgtC && Math.hypot(chaser.x - tgtC.x, chaser.y - tgtC.y) - (chaser.s - tgtC.s / GAME.eatOverlapDiv) < 600;
            if (tgtC && /^out of/.test(need.why) && (to.danger || 0) > 0.3 * to.mass && close && !canEat(big.s, tgtC.s)) {
                const k = pumpSplits(big.s, tgtC.s);
                const edge = Math.hypot(tgtC.x - big.x, tgtC.y - big.y) - tgtC.s;
                const clear = !chaser || segDist(chaser.x, chaser.y, big.x, big.y, tgtC.x, tgtC.y) > chaser.s + big.s * 0.5;
                if (k >= 1 && S.mine.length * Math.pow(2, k) <= GAME.maxCells + S.mine.length && clear) {
                    const p = predict(tgtC, S.L, S.tick);
                    if (edge < GAME.splitBoost * 0.75 + 60 * k && now() - conn.lastAction > 300) {
                        conn.sendMouse(p.x, p.y); conn.sendSplit(k);
                        conn.lastAction = now(); conn.lockUntil = now() + 400; conn.lockTargetId = 0; conn.lockAim = p; conn.botAim = p;
                        conn.diveHold = { until: now() + 1500, key: to.key, name: to.name || 'our teammate' };
                        conn.squadMerge = true;
                        hud.flash('team: splitting everything into ' + (to.name || 'our teammate') + ' to save it (' + need.why + ')');
                        teamlog.start(conn, S, 'suicide to save', { k, dist: Math.round(edge), threat: chaser ? chaser.name || '' : '' }, to.key, chaser ? chaser.key : '', 4000);
                        conn.mode = 'team: splitting x' + k + ' into ' + (to.name || 'a teammate') + ' to save it';
                        return true;
                    }
                    if (edge < 2600) {
                        conn.sendMouse(p.x, p.y); conn.botAim = p;
                        conn.mode = 'team: rushing to save ' + (to.name || 'a teammate');
                        return true;
                    }
                }
            }
        }
        // feeding (shots or a split-in) only while WE are safe: feeding a teammate while being hunted throws mass away
        if (conn.danger > (need && need.urgent ? 0.35 : 0.12) * S.myMass + 1) return stop();
        if (nearMine(S) && !(need && need.urgent)) return stop();       // about to mine: keep our mass (the user's 2300 rule)
        if (threatNear(S, 250) && !(need && need.urgent)) return stop();
        // busy hunting something ourselves (and nobody urgent): finish that first
        if (conn.squadHunt && !need) return stop(); // (a teammate's request comes before our own hunt)
        const cells = S.mates.filter(c => c.key === to.key);
        if (!cells.length) { conn.squadFeeding = true; conn.feedingTo = to.from; return false; } // out of sight: the regroup pull brings us
        const tgt = (need && cells.find(c => c.id === need.cellId)) || cells.reduce((a, c) => (c.s > a.s ? c : a));
        conn.squadFeeding = true;
        conn.feedingTo = to.from;
        // urgent: split the mass in, it arrives at once (the "teaming split"); otherwise shoot it over
        return feedInto(conn, S, tgt, `team: feeding ${to.name || 'a teammate'}` + (need ? ` (${need.why})` : ''),
            // (split-feeding sends half of every piece: from several pieces that is all of us, so only from one or two)
            { splitIn: !!(need && need.urgent) && S.mine.length <= 2, standoff: true, clearLine: !(need && /^to (eat|split-kill)/.test(need.why)),
              prey: need && /^to (eat|split-kill)/.test(need.why) ? S.enemies.find(e => e.id === need.target) : null });
    }

    // ---------------------------------------------------------------- autopilot: virus feast
    // At the piece limit the server can't pop us (distributeCellMass has no room), so a virus is just
    // 100 mass (164 when fed 4 times). Every 5th hit resets it and launches a new 100-mass virus ~880
    // away: shooting 80 mass into one makes 100 mass of new food. With all pieces firing at once, a
    // round of shots is about one new virus.
    function feastViable(S) {
        return (S.mine.length >= GAME.maxCells || S.virusFarm) && S.myMass >= CFG.virusFeastMinMass &&
            now() >= (S.conn.virusCapUntil || 0) && !threatNear(S, 300);
    }
    function findFeast(S) {
        if (!feastViable(S)) return null;
        let best = null, bd = Infinity;
        let spread = 0;
        for (const m of S.mine) spread = Math.max(spread, Math.hypot(m.x - S.center.x, m.y - S.center.y));
        for (const v of S.viruses) {
            if (v.remote || !S.mine.some(m => canEat(m.s, v.s))) continue;
            const d = Math.hypot(v.x - S.center.x, v.y - S.center.y);
            if (d > 700 + spread || d >= bd) continue;
            // nobody else close enough to the virus to eat our blobs (or the new virus)
            if (S.enemies.some(e => Math.hypot(e.x - v.x, e.y - v.y) < e.s + 500)) continue;
            best = v; bd = d;
        }
        if (!best) return null;
        hud.flash('virus feast: at the piece limit, shooting and eating viruses');
        return { vId: best.id, startSize: best.s, maxSize: best.s, launches: 0, ticks: 0, until: now() + 5000 };
    }
    function stepFeast(conn, S) {
        const f = conn.feast, t = now();
        const end = (msg) => {
            conn.feast = null;
            if (conn.dashEjects.size) conn.collectUntil = t + CFG.collectMs;
            if (msg) hud.flash(msg + (conn.dashEjects.size ? ` — collecting ${conn.dashEjects.size} blobs` : ''));
            return false;
        };
        // dropping below the limit (a merge) makes viruses dangerous again: stop at once
        if (S.mine.length < GAME.maxCells && !S.virusFarm) return end('virus feast: below the piece limit, stopping');
        if (!feastViable(S)) return end('virus feast: stopped');
        if (t > f.until) return end('virus feast: done');
        const v = conn.cells.get(f.vId);
        if (!v) {
            // eaten (by us, normally): carry on with the next one in reach
            const next = findFeast(S);
            if (!next) return end(`virus feast: done (${f.launches} new viruses made)`);
            next.launches = f.launches; next.until = f.until;
            conn.feast = next;
            return stepFeast(conn, S);
        }
        f.ticks++;
        if (v.s < f.maxSize - 5) { f.launches++; f.maxSize = v.s; } // reset to 100 = it just launched a new virus
        f.maxSize = Math.max(f.maxSize, v.s);
        // never grew while we shot at it: the server is at its virus cap and ignores feeding
        if (f.ticks > Math.ceil(S.L) + 10 && f.maxSize <= f.startSize + 1 && !f.launches) {
            if (CFG.virusCap) conn.virusCapUntil = t + 20000;
            return end('virus feast: viruses aren\'t taking mass (virus cap), just eating');
        }
        // every piece moves onto the virus (we can't pop: we're at the limit). Every piece >= 100 also
        // shoots when we do, so only fire once most of them are close enough for the ±0.3 rad spread
        // to still hit; blobs from far-off pieces just scatter and have to be collected.
        const p = predict(v, S.L, S.tick);
        const shooters = S.mine.filter(m => m.s >= GAME.minEjectSize);
        const inRange = shooters.filter(m => Math.hypot(v.x - m.x, v.y - m.y) - m.s < CFG.virusFeastRange).length;
        // every piece shoots: with many pieces, only once nearly all of them are around the virus (or the shots scatter)
        const fire = shooters.length && inRange / shooters.length >= (shooters.length > 4 ? 0.85 : 0.6) && shrinkSafe(S, shooters, SHOTS_LOSS);
        conn.sendMouse(p.x, p.y);
        if (fire) conn.sendEject();
        conn.botAim = p;
        conn.mode = fire ? `feast (shooting, ${f.launches} made)` : 'feast (closing in)';
        if (!fire) f.ticks = Math.min(f.ticks, Math.ceil(S.L)); // the virus-cap check only counts firing time
        return true;
    }

    // ---------------------------------------------------------------- autopilot: dash-feeding
    // Running from something with open space ahead: every cell >= minEjectSize shoots mass along the
    // mouse direction, so we shed mass forward. Lighter cells move faster (speed ~ size^-0.44), rear
    // pieces pour into the front one, and the mass lands ~880 ahead on our own path. Heading is locked
    // for the whole run (no wobble). Afterwards we "collect": steer back over every blob we shot.

    // something that can eat one of my cells by moving is close behind (relative to heading u)
    function chasedFrom(S, ux, uy) {
        for (const e of S.enemies) {
            const rx = e.x - S.center.x, ry = e.y - S.center.y;
            if (rx * ux + ry * uy > 0) continue; // not behind
            for (const m of S.mine)
                if (canEat(e.s, m.s) && Math.hypot(e.x - m.x, e.y - m.y) < e.s - m.s / GAME.eatOverlapDiv + 900) return true;
        }
        return false;
    }

    // nothing ahead that would eat our mass (any player), get fed by it (viruses), or stop us (the wall)
    function corridorClear(S, ux, uy) {
        const len = CFG.dashCorridor, halfW = S.maxMine + 300; // ejects spread ±0.3 rad
        const blocks = c => {
            const rx = c.x - S.center.x, ry = c.y - S.center.y;
            const along = rx * ux + ry * uy;
            if (along < -S.maxMine * 0.5 || along > len + c.s) return false;
            return Math.abs(rx * uy - ry * ux) < halfW + c.s;
        };
        for (const e of S.enemies) if (blocks(e) && (e.x - S.center.x) * ux + (e.y - S.center.y) * uy > 0) return false;
        for (const v of S.viruses) if (blocks(v)) return false;
        const b = S.border;
        if (b) {
            const tx = ux > 0 ? (b.maxX - S.center.x) / ux : ux < 0 ? (b.minX - S.center.x) / ux : Infinity;
            const ty = uy > 0 ? (b.maxY - S.center.y) / uy : uy < 0 ? (b.minY - S.center.y) / uy : Infinity;
            if (Math.min(tx, ty) < len * 0.8) return false;
        }
        return true;
    }

    // an enemy piece under split boost, heading at one of mine, that could eat it
    function splitIncoming(S) {
        for (const e of S.enemies) {
            if (e.vt < S.tick - 1 || !isFast(e.vx, e.vy, e.s)) continue;
            const v = Math.hypot(e.vx, e.vy) || 1;
            for (const m of S.mine) {
                if (!canEat(e.s, m.s)) continue;
                const dx = m.x - e.x, dy = m.y - e.y, d = Math.hypot(dx, dy) || 1;
                if (d < 1600 && (dx * e.vx + dy * e.vy) / (d * v) > 0.8) return true;
            }
        }
        return false;
    }
    // some piece of mine is within `extra` of the split reach of someone fairly likely to use it
    function inLikelySplitRange(S, extra) {
        for (const e of S.enemies) {
            const oc = S.ownerCount.get(e.key) || 1;
            for (const m of S.mine) {
                const sr = enemySplitReach(e, m.s, oc);
                if (sr > -Infinity && splitLikelihood(e, m.s, oc, S) >= 0.3 && Math.hypot(e.x - m.x, e.y - m.y) < sr + extra) return true;
            }
        }
        return false;
    }

    const angDiff = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };

    // returns true while it is controlling the cells
    // Shooting shrinks every piece, including the back end. If a chaser can't split-kill a piece right now
    // (the piece is bigger than its split halves can eat), shooting must not shrink it across that line.
    // True if every piece that shoots can lose `loss` more mass and still be out of reach of every
    // nearby player's single (and, for humans, double) split.
    const dashKeepsSplitSafe = (S, loss) => shrinkSafe(S, S.mine, loss);

    // Safety budget, for everything that shoots mass: losing `loss` mass from each of `pieces` must not
    // carry any of them across a nearby player's line, i.e. from "can't eat it by touching" to "can",
    // or from "out of its split's reach" to "in it" (single split for bots, double for humans).
    function shrinkSafe(S, pieces, loss) {
        for (const p of pieces) {
            if (p.s < GAME.minEjectSize) continue; // doesn't shoot, doesn't shrink
            const after = Math.sqrt(Math.max(1, p.s * p.s - loss * 100));
            for (const e of S.enemies) {
                if (Math.hypot(e.x - p.x, e.y - p.y) > e.s + 2500) continue;
                const oc = S.ownerCount.get(e.key) || 1;
                if (!canEat(e.s, p.s * 1.05) && canEat(e.s, after * 1.05)) return false;   // with a little margin
                const safeNow = enemySplitReach(e, p.s * 1.05, oc) === -Infinity;
                const safeAfter = enemySplitReach(e, after * 1.05, oc) === -Infinity;
                if (safeNow && !safeAfter) return false;
            }
        }
        return true;
    }
    const SHOTS_LOSS = 3 * GAME.ejectLoss ** 2 / 100; // the next three shots: 48 mass

    function stepDash(conn, S, move) {
        const t = now();
        const d = conn.dash;
        if (d) {
            const stop = (msg) => {
                conn.dash = null;
                conn.dashCooldown = t + 3000;
                if (conn.dashEjects.size) conn.collectUntil = t + CFG.collectMs;
                if (msg) hud.flash(msg + (conn.dashEjects.size ? ` — collecting ${conn.dashEjects.size} blobs` : ''));
                return false;
            };
            // the planner found a clearly better way out than straight ahead (new threat from the front/side)
            const straight = move.scored.filter(c => !c.gather).reduce((a, c) => (angDiff(c.a, d.a) < angDiff(a.a, d.a) ? c : a));
            if (move.best.score > straight.score + 0.15 * S.myMass + 20 && angDiff(move.best.a, d.a) > 0.6)
                return stop('dash: changing course');
            if (!chasedFrom(S, d.ux, d.uy)) { if (++d.calm > 8) return stop('dash: got away'); } else d.calm = 0;
            if (!corridorClear(S, d.ux, d.uy)) return stop('dash: path ahead not clear');
            // a split piece flying at us: the locked heading can't dodge it, normal steering can
            if (splitIncoming(S)) return stop('dash: split coming at us, dodging');
            if (S.myMass < d.startMass * CFG.dashMinMassFrac) return stop('dash: shot enough');
            if (!S.mine.some(c => c.s >= GAME.minEjectSize)) return stop('dash: too small to shoot');
            if (t - d.start > CFG.dashMaxMs) return stop('dash: done');
            // the next few shots would make a piece small enough for someone's split: stop now
            if (!dashKeepsSplitSafe(S, 3 * mass(GAME.ejectLoss))) return stop('dash: stopped before a piece got small enough to be split on');
            const aim = { x: S.center.x + d.ux * 1200, y: S.center.y + d.uy * 1200 };
            conn.sendMouse(aim.x, aim.y);
            conn.sendEject();
            conn.botAim = aim;
            conn.botDir = d.a;
            conn.mode = 'dash';
            return true;
        }
        // start one?
        if (t < conn.dashCooldown || move.split || conn.dashEjects.size || isNaN(conn.botDir) || S.mergeKeys.size) return false;
        if (!S.mine.some(c => c.s >= GAME.minEjectSize) || S.myMass < CFG.dashMinMass) return false;
        // every piece over 100 fires: in many pieces the mass just scatters (and the pieces stay small)
        if (S.mine.length > 4) return false;
        // a whole dash sheds up to (1 - dashMinMassFrac) of our mass; don't start if that would put any
        // piece within reach of a split that can't touch it now
        if (!dashKeepsSplitSafe(S, S.myMass * (1 - CFG.dashMinMassFrac) / Math.max(1, S.mine.filter(c => c.s >= GAME.minEjectSize).length))) return false;
        const a = conn.botDir, ux = Math.cos(a), uy = Math.sin(a);
        // running straight: the last ~10 headings all agree
        if (conn.dirHist.length < 8 || conn.dirHist.some(h => angDiff(h, a) > 0.2)) return false;
        if (!chasedFrom(S, ux, uy) || !corridorClear(S, ux, uy)) return false;
        // running in a straight line inside someone's split range is standing still for their split
        if (inLikelySplitRange(S, 300)) return false;
        conn.dash = { a, ux, uy, start: t, startMass: S.myMass, calm: 0 };
        conn.dashEjects.clear();
        hud.flash('dash: shooting forward to run faster');
        return stepDash(conn, S, move);
    }

    // ---------------------------------------------------------------- autopilot: consolidate
    // Every cell >= minEjectSize ejects toward the mouse at once, and our cells eat our own
    // ejected mass. With the mouse parked on the biggest piece, all the others pour into it:
    // one big cell plus a few small ones, instead of 16 snackable bits.
    // A teaming group (a teamer plus the partners we've seen it with, nearby) as one cell: its total
    // size at its biggest piece. Feeding turns that total into one chaser within seconds.
    function teamBlobs(S) {
        if (S.teamBlobs) return S.teamBlobs;
        const groups = new Map();
        for (const e of S.enemies) { if (!groups.has(e.key)) groups.set(e.key, []); groups.get(e.key).push(e); }
        const out = [];
        for (const [key, g] of groups) {
            if (!isTeamer(key)) continue;
            const A = g.reduce((a, c) => (c.s > a.s ? c : a));
            let m = g.reduce((a, c) => a + c.s * c.s, 0);
            const tm = teamers.get(key);
            for (const mk of tm ? tm.mates : []) for (const c of groups.get(mk) || []) if (Math.hypot(c.x - A.x, c.y - A.y) < 1500 + A.s) m += c.s * c.s;
            out.push({ key, name: A.name, x: A.x, y: A.y, s: Math.sqrt(m), clan: '', skin: '' });
        }
        return S.teamBlobs = out;
    }

    function threatNear(S, extra) {
        // a whole team counts too (as one cell of their combined size, assumed willing to split)
        for (const T of teamBlobs(S)) for (const m of S.mine) {
            const reach = Math.max(canEat(T.s, m.s) ? T.s - m.s / GAME.eatOverlapDiv + 600 : -Infinity, splitReach(T.s, m.s, 1, 2, true) + CFG.teamerReachExtra);
            if (reach > -Infinity && Math.hypot(T.x - m.x, T.y - m.y) < reach + extra) return true;
        }
        for (const e of S.enemies) {
            const oc = S.ownerCount.get(e.key) || 1;
            for (const m of S.mine) {
                const reach = Math.max(canEat(e.s, m.s) ? e.s - m.s / GAME.eatOverlapDiv + moveSpeed(e.s) * 10 : -Infinity,
                    splitLikelihood(e, m.s, oc, S) >= 0.5 ? enemySplitReach(e, m.s, oc) : -Infinity);
                if (reach > -Infinity && Math.hypot(e.x - m.x, e.y - m.y) < reach + extra) return true;
            }
        }
        return false;
    }

    // ejects fly ~880 from the feeder's edge with ±0.3 rad spread; don't feed viruses or enemies on the way
    function feedLinesClear(S, big, feeders) {
        const segDist = (px, py, ax, ay, bx, by) => {
            const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
            const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
            return Math.hypot(px - ax - k * dx, py - ay - k * dy);
        };
        for (const f of feeders) {
            const len = Math.hypot(big.x - f.x, big.y - f.y);
            if (len - f.s > GAME.virusSplitBoost * 0.9 + big.s * 0.5) return false; // wouldn't arrive
            const slack = GAME.ejectSize + 10 + 0.15 * len;
            for (const v of S.viruses) if (segDist(v.x, v.y, f.x, f.y, big.x, big.y) < v.s + slack) return false;
            for (const e of S.enemies) if (segDist(e.x, e.y, f.x, f.y, big.x, big.y) < e.s + slack) return false;
        }
        return true;
    }

    // returns true while it is controlling the cells
    function stepConsolidate(conn, S) {
        const t = now();
        const stop = (msg) => { conn.consol = null; conn.consolCooldown = t + 2500; if (msg) hud.flash(msg); return false; };
        let big = conn.consol ? conn.cells.get(conn.consol.bigId) : null;
        if (!conn.consol) {
            if (S.mine.length < CFG.consolidateMinCells || t < conn.consolCooldown || conn.tick % 4) return false;
            big = S.mine.reduce((a, b) => (b.s > a.s ? b : a));
        } else if (!big || !conn.mine.has(big.id) || t > conn.consol.until) return stop('');
        const feeders = S.mine.filter(c => c !== big && c.s >= GAME.minEjectSize);
        // the big piece ejects too (wasted), so it needs enough feeders to be worth it
        const minFeeders = big.s >= GAME.minEjectSize ? 3 : 2;
        if (mass(big.s) / S.myMass >= CFG.consolidateDoneShare || feeders.length < minFeeders)
            return conn.consol ? stop('consolidated: ' + Math.round(mass(big.s)) + ' mass in one piece') : false;
        // (no stop just for a threat being around - the user: 'why stop consolidating on a threat?' One bigger piece is
        // exactly what a threat can't eat. But an enemy right on a feeding piece: our shots would feed IT - stop then.)
        {
            const onTop = S.enemies.find(e => e.player && !e.remote && !isAlly(e) && !conn.mateKeys.has(e.key) &&
                feeders.some(f => canEat(e.s, f.s * 0.9) && Math.hypot(e.x - f.x, e.y - f.y) - e.s < Math.max(150, enemySplitReach(e, f.s, S.ownerCount.get(e.key) || 1) + 100)));
            if (onTop) return conn.consol ? stop('consolidate: paused (' + (onTop.name || 'someone') + ' is on our feeding pieces)') : false;
        }
        const clear = feedLinesClear(S, big, feeders);
        if (!conn.consol) {
            if (!clear) return false;
            conn.consol = { bigId: big.id, until: t + 4000 };
            hud.flash(`consolidating ${S.mine.length} pieces into the biggest`);
        }
        // Aim inside the big piece but half its radius toward a feeder: their blobs still land in it,
        // and its own blobs reliably go toward the feeders (staying in the family) instead of spraying out
        // in every direction from a dead-centre aim, where any position error points them anywhere.
        // (toward the nearest feeder, not their centre: feeders in a ring all round would put the centre
        // back on top of the big piece)
        const bp = predict(big, S.L, S.tick);
        const fc = feeders.reduce((a, f) => (Math.hypot(f.x - bp.x, f.y - bp.y) < Math.hypot(a.x - bp.x, a.y - bp.y) ? f : a));
        const d = Math.hypot(fc.x - bp.x, fc.y - bp.y) || 1;
        const off = Math.min(big.s * 0.5, d * 0.5);
        const aim = { x: bp.x + (fc.x - bp.x) / d * off, y: bp.y + (fc.y - bp.y) / d * off };
        if (!shrinkSafe(S, feeders, SHOTS_LOSS)) return stop('consolidate: stopped before a piece got small enough to be caught');
        conn.sendMouse(aim.x, aim.y);
        if (clear) conn.sendEject(); // otherwise just gather until the lines clear
        conn.botAim = aim;
        conn.mode = 'consolidate';
        return true;
    }

    // ---------------------------------------------------------------- WebSocket hook
    const sendHook = function (data) {
        // retired (a newer copy took over): the game may still call this hook - pass everything to the newest copy's
        if (retired) { const h = W.__megaSendHook; return h && h !== sendHook ? h.call(this, data) : nativeSend.call(this, data); }
        if (this === lab.ws) return nativeSend.call(this, data); // our own lab link, not a game server
        seenSockets.add(this);
        let c = conns.get(this);
        if (!c) { c = new Conn(this); conns.set(this, c); }
        if (!c.onOutgoing(data)) return;
        return nativeSend.call(this, data);
    };
    NativeWS.prototype.send = sendHook;
    W.__megaSendHook = sendHook;
    setInterval(() => { for (const c of conns.values()) c.maybeRespawn(); stall.check(); }, 400);

    // Sigmally quietly drops a session after about an hour: no close, the game just stops updating, and
    // only a page reload brings it back. Noticed when we were alive at the last update and then nothing
    // came for stallMs. As an installed userscript we reload (the bot comes back with the page); injected
    // (Prism) a reload would remove us, so we ask for one instead (the Lab turns that into a toast).
    const pressEsc = () => {
        // the site tracks held keys and ignores a key until it's released: send down + up
        for (const type of ['keydown', 'keyup']) {
            const ev = new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true });
            Object.defineProperty(ev, 'keyCode', { get: () => 27 });
            Object.defineProperty(ev, 'which', { get: () => 27 });
            W.dispatchEvent(ev);
        }
    };
    const stall = {
        lastAlive: 0, since: 0, warned: 0,
        seen(conn) { this.lastAlive = conn.mine.size ? now() : 0; if (conn.mine.size) { this.playTries = 0; this.escTries = 0; } },
        check() {
            if (retired || !CFG.bot || !this.lastAlive) return;
            const t = now();
            if (t - this.lastAlive < CFG.stallMs) return;
            // first: Esc (brings the missing menu back), then Play from there; a reload only if that didn't help
            if ((this.escTries || 0) < 3 && t - (this.escAt || 0) > 4000) {
                this.escTries = (this.escTries || 0) + 1; this.escAt = t;
                hud.flash('the game stopped updating: pressing Esc to bring the menu back');
                lab.event('game stopped updating for ' + Math.round((t - this.lastAlive) / 1000) + ' s: pressing Esc (try ' + this.escTries + ')');
                pressEsc();
                return;
            }
            {
                const play = document.getElementById('play-btn');
                if (play && play.offsetParent && !play.disabled && (this.playTries || 0) < 3 && t - (this.playAt || 0) > 5000) {
                    this.playTries = (this.playTries || 0) + 1; this.playAt = t;
                    hud.flash('back at the menu: pressing Play');
                    play.click();
                    return;
                }
            }
            if (t - this.lastAlive < CFG.stallMs + 20000) return;   // give Esc / Play time to work
            if (typeof GM_info !== 'undefined' && CFG.autoReload) {
                if (!W.__megaReloading) {
                    W.__megaReloading = true;
                    lab.event('session timed out (no updates for ' + Math.round((t - this.lastAlive) / 1000) + ' s): reloading the page');
                    setTimeout(() => location.reload(), 500);
                }
                return;
            }
            const play = document.getElementById('play-btn');
            if (play && play.offsetParent && !play.disabled && (this.playTries || 0) < 3 && t - (this.playAt || 0) > 10000) {
                this.playTries = (this.playTries || 0) + 1; this.playAt = t;
                hud.flash('connection dropped: pressing Play to get back in');
                play.click();
                return;
            }
            if (t - this.warned > 60000) { this.warned = t; hud.flash('session timed out (the site drops you after ~1 h): please reload the page'); }
        },
    };

    // ---------------------------------------------------------------- HUD + keys
    const hud = {
        el: null, msg: '', msgUntil: 0, lastDraw: 0,
        ensure() {
            if (this.el || !document.body) return this.el;
            const el = document.createElement('div');
            // top centre: chat lives bottom-left, leaderboard top-right, minimap bottom-right
            el.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:99999;pointer-events:none;' +
                'font:13px/1.45 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.72);padding:6px 12px;' +
                'border-radius:8px;max-width:min(560px,90vw);white-space:pre-wrap;text-align:center;text-shadow:0 1px 2px #000';
            document.body.appendChild(el);
            return this.el = el;
        },
        flash(m) { this.msg = m; this.msgUntil = now() + 2500; lab.event(m); },
        // no game connection yet (page just loaded, at the menu): still show we're here (3.37.3: "reloading gets rid of the banner")
        idle() {
            if (retired || notOwner() || !this.ensure()) return;
            if ([...conns.values()].some(c => c.ready && now() - (c.updAt || 0) < 2000)) return;
            this.el.style.display = ''; this.el.style.opacity = CFG.hud ? '' : '0.45';
            // tell the Lab (once a minute): a tab out of the game needs a real mouse movement - the user can't see hidden tabs
            if (now() - (this.idleToldAt || 0) > 60000) { this.idleToldAt = now(); try { lab.event('this tab is out of the game: needs a mouse movement over it + Play'); } catch (_) { } }
            this.el.textContent = 'Mega Bot ' + VERSION + '  ·  ' + (CFG.bot ? 'bot ON' : 'bot off') + '  ·  not in the game: move the mouse over this window, then press Play' + (keyMoves.length ? '\nSigMod keys in use, so: ' + keyMoves.join(', ') : '');
        },
        update(conn) {
            const t = now();
            if (activeConn && conn !== activeConn) return; // multibox: show the one you're looking at
            if (t - this.lastDraw < 100) return;
            this.lastDraw = t;
            if (!this.ensure()) return;
            // hidden (H): a small faint tag stays, so the banner is never just gone without a clue how to get it back
            this.el.style.display = '';
            this.el.style.opacity = CFG.hud ? '' : '0.45';
            if (!CFG.hud) { this.el.textContent = 'Mega Bot ' + (CFG.bot ? 'ON' : 'off') + '  ·  press ' + CFG.keys.toggleHud.replace('Key', '') + ' to show'; return; }
            const k = CFG.keys, p = conn.lastPlan, key = c => c.replace('Key', '');
            const list = [...teamers.entries()].map(([kk, e]) => [e.name, teamerScore(kk)])
                .filter(([, s]) => s >= 1).sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([n]) => n || '(unnamed)');
            const lines = [
                `Mega Bot ${CFG.bot ? 'ON' : 'off'} [${key(k.toggleBot)}]  ·  ${conn.mode || '-'}` +
                (CFG.bot && conn.mine.size ? `  ·  danger ${Math.round(conn.danger)}` : ''),
                `smart split ${CFG.autoSplit ? 'ON' : 'off'} [${key(k.toggleAuto)}]  ·  ` +
                `${CFG.teamersOnly ? 'teamers only' : 'all players'} [${key(k.toggleTeamers)}]  ·  ` +
                `virus shots ${CFG.virusShots ? 'on' : 'off'} [${key(k.toggleVirus)}]`,
                `rtt ${Math.round(conn.rtt)}ms  ·  manual split [${key(k.manual)}]` +
                (p ? `  ·  best: ${p.k}x → ${Math.round(p.score)}` : ''),
            ];
            if (W.smartSplit && !W.smartSplit.megaBot) lines.push('⚠ disable the old "Sigmally Smart Split" script');
            if (list.length) lines.push('teamers: ' + list.join(', '));
            if (pick.kind) lines.unshift(pick.kind === 'tag' ? '▶ SELECTING friends / enemies: click a player (L / Esc: done)' : '▶ SELECTING the VIP: click a player (U / Esc: done)');
            if (CFG.vipName && CFG.vipMode) lines.push('VIP ' + CFG.vipName + ': bots ' + (CFG.vipMode === 'feed' ? 'FEED' : 'PROTECT') + ' them [U]');
            if ((CFG.friends || []).length || (CFG.enemies || []).length) lines.push((CFG.friends.length ? 'friends ' + CFG.friends.length : '') + (CFG.friends.length && CFG.enemies.length ? '  ·  ' : '') + (CFG.enemies.length ? 'enemies ' + CFG.enemies.length : '') + '  [L tags]');
            if (conn.squadRole !== 'solo') lines.push('team' + (conn.squadNeed ? ` · asking for ${conn.squadNeed.amount} mass` : '') +
                (conn.squadFeeding ? ' · feeding a teammate' : ''));
            if (t < this.msgUntil) lines.push('▶ ' + this.msg);
            this.el.textContent = lines.join('\n');
        },
    };

    // picking players (3.37.1): L / U start a selection mode; clicks then tag the player under the mouse and don't
    // reach the game (no feeding / splitting by accident). The same key or Esc ends it; 20 s without a click too.
    const pick = { kind: '', until: 0 };
    let pickHover = 0;   // the player under the mouse while picking (the overlay rings it)
    function startPick(kind) { pick.kind = kind; pick.until = now() + 20000; hud.flash(kind === 'tag' ? 'SELECT: click players - friend, again: enemy, again: off  (L / Esc: done)' : 'SELECT VIP: click a player - feed, again: protect, again: off  (U / Esc: done)'); }
    function endPick() { if (pick.kind) hud.flash('selection done'); pick.kind = ''; }
    function playerAtCursor(c) {
        let best = null, bd = 250;
        for (const o of c.cells.values()) {
            if (!o.player || !o.name || c.mine.has(o.id) || c.mateKeys.has(o.key)) continue;
            const d = Math.hypot(o.x - c.mouse.x, o.y - c.mouse.y) - o.s;   // < 0: the cursor is on it
            if (d < bd) { bd = d; best = o; }
        }
        return best;
    }
    function pickClick() {
        const c = activeConn; const o = c && playerAtCursor(c);
        pick.until = now() + 20000;
        if (!o) { hud.flash('no named player there - click on one (' + (pick.kind === 'tag' ? 'L' : 'U') + ' / Esc: done)'); return; }
        const n = o.name;
        if (pick.kind === 'tag') {
            const fr = (CFG.friends || []).filter(x => x !== n), en = (CFG.enemies || []).filter(x => x !== n);
            const was = onList(CFG.friends, n) ? 'friend' : onList(CFG.enemies, n) ? 'enemy' : 'none';
            const next = was === 'none' ? 'friend' : was === 'friend' ? 'enemy' : 'none';
            if (next === 'friend') fr.push(n); if (next === 'enemy') en.push(n);
            setLists(fr, en, true);
            hud.flash(n + ': ' + (next === 'friend' ? 'FRIEND' : next === 'enemy' ? 'ENEMY' : 'off the lists') + '  (click again to change; L / Esc: done)');
        } else {
            const mode = n !== CFG.vipName || !CFG.vipMode ? 'feed' : CFG.vipMode === 'feed' ? 'protect' : '';
            setVip(n, mode, true);
            hud.flash(mode ? 'VIP ' + n + ': bots ' + (mode === 'feed' ? 'FEED' : 'PROTECT') + ' them  (click again to change; U / Esc: done)' : 'VIP ' + n + ': off');
        }
    }
    for (const type of ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'contextmenu']) W.addEventListener(type, e => {
        if (retired || notOwner() || !pick.kind) return;
        if (now() > pick.until) { endPick(); return; }
        const tgt = e.target;
        if (tgt && tgt.tagName !== 'CANVAS') return;          // menus, chat, buttons work as usual
        e.preventDefault(); e.stopImmediatePropagation();
        if (type === 'mousedown' && e.button === 0) pickClick();
    }, true);
    W.addEventListener('keydown', e => {
        if (retired || notOwner()) return;
        const tgt = e.target;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
        if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        if (pick.kind && e.code === 'Escape') { endPick(); e.preventDefault(); e.stopImmediatePropagation(); return; }
        const k = CFG.keys;
        let handled = true;
        if (e.code === k.toggleBot) {
            CFG.bot = !CFG.bot;
            const c = activeConn;
            if (c) {
                c.vshot = null; c.consol = null; c.dash = null; c.dashEjects.clear(); c.botDir = NaN;
                c.flank = null; c.feedKill = null; c.bait = null; c.bailout = null;
                if (!CFG.bot) c.sendMouse(c.mouse.x, c.mouse.y);
            }
            hud.flash('bot ' + (CFG.bot ? 'ON' : 'off'));
            saveCfg(); // keep it over a reload (the hourly drop reloaded the captain's tab with the bot back on)
        }
        else if (!CFG.bot && e.code === (k.intel || 'KeyI')) { CFG.intelInject = !CFG.intelInject; customKeys.add('intelInject'); saveCfg(); if (!CFG.intelInject && activeConn) intelInjectClear(activeConn); hud.flash('intel on screen ' + (CFG.intelInject ? 'ON' : 'off')); }
        else if (!CFG.bot && e.code === (k.overlay || 'KeyO')) { CFG.overlay = !CFG.overlay; customKeys.add('overlay'); saveCfg(); hud.flash('overlay ' + (CFG.overlay ? 'ON' : 'off')); }
        else if (!CFG.bot && e.code === (k.guardian || 'KeyK')) { CFG.guardian = !CFG.guardian; customKeys.add('guardian'); saveCfg(); hud.flash('guardian ' + (CFG.guardian ? 'ON: I take the wheel when you head into death' : 'off')); }
        else if (!CFG.bot && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) { aimLock(true); handled = false; }   // (let the game see Shift too)
        else if (!CFG.bot && e.code === (k.backShot || 'KeyA')) { aimCtl.shoot = true; aimStep(); }
        else if (!CFG.bot && e.code === (k.mineMacro || 'KeyE')) { aimCtl.mine = true; aimCtl.mineV = 0; aimCtl.mineLast = null; aimCtl.nextShotAt = 0; aimStep(); }
        else if (e.code === (k.bigMap || 'KeyM')) { intel.big = !intel.big; hud.flash(intel.big ? 'intel map: big' : 'intel map: on the minimap'); }
        else if (e.code === (k.watchMe || 'KeyY')) {
            const on = !(CFG.record && !CFG.bot);
            CFG.record = on; CFG.bot = !on; CFG.autoSplit = !on;
            customKeys.add('record'); saveCfg();
            const c = activeConn;
            if (c && on) c.sendMouse(c.mouse.x, c.mouse.y);
            hud.flash(on ? 'WATCH ME: you play, I record (Y again: back to the bot)' : 'watch me off: the bot plays again');
            lab.event(on ? 'watch me: on (player recording)' : 'watch me: off (bot playing)');
        }
        else if (!CFG.bot && CFG.teamOrders && (e.code in ORDER_KEYS || e.code === 'Tab')) {
            if (e.code === 'Tab') { captain.feedAt = now(); captain.feedWall = Date.now(); hud.flash('team: feed me!'); }
            else { captain.mode = ORDER_KEYS[e.code]; hud.flash('team order: ' + (ORDER_NAMES[captain.mode || 'free'])); }
            e.preventDefault(); e.stopPropagation();
        }
        else if (e.code === k.toggleAuto) { CFG.autoSplit = !CFG.autoSplit; hud.flash('smart split ' + (CFG.autoSplit ? 'ON' : 'off')); }
        else if (e.code === k.toggleTeamers) { CFG.teamersOnly = !CFG.teamersOnly; hud.flash(CFG.teamersOnly ? 'splitting on teamers only' : 'splitting on all players'); }
        else if (e.code === k.toggleVirus) { CFG.virusShots = !CFG.virusShots; hud.flash('virus shots ' + (CFG.virusShots ? 'on' : 'off')); }
        else if (e.code === (k.tagPlayer || 'KeyL')) { pick.kind === 'tag' ? endPick() : startPick('tag'); }
        else if (e.code === (k.vipPlayer || 'KeyU')) { pick.kind === 'vip' ? endPick() : startPick('vip'); }
        else if (e.code === k.toggleHud) { CFG.hud = !CFG.hud; hud.lastDraw = 0; if (activeConn) hud.update(activeConn); }
        else if (e.code === k.manual) {
            const c = activeConn, mine = c && c.myCells();
            const plan = mine && mine.length && splitPlan(snapshot(c, mine), c.intendedAim());
            if (plan && plan.score > 0 && plan.lost === 0) c.executeSplit(plan, 'manual');
            else hud.flash('manual: nothing safe worth splitting on');
        } else handled = false;
        if (handled) { saveCfg(); e.stopImmediatePropagation(); e.preventDefault(); if (activeConn) { hud.lastDraw = 0; hud.update(activeConn); } }
    }, true);

    // Shift / A: heading lock and backward shots (see CFG.backShot*)
    const aimCtl = { lock: null, shoot: false, mine: false, mineV: 0, holdUntil: 0, nextShotAt: 0, sentAt: 0, phase: '' };
    function aimCentre(mine) {
        let x = 0, y = 0, m = 0;
        for (const c of mine) { const w = c.s * c.s; x += c.x * w; y += c.y * w; m += w; }
        return { x: x / m, y: y / m };
    }
    function aimLock(on) {
        const c = activeConn, mine = c && c.myCells();
        if (on && mine && mine.length) {
            if (aimCtl.lock) return;
            const c0 = aimCentre(mine);
            let dx = c.mouse.x - c0.x, dy = c.mouse.y - c0.y, d = Math.hypot(dx, dy);
            if (d < 5) { const big = mine.reduce((a, b) => (b.s > a.s ? b : a)); dx = big.vx || 1; dy = big.vy || 0; d = Math.hypot(dx, dy) || 1; }
            aimCtl.lock = { x: dx / d, y: dy / d };
            hud.flash('heading locked (Shift)');
        } else if (!on && aimCtl.lock) {
            aimCtl.lock = null;
            if (c && !CFG.bot && !aimCtl.shoot) c.sendMouse(c.mouse.x, c.mouse.y);
        }
        aimStep();
    }
    function aimStep() {
        const c = activeConn;
        if (retired || CFG.bot || !c || !c.mine.size) { aimCtl.lock = null; aimCtl.shoot = false; aimCtl.mine = false; return; }
        if (!aimCtl.lock && !aimCtl.shoot && !aimCtl.mine && now() >= aimCtl.holdUntil) { aimCtl.phase = ''; return; }
        const mine = c.myCells(); if (!mine.length) return;
        const c0 = aimCentre(mine), t = now();
        if (aimCtl.mine) { mineMacroStep(c, mine, t); return; }
        // where we're going: the locked heading, else the player's cursor
        const go = aimCtl.lock ? { x: c0.x + aimCtl.lock.x * 2000, y: c0.y + aimCtl.lock.y * 2000 } : { x: c.mouse.x, y: c.mouse.y };
        // a shot: with the heading locked at the cursor, else straight back from where we're going
        if (aimCtl.shoot && t >= aimCtl.nextShotAt && t >= aimCtl.holdUntil && mine.some(m => m.s >= GAME.minEjectSize)) {
            let dx = aimCtl.lock ? c.mouse.x - c0.x : c0.x - go.x, dy = aimCtl.lock ? c.mouse.y - c0.y : c0.y - go.y;
            const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
            const big = mine.reduce((a, b) => (b.s > a.s ? b : a));
            // the server moves the piece first, then shoots from where it ended up: the point must lie more than one
            // step past where the server has it by then (our view is a tick or two behind), or the piece lands on it
            // and the blob goes out the wrong way. So: where it will be + one step + a margin for our guess.
            const lagT = ((performance.now() - (c.updAt || performance.now())) + c.rtt / 2) / GAME.tickMs + 0.5;
            const vx = big.vt >= c.tick - 2 ? big.vx || 0 : 0, vy = big.vt >= c.tick - 2 ? big.vy || 0 : 0;
            const step = moveSpeed(big.s), reach = step + Math.hypot(vx, vy) * 1.5 + 30;   // (a piece moves only ~5-15 a tick: cheap)
            aimCtl.shotAt = { x: big.x + vx * lagT + dx * reach, y: big.y + vy * lagT + dy * reach };
            c.sendMouse(aimCtl.shotAt.x, aimCtl.shotAt.y);
            c.sendEject();
            aimCtl.holdUntil = t + CFG.backShotHoldMs; aimCtl.nextShotAt = t + CFG.backShotEveryMs; aimCtl.sentAt = t; aimCtl.phase = 'shot';
            return;
        }
        if (t < aimCtl.holdUntil) {   // keep the shot point until the server has taken the shot
            if (t - aimCtl.sentAt >= 15) { c.sendMouse(aimCtl.shotAt.x, aimCtl.shotAt.y); aimCtl.sentAt = t; }
            return;
        }
        if (aimCtl.phase === 'shot' || t - aimCtl.sentAt >= 16) {
            c.sendMouse(go.x, go.y); aimCtl.sentAt = t; aimCtl.phase = 'go';
            if (!aimCtl.lock && !aimCtl.shoot) aimCtl.phase = '';
        }
    }
    // hold E (the player, bot off): steer onto the nearest virus and fire W into it every tick; keep on that virus
    // until it is gone (it splits again and again as we feed it, and we roll onto it), then the next nearest one
    function mineMacroStep(c, mine, t) {
        // the player picks: the virus nearest the cursor, every tick (the user, 2026-10-22: no auto-choosing; the
        // cursor still tracks the real mouse while we steer)
        let v = null, best = Infinity;
        // (the player's key: simply the nearest to the cursor - the "not too close" limit is for the bots only, the user)
        for (const x of c.cells.values()) { if (!x.virus) continue; const d = Math.hypot(x.x - c.mouse.x, x.y - c.mouse.y); if (d < best) { best = d; v = x; } }
        if (v && v.id !== aimCtl.mineV) {
            // a new virus: fix the line we shoot along (our middle to it) until the cursor picks another - re-aiming
            // every tick spins the aim point once a cell reaches the virus and the shots spray everywhere
            const c0 = aimCentre(mine), lx = v.x - c0.x, ly = v.y - c0.y, ll = Math.hypot(lx, ly) || 1;
            aimCtl.mineDir = { x: lx / ll, y: ly / ll };
        }
        aimCtl.mineV = v ? v.id : 0;
        if (!v) {   // nothing in view: the mouse is the player's again until one shows up
            if (t - aimCtl.sentAt >= 16) { c.sendMouse(c.mouse.x, c.mouse.y); aimCtl.sentAt = t; }
            aimCtl.phase = 'mine: no virus'; return;
        }
        // aim along the fixed line, just past its centre: our pieces shoot through it and walk onto it
        const dir = aimCtl.mineDir || { x: 1, y: 0 };
        if (t - aimCtl.sentAt >= 16) { c.sendMouse(v.x + dir.x * v.s * 0.5, v.y + dir.y * v.s * 0.5); aimCtl.sentAt = t; }   // (half a virus past: every stream crosses it)   // (half a virus past: every stream crosses it)
        if (t >= aimCtl.nextShotAt && mine.some(m => m.s >= GAME.minEjectSize)) { c.sendEject(); aimCtl.nextShotAt = t + CFG.mineMacroEveryMs; }
        aimCtl.phase = 'mine';
    }
    setInterval(() => { try { aimStep(); } catch (_) { } }, 8);
    W.addEventListener('keyup', e => {
        if (retired) return;
        const k = CFG.keys;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') aimLock(false);
        else if (e.code === (k.mineMacro || 'KeyE') && aimCtl.mine) {
            aimCtl.mine = false; aimCtl.mineV = 0; e.preventDefault(); e.stopImmediatePropagation();
            const c = activeConn;
            if (c && !CFG.bot && !aimCtl.lock && !aimCtl.shoot) c.sendMouse(c.mouse.x, c.mouse.y);
        }
        else if (e.code === (k.backShot || 'KeyA') && aimCtl.shoot) {
            aimCtl.shoot = false; e.preventDefault(); e.stopImmediatePropagation();
            const c = activeConn;
            if (c && !CFG.bot && !aimCtl.lock) setTimeout(() => { if (!aimCtl.lock && !aimCtl.shoot) c.sendMouse(c.mouse.x, c.mouse.y); }, Math.max(0, aimCtl.holdUntil - now()) + 5);
        }
    }, true);
    W.addEventListener('blur', () => { aimCtl.shoot = false; aimCtl.mine = false; aimLock(false); });

    // console: megaBot.set('dangerWeight', 4)   |   megaBot.reset()
    // ---------------------------------------------------------------- lab link (Sigmally Lab gadget)
    // Streams what the bot sees to the gadget on this computer (never anywhere else), keeps a rolling
    // 10 s recording that's sent with every death, and takes setting changes from the gadget.
    const ROLE = { me: 0, threat: 1, prey: 2, virus: 3, blob: 4, master: 5, neutral: 6, pellet: 7, mate: 8 };

    // ---------------------------------------------------------------- team journal
    // What each team action set out to do and what it achieved, scored a few seconds later from eat events:
    // toMate = our mass (pieces or shot blobs) eaten by the teammate; fromMate = teammate mass we ate;
    // toEnemy = our pieces eaten by others; killed = mass we ate off the named threat.
    // Moves that pay for themselves (3.36.0): each attacking team move keeps a running score of mass killed minus mass
    // lost to enemies, from its journal entries. A move whose score is below zero pauses itself and gets one retry
    // every CFG.moveRetryMs to re-measure. Seeded from the live journal of 2026-10-17 (3 h, 4 bots), where all
    // four lost mass on average. Kept per browser (localStorage); megaBot.moves() shows the table.
    const moves = {
        KEY: 'sigMegaBot.moves',
        GATED: { 'kill with cover': -207, 'ask boost to split-kill': -224, 'pump kill': -329, 'pair pour and strike': -465 },
        st: null,
        load() {
            if (this.st) return this.st;
            try { this.st = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (_) { }
            if (!this.st || typeof this.st !== 'object' || Array.isArray(this.st)) this.st = {};
            for (const k in this.st) if (!this.st[k] || typeof this.st[k].avg !== 'number') delete this.st[k];
            for (const k in this.GATED) if (!this.st[k]) this.st[k] = { avg: this.GATED[k], n: 10, lastRetry: Date.now() };
            for (const k in this.st) this.st[k].tryUntil = 0;   // now() restarts per page
            return this.st;
        },
        save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.st)); } catch (_) { } },
        allowed(kind) {
            if (!CFG.moveGate || !(kind in this.GATED)) return true;
            const s = this.load()[kind];
            if (s.avg >= 0 || s.n < 5) return true;
            const t = now();
            if (t < (s.tryUntil || 0)) return true;                // a retry under way
            if (Date.now() - (s.lastRetry || 0) > CFG.moveRetryMs) { s.lastRetry = Date.now(); s.tryUntil = t + 8000; this.save(); return true; }
            return false;
        },
        tried(kind) { },
        record(r) {
            if (!(r.kind in this.GATED)) return;
            const s = this.load()[r.kind];
            const net = (r.killed || 0) - (r.toEnemy || 0) - (r.died ? r.myMass * 0.5 : 0);
            s.n++; s.avg = s.avg + (net - s.avg) / Math.min(s.n, 20);
            this.save();
        },
    };
    const teamlog = {
        open: [], seq: 0,
        start(conn, S, kind, info, mateKey, threatKey, windowMs) {
            moves.tried(kind);
            if (!CFG.teamJournal) return;
            // one open entry per kind per connection (repeated triggers of the same action extend it)
            const cur = this.open.find(e => e.conn === conn && e.kind === kind);
            if (cur) { cur.until = Math.max(cur.until, now() + (windowMs || 3000)); return; }
            const mate = mateKey ? S.squad.find(m => m.key === mateKey) : S.squad[0];
            this.open.push({ id: ++this.seq, conn, kind, info: info || {}, t: Date.now(), t0: now(), until: now() + (windowMs || 3000),
                mateKey: mateKey || (mate && mate.key) || '', mateName: mate ? mate.name : '', mateFrom: mate ? mate.from : '',
                threatKey: threatKey || '', myMass: Math.round(S.myMass), mateMass: mate ? Math.round(mate.mass) : 0,
                pieces: S.mine.length, toMate: 0, fromMate: 0, toEnemy: 0, killed: 0 });
        },
        onEat(conn, eater, eaten) {
            if (!this.open.length) return;
            for (const e of this.open) {
                if (e.conn !== conn) continue;
                const m = mass(eaten.s);
                const eaterMate = eater.player && (e.mateKey ? eater.key === e.mateKey : conn.mateKeys.has(eater.key));
                if (conn.mine.has(eaten.id)) { if (eaterMate) e.toMate += m; else if (!conn.mine.has(eater.id)) e.toEnemy += m; }
                else if (eaten.eject && eaten.color === conn.myColor && eaterMate) e.toMate += m;           // our shot blobs
                else if (conn.mine.has(eater.id) && eaten.player && conn.mateKeys.has(eaten.key)) e.fromMate += m;
                else if (conn.mine.has(eater.id) && e.threatKey && eaten.key === e.threatKey) e.killed += m;
            }
        },
        tick(conn, S) {
            if (!this.open.length) return;
            const t = now();
            for (let i = this.open.length - 1; i >= 0; i--) {
                const e = this.open[i];
                if (e.conn !== conn || t < e.until) continue;
                this.open.splice(i, 1);
                const myAfter = S ? Math.round(S.myMass) : 0;
                const mate = (S ? S.squad : squad.mates(conn)).find(m => m.from === e.mateFrom);
                const r = { id: e.id, t: e.t, secs: +((t - e.t0) / 1000).toFixed(1), kind: e.kind, info: e.info, mate: e.mateName, myMass: e.myMass, mateMass: e.mateMass,
                    myAfter, mateAfter: mate ? Math.round(mate.mass) : 0, toMate: Math.round(e.toMate), fromMate: Math.round(e.fromMate),
                    toEnemy: Math.round(e.toEnemy), killed: Math.round(e.killed), died: !conn.mine.size, mateAlive: !!(mate && mate.cells.length) };
                r.verdict = this.verdict(r);
                moves.record(r);
                try { lab.send({ type: 'teamlog', entry: r }); } catch (_) { }
                (W.__teamlog = W.__teamlog || []).push(r); if (W.__teamlog.length > 300) W.__teamlog.shift();
            }
        },
        verdict(r) {
            const k = r.kind;
            if (r.toEnemy > Math.max(r.toMate, 40)) return 'lost to enemy';
            if (/^split into|^dive into/.test(k)) {
                if (r.toMate >= 0.25 * r.myMass || (/dive/.test(k) && r.toMate >= 0.5 * r.myMass)) return 'worked';
                return r.toMate > 0 ? 'partly' : 'fell short (pulled back)';
            }
            if (/^split onto/.test(k)) return r.killed > 0 ? 'worked' : 'missed';
            if (/^feed/.test(k)) return r.toMate > 0 ? 'worked' : 'nothing landed';
            if (/^collect/.test(k)) return r.fromMate > 0 ? 'worked' : 'nothing eaten';
            if (/^DNA/.test(k)) return r.died ? 'died' : (r.toMate + r.fromMate > 0 ? 'worked' : 'no exchange');
            if (/^kill/.test(k)) return r.killed > 0 ? 'worked' : 'missed';
            if (/^ask boost/.test(k)) return r.killed > 0 ? 'worked' : (r.fromMate > 0 ? 'got mass, no kill' : 'no help came');
            return r.died ? 'died' : 'ok';
        },
    };
    function wobbleCheck(conn, S) {
        if (!CFG.teamJournal) return;
        const t = now();
        const tr = conn.wobTrail = conn.wobTrail || [];
        tr.push({ t, x: S.center.x, y: S.center.y, mode: conn.mode || '', dir: conn.botDir });
        while (tr.length && t - tr[0].t > 3000) tr.shift();
        if (t - (conn.wobCheckAt || 0) < 1000 || tr.length < 20 || t - tr[0].t < 2500) return;
        conn.wobCheckAt = t;
        let path = 0;
        for (let i = 1; i < tr.length; i++) path += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y);
        const net = Math.hypot(tr[tr.length - 1].x - tr[0].x, tr[tr.length - 1].y - tr[0].y);
        // moving but going nowhere (and not just holding still on purpose)
        if (path < 350 || net > path * 0.3 || (conn.wobLogAt && t - conn.wobLogAt < 20000)) return;
        if (/virus farm|feeding|pinned|in formation|following the split/.test(conn.mode || '')) return;  // standing still on purpose
        if (tr.some(e => /dead|respawning/.test(e.mode))) return;                                          // a respawn jump, not a wobble
        conn.wobLogAt = t;
        const deg = a => Math.round(((a * 180 / Math.PI) % 360 + 360) % 360);
        const modes = []; for (const e of tr) if (!modes.length || modes[modes.length - 1] !== e.mode) modes.push(e.mode);
        const pulls = (conn.lastPulls || []).slice().sort((a, b) => b.w - a.w).slice(0, 4)
            .map(p => (p.label || 'pull') + ' w' + Math.round(p.w) + ' @' + deg(Math.atan2(p.y - S.center.y, p.x - S.center.x)));
        const sc = (conn.lastScored || []).filter(c => !c.gather).slice().sort((a, b) => b.score - a.score);
        const part = c => c ? '@' + deg(c.a) + ' score ' + Math.round(c.score) + ' (food ' + Math.round(c.r.foodGain) + ', prey ' + Math.round(c.r.preyGain) +
            ', danger ' + Math.round(c.r.danger) + ', cost ' + Math.round(c.r.virusCost) + ')' : '-';
        const threats = (conn.lastThreats || []).slice(0, 4).map(e => (e.name || '?') + ' ' + Math.round(e.s) + ' at ' + Math.round(Math.hypot(e.x - S.center.x, e.y - S.center.y)) + ' @' + deg(Math.atan2(e.y - S.center.y, e.x - S.center.x)));
        const r = { id: 0, t: Date.now(), secs: 3, kind: 'stuck wobbling', verdict: 'diagnostic', mate: '', myMass: Math.round(S.myMass), myAfter: Math.round(S.myMass),
            mateMass: 0, mateAfter: 0, toMate: 0, fromMate: 0, toEnemy: 0, killed: 0, died: false, mateAlive: true,
            info: { moved: Math.round(path), got: Math.round(net), pieces: S.mine.length, danger: Math.round(conn.danger), modes: modes.slice(-6).join(' > '),
                pulls: pulls.join(' | '), best: part(sc[0]), second: part(sc.find(c => Math.abs(((c.a - sc[0].a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) > 0.6)), threats: threats.join(' | ') } };
        try { lab.send({ type: 'teamlog', entry: r }); } catch (_) { }
        (W.__teamlog = W.__teamlog || []).push(r);
        hud.flash('stuck wobbling: logged what we were torn between');
    }

    const lab = {
        ws: null, open: false, retryAt: 0, ring: [], lastSnap: 0, lastMode: '',
        connect() {
            if (retired || !CFG.lab || this.ws || now() < this.retryAt) return;
            this.retryAt = now() + 5000;
            let ws;
            try { ws = new NativeWS(CFG.labUrl); } catch (_) { return; }
            this.ws = ws;
            ws.onopen = () => {
                this.open = true;
                this.send({ type: 'hello', version: VERSION, page: location.href, cfg: CFG, maxCells: GAME.maxCells,
                    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '' });
            };
            ws.onclose = () => { this.ws = null; this.open = false; };
            ws.onerror = () => { };
            ws.onmessage = ev => { try { this.command(JSON.parse(ev.data)); } catch (err) { console.error('[MegaBot lab]', err); } };
        },
        send(msg) { if (this.open) try { nativeSend.call(this.ws, JSON.stringify(msg)); } catch (_) { } },
        event(text) { this.send({ type: 'event', t: Date.now(), text }); },
        command(m) {
            if (m.type === 'squad') return squad.receive(m); // a mate in another process, relayed
            const reply = (data) => this.send({ type: 'reply', id: m.id, ...data });
            if (m.cmd === 'set') {
                if (!setCfg(m.key, m.value)) return reply({ ok: false, error: 'unknown setting ' + m.key });
                reply({ ok: true, key: m.key, value: CFG[m.key] });
            } else if (m.cmd === 'get') reply({ ok: true, cfg: CFG, defaults: DEFAULTS });
            else if (m.cmd === 'bot') {
                CFG.bot = !!m.on; saveCfg();
                const c = activeConn; if (c && !CFG.bot) c.sendMouse(c.mouse.x, c.mouse.y);
                reply({ ok: true, bot: CFG.bot });
            } else if (m.cmd === 'respawn') {
                const btn = document.getElementById('play-btn');
                if (btn) btn.click();
                reply({ ok: !!btn });
            } else if (m.cmd === 'chat') {
                const c = [...conns.values()].find(k => k.ready && k.ws.readyState === 1 && k.mine.size) || [...conns.values()].find(k => k.ready && k.ws.readyState === 1);
                if (!c) return reply({ ok: false, error: 'no game connection' });
                const msg = new TextEncoder().encode(String(m.text || '').slice(0, 120));
                const pkt = new Uint8Array(msg.length + 3); pkt[0] = c.shuf[0x63]; pkt.set(msg, 2);
                c.raw(pkt);
                reply({ ok: true, as: c.myName || '' });
            } else if (m.cmd === 'eval') {
                // debugging aid for the gadget's owner (the link only accepts this computer)
                let out;
                try { out = String(new Function('megaBot', 'CFG', 'GAME', m.code)(W.megaBot, CFG, GAME)); } catch (err) { out = 'error: ' + err.message; }
                reply({ ok: true, result: out.slice(0, 20000) });
            }
        },
        // compact picture of the world: [id, x, y, size, role, name]
        snapshot(conn) {
            const mine = conn.myCells();
            let minMine = Infinity, maxMine = 0;
            for (const m of mine) { minMine = Math.min(minMine, m.s); maxMine = Math.max(maxMine, m.s); }
            const cells = [];
            let pellets = 0;
            for (const c of conn.cells.values()) {
                let role;
                if (conn.mine.has(c.id)) role = ROLE.me;
                else if (c.virus) role = ROLE.virus;
                else if (c.player) role = (conn.mateSeen && conn.mateSeen.has(c.id)) || conn.mateKeys.has(c.key) ? ROLE.mate : isMaster(c) ? ROLE.master : canEat(c.s, minMine) ? ROLE.threat : canEat(maxMine, c.s) ? ROLE.prey : ROLE.neutral;
                else if (c.eject) role = ROLE.blob;
                else { role = ROLE.pellet; if (pellets++ > 200) continue; }
                cells.push(c.player ? [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.s), role, c.name || ''] : [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.s), role]);
            }
            let mass = 0;
            for (const m of mine) mass += mass_(m.s);
            return {
                t: Date.now(), tick: conn.tick, mode: conn.mode, danger: Math.round(conn.danger), mass: Math.round(mass),
                pieces: mine.length, rtt: Math.round(conn.rtt), bot: CFG.bot, cells, squad: conn.squadRole,
                aim: conn.botAim ? [Math.round(conn.botAim.x), Math.round(conn.botAim.y)] : null,
                plan: conn.lastPlan ? { k: conn.lastPlan.k, score: Math.round(conn.lastPlan.score), target: conn.lastPlan.targetId } : null,
                border: conn.border, center: mine.length ? centroid(mine) : null,
            };
        },
        tick(conn) {
            if (!this.ws) this.connect();
            const t = now();
            if (CFG.record && !CFG.bot) this.record(conn, t);
            if (CFG.observe && CFG.bot && CFG.lab) this.observe(conn, t);
            if (t - this.lastSnap < 200) return; // 5 per second
            this.lastSnap = t;
            const snap = this.snapshot(conn);
            if (snap.pieces) { this.ring.push(snap); if (this.ring.length > 50) this.ring.shift(); }
            if (conn.mode !== this.lastMode) { this.lastMode = conn.mode; }
            this.send({ type: 'snap', snap });
        },
        // observe: what every bot sees of the other players (3 frames a second, players from observeMinMass up), for the
        // Lab to study the teams on the server; same frame layout as the watch-me recording
        observe(conn, t) {
            if (t - (this.obsAt || 0) < 333) return;
            this.obsAt = t;
            const me = [...conn.mine].map(id => conn.cells.get(id)).filter(Boolean).map(c => [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.s)]);
            const minS = Math.sqrt(CFG.observeMinMass * 100) / 2.2;                 // pieces of big players count too
            const o = [];
            for (const c of conn.cells.values()) {
                if (conn.mine.has(c.id) || !c.player || c.s < minS) continue;
                const mate = (conn.mateSeen && conn.mateSeen.has(c.id)) || conn.mateKeys.has(c.key);
                o.push([c.id, Math.round(c.x), Math.round(c.y), Math.round(c.s), Math.round((c.vx || 0) * 10), Math.round((c.vy || 0) * 10), mate ? 4 : 0, c.name || '', c.color]);
            }
            if (!o.length && !me.length) return;
            (this.obsBuf = this.obsBuf || []).push({ t: Date.now(), tick: conn.tick, me, o, b: conn.border ? [conn.border.minX, conn.border.minY, conn.border.maxX, conn.border.maxY] : null });
            if (this.obsBuf.length >= 15) {
                const ua = navigator.userAgent, who = /Firefox/.test(ua) ? 'firefox' : /OPR/.test(ua) ? 'opera' : /Edg/.test(ua) ? 'edge' : /Chrome/.test(ua) ? 'chrome' : 'other';
                this.send({ type: 'obs', who, srv: serverOf(conn.ws), frames: this.obsBuf }); this.obsBuf = [];
            }
        },
        // watch-me recording: 10 frames a second, sent in batches every second
        record(conn, t) {
            if (t - (this.recAt || 0) < 100) return;
            this.recAt = t;
            if (!this.recSession) this.recSession = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '-' + (/Firefox/.test(navigator.userAgent) ? 'firefox' : /OPR/.test(navigator.userAgent) ? 'opera' : /Edg/.test(navigator.userAgent) ? 'edge' : 'chrome');
            const me = [...conn.mine].map(id => conn.cells.get(id)).filter(Boolean).map(c => [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.s)]);
            const cx = me.length ? me.reduce((a, c) => a + c[1] * c[3] * c[3], 0) / me.reduce((a, c) => a + c[3] * c[3], 0) : conn.mouse.x;
            const cy = me.length ? me.reduce((a, c) => a + c[2] * c[3] * c[3], 0) / me.reduce((a, c) => a + c[3] * c[3], 0) : conn.mouse.y;
            const o = []; let pellets = 0;
            for (const c of conn.cells.values()) {
                if (conn.mine.has(c.id)) continue;
                if (!c.player && !c.virus && !c.eject) { if (Math.hypot(c.x - cx, c.y - cy) < 1500) pellets++; continue; }
                const mate = c.player && ((conn.mateSeen && conn.mateSeen.has(c.id)) || conn.mateKeys.has(c.key));
                o.push([c.id, Math.round(c.x), Math.round(c.y), Math.round(c.s), Math.round((c.vx || 0) * 10), Math.round((c.vy || 0) * 10),
                    (c.virus ? 1 : 0) | (c.eject ? 2 : 0) | (mate ? 4 : 0), c.player ? (c.name || '') : '', c.player ? c.color : 0]);
            }
            const fr = { t: Date.now(), tick: conn.tick, me, o, pel: pellets, in: conn.recIn || [], b: conn.border ? [conn.border.minX, conn.border.minY, conn.border.maxX, conn.border.maxY] : null, rtt: Math.round(conn.rtt || 0) };
            conn.recIn = [];
            (this.recBuf = this.recBuf || []).push(fr);
            if (this.recBuf.length >= 10) { this.send({ type: 'rec', session: this.recSession, frames: this.recBuf }); this.recBuf = []; }
        },
        death(conn) {
            const L = conn.lastLoss && conn.tick - conn.lastLoss.tick < 50 ? conn.lastLoss : null;
            const last = this.ring[this.ring.length - 1];
            let cause = 'unknown (disconnected or eaten out of view)';
            if (L) {
                const b = conn.border, nearWall = b && Math.min(L.x - b.minX, b.maxX - L.x, L.y - b.minY, b.maxY - L.y) < 700;
                cause = L.mate ? `merged into teammate ${L.name || ''}` : L.master ? `given to master ${L.name}` : L.fast ? `split-killed by ${L.name || 'someone'}` : L.teamer ? `eaten by teamer ${L.name || ''}` :
                    nearWall ? `cornered by ${L.name || 'someone'}` : `eaten by ${L.name || 'someone'}`;
                if (L.bot) cause += ' (server bot)';
            }
            const modes = [...new Set(this.ring.slice(-10).map(f => f.mode))];
            this.send({ type: 'death', death: { t: Date.now(), cause, killer: L, massBefore: last ? last.mass : 0,
                modesBefore: modes, frames: this.ring.slice(), cfg: { ...CFG } } });
            this.ring = [];
        },
    };
    const mass_ = mass;
    let mmOverlay = null;
    // ---------------------------------------------------------------- intel: everything we (and our teammates) see
    const intel = { cells: new Map(), big: false, el: null };
    function intelUpdate() {
        const t = Date.now(), conn = activeConn;
        if (!conn) return;
        const mine = conn.mine, mateIds = new Set();
        for (const m of squad.members.values()) for (const r of m.cells || []) mateIds.add(r[0]);
        const put = (id, x, y, s, vx, vy, name, color, virus, at) => {
            if (mine.has(id) || mateIds.has(id)) return;
            const o = intel.cells.get(id);
            if (o && o.t > at) return;
            const vmax = moveSpeed(Math.max(s, 10)) * 1.1, vl = Math.hypot(vx, vy);
            if (vl > vmax) { vx *= vmax / vl; vy *= vmax / vl; }
            intel.cells.set(id, { id, x, y, s, vx, vy, name, color, virus, t: at });
        };
        for (const c of conn.cells.values()) if ((c.player || c.virus) && !c.remote) put(c.id, c.x, c.y, c.s, c.vx || 0, c.vy || 0, c.name || '', c.color, !!c.virus, t);
        const srv = serverOf(conn.ws);
        for (const m of squad.members.values()) {
            if (!m.seen || now() - m.rx > 3000 || m.server !== srv) continue;   // another server's map isn't ours (3.37.4)
            const at = t - (now() - m.rx);
            for (const r of m.seen) put(r[0], r[1], r[2], r[3], r[4] / 10, r[5] / 10, r[6] || '', r[7], !!(r[8] & 1), at);
        }
        // gone from our own view while we'd still see it there: it moved off or was eaten - forget it
        const me = conn.myCells();
        if (me.length) {
            const c0 = centroid(me), big = me.reduce((a, c) => Math.max(a, c.s), 0), vw = 2000 + big * 3, vh = 1100 + big * 2;
            for (const [id, o] of intel.cells) if (t - o.t > 400 && Math.abs(o.x - c0.x) < vw * 0.8 && Math.abs(o.y - c0.y) < vh * 0.8 && !conn.cells.has(id)) intel.cells.delete(id);
        }
        for (const [id, o] of intel.cells) if (t - o.t > (o.virus ? 120000 : CFG.intelMemoryMs)) intel.cells.delete(id);
    }
    // hand the game the players only our teammates (or our memory) know about, as an update in the server's format
    const INJECTED = new WeakSet();
    // the area the server shows us (everything in it that exists, it sends): nothing of ours goes there
    function ownView(conn) {
        const vb = conn.viewBox;
        if (vb) return { minX: vb.minX - 150, minY: vb.minY - 150, maxX: vb.maxX + 150, maxY: vb.maxY + 150 };
        const me = conn.myCells(); if (!me.length) return null;
        const c0 = centroid(me), big = me.reduce((a, c) => Math.max(a, c.s), 0), w = 1900 + big * 3, h = 1100 + big * 2;
        return { minX: c0.x - w, minY: c0.y - h, maxX: c0.x + w, maxY: c0.y + h };
    }
    const inView = (v, x, y) => !!v && x > v.minX && x < v.maxX && y > v.minY && y < v.maxY;
    function intelInject(conn) {
        if (!conn.ready || conn.ws.readyState !== 1) return;
        if (Date.now() - (intel.upd || 0) > 200) { intel.upd = Date.now(); intelUpdate(); }
        const t = Date.now(), want = new Map(), view = ownView(conn);
        for (const o of intel.cells.values()) {
            if (conn.cells.has(o.id) || conn.mine.has(o.id)) continue;      // the server is showing it: leave it alone
            if (inView(view, o.x, o.y)) continue;                           // in our own view: if the server doesn't send it, it isn't there
            const age = t - o.t;
            if (age > (o.virus ? 60000 : 1500)) continue;    // older ones: the overlay draws them as fading ghosts
            const f = Math.min(age / GAME.tickMs, 50);
            want.set(o.id, { ...o, x: o.x + (o.vx || 0) * f, y: o.y + (o.vy || 0) * f });
        }
        // our teammates themselves, as they tell us (the squad messages carry their own cells)
        for (const m of squad.mates(conn)) {
            if (now() - m.rx > 1500) continue;
            const f = Math.min((now() - m.rx) / GAME.tickMs, 10);
            for (const r of m.cells) {
                if (conn.cells.has(r[0]) || conn.mine.has(r[0]) || inView(view, r[1], r[2])) continue;
                want.set(r[0], { id: r[0], x: r[1], y: r[2], s: r[3], vx: 0, vy: 0, name: m.name || '', color: m.color >= 0 ? m.color : 0xffd24a, virus: false, mate: true, f });
            }
        }
        const had = conn.ws.__megaInjected || conn.injected || new Set();
        const gone = [...had].filter(id => !want.has(id) && !conn.cells.has(id));
        if (!want.size && !gone.length) return;
        const enc = new TextEncoder(), b = [conn.shuf[16], 0, 0];
        const u32 = v => b.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
        const i16 = v => { v = Math.max(-32768, Math.min(32767, Math.round(v))); b.push(v & 255, (v >> 8) & 255); };
        for (const o of want.values()) {
            u32(o.id); i16(o.x); i16(o.y); const sz = Math.round(o.s); b.push(sz & 255, (sz >> 8) & 255);
            const flags = o.virus ? 1 : (2 | 8);
            b.push(flags, 0, 0, 0, 0);                                   // flags, isUpdate/isPlayer/isSub, clan ''
            if (flags & 2) b.push((o.color >> 16) & 255, (o.color >> 8) & 255, o.color & 255);
            if (flags & 8) { b.push(...enc.encode(o.name || '')); b.push(0); }
        }
        u32(0);
        b.push(gone.length & 255, gone.length >> 8); for (const id of gone) u32(id);
        const buf = new Uint8Array(b).buffer;
        INJECTED.add(buf);
        conn.injected = new Set(want.keys()); conn.ws.__megaInjected = conn.injected;
        try { conn.ws.dispatchEvent(new MessageEvent('message', { data: buf })); } catch (_) { }
    }
    function intelInjectClear(conn) {
        const had = conn && (conn.ws.__megaInjected || conn.injected);
        if (!had || !had.size) return;
        const gone = [...had].filter(id => !conn.cells.has(id));
        conn.injected = new Set(); conn.ws.__megaInjected = conn.injected;
        const b = [conn.shuf[16], 0, 0, 0, 0, 0, 0, gone.length & 255, gone.length >> 8];
        for (const id of gone) b.push(id & 255, (id >>> 8) & 255, (id >>> 16) & 255, (id >>> 24) & 255);
        const buf = new Uint8Array(b).buffer; INJECTED.add(buf);
        try { conn.ws.dispatchEvent(new MessageEvent('message', { data: buf })); } catch (_) { }
    }
    // the camera the game draws the world with: read off its first scaled circle each frame
    if (!W.__megaCamHook4 && W.CanvasRenderingContext2D) {
        W.__megaCamHook4 = true;
        // the game's frame: translate(screen centre), scale(zoom), translate(-camera): the transform after that last
        // translate maps world coordinates to the canvas
        const P = W.CanvasRenderingContext2D.prototype, tr0 = P.translate;
        P.translate = function (x, y) {
            const r = tr0.call(this, x, y);
            try {
                if (this.canvas && this.canvas.id === 'canvas') {
                    const m = this.getTransform();
                    // (not the undo at the end of the frame, which lands back on ~1:1 with no offset)
                    if (Math.abs(m.a - 1) > 1e-3 && m.a === m.d && Math.abs(m.e - this.canvas.width / 2) > 1 && (Math.abs(x) > 2 || Math.abs(y) > 2) && Math.abs(m.e - (this.canvas.width / 2 + m.a * x)) < 2
                        && !(Math.abs(m.e) < 2 && Math.abs(m.f) < 2))
                        { W.__megaCam4 = { a: m.a, d: m.d, e: m.e, f: m.f, t: performance.now() }; W.__megaFrameCtx4 = this; W.__megaFrameDrawn4 = true; }
                }
            } catch (_) { }
            return r;
        };
    }
    // right after the game has drawn a frame (it uses requestAnimationFrame): our additions to that same frame
    // smoothed positions for what we draw: eased towards the server's position (as the game draws its cells), so
    // rings glide with their cell instead of jumping at every update; a big jump (new cell, id reused) snaps
    const smooth = { m: new Map(), t: 0 };
    function smoothAt(id, x, y, s) {
        const tn = performance.now();
        let e = smooth.m.get(id);
        if (!e || tn - e.at > 500 || Math.hypot(x - e.x, y - e.y) > 400 + s) { e = { x, y, s, at: tn }; smooth.m.set(id, e); return e; }
        const k = 1 - Math.exp(-(tn - e.at) / 45);
        e.x += (x - e.x) * k; e.y += (y - e.y) * k; e.s += (s - e.s) * k; e.at = tn;
        return e;
    }
    function smoothPrune() {
        const tn = performance.now();
        if (tn - smooth.t < 1000) return; smooth.t = tn;
        for (const [id, e] of smooth.m) if (tn - e.at > 1000) smooth.m.delete(id);
    }
    function afterGameFrame() {
        if (!W.__megaFrameDrawn4) return;
        W.__megaFrameDrawn4 = false;
        smoothPrune();
        overlayStep();
        const g = W.__megaFrameCtx4, cam = W.__megaCam4, conn = activeConn;
        if (retired || !g || !cam || !CFG.mateGlow || CFG.bot || !conn || !CFG.multibox) return;
        const cells = [], view = ownView(conn);
        for (const m of squad.mates(conn)) {
            for (const r of m.cells) {
                const c = conn.cells.get(r[0]);
                if (c) cells.push(smoothAt(c.id, c.x, c.y, c.s));
                else if (!inView(view, r[1], r[2])) cells.push(smoothAt(r[0], r[1], r[2], r[3]));   // in our view but not shown: not there
            }
        }
        if (!cells.length) return;
        const px = W.devicePixelRatio || 1;
        g.save();
        try {
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.shadowColor = 'rgba(255,210,74,1)'; g.shadowBlur = 18 * px; g.strokeStyle = 'rgba(255,210,74,.9)'; g.lineWidth = 3 * px; g.setLineDash([]);
            for (const c of cells) { g.beginPath(); g.arc(cam.a * c.x + cam.e, cam.d * c.y + cam.f, c.s * cam.a + 3 * px, 0, Math.PI * 2); g.stroke(); }
        } catch (_) { }
        g.restore();
    }
    if (!W.__megaRafWrap && W.requestAnimationFrame) {
        W.__megaRafWrap = true;
        const raf0 = W.requestAnimationFrame.bind(W);
        W.requestAnimationFrame = function (cb) { return raf0(ts => { cb(ts); try { (W.__megaAfterFrame || (() => { }))(); } catch (_) { } }); };
    }
    W.__megaAfterFrame = afterGameFrame;
    // the overlay on the player's screen
    let ovl = null;
    function overlayFrame() {
        const conn = activeConn, game = document.getElementById('canvas'), cam = W.__megaCam4;
        const on = !retired && CFG.overlay && !CFG.bot && conn && conn.mine.size && game && cam;
        if (!on) { if (ovl) ovl.style.display = 'none'; return; }
        if (!ovl || !ovl.isConnected) {
            // overlays older copies left behind (frozen pictures): gone
            for (const o of document.querySelectorAll('canvas')) if (o.id !== 'canvas' && o.style.position === 'fixed' && o.style.zIndex === '50') o.remove();
            ovl = document.createElement('canvas');
            ovl.style.cssText = 'position:fixed;pointer-events:none;z-index:50';
            ovl.dataset.megaOvl = VERSION;
            document.body.appendChild(ovl);
        }
        const r = game.getBoundingClientRect();
        Object.assign(ovl.style, { display: '', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        if (ovl.width !== game.width || ovl.height !== game.height) { ovl.width = game.width; ovl.height = game.height; }
        // draw off-screen; only a finished frame replaces what's on the overlay
        if (!ovl.back) ovl.back = document.createElement('canvas');
        const back = ovl.back;
        if (back.width !== ovl.width || back.height !== ovl.height) { back.width = ovl.width; back.height = ovl.height; }
        const g = back.getContext('2d');
        g.clearRect(0, 0, back.width, back.height);
        const X = x => cam.a * x + cam.e, Y = y => cam.d * y + cam.f, R = v => v * cam.a, px = ovl.width / Math.max(1, r.width);
        const PX = c => smoothAt(c.id, c.x, c.y, c.s).x, PY = c => smoothAt(c.id, c.x, c.y, c.s).y;
        const me = conn.myCells(); if (!me.length) return;   // (nothing replaced: the last picture stays)
        const big = me.reduce((a, c) => (c.s > a.s ? c : a)), small = me.reduce((a, c) => (c.s < a.s ? c : a));
        const S0 = { ownerCount: new Map(), conn };
        for (const c of conn.cells.values()) if (c.player && !conn.mine.has(c.id)) S0.ownerCount.set(c.key, (S0.ownerCount.get(c.key) || 0) + 1);
        g.lineWidth = 2 * px;
        const mates = conn.mateKeys || new Set();
        pickHover = pick.kind ? ((playerAtCursor(conn) || {}).id || 0) : 0;
        for (const c of conn.cells.values()) {
            if (!c.player || conn.mine.has(c.id) || mates.has(c.key)) continue;
            const dx = c.x - big.x, dy = c.y - big.y, d = Math.hypot(dx, dy);
            if (d > 4500) continue;
            const eatsMe = canEat(c.s, small.s), iEat = canEat(big.s, c.s * CFG.eatMargin);
            // outline
            if (eatsMe || iEat) { g.strokeStyle = eatsMe ? (canEat(c.s, big.s) ? 'rgba(255,48,48,.8)' : 'rgba(255,154,48,.75)') : 'rgba(48,255,112,.75)'; g.setLineDash([]); g.beginPath(); g.arc(X(PX(c)), Y(PY(c)), R(c.s) + 3 * px, 0, Math.PI * 2); g.stroke(); }
            // threat ring: how far it can get us with a split
            if (eatsMe && d < 3500) {
                const reach = Math.max(c.s - small.s / GAME.eatOverlapDiv, enemySplitReach(c, small.s, S0.ownerCount.get(c.key) || 1));
                if (reach > c.s) { g.lineWidth = 1.5 * px; g.strokeStyle = canEat(c.s, big.s) ? 'rgba(255,48,48,.35)' : 'rgba(255,154,48,.28)'; g.setLineDash([8 * px, 8 * px]); g.beginPath(); g.arc(X(PX(c)), Y(PY(c)), R(reach + small.s), 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.lineWidth = 2 * px; }
            }
            // teamer tag
            if (pick.kind && pickHover === c.id) { g.lineWidth = 4 * px; g.strokeStyle = pick.kind === 'vip' ? '#ffd24a' : '#ffffff'; g.setLineDash([]); g.beginPath(); g.arc(X(PX(c)), Y(PY(c)), R(c.s) + 10 * px, 0, Math.PI * 2); g.stroke(); }
            if (isFriend(c) || isFoe(c)) { g.fillStyle = isFriend(c) ? '#5ad1ff' : '#ff5a5a'; g.font = 'bold ' + Math.round(12 * px) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(isFriend(c) ? 'FRIEND' : 'ENEMY', X(PX(c)), Y(PY(c)) - R(c.s) - (isTeamer(c.key) ? 20 : 6) * px); }
            if (isTeamer(c.key)) { g.fillStyle = '#ffd24a'; g.font = 'bold ' + Math.round(12 * px) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText('TEAMER', X(PX(c)), Y(PY(c)) - R(c.s) - 6 * px); }
            // an enemy's split pieces: how long until they can merge
            const o = conn.owners && conn.owners.get(c.key);
            if (o && (S0.ownerCount.get(c.key) || 1) > 1 && conn.tick - o.splitTick < 25 * 60) {
                const left = Math.max(0, (25 * 60 + Math.round(c.s * 0.5) - (conn.tick - o.splitTick)) * GAME.tickMs / 1000);
                g.fillStyle = '#ffffffcc'; g.font = Math.round(11 * px) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(Math.ceil(left) + 's', X(PX(c)), Y(PY(c)) + R(c.s) + 4 * px);
            }
        }
        // players none of us can see any more: a fading ghost where they probably are now (gone after intelMemoryMs)
        if (CFG.intelInject) {
            const tn = Date.now(), gView = ownView(conn);
            for (const o of intel.cells.values()) {
                if (o.virus || conn.cells.has(o.id) || conn.mine.has(o.id)) continue;
                const age = tn - o.t; if (age <= 1500 || age > 1500 + CFG.intelMemoryMs) continue;
                if (inView(gView, o.x, o.y)) continue;
                const f = Math.min(age / GAME.tickMs, 50), gx = X(o.x + (o.vx || 0) * f), gy = Y(o.y + (o.vy || 0) * f), gr = Math.max(3 * px, R(o.s));
                const fade = Math.max(0, 1 - (age - 1500) / CFG.intelMemoryMs);
                const danger = canEat(o.s, small.s), food = canEat(big.s, o.s * CFG.eatMargin);
                const rgb = danger ? '255,60,60' : food ? '60,255,110' : '200,200,220';
                g.fillStyle = 'rgba(' + rgb + ',' + (0.18 * fade).toFixed(3) + ')'; g.beginPath(); g.arc(gx, gy, gr, 0, Math.PI * 2); g.fill();
                g.strokeStyle = 'rgba(' + rgb + ',' + (0.7 * fade).toFixed(3) + ')'; g.setLineDash([4 * px, 4 * px]); g.stroke(); g.setLineDash([]);
                if (o.name && gr > 12 * px) { g.fillStyle = 'rgba(255,255,255,' + (0.7 * fade).toFixed(3) + ')'; g.font = Math.round(Math.max(10, Math.min(16, gr / 3 / px)) * px) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.name.slice(0, 16), gx, gy); }
            }
        }
        // our merge timers
        g.font = 'bold ' + Math.round(12 * px) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
        if (me.length > 1) for (const c of me) {
            const left = Math.max(0, (25 * 60 + Math.round(c.s * 0.5) - (conn.tick - c.born)) * GAME.tickMs / 1000);
            g.fillStyle = left > 0 ? '#ffffffdd' : '#30ff70'; g.fillText(left > 0 ? Math.ceil(left) + 's' : 'merge', X(PX(c)), Y(PY(c)) + R(c.s) * 0.55);
        }
        // split preview: where our biggest piece's half would land
        if (big.s >= GAME.minSplitSize && me.length < CFG.maxCells) {
            const bx = PX(big), by = PY(big);
            const ux = conn.mouse.x - bx, uy = conn.mouse.y - by, ul = Math.hypot(ux, uy) || 1;
            const half = big.s / SQRT2, dist = GAME.splitDistance + GAME.splitBoost;
            const lx = bx + ux / ul * dist, ly = by + uy / ul * dist;
            let col = 'rgba(255,255,255,.35)';
            for (const c of conn.cells.values()) {
                if (!c.player || conn.mine.has(c.id) || mates.has(c.key)) continue;
                if (segDist(c.x, c.y, big.x, big.y, lx, ly) > c.s + half) continue;
                if (canEat(c.s, half)) { col = 'rgba(255,48,48,.8)'; break; }
                if (canEat(half, c.s * CFG.eatMargin)) col = 'rgba(48,255,112,.85)';
            }
            g.strokeStyle = col; g.setLineDash([4 * px, 6 * px]); g.beginPath(); g.moveTo(X(bx), Y(by)); g.lineTo(X(lx), Y(ly)); g.stroke(); g.setLineDash([]);
            g.beginPath(); g.arc(X(lx), Y(ly), R(half), 0, Math.PI * 2); g.stroke();
        }
        // the bot's way out, when something's after us
        const adv = conn.advice;
        if (adv && now() - adv.t < 400) { const th = conn.arrowOn ? 0.03 : 0.08; conn.arrowOn = adv.danger > th * adv.mass + 1; }
        if (adv && conn.arrowOn) {
            const c0 = { x: PX(big), y: PY(big) }, ax = adv.aim.x - adv.center.x, ay = adv.aim.y - adv.center.y, al = Math.hypot(ax, ay) || 1;
            const L = big.s + 260, sx = X(c0.x + ax / al * big.s), sy = Y(c0.y + ay / al * big.s), ex = X(c0.x + ax / al * L), ey = Y(c0.y + ay / al * L);
            g.strokeStyle = '#3fe0ff'; g.lineWidth = 5 * px; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
            const an = Math.atan2(ey - sy, ex - sx);
            g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - Math.cos(an - 0.5) * 16 * px, ey - Math.sin(an - 0.5) * 16 * px); g.lineTo(ex - Math.cos(an + 0.5) * 16 * px, ey - Math.sin(an + 0.5) * 16 * px); g.closePath(); g.fillStyle = '#3fe0ff'; g.fill();
            g.lineWidth = 2 * px;
        }
        ovl.back.done = true;
    }
    function overlayStep() {
        let ok = false;
        try { ok = overlayFrame() !== false; } catch (err) { W.__megaOvlErr = (W.__megaOvlErr || 0) + 1; W.__megaOvlLast = String(err && err.stack || err).slice(0, 300); }
        // copy the finished frame onto the overlay in one go
        if (ok && ovl && ovl.back && ovl.style.display !== 'none' && ovl.back.done) { const g2 = ovl.getContext('2d'); g2.clearRect(0, 0, ovl.width, ovl.height); g2.drawImage(ovl.back, 0, 0); ovl.back.done = false; ovl.freshAt = now(); }
        else if (ovl && ovl.freshAt && now() - ovl.freshAt > 300) { ovl.getContext('2d').clearRect(0, 0, ovl.width, ovl.height); ovl.freshAt = 0; }
    }
    function intelDraw(g, X, Y, scale, dpr, big) {
        const conn = activeConn; if (!conn) return;
        const me = conn.myCells();
        const myBig = me.length ? me.reduce((a, c) => Math.max(a, c.s), 0) : 0, mySmall = me.length ? me.reduce((a, c) => Math.min(a, c.s), Infinity) : 0;
        const t = Date.now();
        for (const o of intel.cells.values()) {
            const age = t - o.t, f = Math.min(age / GAME.tickMs, 50);
            const x = o.x + (o.vx || 0) * f, y = o.y + (o.vy || 0) * f;
            const fade = o.virus ? 0.35 : Math.max(0.15, 1 - age / CFG.intelMemoryMs);
            g.globalAlpha = fade;
            if (o.virus) { g.fillStyle = '#5fdc6a'; g.beginPath(); g.arc(X(x), Y(y), Math.max(1, dpr * (big ? 1.5 : 0.8)), 0, Math.PI * 2); g.fill(); continue; }
            const col = myBig && canEat(o.s, mySmall) ? (canEat(o.s, myBig) ? '#ff3b3b' : '#ff9a3b') : myBig && canEat(myBig, o.s) ? '#3bff6e' : '#c8c8c8';
            const r = Math.max(1.5 * dpr, o.s * scale);
            g.fillStyle = col; g.beginPath(); g.arc(X(x), Y(y), r, 0, Math.PI * 2); g.fill();
            if (age > 1000) { g.strokeStyle = col; g.lineWidth = dpr; g.setLineDash([2 * dpr, 2 * dpr]); g.beginPath(); g.arc(X(x), Y(y), r + 2 * dpr, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
            if (big && o.name && o.s > 150) { g.fillStyle = '#fff'; g.font = Math.round(10 * dpr) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(o.name.slice(0, 14) + ' ' + Math.round(o.s * o.s / 100), X(x), Y(y) - r - 2 * dpr); }
        }
        g.globalAlpha = 1;
    }
    function minimapMates() {
        const box = document.querySelector('.minimapContainer') || (document.querySelector('canvas.minimap') || {}).parentElement;
        if (retired || !CFG.minimapMates || !CFG.multibox || !box) { if (mmOverlay) mmOverlay.style.display = 'none'; return; }
        const conn = activeConn, b = conn && conn.border;
        if (!b) return;
        if (!mmOverlay || mmOverlay.parentElement !== box) {
            mmOverlay = document.createElement('canvas');
            mmOverlay.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5';
            if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
            box.appendChild(mmOverlay);
        }
        mmOverlay.style.display = '';
        const dpr = W.devicePixelRatio || 1, cw = box.clientWidth, ch = box.clientHeight;
        if (mmOverlay.width !== Math.round(cw * dpr) || mmOverlay.height !== Math.round(ch * dpr)) { mmOverlay.width = Math.round(cw * dpr); mmOverlay.height = Math.round(ch * dpr); }
        const g = mmOverlay.getContext('2d'), Wd = mmOverlay.width, Hd = mmOverlay.height;
        g.clearRect(0, 0, Wd, Hd);
        const X = x => (x - b.minX) / (b.maxX - b.minX) * Wd, Y = y => (y - b.minY) / (b.maxY - b.minY) * Hd, t = now();
        if (CFG.intelMap) {
            intelUpdate();
            if (!intel.big) intelDraw(g, X, Y, Wd / (b.maxX - b.minX), dpr, false);
            // the big map: a panel bottom-left
            if (!intel.el || !intel.el.isConnected) {
                intel.el = document.createElement('canvas');
                intel.el.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9998;pointer-events:none;border-radius:8px;background:rgba(0,0,0,.6);border:1px solid #ffffff33';
                document.body.appendChild(intel.el);
            }
            intel.el.style.display = intel.big ? '' : 'none';
            if (intel.big) {
                const side = Math.round(Math.min(W.innerHeight * 0.6, 520)), px = Math.round(side * dpr);
                intel.el.style.width = side + 'px'; intel.el.style.height = side + 'px';
                if (intel.el.width !== px) { intel.el.width = px; intel.el.height = px; }
                const bg = intel.el.getContext('2d'); bg.clearRect(0, 0, px, px);
                const BX = x => (x - b.minX) / (b.maxX - b.minX) * px, BY = y => (y - b.minY) / (b.maxY - b.minY) * px;
                bg.strokeStyle = '#ffffff22'; bg.lineWidth = dpr; for (let i = 1; i < 5; i++) { bg.beginPath(); bg.moveTo(i * px / 5, 0); bg.lineTo(i * px / 5, px); bg.moveTo(0, i * px / 5); bg.lineTo(px, i * px / 5); bg.stroke(); }
                intelDraw(bg, BX, BY, px / (b.maxX - b.minX), dpr, true);
                for (const m of squad.members.values()) { if (!m.cells || !m.cells.length || now() - m.rx > 3000 || m.server !== serverOf(conn.ws)) continue; const c = memberCenter(m); bg.fillStyle = m.order ? '#ffd24a' : '#3fe0ff'; bg.beginPath(); bg.arc(BX(c.x), BY(c.y), 4 * dpr, 0, Math.PI * 2); bg.fill(); }
                const mc = conn.myCells(); if (mc.length) { const c = centroid(mc); bg.strokeStyle = '#fff'; bg.lineWidth = 2 * dpr; bg.beginPath(); bg.arc(BX(c.x), BY(c.y), 6 * dpr, 0, Math.PI * 2); bg.stroke(); }
                bg.fillStyle = '#ffffffaa'; bg.font = Math.round(11 * dpr) + 'px system-ui'; bg.textAlign = 'left'; bg.textBaseline = 'top';
                bg.fillText('intel: ' + [...intel.cells.values()].filter(o => !o.virus).length + ' players known (M to close)', 6 * dpr, 6 * dpr);
            }
        }
        const live = [...squad.members.values()].filter(m => m.cells && m.cells.length && t - m.rx < 3000 && m.server === serverOf(conn.ws)).sort((m1, m2) => (m1.from < m2.from ? -1 : 1));
        g.font = 'bold ' + Math.round(8 * dpr) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
        live.forEach((m, i) => {
            const c = memberCenter(m), r = (2.5 + Math.min(4, Math.sqrt(m.mass || 0) / 25)) * dpr;
            g.beginPath(); g.arc(X(c.x), Y(c.y), r, 0, Math.PI * 2);
            g.fillStyle = m.order ? '#ffd24a' : (m.danger || 0) > 0.1 * (m.mass || 1) ? '#ff5050' : '#3fe0ff';
            g.fill(); g.lineWidth = dpr; g.strokeStyle = '#000'; g.stroke();
            g.fillStyle = '#fff'; g.fillText(String(i + 1), X(c.x), Y(c.y) - r - 5 * dpr);
        });
        const mine = conn.myCells();
        if (mine.length) { const c = centroid(mine); g.beginPath(); g.arc(X(c.x), Y(c.y), 4 * dpr, 0, Math.PI * 2); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#fff'; g.stroke(); }
    }
    let orderKey = null;
    function orderLegend() {
        const show = !retired && CFG.teamOrders && CFG.multibox && !CFG.bot && activeConn && activeConn.mine.size;
        if (!show) { if (orderKey) orderKey.style.display = 'none'; return; }
        if (!orderKey || !orderKey.isConnected) {
            orderKey = document.createElement('div');
            orderKey.style.cssText = 'position:fixed;right:8px;z-index:9999;pointer-events:none;font:12px/1.35 system-ui,sans-serif;color:#fff;' +
                'background:rgba(0,0,0,.55);border-radius:6px;padding:5px 8px;text-shadow:0 1px 1px #000';
            document.body.appendChild(orderKey);
        }
        const box = document.querySelector('.minimapContainer');
        const bottom = box ? Math.max(8, W.innerHeight - box.getBoundingClientRect().top + 6) : 110;
        orderKey.style.bottom = bottom + 'px';
        orderKey.style.display = '';
        const cur = captain.mode || (CFG.carryDefault ? 'carry' : 'free'), fed = now() - captain.feedAt < 1500;
        const rows = [['1', 'follow', 'follow me'], ['2', 'protect', 'protect me'], ['3', 'flank', 'flank me'], ['4', 'orbit', 'orbit me'],
            ['5', 'farm', 'go farm'], ['6', 'trade', 'trade mass'], ['7', 'carry', 'carry me' + (CFG.carryDefault ? ' (default)' : '')], ['0', 'free', 'free play'], ['Tab', 'tab', 'feed me now'],
            ['I', CFG.intelInject ? 'on:i' : 'off:i', 'intel on screen ' + (CFG.intelInject ? 'ON' : 'off')], ['O', CFG.overlay ? 'on:o' : 'off:o', 'overlay ' + (CFG.overlay ? 'ON' : 'off')],
            ['K', CFG.guardian ? 'on:k' : 'off:k', 'guardian ' + (CFG.guardian ? 'ON' : 'off')], ['M', intel.big ? 'on:m' : 'off:m', 'big map'],
            ['Shift', aimCtl.lock ? 'on:s' : 'off:s', 'hold: lock heading'], ['A', aimCtl.shoot ? 'on:a' : 'off:a', 'hold: shoot back (+Shift: at cursor)'],
            [(CFG.keys.mineMacro || 'KeyE').replace('Key', ''), aimCtl.mine ? 'on:e' : 'off:e', 'hold: shoot the virus nearest the cursor']];
        const html = '<div style="opacity:.7;margin-bottom:2px">team orders</div>' + rows.map(([k, m, txt]) => {
            const on = m === 'tab' ? fed : /^on:/.test(m) ? true : /^off:/.test(m) ? false : m === cur;
            return '<div style="' + (on ? 'color:#ffd24a;font-weight:600' : 'opacity:.85') + '"><b style="display:inline-block;min-width:38px">' + k + '</b>' + txt + '</div>';
        }).join('');
        if (orderKey.innerHTML !== html) orderKey.innerHTML = html;
    }
    setInterval(() => { try { minimapMates(); } catch (_) { } try { orderLegend(); } catch (_) { } }, 250);
    setInterval(() => { if (!lab.ws) lab.connect(); }, 5000);
    setInterval(() => { try { hud.idle(); } catch (_) { } }, 1000);

    // In Prism's browser the script is injected after the game already connected; closing the game
    // socket makes the client reconnect (it calls setserver again), and this time we see the handshake.
    function reconnect() {
        let n = 0;
        for (const ws of seenSockets) if (ws.readyState === 1 && !conns.get(ws)?.ready) { ws.close(); n++; }
        return n;
    }

    // stop this copy for good (a newer one is taking over)
    function retire() {
        retired = true;
        try { lab.ws && lab.ws.close(); } catch (_) { }
        try { hud.el && hud.el.remove(); } catch (_) { }
        try { ovl && ovl.remove(); } catch (_) { }          // (left behind, its last picture stayed on screen for good)
    }

    // Take over from the copy that was running: its game connections and what it knew. Everything is
    // copied (not shared) so the old copy, if it can't retire properly, can't scramble our state.
    function adopt(prev) {
        try {
            if (typeof prev.retire === 'function') prev.retire();
            else {
                // older versions have no retire(): switch everything that acts off, and drop its lab link
                Object.assign(prev.cfg, { bot: false, autoSplit: false, lab: false, hud: false });
                try { prev.lab && prev.lab.ws && prev.lab.ws.close(); } catch (_) { }
            }
            const list = typeof prev.conns === 'function' ? prev.conns() : prev.active ? [prev.active] : [];
            for (const o of list) {
                // a socket the old copy never managed to read (it loaded after the game connected) still gets handed
                // over as known, so reconnect() can close it and the game comes back through us
                if (o && o.ws && o.ws.readyState === 1 && !o.ready) { seenSockets.add(o.ws); continue; }
                if (!o || !o.ws || o.ws.readyState !== 1 || !o.ready) continue;
                const c = new Conn(o.ws);
                for (const k of ['ready', 'shuf', 'unshuf', 'tick', 'border', 'rtt', 'myColor', 'everAlive', 'diedAt', 'lastRespawn', 'spawnPacket', 'rerolls', 'memberId', 'injected'])
                    if (o[k] !== undefined) c[k] = o[k];
                c.mouse = { ...o.mouse };
                c.cells = new Map([...o.cells].map(([id, cell]) => [id, { ...cell }]));
                c.mine = new Set(o.mine);
                if (o.owners) c.owners = new Map([...o.owners].map(([k, v]) => [k, { ...v }]));
                conns.set(o.ws, c);
                seenSockets.add(o.ws);
                if (o === prev.active || !activeConn) activeConn = c;
            }
            // ...and who our teammates are, so the first moments after a swap can't mistake one for prey
            if (prev.squad && prev.squad.members) for (const [k, v] of prev.squad.members) squad.members.set(k, { ...v, rx: now() });
            if (prev.squad && prev.squad.knownNames) for (const [k, v] of prev.squad.knownNames) squad.knownNames.set(k, { ...v, t: now() });
            hud.flash(`updated to v${VERSION} without reloading`);
            console.log(`[MegaBot] took over from the running copy (${list.length} connection(s))`);
        } catch (err) { console.error('[MegaBot] handoff failed', err); }
    }

    // console: megaBot.set('dangerWeight', 4)   |   megaBot.reset()
    W.megaBot = { version: VERSION, cfg: CFG, save: saveCfg, set: setCfg, reset: resetCfg, teamers, reconnect, lab, retire,
        conns: () => [...conns.values()], get active() { return activeConn; }, squad, moves: () => moves.load(), get pick() { return pick.kind; }, keyMoves };
    if (prevBot) adopt(prevBot);
    console.log('[MegaBot] loaded v' + VERSION);
})();
