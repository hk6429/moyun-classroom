// 自主練習：自主進度＋錯題回流、影片中途提問、錄音作答、朱批共讀。
types.audio='錄音作答';types.read='朱批共讀';
const stampNames={key:'要',doubt:'疑',good:'妙'},stampOrder=[null,'key','doubt','good'];
let stampDrafts=new Map(),recorder=null,recordTimer=null,recorded=null,recordStarted=0,checkpointWatch=null,checkpointOpen=null;const cpDone=new Set();

// 教材編輯：影片提問、朱批共讀、錄音說明
const practiceEditor=editor;editor=function(){practiceEditor();const s=decks[deckIndex].slides[editIndex],box=document.createElement('div');
 if(s.type==='resource')box.innerHTML='<div class="field"><label for="cues">影片中途提問（選填，只限 YouTube）</label><textarea id="cues" rows="4" placeholder="1:30 詩仙是誰？｜*李白｜杜甫｜王維">'+esc((s.cues||[]).join('\n'))+'</textarea><p class="muted">每行一題：「分:秒 問題｜選項｜選項」，在正確選項前加 *。影片播到該處會暫停，讓學生作答後再繼續。</p></div>';
 else if(s.type==='read')box.innerHTML='<p class="muted">把文章貼在「內容／引導文字」。系統會自動斷句，學生逐句蓋上朱批：<b>要</b>（重點）、<b>疑</b>（不懂）、<b>妙</b>（寫得好）。公布後全班可看見熱度。</p>';
 else if(s.type==='audio')box.innerHTML='<p class="muted">學生可直接用手機或電腦麥克風錄音（最長 3 分鐘），適合朗讀、口說與口頭報告。</p>';
 else return;
 $('#body').closest('.field').after(box);
 box.querySelector('#cues')?.addEventListener('input',e=>{s.cues=e.target.value.split('\n');save();});};

function blobToData(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('無法讀取錄音'));r.readAsDataURL(blob);});}
function stopRecording(){clearInterval(recordTimer);recordTimer=null;if(recorder?.state==='recording')recorder.stop();}

const practiceClassroom=classroom;classroom=function(){practiceClassroom();if(!state||state.race)return;const s=state.slide,host=room.role==='host',locked=state.reveal||state.ended,slide=$('.slide');if(!slide)return;
 const add=html=>{const div=document.createElement('div');div.innerHTML=html;slide.append(div);return div;};
 if(s.type!=='audio')stopRecording();
 // 自主進度：學生自行翻頁，錯題到期後回流
 if(!host&&state.paced){const follow=[...slide.parentElement.querySelectorAll(':scope > p.muted')].find(p=>p.textContent.includes('跟隨老師'));const review=state.review||{due:[],waiting:0},reviewing=review.due.includes(state.index);
  const nav=document.createElement('div');nav.className='pace-nav';nav.innerHTML='<div class="controls"><button data-pace="'+(state.index-1)+'" '+(state.index===0?'disabled':'')+'>← 上一頁</button><span class="muted">自主進度 · 第 '+(state.index+1)+' ／ '+state.total+' 頁</span><button class="primary" data-pace="'+(state.index+1)+'" '+(state.index===state.total-1?'disabled':'')+'>下一頁 →</button></div>'+(review.due.filter(i=>i!==state.index).length?'<button class="wide review-go" data-pace="'+review.due.find(i=>i!==state.index)+'">錯題回流：還有 '+review.due.filter(i=>i!==state.index).length+' 題可以再挑戰</button>':'')+(review.waiting?'<p class="muted">有 '+review.waiting+' 題答錯的題目，隔一會兒會回來讓你再試一次。</p>':'');
  if(follow)follow.replaceWith(nav);else slide.after(nav);
  if(reviewing)slide.querySelector('.slide-body').insertAdjacentHTML('beforebegin','<div class="round-banner">錯題回流：上次沒答對，隔了一段時間再試一次，記得更牢。</div>');
  nav.querySelectorAll('[data-pace]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('navigate',{index:Number(b.dataset.pace)});signature='';await poll();}catch(e){toast(e.message);b.disabled=false;}});}
 // 朱批共讀
 if(s.type==='read'&&s.sentences){const key=room.code+':'+state.index,heat=state.reading,mine=state.mine?.stamps||{};let draft=stampDrafts.get(key)||{...mine};stampDrafts.set(key,draft);
  const max=heat?Math.max(1,...heat.map(h=>h.key+h.doubt+h.good)):1;
  slide.querySelector('.slide-body').hidden=true;
  const box=add('<div class="reading">'+(host||heat?'':'<p class="muted">點一下句子蓋朱批：要（重點）→ 疑（不懂）→ 妙（寫得好）→ 取消。</p>')+'<ol class="reading-list">'+s.sentences.map((t,i)=>{const h=heat?.[i],n=h?h.key+h.doubt+h.good:0,st=host?null:draft[i];return '<li><button type="button" class="sentence'+(st?' stamped':'')+'" data-sentence="'+i+'" '+(host||locked?'disabled':'')+(h?' style="--heat:'+(n/max).toFixed(2)+'"':'')+'>'+esc(t)+(st?'<span class="stamp">'+stampNames[st]+'</span>':'')+(h&&n?'<span class="heat">'+Object.entries(stampNames).filter(([k])=>h[k]).map(([k,v])=>v+' '+h[k]).join('　')+'</span>':'')+'</button></li>';}).join('')+'</ol>'+(host?'':'<button class="primary" data-stamp-submit '+(locked?'disabled':'')+'>'+(state.mine?'更新朱批':'送出朱批')+'</button>')+'</div>');
  box.querySelectorAll('[data-sentence]').forEach(b=>b.onclick=()=>{const i=b.dataset.sentence,next=stampOrder[(stampOrder.indexOf(draft[i]||null)+1)%stampOrder.length];if(next)draft[i]=next;else delete draft[i];signature='';classroom();});
  box.querySelector('[data-stamp-submit]')?.addEventListener('click',async e=>{if(!Object.keys(draft).length)return toast('請至少蓋一個朱批');e.target.disabled=true;try{await api('answer',{index:state.index,answer:{stamps:draft}});await poll();toast('朱批已送出');}catch(err){toast(err.message);e.target.disabled=false;}});}
 // 錄音作答（錄好的內容留在記憶體，畫面重繪也不會遺失）
 if(s.type==='audio'&&!host){const key=room.code+':'+state.index,ready=recorded?.key===key?recorded:null,recording=recorder?.state==='recording';
  const box=add('<div class="audio-answer">'+(state.mine?.audio?'<p>你已送出的錄音：</p><audio controls preload="none" src="'+esc(state.mine.audio)+'"></audio>':'')+'<div class="actions"><button data-record '+(locked?'disabled':'')+'>'+(recording?'■ 停止錄音':ready?'● 重新錄音':'● 開始錄音')+'</button><span class="record-time muted" aria-live="polite"></span></div>'+(ready?'<audio class="record-preview" controls src="'+ready.url+'"></audio><button class="primary" data-audio-submit '+(locked?'disabled':'')+'>送出錄音</button>':'')+'</div>');
  box.querySelector('[data-record]').onclick=async()=>{if(recorder?.state==='recording'){stopRecording();return;}if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return toast('這個瀏覽器不支援錄音，請改用 Chrome、Edge 或 Safari');let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}catch{return toast('無法使用麥克風，請在瀏覽器允許麥克風權限');}
   const type=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t))||'';const rec=new MediaRecorder(stream,{...(type?{mimeType:type}:{}),audioBitsPerSecond:32000}),chunks=[];recorder=rec;recordStarted=Date.now();
   rec.ondataavailable=e=>chunks.push(e.data);rec.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());if(recorder===rec)recorder=null;const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});try{if(recorded?.url)URL.revokeObjectURL(recorded.url);recorded={key,data:await blobToData(blob),url:URL.createObjectURL(blob)};}catch(e){toast(e.message);}signature='';classroom();};
   rec.start();recordTimer=setInterval(()=>{const sec=Math.floor((Date.now()-recordStarted)/1000),el=$('.record-time');if(el)el.textContent='錄音中 '+Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')+' ／ 3:00';if(sec>=180)stopRecording();},500);signature='';classroom();};
  box.querySelector('[data-audio-submit]')?.addEventListener('click',async e=>{e.target.disabled=true;try{await api('answer',{index:state.index,answer:{audio:ready.data}});URL.revokeObjectURL(ready.url);recorded=null;signature='';await poll();toast('錄音已送出');}catch(err){toast(err.message);e.target.disabled=false;}});}
 // 影片中途提問
 clearInterval(checkpointWatch);checkpointWatch=null;
 if(s.type==='resource'&&s.checkpoints?.length){if(host){const tally=s.checkpoints.map((c,k)=>c.options.map((_,i)=>state.answers.filter(a=>a.answer?.checkpoints?.[k]===i).length));add('<div class="checkpoints"><h3>影片提問</h3>'+s.checkpoints.map((c,k)=>'<div class="checkpoint-row"><strong>'+Math.floor(c.at/60)+':'+String(c.at%60).padStart(2,'0')+'　'+esc(c.question)+'</strong>'+c.options.map((o,i)=>'<div>'+(i===c.correct?'✓ ':'')+esc(o)+'　'+tally[k][i]+' 人</div>').join('')+'</div>').join('')+'</div>');}
  else{const done=state.mine?.checkpoints||{};add('<p class="muted">影片中有 '+s.checkpoints.length+' 個提問，播到時會自動暫停。已回答 '+Object.keys(done).length+' 題。</p>');
   checkpointWatch=setInterval(()=>{if(checkpointOpen!==null||typeof youtubePlayer==='undefined'||!youtubePlayer?.getCurrentTime||!videoReady)return;const now=youtubePlayer.getCurrentTime(),mine=state.mine?.checkpoints||{},k=s.checkpoints.findIndex((c,i)=>mine[i]===undefined&&!cpDone.has(room.code+':'+state.index+':'+i)&&now>=c.at&&now<c.at+15);if(k<0)return;checkpointOpen=k;youtubePlayer.pauseVideo();const c=s.checkpoints[k],m=$('#modal');
    m.innerHTML='<h2>影片提問</h2><p>'+esc(c.question)+'</p><div class="options">'+c.options.map((o,i)=>'<button class="option" data-cp="'+i+'">'+esc(o)+'</button>').join('')+'</div>';m.showModal();
    m.querySelectorAll('[data-cp]').forEach(b=>b.onclick=async()=>{m.querySelectorAll('[data-cp]').forEach(x=>x.disabled=true);cpDone.add(room.code+':'+state.index+':'+k);try{const r=await api('answer',{index:state.index,checkpoint:k,answer:Number(b.dataset.cp)});toast(r.correct?'答對了！影片繼續播放':'不太對，留意接下來的內容，老師公布時會說明');}catch(e){toast(e.message);}m.close();checkpointOpen=null;await poll();if(state.video){lastVideoCommand='';applyVideo(state.video);}else youtubePlayer.playVideo();});
    m.addEventListener('close',()=>{if(checkpointOpen===k)checkpointOpen=null;},{once:true});},500);}}
 // 教師端：可讀的作答內容、自主進度開關與進度一覽
 if(host){slide.closest('.classgrid')?.querySelectorAll('.responses .response').forEach((el,i)=>{const a=state.answers[i]?.answer;if(!a||typeof a!=='object'||Array.isArray(a))return;const name='<small>'+esc(state.answers[i].name)+'</small>';if(a.audio)el.innerHTML=name+'<audio controls preload="none" src="'+esc(a.audio)+'"></audio>';else if(a.stamps)el.innerHTML=name+Object.entries(a.stamps).map(([k,v])=>'<b class="stamp-inline">'+stampNames[v]+'</b>'+esc(s.sentences?.[k]||'')).join('<br>');else if(a.checkpoints)el.innerHTML=name+Object.entries(a.checkpoints).map(([k,v])=>'第 '+(Number(k)+1)+' 問：'+esc(s.checkpoints?.[k]?.options[v]||'')).join('；');});
  const tools=$('.insight .tool-row');if(tools){tools.insertAdjacentHTML('beforeend','<button data-paced aria-pressed="'+!!state.paced+'">'+(state.paced?'改回老師帶領':'開放自主進度')+'</button>');tools.querySelector('[data-paced]').onclick=async()=>{if(!state.paced&&!confirm('開放後學生可自行翻頁，選擇題、填空題、排列題作答後立即看到解答，答錯的題目隔一段時間會回流再練。確定開放？'))return;try{await api('control',{paced:!state.paced});signature='';await poll();}catch(e){toast(e.message);}};
   if(state.paced)$('.insight').insertAdjacentHTML('beforeend','<details open><summary>自主進度一覽</summary>'+state.roster.map(p=>'<p>'+esc(p.name)+'：第 '+(p.at+1)+' 頁'+(p.wrongs?'（待複習 '+p.wrongs+' 題）':'')+'</p>').join('')+'</details>');}}};
