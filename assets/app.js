/* ==========================================================================
   FH6 Car Explorer
   A dependency-free single-page app over a public Google Sheet.
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ config */

  const CONFIG = {
    sheetId: '1G61S4LOaTN2cWMwgbaArtjwTN08M5LJ198bLmsl1guI',
    gid: '1643258561',
    sheetLabel: 'Forza Horizon 6 · car database',
    autoRefreshMinutes: 10,
    cacheKey: 'fh6-explorer.cache.v2',
    stateKey: 'fh6-explorer.state.v2',
  };

  const SHEET_EDIT_URL =
    `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/edit#gid=${CONFIG.gid}`;
  const CSV_URL =
    `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:csv&gid=${CONFIG.gid}`;

  /* ------------------------------------------------------------------- utils */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const numberFmt = new Intl.NumberFormat('en-US');
  const compactFmt = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  const fmtInt = (n) => (n == null || Number.isNaN(n) ? '—' : numberFmt.format(Math.round(n)));
  const fmtCompact = (n) => (n == null || Number.isNaN(n) ? '—' : compactFmt.format(n));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /** lowercase, strip accents & punctuation — used for search matching */
  function norm(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function debounce(fn, ms) {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function timeAgo(ts) {
    if (!ts) return 'just now';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 90) return '1 min ago';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 7200) return '1 hour ago';
    if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
    return `${Math.round(s / 86400)} days ago`;
  }

  function roundTo(value, decimals = 0) {
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
  }

  /* --------------------------------------------------------------------- CSV */

  /** RFC 4180-ish parser: handles quoted fields, escaped quotes and newlines. */
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* ------------------------------------------------------------------ schema */

  const CLASS_ORDER = ['D', 'C', 'B', 'A', 'S1', 'S2', 'R'];
  const CLASS_COLOR = {
    D: 'var(--cls-d)', C: 'var(--cls-c)', B: 'var(--cls-b)',
    A: 'var(--cls-a)', S1: 'var(--cls-s1)', S2: 'var(--cls-s2)', R: 'var(--cls-r)',
  };
  const RARITY_ORDER = ['Common', 'Rare', 'Epic', 'Legendary', 'Forza Edition', 'Barn Find', 'Treasure Car'];
  const RARITY_COLOR = {
    Common: 'var(--rar-common)', Rare: 'var(--rar-rare)', Epic: 'var(--rar-epic)',
    Legendary: 'var(--rar-legendary)', 'Forza Edition': 'var(--rar-fe)',
    'Barn Find': 'var(--rar-barn)', 'Treasure Car': 'var(--rar-treasure)',
  };
  const DRIVE_LABEL = { Front: 'FWD', Rear: 'RWD', All: 'AWD' };

  const FIELD_DEFS = [
    { key: 'year', header: 'Year', label: 'Year', type: 'year' },
    { key: 'make', header: 'Make', label: 'Make', type: 'text' },
    { key: 'model', header: 'Model', label: 'Model', type: 'text' },
    { key: 'type', header: 'Type', label: 'Type', type: 'text' },
    { key: 'cls', header: 'Class', label: 'Class', type: 'class' },
    { key: 'country', header: 'Country', label: 'Country', type: 'text' },
    { key: 'value', header: 'Value (Cr)', label: 'Value', type: 'money', unit: 'Cr' },
    { key: 'rarity', header: 'Rarity', label: 'Rarity', type: 'text' },
    { key: 'power', header: 'Power (HP)', label: 'Power', type: 'number', unit: 'hp' },
    { key: 'torque', header: 'Torque (ft-lbs)', label: 'Torque', type: 'number', unit: 'ft-lb' },
    { key: 'weight', header: 'Weight (lbs)', label: 'Weight', type: 'number', unit: 'lb' },
    { key: 'balance', header: 'Balance (F)', label: 'Front weight balance', type: 'percent', unit: '%' },
    { key: 'disp', header: 'Displacement (L)', label: 'Displacement', type: 'number', unit: 'L', decimals: 1 },
    { key: 'drive', header: 'Drivetrain', label: 'Drivetrain', type: 'text' },
    { key: 'engine', header: 'Engine Pos.', label: 'Engine position', type: 'text' },
    { key: 'pph', header: 'Pounds Per HP', label: 'Pounds per HP', type: 'number', decimals: 2 },
    { key: 'balpen', header: 'Balance Penalty', label: 'Balance penalty', type: 'percent', unit: '%' },
    { key: 'wi', header: 'Weight Index', label: 'Weight index', type: 'number', decimals: 2 },
    { key: 'source', header: 'Source', label: 'Source', type: 'multi' },
    { key: 'sourceInfo', header: 'Source Info', label: 'Source info', type: 'text' },
    { key: 'owned', header: 'Owned?', label: 'Owned', type: 'bool' },
  ];

  const FACETS = [
    { key: 'make', label: 'Make', field: 'make', open: true },
    { key: 'cls', label: 'Class', field: 'cls', open: true, order: 'class' },
    { key: 'type', label: 'Type', field: 'type' },
    { key: 'country', label: 'Country', field: 'country' },
    { key: 'rarity', label: 'Rarity', field: 'rarity', order: 'rarity' },
    { key: 'drive', label: 'Drivetrain', field: 'drive', order: 'drive' },
    { key: 'engine', label: 'Engine position', field: 'engine', order: 'alpha' },
    { key: 'source', label: 'Source', field: 'source' },
    { key: 'sourceInfo', label: 'Source info', field: 'sourceInfo' },
    { key: 'owned', label: 'Owned', field: 'owned', order: 'bool', needsBoth: true },
  ];

  const RANGES = [
    { key: 'year', label: 'Year', ordinal: true, step: 1, unit: '' },
    { key: 'pi', label: 'Performance index', get: (r) => r.pi, step: 1, unit: 'PI' },
    { key: 'value', label: 'Value', get: (r) => r.value, step: 1000, scale: 'log', money: true, unit: 'Cr' },
    { key: 'power', label: 'Power', get: (r) => r.power, step: 5, floor0: true, unit: 'hp' },
    { key: 'weight', label: 'Weight', get: (r) => r.weight, step: 10, floor0: true, unit: 'lb' },
    { key: 'torque', label: 'Torque', get: (r) => r.torque, step: 5, floor0: true, unit: 'ft-lb' },
    { key: 'disp', label: 'Displacement', get: (r) => r.disp, step: 0.1, decimals: 1, floor0: true, unit: 'L' },
    { key: 'pph', label: 'Pounds per HP', get: (r) => r.pph, step: 0.5, decimals: 1, unit: 'lb/hp' },
    { key: 'balance', label: 'Front weight balance', get: (r) => r.balance, step: 1, unit: '%' },
    { key: 'balpen', label: 'Balance penalty', get: (r) => r.balpen, step: 1, unit: '%' },
    { key: 'wi', label: 'Weight index', get: (r) => r.wi, step: 0.5, decimals: 1 },
  ];

  const TABLE_COLS = [
    { key: 'year', label: 'Year', sort: 'year' },
    { key: 'make', label: 'Make', sort: 'make' },
    { key: 'model', label: 'Model', sort: 'model' },
    { key: 'cls', label: 'Class', sort: 'pi' },
    { key: 'type', label: 'Type', sort: 'type' },
    { key: 'value', label: 'Value', sort: 'value', num: true },
    { key: 'rarity', label: 'Rarity', sort: 'rarity' },
    { key: 'power', label: 'Power', sort: 'power', num: true },
    { key: 'weight', label: 'Weight', sort: 'weight', num: true },
    { key: 'drive', label: 'Drive', sort: 'drive' },
  ];

  /* ------------------------------------------------------------------- parse */

  function parseValue(type, raw) {
    const s = String(raw ?? '').trim();
    switch (type) {
      case 'year':
      case 'number': {
        if (!s) return null;
        const n = Number(s.replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
      }
      case 'money': {
        if (!s) return null;
        const n = Number(s.replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? n : null;
      }
      case 'percent': {
        if (!s) return null;
        const n = Number(s.replace(/[^0-9.-]/g, ''));
        return Number.isFinite(n) ? n : null;
      }
      case 'class': {
        const m = s.match(/^([A-Z][0-9]?)\s*(\d+)?$/);
        if (!m) return null;
        return { letter: m[1], pi: m[2] ? Number(m[2]) : null, raw: s };
      }
      case 'multi':
        return s ? s.split(',').map((p) => p.trim()).filter(Boolean) : [];
      case 'bool': {
        if (!s) return null;
        return /^(true|yes|y|1|x|✓|owned)$/i.test(s) ? 'yes' : 'no';
      }
      default:
        return s || null;
    }
  }

  const normHeader = (h) => norm(h).replace(/\s+/g, ' ');

  /** Turn raw CSV rows into a dataset: fields, typed rows, facet options, domains. */
  function buildDataset(rawRows) {
    const headerRow = rawRows[0].map((h) => String(h ?? '').trim());
    const body = rawRows.slice(1).filter((r) => r.some((c) => String(c ?? '').trim()));

    const fields = [];
    const usedIdx = new Set();

    for (const def of FIELD_DEFS) {
      const idx = headerRow.findIndex(
        (h, i) => !usedIdx.has(i) && normHeader(h) === normHeader(def.header)
      );
      if (idx >= 0) { usedIdx.add(idx); fields.push({ ...def, idx }); }
    }

    // Unknown columns are kept (shown in the detail sheet) and, when useful,
    // promoted to facets/ranges automatically — so new sheet columns just work.
    headerRow.forEach((h, i) => {
      if (!h || usedIdx.has(i)) return;
      const hasData = body.some((r) => String(r[i] ?? '').trim());
      if (!hasData) return;
      const cells = body.map((r) => String(r[i] ?? '').trim()).filter(Boolean);
      const numeric = cells.every((c) => /^-?[\d,]+(\.\d+)?%?$/.test(c));
      fields.push({
        key: `x_${norm(h).replace(/\s+/g, '_')}`,
        header: h,
        label: h,
        type: numeric ? 'number' : 'text',
        idx: i,
        dynamic: true,
      });
    });

    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    const yearsSet = new Set();

    const rows = body.map((cells, i) => {
      const row = { _i: i, _raw: cells };
      for (const f of fields) {
        const value = parseValue(f.type, cells[f.idx]);
        row[f.key] = value;
        if (f.type === 'class') {
          row.clsLetter = value?.letter ?? null;
          row.pi = value?.pi ?? null;
        }
      }
      if (typeof row.year === 'number') yearsSet.add(row.year);
      const hay = [
        row.year, row.make, row.model, row.type, row.country, row.rarity,
        row.cls?.raw, row.pi, DRIVE_LABEL[row.drive] || row.drive, row.engine,
        row.sourceInfo, (row.source || []).join(' '),
      ].join(' ');
      row._hay = norm(hay);
      return row;
    });

    const years = [...yearsSet].sort((a, b) => a - b);
    const dataset = { fields, byKey, rows, years, headerRow, fetchedAt: Date.now() };

    // Domains for range filters.
    for (const range of RANGES) {
      if (range.ordinal) {
        range.hidden = years.length < 2;
        range.values = years;
        range.lo = years[0];
        range.hi = years[years.length - 1];
        continue;
      }
      const values = rows.map(range.get).filter((v) => typeof v === 'number' && Number.isFinite(v));
      if (values.length < 2 || (range.money && !values.length)) { range.hidden = true; continue; }
      let lo = Math.min(...values);
      let hi = Math.max(...values);
      if (range.floor0) lo = 0;
      if (range.scale === 'log') lo = Math.max(lo, Math.min(...values), 1);
      lo = roundTo(Math.floor(lo / range.step) * range.step, range.decimals || 0);
      hi = roundTo(Math.ceil(hi / range.step) * range.step, range.decimals || 0);
      if (hi <= lo) hi = lo + range.step;
      range.lo = lo;
      range.hi = hi;
      range.hidden = false;
    }

    // Facet option values (built from the full dataset).
    dataset.facetOptions = {};
    for (const facet of FACETS) {
      const values = facet.key === 'cls' ? CLASS_ORDER : facet.key === 'owned' ? ['yes', 'no'] : null;
      if (facet.key === 'source') {
        const count = new Map();
        for (const row of rows) for (const token of row.source) count.set(token, (count.get(token) || 0) + 1);
        dataset.facetOptions[facet.key] = [...count.keys()].sort((a, b) => a.localeCompare(b));
      } else if (values) {
        dataset.facetOptions[facet.key] = values;
      } else {
        const set = new Set();
        for (const row of rows) {
          const v = row[facet.field];
          if (v != null && v !== '') set.add(v);
        }
        dataset.facetOptions[facet.key] = [...set].sort((a, b) => a.localeCompare(b));
      }
    }

    // Hide facets that would show one meaningless option.
    dataset.facetVisibility = {};
    for (const facet of FACETS) {
      const opts = dataset.facetOptions[facet.key];
      if (facet.key === 'owned') {
        const owned = rows.filter((r) => r.owned === 'yes').length;
        dataset.facetVisibility[facet.key] = owned > 0 && owned < rows.length;
      } else {
        dataset.facetVisibility[facet.key] = opts.length > 1;
      }
    }

    return dataset;
  }

  /* ------------------------------------------------------------------- state */

  let DATA = null;
  let STATE = null;
  let FILTERED = [];
  let facetSets = {};
  let queryTerms = [];
  let viewportMobile = matchMedia('(max-width: 900px)').matches;
  let lastTablePaint = 0;
  let tableTimer = 0;

  const ctl = { facets: new Map(), ranges: new Map(), chips: null };
  const openBlocks = new Set(['year', 'make', 'cls']);

  function defaultState() {
    const facets = {};
    for (const facet of FACETS) facets[facet.key] = [];
    const ranges = {};
    for (const range of RANGES) if (!range.hidden) ranges[range.key] = [range.lo, range.hi];
    return {
      q: '',
      facets,
      ranges,
      sort: { key: 'make', dir: 1 },
    };
  }

  function rangeActive(key) {
    const range = RANGES.find((r) => r.key === key);
    const value = STATE.ranges[key];
    if (!range || !value) return false;
    return value[0] > range.lo || value[1] < range.hi;
  }

  function activeFilterCount() {
    let n = STATE.q ? 1 : 0;
    for (const facet of FACETS) if ((STATE.facets[facet.key] || []).length) n += 1;
    for (const range of RANGES) if (rangeActive(range.key)) n += 1;
    return n;
  }

  /* ------------------------------------------------------------- URL / storage */

  function stateToHash() {
    const p = new URLSearchParams();
    if (STATE.q) p.set('q', STATE.q);
    for (const facet of FACETS) {
      const values = STATE.facets[facet.key] || [];
      if (values.length) p.set(`f_${facet.key}`, values.join('|'));
    }
    for (const range of RANGES) {
      if (range.hidden || !rangeActive(range.key)) continue;
      const [lo, hi] = STATE.ranges[range.key];
      p.set(`r_${range.key}`, `${lo}-${hi}`);
    }
    if (!(STATE.sort.key === 'make' && STATE.sort.dir === 1)) {
      p.set('sort', `${STATE.sort.key}:${STATE.sort.dir > 0 ? 'asc' : 'desc'}`);
    }
    return p.toString();
  }

  function applyHash(hash) {
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    if (![...p.keys()].length) return false;

    if (p.has('q')) STATE.q = p.get('q').slice(0, 120);
    for (const facet of FACETS) {
      const raw = p.get(`f_${facet.key}`);
      if (!raw) continue;
      const allowed = new Set(DATA.facetOptions[facet.key] || []);
      STATE.facets[facet.key] = raw.split('|').filter((v) => allowed.has(v));
    }
    for (const range of RANGES) {
      const raw = p.get(`r_${range.key}`);
      if (!raw || range.hidden) continue;
      const [a, b] = raw.split('-').map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      STATE.ranges[range.key] = [clamp(Math.min(a, b), range.lo, range.hi), clamp(Math.max(a, b), range.lo, range.hi)];
    }
    const sort = p.get('sort');
    if (sort) {
      const [key, dir] = sort.split(':');
      if (dir === 'asc' || dir === 'desc') STATE.sort = { key, dir: dir === 'asc' ? 1 : -1 };
    }
    return true;
  }

  const saveState = debounce(() => {
    try {
      const { q, facets, ranges, sort } = STATE;
      localStorage.setItem(CONFIG.stateKey, JSON.stringify({ q, facets, ranges, sort }));
    } catch (_) { /* storage may be unavailable */ }
  }, 250);

  function applyStoredState() {
    try {
      const raw = localStorage.getItem(CONFIG.stateKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.q) STATE.q = String(saved.q).slice(0, 120);
      for (const facet of FACETS) {
        const values = saved.facets?.[facet.key];
        if (Array.isArray(values)) {
          const allowed = new Set(DATA.facetOptions[facet.key] || []);
          STATE.facets[facet.key] = values.filter((v) => allowed.has(v));
        }
      }
      for (const range of RANGES) {
        const value = saved.ranges?.[range.key];
        if (!range.hidden && Array.isArray(value) && value.length === 2) {
          STATE.ranges[range.key] = [
            clamp(Math.min(value[0], value[1]), range.lo, range.hi),
            clamp(Math.max(value[0], value[1]), range.lo, range.hi),
          ];
        }
      }
      if (saved.sort?.key && (saved.sort.dir === 1 || saved.sort.dir === -1)) {
        STATE.sort = { key: saved.sort.key, dir: saved.sort.dir };
      }
    } catch (_) { /* ignore corrupt state */ }
  }

  /* ------------------------------------------------------------------- fetch */

  async function fetchSheet() {
    const res = await fetch(CSV_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Google Sheets returned HTTP ${res.status}.`);
    const text = await res.text();
    if (/^\s*</.test(text)) {
      throw new Error('Google returned a web page instead of data — the sheet needs to be shared as “Anyone with the link”.');
    }
    const rows = parseCSV(text).filter((r) => r.some((c) => String(c ?? '').trim()));
    if (rows.length < 2) throw new Error('The sheet came back empty.');
    const dateHeader = res.headers.get('date');
    return { rows, fetchedAt: dateHeader ? new Date(dateHeader).getTime() : Date.now() };
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CONFIG.cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.rows) || !parsed.rows.length) return null;
      return parsed;
    } catch (_) { return null; }
  }

  function writeCache(rows, fetchedAt) {
    try {
      localStorage.setItem(CONFIG.cacheKey, JSON.stringify({ rows, fetchedAt }));
    } catch (_) { /* cache is a nicety */ }
  }

  /* ---------------------------------------------------------------- filtering */

  function facetValues(row, key) {
    if (key === 'source') return row.source || [];
    if (key === 'cls') return row.clsLetter ? [row.clsLetter] : [];
    if (key === 'owned') return row.owned ? [row.owned] : [];
    const facet = FACETS.find((f) => f.key === key);
    if (!facet) return [];
    const v = row[facet.field];
    return v == null || v === '' ? [] : [v];
  }

  function passes(row, exceptKey) {
    for (const term of queryTerms) if (!row._hay.includes(term)) return false;

    for (const facet of FACETS) {
      if (facet.key === exceptKey) continue;
      const set = facetSets[facet.key];
      if (!set || !set.size) continue;
      if (!facetValues(row, facet.key).some((v) => set.has(v))) return false;
    }

    for (const range of RANGES) {
      if (range.key === exceptKey) continue;
      const value = STATE.ranges[range.key];
      if (!value) continue;
      const [lo, hi] = value;
      if (lo <= range.lo && hi >= range.hi) continue; // wide open
      const v = range.ordinal ? row.year : range.get(row);
      if (typeof v !== 'number' || v < lo || v > hi) return false;
    }
    return true;
  }

  function recomputeFacetSets() {
    queryTerms = STATE.q ? norm(STATE.q).split(' ').filter(Boolean) : [];
    facetSets = {};
    for (const facet of FACETS) facetSets[facet.key] = new Set(STATE.facets[facet.key] || []);
  }

  function computeFiltered() {
    recomputeFacetSets();
    FILTERED = DATA.rows.filter((row) => passes(row));
    return FILTERED;
  }

  /* ------------------------------------------------------------------ sorting */

  function sortValue(row, key) {
    switch (key) {
      case 'pi': return row.pi;
      case 'rarity': return RARITY_ORDER.indexOf(row.rarity);
      case 'drive': return ['Front', 'Rear', 'All'].indexOf(row.drive);
      case 'cls': return row.clsLetter ? CLASS_ORDER.indexOf(row.clsLetter) : null;
      case 'source': return (row.source || []).join(', ');
      case 'model': return row.model;
      default: return row[key];
    }
  }

  function compare(a, b, key) {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    const aEmpty = va == null || va === '' || (typeof va === 'number' && Number.isNaN(va));
    const bEmpty = vb == null || vb === '' || (typeof vb === 'number' && Number.isNaN(vb));
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return va - vb;
    return String(va).localeCompare(String(vb), 'en', { numeric: true, sensitivity: 'base' });
  }

  function sortRows(rows) {
    const { key, dir } = STATE.sort;
    return [...rows].sort((a, b) => {
      const primary = compare(a, b, key) * dir;
      if (primary !== 0) return primary;
      if (key !== 'model') return compare(a, b, 'model');
      return 0;
    });
  }

  /* ----------------------------------------------------------------- rendering */

  function clsBadge(letter, pi) {
    if (!letter) return '—';
    const color = CLASS_COLOR[letter] || 'var(--text-dim)';
    return `<span class="cls"><span class="cls-badge" style="--cls-color:${color}">${esc(letter)}</span>${
      pi != null ? `<span class="cls-pi">${fmtInt(pi)}</span>` : ''
    }</span>`;
  }

  function rarityCell(rarity) {
    if (!rarity) return '<span class="c-muted">—</span>';
    return `<span class="rarity"><span class="rarity-dot" style="--rar:${RARITY_COLOR[rarity] || '#888'}"></span>${esc(rarity)}</span>`;
  }

  function sourceCell(row) {
    const items = row.source || [];
    if (!items.length) return '<span class="c-muted">—</span>';
    const tags = items.slice(0, 2).map((s) => `<span class="tag">${esc(s)}</span>`);
    if (items.length > 2) tags.push(`<span class="tag">+${items.length - 2}</span>`);
    if (row.owned === 'yes') tags.unshift('<span class="tag owned">Owned</span>');
    return `<span class="src-tags">${tags.join('')}</span>`;
  }

  function driveCell(row) {
    if (!row.drive) return '<span class="c-muted">—</span>';
    return esc(DRIVE_LABEL[row.drive] || row.drive);
  }

  function tableCell(row, key) {
    switch (key) {
      case 'year': return `<span class="c-year">${row.year ?? '—'}</span>`;
      case 'make': return `<span class="c-make">${esc(row.make || '—')}</span>`;
      case 'model':
        return `<span class="c-model">${row.owned === 'yes' ? '<span class="owned-pin" title="Owned" aria-label="Owned">★</span>' : ''}${esc(row.model || '—')}</span>`;
      case 'cls': return clsBadge(row.clsLetter, row.pi);
      case 'type': return `<span class="c-muted">${esc(row.type || '—')}</span>`;
      case 'country': return `<span class="c-muted">${esc(row.country || '—')}</span>`;
      case 'value':
        return row.value == null
          ? '<span class="c-muted">—</span>'
          : `${fmtInt(row.value)}<span class="unit">Cr</span>`;
      case 'rarity': return rarityCell(row.rarity);
      case 'power':
        return row.power == null ? '<span class="c-muted">—</span>'
          : `${fmtInt(row.power)}<span class="unit">hp</span>`;
      case 'weight':
        return row.weight == null ? '<span class="c-muted">—</span>'
          : `${fmtInt(row.weight)}<span class="unit">lb</span>`;
      case 'drive': return driveCell(row);
      case 'source': return sourceCell(row);
      default: return '';
    }
  }

  function renderTable(rows) {
    const tbody = $('#carsTable tbody');
    const html = rows.map((row) => {
      const cells = TABLE_COLS.map((col) => {
        const cls = col.num ? 'num' : '';
        return `<td class="${cls}">${tableCell(row, col.key)}</td>`;
      }).join('');
      return `<tr tabindex="0" data-i="${row._i}">${cells}</tr>`;
    }).join('');
    tbody.innerHTML = html;
  }

  function renderCards(rows) {
    const html = rows.map((row) => {
      const color = CLASS_COLOR[row.clsLetter] || 'var(--line-strong)';
      const specs = [
        row.power != null ? `${fmtInt(row.power)} hp` : null,
        row.weight != null ? `${fmtInt(row.weight)} lb` : null,
        row.drive ? DRIVE_LABEL[row.drive] || row.drive : null,
        row.disp != null ? `${row.disp} L` : null,
      ].filter(Boolean);
      const footLeft = [row.type, row.country].filter(Boolean).join(' · ') || '—';
      return `
        <button class="card" data-i="${row._i}" style="--cls-color:${color}">
          <span class="card-top">
            <span class="card-year">${row.year ?? '—'}</span>
            <span class="card-make">${esc(row.make || '')}</span>
            ${clsBadge(row.clsLetter, row.pi)}
          </span>
          <span class="card-model">${row.owned === 'yes' ? '<span class="owned-pin" title="Owned" aria-label="Owned">★</span>' : ''}${esc(row.model || '—')}</span>
          <span class="card-specs">${specs.length ? specs.map((s) => `<span>${esc(s)}</span>`).join('') : '<span class="muted">No spec data yet</span>'}</span>
          <span class="card-foot">
            <span>${esc(footLeft)}</span>
            <span class="card-value">${row.value == null ? '—' : `${fmtInt(row.value)} Cr`}</span>
          </span>
        </button>`;
    }).join('');
    $('#cards').innerHTML = html;
  }

  function renderResults() {
    const rows = sortRows(FILTERED);
    const wrap = $('#tableWrap');
    const cards = $('#cards');
    const empty = $('#empty');

    $('#skeleton').hidden = true;

    if (!rows.length) {
      wrap.hidden = true;
      cards.hidden = true;
      empty.hidden = false;
      $('#cards').innerHTML = '';
      $('#carsTable tbody').innerHTML = '';
      return;
    }
    empty.hidden = true;

    renderSortUI();
    if (viewportMobile) {
      wrap.hidden = true;
      cards.hidden = false;
      renderCards(rows);
    } else {
      cards.hidden = true;
      wrap.hidden = false;
      renderTable(rows);
    }
  }

  function scheduleResults(immediate = false) {
    const paint = () => {
      tableTimer = 0;
      renderResults();
      lastTablePaint = performance.now();
    };
    if (immediate || performance.now() - lastTablePaint > 90) {
      clearTimeout(tableTimer);
      tableTimer = 0;
      paint();
    } else if (!tableTimer) {
      tableTimer = setTimeout(paint, 90);
    }
  }

  function renderHero() {
    const rows = FILTERED;
    const makes = new Set(rows.map((r) => r.make).filter(Boolean));
    const years = rows.map((r) => r.year).filter((y) => typeof y === 'number');
    const totalValue = rows.reduce((sum, r) => sum + (r.value || 0), 0);
    const active = activeFilterCount();

    $('#resultCount').textContent = fmtInt(rows.length);
    $('#resultUnit').textContent = rows.length === 1 ? 'car' : 'cars';

    const yearSpan = years.length
      ? (Math.min(...years) === Math.max(...years)
        ? String(Math.min(...years))
        : `${Math.min(...years)}–${Math.max(...years)}`)
      : '—';

    const makeWord = makes.size === 1 ? 'make' : 'makes';
    $('#resultSub').innerHTML = active
      ? `of <strong>${fmtInt(DATA.rows.length)}</strong> cars · ${fmtInt(makes.size)} ${makeWord} · ${yearSpan} model years`
      : `Every car in Forza Horizon 6 — ${fmtInt(makes.size)} ${makeWord}, model years ${yearSpan}.`;

    $('#statMakes').textContent = fmtInt(makes.size);
    $('#statYears').textContent = yearSpan;
    $('#statValue').textContent = totalValue ? `${fmtCompact(totalValue)} Cr` : '—';

    $('#activeCount').hidden = !active;
    $('#activeCount').textContent = active;
    $('#drawerCount').textContent = fmtInt(rows.length);
  }

  function renderChips() {
    const host = $('#chips');
    const chips = [];

    if (STATE.q) {
      chips.push({ label: `“${STATE.q}”`, action: 'q' });
    }
    for (const facet of FACETS) {
      const values = STATE.facets[facet.key] || [];
      if (!values.length) continue;
      if (values.length > 2) {
        chips.push({ label: `${facet.label}: ${values.length} selected`, action: `facet:${facet.key}` });
      } else {
        for (const value of values) {
          chips.push({ label: `${facet.label}: ${facetLabel(facet.key, value)}`, action: `facet:${facet.key}:${value}` });
        }
      }
    }
    for (const range of RANGES) {
      if (!rangeActive(range.key)) continue;
      chips.push({ label: `${rangeLabel(range)}: ${rangeSummary(range)}`, action: `range:${range.key}` });
    }

    if (!chips.length) {
      if (!host.hidden) { host.hidden = true; host.innerHTML = ''; }
      return;
    }
    const html = chips.map((chip) => `
      <span class="chip">${esc(chip.label)}
        <button class="chip-x" data-chip="${esc(chip.action)}" aria-label="Remove filter">×</button>
      </span>`).join('') + '<button class="chip-clear" data-chip="all">Clear all</button>';
    host.hidden = false;
    if (host.innerHTML !== html) host.innerHTML = html;
  }

  function facetLabel(key, value) {
    if (key === 'drive') return DRIVE_LABEL[value] || value;
    if (key === 'owned') return value === 'yes' ? 'Owned' : 'Not owned';
    return value;
  }

  function rangeLabel(range) {
    if (range.key === 'pi') return 'PI';
    return range.label;
  }

  function rangeFormat(range, value) {
    if (range.ordinal) return String(value);
    if (range.money) return value >= 1e6 ? `${roundTo(value / 1e6, 2)}M` : fmtCompact(value);
    if (range.decimals) return value.toFixed(range.decimals);
    return fmtInt(value);
  }

  function rangeSummary(range) {
    const [lo, hi] = STATE.ranges[range.key];
    const unit = range.unit && !range.money ? ` ${range.unit}` : '';
    return `${rangeFormat(range, lo)}–${rangeFormat(range, hi)}${unit}`;
  }

  /* ------------------------------------------------------- filter panel build */

  function buildFilters() {
    const host = $('#filterList');
    const frag = document.createDocumentFragment();

    frag.appendChild(yearBlock());

    for (const facet of FACETS) {
      if (!DATA.facetVisibility[facet.key]) continue;
      frag.appendChild(facetBlock(facet));
    }

    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = 'Specs & numbers';
    frag.appendChild(label);

    for (const range of RANGES) {
      if (range.key === 'year' || range.hidden) continue;
      frag.appendChild(rangeBlock(range));
    }

    host.innerHTML = '';
    host.appendChild(frag);
  }

  function dualMarkup(key) {
    return `
      <div class="dual" data-dual="${key}">
        <div class="dual-track"></div>
        <div class="dual-fill"></div>
        <input type="range" min="0" max="1000" step="1" value="0" data-dual="${key}" data-hand="min" aria-label="Minimum ${key}">
        <input type="range" min="0" max="1000" step="1" value="1000" data-dual="${key}" data-hand="max" aria-label="Maximum ${key}">
      </div>`;
  }

  function yearBlock() {
    const range = RANGES[0];
    const decades = [];
    const seen = new Set();
    for (const year of DATA.years) {
      if (year > 2030) continue;
      const dec = Math.floor(year / 10) * 10;
      if (seen.has(dec)) continue;
      seen.add(dec);
      decades.push(dec);
    }

    const el = document.createElement('details');
    el.className = 'fblock';
    el.open = openBlocks.has('year');
    el.dataset.block = 'year';
    el.innerHTML = `
      <summary>Year <span class="fblock-value" data-summary="year">All</span></summary>
      <div class="fblock-body">
        ${dualMarkup('year')}
        <div class="range-fields">
          <label class="numfield"><input type="number" inputmode="numeric" data-num="year:min" aria-label="Year from"></label>
          <span class="dash">–</span>
          <label class="numfield"><input type="number" inputmode="numeric" data-num="year:max" aria-label="Year to"></label>
        </div>
        <div class="chip-row">
          ${decades.map((dec) => `<button class="mini-chip" data-decade="${dec}" aria-pressed="false">${String(dec).slice(2)}s</button>`).join('')}
        </div>
      </div>`;

    ctl.ranges.set('year', el);
    return el;
  }

  function facetBlock(facet) {
    const options = DATA.facetOptions[facet.key] || [];
    const el = document.createElement('details');
    el.className = 'fblock';
    el.open = openBlocks.has(facet.key);
    el.dataset.block = facet.key;
    el.dataset.facet = facet.key;

    const ordered = orderFacetOptions(facet, options);
    el.innerHTML = `
      <summary>${esc(facet.label)} <span class="fblock-value" data-summary="facet:${facet.key}">All</span></summary>
      <div class="fblock-body">
        <input class="facet-search" type="search" placeholder="Filter ${esc(facet.label.toLowerCase())}…" data-facet-search="${facet.key}" aria-label="Search ${esc(facet.label)} options">
        <div class="facet-opts">
          ${ordered.map((value) => {
            const label = facetLabel(facet.key, value);
            const dot = facet.key === 'cls'
              ? `<span class="opt-dot" style="background:${CLASS_COLOR[value] || '#888'}"></span>`
              : facet.key === 'rarity'
                ? `<span class="opt-dot" style="background:${RARITY_COLOR[value] || '#888'}"></span>`
                : '';
            return `<label class="opt" data-opt="${esc(value)}" data-label="${esc(label)}">
              <input type="checkbox" data-facet="${facet.key}" data-value="${esc(value)}">
              ${dot}<span class="opt-label">${esc(label)}</span>
              <span class="opt-count" data-count-for="${facet.key}:${esc(value)}">0</span>
            </label>`;
          }).join('')}
        </div>
      </div>`;

    ctl.facets.set(facet.key, el);
    return el;
  }

  function orderFacetOptions(facet, options) {
    const list = [...options];
    switch (facet.order) {
      case 'class':
        return list.sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b));
      case 'rarity':
        return list.sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
      case 'drive':
        return list.sort((a, b) => ['Front', 'Rear', 'All'].indexOf(a) - ['Front', 'Rear', 'All'].indexOf(b));
      case 'bool':
        return list.sort((a, b) => (a === 'yes' ? 0 : 1) - (b === 'yes' ? 0 : 1));
      default:
        return list.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    }
  }

  function rangeBlock(range) {
    const el = document.createElement('details');
    el.className = 'fblock';
    el.open = openBlocks.has(range.key);
    el.dataset.block = range.key;
    el.dataset.range = range.key;
    el.innerHTML = `
      <summary>${esc(range.label)} <span class="fblock-value" data-summary="range:${range.key}">All</span></summary>
      <div class="fblock-body">
        ${dualMarkup(range.key)}
        <div class="range-fields">
          <label class="numfield"><input type="number" inputmode="decimal" data-num="${range.key}:min" aria-label="Minimum ${esc(range.label)}"></label>
          <span class="dash">–</span>
          <label class="numfield"><input type="number" inputmode="decimal" data-num="${range.key}:max" aria-label="Maximum ${esc(range.label)}">${range.unit ? `<span class="suffix">${esc(range.unit)}</span>` : ''}</label>
        </div>
      </div>`;
    ctl.ranges.set(range.key, el);
    return el;
  }

  /* ------------------------------------------------------- range math helpers */

  function rangeByKey(key) {
    return RANGES.find((r) => r.key === key);
  }

  function encodeRatio(range, value) {
    const [lo, hi] = [range.lo, range.hi];
    if (hi === lo) return 0;
    if (range.ordinal) {
      const values = range.values;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < values.length; i += 1) {
        const d = Math.abs(values[i] - value);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return values.length > 1 ? best / (values.length - 1) : 0;
    }
    if (range.scale === 'log') {
      const v = Math.max(value, lo);
      return (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    }
    return (value - lo) / (hi - lo);
  }

  function decodeRatio(range, ratio) {
    const t = clamp(ratio, 0, 1);
    if (range.ordinal) {
      const values = range.values;
      const idx = Math.round(t * (values.length - 1));
      return values[clamp(idx, 0, values.length - 1)];
    }
    let value;
    if (range.scale === 'log') {
      value = Math.exp(Math.log(range.lo) + t * (Math.log(range.hi) - Math.log(range.lo)));
    } else {
      value = range.lo + t * (range.hi - range.lo);
    }
    value = Math.round(value / range.step) * range.step;
    value = roundTo(value, range.decimals || 0);
    return clamp(value, range.lo, range.hi);
  }

  function syncRangeControl(key) {
    const range = rangeByKey(key);
    const el = ctl.ranges.get(key);
    if (!range || !el || range.hidden) return;
    const [lo, hi] = STATE.ranges[key];
    const rLo = encodeRatio(range, lo);
    const rHi = encodeRatio(range, hi);

    const dual = el.querySelector('.dual');
    if (dual) {
      dual.querySelectorAll('input[type="range"]').forEach((input) => {
        input.value = String(Math.round((input.dataset.hand === 'min' ? rLo : rHi) * 1000));
      });
      const fill = dual.querySelector('.dual-fill');
      fill.style.left = `${rLo * 100}%`;
      fill.style.width = `${Math.max(0, (rHi - rLo) * 100)}%`;
    }

    el.querySelectorAll('[data-num]').forEach((input) => {
      const isMin = input.dataset.num.endsWith(':min');
      if (document.activeElement === input) return;
      input.value = String(isMin ? lo : hi);
      input.min = String(range.lo);
      input.max = String(range.hi);
      input.step = String(range.step);
    });

    const summary = el.querySelector(`[data-summary="range:${key}"]`);
    if (summary) {
      const full = lo <= range.lo && hi >= range.hi;
      summary.textContent = full ? 'All' : rangeSummary(range);
      summary.style.color = full ? '' : 'var(--accent)';
    }

    if (key === 'year') {
      el.querySelectorAll('[data-decade]').forEach((btn) => {
        const dec = Number(btn.dataset.decade);
        const isActive = lo >= dec && hi <= dec + 9;
        btn.setAttribute('aria-pressed', String(isActive));
      });
    }
  }

  function syncFacetControl(key) {
    const el = ctl.facets.get(key);
    if (!el) return;
    const selected = new Set(STATE.facets[key] || []);
    el.querySelectorAll('input[data-facet]').forEach((input) => {
      input.checked = selected.has(input.dataset.value);
    });
    const summary = el.querySelector(`[data-summary="facet:${key}"]`);
    if (summary) {
      summary.textContent = selected.size ? `${selected.size} selected` : 'All';
      summary.style.color = selected.size ? 'var(--accent)' : '';
    }
  }

  function syncAllControls() {
    for (const range of RANGES) {
      if (range.hidden) continue;
      if (range.key === 'year' || STATE.ranges[range.key]) syncRangeControl(range.key);
    }
    for (const facet of FACETS) syncFacetControl(facet.key);
  }

  function updateCounts() {
    if (!DATA) return;
    for (const facet of FACETS) {
      if (!DATA.facetVisibility[facet.key]) continue;
      const counts = new Map();
      for (const row of DATA.rows) {
        if (!passes(row, facet.key)) continue;
        for (const value of facetValues(row, facet.key)) {
          counts.set(value, (counts.get(value) || 0) + 1);
        }
      }
      const el = ctl.facets.get(facet.key);
      if (!el) continue;
      el.querySelectorAll('[data-count-for]').forEach((node) => {
        const value = node.dataset.countFor.slice(facet.key.length + 1);
        const n = counts.get(value) || 0;
        node.textContent = fmtInt(n);
        node.closest('.opt')?.classList.toggle('is-zero', n === 0);
      });
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      el.querySelector(`[data-summary="facet:${facet.key}"]`)?.setAttribute('data-total', String(total));
    }
  }

  function updateUpdatedNote(cached) {
    const stamp = DATA?.fetchedAt ? timeAgo(DATA.fetchedAt) : 'just now';
    $('#updatedNote').innerHTML = cached
      ? `Showing a cached copy from <strong>${esc(timeAgo(DATA.fetchedAt))}</strong> — refreshing…`
      : `Updated <strong>${esc(stamp)}</strong> · ${fmtInt(DATA?.rows.length || 0)} rows live from Google Sheets`;
  }

  /* ------------------------------------------------------------------ refresh */

  let refreshing = false;

  function refreshViews({ immediate = true } = {}) {
    computeFiltered();
    renderHero();
    renderChips();
    syncAllControls();
    updateCounts();
    scheduleResults(immediate);
    $('#activeCount').textContent = activeFilterCount();
  }

  async function loadData({ silent = false } = {}) {
    if (refreshing) return;
    refreshing = true;
    const btn = $('#refreshBtn');
    btn.classList.add('spinning');

    try {
      const fresh = await fetchSheet();
      const previousCount = DATA?.rows.length;
      const previousFetched = DATA?.fetchedAt;

      DATA = buildDataset(fresh.rows);
      DATA.fetchedAt = fresh.fetchedAt;
      writeCache(fresh.rows, fresh.fetchedAt);

      const hadState = Boolean(STATE && ctl.facets.size);
      if (!hadState) {
        STATE = defaultState();
        if (!applyHash(location.hash)) applyStoredState();
      } else {
        reconcileState();
      }
      buildFilters();
      bindSearchValue();
      refreshViews();
      updateUpdatedNote(false);
      $('#errorPanel').hidden = true;
      $('#skeleton').hidden = true;

      if (previousCount != null && DATA.rows.length !== previousCount) {
        const diff = DATA.rows.length - previousCount;
        toast(diff > 0 ? `${diff} new ${diff === 1 ? 'car' : 'cars'} added` : `${Math.abs(diff)} cars removed from the sheet`);
      } else if (!silent && previousFetched && Date.now() - previousFetched < 5000) {
        toast('Up to date');
      }
    } catch (error) {
      if (DATA) {
        toast('Couldn’t refresh — showing cached data');
        updateUpdatedNote(true);
      } else {
        showError(error);
      }
      console.error(error);
    } finally {
      refreshing = false;
      btn.classList.remove('spinning');
    }
  }

  /** Keep an existing filter state valid after the sheet changed shape. */
  function reconcileState() {
    for (const range of RANGES) {
      if (range.hidden) {
        delete STATE.ranges[range.key];
        continue;
      }
      const current = STATE.ranges[range.key];
      STATE.ranges[range.key] = current
        ? [clamp(Math.min(current[0], current[1]), range.lo, range.hi),
           clamp(Math.max(current[0], current[1]), range.lo, range.hi)]
        : [range.lo, range.hi];
    }
    for (const facet of FACETS) {
      const allowed = new Set(DATA.facetOptions[facet.key] || []);
      STATE.facets[facet.key] = (STATE.facets[facet.key] || []).filter((v) => allowed.has(v));
    }
  }

  function bindSearchValue() {
    const input = $('#search');
    input.value = STATE.q;
    $('#searchClear').hidden = !STATE.q;
  }

  function showError(error) {
    $('#errorPanel').hidden = false;
    $('#skeleton').hidden = true;
    $('#tableWrap').hidden = true;
    $('#cards').hidden = true;
    $('#empty').hidden = true;
    $('#errorMessage').textContent = error?.message || 'The data request failed.';
    $('#resultCount').textContent = '—';
    $('#resultSub').textContent = 'The sheet could not be reached.';
    $('#updatedNote').textContent = 'Offline';
  }

  /* -------------------------------------------------------------------- toast */

  let toastTimer = 0;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 220);
    }, 2600);
  }

  /* -------------------------------------------------------------------- sort UI */

  function renderSortUI() {
    const { key, dir } = STATE.sort;
    const dirLabel = dir > 0 ? 'ascending' : 'descending';
    $$('#carsTable thead th').forEach((th) => {
      const match = th.dataset.sort === key;
      th.setAttribute('aria-sort', match ? dirLabel : 'none');
      const arrow = th.querySelector('.arrow');
      if (arrow) arrow.textContent = match ? (dir > 0 ? '↑' : '↓') : '↑';
    });
    syncSortSelect();
  }

  function buildTableHead() {
    const thead = $('#carsTable thead');
    thead.innerHTML = `<tr>${TABLE_COLS.map((col) => `
      <th scope="col" data-sort="${col.sort}" class="${col.num ? 'num' : ''}" aria-sort="none">
        <button type="button" data-sort="${col.sort}">${esc(col.label)}<span class="arrow" aria-hidden="true">↑</span></button>
      </th>`).join('')}</tr>`;
  }

  function syncSortSelect() {
    const select = $('#sortSelect');
    const value = `${STATE.sort.key}:${STATE.sort.dir > 0 ? 'asc' : 'desc'}`;
    const existing = [...select.options].find((o) => o.value === value);
    if (existing) {
      select.value = value;
      return;
    }
    let custom = select.querySelector('option[data-custom]');
    if (!custom) {
      custom = document.createElement('option');
      custom.dataset.custom = '1';
      select.appendChild(custom);
    }
    const column = TABLE_COLS.find((c) => c.sort === STATE.sort.key);
    custom.value = value;
    custom.textContent = `${column ? column.label : STATE.sort.key} ${STATE.sort.dir > 0 ? '↑' : '↓'}`;
    select.value = value;
  }

  /* ------------------------------------------------------------------ detail */

  function detailValue(field, row) {
    const value = row[field.key];
    if (field.key === 'cls') {
      return value ? `${value.letter}${value.pi != null ? ` ${value.pi}` : ''}` : null;
    }
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
    if (field.type === 'money') return `${fmtInt(value)} Cr`;
    if (field.type === 'multi') return value.join(', ');
    if (field.type === 'bool') return value === 'yes' ? 'Yes' : 'No';
    if (typeof value === 'number') {
      const text = field.decimals ? value.toFixed(field.decimals) : fmtInt(value);
      return field.unit ? `${text} ${field.unit}` : text;
    }
    return String(value);
  }

  function openDetail(row) {
    const dialog = $('#detail');
    $('#detailEyebrow').textContent = `${row.year ?? '—'} · ${row.make ?? ''}`;
    $('#detailTitle').textContent = row.model || 'Unknown model';

    const badges = [];
    if (row.clsLetter) badges.push(`<span class="tag" style="color:${CLASS_COLOR[row.clsLetter]}">${esc(row.cls.raw)}</span>`);
    if (row.rarity) badges.push(`<span class="tag">${esc(row.rarity)}</span>`);
    if (row.drive) badges.push(`<span class="tag">${esc(DRIVE_LABEL[row.drive] || row.drive)}</span>`);
    if (row.type) badges.push(`<span class="tag">${esc(row.type)}</span>`);
    if (row.country) badges.push(`<span class="tag">${esc(row.country)}</span>`);
    if (row.owned === 'yes') badges.push('<span class="tag owned">Owned</span>');
    $('#detailBadges').innerHTML = badges.join('');

    const items = DATA.fields
      .filter((f) => !['make', 'model', 'year', 'type', 'country', 'cls', 'rarity', 'drive'].includes(f.key))
      .map((f) => {
        const value = detailValue(f, row);
        return value ? `<div><dt>${esc(f.label)}</dt><dd>${esc(value)}</dd></div>` : '';
      })
      .filter(Boolean);

    $('#detailGrid').innerHTML = items.join('');
    dialog.showModal();
  }

  /* ------------------------------------------------------------------ events */

  function bindEvents() {
    // Search
    const search = $('#search');
    const applySearch = debounce((value) => {
      STATE.q = value.trim();
      $('#searchClear').hidden = !STATE.q;
      afterStateChange();
    }, 150);
    search.addEventListener('input', (e) => applySearch(e.target.value));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        search.value = '';
        applySearch('');
        search.blur();
      }
    });
    $('#searchClear').addEventListener('click', () => {
      search.value = '';
      STATE.q = '';
      $('#searchClear').hidden = true;
      afterStateChange();
      search.focus();
    });

    // Reset
    $('#resetBtn').addEventListener('click', resetFilters);
    $('#emptyReset').addEventListener('click', resetFilters);

    // Sort select
    $('#sortSelect').addEventListener('change', (e) => {
      const [key, dir] = e.target.value.split(':');
      STATE.sort = { key, dir: dir === 'asc' ? 1 : -1 };
      afterStateChange();
    });

    // Table header sorting
    $('#carsTable thead').addEventListener('click', (e) => {
      const button = e.target.closest('[data-sort]');
      if (!button) return;
      const key = button.dataset.sort;
      if (STATE.sort.key === key) STATE.sort.dir *= -1;
      else STATE.sort = { key, dir: key === 'year' || key === 'value' || key === 'power' ? -1 : 1 };
      afterStateChange();
    });

    // Facility: facet checkboxes, range sliders, number inputs, decade chips
    const filters = $('#filterList');

    filters.addEventListener('change', (e) => {
      const input = e.target;
      if (input.matches('input[data-facet]')) {
        const key = input.dataset.facet;
        const value = input.dataset.value;
        const selected = new Set(STATE.facets[key] || []);
        if (input.checked) selected.add(value); else selected.delete(value);
        STATE.facets[key] = [...selected];
        afterStateChange();
      } else if (input.matches('[data-num]')) {
        commitNumberInput(input);
      }
    });

    filters.addEventListener('input', (e) => {
      const target = e.target;

      if (target.matches('input[type="range"][data-dual]')) {
        onDualInput(target);
        return;
      }
      if (target.matches('[data-facet-search]')) {
        filterFacetOptions(target);
      }
    });

    filters.addEventListener('click', (e) => {
      const decade = e.target.closest('[data-decade]');
      if (decade) {
        const dec = Number(decade.dataset.decade);
        const range = RANGES[0];
        const isActive = STATE.ranges.year[0] === dec && STATE.ranges.year[1] === Math.min(dec + 9, range.hi);
        STATE.ranges.year = isActive
          ? [range.lo, range.hi]
          : [Math.max(dec, range.lo), Math.min(dec + 9, range.hi)];
        afterStateChange();
      }
    });

    // Remember open/closed filter sections across data refreshes
    filters.addEventListener('toggle', (e) => {
      const block = e.target.closest('.fblock');
      if (!block) return;
      if (block.open) openBlocks.add(block.dataset.block);
      else openBlocks.delete(block.dataset.block);
    }, true);

    // Chips
    $('#chips').addEventListener('click', (e) => {
      const button = e.target.closest('[data-chip]');
      if (!button) return;
      const action = button.dataset.chip;
      if (action === 'all') { resetFilters(); return; }
      if (action === 'q') { STATE.q = ''; $('#search').value = ''; $('#searchClear').hidden = true; }
      else if (action.startsWith('facet:')) {
        const [, key, value] = action.split(':');
        if (value === undefined) STATE.facets[key] = [];
        else STATE.facets[key] = (STATE.facets[key] || []).filter((v) => v !== value);
      } else if (action.startsWith('range:')) {
        const key = action.split(':')[1];
        const range = rangeByKey(key);
        STATE.ranges[key] = [range.lo, range.hi];
      }
      afterStateChange();
    });

    // Rows / cards → detail
    const openFromTarget = (e) => {
      const hit = e.target.closest('[data-i]');
      if (!hit) return;
      const row = DATA.rows[Number(hit.dataset.i)];
      if (row) openDetail(row);
    };
    $('#carsTable tbody').addEventListener('click', openFromTarget);
    $('#cards').addEventListener('click', openFromTarget);
    $('#carsTable tbody').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.matches('tr[data-i]')) { e.preventDefault(); openFromTarget(e); }
      }
    });

    // Detail dialog
    $('#detailClose').addEventListener('click', () => $('#detail').close());
    $('#detail').addEventListener('click', (e) => {
      if (e.target === $('#detail')) $('#detail').close();
    });

    // Refresh + retry
    $('#refreshBtn').addEventListener('click', () => loadData());
    $('#retryBtn').addEventListener('click', () => loadData());

    // Share
    $('#shareBtn').addEventListener('click', shareView);

    // Export
    $('#exportBtn').addEventListener('click', exportCSV);

    // Mobile drawer
    const sidebar = $('#sidebar');
    const scrim = $('#scrim');
    const toggle = $('#filtersToggle');
    const openDrawer = () => {
      sidebar.classList.add('open');
      scrim.hidden = false;
      requestAnimationFrame(() => scrim.classList.add('show'));
      toggle.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    };
    const closeDrawer = () => {
      sidebar.classList.remove('open');
      scrim.classList.remove('show');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      setTimeout(() => { if (!sidebar.classList.contains('open')) scrim.hidden = true; }, 240);
    };
    toggle.addEventListener('click', () => (sidebar.classList.contains('open') ? closeDrawer() : openDrawer()));
    scrim.addEventListener('click', closeDrawer);
    $('#showResults').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) closeDrawer();
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        $('#search').focus();
      }
    });

    // Viewport switch between table and cards
    const mq = matchMedia('(max-width: 900px)');
    mq.addEventListener('change', (e) => {
      viewportMobile = e.matches;
      if (DATA) scheduleResults(true);
    });

    // Auto refresh while the tab is visible
    setInterval(() => {
      if (document.visibilityState === 'visible') loadData({ silent: true });
    }, CONFIG.autoRefreshMinutes * 60 * 1000);
  }

  function commitNumberInput(input) {
    const [key, hand] = input.dataset.num.split(':');
    const range = rangeByKey(key);
    if (!range) return;
    let value = Number(input.value);
    if (!Number.isFinite(value)) {
      syncRangeControl(key);
      return;
    }
    value = clamp(value, range.lo, range.hi);
    const [lo, hi] = STATE.ranges[key];
    const next = hand === 'min' ? [Math.min(value, hi), hi] : [lo, Math.max(value, lo)];
    const unchanged = next[0] === STATE.ranges[key][0] && next[1] === STATE.ranges[key][1];
    STATE.ranges[key] = next;
    input.value = String(hand === 'min' ? next[0] : next[1]);
    if (!unchanged) afterStateChange();
    else syncRangeControl(key);
  }

  function onDualInput(input) {
    const key = input.dataset.dual;
    const hand = input.dataset.hand;
    const range = rangeByKey(key);
    let value = decodeRatio(range, Number(input.value) / 1000);
    const [lo, hi] = STATE.ranges[key];
    if (hand === 'min') STATE.ranges[key] = [Math.min(value, hi), hi];
    else STATE.ranges[key] = [lo, Math.max(value, lo)];
    syncRangeControl(key);
    computeFiltered();
    renderHero();
    renderChips();
    updateCounts();
    scheduleResults(false);
  }

  function filterFacetOptions(input) {
    const key = input.dataset.facetSearch;
    const el = ctl.facets.get(key);
    if (!el) return;
    const needle = norm(input.value);
    el.querySelectorAll('.opt').forEach((opt) => {
      const label = norm(opt.dataset.label || opt.dataset.opt);
      opt.classList.toggle('hidden', Boolean(needle) && !label.includes(needle));
    });
  }

  function afterStateChange() {
    computeFiltered();
    renderChips();
    renderHero();
    syncAllControls();
    updateCounts();
    scheduleResults(true);
    const hash = stateToHash();
    try {
      history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
    } catch (_) { /* file:// edge cases */ }
    saveState();
    $('#activeCount').textContent = activeFilterCount();
    $('#activeCount').hidden = !activeFilterCount();
  }

  function resetFilters() {
    STATE = defaultState();
    $('#search').value = '';
    $('#searchClear').hidden = true;
    $$('.facet-search').forEach((el) => {
      el.value = '';
      filterFacetOptions(el);
    });
    afterStateChange();
    toast('Filters cleared');
  }

  async function shareView() {
    const url = location.href;
    if (navigator.share && viewportMobile) {
      try {
        await navigator.share({ title: 'FH6 Car Explorer', url });
        return;
      } catch (_) { /* fall through to clipboard */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link to this filtered view copied');
    } catch (_) {
      toast('Copy this link: ' + url);
    }
  }

  function exportCSV() {
    if (!FILTERED.length) { toast('Nothing to export'); return; }
    const headers = DATA.headerRow.filter((h) => h.trim());
    const rows = sortRows(FILTERED).map((row) => headers.map((h) => {
      const idx = DATA.headerRow.indexOf(h);
      return row._raw[idx] ?? '';
    }));
    const quote = (value) => {
      const s = String(value ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map((r) => r.map(quote).join(',')).join('\r\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fh6-cars-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    toast(`Exported ${rows.length} cars`);
  }

  /* --------------------------------------------------------------------- init */

  async function init() {
    buildTableHead();
    bindEvents();
    $('#sheetLink').href = SHEET_EDIT_URL;
    $('#footSheetLink').href = SHEET_EDIT_URL;
    $('#sourceLabel').textContent = CONFIG.sheetLabel;

    const cached = readCache();
    if (cached) {
      DATA = buildDataset(cached.rows);
      DATA.fetchedAt = cached.fetchedAt || Date.now();
      STATE = defaultState();
      const fromHash = applyHash(location.hash);
      if (!fromHash) applyStoredState();
      buildFilters();
      bindSearchValue();
      updateUpdatedNote(true);
      refreshViews();
      $('#skeleton').hidden = true;
    }

    loadData({ silent: true });

    // PWA: register the offline shell (https or localhost only).
    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => { /* offline is optional */ });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
