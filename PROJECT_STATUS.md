# Project Status — [PROJECT NAME]

> Обновляется после каждой итерации. Это точка входа для любой новой сессии разработки.

**Дата:** 2026-11-04
**Фаза:** 1 — Foundation
**Текущая итерация:** I2a «Каркас API» — ✅ проверено на ПК (17/17 PASS, 47 тестов); осталось: push + CI. I1 ✅ закрыта.

## Сделано
- ТЗ v1 и v2 (`BRIEF.md`, `BRIEF_v2.md`); исследование (`docs/RESEARCH.md`); архитектура и план утверждены заказчиком.
- ADR-001…013 приняты; мобильный аудиоадаптер — свой Expo-модуль.
- Окружение ПК: Node 26.13, pnpm 12.16, Docker 29.9 (WSL 2), Rust 1.99, VS Build Tools 2022, FFmpeg 9.0, Python 3.14.
- I1: монорепо (pnpm + Turborepo + catalog), TS 6.0 / ESLint 10 / Prettier / Vitest 5, пакеты `@mp/config` и `@mp/contracts` (RFC 9457 ошибки, пагинация, health, честная классификация качества звука) с unit-тестами, Docker Compose (Postgres 18 + pgvector, Redis 8, SeaweedFS, Mailpit), CI, `setup.bat` / `infra.bat`.

## Критерии готовности I1
- [x] `pnpm install` без ошибок, lock-файл создан
- [x] Все 4 сервиса healthy (PostgreSQL 18.6, pgvector 0.8.7, Redis, SeaweedFS, Mailpit 1.33), бакеты созданы, расширения в `mp` и `mp_test`
- [x] `pnpm check` зелёный: 22 unit-теста, lint, typecheck, build
- [x] Первый push на GitHub (https://github.com/renatelius/music-platform), CI зелёный

## I2a — критерии готовности
- [x] `pnpm db:generate` создал первую миграцию `0000_strange_prism.sql` (users, sessions, email_tokens, audit_events)
- [x] `pnpm check` зелёный: 25 тестов API (unit + интеграционные на реальных Postgres/Redis/S3) + 22 контрактов
- [x] Миграции применены к dev-БД, API отвечает на `GET /health` со статусом ok
- [ ] CI зелёный (включая проверку «миграции совпадают со схемой»)

## Следующее
I2b — auth: регистрация, подтверждение email (Mailpit), вход, refresh-ротация, выход, сброс пароля, аудит, строгий rate limit.

## Ждёт решения заказчика
- Рабочее название проекта (пока `[PROJECT NAME]`, npm-scope `@mp`).

## Известные ограничения
- Тестовый каталог — только Creative Commons; лицензированного каталога нет (нужны договоры).
- iOS собирается только через облако (EAS) — Mac отсутствует.
- На диске C: ~18 ГБ свободно.
- Все инструменты разработки — в `B:\develop` (кроме Docker Desktop, WSL, Python 3.14 и VS Build Tools 2022 на C:).

## Как запустить
`setup.bat` → отчёт `setup-report.txt`. Повседневно: `infra.bat up|down|ps|logs|psql|reset`, `pnpm check`.
