"""Terminal 3 visual contract: all desktop ETF horizons, smaller screens without horizontal scrolling."""
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

html=Path(sys.argv[1]).read_text()
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),
                              headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('http://localhost:8765/**',lambda r:r.fulfill(body=html,content_type='text/html'))
    page.goto('http://localhost:8765/',wait_until='domcontentloaded',timeout=120000)
    page.locator('#tab-etfs').dispatch_event('click')
    page.wait_for_timeout(200)
    headers=page.locator('#etf-tracker-panel .etf-table thead th')
    assert headers.all_text_contents()==['Fund / ticker','TER','P/S','Fund size','1D','1W','1M','1Y','3Y','5Y','Cmp']
    for width in [1440,1024,390]:
        page.set_viewport_size({'width':width,'height':900})
        page.wait_for_timeout(150)
        assert page.locator('.etf-table-scroll').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),width
        assert page.evaluate('document.body.scrollWidth<=innerWidth+1'),width
        assert headers.nth(8).is_visible(),('3Y hidden',width)
        assert headers.nth(9).is_visible(),('5Y hidden',width)
        if width==1440:
            assert headers.nth(4).is_visible() and headers.nth(5).is_visible(),width
        else:
            assert not headers.nth(4).is_visible(),width
        assert headers.nth(5).is_visible(),('1W hidden',width)
        if width==390:
            assert not headers.nth(3).is_visible(),('fund size should be in detail on phone')
        page.screenshot(path=f'/tmp/compact-terminal3-etf-{width}.png')
    assert not errors,errors
    browser.close()
print('PASS Terminal 3 ETF responsive eleven-column contract')
