import {createClient} from '@libsql/client/web';
export function database(env){return createClient({url:env.TURSO_URL,authToken:env.TURSO_TOKEN});}
export async function initialize(db){
 await db.batch([
 "CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL)",
 "INSERT OR IGNORE INTO app_state VALUES (1,0,'{\"rooms\":[],\"sessions\":[],\"owners\":{}}')",
 "CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, name TEXT, mime TEXT, bytes INTEGER, strokes TEXT, trashed INTEGER NOT NULL DEFAULT 0)",
 "CREATE TABLE IF NOT EXISTS asset_chunks (id TEXT, part INTEGER, data BLOB, PRIMARY KEY(id,part))",
 "CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, n INTEGER, until_ms INTEGER)",
 // 每間課堂一列、每個登入一列：請求只讀寫自己那間，不再整包讀寫全站
 "CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated INTEGER NOT NULL DEFAULT 0)",
 "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)",
 "CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires)",
 "CREATE TABLE IF NOT EXISTS asset_owners (id TEXT PRIMARY KEY, owner TEXT)",
 "CREATE TABLE IF NOT EXISTS room_presence (token TEXT PRIMARY KEY, code TEXT NOT NULL, seen INTEGER NOT NULL)",
 "CREATE INDEX IF NOT EXISTS room_presence_code ON room_presence(code, seen)",
 // 多教師：Google 帳號名單、雲端教材（可分享為校內範本）、課後學習紀錄（只存班級座號，不存姓名）
 "CREATE TABLE IF NOT EXISTS teachers (email TEXT PRIMARY KEY, added INTEGER NOT NULL)",
 "CREATE TABLE IF NOT EXISTS decks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, owner_name TEXT, data TEXT NOT NULL, shared INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL)",
 "CREATE INDEX IF NOT EXISTS decks_owner ON decks(owner)",
 "CREATE TABLE IF NOT EXISTS lessons (code TEXT PRIMARY KEY, owner TEXT, title TEXT, ended INTEGER NOT NULL, slides TEXT NOT NULL)",
 "CREATE INDEX IF NOT EXISTS lessons_owner ON lessons(owner, ended)",
 "CREATE TABLE IF NOT EXISTS records (code TEXT NOT NULL, class TEXT NOT NULL, seat INTEGER NOT NULL, results TEXT NOT NULL, PRIMARY KEY(code,class,seat))",
 // 舊版整包資料搬入新表；可重複執行，已搬過的不覆寫
 "INSERT OR IGNORE INTO rooms(code,data,updated) SELECT json_extract(r.value,'$[0]'),json_extract(r.value,'$[1]'),coalesce(json_extract(r.value,'$[1].updated'),0) FROM app_state a, json_each(a.data,'$.rooms') r WHERE a.id=1",
 "INSERT OR IGNORE INTO sessions(id,data,expires) SELECT json_extract(s.value,'$[0]'),json_extract(s.value,'$[1]'),json_extract(s.value,'$[1].expires') FROM app_state a, json_each(a.data,'$.sessions') s WHERE a.id=1 AND json_extract(s.value,'$[1].expires')>CAST(strftime('%s','now') AS INTEGER)*1000",
 "INSERT OR IGNORE INTO asset_owners(id,owner) SELECT o.key,o.value FROM app_state a, json_each(a.data,'$.owners') o WHERE a.id=1"
 ],'write');
}
export async function loadRooms(db,codes){if(!codes.length)return [];return (await db.execute({sql:'SELECT code,revision,data FROM rooms WHERE code IN ('+codes.map(()=>'?').join(',')+')',args:codes})).rows.map(r=>({code:String(r.code),revision:Number(r.revision),data:String(r.data)}));}
export async function roomRevision(db,code){const r=(await db.execute({sql:'SELECT revision FROM rooms WHERE code=?',args:[code]})).rows[0];return r?Number(r.revision):null;}
export async function loadSession(db,id){if(!id)return null;const r=(await db.execute({sql:'SELECT data FROM sessions WHERE id=? AND expires>?',args:[id,Date.now()]})).rows[0];return r?JSON.parse(r.data):null;}
// 同一交易：先寫的語句以「課堂版本未變」為前提，最後才更新課堂；版本不符則整批不生效，由呼叫端重試
export async function commit(db,{updates=[],inserts=[],sessions=[],removed=[],owners=[],changes=[]}){
 const guard=updates.length?updates.map(()=>'(SELECT revision FROM rooms WHERE code=?)=?').join(' AND '):'1',guardArgs=updates.flatMap(u=>[u.code,u.revision]);
 const statements=[
 ...changes.map(c=>({sql:c.sql+' AND '+guard,args:[...c.args,...guardArgs]})),
 ...sessions.map(([id,s])=>({sql:'INSERT INTO sessions(id,data,expires) SELECT ?,?,? WHERE '+guard+' ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires',args:[id,JSON.stringify(s),s.expires,...guardArgs]})),
 ...removed.map(id=>({sql:'DELETE FROM sessions WHERE id=? AND '+guard,args:[id,...guardArgs]})),
 ...owners.map(([id,o])=>({sql:'INSERT OR IGNORE INTO asset_owners(id,owner) SELECT ?,? WHERE '+guard,args:[id,o,...guardArgs]})),
 ...inserts.map(r=>({sql:'INSERT INTO rooms(code,revision,data,updated) VALUES(?,0,?,?)',args:[r.code,r.data,Date.now()]})),
 ...updates.map(u=>({sql:'UPDATE rooms SET data=?,updated=?,revision=revision+1 WHERE code=? AND revision=?',args:[u.data,Date.now(),u.code,u.revision]}))
 ];
 if(!statements.length)return true;
 let r;try{r=await db.batch(statements,'write');}catch(e){if(/UNIQUE|constraint/i.test(String(e?.message)))return false;throw e;}
 return r.slice(r.length-updates.length).every(x=>x.rowsAffected===1);
}
export async function touchPresence(db,token,code){await db.execute({sql:'INSERT INTO room_presence(token,code,seen) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET code=excluded.code,seen=excluded.seen',args:[token,code,Date.now()]});}
export async function onlineIn(db,code,since){return (await db.execute({sql:'SELECT token,seen FROM room_presence WHERE code=? AND seen>?',args:[code,since]})).rows;}
export async function sweep(db){const now=Date.now();await db.batch([{sql:'DELETE FROM sessions WHERE expires<?',args:[now]},{sql:'DELETE FROM room_presence WHERE seen<?',args:[now-86400000]},{sql:'DELETE FROM request_limits WHERE until_ms<?',args:[now]}],'write');}
export async function rate(db,key,max){const now=Date.now();const r=await db.execute({sql:'INSERT INTO request_limits(key,n,until_ms) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET n=CASE WHEN until_ms<? THEN 1 ELSE n+1 END,until_ms=CASE WHEN until_ms<? THEN excluded.until_ms ELSE until_ms END RETURNING n',args:[key,now+60000,now,now]});return Number(r.rows[0].n)<=max;}
export async function putAsset(db,id,name,mime,bytes,strokes=null){
 const statements=[{sql:'INSERT INTO assets(id,name,mime,bytes,strokes) VALUES(?,?,?,?,?)',args:[id,name,mime,bytes.length,strokes?JSON.stringify(strokes):null]}];
 for(let i=0;i<bytes.length;i+=128*1024)statements.push({sql:'INSERT INTO asset_chunks(id,part,data) VALUES(?,?,?)',args:[id,i/(128*1024),bytes.slice(i,i+128*1024)]});
 await db.batch(statements,'write');
}
export async function getAsset(db,id){const row=(await db.execute({sql:'SELECT * FROM assets WHERE id=? AND trashed=0',args:[id]})).rows[0];if(!row)return null;
 const chunks=(await db.execute({sql:'SELECT data FROM asset_chunks WHERE id=? ORDER BY part',args:[id]})).rows;
 const bytes=new Uint8Array(Number(row.bytes));let offset=0;for(const c of chunks){const b=new Uint8Array(c.data);bytes.set(b,offset);offset+=b.length;}return {...row,data:bytes};
}
