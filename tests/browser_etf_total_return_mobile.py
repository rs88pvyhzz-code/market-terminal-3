"""ETF benchmark and iPhone regression. Synthetic fixtures never reach production."""
import datetime as dt
import json,os,re,sys
from pathlib import Path
from playwright.sync_api import sync_playwright

html=Path(sys.argv[1]).read_text()
match=re.search(r'window\.MT_DATA\s*=\s*',html)
assert match,'Terminal snapshot missing'
data,end=json.JSONDecoder().raw_decode(html[match.end():])
assert data.get('demo') is True,'The synthetic benchmark fixture must never overwrite production prices'
funds=data['etfTracker']['funds']
bench_symbols=['VWRP.L','CSPX.L','VUAG.L','VMIG.L','VUKE.L','EIMI.L','SPOL.L','VGOV.L','VAGP.L']
confirmed={f['symbol'] for f in funds}
for must in ['VWRP.L','CSPX.L','VMIG.L','SPOL.L']:
    assert must in confirmed,('Required catalogue ETF missing',must)
start=dt.date(2020,1,1);enddate=dt.date(2026,11,16)
history=[]
for symbol in bench_symbols:
    if symbol not in confirmed:continue
    ticks=[];d=start;i=0
    while d<=enddate:
        scale={'SPOL.L':1.00050,'VWRP.L':1.00065,'CSPX.L':1.00083,'VUAG.L':1.00081,
               'VMIG.L':1.00045,'VUKE.L':1.00040,'EIMI.L':1.00055,'VGOV.L':1.00020,'VAGP.L':1.00018}[symbol]
        # Price excludes cash distributions. Adjusted close includes them.
        price=100*scale**i
        adjusted=price*(1.00018**i)
        ticks.append([d.isoformat(),round(price,6),round(adjusted,6)])
        d+=dt.timedelta(days=7);i+=1
    history.append({'symbol':symbol,'points':ticks})
    fund=next(f for f in funds if f['symbol']==symbol)
    fund['quote']={'symbol':symbol,'price':ticks[-1][1],'currency':'GBP',
                   'asOf':ticks[-1][0],'source':'Synthetic UI test fixture'}
    fund['quoteStatus']='Quoted'
data['etfTracker']['history']=[x for x in data['etfTracker'].get('history',[]) if x['symbol'] not in bench_symbols]+history
page_html=html[:match.end()]+json.dumps(data).replace('</','<\\/')+html[match.end()+end:]

with sync_playwright() as playwright:
    args={'headless':True,'args':['--no-sandbox']}
    if os.environ.get('CHROMIUM_EXECUTABLE'):args['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
    browser=playwright.chromium.launch(**args)
    for width,height in [(1440,900),(1024,768),(768,1024),(430,900),(390,844),(375,812),(320,740)]:
        context=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<700,
                                    has_touch=width<700,device_scale_factor=2 if width<700 else 1)
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('http://localhost:8765/**',lambda route:route.fulfill(body=page_html,content_type='text/html'))
        page.goto('http://localhost:8765/',wait_until='domcontentloaded',timeout=120000)
        page.locator('#tab-etfs').dispatch_event('click')
        page.locator('#etf-search').fill('SPOL.L')
        page.locator('#etf-rows [data-etf-symbol="SPOL.L"]').click()
        page.locator('#etf-search').fill('')
        page.wait_for_timeout(120)
        assert page.locator('#etf-period').is_visible(),('period selector missing',width)
        assert page.locator('#etf-benchmark').is_visible(),('benchmark selector missing',width)
        assert page.locator('#layout-etf-performance #etf-period').count()==1,('controls separated from chart',width)
        assert page.locator('#etf-period option').evaluate_all('(items)=>items.map(i=>i.value)')==['1M','1Y','3Y','5Y','MAX']
        assert page.locator('#etf-benchmark').input_value()=='AUTO'
        print('BENCHMARK SELECTOR',width,'SELECTED',page.locator('#etf-selected').text_content(),
              'AUTO',page.locator('#etf-benchmark option').first.text_content(),
              'OPTIONS',page.locator('#etf-benchmark option').all_text_contents(),flush=True)
        assert 'SPOL.L' in page.locator('#etf-selected').text_content(),('selection did not change',width)
        assert 'VWRP' in page.locator('#etf-benchmark option').first.text_content()
        assert page.locator('#etf-chart svg path[stroke-width]').count()>=2,('ETF and reference need two lines',width)
        assert 'vs FTSE All-World' in page.locator('#etf-relative-outcome').inner_text(),width
        page.locator('#etf-benchmark').select_option('SP500')
        assert 'S&P 500' in page.locator('#etf-relative-outcome').inner_text()
        page.locator('#etf-benchmark').select_option('FTSE250')
        assert 'FTSE 250' in page.locator('#etf-relative-outcome').inner_text()
        for period in ['1M','1Y','3Y','5Y','MAX']:
            page.locator('#etf-period').select_option(period)
            assert page.locator('#etf-chart svg path[stroke-width]').count()>=2,('period graph',width,period)
            assert period in page.locator('#etf-chart-stamp').inner_text(),period
        page.locator('#etf-period').select_option('1Y')
        # A fund's published TR must use adjusted data, not the raw price.
        row=page.locator('#etf-rows tr[data-etf-symbol="SPOL.L"]')
        assert row.count()==1
        value=row.locator('td').nth(6).text_content()
        assert '%' in value,(width,value)
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),('body overflow',width)
        if width<700:
            assert page.locator('.etf-table-scroll').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),('ETF sideways scroll',width)
            assert page.locator('#etf-rows tr[data-etf-symbol="SPOL.L"] td').nth(6).is_visible()
            assert page.locator('#etf-rows tr[data-etf-symbol="SPOL.L"] td').nth(7).is_visible()
            assert page.locator('#etf-rows tr[data-etf-symbol="SPOL.L"] td').nth(8).is_visible()
            assert page.locator('#workspace-tabs').evaluate('(e)=>e.scrollWidth>e.clientWidth'),('mobile tab navigation',width)
        page.screenshot(path=f'/tmp/etf-total-return-{width}.png')
        assert not errors,(width,errors)
        context.close()
    # Negative control: genuine unadjusted price history is NOT total return.
    missing=json.loads(json.dumps(data))
    for item in missing['etfTracker']['history']:
        if item['symbol']=='SPOL.L':
            for point in item['points']:point[2]=None
    no_adjusted=html[:match.end()]+json.dumps(missing).replace('</','<\\/')+html[match.end()+end:]
    page=browser.new_page(viewport={'width':390,'height':844})
    page.route('http://localhost:8765/**',lambda route:route.fulfill(body=no_adjusted,content_type='text/html'))
    page.goto('http://localhost:8765/',wait_until='domcontentloaded',timeout=120000)
    page.locator('#tab-etfs').dispatch_event('click')
    page.locator('#etf-search').fill('SPOL.L')
    page.locator('#etf-rows [data-etf-symbol="SPOL.L"]').click()
    row=page.locator('#etf-rows tr[data-etf-symbol="SPOL.L"]')
    assert row.locator('td').nth(6).text_content().strip()=='—'
    assert 'No adjusted-price' in page.locator('#etf-chart').inner_text()
    browser.close()
print('PASS: ETF 1M/1Y/3Y/5Y/MAX, S&P/FTSE/global total-return proxies, truthful missing data, phone/tablet/desktop')
