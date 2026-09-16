// ============================================================================
// P/L SYSTEM — Weekly Import Edition
// One import per branch, every Friday after market close.
// Client P/L: MT5 weekly Summary -> Profit column.
// Coverage P/L: Trade History -> OUT deals inside detected week -> Profit only.
// ============================================================================

// IMPORTANT: replace YOUR_FIREBASE_API_KEY with the real key from your live site.
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

// ============================================================================
// STATE
// ============================================================================

let currentBranch = 'awada';
let weeklyStore = {};
let coverPositionMap = {};
let pendingImport = null;
let selectedBranchWeekKey = null;
let selectedExecutiveWeekKey = null;
let selectedArchiveWeekKey = null;
let toastTimer = null;

// ============================================================================
// FIREBASE LIVE DATA
// ============================================================================

db.ref('pl_weekly_store').on('value', snapshot => {
  weeklyStore = snapshot.val() || {};

  const activePanel = document.querySelector('.view-panel.active');

  if (activePanel?.id === 'view-branch') {
    renderBranchWeekLedger();
    renderExistingWeekStatus();

    if (selectedBranchWeekKey) {
      renderBranchWeekDetail(selectedBranchWeekKey);
    }
  }

  if (activePanel?.id === 'view-group5') {
    renderManagementView();
  }

  if (activePanel?.id === 'view-archive') {
    renderArchiveView();
  }
});

db.ref('pl_cover_position_map').on('value', snapshot => {
  coverPositionMap = snapshot.val() || {};
});

// ============================================================================
// NAVIGATION
// ============================================================================

function applySidebarLock(allowedTabs) {
  const isGroup5 = allowedTabs.includes('group5');

  document.querySelectorAll('.nav-item').forEach(btn => {
    const onclickAttr = btn.getAttribute('onclick') || '';
    const isAllowed = allowedTabs.some(tab =>
      onclickAttr.includes(`'${tab}'`)
    );

    btn.style.setProperty(
      'display',
      isAllowed ? 'flex' : 'none',
      'important'
    );
  });

  document.querySelectorAll('.nav-section').forEach(sec => {
    if (isGroup5) {
      sec.style.setProperty('display', 'block', 'important');
      return;
    }

    let visible = false;
    let next = sec.nextElementSibling;

    while (next && !next.classList.contains('nav-section')) {
      if (
        next.classList.contains('nav-item') &&
        next.style.display !== 'none'
      ) {
        visible = true;
        break;
      }

      next = next.nextElementSibling;
    }

    sec.style.setProperty(
      'display',
      visible ? 'block' : 'none',
      'important'
    );
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

  const activeParam = (
    urlParams.get('branch') || 'group5'
  ).toLowerCase();

  const allowedTabs =
    branchGroups[activeParam] || [activeParam];

  if (
    !allowedTabs.includes(tabKey) &&
    activeParam !== 'group5'
  ) {
    tabKey = activeParam;
  }

  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.remove('active');
    panel.style.display = 'none';
  });

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.remove('active');

    const onclickAttr = btn.getAttribute('onclick') || '';

    if (onclickAttr.includes(`'${tabKey}'`)) {
      btn.classList.add('active');
    }
  });

  if (tabKey === 'group5') {
    showPanel('view-group5');
    renderManagementView();
  }

  else if (tabKey === 'archive') {
    showPanel('view-archive');
    renderArchiveView();
  }

  else {
    currentBranch = tabKey;
    pendingImport = null;
    selectedBranchWeekKey = null;

    showPanel('view-branch');

    const title =
      document.getElementById('branch-title');

    if (title) {
      title.textContent =
        `${tabKey.toUpperCase()} — Weekly Import`;
    }

    resetImportUI(false);
    renderBranchWeekLedger();
    renderExistingWeekStatus();
  }

  window.scrollTo(0, 0);
}

// ============================================================================
// BASIC UTILITIES
// ============================================================================

function parseCurrencyNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return 0;
  }

  const clean = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '')
    .replace(/,/g, '')
    .replace(/[^0-9.+-]/g, '');

  return Number.parseFloat(clean) || 0;
}

function roundMoney(value) {
  return Math.round(
    (Number(value || 0) + Number.EPSILON) * 100
  ) / 100;
}

function formatCurrency(value) {
  const num = parseCurrencyNumber(value);

  const sign = num < 0 ? '-' : '';

  return `${sign}$${Math.abs(num).toLocaleString(
    'en-US',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  )}`;
}

function brokerNet(client, coverage) {
  return roundMoney(
    parseCurrencyNumber(coverage) -
    parseCurrencyNumber(client)
  );
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
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function exactClientLogin(value) {
  const clean =
    normalizeWhitespace(value);

  return /^\d{3,12}$/.test(clean)
    ? clean
    : '';
}

function firebaseSafeKey(value) {
  return String(value ?? '')
    .replace(/[.#$\[\]\/]/g, '_');
}

function dotDateToISO(dotDate) {
  return String(dotDate || '')
    .replace(/\./g, '-');
}

function isoToDotDate(isoDate) {
  return String(isoDate || '')
    .replace(/-/g, '.');
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
  return JSON.parse(
    JSON.stringify(value || {})
  );
}

function showToast(
  message,
  type = 'normal'
) {
  const toast =
    document.getElementById('toast');

  if (!toast) return;

  clearTimeout(toastTimer);

  toast.textContent = message;

  toast.classList.toggle(
    'error',
    type === 'error'
  );

  toast.classList.add('show');

  toastTimer = setTimeout(
    () => toast.classList.remove('show'),
    3600
  );
}

function setImportStatus(
  message,
  type = 'neutral'
) {
  const el =
    document.getElementById('import-status');

  if (!el) return;

  el.textContent = message;
  el.className = `import-status ${type}`;
}

// ============================================================================
// DATE / WEEK UTILITIES
// ============================================================================

function isoToDate(isoDate) {
  const [y, m, d] =
    String(isoDate)
      .split('-')
      .map(Number);

  return new Date(
    y,
    m - 1,
    d,
    12,
    0,
    0,
    0
  );
}

function daysBetween(
  startISO,
  endISO
) {
  return Math.round(
    (
      isoToDate(endISO) -
      isoToDate(startISO)
    ) / 86400000
  );
}

function formatISODate(
  isoDate,
  withWeekday = true
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      String(isoDate)
    )
  ) {
    return String(isoDate || '');
  }

  return isoToDate(
    isoDate
  ).toLocaleDateString(
    'en-US',
    {
      ...(withWeekday
        ? { weekday: 'short' }
        : {}),
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }
  );
}

function formatWeekLabel(
  startISO,
  endISO
) {
  const start =
    isoToDate(startISO);

  const end =
    isoToDate(endISO);

  const sameYear =
    start.getFullYear() ===
    end.getFullYear();

  const startText =
    start.toLocaleDateString(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        ...(sameYear
          ? {}
          : { year: 'numeric' })
      }
    );

  const endText =
    end.toLocaleDateString(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }
    );

  return `${startText} – ${endText}`;
}

function makeWeekKey(
  startISO,
  endISO
) {
  return `${startISO}_${endISO}`;
}

function validateTradingWeek(
  startISO,
  endISO
) {
  const start =
    isoToDate(startISO);

  const end =
    isoToDate(endISO);

  const diff =
    daysBetween(
      startISO,
      endISO
    );

  if (end < start) {
    throw new Error(
      'The Summary end date is before the start date.'
    );
  }

  if (
    start.getDay() !== 1 ||
    end.getDay() !== 5 ||
    diff !== 4
  ) {
    throw new Error(
      `Weekly Summary must be exported Monday → Friday. Detected ${startISO} → ${endISO}.`
    );
  }
}

function timestampInWeek(
  value,
  startDot,
  endDot
) {
  const match =
    String(value || '').match(
      /^(\d{4}\.\d{2}\.\d{2})\s+\d{2}:\d{2}:\d{2}$/
    );

  if (!match) return false;

  const dateDot = match[1];

  return (
    dateDot >= startDot &&
    dateDot <= endDot
  );
}

function formatSavedAt(value) {
  if (!value) return '—';

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return String(value);
  }

  return `${
    d.toLocaleDateString(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }
    )
  } · ${
    d.toLocaleTimeString(
      'en-US',
      {
        hour: '2-digit',
        minute: '2-digit'
      }
    )
  }`;
}

// ============================================================================
// FILE READING — MT5 UTF-16 SAFE
// ============================================================================

async function readMT5File(file) {
  const buffer =
    await file.arrayBuffer();

  const bytes =
    new Uint8Array(buffer);

  let encoding = 'utf-8';
  let offset = 0;

  if (
    bytes.length >= 2 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xfe
  ) {
    encoding = 'utf-16le';
    offset = 2;
  }

  else if (
    bytes.length >= 2 &&
    bytes[0] === 0xfe &&
    bytes[1] === 0xff
  ) {
    encoding = 'utf-16be';
    offset = 2;
  }

  else if (
    bytes.length >= 4 &&
    bytes[1] === 0x00 &&
    bytes[3] === 0x00
  ) {
    encoding = 'utf-16le';
  }

  try {
    return new TextDecoder(
      encoding
    ).decode(
      bytes.subarray(offset)
    );
  }

  catch (err) {
    console.warn(
      `TextDecoder(${encoding}) failed; falling back to utf-8`,
      err
    );

    return new TextDecoder(
      'utf-8'
    ).decode(bytes);
  }
}

function directCells(row) {
  return Array.from(
    row.children
  )
    .filter(
      el =>
        el.tagName === 'TD' ||
        el.tagName === 'TH'
    )
    .map(
      el =>
        normalizeWhitespace(
          el.textContent
        )
    );
}

// ============================================================================
// WEEKLY SUMMARY PARSER
// ============================================================================

function parseWeeklySummaryHTML(html) {
  const doc =
    new DOMParser()
      .parseFromString(
        html,
        'text/html'
      );

  const bodyText =
    normalizeWhitespace(
      doc.body?.textContent || ''
    );

  const dateMatch =
    bodyText.match(
      /from\s+'(\d{4}\.\d{2}\.\d{2})'\s+to\s+'(\d{4}\.\d{2}\.\d{2})'/i
    );

  if (!dateMatch) {
    throw new Error(
      'Could not detect the date range from the Summary file.'
    );
  }

  const weekStartDot =
    dateMatch[1];

  const weekEndDot =
    dateMatch[2];

  const weekStart =
    dotDateToISO(
      weekStartDot
    );

  const weekEnd =
    dotDateToISO(
      weekEndDot
    );

  validateTradingWeek(
    weekStart,
    weekEnd
  );

  let headerIndexes = null;

  const rows =
    Array.from(
      doc.querySelectorAll('tr')
    );

  for (const row of rows) {
    const cells =
      directCells(row);

    const normalized =
      cells.map(
        v => v.toLowerCase()
      );

    const loginIndex =
      normalized.indexOf(
        'login'
      );

    const profitIndex =
      normalized.indexOf(
        'profit'
      );

    if (
      loginIndex !== -1 &&
      profitIndex !== -1
    ) {
      headerIndexes = {
        login: loginIndex,
        name:
          normalized.indexOf(
            'name'
          ),
        group:
          normalized.indexOf(
            'group'
          ),
        profit:
          profitIndex
      };

      break;
    }
  }

  if (!headerIndexes) {
    throw new Error(
      'Could not locate Login and Profit columns in the Summary file.'
    );
  }

  const byLogin = {};
  let rawRows = 0;

  rows.forEach(row => {
    const cells =
      directCells(row);

    if (
      cells.length <=
      headerIndexes.profit
    ) {
      return;
    }

    const login =
      exactClientLogin(
        cells[
          headerIndexes.login
        ]
      );

    if (!login) return;

    const name =
      headerIndexes.name >= 0
        ? (
          cells[
            headerIndexes.name
          ] || ''
        )
        : '';

    const group =
      headerIndexes.group >= 0
        ? (
          cells[
            headerIndexes.group
          ] || ''
        )
        : '';

    const profit =
      parseCurrencyNumber(
        cells[
          headerIndexes.profit
        ]
      );

    rawRows += 1;

    if (!byLogin[login]) {
      byLogin[login] = {
        login,
        name,
        group,
        client: 0
      };
    }

    byLogin[login].client =
      roundMoney(
        byLogin[login].client +
        profit
      );

    if (
      !byLogin[login].name &&
      name
    ) {
      byLogin[login].name =
        name;
    }

    if (
      !byLogin[login].group &&
      group
    ) {
      byLogin[login].group =
        group;
    }
  });

  const clientRows =
    Object.values(
      byLogin
    );

  if (!clientRows.length) {
    throw new Error(
      'No client rows were found in the Summary file.'
    );
  }

  return {
    weekStartDot,
    weekEndDot,
    weekStart,
    weekEnd,
    weekKey:
      makeWeekKey(
        weekStart,
        weekEnd
      ),
    weekLabel:
      formatWeekLabel(
        weekStart,
        weekEnd
      ),
    rawRows,
    clientRows
  };
}

// ============================================================================
// COVERAGE HISTORY PARSER
// ============================================================================

function parseCoverageHistoryHTML(
  html,
  fileName = ''
) {
  const doc =
    new DOMParser()
      .parseFromString(
        html,
        'text/html'
      );

  const bodyText =
    normalizeWhitespace(
      doc.body?.textContent || ''
    );

  const accountMatch =
    bodyText.match(
      /Account:\s*(\d+)/i
    );

  const accountId =
    accountMatch
      ? accountMatch[1]
      : `file_${simpleHash(
          fileName ||
          bodyText.slice(0, 300)
        )}`;

  let section = '';

  const positions = [];
  const orders = {};
  const deals = [];

  doc.querySelectorAll('tr')
    .forEach(row => {
      const cells =
        directCells(row);

      if (!cells.length) return;

      const rowText =
        normalizeWhitespace(
          cells.join(' ')
        );

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

      if (
        section === 'positions'
      ) {
        if (cells.length < 14) {
          return;
        }

        if (
          !/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/
            .test(cells[0])
        ) {
          return;
        }

        if (
          !/^\d+$/.test(
            cells[1]
          )
        ) {
          return;
        }

        positions.push({
          accountId,
          positionId: cells[1],
          openTime: cells[0],
          symbol: cells[2] || '',
          type:
            (
              cells[3] || ''
            ).toLowerCase(),

          directComment:
            exactClientLogin(
              cells[4]
            ),

          volume:
            parseCurrencyNumber(
              cells[5]
            ),

          openPrice:
            parseCurrencyNumber(
              cells[6]
            ),

          closeTime:
            cells[9] || '',

          closePrice:
            parseCurrencyNumber(
              cells[10]
            ),

          profit:
            parseCurrencyNumber(
              cells[13]
            )
        });

        return;
      }

      if (
        section === 'orders'
      ) {
        if (
          cells.length < 2
        ) {
          return;
        }

        if (
          !/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/
            .test(cells[0])
        ) {
          return;
        }

        if (
          !/^\d+$/.test(
            cells[1]
          )
        ) {
          return;
        }

        orders[cells[1]] = {
          orderId:
            cells[1],

          time:
            cells[0],

          symbol:
            cells[2] || '',

          type:
            (
              cells[3] || ''
            ).toLowerCase(),

          volumeText:
            cells[4] || '',

          comment:
            exactClientLogin(
              cells[
                cells.length - 1
              ]
            )
        };

        return;
      }

      if (
        section === 'deals'
      ) {
        if (
          cells.length < 15
        ) {
          return;
        }

        if (
          !/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/
            .test(cells[0])
        ) {
          return;
        }

        if (
          !/^\d+$/.test(
            cells[1]
          )
        ) {
          return;
        }

        deals.push({
          accountId,
          sourceFile: fileName,
          dealId:
            cells[1],

          time:
            cells[0],

          symbol:
            cells[2] || '',

          type:
            (
              cells[3] || ''
            ).toLowerCase(),

          direction:
            (
              cells[4] || ''
            ).toLowerCase(),

          volume:
            parseCurrencyNumber(
              cells[5]
            ),

          price:
            parseCurrencyNumber(
              cells[6]
            ),

          orderId:
            cells[7] || '',

          profit:
            parseCurrencyNumber(
              cells[12]
            ),

          comment:
            exactClientLogin(
              cells[14]
            )
        });
      }
    });

  if (!deals.length) {
    throw new Error(
      `No Deals section was found in ${
        fileName ||
        'the Coverage History file'
      }.`
    );
  }

  return {
    accountId,
    fileName,
    positions,
    orders,
    deals
  };
}

function positionLogin(
  position,
  report,
  workingAccountMap
) {
  return (
    position.directComment ||
    report.orders[
      position.positionId
    ]?.comment ||
    workingAccountMap?.[
      firebaseSafeKey(
        position.positionId
      )
    ] ||
    ''
  );
}

function oppositePositionType(
  dealType
) {
  if (dealType === 'buy') {
    return 'sell';
  }

  if (dealType === 'sell') {
    return 'buy';
  }

  return '';
}

function resolveDealLogin(
  deal,
  report,
  workingAccountMap
) {
  if (deal.comment) {
    return {
      login: deal.comment,
      method: 'deal-comment'
    };
  }

  const orderComment =
    report.orders[
      deal.orderId
    ]?.comment || '';

  if (orderComment) {
    return {
      login: orderComment,
      method: 'order-comment'
    };
  }

  let candidates =
    report.positions.filter(
      position =>
        position.closeTime ===
          deal.time &&
        position.symbol ===
          deal.symbol
    );

  if (
    candidates.length > 1
  ) {
    const expectedType =
      oppositePositionType(
        deal.type
      );

    const byTypeVolume =
      candidates.filter(
        position =>
          position.type ===
            expectedType &&
          Math.abs(
            position.volume -
            deal.volume
          ) < 0.0000001
      );

    if (
      byTypeVolume.length
    ) {
      candidates =
        byTypeVolume;
    }
  }

  if (
    candidates.length > 1
  ) {
    const byPrice =
      candidates.filter(
        position =>
          Math.abs(
            position.closePrice -
            deal.price
          ) < 0.000001
      );

    if (byPrice.length) {
      candidates =
        byPrice;
    }
  }

  if (
    candidates.length === 1
  ) {
    const login =
      positionLogin(
        candidates[0],
        report,
        workingAccountMap
      );

    if (login) {
      return {
        login,
        method:
          'position-close-match',

        positionId:
          candidates[0]
            .positionId
      };
    }
  }

  return {
    login: '',
    method: 'unmatched',
    positionId: ''
  };
}

// ============================================================================
// WEEKLY IMPORT ANALYSIS
// ============================================================================

function buildWeeklyAccounts(
  clientRows,
  coverageByLogin
) {
  const result = {};

  clientRows.forEach(row => {
    result[row.login] = {
      login: row.login,
      name: row.name || '',
      group: row.group || '',
      client:
        roundMoney(
          row.client
        ),
      coverage: 0,
      brokerNet: 0
    };
  });

  Object.entries(
    coverageByLogin || {}
  ).forEach(
    ([login, coverage]) => {
      if (!result[login]) {
        result[login] = {
          login,
          name: '',
          group: '',
          client: 0,
          coverage: 0,
          brokerNet: 0
        };
      }

      result[login].coverage =
        roundMoney(
          coverage
        );
    }
  );

  Object.values(
    result
  ).forEach(row => {
    row.coverage =
      roundMoney(
        row.coverage || 0
      );

    row.brokerNet =
      brokerNet(
        row.client,
        row.coverage
      );
  });

  return result;
}

function rankEntries(
  entries,
  limit = 5
) {
  const clean =
    (entries || [])
      .filter(
        row =>
          row &&
          row.login
      );

  const winners =
    clean
      .filter(
        row =>
          row.client > 0
      )
      .sort(
        (a, b) =>
          b.client -
            a.client ||
          String(a.login)
            .localeCompare(
              String(b.login)
            )
      )
      .slice(
        0,
        limit
      );

  const losers =
    clean
      .filter(
        row =>
          row.client < 0
      )
      .sort(
        (a, b) =>
          a.client -
            b.client ||
          String(a.login)
            .localeCompare(
              String(b.login)
            )
      )
      .slice(
        0,
        limit
      );

  return {
    winners,
    losers
  };
}

async function analyzeWeeklyImport() {
  const summaryFile =
    document.getElementById(
      'summary-file'
    )?.files?.[0];

  const coverageFiles =
    Array.from(
      document.getElementById(
        'coverage-files'
      )?.files || []
    );

  const analyzeButton =
    document.getElementById(
      'analyze-import-btn'
    );

  if (!summaryFile) {
    showToast(
      'Choose the weekly MT5 Summary HTML first.',
      'error'
    );

    return;
  }

  if (!coverageFiles.length) {
    showToast(
      'Choose at least one Coverage History HTML file.',
      'error'
    );

    return;
  }

  if (analyzeButton) {
    analyzeButton.disabled = true;
    analyzeButton.textContent =
      'Analyzing…';
  }

  setImportStatus(
    'Reading weekly Summary and Coverage History…',
    'working'
  );

  try {
    const summaryHTML =
      await readMT5File(
        summaryFile
      );

    const summary =
      parseWeeklySummaryHTML(
        summaryHTML
      );

    const coverageReports = [];

    for (
      const file of
      coverageFiles
    ) {
      const html =
        await readMT5File(
          file
        );

      coverageReports.push(
        parseCoverageHistoryHTML(
          html,
          file.name
        )
      );
    }

    const mapSnapshot =
      await db.ref(
        `pl_cover_position_map/${currentBranch}`
      ).once('value');

    const liveCoverMapForBranch =
      mapSnapshot.val() || {};

    const mappingUpdates = {};

    coverageReports.forEach(
      report => {
        const accountKey =
          firebaseSafeKey(
            report.accountId
          );

        const persistentAccountMap =
          liveCoverMapForBranch?.[
            accountKey
          ] || {};

        report.positions.forEach(
          position => {
            const login =
              position.directComment ||
              report.orders[
                position.positionId
              ]?.comment ||
              persistentAccountMap?.[
                firebaseSafeKey(
                  position.positionId
                )
              ] ||
              '';

            if (!login) return;

            if (
              !mappingUpdates[
                accountKey
              ]
            ) {
              mappingUpdates[
                accountKey
              ] = {};
            }

            mappingUpdates[
              accountKey
            ][
              firebaseSafeKey(
                position.positionId
              )
            ] = login;
          }
        );
      }
    );

    const coverageByLogin = {};
    const matchedDeals = [];
    const unmatchedDeals = [];
    const seenDeals = new Set();

    let historicalOutDealsIgnored = 0;
    let allOutDealsSeen = 0;

    coverageReports.forEach(
      report => {
        const accountKey =
          firebaseSafeKey(
            report.accountId
          );

        const persistentAccountMap =
          liveCoverMapForBranch?.[
            accountKey
          ] || {};

        const workingAccountMap = {
          ...persistentAccountMap,
          ...(
            mappingUpdates[
              accountKey
            ] || {}
          )
        };

        report.deals.forEach(
          deal => {
            if (
              deal.direction !==
              'out'
            ) {
              return;
            }

            allOutDealsSeen += 1;

            const uniqueDealKey =
              `${accountKey}_${
                firebaseSafeKey(
                  deal.dealId
                )
              }`;

            if (
              seenDeals.has(
                uniqueDealKey
              )
            ) {
              return;
            }

            seenDeals.add(
              uniqueDealKey
            );

            if (
              !timestampInWeek(
                deal.time,
                summary.weekStartDot,
                summary.weekEndDot
              )
            ) {
              historicalOutDealsIgnored += 1;
              return;
            }

            const resolution =
              resolveDealLogin(
                deal,
                report,
                workingAccountMap
              );

            const normalized = {
              accountId:
                accountKey,

              sourceFile:
                deal.sourceFile ||
                report.fileName ||
                '',

              recordKey:
                uniqueDealKey,

              dealId:
                deal.dealId,

              time:
                deal.time,

              symbol:
                deal.symbol,

              type:
                deal.type,

              direction:
                deal.direction,

              volume:
                deal.volume,

              price:
                deal.price,

              orderId:
                deal.orderId,

              profit:
                roundMoney(
                  deal.profit
                ),

              login:
                resolution.login ||
                '',

              matchMethod:
                resolution.method,

              positionId:
                resolution.positionId ||
                ''
            };

            if (
              resolution.login
            ) {
              matchedDeals.push(
                normalized
              );

              coverageByLogin[
                resolution.login
              ] = roundMoney(
                (
                  coverageByLogin[
                    resolution.login
                  ] || 0
                ) +
                normalized.profit
              );
            }

            else {
              unmatchedDeals.push(
                normalized
              );
            }
          }
        );
      }
    );

    const accounts =
      buildWeeklyAccounts(
        summary.clientRows,
        coverageByLogin
      );

    const accountRows =
      Object.values(
        accounts
      );

    const {
      winners,
      losers
    } =
      rankEntries(
        accountRows,
        5
      );

    const clientTotal =
      roundMoney(
        accountRows.reduce(
          (sum, row) =>
            sum + row.client,
          0
        )
      );

    const coverageTotal =
      roundMoney(
        accountRows.reduce(
          (sum, row) =>
            sum + row.coverage,
          0
        )
      );

    const brokerTotal =
      roundMoney(
        accountRows.reduce(
          (sum, row) =>
            sum +
            row.brokerNet,
          0
        )
      );

    const matchedCoverageProfit =
      roundMoney(
        matchedDeals.reduce(
          (sum, row) =>
            sum + row.profit,
          0
        )
      );

    const unmatchedCoverageProfit =
      roundMoney(
        unmatchedDeals.reduce(
          (sum, row) =>
            sum + row.profit,
          0
        )
      );

    pendingImport = {
      version: 3,
      branch:
        currentBranch,

      weekKey:
        summary.weekKey,

      weekStart:
        summary.weekStart,

      weekEnd:
        summary.weekEnd,

      weekStartDot:
        summary.weekStartDot,

      weekEndDot:
        summary.weekEndDot,

      weekLabel:
        summary.weekLabel,

      summaryFileName:
        summaryFile.name,

      coverageFileNames:
        coverageFiles.map(
          file =>
            file.name
        ),

      summaryRawRows:
        summary.rawRows,

      summaryClientCount:
        summary.clientRows.length,

      accounts,
      coverageByLogin,
      matchedDeals,
      unmatchedDeals,
      mappingUpdates,
      historicalOutDealsIgnored,
      allOutDealsSeen,
      winners,
      losers,

      stats: {
        accountCount:
          accountRows.length,

        clientTotal,
        coverageTotal,
        brokerTotal,

        matchedCoverDeals:
          matchedDeals.length,

        unmatchedCoverDeals:
          unmatchedDeals.length,

        matchedCoverageProfit,
        unmatchedCoverageProfit,
        historicalOutDealsIgnored
      }
    };

    renderImportPreview();
    renderExistingWeekStatus();

    setImportStatus(
      `${summary.weekLabel} detected · ${summary.clientRows.length} client accounts · ${matchedDeals.length} matched cover closes${
        unmatchedDeals.length
          ? ` · ${unmatchedDeals.length} unmatched`
          : ''
      }.`,
      unmatchedDeals.length
        ? 'warning'
        : 'success'
    );

    const saveButton =
      document.getElementById(
        'save-week-import-btn'
      );

    if (saveButton) {
      saveButton.disabled =
        false;
    }
  }

  catch (err) {
    console.error(
      'Weekly import analysis failed:',
      err
    );

    pendingImport = null;

    const preview =
      document.getElementById(
        'import-preview'
      );

    if (preview) {
      preview.innerHTML = '';
    }

    const saveButton =
      document.getElementById(
        'save-week-import-btn'
      );

    if (saveButton) {
      saveButton.disabled = true;
    }

    setImportStatus(
      err.message ||
      'Could not analyze the files.',
      'error'
    );

    showToast(
      err.message ||
      'Could not analyze the files.',
      'error'
    );

    renderExistingWeekStatus();
  }

  finally {
    if (analyzeButton) {
      analyzeButton.disabled =
        false;

      analyzeButton.textContent =
        'Analyze Week';
    }
  }
}

// ============================================================================
// IMPORT PREVIEW
// ============================================================================

function renderImportPreview() {
  const preview =
    document.getElementById(
      'import-preview'
    );

  if (
    !preview ||
    !pendingImport
  ) {
    return;
  }

  const stats =
    pendingImport.stats;

  preview.innerHTML = `
    <div class="import-summary-grid">

      <div class="import-stat">
        <span>DETECTED WEEK</span>
        <strong>
          ${escapeHTML(
            pendingImport.weekLabel
          )}
        </strong>
      </div>

      <div class="import-stat">
        <span>CLIENT ACCOUNTS</span>
        <strong>
          ${stats.accountCount}
        </strong>
      </div>

      <div class="import-stat">
        <span>CLIENT P/L</span>
        <strong class="${
          stats.clientTotal >= 0
            ? 'net-positive'
            : 'net-negative'
        }">
          ${formatCurrency(
            stats.clientTotal
          )}
        </strong>
      </div>

      <div class="import-stat">
        <span>COVER PROFIT</span>
        <strong class="${
          stats.coverageTotal >= 0
            ? 'net-positive'
            : 'net-negative'
        }">
          ${formatCurrency(
            stats.coverageTotal
          )}
        </strong>
      </div>

      <div class="import-stat">
        <span>BROKER NET</span>
        <strong class="${
          stats.brokerTotal >= 0
            ? 'net-positive'
            : 'net-negative'
        }">
          ${formatCurrency(
            stats.brokerTotal
          )}
        </strong>
      </div>

      <div class="import-stat">
        <span>COVER MATCH</span>
        <strong>
          ${stats.matchedCoverDeals}
          matched ·
          ${stats.unmatchedCoverDeals}
          unmatched
        </strong>
      </div>

    </div>

    <div class="preview-grid">

      ${
        rankingCard(
          'Weekly Top 5 Winners',
          pendingImport.winners,
          'winner',
          false
        )
      }

      ${
        rankingCard(
          'Weekly Top 5 Losers',
          pendingImport.losers,
          'loser',
          false
        )
      }

    </div>

    ${
      pendingImport
        .unmatchedDeals
        .length
        ? renderUnmatchedDeals(
            pendingImport
              .unmatchedDeals
          )
        : `
          <div class="match-ok">
            ✓ Every coverage OUT deal inside
            ${escapeHTML(
              pendingImport.weekLabel
            )}
            was matched to a client login.
          </div>
        `
    }

    ${
      renderAccountsSection(
        pendingImport.accounts,
        'All Weekly Accounts',
        'preview'
      )
    }

    ${
      renderCoverageAuditSection(
        pendingImport.matchedDeals,
        pendingImport.unmatchedDeals
      )
    }
  `;
}

function renderUnmatchedDeals(rows) {
  const total =
    roundMoney(
      rows.reduce(
        (sum, row) =>
          sum + row.profit,
        0
      )
    );

  const body =
    rows.map(row => `
      <tr>

        <td>
          ${escapeHTML(
            row.accountId
          )}
        </td>

        <td>
          ${escapeHTML(
            row.dealId
          )}
        </td>

        <td>
          ${escapeHTML(
            row.time
          )}
        </td>

        <td>
          ${escapeHTML(
            row.symbol
          )}
        </td>

        <td>
          ${escapeHTML(
            String(
              row.volume
            )
          )}
        </td>

        <td class="${
          row.profit >= 0
            ? 'net-positive'
            : 'net-negative'
        }">
          ${formatCurrency(
            row.profit
          )}
        </td>

        <td>
          ${escapeHTML(
            row.orderId
          )}
        </td>

      </tr>
    `).join('');

  return `
    <div class="warning-panel">

      <div class="warning-panel-title">

        <div>
          <strong>
            Unmatched Coverage Deals
          </strong>

          <span>
            ${rows.length}
            closing deal(s) ·
            ${formatCurrency(total)}
            excluded from matched Coverage P/L
          </span>
        </div>

        <span class="status-badge check">
          CHECK
        </span>

      </div>

      <p>
        No P/L is guessed.
        Re-import the same week with a longer
        Coverage History if older opening
        comments are missing.
      </p>

      <div class="table-scroll">

        <table class="matrix-table compact-table">

          <thead>
            <tr>
              <th>COVER ACCT</th>
              <th>DEAL</th>
              <th>TIME</th>
              <th>SYMBOL</th>
              <th>VOL</th>
              <th>PROFIT</th>
              <th>ORDER</th>
            </tr>
          </thead>

          <tbody>
            ${body}
          </tbody>

        </table>

      </div>

    </div>
  `;
}

function renderAccountsSection(
  accountsObject,
  title = 'All Accounts',
  mode = 'saved'
) {
  const rows =
    Object.values(
      accountsObject || {}
    )
      .sort(
        (a, b) =>
          b.client -
            a.client ||
          String(a.login)
            .localeCompare(
              String(b.login)
            )
      );

  const tableRows =
    rows.length

      ? rows.map(row => `
          <tr
            data-account-row
            data-search="${
              escapeHTML(
                `${
                  row.login
                } ${
                  row.name || ''
                } ${
                  row.group || ''
                }`.toLowerCase()
              )
            }"
          >

            <td>
              <strong>
                ${escapeHTML(
                  row.login
                )}
              </strong>
            </td>

            <td>
              ${escapeHTML(
                row.name || '—'
              )}
            </td>

            <td class="muted">
              ${escapeHTML(
                row.group || '—'
              )}
            </td>

            <td class="${
              row.client >= 0
                ? 'tag-winner'
                : 'tag-loser'
            }">
              ${formatCurrency(
                row.client
              )}
            </td>

            <td class="${
              row.coverage >= 0
                ? 'net-positive'
                : 'net-negative'
            }">
              ${formatCurrency(
                row.coverage
              )}
            </td>

            <td class="${
              row.brokerNet >= 0
                ? 'net-positive'
                : 'net-negative'
            }">
              ${formatCurrency(
                row.brokerNet
              )}
            </td>

          </tr>
        `).join('')

      : `
        <tr>
          <td
            colspan="6"
            class="empty-cell"
          >
            No accounts
          </td>
        </tr>
      `;

  return `
    <div class="accounts-panel">

      <div class="accounts-panel-head">

        <div>

          <div class="eyebrow">
            FULL SOURCE DATA
          </div>

          <h3>
            ${escapeHTML(title)}
            <span>
              ${rows.length}
            </span>
          </h3>

        </div>

        <input
          class="account-search"
          type="search"
          placeholder="Search login / name / group…"
          oninput="filterAccountTable(this)"
        >

      </div>

      <div class="table-scroll tall-scroll">

        <table class="matrix-table">

          <thead>
            <tr>
              <th>LOGIN</th>
              <th>NAME</th>
              <th>GROUP</th>
              <th>CLIENT P/L</th>
              <th>COVER PROFIT</th>
              <th>BROKER NET</th>
            </tr>
          </thead>

          <tbody>
            ${tableRows}
          </tbody>

        </table>

      </div>

    </div>
  `;
}

function filterAccountTable(input) {
  const query =
    String(
      input.value || ''
    )
      .trim()
      .toLowerCase();

  const panel =
    input.closest(
      '.accounts-panel'
    );

  if (!panel) return;

  panel
    .querySelectorAll(
      '[data-account-row]'
    )
    .forEach(row => {
      const haystack =
        String(
          row.dataset.search ||
          ''
        ).toLowerCase();

      row.style.display =
        !query ||
        haystack.includes(query)
          ? ''
          : 'none';
    });
}

function renderCoverageAuditSection(
  matchedDeals,
  unmatchedDeals
) {
  const rows = [
    ...(matchedDeals || []),
    ...(unmatchedDeals || [])
  ]
    .sort(
      (a, b) =>
        String(a.time)
          .localeCompare(
            String(b.time)
          ) ||
        String(a.dealId)
          .localeCompare(
            String(b.dealId)
          )
    );

  if (!rows.length) {
    return `
      <details class="audit-panel">

        <summary>
          Coverage Deal Audit · 0 deals
        </summary>

        <div class="empty-state">
          No OUT coverage deals were
          closed inside this week.
        </div>

      </details>
    `;
  }

  const body =
    rows.map(row => `
      <tr>

        <td>
          ${escapeHTML(
            row.accountId
          )}
        </td>

        <td>
          ${escapeHTML(
            row.dealId
          )}
        </td>

        <td>
          ${escapeHTML(
            row.time
          )}
        </td>

        <td>
          ${escapeHTML(
            row.symbol
          )}
        </td>

        <td>
          ${escapeHTML(
            String(
              row.volume
            )
          )}
        </td>

        <td class="${
          row.profit >= 0
            ? 'net-positive'
            : 'net-negative'
        }">
          ${formatCurrency(
            row.profit
          )}
        </td>

        <td>
          ${
            row.login
              ? `
                <strong>
                  ${escapeHTML(
                    row.login
                  )}
                </strong>
              `
              : `
                <span class="warning-text">
                  UNMATCHED
                </span>
              `
          }
        </td>

        <td>
          ${escapeHTML(
            row.matchMethod || ''
          )}
        </td>

      </tr>
    `).join('');

  return `
    <details class="audit-panel">

      <summary>
        Coverage Deal Audit ·
        ${rows.length}
        weekly OUT deals
      </summary>

      <div class="table-scroll tall-scroll">

        <table class="matrix-table compact-table">

          <thead>
            <tr>
              <th>COVER ACCT</th>
              <th>DEAL</th>
              <th>TIME</th>
              <th>SYMBOL</th>
              <th>VOL</th>
              <th>PROFIT</th>
              <th>CLIENT LOGIN</th>
              <th>MATCH</th>
            </tr>
          </thead>

          <tbody>
            ${body}
          </tbody>

        </table>

      </div>

    </details>
  `;
}

// ============================================================================
// SAVE WEEK
// ============================================================================

async function saveWeeklyImport() {
  if (!pendingImport) {
    showToast(
      'Analyze the files first.',
      'error'
    );

    return;
  }

  if (
    pendingImport.branch !==
    currentBranch
  ) {
    showToast(
      'Branch changed. Analyze the files again.',
      'error'
    );

    return;
  }

  const existingSnapshot =
    await db.ref(
      `pl_weekly_store/${currentBranch}/${pendingImport.weekKey}`
    ).once('value');

  const existing =
    existingSnapshot.val();

  if (existing) {
    const replace =
      confirm(
        `${currentBranch.toUpperCase()} already has a saved report for ${pendingImport.weekLabel}.\n\n` +
        `Saving will REPLACE that branch/week with the newly analyzed files.\n\nContinue?`
      );

    if (!replace) return;
  }

  if (
    pendingImport
      .unmatchedDeals
      .length
  ) {
    const proceed =
      confirm(
        `${pendingImport.unmatchedDeals.length} coverage closing deal(s) are unmatched.\n\n` +
        `They will be saved for audit but excluded from matched Coverage P/L. You can re-import this same week later with a longer history.\n\nContinue?`
      );

    if (!proceed) return;
  }

  const saveButton =
    document.getElementById(
      'save-week-import-btn'
    );

  if (saveButton) {
    saveButton.disabled =
      true;

    saveButton.textContent =
      'Saving…';
  }

  const matchedDealMap = {};

  pendingImport
    .matchedDeals
    .forEach(row => {
      matchedDealMap[
        firebaseSafeKey(
          row.recordKey
        )
      ] = row;
    });

  const unmatchedDealMap = {};

  pendingImport
    .unmatchedDeals
    .forEach(row => {
      unmatchedDealMap[
        firebaseSafeKey(
          row.recordKey
        )
      ] = row;
    });

  const record = {
    version: 3,
    branch:
      currentBranch,

    weekKey:
      pendingImport.weekKey,

    weekStart:
      pendingImport.weekStart,

    weekEnd:
      pendingImport.weekEnd,

    weekLabel:
      pendingImport.weekLabel,

    savedAt:
      new Date()
        .toISOString(),

    source: {
      summaryFile:
        pendingImport
          .summaryFileName,

      coverageFiles:
        pendingImport
          .coverageFileNames
    },

    summary: {
      rawRows:
        pendingImport
          .summaryRawRows,

      clientCount:
        pendingImport
          .summaryClientCount
    },

    stats:
      pendingImport.stats,

    accounts:
      pendingImport.accounts,

    coverageByLogin:
      pendingImport.coverageByLogin,

    matchedDeals:
      matchedDealMap,

    unmatchedDeals:
      unmatchedDealMap
  };

  const updates = {};

  updates[
    `pl_weekly_store/${currentBranch}/${pendingImport.weekKey}`
  ] = record;

  Object.entries(
    pendingImport
      .mappingUpdates || {}
  ).forEach(
    ([accountKey, positions]) => {
      Object.entries(
        positions || {}
      ).forEach(
        ([positionKey, login]) => {
          updates[
            `pl_cover_position_map/${currentBranch}/${accountKey}/${positionKey}`
          ] = login;
        }
      );
    }
  );

  try {
    await db.ref()
      .update(updates);

    selectedBranchWeekKey =
      pendingImport.weekKey;

    showToast(
      `${currentBranch.toUpperCase()} ${pendingImport.weekLabel} saved successfully.`
    );

    setImportStatus(
      `Saved ${pendingImport.weekLabel}. This record now feeds Group 5 automatically.`,
      'success'
    );

    clearFileInputs();
  }

  catch (err) {
    console.error(
      'Weekly save failed:',
      err
    );

    showToast(
      'Save failed. No weekly record was changed.',
      'error'
    );

    setImportStatus(
      'Save failed. Check Firebase access and try again.',
      'error'
    );
  }

  finally {
    if (saveButton) {
      saveButton.disabled =
        false;

      saveButton.textContent =
        'Save Week';
    }
  }
}

function clearFileInputs() {
  const summary =
    document.getElementById(
      'summary-file'
    );

  const coverage =
    document.getElementById(
      'coverage-files'
    );

  if (summary) {
    summary.value = '';
  }

  if (coverage) {
    coverage.value = '';
  }
}

function resetImportUI(
  clearFiles = true
) {
  pendingImport = null;

  if (clearFiles) {
    clearFileInputs();
  }

  const preview =
    document.getElementById(
      'import-preview'
    );

  if (preview) {
    preview.innerHTML = '';
  }

  const saveButton =
    document.getElementById(
      'save-week-import-btn'
    );

  if (saveButton) {
    saveButton.disabled =
      true;
  }

  setImportStatus(
    'Upload the weekly Summary and Coverage History.',
    'neutral'
  );

  renderExistingWeekStatus();
}

function renderExistingWeekStatus() {
  const el =
    document.getElementById(
      'existing-week-status'
    );

  if (!el) return;

  if (pendingImport) {
    const existing =
      weeklyStore?.[
        currentBranch
      ]?.[
        pendingImport.weekKey
      ];

    el.innerHTML =
      existing

        ? `
          <span class="status-badge check">
            RE-IMPORT
          </span>

          <strong>
            ${escapeHTML(
              pendingImport.weekLabel
            )}
          </strong>

          <small>
            Existing saved week will be replaced
            only after confirmation.
          </small>
        `

        : `
          <span class="status-badge good">
            NEW WEEK
          </span>

          <strong>
            ${escapeHTML(
              pendingImport.weekLabel
            )}
          </strong>

          <small>
            Ready to save after analysis.
          </small>
        `;

    return;
  }

  const records =
    Object.values(
      weeklyStore?.[
        currentBranch
      ] || {}
    )
      .sort(
        (a, b) =>
          String(
            b.weekStart || ''
          ).localeCompare(
            String(
              a.weekStart || ''
            )
          )
      );

  if (!records.length) {
    el.innerHTML = `
      <span class="status-badge neutral">
        NO DATA
      </span>

      <small>
        No weekly reports saved yet.
      </small>
    `;

    return;
  }

  const latest =
    records[0];

  el.innerHTML = `
    <span class="status-badge good">
      LATEST SAVED
    </span>

    <strong>
      ${escapeHTML(
        latest.weekLabel || ''
      )}
    </strong>

    <small>
      ${escapeHTML(
        formatSavedAt(
          latest.savedAt
        )
      )}
    </small>
  `;
}

// ============================================================================
// BRANCH SAVED-WEEK LEDGER + DETAIL
// ============================================================================

function getBranchRecords(branch) {
  return Object.entries(
    weeklyStore?.[
      branch
    ] || {}
  )
    .map(
      ([key, record]) => ({
        key,
        ...record
      })
    )
    .sort(
      (a, b) =>
        String(
          b.weekStart || ''
        ).localeCompare(
          String(
            a.weekStart || ''
          )
        )
    );
}

function renderBranchWeekLedger() {
  const container =
    document.getElementById(
      'branch-week-ledger'
    );

  if (!container) return;

  const records =
    getBranchRecords(
      currentBranch
    );

  if (!records.length) {
    container.innerHTML = `
      <div class="empty-state">

        <strong>
          No weekly reports saved.
        </strong>

        Your first Friday import will appear
        here permanently.

      </div>
    `;

    const detail =
      document.getElementById(
        'branch-week-detail'
      );

    if (detail) {
      detail.innerHTML = '';
    }

    return;
  }

  if (
    !selectedBranchWeekKey ||
    !weeklyStore?.[
      currentBranch
    ]?.[
      selectedBranchWeekKey
    ]
  ) {
    selectedBranchWeekKey =
      records[0].key;
  }

  container.innerHTML = `
    <div class="table-card">

      <div class="table-scroll">

        <table class="matrix-table ledger-table">

          <thead>
            <tr>
              <th>WEEK</th>
              <th>STATUS</th>
              <th>ACCOUNTS</th>
              <th>CLIENT P/L</th>
              <th>COVER PROFIT</th>
              <th>BROKER NET</th>
              <th>UNMATCHED</th>
              <th>SAVED</th>
              <th></th>
            </tr>
          </thead>

          <tbody>

            ${
              records.map(
                record => {
                  const stats =
                    record.stats || {};

                  const needsCheck =
                    Number(
                      stats
                        .unmatchedCoverDeals ||
                      0
                    ) > 0;

                  return `
                    <tr class="${
                      record.key ===
                      selectedBranchWeekKey
                        ? 'selected-row'
                        : ''
                    }">

                      <td>
                        <strong>
                          ${escapeHTML(
                            record.weekLabel ||
                            record.key
                          )}
                        </strong>
                      </td>

                      <td>
                        <span class="status-badge ${
                          needsCheck
                            ? 'check'
                            : 'good'
                        }">
                          ${
                            needsCheck
                              ? 'CHECK'
                              : 'COMPLETE'
                          }
                        </span>
                      </td>

                      <td>
                        ${
                          Number(
                            stats.accountCount ||
                            Object.keys(
                              record.accounts ||
                              {}
                            ).length
                          )
                        }
                      </td>

                      <td class="${
                        Number(
                          stats.clientTotal ||
                          0
                        ) >= 0
                          ? 'tag-winner'
                          : 'tag-loser'
                      }">
                        ${formatCurrency(
                          stats.clientTotal ||
                          0
                        )}
                      </td>

                      <td class="${
                        Number(
                          stats.coverageTotal ||
                          0
                        ) >= 0
                          ? 'net-positive'
                          : 'net-negative'
                      }">
                        ${formatCurrency(
                          stats.coverageTotal ||
                          0
                        )}
                      </td>

                      <td class="${
                        Number(
                          stats.brokerTotal ||
                          0
                        ) >= 0
                          ? 'net-positive'
                          : 'net-negative'
                      }">
                        ${formatCurrency(
                          stats.brokerTotal ||
                          0
                        )}
                      </td>

                      <td>
                        ${
                          Number(
                            stats
                              .unmatchedCoverDeals ||
                            0
                          )
                        }
                      </td>

                      <td>
                        ${escapeHTML(
                          formatSavedAt(
                            record.savedAt
                          )
                        )}
                      </td>

                      <td>
                        <button
                          class="mini-btn"
                          onclick="viewBranchWeek('${escapeHTML(
                            record.key
                          )}')"
                        >
                          View
                        </button>
                      </td>

                    </tr>
                  `;
                }
              ).join('')
            }

          </tbody>

        </table>

      </div>

    </div>
  `;

  renderBranchWeekDetail(
    selectedBranchWeekKey
  );
}

function viewBranchWeek(
  weekKey
) {
  selectedBranchWeekKey =
    weekKey;

  renderBranchWeekLedger();

  const detail =
    document.getElementById(
      'branch-week-detail'
    );

  if (detail) {
    detail.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
}

function objectValues(obj) {
  return Object.values(
    obj || {}
  );
}

function renderBranchWeekDetail(
  weekKey
) {
  const container =
    document.getElementById(
      'branch-week-detail'
    );

  const record =
    weeklyStore?.[
      currentBranch
    ]?.[
      weekKey
    ];

  if (
    !container ||
    !record
  ) {
    if (container) {
      container.innerHTML = '';
    }

    return;
  }

  const rows =
    objectValues(
      record.accounts
    );

  const ranked =
    rankEntries(
      rows,
      5
    );

  const matchedDeals =
    objectValues(
      record.matchedDeals
    );

  const unmatchedDeals =
    objectValues(
      record.unmatchedDeals
    );

  const stats =
    record.stats || {};

  container.innerHTML = `
    <section class="saved-detail">

      <div class="section-heading">

        <div>

          <div class="eyebrow">
            SAVED WEEK ·
            ${escapeHTML(
              currentBranch.toUpperCase()
            )}
          </div>

          <h2>
            ${escapeHTML(
              record.weekLabel ||
              weekKey
            )}
          </h2>

        </div>

        <div class="section-note">
          Saved
          ${escapeHTML(
            formatSavedAt(
              record.savedAt
            )
          )}
        </div>

      </div>

      <div class="import-summary-grid saved-stats">

        <div class="import-stat">
          <span>ACCOUNTS</span>
          <strong>
            ${Number(
              stats.accountCount ||
              rows.length
            )}
          </strong>
        </div>

        <div class="import-stat">
          <span>CLIENT P/L</span>
          <strong class="${
            Number(
              stats.clientTotal ||
              0
            ) >= 0
              ? 'net-positive'
              : 'net-negative'
          }">
            ${formatCurrency(
              stats.clientTotal ||
              0
            )}
          </strong>
        </div>

        <div class="import-stat">
          <span>COVER PROFIT</span>
          <strong class="${
            Number(
              stats.coverageTotal ||
              0
            ) >= 0
              ? 'net-positive'
              : 'net-negative'
          }">
            ${formatCurrency(
              stats.coverageTotal ||
              0
            )}
          </strong>
        </div>

        <div class="import-stat">
          <span>BROKER NET</span>
          <strong class="${
            Number(
              stats.brokerTotal ||
              0
            ) >= 0
              ? 'net-positive'
              : 'net-negative'
          }">
            ${formatCurrency(
              stats.brokerTotal ||
              0
            )}
          </strong>
        </div>

        <div class="import-stat">
          <span>MATCHED COVER</span>
          <strong>
            ${Number(
              stats
                .matchedCoverDeals ||
              matchedDeals.length
            )}
          </strong>
        </div>

        <div class="import-stat">
          <span>UNMATCHED COVER</span>
          <strong class="${
            Number(
              stats
                .unmatchedCoverDeals ||
              unmatchedDeals.length
            )
              ? 'warning-text'
              : ''
          }">
            ${Number(
              stats
                .unmatchedCoverDeals ||
              unmatchedDeals.length
            )}
          </strong>
        </div>

      </div>

      <div class="preview-grid">

        ${
          rankingCard(
            'Top 5 Winners',
            ranked.winners,
            'winner',
            false
          )
        }

        ${
          rankingCard(
            'Top 5 Losers',
            ranked.losers,
            'loser',
            false
          )
        }

      </div>

      ${
        unmatchedDeals.length
          ? renderUnmatchedDeals(
              unmatchedDeals
            )
          : ''
      }

      ${
        renderAccountsSection(
          record.accounts,
          'All Saved Accounts',
          'saved'
        )
      }

      ${
        renderCoverageAuditSection(
          matchedDeals,
          unmatchedDeals
        )
      }

    </section>
  `;
}

// ============================================================================
// GROUP 5 WEEK CATALOG + CALCULATIONS
// ============================================================================

function getWeekCatalog() {
  const map = {};

  allBranches.forEach(
    branch => {
      Object.entries(
        weeklyStore?.[
          branch
        ] || {}
      ).forEach(
        ([weekKey, record]) => {
          if (!map[weekKey]) {
            map[weekKey] = {
              weekKey,

              weekStart:
                record.weekStart ||
                weekKey.split('_')[0] ||
                '',

              weekEnd:
                record.weekEnd ||
                weekKey.split('_')[1] ||
                '',

              weekLabel:
                record.weekLabel ||
                weekKey,

              branches: []
            };
          }

          map[
            weekKey
          ].branches.push(
            branch
          );
        }
      );
    }
  );

  return Object.values(
    map
  ).sort(
    (a, b) =>
      String(
        b.weekStart
      ).localeCompare(
        String(
          a.weekStart
        )
      )
  );
}

function selectExecutiveWeek(
  weekKey
) {
  selectedExecutiveWeekKey =
    weekKey;

  renderManagementView();
}

function computeBranchWeek(
  branch,
  weekKey
) {
  const record =
    weeklyStore?.[
      branch
    ]?.[
      weekKey
    ];

  const entries =
    objectValues(
      record?.accounts
    );

  return {
    record,
    entries,
    ...rankEntries(
      entries,
      5
    )
  };
}

function computeCombinedWeek(
  weekKey
) {
  const combined = {};

  allBranches.forEach(
    branch => {
      const record =
        weeklyStore?.[
          branch
        ]?.[
          weekKey
        ];

      if (!record?.accounts) {
        return;
      }

      objectValues(
        record.accounts
      ).forEach(row => {
        if (
          !combined[
            row.login
          ]
        ) {
          combined[
            row.login
          ] = {
            login:
              row.login,

            name:
              row.name ||
              '',

            client: 0,
            coverage: 0,
            brokerNet: 0,
            branches: []
          };
        }

        const target =
          combined[
            row.login
          ];

        target.client =
          roundMoney(
            target.client +
            Number(
              row.client ||
              0
            )
          );

        target.coverage =
          roundMoney(
            target.coverage +
            Number(
              row.coverage ||
              0
            )
          );

        if (
          !target.name &&
          row.name
        ) {
          target.name =
            row.name;
        }

        if (
          !target.branches
            .includes(branch)
        ) {
          target.branches
            .push(branch);
        }
      });
    }
  );

  const entries =
    Object.values(
      combined
    ).map(row => ({
      ...row,

      brokerNet:
        brokerNet(
          row.client,
          row.coverage
        ),

      branches:
        row.branches.sort()
    }));

  return {
    entries,
    ...rankEntries(
      entries,
      5
    )
  };
}

function renderManagementView() {
  const catalog =
    getWeekCatalog();

  const select =
    document.getElementById(
      'executive-week-select'
    );

  if (!catalog.length) {
    selectedExecutiveWeekKey =
      null;

    if (select) {
      select.innerHTML =
        '<option value="">No saved weeks</option>';
    }

    const combined =
      document.getElementById(
        'combined-tables-container'
      );

    const branches =
      document.getElementById(
        'management-tables-container'
      );

    if (combined) {
      combined.innerHTML = `
        <div class="empty-state wide">
          <strong>
            No weekly imports yet.
          </strong>
          Saved branch weeks will automatically
          appear here.
        </div>
      `;
    }

    if (branches) {
      branches.innerHTML = '';
    }

    renderExecutiveSourceStatus(
      null
    );

    const note =
      document.getElementById(
        'executive-week-note'
      );

    if (note) {
      note.textContent = '';
    }

    return;
  }

  if (
    !selectedExecutiveWeekKey ||
    !catalog.some(
      item =>
        item.weekKey ===
        selectedExecutiveWeekKey
    )
  ) {
    selectedExecutiveWeekKey =
      catalog[0].weekKey;
  }

  if (select) {
    select.innerHTML =
      catalog.map(
        item => `
          <option
            value="${escapeHTML(
              item.weekKey
            )}"
            ${
              item.weekKey ===
              selectedExecutiveWeekKey
                ? 'selected'
                : ''
            }
          >
            ${escapeHTML(
              item.weekLabel
            )}
          </option>
        `
      ).join('');
  }

  const selectedMeta =
    catalog.find(
      item =>
        item.weekKey ===
        selectedExecutiveWeekKey
    );

  const note =
    document.getElementById(
      'executive-week-note'
    );

  if (note) {
    note.textContent =
      selectedMeta?.weekLabel ||
      '';
  }

  const combinedResult =
    computeCombinedWeek(
      selectedExecutiveWeekKey
    );

  const combinedContainer =
    document.getElementById(
      'combined-tables-container'
    );

  if (combinedContainer) {
    combinedContainer.innerHTML =
      rankingCard(
        'Top 5 Winners',
        combinedResult.winners,
        'winner',
        true
      ) +
      rankingCard(
        'Top 5 Losers',
        combinedResult.losers,
        'loser',
        true
      );
  }

  const branchContainer =
    document.getElementById(
      'management-tables-container'
    );

  if (branchContainer) {
    branchContainer.innerHTML =
      allBranches.map(
        branch => {
          const result =
            computeBranchWeek(
              branch,
              selectedExecutiveWeekKey
            );

          if (!result.record) {
            return `
              <div class="branch-pair-block">

                <div class="branch-pair-title">

                  <strong>
                    ${escapeHTML(
                      branch.toUpperCase()
                    )}
                  </strong>

                  <span class="status-badge neutral">
                    NOT IMPORTED
                  </span>

                </div>

                <div class="empty-state compact">
                  No report saved for this week.
                </div>

              </div>
            `;
          }

          return `
            <div class="branch-pair-block">

              <div class="branch-pair-title">

                <strong>
                  ${escapeHTML(
                    branch.toUpperCase()
                  )}
                </strong>

                <span class="status-badge ${
                  Number(
                    result.record
                      .stats
                      ?.unmatchedCoverDeals ||
                    0
                  )
                    ? 'check'
                    : 'good'
                }">

                  ${
                    Number(
                      result.record
                        .stats
                        ?.unmatchedCoverDeals ||
                      0
                    )
                      ? 'CHECK'
                      : 'COMPLETE'
                  }

                </span>

              </div>

              <div class="dashboard-grid executive-pair">

                ${
                  rankingCard(
                    'Top 5 Winners',
                    result.winners,
                    'winner',
                    false
                  )
                }

                ${
                  rankingCard(
                    'Top 5 Losers',
                    result.losers,
                    'loser',
                    false
                  )
                }

              </div>

            </div>
          `;
        }
      ).join('');
  }

  renderExecutiveSourceStatus(
    selectedExecutiveWeekKey
  );
}

function renderExecutiveSourceStatus(
  weekKey
) {
  const note =
    document.getElementById(
      'executive-source-status'
    );

  if (!note) return;

  if (!weekKey) {
    note.innerHTML = `
      <span class="status-dot neutral"></span>
      No weekly branch reports saved yet.
    `;

    return;
  }

  let branchesSaved = 0;
  let totalAccounts = 0;
  let unmatched = 0;
  let clientTotal = 0;
  let coverageTotal = 0;

  allBranches.forEach(
    branch => {
      const record =
        weeklyStore?.[
          branch
        ]?.[
          weekKey
        ];

      if (!record) return;

      branchesSaved += 1;

      totalAccounts +=
        Number(
          record.stats
            ?.accountCount ||
          Object.keys(
            record.accounts ||
            {}
          ).length
        );

      unmatched +=
        Number(
          record.stats
            ?.unmatchedCoverDeals ||
          0
        );

      clientTotal +=
        Number(
          record.stats
            ?.clientTotal ||
          0
        );

      coverageTotal +=
        Number(
          record.stats
            ?.coverageTotal ||
          0
        );
    }
  );

  note.innerHTML = `
    <span class="status-dot ${
      branchesSaved
        ? 'good'
        : 'neutral'
    }"></span>

    <strong>
      ${branchesSaved}/${allBranches.length}
    </strong>
    branches saved ·

    <strong>
      ${totalAccounts.toLocaleString(
        'en-US'
      )}
    </strong>
    account rows ·

    Client P/L

    <strong class="${
      clientTotal >= 0
        ? 'net-positive'
        : 'net-negative'
    }">
      ${formatCurrency(
        clientTotal
      )}
    </strong>

    · Cover

    <strong class="${
      coverageTotal >= 0
        ? 'net-positive'
        : 'net-negative'
    }">
      ${formatCurrency(
        coverageTotal
      )}
    </strong>

    ${
      unmatched
        ? `
          <span class="status-separator">
            ·
          </span>

          <span class="warning-text">
            ${unmatched}
            unmatched cover deal(s)
          </span>
        `
        : ''
    }
  `;
}

function rankingCard(
  title,
  rows,
  type,
  includeBranch
) {
  return `
    <div class="branch-card">

      <h3>
        ${escapeHTML(title)}
      </h3>

      <div class="table-scroll">

        <table class="matrix-table ranking-table">

          <thead>
            <tr>
              <th>RANK</th>
              <th>LOGIN</th>
              <th>NAME</th>

              ${
                includeBranch
                  ? '<th>BRANCH</th>'
                  : ''
              }

              <th>CLIENT P/L</th>
              <th>COVER PROFIT</th>
              <th>BROKER NET</th>
            </tr>
          </thead>

          <tbody>
            ${
              renderRankingRows(
                rows,
                type,
                includeBranch
              )
            }
          </tbody>

        </table>

      </div>

    </div>
  `;
}

function renderRankingRows(
  rows,
  type,
  includeBranch
) {
  if (!rows?.length) {
    return `
      <tr>
        <td
          colspan="${
            includeBranch
              ? 7
              : 6
          }"
          class="empty-cell"
        >
          No qualifying accounts
        </td>
      </tr>
    `;
  }

  return rows.map(
    (row, index) => `
      <tr>

        <td>
          #${index + 1}
        </td>

        <td>
          <strong>
            ${escapeHTML(
              row.login
            )}
          </strong>
        </td>

        <td>
          ${escapeHTML(
            row.name || '—'
          )}
        </td>

        ${
          includeBranch
            ? `
              <td>
                ${escapeHTML(
                  (
                    row.branches ||
                    []
                  )
                    .map(
                      x =>
                        x.toUpperCase()
                    )
                    .join(', ')
                )}
              </td>
            `
            : ''
        }

        <td class="${
          type === 'winner'
            ? 'tag-winner'
            : 'tag-loser'
        }">
          ${formatCurrency(
            row.client
          )}
        </td>

        <td class="${
          Number(
            row.coverage ||
            0
          ) >= 0
            ? 'net-positive'
            : 'net-negative'
        }">
          ${formatCurrency(
            row.coverage ||
            0
          )}
        </td>

        <td class="${
          Number(
            row.brokerNet ||
            0
          ) >= 0
            ? 'net-positive'
            : 'net-negative'
        }">
          ${formatCurrency(
            row.brokerNet ||
            0
          )}
        </td>

      </tr>
    `
  ).join('');
}

// ============================================================================
// WEEKLY ARCHIVE — BUILT DIRECTLY FROM PERMANENT WEEKLY STORE
// ============================================================================

function renderArchiveView() {
  const list =
    document.getElementById(
      'archive-week-list'
    );

  const detail =
    document.getElementById(
      'archive-detail-container'
    );

  if (
    !list ||
    !detail
  ) {
    return;
  }

  const catalog =
    getWeekCatalog();

  if (!catalog.length) {
    list.innerHTML = `
      <p
        class="subtitle"
        style="padding:10px;"
      >
        No saved weeks yet.
      </p>
    `;

    detail.innerHTML = '';

    selectedArchiveWeekKey =
      null;

    return;
  }

  if (
    !selectedArchiveWeekKey ||
    !catalog.some(
      item =>
        item.weekKey ===
        selectedArchiveWeekKey
    )
  ) {
    selectedArchiveWeekKey =
      catalog[0].weekKey;
  }

  list.innerHTML =
    catalog.map(
      item => `
        <button
          class="archive-week-btn ${
            item.weekKey ===
            selectedArchiveWeekKey
              ? 'active'
              : ''
          }"
          onclick="selectArchiveWeek('${escapeHTML(
            item.weekKey
          )}')"
        >

          <strong>
            ${escapeHTML(
              item.weekLabel
            )}
          </strong>

          <span>
            ${item.branches.length}/${allBranches.length}
            branches
          </span>

        </button>
      `
    ).join('');

  renderArchiveDetail(
    selectedArchiveWeekKey
  );
}

function selectArchiveWeek(
  weekKey
) {
  selectedArchiveWeekKey =
    weekKey;

  renderArchiveView();
}

function renderArchiveDetail(
  weekKey
) {
  const container =
    document.getElementById(
      'archive-detail-container'
    );

  if (!container) return;

  const catalogItem =
    getWeekCatalog()
      .find(
        item =>
          item.weekKey ===
          weekKey
      );

  if (!catalogItem) {
    container.innerHTML = `
      <div class="empty-state">
        Week not found.
      </div>
    `;

    return;
  }

  const combined =
    computeCombinedWeek(
      weekKey
    );

  const statusRows =
    allBranches.map(
      branch => {
        const record =
          weeklyStore?.[
            branch
          ]?.[
            weekKey
          ];

        if (!record) {
          return `
            <tr>

              <td>
                <strong>
                  ${escapeHTML(
                    branch.toUpperCase()
                  )}
                </strong>
              </td>

              <td>
                <span class="status-badge neutral">
                  NOT IMPORTED
                </span>
              </td>

              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>

            </tr>
          `;
        }

        const stats =
          record.stats || {};

        const check =
          Number(
            stats
              .unmatchedCoverDeals ||
            0
          ) > 0;

        return `
          <tr>

            <td>
              <strong>
                ${escapeHTML(
                  branch.toUpperCase()
                )}
              </strong>
            </td>

            <td>
              <span class="status-badge ${
                check
                  ? 'check'
                  : 'good'
              }">
                ${
                  check
                    ? 'CHECK'
                    : 'COMPLETE'
                }
              </span>
            </td>

            <td>
              ${Number(
                stats.accountCount ||
                Object.keys(
                  record.accounts ||
                  {}
                ).length
              )}
            </td>

            <td class="${
              Number(
                stats.clientTotal ||
                0
              ) >= 0
                ? 'tag-winner'
                : 'tag-loser'
            }">
              ${formatCurrency(
                stats.clientTotal ||
                0
              )}
            </td>

            <td class="${
              Number(
                stats.coverageTotal ||
                0
              ) >= 0
                ? 'net-positive'
                : 'net-negative'
            }">
              ${formatCurrency(
                stats.coverageTotal ||
                0
              )}
            </td>

            <td>
              ${Number(
                stats
                  .unmatchedCoverDeals ||
                0
              )}
            </td>

            <td>
              ${escapeHTML(
                formatSavedAt(
                  record.savedAt
                )
              )}
            </td>

          </tr>
        `;
      }
    ).join('');

  container.innerHTML = `
    <div class="section-heading">

      <div>

        <div class="eyebrow">
          SAVED TRADING WEEK
        </div>

        <h2>
          ${escapeHTML(
            catalogItem.weekLabel
          )}
        </h2>

      </div>

      <div class="section-note">
        Permanent weekly record
      </div>

    </div>

    <div class="dashboard-grid executive-pair">

      ${
        rankingCard(
          'Top 5 Winners',
          combined.winners,
          'winner',
          true
        )
      }

      ${
        rankingCard(
          'Top 5 Losers',
          combined.losers,
          'loser',
          true
        )
      }

    </div>

    <section class="section-block">

      <div class="section-heading">

        <div>

          <div class="eyebrow">
            IMPORT COMPLETENESS
          </div>

          <h2>
            Branch Status
          </h2>

        </div>

      </div>

      <div class="table-card">

        <div class="table-scroll">

          <table class="matrix-table">

            <thead>
              <tr>
                <th>BRANCH</th>
                <th>STATUS</th>
                <th>ACCOUNTS</th>
                <th>CLIENT P/L</th>
                <th>COVER PROFIT</th>
                <th>UNMATCHED</th>
                <th>SAVED</th>
              </tr>
            </thead>

            <tbody>
              ${statusRows}
            </tbody>

          </table>

        </div>

      </div>

    </section>

    <section class="section-block">

      <div class="section-heading">

        <div>

          <div class="eyebrow">
            BRANCH PERFORMANCE
          </div>

          <h2>
            Top 5 by Branch
          </h2>

        </div>

      </div>

      <div class="dashboard-grid archive-branch-grid">

        ${
          allBranches.map(
            branch => {
              const result =
                computeBranchWeek(
                  branch,
                  weekKey
                );

              if (
                !result.record
              ) {
                return '';
              }

              return `
                <div class="branch-pair-block">

                  <div class="branch-pair-title">

                    <strong>
                      ${escapeHTML(
                        branch.toUpperCase()
                      )}
                    </strong>

                  </div>

                  <div class="dashboard-grid executive-pair">

                    ${
                      rankingCard(
                        'Top 5 Winners',
                        result.winners,
                        'winner',
                        false
                      )
                    }

                    ${
                      rankingCard(
                        'Top 5 Losers',
                        result.losers,
                        'loser',
                        false
                      )
                    }

                  </div>

                </div>
              `;
            }
          ).join('')
        }

      </div>

    </section>
  `;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initApp() {
  const urlParams =
    new URLSearchParams(
      window.location.search
    );

  const branchParam =
    (
      urlParams.get('branch') ||
      'group5'
    ).toLowerCase();

  const allowedTabs =
    branchGroups[
      branchParam
    ] || [branchParam];

  applySidebarLock(
    allowedTabs
  );

  switchTab(
    branchParam
  );
}

if (
  document.readyState ===
  'loading'
) {
  document.addEventListener(
    'DOMContentLoaded',
    initApp
  );
}

else {
  initApp();
}
