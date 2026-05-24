// Microsoft Graph wrapper,所有路径都锚在 /me/drive/special/approot 沙盒里。
// 即使 token 泄漏也只能访问本 app 自己的 approot,不波及用户其它 OneDrive 文件。
//
// 跟 JustReadPapers 的区别:
//  - books 是树状,可以有任意层级子文件夹。listChildren 支持 folder=true 的条目。
//  - 不光 PDF,还有 TXT。下载时 binary blob (PDF) vs text (TXT) 分开。
//  - 仍读写 JSON (session.json + library.json)。

import { getToken } from "./auth.js";
import { decodeBytes } from "./encoding.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function encodeSeg(name) {
  return encodeURIComponent(name).replace(/'/g, "%27");
}

// 多段路径(如 books/folderA/foo.txt)逐段 encode,保留 /
export function encodeApprootPath(path) {
  return path.split("/").filter(Boolean).map(encodeSeg).join("/");
}

async function graphFetch(method, pathOrUrl, { headers = {}, body = null } = {}) {
  const token = await getToken();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;
  const init = {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
  };
  if (body != null) {
    if (
      typeof body === "string" ||
      body instanceof ArrayBuffer ||
      ArrayBuffer.isView(body) ||
      body instanceof Blob
    ) {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      if (!init.headers["Content-Type"]) {
        init.headers["Content-Type"] = "application/json";
      }
    }
  }
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch (_) {}
    const err = new Error(`Graph ${method} ${pathOrUrl} → ${response.status}: ${detail}`);
    err.status = response.status;
    err.body = detail;
    throw err;
  }
  return response;
}

// ── Listing ────────────────────────────────────────────────────────────────

// subfolder = "" 列 approot 根;否则列 approot/<subfolder>。404 静默返回 []。
// 返回 driveItem[] —— 既含文件也含子文件夹 (用 item.folder / item.file 区分)。
export async function listChildren(subfolder = "") {
  const pathPart = subfolder ? `:/${encodeApprootPath(subfolder)}:` : "";
  const items = [];
  let next = `/me/drive/special/approot${pathPart}/children?$top=200&$select=id,name,size,eTag,createdDateTime,lastModifiedDateTime,file,folder,parentReference`;
  while (next) {
    let response;
    try {
      response = await graphFetch("GET", next);
    } catch (e) {
      if (e.status === 404 && subfolder) return [];
      throw e;
    }
    const page = await response.json();
    items.push(...(page.value ?? []));
    next = page["@odata.nextLink"] ?? null;
  }
  return items;
}

export async function listChildrenOfFolderId(folderId) {
  const items = [];
  let next = `/me/drive/items/${folderId}/children?$top=200&$select=id,name,size,eTag,createdDateTime,lastModifiedDateTime,file,folder,parentReference`;
  while (next) {
    const r = await graphFetch("GET", next);
    const page = await r.json();
    items.push(...(page.value ?? []));
    next = page["@odata.nextLink"] ?? null;
  }
  return items;
}

export async function getItemMeta(itemId) {
  const r = await graphFetch(
    "GET",
    `/me/drive/items/${itemId}?$select=id,name,size,eTag,createdDateTime,lastModifiedDateTime,file,folder,parentReference,@microsoft.graph.downloadUrl`,
  );
  return r.json();
}

// ── 二进制下载 (PDF 用) ────────────────────────────────────────────────────
// 优先用 @microsoft.graph.downloadUrl (短期签名,CDN 加速)。

export async function downloadItemBlob(itemId, { onProgress } = {}) {
  const meta = await getItemMeta(itemId);
  const dl = meta["@microsoft.graph.downloadUrl"];
  if (dl) {
    const r = await fetch(dl);
    if (!r.ok) throw new Error(`downloadUrl 失败 ${r.status}`);
    return { blob: await readResponseWithProgress(r, onProgress), meta };
  }
  const r = await graphFetch("GET", `/me/drive/items/${itemId}/content`);
  return { blob: await readResponseWithProgress(r, onProgress), meta };
}

async function readResponseWithProgress(response, onProgress) {
  if (!onProgress || !response.body) return response.blob();
  const total = parseInt(response.headers.get("content-length") || "0", 10) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let read = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    read += value.byteLength;
    if (total > 0) onProgress(read / total);
  }
  return new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
}

// ── 文本下载 (TXT 用),内置 encoding 自动探测 ─────────────────────────────
// 返回 { text, encoding, blob, meta }
// blob 也带上,UI 想缓存原始字节(避免 re-decode)就用 blob。
export async function downloadItemText(itemId, { onProgress } = {}) {
  const { blob, meta } = await downloadItemBlob(itemId, { onProgress });
  const buf = await blob.arrayBuffer();
  const { text, encoding } = decodeBytes(buf);
  return { text, encoding, blob, meta };
}

// ── Read JSON (session.json / library.json) ───────────────────────────────
// 返回 { data, eTag, item },404 → { data: null }

export async function readApprootJson(path) {
  try {
    const meta = await graphFetch(
      "GET",
      `/me/drive/special/approot:/${encodeApprootPath(path)}?$select=id,name,eTag`,
    );
    const metaJson = await meta.json();
    const r = await graphFetch("GET", `/me/drive/items/${metaJson.id}/content`);
    const data = await r.json();
    return { data, eTag: metaJson.eTag, item: metaJson };
  } catch (e) {
    if (e.status === 404) return { data: null, eTag: null, item: null };
    throw e;
  }
}

// eTag 非 null → If-Match 防冲突。conflictBehavior=replace 创建/覆盖。
export async function writeApprootJson(path, data, eTag = null) {
  const headers = { "Content-Type": "application/json" };
  if (eTag) headers["If-Match"] = eTag;
  const r = await graphFetch(
    "PUT",
    `/me/drive/special/approot:/${encodeApprootPath(path)}:/content?@microsoft.graph.conflictBehavior=replace`,
    { headers, body: JSON.stringify(data) },
  );
  return r.json();
}

// ── 文件上传 (本地上传的 TXT/PDF) ──────────────────────────────────────────
// Graph 单次 PUT 限 4MB,边界(>4MB)走 createUploadSession。
//
// conflictBehavior 默认 "fail" —— sync-constraints #7:同名冲突要
// **surface 给用户**(标 collision + 禁止上传 + 等用户本地改名),
// 不能默默 rename 加后缀(那样云端会涌出 "foo 1.txt" "foo 2.txt" 一堆)。
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

export async function uploadFileToApproot(
  path, blob,
  contentType = "application/octet-stream",
  { conflictBehavior = "fail" } = {},
) {
  if (blob.size <= SIMPLE_UPLOAD_LIMIT) {
    const r = await graphFetch(
      "PUT",
      `/me/drive/special/approot:/${encodeApprootPath(path)}:/content?@microsoft.graph.conflictBehavior=${conflictBehavior}`,
      { headers: { "Content-Type": contentType }, body: blob },
    );
    return r.json();
  }
  // 大文件 chunked
  const sessR = await graphFetch(
    "POST",
    `/me/drive/special/approot:/${encodeApprootPath(path)}:/createUploadSession`,
    {
      body: {
        item: {
          "@microsoft.graph.conflictBehavior": conflictBehavior,
          name: path.split("/").pop(),
        },
      },
    },
  );
  const { uploadUrl } = await sessR.json();
  const CHUNK = 5 * 1024 * 1024;
  let offset = 0;
  let last = null;
  while (offset < blob.size) {
    const end = Math.min(offset + CHUNK, blob.size) - 1;
    const chunk = blob.slice(offset, end + 1);
    const r = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.size),
        "Content-Range": `bytes ${offset}-${end}/${blob.size}`,
      },
      body: chunk,
    });
    if (!r.ok && r.status !== 202) {
      throw new Error(`chunked upload 失败 ${r.status}`);
    }
    last = await r.json().catch(() => null);
    offset = end + 1;
  }
  return last;
}

// ── Rename / move / delete ─────────────────────────────────────────────────

export async function renameItem(itemId, newName, eTag = null) {
  const headers = {};
  if (eTag) headers["If-Match"] = eTag;
  const r = await graphFetch("PATCH", `/me/drive/items/${itemId}`, {
    headers,
    body: { name: newName },
  });
  return r.json();
}

export async function moveItemToFolder(itemId, targetFolderId, eTag = null) {
  const headers = {};
  if (eTag) headers["If-Match"] = eTag;
  const r = await graphFetch("PATCH", `/me/drive/items/${itemId}`, {
    headers,
    body: { parentReference: { id: targetFolderId } },
  });
  return r.json();
}

export async function deleteItem(itemId) {
  await graphFetch("DELETE", `/me/drive/items/${itemId}`);
}

// ── Approot root + 子文件夹 ensure ─────────────────────────────────────────

let approotIdCache = null;
const subfolderIdCache = new Map();

export async function getApprootId() {
  if (approotIdCache) return approotIdCache;
  const r = await graphFetch("GET", "/me/drive/special/approot?$select=id");
  approotIdCache = (await r.json()).id;
  return approotIdCache;
}

// 确保 approot 下有指定子文件夹。name 可以是单段(books) 或多段(books/sub1/sub2)。
export async function ensureSubfolder(name) {
  if (subfolderIdCache.has(name)) return subfolderIdCache.get(name);
  try {
    const r = await graphFetch(
      "GET",
      `/me/drive/special/approot:/${encodeApprootPath(name)}?$select=id,name,folder`,
    );
    const item = await r.json();
    if (item.folder) {
      subfolderIdCache.set(name, item.id);
      return item.id;
    }
    throw new Error(`${name} 已存在但不是文件夹`);
  } catch (e) {
    if (e.status !== 404) throw e;
    // 多段路径要逐级建。简单做法:用 PUT path/content 创空文件 OneDrive 会自动建中间;
    // 这里专建 folder,用最后一段 POST children at parent。
    const segments = name.split("/").filter(Boolean);
    let parentSegmentPath = "";
    let lastId = null;
    for (const seg of segments) {
      const path = parentSegmentPath ? `${parentSegmentPath}/${seg}` : seg;
      if (subfolderIdCache.has(path)) {
        lastId = subfolderIdCache.get(path);
        parentSegmentPath = path;
        continue;
      }
      // 试 GET
      try {
        const r2 = await graphFetch("GET", `/me/drive/special/approot:/${encodeApprootPath(path)}?$select=id,folder`);
        const it = await r2.json();
        if (it.folder) {
          subfolderIdCache.set(path, it.id);
          lastId = it.id;
          parentSegmentPath = path;
          continue;
        }
      } catch (e2) {
        if (e2.status !== 404) throw e2;
      }
      // 建
      const parentRef = parentSegmentPath
        ? `/me/drive/special/approot:/${encodeApprootPath(parentSegmentPath)}:/children`
        : `/me/drive/special/approot/children`;
      const r3 = await graphFetch("POST", parentRef, {
        body: { name: seg, folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
      });
      const it3 = await r3.json();
      subfolderIdCache.set(path, it3.id);
      lastId = it3.id;
      parentSegmentPath = path;
    }
    return lastId;
  }
}
