// 競速測驗使用伺服器時間；前端倒數只協助顯示，不參與計分。
const raceExamples=[
 ['「他像一陣風跑過操場」主要使用哪種修辭？',['譬喻','排比','設問','對偶'],0],
 ['「月亮悄悄向我微笑」使用哪種修辭？',['誇飾','轉化（擬人）','引用','層遞'],1],
 ['哪一句主要使用誇飾？',['天空是藍色的','我餓得能吃下一頭牛','他走進教室','桌上有一本書'],1],
 ['「小鳥在樹上唱歌」中的「小鳥」是什麼詞性？',['動詞','形容詞','名詞','連詞'],2],
 ['「他認真地閱讀」中，「閱讀」是什麼詞性？',['名詞','量詞','介詞','動詞'],3],
 ['「因為下雨，所以比賽延期」表達什麼關係？',['因果','轉折','並列','選擇'],0],
 ['「雖然遇到困難，但是他沒有放棄」表達什麼關係？',['因果','轉折','選擇','並列'],1],
 ['「畫蛇添足」最適合形容哪種情況？',['努力後獲得成功','大家分工合作','做了多餘的事反而壞事','認真觀察事物'],2],
 ['哪個詞語最接近「寧靜」的意思？',['喧鬧','匆忙','擁擠','安靜'],3],
 ['閱讀文章時，要支持自己的解讀，哪個做法最合適？',['只說我覺得','引用文中線索並解釋','只看文章長度','只猜作者年齡'],1]
];
function newRaceDeck(){
 decks.push({name:'國文暖身・十題競速測驗',subject:'國文・競速測驗',color:'peach',slides:raceExamples.map(([title,options,correct])=>({type:'racequiz',title,options:[...options],correct,body:'選出最合適的答案。',seconds:20}))});
 deckIndex=decks.length-1;editIndex=0;save();navigate('edit');
}
const beforeRaceHome=home;home=function(){beforeRaceHome();const b=document.createElement('button');b.className='vermilion';b.textContent='建立十題競速測驗';b.onclick=newRaceDeck;$('#main .actions').append(b);};
const beforeRaceEditor=editor;editor=function(){beforeRaceEditor();const s=decks[deckIndex].slides[editIndex];if(s.type!=='racequiz')return;
 const controls=document.createElement('section');controls.className='race-config';controls.innerHTML='<h3>競速計分設定</h3><p>固定十題，每題最高 1,000 分，總分最高 10,000 分。答對越快分數越高；最後 10% 的時間答對也計 0 分。每題只能送出一次。</p><label for="race-seconds">本題作答時間（5～300 秒）</label><input id="race-seconds" type="number" min="5" max="300" step="1" value="'+(s.seconds??20)+'"><button id="race-time-all">套用至全部十題</button><p class="muted">例如 20 秒一題，第 18 秒起答對也計 0 分。請先修改十題題目、選項及正確答案；全班加入後由老師逐題開始。</p>';
 $('.editpanel').prepend(controls);$('#race-seconds').oninput=e=>{s.seconds=Number(e.target.value);save();};$('#race-time-all').onclick=()=>{if(!Number.isInteger(s.seconds)||s.seconds<5||s.seconds>300)return toast('請先填入 5 至 300 秒');decks[deckIndex].slides.forEach(q=>{if(q.type==='racequiz')q.seconds=s.seconds;});save();toast('已套用全部題目的作答時間');};
};
function raceTable(rows){return '<div class="race-table-wrap"><table class="race-table"><thead><tr><th>排名</th><th>學生</th><th>總分</th><th>答對</th><th>已答</th></tr></thead><tbody>'+rows.map(r=>'<tr class="'+(r.me?'race-me':'')+'"><td>'+r.rank+'</td><td>'+esc(r.name)+(r.me?'（你）':'')+'</td><td><strong>'+r.total.toLocaleString()+'</strong></td><td>'+r.correct+'</td><td>'+r.answered+'/10</td></tr>').join('')+'</tbody></table></div>';}
function raceRoom(){
 const race=state.race,s=state.slide,host=room.role==='host',closed=race.phase==='closed',submitted=state.mine!==null;
 const canAnswer=!host&&race.phase==='answering'&&!submitted;
 shell('<div class="roomhead"><div><span class="eyebrow">'+(host?'教師競速測驗':'學生競速測驗')+'</span><div>教室代碼 <strong class="roomcode">'+esc(room.code)+'</strong></div></div><div class="actions">'+(host?'<button data-action="share">複製入課連結</button><button id="race-export">匯出成績與排名</button>':'')+'<button data-nav="home">回首頁</button></div></div><div class="classgrid"><div><section class="slide race-slide"><div class="eyebrow">競速測驗 · 第 '+(state.index+1)+'／10 題 · 每題最高 1,000 分</div><div class="race-timer" role="timer" aria-label="剩餘作答時間"><strong id="race-clock"></strong><span id="race-points"></span></div><h1>'+esc(s.title)+'</h1><p>'+esc(s.body)+'</p>'+(!host&&['waiting','countdown'].includes(race.phase)?'<p>題目會在開始後出現。送出後不能修改，答錯或逾時為 0 分。</p>':'<div class="options">'+s.options.map((text,i)=>'<button class="option '+(state.mine===i?'selected ':'')+(closed&&s.correct===i?'correct':'')+'" data-race-answer="'+i+'" '+(!canAnswer?'disabled':'')+' aria-pressed="'+(state.mine===i)+'"><b>'+String.fromCharCode(65+i)+'</b><span>'+esc(text)+(closed&&s.correct===i?' ✓ 正確答案':'')+'</span></button>').join('')+'</div>')+
 (!host&&submitted?'<p class="feedback">已送出，本題不能修改。'+(race.mine?'本題 '+race.mine.points+' 分 · '+(race.mine.correct?'答對':'答錯')+' · '+(race.mine.elapsedMs/1000).toFixed(2)+' 秒':'等待本題結束公布成績。')+'</p>':'')+(!host&&closed&&!submitted?'<p class="feedback">本題未作答，計 0 分。</p>':'')+(closed&&s.explanation?'<p class="feedback">'+esc(s.explanation)+'</p>':'')+'</section>'+
 (race.rankings&&closed?'<section class="race-ranking"><h2>'+(race.finished?'全班總分與最終排名':'本題結束・累計排名')+'</h2><p>總分相同並列名次；滿分 10,000 分。</p>'+raceTable(race.rankings)+'</section>':'')+'</div><aside class="roomaside"><h3>測驗進度</h3><div class="statrow"><span>全班人數</span><strong id="count">'+state.people+'</strong></div><div class="statrow"><span>本題已答</span><strong id="submitted">'+state.submitted+'</strong></div><p class="connection" id="connection">競速測驗同步中</p><p>每題 '+race.seconds+' 秒。最後 '+(race.seconds*.1).toFixed(1)+' 秒答對也計 0 分。</p>'+(host?'<div class="race-controls">'+(race.phase==='waiting'&&!state.ended?'<button class="primary" id="race-start">'+(state.index===0?'全班就緒，開始第一題':'開始第 '+(state.index+1)+' 題')+'</button>':'')+(race.phase==='answering'?'<button id="race-close">提前收卷，公布本題</button>':'')+(closed&&!state.ended&&state.index<9?'<button class="primary" id="race-next">下一題 →</button>':'')+(!state.ended?'<button id="race-end">'+(race.finished?'完成測驗':'提前結束測驗')+'</button>':'<p>測驗已結束，成績已儲存。</p>')+'</div><h3>全班作答狀態</h3>'+state.roster.map(p=>'<p>'+esc(p.name)+' · '+(p.submitted?'已作答':'等待作答')+'</p>').join(''):'<p>由老師帶領逐題進行。老師開始後，請盡快選出正確答案。</p>')+'<p class="muted">以伺服器收到答案的時間計分，網路延遲可能影響分數。</p></aside></div>');
 const control=async data=>{await api('control',data);await poll();};
 if($('#race-start'))$('#race-start').onclick=()=>raceRun(()=>control({raceStart:true,indexExpected:state.index}));
 if($('#race-close'))$('#race-close').onclick=()=>raceRun(()=>control({reveal:true}));
 if($('#race-next'))$('#race-next').onclick=()=>raceRun(()=>control({index:state.index+1}));
 if($('#race-end'))$('#race-end').onclick=()=>{if(race.finished||confirm('提前結束後不能繼續作答，未作答題目為 0 分。確定結束？'))raceRun(()=>control({end:true}));};
 if($('#race-export'))$('#race-export').onclick=()=>raceRun(exportRace);
 document.querySelectorAll('[data-race-answer]').forEach(b=>b.onclick=()=>{if(b.disabled)return;const index=state.index,answer=Number(b.dataset.raceAnswer);document.querySelectorAll('[data-race-answer]').forEach(x=>x.disabled=true);raceRun(async()=>{await api('answer',{index,answer});await poll();});});
 updateRaceClock();
}
async function raceRun(fn){try{await fn();}catch(e){toast(e.message);signature='';await poll();}}
async function exportRace(){const data=await api('export');const cell=v=>'"'+(/^[=+@\-\t\r]/.test(String(v))?"'":'')+String(v??'').replace(/"/g,'""')+'"';const csv=rows=>'﻿'+rows.map(row=>row.map(cell).join(',')).join('\r\n');download('競速測驗-'+room.code+'-總排名.csv',csv([['排名','學生','總分','答對題數','作答題數'],...data.rankings.map(r=>[r.rank,r.name,r.total,r.correct,r.answered])]),'text/csv;charset=utf-8');download('競速測驗-'+room.code+'-逐題成績.csv',csv([['題次','題目','學生','作答','答對','分數','作答秒數'],...data.rows.map(r=>[r.page,r.title,r.name,r.answer,r.correct===null?'未作答':r.correct?'是':'否',r.points,r.elapsedMs===null?'':(r.elapsedMs/1000).toFixed(3)])]),'text/csv;charset=utf-8');}
function updateRaceClock(){
 if(page!=='room'||!state?.race||!$('#race-clock'))return;
 const r=state.race,now=r.serverNow+performance.now()-(r.clientAt??performance.now());
 const remaining=r.deadline===null?null:Math.max(0,(r.deadline-now)/1000);
 $('#race-clock').textContent=r.phase==='waiting'?'等待開始':r.phase==='closed'?'本題結束':r.phase==='countdown'?'準備 '+Math.max(0,Math.ceil((r.startedAt-now)/1000))+' 秒':remaining.toFixed(1)+' 秒';
 const elapsed=Math.max(0,now-r.startedAt),points=r.phase==='answering'?Math.max(0,1000-Math.floor(elapsed/(r.seconds*900)*1000)):0;
 $('#race-points').textContent=r.phase==='answering'?'現在答對約 '+points+' 分':'';
 if(remaining===0)document.querySelectorAll('[data-race-answer]').forEach(b=>b.disabled=true);
}
const beforeRaceClassroom=classroom;classroom=function(){if(state?.race)raceRoom();else beforeRaceClassroom();};
setInterval(updateRaceClock,100);
if(page==='home')home();else if(page==='edit')editor();else if(state?.race)raceRoom();
