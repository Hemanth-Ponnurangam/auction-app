/**
 * Cricket Simulation Engine v1.0
 * Builds player DNA profiles from raw ball-by-ball data
 * and runs a ball-by-ball T20 match simulation.
 *
 * Sections implemented (from the Factor Registry):
 *  A. Batter DNA (phase-split: PP / Middle / Death)
 *  B. Bowler DNA (phase-split)
 *  C. Head-to-Head Matrix (≥15 balls)
 *  E. Match-situation adjustments
 */

// ─── PHASE BOUNDARIES ───────────────────────────────────────────
export const PHASES = { PP: [0,5], MID: [6,14], DEATH: [15,19] };

function getPhase(over) {
    if (over <= 5)  return 'PP';
    if (over <= 14) return 'MID';
    return 'DEATH';
}

// ─── PROFILE BUILDERS ───────────────────────────────────────────

/**
 * Build batter DNA from array of ball-by-ball rows for one batter.
 * Returns { overall, PP, MID, DEATH } each being a prob distribution.
 */
function buildBatterProfile(rows) {
    const phases = { overall: [], PP: [], MID: [], DEATH: [] };
    for (const r of rows) {
        const p = getPhase(+r.over);
        phases.overall.push(r);
        phases[p].push(r);
    }
    const result = {};
    for (const [key, arr] of Object.entries(phases)) {
        result[key] = computeBatterDist(arr);
    }
    return result;
}

function computeBatterDist(rows) {
    if (!rows.length) return null;
    const total = rows.length;
    let dot=0, one=0, two=0, three=0, four=0, six=0, wkt=0, wide=0, noball=0;
    for (const r of rows) {
        const run = +r.runs_batter;
        const isWkt = r.player_out && r.player_out.trim() !== '' && r.wicket_kind && r.wicket_kind.trim() !== '';
        const isWide  = r.extra_type === 'wides';
        const isNoball = r.extra_type === 'noballs';
        if (isWkt)    { wkt++; continue; }
        if (isWide)   { wide++; continue; }
        if (isNoball) { noball++; continue; }
        if (run === 0) dot++;
        else if (run === 1) one++;
        else if (run === 2) two++;
        else if (run === 3) three++;
        else if (run === 4) four++;
        else if (run >= 6) six++;
    }
    // valid deliveries (faced by batter — exclude wides)
    const valid = total - wide;
    if (!valid) return null;
    return {
        balls: valid,
        dot:   dot   / valid,
        one:   one   / valid,
        two:   two   / valid,
        three: three / valid,
        four:  four  / valid,
        six:   six   / valid,
        wkt:   wkt   / valid,
        sr:    valid > 0 ? ((dot*0+one*1+two*2+three*3+four*4+six*6) / valid) * 100 : 0,
    };
}

/**
 * Build bowler DNA profile.
 */
function buildBowlerProfile(rows) {
    const phases = { overall: [], PP: [], MID: [], DEATH: [] };
    for (const r of rows) {
        const p = getPhase(+r.over);
        phases.overall.push(r);
        phases[p].push(r);
    }
    const result = {};
    for (const [key, arr] of Object.entries(phases)) {
        result[key] = computeBowlerDist(arr);
    }
    return result;
}

function computeBowlerDist(rows) {
    if (!rows.length) return null;
    let balls=0, runs=0, wkts=0, dots=0, fours=0, sixes=0;
    for (const r of rows) {
        const isWide  = r.extra_type === 'wides';
        const isNB    = r.extra_type === 'noballs';
        if (!isWide) balls++;  // valid balls
        runs += +r.runs_total;
        const br = +r.runs_batter;
        if (br === 0 && !isWide && !isNB) dots++;
        if (br === 4) fours++;
        if (br >= 6) sixes++;
        if (r.player_out && r.player_out.trim() !== '') wkts++;
    }
    if (!balls) return null;
    return {
        balls,
        economy:    (runs / balls) * 6,
        wicketRate: wkts / balls,
        dotPct:     dots / balls,
        boundaryPct:(fours + sixes) / balls,
    };
}

/**
 * Build head-to-head matrix (batter vs bowler).
 */
function buildMatchupMatrix(rows) {
    const matrix = {};  // matrix[batter][bowler] = { balls, dist }
    for (const r of rows) {
        const batter = r.batter;
        const bowler = r.bowler;
        if (!batter || !bowler) continue;
        if (!matrix[batter]) matrix[batter] = {};
        if (!matrix[batter][bowler]) matrix[batter][bowler] = [];
        matrix[batter][bowler].push(r);
    }
    const result = {};
    for (const batter of Object.keys(matrix)) {
        result[batter] = {};
        for (const bowler of Object.keys(matrix[batter])) {
            const arr = matrix[batter][bowler];
            if (arr.length >= 15) {
                result[batter][bowler] = computeBatterDist(arr);
            }
        }
    }
    return result;
}

/**
 * Parse raw CSV rows into player stats.
 * Returns { batters, bowlers, matchup, leagueAvg }
 */
export function buildPlayerStats(csvRows) {
    // Group by batter / bowler
    const batterRows = {};
    const bowlerRows = {};
    for (const r of csvRows) {
        const b = r.batter;
        const bw = r.bowler;
        if (b) {
            if (!batterRows[b]) batterRows[b] = [];
            batterRows[b].push(r);
        }
        if (bw) {
            if (!bowlerRows[bw]) bowlerRows[bw] = [];
            bowlerRows[bw].push(r);
        }
    }

    const batters = {};
    for (const [name, rows] of Object.entries(batterRows)) {
        batters[name] = buildBatterProfile(rows);
    }
    const bowlers = {};
    for (const [name, rows] of Object.entries(bowlerRows)) {
        bowlers[name] = buildBowlerProfile(rows);
    }
    const matchup = buildMatchupMatrix(csvRows);
    const leagueAvg = computeBatterDist(csvRows);

    return { batters, bowlers, matchup, leagueAvg };
}

/**
 * Get all unique player names from ball-by-ball data.
 */
export function getPlayerList(csvRows) {
    const players = {};
    for (const r of csvRows) {
        if (r.batter) {
            if (!players[r.batter]) players[r.batter] = { name: r.batter, batBalls: 0, batRuns: 0, wkts: 0, bowlBalls: 0 };
            players[r.batter].batBalls++;
            players[r.batter].batRuns += +r.runs_batter;
        }
        if (r.bowler) {
            if (!players[r.bowler]) players[r.bowler] = { name: r.bowler, batBalls: 0, batRuns: 0, wkts: 0, bowlBalls: 0 };
            players[r.bowler].bowlBalls++;
            if (r.player_out && r.player_out.trim()) players[r.bowler].wkts++;
        }
    }
    return Object.values(players).filter(p => p.batBalls > 0 || p.bowlBalls > 0);
}

// ─── FALLBACK / LEAGUE AVERAGE ───────────────────────────────────

/** Generic T20 league average distribution (when no data exists) */
const GENERIC_DIST = {
    dot: 0.35, one: 0.28, two: 0.06, three: 0.01,
    four: 0.16, six: 0.08, wkt: 0.06,
};

const PHASE_MODS = {
    PP:    { dot: 0.90, four: 1.10, six: 0.85, wkt: 1.05 },
    MID:   { dot: 1.05, four: 0.95, six: 0.90, wkt: 0.95 },
    DEATH: { dot: 0.70, four: 1.05, six: 1.50, wkt: 1.15 },
};

function applyPhaseMod(dist, phase) {
    const mod = PHASE_MODS[phase];
    const d = { ...dist };
    for (const [k, v] of Object.entries(mod)) {
        if (d[k] !== undefined) d[k] *= v;
    }
    normalise(d);
    return d;
}

function normalise(dist) {
    const keys = ['dot','one','two','three','four','six','wkt'];
    const total = keys.reduce((s, k) => s + (dist[k] || 0), 0);
    if (total === 0) return;
    for (const k of keys) dist[k] = (dist[k] || 0) / total;
}

// ─── SAMPLING ─────────────────────────────────────────────────────

function sampleDist(dist) {
    const keys = ['dot','one','two','three','four','six','wkt'];
    const r = Math.random();
    let cum = 0;
    for (const k of keys) {
        cum += (dist[k] || 0);
        if (r < cum) return k;
    }
    return 'dot';
}

/**
 * Blend two distributions with weight w on dist2 (0–1).
 */
function blend(d1, d2, w = 0.5) {
    if (!d1) return d2;
    if (!d2) return d1;
    const keys = ['dot','one','two','three','four','six','wkt'];
    const out = {};
    for (const k of keys) {
        out[k] = (d1[k] || 0) * (1 - w) + (d2[k] || 0) * w;
    }
    normalise(out);
    return out;
}

/**
 * Get the best available distribution for a batter vs bowler in a given phase.
 * Priority: head-to-head → batter phase → league average
 */
function getDeliveryDist(batter, bowler, phase, stats) {
    // Start with league average for phase
    let base = applyPhaseMod({ ...GENERIC_DIST }, phase);

    // Layer batter's phase profile
    const bp = stats.batters[batter];
    if (bp) {
        const pDist = bp[phase] || bp.overall;
        if (pDist) base = blend(base, pDist, 0.55);
    }

    // Layer bowler's phase profile (via economy / wicket rate adjustment)
    const bwp = stats.bowlers[bowler];
    if (bwp) {
        const bwDist = bwp[phase] || bwp.overall;
        if (bwDist) {
            // Adjust base by bowler's tendency
            const ecoFactor = bwDist.economy ? Math.max(0.7, Math.min(1.3, 8 / bwDist.economy)) : 1;
            const wktFactor = bwDist.wicketRate ? Math.max(0.7, Math.min(2.0, bwDist.wicketRate / 0.05)) : 1;
            base.dot  = Math.min(0.6, base.dot * (2 - ecoFactor));
            base.four = Math.max(0.03, base.four * ecoFactor * 0.9);
            base.six  = Math.max(0.02, base.six * ecoFactor * 0.9);
            base.wkt  = Math.min(0.20, base.wkt * wktFactor);
            normalise(base);
        }
    }

    // Layer head-to-head (if enough data)
    const h2h = stats.matchup[batter] && stats.matchup[batter][bowler];
    if (h2h) base = blend(base, h2h, 0.40);

    return base;
}

// ─── COMMENTARY TEMPLATES ─────────────────────────────────────────

const COMMENTARY = {
    six:  [
        '{b} launches {bw} into the stands! MAXIMUM!',
        'HUGE SIX! {b} clears the rope with ease.',
        'That is out of the ground! {b} vs {bw} — no contest.',
        '{b} flat-bats {bw} over mid-wicket for SIX!',
        'SIX! {b} picks the length early and sends it sailing.',
    ],
    four: [
        'FOUR! {b} drives {bw} through the covers beautifully.',
        'Cracking shot from {b}! Races to the boundary.',
        'FOUR — {b} gets underneath it and flicks it fine.',
        'Beautiful timing by {b}, past mid-off for four.',
        'Down the ground! {b} lofts {bw} over the bowler's head.',
    ],
    wkt: [
        'WICKET! {b} is OUT — {bw} gets the breakthrough!',
        'Gone! {b} chops it onto the stumps.',
        'CAUGHT! What a delivery from {bw} — {b} has to go.',
        '{bw} strikes! {b} walks back to the pavilion.',
        'Clean bowled! {bw} finds {b}'s outside edge through to the keeper.',
    ],
    dot: [
        'Dot ball. {bw} keeps it tight.',
        'Defended back. Good discipline from {bw}.',
        'Beaten! {b} doesn't connect.',
        'Outside off, left alone.',
        '{bw} builds the pressure — dot.',
    ],
    one:  ['{b} pushes for one.', 'Single — they rotate the strike.', 'Nudged for one.', 'Flicked to fine leg, a single.'],
    two:  ['{b} drives and gets two.', 'Well run! Two to the boundary.', 'Mid-off misfields — two runs.'],
    three:['{b} runs hard for three!', 'Misfield in the deep — three runs.'],
    wide: ['{bw} strays down leg — wide signalled.', 'Wide ball! Extras.'],
    noball: ['No-ball! Front-foot overstepping by {bw}.'],
};

function getCommentary(outcome, batter, bowler) {
    const list = COMMENTARY[outcome] || COMMENTARY.dot;
    const template = list[Math.floor(Math.random() * list.length)];
    return template.replace(/{b}/g, batter).replace(/{bw}/g, bowler);
}

// ─── WICKET KIND ──────────────────────────────────────────────────

const WICKET_KINDS = ['bowled','caught','lbw','caught-and-bowled','stumped','run out'];
const WICKET_WEIGHTS = [0.20, 0.45, 0.15, 0.08, 0.05, 0.07];

function sampleWicketKind() {
    const r = Math.random();
    let cum = 0;
    for (let i = 0; i < WICKET_KINDS.length; i++) {
        cum += WICKET_WEIGHTS[i];
        if (r < cum) return WICKET_KINDS[i];
    }
    return 'caught';
}

// ─── MAIN MATCH SIMULATION ────────────────────────────────────────

export function createMatchState(team1, team2, team1BatsFirst) {
    const battingTeam  = team1BatsFirst ? team1 : team2;
    const fieldingTeam = team1BatsFirst ? team2 : team1;
    return {
        inning: 1,
        battingTeam: battingTeam.name,
        fieldingTeam: fieldingTeam.name,
        battingSquad:  [...battingTeam.squad],
        bowlingSquad:  [...fieldingTeam.squad],
        bowlingAlloc:  { ...fieldingTeam.bowlingAlloc },

        // innings objects
        innings: [null, null],  // filled as we go

        // 1st innings state
        runs: 0, wickets: 0,
        over: 0, ball: 0,      // ball = 1-indexed within over
        legalBalls: 0,         // total legal deliveries
        batters: {
            striker:    { name: battingTeam.squad[0].name, runs: 0, balls: 0, fours: 0, sixes: 0 },
            nonStriker: { name: battingTeam.squad[1].name, runs: 0, balls: 0, fours: 0, sixes: 0 },
        },
        nextBatterIdx: 2,
        bowlerStates: {},   // name → { overs, runs, wkts, balls }
        currentBowler: null,
        bowlerOverCount: {}, // how many full overs bowled
        overBalls: [],       // balls in current over (for display)
        fallOfWickets: [],
        feed: [],
        extras: { wide: 0, noball: 0, bye: 0 },
        complete: false,
        target: null,
    };
}

/**
 * Choose next bowler (uses bowling allocation).
 */
function chooseBowler(state) {
    const alloc = state.bowlingAlloc;
    const bowled = state.bowlerOverCount;
    const squad = state.bowlingSquad;

    // Find bowlers who still have overs left and are valid bowlers
    const eligible = squad
        .filter(p => p.role === 'BOWL' || p.role === 'ALL')
        .filter(p => {
            const allowed = alloc[p.name] || 0;
            const done    = bowled[p.name] || 0;
            return done < allowed;
        });

    if (!eligible.length) {
        // Fallback: anyone with overs remaining
        const fallback = squad.filter(p => {
            const allowed = alloc[p.name] || 2;
            const done    = bowled[p.name] || 0;
            return done < allowed;
        });
        if (!fallback.length) return squad[squad.length - 1].name; // last resort
        // pick least-used
        fallback.sort((a, b) => (bowled[a.name]||0) - (bowled[b.name]||0));
        return fallback[0].name;
    }

    // Don't bowl same person twice in a row if possible
    const notCurrent = eligible.filter(p => p.name !== state.currentBowler);
    const pool = notCurrent.length ? notCurrent : eligible;
    // Pick the one with fewest overs bowled
    pool.sort((a, b) => (bowled[a.name]||0) - (bowled[b.name]||0));
    return pool[0].name;
}

/**
 * Simulate a single delivery.
 * Returns a delivery event object.
 */
export function simulateDelivery(state, stats) {
    const striker    = state.batters.striker;
    const bowlerName = state.currentBowler;

    if (!bowlerName) {
        state.currentBowler = chooseBowler(state);
    }

    const phase = getPhase(state.over);
    let dist = getDeliveryDist(striker.name, state.currentBowler, phase, stats);

    // ─ chase pressure modifier ─
    if (state.target) {
        const remaining = state.target - state.runs - 1;
        const ballsLeft = (20 * 6) - state.legalBalls;
        const rrr = ballsLeft > 0 ? (remaining / ballsLeft) * 6 : 99;
        if (rrr > 12) {
            // desperation — more sixes/wkts
            dist = { ...dist, six: dist.six * 1.6, wkt: dist.wkt * 1.25, dot: dist.dot * 0.8 };
            normalise(dist);
        } else if (rrr < 6) {
            // comfortable — less risk
            dist = { ...dist, six: dist.six * 0.7, wkt: dist.wkt * 0.8, one: dist.one * 1.2 };
            normalise(dist);
        }
    }

    const outcome = sampleDist(dist);

    // Build event
    const ev = {
        overBall:    `${state.over}.${state.ball}`,
        over:        state.over,
        ballInOver:  state.ball,
        batter:      striker.name,
        bowler:      state.currentBowler,
        outcome,
        runs:        0,
        isWkt:       false,
        isExtra:     false,
        extraType:   null,
        wicketKind:  null,
        commentary:  '',
    };

    // Extra check — occasional wide/no-ball
    const bowlerData = stats.bowlers[state.currentBowler];
    const extraRate  = bowlerData?.overall?.economy ? Math.max(0, (bowlerData.overall.economy - 7) * 0.015) : 0.03;
    if (Math.random() < extraRate && outcome !== 'wkt') {
        const isNB = Math.random() < 0.3;
        ev.isExtra   = true;
        ev.extraType = isNB ? 'noball' : 'wide';
        ev.runs = 1;
        ev.commentary = getCommentary(ev.extraType, striker.name, state.currentBowler);
        // don't consume a legal delivery for wides
        if (!isNB) return ev;
    }

    // Runs from outcome
    const RUN_MAP = { dot:0, one:1, two:2, three:3, four:4, six:6, wkt:0 };
    ev.runs += RUN_MAP[outcome] || 0;

    if (outcome === 'wkt') {
        ev.isWkt       = true;
        ev.wicketKind  = sampleWicketKind();
        ev.commentary  = getCommentary('wkt', striker.name, state.currentBowler);
    } else {
        ev.commentary  = getCommentary(outcome, striker.name, state.currentBowler);
    }

    return ev;
}

/**
 * Apply a delivery event to the match state.
 */
export function applyDelivery(state, ev) {
    // Update bowler state
    if (!state.bowlerStates[ev.bowler]) {
        state.bowlerStates[ev.bowler] = { overs: 0, balls: 0, runs: 0, wkts: 0 };
    }
    const bs = state.bowlerStates[ev.bowler];

    if (!ev.isExtra || ev.extraType === 'noball') {
        // Legal delivery
        state.legalBalls++;
        state.ball++;
        bs.balls++;
    }

    bs.runs += ev.runs;
    state.runs += ev.runs;

    if (ev.isExtra) {
        const eType = ev.extraType === 'noball' ? 'noball' : 'wide';
        state.extras[eType] = (state.extras[eType] || 0) + 1;
    }

    if (ev.isWkt && !(['run out','stumped'].includes(ev.wicketKind) && ev.extraType)) {
        bs.wkts++;
    }

    // Striker stats (only for non-wide deliveries)
    if (!ev.isExtra || ev.extraType === 'noball') {
        const striker = state.batters.striker;
        if (ev.outcome === 'four') { striker.runs += 4; striker.balls++; striker.fours++; }
        else if (ev.outcome === 'six') { striker.runs += 6; striker.balls++; striker.sixes++; }
        else if (!ev.isWkt) { striker.runs += ev.runs; striker.balls++; }
        else { striker.balls++; }
    }

    // Wicket
    if (ev.isWkt) {
        state.fallOfWickets.push({
            wicket: state.wickets + 1,
            batter: ev.batter,
            score: `${state.runs}/${state.wickets + 1}`,
            over: ev.overBall,
            kind: ev.wicketKind,
        });
        state.wickets++;
        // bring in next batter
        if (state.nextBatterIdx < state.battingSquad.length) {
            const nextB = state.battingSquad[state.nextBatterIdx++];
            state.batters.striker = { name: nextB.name, runs: 0, balls: 0, fours: 0, sixes: 0 };
        } else {
            state.complete = true;
        }
    }

    // Over balls display
    state.overBalls.push({
        type: ev.isExtra ? ev.extraType : ev.outcome,
        runs: ev.runs,
        isWkt: ev.isWkt,
    });

    // Rotate strike on odd runs (end of over also rotates)
    if (!ev.isExtra || ev.extraType === 'noball') {
        if ([1,3].includes(ev.runs) || ev.outcome === 'one' || ev.outcome === 'three') {
            const tmp = state.batters.striker;
            state.batters.striker    = state.batters.nonStriker;
            state.batters.nonStriker = tmp;
        }
    }

    // End of over
    if (state.ball > 6 || (state.ball === 6 && !ev.isExtra)) {
        // completed over
        bs.overs++;
        state.bowlerOverCount[ev.bowler] = (state.bowlerOverCount[ev.bowler] || 0) + 1;
        state.over++;
        state.ball = 1;
        state.overBalls = [];
        // rotate strike at end of over
        const tmp = state.batters.striker;
        state.batters.striker    = state.batters.nonStriker;
        state.batters.nonStriker = tmp;
        // choose next bowler
        state.currentBowler = null;
    }

    // Check for end of innings
    if (state.wickets >= 10 || state.over >= 20) {
        state.complete = true;
    }

    // Check target chase
    if (state.target && state.runs >= state.target) {
        state.complete = true;
        state.chaseWin = true;
    }

    // Feed entry
    state.feed.push({
        overBall: ev.overBall,
        batter: ev.batter,
        bowler: ev.bowler,
        outcome: ev.outcome,
        runs: ev.runs,
        isWkt: ev.isWkt,
        commentary: ev.commentary,
        score: `${state.runs}/${state.wickets}`,
    });
}

/** Get CRR */
export function getCRR(state) {
    if (!state.legalBalls) return 0;
    return ((state.runs / state.legalBalls) * 6).toFixed(2);
}

/** Get last 5 overs runs */
export function getLast5(state) {
    const feed = state.feed;
    if (!feed.length) return '—';
    const ballNo = state.legalBalls;
    const from   = Math.max(0, ballNo - 30);
    const slice  = feed.slice(from);
    const runs   = slice.reduce((s, e) => s + e.runs, 0);
    const wkts   = slice.filter(e => e.isWkt).length;
    return `${runs}/${wkts}`;
}
