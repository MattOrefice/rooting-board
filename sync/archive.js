#!/usr/bin/env node
// Rooting board weekly sync: archive the finished week into results.json and roll data.json to the next week.
//
// usage: node sync/archive.js --repo <dir> --espn <espn dump> --cbs <CBS dump, finished week>
//                             [--cbs-next <CBS dump, next week>] [--partial] [--dry]
//   Reads <repo>/data.json, <repo>/results.json and <repo>/index.html (the board's own settling code).
//   Writes data.json and results.json back into <repo> unless --dry, and prints a report.
//   --partial archives even if some games aren't final (normally it stops).
// Safe to run again: a week already in results.json is replaced, and data.json is only rolled from the week it
// is on (run it on a fresh copy of data.json if you need to redo a roll).
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2), arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; }, flag = (k) => argv.indexOf(k) >= 0;
const repo = arg('--repo') || '.';
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const D = readJ(path.join(repo, 'data.json')), R = readJ(path.join(repo, 'results.json'));
if (flag('--plan')) {
  // the config line for sync/grab_espn.js: games and players that this week's prop bets need from the box scores
  const Lp = require('./applib.js')(path.join(repo, 'index.html'));
  const ids = new Set((D.games || []).map((g) => g.id)), box = new Set(), players = new Set();
  (D.bets || []).forEach((b) => (b.legs || []).forEach((l) => {
    if (l.kind !== 'game' || !ids.has(l.game) || l.type !== 'prop' || (l.status && l.status !== 'open')) return;
    box.add(l.game);
    const sp = Lp.propSpec(l);
    if (sp && sp.players) sp.players.forEach((n) => players.add(n)); else if (sp && sp.player) players.add(sp.player);
  }));
  const P = (D.leagues || {}).pickem || {};
  console.log('const CFG = ' + JSON.stringify({ season: D.season, week: Number(D.week), box: [...box], players: [...players], challenge: P.espnChallenge || 'nfl-pickem-' + D.season, group: P.espnGroup || '' }) + ';');
  process.exit(0);
}
const E = readJ(arg('--espn')), C = readJ(arg('--cbs')), CN = arg('--cbs-next') ? readJ(arg('--cbs-next')) : null;
const L = require('./applib.js')(path.join(repo, 'index.html'));
const N = Number(D.week);
const report = [], warns = [];
const warn = (s) => warns.push(s);
const fail = (s) => { console.error('STOP: ' + s); process.exit(1); };
const r2 = (v) => Math.round(Number(v) * 100) / 100;
const money = (v) => (v > 0.004 ? '+' : v < -0.004 ? '-' : '') + '$' + Math.abs(r2(v)).toFixed(2).replace(/\.00$/, '');
const uc = (s) => String(s == null ? '' : s).trim().toUpperCase();
const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' }, ab = (t) => FIX[uc(t)] || uc(t);

if (Number(E.week) !== N) fail('ESPN dump is for week ' + E.week + ' but data.json is on week ' + N);
if (Number(C.week) !== N) fail('CBS dump is for week ' + C.week + ' but data.json is on week ' + N);
if (CN && Number(CN.week) !== N + 1) fail('next-week CBS dump is for week ' + CN.week + ', expected ' + (N + 1));
if ((E.err || []).length) warn('ESPN dump errors: ' + E.err.join('; '));

// ---------- 1. finals onto this week's games ----------
const fin = {};
(E.fin || []).forEach(([id, a, h, ot]) => { fin[id] = { a, h, ot: !!ot }; });
const games = D.games.map((g) => { const f = fin[g.id]; return f ? Object.assign({}, g, { status: 'final', awayScore: f.a, homeScore: f.h, clock: '' }) : Object.assign({}, g); });
const notFinal = games.filter((g) => g.status !== 'final');
if (notFinal.length && !flag('--partial')) fail('not final yet: ' + notFinal.map((g) => g.id).join(', ') + ' (use --partial to archive anyway)');
Object.keys(fin).forEach((id) => { if (!D.games.some((g) => g.id === id)) warn('ESPN final for ' + id + ' is not one of data.json\'s games'); });
const byId = {};
games.forEach((g) => { byId[g.id] = g; });

// ---------- 2. CBS grid: game order, pool lines, picks, weekly order, tiebreaker ----------
const cbsGames = (C.g || []).map(([away, home, a, h, line, ot]) => ({ id: ab(away) + '@' + ab(home), a, h, line, ot: !!ot }));
cbsGames.forEach((x) => {
  const g = byId[x.id];
  if (!g) { warn('CBS game ' + x.id + ' is not in data.json'); return; }
  if (x.a != null && g.status === 'final' && (x.a !== g.awayScore || x.h !== g.homeScore)) warn('score mismatch ' + x.id + ': CBS ' + x.a + '-' + x.h + ', ESPN ' + g.awayScore + '-' + g.homeScore);
});
games.forEach((g) => { if (!cbsGames.some((x) => x.id === g.id)) warn(g.id + ' is missing from the CBS grid'); });
const order = cbsGames.map((x) => x.id).filter((id) => byId[id]).concat(games.map((g) => g.id).filter((id) => !cbsGames.some((x) => x.id === id)));
const lineOf = (id) => { const x = cbsGames.find((y) => y.id === id); if (x && x.line != null) return x.line; warn('no CBS line for ' + id + ', using ' + byId[id].line); return byId[id].line; };
const spreadPlayers = (D.leagues.spread || {}).players || [], pickemPlayers = (D.leagues.pickem || {}).players || [];
(C.p || []).forEach((p) => { if (spreadPlayers.indexOf(p[1]) < 0) warn('CBS player "' + p[1] + '" is not in the spread pool\'s player list'); });
const cbsPick = {};
(C.p || []).forEach(([rank, name, pts, ytd, picks]) => { cbsPick[name] = {}; cbsGames.forEach((x, i) => { if (picks[i]) cbsPick[name][x.id] = picks[i]; }); });
const pickStr = (m) => order.map((id) => (m && m[id]) || '').join(',');
const spread = { picks: {}, order: (C.p || []).map((p) => p[1]), tb: { game: C.tb[0], total: C.tb[1], guess: {} } };
(C.p || []).forEach(([rank, name, pts, ytd, picks, tb]) => { spread.picks[name] = pickStr(cbsPick[name]); if (tb != null) spread.tb.guess[name] = tb; });
// ---------- 3. ESPN pick'em ----------
const pool = E.pool || { picks: {}, total: {}, wk: {} };
if (!E.pool) warn('ESPN pool picks missing from the dump');
const pickem = { picks: {} };
Object.keys(pool.picks).forEach((name) => { if (pickemPlayers.indexOf(name) < 0) warn('ESPN entry "' + name + '" is not in the pick\'em player list'); pickem.picks[name] = pickStr(pool.picks[name]); });

// ---------- 4. bets: settle with the board's own rules ----------
const KEYS = ['passAtt', 'passYds', 'passTD', 'passInt', 'rushAtt', 'rushYds', 'rushTD', 'rec', 'recYds', 'recTD', 'fgMade'];
const boxes = {};
Object.keys(E.box || {}).forEach((gid) => {
  const bx = E.box[gid];
  const arr = (bx.p || []).map((row) => { const [name, team, vals] = row.split('|'); const s = {}; String(vals || '').split(',').forEach((v, i) => { if (v !== '' && KEYS[i]) s[KEYS[i]] = Number(v); }); return { name, team, tokens: L.nameTokens(name), s }; });
  arr.firstTD = bx.ft === undefined ? null : bx.ft;
  arr.wp = null;
  boxes[gid] = arr;
});
const legV = (l, g) => {
  if (!g) return '';
  if (l.type === 'prop') {
    const ps = L.propState(l, g, boxes[g.id]);
    if (!ps) return '';
    if (ps.first) return ps.ft ? 'first TD: ' + ps.ft : '';
    if (!ps.pl) return '';
    const v = Math.round(ps.val * 10) / 10, lab = L.STATLBL[ps.sp.stat] || '';
    return v + ' ' + (v === 1 && lab === 'catches' ? 'catch' : v === 1 && lab === 'carries' ? 'carry' : lab);
  }
  if (!L.hasScore(g)) return '';
  if (l.type === 'total') return (Number(g.awayScore) + Number(g.homeScore)) + ' pts';
  if (l.type === 'ml' || l.type === 'spread' || l.type === 'score') return g.away + ' ' + g.awayScore + '-' + g.homeScore + ' ' + g.home;
  return '';
};
const settled = [], unsettled = [];
(D.bets || []).forEach((b0) => {
  const b = Object.assign({ legs: [], bonus: false }, b0);
  if (!b.legs.some((l) => l.kind === 'game' && byId[l.game])) return;
  const st = L.betStatus(b, byId, boxes);
  if (st === 'open') {
    const why = b.legs.filter((l) => l.kind === 'game').map((l) => { const g = byId[l.game], r = L.legResult(l, g, boxes); return r === 'open' ? L.legText(l) + (l.type === 'prop' && !boxes[l.game] ? ' (no box score in the dump)' : l.type === 'prop' ? ' (player not in the box score)' : g && g.status !== 'final' ? ' (game not final)' : '') : null; }).filter(Boolean);
    unsettled.push(b.id + ' ' + b.desc + ': ' + why.join('; '));
    return;
  }
  const legs = b.legs.filter((l) => l.kind === 'game').map((l) => { const g = byId[l.game]; return { t: L.legText(l), g: l.game, r: L.legResult(l, g, boxes), v: legV(l, g) }; });
  const o = { id: b.id, book: b.book, placed: b.placed, desc: b.desc, stake: b.stake, toPay: b.toPay, status: st, net: r2(L.betNet(b, st)), legs };
  // kind, live and boost are the betting breakdown's overrides for what the description doesn't say
  ['bonus', 'voided', 'note', 'ref', 'st', 'kind', 'live', 'boost'].forEach((k) => { if (b0[k] != null && b0[k] !== false) o[k] = b0[k]; });
  settled.push(o);
});

// ---------- 5. survivor ----------
let survivor = null;
const sv = uc(D.survivor);
if (sv) survivor = { pick: sv, result: L.survResult(sv, games) };
// survivor pools (data.survivorPools; an older data.json has one as survivorPool). Entry numbers run on across pools.
const pools0 = L.survPools(D);
if (pools0.length) {
  const ent = pools0.flatMap((SP) => SP.entries.filter((e) => e.pick && !e.out).map((e) => ({ n: e.n, pick: uc(e.pick), result: L.survResult(uc(e.pick), games), pool: SP.short || 'Survivor' })));
  if (ent.length) survivor = { pool: L.survLabel(pools0), entries: ent };
  pools0.forEach((SP) => SP.entries.filter((e) => !e.out && !e.pick).forEach((e) => warn((SP.short || 'Survivor') + ' entry #' + e.n + ' had no pick recorded for week ' + N + '; ask Matt whether it is still alive')));
}

// ---------- 6. the archived week ----------
const week = { week: N, games: order.map((id) => { const g = byId[id], o = { id, a: g.awayScore, h: g.homeScore, line: lineOf(id) }; if (fin[id] && fin[id].ot) o.ot = true; return o; }), spread, pickem };
if (survivor) week.survivor = survivor;
week.bets = settled;
const prevIdx = R.weeks.findIndex((w) => Number(w.week) === N);
if (prevIdx >= 0) { warn('week ' + N + ' was already in results.json; replaced it'); R.weeks[prevIdx] = week; } else R.weeks.push(week);
R.weeks.sort((x, y) => Number(x.week) - Number(y.week));
const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
R.updatedAt = stamp;

// ---------- 7. roll data.json to next week ----------
const nd = JSON.parse(JSON.stringify(D));
const pools1 = L.survPools(nd);
const sched = (E.nx || []).map(([id, iso, line, total, wp], i) => { const [away, home] = id.split('@'), when = new Date(iso); return { id, away, home, kick: isNaN(when) ? '' : L.etKick(when), line, total, homeWP: wp, status: 'upcoming', awayScore: null, homeScore: null, clock: '', _t: when.getTime() || 0, _i: i }; })
  .sort((x, y) => x._t - y._t || x._i - y._i).map((g) => { delete g._t; delete g._i; return g; });
if (!sched.length) warn('no week ' + (N + 1) + ' schedule in the ESPN dump; data.json keeps its games');
let lineSource = 'DraftKings';
if (CN) {
  const cl = {};
  (CN.g || []).forEach(([away, home, a, h, line]) => { if (line != null) cl[ab(away) + '@' + ab(home)] = line; });
  const hit = sched.filter((g) => cl[g.id] != null);
  hit.forEach((g) => { g.line = cl[g.id]; });
  if (hit.length && hit.length === sched.length) lineSource = 'CBS';
  else if (hit.length) warn('CBS has lines for ' + hit.length + ' of ' + sched.length + ' week ' + (N + 1) + ' games; marked as DraftKings until the rest post');
}
if (sched.length) {
  nd.week = N + 1;
  nd.games = sched;
  nd.spreadPicks = {};
  nd.pickemPicks = {};
  nd.survivor = '';
  nd.lineSource = lineSource;
  nd.gamesLeft = Math.max(0, (Number(D.gamesLeft) || 0) - D.games.length);
  // standings at the start of next week: CBS season points and ESPN season totals
  const ytd = {};
  (C.p || []).forEach(([rank, name, pts, y]) => { ytd[name] = y; });
  if (nd.leagues.spread) nd.leagues.spread.standings = spreadPlayers.map((p) => ({ name: p, pts: ytd[p] != null ? ytd[p] : ((nd.leagues.spread.standings || []).find((x) => x.name === p) || {}).pts || 0 }));
  if (nd.leagues.pickem) nd.leagues.pickem.standings = pickemPlayers.map((p) => ({ name: p, pts: pool.total && pool.total[p] != null ? pool.total[p] : ((nd.leagues.pickem.standings || []).find((x) => x.name === p) || {}).pts || 0 }));
  // bets: drop what settled; keep futures, anything still open, and bets already placed on next week's games
  const nextIds = new Set(sched.map((g) => g.id)), done = new Set(settled.map((b) => b.id));
  nd.bets = (D.bets || []).filter((b) => { const legs = b.legs || []; if (legs.some((l) => l.kind === 'game' && nextIds.has(l.game))) return true; if (!legs.some((l) => l.kind === 'game' && byId[l.game])) return true; return !done.has(b.id); });
  // survivor pools: used teams, eliminations, blank picks for the new week
  pools1.forEach((SP) => SP.entries.forEach((e) => {
    if (e.out || !e.pick) return;
    const pk = uc(e.pick), res = L.survResult(pk, games);
    e.used = (e.used || []).concat([pk]);
    e.pick = '';
    if (res === 'lost') { e.out = N; e.outPick = pk; }
    else if (res === 'tie') warn((SP.short || 'Survivor') + ' entry #' + e.n + ': ' + pk + ' tied. Kept alive; check the pool\'s rule for ties');
    else if (res !== 'won') warn((SP.short || 'Survivor') + ' entry #' + e.n + ': ' + pk + ' has no final result');
  }));
  // each pool's field after this week: Matt's count when he sends one, otherwise an estimate from the week's favorites
  pools1.forEach((SP, i) => {
    delete SP.aliveNow; delete SP.aliveNowAt;
    if (!SP.prize || !pools0[i]) return;
    const sv0 = L.survValue(pools0[i], D.games);
    SP.alive = Math.max(1, Math.round(Math.min(sv0.alive * sv0.s, sv0.aliveNow || Infinity)));
    SP.aliveEst = true;
    warn((SP.short || 'Survivor') + ' field: about ' + SP.alive + ' entries left (an estimate from about ' + Math.round(100 * sv0.s) + '% surviving). Ask Matt for the real count from the pool screen; set that pool\'s alive in survivorPools to it and aliveEst to false' + (SP.field ? '' : ', and its field to the starting count'));
  });
  ['boxes', 'history', 'autoWeek'].forEach((k) => { delete nd[k]; });
  nd.updatedAt = stamp;
}

// ---------- 8. report ----------
const me = D.me || {};
const myC = (C.p || []).find((p) => p[1] === me.spread);
const rankOfYtd = (name, tbl) => 1 + tbl.filter((x) => x.pts > (tbl.find((y) => y.name === name) || {}).pts).length;
report.push('Week ' + N + ' archived: ' + games.filter((g) => g.status === 'final').length + ' of ' + games.length + ' games final.');
if (myC && nd.leagues && nd.leagues.spread) { const tbl = nd.leagues.spread.standings; report.push((D.leagues.spread.name || 'CBS pool') + ': ' + myC[2] + ' this week (' + (myC[0] || 'unranked') + '), season ' + myC[3] + ', ' + rankOfYtd(me.spread, tbl) + ' of ' + tbl.length + '.'); }
if (pool.total && pool.total[me.pickem] != null && nd.leagues && nd.leagues.pickem) { const tbl = nd.leagues.pickem.standings; report.push((D.leagues.pickem.name || 'ESPN pool') + ': ' + (pool.wk[me.pickem] != null ? pool.wk[me.pickem] : '?') + ' this week, season ' + pool.total[me.pickem] + ', ' + rankOfYtd(me.pickem, tbl) + ' of ' + tbl.length + '.'); }
const W = settled.filter((b) => b.status === 'won').length, Lo = settled.filter((b) => b.status === 'lost').length, P = settled.filter((b) => b.status === 'void').length;
report.push('Bets settled on the board: ' + settled.length + ' (' + W + ' won, ' + Lo + ' lost' + (P ? ', ' + P + ' push' : '') + '), net ' + money(settled.reduce((t, b) => t + (b.net || 0), 0)) + '.');
if (unsettled.length) report.push('Not settled, kept open in data.json (settle by hand):\n  ' + unsettled.join('\n  '));
if (survivor && survivor.entries) report.push(survivor.pool + ': ' + survivor.entries.map((e) => '#' + e.n + ' ' + e.pick + ' ' + e.result).join(', ') + '. ' + pools1.map((SP) => (SP.short || 'Survivor') + ': ' + L.survAlive(SP).length + ' of ' + SP.entries.length + ' entries alive.').join(' '));
else if (survivor) report.push('Survivor: ' + survivor.pick + ' ' + survivor.result + '.');
if (sched.length) report.push('Week ' + (N + 1) + ': ' + sched.length + ' games, lines from ' + lineSource + ', first kickoff ' + sched[0].kick + ' (' + sched[0].id + '). ' + nd.bets.length + ' open bets carried over.');
if (warns.length) report.push('Check these:\n  ' + warns.join('\n  '));
console.log(report.join('\n'));

if (!flag('--dry')) {
  fs.writeFileSync(path.join(repo, 'results.json'), JSON.stringify(R) + '\n');
  if (sched.length) fs.writeFileSync(path.join(repo, 'data.json'), JSON.stringify(nd) + '\n');
  console.log('\nWrote results.json' + (sched.length ? ' and data.json' : '') + ' in ' + path.resolve(repo) + '.');
} else console.log('\n(dry run: nothing written)');
