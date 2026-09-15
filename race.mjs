export function raceScore(elapsedMs,seconds,correct){
 const cutoff=seconds*900;
 return !correct||elapsedMs<0||elapsedMs>=cutoff?0:Math.max(0,1000-Math.floor(elapsedMs/cutoff*1000));
}

export function racePhase(room,now){
 const round=room.race.rounds[room.index];
 if(room.ended||round?.closedAt!==undefined||round&&now>=round.startedAt+room.deck[room.index].seconds*1000)return 'closed';
 if(!round)return 'waiting';
 return now<round.startedAt?'countdown':'answering';
}

export function raceRankings(room,viewer){
 const rows=[...room.people].map(([id,name])=>{
  const responses=Object.values(room.race.results).map(row=>row[id]).filter(Boolean);
  return {name,me:id===viewer,total:responses.reduce((n,r)=>n+r.points,0),correct:responses.filter(r=>r.correct).length,answered:responses.length};
 }).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'zh-Hant'));
 let rank=0;return rows.map((row,i)=>{if(!i||row.total!==rows[i-1].total)rank=i+1;return {...row,rank};});
}

export function raceState(room,viewer,host,now){
 const phase=racePhase(room,now),round=room.race.rounds[room.index];
 return {phase,serverNow:now,startedAt:round?.startedAt??null,deadline:round?round.startedAt+room.deck[room.index].seconds*1000:null,
  seconds:room.deck[room.index].seconds,maxPoints:1000,zeroAtRatio:.9,
  finished:room.ended||room.index===room.deck.length-1&&phase==='closed',
  mine:host||phase==='closed'?room.race.results[room.index]?.[viewer]??null:null,
  rankings:host||phase==='closed'?raceRankings(room,viewer):null};
}

export function raceControl(room,body,now){
 const phase=racePhase(room,now);
 if([!!body.raceStart,Number.isInteger(body.index),typeof body.reveal==='boolean'].filter(Boolean).length>1)throw Error('請一次執行一項測驗操作');

 if(body.locked===false&&(body.raceStart||Object.keys(room.race.rounds).length))throw Error('測驗開始後暫停新成員加入');
 if(body.raceStart){
  if(body.indexExpected!==room.index||phase!=='waiting')throw Error('本題已開始，不能重設計時');
  room.race.rounds[room.index]={startedAt:now+3000};room.locked=true;
 }
 if(Number.isInteger(body.index)){
  if(phase!=='closed'||body.index!==room.index+1||body.index>=room.deck.length)throw Error('請先結束本題，再依序進入下一題');
 }
 if(typeof body.reveal==='boolean'){
  if(!body.reveal)throw Error('競速測驗每題只能作答一次，不能重新開放');
  if(phase==='waiting'||phase==='countdown')throw Error('請先開始本題');
  room.race.rounds[room.index].closedAt=now;
 }

}

export function recordRaceAnswer(room,token,answer,now){
 if(racePhase(room,now)!=='answering')throw Error('尚未開始或作答時間已截止');
 if(room.race.results[room.index]?.[token])throw Error('本題已送出，不能修改或重複計分');
 const slide=room.deck[room.index],elapsedMs=now-room.race.rounds[room.index].startedAt,correct=answer===slide.correct;
 room.race.results[room.index]??={};room.race.results[room.index][token]={elapsedMs,correct,points:raceScore(elapsedMs,slide.seconds,correct)};
}
