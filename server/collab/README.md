# Voex collaboration runtime

This private Node service runs alongside Go. Go owns authorization and MySQL; Node owns live Yjs documents and the shared editor schema. Node does not connect to MySQL.

## Build

Install frontend dependencies from its lockfile first, then run:

    cd /path/to/voex-monorepo/server/collab
    pnpm install --frozen-lockfile --ignore-scripts
    pnpm type-check
    pnpm build
    node --env-file=.env dist/server.js

dist/server.js is a self-contained ESM bundle. Production needs Node 22.18+ and a package.json declaring type: module; no runtime node_modules are needed. dist/editor-schema.js contains the standalone codec used by the service. VOEX_COLLAB_SCHEMA_SOURCE overrides the build-time default web/packages/editor-schema/src/index.ts, resolved relative to this repository rather than the current working directory.

## Runtime configuration

| Variable | Value |
|---|---|
| VOEX_COLLAB_HOST | 127.0.0.1 by default |
| VOEX_COLLAB_PORT | 8091 by default |
| VOEX_COLLAB_API_URL | http://127.0.0.1:8090 by default |
| VOEX_COLLAB_SECRET_FILE | Required private secret file shared with Go |
| VOEX_COLLAB_ORIGINS | Required comma-separated exact browser origins |

The secret needs at least 32 bytes. Missing secrets or origins fail startup. Never place authentication or sharing tokens in URLs. Hocuspocus authentication messages carry a JSON envelope with ticket and client_id (the local Y.Doc client ID). Node verifies the ticket through Go and binds presence to that explicit local ID. Legacy raw tickets can still sync document content, but cannot claim presence IDs. Provider/server are pinned to 3.4.4 and Yjs to 13.6.33.

## Durability protocol

WebSocket endpoint: /api/collab/ws. One document per socket. Origin, authentication, frame bounds, write permission and shared schema are checked before updates are broadcast.

A client sends a stateless JSON object:

    {"type":"flush","request_id":"unique-id","epoch":1,"state_vector":"base64"}

After Go confirms durable storage, the response includes:

    {"type":"persisted","request_id":"unique-id","epoch":1,"collab_seq":3,"revision":5,"state_vector":"base64"}

Only the matching request ID confirms the local update generation captured when that flush was sent. State vectors do not include deletion sets. Initial synced events and ordinary persisted broadcasts cannot clear a client's local dirty state.

Other messages: persistence-error, permission, need-reauth, room-closed, document-event (metadata or attachments). Renew tickets with provider.sendToken(). When epoch changes, clients retain unsaved content for explicit recovery and create a fresh Y.Doc.

Go internal POST endpoints: /internal/collab/authorize, /load, /initialize, /commit. X-Collab-Secret protects requests. Commits include all pending writer authorization IDs and atomically persist Yjs state and Markdown projection through an epoch/sequence CAS. Unknown outcomes retry the same idempotency key. Definite authorization rejection removes only the server cache; clients retain their local documents and must obtain fresh authority before resending.

Node internal POST endpoints, also secret-protected:

- /internal/collab/prepare: pause a room, flush older edits, verify reviewed base and prepare isolated new-epoch state.
- /internal/collab/commit: after Go commits, close the old epoch and allow fresh connections.
- /internal/collab/abort: reload authoritative storage before releasing a paused room.
- /internal/collab/events: process Go's durable permission/deletion/metadata/attachment/document events.
- /internal/collab/drain: flush all rooms and stop accepting edits before maintenance.

A prepared operation expires after 30 seconds. Go's transaction deadline ends before that lease. Expiry discards the old room and stage; the next authorized connection loads the authoritative committed or rolled-back state. It never resumes writes against the old cached document.

GET /health/live checks the process. GET /health/ready additionally rejects while draining. Both report runtime and schema versions; neither calls Go readiness.

## Shared representation

Browser and server use the same source for attachments, emoji, LaTeX, Mermaid, text colors, image layout, card lists, table parsing and paragraph serialization. The headless codec runs schema and Remark plugins without constructing an EditorView or browser DOM; HTML image parsing uses parse5.

Canonical card models, emoji data and table utilities remain in the frontend source and are bundled at build time. Runtime access to frontend files is unnecessary. Yjs retains attributes such as column widths even if Markdown does not represent them.

Legacy Markdown initializes once via Go CAS. Conversion failure leaves original content untouched. Reviewed whole-document AI replacement commits a fresh Yjs state and epoch+1, isolating late updates from old clients.

Limits: Markdown 2 MiB, Yjs state 16 MiB, WebSocket frame 20 MiB, internal JSON 26 MiB. Persistence debounce is 1 second with a maximum of 5 seconds. Explicit flush persists immediately. ACL is rechecked every 5 seconds and immediately on Go outbox events.

Presence messages are sanitized before application. Hocuspocus 3 forwards cached remote states and peer removals during reconnect; those entries are ignored, not adopted as the sender. Same-user local-ID handoff removes the ID from the old socket cleanup set. A different active user's ID cannot be claimed. Node consumes the original awareness entry count after applying accepted data so the default receiver cannot replay ignored entries.

Internal grant expiry/restart is recoverable: 401 sends room-closed with authentication-expired before closing, never a preceding fatal persistence-error. Initial and renewed authentication use machine reasons authentication-expired (401) and service-unavailable (network/5xx). Clients keep the same Y.Doc and obtain a new ticket. A fresh public ticket API 401/403 remains a real session/permission rejection. Stale room callbacks cannot invalidate a newly loaded room.
