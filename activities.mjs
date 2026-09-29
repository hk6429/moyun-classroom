// 排列題（排序／配對／分類）、評分與第二輪作答的共用邏輯。
// 教材以「每行一筆」保存在 slide.options；學生看到的順序由開課時產生的 room.shuffle 決定，未公布前不送出正解。
export const ARRANGE_MODES={order:'排序',match:'配對',group:'分類'};
const clean=lines=>(Array.isArray(lines)?lines:[]).map(x=>String(x).trim()).filter(Boolean);
export function parseArrange(mode,lines){
 const rows=clean(lines);
 if(mode==='order'){if(rows.length<2||rows.length>12)throw Error('排序題需 2 至 12 個項目，每行一個');return {items:rows};}
 if(mode==='match'){const pairs=rows.map(l=>l.split(/[=＝｜|]/).map(x=>x.trim()));if(pairs.length<2||pairs.length>10||pairs.some(p=>p.length!==2||!p[0]||!p[1]))throw Error('配對題每行寫「左邊＝右邊」，需 2 至 10 組');return {left:pairs.map(p=>p[0]),right:pairs.map(p=>p[1])};}
 if(mode==='group'){const groups=rows.map(l=>{const m=l.split(/[:：]/);if(m.length!==2||!m[0].trim())throw Error('分類題每行寫「類別：項目、項目」');return {name:m[0].trim(),items:m[1].split(/[,，、]/).map(s=>s.trim()).filter(Boolean)};});const items=groups.flatMap((g,i)=>g.items.map(text=>({text,group:i})));if(groups.length<2||groups.length>6||items.length<2||items.length>20)throw Error('分類題需 2 至 6 個類別、共 2 至 20 個項目');return {groups:groups.map(g=>g.name),items};}
 throw Error('請選擇排列方式');
}
const size=(mode,p)=>mode==='order'?p.items.length:mode==='match'?p.right.length:p.items.length;
export function arrangeShuffle(slide,randomInt){const n=size(slide.mode,parseArrange(slide.mode,slide.options)),perm=[...Array(n).keys()];for(let i=n-1;i>0;i--){const j=randomInt(0,i+1);[perm[i],perm[j]]=[perm[j],perm[i]];}if(perm.every((x,i)=>x===i))[perm[0],perm[1]]=[perm[1],perm[0]];return perm;}
export function arrangeView(slide,perm,revealed){
 const p=parseArrange(slide.mode,slide.options);
 if(slide.mode==='order')return {mode:'order',items:perm.map(i=>p.items[i]),...(revealed?{solution:p.items.map((_,k)=>perm.indexOf(k))}:{})};
 if(slide.mode==='match')return {mode:'match',left:p.left,right:perm.map(i=>p.right[i]),...(revealed?{solution:p.left.map((_,i)=>perm.indexOf(i))}:{})};
 return {mode:'group',groups:p.groups,items:perm.map(i=>p.items[i].text),...(revealed?{solution:perm.map(i=>p.items[i].group)}:{})};
}
export function validArrange(slide,perm,a){
 const p=parseArrange(slide.mode,slide.options),n=perm.length;
 if(!Array.isArray(a)||!a.every(Number.isInteger))return false;
 if(slide.mode==='order')return a.length===n&&new Set(a).size===n&&a.every(d=>d>=0&&d<n);
 if(slide.mode==='match')return a.length===p.left.length&&new Set(a).size===a.length&&a.every(d=>d>=0&&d<n);
 return a.length===n&&a.every(g=>g>=0&&g<p.groups.length);
}
function arrangeCorrect(slide,perm,a){const p=parseArrange(slide.mode,slide.options);if(slide.mode==='group')return a.every((g,d)=>p.items[perm[d]].group===g);return a.every((d,k)=>perm[d]===k);}
export function arrangeText(slide,perm,a){
 const p=parseArrange(slide.mode,slide.options);
 if(slide.mode==='order')return a.map(d=>p.items[perm[d]]).join(' → ');
 if(slide.mode==='match')return a.map((d,i)=>p.left[i]+'＝'+p.right[perm[d]]).join('；');
 return p.groups.map((g,gi)=>g+'：'+a.map((x,d)=>x===gi?p.items[perm[d]].text:null).filter(Boolean).join('、')).join('；');
}
// 可自動判對錯的題型回傳 true／false，其餘回傳 null
export function isCorrect(room,index,answer){
 const s=room.deck[index];if(answer===undefined||answer===null)return null;
 if(['quiz','racequiz'].includes(s.type))return answer===s.correct;
 if(s.type==='fill')return answer===s.solution;
 if(s.type==='arrange')return Array.isArray(answer)&&arrangeCorrect(s,room.shuffle[index],answer);
 return null;
}
export const graded=s=>['quiz','fill','arrange'].includes(s.type);
// 教師端：錯答聚合、高信心答錯、兩輪對照
export function insight(room,index,names){
 const s=room.deck[index],answers=room.answers[index]||{},conf=room.confidence?.[index]||{};
 if(!graded(s))return null;
 const rows=Object.entries(answers).filter(([id])=>names.has(id)).map(([id,a])=>({id,name:names.get(id),correct:isCorrect(room,index,a),answer:a,confidence:conf[id]||null}));
 const wrong=rows.filter(r=>r.correct===false);
 const groups=s.type==='quiz'?s.options.map((o,i)=>({label:o,names:wrong.filter(r=>r.answer===i).map(r=>r.name)})).filter(g=>g.names.length):[];
 const first=room.peer?.[index];
 let peer=null;
 if(first){const before=Object.entries(first.answers).filter(([id])=>names.has(id)),rightBefore=before.filter(([,a])=>isCorrect(room,index,a)).length;peer={round:2,firstTotal:before.length,firstCorrect:rightBefore,secondTotal:rows.length,secondCorrect:rows.filter(r=>r.correct).length,fixed:rows.filter(r=>r.correct&&first.answers[r.id]!==undefined&&!isCorrect(room,index,first.answers[r.id])).map(r=>r.name)};}
 return {total:rows.length,correct:rows.filter(r=>r.correct).length,sureWrong:wrong.filter(r=>r.confidence===3).map(r=>r.name),guessRight:rows.filter(r=>r.correct&&r.confidence===1).map(r=>r.name),groups,peer};
}
// 影片中途提問：每行「分:秒 問題｜選項｜*正解｜選項」
export function parseCheckpoints(lines){
 const rows=(Array.isArray(lines)?lines:[]).map(x=>String(x).trim()).filter(Boolean);if(rows.length>10)throw Error('影片提問最多 10 題');
 return rows.map(l=>{const m=/^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$/.exec(l);if(!m)throw Error('影片提問每行開頭寫時間，例如「1:30 問題｜選項｜*正解」');const parts=m[4].split(/[｜|]/).map(x=>x.trim()).filter(Boolean),q=parts.shift(),options=parts.map(o=>o.replace(/^[*＊]/,'').trim()),correct=parts.findIndex(o=>/^[*＊]/.test(o));if(!q||options.length<2||options.length>6||correct<0||parts.filter(o=>/^[*＊]/.test(o)).length!==1)throw Error('影片提問需 2 至 6 個選項，並在正解前加 *');return {at:Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]),question:q.slice(0,200),options:options.map(o=>o.slice(0,120)),correct};}).sort((a,b)=>a.at-b.at);
}
// 朱批共讀：把文章切成句子，學生逐句蓋「要／疑／妙」
export const STAMPS={key:'要',doubt:'疑',good:'妙'};
export function sentences(text){return String(text||'').split(/\n+/).flatMap(p=>p.match(/[^。！？；!?]+[。！？；!?」』）)]*|[^。！？；!?]+$/g)||[]).map(x=>x.trim()).filter(Boolean).slice(0,120);}
export function validStamps(n,a){if(!a||typeof a!=='object'||!a.stamps||typeof a.stamps!=='object')return false;const e=Object.entries(a.stamps);return e.length>0&&e.length<=40&&e.every(([i,v])=>/^\d+$/.test(i)&&Number(i)<n&&STAMPS[v]);}
export function readingHeat(n,answers){const heat=Array.from({length:n},()=>({key:0,doubt:0,good:0}));for(const a of answers)for(const [i,v]of Object.entries(a?.stamps||{}))if(heat[i]&&STAMPS[v])heat[i][v]++;return heat;}
// 自主進度的錯題複習用：只接受可評分題型的合法作答
export function validGraded(slide,perm,a){if(['quiz','racequiz'].includes(slide.type))return Number.isInteger(a)&&a>=0&&a<slide.options.length;if(slide.type==='fill')return typeof a==='string'&&!!a.trim()&&a.length<=1000;if(slide.type==='arrange')return validArrange(slide,perm,a);return false;}
// 記憶牌卡：每行「正面＝背面」；學生翻卡後自評記得（1）或不熟（0）
export function parseCards(lines){const rows=(Array.isArray(lines)?lines:[]).map(x=>String(x).trim()).filter(Boolean),cards=rows.map(l=>l.split(/[=＝｜|]/).map(x=>x.trim()));if(cards.length<2||cards.length>40||cards.some(c=>c.length!==2||!c[0]||!c[1]))throw Error('記憶牌卡每行寫「正面＝背面」，需 2 至 40 張');return cards.map(([front,back])=>({front,back}));}
export function validCards(n,a){if(!a||typeof a!=='object'||!a.cards||typeof a.cards!=='object')return false;const e=Object.entries(a.cards);return e.length>0&&e.every(([i,v])=>/^\d+$/.test(i)&&Number(i)<n&&(v===0||v===1));}
