P/L SYSTEM — DAILY IMPORT UPDATE
================================

FILES
-----
index.html
styles.css
app.js

IMPORTANT BEFORE DEPLOYING
--------------------------
1. Copy your REAL Firebase apiKey/config into app.js.
2. Upload all three files together.
3. Test on a branch link before replacing production.

NEW SOURCE-OF-TRUTH WORKFLOW
----------------------------
1. Open the branch page.
2. Upload the one-day MT5 Trades\\Summary HTML.
3. Upload one or more Coverage History HTML files. The history can begin on an older date.
4. Click Analyze Files.
5. The app reads the report date automatically from the Summary header.
6. The app reads the entire cover history for position/comment mapping.
7. It counts ONLY coverage positions whose Close Time is on the detected Summary date.
8. Coverage P/L uses ONLY the Profit field.
9. If a closed position has no client login mapping, it appears in an Unmatched table for optional manual mapping.
10. Save Daily Report. Re-importing the same branch/date REPLACES the day; it does not duplicate it.

WEEKLY TOP 5
------------
Group 5 now uses pl_daily_store, not the manual Top 3 shift matrix.
It nets each login across Monday-Friday and then ranks the true weekly Top 5 Winners / Losers.

MANUAL TOP 3
------------
The ON / AM / PM manual table is still available for operations.
Enter moves to the next field. Shift+Enter goes backward.
This table does NOT drive the Executive Top 5.

PERSISTENT COVER MAPPING
------------------------
The app stores cover position -> client login mappings under pl_cover_position_map.
Archiving/resetting a week does NOT delete this mapping.
This helps later closes whose original opening comment came from an earlier day/week.

SAMPLE VALIDATION WITH THE FILES PROVIDED
-----------------------------------------
Summary detected: 2026-09-10
Summary client rows: 4,306
Non-zero client P/L accounts: 605
Coverage account detected: 5221
Coverage positions closed on 2026-09-10: 66
Coverage Profit counted: +1,278.45
Unmatched closed positions in this sample: 0

This validation follows the requested rule: position Close Time = report date; Coverage P/L = Profit only.
