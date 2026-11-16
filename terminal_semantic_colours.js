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
      const label=movement===0?'No change vs prior':(movement>0?'↑ +':'↓ −')+fmt(Math.abs(movement),2)+unit+' vs prior';
      if(delta.textContent!==label)delta.textContent=label;
      mark(delta,direction);
      delta.title='Increase/decrease since previous official observation; not a judgement about economic conditions.';
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
