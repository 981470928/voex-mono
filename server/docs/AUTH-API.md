Current team authorization supersedes creator-only isolation; see TEAM-API.md.

# Voex authentication (experimental)

API root: /api. The Go service listens on 127.0.0.1:8090 behind Nginx.

POST /auth/account-availability {account} -> {available}
POST /auth/register {account,password,name,email?,phone?} -> {accessToken,expiresIn:900,user}
POST /auth/login {account,password} -> same session
POST /auth/refresh with HttpOnly voex_refresh cookie -> same session
POST /auth/logout with refresh cookie or Bearer access token -> {success:true}
GET /auth/me -> {id,account,name,avator,email,phone}
PATCH /auth/me {name?,email?,phone?,avator?} -> user
GET/HEAD /auth/me/config -> {userConfig:{...}}
PATCH /auth/me/config {userConfig:{...}} -> {userConfig:{...}} (non-empty object; shallow assign)
POST /assets/upload multipart file,path -> {id,name,url,path,size,mime,creator}
GET /assets/:id -> owned asset, or a current teammate's active avatar; cookie/Bearer required

User configuration: [USER-CONFIG-API.md](USER-CONFIG-API.md). Its schema belongs to the frontend; supplied top-level keys overwrite existing values, omitted keys remain, and nested objects are replaced as a whole. Null is stored rather than deleting a key.

Accounts: 8-64 Unicode codepoints, exact bytes, no trimming or case folding.
Passwords: 10-128 Unicode codepoints, Argon2id (19456 KiB, t=2, p=1).
Name: required 1-64 trimmed codepoints. Email and phone optional, unverified.
JWT: HS256, fixed issuer/audience, 15 minutes. /home/server/.secrets/jwt-key is 0600.
Refresh: random 32 bytes, database stores SHA256, fixed 14 days, revocable, no rotation.
Every request validates database session as well as JWT; logout revokes immediately.
Cookie: HttpOnly, SameSite=Strict, Secure on HTTPS; current listener is HTTP only.

Project/document/attachment access follows team and project permissions described in TEAM-API.md. Creator name/avator reflect the current profile.

Upload storage: private R2 objects at assets/{path}/{server-generated-uuid}; new images retain their original bytes and actual MIME type. Existing converted .webp objects remain readable. API URLs and authorization remain unchanged.
Each path segment: [A-Za-z0-9_-]{1,64}, relative path <=255 chars. No dots, backslash or absolute paths.
General files <=200 MiB, avator <=5 MiB, thumbnail <=20 MiB. Images must be static JPEG/PNG/WebP <=20M pixels.
Images are checked for supported format, dimensions, static content and complete decoding using Go; no libvips dependency, resizing, re-encoding or metadata removal. PNG/JPEG/WebP assets and shared creator avatars are served inline with their actual MIME type.
Document attachments use R2 keys attachments/{sha256}. Shared hash objects are retained after record deletion; no scheduled orphan cleanup is configured. Existing local files must be migrated before switching; see README.md. Local temporary files are used only to stage uploads for validation and R2 transfer.

Implementation: internal/handler/auth.go and internal/handler/storage.go, with service/repository counterparts. Configuration, build, deployment and verification are documented in README.md.
