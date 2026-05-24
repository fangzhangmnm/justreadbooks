# Sync constraints — product-level priorities

> Cross-project 设计准则;源版本住在 [RealHome/docs/sync-constraints.md](../../20260520%20RealHome/docs/sync-constraints.md)。
> 这里 inline 一份是因为 repo 单独 clone 时外链会断;两边内容应该保持一致,
> RealHome 那边是 source of truth,改了同步过来。

The product-level rules the local-cache ↔ cloud-sync layer must obey.
Listed in priority order — higher numbers may be sacrificed for lower
numbers, never the reverse.

This is a **cross-project** doc — same constraints apply across the
sibling-app family (RealHome, WebXiaoHeiWu, Background Audio,
JustReadPapers, JustReadBooks). What differs per project is which
variability axes (last section) apply; the core constraints don't.

## Core constraints (priority order)

### 1. Zero-account is first-class (product promise)

The app works **completely** offline, with **no** cloud account, as a
fully functional standalone tool. Not a degraded fallback — a first-
class mode.

For RealHome: no OneDrive sign-in = drag-drop glb → it plays. Bundled
worlds work. Cached worlds work. Nothing about the UI says "you need
to sign in."

### 2. No consent → no user data deletion (critical safety red line)

The app **never** silently destroys user data. Every destructive
action requires explicit user consent. There are **two different
consent semantics**:

- **Local cache consent**: deleting a record from the local IndexedDB
  cache. Lower-risk because (for cloud-backed records) the cloud copy
  may still exist; user can re-download. Standard confirm dialog.
- **Cloud consent**: deleting from the user's cloud (OneDrive
  AppFolder, etc.). High-risk: data is gone everywhere. Stronger
  confirm: name the file, show "this affects all your devices",
  default button = Cancel.

The two MUST be separate UI affordances. A single button must not do
both without making the scope clear.

What counts as deletion: removing a record, overwriting an upload,
cascading on account-switch, "clean all cache" button. All of these
need consent of the appropriate semantic.

### 3. Sudden offline → all cached content still works (high)

If the network drops mid-session — and especially across sessions —
everything that was previously cached must remain fully usable. No
"loading" spinner that never resolves, no error toast for content the
user has already downloaded.

For RealHome: cached worlds load from IDB and play. Cached thumbnails
appear. Menu populates from IDB. The only things that fail are
operations that genuinely need network (new download, upload, sign
in).

### 4. In-app upload defaults to push-to-cloud (medium-high)

When the user adds a file from the app (drag-drop, file-picker), it
should end up on the cloud automatically. Reason: the typical user
case is "I found / made something nice on my Quest / phone, I want it
on my other devices without going back to my desktop."

The push is opportunistic — if no account, if offline, if the upload
fails — the intent is preserved (`pendingUpload=true`) and retried on
the next opportunity (sign-in, online event, app boot). It's never
silently abandoned.

The opposite default ("save locally, click a separate button to
push") creates the wrong mental model. Users forget to push and lose
their work when they switch devices.

### 5. Users edit the cloud directly (medium)

Users will reorganize on the cloud side outside the app:
- Rename files
- Delete files
- Modify files
- (Some projects) reorganize into subfolders

The app must handle gracefully:
- A rename on the cloud → next sync sees a "new" item (since the
  remote id may change or not depending on the cloud); the
  corresponding local cache may become orphaned. Don't crash. Don't
  silently delete the local cache.
- A delete on the cloud → local cache becomes a "ghost" (was on
  cloud, isn't anymore). UI should show this state. **Do not**
  auto-delete the local cache (constraint #2).
- A modification on the cloud → next sync detects via mtime/etag,
  pulls new content (constraint #6).

### 6. Cache freshness via mtime/etag (medium)

The app needs a cheap signal for "has this content changed?" so it
knows when to re-download. Standard mechanism: store the
mtime/etag/cTag the cloud returned at last sync; conditional GET with
`If-None-Match` / `If-Modified-Since` on subsequent reads.

304 → cache is fresh, no download needed.
200 → new bytes, update local cache.

This is what allows opening the menu to be fast even with many cached
worlds (the conditional GETs are cheap on 304).

### 7. Long-offline → reconnect with many queued uploads needs a strategy (low)

Edge case: user is offline (or signed-out) for a long time. Adds many
files to the app. Eventually reconnects.

The system must do something coherent. Options:
- Auto-push each one in order; collisions resolved per-item
- **Surface duplicates as a local error**: "you have N files that
  collide with cloud, please rename them before they can upload"
- Combination: push the non-colliding ones automatically, surface
  collisions for user attention

User preference: surface collisions, require rename before upload.
This is more friction but prevents accidental overwrite of cloud data
the user may have forgotten was there.

### 8. Minimize duplicates as an aesthetic goal (lowest)

Even when conflicts are correctly resolved, the result can pollute
the cloud / cache with multiple copies (e.g., auto-suffix uploads:
`house.glb`, `house (Quest 2026-05-22).glb`, `house (PC).glb`, …).
The user has to clean up later.

Design should:
- Prefer asking the user to disambiguate over silent auto-suffix
- Surface duplicates in the UI (badge / counter)
- Provide a "resolve duplicates" helper for cleanup

This is the *last* priority — it can be sacrificed when it conflicts
with #2 (no data loss). Better to have a duplicate than to lose
something.

## Variability across sibling projects

Different projects in the family touch different combinations of
these orthogonal axes. **What's common is the priority order above.**
What differs is which features apply.

### Axis A: Data source topology

- **Single personal cloud + maybe public sources** — RealHome (OneDrive
  + future GitHub public-source). Local cache is for offline; cloud is
  the authoritative copy for personal data.
- **Single personal cloud, no public sources** — WebXiaoHeiWu,
  JustReadPapers, Background Audio. Cloud is the only remote source.

### Axis B: Local edit-and-upload patterns

- **Heavy local editing with frequent push** — WebXiaoHeiWu (note-
  taking, every few seconds of typing is dirty). Needs dirty-state
  tracking, sibling-on-412, atomic conditional writes.
- **No in-app editing, only ingest + render** — RealHome (artist
  exports glb in Blender), JustReadPapers (PDFs already exist).
  Constraint #4's "upload" means "ingest from local disk", not "save
  user edits". Much simpler.

### Axis C: Cloud-side subfolder organization

- **Flat AppFolder** — RealHome, WebXiaoHeiWu, JustReadPapers.
  Everything at the AppFolder root.
- **Subfolder taxonomy** — Background Audio (playlists / folders),
  JustReadBooks (categories / shelves). Users organize hierarchically.

For projects on this axis: provider API must support folder
operations (create, move-between, list-recursive), `Sources` table or
schema must encode the hierarchy, UI must let users navigate.

### Axis D: Multi-cloud (future, not v1 for any project)

- All projects currently: **at most one personal cloud account**
- Future: multiple cloud providers (Dropbox / Google Drive / iCloud)
  AND multiple accounts per provider AND NAS support
- One account logged in at a time (no concurrent multi-account)
- Account-switch options:
  - **discard-all-rebuild** — cascade delete current cache, sign in,
    re-sync. Very dangerous: requires serious consent surface.
  - **auto-migrate-upload** — push current cached content to new
    account before clearing. Minimizes duplicates but slow.

Out of scope for current implementations; reserved here so data model
doesn't paint into a corner.

## Which axes apply to RealHome

| Axis | RealHome status |
|---|---|
| A. Data sources | Single OneDrive cloud + future GitHub public sources |
| B. Local edits | No (artist edits in Blender, app only ingests). Constraint #4 is "ingest from disk → push to cloud" |
| C. Subfolders | No — flat AppFolder |
| D. Multi-cloud | Out of scope v1 |

So RealHome's sync layer is the *simplest* combination: single cloud,
no in-app edits, flat. The cross-project constraints (1-8) still apply.

## What this doc is for

- **Design check**: when proposing a new feature or refactor, walk
  through 1-8 and confirm nothing is violated. If priorities conflict,
  the lower-numbered constraint wins.
- **Code review check**: any code path that might delete, overwrite,
  or silently fail must be auditable against 1-3.
- **Cross-project alignment**: when porting a pattern from one sibling
  to another, refer to the variability matrix to see what's relevant.

## Not in this doc (intentionally)

- **Schema** — see [docs/data-model.md](data-model.md) *(to be written)*.
- **Specific implementation rules** (atomic writes, etag pinning,
  tombstone semantics) — derived from these constraints; live in
  data-model.md.
- **UI flows for specific operations** — see
  [docs/user-flows.md](user-flows.md).
- **Per-provider quirks** (Graph API patterns, MSAL traps) — see
  [docs/msal-onedrive-patterns.md](msal-onedrive-patterns.md).
- **Three-pattern taxonomy** (writable-doc / opaque-blob /
  read-only-asset) — see [docs/sync-strategies.md](sync-strategies.md)
  for the orientation lens.

## One-sentence summary

> Offline-first, no silent destruction, cache works during outages,
> uploads push by default, gracefully handle cloud-side changes, etag-
> based freshness, handle long-offline-reconnect coherently, and
> minimize duplicates only after all of the above.
