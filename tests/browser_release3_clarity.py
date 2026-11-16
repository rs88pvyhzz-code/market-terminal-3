"""Release B: price/adjusted return basis, company hierarchy, issuer-source links.

Uses explicit synthetic rows only in the demo browser, not production caches.
"""
import json,os,re,sys,math
from pathlib import Path
from playwright.sync_api import sync_playwright

raw=Path(sys.argv[1]).read_text()
m=re.search(r'window\.MT_DATA\s*=\s*',raw)
assert m,'No production/demo payload'
payload,end=json.JSONDecoder().raw_decode(raw[m.end():])
is_demo=bool(payload.get('demo'))
if is_demo:
    symbol=payload['personalWatchlist'][0]['symbol']
    # 1Y, 3Y and 5Y end dates are precisely matched to the annualisation code.
    points=[['2021-11-16',50,55],['2023-11-16',70,80],
            ['2025-11-16',100,110],['2026-11-16',120,140]]
    payload['watchlist_history']=[x for x in payload.get('watchlist_history',[]) if x['symbol']!=symbol]
    payload['watchlist_history'].append({'symbol':symbol,'points':points})
    raw=raw[:m.end()]+json.dumps(payload).replace('</','<\\/')+raw[m.end()+end:]

with sync_playwright() as playwright:
    opts={'headless':True,'args':['--no-sandbox']}
    if os.environ.get('CHROMIUM_EXECUTABLE'):opts['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
    browser=playwright.chromium.launch(**opts)
    page=browser.new_page(viewport={'width':1024,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('http://localhost:8765/**',lambda route:route.fulfill(body=raw,content_type='text/html'))
    page.goto('http://localhost:8765/',wait_until='domcontentloaded',timeout=120000)
    page.locator('#tab-watchlist').dispatch_event('click')
    box=page.locator('#watchlist-return-comparison')
    if is_demo:
        cells=box.locator('tbody tr').first.locator('td').all_text_contents()
        assert cells[0]=='1Y',cells
        def percent(v):return float(v.strip().replace('%','').replace('+',''))
        assert abs(percent(cells[1])-20)<.06,cells
        assert abs(percent(cells[2])-(140/110-1)*100)<.06,cells
        third=box.locator('tbody tr').nth(1).locator('td').all_text_contents()
        assert third[0]=='3Y p.a.',third
        expect=100*((120/70)**(365.25/1096)-1)
        assert abs(percent(third[1])-expect)<.06,third
        assert abs(percent(third[2])-100*((140/80)**(365.25/1096)-1))<.06,third
    page.locator('#tab-companies').dispatch_event('click')
    page.locator('#research-tab-0').dispatch_event('click')
    assert page.locator('#company-source-provenance').count()==1
    assert page.locator('#company-source-provenance summary').count()==1
    # All existing underlying provider figures remain in the DOM; only eight
    # or fewer non-duplicate values are in the initial visible hierarchy.
    metrics=page.locator('#research-overview .layout-metrics')
    assert metrics.count()==1
    visible=metrics.locator('.research-card:visible,.company-kpi:visible').count()
    assert 1<=visible<=8,visible
    more=metrics.locator('.layout-more-metrics')
    if more.count():
        before=visible
        more.click()
        after=metrics.locator('.research-card:visible,.company-kpi:visible').count()
        assert after>before,(before,after)
        more.click()
        assert metrics.locator('.research-card:visible,.company-kpi:visible').count()==before
    for link in page.locator('#research-overview .research-primary-sources a').all():
        assert link.get_attribute('href').startswith('https://www.sec.gov/') or link.get_attribute('href').startswith('https://sec.gov/')
    assert not errors,errors
    browser.close()
print('PASS Release B source documents, focused research and price/adjusted return basis')
