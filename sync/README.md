# Weekly sync

How the board gets archived and rolled forward each Tuesday after Monday Night Football. A scheduled Claude
session follows these steps; a person can too. Nothing here needs a password. Matt is signed in to CBS and
GitHub in his Chrome, and the session drives that Chrome through the Claude in Chrome extension.

Week N is the week that just finished (the week `data.json` is on). Week N+1 is the next one.

## Ground rules

- Never type a password or sign in. If CBS or GitHub shows a sign-in page, stop and ask Matt to sign in.
- Don't open DraftKings, FanDuel, Splash or mattorefice.github.io in the browser. The books' bet histories come
  from Matt's pastes, and the DraftKings survivor picks come from his screenshots.
- Work in one Chrome tab you create, and close it at the end. Keep each `javascript_tool` call under about 40
  seconds: no waiting loops inside a call.
- Data copied out of a page goes through `get_page_text`. Save it exactly, then check it with
  `python3 -I sync/fnv.py FILE`: the byte count and hash must match what the snippet printed. If they don't,
  read the page again and rewrite the file. Never hand-edit a dump.
- Publish only through GitHub's Upload files page, then check the raw files' hashes and that the Pages build
  finished. End each commit description with the Co-Authored-By and Claude-Session lines the session gives you.

## 1. Get the repo and plan

```
git clone --depth 1 https://github.com/MattOrefice/rooting-board.git rb && cd rb && git rev-parse HEAD
node sync/archive.js --repo . --plan
```

The first command prints the commit SHA, used below to load the snippets. The second prints the config line
for the ESPN snippet: the week, the games and players that this week's prop bets need from the box scores, and
the ESPN pick'em group. If `results.json` already has week N and `data.json` is on N+1, the sync already ran:
report that and stop.

## 2. ESPN: finals, next week's schedule, box scores, the pick'em group

In Chrome, open `https://www.cbssports.com/robots.txt` (ESPN's APIs answer cbssports.com; github.com blocks
them). Run this with `javascript_tool`, pasting the plan's `CFG` and the SHA:

```
await (async () => { const CFG = <CFG from the plan>; const r = await fetch('https://raw.githubusercontent.com/MattOrefice/rooting-board/<SHA>/sync/grab_espn.js', { cache: 'no-store' }); const src = await r.text(); const AF = Object.getPrototypeOf(async function () {}).constructor; return await new AF('CFG', src.replace(/^await /m, 'return await '))(CFG); })()
```

It answers `rbdump <bytes> bytes, fnv <hash>; week N finals 15, not final 0; ...`. If any game isn't final,
stop (a game was postponed, or the run is early). Read the page with `get_page_text` and save the JSON after the
`---` line to `dumps/espn.json`, then check the hash.

## 3. CBS: the finished week's grid and next week's lines

Open the CBS pool's Weekly standings page (Standings, then Weekly; the link is in the task prompt and the
project notes). The week menu is a combobox reading "Week N". If it shows another week, click it and pick
"Week N". Run the same loader with `grab_cbs.js` and no config:

```
await (async () => { const r = await fetch('https://raw.githubusercontent.com/MattOrefice/rooting-board/<SHA>/sync/grab_cbs.js', { cache: 'no-store' }); const src = await r.text(); const AF = Object.getPrototypeOf(async function () {}).constructor; return await new AF(src.replace(/^await /m, 'return await '))(); })()
```

It should report all games final with lines, every player, and the tiebreaker total. Save the JSON to
`dumps/cbs.json` and check the hash. Then reload the page, pick "Week N+1" (often the default by Tuesday), run it
again and save `dumps/cbs_next.json`. If CBS hasn't posted next week's lines yet, skip that file: the board then
uses DraftKings' lines until a later update adds CBS's.

## 4. Archive and roll

```
node sync/archive.js --repo . --espn dumps/espn.json --cbs dumps/cbs.json --cbs-next dumps/cbs_next.json
```

It settles the week's bets with the board's own code (finals plus the box scores), appends week N to
`results.json` (games with final scores and CBS lines, both pools' picks, the CBS order and tiebreaker,
survivor results, settled bets with each leg's result) and rolls `data.json` to week N+1 (schedule, lines,
standings from CBS and ESPN, games left, open bets carried over, survivor entries updated with used teams and
eliminations). It prints a report. Lines starting `STOP` mean nothing was written; fix the cause and rerun.
Review every line under "Check these". Bets it couldn't settle stay open in `data.json` and are listed; settle
them by hand from the box score or Matt's pastes.

Then render the result offline:

```
npm install --silent --no-audit --no-fund --prefix /tmp/rb react@18.3.1 react-dom@18.3.1
node sync/smoke.js --repo . --react /tmp/rb
```

It must end with "No page errors".

## 5. Publish and verify

1. Open `https://github.com/MattOrefice/rooting-board/upload/main`, find the file input, upload `data.json` and
   `results.json` with `file_upload`. If the tool rejects the paths, copy the two files into the session's
   outputs folder and retry from there.
2. Commit summary: `Week N results; roll the board to Week N+1`. Description: one line on what changed, then
   the attribution lines. Click Commit changes.
3. In the GitHub tab, fetch `https://api.github.com/repos/MattOrefice/rooting-board/commits/main` for the new
   SHA, fetch both files from `raw.githubusercontent.com/MattOrefice/rooting-board/<new SHA>/...`, hash them
   (32-bit FNV-1a over the bytes) and compare with `python3 -I sync/fnv.py data.json results.json`.
4. Check `https://api.github.com/repos/MattOrefice/rooting-board/actions/runs?per_page=1` until the
   "pages build and deployment" run for this commit is completed with success (one short check per call).

## 6. Tell Matt, and ask for the sportsbook pastes

Send Matt a short summary from the report: both pools' week and season standing, survivor entries, the week's
settled bets and net, and anything left to settle. Then ask for:

- FanDuel: My Bets, Settled and Open tabs. Select all and paste each one; one paste covers New York and
  Pennsylvania.
- DraftKings: My Bets, Settled (it loads 25 bets at a time, so paste in pieces, scrolling between copies, until
  it reaches last Tuesday) and Open.
- DraftKings survivor: a screenshot of the entries once he has made next week's picks, plus the pool's entry count
  (how many entries are still alive, if the pool screen shows it). The board values each live entry from the prize
  and that count.

## 7. When the pastes come in

Save each paste to `dumps/`, then:

```
python3 -I sync/books.py --repo . --since <date of last Tuesday> --fd <FanDuel pastes> --dk <DraftKings pastes>
```

It lists disagreements (result, payout or stake), open bets the book has settled, NFL bets the board is
missing (with the book's own text), and archived bets the pastes don't show. Fix each one:

- A settled bet goes in `results.json` under its week, like the bets already there:
  `{id, book, placed: "M/D", desc, stake, toPay, status: won|lost|void, net, legs: [{t, g, r, v}], ref}`, plus
  `st` (PA or NY) for FanDuel and `bonus: true` for a bonus bet. A leg's `r` is won, lost, void, or unk when
  the book's list doesn't say which player a DraftKings leg was on. `v` is the stat or score that settled it,
  for example "4 catches" or "BAL 30-23 ATL".
- An open bet goes in `data.json` `bets`:
  `{id, book, placed, desc, stake, toPay, odds, status: "open", bonus, legs, ref}`, with game legs like
  `{kind: "game", game: "AWAY@HOME", type: "ml", side: "PHI", status: "open"}`, `type: "spread"` with `line`,
  `type: "total"` with `side: "over"` and `line`, or a prop:
  `{kind: "game", game, type: "prop", desc, player, stat, line, side: "over"}` (stats: passYds, passTD,
  passInt, passAtt, rushYds, rushTD, rushAtt, recYds, rec, recTD, td, rushRecYds, fgMade, firstTD), and
  futures as `{kind: "future", team: "LAC", desc: "Super Bowl", status: "open"}`.
- Never invent a payout: use the book's numbers.

Rerun `books.py` until only the expected items remain, rerun the smoke test, and publish again (step 5). Put the
survivor picks from the screenshot in `data.json` `survivorPool.entries[].pick`. If Matt gives the pool's entry
count, set `survivorPool.alive` to it and `aliveEst` to false (and `survivorPool.field` to the starting count the
first time). Then publish.

## Files

- `grab_espn.js`, `grab_cbs.js`: browser snippets (above).
- `archive.js`: archive and roll; `--plan` prints the ESPN config, `--dry` writes nothing, `--partial`
  archives even if a game isn't final.
- `applib.js`: loads the board's own functions from `index.html`, so the scripts settle bets exactly as the
  page does.
- `books.py`, `fdparse.py`, `dkparse.py`: check the board against FanDuel and DraftKings pastes.
- `smoke.js`: offline render of every tab.
- `fnv.py`: byte count and hash, for checking dumps and published files.
