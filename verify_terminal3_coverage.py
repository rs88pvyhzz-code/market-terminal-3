"""Reject a Terminal 3 publication that silently drops Terminal 2 data coverage.

Thresholds below come from Terminal 2's successful 15 November 2026 build.
These are conservative *floors*, not claims of identical source freshness.
"""
import json
import re
import sys
from pathlib import Path

html=Path(sys.argv[1]).read_text('utf-8')
match=re.search(r'window\.MT_DATA\s*=\s*',html)
if not match:
    raise SystemExit('Missing Market Terminal production payload')
payload=json.JSONDecoder().raw_decode(html[match.end():])[0]
if payload.get('demo') is not False:
    raise SystemExit('Coverage gate requires actual production source data')
fc=payload.get('fundamentalsCoverage') or {}
pc=payload.get('priceHistoryCoverage') or {}
cc=payload.get('companyProfilesCoverage') or {}
gilt=payload.get('gilt_history') or []
indicators={
    'market quotes': (len(payload.get('quotes') or []), 70),
    'fundamental summaries': (int(fc.get('summaries') or 0), 800),
    'five-year equity price histories': (int(pc.get('fullFiveYears') or 0), 750),
    'available price histories': (int(pc.get('available') or 0), 800),
    'company profiles': (int(cc.get('profiles') or 0), 155),
    'dated US Treasury prices': (len(payload.get('us_treasuries') or []), 400),
    'saved UK gilt history observations': (len(gilt), 400),
    'economic series': (len(payload.get('macro') or []), 60),
}
for name,(actual,minimum) in indicators.items():
    print(f'{name}: {actual} (minimum {minimum})')
failed=[name for name,(actual,minimum) in indicators.items() if actual<minimum]
# Corporate document coverage should be checked against the saved source report.
# Some sources are unavailable without an SEC_USER_AGENT secret; never invent
# a successful download or update the retrieved date for retained documents.
if failed:
    raise SystemExit('Terminal 2 coverage regression: '+', '.join(failed))
print('PASS Terminal 3 retained Terminal 2 baseline market-data coverage')
