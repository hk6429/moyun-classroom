import {mkdir,copyFile,cp} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const target=new URL('public/vendor/pdfjs/',root);
await mkdir(target,{recursive:true});
for(const file of ['pdf.mjs','pdf.worker.mjs'])await copyFile(new URL('node_modules/pdfjs-dist/build/'+file,root),new URL(file,target));
for(const dir of ['cmaps','standard_fonts','wasm'])await cp(new URL('node_modules/pdfjs-dist/'+dir,root),new URL(dir,target),{recursive:true});
await copyFile(new URL('node_modules/pdfjs-dist/LICENSE',root),new URL('LICENSE',target));
console.log('PDF.js 前端資產已準備完成');
