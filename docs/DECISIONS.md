# Решения и допущения

## Принятый архитектурный вариант

**Один pnpm monorepo, один Next.js frontend, один модульный NestJS backend, PostgreSQL/TypeORM.**
Frontend содержит `/backoffice/...` и `/crew/...`, отдельные layout и navigation.
В Next.js route groups могут использоваться для layout, но видимые URL должны быть явными.
Next.js и NestJS — разные запускаемые приложения; monorepo не означает один процесс.
Backend остаётся одним приложением, не набором микросервисов.
Turborepo не обязателен для первого этапа.

## Контракты

`packages/contracts` содержит transport types и разрешённые публичные enum.
Backend использует DTO/runtime-валидацию и явное отображение entity → response.
Не отдавать entity автоматически и не импортировать её в web.
В M1 достаточно контракта health. Не проектировать весь SDK заранее.

## Хранение и транзакции

Миграции с первого этапа, `synchronize: false`.
Резервирование и перепланирование атомарны и защищены от конкуренции.
Платёжный журнал — отдельные записи, не редактируемый вручную paymentStatus.
Фото для локального демо можно хранить на диске через storage adapter;
публичное directory listing и неавторизованный доступ запрещены.

## Временные допущения, не подтверждённые заказчиком

| Вопрос | Предложение для MVP |
| --- | --- |
| UI-язык | Английский; подготовить удобные для замены labels |
| Бизнес-зона | Europe/Rome |
| Валюта | EUR, integer cents |
| Размер демо | 10 команд × 4 сотрудника |
| Рабочий день демо | Пн–Пт 08:00–18:00; настраиваемо |
| Буфер переезда демо | 30 минут; настраиваемо, не реальное ETA |
| Членство | Не больше одной активной команды на сотрудника |
| Разделение команды | Не поддерживается; команда бронируется целиком |
| Команды визита | Все работают в одном окне; разное окно — отдельный Appointment |
| Внешние специалисты | Контакты без аккаунта; отдельное планирование их загрузки вне MVP |
| Цена заказа | Вручную введённая итоговая сумма, без налогового расчёта |
| Задолженность | Не блокирует фиксацию физического выполнения |
| Новый слот клиента | Требует подтверждения; незавершённое согласование видно диспетчеру |
| Issues | Отдельная сущность и фильтр, не один взаимоисключающий общий статус |

## Календарь

Для MVP — стандартный day/week календарь, список и фильтры команд.
FullCalendar resource/timeline views относятся к Premium с отдельной лицензией.
Не использовать trial как неоговорённую зависимость коммерческого продолжения проекта.
Выбор точного календарного компонента и лицензии принять в M4 и записать здесь.

## Аутентификация

В M2 выбраны серверные PostgreSQL sessions с opaque token в HttpOnly cookie;
подробная политика expiry/revocation, CSRF и proxy зафиксирована ниже.
Проверки прав выполняет NestJS на каждом запросе; Next.js layouts и скрытие кнопок
служат интерфейсом, а не заменой backend authorization.

## Дальнейшие записи

При изменении решения добавлять: дата, контекст, решение, последствия и затронутые тесты.
Версии зависимостей документировать после реального выбора и установки, а не из предположений.

## 2026-10-25 / M1 — версии и запуск

Установлен и проверен следующий набор (все прямые зависимости закреплены без `latest`,
в workspace один `pnpm-lock.yaml`):

| Компонент | Версия |
| --- | --- |
| Node.js LTS | 24.22.1; `.nvmrc`, `.node-version`, `engines` |
| pnpm | 10.34.8; `packageManager`, `engines` |
| Next.js / React / React DOM | 16.4.3 / 19.3.1 / 19.3.1 |
| NestJS common/core/platform-express | 11.2.8 |
| TypeORM / pg | 0.3.31 / 8.16.3 |
| TypeScript | 5.9.3 |
| ESLint / typescript-eslint | 10.13.0 / 8.72.0 |
| Vitest / jsdom | 4.1.12 / 30.1.3 |
| Prettier | 3.6.2 |
| Docker PostgreSQL | `postgres:17.11-alpine` |

Совместимость сверена по npm registry (`engines`, `peerDependencies`, stable tags),
[Node release policy](https://github.com/nodejs/Release),
[Next installation](https://nextjs.org/docs/app/getting-started/installation),
[Nest 11 manifest](https://raw.githubusercontent.com/nestjs/nest/v11.2.8/packages/core/package.json),
[TypeORM manifest](https://raw.githubusercontent.com/typeorm/typeorm/0.3.31/package.json),
[typescript-eslint manifest](https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.72.0/packages/typescript-eslint/package.json),
[Vitest manifest](https://raw.githubusercontent.com/vitest-dev/vitest/v4.1.12/packages/vitest/package.json),
[pnpm support policy](https://github.com/pnpm/pnpm/security) и
[Docker official images](https://raw.githubusercontent.com/docker-library/official-images/master/library/postgres).
Nest 11 и TypeORM 0.3 выбраны в актуальных stable patches своих предыдущих major-веток:
они совместимы с CommonJS, legacy decorators и не требуют перехода на Nest 12 / TypeORM 1.
TypeScript 5.9 совместим с обоими и текущим lint tooling. pnpm 10 выбран в поддерживаемом
текущем patch; предварительно рассмотренные устаревшие lint/test версии заменены до итоговой проверки.
Фактические install, lint, typecheck, tests и build выполнены на Node 24.22.1.

### Модули, health и окружение

- Без Nest CLI, Turborepo и дополнительного framework package: Nest собирается `tsc`,
  dev/DB-команды выполняются через `tsx`. DI использует явный `@Inject`, типы колонок заданы явно.
- API загружает корневой `.env` из одного config-модуля независимо от cwd и src/dist.
  Next загружает тот же файл в server-only config; process env имеет приоритет.
  Password placeholders отклоняются. Приватные переменные не используют `NEXT_PUBLIC_`.
- Браузер вызывает same-origin `/api/health`; Next rewrite использует server-only `API_ORIGIN`.
  Endpoint не кэшируется. Runtime guard frontend проверяет HTTP-статус и структуру ответа.
- TypeORM DataSource инициализируется лениво с общим promise для параллельных health-запросов.
  Это позволяет запустить API при выключенной БД, вернуть 503 и восстановиться без рестарта.
  SQL, параметры и сырые ошибки соединений не логируются. Прямые тесты проверяют `SELECT 1`.
- Seed отдельно от boot/migrations: транзакционный `ON CONFLICT (code) DO NOTHING`,
  без обновления существующих записей, разрешён только в development/test.
- Интеграционные тесты требуют все `TEST_DATABASE_*`, `NODE_ENV=test` и отдельную `_test` БД;
  создают случайную схему и очищают только её. Настроен отдельный Compose service/volume.
  Сетевой сбой проверяется настоящим TCP tunnel, без подмены DB/health моками.
- Автогенерация Next agent rules отключена документированной опцией `agentRules: false`:
  `next dev` не должен изменять исходные инструкции проекта.

### Ограничение проверочного окружения

Docker отсутствует. Для проверок вне workspace временно установлены native binaries
PostgreSQL **17.10** (`@embedded-postgres/darwin-x64@17.10.0-beta.17`, wrapper package с beta-tag,
сама БД — стабильный PostgreSQL). Это не dependency проекта и не замена PostgreSQL другим движком.
Два независимых кластера в `/private/tmp` слушают loopback 5432 и 5433; credentials только в
игнорируемом `.env` / приватных временных файлах. Применение Compose с PostgreSQL **17.11**
и его persistent volume остаётся отдельной локальной проверкой; native проверки её не заменяют.

## 2026-10-25 / M2 — PostgreSQL sessions и актуальные права

M1 принят пользователем перед началом M2. Зафиксированные версии M1 не менялись;
новых зависимостей M2 не потребовал. Для auth используется тот же `DatabaseService`
и его lazy `getDataSource()`, что и для health/команд. Вторая независимая auth-БД,
DataSource, Redis или frontend-хранилище не создавались.

### Пароли и сессии

- Пароли: async Node.js scrypt, N=131072 (2^17), r=8, p=1, random salt 16 bytes,
  key 32 bytes, maxmem 192 MiB; постоянное по времени сравнение. Допускается только
  реализованный формат хеша. Два вычисления одновременно, очередь не больше 16,
  чтобы ограничить память. Параметры соответствуют
  [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt);
  API и memory limits проверены по [Node 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
- Каждая сессия получает `randomBytes(32).toString('base64url')`. Cookie содержит
  исходный token, БД — только SHA-256 tokenHash (unique, не выбирается по умолчанию).
  User.passwordHash также `select:false`. JSON отображается явно через публичные контракты.
- Cookie `fd_session`: HttpOnly, SameSite=Lax, Path=/, host-only (без Domain),
  Secure по умолчанию в production. TLS обязателен для production login; local demo
  запускается в development/test. Cookie не сохраняется в localStorage/sessionStorage.
- Абсолютный TTL по умолчанию 8 часов, настраивается `SESSION_TTL_SECONDS` (1–604800).
  createdAt/expiresAt вычисляются из одной временной точки. На каждом запросе API
  проверяет expiry, revokedAt и текущую активность пользователя; sliding expiry нет.
- Успешный login выдаёт новый token; если запрос принёс предыдущую сессию, она отзывается
  в той же транзакции. Logout записывает revokedAt и очищает cookie с теми же attributes.
  Повтор cookie после logout/expiry возвращает 401. Сессии переживают рестарт API.
  Автоматическая очистка старых отозванных записей не входит в M2; без отдельной
  retention/эксплуатационной политики система не считается production-ready.

Политика основана на [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies).

### CSRF, Origin и Next proxy

Все бизнес-обработчики защищены глобальным guard по умолчанию. Исключения — явные
`@Public` health и login. Проверка unsafe HTTP методов выполняется даже для login:
точное равенство Origin настроенному `WEB_ORIGIN` плюс `X-CSRF-Protection: 1`.
Отсутствующий Origin и `Origin: null` не разрешены. SameSite служит дополнительным
барьером; сам по себе не заменяет Origin/header проверку. У GET нет побочных эффектов.
См. [OWASP CSRF custom headers](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi)
и [Origin checks](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#using-standard-headers-to-verify-origin).

Браузер отправляет same-origin запросы на Next `/api/:path*`; штатный rewrite передаёт
Cookie/Set-Cookie и исходный Origin в NestJS. `API_ORIGIN` остаётся server-only.
SSR layouts передают только fd_session в `/auth/me`, читают свежую сессию с no-store
и выбирают интерфейс/redirect. API независимо проверяет каждый запрос и запись.
Ответы API не кэшируются, неожиданные ошибки/JSON parser errors не раскрывают SQL,
stack traces или фрагменты credentials. CORS не включён; wildcard credentials не используются.

Login limiter: in-memory fixed window, default 10 попыток/аккаунт/60 секунд и
100/socket IP/60 секунд, Retry-After при 429. Имена аккаунтов в ключах хешируются;
не больше 2000 buckets с удалением истёкших. X-Forwarded-For не используется как доверенный
адрес: через Next socket IP общий, лимит аккаунта независим. Это политика одного
процесса MVP, счётчики сбрасываются при рестарте. Пароль отсутствующего/disabled аккаунта
не проверяется быстрым обходом scrypt; ответ неверного входа одинаковый.

### Права, история и seed

Роль и активное членство читаются из БД на каждом запросе. Через ADMIN смена active,
роли или пароля отзывает все сессии пользователя в транзакции; повторное включение
не воскрешает старые cookies. Смена роли на не-CREW_MEMBER отключает активное членство.
Членство меняется без logout, `/auth/me` и crew reads сразу видят новое состояние.
Даже прямое изменение роли в БД не оставляет права старого token: роли в token нет.

ADMIN управляет аккаунтами. ADMIN/DISPATCHER читают и редактируют команды/состав/контакты;
CREW_MEMBER читает только команду своего текущего активного CrewMember. Disabled Crew
остаётся видна её текущим участникам для истории, но новых активных участников в неё
не добавляют. Наличие недоступной записи не раскрывается (404); запрет действия — 403.
UI скрывает чужие действия, backend остаётся обязательной проверкой.

CrewMember — связь, не команда. DB partial unique index по user_id WHERE active=true
плюс транзакционные блокировки User → Crew предотвращают конкурентное двойное членство.
Роль/active пользователя меняются под тем же User lock. Crew, membership и external
contacts физически не удаляются через API. Внешний контакт не получает аккаунт.

Seed создаёт 1 admin, 1 dispatcher, 40 отдельных сотрудников и 40 членств в 10 командах.
`SEED_PASSWORD` нужен только при создании отсутствующих аккаунтов; каждый хеш получает
свою соль. Существующие username/пароли/роли/disabled-состояния и ручные переносы или
отключения членства не исправляются seed. Пользователь и первое членство создаются в
одной транзакции; повторный seed не восстанавливает намеренно снятое членство.
Production seed запрещён до подключения к БД.
