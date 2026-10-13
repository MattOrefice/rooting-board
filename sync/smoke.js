#!/usr/bin/env node
// Render the board offline with a repo's index.html, data.json and results.json, click through every tab, and
// report page errors. Live feeds (ESPN and the rest) are blocked, so this checks the files, not today's scores.
// usage: node sync/smoke.js --repo <dir> [--react <dir holding node_modules/react and react-dom>]
// First time in a fresh workspace: npm install --prefix /tmp/rb react@18.3.1 react-dom@18.3.1, then --react /tmp/rb
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const repo = arg('--repo', '.'), rdir = arg('--react', '/tmp/rb');
let pw;
for (const p of ['playwright', '/opt/npm-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (e) { /* try the next */ } }
if (!pw) { console.error('Playwright not found; skip the smoke test.'); process.exit(2); }
const umd = (pkg, f) => { const p = path.join(rdir, 'node_modules', pkg, 'umd', f); if (!fs.existsSync(p)) { console.error('Missing ' + p + '. Run: npm install --prefix ' + rdir + ' react@18.3.1 react-dom@18.3.1'); process.exit(2); } return fs.readFileSync(p); };
const react = umd('react', 'react.production.min.js'), rdom = umd('react-dom', 'react-dom.production.min.js');
const week = JSON.parse(fs.readFileSync(path.join(repo, 'data.json'), 'utf8')).week;
(async () => {
  const browser = await pw.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York' })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|fetching the script/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.route('**/*', (route) => {
    const u = route.request().url(), ok = (body, type) => route.fulfill({ status: 200, contentType: type || 'application/json', body });
    if (u.startsWith('https://board.test/')) {
      const f = u.replace('https://board.test/', '').split('?')[0] || 'index.html';
      if (['index.html', 'data.json', 'results.json'].indexOf(f) >= 0) return ok(fs.readFileSync(path.join(repo, f)), f.endsWith('.html') ? 'text/html' : 'application/json');
      return route.fulfill({ status: 404, body: '' });
    }
    if (u.includes('cdnjs.cloudflare.com') && u.includes('react-dom')) return ok(rdom, 'text/javascript');
    if (u.includes('cdnjs.cloudflare.com') && u.includes('react')) return ok(react, 'text/javascript');
    return route.abort();
  });
  await page.goto('https://board.test/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const out = [];
  for (const b of await page.locator('nav.tabs button').all()) {
    const name = (await b.innerText()).trim();
    await b.click();
    await page.waitForTimeout(500);
    const text = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');
    out.push(name + ': ' + text.length + ' chars');
    if (/^Results$/.test(name)) out.push('  Results weeks shown: ' + (await page.locator('.res-row').count()) + '; latest: ' + ((await page.locator('.res-row').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120)));
  }
  console.log('Board for week ' + week + ' rendered. ' + out.join('\n'));
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'No page errors.');
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
