// ETF TRACKERS — optional, snapshot-only extension using the existing chart and FX helpers.
const ETF_DATA = D.etfTracker || {funds:[],history:[],coverage:{}};
const ETF_FUNDS = ETF_DATA.funds || [];
const ETF_BY_SYMBOL = new Map(ETF_FUNDS.map(f=>[f.symbol,f]));
const ETF_HISTORY = new Map((ETF_DATA.history||[]).map(r=>[r.symbol,r.points||[]]));
const etfState = {selected:ETF_FUNDS[0]?.symbol||'',compared:new Set(),range:'5Y',basis:'adjusted_gbp',benchmark:'AUTO'};

function etfText(value){return value==null||value===''?'—':String(value);}
function etfPct(value){return value==null||!Number.isFinite(+value)?'—':fmt(value,2)+'%';}
function etfFee(f){return f.terPct==null?'—':fmt(f.terPct,2)+'%';}
function etfCell(row,value,cls){const cell=el('td',cls||'',value);row.append(cell);return cell;}
function etfStatistic(host,label,value,detail){
  const stat=el('div','etf-stat');stat.append(el('div','k',label),el('div','v',etfText(value)));
  if(detail)stat.append(el('div','d',detail));host.append(stat);
}
function etfFiltered(){
  const term=$('etf-search').value.trim().toLowerCase(),category=$('etf-category').value,market=$('etf-market').value;
  const replication=$('etf-replication').value,maxRaw=$('etf-maxfee').value.trim(),maximum=maxRaw===''?null:Number(maxRaw),sort=$('etf-sort').value;
  const rows=ETF_FUNDS.filter(f=>{
    if(category!=='all'&&f.category!==category)return false;
    if(market!=='all'&&f.market!==market)return false;
    if(replication==='physical'&&!f.replication?.startsWith('Physical'))return false;
    if(replication==='synthetic'&&!f.replication?.startsWith('Synthetic'))return false;
    if(replication==='unknown'&&f.replication)return false;
    if(maximum!=null&&Number.isFinite(maximum)&&(f.terPct==null||f.terPct>maximum))return false;
    return !term||[f.name,f.symbol,f.market,f.benchmark,f.note,f.isin].some(v=>String(v||'').toLowerCase().includes(term));
  });
  const compareNumber=(a,b,key,direction)=>{
    const x=a[key],y=b[key];return x==null&&y==null?0:x==null?1:y==null?-1:direction*(Number(x)-Number(y));
  };
  rows.sort((a,b)=>{
    if(sort==='name')return a.name.localeCompare(b.name);
    if(sort==='fee')return compareNumber(a,b,'terPct',1)||a.name.localeCompare(b.name);
    if(sort==='one')return compareNumber(a,b,'return1Y',-1)||a.name.localeCompare(b.name);
    if(sort==='three')return compareNumber(a,b,'return3Y',-1)||a.name.localeCompare(b.name);
    if(sort==='five')return compareNumber(a,b,'return5Y',-1)||a.name.localeCompare(b.name);
    return a.market.localeCompare(b.market)||compareNumber(a,b,'terPct',1)||a.name.localeCompare(b.name);
  });
  return rows;
}
function etfMarkets(){
  const picker=$('etf-market'),old=picker.value,category=$('etf-category').value;
  const markets=[...new Set(ETF_FUNDS.filter(f=>category==='all'||f.category===category).map(f=>f.market))].sort((a,b)=>a.localeCompare(b));
  picker.replaceChildren(new Option('All markets','all'));
  for(const market of markets)picker.add(new Option(market,market));
  picker.value=markets.includes(old)?old:'all';
}
// A one-day jump that reverses next day (bad FX or price print) is dropped, not drawn.
function etfDespike(points){
  if(points.length<5)return points;
  const bad=new Set();
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1].v,b=points[i].v,c=points[i+1].v;
    if(Math.abs(a/c-1)<0.03&&Math.abs(b/((a+c)/2)-1)>0.05)bad.add(i);
  }
  return bad.size?points.filter((_,i)=>!bad.has(i)):points;
}
function etfRows(f,range=etfState.range,basis=etfState.basis){
  const raw=ETF_HISTORY.get(f.symbol)||[],adjusted=basis.startsWith('adjusted'),toGBP=basis.endsWith('gbp');
  const points=raw.map(p=>{
    const val=Number(adjusted?p[2]:p[1]);
    if(!(val>0)||!Number.isFinite(val))return null;
    const price=toGBP?priceToGBP(val,f.quote?.currency||'',p[0]):val;
    return price!=null&&price>0&&Number.isFinite(price)?{date:p[0],v:price}:null;
  }).filter(Boolean);
  if(!points.length)return [];
  const clean=etfDespike(points);
  const start=startOf(clean.at(-1).date,range);
  return clean.filter(p=>p.date>=start);
}
function etfPerformance(f,range='1Y',basis=etfState.basis){
  const all=etfRows(f,range,basis);
  if(all.length<2)return null;
  const elapsed=(Date.parse(all.at(-1).date+'T12:00:00Z')-Date.parse(all[0].date+'T12:00:00Z'))/86400000/365.25;
  const years=range==='1Y'?1:range==='3Y'?3:range==='5Y'?5:range==='10Y'?10:0;
  if(years&&elapsed<years*0.90)return null;
  return 100*(Math.pow(all.at(-1).v/all[0].v,1/Math.max(elapsed,1/365.25))-1);
}
function etfRisk(f){
  const one=etfRows(f,'1Y',etfState.basis),period=etfRows(f,etfState.range,etfState.basis),returns=[];
  for(let i=1;i<one.length;i++){
    const days=(Date.parse(one[i].date)-Date.parse(one[i-1].date))/86400000;
    if(days>=1&&days<=5)returns.push(one[i].v/one[i-1].v-1);
  }
  let volatility=null;
  if(returns.length>=150){
    const mean=returns.reduce((s,x)=>s+x,0)/returns.length;
    volatility=100*Math.sqrt(returns.reduce((s,x)=>s+(x-mean)**2,0)/(returns.length-1))*Math.sqrt(252);
  }
  let peak=0,drawdown=null;
  for(const item of period){peak=Math.max(peak,item.v);if(peak>0)drawdown=Math.min(drawdown??0,100*(item.v/peak-1));}
  return {volatility,drawdown,n:returns.length,period:period.length};
}
// Comparable dividend-adjusted *ETF* proxies: unlike a price index, each
// candidate contains the reinvested-distribution adjustment when supplied.
const ETF_BENCHMARK_LIST=[
 {key:'WORLD',label:'FTSE All-World · VWRP',symbols:['VWRP.L']},
 {key:'SP500',label:'S&P 500 · CSPX / VUAG',symbols:['CSPX.L','VUAG.L']},
 {key:'FTSE250',label:'FTSE 250 · VMIG / VMID',symbols:['VMIG.L','VMID.L','MIDD.L']},
 {key:'FTSE100',label:'FTSE 100 · VUKE',symbols:['VUKE.L']},
 {key:'EM',label:'Emerging markets · EIMI',symbols:['EIMI.L']},
 {key:'GILTS',label:'UK gilts · VGOV / IGLT',symbols:['VGOV.L','IGLT.L']},
 {key:'AGGB',label:'Global aggregate bonds GBP hedged · VAGP',symbols:['VAGP.L']},
 {key:'SHORTGILTS',label:'Short UK gilts · IGLS',symbols:['IGLS.L']}
];
function etfBenchmarkChoices(){
 return ETF_BENCHMARK_LIST.map(entry=>{
   const fund=entry.symbols.map(symbol=>ETF_BY_SYMBOL.get(symbol)).find(f=>{
     if(!f||!ETF_HISTORY.has(f.symbol))return false;
     return ETF_HISTORY.get(f.symbol).filter(p=>Number(p[2])>0).length>=2;
   });
   return fund?{...entry,fund}:null;
 }).filter(Boolean);
}
function etfDefaultBenchmark(f){
 if(!f)return null;
 const market=String(f.market||'').toLowerCase();
 const preferences=f.category==='Bonds'?
   (/short gilt|0-5/.test(market)?['SHORTGILTS','GILTS','AGGB']:
    /uk gilt/.test(market)?['GILTS','AGGB']:
    ['AGGB','GILTS']):
   /ftse 250/.test(market)?['FTSE250','WORLD','SP500']:
   /ftse 100/.test(market)?['FTSE100','WORLD','SP500']:
   /united states|us equal weight|us health|us technology/.test(market)?['SP500','WORLD','FTSE250']:
   /emerging market/.test(market)?['EM','WORLD','SP500']:
   ['WORLD','SP500','FTSE250'];
 const all=etfBenchmarkChoices();
 return [...preferences,...all.map(x=>x.key)]
   .map(key=>all.find(x=>x.key===key&&x.fund.symbol!==f.symbol))
   .find(Boolean)||null;
}
function etfRefreshBenchmarkSelect(f){
 const picker=$('etf-benchmark');if(!picker)return;
 const previous=etfState.benchmark||'AUTO';
 const choices=etfBenchmarkChoices().filter(x=>x.fund.symbol!==f?.symbol);
 const options=[new Option('Suggested relevant benchmark','AUTO'),
   ...choices.map(x=>new Option(x.label+' (ETF total-return proxy)',x.key)),
   new Option('No benchmark','NONE')];
 picker.replaceChildren(...options);
 etfState.benchmark=[...picker.options].some(o=>o.value===previous)?previous:'AUTO';
 picker.value=etfState.benchmark;
 const suggested=etfDefaultBenchmark(f);
 picker.options[0].textContent='Suggested: '+(suggested?.label||'no sourced matching proxy');
}
function etfReference(f){
 if(etfState.benchmark==='NONE')return {error:'Benchmark comparison disabled'};
 const candidate=etfState.benchmark==='AUTO'?etfDefaultBenchmark(f):
   etfBenchmarkChoices().find(x=>x.key===etfState.benchmark&&x.fund.symbol!==f.symbol);
 if(!candidate)return {error:'No suitable ETF total-return benchmark is currently sourced'};
 const fund=candidate.fund;
 const ccy1=f.quote?.currency||'',ccy2=fund.quote?.currency||'';
 if(etfState.basis.endsWith('local')&&ccy1!==ccy2)
   return {error:'Selected fund and benchmark have different quoted currencies; select GBP comparison'};
 const points=etfRows(fund,etfState.range,etfState.basis);
 if(points.length<2)return {error:candidate.label+': adjusted history or dated FX unavailable'};
 return {name:candidate.label+' (total-return ETF proxy)',symbol:fund.symbol,points,reference:true};
}
function etfMatchedGap(first,second,range=etfState.range,basis=etfState.basis){
 if(!first||!second)return null;
 const a=etfRows(first,range,basis),b=etfRows(second,range,basis);
 const bm=new Map(b.map(p=>[p.date,p.v]));
 const joined=a.filter(p=>bm.has(p.date)).map(p=>({date:p.date,a:p.v,b:bm.get(p.date)}));
 if(joined.length<2)return null;
 const firstRow=joined[0],lastRow=joined.at(-1);
 const elapsed=(Date.parse(lastRow.date)-Date.parse(firstRow.date))/86400000/365.25;
 const wanted={'1Y':1,'3Y':3,'5Y':5}[range];
 if(wanted&&elapsed<wanted*.90)return null;
 const ratioA=lastRow.a/firstRow.a,ratioB=lastRow.b/firstRow.b;
 if(!(ratioA>0&&ratioB>0))return null;
 const annualised=elapsed>=1.5&&(range==='3Y'||range==='5Y');
 const aReturn=annualised?100*(Math.pow(ratioA,1/elapsed)-1):100*(ratioA-1);
 const bReturn=annualised?100*(Math.pow(ratioB,1/elapsed)-1):100*(ratioB-1);
 return {difference:aReturn-bReturn,annualised,from:firstRow.date,to:lastRow.date};
}
// Compared funds minus the selected fund, in percentage points, plus return gaps by period.
function etfDrawDifference(sets,primary,symbols){
 let box=document.getElementById('etf-diff-box');
 if(!box){box=document.createElement('div');box.id='etf-diff-box';
   box.innerHTML='<h3>DIFFERENCE VS SELECTED FUND (PERCENTAGE POINTS)</h3><div id="etf-diff-chart" class="chart"></div><div class="mt-table-scroll"><table class="watch" id="etf-diff-table"><thead><tr><th>Fund</th><th class="n">Latest gap</th><th class="n">1Y</th><th class="n">3Y</th><th class="n">5Y</th></tr></thead><tbody></tbody></table></div>';
   const anchor=$('etf-chart-note');(anchor||$('etf-chart')).after(box);}
 const base=sets.find(t=>t.symbol===primary.symbol);
 const peers=symbols.slice(1).map(symbol=>({fund:ETF_BY_SYMBOL.get(symbol),
   set:sets.find(t=>t.symbol===symbol)})).filter(t=>t.fund&&t.set);
 if(!base||!peers.length){box.hidden=true;box.style.display='none';return;}
 box.hidden=false;box.style.display='';
 const baseDates=new Map(base.pts.map(p=>[p.date,p.v]));
 const series=peers.map(({fund,set})=>({name:fund.symbol+' − '+primary.symbol,color:set.color,
   pts:set.pts.filter(p=>baseDates.has(p.date)).map(p=>({date:p.date,v:p.v-baseDates.get(p.date)}))}));
 chart('etf-diff-chart',series,{height:180,format:v=>(v>0?'+':'')+fmt(v,2),
   aria:'Matched-date percentage point return difference versus selected fund'});
 const body=box.querySelector('tbody');body.replaceChildren();
 peers.forEach(({fund},i)=>{
   const latest=series[i].pts.at(-1)?.v,tr=el('tr');
   const pairs=[fund.name+' · '+fund.symbol,
     Number.isFinite(latest)?(latest>0?'+':'')+fmt(latest,2)+' pp':'—',
     ...['1Y','3Y','5Y'].map(range=>{
       const result=etfMatchedGap(fund,primary,range);
       return result?(result.difference>0?'+':'')+fmt(result.difference,2)+(result.annualised?' pp p.a.':' pp'):'—';
     })];
   pairs.forEach((text,i)=>tr.append(el('td',i?'n':'',text)));body.append(tr);
 });
}
function etfDrawChart(){
 const primary=ETF_BY_SYMBOL.get(etfState.selected),stamp=$('etf-chart-stamp'),
   outcome=$('etf-relative-outcome'),note=$('etf-chart-note');
 if(!primary){empty('etf-chart','No ETF selected');if(outcome)outcome.textContent='';return;}
 const rejected=[],basePts=etfRows(primary);
 const basisLabel=etfState.basis.startsWith('adjusted')?'Total return (adjusted close proxy)':'Price only';
 if(stamp)stamp.textContent=etfState.range+' · '+basisLabel+' · '+
   (etfState.basis.endsWith('gbp')?'GBP converted':'Quoted currency');
 if(basePts.length<2){
   empty('etf-chart','No adjusted-price or FX observations for this fund and period.');
   if(note)note.textContent='No total return is imputed from raw prices. Try a different range or verify the quote feed.';
   if(outcome)outcome.textContent='';
   etfDrawDifference([],primary,[]);
   return;
 }
 const sources=[{name:primary.symbol,symbol:primary.symbol,points:basePts}];
 const symbols=[primary.symbol], maxPeers=etfState.benchmark==='NONE'?3:2;
 const candidate=etfReference(primary);
 let reference=null;
 if(candidate?.points?.length>=2&&candidate.symbol!==primary.symbol){
   const common=new Set(basePts.map(p=>p.date));
   if(candidate.points.some(p=>common.has(p.date))){
     reference=candidate;sources.push(candidate);
   }else rejected.push('Benchmark: no matched trading dates');
 }else if(candidate?.error&&etfState.benchmark!=='NONE')rejected.push('Benchmark: '+candidate.error);
 for(const symbol of etfState.compared){
   if(symbols.length>maxPeers)break;
   if(symbol===primary.symbol)continue;
   const fund=ETF_BY_SYMBOL.get(symbol),pts=fund?etfRows(fund):[];
   if(pts.length<2){rejected.push(symbol+': adjusted/FX observations missing');continue;}
   if(etfState.basis.endsWith('local')&&fund.quote?.currency!==primary.quote?.currency){
     rejected.push(symbol+': different quoted currency');continue;
   }
   const common=new Set(sources[0].points.map(p=>p.date));
   for(const src of sources.slice(1)){const m=new Set(src.points.map(p=>p.date));
     for(const date of [...common])if(!m.has(date))common.delete(date);}
   if(!pts.some(p=>common.has(p.date))){rejected.push(symbol+': no overlapping trading dates');continue;}
   symbols.push(symbol);sources.push({name:symbol,symbol,points:pts});
 }
 let dates=new Set(basePts.map(p=>p.date));
 for(const src of sources.slice(1)){
   const present=new Set(src.points.map(p=>p.date));
   dates=new Set([...dates].filter(day=>present.has(day)));
 }
 let days=[...dates].sort();
 if(days.length<2&&reference){
   // A mismatched reference must never make the selected ETF disappear.
   sources.splice(sources.indexOf(reference),1);reference=null;
   days=basePts.map(p=>p.date).sort();
   rejected.push('Benchmark dropped: insufficient exact matched observations');
 }
 if(days.length<2){
   empty('etf-chart','Insufficient matching dated observations for this comparison.');
   if(note)note.textContent=rejected.join(' · ');
   if(outcome)outcome.textContent='';
   etfDrawDifference([],primary,[]);
   return;
 }
 const sets=sources.map((src,i)=>{
   const prices=new Map(src.points.map(p=>[p.date,p.v])),base=prices.get(days[0]);
   return {name:src.name,symbol:src.symbol,reference:!!src.reference,
     color:src.reference?AQUA:(i===0?AMBER:PALETTE[i%PALETTE.length]),
     pts:days.map(date=>({date,v:100*prices.get(date)/base}))};
 });
 chart('etf-chart',sets,{height:290,format:v=>fmt(v,1),
   aria:'Reinvested-distribution ETF performance, each series indexed to 100 on '+days[0]});
 try{etfDrawDifference(sets,primary,symbols);}catch(e){
   console.warn('ETF difference chart unavailable',e);rejected.push('Peer difference chart could not be rendered');
 }
 const elapsed=(Date.parse(days.at(-1))-Date.parse(days[0]))/86400000/365.25;
 const years={'1Y':1,'3Y':3,'5Y':5}[etfState.range];
 const limited=years&&elapsed<years*.90;
 if(outcome){
   const b=reference&&sets.find(t=>t.symbol===reference.symbol);
   if(b){
     const gross=sets[0].pts.at(-1).v/100,bench=b.pts.at(-1).v/100;
     const pa=elapsed>=1.5&&(etfState.range==='3Y'||etfState.range==='5Y')&&!limited;
     const move=pa?100*(Math.pow(gross,1/elapsed)-Math.pow(bench,1/elapsed)):100*(gross-bench);
     outcome.textContent=(move>=0?'+':'')+fmt(move,2)+(pa?' pp p.a.':' pp')+
       ' vs '+reference.name+(limited?' · PARTIAL PERIOD':'');
     outcome.className='etf-relative-outcome '+(move>0?'pos':move<0?'neg':'');
   }else{outcome.textContent=etfState.benchmark==='NONE'?'No benchmark selected':'Benchmark unavailable for these dated observations';outcome.className='etf-relative-outcome';}
 }
 if(note)note.textContent='Indexed to 100 on '+datefmt(days[0])+' · through '+datefmt(days.at(-1))+
   ' · '+days.length+' exact matched trading dates'+(limited?' · PARTIAL '+etfState.range+' HISTORY':'')+
   '. '+(etfState.basis.startsWith('adjusted')?'Yahoo adjusted close is an unofficial total-return proxy. ':'Price-only diagnostic view excludes dividends. ')+
   (etfState.basis.endsWith('gbp')?'Both sides converted at dated FX observations. ':'Both sides must share their trading currency. ')+
   'Benchmark is an ETF proxy, not the fund’s official index or a tracking-difference statistic.'+
   (rejected.length?' Excluded: '+rejected.join('; '):'');
}
function etfDetails(){
  const fund=ETF_BY_SYMBOL.get(etfState.selected);if(!fund)return;
  const q=fund.quote||{};
  $('etf-selected').textContent=fund.name+' ['+fund.symbol+']';
  $('etf-selected-meta').textContent=fund.category+' · '+fund.market+' · '+(fund.domicile||'Domicile not verified')+' · '+(fund.isin||'ISIN not recorded');
  const issuer=$('etf-facts-link');issuer.href=fund.issuerFactsUrl||'https://www.justetf.com/uk/';issuer.textContent=fund.issuerFactsUrl?'CHECK ETF PROFILE':'SEARCH ETF FACTS';
  $('etf-quote-link').href='https://finance.yahoo.com/quote/'+encodeURIComponent(fund.symbol)+'/';
  const stats=$('etf-detail-stats');stats.replaceChildren();
  etfStatistic(stats,'Annual OCF / TER',etfFee(fund),'Editorial snapshot dated '+(fund.factsAsOf||'not checked'));
  etfStatistic(stats,'Replication',fund.replication||'Unverified',(fund.replication||'').startsWith('Synthetic')?'Swap counterparty/collateral exposure':'Fund legal structure');
  etfStatistic(stats,'Benchmark',fund.benchmark||'Unverified','Not necessarily chart reference');
  etfStatistic(stats,'Income',fund.distribution||'Unverified','Acc = reinvested; Dist = paid out');
  etfStatistic(stats,'Trading currency',q.currency||'Unavailable',fund.hedged?'Currency hedge: '+fund.hedged:'FX hedge not verified');
  etfStatistic(stats,'Last quotation',q.price==null?'Unavailable':fmt(q.price,Math.abs(q.price)<2?4:2),(q.asOf||'').slice(0,16)+' · '+(q.source||'No source'));
  etfStatistic(stats,'Fund size','Unavailable','Current issuer AUM not retrieved');
  etfStatistic(stats,'Bid-offer spread','Unavailable','No validated live two-way quotes');
  $('etf-warning').textContent=(fund.note||'')+(fund.note?' · ':'')+(fund.quoteStatus!=='Quoted'?'No confirmed current Yahoo price; fund stays in the catalogue. ':'')
    +'Charges, replication, fund size, share-class currency and trading line must be checked with the issuer or broker. No yield or tracking difference is manufactured.';
  const risk=etfRisk(fund),host=$('etf-risk-stats');host.replaceChildren();
  etfStatistic(host,'1Y volatility',etfPct(risk.volatility),risk.n>=150?risk.n+' daily observed returns':'Requires at least 150 daily returns');
  etfStatistic(host,'Max drawdown',etfPct(risk.drawdown),'Within selected '+etfState.range+' chart window');
  etfStatistic(host,'1Y annualised',etfPct(etfPerformance(fund,'1Y')),'Selected chart basis');
  etfStatistic(host,'3Y annualised',etfPct(etfPerformance(fund,'3Y')),'Selected chart basis');
  etfStatistic(host,'5Y annualised',etfPct(etfPerformance(fund,'5Y')),'Selected chart basis');
  etfStatistic(host,'Income yield','Unavailable','No validated issuer distribution yield');
  etfStatistic(host,'Tracking difference','Unavailable','Official index total-return data required');
  etfRefreshBenchmarkSelect(fund);
  etfDrawChart();
}
function renderEtfTracker(){
  if(!$('etf-rows'))return;
  const coverage=ETF_DATA.coverage||{};
  $('etf-coverage').textContent=(coverage.quoted||0)+'/'+(coverage.catalogued||ETF_FUNDS.length)+' quoted · '+(coverage.withHistory||0)+' charts';
  const stats=$('etf-stats');stats.replaceChildren();
  etfStatistic(stats,'CATALOGUED',ETF_FUNDS.length,'ETF / bond candidates');
  etfStatistic(stats,'MARKETS',[...new Set(ETF_FUNDS.map(f=>f.market))].length,'Countries, regions, bond sectors');
  etfStatistic(stats,'QUOTE COVERAGE',coverage.quoted||0,'Unavailable quotes shown openly');
  etfStatistic(stats,'REPLICATION VERIFIED',ETF_FUNDS.filter(f=>f.replication).length,'Missing values not assumed');
  const filtered=etfFiltered();
  $('etf-result-count').textContent=filtered.length+' funds matching filters · 1Y / 3Y / 5Y values are annualised';
  const body=$('etf-rows');body.replaceChildren();
  for(const fund of filtered){
    const row=el('tr',fund.symbol===etfState.selected?'etf-active':'');row.title='Select '+fund.name;
    const name=etfCell(row,'','');name.append(el('span','etf-name',fund.name),el('span','etf-market',fund.market));
    etfCell(row,fund.symbol);etfCell(row,fund.benchmark||'—');etfCell(row,etfFee(fund),'n');
    etfCell(row,fund.replication||'Unverified',fund.replication.startsWith('Synthetic')?'etf-swap':'etf-unknown');
    etfCell(row,fund.distribution||'—');
    etfCell(row,fund.quote?.price==null?'—':fmt(fund.quote.price,Math.abs(fund.quote.price)<2?4:2)+' '+(fund.quote.currency||''),'n');
    etfCell(row,etfPct(fund.return1Y),'n');etfCell(row,etfPct(fund.return3Y),'n');etfCell(row,etfPct(fund.return5Y),'n');
    etfCell(row,(fund.quote?.asOf||'').slice(0,10)||'Unavailable');
    const td=etfCell(row,'');const check=el('input');check.type='checkbox';check.checked=etfState.compared.has(fund.symbol);
    check.setAttribute('aria-label','Compare '+fund.symbol);check.onchange=()=>{
      if(check.checked){if(etfState.compared.size>=3){check.checked=false;return;}etfState.compared.add(fund.symbol);}
      else etfState.compared.delete(fund.symbol);
      etfDrawChart();
    };td.append(check);
    row.onclick=e=>{if(e.target.closest('input,a'))return;etfState.selected=fund.symbol;renderEtfTracker();};body.append(row);
  }
  if(!ETF_BY_SYMBOL.has(etfState.selected))etfState.selected=ETF_FUNDS[0]?.symbol||'';
  etfDetails();
}
function etfExport(){
  const columns=['market','category','symbol','name','benchmark','terPct','replication','distribution','domicile','isin','hedged','return1Y','return3Y','return5Y','quoteStatus','note'];
  const cell=x=>'"'+String(x==null?'':x).replace(/"/g,'""')+'"';
  const csv=[columns.map(cell).join(','),...(typeof etfV5PickMain==='function'?etfV5PickMain().shown:etfFiltered()).map(f=>columns.map(k=>cell(f[k])).join(','))].join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');
  a.href=url;a.download='etf-trackers-'+(D.generatedAt||'snapshot').slice(0,10)+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),250);
}
function initEtfTracker(){
  etfMarkets();
  $('etf-search').oninput=renderEtfTracker;
  $('etf-category').onchange=()=>{etfMarkets();renderEtfTracker();};
  for(const id of ['etf-market','etf-replication','etf-sort'])$(id).onchange=renderEtfTracker;
  $('etf-maxfee').oninput=renderEtfTracker;
  $('etf-period').onchange=e=>{etfState.range=e.target.value;etfDetails();};
  $('etf-basis').value=etfState.basis;
  $('etf-basis').onchange=e=>{etfState.basis=e.target.value;etfDetails();};
  $('etf-reference').checked=true;
  $('etf-reference').onchange=etfDrawChart;
  const benchmark=$('etf-benchmark');
  if(benchmark)benchmark.onchange=e=>{etfState.benchmark=e.target.value;etfDrawChart();};
  $('etf-clear-comparisons').onclick=()=>{etfState.compared.clear();renderEtfTracker();};
  $('etf-export').onclick=etfExport;
}
