"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type FormEvent} from "react";
import {ChevronLeft,ChevronRight,Download,Highlighter,LoaderCircle,Minus,Plus,Search,X,FileWarning} from "lucide-react";
import type {PDFDocumentProxy,PDFDocumentLoadingTask,PDFPageProxy,RenderTask,TextLayer} from "pdfjs-dist";
import {cachedPdf,rememberPdf} from "../lib/pdf-source-cache";
import "./pdf-reader.css";
type Rect={x:number;y:number;w:number;h:number};
type SelectionData={quote:string;page:number;rects:Rect[]};
type Note={id:string;page:number;color:string;rects?:Rect[]};
type Props={url:string;initialPage?:number;notes:Note[];onPageChange:(page:number,total:number)=>void;onSelect:(data:SelectionData)=>void;jumpPage?:number};
type Loaded={document:PDFDocumentProxy;module:typeof import("pdfjs-dist")};
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
const normalize=(value:string)=>value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g,"");
const colors:Record<string,string>={yellow:"#f4d76c",green:"#9dceb0",blue:"#96c5ee",pink:"#edabc1",purple:"#c4ace4"};
function errorText(error:unknown){const name=(error as Error)?.name;if(name==="PasswordException")return "PDF 已加密，请先解除密码保护。";if(name==="InvalidPDFException")return "PDF 无法解析，请检查原文件是否完整。";return "暂时无法加载，请检查连接后重试，或下载原文件。";}
export default function PdfReader(props:Props){return <Reader key={props.url} {...props}/>;}

function Reader({url,initialPage=1,notes,onPageChange,onSelect,jumpPage}:Props){
 const [loaded,setLoaded]=useState<Loaded|null>(null),[page,setPage]=useState(initialPage),[pageInput,setPageInput]=useState(String(initialPage));
 const [zoom,setZoom]=useState(1),[width,setWidth]=useState(700),[estimate,setEstimate]=useState({width:612,height:792});
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[retry,setRetry]=useState(0),[progress,setProgress]=useState("");
 const [query,setQuery]=useState(""),[searching,setSearching]=useState(false),[matches,setMatches]=useState<number[]>([]),[matchIndex,setMatchIndex]=useState(0),[searchMessage,setSearchMessage]=useState("");
 const scrollRef=useRef<HTMLDivElement>(null),pageNodes=useRef(new Map<number,HTMLDivElement>()),texts=useRef(new Map<number,string>()),searchRun=useRef(0),frame=useRef(0),pageRef=useRef(page),inputFocused=useRef(false);
 const programmedScroll=useRef<{top:number;page:number}|null>(null);
 const callbacks=useRef({onPageChange,onSelect});callbacks.current={onPageChange,onSelect};pageRef.current=page;
 const total=loaded?.document.numPages||0;
 const goToPage=useCallback((next:number)=>{
  if(!total)return;const target=clamp(Math.floor(next)||1,1,total);setPage(target);setPageInput(String(target));
  const node=pageNodes.current.get(target),scroll=scrollRef.current;if(node&&scroll){scroll.scrollTo({top:Math.max(0,node.offsetTop-16),behavior:"instant" as ScrollBehavior});programmedScroll.current={top:scroll.scrollTop,page:target};}
 },[total]);
 useEffect(()=>{
  let cancelled=false;let task:PDFDocumentLoadingTask|undefined;setLoading(true);setError("");setLoaded(null);setProgress("");texts.current.clear();
  async function load(){try{
   const module=await import("pdfjs-dist");if(cancelled)return;module.GlobalWorkerOptions.workerSrc="/pdf.worker.min.mjs";
   const cached=cachedPdf(url),data=cached?new Uint8Array(await cached.arrayBuffer()):undefined;if(cancelled)return;
   task=module.getDocument({...data?{data}:{url,disableAutoFetch:true,disableStream:true,rangeChunkSize:1024*1024},cMapUrl:"/cmaps/",cMapPacked:true,standardFontDataUrl:"/standard_fonts/",wasmUrl:"/wasm/"});
   task.onProgress=({loaded,total}:{loaded:number;total:number})=>{if(!cancelled)setProgress(total?Math.min(100,Math.round(loaded/total*100))+"% · 正在读取所需页面":(loaded/1024/1024).toFixed(1)+" MB");};
   const document=await task.promise;if(cancelled)return;
   const first=await document.getPage(1);if(cancelled)return;const viewport=first.getViewport({scale:1});setEstimate({width:viewport.width,height:viewport.height});
   const target=clamp(initialPage||1,1,document.numPages);setPage(target);setPageInput(String(target));setLoaded({document,module});
   // This resolves only once all bytes have arrived; it never starts a full download.
   if(!cached)void document.getDownloadInfo().then(async()=>{if(!cancelled){const data=await document.getData();if(!cancelled)rememberPdf(url,new Blob([new Uint8Array(data)],{type:"application/pdf"}));}}).catch(()=>undefined);
  }catch(e){if(!cancelled)setError(errorText(e));}finally{if(!cancelled)setLoading(false);}}
  void load();return()=>{cancelled=true;searchRun.current++;if(task)void task.destroy().catch(()=>undefined);};
  // A stable file version keeps metadata/progress changes from reopening the PDF.
 },[url,retry]);
 useEffect(()=>{const node=scrollRef.current;if(!node)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.round(entry.contentRect.width)));observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(total){const id=requestAnimationFrame(()=>goToPage(jumpPage??pageRef.current));return()=>cancelAnimationFrame(id);}},[total,goToPage]);
 useEffect(()=>{if(jumpPage!=null&&total)goToPage(jumpPage);},[jumpPage,total,goToPage]);
 useEffect(()=>{if(total)callbacks.current.onPageChange(page,total);if(!inputFocused.current)setPageInput(String(page));},[page,total]);
 useLayoutEffect(()=>{if(total){cancelAnimationFrame(frame.current);goToPage(pageRef.current);}},[zoom,width]);
 useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
 function onScroll(){cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>{
  const scroll=scrollRef.current;if(!scroll||!total||Math.abs(scroll.clientWidth-width)>2)return;
  const programmed=programmedScroll.current;programmedScroll.current=null;
  if(programmed&&Math.abs(scroll.scrollTop-programmed.top)<2){setPage(programmed.page);return;}
  if(scroll.scrollTop>0&&scroll.scrollTop+scroll.clientHeight>=scroll.scrollHeight-2){setPage(total);return;}
  const position=scroll.scrollTop+Math.min(180,scroll.clientHeight*.25);
  let low=1,high=total;while(low<high){const mid=Math.ceil((low+high)/2),node=pageNodes.current.get(mid);if(node&&node.offsetTop<=position)low=mid;else high=mid-1;}
  setPage(low);
 });}
 async function searchDocument(event:FormEvent){event.preventDefault();if(!loaded)return;const term=normalize(query.trim()),run=++searchRun.current;setMatches([]);setMatchIndex(0);if(!term){setSearching(false);setSearchMessage("");return;}setSearching(true);
  try{const found:number[]=[];let anyText=false;for(let number=1;number<=total;number++){if(run!==searchRun.current)return;setSearchMessage("搜索第 "+number+" / "+total+" 页…");
   let text=texts.current.get(number);if(text===undefined){const p=await loaded.document.getPage(number),content=await p.getTextContent();if(run!==searchRun.current)return;text=content.items.map(item=>"str" in item?item.str:"").join(" ");texts.current.set(number,text);}
   const normalized=normalize(text);if(normalized)anyText=true;if(normalized.includes(term)){found.push(number);setMatches([...found]);if(found.length===1)goToPage(number);}
  }if(run===searchRun.current)setSearchMessage(found.length?"共 "+found.length+" 页包含“"+query.trim()+"”":anyText?"没有找到匹配文字。":"扫描件没有文字层，可手动添加页码笔记。");
  }catch{if(run===searchRun.current)setSearchMessage("搜索未完成，请重试。");}finally{if(run===searchRun.current)setSearching(false);}
 }
 function stepMatch(direction:number){if(!matches.length)return;const next=(matchIndex+direction+matches.length)%matches.length;setMatchIndex(next);goToPage(matches[next]);}
 function clearSearch(){searchRun.current++;setQuery("");setMatches([]);setSearchMessage("");setSearching(false);}
 return <section className="pdf-reader" aria-label="论文阅读器">
  <div className="pdf-reader-toolbar"><div className="pdf-reader-page-controls">
   <button title="上一页" aria-label="上一页" disabled={!total||page===1} onClick={()=>goToPage(page-1)}><ChevronLeft size={17}/></button>
   <form className="pdf-reader-page-form" onSubmit={e=>{e.preventDefault();inputFocused.current=false;goToPage(Number(pageInput));}}>
    <input aria-label="跳转到页码" inputMode="numeric" value={pageInput} disabled={!total} onFocus={()=>inputFocused.current=true} onBlur={()=>inputFocused.current=false} onChange={e=>setPageInput(e.target.value)}/><span>/ {total||"—"}</span><button className="pdf-reader-jump" type="submit" disabled={!total}>跳转</button>
   </form>
   <button title="下一页" aria-label="下一页" disabled={!total||page===total} onClick={()=>goToPage(page+1)}><ChevronRight size={17}/></button>
  </div><span className="pdf-continuous-label">连续阅读</span><div className="pdf-reader-zoom-controls">
   <button title="缩小" aria-label="缩小 PDF" disabled={!total||zoom<=.5} onClick={()=>setZoom(v=>Math.max(.5,v-.15))}><Minus size={15}/></button>
   <button className="pdf-reader-fit" title="恢复适合宽度" disabled={!total} onClick={()=>setZoom(1)}>{zoom===1?"适宽":Math.round(zoom*100)+"%"}</button>
   <button title="放大" aria-label="放大 PDF" disabled={!total||zoom>=2.5} onClick={()=>setZoom(v=>Math.min(2.5,v+.15))}><Plus size={15}/></button>
  </div><a href={url+"&download=1"} target="_blank" rel="noreferrer" className="pdf-reader-download" title="下载原文件" aria-label="下载 PDF 原文件"><Download size={17}/></a></div>
  <form className="pdf-reader-search" onSubmit={searchDocument}><Search size={15}/><input aria-label="搜索 PDF 全文" placeholder="搜索 PDF 全文…" value={query} onChange={e=>setQuery(e.target.value)} disabled={!total}/>{query&&<button type="button" onClick={clearSearch} aria-label="清除 PDF 搜索"><X size={14}/></button>}<button className="pdf-reader-search-submit" type="submit" disabled={!total||!query.trim()||searching}>{searching?<LoaderCircle className="pdf-reader-spinner" size={14}/>:"查找"}</button></form>
  {searchMessage&&<div className="pdf-reader-search-status" role="status"><span>{searchMessage}</span>{matches.length>0&&<div><button aria-label="上一个匹配页面" onClick={()=>stepMatch(-1)}><ChevronLeft size={15}/></button><span>{matchIndex+1}/{matches.length}</span><button aria-label="下一个匹配页面" onClick={()=>stepMatch(1)}><ChevronRight size={15}/></button></div>}</div>}
  <div className="pdf-reader-scroll" ref={scrollRef} onScroll={onScroll}>
   {loading&&<div className="pdf-reader-state" role="status"><LoaderCircle size={25} className="pdf-reader-spinner"/><strong>正在打开论文</strong><span>{progress||"按需加载页面，随后即可滚动阅读"}</span></div>}
   {error&&<div className="pdf-reader-state" role="alert"><FileWarning size={30}/><strong>暂时无法打开</strong><span>{error}</span><button onClick={()=>setRetry(n=>n+1)}>重新加载</button><a href={url+"&download=1"}>下载原文件</a></div>}
   {loaded&&!error&&<div className="pdf-reader-document" style={{padding:width<500?12:24}}><p className="pdf-reader-hint">滚轮连续阅读 · 输入页码可跳转 · 选中文字可摘录</p>{Array.from({length:total},(_,i)=>i+1).map(number=><PdfPage key={number} loaded={loaded} number={number} active={Math.abs(number-page)<=2} width={width} zoom={zoom} estimate={estimate} notes={notes.filter(n=>n.page===number)} register={node=>{if(node)pageNodes.current.set(number,node);else pageNodes.current.delete(number);}} onSelect={selection=>callbacks.current.onSelect(selection)} onText={text=>texts.current.set(number,text)}/>)}</div>}
  </div>
 </section>;
}

function PdfPage({loaded,number,active,width,zoom,estimate,notes,register,onSelect,onText}:{loaded:Loaded;number:number;active:boolean;width:number;zoom:number;estimate:{width:number;height:number};notes:Note[];register:(node:HTMLDivElement|null)=>void;onSelect:(selection:SelectionData)=>void;onText:(text:string)=>void}){
 const surface=useRef<HTMLDivElement>(null),canvasHost=useRef<HTMLDivElement>(null),textHost=useRef<HTMLDivElement>(null);
 const [intrinsic,setIntrinsic]=useState(estimate),[rendering,setRendering]=useState(true),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 const [selected,setSelected]=useState<(SelectionData&{left:number;top:number})|null>(null);
 const callbacks=useRef({onText,onSelect});callbacks.current={onText,onSelect};
 const available=Math.max(160,width-(width<500?24:48)),scale=Math.min(available/intrinsic.width,1.6)*zoom,dimensions={width:intrinsic.width*scale,height:intrinsic.height*scale};
 useEffect(()=>{
  if(!active||!canvasHost.current||!textHost.current)return;
  let cancelled=false,renderTask:RenderTask|undefined,layer:TextLayer|undefined,renderedPage:PDFPageProxy|undefined;
  const host=canvasHost.current,text=textHost.current,canvas=document.createElement("canvas");canvas.setAttribute("aria-label","PDF 第 "+number+" 页");host.replaceChildren(canvas);text.replaceChildren();setRendering(true);setError("");setSelected(null);
  async function render(){try{
   const pdfPage=await loaded.document.getPage(number);if(cancelled)return;renderedPage=pdfPage;const original=pdfPage.getViewport({scale:1});setIntrinsic({width:original.width,height:original.height});
   const fit=Math.min(available/original.width,1.6)*zoom,viewport=pdfPage.getViewport({scale:fit}),ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(3000000/(viewport.width*viewport.height)));
   canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+"px";canvas.style.height=viewport.height+"px";
   text.style.setProperty("--total-scale-factor",String(fit*pdfPage.userUnit));text.style.setProperty("--scale-factor",String(fit));
   const context=canvas.getContext("2d");if(!context)throw Error("Canvas unavailable");
   renderTask=pdfPage.render({canvas,canvasContext:context,viewport,transform:[ratio,0,0,ratio,0,0]});void renderTask.promise.catch(()=>undefined);
   const content=await pdfPage.getTextContent();if(cancelled)return;callbacks.current.onText(content.items.map(item=>"str" in item?item.str:"").join(" "));
   layer=new loaded.module.TextLayer({textContentSource:content,container:text,viewport});await Promise.all([renderTask.promise,layer.render()]);
  }catch(e){if(!cancelled)setError(errorText(e));}finally{if(!cancelled)setRendering(false);}}
  void render();return()=>{cancelled=true;renderTask?.cancel();layer?.cancel();canvas.width=0;canvas.height=0;void (renderTask?.promise||Promise.resolve()).catch(()=>undefined).then(()=>renderedPage?.cleanup()).catch(()=>undefined);};
 },[loaded,number,active,available,zoom,retry]);
 useEffect(()=>{
  if(!active)return;let timer:ReturnType<typeof setTimeout>;
  function capture(){const selection=window.getSelection(),paper=surface.current,host=textHost.current;
   if(!selection||selection.isCollapsed||!selection.rangeCount||!paper||!host){setSelected(null);return;}
   const range=selection.getRangeAt(0);if(!host.contains(range.startContainer)||!host.contains(range.endContainer)){setSelected(null);return;}
   const quote=selection.toString().trim(),bounds=paper.getBoundingClientRect();if(!quote||!bounds.width||!bounds.height){setSelected(null);return;}
   const boxes=Array.from(range.getClientRects()).filter(r=>r.width>1&&r.height>1);
   const rects=boxes.map(r=>{const x=clamp((r.left-bounds.left)/bounds.width,0,1),y=clamp((r.top-bounds.top)/bounds.height,0,1);return{x,y,w:clamp(r.width/bounds.width,0,1-x),h:clamp(r.height/bounds.height,0,1-y)};}).filter(r=>r.w>0&&r.h>0);
   if(!rects.length){setSelected(null);return;}const last=boxes[boxes.length-1];setSelected({quote,page:number,rects,left:clamp(last.left-bounds.left,8,Math.max(8,bounds.width-155)),top:Math.min(bounds.height-40,last.bottom-bounds.top+8)});
  }
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(capture,140);};document.addEventListener("selectionchange",schedule);return()=>{clearTimeout(timer);document.removeEventListener("selectionchange",schedule);};
 },[active,number]);
 return <div ref={node=>{surface.current=node;register(node);}} data-pdf-page={number} className="pdf-reader-paper" style={dimensions}>
  <span className="pdf-page-number">第 {number} 页</span>
  {active&&<><div ref={canvasHost} className="pdf-reader-canvas"/><div className="pdf-reader-highlights" aria-hidden="true">{notes.flatMap(note=>(note.rects||[]).map((rect,i)=><span key={note.id+"-"+i} style={{left:rect.x*100+"%",top:rect.y*100+"%",width:rect.w*100+"%",height:rect.h*100+"%",backgroundColor:colors[note.color]||note.color} as CSSProperties}/>))}</div><div ref={textHost} className="pdf-reader-text-layer"/>
   {selected&&!rendering&&<button className="pdf-reader-selection" style={{left:selected.left,top:selected.top}} onPointerDown={e=>e.preventDefault()} onClick={()=>{callbacks.current.onSelect({quote:selected.quote,page:selected.page,rects:selected.rects});window.getSelection()?.removeAllRanges();setSelected(null);}}><Highlighter size={15}/>摘录并记录</button>}
   {rendering&&<div className="pdf-reader-page-loading" role="status"><LoaderCircle size={18} className="pdf-reader-spinner"/>正在加载第 {number} 页</div>}
   {error&&<div className="pdf-reader-page-loading" role="alert"><span>{error}</span><button onClick={()=>setRetry(n=>n+1)}>重试这一页</button></div>}
  </>}
 </div>;
}
