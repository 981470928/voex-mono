-- Explicit additive MySQL 8 migration for query indexes. Run against the intended database.
-- Idempotent by index name; retains all existing indexes and business data.
-- Fail rather than fall back to a table copy or a DDL operation that blocks DML.
-- Brief metadata locks are still needed; stop waiting after five seconds.
-- 用于查询索引的显式 MySQL 8 增量迁移；应在目标数据库中执行。
-- 按索引名保证幂等，保留全部现有索引和业务数据。
-- 不回退到复制表或阻塞 DML 的 DDL 操作，无法满足条件时直接失败。
-- 仍需短暂获取元数据锁；等待超过五秒即停止。
SET @voex_previous_lock_wait_timeout = @@SESSION.lock_wait_timeout;
SET SESSION lock_wait_timeout = 5;

SET @voex_query_index_ddl = IF(
 EXISTS(SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='files' AND INDEX_NAME='idx_files_key_hash'),
 'DO 0',
 'ALTER TABLE `files` ADD INDEX `idx_files_key_hash` (`file_key`, `hash`), ALGORITHM=INPLACE, LOCK=NONE'
);
PREPARE voex_query_index_statement FROM @voex_query_index_ddl;
EXECUTE voex_query_index_statement;
DEALLOCATE PREPARE voex_query_index_statement;

SET @voex_query_index_ddl = IF(
 EXISTS(SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='projects' AND INDEX_NAME='idx_projects_team_order'),
 'DO 0',
 'ALTER TABLE `projects` ADD INDEX `idx_projects_team_order` (`team_id`, `created_at`, `id`), ALGORITHM=INPLACE, LOCK=NONE'
);
PREPARE voex_query_index_statement FROM @voex_query_index_ddl;
EXECUTE voex_query_index_statement;
DEALLOCATE PREPARE voex_query_index_statement;

SET @voex_query_index_ddl = IF(
 EXISTS(SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_models' AND INDEX_NAME='idx_ai_model_user_order'),
 'DO 0',
 'ALTER TABLE `ai_models` ADD INDEX `idx_ai_model_user_order` (`user_id`, `created_at`, `id`), ALGORITHM=INPLACE, LOCK=NONE'
);
PREPARE voex_query_index_statement FROM @voex_query_index_ddl;
EXECUTE voex_query_index_statement;
DEALLOCATE PREPARE voex_query_index_statement;

SET SESSION lock_wait_timeout = @voex_previous_lock_wait_timeout;
