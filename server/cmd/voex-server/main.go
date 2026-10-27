package main

import (
	"fmt"
	"log"
	"os"
	"voex-server/internal/app"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Fatal(err)
	}
}

func run(args []string) error {
	command := "serve"
	if len(args) > 1 {
		return fmt.Errorf("usage: voex-server [serve]")
	}
	if len(args) == 1 {
		command = args[0]
	}
	switch command {
	case "serve":
		return app.Run()
	default:
		return fmt.Errorf("unknown command %q; usage: voex-server [serve]", command)
	}
}
