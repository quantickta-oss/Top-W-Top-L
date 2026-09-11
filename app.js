// ============================================================================
// P/L SYSTEM — Dealer Risk Dashboard
// Shift Import Edition: ON / AM / PM
// ============================================================================

// IMPORTANT: replace YOUR_FIREBASE_API_KEY with your real live key.
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "pl-system-227d1.firebaseapp.com",
  databaseURL: "https://pl-system-227d1-default-rtdb.firebaseio.com",
  projectId: "pl-system-227d1",
  storageBucket: "pl-system-227d1.firebasestorage.app",
  messagingSenderId: "557167025195",
  appId: "1:557167025195:web:9de8f4305284ba2a045e6e",
  measurementId: "G-1YSYFWMWTZ"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ============================================================================
// CONFIGURATION
// ============================================================================

const branchGroups = {
  awada: ['awada', 'fawaz'],
  fawaz: ['awada', 'fawaz'],
  boudani: ['boudani', 'issa'],
  issa: ['boudani', 'issa'],
  bbc: ['bbc', 'badaro', 'tajco'],
  badaro: ['bbc', 'badaro', 'tajco'],
  tajco: ['bbc', 'badaro', 'tajco'],
  cdi: ['cdi', 'connect'],
  connect: ['cdi', 'connect'],
  group5: [
    'awada', 'fawaz', 'boudani', 'issa', 'bbc',
    'badaro', 'tajco', 'cdi', 'connect', 'group5', 'archive'
  ]
};

const allBranches = [
  'awada', 'fawaz', 'boudani', 'issa',
  'bbc', 'badaro', 'tajco', 'cdi', 'connect'
];

const SHIFT_ORDER = ['ON', 'AM', 'PM'];
const SHIFT_CONFIG = {
  ON: { label: 'Overnight', start: 0, end: 8 * 3600, display: '00:00 → 08:00' },
  AM: { label: 'AM',        start: 8 * 3600, end: 16 * 3600, display: '08:00 → 16:00' },
  PM: { label: 'PM',        start: 16 * 3600, end: 24 * 3600, display: '16:00 → 24:00' }
};

// ============================================================================
// STATE
// ============================================================================

let currentBranch = 'awada';
let selectedImportShift = 'ON';
let shiftStore = {};              // branch -> YYYY-MM-DD -> ON/AM/PM
let coverPositionMap = {};        // persistent branch -> cover account -> position -> client login
let archiveStore = {};
let selectedArchiveWeek = null;
let pendingImport = null;
let toastTimer = null;

// ============================================================================
// FIREBASE LIVE LISTENERS
// ============================================================================

db.ref('pl_shift_store').on('value', snapshot => {
  shiftStore = snapshot.val() || {};

  const activePanel = document.querySelector('.view-panel.active');
  if (activePanel?.id === 'view-group5') renderManagementView();
  if (activePanel?.id === 'view-matrix') {
    renderShiftLedger();
    renderSelectedShiftState();
  }
});

db.ref('pl_cover_position_map').on('value', snapshot => {
  coverPositionMap = snapshot.val() || {};
});

db.ref('pl_history').on('value', snapshot => {
  archiveStore = snapshot.val() || {};
  const archivePanel = document.getElementById('view-archive');
  if (archivePanel?.classList.contains('active')) renderArchiveView();
});

// ============================================================================
// NAVIGATION
// ============================================================================

function applySidebarLock(allowedTabs) {
  const isGroup5 = allowedTabs.includes('group5');

  document.querySelectorAll('.nav-item').forEach(btn => {
    const onclickAttr = btn.getAttribute('onclick') || '';
    const isAllowed = allowedTabs.some(tab => onclickAttr.includes(`'${tab}'`));
    btn.style.setProperty('display', isAllowed ? 'flex' : 'none', 'important');
  });

  document.querySelectorAll('.nav-section').forEach(sec => {
    if (isGroup5) {
      sec.style.setProperty('display', 'block', 'important');
      return;
    }

    let visible = false;
    let next = sec.nextElementSibling;
    while (next && !next.classList.contains('nav-section')) {
      if (next.classList.contains('nav-item') && next.style.display !== 'none') {
        visible = true;
        break;
      }
      next = next.nextElementSibling;
    }
    sec.style.setProperty('display', visible ? 'block' : 'none', 'important');
  });
}

function showPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.classList.add('active');
  panel.style.display = 'block';
}

function switchTab(tabKey) {
  const urlParams = new URLSearchParams(window.location.search);
  const activeParam = (urlParams.get('branch') || 'group5').toLowerCase();
  const allowedTabs = branchGroups[activeParam] || [activeParam];

  if (!allowedTabs.includes(tabKey) && activeParam !== 'group5') tabKey = activeParam;

  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.remove('active');
    panel.style.display = 'none';
  });

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.remove('active');
    const onclickAttr = btn.getAttribute('onclick') || '';
    if (onclickAttr.includes(`'${tabKey}'`)) btn.classList.add('active');
  });

  if (tabKey === 'group5') {
    showPanel('view-group5');
    renderManagementView();
  } else if (tabKey === 'archive') {
    showPanel('view-archive');
    renderArchiveView();
  } else {
    currentBranch = tabKey;
    pendingImport = null;
    showPanel('view-matrix');

    const title = document.getElementById('matrix-title');
    if (title) title.textContent = `${tabKey.toUpperCase()} — Shift Import Desk`;

    resetImportUI(false);
    updateWeekLabels();
    renderShiftLedger();
    renderSelectedShiftState();
  }

  window.scrollTo(0, 0);
}

// ============================================================================
// BASIC UTILITIES
// ============================================================================

function parseCurrencyNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const clean = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '')
    .replace(/,/g, '')
    .replace(/[^0-9.+-]/g, '');
  return Number.parseFloat(clean) || 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatCurrency(value) {
  const num = parseCurrencyNumber(value);
  const sign = num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function brokerNet(client, coverage) {
  return roundMoney(parseCurrencyNumber(coverage) - parseCurrencyNumber(client));
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function exactClientLogin(value) {
  const clean = normalizeWhitespace(value);
  return /^\d{3,12}$/.test(clean) ? clean : '';
}

function firebaseSafeKey(value) {
  return String(value ?? '').replace(/[.#$\[\]\/]/g, '_');
}

function dotDateToISO(dotDate) {
  return String(dotDate).replace(/\./g, '-');
}

function simpleHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function showToast(message, type = 'normal') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', type === 'error');
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ============================================================================
// DATE / WEEK UTILITIES
// ============================================================================

function getWeekBounds(date = new Date()) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const weekday = d.getDay();
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;

  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  return { monday, friday };
}

function isoDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekDateKeys(date = new Date()) {
  const { monday } = getWeekBounds(date);
  return Array.from({ length: 5 }, (_, index) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + index);
    return isoDateOnly(d);
  });
}

function getWeekLabel(date = new Date()) {
  const { monday, friday } = getWeekBounds(date);
  return `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${friday.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  })}`;
}

function formatISODate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))) return String(isoDate || '');
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
}

function updateWeekLabels() {
  const label = `Trading Week · ${getWeekLabel()}`;
  const matrix = document.getElementById('matrix-week-label');
  const executive = document.getElementById('executive-week-label');
  if (matrix) matrix.textContent = label;
  if (executive) executive.textContent = label;
}

function parseMT5Timestamp(value) {
  const match = String(value || '').match(/^(\d{4}\.\d{2}\.\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return {
    dateDot: match[1],
    seconds: Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4])
  };
}

function timestampInShift(value, reportDateDot, shift) {
  const parsed = parseMT5Timestamp(value);
  const cfg = SHIFT_CONFIG[shift];
  if (!parsed || !cfg) return false;
  return parsed.dateDot === reportDateDot && parsed.seconds >= cfg.start && parsed.seconds < cfg.end;
}

// ============================================================================
// MT5 FILE READING — UTF-16 SAFE
// ============================================================================

async function readMT5File(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let encoding = 'utf-8';
  let offset = 0;

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    offset = 2;
  } else if (bytes.length >= 4 && bytes[1] === 0x00 && bytes[3] === 0x00) {
    encoding = 'utf-16le';
  }

  try {
    return new TextDecoder(encoding).decode(bytes.subarray(offset));
  } catch (err) {
    console.warn(`TextDecoder(${encoding}) failed; falling back to utf-8`, err);
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function directCells(row) {
  return Array.from(row.children)
    .filter(el => el.tagName === 'TD' || el.tagName === 'TH')
    .map(el => normalizeWhitespace(el.textContent));
}

// ============================================================================
// SUMMARY PARSER
// ============================================================================

function parseSummaryHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bodyText = normalizeWhitespace(doc.body?.textContent || '');

  const dateMatch = bodyText.match(/from\s+'(\d{4}\.\d{2}\.\d{2})'\s+to\s+'(\d{4}\.\d{2}\.\d{2})'/i);
  if (!dateMatch) throw new Error('Could not detect the report date from the Summary file.');

  const fromDate = dateMatch[1];
  const toDate = dateMatch[2];
  if (fromDate !== toDate) {
    throw new Error(`Summary must cover one day only. This file covers ${fromDate} to ${toDate}.`);
  }

  const byLogin = {};
  let rawRows = 0;

  doc.querySelectorAll('tr').forEach(row => {
    const cells = directCells(row);
    if (cells.length < 13) return;

    const login = exactClientLogin(cells[0]);
    if (!login) return;

    const name = cells[1] || '';
    const group = cells[2] || '';
    const profit = parseCurrencyNumber(cells[12]);

    rawRows += 1;
    if (!byLogin[login]) byLogin[login] = { login, name, group, cumulativeClient: 0 };
    byLogin[login].cumulativeClient += profit;
    if (!byLogin[login].name && name) byLogin[login].name = name;
    if (!byLogin[login].group && group) byLogin[login].group = group;
  });

  const rows = Object.values(byLogin).map(row => ({
    ...row,
    cumulativeClient: roundMoney(row.cumulativeClient)
  }));

  if (!rows.length) throw new Error('No client rows were found in the Summary file.');

  return {
    reportDateDot: fromDate,
    reportDate: dotDateToISO(fromDate),
    rawRows,
    rows
  };
}

function snapshotObjectFromSummary(summary) {
  const snapshot = {};
  summary.rows.forEach(row => {
    snapshot[row.login] = {
      login: row.login,
      name: row.name || '',
      group: row.group || '',
      cumulativeClient: roundMoney(row.cumulativeClient)
    };
  });
  return snapshot;
}

// ============================================================================
// COVERAGE HISTORY PARSER
// ============================================================================

function parseCoverageHistoryHTML(html, fileName = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bodyText = normalizeWhitespace(doc.body?.textContent || '');

  const accountMatch = bodyText.match(/Account:\s*(\d+)/i);
  const accountId = accountMatch ? accountMatch[1] : `file_${simpleHash(fileName || bodyText.slice(0, 200))}`;

  let section = '';
  const positions = [];
  const orders = {};
  const deals = [];

  doc.querySelectorAll('tr').forEach(row => {
    const cells = directCells(row);
    if (!cells.length) return;
    const rowText = normalizeWhitespace(cells.join(' '));

    if (rowText === 'Positions') { section = 'positions'; return; }
    if (rowText === 'Orders') { section = 'orders'; return; }
    if (rowText === 'Deals') { section = 'deals'; return; }

    if (section === 'positions') {
      if (cells.length < 14) return;
      if (!/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(cells[0])) return;
      if (!/^\d+$/.test(cells[1])) return;

      positions.push({
        accountId,
        positionId: cells[1],
        openTime: cells[0],
        symbol: cells[2] || '',
        type: (cells[3] || '').toLowerCase(),
        directComment: exactClientLogin(cells[4]),
        volume: parseCurrencyNumber(cells[5]),
        openPrice: parseCurrencyNumber(cells[6]),
        closeTime: cells[9] || '',
        closePrice: parseCurrencyNumber(cells[10]),
        profit: parseCurrencyNumber(cells[13])
      });
      return;
    }

    if (section === 'orders') {
      if (cells.length < 2) return;
      if (!/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(cells[0])) return;
      if (!/^\d+$/.test(cells[1])) return;

      orders[cells[1]] = {
        orderId: cells[1],
        time: cells[0],
        symbol: cells[2] || '',
        type: (cells[3] || '').toLowerCase(),
        volumeText: cells[4] || '',
        comment: exactClientLogin(cells[cells.length - 1])
      };
      return;
    }

    if (section === 'deals') {
      if (cells.length < 15) return;
      if (!/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(cells[0])) return;
      if (!/^\d+$/.test(cells[1])) return;

      deals.push({
        accountId,
        dealId: cells[1],
        time: cells[0],
        symbol: cells[2] || '',
        type: (cells[3] || '').toLowerCase(),
        direction: (cells[4] || '').toLowerCase(),
        volume: parseCurrencyNumber(cells[5]),
        price: parseCurrencyNumber(cells[6]),
        orderId: cells[7] || '',
        profit: parseCurrencyNumber(cells[12]),
        comment: exactClientLogin(cells[14])
      });
    }
  });

  if (!deals.length) throw new Error(`No Deals section was found in ${fileName || 'the Coverage History file'}.`);

  return { accountId, fileName, positions, orders, deals };
}

function positionLogin(position, report, persistentAccountMap) {
  return position.directComment ||
    report.orders[position.positionId]?.comment ||
    persistentAccountMap?.[firebaseSafeKey(position.positionId)] || '';
}

function oppositePositionType(dealType) {
  if (dealType === 'buy') return 'sell';
  if (dealType === 'sell') return 'buy';
  return '';
}

function resolveDealLogin(deal, report, persistentAccountMap) {
  // Best case: comment is directly on the closing deal.
  if (deal.comment) return { login: deal.comment, method: 'deal-comment' };

  // Next: closing order carries the client comment.
  const orderComment = report.orders[deal.orderId]?.comment || '';
  if (orderComment) return { login: orderComment, method: 'order-comment' };

  // Final-close fallback: match the OUT deal to the Positions row that closes
  // at the exact same MT5 server time and symbol, then use the position mapping.
  let candidates = report.positions.filter(position =>
    position.closeTime === deal.time && position.symbol === deal.symbol
  );

  if (candidates.length > 1) {
    const expectedType = oppositePositionType(deal.type);
    const byTypeVolume = candidates.filter(position =>
      position.type === expectedType && Math.abs(position.volume - deal.volume) < 0.0000001
    );
    if (byTypeVolume.length) candidates = byTypeVolume;
  }

  if (candidates.length > 1) {
    const byPrice = candidates.filter(position => Math.abs(position.closePrice - deal.price) < 0.000001);
    if (byPrice.length) candidates = byPrice;
  }

  if (candidates.length === 1) {
    const login = positionLogin(candidates[0], report, persistentAccountMap);
    if (login) return { login, method: 'position-close-match', positionId: candidates[0].positionId };
  }

  return { login: '', method: 'unmatched' };
}

// ============================================================================
// SHIFT SELECTION
// ============================================================================

function selectImportShift(shift) {
  if (!SHIFT_CONFIG[shift]) return;
  selectedImportShift = shift;
  pendingImport = null;

  document.querySelectorAll('.shift-pick-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.shift === shift);
  });

  const preview = document.getElementById('import-preview');
  if (preview) preview.innerHTML = '';
  const save = document.getElementById('save-shift-import-btn');
  if (save) save.disabled = true;

  setImportStatus(`Selected ${shift} (${SHIFT_CONFIG[shift].display}). Upload the Summary and Coverage History.`, 'neutral');
  renderSelectedShiftState();
}

function renderSelectedShiftState() {
  const container = document.getElementById('selected-shift-state');
  if (!container) return;

  const weekDates = getWeekDateKeys();
  const branchData = shiftStore[currentBranch] || {};
  const savedCount = weekDates.reduce((sum, date) => {
    return sum + SHIFT_ORDER.filter(shift => branchData?.[date]?.[shift]).length;
  }, 0);

  container.innerHTML = `
    <span class="status-dot ${savedCount ? 'good' : 'neutral'}"></span>
    ${escapeHTML(currentBranch.toUpperCase())} · ${savedCount}/15 shifts saved this week · selected ${escapeHTML(selectedImportShift)}
  `;
}

// ============================================================================
// CLIENT SNAPSHOT DELTA ENGINE
// ============================================================================

function previousShiftName(shift) {
  if (shift === 'AM') return 'ON';
  if (shift === 'PM') return 'AM';
  return null;
}

function validateShiftSequence(reportDate, shift) {
  const previous = previousShiftName(shift);
  if (!previous) return;

  const previousRecord = shiftStore?.[currentBranch]?.[reportDate]?.[previous];
  if (!previousRecord?.snapshotAccounts) {
    throw new Error(`${shift} requires the ${previous} Summary snapshot for ${reportDate} first. Import ${previous} before ${shift}.`);
  }
}

function deriveShiftAccounts(snapshotAccounts, baselineSnapshot, coverageByLogin) {
  const result = {};
  const logins = new Set([
    ...Object.keys(snapshotAccounts || {}),
    ...Object.keys(baselineSnapshot || {}),
    ...Object.keys(coverageByLogin || {})
  ]);

  logins.forEach(login => {
    const current = snapshotAccounts?.[login];
    const previous = baselineSnapshot?.[login];

    // If a login existed in the prior cumulative snapshot but is unexpectedly
    // absent in the newer cumulative snapshot, keep the prior cumulative value.
    // A cumulative day report should not erase earlier activity.
    const currentCum = current
      ? parseCurrencyNumber(current.cumulativeClient)
      : parseCurrencyNumber(previous?.cumulativeClient);
    const previousCum = parseCurrencyNumber(previous?.cumulativeClient);

    const client = roundMoney(currentCum - previousCum);
    const coverage = roundMoney(coverageByLogin?.[login] || 0);

    if (client === 0 && coverage === 0) return;

    result[login] = {
      login,
      name: current?.name || previous?.name || '',
      group: current?.group || previous?.group || '',
      client,
      coverage,
      brokerNet: brokerNet(client, coverage)
    };
  });

  return result;
}

function recalculateDayRecords(dayRecords) {
  const recalculated = deepClone(dayRecords);
  let baselineSnapshot = {};

  SHIFT_ORDER.forEach((shift, index) => {
    const record = recalculated[shift];
    if (!record) return;

    if (index > 0) {
      const previousShift = SHIFT_ORDER[index - 1];
      const previousRecord = recalculated[previousShift];
      if (!previousRecord?.snapshotAccounts) {
        record.baselineMissing = true;
        record.accounts = {};
        return;
      }
      baselineSnapshot = previousRecord.snapshotAccounts;
    } else {
      baselineSnapshot = {};
    }

    record.baselineMissing = false;
    record.accounts = deriveShiftAccounts(
      record.snapshotAccounts || {},
      baselineSnapshot,
      record.coverageByLogin || {}
    );

    const accounts = Object.values(record.accounts);
    record.stats = {
      ...(record.stats || {}),
      storedAccounts: accounts.length,
      clientShiftTotal: roundMoney(accounts.reduce((sum, row) => sum + row.client, 0)),
      coverShiftTotal: roundMoney(accounts.reduce((sum, row) => sum + row.coverage, 0)),
      brokerShiftNet: roundMoney(accounts.reduce((sum, row) => sum + row.brokerNet, 0))
    };
  });

  return recalculated;
}

// ============================================================================
// SHIFT IMPORT ANALYSIS
// ============================================================================

async function analyzeShiftImport() {
  const summaryInput = document.getElementById('summary-file');
  const coverageInput = document.getElementById('coverage-files');
  const analyzeButton = document.getElementById('analyze-import-btn');

  const summaryFile = summaryInput?.files?.[0];
  const coverageFiles = Array.from(coverageInput?.files || []);

  if (!summaryFile) {
    showToast('Choose the MT5 Summary HTML file first.', 'error');
    return;
  }
  if (!coverageFiles.length) {
    showToast('Choose at least one Coverage History HTML file.', 'error');
    return;
  }

  if (analyzeButton) {
    analyzeButton.disabled = true;
    analyzeButton.textContent = 'Analyzing…';
  }
  setImportStatus(`Analyzing ${selectedImportShift} files…`, 'working');

  try {
    const summaryHTML = await readMT5File(summaryFile);
    const summary = parseSummaryHTML(summaryHTML);
    validateShiftSequence(summary.reportDate, selectedImportShift);

    const coverageReports = [];
    for (const file of coverageFiles) {
      const html = await readMT5File(file);
      coverageReports.push(parseCoverageHistoryHTML(html, file.name));
    }

    const snapshotAccounts = snapshotObjectFromSummary(summary);
    const previousShift = previousShiftName(selectedImportShift);
    const baselineSnapshot = previousShift
      ? (shiftStore?.[currentBranch]?.[summary.reportDate]?.[previousShift]?.snapshotAccounts || {})
      : {};

    const mappingUpdates = {};
    const coverageByLogin = {};
    const matchedDeals = [];
    const unmatchedDeals = [];
    const seenDeals = new Set();
    let historicalOrOtherShiftDealsIgnored = 0;

    coverageReports.forEach(report => {
      const accountKey = firebaseSafeKey(report.accountId);
      const persistentAccountMap = coverPositionMap?.[currentBranch]?.[accountKey] || {};

      // Learn every position/client mapping from the full uploaded history.
      report.positions.forEach(position => {
        const login = positionLogin(position, report, persistentAccountMap);
        if (!login) return;
        if (!mappingUpdates[accountKey]) mappingUpdates[accountKey] = {};
        mappingUpdates[accountKey][firebaseSafeKey(position.positionId)] = login;
      });

      report.deals.forEach(deal => {
        const uniqueDealKey = `${accountKey}_${firebaseSafeKey(deal.dealId)}`;
        if (seenDeals.has(uniqueDealKey)) return;
        seenDeals.add(uniqueDealKey);

        if (deal.direction !== 'out') return;
        if (!timestampInShift(deal.time, summary.reportDateDot, selectedImportShift)) {
          historicalOrOtherShiftDealsIgnored += 1;
          return;
        }

        const resolution = resolveDealLogin(deal, report, persistentAccountMap);
        const normalized = {
          ...deal,
          accountId: accountKey,
          recordKey: uniqueDealKey,
          login: resolution.login,
          matchMethod: resolution.method,
          positionId: resolution.positionId || ''
        };

        if (resolution.login) {
          matchedDeals.push(normalized);
          coverageByLogin[resolution.login] = roundMoney((coverageByLogin[resolution.login] || 0) + deal.profit);
        } else {
          unmatchedDeals.push(normalized);
        }
      });
    });

    const accounts = deriveShiftAccounts(snapshotAccounts, baselineSnapshot, coverageByLogin);
    const rows = Object.values(accounts);
    const { winners, losers } = rankEntries(rows, 3);

    pendingImport = {
      branch: currentBranch,
      shift: selectedImportShift,
      reportDate: summary.reportDate,
      reportDateDot: summary.reportDateDot,
      summaryFileName: summaryFile.name,
      coverageFileNames: coverageFiles.map(file => file.name),
      summaryRawRows: summary.rawRows,
      snapshotAccounts,
      baselineShift: previousShift,
      baselineSnapshot,
      coverageByLogin,
      matchedDeals,
      unmatchedDeals,
      mappingUpdates,
      historicalOrOtherShiftDealsIgnored,
      accounts,
      winners,
      losers
    };

    renderImportPreview();
    setImportStatus(
      `${selectedImportShift} detected for ${formatISODate(summary.reportDate)} · ${rows.length} active shift accounts · ${matchedDeals.length} matched cover closes.`,
      unmatchedDeals.length ? 'warning' : 'success'
    );

    const saveButton = document.getElementById('save-shift-import-btn');
    if (saveButton) saveButton.disabled = false;
  } catch (err) {
    console.error('Shift import analysis failed:', err);
    pendingImport = null;
    setImportStatus(err.message || 'Could not analyze the files.', 'error');
    showToast(err.message || 'Could not analyze the files.', 'error');

    const preview = document.getElementById('import-preview');
    if (preview) preview.innerHTML = '';
    const saveButton = document.getElementById('save-shift-import-btn');
    if (saveButton) saveButton.disabled = true;
  } finally {
    if (analyzeButton) {
      analyzeButton.disabled = false;
      analyzeButton.textContent = 'Analyze Files';
    }
  }
}

function renderImportPreview() {
  const preview = document.getElementById('import-preview');
  if (!preview || !pendingImport) return;

  const rows = Object.values(pendingImport.accounts || {});
  const clientTotal = roundMoney(rows.reduce((sum, row) => sum + row.client, 0));
  const coverTotal = roundMoney(rows.reduce((sum, row) => sum + row.coverage, 0));
  const netTotal = roundMoney(rows.reduce((sum, row) => sum + row.brokerNet, 0));
  const matchedProfit = roundMoney(pendingImport.matchedDeals.reduce((sum, row) => sum + row.profit, 0));

  preview.innerHTML = `
    <div class="import-summary-grid">
      <div class="import-stat"><span>REPORT DATE</span><strong>${escapeHTML(formatISODate(pendingImport.reportDate))}</strong></div>
      <div class="import-stat"><span>SHIFT</span><strong>${escapeHTML(pendingImport.shift)} · ${escapeHTML(SHIFT_CONFIG[pendingImport.shift].display)}</strong></div>
      <div class="import-stat"><span>CLIENT P/L</span><strong class="${clientTotal >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(clientTotal)}</strong></div>
      <div class="import-stat"><span>COVER PROFIT</span><strong class="${coverTotal >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(coverTotal)}</strong></div>
      <div class="import-stat"><span>BROKER NET</span><strong class="${netTotal >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(netTotal)}</strong></div>
      <div class="import-stat"><span>MATCHED OUT DEALS</span><strong>${pendingImport.matchedDeals.length} · ${formatCurrency(matchedProfit)}</strong></div>
    </div>

    <div class="preview-grid">
      ${previewRankingCard(`${pendingImport.shift} Top 3 Winners`, pendingImport.winners, 'winner')}
      ${previewRankingCard(`${pendingImport.shift} Top 3 Losers`, pendingImport.losers, 'loser')}
    </div>

    ${pendingImport.unmatchedDeals.length ? renderUnmatchedDeals(pendingImport.unmatchedDeals) : `
      <div class="match-ok">✓ Every ${pendingImport.shift} coverage OUT deal was matched to a client login.</div>
    `}
  `;
}

function previewRankingCard(title, rows, type) {
  const body = rows.length
    ? rows.map((row, index) => `
        <tr>
          <td>#${index + 1}</td>
          <td><strong>${escapeHTML(row.login)}</strong></td>
          <td class="${type === 'winner' ? 'tag-winner' : 'tag-loser'}">${formatCurrency(row.client)}</td>
          <td>${formatCurrency(row.coverage)}</td>
          <td class="${row.brokerNet >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(row.brokerNet)}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="muted" style="text-align:center;padding:16px;">No data</td></tr>';

  return `
    <div class="branch-card preview-card">
      <h3>${escapeHTML(title)}</h3>
      <div class="table-scroll">
        <table class="matrix-table">
          <thead><tr><th>RANK</th><th>LOGIN</th><th>CLIENT P/L</th><th>COVER</th><th>BROKER NET</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
}

function renderUnmatchedDeals(rows) {
  const total = roundMoney(rows.reduce((sum, row) => sum + row.profit, 0));
  return `
    <div class="unmatched-card">
      <div class="unmatched-heading">
        <div>
          <strong>Unmatched Coverage Deals</strong>
          <p>No manual typing is required. These deals are saved as unmatched. Re-import the same shift with a longer Coverage History if you want the system to recover their client comments.</p>
        </div>
        <span class="warning-pill">${rows.length} deals · ${formatCurrency(total)}</span>
      </div>
      <div class="table-scroll">
        <table class="matrix-table">
          <thead><tr><th>COVER ACCOUNT</th><th>DEAL</th><th>TIME</th><th>SYMBOL</th><th>VOLUME</th><th>PROFIT</th></tr></thead>
          <tbody>${rows.map(row => `
            <tr>
              <td>${escapeHTML(row.accountId)}</td>
              <td>${escapeHTML(row.dealId)}</td>
              <td>${escapeHTML(row.time)}</td>
              <td>${escapeHTML(row.symbol)}</td>
              <td>${escapeHTML(row.volume)}</td>
              <td class="${row.profit >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(row.profit)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// ============================================================================
// SAVE SHIFT + RECALCULATE DAY
// ============================================================================

async function saveShiftImport() {
  if (!pendingImport) {
    showToast('Analyze the files first.', 'error');
    return;
  }

  if (pendingImport.branch !== currentBranch || pendingImport.shift !== selectedImportShift) {
    showToast('Branch or shift changed. Analyze again before saving.', 'error');
    return;
  }

  const existing = shiftStore?.[currentBranch]?.[pendingImport.reportDate]?.[pendingImport.shift];
  if (existing) {
    const replace = confirm(
      `${currentBranch.toUpperCase()} already has ${pendingImport.shift} saved for ${pendingImport.reportDate}.\n\n` +
      `Saving now will replace that shift and automatically recalculate dependent shift totals.\n\nContinue?`
    );
    if (!replace) return;
  }

  if (pendingImport.unmatchedDeals.length) {
    const proceed = confirm(
      `${pendingImport.unmatchedDeals.length} coverage OUT deal(s) could not be matched automatically.\n\n` +
      `They will be SAVED as unmatched and excluded from Coverage P/L until you re-import this shift with enough history to match them.\n\nContinue?`
    );
    if (!proceed) return;
  }

  const saveButton = document.getElementById('save-shift-import-btn');
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
  }

  const oldDay = deepClone(shiftStore?.[currentBranch]?.[pendingImport.reportDate] || {});
  oldDay[pendingImport.shift] = {
    branch: currentBranch,
    reportDate: pendingImport.reportDate,
    shift: pendingImport.shift,
    shiftWindow: SHIFT_CONFIG[pendingImport.shift].display,
    importedAt: firebase.database.ServerValue.TIMESTAMP,
    summaryFile: pendingImport.summaryFileName,
    coverageFiles: pendingImport.coverageFileNames,
    snapshotAccounts: pendingImport.snapshotAccounts,
    coverageByLogin: pendingImport.coverageByLogin,
    unmatchedDeals: pendingImport.unmatchedDeals.map(row => ({
      accountId: row.accountId,
      dealId: row.dealId,
      time: row.time,
      symbol: row.symbol,
      type: row.type,
      volume: row.volume,
      profit: row.profit
    })),
    stats: {
      summaryRows: pendingImport.summaryRawRows,
      matchedCoverDeals: pendingImport.matchedDeals.length,
      unmatchedCoverDeals: pendingImport.unmatchedDeals.length,
      ignoredOtherDeals: pendingImport.historicalOrOtherShiftDealsIgnored
    }
  };

  const recalculatedDay = recalculateDayRecords(oldDay);
  const updates = {};
  updates[`pl_shift_store/${currentBranch}/${pendingImport.reportDate}`] = recalculatedDay;

  Object.entries(pendingImport.mappingUpdates).forEach(([accountId, positions]) => {
    Object.entries(positions).forEach(([positionId, login]) => {
      updates[`pl_cover_position_map/${currentBranch}/${accountId}/${positionId}`] = login;
    });
  });

  try {
    await db.ref().update(updates);
    showToast(`${currentBranch.toUpperCase()} ${pendingImport.shift} saved for ${pendingImport.reportDate}.`);
    setImportStatus(`Saved ${pendingImport.shift} for ${formatISODate(pendingImport.reportDate)}. Weekly totals recalculated automatically.`, 'success');
    pendingImport = null;
    clearFileInputs();
    const preview = document.getElementById('import-preview');
    if (preview) preview.innerHTML = '';
    renderShiftLedger();
    renderSelectedShiftState();
  } catch (err) {
    console.error('Shift save failed:', err);
    showToast('Save failed. Check Firebase and try again.', 'error');
  } finally {
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'Save Shift';
    }
  }
}

function resetImportUI(clearFiles = true) {
  pendingImport = null;
  if (clearFiles) clearFileInputs();

  const preview = document.getElementById('import-preview');
  if (preview) preview.innerHTML = '';

  const saveButton = document.getElementById('save-shift-import-btn');
  if (saveButton) saveButton.disabled = true;

  setImportStatus(`Selected ${selectedImportShift} (${SHIFT_CONFIG[selectedImportShift].display}). Upload the Summary and Coverage History.`, 'neutral');
}

function clearFileInputs() {
  const summary = document.getElementById('summary-file');
  const coverage = document.getElementById('coverage-files');
  if (summary) summary.value = '';
  if (coverage) coverage.value = '';
}

function setImportStatus(message, type = 'neutral') {
  const status = document.getElementById('import-status');
  if (!status) return;
  status.textContent = message;
  status.className = `import-status ${type}`;
}

// ============================================================================
// SAVED SHIFT LEDGER / DETAILS
// ============================================================================

function renderShiftLedger() {
  const container = document.getElementById('shift-ledger-container');
  if (!container) return;

  const dateKeys = getWeekDateKeys();
  const branchData = shiftStore[currentBranch] || {};

  let rows = '';
  dateKeys.forEach(date => {
    SHIFT_ORDER.forEach(shift => {
      const record = branchData?.[date]?.[shift];
      if (!record) {
        rows += `
          <tr>
            <td>${escapeHTML(formatISODate(date))}</td>
            <td><span class="shift-badge shift-${shift.toLowerCase()}">${shift}</span></td>
            <td><span class="ledger-status missing">NOT IMPORTED</span></td>
            <td>—</td><td>—</td><td>—</td><td>—</td><td></td>
          </tr>`;
        return;
      }

      const stats = record.stats || {};
      const incomplete = Number(stats.unmatchedCoverDeals || 0) > 0 || record.baselineMissing;
      rows += `
        <tr>
          <td>${escapeHTML(formatISODate(date))}</td>
          <td><span class="shift-badge shift-${shift.toLowerCase()}">${shift}</span></td>
          <td><span class="ledger-status ${incomplete ? 'warning' : 'complete'}">${incomplete ? 'CHECK' : 'SAVED'}</span></td>
          <td>${Number(stats.storedAccounts || 0)}</td>
          <td class="${Number(stats.clientShiftTotal || 0) >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(stats.clientShiftTotal || 0)}</td>
          <td class="${Number(stats.coverShiftTotal || 0) >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(stats.coverShiftTotal || 0)}</td>
          <td class="${Number(stats.brokerShiftNet || 0) >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(stats.brokerShiftNet || 0)}</td>
          <td><button class="table-action-btn" onclick="viewShiftDetails('${date}','${shift}')">View</button></td>
        </tr>`;
    });
  });

  container.innerHTML = `
    <div class="table-card">
      <div class="table-scroll">
        <table class="matrix-table">
          <thead><tr><th>DATE</th><th>SHIFT</th><th>STATUS</th><th>ACCOUNTS</th><th>CLIENT P/L</th><th>COVER PROFIT</th><th>BROKER NET</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function viewShiftDetails(date, shift) {
  const container = document.getElementById('shift-detail-container');
  const record = shiftStore?.[currentBranch]?.[date]?.[shift];
  if (!container || !record) return;

  const entries = Object.values(record.accounts || {});
  const { winners, losers } = rankEntries(entries, 3);
  const sorted = [...entries].sort((a, b) => Math.abs(b.client) - Math.abs(a.client));
  const unmatched = record.unmatchedDeals || [];

  container.innerHTML = `
    <div class="shift-detail-card">
      <div class="section-heading">
        <div>
          <div class="eyebrow">${escapeHTML(currentBranch.toUpperCase())} · ${escapeHTML(shift)}</div>
          <h2>${escapeHTML(formatISODate(date))} — Full Saved Shift</h2>
        </div>
        <button class="ghost-btn" onclick="document.getElementById('shift-detail-container').innerHTML=''">Close</button>
      </div>

      <div class="preview-grid">
        ${previewRankingCard('Top 3 Winners', winners, 'winner')}
        ${previewRankingCard('Top 3 Losers', losers, 'loser')}
      </div>

      <div class="section-heading compact-heading">
        <div><div class="eyebrow">ALL SAVED ACCOUNTS</div><h2>${entries.length} accounts</h2></div>
        <div class="section-note">Shift totals are what feed Group 5</div>
      </div>
      <div class="table-card">
        <div class="table-scroll">
          <table class="matrix-table">
            <thead><tr><th>LOGIN</th><th>NAME</th><th>CLIENT P/L</th><th>COVER PROFIT</th><th>BROKER NET</th></tr></thead>
            <tbody>${sorted.length ? sorted.map(row => `
              <tr>
                <td><strong>${escapeHTML(row.login)}</strong></td>
                <td>${escapeHTML(row.name || '')}</td>
                <td class="${row.client >= 0 ? 'tag-winner' : 'tag-loser'}">${formatCurrency(row.client)}</td>
                <td class="${row.coverage >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(row.coverage)}</td>
                <td class="${row.brokerNet >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(row.brokerNet)}</td>
              </tr>`).join('') : '<tr><td colspan="5" class="muted" style="text-align:center;padding:18px;">No shift activity</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      ${unmatched.length ? `
        <div class="unmatched-card ledger-unmatched">
          <div class="unmatched-heading"><div><strong>Saved Unmatched Coverage</strong><p>Re-import this same shift with a longer history to attempt automatic matching.</p></div><span class="warning-pill">${unmatched.length} deals</span></div>
        </div>` : ''}
    </div>`;

  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================================
// WEEKLY EXECUTIVE ENGINE — ALL SAVED SHIFTS
// ============================================================================

function aggregateBranchWeek(branchData, dateKeys = getWeekDateKeys()) {
  const netByLogin = {};
  const allowedDates = new Set(dateKeys);

  Object.entries(branchData || {}).forEach(([dateKey, dayData]) => {
    if (!allowedDates.has(dateKey)) return;

    SHIFT_ORDER.forEach(shift => {
      const record = dayData?.[shift];
      if (!record) return;

      Object.values(record.accounts || {}).forEach(account => {
        const login = String(account.login || '').trim();
        if (!login) return;

        if (!netByLogin[login]) {
          netByLogin[login] = {
            login,
            name: account.name || '',
            client: 0,
            coverage: 0,
            dates: new Set(),
            shiftCount: 0
          };
        }

        const target = netByLogin[login];
        target.client += parseCurrencyNumber(account.client);
        target.coverage += parseCurrencyNumber(account.coverage);
        target.dates.add(dateKey);
        target.shiftCount += 1;
        if (!target.name && account.name) target.name = account.name;
      });
    });
  });

  return Object.values(netByLogin).map(row => ({
    login: row.login,
    name: row.name,
    client: roundMoney(row.client),
    coverage: roundMoney(row.coverage),
    brokerNet: brokerNet(row.client, row.coverage),
    days: Array.from(row.dates).sort(),
    occurrences: row.shiftCount
  }));
}

function rankEntries(entries, limit = 5) {
  return {
    winners: entries.filter(row => row.client > 0).sort((a, b) => b.client - a.client).slice(0, limit),
    losers: entries.filter(row => row.client < 0).sort((a, b) => a.client - b.client).slice(0, limit)
  };
}

function computeWeeklyBranch(branch, sourceStore = shiftStore, dateKeys = getWeekDateKeys()) {
  const entries = aggregateBranchWeek(sourceStore?.[branch] || {}, dateKeys);
  return { ...rankEntries(entries, 5), entries };
}

function computeCombinedWeekly(sourceStore = shiftStore, dateKeys = getWeekDateKeys()) {
  const combined = {};

  allBranches.forEach(branch => {
    aggregateBranchWeek(sourceStore?.[branch] || {}, dateKeys).forEach(row => {
      if (!combined[row.login]) {
        combined[row.login] = {
          login: row.login,
          name: row.name || '',
          client: 0,
          coverage: 0,
          days: new Set(),
          shifts: 0,
          branches: new Set()
        };
      }

      const target = combined[row.login];
      target.client += row.client;
      target.coverage += row.coverage;
      target.shifts += row.occurrences;
      target.branches.add(branch);
      row.days.forEach(day => target.days.add(day));
      if (!target.name && row.name) target.name = row.name;
    });
  });

  const entries = Object.values(combined).map(row => ({
    login: row.login,
    name: row.name,
    client: roundMoney(row.client),
    coverage: roundMoney(row.coverage),
    brokerNet: brokerNet(row.client, row.coverage),
    days: Array.from(row.days).sort(),
    occurrences: row.shifts,
    branches: Array.from(row.branches).sort()
  }));

  return { ...rankEntries(entries, 5), entries };
}

function renderManagementView() {
  updateWeekLabels();
  const dateKeys = getWeekDateKeys();
  const combined = computeCombinedWeekly(shiftStore, dateKeys);

  const combinedContainer = document.getElementById('combined-tables-container');
  if (combinedContainer) {
    combinedContainer.innerHTML =
      rankingCard('Top 5 Winners', combined.winners, 'winner', true) +
      rankingCard('Top 5 Losers', combined.losers, 'loser', true);
  }

  const container = document.getElementById('management-tables-container');
  if (container) {
    container.innerHTML = '';
    allBranches.forEach(branch => {
      const result = computeWeeklyBranch(branch, shiftStore, dateKeys);
      container.innerHTML += rankingCard(`${branch.toUpperCase()} — Top 5 Winners`, result.winners, 'winner', false);
      container.innerHTML += rankingCard(`${branch.toUpperCase()} — Top 5 Losers`, result.losers, 'loser', false);
    });
  }

  renderExecutiveSourceStatus(dateKeys);
}

function renderExecutiveSourceStatus(dateKeys) {
  const note = document.getElementById('executive-source-status');
  if (!note) return;

  let savedShifts = 0;
  let incompleteShifts = 0;
  let branchesWithData = 0;

  allBranches.forEach(branch => {
    let hasData = false;
    dateKeys.forEach(date => {
      SHIFT_ORDER.forEach(shift => {
        const record = shiftStore?.[branch]?.[date]?.[shift];
        if (!record) return;
        savedShifts += 1;
        hasData = true;
        if (record.baselineMissing || Number(record.stats?.unmatchedCoverDeals || 0) > 0) incompleteShifts += 1;
      });
    });
    if (hasData) branchesWithData += 1;
  });

  note.innerHTML = `
    <span class="status-dot ${savedShifts ? 'good' : 'neutral'}"></span>
    ${branchesWithData}/${allBranches.length} branches active · ${savedShifts} shift reports saved this week
    ${incompleteShifts ? `<span class="status-separator">·</span> <span class="warning-text">${incompleteShifts} shift(s) need coverage review</span>` : ''}
  `;
}

function rankingCard(title, rows, type, includeBranch) {
  return `
    <div class="branch-card">
      <h3>${escapeHTML(title)}</h3>
      <div class="table-scroll">
        <table class="matrix-table">
          <thead><tr><th>RANK</th><th>LOGIN</th>${includeBranch ? '<th>BRANCH</th>' : ''}<th>CLIENT P/L</th><th>COVER PROFIT</th><th>BROKER NET</th><th>SHIFTS</th></tr></thead>
          <tbody>${renderRankingRows(rows, type, includeBranch)}</tbody>
        </table>
      </div>
    </div>`;
}

function renderRankingRows(rows, type, includeBranch) {
  if (!rows.length) {
    return `<tr><td colspan="${includeBranch ? 7 : 6}" class="muted" style="text-align:center;padding:18px;">No saved shift imports yet</td></tr>`;
  }

  return rows.map((row, index) => `
    <tr>
      <td>#${index + 1}</td>
      <td><strong>${escapeHTML(row.login)}</strong></td>
      ${includeBranch ? `<td>${escapeHTML((row.branches || []).map(x => x.toUpperCase()).join(', '))}</td>` : ''}
      <td class="${type === 'winner' ? 'tag-winner' : 'tag-loser'}">${formatCurrency(row.client)}</td>
      <td class="${row.coverage >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(row.coverage)}</td>
      <td class="${row.brokerNet >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(row.brokerNet)}</td>
      <td>${row.occurrences}</td>
    </tr>`).join('');
}

// ============================================================================
// ARCHIVE
// ============================================================================

function extractWeekShiftData(sourceStore, dateKeys) {
  const result = {};
  allBranches.forEach(branch => {
    dateKeys.forEach(date => {
      const day = sourceStore?.[branch]?.[date];
      if (!day) return;
      if (!result[branch]) result[branch] = {};
      result[branch][date] = deepClone(day);
    });
  });
  return result;
}

async function archiveAndResetWeek() {
  const dateKeys = getWeekDateKeys();
  const snapshot = extractWeekShiftData(shiftStore, dateKeys);

  let shiftCount = 0;
  allBranches.forEach(branch => {
    dateKeys.forEach(date => {
      shiftCount += SHIFT_ORDER.filter(shift => snapshot?.[branch]?.[date]?.[shift]).length;
    });
  });

  const weekLabel = getWeekLabel();
  const confirmed = confirm(
    `Archive trading week ${weekLabel}?\n\n` +
    `${shiftCount} saved ON / AM / PM shift reports will be archived.\n\n` +
    `The persistent cover-position/client mapping will NOT be deleted.\n\nContinue?`
  );
  if (!confirmed) return;

  const archiveKey = Date.now().toString();
  const { monday, friday } = getWeekBounds();
  const archivePayload = {
    archivedAt: new Date().toISOString(),
    weekLabel,
    weekStart: isoDateOnly(monday),
    weekEnd: isoDateOnly(friday),
    shiftData: snapshot
  };

  const updates = {};
  updates[`pl_history/${archiveKey}`] = archivePayload;
  allBranches.forEach(branch => {
    dateKeys.forEach(date => {
      if (shiftStore?.[branch]?.[date]) updates[`pl_shift_store/${branch}/${date}`] = null;
    });
  });

  try {
    await db.ref().update(updates);
    showToast('Week archived successfully. New week is ready.');
  } catch (err) {
    console.error('Archive failed:', err);
    showToast('Archive failed. No shift data was cleared.', 'error');
  }
}

function formatArchiveDate(value) {
  const d = new Date(value);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderArchiveView() {
  const list = document.getElementById('archive-week-list');
  const detail = document.getElementById('archive-detail-container');
  if (!list || !detail) return;

  const keys = Object.keys(archiveStore).sort((a, b) => Number(b) - Number(a));
  if (!keys.length) {
    list.innerHTML = '<p class="subtitle" style="padding:10px;">No archived weeks yet.</p>';
    detail.innerHTML = '';
    selectedArchiveWeek = null;
    return;
  }

  if (!selectedArchiveWeek || !archiveStore[selectedArchiveWeek]) selectedArchiveWeek = keys[0];

  list.innerHTML = keys.map(key => {
    const entry = archiveStore[key];
    const label = entry.weekLabel || formatArchiveDate(entry.archivedAt || Number(key));
    return `<button class="archive-week-btn ${key === selectedArchiveWeek ? 'active' : ''}" onclick="selectArchiveWeek('${key}')">${escapeHTML(label)}</button>`;
  }).join('');

  renderArchiveDetail(selectedArchiveWeek);
}

function selectArchiveWeek(key) {
  selectedArchiveWeek = key;
  renderArchiveView();
}

function renderArchiveDetail(key) {
  const container = document.getElementById('archive-detail-container');
  const entry = archiveStore[key];
  if (!container || !entry) return;

  if (!entry.shiftData) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>Legacy archive</strong>
        This archived week was created before the ON / AM / PM import system and does not contain shift-level source data.
      </div>`;
    return;
  }

  const source = entry.shiftData;
  const dateKeys = entry.weekStart && entry.weekEnd
    ? buildDateRange(entry.weekStart, entry.weekEnd)
    : Object.values(source).flatMap(branch => Object.keys(branch || {})).filter((v, i, a) => a.indexOf(v) === i).sort();

  const combined = computeCombinedWeekly(source, dateKeys);
  let html = `
    <div class="section-heading">
      <div><div class="eyebrow">ARCHIVED WEEK</div><h2>${escapeHTML(entry.weekLabel || '')}</h2></div>
      <div class="section-note">Archived ${escapeHTML(formatArchiveDate(entry.archivedAt || Number(key)))}</div>
    </div>
    <div class="dashboard-grid executive-pair">
      ${rankingCard('Top 5 Winners', combined.winners, 'winner', true)}
      ${rankingCard('Top 5 Losers', combined.losers, 'loser', true)}
    </div>
    <div class="section-heading"><div><div class="eyebrow">BRANCH PERFORMANCE</div><h2>Top 5 by Branch</h2></div></div>
    <div class="dashboard-grid">`;

  allBranches.forEach(branch => {
    const result = computeWeeklyBranch(branch, source, dateKeys);
    html += rankingCard(`${branch.toUpperCase()} — Top 5 Winners`, result.winners, 'winner', false);
    html += rankingCard(`${branch.toUpperCase()} — Top 5 Losers`, result.losers, 'loser', false);
  });

  html += '</div>';
  container.innerHTML = html;
}

function buildDateRange(startISO, endISO) {
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ey, em, ed] = endISO.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd, 12);
  const end = new Date(ey, em - 1, ed, 12);
  const result = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) result.push(isoDateOnly(d));
  return result;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initApp() {
  updateWeekLabels();
  selectImportShift('ON');

  const urlParams = new URLSearchParams(window.location.search);
  const branchParam = (urlParams.get('branch') || 'group5').toLowerCase();
  const allowedTabs = branchGroups[branchParam] || [branchParam];

  applySidebarLock(allowedTabs);
  switchTab(branchParam);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
