import {storageList,trashAsset} from './storage.mjs';
import {persistence,access} from './security.mjs';
import path from 'node:path';
import {upload,getJob,serveAsset,validAsset,saveDrawing,dataRoot,cancelJob,converterHealth} from './uploads.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomInt} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('./public/',import.meta.url));
import {createEngine} from './engine.mjs';
export function createApp(options={}){return createEngine(options,{storageList,trashAsset,persistence,access,path,upload,getJob,serveAsset,validAsset,saveDrawing,dataRoot,cancelJob,converterHealth,http,readFile,randomBytes,randomInt,root,env:process.env});}

if(process.argv[1]===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT)||4178;createApp().listen(port,process.env.HOST||'127.0.0.1',()=>console.log('墨韻課堂 http://localhost:'+port));}
