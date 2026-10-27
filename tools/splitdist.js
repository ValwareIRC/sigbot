// split-kills: edge gap between the killer's biggest cell and our biggest, 1.0 / 0.6 / 0.3 s before death
const fs=require('fs'),path=require('path');const D=(process.env.LAB_DATA||process.env.APPDATA+'/prism/gadget-data/sigmally-lab')+'/deaths';
const since=Date.now()-(+(process.argv[2]||90))*60e3;const rows=[];
for(const f of fs.readdirSync(D).filter(f=>f.endsWith('.json')).sort().reverse()){if(+f.split('-')[0]<since)break;
 const d=JSON.parse(fs.readFileSync(path.join(D,f),'utf8'));if(d.kind!=='browser'||!/split-killed/.test(d.cause||''))continue;
 const fr=d.frames||[],k=d.killer||{};if(fr.length<10)continue;
 const gap=i=>{const x=fr[fr.length-1-i];if(!x||!x.cells)return null;const mine=x.cells.filter(c=>c[4]===0);const kc=x.cells.filter(c=>c[5]===k.name);if(!mine.length||!kc.length)return null;
  const m=mine.reduce((a,c)=>c[3]>a[3]?c:a),kk=kc.reduce((a,c)=>c[3]>a[3]?c:a);return {g:Math.round(Math.hypot(m[1]-kk[1],m[2]-kk[2])-m[3]-kk[3]),ks:kk[3],ms:m[3],n:kc.length};};
 rows.push({f,mass:d.massBefore,a:gap(5),b:gap(3),c:gap(1),ratio:k.s&&fr.length?k.s:0});}
for(const r of rows.slice(0,25))console.log(r.f.slice(0,13),r.mass,'| -1.0s',r.a&&r.a.g,'(killer',r.a&&r.a.ks,'pieces',r.a&&r.a.n,') | -0.6s',r.b&&r.b.g,'| -0.2s',r.c&&r.c.g,'killer pieces',r.c&&r.c.n,'| our size',r.a&&r.a.ms);
