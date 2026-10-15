"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Download, Highlighter, LoaderCircle, Minus, Plus, Search, X, FileWarning } from "lucide-react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask, TextLayer } from "pdfjs-dist";
import "./pdf-reader.css";

type Rect = { x: number; y: number; w: number; h: number };
type SelectionData = { quote: string; page: number; rects: Rect[] };
type PdfReaderProps = {
  url: string;
  initialPage?: number;
  notes: Array<{ id: string; page: number; color: string; rects?: Rect[] }>;
  onPageChange: (page: number, total: number) => void;
  onSelect: (data: SelectionData) => void;
  jumpPage?: number;
};
type PdfModule = typeof import("pdfjs-dist");
type LoadedPdf = { document: PDFDocumentProxy; module: PdfModule };
type SearchMatch = { page: number; snippet: string };
type SelectedText = SelectionData & { left: number; top: number };

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "#f4d76c", green: "#9dceb0", blue: "#96c5ee", pink: "#edabc1", purple: "#c4ace4",
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeSearch = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");

function readableError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") return "这份 PDF 已加密，请先解除密码保护后重新导入。";
  if (name === "InvalidPDFException") return "暂时无法解析这份 PDF，文件可能已损坏。";
  if (name === "MissingPDFException") return "没有找到 PDF 文件，请重新导入后再试。";
  return "PDF 暂时无法打开，请检查网络连接，或下载原文件查看。";
}

export default function PdfReader(props: PdfReaderProps) {
  return <PdfReaderSession key={props.url} {...props} />;
}

function PdfReaderSession({ url, initialPage = 1, notes, onPageChange, onSelect, jumpPage }: PdfReaderProps) {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(700);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<SelectedText | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [searchMessage, setSearchMessage] = useState("");
  const [handledJump, setHandledJump] = useState<{ value?: number; total: number }>({ total: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const textHostRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ onPageChange, onSelect });
  const initialPageRef = useRef(initialPage);
  const pageTextsRef = useRef(new Map<number, string>());
  const searchRunRef = useRef(0);
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const total = loaded?.document.numPages ?? 0;

  // Reconcile an external page request before committing the rendered page.
  if (total && (handledJump.value !== jumpPage || handledJump.total !== total)) {
    setHandledJump({ value: jumpPage, total });
    if (jumpPage != null) {
      const next = clamp(Math.floor(jumpPage) || 1, 1, total);
      setPage(next);
      setPageInput(String(next));
      setSelected(null);
    }
  }

  useEffect(() => { callbacksRef.current = { onPageChange, onSelect }; }, [onPageChange, onSelect]);
  useEffect(() => { initialPageRef.current = initialPage; }, [initialPage]);

  // Keep the document lifetime tied to its URL, never to annotation or callback changes.
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    async function load() {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        task = pdfjs.getDocument({ url, cMapUrl: "/cmaps/", cMapPacked: true, standardFontDataUrl: "/standard_fonts/", wasmUrl: "/wasm/" });
        const document = await task.promise;
        if (cancelled) return;
        const start = clamp(Math.floor(initialPageRef.current) || 1, 1, document.numPages);
        setPage(start);
        setPageInput(String(start));
        setLoaded({ document, module: pdfjs });
      } catch (cause) {
        if (!cancelled) setError(readableError(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      searchRunRef.current += 1;
      if (task) void task.destroy().catch(() => undefined);
    };
  }, [url, retry]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (total) callbacksRef.current.onPageChange(page, total);
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [page, total]);

  useEffect(() => {
    if (!loaded || !canvasHostRef.current || !textHostRef.current || width < 1) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    const canvasHost = canvasHostRef.current;
    const textHost = textHostRef.current;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `PDF 第 ${page} 页`);
    canvasHost.replaceChildren(canvas);
    textHost.replaceChildren();
    setRendering(true);
    setPageError("");
    setSelected(null);
    async function render() {
      try {
        const pdfPage = await loaded!.document.getPage(page);
        if (cancelled) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const available = Math.max(160, width - (width < 500 ? 24 : 48));
        const scale = Math.min(available / original.width, 1.6) * zoom;
        const viewport = pdfPage.getViewport({ scale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textHost.style.setProperty("--total-scale-factor", String(scale * pdfPage.userUnit));
        textHost.style.setProperty("--scale-factor", String(scale));
        setDimensions({ width: viewport.width, height: viewport.height });
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable");
        renderTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        void renderTask.promise.catch(() => undefined);
        const textContent = await pdfPage.getTextContent();
        if (cancelled) return;
        pageTextsRef.current.set(page, textContent.items.map((item) => "str" in item ? item.str : "").join(" "));
        textLayer = new loaded!.module.TextLayer({ textContentSource: textContent, container: textHost, viewport });
        // Await both tasks so cancellations never leave an unhandled render rejection.
        await Promise.all([renderTask.promise, textLayer.render()]);
      } catch (cause) {
        if (!cancelled) setPageError(readableError(cause));
      } finally {
        if (!cancelled) setRendering(false);
      }
    }
    void render();
    return () => {
      cancelled = true;
      if (renderTask) {
        void renderTask.promise.catch(() => undefined);
        renderTask.cancel();
      }
      textLayer?.cancel();
    };
  }, [loaded, page, zoom, width]);

  useEffect(() => {
    function captureSelection() {
      const selection = window.getSelection();
      const surface = surfaceRef.current;
      const textHost = textHostRef.current;
      if (!selection || selection.isCollapsed || !selection.rangeCount || !surface || !textHost) {
        setSelected(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!textHost.contains(range.startContainer) || !textHost.contains(range.endContainer)) {
        setSelected(null);
        return;
      }
      const quote = selection.toString().trim();
      if (!quote) { setSelected(null); return; }
      const bounds = surface.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const boxes = Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1);
      const rects = boxes.map((rect) => {
        const x = clamp((rect.left - bounds.left) / bounds.width, 0, 1);
        const y = clamp((rect.top - bounds.top) / bounds.height, 0, 1);
        return { x, y, w: clamp(rect.width / bounds.width, 0, 1 - x), h: clamp(rect.height / bounds.height, 0, 1 - y) };
      }).filter((rect) => rect.w > 0 && rect.h > 0);
      if (!rects.length) return;
      const last = boxes[boxes.length - 1];
      setSelected({ quote, page, rects, left: clamp(last.left - bounds.left, 8, Math.max(8, bounds.width - 155)), top: last.bottom - bounds.top + 8 });
    }
    function scheduleSelection() {
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = setTimeout(captureSelection, 160);
    }
    document.addEventListener("selectionchange", scheduleSelection);
    return () => {
      document.removeEventListener("selectionchange", scheduleSelection);
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
    };
  }, [page, loaded]);

  function goToPage(next: number) {
    if (!total) return;
    const target = clamp(Math.floor(next) || 1, 1, total);
    setPage(target);
    setPageInput(String(target));
    setSelected(null);
  }

  function retryDocument() {
    setLoaded(null);
    setLoading(true);
    setError("");
    setPageError("");
    setSelected(null);
    setMatches([]);
    setSearchMessage("");
    setSearching(false);
    pageTextsRef.current = new Map();
    searchRunRef.current += 1;
    setRetry((value) => value + 1);
  }

  function submitPage(event: FormEvent) {
    event.preventDefault();
    goToPage(Number(pageInput));
    setPageInput(String(clamp(Math.floor(Number(pageInput)) || 1, 1, total || 1)));
  }

  async function searchDocument(event: FormEvent) {
    event.preventDefault();
    if (!loaded) return;
    const search = normalizeSearch(query.trim());
    const run = ++searchRunRef.current;
    setMatches([]);
    setMatchIndex(0);
    setSearchMessage("");
    if (!search) { setSearching(false); return; }
    setSearching(true);
    try {
      const found: SearchMatch[] = [];
      let anyText = false;
      for (let number = 1; number <= loaded.document.numPages; number += 1) {
        if (run !== searchRunRef.current) return;
        let text = pageTextsRef.current.get(number);
        if (text === undefined) {
          const pdfPage = await loaded.document.getPage(number);
          const content = await pdfPage.getTextContent();
          if (run !== searchRunRef.current) return;
          text = content.items.map((item) => "str" in item ? item.str : "").join(" ");
          pageTextsRef.current.set(number, text);
        }
        const normalized = normalizeSearch(text);
        if (normalized) anyText = true;
        if (normalized.includes(search)) found.push({ page: number, snippet: text.slice(0, 180) });
      }
      if (run !== searchRunRef.current) return;
      setMatches(found);
      if (found.length) {
        goToPage(found[0].page);
        setSearchMessage(`共 ${found.length} 页包含“${query.trim()}”`);
      } else {
        setSearchMessage(anyText ? "没有找到匹配文字，请试试其他关键词。" : "这份 PDF 没有可提取的文字，扫描件需要先进行 OCR。" );
      }
    } catch {
      if (run === searchRunRef.current) setSearchMessage("搜索暂时未完成，请重试。");
    } finally {
      if (run === searchRunRef.current) setSearching(false);
    }
  }

  function stepMatch(direction: number) {
    if (!matches.length) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(next);
    goToPage(matches[next].page);
  }

  function clearSearch() {
    searchRunRef.current += 1;
    setQuery("");
    setMatches([]);
    setSearchMessage("");
    setSearching(false);
  }

  function recordSelection() {
    if (!selected) return;
    callbacksRef.current.onSelect({ quote: selected.quote, page: selected.page, rects: selected.rects });
    window.getSelection()?.removeAllRanges();
    setSelected(null);
  }

  return (
    <section className="pdf-reader" aria-label="论文阅读器">
      <div className="pdf-reader-toolbar">
        <div className="pdf-reader-page-controls">
          <button type="button" title="上一页" aria-label="上一页" onClick={() => goToPage(page - 1)} disabled={!total || page === 1}><ChevronLeft size={17} /></button>
          <form onSubmit={submitPage} className="pdf-reader-page-form">
            <input aria-label="跳转到页码" inputMode="numeric" value={pageInput} disabled={!total} onChange={(event) => setPageInput(event.target.value)} onBlur={() => setPageInput(String(page))} />
            <span>/ {total || "—"}</span>
          </form>
          <button type="button" title="下一页" aria-label="下一页" onClick={() => goToPage(page + 1)} disabled={!total || page === total}><ChevronRight size={17} /></button>
        </div>
        <div className="pdf-reader-zoom-controls">
          <button type="button" title="缩小" aria-label="缩小 PDF" disabled={!total || zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.15))}><Minus size={15} /></button>
          <button className="pdf-reader-fit" type="button" title="恢复适合宽度" onClick={() => setZoom(1)} disabled={!total}>{zoom === 1 ? "适宽" : `${Math.round(zoom * 100)}%`}</button>
          <button type="button" title="放大" aria-label="放大 PDF" disabled={!total || zoom >= 2.5} onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))}><Plus size={15} /></button>
        </div>
        <a href={url} target="_blank" rel="noreferrer" download className="pdf-reader-download" title="下载原文件" aria-label="下载 PDF 原文件"><Download size={17} /></a>
      </div>
      <form className="pdf-reader-search" onSubmit={searchDocument}>
        <Search size={15} aria-hidden="true" />
        <input aria-label="搜索 PDF 全文" placeholder="搜索 PDF 全文…" value={query} onChange={(event) => setQuery(event.target.value)} disabled={!total} />
        {query && <button type="button" onClick={clearSearch} title="清除搜索" aria-label="清除 PDF 搜索"><X size={14} /></button>}
        <button className="pdf-reader-search-submit" type="submit" disabled={!total || !query.trim() || searching}>{searching ? <LoaderCircle className="pdf-reader-spinner" size={14} /> : "查找"}</button>
      </form>
      {(searchMessage || searching) && <div className="pdf-reader-search-status" role="status">
        <span>{searching ? "正在搜索全文…" : searchMessage}</span>
        {matches.length > 0 && <div><button type="button" title="上一个匹配页面" aria-label="上一个匹配页面" onClick={() => stepMatch(-1)}><ChevronLeft size={15} /></button><span>{matchIndex + 1}/{matches.length}</span><button type="button" title="下一个匹配页面" aria-label="下一个匹配页面" onClick={() => stepMatch(1)}><ChevronRight size={15} /></button></div>}
      </div>}
      <div className="pdf-reader-scroll" ref={scrollRef}>
        {loading && <div className="pdf-reader-state" role="status"><LoaderCircle size={25} className="pdf-reader-spinner" /><strong>正在打开论文</strong><span>稍等片刻，马上开始阅读</span></div>}
        {error && <div className="pdf-reader-state" role="alert"><FileWarning size={30} /><strong>暂时无法打开</strong><span>{error}</span><button type="button" onClick={retryDocument}>重新加载</button><a href={url} target="_blank" rel="noreferrer" download>下载原文件</a></div>}
        <div className="pdf-reader-document" style={{ display: loaded && !error ? undefined : "none" }}>
          {pageError && <div className="pdf-reader-page-error" role="alert">{pageError}<button type="button" onClick={retryDocument}>重试</button></div>}
          <div ref={surfaceRef} className={`pdf-reader-paper${rendering ? " is-rendering" : ""}`} style={{ width: dimensions.width || undefined, height: dimensions.height || undefined }}>
            <div ref={canvasHostRef} className="pdf-reader-canvas" />
            <div className="pdf-reader-highlights" aria-hidden="true">
              {notes.filter((note) => note.page === page).flatMap((note) => (note.rects ?? []).map((rect, index) => <span key={`${note.id}-${index}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, backgroundColor: HIGHLIGHT_COLORS[note.color] ?? note.color } as CSSProperties} />))}
            </div>
            <div ref={textHostRef} className="pdf-reader-text-layer" />
            {selected && !rendering && <button className="pdf-reader-selection" type="button" style={{ left: selected.left, top: selected.top }} onPointerDown={(event) => event.preventDefault()} onClick={recordSelection}><Highlighter size={15} />摘录并记录</button>}
            {rendering && <div className="pdf-reader-page-loading" role="status"><LoaderCircle size={20} className="pdf-reader-spinner" /><span>正在加载第 {page} 页</span></div>}
          </div>
          {!rendering && !pageError && <p className="pdf-reader-hint">选中文字，随手摘录与记录 · 第 {page} 页</p>}
        </div>
      </div>
    </section>
  );
}
