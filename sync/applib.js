// Load the board's own functions from index.html so the sync scripts settle bets and read games exactly the way
// the page does. Everything above the "// ---------- app ----------" marker is plain functions and constants.
const fs = require('fs');
const vm = require('vm');
module.exports = function load(file) {
  const html = fs.readFileSync(file, 'utf8');
  const i = html.lastIndexOf('<script>'), j = html.lastIndexOf('</script>');
  let src = html.slice(i + 8, j);
  const a = src.indexOf("'use strict';"), b = src.indexOf('// ---------- app ----------');
  if (a < 0 || b < 0) throw new Error('index.html layout changed: no strict marker or app marker');
  src = src.slice(a + 13, b);
  const names = [...src.matchAll(/^(?:function|async function)\s+([A-Za-z0-9_]+)|^const\s+([A-Za-z0-9_]+)\s*=/gm)].map((m) => m[1] || m[2]);
  const React = { useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {}, useMemo: (f) => f(), useRef: (v) => ({ current: v }), useCallback: (f) => f, createElement: () => null };
  const ctx = { React, ReactDOM: {}, console, Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, Promise, RegExp, Error, isNaN, isFinite, parseFloat, parseInt, Float64Array, Int16Array, Uint8Array, Uint32Array, Infinity, NaN, setTimeout, clearTimeout,
    document: { visibilityState: 'visible', scripts: [], addEventListener: () => {}, removeEventListener: () => {} }, window: {}, navigator: {},
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} }, fetch: async () => ({ ok: false }) };
  vm.createContext(ctx);
  const code = src + '\n;({' + [...new Set(names)].join(',') + '})';
  return vm.runInContext(code, ctx);
};
