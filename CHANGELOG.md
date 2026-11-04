# Changelog — [PROJECT NAME]

Все значимые изменения проекта фиксируются в этом файле.
Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).

## [Unreleased]

## [0.2.0-i2a] — 2026-11-04 — Итерация I2a: каркас API

### Добавлено
- `apps/api` — backend на **NestJS 12.3** (ESM, Express), модульный монолит:
  - `config/env.ts` — проверка переменных окружения zod-схемой; понятная ошибка без утечки значений.
  - `common/` — RFC 9457 ошибки (`ProblemExceptionFilter`, `ApiError`, `ZodValidationPipe`), X-Request-Id (принимается от прокси или генерируется), лог каждого запроса без query-строк, глобальный rate limit по IP в Redis с заголовками `RateLimit-*` и `Retry-After`.
  - `infra/` — клиенты PostgreSQL (pg + Drizzle), Redis (ioredis), S3 (AWS SDK v3); корректное закрытие соединений.
  - `health/` — `GET /health/live` (процесс жив) и `GET /health` (Postgres, Redis, S3 с таймаутами; 503 при отказе критичной зависимости).
  - Безопасность: helmet-заголовки, CORS только для разрешённых источников, без `X-Powered-By`.
  - `db/schema.ts` — первая схема: `users` (email citext уникальный, argon2-хэш, статус, язык), `sessions` (refresh-токены по хэшу, семейства ротации), `email_tokens` (подтверждение email / сброс пароля), `audit_events`; UUID v7 ключи.
  - `db/migrate.ts`, `db/migrate-cli.ts`, `drizzle.config.ts` — генерация и применение миграций.
  - Тесты: unit (конфиг, request id, маппинг ошибок, валидация, rate limiter на реальном Redis) и интеграционные (health, 503 при падении Redis, 404 в формате Problem Details, request id, security-заголовки, CORS, 429, UUID v7 и уникальность email без учёта регистра в БД).
- Корневые команды `pnpm dev:api`, `pnpm db:generate`, `pnpm db:migrate`.
- ADR-014 — решения по каркасу API.

### Изменено
- `@mp/contracts` — код ошибки `BAD_REQUEST` (400, некорректный запрос) отдельно от `VALIDATION_FAILED` (422).
- `eslint.config.mjs` — разрешены декорированные классы без экземплярных членов (модули NestJS).
- `.prettierignore` — сгенерированные миграции не форматируются.
- `.env.example` — описаны настройки API (у всех есть значения по умолчанию).
- CI — одно задание: инфраструктура → format check → **проверка, что миграции совпадают со схемой** → lint/typecheck/test/build.
- `scripts/setup.ps1` — шаги: генерация миграций, миграция dev-БД, smoke-тест `GET /health` запущенного API.
- `ROADMAP.md` (I2 разбита на I2a/I2b), `PROJECT_STATUS.md`, `README.md`.

### Исправлено
- `apps/api/src/bootstrap.ts` — ошибка сборки TS2322: список CORS-источников из конфига (readonly) передаётся копией.
- Сборка (`tsconfig.build.json` в `api` и `contracts`) — `noEmitOnError`: при ошибке типов `dist/` не обновляется, чтобы smoke-тест не запускал устаревший код.

### Статус
- Первый прогон `setup.bat`: 16/17 PASS. Сгенерирована миграция `0000_strange_prism.sql` (4 таблицы, UUID v7), применена к dev-БД, `GET /health` → ok (Postgres 22 мс, Redis 9 мс, S3 17 мс). Упала сборка API (исправлено выше).
- Повторный прогон: **17/17 PASS**. 47 тестов зелёные (contracts 22, api 25 — из них интеграционные на реальных Postgres/Redis/S3), lint и typecheck чистые, миграции совпадают со схемой. Код I2a проверен на ПК; осталось — push и зелёный CI.

### Изменено
- `push-to-github.bat` — подсказка, как вставить ссылку (правый клик / Ctrl+V); проверка, что это ссылка на GitHub, с повторным вводом вместо выхода.

### Состояние
- Git-репозиторий проекта инициализирован (`git init`, ветка `main`); remote `origin` → https://github.com/renatelius/music-platform.git.
- Первый push (коммит `9a931e2`) выполнен; CI на GitHub Actions — оба задания зелёные: «Lint, typecheck, test, build» и «Local infrastructure boots». **Итерация I1 закрыта.**

## [0.1.2] — 2026-11-04 — Инструменты перенесены в B:\develop

### Проверено
- Перенос завершён, все шаги OK: Node.js 26.13 (`B:\develop\nodejs`), pnpm 12.16.1 (`npm-global`), хранилище pnpm (`pnpm-store`), Git 2.56 (`Git`), Rust 1.99 (`rust`), FFmpeg 9.0.2 (`ffmpeg`), данные Docker (`DockerDesktopWSL`). Проект переустановлен с нового хранилища, `pnpm check` зелёный (22 теста).
- Удалены старые копии: `B:\nodejs`, `B:\.pnpm-store`, Rust из профиля пользователя на C:. VS Build Tools оставлены на C: (выбор заказчика).

### Удалено
- `move-tools-to-develop.bat`, `scripts/relocate-dev-tools.ps1` — одноразовый перенос выполнен, скрипт удалил себя; `relocate-log.txt`.

### Исправлено (по ходу переноса)
- `scripts/relocate-dev-tools.ps1` — **бесконечная рекурсия**: вспомогательная функция называлась `Winget`, и PowerShell вызывал её вместо `winget.exe` (функции имеют приоритет над программами, регистр не важен). Скрипт падал на шаге 1, до вызова установщика. Исправлено: функции переименованы, `winget.exe` вызывается по полному пути.
- `scripts/relocate-dev-tools.ps1` — первый запуск успел удалить глобальный pnpm (`npm uninstall -g pnpm`); теперь pnpm не удаляется заранее, а Node.js при отсутствии/поломке `node.exe` ставится начисто (`--force`).
- `scripts/relocate-dev-tools.ps1` — учитываются остатки старого Node.js в `B:\nodejs` (когда `node.exe` уже нет) и старое хранилище `B:\.pnpm-store`, чтобы их убрать после переноса.
- `scripts/relocate-dev-tools.ps1` — если Git уже установлен в `B:\develop\Git` (например, установщик завис после копирования файлов), скрипт не переустанавливает его, а только добавляет `B:\develop\Git\cmd` в PATH.
- `scripts/relocate-dev-tools.ps1` — FFmpeg: копия в `B:\develop\ffmpeg` ставилась, но команда `ffmpeg` по-прежнему вела на старую копию на C: (старый ярлык winget). Теперь папка `bin` ставится первой в PATH, повторно не переустанавливается; старая пользовательская копия удаляется из `move-tools-to-develop.bat` без прав администратора (winget не удаляет её из-под админа).
- `scripts/relocate-dev-tools.ps1` — данные Docker уже лежат в `B:\develop\DockerDesktopWSL` — шаг 9 это распознаёт; пустая `docker-data` удалена. Удаляются остатки старого Node.js в `B:\nodejs`.
- `scripts/relocate-dev-tools.ps1` — лог переноса пишется в папку проекта (`relocate-log.txt`), а не в `B:\develop`, чтобы его можно было разобрать; файл исключён из Git.

## [0.1.1] — 2026-11-04 — I1 проверена, уборка, перенос инструментов

### Проверено
- `setup.bat` на ПК: 14/14 PASS — pnpm install (135 пакетов), PostgreSQL 18.6 + pgvector 0.8.7 / pg_trgm / citext / unaccent в `mp` и `mp_test`, Redis PONG, SeaweedFS с бакетами `mp-media` и `mp-masters`, Mailpit 1.33, `pnpm check` (22 unit-теста, lint, typecheck, build).

### Добавлено
- `move-tools-to-develop.bat` + `scripts/relocate-dev-tools.ps1` — одноразовый перенос инструментов в `B:\develop`: Node.js, npm-global и pnpm, хранилище pnpm, Git, Rust (`CARGO_HOME`/`RUSTUP_HOME`), FFmpeg, по желанию VS Build Tools; переустановка зависимостей проекта и `pnpm check`; `B:\develop\README.txt`. Повторный запуск безопасен; при полном успехе скрипт удаляет сам себя.

### Изменено
- `scripts/install-dev-tools.ps1` — для нового ПК ставит инструменты сразу в `B:\develop`.
- `scripts/setup.ps1` — тихая загрузка образов Docker (короче отчёт), отключена телеметрия Turborepo.
- `turbo.json` — у задачи `test` нет выходных файлов (убрано предупреждение).
- `.github/workflows/ci.yml` — отключена телеметрия Turborepo.
- `README.md`, `TECHNICAL_DECISIONS.md` (ADR-013), `ROADMAP.md` (I1 ✅), `PROJECT_STATUS.md`.

### Удалено
- `check-env.bat`, `install-dev-tools.bat` — больше не нужны в корне; логика осталась в `scripts/check-env.ps1` и `scripts/install-dev-tools.ps1`.
- `env-report.txt`, `install-log.txt` — устаревшие отчёты.

## [0.1.0-i1] — 2026-11-04 — Итерация I1: каркас монорепо

### Добавлено
- Монорепозиторий: `package.json`, `pnpm-workspace.yaml` (workspaces + catalog версий), `turbo.json` (build/lint/typecheck/test/dev), `.node-version`.
- Инструменты качества: `eslint.config.mjs` (ESLint 10 + typescript-eslint strictTypeChecked + Prettier), `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.gitattributes`.
- `packages/config` — общие пресеты TypeScript (`base`, `library`, `node`).
- `packages/contracts` — общие контракты API на zod 4:
  - ошибки по RFC 9457 (`ProblemDetails`, коды ошибок, `createProblem`, преобразование ошибок валидации);
  - id, даты, курсорная пагинация (`PageQuery`, `pageOf`);
  - health-ответ и правило агрегации статуса;
  - аудиоформаты и **честная классификация качества** (`classifyQuality`): lossy/lossless/hires с учётом исходника — FLAC из MP3 не считается lossless, апсемплинг не считается Hi-Res; подписи формата для плеера.
  - Unit-тесты на все правила (Vitest 5).
- `infrastructure/docker/compose.yaml` — PostgreSQL 18 + pgvector, Redis 8, SeaweedFS (S3), Mailpit, одноразовый `s3-init` для бакетов; порты только на 127.0.0.1.
- `infrastructure/docker/postgres/init/01-extensions.sql` — расширения `vector`, `pg_trgm`, `citext`, `unaccent`; тестовая БД `mp_test`.
- `infrastructure/docker/seaweedfs/s3.json` — dev-ключи S3.
- `.env.example` — все локальные настройки.
- `.github/workflows/ci.yml` — CI: format check, lint, typecheck, test, build; проверка запуска инфраструктуры.
- `setup.bat` + `scripts/setup.ps1` — первичная настройка и полная проверка с отчётом `setup-report.txt`.
- `infra.bat` — up / down / ps / logs / psql / reset.
- `README.md` проекта — быстрый старт, сервисы, команды, структура.

### Изменено
- `TECHNICAL_DECISIONS.md` — стек утверждён; TypeScript зафиксирован на 6.0.x (typescript-eslint не поддерживает TS 7); локальное S3 — SeaweedFS вместо заархивированного MinIO; ADR-005…012 приняты; ADR-010 — свой мобильный аудиомодуль; добавлен ADR-013 (локальная инфраструктура).
- `ROADMAP.md`, `PROJECT_STATUS.md` — статус I1.
- `.gitignore` — `.turbo/`, `setup-report.txt`, `*.local`.

### Статус
- Код I1 написан, но ещё не запускался: проверка — `setup.bat` на ПК разработчика.

## [0.1.0-research] — 2026-11-04

### Добавлено
- `docs/RESEARCH.md` — анализ конкурентов и рисков, 3 варианта позиционирования, конкурентные преимущества, карта экранов и сценарии MVP, легальные источники музыки, список внешних API и сервисов.
- `ARCHITECTURE.md` — общая схема, структура монорепо, backend-модули, модель данных, аудио-конвейер, плеер, синхронизация, безопасность, качество.
- `ROADMAP.md` — Рубеж 1 (итерации I1–I8 до первого контрольного результата), фазы 3–7, риски.
- `PROJECT_STATUS.md` — текущее состояние проекта и открытые вопросы.

### Изменено
- `TECHNICAL_DECISIONS.md` — ADR-003 дополнен позиционированием; ADR-004 расписан по слоям с актуальными версиями (Next 16.3, NestJS 12, Tauri 2.12, Expo SDK 58 / RN 0.88, PostgreSQL 18 + pgvector 0.8.7); добавлены ADR-005…012 (монорепо, модульный монолит, auth, поиск, доставка аудио, аудиодвижок, синхронизация, тестовый CC-каталог).

### Статус
- Исследование завершено; стек и архитектура ждут утверждения заказчика. Открыт вопрос ADR-010 (мобильный аудиоадаптер).

## [0.0.3] — 2026-11-04 (окружение)

### Добавлено
- `check-env.bat` — проверка окружения разработчика (Node.js, npm/pnpm, Git, Docker, Rust, MSVC Build Tools, WebView2, Python, FFmpeg, Java, Android SDK, ресурсы ПК). Результат пишется в `env-report.txt`.
- `scripts/check-env.ps1` — логика проверки окружения на PowerShell (вызывается из `check-env.bat`).
- `install-dev-tools.bat` + `scripts/install-dev-tools.ps1` — автоматическая установка инструментов через winget с запросом прав администратора: long paths, WSL 2, VS Build Tools (C++), Node.js LTS в `B:\nodejs` + pnpm, Rust, FFmpeg, Docker Desktop (данные в `B:\DockerData`). Повторный запуск безопасен — установленное пропускается. Лог — `install-log.txt`.

### Изменено
- `.gitignore` — исключены `env-report.txt` и `install-log.txt` (данные конкретной машины).

### Исправлено
- `check-env.bat` ломался после проверки Node.js: `npm`/`pnpm` — это .cmd-обёртки, и вызов без `call` передавал им управление; отчёт заполнялся ошибками «file is being used by another process». Проверка перенесена в PowerShell.
- `scripts/check-env.ps1` — вывод `wsl --status` (UTF-16) отображался кракозябрами; добавлено корректное декодирование и явная пометка NOT INSTALLED.
- `scripts/install-dev-tools.ps1` — убраны ложные красные ошибки `NativeCommandError` в PowerShell 5.1 (wsl/rustup/net писали в stderr); pnpm через npm ставится с `--allow-scripts=pnpm`.
- `scripts/check-env.ps1` — отсутствие corepack помечается как ожидаемое (удалён из Node.js 25+).

### Окружение (первая установка, 04.11.2026)
- Установлено: Node.js 26.13.0, npm 11.20.0, pnpm 12.16.1, Rust 1.99.1, VS Build Tools 2022, FFmpeg 9.0.2, Docker Desktop 29.9.2 / Compose 5.6.1, WSL 2.
- После перезагрузки проверено: WSL 2 работает (дистрибутив docker-desktop), Docker Engine 29.9.2 запущен. Окружение для фаз 1–2 готово.
- Ещё не установлено (нужно с фазы 3): JDK 17, Android Studio / SDK.

## [0.0.2] — 2026-11-04

### Добавлено
- `BRIEF_v2.md` — техническое задание v2 (дословно): 4 платформы, гибридный каталог, монорепозиторий, Artist/Admin Studio, AI DJ, фазы 1–7, первый контрольный результат, визуальные референсы.
- `TECHNICAL_DECISIONS.md` — журнал архитектурных решений:
  - ADR-001 — платформы Web / Windows / Android / iOS на общей платформе (принято).
  - ADR-002 — гибридный каталог: лицензированный + независимые исполнители + загрузки пользователей + локальные файлы (принято).
  - ADR-003 — концепция «новый стандарт музыкальных платформ» (принято).
  - ADR-004 — ориентир по стеку (предложено, ждёт технического исследования).

### Статус
- Следующий шаг — техническое исследование и подробный план (ТЗ v2 §15), затем утверждение стека.

## [0.0.1] — 2026-11-04

### Добавлено
- `BRIEF.md` — исходное техническое задание (дословно), первоисточник требований.
- `CHANGELOG.md` — журнал изменений проекта.
- `push-to-github.bat` — скрипт отправки проекта на GitHub (init репозитория, настройка remote при первом запуске, commit, push).
- `.gitignore` — базовые исключения (зависимости, сборки, секреты, IDE).

### Статус
- Разработка не начата. Следующий шаг — «Первое задание» из BRIEF.md (анализ концепции, позиционирование, архитектура, стек, план).
