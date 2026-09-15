import {fileURLToPath} from 'node:url';
export async function checkBackend(origin){
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('正式後端必須使用不含路徑與憑證的 HTTPS 網址');
 const response=await fetch(new URL('/api/health',url),{signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw Error('後端健康檢查失敗：HTTP '+response.status);
 const health=await response.json();
 if(health.ok!==true||health.persistent!==true)throw Error('後端尚未確認持久儲存');
 if(!['isolated','browser-pdf'].includes(health.converter?.mode)||health.converter?.ready!==true)throw Error('教材匯入模式尚未就緒');
 if(health.publicOrigin!==url.origin)throw Error('後端正式網址設定不符');
 return {backend:url.origin,persistent:true,isolatedConverter:true};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await checkBackend(process.argv[2]),null,2));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
