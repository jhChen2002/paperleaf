import { env } from "cloudflare:workers";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import type { Folder, Library, LibraryBackup, Note, Paper } from "@/lib/types";

type Row = Record<string, unknown>;
type Context = { params: Promise<{ id: string }> | { id: string } };
const MAX_FILE = 40 * 1024 * 1024;
const MAX_JSON = 256 * 1024;
const now = () => new Date().toISOString();
const shortText = (max: number) => z.string().trim().max(max);
const identifier = z.string().min(1).max(160);
const color = z.string().regex(/^#[a-f\d]{6}$/i, "颜色需要使用六位十六进制格式");
const tags = z.array(shortText(80).min(1)).max(30).transform((values) => [...new Set(values)]);
const rect = z.object({
  x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
  w: z.number().finite().min(0).max(1), h: z.number().finite().min(0).max(1),
}).refine((v) => v.x + v.w <= 1.005 && v.y + v.h <= 1.005, "标记区域超出页面");
const paperSchema = z.object({
  title: shortText(1000).min(1, "请填写论文标题"),
  authors: shortText(2000).default(""), year: z.number().int().min(1000).max(2200).nullable().default(null),
  venue: shortText(1000).default(""), doi: shortText(500).default(""), abstract: shortText(50000).default(""),
  tags: tags.default([]), folderId: identifier.nullable().default(null),
  status: z.enum(["unread", "reading", "read"]).default("unread"), starred: z.boolean().default(false),
  pageCount: z.number().int().min(0).max(100000).default(0), currentPage: z.number().int().min(1).max(100000).default(1),
});
const noteSchema = z.object({
  paperId: identifier, quote: shortText(30000).default(""), content: shortText(30000).default(""),
  page: z.number().int().min(1).max(100000).nullable().default(null), color: color.default("#f2d774"),
  tags: tags.default([]), rects: z.array(rect).max(500).default([]),
});
const folderSchema = z.object({ name: shortText(120).min(1, "请填写文件夹名称"), color: color.default("#6b8071") });

class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

function db(): D1Database {
  if (!env.DB) throw new ApiError(503, "文献库暂时不可用，请稍后重试。", "DATABASE_UNAVAILABLE");
  return env.DB;
}
function bucket(): R2Bucket {
  if (!env.BUCKET) throw new ApiError(503, "文件存储暂时不可用，请稍后重试。", "STORAGE_UNAVAILABLE");
  return env.BUCKET;
}
async function user() {
  const value = await getChatGPTUser();
  if (!value) throw new ApiError(401, "请先登录，然后使用你的个人文献库。", "UNAUTHENTICATED");
  return value;
}
export async function api(action: () => Promise<Response>): Promise<Response> {
  try {
    const response = await action();
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) {
    const options = { headers: { "Cache-Control": "private, no-store" } };
    if (error instanceof ApiError) return Response.json({ error: error.message, code: error.code, ...error.details }, { ...options, status: error.status });
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message || "提交的内容格式不正确。", code: "VALIDATION_ERROR", fields: error.issues.map((issue) => issue.path.join(".")) }, { ...options, status: 400 });
    return Response.json({ error: "操作未完成，请稍后重试。你的其他文献不会受影响。", code: "SERVER_ERROR" }, { ...options, status: 500 });
  }
}

function limitedBody(request: Request, maxBytes: number): ReadableStream<Uint8Array> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new ApiError(413, "文件或请求内容超过大小限制。", "PAYLOAD_TOO_LARGE");
  if (!request.body) throw new ApiError(400, "请求内容不能为空。", "EMPTY_BODY");
  let size = 0;
  return request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new ApiError(413, "文件或请求内容超过大小限制。", "PAYLOAD_TOO_LARGE");
      controller.enqueue(chunk);
    },
  }));
}
async function json(request: Request, maxBytes = MAX_JSON): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "请使用 JSON 格式提交内容。", "UNSUPPORTED_MEDIA_TYPE");
  try { return JSON.parse(await new Response(limitedBody(request, maxBytes)).text()); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "JSON 文件格式不正确。", "INVALID_JSON"); }
}
function jsonList<T>(value: unknown): T[] {
  try { const result: unknown = JSON.parse(String(value || "[]")); return Array.isArray(result) ? result as T[] : []; }
  catch { return []; }
}
function paper(row: Row): Paper {
  return {
    id: String(row.id), title: String(row.title), authors: String(row.authors), year: row.year == null ? null : Number(row.year),
    venue: String(row.venue), doi: String(row.doi), abstract: String(row.abstract), tags: jsonList<string>(row.tags),
    folderId: row.folder_id == null ? null : String(row.folder_id), status: row.status as Paper["status"], starred: !!row.starred,
    pageCount: Number(row.page_count), currentPage: Number(row.current_page), fileName: row.file_name == null ? null : String(row.file_name),
    fileSize: Number(row.file_size), hasFile: !!row.file_key, createdAt: String(row.created_at), updatedAt: String(row.updated_at), revision: Number(row.revision),
  };
}
function note(row: Row): Note {
  return { id: String(row.id), paperId: String(row.paper_id), quote: String(row.quote), content: String(row.content),
    page: row.page == null ? null : Number(row.page), color: String(row.color), tags: jsonList<string>(row.tags), rects: jsonList<Note["rects"][number]>(row.rects),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), revision: Number(row.revision) };
}
function folder(row: Row): Folder { return { id: String(row.id), name: String(row.name), color: String(row.color) }; }
async function findPaper(id: string, userId: string): Promise<Row> {
  const row = await db().prepare("SELECT * FROM papers WHERE id = ? AND user_id = ?").bind(id, userId).first<Row>();
  if (!row) throw new ApiError(404, "找不到这篇论文，可能已在另一台设备删除。", "NOT_FOUND");
  return row;
}
async function findNote(id: string, userId: string): Promise<Row> {
  const row = await db().prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").bind(id, userId).first<Row>();
  if (!row) throw new ApiError(404, "找不到这条笔记，可能已在另一台设备删除。", "NOT_FOUND");
  return row;
}
async function checkFolder(id: string | null | undefined, userId: string) {
  if (id && !await db().prepare("SELECT id FROM folders WHERE id = ? AND user_id = ?").bind(id, userId).first()) throw new ApiError(404, "文件夹不存在或已被删除。", "FOLDER_NOT_FOUND");
}
function checkPages(value: Pick<Paper, "pageCount" | "currentPage">) {
  if (value.pageCount && value.currentPage > value.pageCount) throw new ApiError(400, "阅读位置不能超出论文页数。", "INVALID_PAGE");
}
function checkNote(value: Pick<Note, "quote" | "content">) {
  if (!value.quote && !value.content) throw new ApiError(400, "请填写摘录或笔记内容。", "EMPTY_NOTE");
}
async function idFrom(context: Context) { return identifier.parse((await context.params).id); }

export async function getLibrary() {
  const account = await user();
  const result = await db().batch<Row>([
    db().prepare("SELECT * FROM papers WHERE user_id = ? ORDER BY updated_at DESC, id").bind(account.userId),
    db().prepare("SELECT * FROM folders WHERE user_id = ? ORDER BY created_at, id").bind(account.userId),
    db().prepare("SELECT n.* FROM notes n JOIN papers p ON p.id = n.paper_id AND p.user_id = n.user_id WHERE n.user_id = ? ORDER BY n.updated_at DESC, n.id").bind(account.userId),
  ]);
  const library: Library = { papers: result[0].results.map(paper), folders: result[1].results.map(folder), notes: result[2].results.map(note), user: { name: account.displayName, email: account.email }, serverTime: now() };
  return Response.json(library);
}

function insertPaper(id: string, userId: string, value: z.infer<typeof paperSchema>, time: string, file: { name: string | null; size: number; key: string | null; hash: string | null } = { name: null, size: 0, key: null, hash: null }, ignoreExisting = false, updatedTime = time) {
  return db().prepare(`INSERT ${ignoreExisting ? "OR IGNORE " : ""}INTO papers (id,user_id,title,authors,year,venue,doi,abstract,tags,folder_id,status,starred,page_count,current_page,file_name,file_size,file_key,file_hash,created_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) RETURNING *`)
    .bind(id, userId, value.title, value.authors, value.year, value.venue, value.doi, value.abstract, JSON.stringify(value.tags), value.folderId, value.status, value.starred ? 1 : 0, value.pageCount, value.currentPage, file.name, file.size, file.key, file.hash, time, updatedTime);
}

export async function createPaper(request: Request) {
  const account = await user();
  const id = crypto.randomUUID();
  let value: z.infer<typeof paperSchema>;
  let file: { name: string | null; size: number; key: string | null; hash: string | null } = { name: null, size: 0, key: null, hash: null };
  let bytes: ArrayBuffer | null = null;
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await new Response(limitedBody(request, MAX_FILE + 1024 * 1024), { headers: { "content-type": request.headers.get("content-type")! } }).formData(); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "上传内容无法读取，请重新选择 PDF。", "INVALID_UPLOAD"); }
    const upload = form.get("file");
    if (!(upload instanceof File) || form.getAll("file").length !== 1) throw new ApiError(400, "请每次上传一个 PDF 文件。", "FILE_REQUIRED");
    if (!upload.size || upload.size > MAX_FILE) throw new ApiError(413, "单篇 PDF 大小不能超过 40 MB，且不能为空。", "FILE_TOO_LARGE");
    const magic = new TextDecoder().decode(await upload.slice(0, 5).arrayBuffer());
    if (magic !== "%PDF-") throw new ApiError(400, "这个文件不是有效的 PDF，请检查文件内容。", "INVALID_PDF");
    value = paperSchema.parse({ title: form.get("title") || upload.name.replace(/\.pdf$/i, "").replace(/[_]/g, " "), folderId: form.get("folderId") || null });
    bytes = await upload.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
    const duplicate = await db().prepare("SELECT id,title FROM papers WHERE user_id = ? AND file_hash = ?").bind(account.userId, hash).first<Row>();
    if (duplicate) throw new ApiError(409, "这篇 PDF 已经在文献库中了。", "DUPLICATE_FILE", { paperId: duplicate.id, title: duplicate.title });
    file = { name: upload.name.slice(0, 500), size: upload.size, key: `papers/${id}.pdf`, hash };
  } else {
    value = paperSchema.parse(await json(request));
  }
  checkPages(value);
  await checkFolder(value.folderId, account.userId);
  if (bytes && file.key) await bucket().put(file.key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  try {
    const created = await insertPaper(id, account.userId, value, now(), file).first<Row>();
    return Response.json({ paper: paper(created!) }, { status: 201 });
  } catch (error) {
    if (file.key) await bucket().delete(file.key).catch(() => undefined);
    if (file.hash) {
      const duplicate = await db().prepare("SELECT id FROM papers WHERE user_id = ? AND file_hash = ?").bind(account.userId, file.hash).first<Row>();
      if (duplicate) throw new ApiError(409, "这篇 PDF 已经在文献库中了。", "DUPLICATE_FILE", { paperId: duplicate.id });
    }
    throw error;
  }
}

const paperColumns: Record<string, string> = { title: "title", authors: "authors", year: "year", venue: "venue", doi: "doi", abstract: "abstract", tags: "tags", folderId: "folder_id", status: "status", starred: "starred", pageCount: "page_count", currentPage: "current_page" };
const noteColumns: Record<string, string> = { quote: "quote", content: "content", page: "page", color: "color", tags: "tags", rects: "rects" };
function valuesFor(value: Record<string, unknown>, columns: Record<string, string>) {
  return Object.entries(value).filter(([key]) => key in columns).map(([key, v]) => ({ column: columns[key], value: (key === "tags" || key === "rects" ? JSON.stringify(v) : typeof v === "boolean" ? Number(v) : v) as string | number | null }));
}

export async function updatePaper(request: Request, context: Context) {
  const account = await user(); const id = await idFrom(context);
  const input = paperSchema.partial().extend({ revision: z.number().int().positive() }).parse(await json(request));
  const existing = await findPaper(id, account.userId);
  if (input.revision !== Number(existing.revision)) throw new ApiError(409, "另一台设备已更新这篇论文，请刷新后重试。", "REVISION_CONFLICT", { current: paper(existing) });
  checkPages({ ...paper(existing), ...input });
  await checkFolder(input.folderId, account.userId);
  const fields = valuesFor(input, paperColumns);
  if (!fields.length) return Response.json({ paper: paper(existing) });
  const updated = await db().prepare(`UPDATE papers SET ${fields.map((f) => `${f.column} = ?`).join(", ")}, updated_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? RETURNING *`)
    .bind(...fields.map((f) => f.value), now(), id, account.userId, input.revision).first<Row>();
  if (!updated) throw new ApiError(409, "另一台设备已修改这篇论文，请刷新后重试。", "REVISION_CONFLICT", { current: paper(await findPaper(id, account.userId)) });
  return Response.json({ paper: paper(updated) });
}

function deleteRevision(request: Request) {
  const value = new URL(request.url).searchParams.get("revision");
  if (value === null) throw new ApiError(400, "缺少记录版本，请刷新后再删除。", "REVISION_REQUIRED");
  return z.coerce.number().int().positive().parse(value);
}
export async function deletePaper(request: Request, context: Context) {
  const account = await user(); const id = await idFrom(context); const revision = deleteRevision(request);
  const removed = await db().prepare("DELETE FROM papers WHERE id = ? AND user_id = ? AND revision = ? RETURNING *")
    .bind(id, account.userId, revision).first<Row>();
  if (!removed) { const current = await findPaper(id, account.userId); throw new ApiError(409, "论文已更新，请刷新后再删除。", "REVISION_CONFLICT", { current: paper(current) }); }
  if (removed.file_key) await bucket().delete(String(removed.file_key)).catch(() => undefined);
  return Response.json({ ok: true });
}

export async function getPaperFile(request: Request, context: Context) {
  const account = await user(); const row = await findPaper(await idFrom(context), account.userId);
  if (!row.file_key) throw new ApiError(404, "这条文献还没有 PDF 附件。元数据备份不包含原文件。", "FILE_NOT_FOUND");
  const total = Number(row.file_size); const rangeHeader = request.headers.get("range");
  let range: { offset: number; length: number } | undefined;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    range = { offset: start, length: end - start + 1 };
  }
  const object = await bucket().get(String(row.file_key), range ? { range } : undefined);
  if (!object) throw new ApiError(404, "PDF 文件暂时找不到，请重新上传原文件。", "FILE_NOT_FOUND");
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  const headers = new Headers({ "Content-Type": "application/pdf", "Accept-Ranges": "bytes", "Content-Length": String(range?.length ?? object.size), "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(String(row.file_name || "paper.pdf"))}` });
  if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${total}`);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

export async function attachPaperFile(request: Request, context: Context) {
  const account = await user(); const id = await idFrom(context);
  const existing = await findPaper(id, account.userId);
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) throw new ApiError(415, "请选择 PDF 文件上传。", "UNSUPPORTED_MEDIA_TYPE");
  let form: FormData;
  try { form = await new Response(limitedBody(request, MAX_FILE + 1024 * 1024), { headers: { "content-type": request.headers.get("content-type")! } }).formData(); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "上传内容无法读取，请重新选择 PDF。", "INVALID_UPLOAD"); }
  const revision = z.coerce.number().int().positive().parse(form.get("revision"));
  if (revision !== Number(existing.revision)) throw new ApiError(409, "另一台设备已更新这篇论文，请刷新后重试。", "REVISION_CONFLICT", { current: paper(existing) });
  const upload = form.get("file");
  if (!(upload instanceof File) || form.getAll("file").length !== 1) throw new ApiError(400, "请每次上传一个 PDF 文件。", "FILE_REQUIRED");
  if (!upload.size || upload.size > MAX_FILE) throw new ApiError(413, "单篇 PDF 大小不能超过 40 MB，且不能为空。", "FILE_TOO_LARGE");
  if (new TextDecoder().decode(await upload.slice(0, 5).arrayBuffer()) !== "%PDF-") throw new ApiError(400, "这个文件不是有效的 PDF，请检查文件内容。", "INVALID_PDF");
  const bytes = await upload.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
  const duplicate = await db().prepare("SELECT id,title FROM papers WHERE user_id = ? AND file_hash = ? AND id != ?").bind(account.userId, hash, id).first<Row>();
  if (duplicate) throw new ApiError(409, "这篇 PDF 已在另一条文献中，请直接打开已有文献。", "DUPLICATE_FILE", { paperId: duplicate.id, title: duplicate.title });
  if (existing.file_hash === hash && existing.file_key) return Response.json({ paper: paper(existing) });
  const key = `papers/${id}/${crypto.randomUUID()}.pdf`;
  await bucket().put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  try {
    const updated = await db().prepare("UPDATE papers SET file_name = ?, file_size = ?, file_key = ?, file_hash = ?, page_count = 0, current_page = 1, updated_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? RETURNING *")
      .bind(upload.name.slice(0, 500), upload.size, key, hash, now(), id, account.userId, revision).first<Row>();
    if (!updated) throw new ApiError(409, "论文已在另一台设备更改，请刷新后重新关联。", "REVISION_CONFLICT", { current: paper(await findPaper(id, account.userId)) });
    if (existing.file_key) await bucket().delete(String(existing.file_key)).catch(() => undefined);
    return Response.json({ paper: paper(updated) });
  } catch (error) {
    await bucket().delete(key).catch(() => undefined);
    const raceDuplicate = await db().prepare("SELECT id FROM papers WHERE user_id = ? AND file_hash = ? AND id != ?").bind(account.userId, hash, id).first<Row>();
    if (raceDuplicate) throw new ApiError(409, "这篇 PDF 已经在文献库中了。", "DUPLICATE_FILE", { paperId: raceDuplicate.id });
    throw error;
  }
}

export async function createFolder(request: Request) {
  const account = await user(); const value = folderSchema.parse(await json(request));
  const row = await db().prepare("INSERT INTO folders (id,user_id,name,color,created_at) VALUES (?,?,?,?,?) RETURNING *").bind(crypto.randomUUID(), account.userId, value.name, value.color, now()).first<Row>();
  return Response.json({ folder: folder(row!) }, { status: 201 });
}
export async function updateFolder(request: Request, context: Context) {
  const account = await user(); const id = await idFrom(context); const value = folderSchema.partial().parse(await json(request));
  await checkFolder(id, account.userId);
  const fields = valuesFor(value, { name: "name", color: "color" });
  if (!fields.length) throw new ApiError(400, "请选择要修改的文件夹信息。", "EMPTY_UPDATE");
  const row = await db().prepare(`UPDATE folders SET ${fields.map((f) => `${f.column} = ?`).join(",")} WHERE id = ? AND user_id = ? RETURNING *`).bind(...fields.map((f) => f.value), id, account.userId).first<Row>();
  if (!row) throw new ApiError(404, "文件夹已被删除。", "FOLDER_NOT_FOUND");
  return Response.json({ folder: folder(row) });
}
export async function deleteFolder(_request: Request, context: Context) {
  const account = await user(); const id = await idFrom(context); await checkFolder(id, account.userId);
  await db().batch([
    db().prepare("UPDATE papers SET folder_id = NULL, updated_at = ?, revision = revision + 1 WHERE folder_id = ? AND user_id = ?").bind(now(), id, account.userId),
    db().prepare("DELETE FROM folders WHERE id = ? AND user_id = ?").bind(id, account.userId),
  ]);
  return Response.json({ ok: true });
}

function insertNote(id: string, userId: string, value: z.infer<typeof noteSchema>, time: string, ignoreExisting = false, updatedTime = time) {
  return db().prepare(`INSERT ${ignoreExisting ? "OR IGNORE " : ""}INTO notes (id,user_id,paper_id,quote,content,page,color,tags,rects,created_at,updated_at,revision) SELECT ?,?,?,?,?,?,?,?,?,?,?,1 WHERE EXISTS (SELECT 1 FROM papers WHERE id = ? AND user_id = ?) RETURNING *`)
    .bind(id, userId, value.paperId, value.quote, value.content, value.page, value.color, JSON.stringify(value.tags), JSON.stringify(value.rects), time, updatedTime, value.paperId, userId);
}
export async function createNote(request: Request) {
  const account = await user(); const value = noteSchema.parse(await json(request)); checkNote(value);
  const parent = paper(await findPaper(value.paperId, account.userId));
  if (value.page && parent.pageCount && value.page > parent.pageCount) throw new ApiError(400, "笔记页码超出论文页数。", "INVALID_PAGE");
  const created = await insertNote(crypto.randomUUID(), account.userId, value, now()).first<Row>();
  if (!created) throw new ApiError(404, "原论文已删除，无法新增笔记。", "PAPER_NOT_FOUND");
  return Response.json({ note: note(created) }, { status: 201 });
}
export async function updateNote(request: Request, context: Context) {
  const account = await user(); const id = await idFrom(context);
  const input = noteSchema.omit({ paperId: true }).partial().extend({ revision: z.number().int().positive() }).parse(await json(request));
  const existing = await findNote(id, account.userId);
  if (input.revision !== Number(existing.revision)) throw new ApiError(409, "另一台设备已更新这条笔记，请刷新后重试。", "REVISION_CONFLICT", { current: note(existing) });
  const combined = { ...note(existing), ...input }; checkNote(combined);
  const parent = paper(await findPaper(String(existing.paper_id), account.userId));
  if (combined.page && parent.pageCount && combined.page > parent.pageCount) throw new ApiError(400, "笔记页码超出论文页数。", "INVALID_PAGE");
  const fields = valuesFor(input, noteColumns);
  if (!fields.length) return Response.json({ note: note(existing) });
  const updated = await db().prepare(`UPDATE notes SET ${fields.map((f) => `${f.column} = ?`).join(",")}, updated_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? RETURNING *`)
    .bind(...fields.map((f) => f.value), now(), id, account.userId, input.revision).first<Row>();
  if (!updated) throw new ApiError(409, "另一台设备已修改这条笔记，请刷新后重试。", "REVISION_CONFLICT", { current: note(await findNote(id, account.userId)) });
  return Response.json({ note: note(updated) });
}
export async function deleteNote(request: Request, context: Context) {
  const account = await user(); const id = await idFrom(context); const revision = deleteRevision(request);
  const removed = await db().prepare("DELETE FROM notes WHERE id = ? AND user_id = ? AND revision = ? RETURNING id").bind(id, account.userId, revision).first();
  if (!removed) { const current = await findNote(id, account.userId); throw new ApiError(409, "笔记已更新，请刷新后再删除。", "REVISION_CONFLICT", { current: note(current) }); }
  return Response.json({ ok: true });
}

export async function exportLibrary() {
  const response = await getLibrary(); const library = await response.json() as Library;
  const backup: LibraryBackup = { version: 1, exportedAt: now(), papers: library.papers, folders: library.folders, notes: library.notes };
  return Response.json(backup, { headers: { "Content-Disposition": `attachment; filename="paperleaf-backup-${now().slice(0, 10)}.json"` } });
}

export async function importLibrary(request: Request) {
  const account = await user();
  const backupDates = { createdAt: z.string().datetime().optional(), updatedAt: z.string().datetime().optional() };
  const backupSchema = z.object({
    version: z.literal(1),
    folders: z.array(folderSchema.extend({ id: identifier })).max(2000),
    papers: z.array(paperSchema.extend({ id: identifier, hasFile: z.boolean().optional(), fileName: shortText(500).nullable().optional(), fileSize: z.number().int().min(0).max(MAX_FILE).optional(), ...backupDates })).max(5000),
    notes: z.array(noteSchema.extend({ id: identifier, ...backupDates })).max(15000),
  });
  const backup = backupSchema.parse(await json(request, 16 * 1024 * 1024));
  for (const value of backup.papers) checkPages(value);
  for (const value of backup.notes) checkNote(value);
  const currentResponse = await getLibrary(); const current = await currentResponse.json() as Library;
  const currentPapers = new Set(current.papers.map((p) => p.id));
  const currentFolders = new Set(current.folders.map((p) => p.id));
  const currentNotes = new Set(current.notes.map((p) => p.id));
  const folderMap = new Map<string, string>(); const paperMap = new Map<string, string>();
  const imported = { papers: 0, folders: 0, notes: 0 }; const skipped = { papers: 0, folders: 0, notes: 0 }; let missingFiles = 0;
  const time = now();
  async function restoredId(kind: string, sourceId: string) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${account.userId}:${kind}:${sourceId}`));
    return `restored-${Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("").slice(0, 40)}`;
  }
  // Backups merge only missing records. Existing revisions are never overwritten.
  // Deterministic user-scoped IDs also make a repeated restore idempotent.
  const folderStatements: D1PreparedStatement[] = [];
  for (const value of backup.folders) {
    const id = currentFolders.has(value.id) ? value.id : await restoredId("folder", value.id);
    folderMap.set(value.id, id);
    if (currentFolders.has(id)) { skipped.folders++; continue; }
    currentFolders.add(id);
    folderStatements.push(db().prepare("INSERT OR IGNORE INTO folders (id,user_id,name,color,created_at) VALUES (?,?,?,?,?)").bind(id, account.userId, value.name, value.color, time));
  }
  async function runBatch(statements: D1PreparedStatement[], kind: keyof typeof imported) {
    try {
      for (let start = 0; start < statements.length; start += 50) {
        const result = await db().batch(statements.slice(start, start + 50));
        imported[kind] += result.reduce((sum, item) => sum + Number(item.meta.changes || 0), 0);
      }
    } catch {
      throw new ApiError(503, `恢复暂时中断，已合并 ${imported.papers} 篇文献、${imported.folders} 个分类和 ${imported.notes} 条笔记。请刷新后重新导入同一备份，已恢复的内容不会重复添加。`, "IMPORT_INTERRUPTED", { imported, skipped });
    }
  }
  await runBatch(folderStatements, "folders");
  const paperStatements: D1PreparedStatement[] = [];
  for (const value of backup.papers) {
    const id = currentPapers.has(value.id) ? value.id : await restoredId("paper", value.id);
    paperMap.set(value.id, id);
    if (currentPapers.has(id)) { skipped.papers++; continue; }
    currentPapers.add(id);
    const folderId = value.folderId ? (folderMap.get(value.folderId) || (currentFolders.has(value.folderId) ? value.folderId : null)) : null;
    paperStatements.push(insertPaper(id, account.userId, { ...value, folderId }, value.createdAt || time, { name: value.fileName ?? null, size: value.fileSize ?? 0, key: null, hash: null }, true, value.updatedAt || time));
    if (value.hasFile) missingFiles++;
  }
  await runBatch(paperStatements, "papers");
  const noteStatements: D1PreparedStatement[] = [];
  for (const value of backup.notes) {
    const id = currentNotes.has(value.id) ? value.id : await restoredId("note", value.id);
    if (currentNotes.has(id)) { skipped.notes++; continue; }
    const paperId = paperMap.get(value.paperId) || (currentPapers.has(value.paperId) ? value.paperId : null);
    if (!paperId) { skipped.notes++; continue; }
    currentNotes.add(id);
    noteStatements.push(insertNote(id, account.userId, { ...value, paperId }, value.createdAt || time, true, value.updatedAt || time));
  }
  await runBatch(noteStatements, "notes");
  return Response.json({ imported, skipped, missingFiles, message: `已合并 ${imported.papers} 篇文献、${imported.folders} 个文件夹和 ${imported.notes} 条笔记。现有记录保持不变。JSON 备份不包含 PDF 原文件。` });
}
