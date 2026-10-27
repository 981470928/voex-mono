-- Explicit migration for existing databases. Run once before enabling collaboration.
ALTER TABLE documents ADD COLUMN content_mode enum('legacy','collab') NOT NULL DEFAULT 'legacy';
CREATE TABLE document_collaboration (
 document_id int NOT NULL,
 state longblob NOT NULL,
 schema_version varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 epoch bigint NOT NULL DEFAULT 1,
 collab_seq bigint NOT NULL DEFAULT 1,
 updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(document_id),
 CONSTRAINT fk_collab_document FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE collaboration_commits (
 document_id int NOT NULL,
 commit_key varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload_hash char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 collab_seq bigint NOT NULL,
 revision bigint NOT NULL,
 created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(document_id,commit_key),
 KEY idx_collab_commit_created(created_at),
 CONSTRAINT fk_collab_commit_document FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE collaboration_outbox (
 id bigint NOT NULL AUTO_INCREMENT,
 kind varchar(32) NOT NULL,
 file_key varchar(64) NOT NULL DEFAULT '',
 created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(id)
) ENGINE=InnoDB;
