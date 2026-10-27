-- Current schema for a new, empty MySQL 8 database. Import manually before starting the server.
-- Existing databases are managed explicitly; this script does not update existing tables.

CREATE TABLE `users` (
  `id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account` varbinary(256) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `name` varchar(64) NOT NULL,
  `avator` varchar(255) NOT NULL DEFAULT '',
  `email` varchar(254) NOT NULL DEFAULT '',
  `phone` varchar(32) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `user_config` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `account` (`account`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workspace_state` (
  `id` tinyint NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `assets` (
  `id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creator_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `directory` varchar(255) NOT NULL,
  `storage_name` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `mime` varchar(128) NOT NULL,
  `size` bigint unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_asset_creator` (`creator_id`),
  CONSTRAINT `assets_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `auth_sessions` (
  `id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `refresh_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `refresh_hash` (`refresh_hash`),
  KEY `idx_session_expiry` (`expires_at`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `auth_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `files` (
  `id` int NOT NULL AUTO_INCREMENT,
  `file_key` varchar(64) NOT NULL,
  `hash` varchar(128) NOT NULL,
  `name` varchar(255) NOT NULL,
  `mime` varchar(128) NOT NULL,
  `size` bigint NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `creator_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `privileges` json NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_file_key` (`file_key`),
  KEY `idx_hash` (`hash`),
  KEY `idx_files_creator` (`creator_id`),
  CONSTRAINT `fk_files_creator` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `teams` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_key` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `team_code` char(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` varchar(128) NOT NULL,
  `kind` enum('personal','standard') NOT NULL,
  `owner_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `personal_owner_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `privileges` json NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `team_key` (`team_key`),
  UNIQUE KEY `team_code` (`team_code`),
  UNIQUE KEY `personal_owner_id` (`personal_owner_id`),
  KEY `owner_id` (`owner_id`),
  CONSTRAINT `teams_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `teams_ibfk_2` FOREIGN KEY (`personal_owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `teams_chk_1` CHECK ((((`kind` = _utf8mb4'personal') and (`personal_owner_id` is not null) and (`personal_owner_id` = `owner_id`)) or ((`kind` = _utf8mb4'standard') and (`personal_owner_id` is null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE ai_models (
  id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name varchar(128) NOT NULL,
  protocol varchar(16) NOT NULL,
  base_url varchar(2048) NOT NULL,
  model varchar(255) NOT NULL,
  key_cipher text NOT NULL,
  temperature double DEFAULT NULL,
  max_tokens int unsigned NOT NULL DEFAULT 4096,
  token_parameter varchar(24) NOT NULL DEFAULT 'max_completion_tokens',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_ai_model_user (user_id),
  CONSTRAINT fk_ai_model_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ai_review_applications (
  review_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json json NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, review_id),
  CONSTRAINT fk_ai_review_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `projects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_key` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `creator_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `team_id` int DEFAULT NULL,
  `privileges` json NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `project_key` (`project_key`),
  KEY `idx_projects_order` (`created_at`,`id`),
  KEY `idx_projects_creator` (`creator_id`),
  KEY `idx_projects_team` (`team_id`),
  CONSTRAINT `fk_projects_creator` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_projects_team` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `team_invites` (
  `id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `team_id` int NOT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `team_id` (`team_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `team_invites_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_invites_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `team_join_requests` (
  `id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `team_id` int NOT NULL,
  `user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `message` varchar(1000) NOT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reviewed_by` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_team_request` (`team_id`,`user_id`),
  KEY `user_id` (`user_id`),
  KEY `reviewed_by` (`reviewed_by`),
  CONSTRAINT `team_join_requests_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_join_requests_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `team_join_requests_ibfk_3` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `team_members` (
  `team_id` int NOT NULL,
  `user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `role` enum('admin','member') NOT NULL DEFAULT 'member',
  `joined_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`team_id`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `team_members_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_members_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `folders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `folder_key` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `project_id` int NOT NULL,
  `parent_id` int DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `privileges` json NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `deleted_by` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `expires_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `folder_key` (`folder_key`),
  UNIQUE KEY `uq_folders_project_id` (`project_id`,`id`),
  KEY `idx_folders_parent` (`project_id`,`parent_id`,`created_at`,`id`),
  KEY `idx_folders_order` (`project_id`,`created_at`,`id`),
  CONSTRAINT `fk_folders_parent` FOREIGN KEY (`project_id`, `parent_id`) REFERENCES `folders` (`project_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_folders_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_folders_flat` CHECK ((`parent_id` is null)),
  KEY `idx_folders_trash_expiry` (`expires_at`, `id`),
  KEY `idx_folders_project_deleted` (`project_id`, `deleted_at`, `created_at`, `id`),
  KEY `idx_folders_deleted_by` (`deleted_by`),
  CONSTRAINT `fk_folders_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `project_members` (
  `project_id` int NOT NULL,
  `user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`project_id`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `project_members_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `project_members_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `file_key` varchar(64) NOT NULL,
  `file_name` varchar(255) NOT NULL DEFAULT 'untitled',
  `file_content` longtext,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `folder_id` int NOT NULL,
  `creator_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `privileges` json NOT NULL,
  `revision` int unsigned NOT NULL DEFAULT '1',
  `updated_by` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `updated_by_anonymous` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_at` datetime(6) DEFAULT NULL,
  `deleted_by` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `expires_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `file_key` (`file_key`),
  KEY `idx_file_key` (`file_key`),
  KEY `idx_documents_folder` (`folder_id`,`created_at`,`id`),
  KEY `idx_documents_creator` (`creator_id`),
  CONSTRAINT `fk_documents_creator` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_documents_folder` FOREIGN KEY (`folder_id`) REFERENCES `folders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  KEY `idx_documents_updated_by` (`updated_by`),
  KEY `idx_documents_trash_expiry` (`expires_at`, `id`),
  KEY `idx_documents_folder_deleted` (`folder_id`, `deleted_at`, `created_at`, `id`),
  KEY `idx_documents_deleted_by` (`deleted_by`),
  CONSTRAINT `fk_documents_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_documents_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `document_sharing` (
 `document_id` int NOT NULL PRIMARY KEY,
 `read_enabled` boolean NOT NULL DEFAULT false,
 `edit_enabled` boolean NOT NULL DEFAULT false,
 CONSTRAINT `fk_document_sharing_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `document_access` (
  `document_id` int NOT NULL,
  `user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `permission` enum('read','edit') NOT NULL,
  `granted_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`document_id`,`user_id`),
  KEY `idx_document_access_user` (`user_id`),
  CONSTRAINT `fk_document_access_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_document_access_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `file_shares` (
  `id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document_id` int NOT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `permission` enum('read','edit') NOT NULL,
  `created_by` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `document_id` (`document_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `file_shares_ibfk_1` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `file_shares_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE ai_conversation_sessions (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_id int NOT NULL,
  session_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title varchar(80) NOT NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_session (user_id, document_id, session_id),
  KEY idx_ai_sessions (user_id, document_id, id),
  CONSTRAINT fk_ai_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_session_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `recent_files` (
  `user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document_id` int NOT NULL,
  `share_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `file_name` varchar(255) NOT NULL,
  `viewed_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`,`document_id`),
  KEY `idx_recent_files_order` (`user_id`,`viewed_at`,`document_id`),
  KEY `idx_recent_files_document` (`document_id`),
  KEY `idx_recent_files_share` (`share_id`),
  CONSTRAINT `fk_recent_files_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_recent_files_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_recent_files_share` FOREIGN KEY (`share_id`) REFERENCES `file_shares` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE ai_conversation_turns (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_id int NOT NULL,
  session_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'default',
  turn_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  model_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  prompt longtext NOT NULL,
  response longtext NOT NULL,
  activity json NOT NULL,
  error text NOT NULL,
  review_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  review_json json DEFAULT NULL,
  finish_hash char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at datetime(3) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_turn (user_id, turn_id),
  UNIQUE KEY uq_ai_turn_review (user_id, review_id),
  KEY idx_ai_conversation (user_id, document_id, id),
  CONSTRAINT fk_ai_turn_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_turn_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  KEY idx_ai_session_turns (user_id, document_id, session_id, id),
  CONSTRAINT fk_ai_turn_session FOREIGN KEY (user_id, document_id, session_id)
    REFERENCES ai_conversation_sessions (user_id, document_id, session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO workspace_state (id) VALUES (1);

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
