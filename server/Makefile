GOLINES_VERSION := v0.16.0
GOLINES := $(CURDIR)/bin/golines

.PHONY: check fmt fmt-check
check: fmt-check
	go vet ./...
	go mod verify
$(GOLINES): Makefile
	mkdir -p bin
	GOBIN="$(CURDIR)/bin" GOTOOLCHAIN=local GOWORK=off \
		go install github.com/golangci/golines@$(GOLINES_VERSION)
fmt: $(GOLINES)
	find main.go internal scripts -type f -name '*.go' ! -name '*_test.go' -print0 | \
		xargs -0 "$(GOLINES)" -m 100 -t 4 --base-formatter=gofmt \
			--no-reformat-tags --no-ignore-generated -w
	$(MAKE) fmt-check
fmt-check:
	go run ./scripts/check-go-format.go
