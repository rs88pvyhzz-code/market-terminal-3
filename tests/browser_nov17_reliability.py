"""Regression for November screenshot issues: no additions to analytical engine."""
import os,re,sys,json
from pathlib import Path
from playwright.sync_api import sync_playwright
html=Path(sys.argv[1]).read_text()
m=re.search(r'window.MT_DATA\s*=\s*',html)
assert m,'Missing terminal data'
D=json.JSONDecoder().raw_decode(html[m.end():])[0]
with sync_playwright() as play:
    args={'headless':True,'args':['--no-sandbox']}
    if os.getenv('CHROMIUM_EXECUTABLE'):args['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
    browser=play.chromium.launch(**args)
    page=browser.new_page(viewport={'width':1024,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('http://localhost:8765/**',lambda route:route.fulfill(body=html,content_type='text/html'))
    page.goto('http://localhost:8765/',wait_until='domcontentloaded',timeout=120000)

    page.locator('#tab-analytics').dispatch_event('click')
    page.wait_for_timeout(180)
    assert page.locator('#score-panel').is_hidden(),'Duplicated Markets/Analytics matrix must be retired'
    assert page.locator('#mt-risk-comparison').is_visible()
    options=page.locator('#mt-risk-period option').all_text_contents()
    assert options==['1Y','3Y','5Y'],options
    for period in options:
        page.locator('#mt-risk-period').select_option(label=period)
        assert page.locator('#mt-risk-rows tr').count()==8
    page.locator('#mt-risk-currency').select_option('gbp')
    assert 'sterling' in page.locator('#mt-risk-note').inner_text().lower()
    page.locator('#mt-risk-currency').select_option('local')

    page.locator('#tab-fx').dispatch_event('click')
    page.wait_for_timeout(120)
    for q in D.get('quotes',[]):
        if not (isinstance(q.get('low52'),(int,float)) and q['low52']<=0 and
                isinstance(q.get('high52'),(int,float)) and q['high52']>0):continue
        row=page.locator('#watch-rows tr:not(.watch-section)').filter(has_text=q['name'])
        if row.count()==1:
            assert row.locator('td').nth(9).inner_text().strip()=='—',q['symbol']

    page.locator('#tab-watchlist').dispatch_event('click')
    page.wait_for_timeout(150)
    panel=page.locator('#personal-watchlist-panel')
    assert panel.locator('.watchlist-bottom').count()==1
    assert panel.evaluate('(n)=>n.lastElementChild?.classList.contains("watchlist-bottom")'), 'News must follow the analysis and confirmed changes'
    for link in panel.locator('#watchlist-news-stories a').all():
        assert not re.search(r'(?i)stock price,? news|quote (?:and|&) history|latest stock news and headlines',
                             link.inner_text()),'Generic quote navigation is not company news'

    page.locator('#tab-etfs').dispatch_event('click')
    page.wait_for_timeout(200)
    for width,expected in [(1024,6),(390,2)]:
        page.set_viewport_size({'width':width,'height':900})
        page.wait_for_timeout(100)
        cols=page.locator('#etf-detail-stats').evaluate(
            '(el)=>getComputedStyle(el).gridTemplateColumns.split(/\\s+/).filter(Boolean).length')
        assert cols==expected,(width,cols,expected)
    page.set_viewport_size({'width':1024,'height':900})

    page.locator('#tab-bonds').dispatch_event('click')
    page.wait_for_timeout(160)
    nav=page.locator('#layout-bond-tabs button')
    assert nav.count()==5
    conventional=[g for g in D.get('gilts',[]) if g.get('quoted') and not g.get('indexLinked')]
    if conventional:
        row=page.locator('#gilt-rows tr[data-isin="'+conventional[0]['isin']+'"]')
        if row.count():row.dispatch_event('click')
        selected=page.locator('#gilt-selected').inner_text()
        field=page.locator('#gilt-clean-input')
        field.fill('')
        field.press_sequentially('95.25',delay=20)
        assert field.input_value()=='95.25',field.input_value()
        tax=page.locator('#mt-gilt-tax-rate')
        tax.select_option('40')
        nav.nth(2).click()
        assert page.locator('#rates').is_visible()
        nav.nth(0).click()
        assert page.locator('#gilts').is_visible()
        assert page.locator('#gilt-selected').inner_text()==selected,'Bond subtab changed selection'
        assert field.input_value()=='95.25','Switching bonds tabs reset manual price'
        assert tax.input_value()=='40','Switching bonds tabs reset the tax assumption'
        rows=page.locator('#gilt-rows tr[data-isin]')
        if rows.count()>12:
            rows.nth(12).dispatch_event('click')
            page.wait_for_timeout(180)
            chosen=page.locator('#gilt-rows tr.selected')
            assert chosen.count()==1 and 'polish-cut' not in (chosen.get_attribute('class') or ''), 'Selected gilt after row 10 was hidden'
    assert not errors,errors
    browser.close()
print('PASS: Markets source guards, risk periods, no duplicate Analytics, watchlist news last, ETF facts, bond input/nav')
