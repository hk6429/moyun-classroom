import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
const ext=process.argv[2];if(!['pdf','ppt','pptx'].includes(ext))throw Error('unsupported');
if(ext!=='pdf'){mkdirSync('/tmp/profile',{recursive:true});writeFileSync('/tmp/profile/registrymodifications.xcu','<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');execFileSync('soffice',['-env:UserInstallation=file:///tmp/profile','--headless','--convert-to','pdf','--outdir','/work','/work/source.'+ext],{timeout:180000});}
const info=execFileSync('pdfinfo',['/work/source.pdf'],{encoding:'utf8',timeout:30000});const count=Number(info.match(/Pages:\s+(\d+)/)?.[1]);if(!count)throw Error('invalid PDF');
for(let i=1;i<=count;i++){execFileSync('pdftoppm',['-f',String(i),'-l',String(i),'-singlefile','-scale-to','2400','-png','/work/source.pdf','/work/page-'+String(i).padStart(6,'0')],{timeout:90000});}
