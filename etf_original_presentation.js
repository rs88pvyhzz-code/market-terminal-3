/* Original Market Terminal ETF presentation, source ced3f6a, terminal_template.html
   and etf_consolidation.py. Adaptations: exact peers capped at three, no repeated
   cards, full-current-catalogue search. No return/risk/FX calculations changed. */
// Release 2.10: hide specialist ESG/climate strategies from the presented
// candidate universe. All sourced catalogue records remain in the data layer.
function etfIsConventional(f){
 const text=[f.name,f.benchmark,f.market].join(' ');
 return !/\b(?:ESG|SRI|climate|low[ -]?carbon|carbon[ -]?transition|Paris[ -]?aligned|sustainable|sustainability|green[ -]?bond|net[ -]?zero|responsible[ -]?investment|SDG|PAB|CTB)\b/i.test(text);
}
function etfMarketGroup(f){
 // Equity "Europe", "Eurozone", Germany DAX, France etc remain distinct.
 // Bonds and equities are never combined merely because both say Global.
 return [f.category||'unknown',f.market||'unknown'].join('|').toLowerCase();
}
function etfOriginalKey(f){
  const explicit=[f.name,f.benchmark,f.market].join(' ').match(/\b(?:GBP|USD|EUR|JPY|CHF)\s*[- ]?hedged\b/i)?.[0]||'';
  return etfV5Key(f)+'|'+explicit.toLowerCase().replace(/[- ]+/g,' ');
}
function etfUnderlyingIdentity(f){
 return etfOriginalKey(f)+'|'+String(f.name||'').toLowerCase()
 .replace(/\b(accumulating|accumulation|distributing|distribution|acc|dist|inc|income|1c|1d)\b/g,'')
 .replace(/[^a-z0-9]/g,'');
}
function etfShareClassRank(f){
 const name=String(f?.name||'');
 if(/\b(?:acc|accumulating|accumulation|1c)\b/i.test(name))return 0;
 if(/\b(?:dist|distributing|distribution|inc|income|1d)\b/i.test(name))return 2;
 return 1;
}
function etfOriginalPeers(f){
  if(!f?.benchmark)return [];
  const seen=new Set([etfUnderlyingIdentity(f)]);
  return ETF_FUNDS.filter(p=>etfIsConventional(p)&&p.symbol!==f.symbol&&etfUnderlyingIdentity(p)!==etfUnderlyingIdentity(f)&&etfOriginalKey(p)===etfOriginalKey(f))
   .sort((a,b)=>etfShareClassRank(a)-etfShareClassRank(b)||(a.terPct??Infinity)-(b.terPct??Infinity)||a.symbol.localeCompare(b.symbol))
   .filter(p=>{const id=etfUnderlyingIdentity(p);if(seen.has(id))return false;seen.add(id);return true;}).slice(0,3);
}
// All fund detail returns use the same actual anniversary-date convention as
// the main ETF table. Price and adjusted-price chart bases remain distinct.
const etfPreviousPerformance=etfPerformance;
etfPerformance=function(f,range='1Y',basis=etfState.basis){
 const years={'1Y':1,'3Y':3,'5Y':5,'10Y':10}[range];
 if(!years)return etfPreviousPerformance(f,range,basis);
 const rows=etfRows(f,'MAX',basis);
 if(rows.length<2)return null;
 const last=rows[rows.length-1],end=new Date(last.date+'T12:00:00Z');
 const cutoff=new Date(end.valueOf()),oldMonth=cutoff.getUTCMonth(),oldDay=cutoff.getUTCDate();
 cutoff.setUTCFullYear(cutoff.getUTCFullYear()-years);
 if(oldMonth===1&&oldDay===29&&cutoff.getUTCMonth()!==1)cutoff.setUTCDate(0);
 const periodDays=86400000;
 let best=null,bestDistance=Infinity;
 for(const row of rows.slice(0,-1)){
  const date=new Date(row.date+'T12:00:00Z'),distance=Math.abs((date-cutoff)/periodDays);
  if(distance>7)continue;
  if(distance<bestDistance||(distance===bestDistance&&date>=cutoff)){best=row;bestDistance=distance;}
 }
 if(!best)return null;
 const span=(end-new Date(best.date+'T12:00:00Z'))/periodDays/365.25;
 if(span<years*.95||span>years*1.07)return null;
 const growth=last.v/best.v;
 return 100*(years===1?growth-1:Math.pow(growth,1/span)-1);
};
etfV5Choose=function(symbol){
 const f=ETF_BY_SYMBOL.get(symbol);if(!f)return;
 etfState.selected=symbol;etfCompareBenchmark=f.benchmark||'';
 const allowed=new Set(etfOriginalPeers(f).map(p=>p.symbol));etfState.compared=new Set([...etfState.compared].filter(s=>allowed.has(s)).slice(0,3));renderEtfTracker();
};
etfV5ChangeCompare=function(symbol,yes){
 const f=ETF_BY_SYMBOL.get(etfState.selected);
 if(!etfOriginalPeers(f).some(p=>p.symbol===symbol)||yes&&etfState.compared.size>=3&&!etfState.compared.has(symbol))return false;
 if(yes)etfState.compared.add(symbol);else etfState.compared.delete(symbol);
 renderEtfTracker();return true;
};
renderSameIndexETFs=function(){
 const target=$('etf-same-index'),selector=$('etf-same-index-benchmark'),f=ETF_BY_SYMBOL.get(etfState.selected);
 if(!target||!selector||!f)return;
 const names=[...new Set(ETF_FUNDS.filter(etfIsConventional).map(p=>p.benchmark).filter(Boolean))].sort();
 selector.replaceChildren(...names.map(s=>new Option(s,s)));
 selector.value=f.benchmark;
 const peers=etfOriginalPeers(f);target.replaceChildren();
 if(!peers.length){
  target.append(el('p','note','No other exact-benchmark and hedge-label alternatives are available.'));
 }else{
  // Restore the original nine-fact ETF cards, Details, Compare and issuer links.
  // One set only: three distinct compatible alternatives, no duplicate card
  // list or checked-comparison section. The complete catalogue stays searchable.
  const grid=el('div','etf-compare-grid');
  for(const p of peers){
   const card=etfV5Card(p,'Not in the selected fund details',true);
   card.dataset.etfAlternative=p.symbol;
   grid.append(card);
  }
  target.append(grid);
 }
 $('etf-same-index-note').textContent='Exact catalogue benchmark and hedge labels; unspecified issuer return variants require verification. Up to three alternatives. Returns in these cards use each fund’s recorded return basis; chart comparisons use the selected period and basis. Local currencies can differ.';
 etfV5PeerLabels();
};
initEtfSameIndex=function(){const selector=$('etf-same-index-benchmark');if(selector)selector.onchange=()=>{const f=ETF_FUNDS.find(f=>f.benchmark===selector.value);if(f)etfV5Choose(f.symbol);};};
const etfOriginalDetails=etfDetails;
etfDetails=function(){
 etfOriginalDetails();renderEtfStructure();renderEtfIssuerVerified();renderSameIndexETFs();
 const f=ETF_BY_SYMBOL.get(etfState.selected);if(!f)return;
 // Keep the newer unique quote/source information inside the original text areas.
 const q=f.quote;if(q?.price!=null)$('etf-selected-meta').append(document.createTextNode(' · Last quote '+fmt(q.price/(['GBp','GBX'].includes(q.currency)?100:1),2)+' '+(['GBp','GBX'].includes(q.currency)?'GBP':q.currency||'')+' · '+(q.asOf||'Quote date unavailable')+' · '+(q.source||'Source unavailable')));
 const one=f.returnPeriods?.['1Y'];
 if(one)$('etf-selected-meta').append(document.createTextNode(' · Table 1Y '+one.basis+' '+one.start+' to '+one.end+' ('+(f.returnEndSource||'historical chart')+')'));
 const riskHost=$('etf-risk-stats');
 if(riskHost)for(const tile of riskHost.querySelectorAll('.etf-stat')){
  const label=tile.querySelector('.k');
  if(label&&label.textContent.trim()==='1Y annualised')label.textContent='1Y period return';
 }
 if(f.returnEndSource?.includes('after-close')){
   const chartNote=$('etf-chart-note');
   if(chartNote&&etfState.basis.startsWith('adjusted'))chartNote.append(document.createTextNode(' Latest after-close quote has no matching adjusted-close candle: the return chart stops at the last verified adjusted close and does not impute an intervening dividend.'));
 }
 const host=$('etf-issuer-snapshot');if(host){const sources=el('p','note'),seen=new Set([$('etf-facts-link')?.href,$('etf-quote-link')?.href]);
  for(const [label,url] of [['Issuer',f.issuerVerifiedUrl||f.officialFactsUrl],['TER source',f.terUrl],['Structure',f.structureSource],['Lending policy',f.lendingPolicySource]])if(url?.startsWith('https://')&&!seen.has(url)){seen.add(url);const a=el('a','',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';sources.append(a,document.createTextNode(' · '));}
  sources.append(document.createTextNode('Issuer checked '+(f.issuerCheckedAt||'not recorded')+' · snapshot '+(f.snapshotCapturedAt||'not recorded')));host.append(sources);
 }
};
function etfV5PickMain(){
  const all=etfFiltered().filter(etfIsConventional);
  const groups=new Map();
  for(const f of all){
    const key=etfMarketGroup(f);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(f);
  }
  const keep=new Set();
  for(const funds of groups.values()){
    const ranked=funds.slice().sort((a,b)=>
      etfShareClassRank(a)-etfShareClassRank(b)||
      (a.terPct??Infinity)-(b.terPct??Infinity)||
      (etfAumUSD(b)??0)-(etfAumUSD(a)??0)||
      a.name.localeCompare(b.name));
    const seen=new Set();const distinct=ranked.filter(f=>{const k=etfUnderlyingIdentity(f);if(seen.has(k))return false;seen.add(k);return true;});
    const top=distinct.slice(0,2);
    // Preserve selected candidate context if its market is filtered.
    const selected=funds.find(f=>f.symbol===etfState.selected);
    if(selected&&!top.includes(selected)){const same=top.findIndex(f=>etfUnderlyingIdentity(f)===etfUnderlyingIdentity(selected));top[same>=0?same:top.length===2?1:0]=selected;}
    for(const f of top)keep.add(f.symbol);
  }
  return {all,shown:all.filter(f=>keep.has(f.symbol)),suppressed:all.length-keep.size};
}
function etfShortMove(f,k){
  try{const rows=etfRows(f,'MAX','adjusted_local');if(rows.length<2)return null;
    const last=rows[rows.length-1];let base=null;
    if(k==='1D')base=rows[rows.length-2];
    else{const c=new Date(last.date+'T12:00:00Z');if(k==='1W')c.setUTCDate(c.getUTCDate()-7);else c.setUTCMonth(c.getUTCMonth()-1);const t=c.toISOString().slice(0,10);
      for(let i=rows.length-1;i>=0;i--){if(rows[i].date<=t){base=rows[i];break;}}
      if(base&&(new Date(last.date)-new Date(base.date))/864e5>(k==='1W'?14:40))return null;}
    if(!base||!(base.v>0))return null;return 100*(last.v/base.v-1);}catch(e){return null;}
}
renderEtfTracker=function(){
  const etfViewport=$('etf-rows')?.closest('.etf-table-scroll'),savedTop=etfViewport?.scrollTop||0;
  _etfV5PriorRender(); // existing risk, issuer facts, chart, data-quality links preserved
  const tbody=$('etf-rows'),table=tbody?.closest('table'),thead=table?.querySelector('thead');
  if(!tbody||!table||!thead)return;
  const labels=['Fund / ticker','TER','P/S','Fund size','1D','1W','1M','1Y','3Y','5Y','Cmp'];
  const head=el('tr');
  for(const label of labels){const th=el('th','',label);th.scope='col';
    if(label==='TER')th.title='Annual ongoing charge. Not tracking error.';
    if(label==='Cmp')th.title='Tick to add this fund to the detailed comparison and display its expanded facts.';
    if(label==='P/S')th.title='P: physical; S: synthetic; ?: unknown. Click a fund for the exact replication detail.';
    if(['1Y','3Y','5Y'].includes(label))th.title='Annualised adjusted-close price proxy. Not certified NAV total return.';
    head.append(th);
  }
  thead.replaceChildren(head);
  const {all,shown,suppressed}=etfV5PickMain();
  const frag=document.createDocumentFragment();let lastGroup='';
  for(const f of shown){
    const region=typeof etfRegion==='function'?etfRegion(f)[2]:f.market;
    if($('etf-sort')?.value==='market'&&region!==lastGroup){
      const gr=el('tr','etf-geo-group'),th=el('th','',region||f.market);th.colSpan=11;th.scope='rowgroup';gr.append(th);frag.append(gr);lastGroup=region;
    }
    const row=el('tr',f.symbol===etfState.selected?'etf-active':'');row.dataset.etfSymbol=f.symbol;
    row.setAttribute('aria-label','View details of '+f.name);
    const name=etfCell(row,'');name.append(el('span','etf-compact-fund',f.name),el('span','etf-compact-sub',f.symbol+' · '+f.market));
    const fee=etfCell(row,etfFee(f),'n');fee.title=(f.terSource||f.terStatus||'Unverified')+(f.terCheckedAt?' · '+f.terCheckedAt:'');
    const [code,label]=etfV5Kind(f);const codecell=etfCell(row,code,'etf-compact-code');codecell.title=label+' · '+(f.replicationStatus||'unverified');
    const aum=etfCell(row,etfFundSize(f),'n');aum.title=(f.fundSizeSource||'Fund AUM unverified')+(f.fundSizeAsOf?' · '+f.fundSizeAsOf:'');
    for(const y of ['1D','1W','1M']){const v=etfShortMove(f,y);const c=etfCell(row,v==null?'—':etfPct(v),'n');c.title=y==='1D'?'Last close against previous close':y==='1W'?'Last close against close one week earlier':'Last close against close one month earlier';}
    for(const y of ['1Y','3Y','5Y']){
      // No silent fallback to price returns: only dated adjusted closing prices.
      const value=etfPerformance(f,y,'adjusted_local');
      const cell=etfCell(row,etfPct(value),'n');
      cell.title=value==null?
        y+' total return proxy unavailable: missing dated adjusted-close observations':
        y+' dividend/split-adjusted close proxy in quoted currency'+(y==='1Y'?'':' (annualised)')+'. Not audited fund NAV.';
    }
    const cell=etfCell(row,'','etf-compact-compare');
    const check=el('input');check.type='checkbox';check.checked=f.symbol===etfState.selected||etfState.compared.has(f.symbol);check.disabled=f.symbol===etfState.selected||!etfOriginalPeers(ETF_BY_SYMBOL.get(etfState.selected)).some(p=>p.symbol===f.symbol);
    check.setAttribute('aria-label','Compare '+f.symbol);check.onchange=()=>{if(!etfV5ChangeCompare(f.symbol,check.checked))check.checked=false;};cell.append(check);
    row.onclick=(e)=>{if(e.target.closest('input,button,a'))return;etfV5Choose(f.symbol);};
    frag.append(row);
  }
  tbody.replaceChildren(frag);if(etfViewport)etfViewport.scrollTop=savedTop;
  const label=$('etf-result-count');if(label)label.textContent=shown.length+' mainstream funds · '+suppressed+' other funds in these markets · maximum two per market · ESG/climate funds excluded · total-return proxy: 1Y period / 3Y & 5Y annualised · missing —';
  // Older wrappers used a seven-column layout; these eight match the headers.
  // Duplicate checked-fund cards are deliberately not restored.
  renderSameIndexETFs();
  etfV5PeerLabels();
};

function etfOriginalSetup(){
 const heading=$('view-etfs')?.querySelector('.workspace-title h1'),subtitle=$('view-etfs')?.querySelector('.workspace-title span');if(heading)heading.textContent='ETF RESEARCH';if(subtitle)subtitle.textContent='TER · tracking error · country funds · equities · bonds';
 $('etf-selected-comparisons')?.remove();
 const stylesheet=$('etf-original-styles');if(stylesheet)document.head.append(stylesheet);
}
document.addEventListener('DOMContentLoaded',etfOriginalSetup);
