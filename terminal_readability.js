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
  const niceDate=t=>t.replace(ISO,(m,y,mo,d,hm)=>`${+d} ${MONTHS[+mo-1]} ${y}`+(hm?', '+hm:''))
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
      document.querySelectorAll('#workspace-stage table tbody').forEach(datesIn);econDates();classify();currency();t3colour();align();tone();slim();
    }catch(e){console.warn('readability layer',e)}
    busy=false;
  }
  function schedule(){if(queued)return;queued=true;setTimeout(()=>{queued=false;apply()},60)}

  apply();
  const stage=document.getElementById('workspace-stage')||document.body;
  new MutationObserver(()=>{if(!busy)schedule()}).observe(stage,{childList:true,subtree:true,characterData:true});
  const st=document.getElementById('stamp');if(st)new MutationObserver(()=>{if(!busy)schedule()}).observe(st,{childList:true,characterData:true,subtree:true});
})();
