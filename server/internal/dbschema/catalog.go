package dbschema

// CatalogTablesTable 定义表名与物理字段。
type CatalogTablesTable struct {
	Name    string
	Columns struct {
		TABLE_NAME   string
		TABLE_SCHEMA string
		TABLE_TYPE   string
	}
}

var CatalogTables = func() CatalogTablesTable {
	var table CatalogTablesTable
	table.Name = "information_schema.TABLES"
	table.Columns.TABLE_NAME = "TABLE_NAME"
	table.Columns.TABLE_SCHEMA = "TABLE_SCHEMA"
	table.Columns.TABLE_TYPE = "TABLE_TYPE"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (CatalogTablesTable) As(alias string) CatalogTablesTable {
	table := CatalogTables
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.TABLE_NAME = alias + "." + table.Columns.TABLE_NAME
	table.Columns.TABLE_SCHEMA = alias + "." + table.Columns.TABLE_SCHEMA
	table.Columns.TABLE_TYPE = alias + "." + table.Columns.TABLE_TYPE
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (CatalogTablesTable) Qualified() CatalogTablesTable {
	table := CatalogTables.As(CatalogTables.Name)
	table.Name = CatalogTables.Name
	return table
}

// CatalogColumnsTable 定义表名与物理字段。
type CatalogColumnsTable struct {
	Name    string
	Columns struct {
		TABLE_NAME   string
		TABLE_SCHEMA string
		COLUMN_NAME  string
	}
}

var CatalogColumns = func() CatalogColumnsTable {
	var table CatalogColumnsTable
	table.Name = "information_schema.COLUMNS"
	table.Columns.TABLE_NAME = "TABLE_NAME"
	table.Columns.TABLE_SCHEMA = "TABLE_SCHEMA"
	table.Columns.COLUMN_NAME = "COLUMN_NAME"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (CatalogColumnsTable) As(alias string) CatalogColumnsTable {
	table := CatalogColumns
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.TABLE_NAME = alias + "." + table.Columns.TABLE_NAME
	table.Columns.TABLE_SCHEMA = alias + "." + table.Columns.TABLE_SCHEMA
	table.Columns.COLUMN_NAME = alias + "." + table.Columns.COLUMN_NAME
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (CatalogColumnsTable) Qualified() CatalogColumnsTable {
	table := CatalogColumns.As(CatalogColumns.Name)
	table.Name = CatalogColumns.Name
	return table
}
