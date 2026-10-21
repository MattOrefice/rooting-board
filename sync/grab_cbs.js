// Rooting board weekly sync, CBS side. Run with javascript_tool on the CBS pool's Weekly standings page
// (Standings, then Weekly) after picking the week in the week menu. It reads the grid: each game with its final
// score (once played) and the pool's line, the tiebreaker, and every player's rank, week points, season points,
// picks and tiebreaker guess. Then it replaces the page with one <pre id="rbdump"> holding compact JSON.
// Read it with get_page_text, save the JSON exactly, and check the file against the byte count and hash
// returned here: python3 sync/fnv.py <file>.
await (async () => {
  const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
  const ab = (a) => { const x = String(a == null ? '' : a).trim().toUpperCase(); return FIX[x] || x; };
  const t = document.body.innerText;
  const i0 = t.indexOf('PLAYERS');
  if (i0 < 0) return 'ERROR: no PLAYERS grid on this page. Open Standings, then Weekly, and pick the week.';
  const wm = t.slice(Math.max(0, i0 - 80), i0).match(/Week (\d+)/);
  const i1 = t.indexOf('\nMore\n', i0);
  const tok = t.slice(i0, i1 > 0 ? i1 : undefined).split(/[\t\n]+/).map((s) => s.trim()).filter(Boolean);
  let k = 0;
  const want = (x) => { if (tok[k] !== x) throw new Error('expected ' + x + ' at token ' + k + ' but found ' + tok[k]); k++; };
  const NUM = /^-?\d+(\.\d+)?$/, TEAM = /^[A-Z]{2,3}$/;
  try {
    want('PLAYERS'); want('PTS'); want('YTD');
    const games = [];
    while (k < tok.length && tok[k] !== 'TIE') {
      const st = tok[k++], away = tok[k++], home = tok[k++];
      if (!TEAM.test(away || '') || !TEAM.test(home || '')) throw new Error('bad game near token ' + k + ': ' + [st, away, home].join(' '));
      let a = null, hs = null;
      if (/^\d+$/.test(tok[k] || '') && /^\d+$/.test(tok[k + 1] || '')) { a = Number(tok[k++]); hs = Number(tok[k++]); }
      let line = null;
      const lm = String(tok[k] || '').match(/^\(([+-]?\d+(?:\.\d+)?|PK|EVEN)\)$/i);
      if (lm) { line = /^(PK|EVEN)$/i.test(lm[1]) ? 0 : Number(lm[1]); k++; }
      games.push([ab(away), ab(home), a, hs, line, /OT/.test(st) ? 1 : 0, st]);
    }
    want('TIE');
    const tbGame = tok[k++];
    let tbTot = null;
    if (NUM.test(tok[k] || '')) tbTot = Number(tok[k++]); else if (tok[k] === '-') k++;
    const players = [];
    const RANK = /^T?-?\d+(st|nd|rd|th)$/i;
    while (k < tok.length) {
      const rank = RANK.test(tok[k]) ? tok[k++] : null;
      const name = tok[k++];
      if (!NUM.test(tok[k] || '') || !NUM.test(tok[k + 1] || '')) throw new Error('bad points for ' + name + ': ' + tok[k] + ' ' + tok[k + 1]);
      const pts = Number(tok[k++]), ytd = Number(tok[k++]);
      const picks = [];
      // a player who hasn't picked any game yet (early in the week) has an empty row
      const none = k >= tok.length || (tok[k] !== '-' && !TEAM.test(tok[k]));
      for (let j = 0; j < games.length; j++) {
        if (none) { picks.push(''); continue; }
        const x = tok[k++];
        if (x !== '-' && !TEAM.test(x || '')) throw new Error('bad pick for ' + name + ' in game ' + (j + 1) + ': ' + x);
        picks.push(x === '-' ? '' : ab(x));
      }
      let tb = null;
      if (NUM.test(tok[k] || '') && !RANK.test(tok[k])) tb = Number(tok[k++]); else if (tok[k] === '-') k++;
      players.push([rank, name, pts, ytd, picks, tb]);
    }
    const out = { v: 1, week: wm ? Number(wm[1]) : null, at: new Date().toISOString(), g: games, tb: [tbGame, tbTot], p: players };
    const txt = JSON.stringify(out);
    document.body.innerHTML = '<article><pre id="rbdump"></pre></article>';
    document.getElementById('rbdump').textContent = txt;
    const bytes = new TextEncoder().encode(txt);
    let hsh = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { hsh ^= bytes[i]; hsh = Math.imul(hsh, 0x01000193) >>> 0; }
    return 'rbdump ' + bytes.length + ' bytes, fnv ' + hsh + '; CBS week ' + out.week + ': ' + games.length + ' games (' + games.filter((g) => g[2] != null).length + ' final, ' + games.filter((g) => g[4] != null).length + ' with lines), ' + players.length + ' players, tiebreaker ' + tbGame + ' ' + (tbTot == null ? 'not played' : tbTot);
  } catch (e) { return 'ERROR: ' + e.message; }
})()
