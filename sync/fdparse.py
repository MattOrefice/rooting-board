"""Parse FanDuel 'My Bets' text pastes into a list of bet dicts.

Usage: python3 -I fdparse.py out.json paste1.txt [paste2.txt ...]
Bets are deduped by BET ID. Each bet keeps its raw block lines for review.
"""
import json, re, sys

MONEY = re.compile(r'^\$([\d,]+\.\d\d)$')
ODDS = re.compile(r'^[+-]\d+$')
PLACED = re.compile(r'^PLACED: (\d+)/(\d+)/(\d{4}) (\d+):(\d\d)(AM|PM) ET$')
EVTIME = re.compile(r'^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d+), (\d+):(\d\d)(am|pm) ET$')
NFL = ["Arizona Cardinals", "Atlanta Falcons", "Baltimore Ravens", "Buffalo Bills", "Carolina Panthers",
       "Chicago Bears", "Cincinnati Bengals", "Cleveland Browns", "Dallas Cowboys", "Denver Broncos",
       "Detroit Lions", "Green Bay Packers", "Houston Texans", "Indianapolis Colts", "Jacksonville Jaguars",
       "Kansas City Chiefs", "Las Vegas Raiders", "Los Angeles Chargers", "Los Angeles Rams", "Miami Dolphins",
       "Minnesota Vikings", "New England Patriots", "New Orleans Saints", "New York Giants", "New York Jets",
       "Philadelphia Eagles", "Pittsburgh Steelers", "San Francisco 49ers", "Seattle Seahawks",
       "Tampa Bay Buccaneers", "Tennessee Titans", "Washington Commanders"]


def parse_file(path):
    lines = [l.rstrip() for l in open(path, encoding='utf-8')]
    bets = []
    state = None
    start = 0
    for i, l in enumerate(lines):
        if l == 'Bets placed in:' and i + 1 < len(lines):
            state = lines[i + 1].strip()
            start = i + 2
            continue
        m = re.match(r'^My Bets \((\w\w)\)$', l)
        if m:
            state = {'PA': 'Pennsylvania', 'NY': 'New York'}.get(m.group(1), m.group(1))
            start = i + 1
            continue
        if l in ('Open', 'Settled') and i < start + 3:
            start = i + 1
            continue
        pm = PLACED.match(l)
        if pm:
            block = lines[start:i + 1]
            start = i + 1
            bets.append(parse_block(block, state))
    return bets


def parse_block(block, state):
    b = {'state': state, 'raw': block}
    # strip leading blanks / UI junk
    body = [x for x in block]
    while body and body[0] == '':
        body.pop(0)
    pm = PLACED.match(body[-1])
    mo, d, y, hh, mm, ap = pm.groups()
    h = int(hh) % 12 + (12 if ap == 'PM' else 0)
    b['placed'] = '%s-%02d-%02dT%02d:%s' % (y, int(mo), int(d), h, mm)
    b['id'] = body[-2].replace('BET ID: ', '')
    # wager line
    wi = None
    for j, x in enumerate(body):
        if x == 'TOTAL WAGER' or x.startswith('TOTAL CHARGED'):
            wi = j
            break
    b['stake'] = float(MONEY.match(body[wi - 1]).group(1).replace(',', ''))
    b['ret'] = float(MONEY.match(body[wi + 1]).group(1).replace(',', ''))
    b['status_raw'] = body[wi + 2]
    head = body[:wi - 1]
    b['protect'] = 'BET PROTECT+' in head
    b['won_bp'] = 'WON WITH BP+' in head
    b['early'] = 'EARLY WIN' in head
    b['tokens'] = [x for x in head if 'Token' in x or 'token' in x or x.startswith('Bet Reset')]
    if 'bonus bet' in head:
        b['bonus'] = True
    boost = None
    for j, x in enumerate(head):
        if x == 'profit boost' and j + 1 < len(head):
            boost = head[j + 1]
    b['boost'] = boost
    odds = [x for x in head if ODDS.match(x)]
    first = head[0]
    if first in ('Same Game Parlay™',) or re.match(r'^\d+ leg parlay$', first) or first.startswith('Same Game Parlay'):
        b['kind'] = 'parlay'
        b['type'] = first
        b['odds'] = odds[0] if odds else None
        b['odds_boosted'] = odds[1] if len(odds) > 1 and head[2] == odds[1] else None
        # description = first line containing a comma after odds/boost/protect lines
        k = 1
        while k < len(head) and (ODDS.match(head[k]) or head[k] in ('profit boost', 'BET PROTECT+', 'WON WITH BP+') or head[k].endswith('%')):
            k += 1
        b['desc'] = head[k] if k < len(head) else ''
        rest = head[k + 1:]
        b['events'] = [x for x in rest if (' @ ' in x or ' v ' in x) and not ODDS.match(x)]
        b['times'] = [x for x in rest if EVTIME.match(x)]
        b['void_legs'] = sum(1 for x in rest if x == 'Void')
        b['legs_raw'] = rest
    else:
        b['kind'] = 'single'
        b['sel'] = first
        b['odds'] = odds[0] if odds else None
        b['odds_boosted'] = odds[1] if len(odds) > 1 and len(head) > 2 and head[2] == odds[1] else None
        # market = first non-odds line after the selection
        k = 1
        while k < len(head) and ODDS.match(head[k]):
            k += 1
        # selection like 'Over' then '48.5' then odds
        if b['sel'] in ('Over', 'Under') or re.match(r'^[+-]?\d+(\.\d)?$', head[1] if len(head) > 1 else ''):
            # line value present (spread/total): Philadelphia Eagles / -5.5 / -114 / +115 / SPREAD
            pass
        mk = [x for x in head[1:] if x and not ODDS.match(x) and not re.match(r'^[+-]?\d+(\.\d)?$', x)
              and x not in ('profit boost', 'BET PROTECT+', 'EARLY WIN', 'WON WITH BP+') and not x.endswith('%')]
        b['market'] = mk[0] if mk else ''
        lines_val = [x for x in head[1:4] if re.match(r'^[+-]?\d+\.\d$', x)]
        b['line'] = lines_val[0] if lines_val else None
        b['events'] = [x for x in head if (' @ ' in x or ' v ' in x)]
        b['times'] = [x for x in head if EVTIME.match(x)]
    # NY layout shows team names + scores instead of an 'A @ B' line
    if not b['events']:
        teams = [x for x in head if x in NFL]
        if len(teams) >= 2:
            b['events'] = ['%s @ %s' % (teams[0], teams[1])]
    st = b['status_raw']
    if st == 'WON ON FANDUEL':
        b['result'] = 'won'
    elif st == 'RETURNED VIA EARLY WIN TOKEN':
        b['result'] = 'won'
        b['early'] = True
    elif st == 'RETURNED':
        b['result'] = 'lost' if b['ret'] == 0 else ('void' if abs(b['ret'] - b['stake']) < 0.005 else 'returned')
    else:
        b['result'] = st
    ev = ' '.join(b['events']) + ' ' + ' '.join(head)
    b['nfl'] = any(t in ev for t in NFL) or 'NFL ' in ev
    return b


if __name__ == '__main__':
    out = sys.argv[1]
    seen = {}
    for p in sys.argv[2:]:
        for b in parse_file(p):
            if b['id'] in seen:
                continue
            seen[b['id']] = b
    bets = sorted(seen.values(), key=lambda b: b['placed'])
    json.dump(bets, open(out, 'w'), indent=1)
    print(len(bets), 'bets;', sum(b['nfl'] for b in bets), 'NFL')
