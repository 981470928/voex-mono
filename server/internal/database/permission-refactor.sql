CREATE TABLE IF NOT EXISTS `document_sharing` (
 `document_id` int NOT NULL PRIMARY KEY,
 `read_enabled` boolean NOT NULL DEFAULT false,
 `edit_enabled` boolean NOT NULL DEFAULT false,
 CONSTRAINT `fk_document_sharing_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO document_sharing (document_id,read_enabled,edit_enabled)
SELECT document_id,MAX(permission='read'),MAX(permission='edit') FROM file_shares WHERE revoked_at IS NULL GROUP BY document_id;
UPDATE projects SET privileges=JSON_SET(privileges,'$.mode','restricted') WHERE JSON_UNQUOTE(JSON_EXTRACT(privileges,'$.mode'))='inherit';
