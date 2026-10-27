// livestats: the loop's scoreboard - leaderboard places, deaths and causes, wobbles, over the last N minutes
const fs=require('fs'),path=require('path');const G=(process.env.LAB_DATA||process.env.APPDATA+'/prism/gadget-data/sigmally-lab')+'';
const mins=+(process.argv[2]||60), since=Date.now()-mins*60e3;
const lines=f=>{try{return fs.readFileSync(path.join(G,f),'utf8').trim().split('\n').map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)}catch(e){return[]}};
const lb=lines('lb.jsonl').filter(r=>r.t>=since && !/^Mega-/.test(r.who||'') && !r.label);
const places=lb.map(r=>{const L=r.lb||r.list||r.entries||r.top||[];const me=(r.me||r.place||r.pos);return me}).filter(x=>x);
let best=1e9,hist={};for(const r of lb){const p=r.pos;if(typeof p==='number'&&p>0){best=Math.min(best,p);hist[p]=(hist[p]||0)+1;}}
console.log(`last ${mins} min: lb samples ${lb.length}, best place ${best===1e9?'-':best}, places ${JSON.stringify(hist)}`);
if(lb.length)console.log('sample lb record keys:',Object.keys(lb[lb.length-1]).join(','));
const D=path.join(G,'deaths');const fsN=fs.readdirSync(D).filter(f=>f.endsWith('.json')).sort().reverse();
const cause={},mass=[];for(const f of fsN){if(+f.split('-')[0]<since)break;const d=JSON.parse(fs.readFileSync(path.join(D,f),'utf8'));if(d.kind!=='browser')continue;const c=(d.cause||'').replace(/teammate.*/,'teammate').replace(/ by .*/,' by X');cause[c]=(cause[c]||0)+1;mass.push(d.massBefore||0);}
mass.sort((a,b)=>a-b);console.log('deaths',mass.length,JSON.stringify(cause),'median mass',mass[mass.length>>1]||0,'max',mass[mass.length-1]||0);
const w=lines('teamlog.jsonl').map(r=>r.entry||r).filter(r=>r.kind==='stuck wobbling'&&r.t>=since&&r.client==='Your game');console.log('wobbles',w.length,'(',(w.length/mins*60).toFixed(0),'/h)');
