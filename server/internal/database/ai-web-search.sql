-- Explicit additive migration; existing model configurations default to search disabled.
-- 显式执行增量迁移；现有模型配置默认禁用搜索。
SET @voex_ai_web_search_ddl = IF(
 EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_models' AND COLUMN_NAME='web_search_enabled'),
 'SELECT 1',
 'ALTER TABLE ai_models ADD COLUMN web_search_enabled boolean NOT NULL DEFAULT false AFTER multimodal_enabled'
);
PREPARE voex_ai_web_search_statement FROM @voex_ai_web_search_ddl;
EXECUTE voex_ai_web_search_statement;
DEALLOCATE PREPARE voex_ai_web_search_statement;
