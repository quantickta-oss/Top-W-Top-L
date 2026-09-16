P/L SYSTEM — WEEKLY IMPORT EDITION
==================================

FINAL WORKFLOW
--------------
Do this once per branch every Friday after market close:

1) Export MT5 Trades\Summary for Monday -> Friday.
2) Export the Coverage Trade History. The coverage history may start before Monday.
3) Open the branch page.
4) Upload the weekly Summary.
5) Upload one or more Coverage History HTML files.
6) Click "Analyze Week".
7) Review the detected week, totals, Top 5, all accounts and any unmatched cover deals.
8) Click "Save Week".

There is NO manual P/L typing and NO ON / AM / PM processing.

PERMANENT CALCULATION RULES
---------------------------
CLIENT P/L
- Source: MT5 Trades\Summary.
- Field used: Profit.
- Every login in the Summary is stored.
- Winners = highest positive weekly Client P/L.
- Losers = most negative weekly Client P/L.

COVERAGE P/L
- Source: MT5 Trade History -> Deals section.
- Only Direction = OUT is counted.
- Only deals whose Deal Time falls between the Summary's detected Monday and Friday are counted.
- Amount used = Profit ONLY.
- Commission, Fee and Swap are ignored.
- Older rows outside the week are NEVER counted in weekly Coverage P/L.
- Older rows are read only to recover client comments / position-to-login mapping.

BROKER NET
- Broker Net = Coverage P/L - Client P/L.

MATCHING
--------
The system uses this priority:
1) Client login directly on the closing deal comment.
2) Client login on the closing order comment.
3) Match the OUT deal to the closed Position row, then recover the position's client login.
4) Reuse the persistent position -> client login mapping saved in Firebase.

If a weekly OUT deal still cannot be matched:
- The system DOES NOT guess.
- It saves the deal as unmatched for audit.
- The unmatched profit is excluded from matched Coverage P/L.
- Re-import the same branch/week later with a longer Coverage History to replace the week.

WEEK DETECTION
--------------
The Summary date range is detected automatically from the MT5 header.
The importer requires a Monday -> Friday range.
Example:
from '2026.09.14' to '2026.09.18'

No date needs to be changed in app.js each week.

FIREBASE DATA
-------------
New permanent weekly records:
pl_weekly_store/{branch}/{weekKey}

Permanent cover mapping:
pl_cover_position_map/{branch}/{coverAccount}/{positionId}

The previous shift/manual data paths are not deleted by this update.
The new weekly dashboard does not use them.

There is no Archive & Reset action anymore.
Each week is saved under its own week key, so a new Friday import automatically creates the next week.
The Weekly Archive screen reads these permanent weekly records directly.

RE-IMPORTS
----------
Re-importing the same branch + week replaces that weekly branch report after confirmation.
It does not add the P/L a second time.
Overlapping Coverage History files are deduplicated by cover account + Deal ID during analysis.

GROUP 5
-------
Group 5 automatically discovers all saved weeks.
Choose a week from the Trading Week selector.
It shows:
- Company-wide Top 5 Winners
- Company-wide Top 5 Losers
- Top 5 by branch
- Branch completeness status
- Unmatched coverage warning count

The company-wide calculation nets each login across all saved branches for the selected week before ranking.

DEPLOYMENT
----------
Replace your site's:
- index.html
- app.js
- styles.css

IMPORTANT:
app.js intentionally contains:
apiKey: "YOUR_FIREBASE_API_KEY"

Copy the REAL apiKey from your current live app.js / Firebase project before publishing.
All other Firebase project values are already set to the existing project details supplied previously.
