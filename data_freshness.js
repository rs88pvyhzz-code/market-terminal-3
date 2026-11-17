// Data freshness strip: one line, one entry per source, with its age in business days.
// Reads only the snapshot already embedded in the page; changes no figure.
// Green: current. Amber: one or two business days behind what is expected.
// Red: older. A source that silently falls back to saved data therefore shows up.
(function(){
  'use strict';
  var D=window.MT_DATA;if(!D)return;
  function day(v){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(v||'');return m?Date.UTC(+m[1],+m[2]-1,+m[3]):null;}
  function latest(list,pick){var best=null;(list||[]).forEach(function(x){var t=day(pick(x));if(t!==null&&(best===null||t>best))best=t;});return best;}
  function businessDays(from,to){var n=0;for(var t=from;t<to;t+=864e5){var w=new Date(t+864e5).getUTCDay();if(w!==0&&w!==6)n++;}return n;}
  var now=day(String(D.generatedAt||'').slice(0,10))||day(new Date().toISOString());
  var rows=[
    ['Prices',latest(D.quotes,function(x){return x.asOf;}),1,3],
    ['Gilts',latest(D.gilts,function(x){return x.asOf;}),1,3],
    ['US Treasuries',latest(D.us_treasuries,function(x){return x.asOf;}),2,4],
    ['Yield curves',latest(D.uk_rates,function(x){return x.date;}),3,6],
    ['News',latest(D.news,function(x){return x.published;}),2,5]
  ];
  function paint(){
    var host=document.getElementById('freshness-strip');
    if(!host){
      var stamp=document.querySelector('header .stamp');if(!stamp)return;
      host=document.createElement('div');host.id='freshness-strip';host.setAttribute('aria-label','Data freshness');
      stamp.appendChild(host);
    }
    host.textContent='';
    rows.forEach(function(r){
      if(r[1]===null)return;
      var age=businessDays(r[1],now),level=age<=r[2]?'ok':age<=r[3]?'warn':'old';
      var s=document.createElement('span');s.className='fresh-'+level;
      s.textContent=r[0]+' '+new Date(r[1]).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
      s.title=r[0]+': latest observation '+new Date(r[1]).toISOString().slice(0,10)+' ('+age+' business day'+(age===1?'':'s')+' before the build)';
      host.appendChild(s);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paint);else paint();
})();
