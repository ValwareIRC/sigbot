// team scenes for the real-server sims (rsim.js real time, frsim.js fast): bots, scripted opponents, viruses
const SCENES = {
    fast: {
        desc: 'Fast travel (the user\'s design): the lead splits forward once every 0.25 s; once its pieces are small enough, the other starts splitting into them; the lead splits 2-3 more times into the other\'s tail, then the lead passes over - again and again. Should get further than walking and never lose a teammate.',
        bots: { Lead: [[0, 0, 1600]], Help: [[0, 650, 1200]] }, npcs: {}, goal: 'travel',
    },
    fastbig: {
        desc: 'Fast travel, big pair (6000 + 5000): split boosts are the same size for everyone, so big cells (slow walkers) should gain the most.',
        bots: { Lead: [[0, 0, 6000]], Help: [[0, 1300, 5000]] }, npcs: {}, goal: 'travel',
    },
    fast4: {
        desc: 'Fast travel with four bots: two pairs side by side, each pair fast-travelling.',
        bots: { Lead: [[0, 0, 1600]], Help: [[0, 650, 1200]], Third: [[1400, 0, 1400]], Fourth: [[1400, 650, 1000]] }, npcs: {}, goal: 'travel',
    },
    rally: {
        desc: 'Surrounded and split up: both teammates in 6 pieces, three hunters closing in from three sides (each can eat our pieces, none can eat us once we are one cell). Right move: pick one teammate and everyone dives into it, fast.',
        bots: { Lead: [[0, 0, 420], [260, 120, 300], [-200, 180, 260], [80, -260, 240], [-260, -120, 220], [330, -180, 200]],
                Help: [[700, 300, 380], [950, 450, 280], [600, 620, 250], [980, 150, 230], [780, 700, 210], [1100, 330, 200]] },
        npcs: { Hunter1: { pieces: [[-1900, 200, 2600]], kind: 'chaseboth', splits: true }, Hunter2: { pieces: [[2600, 300, 2600]], kind: 'chaseboth', splits: true },
                Hunter3: { pieces: [[400, -2000, 2600]], kind: 'chaseboth', splits: true } }, goal: 'survive',
    },
    boostkill: {
        desc: 'Boost kill: Lead chases a Runner it can\'t split-kill yet (its half is too small). Right move: Help SPLITS into Lead (mass arrives at once), then Lead split-kills the Runner.',
        bots: { Lead: [[0, 0, 1760]], Help: [[-300, -800, 1440]] }, npcs: { Runner: { pieces: [[650, 0, 784]], kind: 'flee' } }, goal: 'kill',
    },
    escape: {
        desc: 'Escape: Lead is chased by a Hunter that can eat it; Help is ahead. Right move: Lead dives into Help (or both get away); nobody gets eaten.',
        bots: { Lead: [[0, 0, 1200]], Help: [[800, 100, 1000]] }, npcs: { Hunter: { pieces: [[-520, 0, 1700]], kind: 'chase', target: 'Lead' } }, goal: 'survive',
    },
    pourin: {
        desc: 'Pour in (the user, 2026-10-20): Lead broken into 8 pieces (2400) chased by a 2000 Hunter, Help one whole 900 cell nearby. Right move: Lead pours everything into Help (one 3300 cell that eats the Hunter), NOT Help diving into one of Lead pieces.',
        bots: { Lead: [[0, 0, 300], [200, 120, 300], [-180, 140, 300], [100, -200, 300], [-150, -170, 300], [260, -60, 300], [-260, 0, 300], [40, 240, 300]], Help: [[700, 300, 900]] },
        npcs: { Hunter: { pieces: [[-1200, 0, 2000]], kind: 'chase', target: 'Lead' } }, goal: 'kill',
    },
    pairkill: {
        desc: 'Pair kill (live 2026-10-20): two players the same size side by side in front of Lead (in two pieces). Right move: one split between them eats both.',
        bots: { Lead: [[0, -170, 800], [0, 170, 800]], Help: [[-2500, 0, 400]] }, npcs: { P1: { pieces: [[560, -175, 220]], kind: 'flee' }, P2: { pieces: [[560, 175, 220]], kind: 'flee' } }, goal: 'kill',
    },
    runaway: {
        desc: 'Runaway (live 2026-10-20, DØPT): Lead (800) alone, a 3,100 player 950 behind chasing it; food and small prey around. Lead is 1.3x faster: right move is to out-run it (gap grows), never let it close in.',
        bots: { Lead: [[0, 0, 800]], Help: [[7000, 7000, 300]] }, npcs: { Chaser: { pieces: [[-1270, 0, 3100]], kind: 'chase', target: 'Lead' }, Snack: { pieces: [[600, 500, 220]], kind: 'idle' } }, goal: 'survive',
    },
    evenfight: {
        desc: 'Even fight (live 2026-10-20): Help is in two pieces; a stranger the same size as one piece goes for it - neither can eat the other. Right move: Lead splits into that piece, which then eats the stranger.',
        bots: { Lead: [[600, -600, 700]], Help: [[0, 0, 500], [380, 0, 500]] }, npcs: { Rival: { pieces: [[900, 40, 520]], kind: 'chase', target: 'Help' } }, goal: 'kill',
    },
    frozen: {
        desc: 'Frozen (live 2026-10-20): Lead and Help, and a disconnected player standing still 1200 away that Lead can only just eat (1.16x its size). Right move: go and eat it.',
        bots: { Lead: [[0, 0, 1000]], Help: [[300, 250, 900]] }, npcs: { Frozen: { pieces: [[1200, -300, 740]], kind: 'idle' } }, goal: 'kill',
    },
    squeeze: {
        desc: 'Squeeze (live 2026-10-20): Lead and Help together, a big player closing from the left and another from the right; up and down are open. Right move: both pick ONE way out (up or down) together and go, or merge; never jitter in place.',
        bots: { Lead: [[0, 0, 800]], Help: [[150, 320, 650]] },
        npcs: { BigL: { pieces: [[-1700, 150, 6000]], kind: 'chase', target: 'Lead' }, BigR: { pieces: [[1800, 150, 6000]], kind: 'chase', target: 'Help' } }, goal: 'survive',
    },
    jeblina: {
        desc: 'Jeblina (live 2026-10-20): Lead is one big cell beside Help, who is split in three; Jeb (can eat Help, Lead can eat Jeb) walks in at Help. Right move: Help gets away or into Lead, and/or Lead eats Jeb. Nobody sits still.',
        bots: { Lead: [[0, 0, 3400]], Help: [[700, 250, 360], [820, 420, 300], [560, 480, 250]] },
        npcs: { Jeb: { pieces: [[1900, 600, 700]], kind: 'chase', target: 'Help' } }, goal: 'survive',
    },
    samesize: {
        desc: 'Same size: both teammates in 3 pieces of the same size with a Hunter close; no piece can eat the other side\'s. Right move: one splits smaller (or shoots mass) into the other, never just bumping into it.',
        bots: { Lead: [[0, 0, 900], [260, 60, 880], [120, -240, 860]], Help: [[600, 250, 890], [820, 120, 870], [700, 480, 860]] },
        npcs: { Hunter: { pieces: [[-1100, 300, 1900]], kind: 'chase', target: 'Lead' } }, goal: 'survive',
    },
    turnaround: {
        desc: 'Turnaround: Lead and Help side by side, chased by a Hunter that can eat either alone but not both together. Right move: one dives into the other, then the merged one turns and eats the Hunter.',
        bots: { Lead: [[0, 0, 1000]], Help: [[0, 450, 900]] }, npcs: { Hunter: { pieces: [[-900, 200, 1400]], kind: 'chase', target: 'Lead' } }, goal: 'kill',
    },
    mines: {
        desc: 'Mines: Lead (2500) next to a dense virus field, two big players idle 3000+ away in plain view. Right move: eat/shoot the viruses and keep going after popping, not run.',
        bots: { Lead: [[-1600, 0, 2500]], Help: [[-2500, -700, 800]] },
        npcs: { Big: { pieces: [[3800, 200, 9000]], kind: 'idle' }, Big2: { pieces: [[900, 3600, 7000]], kind: 'idle' } },
        viruses: [[600, -300], [880, -260], [1150, -330], [700, 30], [980, 60], [1260, 0], [620, 360], [900, 330], [1200, 380], [1450, 150]], goal: 'grow',
    },
    slip: {
        desc: 'Slip-through (the user, 2026-10-22): a player in three pieces - two 1600s side by side, touching, and a 400 behind them. Lead (1000) can eat the 400 but not the 1600s, whose halves are too small to eat Lead. Right move: walk the lane between the two big pieces (their eat lines leave a gap) and eat the 400.',
        bots: { Lead: [[0, 0, 1000]], Help: [[-6000, 6000, 400]] },
        npcs: { Pack: { pieces: [[600, -400, 1600], [600, 400, 1600], [1150, 0, 400]], kind: 'idle' } }, goal: 'kill',
    },
    slipchase: {
        desc: 'Slip-through while chased: the same player walks at Lead with its two big pieces in front and the 400 behind. Right move: go through between them, eat the 400, come out the other side.',
        bots: { Lead: [[0, 0, 1000]], Help: [[-6000, 6000, 400]] },
        npcs: { Pack: { pieces: [[700, -400, 1600], [700, 400, 1600], [1250, 0, 400]], kind: 'chase', target: 'Lead' } }, goal: 'kill',
    },
    slippieces: {
        desc: 'Slip-through in pieces, another player around: Lead in 3 pieces (900 + 2x250), a third player (2000) loitering 1200 away. Right move: the 900 walks the lane, the small pieces shoot into it on the way, eat the 400.',
        bots: { Lead: [[0, 0, 900], [-300, 120, 250], [-300, -120, 250]], Help: [[-6000, 6000, 400]] },
        npcs: { Pack: { pieces: [[600, -400, 1600], [600, 400, 1600], [1150, 0, 400]], kind: 'idle' }, Lurker: { pieces: [[300, 1500, 2000]], kind: 'idle' } }, goal: 'kill',
    },
    sliptrip: {
        desc: 'Slip-through after a trip: like slippieces but the player is 1800 away, so there is time to consolidate on the way.',
        bots: { Lead: [[0, 0, 900], [-300, 120, 250], [-300, -120, 250]], Help: [[-6000, 6000, 400]] },
        npcs: { Pack: { pieces: [[1800, -400, 1600], [1800, 400, 1600], [2350, 0, 400]], kind: 'idle' }, Lurker: { pieces: [[900, 1700, 2000]], kind: 'idle' } }, goal: 'kill',
    },
    packchase: {
        desc: 'Pack chase: Lead (2000) and Help (1500) side by side behind a fleeing 600. Right move: one chases, the other runs level beside it (no gap for the prey to dodge through) - someone eats it.',
        bots: { Lead: [[0, 0, 2000]], Help: [[0, 600, 1500]] },
        npcs: { Prey: { pieces: [[900, 300, 600]], kind: 'flee' } }, goal: 'kill',
    },
    calm: {
        desc: 'Calm: nothing around for 20 s. What do two teammates do together (grow, feed, travel)?',
        bots: { Lead: [[0, 0, 2400]], Help: [[700, 200, 500]] }, npcs: {}, goal: 'grow',
    },
};
module.exports = SCENES;
