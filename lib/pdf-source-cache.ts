import type {Paper} from './types';
const sources=new Map<string,Blob>();
const MAX_BYTES=80*1024*1024;
export const paperFileUrl=(paper:Paper)=>`/api/papers/${paper.id}/file?v=${encodeURIComponent(paper.fileVersion||String(paper.fileSize))}`;
export function rememberPdf(url:string,file:Blob){sources.delete(url);sources.set(url,file);let bytes=Array.from(sources.values()).reduce((n,f)=>n+f.size,0);for(const [key,value] of sources){if(bytes<=MAX_BYTES)break;sources.delete(key);bytes-=value.size;}}
export function cachedPdf(url:string){const file=sources.get(url);if(file){sources.delete(url);sources.set(url,file);}return file;}
