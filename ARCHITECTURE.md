# Architecture — [PROJECT NAME]

> Версия 0.1 · 2026-11-04 · Статус: на утверждении
> Обоснования решений — `TECHNICAL_DECISIONS.md` (ссылки вида ADR-0XX).

---

## 1. Принципы

1. **Модульный монолит сначала** (ADR-006). Один backend-процесс с жёсткими границами модулей + отдельный worker для тяжёлых задач. Модуль выделяется в сервис только при реальной причине (нагрузка, команда, язык).
2. **Контракты — единый источник правды.** Схемы API описаны один раз (zod) → типы для всех клиентов + OpenAPI.
3. **Тонкие клиенты, толстые общие пакеты.** Логика плеера, синхронизации, API-клиент, i18n — в общих TS-пакетах.
4. **Права на контент — часть модели данных**, а не проверка «где-то в UI». Ни один трек не воспроизводится без разрешающей записи прав.
5. **Честность.** Формат, источник и лицензия трека всегда известны и показываются.
6. **Local-first клиенты.** Клиент работает при плохой сети: кэш, очередь изменений, повторная отправка.

---

## 2. Общая схема

```
   Web (Next.js)   Windows (Tauri 2)   Android / iOS (Expo)    Artist Studio   Admin Studio
        │                 │                    │                     │              │
        └────────── HTTPS REST (OpenAPI) + WebSocket (sync, playback) ──────────────┘
                                   │
                         ┌─────────▼──────────┐
                         │  API (NestJS)      │  модульный монолит
                         │  auth · users      │
                         │  catalog · search  │
                         │  library · playlists│
                         │  playback-sync     │
                         │  streaming (URLs)  │
                         │  ingest · rights   │
                         │  artist · admin    │
                         └──┬─────┬─────┬─────┘
             ┌──────────────┘     │     └────────────────┐
     ┌───────▼───────┐    ┌───────▼──────┐       ┌───────▼────────┐
     │ PostgreSQL 18 │    │ Redis        │       │ Worker (NestJS)│  BullMQ-очереди
     │ + pgvector    │    │ кэш, очереди,│       │ FFmpeg: анализ,│
     │ + pg_trgm/FTS │    │ pub/sub, RL  │       │ громкость,     │
     └───────────────┘    └──────────────┘       │ транскодинг    │
                                                 └───────┬────────┘
     ┌───────────────┐   ┌──────────────────┐            │
     │ OpenSearch 3  │   │ S3-хранилище     │◄───────────┘
     │ (Phase 2+)    │   │ masters/ renditions/ covers/
     └───────────────┘   └────────┬─────────┘
                                  │ подписанные URL
                             ┌────▼────┐
                             │  CDN    │ ──► клиенты (аудио, обложки)
                             └─────────┘
     ┌───────────────────────────┐
     │ ML-сервис (Python/FastAPI)│  Phase 5: embeddings, рекомендации, AI DJ
     └───────────────────────────┘
```

Аудио **никогда не проходит через API-процесс**: API выдаёт короткоживущую подписанную ссылку, клиент качает файл напрямую из CDN/S3.

---

## 3. Монорепозиторий (ADR-005)

pnpm workspaces + Turborepo. Структура упрощена по сравнению с BRIEF_v2 §10 (обоснование ниже).

```
music-platform/
├── apps/
│   ├── api/               NestJS — модульный монолит (REST + WebSocket)
│   ├── worker/            NestJS standalone — очереди: ingest, транскодинг, анализ
│   ├── web/               Next.js — веб-клиент
│   ├── desktop/           Tauri 2 + Vite + React — Windows-клиент
│   ├── mobile/            Expo (React Native) — Android + iOS          [Phase 3]
│   ├── artist-studio/     Next.js                                      [Phase 4]
│   └── admin/             Next.js                                      [Phase 4]
├── packages/
│   ├── contracts/         zod-схемы API + общие типы (замена shared-types)
│   ├── api-client/        типизированный клиент REST + WS (все клиенты)
│   ├── player-core/       платформенно-независимое ядро плеера: очередь, состояния, shuffle/repeat, политика качества
│   ├── audio-web/         адаптер воспроизведения для браузера/WebView2 (Web Audio): gapless, crossfade, ReplayGain, EQ
│   ├── audio-native/      адаптер для мобильных (Expo-модуль)               [Phase 3]
│   ├── design-tokens/     цвета, типографика, отступы, анимации → CSS-переменные и RN-объекты
│   ├── ui/                React-компоненты для web/desktop/studio (DOM)
│   ├── app-shell/         экраны и фичи, общие для web и desktop (без привязки к роутеру)
│   ├── sync/              синхронизация: офлайн-очередь изменений, версии, WS-подписки
│   ├── i18n/              локализация (ICU-сообщения), RTL
│   └── config/            общие tsconfig, ESLint, Prettier, Vitest-пресеты
├── ml/                    Python-сервис рекомендаций (uv)                [Phase 5]
├── infrastructure/
│   ├── docker/            docker-compose для локальной разработки
│   ├── database/          seed, скрипты
│   └── deployment/        k8s/terraform                                 [Phase 6]
├── tools/
│   └── catalog-import/    CLI импорта тестового CC-каталога
└── docs/
```

**Отличия от BRIEF_v2 §10 и почему:**
- `services/*` (7 микросервисов) → **модули внутри `apps/api`** + `apps/worker`. Требование ТЗ «не превращай в микросервисы на старте». Границы модулей сохраняются — выделить сервис потом = перенести папку.
- `design-system` + `ui` → **`design-tokens` + `ui`**: токены общие для DOM и React Native, а компоненты — нет (RN не рендерит DOM).
- `audio-engine` → **`player-core` + адаптеры** (`audio-web`, `audio-native`): логика одна, механизм воспроизведения — нативный для платформы (требование BRIEF_v2 §7).
- `shared-types` → **`contracts`**: типы выводятся из схем валидации, а не пишутся вручную дважды.
- `recommendation-sdk`, `auth` как пакеты → появятся, когда будет что переиспользовать; пока auth — модуль API + методы в `api-client`.
- `cdn/`, `monitoring/` → в `infrastructure/deployment` на Phase 6.

---

## 4. Backend-модули (apps/api)

| Модуль | Ответственность | Phase |
|---|---|---|
| `auth` | регистрация, вход, refresh-ротация, выход со всех устройств, сброс пароля, подтверждение email | 1 |
| `users` | профиль, настройки (язык, тема, качество), устройства | 1 |
| `catalog` | артисты, релизы, треки, кредиты, жанры, источники и права | 2 |
| `search` | поиск и подсказки (порт `SearchPort`: Postgres → OpenSearch) | 2 |
| `streaming` | проверка прав → выбор качества → подписанная ссылка | 2 |
| `library` | лайки треков/альбомов/артистов, сохранённое, история прослушиваний | 2 |
| `playlists` | CRUD, порядок, (совместные — Phase 6) | 2 |
| `playback-sync` | WebSocket: состояние воспроизведения, устройства, Handoff, события изменений библиотеки | 2–3 |
| `ingest` | приём файлов, постановка задач worker'у, статусы | 2 / 4 |
| `rights` | территории, режимы (стрим/офлайн/превью), сроки, лицензии | 2 |
| `artist` | Artist Studio API | 4 |
| `admin` | модерация, жалобы, RBAC | 4 |
| `billing` | тарифы, подписки, вебхуки платёжных провайдеров | 6 |

Реализовано в I2a: `config`, `common`, `infra`, `db`, `health` (ADR-014). Сквозное: конфиг с валидацией, структурные логи (pino) с request-id, глобальный обработчик ошибок (RFC 9457 Problem Details), rate limiting (Redis), health/readiness, OpenAPI на `/docs`.

---

## 5. Модель данных (ядро, Phase 1–2)

```
users ─┬─ sessions (refresh-токены: hash, device, expires, revoked)
       ├─ devices
       ├─ user_settings
       ├─ likes_tracks / likes_releases / likes_artists
       ├─ playlists ── playlist_items (position: дробный ключ для дешёвой перестановки)
       └─ play_events (история: track, started_at, played_ms, completed, skipped, device, context)

artists ── release_artists ── releases (album | single | ep | compilation | live)
                                  └── tracks ── track_artists (role: main, feat, remixer…)
                                         ├── track_assets   (rendition: codec, container, bitrate,
                                         │                   sample_rate, bit_depth, lossless, s3_key, size)
                                         ├── track_loudness (integrated LUFS, true peak → ReplayGain)
                                         └── track_rights ── sources (fma | jamendo | label:X | artist_upload | user_upload)
                                                 (territories, modes[stream|offline|preview],
                                                  license (CC BY 4.0 …), attribution, valid_from/to)
```

Правила:
- `lossless = true` только если исходник — FLAC/ALAC/WAV и цепочка без потерь. Hi-Res — только при sample_rate > 48 кГц или bit_depth > 16 **исходника** (BRIEF §3).
- Пользовательские загрузки — в отдельной таблице `user_tracks`, никогда не смешиваются с `tracks` каталога (BRIEF_v2 §4C).
- Все изменения библиотеки получают монотонную версию `user_change_seq` — основа синхронизации.

---

## 6. Аудио-конвейер (сердце продукта)

### 6.1 Приём и обработка (worker)
```
исходник ─► ffprobe (кодек, частота, битность, длительность, теги)
        ─► проверка: повреждения, тишина, длительность
        ─► loudness: FFmpeg ebur128 → LUFS, true peak → ReplayGain-значения
        ─► fingerprint: Chromaprint (дубликаты, Phase 4 — права)
        ─► рендиции:
             AAC-LC  96 / 160 / 256 kbps (m4a)  — совместимость, слабая сеть
             Opus   160 kbps (webm/ogg)         — лучшее качество/размер где поддерживается
             FLAC   16/44.1                      — только если исходник lossless
             FLAC   24/96 (как есть)             — только если исходник Hi-Res
        ─► S3: masters/ (приватно, неизменяемо), renditions/, covers/ (WebP/AVIF, 3 размера)
```

### 6.2 Доставка (ADR-009)
- MVP: **целый файл рендиции по HTTP с Range-запросами**, по подписанной ссылке (TTL ~ 5–15 мин) через CDN. Трек 3–5 мин — это 2–10 МБ; такой подход проще и надёжнее HLS для gapless и кэширования офлайн.
- **Адаптивность — на уровне трека:** клиент меряет пропускную способность и выбирает рендицию для следующего трека; при деградации — переключение на меньший битрейт без остановки.
- HLS/DASH (fMP4) — в Phase 5–6 для длинного контента (подкасты, live, DJ-миксы), где сегментация действительно нужна.

### 6.3 Плеер
`player-core` (чистый TS, без DOM) — конечный автомат: `idle → loading → ready → playing ⇄ paused → ended`, очередь (контекст + «далее в очереди»), shuffle (Fisher–Yates с сохранением исходного порядка), repeat, политика качества, предзагрузка следующего трека, отчёты о прослушивании (play_events). Покрывается unit-тестами полностью.

Адаптеры:
- **audio-web** (Web, Windows/WebView2): Web Audio API — декодирование и точное планирование стыка двух треков (gapless), crossfade через GainNode, ReplayGain как усиление, эквалайзер на BiquadFilterNode (10 полос), Media Session API (экран блокировки, медиаклавиши), горячие клавиши.
- **audio-native** (Android/iOS, Phase 3): ExoPlayer/Media3 и AVQueuePlayer через Expo-модуль — фоновое воспроизведение, экран блокировки, Bluetooth, Android Auto/CarPlay (ADR-010).
- Windows bit-perfect / WASAPI exclusive — Rust-сторона Tauri (Phase 5+, опционально).

---

## 7. Синхронизация между устройствами (ADR-011)

- **Данные библиотеки:** клиент отправляет мутации с `idempotency-key`; сервер применяет, увеличивает `user_change_seq` и рассылает событие по WebSocket всем устройствам пользователя (Redis pub/sub между инстансами API). Клиент, пропустивший события, догоняет запросом `GET /sync/changes?since=seq`.
- **Офлайн:** мутации копятся в локальной очереди (`packages/sync`), отправляются при появлении сети. Конфликты: лайки/сохранения — идемпотентны; плейлисты — операции «вставить после X / удалить / переместить» с дробными позициями, а не перезапись всего списка.
- **Воспроизведение:** у пользователя одна «активная сессия» (устройство, трек, позиция, очередь, время обновления). Устройство-проигрыватель шлёт heartbeat каждые ~10 с и на каждое событие. Handoff = другое устройство забирает сессию и стартует с позиции + поправка на задержку.

---

## 8. Безопасность (Phase 1 — базовая, Phase 7 — аудит)

- Пароли: **argon2id** (встроенный `crypto.argon2`, ADR-015). Access-токен JWT 15 мин; refresh-токен — случайный, хранится **только хэш**, ротация с обнаружением повторного использования (кража → отзыв всей цепочки).
- Хранение токенов: Web — `httpOnly; Secure; SameSite=Lax` cookie + CSRF-защита; Windows — системное хранилище (Credential Manager через Tauri); мобильные — Keychain/Keystore (expo-secure-store).
- Rate limiting по IP и аккаунту на auth-эндпоинтах; защита от перебора; капча/антибот — Phase 6.
- Валидация каждого входа (zod), параметризованные запросы (ORM), CSP и security-заголовки, CORS по списку.
- Подписанные ссылки на аудио с коротким TTL и привязкой к пользователю.
- Аудит-лог критичных операций (вход, смена пароля, удаление, админ-действия).
- Секреты — только в `.env` (не в Git), в проде — секрет-хранилище.
- Персональные данные: минимизация, экспорт и удаление аккаунта (GDPR-подход).

---

## 9. Качество

| Уровень | Инструмент | Что покрываем |
|---|---|---|
| Unit | Vitest | player-core, sync, contracts, сервисы API |
| Integration | Vitest + Testcontainers (реальный Postgres/Redis) | API-модули, миграции, auth-поток |
| E2E | Playwright | сценарии MVP в web и desktop |
| Performance | k6 | auth, поиск, выдача ссылок; бюджет p95 |
| Security | ESLint security-правила, `pnpm audit`, OWASP ZAP (Phase 7) | — |
| CI | GitHub Actions | lint → typecheck → unit → integration → build на каждый push |

Бюджеты (MVP): ответ API p95 < 150 мс на локальном стенде; старт воспроизведения < 1 с на 4G; первый экран web LCP < 2.5 с.
