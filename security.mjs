import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import path from 'node:path';
export function persistence(dir){
 mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,'classrooms.json');
 let data={rooms:[],sessions:[],owners:{}};
 if(existsSync(file))data=JSON.parse(readFileSync(file,'utf8'));
 return {data,save(next){const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(next),{mode:0o600});renameSync(tmp,file);}};
}
export function access(dir,store){
 const credential=path.join(dir,'teacher-password');
 if(!process.env.TEACHER_PASSWORD&&!existsSync(credential))writeFileSync(credential,randomBytes(24).toString('base64url'),{mode:0o600});
 const password=process.env.TEACHER_PASSWORD||readFileSync(credential,'utf8').trim();
 const salt='moyun-teacher-v1',hash=scryptSync(password,salt,64),sessions=new Map(store.data.sessions||[]),limits=new Map();
 function session(req){const id=/moyun_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];const s=sessions.get(id);return s&&s.expires>Date.now()?s:null;}
 function setSession(req,res,teacher=false,member=null){let id=/moyun_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1],s=session(req);if(!s||teacher){id=randomBytes(24).toString('hex');s={teacher:false,members:[],expires:Date.now()+12*3600000};sessions.set(id,s);}s.teacher ||= teacher;if(member&&!s.members.includes(member))s.members.push(member);res.setHeader('Set-Cookie','moyun_session='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+(process.env.PUBLIC_ORIGIN?.startsWith('https:')?'; Secure':''));return s;}
 return {sessions,session,setSession,passwordFile:credential,
 login(req,res,value){if(typeof value!=='string'||value.length>256||!timingSafeEqual(hash,scryptSync(value,salt,64)))return false;setSession(req,res,true);return true;},
 logout(req,res){const id=/moyun_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];sessions.delete(id);res.setHeader('Set-Cookie','moyun_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');},
 rate(req,key,max,ms=60000){const k=(req.socket.remoteAddress||'')+':'+key,now=Date.now();let r=limits.get(k);if(!r||r.until<now)limits.set(k,r={n:0,until:now+ms});if(limits.size>10000)for(const [id,v]of limits)if(v.until<now)limits.delete(id);return ++r.n<=max;}
 };
}
