// Command check-go-format checks gofmt output and a strict 100-column limit.
package main

import (
	"bytes"
	"fmt"
	"go/format"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const (
	maxColumns = 100
	tabColumns = 4
)

func main() {
	roots := os.Args[1:]
	if len(roots) == 0 {
		roots = []string{"cmd", "internal", "scripts"}
	}
	files, failures := 0, 0
	for _, root := range roots {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				switch entry.Name() {
				case ".git", "vendor", "node_modules", "bin":
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(entry.Name(), ".go") {
				return nil
			}
			source, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			files++
			formatted, err := format.Source(source)
			if err != nil {
				return fmt.Errorf("%s: %w", path, err)
			}
			if !bytes.Equal(source, formatted) {
				fmt.Fprintf(os.Stderr, "%s: gofmt required\n", path)
				failures++
			}
			for index, line := range strings.Split(string(source), "\n") {
				columns := 0
				for _, character := range line {
					if character == '\t' {
						columns += tabColumns - columns%tabColumns
					} else {
						columns++
					}
				}
				if columns > maxColumns {
					fmt.Fprintf(os.Stderr, "%s:%d: %d columns (maximum %d)\n",
						path, index+1, columns, maxColumns)
					failures++
				}
			}
			return nil
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			failures++
		}
	}
	if failures != 0 {
		os.Exit(1)
	}
	fmt.Printf("Go format check passed: %d files, maximum %d columns, tab stops %d.\n",
		files, maxColumns, tabColumns)
}
