// how our bots get killed by enemies: killer/our size, modes before, pieces, danger trend, distance when it began
const fs=require('fs'),path=require('path');const D=(process.env.LAB_DATA||process.env.APPDATA+'/prism/gadget-data/sigmally-lab')+'/deaths';
const mins=+(process.argv[2]||60),since=Date.now()-mins*60e3;
const strip=s=>(s||'').replace(/🚨/g,'').replace(/\(.*?\)/g,'').replace(/\d+/g,'#').replace(/ +/g,' ').trim();
const fsN=fs.readdirSync(D).filter(f=>f.endsWith('.json')).sort().reverse();
const modes={},ratio=[],seen=[],kinds={},dangerLate=[],pieces={};let n=0;
for(const f of fsN){if(+f.split('-')[0]<since)break;const d=JSON.parse(fs.readFileSync(path.join(D,f),'utf8'));
 if(d.kind!=='browser'||/teammate/.test(d.cause||''))continue;n++;
 const k=d.killer||{};const fr=d.frames||[];const last=fr[fr.length-1]||{};
 const mySize=Math.sqrt((d.massBefore||1)*100);ratio.push(+(k.s/ (last.cells? Math.max(...last.cells.filter(c=>c[4]===0||c[4]===undefined).map(c=>c[3]),1):mySize)).toFixed(2));
 const mb=[...new Set((d.modesBefore||[]).map(x=>strip(typeof x==='string'?x:x.mode)))].slice(-2).join(' > ');modes[mb]=(modes[mb]||0)+1;
 kinds[(k.bot?'server bot':'player')+(k.teamer?' teamer':'')]=(kinds[(k.bot?'server bot':'player')+(k.teamer?' teamer':'')]||0)+1;
 pieces[last.pieces||'?']=(pieces[last.pieces||'?']||0)+1;
 // first frame where the killer was visible
 const first=fr.find(x=>(x.cells||[]).some(c=>c[0]===k.id||c[5]===k.name));const fi=first?fr.indexOf(first):-1;seen.push(fi<0?'-':((fr.length-fi)*0.2).toFixed(1));
 const dang=fr.slice(-10).map(x=>x.danger||0);dangerLate.push(Math.round(Math.max(...dang)/(d.massBefore||1)*100));}
const top=(o,c)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,c).map(([a,b])=>b+'  '+a).join('\n');
ratio.sort((a,b)=>a-b);console.log('enemy kills',n,'| killer/our-biggest size ratio median',ratio[ratio.length>>1],'p25',ratio[ratio.length>>2],'p75',ratio[(ratio.length*3)>>2]);
console.log('killer kind:',JSON.stringify(kinds));console.log('our pieces at death:',JSON.stringify(pieces));
console.log('max danger % of mass in last 2s (median):',dangerLate.sort((a,b)=>a-b)[dangerLate.length>>1]);
console.log('modes before:\n'+top(modes,15));
