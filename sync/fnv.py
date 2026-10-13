"""Byte count and 32-bit FNV-1a hash of files, the same check the browser snippets print.

Usage: python3 -I sync/fnv.py FILE [FILE ...]
Use it to confirm a dump was saved exactly as the page held it, and that a published file matches the local one.
"""
import os
import sys


def fnv(path):
    h = 0x811c9dc5
    with open(path, 'rb') as f:
        for b in f.read():
            h ^= b
            h = (h * 0x01000193) & 0xffffffff
    return h


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print('%s %d bytes, fnv %d' % (p, os.path.getsize(p), fnv(p)))
