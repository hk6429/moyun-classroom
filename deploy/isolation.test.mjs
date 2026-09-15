import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('轉檔容器無網路、非 root、唯讀根目錄',()=>{
 const code="const fs=require('node:fs'); const os=require('node:os'); if(process.getuid()===0)throw Error('root'); let denied=false; try{fs.writeFileSync('/probe','x')}catch(e){denied=['EROFS','EACCES'].includes(e.code)}; if(!denied)throw Error('writable root'); if(Object.values(os.networkInterfaces()).flat().some(i=>!i.internal))throw Error('external network'); fs.writeFileSync('/tmp/probe','ok'); console.log('isolated')";
 const output=execFileSync('docker',['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','768m','--cpus','1','--pids-limit','128','--tmpfs','/tmp:rw,nosuid,size=256m','--user','1000:1000','--entrypoint','node','moyun-converter:1','-e',code],{encoding:'utf8',timeout:30000});
 assert.equal(output.trim(),'isolated');
});
