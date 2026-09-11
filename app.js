// ============================================================================
// P/L SYSTEM — Dealer Risk Dashboard
// Daily Summary + Coverage History Import Edition
// ============================================================================

// IMPORTANT: keep your real production Firebase credentials here.
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

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const shifts = ['ON', 'AM', 'PM'];

// ============================================================================
// STATE
// ============================================================================

let currentBranch = 'awada';
let matrixStore = {};            // Existing manual shift Top 3 workflow
let dailyStore = {};             // Source of truth for Executive weekly ranking
let coverPositionMap = {};       // Persistent cover position -> client login mapping
let archiveStore = {};
let saveDebounceTimers = {};
let selectedArchiveWeek = null;
let pendingImport = null;
let toastTimer = null;

// ============================================================================
// FIREBASE LIVE LISTENERS
// ============================================================================

db.ref('pl_matrix_store').on('value', snapshot => {
  matrixStore = snapshot.val() || {};

  const activePanel = document.querySelector('.view-panel.active');
  if (activePanel && activePanel.id === 'view-matrix') {
    if (!document.activeElement || document.activeElement.tagName !== 'INPUT') {
      renderMatrixTable();
    }
  }
});

db.ref('pl_daily_store').on('value', snapshot => {
  dailyStore = snapshot.val() || {};

  const activePanel = document.querySelector('.view-panel.active');
  if (activePanel && activePanel.id === 'view-group5') renderManagementView();
  if (activePanel && activePanel.id === 'view-matrix') renderDailyImportStatus();
});

db.ref('pl_cover_position_map').on('value', snapshot => {
  coverPositionMap = snapshot.val() || {};
});

db.ref('pl_history').on('value', snapshot => {
  archiveStore = snapshot.val() || {};

  const archivePanel = document.getElementById('view-archive');
  if (archivePanel && archivePanel.classList.contains('active')) renderArchiveView();
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

    let hasVisibleChild = false;
    let nextElem = sec.nextElementSibling;

    while (nextElem && !nextElem.classList.contains('nav-section')) {
      if (nextElem.classList.contains('nav-item') && nextElem.style.display !== 'none') {
        hasVisibleChild = true;
        break;
      }
      nextElem = nextElem.nextElementSibling;
    }

    sec.style.setProperty('display', hasVisibleChild ? 'block' : 'none', 'important');
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
    if (title) title.textContent = `${tabKey.toUpperCase()} — Daily P/L & Coverage Desk`;

    resetImportUI(false);
    updateWeekLabels();
    renderDailyImportStatus();
    renderMatrixTable();
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

function formatCurrency(value) {
  const num = parseCurrencyNumber(value);
  const sign = num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function brokerNet(client, coverage) {
  return parseCurrencyNumber(coverage) - parseCurrencyNumber(client);
}

function calculatePercentage(client, coverage) {
  const c = parseCurrencyNumber(client);
  const cov = parseCurrencyNumber(coverage);
  if (!c) return '-';
  return `${((cov / Math.abs(c)) * 100).toFixed(2)}%`;
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

function isoDateToDot(isoDate) {
  return String(isoDate).replace(/-/g, '.');
}

function showToast(message, type = 'normal') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', type === 'error');
  toast.classList.add('show');

  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
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
  const matrixLabel = document.getElementById('matrix-week-label');
  const executiveLabel = document.getElementById('executive-week-label');
  if (matrixLabel) matrixLabel.textContent = label;
  if (executiveLabel) executiveLabel.textContent = label;
}

// ============================================================================
// MT5 FILE READING — UTF-16 SAFE
// ============================================================================

// MT5 Manager/Terminal HTML exports are commonly UTF-16LE with a BOM.
// Blob.text() assumes UTF-8, so we decode the bytes ourselves.
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
    console.warn(`TextDecoder(${encoding}) failed, falling back to utf-8`, err);
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
    throw new Error(`Summary must be a single day. This file covers ${fromDate} to ${toDate}.`);
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
    const profit = parseCurrencyNumber(cells[12]); // Profit column only

    rawRows += 1;

    if (!byLogin[login]) {
      byLogin[login] = { login, name, group, client: 0 };
    }

    byLogin[login].client += profit;
    if (!byLogin[login].name && name) byLogin[login].name = name;
    if (!byLogin[login].group && group) byLogin[login].group = group;
  });

  const rows = Object.values(byLogin);
  if (!rows.length) throw new Error('No client rows were found in the Summary file.');

  return {
    reportDateDot: fromDate,
    reportDate: dotDateToISO(fromDate),
    rawRows,
    rows
  };
}

// ============================================================================
// COVER HISTORY PARSER
// ============================================================================

// Permanent rule:
//   1) Read the entire uploaded coverage history for comments/mapping.
//   2) Use the Positions section.
//   3) Count only positions whose CLOSE TIME is on the Summary report date.
//   4) Coverage P/L = Position Profit column ONLY.
//   5) Older rows are context only and never added to today's result.
function parseCoverageHistoryHTML(html, fileName = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bodyText = normalizeWhitespace(doc.body?.textContent || '');

  const accountMatch = bodyText.match(/Account:\s*(\d+)/i);
  const accountId = accountMatch ? accountMatch[1] : `file_${simpleHash(fileName || bodyText.slice(0, 200))}`;

  let section = '';
  const positions = [];
  const orderComments = {};

  doc.querySelectorAll('tr').forEach(row => {
    const cells = directCells(row);
    if (!cells.length) return;

    const rowText = normalizeWhitespace(cells.join(' '));

    if (rowText === 'Positions') {
      section = 'positions';
      return;
    }
    if (rowText === 'Orders') {
      section = 'orders';
      return;
    }
    if (rowText === 'Deals') {
      section = 'deals';
      return;
    }

    if (section === 'positions') {
      if (cells.length < 14) return;
      if (!/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(cells[0])) return;
      if (!/^\d+$/.test(cells[1])) return;

      positions.push({
        accountId,
        fileName,
        openTime: cells[0],
        positionId: cells[1],
        symbol: cells[2] || '',
        type: cells[3] || '',
        directComment: exactClientLogin(cells[4]),
        volume: parseCurrencyNumber(cells[5]),
        openPrice: parseCurrencyNumber(cells[6]),
        closeTime: cells[9] || '',
        closePrice: parseCurrencyNumber(cells[10]),
        profit: parseCurrencyNumber(cells[13]) // Profit only — no commission/swap
      });
      return;
    }

    if (section === 'orders') {
      if (cells.length < 2) return;
      if (!/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(cells[0])) return;
      if (!/^\d+$/.test(cells[1])) return;

      const login = exactClientLogin(cells[cells.length - 1]);
      if (login) orderComments[cells[1]] = login;
    }
  });

  if (!positions.length) {
    throw new Error(`No Positions section was found in ${fileName || 'the coverage history file'}.`);
  }

  // The Position ticket is normally the opening order ticket in MT5 hedge reports.
  // Use the opening order comment as a fallback when the hidden Position comment is blank.
  positions.forEach(position => {
    position.orderComment = orderComments[position.positionId] || '';
  });

  return { accountId, fileName, positions, orderComments };
}

function simpleHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// ============================================================================
// DAILY IMPORT ANALYSIS
// ============================================================================

async function analyzeDailyImport() {
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

  setImportStatus('Reading MT5 files…', 'working');

  try {
    const summaryHTML = await readMT5File(summaryFile);
    const summary = parseSummaryHTML(summaryHTML);

    const coverageReports = [];
    for (const file of coverageFiles) {
      const html = await readMT5File(file);
      coverageReports.push(parseCoverageHistoryHTML(html, file.name));
    }

    const reportDateDot = summary.reportDateDot;
    const reportDate = summary.reportDate;
    const persistentBranchMap = coverPositionMap[currentBranch] || {};

    const mappingUpdates = {};
    const matchedPositions = [];
    const unmatchedPositions = [];
    let ignoredHistoricalClosed = 0;
    let openPositions = 0;

    coverageReports.forEach(report => {
      const accountId = firebaseSafeKey(report.accountId);
      const persistentAccountMap = persistentBranchMap[accountId] || {};

      report.positions.forEach(position => {
        const directLogin = position.directComment || position.orderComment || '';
        const rememberedLogin = persistentAccountMap[firebaseSafeKey(position.positionId)] || '';
        const login = directLogin || rememberedLogin || '';

        // Learn mappings from the ENTIRE uploaded history, including older rows.
        if (directLogin) {
          if (!mappingUpdates[accountId]) mappingUpdates[accountId] = {};
          mappingUpdates[accountId][firebaseSafeKey(position.positionId)] = directLogin;
        }

        if (!position.closeTime) {
          openPositions += 1;
          return;
        }

        if (!position.closeTime.startsWith(reportDateDot)) {
          ignoredHistoricalClosed += 1;
          return;
        }

        const normalized = {
          ...position,
          accountId,
          login,
          recordKey: `${accountId}_${firebaseSafeKey(position.positionId)}`
        };

        if (login) matchedPositions.push(normalized);
        else unmatchedPositions.push(normalized);
      });
    });

    const summaryByLogin = {};
    summary.rows.forEach(row => {
      summaryByLogin[row.login] = {
        login: row.login,
        name: row.name || '',
        group: row.group || '',
        client: row.client
      };
    });

    pendingImport = {
      branch: currentBranch,
      reportDate,
      reportDateDot,
      summaryFileName: summaryFile.name,
      coverageFileNames: coverageFiles.map(file => file.name),
      summaryRawRows: summary.rawRows,
      summaryByLogin,
      coverageReports: coverageReports.map(report => ({
        accountId: report.accountId,
        fileName: report.fileName,
        positions: report.positions.length
      })),
      matchedPositions,
      unmatchedPositions,
      mappingUpdates,
      ignoredHistoricalClosed,
      openPositions
    };

    renderImportPreview();
    setImportStatus(`Detected ${formatISODate(reportDate)} automatically from the Summary.`, 'success');

    const saveButton = document.getElementById('save-daily-import-btn');
    if (saveButton) saveButton.disabled = false;
  } catch (err) {
    console.error('Import analysis failed:', err);
    pendingImport = null;
    setImportStatus(err.message || 'Could not analyze the files.', 'error');
    showToast(err.message || 'Could not analyze the files.', 'error');

    const preview = document.getElementById('import-preview');
    if (preview) preview.innerHTML = '';

    const saveButton = document.getElementById('save-daily-import-btn');
    if (saveButton) saveButton.disabled = true;
  } finally {
    if (analyzeButton) {
      analyzeButton.disabled = false;
      analyzeButton.textContent = 'Analyze Files';
    }
  }
}

function buildAccountsForPendingImport(includeManualMappings = false) {
  if (!pendingImport) return { accounts: {}, manualMappings: {}, unresolved: [] };

  const accounts = {};

  Object.values(pendingImport.summaryByLogin).forEach(row => {
    accounts[row.login] = {
      login: row.login,
      name: row.name || '',
      group: row.group || '',
      client: parseCurrencyNumber(row.client),
      coverage: 0
    };
  });

  pendingImport.matchedPositions.forEach(position => {
    addCoverageToAccount(accounts, position.login, position.profit);
  });

  const manualMappings = {};
  const unresolved = [];

  pendingImport.unmatchedPositions.forEach(position => {
    let login = '';

    if (includeManualMappings) {
      const input = document.querySelector(`.unmatched-login-input[data-record-key="${cssEscape(position.recordKey)}"]`);
      login = exactClientLogin(input?.value || '');
    }

    if (login) {
      addCoverageToAccount(accounts, login, position.profit);
      manualMappings[position.recordKey] = {
        accountId: position.accountId,
        positionId: position.positionId,
        login
      };
    } else {
      unresolved.push(position);
    }
  });

  // Store only accounts that matter for P/L: non-zero client or non-zero coverage.
  const compactAccounts = {};
  Object.values(accounts).forEach(account => {
    if (account.client === 0 && account.coverage === 0) return;
    compactAccounts[firebaseSafeKey(account.login)] = {
      login: account.login,
      name: account.name || '',
      group: account.group || '',
      client: roundMoney(account.client),
      coverage: roundMoney(account.coverage)
    };
  });

  return { accounts: compactAccounts, manualMappings, unresolved };
}

function addCoverageToAccount(accounts, login, profit) {
  if (!accounts[login]) {
    accounts[login] = {
      login,
      name: '',
      group: '',
      client: 0,
      coverage: 0
    };
  }
  accounts[login].coverage += parseCurrencyNumber(profit);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/(["'\\.#:[\]()])/g, '\\$1');
}

function renderImportPreview() {
  const preview = document.getElementById('import-preview');
  if (!preview || !pendingImport) return;

  const { accounts } = buildAccountsForPendingImport(false);
  const entries = Object.values(accounts).map(account => ({
    ...account,
    brokerNet: brokerNet(account.client, account.coverage)
  }));

  const { winners, losers } = rankEntries(entries, 3);
  const matchedProfit = roundMoney(pendingImport.matchedPositions.reduce((sum, x) => sum + x.profit, 0));
  const unmatchedProfit = roundMoney(pendingImport.unmatchedPositions.reduce((sum, x) => sum + x.profit, 0));
  const totalClosedToday = pendingImport.matchedPositions.length + pendingImport.unmatchedPositions.length;

  preview.innerHTML = `
    <div class="import-summary-grid">
      <div class="import-stat"><span>REPORT DATE</span><strong>${escapeHTML(formatISODate(pendingImport.reportDate))}</strong></div>
      <div class="import-stat"><span>SUMMARY ACCOUNTS</span><strong>${pendingImport.summaryRawRows.toLocaleString('en-US')}</strong></div>
      <div class="import-stat"><span>CLOSED COVER POSITIONS</span><strong>${totalClosedToday}</strong></div>
      <div class="import-stat"><span>MATCHED COVER PROFIT</span><strong class="${matchedProfit >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(matchedProfit)}</strong></div>
      <div class="import-stat"><span>UNMATCHED POSITIONS</span><strong class="${pendingImport.unmatchedPositions.length ? 'warning-text' : 'net-positive'}">${pendingImport.unmatchedPositions.length}</strong></div>
      <div class="import-stat"><span>OLDER CLOSED POSITIONS IGNORED</span><strong>${pendingImport.ignoredHistoricalClosed}</strong></div>
    </div>

    <div class="preview-grid">
      ${previewRankingCard('Daily Top 3 Winners', winners, 'winner')}
      ${previewRankingCard('Daily Top 3 Losers', losers, 'loser')}
    </div>

    ${pendingImport.unmatchedPositions.length ? renderUnmatchedPositions(pendingImport.unmatchedPositions, unmatchedProfit) : `
      <div class="match-ok">✓ Every position closed on ${escapeHTML(pendingImport.reportDate)} was matched to a client login.</div>
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
        </tr>`).join('')
    : '<tr><td colspan="4" class="muted" style="text-align:center;padding:16px;">No data</td></tr>';

  return `
    <div class="branch-card preview-card">
      <h3>${escapeHTML(title)}</h3>
      <div class="table-scroll">
        <table class="matrix-table">
          <thead><tr><th>RANK</th><th>LOGIN</th><th>CLIENT P/L</th><th>COVER PROFIT</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
}

function renderUnmatchedPositions(rows, totalProfit) {
  return `
    <div class="unmatched-card">
      <div class="unmatched-heading">
        <div>
          <strong>Unmatched Coverage Positions</strong>
          <p>Enter the client login only when you know it. Blank positions will be excluded from the saved coverage result.</p>
        </div>
        <span class="warning-pill">${rows.length} positions · ${formatCurrency(totalProfit)}</span>
      </div>
      <div class="table-scroll">
        <table class="matrix-table">
          <thead><tr><th>COVER ACCOUNT</th><th>POSITION</th><th>SYMBOL</th><th>CLOSE TIME</th><th>PROFIT</th><th>CLIENT LOGIN</th></tr></thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${escapeHTML(row.accountId)}</td>
                <td>${escapeHTML(row.positionId)}</td>
                <td>${escapeHTML(row.symbol)}</td>
                <td>${escapeHTML(row.closeTime)}</td>
                <td class="${row.profit >= 0 ? 'net-positive' : 'net-negative'}">${formatCurrency(row.profit)}</td>
                <td><input class="matrix-input unmatched-login-input" data-record-key="${escapeHTML(row.recordKey)}" placeholder="Client login"></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function saveDailyImport() {
  if (!pendingImport) {
    showToast('Analyze the files first.', 'error');
    return;
  }

  if (pendingImport.branch !== currentBranch) {
    showToast('Branch changed. Analyze the files again before saving.', 'error');
    return;
  }

  const { accounts, manualMappings, unresolved } = buildAccountsForPendingImport(true);
  const existing = dailyStore[currentBranch]?.[pendingImport.reportDate];

  if (unresolved.length) {
    const proceed = confirm(
      `${unresolved.length} coverage position(s) are still unmatched.\n\n` +
      `Their Profit will NOT be included in ${pendingImport.reportDate}.\n\n` +
      `Continue anyway?`
    );
    if (!proceed) return;
  }

  if (existing) {
    const replace = confirm(
      `${currentBranch.toUpperCase()} already has a saved daily import for ${pendingImport.reportDate}.\n\n` +
      `Saving now will REPLACE that day's imported client and coverage results.\n\nContinue?`
    );
    if (!replace) return;
  }

  const saveButton = document.getElementById('save-daily-import-btn');
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
  }

  const matchedPositions = pendingImport.matchedPositions.length + Object.keys(manualMappings).length;
  const matchedProfit = roundMoney(
    pendingImport.matchedPositions.reduce((sum, row) => sum + row.profit, 0) +
    Object.entries(manualMappings).reduce((sum, [recordKey]) => {
      const row = pendingImport.unmatchedPositions.find(x => x.recordKey === recordKey);
      return sum + (row ? row.profit : 0);
    }, 0)
  );

  const dailyPayload = {
    reportDate: pendingImport.reportDate,
    branch: currentBranch,
    importedAt: firebase.database.ServerValue.TIMESTAMP,
    summaryFile: pendingImport.summaryFileName,
    coverageFiles: pendingImport.coverageFileNames,
    accounts,
    stats: {
      summaryRows: pendingImport.summaryRawRows,
      storedAccounts: Object.keys(accounts).length,
      closedCoverPositions: pendingImport.matchedPositions.length + pendingImport.unmatchedPositions.length,
      matchedCoverPositions: matchedPositions,
      unmatchedCoverPositions: unresolved.length,
      matchedCoverProfit: matchedProfit,
      historicalClosedPositionsIgnored: pendingImport.ignoredHistoricalClosed
    }
  };

  const updates = {};
  updates[`pl_daily_store/${currentBranch}/${pendingImport.reportDate}`] = dailyPayload;

  // Persist every direct mapping learned from the full uploaded history.
  Object.entries(pendingImport.mappingUpdates).forEach(([accountId, positions]) => {
    Object.entries(positions).forEach(([positionId, login]) => {
      updates[`pl_cover_position_map/${currentBranch}/${accountId}/${positionId}`] = login;
    });
  });

  // Persist manual mappings too.
  Object.values(manualMappings).forEach(mapping => {
    updates[`pl_cover_position_map/${currentBranch}/${firebaseSafeKey(mapping.accountId)}/${firebaseSafeKey(mapping.positionId)}`] = mapping.login;
  });

  try {
    await db.ref().update(updates);
    showToast(`${currentBranch.toUpperCase()} ${pendingImport.reportDate} imported successfully.`);
    setImportStatus(`Saved ${formatISODate(pendingImport.reportDate)} as the daily source of truth.`, 'success');
    pendingImport = null;
    clearFileInputs();
    const preview = document.getElementById('import-preview');
    if (preview) preview.innerHTML = '';
    renderDailyImportStatus();
  } catch (err) {
    console.error('Daily import save failed:', err);
    showToast('Save failed. Nothing was replaced. Check Firebase and try again.', 'error');
  } finally {
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'Save Daily Report';
    }
  }
}

function resetImportUI(clearFiles = true) {
  pendingImport = null;
  if (clearFiles) clearFileInputs();

  const preview = document.getElementById('import-preview');
  if (preview) preview.innerHTML = '';

  const saveButton = document.getElementById('save-daily-import-btn');
  if (saveButton) saveButton.disabled = true;

  setImportStatus('Upload a one-day Summary and one or more Coverage History files. The report date is detected automatically.', 'neutral');
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

function renderDailyImportStatus() {
  const container = document.getElementById('existing-import-status');
  if (!container) return;

  const branchData = dailyStore[currentBranch] || {};
  const dates = Object.keys(branchData).sort().reverse();

  if (!dates.length) {
    container.innerHTML = '<span class="status-dot neutral"></span> No daily source-of-truth imports saved for this branch yet.';
    return;
  }

  const latestDate = dates[0];
  const latest = branchData[latestDate] || {};
  const storedAccounts = latest.stats?.storedAccounts ?? Object.keys(latest.accounts || {}).length;

  container.innerHTML = `
    <span class="status-dot good"></span>
    Latest saved day: <strong>${escapeHTML(formatISODate(latestDate))}</strong>
    <span class="status-separator">·</span>
    ${storedAccounts.toLocaleString('en-US')} P/L accounts stored
  `;
}

// ============================================================================
// MANUAL SHIFT TOP 3 — OPERATIONAL WORKFLOW
// This remains available, but it does NOT drive Executive weekly Top 5.
// ============================================================================

function renderMatrixTable() {
  const tbody = document.getElementById('matrix-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  const branchData = matrixStore[currentBranch] || {};

  days.forEach(day => {
    shifts.forEach(shift => {
      for (let rank = 1; rank <= 3; rank += 1) {
        const rowId = `${day}_${shift}_Winner_${rank}`;
        renderMatrixRow(tbody, day, shift, 'Winner', rank, rowId, branchData[rowId]);
      }
      for (let rank = 1; rank <= 3; rank += 1) {
        const rowId = `${day}_${shift}_Loser_${rank}`;
        renderMatrixRow(tbody, day, shift, 'Loser', rank, rowId, branchData[rowId]);
      }
    });
  });
}

function renderMatrixRow(tbody, day, shift, type, rank, rowId, rowData) {
  const row = rowData || { login: '', client: '', coverage: '' };
  const formattedClient = row.client !== '' && row.client !== undefined ? formatCurrency(row.client) : '';
  const formattedCoverage = row.coverage !== '' && row.coverage !== undefined ? formatCurrency(row.coverage) : '';
  const tagClass = type === 'Winner' ? 'tag-winner' : 'tag-loser';
  const shiftClass = shift === 'ON' ? 'shift-on' : shift === 'AM' ? 'shift-am' : 'shift-pm';

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><strong>${day}</strong></td>
    <td><span class="shift-badge ${shiftClass}">${shift}</span></td>
    <td><span class="${tagClass}">${type}</span></td>
    <td>#${rank}</td>
    <td>
      <input class="matrix-input" value="${escapeHTML(row.login || '')}"
        oninput="updateLocalAndScheduleSave('${rowId}', 'login', this.value)"
        onkeydown="handleEnterKey(event, this)" placeholder="Login ID" autocomplete="off">
    </td>
    <td>
      <input class="matrix-input num-input" value="${escapeHTML(formattedClient)}"
        onfocus="handleInputFocus(this)"
        onblur="handleInputBlur('${rowId}', 'client', this)"
        oninput="updateLocalAndScheduleSave('${rowId}', 'client', this.value)"
        onkeydown="handleEnterKey(event, this)" placeholder="$0" inputmode="decimal">
    </td>
    <td>
      <input class="matrix-input num-input" value="${escapeHTML(formattedCoverage)}"
        onfocus="handleInputFocus(this)"
        onblur="handleInputBlur('${rowId}', 'coverage', this)"
        oninput="updateLocalAndScheduleSave('${rowId}', 'coverage', this.value)"
        onkeydown="handleEnterKey(event, this)" placeholder="$0" inputmode="decimal">
    </td>
    <td><span class="pct-badge" id="pct_${rowId}">${calculatePercentage(row.client, row.coverage)}</span></td>`;

  tbody.appendChild(tr);
}

function handleInputFocus(input) {
  const raw = parseCurrencyNumber(input.value);
  input.value = input.value.trim() === '' ? '' : raw;
  input.style.textAlign = 'left';
  setTimeout(() => input.select(), 0);
}

function handleInputBlur(rowId, field, input) {
  const raw = parseCurrencyNumber(input.value);
  updateLocalAndScheduleSave(rowId, field, raw, true);
  input.value = input.value.trim() === '' ? '' : formatCurrency(raw);
  input.style.textAlign = 'right';

  const rowData = matrixStore[currentBranch]?.[rowId] || {};
  const pctCell = document.getElementById(`pct_${rowId}`);
  if (pctCell) pctCell.textContent = calculatePercentage(rowData.client, rowData.coverage);
}

function updateLocalAndScheduleSave(rowId, field, value, immediate = false) {
  // Capture branch NOW so delayed saves cannot move to another branch.
  const branchAtEdit = currentBranch;

  if (!matrixStore[branchAtEdit]) matrixStore[branchAtEdit] = {};
  if (!matrixStore[branchAtEdit][rowId]) {
    matrixStore[branchAtEdit][rowId] = { login: '', client: '', coverage: '' };
  }

  matrixStore[branchAtEdit][rowId][field] = value;

  if (field === 'client' || field === 'coverage') {
    const pctCell = document.getElementById(`pct_${rowId}`);
    if (pctCell) {
      const row = matrixStore[branchAtEdit][rowId];
      pctCell.textContent = calculatePercentage(row.client, row.coverage);
    }
  }

  const timerKey = `${branchAtEdit}_${rowId}_${field}`;
  if (saveDebounceTimers[timerKey]) clearTimeout(saveDebounceTimers[timerKey]);

  const saveValue = value;
  const push = () => {
    delete saveDebounceTimers[timerKey];
    return db.ref(`pl_matrix_store/${branchAtEdit}/${rowId}`).update({
      [field]: saveValue,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    }).catch(err => {
      console.error('Manual matrix save failed:', err);
      showToast('Manual entry save failed. Check the connection.', 'error');
    });
  };

  if (immediate) push();
  else saveDebounceTimers[timerKey] = setTimeout(push, 450);
}

function handleEnterKey(event, currentInput) {
  if (event.key !== 'Enter') return;
  event.preventDefault();

  const inputs = Array.from(document.querySelectorAll('#matrix-tbody input.matrix-input'));
  const index = inputs.indexOf(currentInput);
  if (index < 0) return;

  const target = inputs[index + (event.shiftKey ? -1 : 1)];
  if (!target) return;

  target.focus();
  if (typeof target.select === 'function') target.select();
}

// ============================================================================
// WEEKLY EXECUTIVE ENGINE — DAILY IMPORTS ONLY
// ============================================================================

function aggregateBranchWeek(branchData, dateKeys = getWeekDateKeys()) {
  const netByLogin = {};
  const allowedDates = new Set(dateKeys);

  Object.entries(branchData || {}).forEach(([dateKey, dayData]) => {
    if (!allowedDates.has(dateKey)) return;

    Object.values(dayData?.accounts || {}).forEach(account => {
      const login = String(account.login || '').trim();
      if (!login) return;

      if (!netByLogin[login]) {
        netByLogin[login] = {
          login,
          name: account.name || '',
          client: 0,
          coverage: 0,
          days: new Set()
        };
      }

      const target = netByLogin[login];
      target.client += parseCurrencyNumber(account.client);
      target.coverage += parseCurrencyNumber(account.coverage);
      target.days.add(dateKey);
      if (!target.name && account.name) target.name = account.name;
    });
  });

  return Object.values(netByLogin).map(row => ({
    login: row.login,
    name: row.name,
    client: roundMoney(row.client),
    coverage: roundMoney(row.coverage),
    brokerNet: roundMoney(brokerNet(row.client, row.coverage)),
    days: Array.from(row.days).sort(),
    occurrences: row.days.size
  }));
}

function rankEntries(entries, limit = 5) {
  return {
    winners: entries
      .filter(row => row.client > 0)
      .sort((a, b) => b.client - a.client)
      .slice(0, limit),
    losers: entries
      .filter(row => row.client < 0)
      .sort((a, b) => a.client - b.client)
      .slice(0, limit)
  };
}

function computeWeeklyBranch(branch, sourceDailyStore = dailyStore, dateKeys = getWeekDateKeys()) {
  const entries = aggregateBranchWeek(sourceDailyStore?.[branch] || {}, dateKeys);
  return { ...rankEntries(entries, 5), entries };
}

function computeCombinedWeekly(sourceDailyStore = dailyStore, dateKeys = getWeekDateKeys()) {
  const combined = {};

  allBranches.forEach(branch => {
    aggregateBranchWeek(sourceDailyStore?.[branch] || {}, dateKeys).forEach(row => {
      if (!combined[row.login]) {
        combined[row.login] = {
          login: row.login,
          name: row.name || '',
          client: 0,
          coverage: 0,
          days: new Set(),
          branches: new Set()
        };
      }

      const target = combined[row.login];
      target.client += row.client;
      target.coverage += row.coverage;
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
    brokerNet: roundMoney(brokerNet(row.client, row.coverage)),
    days: Array.from(row.days).sort(),
    occurrences: row.days.size,
    branches: Array.from(row.branches).sort()
  }));

  return { ...rankEntries(entries, 5), entries };
}

function renderManagementView() {
  updateWeekLabels();

  const dateKeys = getWeekDateKeys();
  const combined = computeCombinedWeekly(dailyStore, dateKeys);

  const combinedContainer = document.getElementById('combined-tables-container');
  if (combinedContainer) {
    combinedContainer.innerHTML =
      rankingCard('Top 5 Winners', combined.winners, 'winner', true) +
      rankingCard('Top 5 Losers', combined.losers, 'loser', true);
  }

  const container = document.getElementById('management-tables-container');
  if (!container) return;
  container.innerHTML = '';

  allBranches.forEach(branch => {
    const result = computeWeeklyBranch(branch, dailyStore, dateKeys);
    container.innerHTML += rankingCard(`${branch.toUpperCase()} — Top 5 Winners`, result.winners, 'winner', false);
    container.innerHTML += rankingCard(`${branch.toUpperCase()} — Top 5 Losers`, result.losers, 'loser', false);
  });

  renderExecutiveImportCoverage(dateKeys);
}

function renderExecutiveImportCoverage(dateKeys) {
  const note = document.getElementById('executive-source-status');
  if (!note) return;

  let importedBranchDays = 0;
  let branchesWithData = 0;

  allBranches.forEach(branch => {
    let branchHasData = false;
    dateKeys.forEach(date => {
      if (dailyStore?.[branch]?.[date]) {
        importedBranchDays += 1;
        branchHasData = true;
      }
    });
    if (branchHasData) branchesWithData += 1;
  });

  note.textContent = `${branchesWithData}/${allBranches.length} branches have imported data this week · ${importedBranchDays} branch-days saved`;
}

function rankingCard(title, rows, type, includeBranch) {
  return `
    <div class="branch-card">
      <h3>${escapeHTML(title)}</h3>
      <div class="table-scroll">
        <table class="matrix-table">
          <thead>
            <tr>
              <th>RANK</th>
              <th>LOGIN</th>
              ${includeBranch ? '<th>BRANCH</th>' : ''}
              <th>CLIENT P/L</th>
              <th>COVER PROFIT</th>
              <th>BROKER NET</th>
              <th>DAYS</th>
            </tr>
          </thead>
          <tbody>${renderRankingRows(rows, type, includeBranch)}</tbody>
        </table>
      </div>
    </div>`;
}

function renderRankingRows(rows, type, includeBranch) {
  if (!rows.length) {
    return `<tr><td colspan="${includeBranch ? 7 : 6}" class="muted" style="text-align:center;padding:18px;">No daily imports yet</td></tr>`;
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

function extractWeekDailyData(sourceDailyStore, dateKeys) {
  const result = {};

  allBranches.forEach(branch => {
    dateKeys.forEach(date => {
      const day = sourceDailyStore?.[branch]?.[date];
      if (!day) return;
      if (!result[branch]) result[branch] = {};
      result[branch][date] = JSON.parse(JSON.stringify(day));
    });
  });

  return result;
}

function archiveAndResetWeek() {
  const dateKeys = getWeekDateKeys();
  const snapshotDaily = extractWeekDailyData(dailyStore, dateKeys);
  const snapshotMatrix = JSON.parse(JSON.stringify(matrixStore || {}));

  const importedBranchDays = allBranches.reduce((sum, branch) => {
    return sum + dateKeys.filter(date => snapshotDaily?.[branch]?.[date]).length;
  }, 0);

  const manualRows = allBranches.reduce((sum, branch) => {
    return sum + Object.values(snapshotMatrix[branch] || {}).filter(row => row && row.login).length;
  }, 0);

  const weekLabel = getWeekLabel();
  const confirmed = confirm(
    `Archive trading week ${weekLabel}?\n\n` +
    `${importedBranchDays} imported branch-day reports will be archived.\n` +
    `${manualRows} manual shift rows will also be archived.\n\n` +
    `The persistent cover-position/client mapping will NOT be deleted.\n\nContinue?`
  );
  if (!confirmed) return;

  const archiveKey = Date.now().toString();
  const { monday, friday } = getWeekBounds();

  const archiveData = {
    archivedAt: new Date().toISOString(),
    weekLabel,
    weekStart: isoDateOnly(monday),
    weekEnd: isoDateOnly(friday),
    dailyData: snapshotDaily,
    matrix: snapshotMatrix
  };

  const updates = {
    [`pl_history/${archiveKey}`]: archiveData,
    pl_matrix_store: null
  };

  // Delete only this week's imported daily reports. Keep other dates and mapping history.
  allBranches.forEach(branch => {
    dateKeys.forEach(date => {
      if (snapshotDaily?.[branch]?.[date]) updates[`pl_daily_store/${branch}/${date}`] = null;
    });
  });

  db.ref().update(updates)
    .then(() => showToast('Week archived. Persistent coverage mappings were kept.'))
    .catch(err => {
      console.error('Archive failed:', err);
      showToast('Archive failed. Nothing was reset.', 'error');
    });
}

function formatArchiveDate(value) {
  const date = new Date(value);
  return `${date.toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
  })} · ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
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
  if (!container) return;

  const entry = archiveStore[key];
  if (!entry) {
    container.innerHTML = '';
    return;
  }

  const title = entry.weekLabel || formatArchiveDate(entry.archivedAt || Number(key));
  let html = `<h2 class="archive-detail-title">Week: ${escapeHTML(title)}</h2><div class="dashboard-grid">`;

  if (entry.dailyData) {
    const dateKeys = Object.values(entry.dailyData)
      .flatMap(branch => Object.keys(branch || {}));
    const uniqueDateKeys = [...new Set(dateKeys)].sort();

    allBranches.forEach(branch => {
      const result = computeWeeklyBranch(branch, entry.dailyData, uniqueDateKeys);
      html += rankingCard(`${branch.toUpperCase()} — Top 5 Winners`, result.winners, 'winner', false);
      html += rankingCard(`${branch.toUpperCase()} — Top 5 Losers`, result.losers, 'loser', false);
    });
  } else if (entry.matrix) {
    // Legacy archive support — old manual Top 3 based archives.
    allBranches.forEach(branch => {
      const legacyEntries = aggregateLegacyMatrix(entry.matrix[branch] || {});
      const ranked = rankEntries(legacyEntries, 5);
      html += rankingCard(`${branch.toUpperCase()} — Legacy Top 5 Winners`, ranked.winners, 'winner', false);
      html += rankingCard(`${branch.toUpperCase()} — Legacy Top 5 Losers`, ranked.losers, 'loser', false);
    });
  } else if (entry.branches) {
    allBranches.forEach(branch => {
      const legacy = entry.branches[branch] || { winners: [], losers: [] };
      const winners = (legacy.winners || []).map(x => ({
        ...x,
        brokerNet: brokerNet(x.client, x.coverage),
        occurrences: x.occurrences || 1
      }));
      const losers = (legacy.losers || []).map(x => ({
        ...x,
        brokerNet: brokerNet(x.client, x.coverage),
        occurrences: x.occurrences || 1
      }));
      html += rankingCard(`${branch.toUpperCase()} — Legacy Top 5 Winners`, winners, 'winner', false);
      html += rankingCard(`${branch.toUpperCase()} — Legacy Top 5 Losers`, losers, 'loser', false);
    });
  }

  html += '</div>';
  container.innerHTML = html;
}

function aggregateLegacyMatrix(branchData) {
  const byLogin = {};

  Object.values(branchData || {}).forEach(row => {
    const login = String(row?.login || '').trim();
    if (!login) return;

    if (!byLogin[login]) byLogin[login] = { login, client: 0, coverage: 0, occurrences: 0 };
    byLogin[login].client += parseCurrencyNumber(row.client);
    byLogin[login].coverage += parseCurrencyNumber(row.coverage);
    byLogin[login].occurrences += 1;
  });

  return Object.values(byLogin).map(row => ({
    ...row,
    client: roundMoney(row.client),
    coverage: roundMoney(row.coverage),
    brokerNet: roundMoney(brokerNet(row.client, row.coverage))
  }));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initApp() {
  updateWeekLabels();

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
