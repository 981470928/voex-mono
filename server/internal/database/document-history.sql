-- Explicit migration for existing databases. Run once before enabling document history.
-- No baseline backfill: version history starts when this migration is deployed.
-- 用于现有数据库的显式迁移；启用文档历史前执行一次。
-- 不回填基线版本；版本历史从部署此迁移时开始记录。
CREATE TABLE document_versions (
 id bigint NOT NULL AUTO_INCREMENT,
 document_id int NOT NULL,
 revision bigint NOT NULL,
 kind enum('auto','manual','backup') NOT NULL DEFAULT 'auto',
 label varchar(255) NOT NULL DEFAULT '',
 content longtext NOT NULL,
 content_hash char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 schema_version varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_by char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
 created_by_anonymous tinyint(1) NOT NULL DEFAULT '0',
 created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(id),
 KEY idx_document_versions_doc (document_id, id),
 KEY idx_document_versions_cleanup (kind, created_at),
 KEY idx_document_versions_creator (created_by),
 CONSTRAINT fk_document_versions_document FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
 CONSTRAINT fk_document_versions_creator FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
