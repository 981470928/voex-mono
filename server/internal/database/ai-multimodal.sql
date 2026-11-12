-- Run explicitly against the configured MySQL 8 database before deploying the new API.
-- Existing models remain text-only. Existing turns have no attachments.
-- DDL is intentionally not run by the application and does not rewrite existing conversation data.
-- 部署新 API 前，需对配置的 MySQL 8 数据库显式执行此脚本。
-- 现有模型仍仅支持文本，现有对话轮次不含附件。
-- 应用不会自动执行 DDL，此脚本也不会改写现有对话数据。
SET @voex_ai_model_multimodal_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_models'
      AND COLUMN_NAME = 'multimodal_enabled'
  ),
  'SELECT 1',
  'ALTER TABLE ai_models ADD COLUMN multimodal_enabled boolean NOT NULL DEFAULT false AFTER token_parameter'
);
PREPARE voex_ai_multimodal_statement FROM @voex_ai_model_multimodal_ddl;
EXECUTE voex_ai_multimodal_statement;
DEALLOCATE PREPARE voex_ai_multimodal_statement;

SET @voex_ai_turn_attachments_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_conversation_turns'
      AND COLUMN_NAME = 'attachments'
  ),
  'SELECT 1',
  'ALTER TABLE ai_conversation_turns ADD COLUMN attachments json DEFAULT NULL AFTER prompt'
);
PREPARE voex_ai_multimodal_statement FROM @voex_ai_turn_attachments_ddl;
EXECUTE voex_ai_multimodal_statement;
DEALLOCATE PREPARE voex_ai_multimodal_statement;
