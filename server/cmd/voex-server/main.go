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
		return fmt.Errorf("usage: voex-server [serve|init-db|check-config]")
	}
	if len(args) == 1 {
		command = args[0]
	}
	switch command {
	case "serve":
		return app.Run()
	case "init-db":
		if err := app.InitializeDatabase(); err != nil {
			return err
		}
		fmt.Println("Missing database and tables initialized; configuration checks passed.")
		return nil
	case "check-config":
		if err := app.CheckConfig(); err != nil {
			return err
		}
		fmt.Println("Configuration, storage, secrets and database tables are ready.")
		return nil
	default:
		return fmt.Errorf("unknown command %q; usage: voex-server [serve|init-db|check-config]", command)
	}
}
