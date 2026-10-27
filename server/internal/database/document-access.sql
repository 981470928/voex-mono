-- Apply explicitly before deploying account-bound file access.
CREATE TABLE IF NOT EXISTS `document_access` (
  `document_id` int NOT NULL,
  `user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `permission` enum('read','edit') NOT NULL,
  `granted_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`document_id`,`user_id`),
  KEY `idx_document_access_user` (`user_id`),
  CONSTRAINT `fk_document_access_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_document_access_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Keep prior verified visits, without downgrading an existing grant on rerun.
INSERT INTO document_access (document_id,user_id,permission,granted_at)
SELECT r.document_id,r.user_id,s.permission,r.viewed_at FROM recent_files r
JOIN file_shares s ON s.id=r.share_id AND s.document_id=r.document_id
JOIN documents d ON d.id=r.document_id
JOIN folders f ON f.id=d.folder_id
WHERE s.revoked_at IS NULL AND d.deleted_at IS NULL AND f.deleted_at IS NULL
ON DUPLICATE KEY UPDATE document_access.permission=IF(document_access.permission='edit' OR s.permission='edit','edit','read');
