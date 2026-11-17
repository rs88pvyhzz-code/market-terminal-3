/* Terminal layout — the single source of truth for what appears on each tab.
 *
 * Rules enforced here (and checked by tests/browser_layout.py):
 *   1. Every section sits on exactly one tab.
 *   2. Market-wide analytics (risk, volatility, correlation, breadth, valuation
 *      proxies, signals) live on the Analytics tab. Analysis of a gilt, ETF or
 *      watched security stays on that tab; company analysis in Company Research.
 *   3. Duplicated or distracting panels are retired, not deleted: they are parked
 *      in a hidden container so older render code that still writes to them by id
 *      cannot throw.
 *
 * Sections are moved, never rebuilt, so every renderer keeps finding its nodes by
 * id. No figures are calculated or changed here.
 *
 * build_site.py injects this file inside the main application closure, straight
 * after init(), so it can reach paintWorkspace, activateWorkspace and the
 * renderers. It re-asserts the layout after every tab paint and after the other
 * layers' DOMContentLoaded/load handlers, because those move panels too.
 */
(function(){
'use strict';
const $L=id=>document.getElementById(id);

// Tab membership for everything except Analytics and Data Quality, in display order.
const TABS={
  // Key market news is the top-ranked stories; 'news' lists the rest without repeating them.
  overview:['news-visit-controls','overview-board','r24-conditions','r24-developments','news','r24-upcoming'],
  fx:['monitor'],
  equities:['equity-screener','constituents','movers'],
  companies:['companies'],
  bonds:['gilts','mt-gilt-tax','gilt-ladder','us-treasuries','us-spread-panel','rates','real','cross-rates','sovereign','corporate-credit'],
  etfs:['etf-tracker-panel'],
  economics:['macro','calendar','macro-surprise'],
  watchlist:['personal-watchlist-panel']
};

// Analytics tab: grouped by the subject the analysis is about.
// `scopes` are [outer, inner] class lists standing in for the panel's original
// ancestors, so CSS written as "#gilts .x" still applies after the move
// (build_site.py adds a ".scope-gilts .x" twin to every such rule).
// `source` is the tab where the subject (company, gilt, ETF, watched security) is chosen.
const ANALYTICS=[
  {key:'markets',title:'Markets',source:null,context:null,scopes:[['scope-view-fx'],[]],
   items:['mt-risk-comparison','score-panel','analytics-rolling','market-valuations','compare',
          'analytics-breadth','analytics-sectors','r23-market-conditions','r23-alerts','watchlist-freshness']}
  // Bonds, ETF and watchlist analysis now stay on their own tabs, beside the instrument.
];

// Company Research: company-specific analysis stays with the company it describes,
// in the research view where it is read. Listed panels are placed first, in order;
// anything else in the view (e.g. the full metrics grid) follows them.
const RESEARCH={
  'research-view-0':['research-overview','company-news-panel','company-price-block',
                     'company-benchmark-block','company-risk-panel','company-advanced','research-executive'],
  'research-view-3':['peer-panel'],
  'research-view-5':['research-warning-priority','forensic-panel']
};

// Company-level source coverage belongs with the other source diagnostics.
const QUALITY=['r29-coverage','company-coverage'];

// Duplicates and distractions. Kept in the DOM (hidden) so legacy renderers are safe.
const RETIRED_IDS=['r24-watch','r23-moves','r23-watch','headline','subview-fx-news'];
const RETIRED_SELECTORS=[
  '.terminal-subnav','.r25-section-links','#mt-bond-nav','.r210-research-jump',
  '.t11-quality-shortcut','.mt-quality-link'
];
// Methodology notes inside Company Research that add nothing to the figures shown.
const RETIRED_HEADINGS=['Dashboard rules'];

// Renderers to run when Analytics becomes visible: charts need a visible
// container to measure. Each is optional; a failure in one does not stop the rest.
const ANALYTICS_PAINT=[
  ()=>renderGilts(),()=>usSpread(),()=>renderRates(),
  ()=>renderEtfTracker(),()=>renderWatchlist(),()=>renderMarketBriefing()
];

const TAB_NAMES={companies:'Company Research',bonds:'Bonds & Rates',etfs:'ETF Trackers',watchlist:'My Watchlist'};

// Match visual navigation to keyboard navigation; stable IDs preserve deep links.
function orderNavigation(){
 const nav=$L('workspace-tabs');if(!nav)return;
 WORKSPACES.forEach((key,i)=>{const tab=$L('tab-'+key);if(tab&&nav.children[i]!==tab)nav.insertBefore(tab,nav.children[i]||null);});
}
function unwrapValuations(){
 const fold=$L('r212-valuation-fold'),panel=$L('market-valuations');
 if(fold&&panel){fold.before(panel);fold.remove();}
}
function sectionLinks(){
 for(const key of ['overview','equities','companies','analytics','economics','watchlist']){
  const view=$L('view-'+key),title=view?.querySelector(':scope > .workspace-title');if(!title)continue;
  const ids=key==='analytics'?ANALYTICS[0].items:key==='companies'?RESEARCH['research-view-0']:TABS[key];
  let nav=title.querySelector('.layout-jumps');if(!nav){nav=document.createElement('nav');nav.className='layout-jumps';nav.setAttribute('aria-label','Jump within '+key);title.append(nav);}
  const targets=(ids||[]).map(id=>$L(id)).filter(n=>n&&n.querySelector('h2,h3'));
  const sig=targets.map(n=>n.id).join('|');if(nav.dataset.targets===sig)continue;nav.dataset.targets=sig;nav.replaceChildren();
  for(const node of targets){const b=document.createElement('button');b.type='button';b.textContent=node.querySelector('h2,h3').textContent.replace(/ · .*/,'');
   b.onclick=()=>node.scrollIntoView({behavior:'smooth',block:'start'});nav.append(b);}
 }
}

function renderYieldSnapshot(){
 // Yield-curve summary: yield levels, change since the prior available observation, and 10Y minus 2Y.
 const rates=$L('rates');if(!rates)return;
 $L('layout-yield-snapshot')?.remove();
 let host=$L('layout-curve-strip');if(host&&host.dataset.ready)return;
 if(!host){host=document.createElement('div');host.id='layout-curve-strip';const head=rates.querySelector(':scope > .row');head?head.after(host):rates.prepend(host);}
 host.dataset.ready='yes';
 const TENORS=['2Y','5Y','10Y','20Y','30Y'];
 const MARKETS=[['UK · BoE spot',D.uk_rates,{'5Y':'gilt5y','10Y':'gilt10y','20Y':'gilt20y'}],
  ['US · Treasury',D.us_rates,{'2Y':'DGS2','5Y':'DGS5','10Y':'DGS10','20Y':'DGS20','30Y':'DGS30'}],
  ['Euro area · ECB',D.eu_rates,{'2Y':'eur2y','5Y':'eur5y','10Y':'eur10y','20Y':'eur20y','30Y':'eur30y'}]];
 const table=document.createElement('table');table.className='watch layout-curve-table';
 const head=document.createElement('tr');for(const t of ['',...TENORS,'10Y − 2Y (bp)','As of']){const th=document.createElement('th');th.textContent=t;if(t&&t!=='As of')th.className='n';head.append(th);}
 const thead=document.createElement('thead');thead.append(head);table.append(thead);
 const body=document.createElement('tbody');
 const bp=x=>{const r=Math.round(x);return (r>0?'+':r<0?'−':'')+Math.abs(r)+' bp';};
 for(const [name,rows,fields] of MARKETS){
  const tr=document.createElement('tr');const label=document.createElement('td');const [mk,src]=name.split(' · ');label.append(mk);if(src){const sp=document.createElement('span');sp.className='layout-curve-src';sp.textContent=' · '+src;label.append(sp);}tr.append(label);
  const valid=(rows||[]).filter(r=>Object.values(fields).some(f=>Number.isFinite(r[f])));
  const last=valid.at(-1),prev=valid.at(-2);
  const cell=(level,change)=>{const td=document.createElement('td');td.className='n';
   if(!Number.isFinite(level)){td.textContent='—';return td;}
   const v=document.createElement('div');v.textContent=level.toFixed(2)+'%';td.append(v);
   if(Number.isFinite(change)){const c=document.createElement('div');c.className='layout-curve-chg '+(change>0?'up':change<0?'down':'');c.textContent=bp(change);td.append(c);}
   return td;};
  for(const t of TENORS){const f=fields[t];tr.append(cell(f&&last?last[f]:NaN,f&&last&&prev&&Number.isFinite(prev[f])?(last[f]-prev[f])*100:NaN));}
  const s2=fields['2Y'],s10=fields['10Y'];
  const slope=r=>r&&s2&&Number.isFinite(r[s2])&&Number.isFinite(r[s10])?(r[s10]-r[s2])*100:NaN;
  const sl=slope(last),sp=slope(prev);
  const td=document.createElement('td');td.className='n';
  if(Number.isFinite(sl)){const v=document.createElement('div');v.textContent=bp(sl);td.append(v);
   if(Number.isFinite(sp)){const c=document.createElement('div');const d=sl-sp;c.className='layout-curve-chg '+(d>0?'up':d<0?'down':'');c.textContent=bp(d);td.append(c);}}
  else td.textContent='—';
  tr.append(td);
  const date=document.createElement('td');const observed=last?.date||'';
  date.textContent=/^\d{4}-\d{2}-\d{2}$/.test(observed)?observed.slice(8,10)+'/'+observed.slice(5,7)+'/'+observed.slice(2,4):(observed||'—');
  date.title='Actual source observation date: '+(observed||'unavailable')+'. Website refresh: '+(D.generatedAt||'unknown')+'.';tr.append(date);
  body.append(tr);
 }
 table.append(body);host.append(table);
 const note=document.createElement('p');note.className='note layout-curve-explainer';
 note.textContent='Large figures: yield levels (%). Small figures: changes in basis points since the previous available source observation, not necessarily the previous calendar day. 10Y − 2Y measures curve steepness; positive means the 10-year yield is higher. UK spot, US Treasury and ECB curves use different methods. Dates are observations, not website update times; — means not available.';
 host.append(note);
}

function renderWatchFreshness(){
 let host=$L('watchlist-freshness');if(!host){host=document.createElement('section');host.id='watchlist-freshness';host.className='panel';$L('view-analytics')?.append(host);}
 const expected=watchExpectedDate(),stale=watchlistRecords.map(w=>({w,q:watchQuoteMap.get(w.symbol)})).filter(({q})=>!q?.asOf||q.asOf.slice(0,10)<expected);
 const signature=expected+'|'+stale.map(({w,q})=>w.symbol+':'+q?.asOf).join('|');if(host.dataset.signature===signature)return;host.dataset.signature=signature;
 host.replaceChildren(el('h2','','WATCHLIST QUOTE FRESHNESS'));
 host.append(el('p','note','Expected weekday close: '+expected+'. Weekends excluded; exchange holidays may also explain older quotes.'));
 if(!stale.length)host.append(el('p','','All watchlist quotes meet the weekday freshness check.'));
 for(const {w,q} of stale)host.append(el('p','',w.name+' · '+(q?.asOf?.slice(0,10)||'No dated quote')));
}
function orderDetailContent(){
 // The price table answers the first Markets question; history follows selection.
 const monitor=$L('monitor'),table=$L('watch-rows')?.closest('.scroll');
 if(monitor&&table&&!$L('layout-market-prices')){
  const group=$L('group-pills')?.closest('.inputs'),head=group?.previousElementSibling;
  const prices=document.createElement('section');prices.id='layout-market-prices';
  if(head&&group){prices.append(head,group,table);monitor.prepend(prices);}
 }
 const risk=$L('watchlist-risk')||document.querySelector('#personal-watchlist-panel .watchlist-risk');
 const history=$L('watchlist-history-meta')?.closest('.row');
 if(risk&&history&&history.previousElementSibling!==risk)history.before(risk);
 for(const node of [$L('watchlist-relative-meta')?.closest('.row'),$L('watchlist-relative-chart'),document.querySelector('.watchlist-relative-legend')])if(node)node.hidden=true;
 const watch=$L('personal-watchlist-panel'),news=watch?.querySelector('.watchlist-bottom'),selected=watch?.querySelector('.watchlist-selected-header');
 if(news&&selected&&selected.nextElementSibling!==news)selected.after(news);
 // Selected bond cash returns precede the history chart, retaining all controls.
 const stats=$L('gilt-stats'),chart=$L('gilt-chart');
 if(stats&&chart&&stats.parentElement===chart.parentElement&&stats.compareDocumentPosition(chart)&Node.DOCUMENT_POSITION_PRECEDING)chart.before(stats);
}

function parking(){
  let p=$L('layout-retired');
  if(!p){p=document.createElement('div');p.id='layout-retired';p.hidden=true;p.setAttribute('aria-hidden','true');document.body.append(p);}
  return p;
}

// Give id-less panels stable ids so they can be placed like everything else.
function tagAnonymous(){
  const wr=document.querySelector('#personal-watchlist-panel .watchlist-risk:not([id])');
  if(wr)wr.id='watchlist-risk';
  const detail=document.querySelector('#etf-tracker-panel .etf-detail');
  wrapEtf('layout-etf-performance',detail,()=>{
    const chartEl=$L('etf-chart');if(!chartEl)return [];
    const head=$L('etf-chart-stamp')?.closest('div');
    return [head,detail?.querySelector('.etf-plot-controls'),chartEl,$L('etf-relative-outcome'),$L('etf-chart-note')].filter(Boolean);
  });
  wrapEtf('layout-etf-risk',detail,()=>{
    const stats=$L('etf-risk-stats');if(!stats)return [];
    const head=stats.previousElementSibling&&/RISK/i.test(stats.previousElementSibling.textContent)?stats.previousElementSibling:null;
    return [head,stats].filter(Boolean);
  });
}
// Wrapper sections are rebuilt from the live nodes each time, so a renderer that
// recreates the ETF detail can never leave a stale copy behind.
function wrapEtf(id,detail,collect){
  const nodes=collect();if(!nodes.length)return;
  let w=$L(id);
  if(!w){w=document.createElement('section');w.id=id;w.className='layout-subpanel';}
  if(nodes.some((n,i)=>w.children[i]!==n)||w.children.length!==nodes.length)w.replaceChildren(...nodes);
  if(!w.parentElement&&detail)detail.append(w);
}

function place(container,ids){
  let prev=null;
  for(const id of ids){
    const node=$L(id);if(!node||node===container)continue;
    // Leave a node where it is if it sits inside another listed item (e.g. a fold).
    if(ids.some(x=>{const o=$L(x);return o&&o!==node&&o.contains(node);}))continue;
    const want=prev?prev.nextElementSibling:firstContentSlot(container);
    if(node.parentElement!==container||node!==want){
      if(prev)prev.after(node);else{const slot=firstContentSlot(container);slot?container.insertBefore(node,slot):container.append(node);}
    }
    prev=node;
  }
}
function firstContentSlot(container){
  for(const c of container.children)if(!c.classList.contains('workspace-title')&&!c.classList.contains('layout-group-head'))return c;
  return null;
}

function analyticsGroup(view,g){
  let box=$L('layout-analytics-'+g.key);
  if(!box){
    box=document.createElement('div');box.id='layout-analytics-'+g.key;
    box.className=['layout-group',...g.scopes[0]].join(' ');
    const head=document.createElement('div');head.className='layout-group-head';
    const h=document.createElement('h2');h.textContent=g.title;head.append(h);
    if(g.context){const p=document.createElement('p');p.className='layout-context';p.id='layout-context-'+g.key;head.append(p);}
    if(g.source){const b=document.createElement('button');b.type='button';b.className='btn layout-source';
      b.textContent='Change in '+TAB_NAMES[g.source];b.onclick=()=>activateWorkspace(g.source);head.append(b);}
    const body=document.createElement('div');body.id='layout-body-'+g.key;
    body.className=['layout-group-body',...g.scopes[1]].join(' ');
    box.append(head,body);
  }
  if(box.parentElement!==view)view.append(box);
  return $L('layout-body-'+g.key);
}

// Company Research: the reported snapshot figures join the overview tiles as one
// block, instead of a separate "All reported snapshot metrics" section further down.
// Figures already shown in the overview tiles (day move, market capitalisation) are
// hidden from the merged grid, not deleted. Re-run after every company render,
// because that render rebuilds the overview and its snapshot section.
const SNAPSHOT_DUPLICATES=/^(day move|market capitali[sz]ation)$/i;
// One grid read in a fixed order: price & valuation, size & growth, profitability,
// then cash & balance sheet. Tiles stay inside their own grids (renderers rebuild
// them); the shared wrapper orders them with CSS order, so nothing is copied.
const METRIC_GROUPS=[
  ['Price & valuation',[/^price$/,/^market capitali[sz]ation$/,/^valuation$/,/^trailing p\/e/,/^forward p\/e/,/^price \/ book/,/^ev \/ ebitda/,/^eps/,/^dividend yield/]],
  ['Size & growth',[/^revenue · ttm/,/^revenue · fy/,/^revenue growth/,/^ebitda/,/^operating profit/,/^net profit · ttm/,/^net profit · fy/]],
  ['Profitability',[/^profit margin/,/^profitability/,/^calculated return on equity/,/^return on equity/,/^return on/]],
  ['Cash & balance sheet',[/^cash generation/,/^free cash flow/,/^total debt/,/^financial strength/,/^net debt/]]
];
function metricOrder(label){
  const l=label.trim().toLowerCase();let n=0;
  for(let g=0;g<METRIC_GROUPS.length;g++){
    for(let i=0;i<METRIC_GROUPS[g][1].length;i++)if(METRIC_GROUPS[g][1][i].test(l))return (g+1)*100+i+1;
  }
  return 900;
}
function mergeSnapshot(park){
  const kpis=$L('company-kpis'),dash=document.querySelector('#research-overview .research-dashboard');
  if(!kpis||!dash)return;
  const holder=kpis.closest('.research-detail');
  let wrap=dash.parentElement.classList.contains('layout-metrics')?dash.parentElement:null;
  if(!wrap){
    wrap=document.createElement('div');wrap.className='layout-metrics';
    METRIC_GROUPS.forEach(([title],g)=>{const h=document.createElement('div');h.className='layout-metrics-head';h.textContent=title;h.style.order=String((g+1)*100);wrap.append(h);});
    dash.before(wrap);wrap.append(dash);
  }
  if(kpis.parentElement!==wrap)wrap.append(kpis);
  kpis.classList.add('layout-merged-kpis');
  for(const tile of kpis.children){const label=(tile.firstElementChild&&tile.firstElementChild.textContent||'').trim();tile.hidden=SNAPSHOT_DUPLICATES.test(label);}
  const trailing=[...dash.children].find(t=>/^trailing p\/e$/i.test(t.firstElementChild?.textContent.trim()||''));
  for(const tile of kpis.children)if(/^trailing p\/e$/i.test(tile.firstElementChild?.textContent.trim()||'')&&trailing&&trailing.children[1]?.textContent!=='—')tile.hidden=true;
  const calculated=[...dash.children].find(t=>/^calculated return on equity$/i.test(t.firstElementChild?.textContent.trim()||''));
  const reported=[...kpis.children].find(t=>/^return on equity$/i.test(t.firstElementChild?.textContent.trim()||''));
  if(calculated&&reported&&calculated.children[1]?.textContent!=='—'&&calculated.children[1]?.textContent===reported.children[1]?.textContent)reported.hidden=true;
  for(const tile of [...dash.children,...kpis.children]){const label=tile.firstElementChild&&tile.firstElementChild.textContent||'';tile.style.order=String(metricOrder(tile.dataset.metricLabel||label));}

  if(holder&&!holder.contains(kpis)&&!park.contains(holder)){
    const rest=[...holder.children].filter(c=>!c.matches('h3,h4,summary,.r24-support-heading'));
    if(!rest.length)park.append(holder);
  }
}

// Repeated caveats the reader already knows (causation, methodology) are removed
// wherever a renderer writes them. Whole notes that are only a caveat are hidden;
// a caveat sentence inside a longer plain-text note is cut out.
const CAVEAT_SENTENCES=[
  /[^.]*\bnot (?:proof|evidence) (?:of|that)[^.]*causa[^.]*\.?/gi,
  /[^.]*\bno (?:price |event-to-price )?caus(?:ation|e)[^.]*inferred[^.]*\.?/gi,
  /[^.]*\bRelated (?:headlines|articles) are[^.]*\.?/gi,
  /[^.]*\bnot verified causes[^.]*\.?/gi,
  /[^.]*\bCheck company announcements, dividends, splits[^.]*\.?/gi,
  /[^.]*\bVerify company announcements and corporate actions[^.]*\.?/gi,
  /\s*·\s*Existing alert threshold crossed[^·]*/gi
];
function stripCaveats(root){
  const scope=root||$L('workspace-stage');if(!scope)return;
  scope.querySelectorAll('.note,.mini,p,.r23-observation>div,.watchlist-kpis>*>:nth-child(3)').forEach(n=>{
    if(n.dataset.caveatChecked===n.textContent)return;
    if(n.closest('#company-coverage-gaps,.research-warning,.mt-inline-notice'))return;
    if(n.children.length===0){
      let t=n.textContent;const orig=t;
      for(const re of CAVEAT_SENTENCES)t=t.replace(re,'');
      t=t.replace(/\s{2,}/g,' ').trim();
      if(t!==orig.trim()){if(!t||/^[·.,;:\s]*$/.test(t))n.hidden=true;else n.textContent=t;}
    }
    n.dataset.caveatChecked=n.textContent;
  });
  scope.querySelectorAll('details').forEach(d=>{const s=d.querySelector('summary');if(s&&/^News methodology$/i.test(s.textContent.trim()))d.hidden=true;});
}

// ---------------------------------------------------------------- Release 3.3
// Overview pulse: equity indices, then currencies, bond yields, VIX, gold, Brent, bitcoin.
const PULSE_ORDER=[/^FTSE 100/,/^S&P 500/,/^Nasdaq/,/STOXX 600/,/Nikkei/,/Emerging/,/^GBP\/USD/,/^GBP\/EUR/,/^EUR\/USD/,
  /UK 10Y/,/US 10Y/,/^VIX/,/^Gold/,/^Brent/,/^Bitcoin/];
function orderPulse(){
  document.querySelectorAll('#overview-board .r24-snapshot-item').forEach(item=>{
    const label=(item.firstElementChild&&item.firstElementChild.textContent||'').trim();
    const i=PULSE_ORDER.findIndex(re=>re.test(label));item.style.order=String(i<0?50:i);
  });
}

// ETF Trackers: catalogue counts belong in Data Quality; tidy duplicated or hedged labels.
function tidyEtf(){
  const panel=$L('etf-tracker-panel');if(!panel)return;
  const stats=$L('etf-stats'),quality=$L('mt-other-audits')||$L('view-quality');
  if(stats&&quality&&!quality.contains(stats)){
    const box=$L('layout-etf-coverage')||document.createElement('section');
    if(!box.id){box.id='layout-etf-coverage';box.className='panel';const h=document.createElement('h2');h.textContent='ETF CATALOGUE COVERAGE';box.append(h);}
    const head=panel.querySelector(':scope > .row');
    if(head)head.querySelectorAll('.note,.mini,p,span').forEach(n=>{if(!n.closest('h2')){box.append(n);} });
    box.append(stats);quality.append(box);
  }
  panel.querySelectorAll('*').forEach(n=>{
    if(n.children.length===0&&/\(submethod not confirmed\)/.test(n.textContent))n.textContent=n.textContent.replace(/\s*\(submethod not confirmed\)/g,'');
  });
  panel.querySelectorAll('.etf-stat-grid').forEach(grid=>{
    const tiles=[...grid.children],label=t=>(t.firstElementChild&&t.firstElementChild.textContent||'').trim().toLowerCase();
    if(tiles.some(t=>/^fund assets/.test(label(t))))tiles.forEach(t=>{if(label(t)==='fund size')t.classList.add('layout-hidden');});
  });
}

// ETF alternatives: the selected fund beside up to three funds tracking the same
// market (then closely related markets), largest first, on cost, size and returns.
const ETF_RELATED={'Global':['Developed world'],'Developed world':['Global'],'Europe':['Eurozone'],'Eurozone':['Europe'],
  'UK FTSE 100':['UK FTSE All Share','UK FTSE 250'],'UK FTSE 250':['UK FTSE 100','UK FTSE All Share'],'UK FTSE All Share':['UK FTSE 100','UK FTSE 250'],
  'Emerging markets':['EM ex China'],'EM ex China':['Emerging markets'],'United States':['US equal weight','US small cap','US technology'],
  'US technology':['United States'],'UK gilts':['UK short gilts'],'UK short gilts':['UK gilts'],
  'US Treasury 7-10y':['US Treasury 3-7y','US Treasury long dated'],'US Treasury 1-3y':['US Treasury 0-1y','US Treasury 3-7y'],
  'Global aggregate bond':['Global aggregate GBP hedged'],'Global aggregate GBP hedged':['Global aggregate bond'],
  'USD investment grade':['EUR investment grade','UK investment grade'],'China':['Asia Pacific ex Japan'],'Latin America':['Brazil','Mexico']};
function etfAlternatives(fund){
  const same=ETF_FUNDS.filter(f=>f.symbol!==fund.symbol&&f.market===fund.market&&f.category===fund.category);
  const related=(ETF_RELATED[fund.market]||[]).flatMap(m=>ETF_FUNDS.filter(f=>f.market===m&&f.category===fund.category));
  const bySize=a=>a.sort((x,y)=>(y.fundSize||0)-(x.fundSize||0));
  return [...bySize(same),...bySize(related)].slice(0,3);
}
function etfMoney(f){
  if(!Number.isFinite(f.fundSize)||!f.fundSize)return '—';
  const v=f.fundSize,c=f.fundSizeCurrency||'';return ((({USD:'$',GBP:'£',GBp:'£',GBX:'£',EUR:'€',JPY:'¥'})[c])??(c+' '))+(v>=1e9?fmt(v/1e9,2)+'bn':fmt(v/1e6,1)+'m');
}
function etfPct(v){return Number.isFinite(v)?(v>0?'+':'')+fmt(v,2)+'%':'—';}
function renderEtfAlternatives(){
  const detail=document.querySelector('#etf-tracker-panel .etf-detail');if(!detail||typeof ETF_BY_SYMBOL==='undefined')return;
  const fund=ETF_BY_SYMBOL.get(etfState.selected);if(!fund)return;
  let box=$L('layout-etf-alternatives');
  if(!box){box=document.createElement('section');box.id='layout-etf-alternatives';box.className='layout-subpanel';}
  if(box.dataset.fund===fund.symbol+'|'+[...etfState.compared].join(',')&&box.isConnected)return;
  box.dataset.fund=fund.symbol+'|'+[...etfState.compared].join(',');box.replaceChildren();
  const h=document.createElement('h3');h.textContent='ALTERNATIVES — '+String(fund.market||'').toUpperCase();box.append(h);
  const alts=etfAlternatives(fund);
  if(!alts.length){const p=document.createElement('p');p.className='note';p.textContent='No other catalogued fund tracks this market.';box.append(p);}
  else{
    const wrap=document.createElement('div');wrap.className='mt-table-scroll';
    const t=document.createElement('table');t.className='watch layout-alt-table';
    t.innerHTML='<thead><tr><th>Fund / ticker</th><th>Index</th><th>TER</th><th>Fund size</th><th>1Y</th><th>3Y</th><th>5Y</th><th>P/S</th><th>Income</th><th>Chart</th></tr></thead>';
    const tb=document.createElement('tbody');
    for(const f of [fund,...alts]){
      const tr=document.createElement('tr');if(f===fund)tr.className='selected';
      const cells=[null,f.benchmark||'—',Number.isFinite(f.terPct)?fmt(f.terPct,2)+'%':'—',etfMoney(f),etfPct(f.return1Y),etfPct(f.return3Y),etfPct(f.return5Y),
        (r=>/synthetic|swap/i.test(r)?'S':/physical|full|sampl|optimi/i.test(r)?'P':'?')(String(f.replication||'')),f.distribution||'—'];
      const name=document.createElement('td');const b=document.createElement('button');b.type='button';b.className='layout-alt-pick';
      b.textContent=f.name+' · '+f.symbol;b.disabled=f===fund;b.onclick=()=>{etfState.selected=f.symbol;try{renderEtfTracker();}catch(e){}renderEtfAlternatives();};
      name.append(b);tr.append(name);
      cells.slice(1).forEach((c,i)=>{const td=document.createElement('td');td.textContent=c;if(i>=3&&i<=5&&/^[+-]/.test(c))td.className=c.startsWith('-')?'down':'up';tr.append(td);});
      const choice=document.createElement('td');if(f!==fund){const check=document.createElement('input');check.type='checkbox';check.checked=etfState.compared.has(f.symbol);check.setAttribute('aria-label','Compare '+f.name);check.onchange=()=>etfV5ChangeCompare(f.symbol,check.checked);choice.append(check);}else choice.textContent='Selected';tr.append(choice);
      tb.append(tr);
    }
    t.append(tb);wrap.append(t);box.append(wrap);
    const p=document.createElement('p');p.className='note';
  }
  const anchor=detail.querySelector('.etf-stat-grid');
  if(anchor)anchor.after(box);else detail.prepend(box);
}

// Data Quality: collection warnings grouped by source in plain language.
function plainWarning(w){
  const s=String(w);
  if(/429|Too Many Requests/i.test(s))return 'Source limited request rate; retried, then skipped';
  if(/404|Not Found|delisted/i.test(s))return 'No longer available from source';
  if(/Under two historical closes|insufficient|too short/i.test(s))return 'Too little price history to use';
  if(/stale cache/i.test(s))return 'Download failed; last saved copy used';
  if(/timed? ?out|timeout/i.test(s))return 'Source did not respond in time';
  return s.replace(/^[^:]+:\s*/,'');
}
function renderWarnings(){
  const old=$L('t11-exception-details');if(!old)return;
  const list=Array.isArray(D.warnings)?D.warnings:[];
  let box=$L('layout-warnings');
  if(!box){box=document.createElement('section');box.id='layout-warnings';box.className='panel';old.before(box);}
  if(box.dataset.count===String(list.length))return;box.dataset.count=String(list.length);box.replaceChildren();
  const h=document.createElement('h2');h.textContent='COLLECTION ISSUES THIS BUILD ('+list.length+')';box.append(h);
  const groups=new Map();
  for(const w of list){const s=String(w);const m=s.match(/^([A-Za-z][A-Za-z/& ]{1,20}?)\s+([^:]{1,40}):/);const src=m?m[1]:'Other';const item=m?m[2]:'';
    const key=src+'|'+plainWarning(s);if(!groups.has(key))groups.set(key,{src,issue:plainWarning(s),items:[]});if(item)groups.get(key).items.push(item);}
  const t=document.createElement('table');t.className='watch';t.innerHTML='<thead><tr><th>Source</th><th>What happened</th><th>Affected</th></tr></thead>';
  const tb=document.createElement('tbody');
  for(const g of groups.values()){const tr=document.createElement('tr');for(const c of [g.src,g.issue,g.items.length?g.items.join(', '):'—']){const td=document.createElement('td');td.textContent=c;tr.append(td);}tb.append(tr);}
  t.append(tb);const wrap=document.createElement('div');wrap.className='mt-table-scroll';wrap.append(t);box.append(wrap);
  old.hidden=true;
}

// Sovereign yields: one table of 10-year yields for the major economies, no chart.
function lastTwo(arr,field){const v=(arr||[]).filter(r=>Number.isFinite(Number(r[field])));return v;}
function changeBp(pts,days){
  const last=pts.at(-1);if(!last)return null;const cutoff=new Date(new Date(last.date).getTime()-days*864e5).toISOString().slice(0,10);
  const base=[...pts].reverse().find(p=>p.date<=cutoff);return base?Math.round((last.v-base.v)*100):null;
}
function renderSovereignTable(){
  const host=$L('sovereign');if(!host)return;
  const series=[];
  const add=(name,rows,field,source)=>{const pts=(rows||[]).filter(r=>r[field]!=null&&r[field]!==''&&Number.isFinite(Number(r[field]))).map(r=>({date:r.date,v:Number(r[field])}));if(pts.length)series.push({name,pts,source});};
  add('United Kingdom',D.uk_rates,'gilt10y','BoE spot');add('United States',D.us_rates,'DGS10','US Treasury');
  for(const [code,name] of [['DE','Germany'],['FR','France'],['IT','Italy'],['ES','Spain'],['NL','Netherlands']])add(name,D.sovereign_yields,code,'Eurostat monthly');
  if(!series.length)return;
  let box=$L('layout-sovereign-table');
  const sig=series.map(s=>s.name+s.pts.at(-1).date).join();if(box&&box.dataset.sig===sig)return;
  if(!box){box=document.createElement('div');box.id='layout-sovereign-table';const head=host.querySelector('.row');(head||host.firstElementChild).after(box);}
  box.dataset.sig=sig;box.replaceChildren();
  const de=series.find(s=>s.name==='Germany');
  const t=document.createElement('table');t.className='watch';t.innerHTML='<thead><tr><th>Country</th><th>10Y yield</th><th>As of</th><th>vs Germany</th><th>1M change</th><th>1Y change</th><th>Source</th></tr></thead>';
  const tb=document.createElement('tbody');
  for(const s of series){const last=s.pts.at(-1),spread=de&&s!==de?Math.round((last.v-de.pts.at(-1).v)*100):null;
    const c1=changeBp(s.pts,31),c12=changeBp(s.pts,365);
    const vals=[s.name,fmt(last.v,2)+'%',last.date,spread==null?'—':(spread>0?'+':'')+spread+'bp',c1==null?'—':(c1>0?'+':'')+c1+'bp',c12==null?'—':(c12>0?'+':'')+c12+'bp',s.source];
    const tr=document.createElement('tr');vals.forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td);});tb.append(tr);}
  t.append(tb);const wrap=document.createElement('div');wrap.className='mt-table-scroll';wrap.append(t);box.append(wrap);
  const h2=host.querySelector('h2');if(h2)h2.textContent='SOVEREIGN 10-YEAR YIELDS';
  const intro=host.querySelector('.row .note');if(intro)intro.textContent='Latest 10-year government bond yields. UK uses the Bank of England spot curve; euro-area countries use Eurostat monthly benchmarks, so their dates lag.';
  for(const id of ['sovereign-chart','sovereign-latest','sovereign-meta'])$L(id)?.classList.add('layout-hidden');
  host.querySelectorAll('select').forEach(sel=>{(sel.closest('label')||sel).classList.add('layout-hidden');const l=host.querySelector('label[for="'+sel.id+'"]');if(l)l.classList.add('layout-hidden');});
  host.querySelectorAll('details').forEach(d=>d.classList.add('layout-hidden'));
}

// Bonds & Rates: five sub-tabs instead of one long page.
const BOND_TABS=[['UK gilts',['gilts','mt-gilt-tax','gilt-ladder']],['US Treasuries',['us-treasuries','us-spread-panel']],['Yield curves',['rates','real','cross-rates']],['Credit spreads',['corporate-credit']],['Sovereign',['sovereign']]];
let bondTab=0;
function bondTabFor(id){return BOND_TABS.findIndex(([,ids])=>ids.some(x=>x===id||$L(x)?.querySelector('#'+CSS.escape(id))));}
function renderBondTabs(){
  const view=$L('view-bonds');if(!view)return;
  let nav=$L('layout-bond-tabs');
  if(!nav){nav=document.createElement('nav');nav.id='layout-bond-tabs';nav.className='layout-subtabs';
    BOND_TABS.forEach(([label],i)=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.onclick=()=>{bondTab=i;renderBondTabs();try{paintWorkspace('bonds');}catch(e){}window.scrollTo({top:Math.max(0,view.offsetTop-80)});};nav.append(b);});}
  const title=view.querySelector(':scope > .workspace-title');
  if(nav.parentElement!==view||nav.previousElementSibling!==title){title?title.after(nav):view.prepend(nav);}
  [...nav.children].forEach((b,i)=>b.classList.toggle('active',i===bondTab));
  BOND_TABS.forEach(([,ids],i)=>ids.forEach(id=>$L(id)?.classList.toggle('layout-subtab-hidden',i!==bondTab)));
}
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(!id)return;const i=bondTabFor(id);if(i>=0&&i!==bondTab){bondTab=i;renderBondTabs();}});
{const id=location.hash.slice(1);const i=id?bondTabFor(id):-1;if(i>=0)bondTab=i;}

// Clean reading (Release 3.4): this terminal has one expert reader, so explanatory
// notes, caveats, source boilerplate, coverage counts and footers are removed from
// every tab except Data Quality. Kept: figures, tables, tiles with data, headlines
// and their dates, chart summaries, empty-state messages and controls.
const KEEP_NOTE=[/^(1D|1W|1M|3M|6M|YTD|1Y|3Y|5Y|10Y|MAX)\s*·/,/\bprice (?:move|change)[: ]/i,/^\d{4}-\d{2}-\d{2} to \d{4}/,/^No /,/^Showing \d+ of \d+/];
const DROP_SECTIONS=['etf-issuer-snapshot'];
const TILE_GRIDS='.etf-stat-grid,.research-stats,.watchlist-kpis,.etf-stat-grid,.analytic-cards,.research-dashboard,.company-kpis,.credit-kpis,.r28-gilt-yields,.r28-gilt-facts,.t11-ratios,.macro,.pulse-board,.layout-metrics,.r29-coverage-grid';
function cleanReading(){
  const stage=$L('workspace-stage');if(!stage)return;
  document.querySelectorAll('footer,[role=contentinfo]').forEach(f=>f.remove());
  // Keep the screener methodology once, in Data Quality, rather than as a footer.
  const screenNote=$L('screen-note'),quality=$L('view-quality');
  if(screenNote&&quality&&screenNote.parentElement!==quality){screenNote.classList.remove('screener-footnote','layout-hidden');quality.append(screenNote);}
  for(const id of DROP_SECTIONS){const n=$L(id);if(n)n.classList.add('layout-hidden');}
  stage.querySelectorAll('.r24-calendar-key,.r28-gilt-advanced,.r28-more').forEach(n=>{if(!n.closest('#view-quality'))n.classList.add('layout-hidden');});
  stage.querySelectorAll('p,.note,.mini,small').forEach(n=>{
    if(n.dataset.cleanChecked===n.textContent)return;n.dataset.cleanChecked=n.textContent;
    if(n.closest('.metric-commentary,#company-coverage-gaps,#news-visit-controls,#view-quality,table,label,button,select,summary,h1,h2,h3,h4,.news-item,.r24-item,.r23-observation,.layout-group-head,#layout-bond-tabs,.mt-reading-note,.r213-company-evidence,.company-story,.research-warning,.mt-inline-notice'))return;
    const text=n.textContent.trim();if(!text)return;
    // Research write-ups (outlook, statements, issuer evidence) are content: there only
    // purely explanatory lines (no figure or date) are removed.
    if(n.closest('.research-view:not(#research-view-0),.r23-company-changes')){if(!/\d/.test(text))n.classList.add('layout-hidden');return;}
    const tile=n.closest(TILE_GRIDS);
    if(tile){ // inside a data tile: keep captions that carry figures or dates
      if(n.parentElement&&n.parentElement.firstElementChild===n)return;   // tile label
      if(!/\d/.test(text))n.classList.add('layout-hidden');
      return;
    }
    if(KEEP_NOTE.some(re=>re.test(text)))return;
    n.classList.add('layout-hidden');
  });
  // Tile captions that only explain (no figure or date) go; captions with data stay.
  stage.querySelectorAll(TILE_GRIDS.split(',').map(g=>g+' > * > :nth-child(n+3)').join(',')).forEach(n=>{
    if(n.closest('#view-quality,.metric-commentary'))return;
    if(n.children.length===0&&!/\d/.test(n.textContent))n.classList.add('layout-hidden');
  });
  $L('company-dates')?.classList.add('layout-hidden');
  // Methodology fold-outs belong in Data Quality only.
  stage.querySelectorAll('details').forEach(d=>{
    if(d.closest('#view-quality'))return;
    const sum=d.querySelector(':scope > summary');if(sum&&/methodolog|source tables|how this is calculated/i.test(sum.textContent))d.classList.add('layout-hidden');
  });
  // Retrieval timestamps on article cards add nothing to the publisher date.
  stage.querySelectorAll('.news-item .meta,.r24-item .mini,.mini').forEach(n=>{
    if(n.children.length===0&&/ · retrieved \d{4}-\d{2}-\d{2}T[\d:.+]+/.test(n.textContent))n.textContent=n.textContent.replace(/\s*·\s*retrieved \d{4}-\d{2}-\d{2}T[\d:.+-]+(?::\d{2})?/g,'');
  });
}

function refreshContexts(){
  for(const g of ANALYTICS){
    const box=$L('layout-analytics-'+g.key);if(!box)continue;
    const filled=g.items.some(id=>{const n=$L(id);return n&&box.contains(n);});
    box.hidden=!filled;
    if(g.context){const p=$L('layout-context-'+g.key);if(p){const t=g.context();if(p.textContent!==t)p.textContent=t;}}
  }
}

let applying=false;
// Presentation only: retain raw labels for grouping; never rewrite source values.
function readableMetrics(){
  const acronym=/\b(?:US|UK|EU|FTSE|MSCI|S&P|GDP|CPI|PMI|TTM|FY|EPS|EBITDA|EV|ROE|ROIC|RSI|CAGR|GBP|USD|EUR|ETF|TER|OCF|P\/E|P\/B|\d+[YMDW])\b/g;
  function sentence(text){const keep=new Map();let i=0;const protectedText=text.replace(acronym,m=>{const key='zz'+i+++'zz';keep.set(key,m);return key;});let result=protectedText.toLowerCase();result=result.charAt(0).toUpperCase()+result.slice(1);for(const [key,value] of keep)result=result.replace(new RegExp(key,'i'),value);return result;}
  const stage=$L('workspace-stage');if(!stage)return;
  stage.querySelectorAll(TILE_GRIDS.split(',').map(g=>g+' > *').join(',')).forEach(tile=>{
    if(tile.classList.contains('layout-metrics-head')||tile.matches('.research-dashboard,.company-kpis'))return;
    const label=tile.firstElementChild,value=tile.children[1];if(!label||!value||label.children.length)return;
    const raw=tile.dataset.metricLabel||label.textContent;tile.dataset.metricLabel=raw;
    const next=sentence(raw).replace(/ · TTM/g,' — last 12 months').replace(/ · FY /g,' — FY ');
    if(label.textContent!==next)label.textContent=next;
    if(value.textContent.trim()==='Sector review'){tile.classList.add('metric-commentary');value.textContent='Review sector-specific measures';}
    if(tile.classList.contains('metric-commentary'))tile.querySelectorAll('.layout-hidden').forEach(n=>n.classList.remove('layout-hidden'));
    for(const note of [...tile.children].slice(2)){
      if(note.children.length)continue;
      const text=note.textContent;const next=text.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\+00:00|Z| UTC)?/g,rawDate=>{const d=new Date(rawDate.includes('T')?rawDate:rawDate.replace(' ','T').replace(' UTC','Z'));if(!Number.isFinite(+d))return rawDate;return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})+', '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';}).replace(/^Provider observation · /,'Updated ');
      if(next!==text){note.title=text;note.textContent=next;}
    }
  });
}

function applyLayout(){
  if(applying)return;applying=true;
  try{
    const sheet=$L('terminal-layout-styles');if(sheet&&document.head.lastElementChild!==sheet)document.head.append(sheet);
    tagAnonymous();
    orderNavigation();
    unwrapValuations();
    const park=parking();
    for(const id of RETIRED_IDS){const n=$L(id);if(n&&n.parentElement!==park)park.append(n);}
    for(const sel of RETIRED_SELECTORS)document.querySelectorAll(sel).forEach(n=>{if(!park.contains(n))park.append(n);});
    document.querySelectorAll('#companies .research-detail').forEach(sec=>{
      const h=sec.querySelector('.r24-support-heading,h3,summary');
      if(h&&RETIRED_HEADINGS.includes(h.textContent.trim())&&!park.contains(sec))park.append(sec);
    });
    for(const id of ['gilt-ladder','mt-gilt-tax']){const n=$L(id),g=$L('gilts');if(n&&g&&g.contains(n))g.after(n);} // gilt analysis sits under the gilt list
    for(const [key,ids] of Object.entries(TABS)){const view=$L('view-'+key);if(view)place(view,ids);}
    for(const [id,ids] of Object.entries(RESEARCH)){const view=$L(id);if(view)place(view,ids);}
    const executive=$L('research-executive'),research=$L('research-view-0');if(executive&&research&&research.lastElementChild!==executive)research.append(executive);
    mergeSnapshot(park);
    for(const step of [orderPulse,orderDetailContent,renderWatchFreshness,renderYieldSnapshot,tidyEtf,renderEtfAlternatives,renderWarnings,renderSovereignTable,renderBondTabs])
      {try{step();}catch(e){console.warn('Layout step skipped:',step.name,e&&e.message);}}
    const ws=$L('watchlist-summary');if(ws&&ws.parentElement!==park)park.append(ws);
    readableMetrics();
    stripCaveats();
    try{cleanReading();}catch(e){console.warn('Clean reading skipped:',e&&e.message);}
    const av=$L('view-analytics');
    if(av){for(const g of ANALYTICS)place(analyticsGroup(av,g),g.items);}
    const qv=$L('mt-other-audits')||$L('view-quality');
    if(qv)for(const id of QUALITY){const n=$L(id);if(n&&!qv.contains(n))qv.append(n);}
    // The Markets sub-view wrapper is redundant once its sub-navigation is gone.
    const sub=$L('subview-fx-prices');if(sub&&!sub.children.length&&sub.parentElement!==park)park.append(sub);
    refreshContexts();
    sectionLinks();
  }finally{applying=false;}
}

function runAnalyticsPaint(){
  for(const fn of ANALYTICS_PAINT){try{fn();}catch(e){console.warn('Layout repaint skipped:',e&&e.message);}}
}

// Company Research re-arranges its overview after every company render, outside
// the tab paint cycle; re-assert the layout straight after it.
const baseArrange=researchArrangeOverview;
researchArrangeOverview=function(){baseArrange();applyLayout();};

// Re-draw the alternatives table whenever the ETF tracker re-renders a selection.
try{const baseEtf=renderEtfTracker;renderEtfTracker=function(){const r=baseEtf.apply(this,arguments);try{renderEtfAlternatives();tidyEtf();}catch(e){}return r;};}catch(e){}

const basePaint=paintWorkspace;
paintWorkspace=function(key){
  applyLayout();
  try{basePaint(key);if(key==='analytics')runAnalyticsPaint();}
  finally{applyLayout();}
};

// UK government bond yields in Global prices, next to the US Treasury yields:
// Bank of England nominal zero-coupon spot yields (5/10/20Y) and the DMO-quoted
// 0 1/8% Treasury Gilt 2028 (TN28), whose yield uses the same model as Bonds & Rates.
// Rows are added to the snapshot once; their history feeds the price chart.
function ukYieldQuote(symbol,name,points,source,note){
  const pts=points.filter(p=>Number.isFinite(p.v)).sort((a,b)=>a.date.localeCompare(b.date));if(!pts.length)return null;
  const last=pts.at(-1),prev=pts.at(-2),lastDate=new Date(last.date+'T00:00:00Z');
  const yearStart=last.date.slice(0,4)+'-01-01';const ytdBase=[...pts].reverse().find(p=>p.date<yearStart);
  const yearAgo=new Date(lastDate.getTime()-365*864e5).toISOString().slice(0,10);
  const yearBase=[...pts].reverse().find(p=>p.date<=yearAgo);
  const window=pts.filter(p=>p.date>yearAgo).map(p=>p.v);
  const bpChange=base=>base?Math.round((last.v-base.v)*1000)/10:null;
  return {group:'Rates',symbol,name,kind:'yield',currency:'GBP',price:Math.round(last.v*1000)/1000,changePct:null,
    changeBp:bpChange(prev),ytdPct:null,yearPct:null,ytdBp:bpChange(ytdBase),yearBp:bpChange(yearBase),
    low52:window.length>20?Math.min(...window):null,high52:window.length>20?Math.max(...window):null,
    asOf:last.date,delayedMin:null,cached:false,cacheDetail:note,source,history:pts};
}
function addUkYieldQuotes(){
  if(!Array.isArray(D.quotes)||D.quotes.some(q=>q.symbol==='UK10Y.BOE'))return;
  const added=[];
  for(const [field,label] of [['gilt5y','5Y'],['gilt10y','10Y'],['gilt20y','20Y']]){
    const pts=(D.uk_rates||[]).filter(r=>typeof r[field]==='number'&&Number.isFinite(r[field])).map(r=>({date:r.date,v:r[field]}));
    const q=ukYieldQuote('UK'+label+'.BOE','UK '+label+' gilt yield (BoE spot)',pts,'Bank of England','BoE nominal zero-coupon spot curve');
    if(q)added.push(q);
  }
  try{
    const b=(D.gilts||[]).find(g=>g.shortTicker==='TN28'&&g.quoted&&!g.indexLinked);
    if(b&&typeof giltValuation==='function'){
      const pts=(D.gilt_history||[]).filter(p=>p.ticker===b.ticker).map(p=>({date:p.date,v:giltValuation(b,p.close,p.date)?.ytm}));
      // Changes compare like with like (every point valued the same way, clean + modelled
      // accrued); the level shown uses the DMO's own dirty price, as Bonds & Rates does.
      const modelLatest=giltValuation(b,b.askClean,b.asOf)?.ytm;
      if(Number.isFinite(modelLatest)&&!pts.some(p=>p.date===b.asOf))pts.push({date:b.asOf,v:modelLatest});
      const q=ukYieldQuote('TN28.DMO','0 1/8% Treasury Gilt 2028 (TN28) gross YTM',pts,'UK DMO','Model yield from DMO dated offer price');
      const official=giltValuation(b,b.askClean,b.asOf,b.askDirty)?.ytm;
      if(q&&Number.isFinite(official))q.price=Math.round(official*1000)/1000;
      if(q)added.push(q);
    }
  }catch(e){console.warn('TN28 yield skipped:',e&&e.message);}
  if(!added.length)return;
  const at=D.quotes.findIndex(q=>q.group==='Rates');
  D.quotes.splice(at<0?D.quotes.length:at,0,...added.map(({history,...q})=>q));
  if(Array.isArray(D.history))for(const q of added)for(const p of q.history)D.history.push({symbol:q.symbol,date:p.date,close:Math.round(p.v*1000)/1000});
  // The page indexed quotes and histories at start-up; register the new rows there too.
  const pick=$L('main-pick');
  for(const q of added){
    const {history,...row}=q;
    try{qMap.set(q.symbol,D.quotes.find(x=>x.symbol===q.symbol)||row);}catch(e){}
    try{histMap.set(q.symbol,history.map(p=>({date:p.date,v:Math.round(p.v*1000)/1000,adj:null})));}catch(e){}
    if(pick&&![...pick.options].some(o=>o.value===q.symbol)){const o=document.createElement('option');o.value=q.symbol;o.textContent=q.name+' ['+q.symbol+']';pick.append(o);}
  }
  try{if(typeof renderWatch==='function')renderWatch();}catch(e){}
}
addUkYieldQuotes();

window.terminalLayout={TABS,RESEARCH,ANALYTICS,QUALITY,RETIRED_IDS,apply:applyLayout};
applyLayout();
// Other layers rearrange panels in their own DOMContentLoaded handlers and on short
// timers; a zero-delay task queued from ours runs after all of them.
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(applyLayout,0));
window.addEventListener('load',()=>{applyLayout();setTimeout(applyLayout,150);});
setTimeout(applyLayout,150);
})();

// Terminal polish — runs last, inside the application closure.
// One return figure everywhere, explanations off, flat lists, stale-data flags.
(function(){
  const $q=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const EMPTY=/^(unavailable|—|-|not disclosed|not verified|unverified|n\/a)$/i;
  const DATED=/\d{4}-\d{2}-\d{2}/;
  const pct=v=>(v==null||!Number.isFinite(+v))?'—':(typeof etfPct==='function'?etfPct(+v):(+v).toFixed(2)+'%');
  const fund=()=>(typeof ETF_BY_SYMBOL!=='undefined'&&typeof etfState!=='undefined')?ETF_BY_SYMBOL.get(etfState.selected):null;
  const today=()=>{const g=(typeof D!=='undefined'&&D.generatedAt)||'';return /^\d{4}-\d{2}-\d{2}/.test(g)?g.slice(0,10):new Date().toISOString().slice(0,10);};

  const PS=t=>{t=String(t||'').trim();if(/^[PS]$/.test(t))return t;if(/^S\b|synthetic|swap/i.test(t))return 'S';if(/^P\b|physical/i.test(t))return 'P';return '?';};
  // ETF detail: the 1Y/3Y/5Y shown in the detail are the same figures as the card and table.
  function etfDetail(){
    const f=fund();
    for(const host of $$('#etf-risk-stats,#etf-detail-stats')){
      for(const stat of $$('.etf-stat',host)){
        const k=$q('.k',stat),v=$q('.v',stat),d=$q('.d',stat);if(!k||!v)continue;
        const m=k.textContent.trim().match(/^([135])Y annualised$/i);
        if(m&&f){const val=pct(f['return'+m[1]+'Y']);if(v.textContent!==val)v.textContent=val;if(d)d.remove();k.textContent=m[1]+'Y total return'+(m[1]==='1'?'':' (annualised)');}
        const label=k.textContent.trim();
        if(/^fund assets \(aum\)$/i.test(label)){stat.remove();continue;}
        if(/^replication$/i.test(label)){const kind=(f&&typeof etfV5Kind==='function')?etfV5Kind(f)[0]:'';const ps=/^[PS]$/.test(kind)?kind:PS(v.textContent);if(v.textContent!==ps)v.textContent=ps;if(d)d.remove();continue;}
        if(EMPTY.test(v.textContent.trim())){stat.remove();continue;}
        if(d&&!DATED.test(d.textContent))d.remove();
      }
    }
    const risk=$q('#etf-risk-stats');
    if(risk&&f){
      let basis=$q('#polish-etf-basis');
      if(!basis){basis=document.createElement('div');basis.id='polish-etf-basis';basis.className='polish-basis';risk.before(basis);}
      const end=f.returnPeriods?.['1Y']?.end||(f.quote?.asOf||'').slice(0,10);
      const text='Returns: '+(f.returnBasis||'basis not recorded')+(end?' · to '+end:'')+(f.quote?.currency?' · '+f.quote.currency:'');
      if(basis.textContent!==text)basis.textContent=text;
    }
  }

  // ETF cards: drop filler tags; AUM is the whole fund, so say so.
  function etfCards(){
    for(const meta of $$('.etf-compare-card .etf-card-meta'))if(/^not in main table$/i.test(meta.textContent.trim()))meta.remove();
    for(const span of $$('.etf-card-facts span'))if(/^Fund AUM/.test(span.textContent))span.textContent='Fund size';
    for(const box of $$('.etf-card-facts > div')){const k=box.querySelector('span'),v=box.querySelector('strong');
      if(k&&v&&/^structure$/i.test(k.textContent.trim())){k.textContent='Replication';const ps=PS(v.textContent);if(v.textContent!==ps)v.textContent=ps;}}
    for(const th of $$('th')){const t=th.textContent.trim();if(/^Fund (AUM|assets)/.test(t)&&t!=='Fund size')th.textContent='Fund size';}
    for(const k of $$('.etf-stat .k'))if(/^Fund assets|^Fund AUM/.test(k.textContent.trim()))k.textContent='Fund size';
  }

  // Calendar: keep a release time only when it is a real time; otherwise no sub-line.
  function calendar(){
    for(const mini of $$('#calendar-items .mt-cal-row .mini')){
      const t=mini.textContent.match(/\b\d{1,2}:\d{2}(\s?(ET|CET|GMT|BST|UK))?\b/);
      if(t){if(mini.textContent!==t[0])mini.textContent=t[0];}else mini.remove();
    }
    for(const small of $$('#calendar-items small'))if(!/\d{1,2}:\d{2}/.test(small.textContent))small.remove();
  }

  // Economics actuals: drop empty forecast columns, show source once, flag stale prints.
  function periodEnd(text){
    const s=text.trim().toUpperCase(),mon={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
    let m=s.match(/^(\d{4}) (Q[1-4])$/);if(m){const q=+m[2][1];return {end:new Date(Date.UTC(+m[1],q*3,0)),limit:140};}
    m=s.match(/^(\d{4}) ([A-Z]{3})$/);if(m&&mon[m[2]])return {end:new Date(Date.UTC(+m[1],mon[m[2]],0)),limit:80};
    m=s.match(/^(\d{4})-(\d{2})$/);if(m)return {end:new Date(Date.UTC(+m[1],+m[2],0)),limit:80};
    return null;
  }
  function macroTable(){
    const body=$q('#macro-print-rows');if(!body||!body.rows.length)return;
    const table=body.closest('table'),heads=[...table.tHead.rows[0].cells];
    heads.forEach((th,i)=>{
      const label=th.textContent.trim();
      const cells=[...body.rows].map(r=>r.cells[i]).filter(Boolean);
      const allEmpty=cells.every(c=>/^(—|-|)$/.test(c.textContent.trim()));
      const hide=(/forecast|surprise/i.test(label)&&allEmpty)||/^source$/i.test(label);
      th.classList.toggle('polish-hidden',hide);cells.forEach(c=>c.classList.toggle('polish-hidden',hide));
      if(/^source$/i.test(label)){
        const names=[...new Set(cells.map(c=>c.textContent.trim().split(/\s*·\s*/)[0]).filter(Boolean))];
        let cap=$q('#polish-macro-source');
        if(!cap){cap=document.createElement('p');cap.id='polish-macro-source';cap.className='polish-section-source';table.parentElement.after(cap);}
        const text=names.length?'Source: '+names.join(', '):'';if(cap.textContent!==text)cap.textContent=text;
      }
    });
    const pi=heads.findIndex(th=>/observation period/i.test(th.textContent));if(pi<0)return;
    const now=Date.parse(today()+'T00:00:00Z');
    for(const row of body.rows){
      const cell=row.cells[pi];if(!cell)continue;
      const raw=(cell.firstChild&&cell.firstChild.nodeType===3?cell.firstChild.textContent:cell.textContent).replace('stale','');
      const p=periodEnd(raw);let flag=$q('.polish-stale',cell);
      const stale=p&&(now-p.end.getTime())/86400000>p.limit;
      if(stale&&!flag){flag=document.createElement('span');flag.className='polish-stale';flag.textContent='stale';
        flag.title='A newer release should exist; the feed may be serving cached data';cell.append(flag);}
      if(!stale&&flag)flag.remove();
    }
  }

  // Gilt block: keep warnings, drop the standing method explanation.
  function gilt(){for(const n of $$('#gilts .r28-gilt-single > p.note'))if(/^Gross cash figures are undiscounted/.test(n.textContent)&&!n.hidden)n.hidden=true;}

  // Long tables: first rows in page flow, the rest behind "Show all" (no nested scroll boxes).
  const LIMIT=20,expanded=new Set();
  const WRAPS='.r28-table-scroll,.etf-table-scroll,.gilt-table-scroll,.mt-table-scroll,.constituents-scroll,.screener-scroll,.watchlist-table-scroll,.scroll,#ust-securities-scroll';
  function wrapKey(w){return w.id||[...w.classList].join('.')+'@'+(w.closest('section[id],[id^=view-]')?.id||'');}
  function longTables(){
    for(const w of $$(WRAPS)){
      if(w.closest('#view-quality')||w.parentElement?.closest(WRAPS))continue;
      const body=w.querySelector('tbody');if(!body)continue;
      const rows=[...body.rows].filter(r=>!/group|geo/.test(r.className));
      const limit=['gilt-rows','ust-rows'].includes(body.id)?10:LIMIT;
      const key=wrapKey(w),open=expanded.has(key),over=rows.length>limit;
      let n=0;
      for(const r of body.rows){
        const isGroup=/group|geo/.test(r.className);if(!isGroup)n++;
        const keep=open||!over||n<=limit||(limit!==10&&r.matches('.etf-active,.selected,.active,[aria-selected=true]'));
        if(r.classList.contains('polish-cut')===keep)r.classList.toggle('polish-cut',!keep);
      }
      let btn=w.nextElementSibling?.classList.contains('polish-more')?w.nextElementSibling:null;
      if(!over){btn?.remove();continue;}
      if(!btn){btn=document.createElement('button');btn.type='button';btn.className='polish-more';w.after(btn);}
      btn.onclick=()=>{open?expanded.delete(key):expanded.add(key);longTables();if(open)w.scrollIntoView({block:'start'});};
      const label=open?'Show fewer':'Show all '+rows.length;
      if(btn.textContent!==label)btn.textContent=label;
    }
  }

  // Search: gilts and US Treasuries are searchable, and every result lands on its detail.
  function extendSearch(){
    if(typeof fullSearchList==='undefined'||typeof chooseGlobalResult!=='function')return;
    for(const g of (typeof giltList!=='undefined'?giltList:[]))
      fullSearchList.push({kind:'gilt',label:g.name+(g.shortTicker?' ('+g.shortTicker+')':''),code:g.isin||g.ticker,ticker:g.ticker,detail:'UK gilt · matures '+g.maturity});
    for(const b of (typeof ustList!=='undefined'?ustList:[]))
      fullSearchList.push({kind:'ust',label:b.name,code:b.cusip,detail:'US Treasury · '+(b.type||'')+' · matures '+b.maturity});
    const base=chooseGlobalResult;
    const land=(id)=>setTimeout(()=>{const n=document.getElementById(id);if(n)n.scrollIntoView({behavior:'smooth',block:'start'});},120);
    const bond=(i)=>{activateWorkspace('bonds',{scroll:false});if(typeof bondTab!=='undefined'){bondTab=i;renderBondTabs();}};
    chooseGlobalResult=function(item){
      if(!item)return;
      if(item.kind==='gilt'){$('global-search').value='';closeGlobalResults();bond(0);giltState.symbol=item.ticker;renderGilts();land('gilt-stats');return;}
      if(item.kind==='ust'){$('global-search').value='';closeGlobalResults();bond(1);ustState.selected=item.code;renderUST();land('ust-selected');return;}
      base(item);
      if(item.kind==='etfTracker')land('etf-selected');
    };
  }
  try{extendSearch();}catch(err){console.warn('search extension:',err);}
  try{if(typeof etfState!=='undefined'&&etfState.compared?.size){etfState.compared.clear();if(typeof renderEtfTracker==='function')renderEtfTracker();}}catch(err){}

  // No references to SEC filings, EDGAR, XBRL or form numbers outside Data Quality.
  const FILING=/\bSEC\b|EDGAR|XBRL|\b(?:10-K|10-Q|20-F|6-K|8-K)\b/;
  function scrubFilings(){
    const stage=document.getElementById('workspace-stage');if(!stage)return;
    for(const a of stage.querySelectorAll('a[href*="sec.gov"]'))if(!a.closest('#view-quality'))a.remove();
    for(const h of stage.querySelectorAll('summary,h3,h4,.r24-support-heading'))
      if(/filing dates|Field-level sources/i.test(h.textContent)&&!h.closest('#view-quality')){const box=h.closest('details,section.r24-support')||h;box.hidden=true;}
    const walk=document.createTreeWalker(stage,NodeFilter.SHOW_TEXT);const hits=[];let n;
    while(n=walk.nextNode())if(FILING.test(n.textContent)&&!n.parentElement.closest('#view-quality,script,style'))hits.push(n);
    for(const t of hits){
      const v=t.textContent.replace(/SEC issuer filings?/gi,'issuer accounts').replace(/\(?SEC XBRL\)?\s*/gi,'').replace(/SEC (?:EDGAR )?(?:filings?|companyfacts)/gi,'issuer accounts')
        .replace(/\b(?:EDGAR|XBRL)\b\s*/g,'').replace(/\b(?:10-K|10-Q|20-F|6-K|8-K)\b/g,'annual report').replace(/\bSEC\b\s*/g,'').replace(/\s{2,}/g,' ');
      if(v!==t.textContent)t.textContent=v;
    }
  }

  // Company figures carried over from the last good provider lookup carry their date.
  function retainedDates(){
    const pick=document.getElementById('company-pick');if(!pick||typeof D==='undefined')return;
    const c=(D.companies||[]).find(x=>x.symbol===pick.value);const day=c?.fundamentalsRetainedFrom;
    if(!day)return;
    for(const tile of document.querySelectorAll('#view-companies .research-stats > *, #view-companies .t11-ratios > *, #view-companies .research-dashboard > *')){
      const k=tile.firstElementChild?.textContent||'';
      if(!/P\/E|market cap|dividend yield|EV \/ EBITDA|price \/ book|margin|return on equity|free cash flow|total debt/i.test(k))continue;
      const v=tile.children[1]?.textContent.trim();if(!v||v==='—'||/unavailable/i.test(v))continue;
      let note=tile.querySelector('.polish-retained');
      if(!note){note=document.createElement('div');note.className='polish-retained';tile.append(note);}
      const t='as of '+day;if(note.textContent!==t)note.textContent=t;
    }
  }

  let busy=false,queued=false;
  function polish(){
    if(busy)return;busy=true;
    try{etfDetail();etfCards();calendar();macroTable();gilt();longTables();scrubFilings();retainedDates();}
    catch(err){console.warn('terminal polish:',err);}
    finally{busy=false;}
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;polish();});}
  polish();
  new MutationObserver(()=>{if(!busy)schedule();}).observe(document.body,{childList:true,subtree:true});
})();

// Reading headings follow page scroll even when a table has horizontal overflow.
// Keep the real header in the table for semantics and forward sorting clicks.
(function(){
 const copies=new Map();let queued=false;
 const set=(e,k,v)=>{if(e.style[k]!==v)e.style[k]=v;};
 function update(){
  queued=false;
  const stage=document.getElementById('workspace-stage');if(!stage)return;
  const nav=document.querySelector('.commandbar');
  let top=Math.max(0,nav?.getBoundingClientRect().bottom||0);
  for(const n of stage.querySelectorAll('.layout-subtabs,.mt-bond-nav,.r25-section-links,.watchlist-selected-header,#etf-tracker-panel .etf-detail>.row:first-child')){
   const r=n.getBoundingClientRect();if(n.getClientRects().length&&getComputedStyle(n).position==='sticky'&&r.top<=top+2&&r.bottom>top)top=r.bottom;
  }
  const active=new Set();
  for(const table of stage.querySelectorAll('table')){
   const head=table.tHead;if(!head||!head.rows.length||!table.getClientRects().length)continue;
   const rect=table.getBoundingClientRect(),height=head.getBoundingClientRect().height;
   if(rect.top>=top||rect.bottom<=top+height||!height)continue;
   let left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right);
   for(let p=table.parentElement;p&&p!==stage;p=p.parentElement){
    if(/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)){const r=p.getBoundingClientRect();left=Math.max(left,r.left);right=Math.min(right,r.right);}
   }
   if(right<=left)continue;
   active.add(table);let copy=copies.get(table);
   const signature=head.innerHTML;
   if(!copy||copy.signature!==signature){
    copy?.box.remove();const box=document.createElement('div');box.className='table-reading-head';box.setAttribute('aria-hidden','true');
    const t=document.createElement('table'),h=head.cloneNode(true);t.append(h);box.append(t);
    for(const n of h.querySelectorAll('[id]'))n.removeAttribute('id');
    for(const n of h.querySelectorAll('button,a,input'))n.tabIndex=-1;
    const originals=[...head.querySelectorAll('th,td')],clones=[...h.querySelectorAll('th,td')];
    clones.forEach((c,i)=>{c.addEventListener('click',e=>{e.preventDefault();const button=originals[i].querySelector('button');(button||originals[i]).click();});});
    document.body.append(box);copy={box,t,originals,clones,signature};copies.set(table,copy);
   }
   set(copy.box,'top',top+'px');set(copy.box,'left',left+'px');set(copy.box,'width',(right-left)+'px');
   set(copy.t,'width',rect.width+'px');set(copy.t,'marginLeft',(rect.left-left)+'px');
   copy.clones.forEach((c,i)=>{const source=copy.originals[i],style=getComputedStyle(source),r=source.getBoundingClientRect();
    for(const key of ['display','font','color','padding','textAlign','letterSpacing','whiteSpace','borderBottom'])set(c,key,style[key]);
    set(c,'width',r.width+'px');set(c,'minWidth',r.width+'px');set(c,'maxWidth',r.width+'px');
   });
  }
  for(const [table,copy] of copies)if(!active.has(table)){copy.box.remove();copies.delete(table);}
 }
 function schedule(){if(!queued){queued=true;requestAnimationFrame(update);}}
 document.addEventListener('scroll',schedule,{capture:true,passive:true});window.addEventListener('resize',schedule,{passive:true});
 const stage=document.getElementById('workspace-stage');if(stage)new MutationObserver(schedule).observe(stage,{childList:true,subtree:true});
 schedule();
})();

// Measure navigation rather than assuming an iPad or desktop header height.
(function(){const nav=document.querySelector('.commandbar');if(!nav)return;const size=()=>document.documentElement.style.setProperty('--security-nav-height',nav.getBoundingClientRect().height+'px');size();new ResizeObserver(size).observe(nav);})();

/* Readability layer — runs last. Presentation only: it rewords timestamps,
   hides low-value columns and empty section rows. No market data is changed. */
(function(){
  const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const isoShort=(y,m,d)=>`${+d} ${MONTHS[+m-1]}`;

  // "5 Nov 2026, 16:30 UTC" -> "5 Nov, 16:30";  "2026-11-05" -> "5 Nov"
  function shortTime(t){
    return t.replace(/(\d{1,2} [A-Z][a-z]{2}) \d{4},? (\d{2}:\d{2})(?: UTC)?/g,'$1, $2')
            .replace(/\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?(?: UTC)?/g,(m,y,mo,d,hm)=>isoShort(y,mo,d)+(hm?', '+hm:''))
            .replace(/ UTC\b/g,'');
  }

  function setText(el,t){if(el.textContent!==t)el.textContent=t}

  function header(){
    const s=document.getElementById('stamp');
    if(s&&/rerun Python/i.test(s.textContent))setText(s,s.textContent.replace(/\s*·\s*rerun Python to refresh/i,''));
  }

  function pulse(){
    const board=document.getElementById('market-pulse');
    if(!board)return;
    if(!document.getElementById('rd-utc-note')){
      const n=document.createElement('div');n.id='rd-utc-note';n.className='rd-utc-note';n.textContent='Quote times in UTC';
      board.parentNode.insertBefore(n,board);
    }
    board.querySelectorAll('.r24-snapshot-item .mini').forEach(m=>{
      if(m.children.length)return;
      setText(m,shortTime(m.textContent));
    });
  }

  // Tables: say "UTC" once in the column heading, not in every row.
  function tableUtc(table){
    const heads=table.tHead&&table.tHead.rows.length?[...table.tHead.rows[table.tHead.rows.length-1].cells]:[];
    if(!heads.length)return;
    const cols=new Set();
    for(const tb of table.tBodies)for(const row of tb.rows){
      if(row.cells.length!==heads.length)continue;
      [...row.cells].forEach((c,i)=>{if(!c.children.length&&/\d{2}:\d{2} UTC$/.test(c.textContent.trim()))cols.add(i)});
    }
    cols.forEach(i=>{
      const h=heads[i];
      if(h&&!/UTC/.test(h.textContent)&&!h.querySelector('button'))setText(h,h.textContent.trim()+' (UTC)');
      for(const tb of table.tBodies)for(const row of tb.rows){
        const c=row.cells[i];
        if(c&&row.cells.length===heads.length&&!c.children.length&&/ UTC$/.test(c.textContent.trim()))setText(c,c.textContent.trim().replace(/ UTC$/,''));
      }
    });
  }

  // Hide columns by heading text; keep the hidden values as a tooltip on the row.
  const HIDE={
    '#market-valuations':['P/E coverage','Financials retrieved'],
    '#equity-screener':['Financials checked','Price history']
  };
  HIDE['.mt-risk-table']=['Observations'];
  function hideCols(){
    for(const [sel,names] of Object.entries(HIDE)){
      const tables=sel.startsWith('#')?document.querySelectorAll(sel+' table'):document.querySelectorAll(sel);
      tables.forEach(table=>{
        if(!table.tHead)return;
        const heads=[...table.tHead.rows[table.tHead.rows.length-1].cells];
        const idx=heads.map((h,i)=>names.includes(h.textContent.trim())?i:-1).filter(i=>i>=0);
        if(!idx.length)return;
        idx.forEach(i=>heads[i].classList.add('rd-hide-col'));
        for(const tb of table.tBodies)for(const row of tb.rows){
          if(row.cells.length!==heads.length)continue;
          const tip=idx.map(i=>heads[i].textContent.trim()+': '+row.cells[i].textContent.trim()).join(' · ');
          idx.forEach(i=>row.cells[i].classList.add('rd-hide-col'));
          if(row.cells[0]&&row.cells[0].title!==tip)row.cells[0].title=tip;
        }
      });
    }
  }

  // A section heading with no visible rows under it is hidden.
  function orphans(){
    document.querySelectorAll('#workspace-stage tbody').forEach(tb=>{
      const rows=[...tb.rows];
      rows.forEach((r,i)=>{
        if(!r.classList.contains('watch-section'))return;
        let shown=false;
        for(let j=i+1;j<rows.length&&!rows[j].classList.contains('watch-section');j++){
          if(!rows[j].classList.contains('polish-cut')&&!rows[j].classList.contains('rd-orphan')&&rows[j].style.display!=='none'){shown=true;break}
        }
        if(r.classList.contains('rd-orphan')===shown)r.classList.toggle('rd-orphan',!shown);
      });
    });
  }

  // Economic indicators: "Prior 3.10% · 2026-08" -> value in bold, readable date.
  function priors(){
    document.querySelectorAll('#macro-tiles .r28-economic-sub').forEach(el=>{
      if(el.querySelector('b'))return;
      const m=el.textContent.match(/^Prior\s+(\S+)\s*·\s*(.+)$/);
      if(!m)return;
      let when=m[2].trim().replace(/^(\d{4})-(\d{2})$/,(x,y,mo)=>MONTHS[+mo-1]+' '+y)
                         .replace(/^(\d{4}) ([A-Z]{3})$/,(x,y,mo)=>mo[0]+mo.slice(1).toLowerCase()+' '+y);
      el.textContent='Prior ';const b=document.createElement('b');b.textContent=m[1];el.append(b,' · '+when);
    });
  }

  // Dates: one style everywhere. "2027-01-29" -> "29 Jan 2027"; "2026-11-13 21:15" -> "13 Nov 2026, 21:15";
  // "2026 SEP" -> "Sep 2026"; "2026 Q2" -> "Q2 2026".
  const ISO=/\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?(?: UTC)?\b/g;
  const niceDate=t=>t.replace(ISO,(m,y,mo,d,hm)=>`${d}/${mo}/${y.slice(-2)}`+(hm?', '+hm:''))
                     .replace(/^(\d{4}) ([A-Z]{3})$/,(m,y,mo)=>mo[0]+mo.slice(1).toLowerCase()+' '+y)
                     .replace(/^(\d{4}) (Q[1-4])$/,'$2 $1')
                     .replace(/^(\d{4})-(\d{2})$/,(m,y,mo)=>MONTHS[+mo-1]+' '+y);
  function datesIn(root){
    const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;const todo=[];
    while(n=w.nextNode()){const v=n.nodeValue;if(/\d{4}-\d{2}-\d{2}/.test(v)&&!n.parentElement.closest('input,select,textarea,script,style'))todo.push(n)}
    todo.forEach(n=>{const v=niceDate(n.nodeValue);if(v!==n.nodeValue)n.nodeValue=v});
  }
  function econDates(){
    document.querySelectorAll('#macro-tiles button .ml').forEach(el=>{if(/Bank of england/.test(el.textContent))el.textContent=el.textContent.replace('Bank of england','Bank of England')});
    document.querySelectorAll('#macro-tiles button .md').forEach(el=>{if(!el.children.length){const v=niceDate(el.textContent.trim());if(v!==el.textContent)el.textContent=v}});
    document.querySelectorAll('#macro-tiles .r28-economic-sub').forEach(el=>{
      const last=el.lastChild;if(!last||last.nodeType!==3)return;
      const m=last.nodeValue.match(/^(\s*·\s*)(.+)$/);if(!m)return;
      const v=m[1]+niceDate(m[2].trim());if(v!==last.nodeValue)last.nodeValue=v;
    });
  }
  // Words in the reading font, figures in the monospace.
  const NUM=/^[\s(]*[+\-−–]?\s*(?:USD|GBP|EUR|£|\$|€)?\s*[+\-−–]?[\d][\d.,]*\s*(?:%|bp|pp|x|×|bn|m|k|p)?\s*\*?\s*[)]?\s*$|^[\s—–-]*$/;
  const DATEISH=/^\s*\d{1,2} [A-Z][a-z]{2}(?: \d{4})?(?:, \d{2}:\d{2})?\s*$|^\s*\d{4}(?:-\d{2}){1,2}/;
  function classify(){
    const DATECOL=/date|time|as of|maturity|matures|retrieved|checked/i;
    document.querySelectorAll('#workspace-stage table').forEach(table=>{
      const hr=table.tHead&&table.tHead.rows.length?table.tHead.rows[table.tHead.rows.length-1]:null;
      if(!hr)return;
      [...hr.cells].forEach((h,i)=>{if(!DATECOL.test(h.textContent))return;
        for(const tb of table.tBodies)for(const row of tb.rows){const c=row.cells[i];
          if(c&&row.cells.length===hr.cells.length&&!c.querySelector('canvas,svg,input,select,button')){c.classList.add('rd-num');c.classList.remove('rd-txt');c.dataset.rdCol='date'}}});
    });
    document.querySelectorAll('#workspace-stage table tbody td').forEach(td=>{
      if(td.dataset.rdCol==='date'||td.querySelector('canvas,svg,input,select,button'))return;
      const kids=[...td.children];
      if(!kids.length){
        const t=td.textContent;const num=NUM.test(t)||DATEISH.test(t);
        td.classList.toggle('rd-num',num);td.classList.toggle('rd-txt',!num);
      }else{
        kids.forEach(k=>{if(k.children.length&&k.querySelector('canvas,svg'))return;
          const t=k.textContent;const num=NUM.test(t)||DATEISH.test(t);
          k.classList.toggle('rd-num',num);k.classList.toggle('rd-txt',!num);});
      }
    });
  }


  // ---- Terminal 3 additions ----
  // Currency: $ £ € symbols, never "USD 12.3bn" / "GBp".
  const SYM={USD:'$',GBP:'£',EUR:'€',JPY:'¥'};
  const NUMPART='[+\\-−]?\\d[\\d,]*(?:\\.\\d+)?\\s?(?:bn|tn|m|k)?';
  const RE1=new RegExp('\\b(USD|GBP|EUR|JPY)\\s+('+NUMPART+')(?![\\w%])','g');
  const RE2=new RegExp('(^|[^\\w.])('+NUMPART+')\\s+(USD|GBP|EUR|JPY)\\b','g');
  function currency(){
    const root=document.getElementById('workspace-stage');if(!root)return;
    const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;const todo=[];
    while(n=w.nextNode()){const v=n.nodeValue;if(!/USD|GBP|EUR|JPY|GBp/.test(v))continue;
      if(n.parentElement.closest('input,select,textarea,script,style,option'))continue;todo.push(n)}
    todo.forEach(n=>{let v=n.nodeValue;
      v=v.replace(RE1,(m,c,x)=>SYM[c]+x.replace(/\s/g,'')).replace(RE2,(m,pre,x,c)=>pre+SYM[c]+x.replace(/\s/g,''));
      // Keep GBp as pence. Rendering routines must divide by 100 before showing GBP.
      if(v!==n.nodeValue)n.nodeValue=v});
  }
  // Header follows its column: numeric columns right-aligned, text columns left.
  function align(){
    document.querySelectorAll('#workspace-stage table').forEach(table=>{
      const hr=table.tHead&&table.tHead.rows.length?table.tHead.rows[table.tHead.rows.length-1]:null;if(!hr)return;
      const heads=[...hr.cells];if(heads.length<2)return;
      heads.forEach((h,i)=>{
        let num=0,tot=0;
        for(const tb of table.tBodies)for(const row of tb.rows){
          if(row.cells.length!==heads.length||row.classList.contains('rd-orphan'))continue;
          const c=row.cells[i];if(c.querySelector('input,button,canvas,svg'))continue;
          const t=c.textContent.trim();if(!t)continue;tot++;if(c.classList.contains('rd-num')&&!/^\d{1,2} [A-Z][a-z]{2}/.test(t)||/^[—–-]$/.test(t))num++;
        }
        const cls=tot&&num/tot>=0.6?'rd-r':'rd-l';
        [h,...[...table.tBodies].flatMap(tb=>[...tb.rows].filter(r=>r.cells.length===heads.length).map(r=>r.cells[i]))].forEach(c=>{
          if(c.classList.contains(cls))return;c.classList.remove('rd-r','rd-l');
          if(c.querySelector('input[type=checkbox]')||c.classList.contains('etf-compact-code')||/^P\/S$/.test(h.textContent.trim())){c.classList.add('rd-c');return}
          c.classList.add(cls)});
      });
    });
  }
  // Return columns: green up, red down, everywhere.
  function tone(){
    const RET=/^(1D|1W|1M|3M|6M|YTD|1Y|3Y|5Y|10Y|Day|Week|Month|Year|Change|Ann\. price return)\b/i;
    document.querySelectorAll('#workspace-stage table').forEach(table=>{
      const hr=table.tHead&&table.tHead.rows.length?table.tHead.rows[table.tHead.rows.length-1]:null;if(!hr)return;
      [...hr.cells].forEach((h,i)=>{if(!RET.test(h.textContent.trim().replace(/[▾▴]/g,'').trim()))return;
        for(const tb of table.tBodies)for(const row of tb.rows){if(row.cells.length!==hr.cells.length)continue;
          const c=row.cells[i];if(c.classList.contains('up')||c.classList.contains('down'))continue;
          const t=c.textContent.trim().replace('−','-');if(!/%|bp|pp/.test(t))continue;
          const neg=/^-/.test(t);const pos=/^\+/.test(t)||(/^\d/.test(t)&&parseFloat(t)>0);
          c.classList.toggle('rd-neg',neg);c.classList.toggle('rd-pos',pos&&!neg)}});
    });
  }
  // Drop Market signals; fold explanatory notes behind a small i button.
  function slim(){
    document.querySelectorAll('#workspace-stage h2,#workspace-stage h3').forEach(h=>{
      if(/^market signals$/i.test(h.textContent.trim())){const box=h.closest('section,.panel')||h.parentElement;box.classList.add('rd-gone')}});
    document.querySelectorAll('#r23-alerts').forEach(x=>x.classList.add('rd-gone'));
    document.querySelectorAll('#workspace-stage a,#workspace-stage button').forEach(a=>{if(/^market signals$/i.test(a.textContent.trim()))a.classList.add('rd-gone')});
    // Keep editable research notebooks usable. Another presentation layer can
    // turn <details> into <section>, so excluding only "closest(details)" was
    // hiding entire input labels (and all their textareas) behind an info button.
    document.querySelectorAll('#workspace-stage .research-notebook label.rd-gone').forEach(note=>{
      note.classList.remove('rd-gone');delete note.dataset.rdFolded;
    });
    document.querySelectorAll('#workspace-stage .panel .note, #workspace-stage .research-hint, #workspace-stage .mt-inline-notice').forEach(note=>{
      if(note.matches('label,form')||note.querySelector('input,select,textarea,button,[contenteditable]')||
         note.closest('.research-notebook,form')||
         note.dataset.rdFolded||note.closest('table,details,.rd-gone')||
         /synthetic|warning|error|failed|unavailable/i.test(note.className+' '+note.textContent.slice(0,60)))return;
      if(note.textContent.trim().length<40)return;
      const panel=note.closest('.panel');const head=panel&&panel.querySelector('h2,h3');if(!head)return;
      note.dataset.rdFolded='1';note.classList.add('rd-gone');
      let btn=panel.querySelector(':scope .rd-note-btn');
      if(!btn){btn=document.createElement('button');btn.type='button';btn.className='rd-note-btn';btn.setAttribute('aria-expanded','false');btn.title='About this table';head.append(btn);
        btn.onclick=e=>{e.stopPropagation();const open=btn.getAttribute('aria-expanded')!=='true';btn.setAttribute('aria-expanded',open);panel.querySelectorAll('[data-rd-folded]').forEach(n=>n.classList.toggle('rd-gone',!open))}}
    });
  }


  // Terminal 3: pulse yields in colour, tile figures signed, dates without year or time on condition tables.
  function t3colour(){
    document.querySelectorAll('#market-pulse .r24-snapshot-item .mini').forEach(m=>{
      const t=m.textContent.replace('−','-');const mm=t.match(/^([+\-]?\d+(?:\.\d+)?) bp since/);if(!mm)return;
      const v=parseFloat(mm[1]);m.classList.toggle('rd-pos',v>0);m.classList.toggle('rd-neg',v<0);
      const short=m.textContent.replace(/ (\d{1,2} [A-Z][a-z]{2}) \d{4}/g,' $1');if(short!==m.textContent)m.textContent=short;
    });
    document.querySelectorAll('#workspace-stage .research-stat .val').forEach(v=>{
      const t=v.textContent.trim().replace('−','-');
      v.classList.toggle('rd-neg',/^-\d/.test(t)&&/%$/.test(t));v.classList.toggle('rd-pos',/^\+\d/.test(t)&&/%$/.test(t));
    });
    document.querySelectorAll('#workspace-stage h3,#workspace-stage h4,#workspace-stage .research-group-title,#workspace-stage summary').forEach(h=>{
      if(/^(Price & valuation|Size & growth|Profitability|Cash & balance sheet)$/i.test(h.textContent.trim()))h.classList.add('rd-amber')});
    document.querySelectorAll('#workspace-stage table').forEach(table=>{
      const hr=table.tHead&&table.tHead.rows.length?table.tHead.rows[table.tHead.rows.length-1]:null;if(!hr)return;
      const cond=table.classList.contains('r24-conditions-table')||table.classList.contains('r26-conditions');
      [...hr.cells].forEach((h,i)=>{
        if(!/^(observation date|date)( \(utc\))?$/i.test(h.textContent.trim().replace(/\s+/g,' ')))return;
        if(!cond)return;
        if(h.textContent.trim()!=='Date')h.textContent='Date';
        for(const tb of table.tBodies)for(const row of tb.rows){const c=row.cells[i];if(!c)continue;
          c.querySelectorAll('div').forEach(d=>{if(!d.children.length)fix(d)});if(!c.querySelector('div'))fix(c)}
      });
      if(cond)for(const tb of table.tBodies)for(const row of tb.rows)for(const c of row.cells)(c.querySelectorAll('div').length?c.querySelectorAll('div'):[c]).forEach(d=>{if(!d.children.length)fix(d)});
    });
    document.querySelectorAll('.r24-conditions-table .r24-line,.r26-conditions td').forEach(d=>{
      if(d.children.length)return;const t=d.textContent.trim().replace('−','-');
      if(/^[+\-]?\d+(?:\.\d+)?\s?(bp|%)/.test(t)||/^1M [+\-]?\d/.test(t)){const v=parseFloat(t.replace(/^1M /,''));d.classList.toggle('rd-pos',v>0);d.classList.toggle('rd-neg',v<0)}});
    function fix(n){const v=n.textContent.replace(/(\d{1,2} [A-Z][a-z]{2}) \d{4}(?:,? \d{2}:\d{2})?(?: UTC)?/g,'$1');if(v!==n.textContent)n.textContent=v}
  }

  let busy=false,queued=false;
  function apply(){
    if(busy)return;busy=true;
    try{
      header();pulse();
      document.querySelectorAll('#workspace-stage table').forEach(tableUtc);
      hideCols();orphans();priors();
      document.querySelectorAll('#workspace-stage table tbody').forEach(datesIn);econDates();classify();currency();t3colour();align();tone();slim();t3SemanticColours();
    }catch(e){console.warn('readability layer',e)}
    busy=false;
  }
  function schedule(){if(queued)return;queued=true;setTimeout(()=>{queued=false;apply()},60)}

  apply();
  const stage=document.getElementById('workspace-stage')||document.body;
  new MutationObserver(()=>{if(!busy)schedule()}).observe(stage,{childList:true,subtree:true,characterData:true});
  const st=document.getElementById('stamp');if(st)new MutationObserver(()=>{if(!busy)schedule()}).observe(st,{childList:true,characterData:true,subtree:true});
})();

/* Semantic colour semantics for Terminal 3. This runs inside the existing
   market application and is called by the existing readability repaint cycle.
   No values are calculated or modified apart from displaying an observed
   actual-minus-previous difference on the economics cards. */
function t3SemanticColours(){
  const root=document.getElementById('workspace-stage');
  if(!root)return;
  const cls=['t3-positive','t3-negative','t3-volatility','t3-primary','t3-neutral','t3-empty'];
  const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
  function number(text){
    const s=String(text||'').replace(/,/g,'').replace(/−/g,'-').trim();
    if(!s||/^(?:—|–|unavailable|insufficient|not sourced|loading|n\/a)$/i.test(s))return null;
    const hit=s.match(/(?:^|[^\w])([+\-]?\d+(?:\.\d+)?)(?![\d])/);
    return hit?Number(hit[1]):null;
  }
  function mark(node,tone){
    if(!node)return;
    cls.forEach(c=>node.classList.toggle(c,c===tone));
  }
  function classify(label,value){
    const name=String(label||'').replace(/\s+/g,' ').trim().toLowerCase();
    const str=String(value||'').trim();
    if(!str||str==='—'||/^(?:unavailable|not available|insufficient|loading|no data)/i.test(str))return 't3-empty';
    const n=number(str);
    // Drawdown is a peak-to-trough loss. It must not turn green because a
    // source happens to report the loss as a positive magnitude.
    if(/(?:max(?:imum)?\s+)?drawdown|peak.to.trough/.test(name))return n!=null&&n!==0?'t3-negative':'t3-neutral';
    if(/volatility|\bvol\b|\bvix\b|\bbeta\b|\bcorrelation\b|\brsi\b|tracking error/.test(name))return 't3-volatility';
    // A yield is an income/rate level, not a price move. A positive yield
    // gets green even though a *rise in yield* can reduce the bond's price.
    if(/earnings yield|dividend yield|gross ytm|yield to maturity|\bytm\b|cash return|gross return|coupon rate|interest yield|total profit for holding/.test(name))
      return n==null?'t3-empty':n<0?'t3-negative':'t3-positive';
    if(/return|price move|day move|\bdaily move\b|\bchange\b|\bmomentum\b|growth|profit margin|return on (?:equity|capital|invested capital)|\broe\b|\broic\b/.test(name))
      return n==null?'t3-empty':n>0?'t3-positive':n<0?'t3-negative':'t3-neutral';
    if(/(?:net |operating )?profit\b|\bearnings\b|free cash flow|cash generation/.test(name))
      return n==null?'t3-empty':n<0?'t3-negative':'t3-primary';
    if(/\b(price|capitalisation|valuation|revenue|\ba[uy]m\b|assets|bid|offer|cost|value|p\/e|p\/b|52.week)/.test(name))
      return 't3-primary';
    return null;
  }
  // The exact same class mapping covers watchlist metrics, research metrics
  // (including changing the selected company), analytics and gilt/Treasury KPIs.
  const cards=root.querySelectorAll(
    '#view-watchlist .watchlist-stat,#view-companies .watchlist-stat,'+
    '#view-companies .company-kpi,#view-companies .research-dashboard .research-card,'+
    '#view-companies .research-stat,#view-analytics .analytic-stat,'+
    '#view-bonds .research-stat,#view-bonds .r28-gilt-yield,#view-bonds .r28-gilt-fact,'+
    '#view-etfs .etf-stat'
  );
  cards.forEach(card=>{
    const lab=card.querySelector(':scope > .k,:scope > .key,:scope > .lab,:scope > .mini,:scope > span.mini');
    const val=card.querySelector(':scope > .v,:scope > .val,:scope > strong,:scope > .value');
    if(lab&&val)mark(val,classify(lab.textContent,val.textContent));
  });
  // Earnings yield is the fifth valuation-column, while the premium to
  // government bond yield is the eighth: colour each by its actual sign.
  const valuation=root.querySelector('#valuation-rows');
  if(valuation)valuation.querySelectorAll('tr').forEach(tr=>{
    const cells=[...tr.cells];if(cells.length<8)return;
    for(const i of [4,5,7]){
      const n=number(cells[i].textContent);
      mark(cells[i],n==null?'t3-empty':n<0?'t3-negative':n>0?'t3-positive':'t3-neutral');
    }
  });
  // Use column headings, not hard-coded column numbers, on Treasury and
  // gilt tables, so bid/offer prices and durations remain neutral.
  root.querySelectorAll('#view-bonds table').forEach(table=>{
    const headings=[...(table.tHead?.rows?.[0]?.cells||[])];
    headings.forEach((th,i)=>{
      const label=th.textContent.replace(/\s+/g,' ').trim();
      if(!/(gross ytm|yield to maturity|gross yield|running yield|annualised yield|cash return)/i.test(label))return;
      for(const body of table.tBodies)for(const row of body.rows){
        const cell=row.cells[i];if(!cell)continue;
        const n=number(cell.textContent);
        mark(cell,n==null?'t3-empty':n<0?'t3-negative':n>0?'t3-positive':'t3-neutral');
      }
    });
  });
  // The macro tiles are generated from the same D.macro rows used for the
  // displayed latest actual. Never infer a comparison from a missing source.
  const macro=[...(D.macro||[])].filter(m=>(m.region||'US')===state.macroRegion);
  const prints=new Map((D.economicPrints||[]).map(p=>[p.key,p]));
  const econ=root.querySelector('#macro-tiles');
  if(econ){
    const tiles=[...econ.children].filter(n=>n.matches('button'));
    for(let i=0;i<tiles.length&&i<macro.length;i++){
      const m=macro[i],p=prints.get(m.key),tile=tiles[i];
      const actual=m.value,previous=p?.previous;
      const mperiod=String(m.period||m.date||'').slice(0,10),pperiod=String(p?.period||p?.observationDate||'').slice(0,10);
      const compatible=finite(actual)&&finite(previous)&&
        (!finite(p?.value)||Math.abs(Number(p.value)-Number(actual))<0.00001)&&
        (!mperiod||!pperiod||mperiod===pperiod);
      const value=tile.querySelector('.mv'),prior=tile.querySelector('.r28-economic-sub');
      let delta=tile.querySelector('.t3-econ-delta');
      if(!compatible){
        mark(value,null);if(delta)delta.remove();continue;
      }
      const move=Number(actual)-Number(previous);
      const movement=Math.abs(move)<1e-9?0:move;
      const direction=movement>0?'t3-positive':movement<0?'t3-negative':'t3-neutral';
      mark(value,direction);
      if(!delta){delta=document.createElement('div');delta.className='t3-econ-delta';(prior||value||tile.lastChild).after(delta);}
      const unit=p.unit||m.unit||'';
      const policy=m.frequency==='policy'&&p.policyChangeDate;
      const label=policy
        ?(movement===0?'No recorded change':(movement>0?'↑ +':'↓ −')+fmt(Math.abs(Number(p.policyChangeBp??movement*100)),0)+' bp')+' · '+datefmt(p.policyChangeDate)
        :movement===0?'No change vs prior':(movement>0?'↑ +':'↓ −')+fmt(Math.abs(movement),2)+unit+' vs prior';
      if(delta.textContent!==label)delta.textContent=label;
      mark(delta,direction);
      delta.title=policy?'Change from previous DISTINCT official policy rate on the shown effective date.':'Increase/decrease since previous official observation; not a judgement about economic conditions.';
    }
  }
  // Actual-vs-previous table: colour actual by direction, leave the prior
  // number untouched and never fabricate forecast data.
  const printed=(D.economicPrints||[]).filter(p=>p.region===state.macroRegion).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const table=root.querySelector('#macro-print-rows');
  if(table){
    const rows=[...table.rows];
    printed.forEach((p,i)=>{
      const tr=rows[i],cell=tr?.cells?.[2];if(!cell||tr.cells[0]?.textContent!==p.name)return;
      const valid=finite(p.value)&&finite(p.previous),d=valid?Number(p.value)-Number(p.previous):null;
      const tone=d==null?'t3-empty':d>0?'t3-positive':d<0?'t3-negative':'t3-neutral';
      mark(cell,tone);
      if(valid)cell.title=(d>0?'Increase':d<0?'Decrease':'No change')+' vs previous observation (direction only)';
    });
  }
}
