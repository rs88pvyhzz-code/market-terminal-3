"""Visual contract: Terminal 3's semantic colours have consistent meanings.

Run with a synthetic demo built through build_site.py; the test modifies only
the disposable browser DOM, never public market observations or production data.
"""
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

html=Path(sys.argv[1]).read_text()
with sync_playwright() as playwright:
    executable=os.environ.get('CHROMIUM_EXECUTABLE')
    browser=playwright.chromium.launch(**({'executable_path':executable} if executable else {}),
                                       headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1024,'height':820})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('http://localhost:8765/**',lambda route:route.fulfill(body=html,content_type='text/html'))
    page.goto('http://localhost:8765/',wait_until='domcontentloaded',timeout=120000)
    page.evaluate("""() => {
       const specs=[
          ['#watchlist-risk-kpis','watchlist-stat','1Y MAX DRAWDOWN','-27.4%','t3-watch-draw'],
          ['#watchlist-risk-kpis','watchlist-stat','1Y VOLATILITY','27.4%','t3-watch-vol'],
          ['#watchlist-risk-kpis','watchlist-stat','1Y PRICE MOVE','+18.2%','t3-watch-return'],
          ['#company-kpis','company-kpi','DIVIDEND YIELD','0.50%','t3-company-yield'],
          ['#company-risk-kpis','watchlist-stat','1Y MAX DRAWDOWN','-31.4%','t3-company-draw'],
          ['#company-risk-kpis','watchlist-stat','1Y VOLATILITY','31.4%','t3-company-vol'],
          ['#company-risk-kpis','watchlist-stat','1Y PRICE MOVE','-10.5%','t3-company-return'],
          ['#rolling-kpis','analytic-stat','Primary annual volatility','29.8%','t3-analytic-vol'],
          ['#gilt-stats','r28-gilt-yield','Annualised gross YTM','4.51%','t3-gilt-ytm'],
          ['#gilt-stats','r28-gilt-yield','Cumulative cash return','-1.1%','t3-gilt-loss']
       ];
       for(const [selector,klass,label,value,id] of specs){
         const parent=document.querySelector(selector);
         if(!parent)throw new Error('Missing UI section '+selector);
         const box=document.createElement('div');box.id=id;box.className=klass;
         const k=document.createElement('div');k.className=klass==='analytic-stat'?'key':
              klass==='r28-gilt-yield'?'mini':'k';k.textContent=label;
         const v=document.createElement(klass==='r28-gilt-yield'?'strong':'div');
         if(klass!=='r28-gilt-yield')v.className=klass==='analytic-stat'?'val':'v';
         v.textContent=value;box.append(k,v);parent.append(box);
       }
       const val=document.querySelector('#valuation-rows'),row=document.createElement('tr');
       row.id='t3-earnings-yield';for(let i=0;i<9;i++){
         const td=document.createElement('td');
         td.textContent=i===4?'5.75%':i===7?'+1.20pp':'—';row.append(td);
       }val.append(row);
     }""")
    page.wait_for_function("""() => document.querySelector('#t3-watch-draw .v')?.classList.contains('t3-negative')
      && document.querySelector('#t3-company-vol .v')?.classList.contains('t3-volatility')
      && document.querySelector('#t3-earnings-yield td:nth-child(5)')?.classList.contains('t3-positive')""",
      timeout=10000)
    expectations={
      't3-watch-draw':('t3-negative','rgb(255, 116, 131)'),
      't3-watch-vol':('t3-volatility','rgb(139, 212, 255)'),
      't3-watch-return':('t3-positive','rgb(85, 219, 137)'),
      't3-company-yield':('t3-positive','rgb(85, 219, 137)'),
      't3-company-draw':('t3-negative','rgb(255, 116, 131)'),
      't3-company-vol':('t3-volatility','rgb(139, 212, 255)'),
      't3-company-return':('t3-negative','rgb(255, 116, 131)'),
      't3-analytic-vol':('t3-volatility','rgb(139, 212, 255)'),
      't3-gilt-ytm':('t3-positive','rgb(85, 219, 137)'),
      't3-gilt-loss':('t3-negative','rgb(255, 116, 131)')
    }
    for id,(klass,colour) in expectations.items():
        value=page.locator('#'+id+' > :last-child')
        assert klass in value.get_attribute('class').split(),(id,value.get_attribute('class'))
        assert value.evaluate('(n)=>getComputedStyle(n).color')==colour,(id,colour)
    cell=page.locator('#t3-earnings-yield td:nth-child(5)')
    assert cell.evaluate('(n)=>getComputedStyle(n).color')=='rgb(85, 219, 137)'
    # The quote's original UTC timestamp stays available via title; only its
    # calendar date is shown in the Markets table.
    datecell=page.locator('#watch-rows tr:not(.watch-section) td:last-child').first
    assert ':' not in datecell.text_content(),datecell.text_content()
    if datecell.text_content()!='—':
        assert datecell.get_attribute('title'), 'Exact quote date/time must remain in tooltip'
    page.locator('#tab-economics').dispatch_event('click')
    page.wait_for_timeout(300)
    # Changes are shown only when two genuine comparable observations exist.
    for change in page.locator('#macro-tiles .t3-econ-delta').all():
        text=change.text_content()
        assert any(t in text for t in ('↑ +','↓ −','No change vs prior')),text
        if text.startswith('↑ +'):assert 't3-positive' in change.get_attribute('class')
        if text.startswith('↓ −'):assert 't3-negative' in change.get_attribute('class')
    assert not errors,errors
    browser.close()
print('PASS Terminal 3 semantic colours: watchlist, company, analytics, yields, economics and Markets date-only')
