// Rooting board weekly sync, ESPN side. Run with javascript_tool in a www.cbssports.com tab (ESPN's public APIs
// answer that origin; github.com blocks them). Send this file's text with one config line in front of it:
//   const CFG = { season: 2026, week: 6, box: ['CAR@PHI'], challenge: 'nfl-pickem-2026', group: '<ESPN group id>' };
// week: the week being archived. box: games whose player stats settle prop bets ('all' for every game).
// It collects that week's finals, next week's schedule with DraftKings lines (read the way the board reads them),
// box scores for the listed games and the ESPN pick'em group's picks, then replaces the page with one
// <pre id="rbdump"> holding compact JSON. Read it with get_page_text, save the JSON exactly, and check the file
// against the byte count and hash returned here: python3 sync/fnv.py <file>.
await (async () => {
  const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
  const ab = (a) => { const x = String(a == null ? '' : a).trim().toUpperCase(); return FIX[x] || x; };
  const uc = (a) => String(a == null ? '' : a).trim().toUpperCase();
  const get = async (u) => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
  const dec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
  const out = { v: 1, season: CFG.season, week: CFG.week, at: new Date().toISOString(), fin: [], open: [], nx: [], box: {}, pool: null, err: [] };
  const sbUrl = (wk) => 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=' + wk + '&dates=' + CFG.season;
  const sides = (c) => { const t = (ha) => (c.competitors || []).find((x) => x.homeAway === ha) || {}; return [t('away'), t('home')]; };
  // 1. finals for the week being archived
  const evOf = {};
  try {
    const S = await get(sbUrl(CFG.week));
    (S.events || []).forEach((e) => {
      const c = (e.competitions || [])[0];
      if (!c) return;
      const [A, H] = sides(c), id = ab(A.team && A.team.abbreviation) + '@' + ab(H.team && H.team.abbreviation);
      evOf[id] = e.id;
      const st = (c.status && c.status.type) || (e.status && e.status.type) || {};
      if (st.state === 'post' && st.completed !== false) out.fin.push([id, Number(A.score) || 0, Number(H.score) || 0, (c.status && c.status.period > 4) || /OT/.test(st.detail || st.shortDetail || '') ? 1 : 0]);
      else out.open.push([id, st.shortDetail || st.state || '']);
    });
  } catch (e) { out.err.push('scoreboard week ' + CFG.week + ': ' + e.message); }
  // 2. next week's schedule: DraftKings line (home spread), total and home win chance
  try {
    const S = await get(sbUrl(CFG.week + 1));
    for (const e of S.events || []) {
      const c = (e.competitions || [])[0];
      if (!c) continue;
      const [A, H] = sides(c), home = ab(H.team && H.team.abbreviation), away = ab(A.team && A.team.abbreviation);
      if (!home || !away) continue;
      const od = (c.odds || [])[0] || {}, det = String(od.details || '').trim(), dm = det.match(/^([A-Z]{2,3})\s+(-?\d+(?:\.\d+)?)$/);
      let line = null, wp = null, total = Number(od.overUnder) > 0 ? Number(od.overUnder) : null;
      if (/^(EVEN|PK|PICK)/i.test(det)) line = 0;
      else if (dm) { const fav = ab(dm[1]), n = Math.abs(parseFloat(dm[2])); line = fav === home ? -n : n; }
      const hml = Number(od.homeTeamOdds && od.homeTeamOdds.moneyLine), aml = Number(od.awayTeamOdds && od.awayTeamOdds.moneyLine);
      if (hml && aml) { const ih = 1 / dec(hml), ia = 1 / dec(aml); wp = Math.round(100 * ih / (ih + ia)) / 100; }
      else {
        try {
          const j = await get('https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/' + e.id + '/competitions/' + e.id + '/odds');
          const it = (j.items || []).find((i) => !/live/i.test((i.provider && i.provider.name) || ''));
          const n = (x) => { const v = parseFloat(x); return isFinite(v) ? v : null; };
          if (it) {
            const h2 = n(it.homeTeamOdds && it.homeTeamOdds.moneyLine), a2 = n(it.awayTeamOdds && it.awayTeamOdds.moneyLine);
            if (h2 && a2) { const ih = 1 / dec(h2), ia = 1 / dec(a2); wp = Math.round(1000 * ih / (ih + ia)) / 1000; }
            if (line == null && n(it.spread) != null) line = n(it.spread);
            if (total == null && n(it.overUnder) != null) total = n(it.overUnder);
          }
        } catch (x) { /* no pregame odds yet */ }
      }
      out.nx.push([away + '@' + home, e.date || c.date || '', line, total, wp]);
    }
  } catch (e) { out.err.push('scoreboard week ' + (CFG.week + 1) + ': ' + e.message); }
  // 3. box scores, every player in the passing, rushing, receiving and kicking tables (blank = not in that table)
  const KEYS = ['passAtt', 'passYds', 'passTD', 'passInt', 'rushAtt', 'rushYds', 'rushTD', 'rec', 'recYds', 'recTD', 'fgMade'];
  const firstTd = (j) => {
    const plays = (j && j.scoringPlays) || [];
    const td = plays.find((p) => /touchdown/i.test(((p.type || {}).text || '') + ' ' + ((p.scoringType || {}).name || '') + ' ' + ((p.scoringType || {}).displayName || '')));
    if (!td) return null;
    const t = String(td.text || '').trim();
    const m = t.match(/^(.+?)\s+\d+\s*(?:yd|yds|yard|yards)\b/i) || t.match(/^(.+?)\s+(?:pass|run|rush|fumble|interception|punt|kick|blocked|recovery)\b/i);
    return m ? m[1].trim() : '';
  };
  const want = CFG.box === 'all' ? Object.keys(evOf) : (CFG.box || []);
  for (const g of want) {
    const id = evOf[g];
    if (!id) { out.err.push('no ESPN event for ' + g); continue; }
    try {
      const j = await get('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=' + id);
      const byName = {}, order = [];
      (((j || {}).boxscore || {}).players || []).forEach((tm) => {
        const team = uc(tm.team && tm.team.abbreviation);
        (tm.statistics || []).forEach((cat) => {
          const keys = cat.keys || [], labels = (cat.labels || []).map((x) => String(x).toUpperCase());
          const col = (k, lab) => { const i = keys.indexOf(k); return i >= 0 ? i : labels.indexOf(lab); };
          (cat.athletes || []).forEach((a) => {
            const name = (a.athlete && (a.athlete.displayName || a.athlete.shortName)) || '';
            if (!name) return;
            if (!byName[name]) { byName[name] = { team, s: {} }; order.push(name); }
            const p = byName[name];
            const v = (i) => (i >= 0 && a.stats && a.stats[i] != null ? parseFloat(String(a.stats[i]).split('/')[0]) || 0 : 0);
            if (cat.name === 'passing') { p.s.passYds = v(col('passingYards', 'YDS')); p.s.passTD = v(col('passingTouchdowns', 'TD')); p.s.passInt = v(col('interceptions', 'INT')); const ca = col('completions/passingAttempts', 'C/ATT'); p.s.passAtt = ca >= 0 && a.stats && a.stats[ca] != null ? parseFloat(String(a.stats[ca]).split('/')[1]) || 0 : 0; }
            else if (cat.name === 'kicking') { p.s.fgMade = v(col('fieldGoalsMade/fieldGoalAttempts', 'FG')); }
            else if (cat.name === 'rushing') { p.s.rushAtt = v(col('rushingAttempts', 'CAR')); p.s.rushYds = v(col('rushingYards', 'YDS')); p.s.rushTD = v(col('rushingTouchdowns', 'TD')); }
            else if (cat.name === 'receiving') { p.s.rec = v(col('receptions', 'REC')); p.s.recYds = v(col('receivingYards', 'YDS')); p.s.recTD = v(col('receivingTouchdowns', 'TD')); }
          });
        });
      });
      out.box[g] = { ft: firstTd(j), p: order.map((n) => n.replace(/\|/g, '/') + '|' + byName[n].team + '|' + KEYS.map((k) => (byName[n].s[k] == null ? '' : byName[n].s[k])).join(',')) };
    } catch (e) { out.err.push('box ' + g + ': ' + e.message); }
  }
  // 4. ESPN pick'em group: every entry's picks for the week, its week score and its season total
  if (CFG.challenge && CFG.group) {
    try {
      const base = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/' + CFG.challenge;
      const c = await get(base + '?scoringPeriodId=' + CFG.week);
      const props = {};
      (c.propositions || []).forEach((p) => {
        if (p.scoringPeriodId != null && Number(p.scoringPeriodId) !== Number(CFG.week)) return;
        const m = String(p.name || '').match(/^\s*([A-Za-z]{2,3})\s*@\s*([A-Za-z]{2,3})\s*$/);
        if (!m) return;
        const oc = {};
        (p.possibleOutcomes || []).forEach((o) => { oc[o.id] = ab(o.abbrev || ''); });
        props[p.id] = { gid: ab(m[1]) + '@' + ab(m[2]), oc };
      });
      const gr = await get(base + '/groups/' + CFG.group);
      const picks = {}, total = {}, wk = {};
      for (const en of gr.entries || []) {
        let e = en;
        if (!e.picks) { try { e = await get(base + '/entries/' + en.id); } catch (x) { continue; } }
        const name = en.name || e.name;
        if (!name) continue;
        picks[name] = {};
        (e.picks || []).forEach((pk) => { const pr = props[pk.propositionId], o = pk.outcomesPicked && pk.outcomesPicked[0], t = pr && o ? pr.oc[o.outcomeId] : ''; if (t) picks[name][pr.gid] = t; });
        const sc = en.score || e.score || {}, sp = (sc.scoreByPeriod || {})[String(CFG.week)];
        total[name] = sc.overallScore != null ? sc.overallScore : null;
        wk[name] = sp && sp.score != null ? sp.score : null;
      }
      out.pool = { games: Object.keys(props).length, picks, total, wk };
    } catch (e) { out.err.push('ESPN pool: ' + e.message); }
  }
  const txt = JSON.stringify(out);
  document.body.innerHTML = '<article><pre id="rbdump"></pre></article>';
  document.getElementById('rbdump').textContent = txt;
  const bytes = new TextEncoder().encode(txt);
  let hsh = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { hsh ^= bytes[i]; hsh = Math.imul(hsh, 0x01000193) >>> 0; }
  return 'rbdump ' + bytes.length + ' bytes, fnv ' + hsh + '; week ' + CFG.week + ' finals ' + out.fin.length + ', not final ' + out.open.length + '; week ' + (CFG.week + 1) + ' games ' + out.nx.length + '; box scores ' + Object.keys(out.box).length + '; ESPN pool ' + (out.pool ? Object.keys(out.pool.picks).length + ' entries over ' + out.pool.games + ' games' : 'not read') + (out.err.length ? '; ERRORS: ' + out.err.join('; ') : '');
})()
