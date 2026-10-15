import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.PAPERLEAF_TEST_URL || 'http://127.0.0.1:43128';
const report = [];
const createdPapers = new Set();
const createdFolders = new Set();
const record = (label) => { report.push({ test: label, passed: true }); console.log(`PASS ${label}`); };
async function request(path, method = 'GET', body, extra = {}) {
  if(process.env.DEBUG_QA) console.log(method,path,body instanceof FormData?'form':JSON.stringify(body)?.slice(0,110));
  const headers = { Cookie: '__sites_local_auth=1', ...extra };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await response.text(); let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
function expect(result, code) { assert.equal(result.status, code, JSON.stringify(result.data)); return result.data; }
function upload(text, filename = 'QA.pdf', revision) {
  const form = new FormData(); form.set('file', new File([text], filename, { type: 'application/pdf' }));
  if (revision) form.set('revision', String(revision)); return form;
}
const suffix = Date.now();
let failure;
try {
  expect(await request('/api/library','GET',undefined,{Origin:'https://example.com'}),403);
  expect(await request('/api/library','GET',undefined,{'Sec-Fetch-Site':'cross-site'}),403);
  record('Loopback origin protection');
  expect(await request('/api/papers','POST',{ title: '' }),400);
  expect(await request('/api/papers','POST',{ title: 'QA', tags: Array(31).fill('too-many') }),400);
  expect(await request('/api/papers','POST',{ title: 'QA', abstract: 'x'.repeat(270000) }),413);
  expect(await request('/api/papers','POST',upload('Not a PDF')),400);
  expect(await request('/api/papers','POST',upload('')),413);
  record('Validation, JSON payload bound, PDF signature and empty-file checks');
  const folder = expect(await request('/api/folders','POST',{ name:`QA folder ${suffix}`, color:'#123456' }),201).folder;
  createdFolders.add(folder.id);
  let paper = expect(await request('/api/papers','POST',{ title:`QA metadata ${suffix}`, authors:'Author One', tags:['method'], folderId:folder.id, pageCount:5, currentPage:2 }),201).paper;
  createdPapers.add(paper.id);
  expect(await request(`/api/papers/${paper.id}`,'DELETE'),400);
  expect(await request(`/api/papers/${paper.id}/file`),404);
  expect(await request(`/api/papers/${paper.id}`,'PATCH',{ currentPage:6, revision:paper.revision }),400);
  paper = expect(await request(`/api/papers/${paper.id}`,'PATCH',{ title:'QA renamed', revision:paper.revision }),200).paper;
  assert.equal(paper.authors,'Author One'); assert.equal(paper.currentPage,2); assert.deepEqual(paper.tags,['method']);
  const edits = await Promise.all([
    request(`/api/papers/${paper.id}`,'PATCH',{ starred:true, revision:paper.revision }),
    request(`/api/papers/${paper.id}`,'PATCH',{ status:'reading', revision:paper.revision }),
  ]);
  assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
  const successful = edits.find(r=>r.status===200).data.paper;
  expect(await request(`/api/papers/${paper.id}?revision=${paper.revision}`,'DELETE'),409);
  paper = successful;
  record('Partial updates preserve fields and simultaneous edits enforce revision');
  expect(await request('/api/notes','POST',{ paperId:paper.id, content:'invalid', page:6 }),400);
  expect(await request('/api/notes','POST',{ paperId:paper.id, content:'invalid', rects:[{x:.9,y:0,w:.5,h:.1}] }),400);
  let note = expect(await request('/api/notes','POST',{ paperId:paper.id, quote:'Important quote', content:'My thought', page:2, rects:[{x:.1,y:.2,w:.3,h:.03}] }),201).note;
  const noteEdits=await Promise.all([
    request(`/api/notes/${note.id}`,'PATCH',{content:'First edit',revision:note.revision}),
    request(`/api/notes/${note.id}`,'PATCH',{content:'Second edit',revision:note.revision}),
  ]);
  assert.deepEqual(noteEdits.map(r=>r.status).sort(),[200,409]);
  expect(await request(`/api/notes/${note.id}?revision=1`,'DELETE'),409);
  note=noteEdits.find(r=>r.status===200).data.note;
  record('Page/rectangle validation and simultaneous note revision protection');
  const bytes=`%PDF-1.4\n% QA upload ${suffix}\n%%EOF`;
  const pdf = expect(await request('/api/papers','POST',upload(bytes,`QA-upload-${suffix}.pdf`)),201).paper;
  createdPapers.add(pdf.id); assert.equal(pdf.hasFile,true);
  const duplicate=expect(await request('/api/papers','POST',upload(bytes)),409); assert.equal(duplicate.code,'DUPLICATE_FILE');
  const full=await request(`/api/papers/${pdf.id}/file`);expect(full,200);assert.equal(full.data,bytes);
  const range=await request(`/api/papers/${pdf.id}/file`,'GET',undefined,{ Range:'bytes=0-4' });expect(range,206);assert.equal(range.data,'%PDF-');assert.equal(range.headers.get('content-range'),`bytes 0-4/${new TextEncoder().encode(bytes).byteLength}`);
  expect(await request(`/api/papers/${pdf.id}/file`,'GET',undefined,{ Range:'bytes=999999-1000000' }),416);
  assert.match((await request(`/api/papers/${pdf.id}/file?download=1`)).headers.get('content-disposition'),/^attachment;/);
  expect(await request(`/api/papers/${paper.id}/file`,'POST',upload(bytes,'dup.pdf',paper.revision)),409);
  const attached = expect(await request(`/api/papers/${paper.id}/file`,'POST',upload(`%PDF-1.4\n% QA attachment ${suffix}\n%%EOF`,'attached.pdf',paper.revision)),200).paper;
  assert.equal(attached.hasFile,true);assert.equal(attached.revision,paper.revision+1);paper=attached;
  record('PDF persisted byte-for-byte, deduplicated, ranged, downloadable and attachable');
  const backup=expect(await request('/api/export'),200);
  const serialized=JSON.stringify(backup);assert.ok(!serialized.includes('file_key'));assert.ok(!serialized.includes('file_hash'));assert.ok(!serialized.includes('user_id'));assert.ok(!serialized.includes('qa-other-paper'));
  const unchanged=expect(await request('/api/import','POST',backup),200);assert.equal(unchanged.imported.papers,0);assert.equal(unchanged.imported.notes,0);assert.equal(unchanged.imported.folders,0);
  const sourcePaper=`qa-source-paper-${suffix}`, sourceFolder=`qa-source-folder-${suffix}`;
  const restore={version:1,folders:[{id:sourceFolder,name:`QA restored folder ${suffix}`,color:'#123456'}],papers:[{id:sourcePaper,title:`QA restored paper ${suffix}`,folderId:sourceFolder,hasFile:true,fileName:'missing.pdf',fileSize:42,createdAt:'2025-01-02T00:00:00.000Z',updatedAt:'2025-02-03T00:00:00.000Z'}],notes:[{id:`qa-source-note-${suffix}`,paperId:sourcePaper,content:'Restored note',page:1},{id:`qa-orphan-note-${suffix}`,paperId:'missing-parent',content:'Should skip'}]};
  const restored=expect(await request('/api/import','POST',restore),200);assert.deepEqual(restored.imported,{papers:1,folders:1,notes:1});assert.equal(restored.skipped.notes,1);assert.equal(restored.missingFiles,1);
  const second=expect(await request('/api/import','POST',restore),200);assert.deepEqual(second.imported,{papers:0,folders:0,notes:0});
  const after=expect(await request('/api/library'),200);const restoredPaper=after.papers.find(p=>p.title===`QA restored paper ${suffix}`);const restoredFolder=after.folders.find(p=>p.name===`QA restored folder ${suffix}`);
  assert.ok(restoredPaper);createdPapers.add(restoredPaper.id);createdFolders.add(restoredFolder.id);assert.equal(restoredPaper.hasFile,false);assert.equal(restoredPaper.createdAt,'2025-01-02T00:00:00.000Z');assert.equal(restoredPaper.folderId,restoredFolder.id);
  record('Metadata backup omits private internals; restore is idempotent, preserves dates and skips orphan notes');
  expect(await request(`/api/folders/${folder.id}`,'DELETE'),200);createdFolders.delete(folder.id);
  const afterFolder=expect(await request('/api/library'),200).papers.find(p=>p.id===paper.id);assert.equal(afterFolder.folderId,null);assert.equal(afterFolder.revision,paper.revision+1);
  expect(await request(`/api/papers/${paper.id}?revision=${afterFolder.revision}`,'DELETE'),200);createdPapers.delete(paper.id);
  assert.ok(!expect(await request('/api/library'),200).notes.some(n=>n.id===note.id));
  record('Folder deletion preserves papers and increments revisions; paper deletion cascades notes');
} catch (error) { failure=error; report.push({passed:false,error:error.stack||String(error)});console.error(error); }
finally {
  const cleanupLibrary=expect(await request('/api/library'),200);
  for(const id of createdPapers) { const item=cleanupLibrary.papers.find(p=>p.id===id); if(item) await request(`/api/papers/${id}?revision=${item.revision}`,'DELETE'); }
  for(const id of createdFolders) await request(`/api/folders/${id}`,'DELETE');
  await mkdir('qa',{recursive:true});await writeFile('qa/portable-http-results.json',JSON.stringify({testedAt:new Date().toISOString(),passed:!failure,tests:report},null,2));
}
if(failure)process.exitCode=1;
