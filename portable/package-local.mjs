import {cp,mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'release/portable');
if(process.platform!=='win32'||process.arch!=='x64'||Number(process.versions.node.split('.')[0])<24)throw new Error('Package on Windows x64 with Node 24 or newer.');
await import('./build-local.mjs');
await mkdir(path.join(out,'runtime'),{recursive:true});await copyFile(process.execPath,path.join(out,'runtime/node.exe'));
const licenses=path.join(out,'licenses');await mkdir(licenses,{recursive:true});
const require=createRequire(import.meta.url);
for(const name of ['react','react-dom','scheduler','lucide-react','pdfjs-dist','zod']){
 const location=path.dirname(require.resolve(`${name}/package.json`,{paths:[root,path.dirname(require.resolve('react-dom/package.json'))]}));
 for(const file of await readdir(location))if(/^(LICENSE|COPYING|NOTICE)/i.test(file))await cp(path.join(location,file),path.join(licenses,`${name}-${file}`),{recursive:true});
}
const nodeLicense=await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`);if(!nodeLicense.ok)throw new Error('Cannot download Node license');
await writeFile(path.join(licenses,'Node-LICENSE.txt'),await nodeLicense.text());
await writeFile(path.join(licenses,'NOTICE.txt'),`Paperleaf includes Node.js ${process.versions.node} (https://nodejs.org), React, React DOM, Scheduler, Lucide, PDF.js and Zod. Their licenses are included here. PDF.js font and CMap licenses are also in web/standard_fonts and web/cmaps.\nNode source: https://github.com/nodejs/node/tree/v${process.versions.node}\nPaperleaf source: https://github.com/jhChen2002/paperleaf\n`);
await copyFile(path.join(root,'LICENSE'),path.join(out,'LICENSE'));
// A release may never include the developer's working library.
if((await readdir(out)).includes('data'))throw new Error('Refusing to package a directory containing data. Build in a clean release directory.');
const zip=path.resolve(process.argv[2]||path.join(root,`release/Paperleaf-${JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version}-Windows-x64.zip`));
await mkdir(path.dirname(zip),{recursive:true});
const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; if(Test-Path -LiteralPath $env:PAPERLEAF_PACKAGE_ZIP){Remove-Item -LiteralPath $env:PAPERLEAF_PACKAGE_ZIP}; [IO.Compression.ZipFile]::CreateFromDirectory($env:PAPERLEAF_PACKAGE_DIR,$env:PAPERLEAF_PACKAGE_ZIP,[IO.Compression.CompressionLevel]::Optimal,$true)";
const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',script],{stdio:'inherit',env:{...process.env,PAPERLEAF_PACKAGE_DIR:out,PAPERLEAF_PACKAGE_ZIP:zip}});if(result.status!==0)throw new Error('ZIP packaging failed');
console.log(`Windows ZIP ready: ${zip}`);
