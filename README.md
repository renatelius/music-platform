# ReMusic

Монорепозиторий музыкальной платформы **ReMusic**: Web, Windows, Android, iOS на общем backend.

- Требования и решения: `BRIEF.md`, `BRIEF_v2.md`, `TECHNICAL_DECISIONS.md`
- Архитектура: `ARCHITECTURE.md` · План: `ROADMAP.md` · Состояние: `PROJECT_STATUS.md`
- Изменения: `CHANGELOG.md`

## Быстрый старт (Windows)

1. Один раз на новом ПК: `powershell -ExecutionPolicy Bypass -File scripts\install-dev-tools.ps1` (Node, pnpm, Docker, Rust, FFmpeg — в `B:\develop`), перезагрузка, запуск Docker Desktop. Диагностика окружения: `powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1`.
2. `setup.bat` — создаёт `.env`, ставит зависимости, поднимает инфраструктуру, прогоняет все проверки. Отчёт — `setup-report.txt`.
3. Разработка: `dev.bat` — поднимает инфраструктуру, API (http://127.0.0.1:4000) и веб-приложение (http://localhost:3000), открывает браузер.
4. Повседневно: `infra.bat up | down | ps | logs | psql | reset`.

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

## API (локально, http://127.0.0.1:4000)

| Метод и путь | Назначение |
|---|---|
| `GET /health`, `GET /health/live` | готовность (Postgres, Redis, S3) и «жив ли процесс» |
| `POST /auth/register` | регистрация + сразу вход; письмо с подтверждением |
| `POST /auth/login` | вход (лимит 10 попыток / 15 мин на email) |
| `POST /auth/refresh` | новый access-токен; ротация refresh-токена |
| `POST /auth/logout`, `POST /auth/logout-all` | выход с устройства / со всех |
| `GET /auth/sessions`, `DELETE /auth/sessions/:id` | активные сессии, отзыв |
| `POST /auth/email/verify`, `POST /auth/email/resend` | подтверждение email |
| `POST /auth/password/forgot`, `POST /auth/password/reset` | сброс пароля |
| `GET /me`, `PATCH /me` | профиль, смена имени и языка (нужен `Authorization: Bearer`) |
| `GET /catalog/home` | главная: размер каталога, недавно добавленные, треки дня, исполнители |
| `GET /catalog/releases/:id`, `/catalog/artists/:id`, `/catalog/tracks/:id` | альбом, исполнитель, трек (лицензия и атрибуция на каждом треке) |
| `GET /catalog/search?q=`, `/catalog/search/suggest?q=` | поиск и подсказки (опечатки, акценты, ё/е) |
| `GET /catalog/tracks/:id/stream` | подписанные ссылки на рендиции трека и громкость для ReplayGain |
| `GET /media/:token` | аудиофайл по подписанной ссылке (Range, без Authorization) |
| `GET /openapi.json`, `GET /docs` | описание API (OpenAPI 3.1), вне production |

Веб-приложение проксирует API под `/api/*` (например, `/api/auth/login`). Нативные клиенты передают `X-Client-Type: native` и получают refresh-токен в теле ответа; браузер — в HttpOnly-cookie. Письма видны в Mailpit: http://127.0.0.1:8025

## Команды

| Команда | Что делает |
|---|---|
| `pnpm check` | lint + typecheck + test + build всех пакетов (тесты API используют Docker-инфраструктуру) |
| `pnpm dev` | API + веб в режиме разработки (то же, что `dev.bat` без Docker) |
| `pnpm dev:web` | только веб: http://localhost:3000 |
| `pnpm dev:api` | API в режиме разработки: http://127.0.0.1:4000 (`/health`, `/health/live`) |
| `pnpm db:generate` | создать SQL-миграцию из `apps/api/src/db/schema.ts` |
| `pnpm db:migrate` | применить миграции к dev-БД |
| `pnpm catalog:import` | тестовый каталог: 300 треков FMA под открытыми лицензиями (повторный запуск безопасен; `--help`, `--dry-run`, `--verify`) |
| `pnpm test` | unit-тесты |
| `pnpm format` | форматирование (Prettier) |
| `push-to-github.bat "сообщение"` | commit + push |
| `catalog.bat` | тестовый каталог: меню «пробный запуск / импорт / проверка» (то же, что `pnpm catalog:import`) |

## Структура

```
apps/
  api/         backend на NestJS 12 (модульный монолит)
    src/       config, common (ошибки, rate limit, request id, логи), infra, db, health
    drizzle/   SQL-миграции (генерируются, коммитятся)
    test/      интеграционные тесты
  web/         веб-приложение на Next.js 16 (вход, регистрация, главная, аккаунт)
packages/
  config/        общие пресеты TypeScript
  contracts/     схемы API и общие доменные правила (zod)
  design-tokens/ цвета, тени, радиусы, анимации → tokens.css (светлая/тёмная тема)
  ui/            React-компоненты на Tailwind CSS v4
  i18n/          переводы (en, ru) и определение языка
  api-client/    типизированный клиент API для всех платформ
  player-core/   ядро плеера для всех платформ: очередь, shuffle/repeat, выбор рендиции, ReplayGain
  audio-web/     аудиодвижок браузера и Windows: gapless, crossfade, эквалайзер, Media Session
infrastructure/docker/   локальная инфраструктура (docker compose)
tools/
  catalog-import/ импорт тестового каталога FMA (Hugging Face → S3 → конвейер аудио)
scripts/       служебные скрипты
docs/          исследование и документация
```
