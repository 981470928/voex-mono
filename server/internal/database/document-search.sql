-- Explicit additive migration; existing databases get the full-text search index here.
-- Requires MySQL ngram parser (built in since 5.7.6) with ngram_token_size=2 (the default),
-- which aligns two-character CJK terms with the minimum search length.
-- 显式执行增量迁移，为现有数据库添加全文搜索索引。
-- 需要 MySQL ngram parser（自 5.7.6 起内置），且 ngram_token_size=2（默认值），
-- 使两个字符的中日韩检索词与最小搜索长度一致。
SET @voex_document_search_ddl = IF(
 EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='documents' AND INDEX_NAME='ft_documents_search'),
 'SELECT 1',
 'ALTER TABLE documents ADD FULLTEXT INDEX ft_documents_search (file_name, file_content) WITH PARSER ngram'
);
PREPARE voex_document_search_statement FROM @voex_document_search_ddl;
EXECUTE voex_document_search_statement;
DEALLOCATE PREPARE voex_document_search_statement;
