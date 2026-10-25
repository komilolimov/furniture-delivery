# Прогресс

## Этапы

| Этап | Состояние |
| --- | --- |
| M1 | ACCEPTED — подтверждено пользователем перед M2 |
| M2 | IMPLEMENTED / VERIFIED — проверки ниже; ожидает пользовательской приёмки |
| M3 | NOT_STARTED |
| M4 | NOT_STARTED |
| M5 | NOT_STARTED |
| M6 | NOT_STARTED |
| M7 | NOT_STARTED |
| M8 | NOT_STARTED |

## 2026-10-25 / Первая контрольная точка Git

По запросу пользователя текущее состояние M1/M2 сохранено первым локальным
baseline commit. Перед включением проверены 129 файлов: локальные DB/seed secrets
и маркеры приватных ключей не обнаружены. `.env.example` содержит placeholders.
`git check-ignore` подтверждает исключение `.env` и локальных env-файлов,
`node_modules`, `.next`, `dist`, `.tmp`, logs, временных файлов, tsbuildinfo
и предусмотренных каталогов PostgreSQL. Compose использует named volumes вне checkout.

Код приложения не менялся; проверки приложения из отчёта M2 не выдаются за новые
запуски. Для этой контрольной точки проверены состав Git, исключения и форматирование.
Push и deploy не выполнялись; запущенные для ручной проверки сервисы не останавливались.
M3 не начат. Две правки README отложены до M3: описание contracts должно учитывать
identity/crews, а последняя строка должна отражать завершённую реализацию M2.

## 2026-10-25 / M2

M1 принят прямым сообщением пользователя перед этим этапом. Более ранний отчёт M1
ниже сохранён как история предыдущего запуска, а не текущая блокировка перехода.
Реализован только M2; M3–M8 не начинались.

### Реализовано

- User, CrewMember, AuthSession и внешние контакты; одна новая недеструктивная миграция.
  `synchronize: false`, тот же lazy DataSource/DatabaseService для health, auth и business API.
- Индивидуальные аккаунты с scrypt password hashes; 32-byte opaque session token в
  HttpOnly cookie, в БД только SHA-256 tokenHash. В JSON/SSR HTML секретов нет.
- Login/logout/me, абсолютный TTL 8 часов, server-side revocation, Origin+CSRF guard,
  bounded login limiter с 429/Retry-After. Глобальная auth-защита по умолчанию.
- Текущие User.role/active и CrewMember читаются на каждом запросе. ADMIN изменения
  роли, пароля или active отзывают сессии. После re-enable старая cookie не восстанавливается.
  Смена членства действует без повторного входа; чужая команда — 404, запрещённое действие — 403.
- ADMIN account management; ADMIN/DISPATCHER team management, состав и внешние контакты.
  CREW_MEMBER читает только свою текущую команду. Исторические записи отключаются, не удаляются.
- Partial unique index на активное членство плюс транзакции User → Crew исключают
  два конкурентных активных членства. Внешний контакт не создаёт аккаунт.
- Seed: 1 admin + 1 dispatcher + 40 сотрудников, по 4 в 10 командах. Пароль только
  из локального SEED_PASSWORD при создании отсутствующих пользователей. Повторный seed
  сохраняет пароль/соль, роль, disabled-состояния, ручные изменения и членство.
- Login, отдельные защищённые SSR layouts backoffice/crew, формы команд/состава/контактов,
  ADMIN accounts, loading/empty/error/retry. Next proxy передаёт Cookie/Set-Cookie/Origin.
- Browser-safe response/request contracts и явные backend DTO/runtime parsers;
  неизвестные/некорректные поля отклоняются. JSON parser/SQL errors не раскрывают credentials.

### Сохранность и изменения

До изменений сохранена копия исходников в `/private/tmp/furniture-delivery-m2-baseline`.
Все файлы в Git ещё untracked (репозиторий без первого commit); чужой код не сбрасывался.
Существующий `.env` проверен по хешу и не изменён. Версии, все package manifests,
lockfile и Compose не изменены; новых зависимостей нет. `pnpm install --frozen-lockfile --offline`
действительно выполнен и подтвердил согласованность lockfile.

Основные изменения: `apps/api/src/auth`, `users`, `identity`, `crews`, M2 migration,
расширение seed/DataSource/public DatabaseService API; `apps/web/app/login`, `backoffice`,
`crew`, компоненты/guards/proxy; `packages/contracts/src/identity.ts`, `crews.ts`;
root `.env.example`, README, DECISIONS, PROGRESS и тесты. Commit/push/deploy не выполнялись.

Для этого локального запуска начальный demo password сгенерирован в приватном файле
`/private/tmp/furniture-delivery-m2-seed-password` (0600), передан только через process env;
значение в команды, отчёт и логи не выводилось. Не публиковать этот файл.

### Проверки, реально выполненные агентом в M2

Node **24.22.1**, pnpm **10.34.8**. Compose PostgreSQL **17.11**, две отдельные БД
на loopback 5432/5433 с отдельными credentials/volumes. Новая временная PostgreSQL
не устанавливалась. Integration использует только обязательные TEST_DATABASE_*
и случайные test schemas, development данные не очищаются.

| Команда / сценарий | Фактический результат |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | **PASS** |
| `pnpm lint` | **PASS** |
| `pnpm format:check` | **PASS** |
| `pnpm typecheck` | **PASS** — все пакеты |
| `pnpm test` | **PASS** — API 50 + web 43 = 93 unit tests |
| `pnpm test:integration` | **PASS** — 15 tests / 3 files на Compose test PostgreSQL |
| `pnpm build` | **PASS** — contracts, NestJS, Next.js; protected routes dynamic SSR |
| `pnpm db:migrate` на существующей development БД | **PASS** — 1 новая M2 миграция; Crew сохранены |
| `pnpm db:seed`, затем повтор без SEED_PASSWORD | **PASS** — роли 1/1/40, 40 членств, min/max 4 сотрудника на команду, 10 команд |
| Реальный HTTP smoke через Next proxy | **PASS** — login/me, Cookie/Set-Cookie attributes, SSR role redirect, 403 чужому Origin и staff admin request, logout/clear/replay401 |
| Браузер: login, ADMIN backoffice/crew detail/accounts и logout на 390 px | **PASS** — живой API/БД, горизонтального overflow нет |
| Браузер: личный вход сотрудника и crew layout на 390 px | **PASS** — одна команда, четыре участника, без admin actions; overflow нет |
| Браузер: desktop 1280 px, staff → /backoffice и anonymous → /backoffice | **PASS** — redirects в /crew и /login; logout подтверждён |
| Статическая проверка browser storage / DataSource | **PASS** — localStorage/sessionStorage не используются; единственная фабрика new DataSource |
| Проверка финального client bundle на DB/seed passwords | **PASS** — 0 вхождений; существующий .env не изменён |

Integration проверяет правильный/неправильный login, 401/403/404, неизвестные и неполные
payloads, malformed JSON без отражения credentials, cookie/hash-only storage, expiry,
logout/replay, disabled/re-enabled пользователя, актуальную роль при прямом DB изменении,
membership change без logout, password/role revocation, rate limit и forged XFF,
конкурентное членство, недеструктивный повтор seed и сохранение истории контактов/команд.

Первый integration run выявил две проблемы: createdAt из DB transaction timestamp
отличался на 3 ms от JS точки расчёта expiry; исправлено вычислением обеих точек
от одного createdAt. Тест чужой команды ожидал 403, тогда как согласованная политика
скрывает её через 404; ожидаемый read-статус исправлен, запрет mutation остался 403.
Итоговый общий run — 15 PASS. Ручной HTTP smoke также учитывает streaming meta redirect
Next 16 (HTTP 200 с __next-page-redirect), а не предполагает обязательный HTTP 307;
фактические browser URL после redirect проверены отдельно.
При финальном сведении metadata был добавлен дублирующий Check import/decorator;
TypeScript обнаружил дубликат. Он удалён, затем API typecheck/build, общий lint
и format:check повторно прошли.

Скриншоты проверки: `.tmp/m2-browser/login-390.png`, `backoffice-390.png`,
`crew-390.png`, `crew-desktop.png` (игнорируются Git). Браузерная сессия завершена logout,
viewport восстановлен, временная вкладка закрыта. Dev API/web остановлены после проверки.
Существующие Compose `postgres` и `postgres-test` оставлены работающими; volumes не удалялись.

### Ограничения и пользовательская приёмка

Обязательные проверки M2 в этом запуске не BLOCKED. Для ручной приёмки пользователя:
запустить `pnpm dev`, войти demo.admin/demo.dispatcher/сотрудником, проверить сохранение
форм команд/контактов и ADMIN account edit/disable; использовать порядок из README.
Демопароль соответствует локальному файлу выше, новый SEED_PASSWORD не сбрасывает старые пароли.
Seed и тестовые данные вымышленные. Заказы/назначения/финансы/файлы не реализованы.

Лимитер in-memory рассчитан на один процесс; expired/revoked session retention и
production security/operations остаются вне M2. HTTPS/Secure-cookie production topology
документирована, production deploy не выполнялся. Следующий этап — только по отдельному запросу.

## 2026-10-25 / M1

### Что реализовано

- pnpm workspace: `apps/web` (Next App Router), `apps/api` (NestJS),
  `packages/contracts` (публичный health-контракт без серверных импортов).
- TypeScript strict, закреплённые прямые зависимости, Node 24.22.1 LTS,
  pnpm 10.34.8 и один lockfile. Lint, Prettier, typecheck, unit/integration tests, build.
- PostgreSQL Compose: loopback ports, persistent volumes, healthchecks,
  отдельный test service с отдельным портом/credentials/volume.
- TypeORM `synchronize: false`, entity Crew, миграция: UUID, unique stable code,
  name, active, INDOOR/OUTDOOR, service area, UTC instants (`timestamptz`), DB constraints.
- Отдельный транзакционный seed 10 вымышленных команд. Повторный и конкурентный
  запуск не меняет существующие записи; production запрещён.
- `GET /api/health`: настоящий `SELECT 1`, 200/503, no-store, без секретов/stack traces.
  API работает при первоначально выключенной БД и восстанавливает подключение.
- Responsive frontend: loading, API unreachable, database unavailable, success, retry;
  server-only `API_ORIGIN`, same-origin proxy, runtime-проверка ответа.
- Единая root `.env` загрузка для API, CLI, seed, integration tests и Next config.
  `.env.example` с placeholders, игнорируемый локальный `.env` со случайными credentials.
- README с первым запуском, миграцией, seed, проверками, остановкой и ручным smoke test.
  Выбранные версии и решения записаны в `docs/DECISIONS.md`.

M2 и следующие этапы не реализовывались. Публичного Crew CRUD нет.

### Сохранность исходного пакета

Папка первоначально содержала только документы и `.gitignore`; `.git` отсутствует.
`git status --short` / diff — **BLOCKED: not a git repository**, это не ошибка приложения.
До изменений сохранена копия в `/private/tmp/furniture-delivery-m1-original`.
Контрольные суммы исходных `AGENTS.md`, `START_HERE.md`, спецификации, domain rules,
milestones и prompts сохранены; `.gitignore` только дополнен `*.tsbuildinfo`.
Создание commit, push, deploy и инициализация Git не выполнялись.

### Изменённые файлы

- Новые `apps/api/**`, `apps/web/**`, `packages/contracts/**`.
- Новые root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
  `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`,
  `.npmrc`, `.nvmrc`, `.node-version`, `.env.example`, `docker-compose.yml`, `README.md`.
- Обновлены `.gitignore`, `docs/DECISIONS.md`, `docs/PROGRESS.md`.

### Фактические команды и результаты

Проверки выполнялись с временно установленными вне workspace Node **24.22.1** и
pnpm **10.34.8**. Системный Node 25.9.0 не использовался для итоговых проверок.
Сеть npm, локальные сокеты и PostgreSQL shared memory ограничены sandbox;
для необходимых install/DB/HTTP-проверок использованы точечные разрешения команд.

| Команда / проверка | Результат |
| --- | --- |
| `pnpm install` | **PASS** — зависимости реально установлены, итоговый lockfile соответствует manifests |
| `pnpm install --frozen-lockfile --offline` | **PASS** — lockfile актуален, установка без повторного разрешения версий |
| `pnpm lint` | **PASS** |
| `pnpm format:check` | **PASS** |
| `pnpm typecheck` | **PASS** — все три пакета |
| `pnpm test` | **PASS** — API 14 + web 13 = 27 unit tests |
| `pnpm build` | **PASS** — contracts, NestJS и Next.js production build |
| `pnpm db:migrate` | **PASS** — 1 миграция на свежей временной dev БД |
| `pnpm db:migrate` повторно | **PASS** — 0 миграций |
| `pnpm db:seed` дважды | **PASS** — оба запуска успешны; отдельный SQL count = 10 |
| `pnpm test:integration` | **PASS** — 3 теста на отдельной временной test PostgreSQL |
| `pnpm dev` | **PASS** — localhost 3000 и 3001, оба процесса запущены |
| Запуск собранных API/web с `NODE_ENV=production` | **PASS** — оба `start` работают; frontend HTTP 200 и proxy health 200 |
| Прямой `curl /api/health` на 3001 | **PASS** — 200, database=up |
| `curl /api/health` через Next на 3000 | **PASS** — 200, настоящий proxy → API → PostgreSQL |
| Ручной stop/start временной dev PostgreSQL | **PASS** — через Next 503 → 200 без перезапуска API; после рестарта SQL count Crew = 10 |
| Проверка client build на значения двух DB passwords | **PASS** — 0 вхождений |
| `docker compose version` / Compose startup | **BLOCKED** — `docker: command not found` |
| Браузерная визуальная проверка / телефон 390 px | **BLOCKED** — IAB недоступен, browser inventory пуст, native Chrome control завершился timeout; headless Chrome CLI завершился с кодом 134, screenshot не создан |

Первый unit run выявил timeout frontend hook: возвращённая mock-функция воспринималась
Vitest 4 как cleanup. Hook исправлен на void; итоговый полный run — 27 PASS.
Первоначальные EPERM на listen / PostgreSQL shared memory преодолены точечным разрешением;
соответствующие проверки затем реально выполнены, а не записаны как успех по предположению.
Для browser QA первая автоматическая проверка разрешений не завершилась до deadline
и отклонила открытие браузера. Повторный IAB оказался недоступен, native Chrome control
завершился timeout (339 секунд), headless CLI — exit 134. Это не подтверждение
визуального успеха; разрешений на дальнейшие обходы не запрашивалось.

### База данных и интеграционные сценарии

Docker в окружении отсутствует. Фактическая БД для проверок — **настоящий PostgreSQL 17.10**:
native binaries установлены только в `/private/tmp`, в dependency проекта их нет.
Два отдельных кластера и БД на loopback 5432/5433 используют разные credentials.
Это не запуск Compose image `postgres:17.11-alpine`.
После проверок процессы приложений и оба временных кластера остановлены,
данные кластеров не удалены; порты освобождены для локального запуска через Compose.

Интеграционные тесты подтвердили:

- миграция применима и повторяема;
- два конкурентных seed после правки команды сохраняют 10 записей, UUID,
  изменённые name/active/serviceArea и timestamps;
- новое соединение читает те же сохранённые изменения;
- PostgreSQL отклоняет duplicate code, пустое имя, неправильную workEnvironment и NULL serviceArea;
- production seed запрещён;
- один HTTP-процесс API возвращает **503 → 200 → 503 → 200** при настоящем отсутствии,
  восстановлении и разрыве соединения через TCP tunnel; health не подменён mock-ответом;
- бизнес-эндпоинт `/api/crews` отсутствует (404).

### Оставшаяся локальная приёмка

M1 не объявляется полностью принятым из-за BLOCKED Compose и browser проверок. Необходимо:

1. Установить/запустить Docker и выполнить последовательность из README на свежих volumes:
   `docker compose up -d --wait postgres`, `pnpm db:migrate`, дважды `pnpm db:seed`.
2. Проверить сохранение 10 команд и ручной правки после перезапуска Compose service/volume.
3. Поднять `docker compose --profile test up -d --wait postgres-test`, выполнить
   `pnpm test:integration` на PostgreSQL **17.11** из Compose.
4. Проверить frontend при stop/start PostgreSQL и API по smoke test из README.
5. В браузере проверить loading, оба вида ошибки, Retry и телефон 390 px без
   горизонтального скролла. Эти состояния проверены unit-тестами, но визуально не приняты.

Следующий согласованный шаг — локальная приёмка M1. Переход к M2 требует отдельного запроса.
