import {createClient} from '@libsql/client/web';
export function database(env){return createClient({url:env.TURSO_URL,authToken:env.TURSO_TOKEN});}
export async function initialize(db){
 await db.batch([
 "CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL)",
 "INSERT OR IGNORE INTO app_state VALUES (1,0,'{\"rooms\":[],\"sessions\":[],\"owners\":{}}')",
 "CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, name TEXT, mime TEXT, bytes INTEGER, strokes TEXT, trashed INTEGER NOT NULL DEFAULT 0)",
 "CREATE TABLE IF NOT EXISTS asset_chunks (id TEXT, part INTEGER, data BLOB, PRIMARY KEY(id,part))",
 "CREATE TABLE IF NOT EXISTS presence (token TEXT PRIMARY KEY, seen INTEGER)",
 "CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, n INTEGER, until_ms INTEGER)"
 ],'write');
}
export async function load(db){const r=(await db.execute('SELECT revision,data FROM app_state WHERE id=1')).rows[0];if(!r)throw Error('資料庫尚未初始化');return {revision:Number(r.revision),data:JSON.parse(r.data)};}
export async function save(db,revision,data,changes=[]){const update={sql:'UPDATE app_state SET data=?, revision=revision+1 WHERE id=1 AND revision=?',args:[JSON.stringify(data),revision]};if(!changes.length)return (await db.execute(update)).rowsAffected===1;const r=await db.batch([...changes.map(c=>({sql:c.sql+' AND EXISTS(SELECT 1 FROM app_state WHERE id=1 AND revision=?)',args:[...c.args,revision]})),update],'write');return r.at(-1).rowsAffected===1;}
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
