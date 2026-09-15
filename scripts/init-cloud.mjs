import {readFile} from 'node:fs/promises';
import {database,initialize} from '../cloud/database.mjs';
const db=database(JSON.parse(await readFile(process.argv[2],'utf8')));
try{await db.execute('SELECT 1');await initialize(db);console.log('Turso 連線與資料表初始化成功');}finally{db.close();}
