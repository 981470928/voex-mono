.PHONY: build check fmt run
build:
	mkdir -p bin
	go build -trimpath -o bin/voex-server.new ./cmd/voex-server
	mv bin/voex-server.new bin/voex-server
check:
	go vet ./...
	go mod verify
fmt:
	gofmt -w cmd internal
run: build
	./bin/voex-server
