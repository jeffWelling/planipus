.PHONY: archive-note build test verify linux-amd64

archive-note:
	@printf '%s\n' 'Archived spike only: not a Planipus foundation, product build, or release artifact.'

build:
	$(MAKE) archive-note

test:
	go test ./...

verify:
	go test -race ./...
	go vet ./...

linux-amd64:
	$(MAKE) archive-note
