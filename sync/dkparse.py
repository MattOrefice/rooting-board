"""Parse DraftKings 'My Bets' text pastes (each holds a ~25-bet window) into bet dicts.

Usage: python3 -I dkparse.py out.json paste1.txt [paste2.txt ...]
Bets are deduped by DraftKings bet ID; the script reports whether consecutive windows overlap.
"""
import json, re, sys, datetime

END = re.compile(r'^((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+, \d{4}, \d+:\d\d:\d\d [AP]M)DK(\d+)$')
EVT = re.compile(r'^(Final Score|Bet Ended)?((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+, \d{4}, \d+:\d\d:\d\d [AP]M)$')
TITLE = re.compile(r'^(.*?)([+\u2212-]\d+)([+\u2212-]\d+)?$')
MONEY = re.compile(r'^(Wager|Paid): \$([\d,]+\.\d\d)$')
STATUS = ('Won', 'Lost', 'Cancelled', 'Early Exit Win', 'Void', 'Push', 'Cashed Out')
NFL = {'ARI Cardinals': 'ARI', 'ATL Falcons': 'ATL', 'BAL Ravens': 'BAL', 'BUF Bills': 'BUF', 'CAR Panthers': 'CAR',
       'CHI Bears': 'CHI', 'CIN Bengals': 'CIN', 'CLE Browns': 'CLE', 'DAL Cowboys': 'DAL', 'DEN Broncos': 'DEN',
       'DET Lions': 'DET', 'GB Packers': 'GB', 'HOU Texans': 'HOU', 'IND Colts': 'IND', 'JAX Jaguars': 'JAX',
       'KC Chiefs': 'KC', 'LV Raiders': 'LV', 'LA Chargers': 'LAC', 'LA Rams': 'LAR', 'MIA Dolphins': 'MIA',
       'MIN Vikings': 'MIN', 'NE Patriots': 'NE', 'NO Saints': 'NO', 'NY Giants': 'NYG', 'NY Jets': 'NYJ',
       'PHI Eagles': 'PHI', 'PIT Steelers': 'PIT', 'SF 49ers': 'SF', 'SEA Seahawks': 'SEA', 'TB Buccaneers': 'TB',
       'TEN Titans': 'TEN', 'WAS Commanders': 'WAS'}


def odds(s):
    return int(s.replace('\u2212', '-')) if s else None


def ts(s):
    return datetime.datetime.strptime(s, '%b %d, %Y, %I:%M:%S %p').strftime('%Y-%m-%dT%H:%M:%S')


def parse_file(path):
    lines = [l.rstrip() for l in open(path, encoding='utf-8')]
    try:
        start = lines.index('Lost', lines.index('Settled')) + 1
    except ValueError:
        start = 0
    bets, cur = [], []
    for l in lines[start:]:
        m = END.match(l)
        if m:
            bets.append(parse_block(cur, m))
            cur = []
        else:
            cur.append(l)
    return bets


def parse_block(block, m):
    body = [x for x in block if x.strip() != '']
    b = {'id': 'DK' + m.group(3), 'placed': ts(m.group(1))}
    t = TITLE.match(body[0])
    b['sel'] = t.group(1).strip() if t else body[0]
    b['odds'] = odds(t.group(2)) if t else None
    b['odds2'] = odds(t.group(3)) if t else None
    b['market'] = body[1] if len(body) > 1 else ''
    b['status'] = next((x for x in body[1:4] if x in STATUS), None)
    for x in body:
        mm = MONEY.match(x)
        if mm:
            b['stake' if mm.group(1) == 'Wager' else 'paid'] = float(mm.group(2).replace(',', ''))
    b['bonus'] = any(re.match(r'^\$[\d.]+ Bonus Bet$', x) for x in body)
    b['tags'] = [x for x in body if re.match(r'^\+\d+% (Parlay )?Boost$', x) or x in (
        'Odds Boost', 'NO SWEAT', 'KING OF THE ENDZONE', 'BET & GET', 'QUALIFYING BET', 'INSURANCE', 'DRAWBREAKER',
        'UP 2 Early Win', 'Early Exit Protected', 'McAfee Super Boost') or 'Bonus Bet' in x or x.startswith('* ')
        or x.startswith('No Sweat') or x.startswith('Boost applied')]
    ev = [EVT.match(x) for x in body]
    ev = [e for e in ev if e]
    b['event'] = ts(ev[0].group(2)) if ev else None
    teams = [NFL[x] for x in body if x in NFL]
    b['teams'] = teams[:2]
    b['nfl'] = len(teams) >= 2 or bool(re.search(r'\b(' + '|'.join(re.escape(k) for k in NFL) + r')\b', b['market']))
    b['raw'] = body
    return b


if __name__ == '__main__':
    out = sys.argv[1]
    seen, windows = {}, []
    for p in sys.argv[2:]:
        bs = parse_file(p)
        windows.append((p.split('/')[-1], [x['id'] for x in bs], bs[0]['placed'] if bs else '', bs[-1]['placed'] if bs else ''))
        for x in bs:
            seen.setdefault(x['id'], x)
    bets = sorted(seen.values(), key=lambda x: x['placed'], reverse=True)
    json.dump(bets, open(out, 'w'), indent=1)
    print(len(bets), 'unique bets;', sum(x['nfl'] for x in bets), 'NFL')
    # window continuity: walk windows from newest to oldest, check each overlaps the union so far
    windows.sort(key=lambda w: w[2], reverse=True)
    have = set()
    for name, ids, first, last in windows:
        ov = len(have & set(ids))
        print('%-24s %3d bets %s .. %s  overlap with newer: %d' % (name, len(ids), first, last, ov))
        have |= set(ids)
