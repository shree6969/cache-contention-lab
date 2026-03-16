.PHONY: install dev lint test

install:
	poetry install

dev:
	poetry run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

lint:
	poetry run ruff check src/

test:
	poetry run pytest tests/ -v
