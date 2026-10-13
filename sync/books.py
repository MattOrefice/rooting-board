"""Check the board's bets against the sportsbooks' own My Bets pastes.

Usage: python3 -I sync/books.py --repo DIR [--since YYYY-MM-DD] [--fd FILE ...] [--dk FILE ...]
  --fd, --dk  FanDuel or DraftKings My Bets pastes, Settled or Open tab. Several files are fine and overlaps
              are fine: bets are matched by the book's bet ID, which the board keeps as each bet's `ref`.
  --since     only look at book bets placed on or after this date (default: 10 days ago).
It reads DIR/results.json and DIR/data.json and prints:
  1. board bets whose result or payout disagrees with the book,
  2. open bets on the board that the book has settled (settle them), and settled ones the book still shows open,
  3. NFL bets in the books that aren't on the board, with the book's own text so they can be added by hand,
  4. board bets placed in the window that the pastes don't show (the paste may just not reach back that far).
The board tracks NFL bets only; other sports are ignored. It changes nothing.
"""
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dkparse  # noqa: E402
import fdparse  # noqa: E402

NFLISH = re.compile(r'\b(NFL|Super Bowl|AFC|NFC|Most Regular Season Wins|MVP|Offensive Player|Defensive Player|Rookie of the Year)\b', re.I)


def args():
    a, cur = {'fd': [], 'dk': [], 'repo': '.', 'since': None}, None
    for x in sys.argv[1:]:
        if x in ('--fd', '--dk'):
            cur = x[2:]
        elif x in ('--repo', '--since'):
            cur = x[2:] + '='
        elif cur and cur.endswith('='):
            a[cur[:-1]] = x
            cur = None
        elif cur in ('fd', 'dk'):
            a[cur].append(x)
        else:
            sys.exit('unexpected argument: ' + x)
    return a


def money(v):
    return ('+' if v > 0.004 else '-' if v < -0.004 else '') + '$%.2f' % abs(v)


def main():
    a = args()
    since = a['since'] or (datetime.date.today() - datetime.timedelta(days=10)).isoformat()
    R = json.load(open(os.path.join(a['repo'], 'results.json')))
    D = json.load(open(os.path.join(a['repo'], 'data.json')))
    board = {}
    for w in R.get('weeks', []):
        for b in w.get('bets') or []:
            if b.get('ref'):
                board[b['ref']] = dict(b, _where='results week %s' % w['week'])
    for b in D.get('bets', []):
        if b.get('ref'):
            board[b['ref']] = dict(b, _where='data.json (week %s)' % D.get('week'), _open=True)
    books = []
    for p in a['fd']:
        for b in fdparse.parse_file(p):
            res = b.get('result')
            # settled FanDuel bets end in WON ON FANDUEL or RETURNED; an open one shows its potential payout instead
            st = res if res in ('won', 'lost', 'void', 'returned') else 'open'
            txt = ' / '.join(x for x in [b.get('sel') or b.get('desc') or '', b.get('market', ''), ' '.join(b.get('events') or [])] if x)
            books.append({'book': 'FD', 'id': b['id'], 'placed': b['placed'], 'stake': b['stake'], 'paid': b.get('ret') if st != 'open' else None, 'status': st, 'raw_status': b.get('status_raw'),
                          'bonus': bool(b.get('bonus')), 'nfl': b.get('nfl') or bool(NFLISH.search(txt)), 'text': txt, 'state': b.get('state')})
    for p in a['dk']:
        for b in dkparse.parse_file(p):
            s = b.get('status')
            st = {'Won': 'won', 'Lost': 'lost', 'Early Exit Win': 'won', 'Void': 'void', 'Push': 'void', 'Cancelled': 'void', 'Cashed Out': 'cashout'}.get(s, 'open')
            txt = ' / '.join(x for x in [b.get('sel', ''), b.get('market', ''), '@'.join(b.get('teams') or [])] if x)
            books.append({'book': 'DK', 'id': b['id'], 'placed': b['placed'], 'stake': b.get('stake'), 'paid': b.get('paid', 0.0 if st == 'lost' else None), 'status': st, 'raw_status': s,
                          'bonus': bool(b.get('bonus')), 'nfl': b.get('nfl') or bool(NFLISH.search(txt)), 'text': txt})
    seen, uniq = set(), []
    for b in books:
        if (b['book'], b['id']) in seen:
            continue
        seen.add((b['book'], b['id']))
        uniq.append(b)
    books = uniq
    inwin = [b for b in books if (b['placed'] or '')[:10] >= since]
    mism, settle, reopen, missing = [], [], [], []
    for b in books:
        x = board.get(b['id'])
        if not x:
            if b['nfl'] and b in inwin:
                missing.append(b)
            continue
        bst = x.get('status', 'open')
        if b['status'] == 'open':
            if bst != 'open' and not x.get('_open'):
                reopen.append((b, x))
            continue
        if x.get('_open') and bst == 'open':
            settle.append((b, x))
            continue
        net_book = (b['paid'] or 0) - (0 if b['bonus'] else (b['stake'] or 0)) if b['paid'] is not None else None
        bad = []
        if b['status'] in ('won', 'lost', 'void') and bst != b['status']:
            bad.append('result: board %s, book %s' % (bst, b['status']))
        if net_book is not None and x.get('net') is not None and abs(net_book - x['net']) > 0.011:
            bad.append('net: board %s, book %s' % (money(x['net']), money(net_book)))
        if b['stake'] is not None and x.get('stake') is not None and abs(b['stake'] - float(x['stake'])) > 0.011:
            bad.append('stake: board $%s, book $%.2f' % (x['stake'], b['stake']))
        if bad:
            mism.append((b, x, bad))
    refs = {(b['book'], b['id']) for b in books}
    unseen = []
    for ref, x in board.items():
        bk = 'DK' if ref.startswith('DK') else 'FD'
        if (bk == 'DK' and not a['dk']) or (bk == 'FD' and not a['fd']):
            continue
        pl = str(x.get('placed', ''))
        if (bk, ref) not in refs and x.get('_where', '').startswith('results week %s' % (max([w['week'] for w in R.get('weeks', [])] or [0]))):
            unseen.append((ref, x, pl))
    print('Book bets read: %d (%d FanDuel, %d DraftKings); %d placed since %s, %d of them NFL.' % (
        len(books), sum(b['book'] == 'FD' for b in books), sum(b['book'] == 'DK' for b in books), len(inwin), since, sum(b['nfl'] for b in inwin)))
    print('\n1. Disagreements (%d):' % len(mism))
    for b, x, bad in mism:
        print('  %s %s %s [%s]: %s' % (x['id'], b['book'], x.get('desc', ''), x['_where'], '; '.join(bad)))
    print('\n2a. Open on the board, settled at the book (%d):' % len(settle))
    for b, x in settle:
        print('  %s %s: book says %s, paid $%s on $%s' % (x['id'], x.get('desc', ''), b['status'], b['paid'], b['stake']))
    print('2b. Settled on the board, open at the book (%d):' % len(reopen))
    for b, x in reopen:
        print('  %s %s [%s]: board %s' % (x['id'], x.get('desc', ''), x['_where'], x.get('status')))
    print('\n3. NFL bets in the books that are not on the board (%d):' % len(missing))
    for b in sorted(missing, key=lambda y: y['placed']):
        print('  %s %s placed %s, %s, stake $%s%s, paid %s%s: %s' % (b['book'], b['id'], b['placed'][:16], b['status'], b['stake'], ' (bonus bet)' if b['bonus'] else '',
              '$%.2f' % b['paid'] if b['paid'] is not None else '-', (', ' + b['state']) if b.get('state') else '', b['text'][:160]))
    print('\n4. Latest archived week\'s board bets that the pastes do not show (%d):' % len(unseen))
    for ref, x, pl in unseen:
        print('  %s %s placed %s: %s' % (x['id'], ref, pl, x.get('desc', '')))


if __name__ == '__main__':
    main()
