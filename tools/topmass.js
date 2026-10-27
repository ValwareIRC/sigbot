// how big is #1? leaderboard #1 names (live) vs the biggest mass our bots have seen each name at
const fs=require('fs'),path=require('path');const G=(process.env.LAB_DATA||process.env.APPDATA+'/prism/gadget-data/sigmally-lab')+'';
const since=Date.now()-(+(process.argv[2]||60))*60e3;
const lb=fs.readFileSync(G+'/lb.jsonl','utf8').trim().split('\n').map(l=>{try{return JSON.parse(l)}catch(e){}}).filter(r=>r&&r.t>=since&&!/^Mega-/.test(r.who||'')&&!r.label);
const top1={};for(const r of lb){const n=(r.names||[])[0];if(n!==undefined)top1[n]=(top1[n]||0)+1;}
const seen={};const D=G+'/deaths';
for(const f of fs.readdirSync(D).filter(f=>f.endsWith('.json')).sort().reverse()){if(+f.split('-')[0]<since)break;const d=JSON.parse(fs.readFileSync(path.join(D,f),'utf8'));if(d.kind!=='browser')continue;
 for(const fr of d.frames||[]){const by={};for(const c of fr.cells||[]){if(c[4]===0||!c[5])continue;by[c[5]]=(by[c[5]]||0)+c[3]*c[3]/100;}for(const n in by)seen[n]=Math.max(seen[n]||0,Math.round(by[n]));}}
console.log('leaderboard #1 (share of samples) -> biggest total mass our bots saw them at');
for(const [n,c] of Object.entries(top1).sort((a,b)=>b[1]-a[1]).slice(0,8))console.log(' ',(c/lb.length*100).toFixed(0)+'%',JSON.stringify(n),'->',seen[n]||'never seen');
const all=Object.entries(seen).sort((a,b)=>b[1]-a[1]).slice(0,8);console.log('biggest players seen at all:',all.map(([n,m])=>n+' '+m).join(' | '));
