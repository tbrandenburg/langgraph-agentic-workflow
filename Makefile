.PHONY: install run stop test lint build clean dev e2e

install:
	pnpm install

build:
	pnpm build

lint:
	pnpm lint

test:
	pnpm test

clean:
	find . -type d -name dist -not -path '*/node_modules/*' -prune -exec rm -rf {} +
	find . -type f -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete

run:
	@echo "not yet implemented"

stop:
	@echo "not yet implemented"

dev:
	@echo "not yet implemented"

e2e:
	@echo "not yet implemented"
