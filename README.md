# [PROJECT NAME] — music platform

Монорепозиторий музыкальной платформы: Web, Windows, Android, iOS на общем backend.

- Требования и решения: `BRIEF.md`, `BRIEF_v2.md`, `TECHNICAL_DECISIONS.md`
- Архитектура: `ARCHITECTURE.md` · План: `ROADMAP.md` · Состояние: `PROJECT_STATUS.md`
- Изменения: `CHANGELOG.md`

## Быстрый старт (Windows)

1. Один раз на новом ПК: `powershell -ExecutionPolicy Bypass -File scripts\install-dev-tools.ps1` (Node, pnpm, Docker, Rust, FFmpeg — в `B:\develop`), перезагрузка, запуск Docker Desktop. Диагностика окружения: `powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1`.
2. `setup.bat` — создаёт `.env`, ставит зависимости, поднимает инфраструктуру, прогоняет все проверки. Отчёт — `setup-report.txt`.
3. Повседневно: `infra.bat up | down | ps | logs | psql | reset`.

## Инструменты разработчика

Все инструменты лежат в `B:\develop` (описание — `B:\develop\README.txt`): Node.js, глобальные npm-пакеты, хранилище pnpm, Git, Rust, FFmpeg, данные Docker.

## Локальные сервисы

| Сервис | Адрес | Назначение |
|---|---|---|
| PostgreSQL 18 + pgvector | `127.0.0.1:54320` (БД `mp`, тесты `mp_test`) | основная БД |
| Redis 8 | `127.0.0.1:63790` | кэш, очереди, pub/sub |
| SeaweedFS (S3 API) | `http://127.0.0.1:8333` | аудио и обложки |
| Mailpit | SMTP `127.0.0.1:1025`, UI http://127.0.0.1:8025 | перехват писем |

Пароли — в `.env` (только для локальной разработки).

## Команды

| Команда | Что делает |
|---|---|
| `pnpm check` | lint + typecheck + test + build всех пакетов (тесты API используют Docker-инфраструктуру) |
| `pnpm dev:api` | API в режиме разработки: http://127.0.0.1:4000 (`/health`, `/health/live`) |
| `pnpm db:generate` | создать SQL-миграцию из `apps/api/src/db/schema.ts` |
| `pnpm db:migrate` | применить миграции к dev-БД |
| `pnpm test` | unit-тесты |
| `pnpm format` | форматирование (Prettier) |
| `push-to-github.bat "сообщение"` | commit + push |

## Структура

```
apps/
  api/         backend на NestJS 12 (модульный монолит)
    src/       config, common (ошибки, rate limit, request id, логи), infra, db, health
    drizzle/   SQL-миграции (генерируются, коммитятся)
    test/      интеграционные тесты
packages/
  config/      общие пресеты TypeScript
  contracts/   схемы API и общие доменные правила (zod)
infrastructure/docker/   локальная инфраструктура (docker compose)
scripts/       служебные скрипты
docs/          исследование и документация
```
