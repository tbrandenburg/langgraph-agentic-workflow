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
	@if [ -f .run-api.pid ] && kill -0 "$$(cat .run-api.pid)" 2>/dev/null; then \
		echo "run-api already running (pid $$(cat .run-api.pid))"; \
	else \
		setsid pnpm exec tsx apps/run-api/src/index.ts > .run-api.log 2>&1 < /dev/null & \
		echo $$! > .run-api.pid; \
		echo "run-api started (pid $$(cat .run-api.pid), process-group leader), logs: .run-api.log"; \
	fi

stop:
	@if [ -f .run-api.pid ]; then \
		PID=$$(cat .run-api.pid); \
		if kill -0 "$$PID" 2>/dev/null; then kill -TERM -$$PID 2>/dev/null; sleep 1; kill -9 -$$PID 2>/dev/null; echo "run-api stopped (pid $$PID, group-killed)"; \
		else echo "run-api not running (stale pidfile)"; fi; \
		rm -f .run-api.pid; \
	else \
		echo "no .run-api.pid found; nothing to stop"; \
	fi

dev:
	pnpm exec tsx apps/run-api/src/index.ts

e2e:
	@echo "not yet implemented"
