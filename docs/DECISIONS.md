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

## 2026-10-25 / M3 — заказы и ручной журнал платежей

M2 принят пользователем явным сообщением перед M3. Архитектура, auth/CSRF/Origin,
Next proxy, версии и единственный DataSource factory сохранены. Новых зависимостей нет.
Миграция `CreateOrders1792886402000` добавляет `delivery_order`, `order_item`, `payment`,
`activity_log` и sequence; ранее применённые миграции не изменяются.

### Заказ, позиции и валидация

- Номер `ORD-<n>` формирует PostgreSQL sequence, UNIQUE проверяется БД. Конкурентное
  создание безопасно; пропуски после rollback/повторного seed допустимы.
- Контакты и адрес — снимок внутри заказа. Обязательны customerName, 1–5 phoneNumbers,
  address, city, country, serviceType, workDescription, estimatedDurationMinutes,
  orderTotalCents и 1–100 items. Остальные текстовые поля nullable либо пустая строка.
  hasElevator/easyAccess/parkingAvailable — `true | false | null`; null означает неизвестно.
- Пределы: имена 200, телефон 40, email 254, address 500, city/country 120,
  postalCode 24, floor 40, workDescription/access/internal/crew notes 4000 символов.
  Длительность 1–10080 целых минут. Item: description 1000, configuration/notes 2000,
  ambient 120, quantity 1–10000, sortOrder 0–9999; номера порядка уникальны в форме.
- DELIVERY_ONLY запрещает requiresAssembly=true. DELIVERY_AND_ASSEMBLY допускает
  товары со сборкой и без неё. Нет цен товаров и вычисления стоимости из позиций.
- PATCH частично меняет поля, а переданный items заменяет весь активный состав.
  Пропущенные старые позиции получают active=false; чужие/снятые ID отклоняются.
  Позиции и заказ изменяются атомарно. Нет Customer CRUD, загрузок и физического DELETE.
- Строгие runtime parsers отклоняют неизвестные поля, ID/авторов/даты/финансовые итоги
  из payload. TypeScript contracts не заменяют эти проверки.
- Progress в ответах — read-only `INBOX`; в таблице нет произвольного status patch,
  scheduledStart или crew assignment. Оплата не означает операционное завершение.

### Суммы, даты, блокировки и версии

Одна сумма заказа/платежа ограничена **2 000 000 000 integer EUR cents**
(€20 000 000), что помещается в PostgreSQL integer и безопасный JavaScript integer.
Total допускает ноль, платёж строго положителен. Ограничение действует в DTO и CHECK БД.
`SUM(integer)` PostgreSQL возвращает bigint: decimal string переводится через BigInt,
проверяется относительно Number.MAX_SAFE_INTEGER, затем преобразуется в Number.
Агрегаты всего dashboard могут превышать лимит одной записи, но не safe integer range;
переполнение явно отклоняется, без округления. UI разбирает евро как строку цифр,
без промежуточного floating point умножения; максимум два дробных знака, точка или запятая.
Форматирование агрегатов также целочисленное: BigInt quotient/remainder и Intl parts,
без `Number(cents) / 100`, чтобы не терять последний цент у больших safe integer сумм.

Paid — только сумма RECORDED, balance=total−paid, paymentStatus вычисляется сервером.
При total=0 статус NOT_REQUIRED, иначе UNPAID/PARTIALLY_PAID/PAID по paid.
Переплата, отрицательные/дробные суммы и total ниже paid запрещены.
paidOn — PostgreSQL date, действительная дата YYYY-MM-DD 1900–9999, отдельно от UTC
createdAt/voidedAt; показ времени истории — Europe/Rome. CARD — ручная отметка,
эквайринга, карточных реквизитов и возвратов нет.

Все записи в существующий заказ выполняются в транзакции **READ COMMITTED**:
сначала `SELECT ... FOR UPDATE` родительского Order, затем текущие товары/журнал,
проверка инвариантов, изменения, ActivityLog и commit. Единственный порядок блокировок:
Order → его дочерние записи. Используются только repositories текущего manager.
Новая строка заказа/seed aggregate также создаётся и инициализируется одной транзакцией.
Это соответствует [PostgreSQL row-level locking](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS)
и [TypeORM transactions](https://typeorm.io/docs/advanced-topics/transactions/).

PATCH требует expectedVersion и сравнивает её уже под Order lock. Устаревшая форма — 409
без изменений и истории. Успешный PATCH (включая items), новый платёж и первый VOID
увеличивают version на один; начальное создание — version=1. Replay платежа/VOID не
увеличивает version и не меняет автора/время. UI предлагает перечитать текущий заказ.
Detail/list/dashboard читаются транзакцией REPEATABLE READ: ответы не смешивают разные
состояния заказа/журнала между SELECT.

### Идемпотентность, VOID и история

Payment имеет unique `(order_id,idempotency_key)`. Ключ — 8–100 букв/цифр/`_`/`-`,
scope одного заказа. SHA-256 fingerprint строится из нормализованного набора
amountCents/paidOn/method/note; пустая/отсутствующая note равнозначны null.
Ключ и fingerprint не входят в публичный response. Авторизация проверяется до операции.

Под Order lock сначала ищется ключ. Совпавший fingerprint возвращает **актуальную**
запись и текущие итоги заказа, до повторной проверки доступного остатка. Другой payload — 409.
Это действует и после VOID: старый ключ возвращает VOIDED, не создаёт новую оплату.
Сумма/дата/метод исходного платежа неизменяемы. Исправление — VOID с обязательной причиной
и новым платежом с новым ключом. Повтор VOID возвращает прежнюю запись, сохраняя исходную
причину и автора. VOID исправляет журнал, а не отправляет возврат денег.

Frontend хранит попытку только в памяти: один randomUUID и замороженный payload,
синхронная защита от двойного submit. Сетевая ошибка/5xx сохраняет их для Retry.
Намеренно новая операция после неизвестного результата требует успешного GET журнала.
Неудачный GET не теряет прежний ключ. После reload сначала загружается карточка/журнал;
никаких токенов, ключей или форм в localStorage/sessionStorage нет.

ActivityLog записывает action, actorId, orderId, targetId, UTC instant, reason и минимальные
changes (имена изменённых полей, version, количество или сумму), без полного request body.
Успех и история коммитятся вместе; ошибка audit откатывает бизнес-операцию.
Нет публичных mutation endpoints истории, физического удаления платежей и event sourcing.

### API, dashboard и доступ

Все новые маршруты доступны только ADMIN/DISPATCHER, включая чтение:

| Метод и путь под `/api` | Ответ / назначение |
| --- | --- |
| GET `/orders` | `{ orders, total, page, pageSize }`; search/serviceType/paymentStatus/page/pageSize |
| POST `/orders` | `{ order }`, HTTP 201 |
| GET `/orders/:id` | `{ order }`, включая активные items, payments и activity |
| PATCH `/orders/:id` | `{ order }`, expectedVersion обязателен |
| POST `/orders/:id/payments` | `{ payment, order }`; idempotencyKey обязателен |
| POST `/orders/:id/payments/:paymentId/void` | `{ payment, order }`; reason обязателен |
| GET `/dashboard` | inboxCount/orderTotalCents/paidCents/balanceCents/currency |

CREW_MEMBER получает 403 на каждый новый endpoint, без финансовых/внутренних данных.
SSR backoffice сохраняет redirect в /crew; его интерфейс M2 остаётся прежним.
Принадлежность вложенного платежа/товара проверяется сервером. CSRF/Origin и актуальные
роль/active проверяются существующим M2 guard, в том числе при replay.

Поиск — escaped ILIKE substring номера/клиента/города. Сортировка createdAt DESC, id DESC,
offset pagination; API page1..1000000, pageSize1..100 (default20), UI10/25/50(default10).
Total списка относится ко всему набору с фильтрами. Dashboard относится ко **всем** заказам,
независимо от фильтров и текущей страницы. Суммы заказов и платежей считаются отдельно,
без JOIN с items; это журнал и обязательства, не бухгалтерская выручка.
После mutation detail получает canonical response, list/dashboard перечитываются
по локальному событию и focus; WebSockets не добавлялись.

### Недеструктивный seed и проверка

10 demo orders создаются по private unique seedKey. Только успешная вставка нового
Order разрешает инициализировать его items/payments/history. Конкурирующий seed ждёт
unique constraint и пропускает уже существующий aggregate целиком. Ручные правки,
стоимость, снятые позиции, VOIDED, версии и история не восстанавливаются поверх данных.
Существующий demo.dispatcher используется как автор, его аккаунт не меняется.
Production guard действует до подключения; seed не запускается при boot/migrations.

На свежем M3 seed: 10 Inbox orders, 20 items, 9 payments (8 RECORDED + 1 VOIDED),
3 UNPAID / 3 PARTIALLY_PAID / 2 PAID / 2 NOT_REQUIRED. Повтор не добавляет историю.
Фактические результаты команд, конкурентных тестов и browser smoke — в PROGRESS;
приёмка пользователя M3 записывается только после отдельного подтверждения.

## 2026-10-25 / M4 — визиты, команды и ручное планирование

Пользователь явно принял M3 и отдельно разрешил M4. Решения ниже конкретизируют MVP,
а не являются новыми подтверждёнными требованиями работодателя. M4 реализует только
планирование: без выполнения crew, actual times, issues, файлов, подписей, рекомендаций
свободных слотов, автоматического переноса, уведомлений или realtime. Пользовательская
приёмка M4 требует отдельного подтверждения; результаты проверок записываются в PROGRESS.

### Данные и границы модулей

Миграция `CreatePlanning1792886403000` добавляет `appointment`, `crew_assignment`,
`task_template`, `task`, `crew_planning_config`, `crew_unavailability` и расширяет CHECK
допустимых действий существующего ActivityLog. Уже применённые миграции не меняются;
старые таблицы/строки заказов, товаров, платежей и истории не пересоздаются.
Используются прежние DatabaseService/DataSource factory, `synchronize: false`, PostgreSQL
sessions, глобальная backend authorization, Origin/CSRF guard и same-origin Next proxy.
Contracts остаются браузерными типами без entities; зависимости типов направлены
`service-types → planning → orders`, без циклических импортов.

Order остаётся обязательством перед клиентом; Appointment принадлежит Order и хранит
собственное окно, notes и version. Статус M4 — SCHEDULED/CANCELLED, отдельно от
NEEDS_CONFIRMATION/CONFIRMED. Наличие назначенной команды не означает подтверждения
клиента. Допускается несколько визитов одного заказа и визит без команды (Unassigned).
Unassigned не резервирует Crew; назначенный NEEDS_CONFIRMATION резервирует ресурс.
Прошедшее плановое время само по себе не означает начала работ, завершения или отмены.

CrewAssignment содержит snapshot travelBufferMinutes и статус ASSIGNED/CANCELLED.
Partial UNIQUE допускает только одно активное назначение пары appointment/crew.
Снятие сохраняет причину, автора, время и задачи. Повторное добавление снятой команды
создаёт новое назначение; перенос с неизменной командой сохраняет assignment ID.
Клиент и финансовые поля в назначения не копируются.

TaskTemplate имеет stable code, name/description, active/required, severity,
defaultPriority и applicability ALL/DELIVERY_ONLY/DELIVERY_AND_ASSEMBLY. При назначении
сервер добавляет обязательные подходящие active-шаблоны и выбранные optional-шаблоны.
Task копирует name/description/required/severity/priority; исходный templateId — только
происхождение. Изменение/отключение каталога не меняет старые snapshots и не добавляет
новые задачи существующим назначениям. Перенос времени не регенерирует задачи.
Разрешены смена severity/priority, добавление из подходящего шаблона и логическое снятие
optional-задачи. Required snapshot удалить нельзя, в том числе через прямой payload.
Сборка применяется к новым назначениям только для DELIVERY_AND_ASSEMBLY. Старые snapshots
после смены услуги не переписываются молча: диспетчер пересматривает состав и задачи.
Выполнение/checklist API и UI в M4 отсутствуют.

### Время, рабочие окна и резерв

Вход времени визита — `localStart` вида YYYY-MM-DDTHH:mm в **Europe/Rome** плюс
`durationMinutes`. Сервер определяет canonical plannedStartAt/plannedEndAt и возвращает
ISO UTC с Z; независимый end из payload не принимается. Оценка длительности Order
подставляет первоначальное значение формы, но не изменяет уже сохранённое окно.
Длительный заказ диспетчер явно делит на несколько визитов; автоматического обрезания нет.

Luxon выполняет строгий переход local → UTC: проверяются формат, действительная дата,
обратное совпадение wall time и единственный возможный offset. Нормализованный DST gap
и неоднозначный fold отклоняются до проверки доступности. Выбор первого offset и
фиксированная таблица UTC+1/UTC+2 не используются. UI и календарь показывают ту же
бизнес-зону независимо от timezone устройства. Сутки/недели строятся как местные даты,
затем переводятся в UTC; «следующий день» не равен безусловному UTC +24 часа.
См. [Luxon DateTime API](https://moment.github.io/luxon/api-docs/index.html#datetimegetpossibleoffsets)
и [FullCalendar named time zones](https://fullcalendar.io/docs/timeZone).

Weekly windows — local HH:mm и ISO weekday 1–7; день может быть выходным или иметь
несколько непересекающихся окон с перерывом. Окно не пересекает полночь. Начальные
defaults: Пн–Пт 08:00–18:00 и buffer 30 минут; суббота/воскресенье редактируются через UI.
Визит и весь резерв должны помещаться в одном окне одной местной даты. Ночные смены
и многодневный визит отклоняются. Датированная недоступность может длиться несколько дней.

Резерв каждой команды — **[start, end + её snapshot buffer)**. Проверяются полные
резервы обеих сторон: новый визит до существующего тоже учитывает свой buffer.
Общая граничная точка разрешена. Резерв целиком, включая buffer, должен помещаться в
рабочее окно и не пересекать активную недоступность. Исключения для последнего визита
дня нет. Buffer — фиксированное допущение, не вычисленное дорожное ETA; UI отличает
его от времени у клиента. Новые defaults влияют только на новые назначения; сохранённый
buffer остаётся прежним при переносе и правке конфигурации команды.

Изменение окон, запись отсутствия и отключение Crew разрешены даже после бронирования.
Они не двигают/удаляют старые визиты и не освобождают резерв. По текущей доступности
сервер вычисляет Needs attention: inactive crew, выход за окно, недоступность или конфликт
резервов. Это предупреждение, не execution status и не установленное опоздание.
Новые/изменяемые резервы проверяются заново; metadata-only правка notes не требует
сначала устранить старое предупреждение. Для исправления нужна явная отмена/переназначение.

GET конфигурации не пишет данные. Если Crew создан внешним SQL без config, ответ
содержит виртуальные defaults с version=0; первая явная правка сохраняет config.
Обычное создание Crew через M2, миграция существующих Crew и seed создают отсутствующий
config с version=1. Пользовательский config не заменяется defaults.

### Транзакции, повтор запросов и версии

Все изменения планирования выполняются через transaction manager существующего
DataSource в **READ COMMITTED**. Порядок явных row locks: Order → существующий
Appointment → объединение старых и новых Crew по отсортированным ID. После ожидания
Crew locks заново читаются committed-резервы, конфигурация и недоступность. Чужие
Order/Appointment строки при проверке конфликтов не блокируются. Один конфликт
откатывает весь многокомандный визит вместе с назначениями, задачами, версиями и audit.
Это сериализует бронирования одной Crew даже у разных Order; одного Order lock для
этого недостаточно. Основа — [PostgreSQL explicit row locking](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS).

Доступность держит Crew lock и не берёт после него Order/Appointment locks; affected
visits читаются для вычисляемых предупреждений. Каталог имеет собственные metadata.
Порядок M2 User → Crew при членстве сохраняется; обратный прикладной Crew → User lock
не добавлен. Seed config также блокирует Crew. Read detail/list/calendar используют
REPEATABLE READ для согласованного снимка, новые business/audit записи коммитятся вместе.

Создание Appointment имеет unique `(order_id,idempotency_key)` и SHA-256 fingerprint
нормализованного localStart/duration/отсортированных crewIds/templateIds/notes. Изменяемые
defaults, текущий текст шаблонов и buffer не входят в fingerprint запроса. Под Order lock
сначала проверяется существующий ключ, до повторной проверки свободного окна. Тот же
payload возвращает текущий визит, даже CANCELLED; другой payload — 409
IDEMPOTENCY_CONFLICT. Replay не создаёт назначения, задачи, версии или историю заново.
Ключ/fingerprint не входят в публичные response DTO.

В UI одна попытка создания держит frozen payload и ключ только в памяти. Retry после
сети/5xx отправляет их же; новый запрос требует успешного чтения текущих визитов.
Неудачное чтение не теряет ключ. Закрытие формы заблокировано при ожидающем/неизвестном
результате. После reload сначала читаются persisted данные; browser storage не используется.

Appointment имеет собственную optimistic version. Изменения времени/команд/задач,
подтверждение и первая отмена проверяют expectedVersion после row lock. Effective mutation
повышает Appointment.version и Order.version один раз; no-op/replay не повышает.
Новый платёж/VOID сохраняют прежнюю политику Order.version, но не меняют Appointment.version.
Поэтому поступление платежа не делает форму переноса устаревшей. Appointment responses
включают canonical `{ appointment, order }` после mutation, а не старый снимок M3.

Повтор отмены уже CANCELLED возвращает текущее состояние даже со старой expectedVersion,
сохраняя первоначальные reason/author/time и единственный audit. Другие stale формы дают
409 STALE_APPOINTMENT_VERSION. Конфликты расписания имеют отдельный устойчивый code и
безопасные crewId/appointmentId/from/to; сырые SQL/stack/credentials не отражаются.
При неизвестном результате изменения UI предлагает прочитать визит и не подставляет
автоматически новую version в старый payload. Черновики сохраняют исходный snapshot;
незавершённые confirm/cancel не позволяют открыть другой editor и потерять его draft.

### Подтверждение клиента и изменение условий Order

Создание — NEEDS_CONFIRMATION. Подтверждение — отдельное действие по показанной version
с серверным автором/временем, без отправки клиенту email/SMS. Изменение начала или конца
атомарно очищает confirmation metadata; прежнее согласование остаётся в ActivityLog.
Смена только команды не сбрасывает согласованное клиентское время — это допущение M4.
Перенос/смена команд требуют причину. Неудачная операция сохраняет прежнее состояние целиком.

M3 Order mutation под прежним Order lock сбрасывает confirmation активных CONFIRMED
визитов, повышает их версии и пишет CONFIRMATION_RESET в той же транзакции при изменении:
address/city/country/postalCode/serviceType/workDescription/floor/hasElevator/easyAccess/
parkingAvailable/accessRestrictions/accessNotes, либо состава товаров, description,
quantity, configuration, ambient или requiresAssembly. Время, назначения и snapshots
автоматически не меняются. UI просит пересмотреть длительность/задачи и согласовать визит снова.
Цена, платёж, VOID, internalNotes/crewNotes, item.notes, Appointment.notes и
перестановка sortOrder/priority сами по себе confirmation не сбрасывают. Правка estimatedDurationMinutes не переносит сохранённые окна; UI предупреждает
о самостоятельной проверке существующих визитов. M3 expectedVersion не ослаблен.

### API, limits и доступ

Все маршруты M4 пока только ADMIN/DISPATCHER, включая GET. Сохраняются текущие role/active
и CSRF/Origin проверки; CREW_MEMBER получает 403 и свой прежний M2-интерфейс. Вложенные
Appointment/Assignment/Task IDs проверяются на принадлежность указанному заказу/визиту.
Новые backoffice contracts не служат будущим crew API и не раскрываются ему временно.

| Метод и путь под `/api` | Назначение |
| --- | --- |
| GET/POST `/orders/:orderId/appointments` | Все визиты заказа / создание с idempotencyKey |
| GET/PATCH `/orders/:orderId/appointments/:id` | Детали / изменение с expectedVersion |
| POST `/orders/:orderId/appointments/:id/confirm` | Подтвердить текущую version |
| POST `/orders/:orderId/appointments/:id/cancel` | Отмена с expectedVersion и reason |
| GET `/planning/calendar` | Полный диапазон и явные фильтры команд/Unassigned |
| GET/PATCH `/crews/:crewId/planning` | Окна/buffer/предупреждения / правка с expectedVersion |
| POST `/crews/:crewId/unavailability` | Запись отсутствия из localStart/localEnd/reason |
| PATCH `/crews/:crewId/unavailability/:id` | Правка или active=false без hard delete |
| GET/POST `/task-templates` | Каталог / создание шаблона |
| PATCH `/task-templates/:id` | Редактирование/отключение без hard delete |

Runtime limits: годы 1900–9999; visit duration 1–1440 целых минут и одна местная дата;
buffer 0–180; максимум 49 weekly windows, 50 crew IDs и 50 assignment edits,
100 selected templates и не более 100 итоговых task snapshots на назначение.
Priority 0–9999; template code 3–64 uppercase letters/digits/`_`/`-`, name 1–200,
description/appointment notes до 4000, причины 1–1000 символов. Дубликаты IDs,
неизвестные/protected fields, снятые task IDs, inactive/неподходящие новые шаблоны
отклоняются. Применимые числовые/enum/unique/FK ограничения закреплены в БД.

Calendar query: from/to — Rome YYYY-MM-DD или ISO UTC instants с Z, диапазон [from,to)
не больше 42 местных дней. Пересечение выбирается как start < to AND end > from.
`allTeams=true|false` задаётся явно; конкретные crewIds передаются через запятую и
не совмещаются с All teams. Пустой конкретный набор означает отсутствие выбранных команд,
а includeUnassigned — отдельный переключатель (по умолчанию true). Неизвестный crew ID —
ошибка. OR выбранных Crew реализуется через EXISTS: многокомандный визит возвращается
один раз. До 1000 визитов диапазон возвращается целиком; больше — явный 409
CALENDAR_RANGE_TOO_BUSY с просьбой сузить диапазон. Первые страницы orders не заменяют
источник календаря, молчаливого усечения событий нет.

Order.progress вычисляется по всем SCHEDULED визитам: нет активных → INBOX; есть хоть
один без ASSIGNED назначения → PLANNED; у каждого есть назначение → ASSIGNED.
Confirmation и Needs attention независимы. Отмена последнего активного визита возвращает
INBOX, прошедшее время не даёт COMPLETED. Список имеет серверный progress-фильтр;
dashboard показывает согласованные глобальные inbox/planned/assigned counts.
Финансовые суммы M3 по-прежнему считаются по Order и RECORDED Payment отдельно, без
размножения JOIN на appointments/assignments/tasks. Фильтры списка/календаря не меняют их.

### Backoffice, календарь и зависимости

`/backoffice/planning` использует Day/Week TimeGrid и List, Today/навигацию/дату,
All teams, конкретный multi-select и Unassigned. На телефоне исходно List. Событие
содержит номер/клиента/город/окно/названия команд/confirmation/attention; многокомандный
визит — одно событие. Полный список диапазона доступен отдельно от наложений сетки.
Buffer показан отдельно от customer window. Event click открывает карточку
`/backoffice/planning/orders/[orderId]/appointments/[id]`. Создание доступно из заказа;
карточка Order содержит визиты, а Crew — доступность; TaskTemplate редактируется отдельно.
Drag-and-drop, resize и crew execution выключены. После commit выполняются refetch,
явный Refresh и focus; поздний ответ старого диапазона не подменяет новый календарь.

Добавлены только необходимые прямые зависимости с точными версиями в единственный lockfile:

| Пакет | Где / назначение | Лицензия |
| --- | --- | --- |
| `luxon` 3.7.2 | API: named zone, DST, local boundaries; существующий CommonJS runtime | MIT |
| `@types/luxon` 3.7.6 | API dev: TypeScript declarations | MIT |
| `@fullcalendar/react` 7.1.3 | Web: Standard React calendar, TimeGrid/List и Monarch theme | MIT |
| `temporal-polyfill` 1.0.1 | Web: обязательный peer v7 и named-zone date helpers | MIT |

Существующие React 19/Next и остальные закреплённые зависимости не обновляются ради
календаря. API использует CJS-совместимый Luxon, web — ESM Temporal, который уже требуется
FullCalendar v7; ради timezone не меняется модульный формат NestJS. В v7 используются
React package subpaths и built-in named-zone resolution, а не импорты/плагин luxon3 из v6.
Никакие Premium/resource timeline/trial plugins и license keys не добавлены.
Источники: [React v7 integration](https://fullcalendar.io/docs/react),
[v7 migration / timezone changes](https://fullcalendar.io/docs/upgrading-from-v6-js),
[Temporal peer dependency](https://fullcalendar.io/docs/temporal-polyfill),
[Standard и Premium лицензии](https://fullcalendar.io/license),
[Luxon 3.7.2 manifest](https://github.com/moment/luxon/blob/3.7.2/package.json).

### Defaults и сохранность seed

Миграция и seed добавляют defaults только отсутствующей конфигурации Crew. Обычный
`db:seed` не назначает даты/команды старым M3-заказам: создаёт только missing planning
configs и шесть task templates по unique stable code с DO NOTHING. Начальные check
products/quantities/integrity обязательны для обеих услуг, assemble products — обязательный
для доставки со сборкой; clear area/discard packages — optional. Severity/priority и
required/applicability — редактируемые допущения MVP. Пользовательские окна, buffer,
недоступность, отключённые/изменённые шаблоны и прежние M1–M3 данные не восстанавливаются
поверх ручных правок. Автоматической демонстрационной записи визитов при boot/migrate
или обычном seed нет. Production guard действует до seed mutation. Проверки сохранности,
concurrency и browser smoke относятся к фактически выполненным действиям из PROGRESS;
предыдущие PASS не объявляются новыми запусками и не заменяют пользовательскую приёмку.

## 2026-10-25 / M5 — исполнение команды и сохранённый результат

Пользователь прямо подтвердил M4 и разрешил только M5. Следующие решения конкретизируют
тестовый MVP. Единица исполнения — существующий CrewAssignment, с общими для команды
задачами и индивидуальным автором действий. Новый параллельный набор заказов/задач,
DataSource, auth или browser storage не создаётся. Подписи и Order.COMPLETED отсутствуют.

### Состояния, факты и совместимость с планированием

Миграция `CreateExecution1792886404000` расширяет старые назначения значениями
NOT_STARTED/executionVersion=1, задачи PENDING/resultVersion=1, товары накопленными
deliveredQuantity=0/assembledQuantity=0/fulfillmentVersion=1. Эти defaults не означают
фактически выполненную работу; прежние значения, авторы, план, confirmation и платежи
не переписываются. Lifecycle ASSIGNED/CANCELLED сохраняется отдельно от executionStatus.

| Действие | Разрешённый переход |
| --- | --- |
| Depart | NOT_STARTED → ON_THE_WAY |
| Arrive | ON_THE_WAY → ARRIVED |
| Start | ARRIVED → IN_PROGRESS |
| Finish COMPLETED | IN_PROGRESS → COMPLETED, все required DONE, optional DONE/SKIPPED |
| Finish PARTIALLY_COMPLETED | IN_PROGRESS → PARTIALLY_COMPLETED, reason и remainingWork |
| Finish BLOCKED | ON_THE_WAY/ARRIVED/IN_PROGRESS → BLOCKED, reason и remainingWork |

Новый выезд требует актуальных Assignment/Appointment, active Crew, CONFIRMED и
сегодняшнюю плановую Rome-дату, а также показанную Appointment.version. В пределах дня
можно выехать раньше плана. Уже начатые действия/finish не ограничиваются датой,
рабочими окнами, неоплатой или последующим резервом. Disabled Crew можно закончить
и документировать после выезда; disabled User доступа не имеет. Один Crew имеет не
больше одного активного исполнения ON_THE_WAY/ARRIVED/IN_PROGRESS, включая разные заказы:
это защищено Crew lock и partial unique index. AllowedActions и объяснение блокировки
рассчитываются сервером, действие повторяет проверки под locks.

departedAt/arrivedAt/actualStartAt/actualEndAt — серверные UTC instants после получения
locks, отдельно от плана. Повтор не меняет timestamps; хронология закреплена CHECK и
проверкой сервера. Окончание на следующую дату и после следующего планового визита
записывает факт, не переносит следующие заказы. Активное исполнение после plannedEnd
означает только «возможно задержка / нет завершения», без ETA или рекомендаций M6.

После первого depart Appointment нельзя обычным M4 path переносить, отменять,
менять состав команд или снимки задач. Сравниваются фактические изменения: notes-only
и полный неизменившийся payload задач остаются допустимыми. После первого depart
любого назначения Order заморожены address/city/country/postalCode/serviceType/
workDescription/floor/hasElevator/easyAccess/parkingAvailable/accessRestrictions/accessNotes,
а также добавление/снятие товаров и их description/quantity/configuration/ambient/
requiresAssembly. Контакты, internalNotes/crewNotes, item.notes/sortOrder, цена и платежи
остаются доступны с прежними проверками. EstimatedDuration не двигает визиты.
Проверки стоят внутри прежних транзакций M3/M4, а не только в UI.

### Версии, повтор и доступ

Порядок writes: User **FOR SHARE** → Order → Appointment → Crew по UUID →
Assignment/Task/Item. SHARE берётся до business locks, совместим с FK KEY SHARE и
исключает изменения active/role/членства M2 до конца принятого действия. KEY SHARE
для этого недостаточен. Роль/active/session/ownership проверяются повторно после
ожидания locks; membership проверяется и до чужих business locks. Доверенный sessionId
передаётся из guard context, не из body. M3/M4 author-bearing mutations используют
тот же порядок, включая availability перед Crew и каталог перед template row.
Чтения — согласованные snapshots. Принятые данные браузера технически не отзываются;
следующий запрос и replay обязаны заново пройти актуальные проверки.

executionVersion назначения растёт при effective action/task/quantity change.
Task.resultVersion и OrderItem.fulfillmentVersion независимы. Платёж/VOID не меняет
execution/task/fulfillment versions; Order.version по-прежнему защищает общие изменения.
Текущий участник читает историю своей команды, бывший участник теряет этот доступ.
Снятое/отменённое до начала назначение не открывает клиентские данные по старому URL.
Crew-проекция — явный allowlist: контакты/доступ/crewNotes/товары/свои задачи/результат.
В ней нет финансов, internalNotes, Appointment.notes, сырого audit или секретов.

ExecutionReceipt имеет unique(actorId,assignmentId,action,operationKey), fingerprint
нормализованного input с target ID и исходными версиями. Проверка receipt следует после
fresh authorization/ownership, но до transition/stale-version проверки. Тот же запрос
возвращает текущую разрешённую проекцию и узкую receipt metadata; другой payload — 409.
Старый DONE Retry после нового PENDING не меняет PENDING. Изменение/receipt/audit
коммитятся вместе. Полный reason до 4000 сохраняется в domain report/changes; прежнее
поле ActivityLog.reason ограничено 1000 и получает excerpt, без изменения старой схемы.

### Checklist, количества и отчёт

Только IN_PROGRESS может менять свои активные task snapshots или количества своего
Order. Required нельзя SKIPPED; optional skip и возврат в PENDING требуют причину.
Crew не меняет текст/required/severity/priority. Finish не генерирует задачи и не
выставляет количества автоматически. Общие абсолютные количества по OrderItem под
Order lock: `0 ≤ assembled ≤ delivered ≤ quantity`; оба поля обязательны в запросе,
version проверяется. Для requiresAssembly=false и DELIVERY_ONLY assembled=0.
Уменьшение требует причину. Это накопленный итог заказа, не сумма результатов команд.

Один FinishReport на Assignment неизменяем: outcome/summary/reason/remainingWork,
свои задачи и снимок всех активных quantities с quantityScope=ACCUMULATED_ORDER,
известные crew-visible issue/attachment IDs, автор и actualEndAt. Это не утверждение,
что вся накопленная мебель выполнена этой командой. После finish допустимы только
новые append-only дополнения к доказательствам, исходный report не переписывается.
ReturnVisitRequest — отдельная OPEN потребность с provenance и unique Assignment;
вторая команда не очищает её boolean-перезаписью. В M5 нет resolve этого запроса,
создания следующего визита или покрытия прежнего partial новым визитом: это M6.
Решение Issue также не закрывает потребность приезда.

Единый execution resolver и его SQL-проекция используются detail/list/dashboard.
Приоритет: active execution → IN_PROGRESS; весь объём/назначения/задачи готовы без
issues/return → AWAITING_REVIEW; только эти blockers при готовом объёме →
REQUIRES_ATTENTION; неполный объём с выполненной работой/partial outcome →
PARTIALLY_COMPLETED; неуспешная попытка или проблема без выполненного →
REQUIRES_ATTENTION; иначе прежние INBOX/PLANNED/ASSIGNED. Все неотменённые визиты
должны иметь назначения, все действующие назначения COMPLETED, required DONE,
optional DONE/SKIPPED, доставка/нужная сборка полны; future Unassigned блокирует review.
Открытые issues и return представлены отдельно от прогресса и оплаты. Никакая команда
не закрывает целый Order своим finish, финального COMPLETED в M5 нет. Финансовые SUM
считаются отдельно от дочерних execution/evidence записей, без JOIN fanout.

### Evidence, visibility и локальные файлы M5

`CreateEvidence1792886404100` добавляет ExecutionNote, Issue/IssueItem/IssueAttachment/
IssueEvent, Attachment и EvidenceReceipt без изменения прежних business rows.
Заметки append-only до 4000 символов с provenance Order/Appointment/Assignment/Item,
автором и UTC instant. Crew дополняет только уже выехавшее своё назначение, включая
завершённое. BACKOFFICE_ONLY по умолчанию для диспетчера; crew evidence всегда
CREW_VISIBLE. Через разрешённое назначение видны рабочие материалы этого Order,
включая прошлые визиты; другой заказ или приватный parent не дают обхода visibility.
Crew counters/IDs исключают private issues/files; backoffice progress учитывает все issues.

Issue type: DAMAGE/MISSING_PARTS/WRONG_PRODUCT/QUANTITY_MISMATCH/ACCESS_PROBLEM/
CUSTOMER_UNAVAILABLE/OTHER; source CREW/CUSTOMER — допущения M5. Несколько item/file IDs
проверяются в том же Order. Resolve/reopen доступны только ADMIN/DISPATCHER с version,
причиной, серверным временем и отдельной неизменяемой IssueEvent. Решение проблемы
не меняет quantities, finish report, оплату или ReturnVisitRequest. Crew видит безопасную
issue timeline, не ActivityLog. Дополнительная заметка не заменяет старую запись.

EvidenceReceipt отдельно scoped unique(actorId,orderId,action,operationKey), поскольку
backoffice может добавлять материалы без Assignment. Fingerprint включает route scope,
target и нормализованный payload. Для upload — также SHA-256 исходных bytes и display name,
без зависимости от версии image processor. Доступ проверяется до replay; replay возвращает
текущую разрешённую запись. Отозванный файл не возрождается повторной загрузкой с тем же ключом.

Один multipart file: JPEG/PNG/WebP до 10 MiB либо backoffice PDF до 20 MiB. До 100
READY/неотозванных файлов и 250 MiB на Order. Максимум 40 MP, две image decode операции
и четыре ожидающих; неподдерживаемая/повреждённая/animated картинка отклоняется.
Sharp проверяет декодируемость, нормализует ориентацию, перекодирует в WebP и убирает
исходные EXIF/GPS. HEIC не обещается. Browser MIME/extension не являются доказательством
формата; служебное имя/extension создаёт сервер. PDF проверяется по header/EOF, выдаётся
attachment без активного встроенного preview: это не полноценная проверка PDF и не AV/CDR.
Пользователь выбирает CREW_VISIBLE осознанно; содержимое документа автоматически не
проверяется на финансовую/приватную информацию.

STORAGE_* limits разрешено понизить до положительных значений, но не поднять выше этих
caps. Default persistent root — workspace `uploads/`, вне public/build и Git. Test config
получает отдельный случайный root; каталоги создаются лениво. Source filename не может
стать путём: separators/control chars отвергаются, display name ограничен, final key —
random server UUID с `.webp`/`.pdf`. Symlinks/unsafe roots не принимаются.
Multer bounded disk staging не читает raw file целиком в memory; multipart ограничен
одним файлом, восемью полями по 4096 bytes, десятью parts. Next rewrite clone limit поднят
с 10 до 22 MiB для 20 MiB PDF + overhead; Nest сохраняет меньшие per-format limits.
Синтетический HTTP probe подтвердил исправление обрезания, реальные uploads проверяются
отдельно по PROGRESS.

Pipeline: private staging → hash/первый fresh-auth receipt lookup → validated файл вне
business locks → короткая повторная User/Order/parent авторизация, replay/ownership/quota
→ promotion и READY metadata/audit/receipt. DB quota проверяется под Order lock, поэтому
две конкурентные публикации не превышают предел. Heavy decode не держит Order lock.
Обычная ошибка убирает только принадлежащие этой попытке staging/validated/final paths.
При неизвестном COMMIT final не удаляется до fresh connection + Order lock + проверки
metadata. Если БД недоступна и исход не доказан, файл сохраняется как потенциально
committed orphan, UI получает неизвестный результат, повтор использует исходный File/key.
Никакой автоматической очистки development storage нет. `pnpm storage:inspect --dry-run`
только сопоставляет metadata и файлы; unreferenced может быть in-flight. Перед ручной
диагностикой остановить writes и сохранить вместе PostgreSQL и private storage.

Metadata/bytes/thumbnail обслуживаются защищёнными handlers через Order либо доступный
Assignment, включая HEAD. Origin/CSRF/session и preflight role/ownership стоят до multipart,
после обработки право перечитывается перед READY. Каждый GET/HEAD заново проверяет доступ,
visibility и withdrawal; Range после authorization явно отклоняется (416). Ответы имеют
private/no-store, nosniff, controlled Content-Disposition; PDF дополнительно sandbox CSP.
Thumbnail использует тот же нормализованный image с тем же доступом, без public derivative.
Logout/потеря членства/withdrawal запрещают новый запрос по старому URL; уже полученные
bytes технически не отзываются. Storage keys/physical paths/hash/fingerprints не входят API.

Новая image dependency — `sharp` **0.35.5**, Apache-2.0, Node >=20.9, проверена на
Node 24.22.1. Используется штатный Nest FileInterceptor; только его transitive Multer
закреплён scoped override **2.5.0**, потому что официальный release исправляет
[конкретную уязвимость предыдущей версии](https://github.com/expressjs/multer/releases/tag/v2.5.0).
Nest/Next/TypeORM и прочие прежние pins не обновлялись. Источники:
[Nest upload lifecycle](https://docs.nestjs.com/techniques/file-upload),
[Sharp installation](https://sharp.pixelplumbing.com/install/),
[OWASP upload controls](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html),
[проверка прав на каждом запросе](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
Это локальный тестовый storage, без заявления о production security certification.


## 2026-10-26 / M6 — прогноз, подтверждаемый перенос и return lifecycle

Пользователь разрешил M6, перенеся B/C, физический телефон/камеру и пользовательскую
приёмку M5 на конец разработки. Это не ACCEPTED. Исторические M5 run/logs и RECOVERY
сохранены; браузер в M6 не открывается. Новые UI-сценарии тоже DEFERRED BY USER.

`CreateEstimates1792886405000` добавляет nullable оценку и метаданные назначения с
отдельной estimateVersion. Команды crew/диспетчера используют прежние свежие User/Session,
Order → Appointment → sorted Crew → Assignment locks и ExecutionReceipt. Replay проходит
повторную авторизацию и возвращает актуальную проекцию, не откатывая более новую оценку.
Серверное now проверяется после ожиданий. План, actual, confirmation и выполнение не меняются.

Низкоуровневый `planning/crew-reservations.ts` — общая read model и predicate доступности
для M4 create/update, M6 поиска/apply/return planning. Plan/estimate/actual release и
UNKNOWN описаны в DOMAIN_RULES. Хранящийся buffer назначений сохраняется. Active reservation начинается с
min(plannedStart, departedAt): M5 разрешает ранний выезд в плановую дату, и crew уже занята
даже до планового начала. Loader включает такую запись при поиске более раннего окна.
Вчерашний незавершённый визит остаётся в risk board диапазона, содержащего serverNow.
Риск read-only,
с serverNow/dataAsOf, дедупликацией визита и источниками по командам. Поиск ограничен
42 Rome-днями, 15-минутной сеткой и 20 результатами; исключает только переносимый
Appointment. Альтернативы перебираются только для одиночной команды. Нет holds, cron,
оптимизатора или каскадного переноса. Предложение не гарантирует слот.

Apply переиспользует `PlanningService.updateInTransaction` с тем же EntityManager и
порядком блокировок. Причина, expectedVersion, повторная доступность и запрет departed
обязательны; время меняет confirmation на NEEDS_CONFIRMATION. EvidenceReceipt используется
как существующий order-bound durable receipt. Повтор после более позднего переноса не
возвращает старые даты. Повторная свежая session-проверка выполняется после ожидания
Order, включая replay. Не создаётся второй независимый DataSource.

`CreateReturnVisits1792886405100` расширяет существующий ReturnVisitRequest до
OPEN/PLANNED/RESOLVED с version/actor/time/resolution. Исторические поля не переписываются.
ReturnVisitAttempt хранит immutable JSON scope, order/request/appointment provenance,
closure metadata и returnRequested. Composite FK удерживают один Order; unique appointment
и partial unique current request закрепляют 1:1 текущую попытку. Task.sourceTaskId self-FK
и returnScopeKey сохраняют происхождение, включая замену команды. Незавершённые source
leaves проходят same-request проверку; required нельзя исключить, каждый переносится
одной выбранной команде. Выполненные предки и optional SKIPPED не копируются. Новые задачи
явны и требуют причины. Непокрытый optional/PENDING source leaf после terminal текущей
попытки оставляет request OPEN, а не создаёт RESOLVED без пути к готовности; следующий
визит может явно SKIPPED эту optional задачу с причиной. Полный набор required templates M4 к follow-up не применяется.
При замене команды неначатого follow-up её scope передаётся первой из выбранных команд
в сортировке UUID с отдельной записью истории; прежние snapshots остаются неизменными.

Item targets — абсолютные accumulated OrderItem значения. Каждый новый план проверяет
текущие totals и невыполненные цели всех неудачных попыток; опустить их нельзя. Факт
повторного визита не складывается второй раз. Plan/assignments/tasks/link/status/audit/
receipt атомарны под Order lock и partial unique. Cancel и finish вызывают узкие lifecycle
функции в той же транзакции, без циклической зависимости сервисов. Все terminal с
неуспехом/return flag/недостигнутыми целями открывают исходную потребность; новый flag
не создаёт дубли для каждой команды. Дополнительные причины — append-only ActivityLog,
отчёты каждой команды неизменны. Все успешные требуют явного resolve диспетчера.

Execution resolver расширен коррелированными EXISTS, без финансовых JOIN. Старое
назначение может считаться покрытым только RESOLVED request с завершённой attempt;
каждая старая pending задача требует достижимого выполненного потомка sourceTaskId.
Recursive SQL защищён от циклов. Исходные rows и immutable reports не меняются.
Другие requests, issues, tasks, будущие визиты и неполные quantities продолжают блокировать
review. OPEN и PLANNED оба считаются незакрытой потребностью. Финальные статусы не добавлены.

Crew context строится отдельным allowlist, только задачи своего текущего назначения,
операционная причина/remainingWork, общие разрешённые item targets и минимальные source
names/statuses. Он не наследует backoffice detail, исходные private attachments или finance.
Файловые/auth/Origin/CSRF правила M5 и Next proxy остаются прежними.

UI использует прежние apiRequest/useCommandAttempt, явные preview/submit и версии draft.
Refresh не заменяет expectedVersion в старом payload. Нет realtime или фонового применения.
Component tests и программные gates фиксируются отдельно в PROGRESS; UI-эмуляция и
физический телефон в этом запуске не проверяются.


Точечные проверки UI выявили test setup error: concise beforeEach возвращал mock, который
Vitest 4 вызывал как cleanup. Исправлен только возврат void, assertions сохранены.
SlotFinder может находиться внутри формы return plan: ResourceNotice Retry теперь имеет
`type="button"`, чтобы повтор GET не отправлял внешний план. Component regression проверяет
отсутствие submit/mutation. Старые typed fixtures получили nullable estimate metadata,
без изменения прежних ожидаемых execution результатов.


## 2026-10-26 / M7 — решения MVP о подписанном результате и закрытии

Пользователь разрешил только M7. M6 code run 20261026T102822Z остаётся историей;
M5/M6 не ACCEPTED. Браузер, M5 B/C, UI M6 и физический телефон отложены до финала,
без нового запроса origin permission. Подписи — запись согласия в тестовом приложении,
без квалификации/сертификации/проверки личности/внешнего провайдера и юридических обещаний.

Существующие Next16.4.3, Nest11.2.8, TypeORM0.3.31, Sharp0.35.5 и Node24.22.1 совместимы
по установленным engines; зависимости/lockfile не обновляются. Используются прежние
DataSource factory, PG17 Compose, HttpOnly opaque sessions, fresh User/Session/membership,
Origin/CSRF и Next rewrite. Canvas/Pointer Events не требуют SDK. PNG только синтетические
в test fixtures, обычный seed и миграции не создают подтверждений/закрытий старым заказам.

### Immutable документ, signer requirements и приватность

`CreateAcceptance1792886406000` добавляет AcceptanceSnapshot, AcceptanceSlot,
SignatureConfirmation и ExceptionReview. Снимок payload/canonical/hash immutable,
исправляемы лишь отдельные invalidation metadata. Unique version Appointment и partial
unique invalidatedAt IS NULL закрепляют один текущий документ. Server builder сохраняет
все departed FinishReport IDs/снимки task/quantity, время, условия, явные причины/remaining
и CREW_VISIBLE issues/evidence. Report quantities накоплены по Order и не складываются.
Ссылки/metadata исторические; новые события не меняют payload. Нормализованный checksum
старых файлов не существует в публичной модели, поэтому checksum=null; приватный
sourceHash и storageKey не раскрываются. Подтверждение version MVP-VISIT-1 не содержит
отказа от прав или утверждения об отсутствии любых будущих/внутренних проблем.

Один CUSTOMER slot и по одному CREW на фактическое назначение. Crew DTO отдельный:
другие staff slots показывают status без confirmation/review/image, PNG читается лишь
для клиента/своего назначения того же визита. BO может читать все изображения заказа,
но не подписываться за crew. Имя staff подписанта берётся из User.displayName, customer name/relation
заявляет человек; capturedBy всегда из сессии. Fresh membership проверяется до чужих
locks и после ожидания. Disabled Crew допускает подтверждение сделанного, disabled user нет.

Одно append-only SIGNED/ABSENCE на slot и одно решение review; DB CHECK исключает
смешивание отсутствия и PNG, FK допускает review только ABSENCE. Исправление любого
такого факта требует явной инвалидации общей редакции и новых подтверждений, а не
скрытой замены/переноса. Это осознанное ограничение маленького MVP. Prepare — POST,
GET не пишет. Повтор prepare использует текущую редакцию, не плодит её.

PNG bytea select:false/metadata/audit/receipt коммитятся вместе. Декодирование Sharp до
длинной business transaction, до двух декодеров, ограничение 256 KiB input/output,
2048×1024/2 097 152 pixels и timeout native processing. Проверяются фактический PNG,
APNG chunks/frames, декодируемость, непустая видимая вариация после композиции на белом,
перекодирование без metadata. Это не анализ подлинности почерка. Specialized multipart
Multer module с bounded memory/file/field/parts не меняет evidence disk pipeline.
Для pre-parser total cap MVP требует Content-Length≤272 KiB, missing/chunked→411,
oversized→413; конечный browser Blob/FormData имеет вычисляемую fetch длину. Installed
Next proxy-request/httpxy source сохраняет CL обычного POST; это code review, не новый
browser PASS. Совместимость реального proxy/телефона отложена. Header/body caps не отключают
глобальную auth/CSRF. Защищённый content image/png +nosniff+no-store, без PNG в DTO/SSR/audit.

### Готовность, завершение, переоткрытие и совместимость M6

`CreateCompletion1792886406100` добавляет append-only CompletionRecord, OrderReopenEvent
и nullable Order.currentCompletionId — единственный active marker, без второго manual
status/active boolean. Composite FK удерживает marker/history в одном Order. Column
select:false/insert:false позволяет реальным legacy migration fixtures использовать
новые metadata до M7 schema; новые code paths явно выбирают pointer. Старые восемь
миграций не меняются, все прежние orders получают null, без invented completion.

Readiness использует экспортированные M6 physical predicates, включая recursive task
coverage/RESOLVED return request, а не новое условие всех старых assignments COMPLETED.
Отдельные physicalReady/confirmationsReady, конкретные codes и ссылки на visit/item/issue/
request/slot. Каждый фактический визит требует собственного документа/всех requirements,
включая неудачный источник успешного follow-up. Empty/fullpaid/одна staff подпись не
дают canComplete. Order.version повышается при effective acceptance action; отдельная
snapshot.version остаётся общей immutable редакцией, поэтому crew A не затирает B.
Receipt replay и подготовка существующего current snapshot revision не меняют.

Complete под User SHARE → Order WRITE заново читает права/версию/всю readiness и сохраняет
CompletionDecisionSnapshot (IDs docs/signatures/exceptions/coverage и operational facts),
current marker, audit и receipt атомарно. Finance в readiness отсутствует. Detail/list/
dashboard/calendar и safe crew orderProgress используют тот же SQL marker +M6 resolver;
финансовые SUM и counters не JOINятся с signatures/snapshots и не размножаются.

Reopen сохраняет прошлый record/event/подписи, чистит marker, не обнуляет физическую работу.
Issue create/reopen после closure и document invalidate вызывают узкий helper в той же
транзакции и затем общий revision touch. Между complete и этими writers возможны оба
порядка: blocker первым → отказ complete; completion первым → сохранённое событие и reopen.
Новый plan/return scope требует explicit reopen, receipts прежних успешных операций лишь
возвращают актуальную проекцию. Payment/VOID/price/contact/internal notes допускаются без
reopen по прежним M3/M5 ограничениям. Нет универсального crew-reopen или hidden auto-close.

При проверке двойного seed обнаружен реальный defect: TypeORM SubjectExecutor после
save подставляет null в unloaded nullable поля объекта; первый save pointer в reopen,
затем второй save того же Order при touch теряли private seedKey. Диагностические
checkpoints подтвердили первый сбой на manual reopen. Helper теперь лишь меняет marker
в объекте, а caller сохраняет Order ровно один раз вместе с revision. Audit/event/marker
остаются одной транзакцией. Полные row digests, PNG hashes, seed keys и история повторных
закрытий — regression, assertions не ослаблялись. Прежние FAIL сохранены в M7 run logs.

В финальном integration run `44` сохранён DB Query read timeout (2000 ms) dashboard,
189 PASS / 1 FAIL. Единственный diagnostic `48` повторил planning file: 19 PASS;
EXPLAIN без ANALYZE и длительности сохранены без SQL parameters/PII. В этом повторе
aggregate SQL имел 70 185 символов/8 recursive occurrences, запросы 77/83 ms и без JIT
в сохранённых планах. Диагностика после исходного сбоя не увидела активных ожиданий;
она не описывает момент самого timeout. **Его первоначальный триггер UNKNOWN**,
успешный повтор не удаляет FAIL и не доказывает причину. Устранено доказанное лишнее
вычисление: completedCount использует current_completion_id IS NOT NULL, точную первую
ветку resolver, вместо восьмого полного progress expression. Все прежние 2000 ms caps
и assertions сохранены; regression проверяет complete/reopen/reclose, счётчик только
действующего marker и неизменные деньги. Это локальное изменение одного счётчика,
не новый resolver/общий refactor и не доказательство устранения исходного timeout.

### UI и окончательная приёмка

Расширяются существующие crew/backoffice компоненты, не новое приложение. Canvas хранит
только x/y штрихи в памяти и перерисовывает при resize/DPR; pointercancel завершает ввод,
clear/preview/save явные, touch-action локален. Client presentation не меняет роль и
скрывает рабочую навигацию; доступ остаётся по сессии. Unknown result держит один Blob/
key/payload/version; потеря доступа очищает state/object URLs. Успешный logout сразу
отправляет прежнее событие очистки до navigation; regression с задержанным ответом и
router spy подтверждает освобождение preview даже без unmount. Нет browser storage,
автосохранения движения, искусственного имени-картинки, PDF, offline или realtime.
Completion UI показывает причины отказа/историю/revision, явный review и Complete/Reopen.
Issue UI заранее объясняет reopen и требует unchecked подтверждение последствий.
Реальные mouse/touch/rotation/proxy/content, 390/1280 и все M5/M6/M7 пользовательские
сценарии DEFERRED BY USER; jsdom/canvas mocks не являются физическим телефоном.


## 2026-10-26 / M8 — решения тестового MVP: сигналы и восстановление чтений

Пользователь разрешил M8, не принял M5–M7. Браузер/разрешения не открываются и не
обходятся; программные HTTP/streaming проверки относятся только к изолированным
test schemas/storage. Realtime — SSE в том же Nest, mutations остаются обычным HTTP.
Новых dependencies, брокера, outbox, notification table или второго DataSource нет.
Технические первичные источники: [Nest 11 SSE](https://docs.nestjs.com/v11/techniques/server-sent-events),
[MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
и установленный исходник Nest 11.2.8 / TypeORM 0.3.31. Они не подтверждают поведение проекта.

### Внешний commit и best-effort доставка

`RealtimeCommitSubscriber` установлен в прежней DataSource factory; бизнес-операции
явно помечают разрешённые read models в их существующем transactional manager.
Нет публикации через save/afterUpdate или сериализации ActivityLog. Стек WeakMap
QueryRunner frames отслеживает реальную вложенность: RELEASE SAVEPOINT объединяет
hints в родитель, ROLLBACK TO их отбрасывает, outer rollback всё удаляет. Только
AfterTransactionCommit с isTransactionActive=false ставит best-effort callback.
Publisher не ожидается бизнес-транзакцией; синхронный throw/Promise rejection ловятся,
не откатывают сохранённую работу и не превращают успешный HTTP в ложный FAIL.

До 256 distinct hints в транзакции и 128 на stream; повторные hints coalesced,
при переполнении самые старые отбрасываются. Это осознанная bounded best-effort
политика маленького однопроцессного MVP: падение процесса между commit/publish тоже
может потерять сигнал. Нет exactly-once, durable replay Last-Event-ID или нескольких
replicas. Контрольный refetch/reconnect/focus нужны даже при здоровом SSE.

### Stream, приватность и жизненный цикл

`GET /api/realtime/events` проходит прежний session guard и отдельную same-origin
проверку: явно чужой Origin или Sec-Fetch-Site отклоняются. Нативный EventSource не
обязан добавлять mutation header; POST/PATCH Origin/CSRF правила не ослаблены. Нет
client-selected channels/query/token, публичного direct API или wildcard CORS.
Идентификатор session передаётся только внутренне после проверки HttpOnly cookie.

Manual Nest GET/Response выбран для явного ограничения backpressure вместо очереди
concatMap в установленном @Sse handler. Headers: text/event-stream, no-store/no-transform,
nosniff, X-Accel-Buffering:no. Ready {emittedAt}; invalidate {eventId,emittedAt,topics};
access-reset {eventId,emittedAt,reason}; heartbeat — комментарий, не данные карточки.
Никаких Order/Payment/текстов/адресов/file metadata/PNG/object IDs в payload.

Лимиты MVP: 32 connections включая setup, 4/user, packet≤2048 bytes, write buffer≤16KiB;
write=false/переполнение закрывает stream, не растит очередь. Hints coalesce 250ms,
heartbeat 15s заново читает User/Session/членство/назначения. Crew scope ограничен 1000
текущими scheduled assignments; больший scope fail-closed 503 с обычным refetch.
Сокет не удерживает QueryRunner/DB connection: только короткие проверки на каждую
группу/heartbeat. Разрыв, abort setup, DB error и shutdown очищают timers/listeners;
cleanup отслеживает и завершающиеся auth promises уже удалённых из clientMap клиентов.
Это целевой предел обнаружения изменения на idle stream, не мгновенная очистка устройств.

BO topics разрешены ADMIN/DISPATCHER, accounts только ADMIN. Crew получает лишь
scope разрешённого Order/своей команды; финансовые/BACKOFFICE_ONLY события молчат.
Staff exception review адресуется своей команде, не соседнему staff slot. Снятие старого
assignment/смена роли или команды даёт обезличенный access-reset и close; новые
назначения — crew-work/list refresh. Disabled Crew сохраняет M5-доступ к истории,
disabled user/отозванная/истёкшая session теряют stream. DB error закрывает соединение,
не сообщает ложный logout. HTTP API независимо заново проверяет каждую читаемую запись.

Карта отметок → read models:

| Изменение | BO topics | Crew |
| --- | --- | --- |
| Order/items/shared fields | orders/dashboard/completion | crew-work только actual shared diff |
| Payment/VOID/price/internal notes | orders/dashboard/completion | нет |
| Planning/assignments/cancel/confirmation/tasks | orders/planning/dashboard/returns/completion | разрешённая работа, прежний/новый список |
| Execution/quantity/checklist/estimate | orders/dashboard/planning/evidence/returns/completion | разрешённые общие результаты/risk |
| Notes/files/issues | orders/dashboard/evidence/completion | только CREW_VISIBLE |
| Return scope/plan/resolve | orders/dashboard/returns/planning/completion | разрешённый return context |
| Snapshot/sign/absence/review | orders/dashboard/acceptance/completion | разрешённый snapshot/свой review |
| Explicit Complete/Reopen | orders/dashboard/completion | безопасный operational/acceptance state |
| User/membership/Crew/availability/templates | разрешённые справочники/planning | scope reset/своя crew, без admin accounts |

Не ставится общий mark внутри automatic reopen helper: private issue не должен через
побочный completion hint раскрыться crew. Caller сохраняет исходную visibility.
Mixed price+неизменённое crewNotes не создаёт crew сигнал только из-за наличия поля.
Изменение BO-аккаунта без истории членства не посылает диспетчеру `crews`: accounts
остаётся ADMIN-only. Смена публичной identity сотрудника обновляет только разрешённые
candidate/roster read models, включая прежние команды с исторической строкой участника.
Password-only и переданные неизменённые public поля не создают общий roster hint.
Две PG/HTTP regressions сначала воспроизвели обе ошибки (58: 2 FAIL), затем проверены
после узкого исправления UsersService; окончательные результаты записаны в PROGRESS.

### Frontend и demo

Один RealtimeCoordinator в SessionProvider координирует активные resource hooks; новая
query library не добавляется. Ключи нормализуют порядок query-параметров. Fixed coalesce
250 ms, один GET в полёте/один pending follow-up, automatic minimum 2s и 5s dashboard;
manual Refresh присоединяется к flight. Resource failures имеют backoff 2–60s. EventSource
на error явно закрывается; один собственный retry 1–30s, без второго native retry loop.
Reconnect/focus/visibility/control сначала проверяют `/auth/me`, потом активные ресурсы.
Control 60s работает и при здоровом stream, hidden/offline не запускает новые тяжёлые reads.
Границы Today/рисков — Europe/Rome; ручной выбор даты/слота не становится автопереносом.

`dataLastSyncedAt` — минимум успешных validated GET timestamps всех активных ресурсов;
при отсутствующем GET timestamp null. Ready/heartbeat и canonical mutation response не
выдаются за успешное фоновое чтение. Dedup event IDs ограничен 128, сами hints не несут
state/version. Epoch/generation/controller защищают от late ответов после setData/scope.
403 или 404 ранее прочитанной записи сразу очищает private scope; first-load 404 остаётся
обычной ошибкой, чтобы bad URL не создавал reset loop. Подтверждённый новый user/role/crew
не включает reads старого layout до navigation. Временный 503 сохраняет drafts, не logout.

Открытая форма держит свой snapshot/revision/key/payload. Per-form change notice сообщает
о новом canonical data без rebase; обычный background не вызывает router.refresh и не
меняет canvas/Blob. Только verified access reset снимает private subtree, отменяет reads
и чистит имена/изображения/Object URLs. M2 Crew/Accounts больше не размонтируют формы
при pending; Crew key стабилен по ID. M6 return create/resolve unknown формы остаются
монтированными после появления канонического committed результата, сохраняя старый Retry.

Новый runtime export contracts обнаружил реальную проблему fresh dev/test: types брались
из src, а main из оставшегося M7 dist. Первоначальный запуск 25 дал 287 PASS / 11 FAIL + 111 runtime
errors. Перед root dev/test/test:integration и demo/proxy/load командами теперь собирается
contracts. После сборки и исправления одного тестового password-label запуск 27 дал 24 PASS,
полный 29 — 298 web PASS. Allowlist/assertions не ослаблялись, pins/lockfile не менялись.

Демо — отдельный opt-in CLI, не расширение обычного db:seed: 40 заказов, 10 команд, 40 сотрудников
и 2 backoffice-пользователя. TEST_DATABASE_* обязательны, локальная `_test` БД без development fallback, свои
schema `fd_demo_<slug>_<hash>`/COMMENT owner/workspace hash и private storage marker.
`.demo-runs` 0700, credentials/state 0600; 42 случайных пароля не печатаются. Миграции прежние 10,
synchronize:false, signed PNG только явно синтетических fixture-пользователей этого run.

Новый prepare требует Rome Today (первые 00:02 честно запрещены для короткого уже
просроченного планового примера); all initial bookings создаются до реальных execution
фактов. План/estimate/actual не подменяются. Статусы получены domain operations/resolver,
не произвольным PATCH. Prepare проверяет expected progress/risk/readiness и сохраняет
стабильные narrative IDs. PREPARED/STOPPED/RUNNING repeat лишь читает manifest; дата,
ручные изменения, passwords/payments/PNG/history не перезаписываются. Partial PREPARING/
FAILED не возобновляется: явный stop/cleanup/newrun, без сомнительного повтора Order.create.

Demo start — foreground supervisor, только own spawned process groups; stop сверяет OS
PID/start time/cwd/command/run ID перед SIGINT. Занятые 3000/3001 — отказ, не auto-killdev.
Next dist `.next-demo/<run>` отделён от `.next`; proxy tests используют `.next-test/<id>`.
Оба узких пути валидируются, generated next-env восстанавливается лишь при own hash,
посторонняя правка не затирается. Нормальный режим — `pnpm dev` после stop. API nodeEnv=test,
оптимизированный frontend NODE_ENV=production — локальный synthetic demo, не отмена Secure
cookie production API. FD_DEMO_RUN включает только видимый banner, не права/изоляцию.

Cleanup проверяет точные schemaCOMMENT/target/workspace/storage/process ownership и
удаляет лишь один run. Не чистит чужие QA fixtures/volumes. Private application.log удаляется
вместе с run: для длительной диагностики сначала отдельно сохранить redacted log. Backup/
restore требует вместе DB (включая M7 bytea) и M5 private storage; план процедуры в runbook,
фактический backup/restore здесь NOT VERIFIED. Однопроцессный MVP не production-ready.

Запуск 35 полного demo verification сохранил manual edit и все row/private-file hashes при повторе,
наблюдались 40 заказов на восьми стадиях; три явных dashboard reads 152/96/96 ms. Это не capacity benchmark
и не объяснение исторического M7 timeout (его исходная причина UNKNOWN). Запуск 36 проверил два реальных
production Next proxy streaming cases на отдельном test API, не только прямой Nest.
37–39 подтвердили own lifecycle start/stop/cleanup; окончательные gates/fresh-run/load
результаты фиксируются только по реальным логам в PROGRESS.


## 2026-10-27 / Dashboard — сводные диаграммы и приоритеты

По запросу пользователя обновлён только backoffice dashboard. Используется прежний
защищённый `/dashboard` и существующий resource hook; новых бизнес-показателей,
эндпоинтов, зависимостей, миграций и новых этапов функциональности нет.

- Четыре KPI: общее число заказов, заказы в работе, ожидающие проверки и задолженность.
  Восемь взаимоисключающих серверных progress buckets составляют общее число заказов.
  Горизонтальные столбцы показывают эти counts и ведут в существующие progress filters;
  длина нормирована по самому большому bucket, рядом указано точное количество.
- Круговая диаграмма сравнивает записанные платежи со стоимостью заказов за всё время,
  без выдуманных временных рядов/трендов. Деньги остаются integer cents, форматируются
  существующим `formatCents`; пропорции вычисляются через BigInt. Видимый процент
  округляется вниз, чтобы непогашенные центы не превратились в «100%». При отсутствии
  стоимости выводится нейтральное «—», без деления на ноль.
- Issues считаются проблемами, return count — заказами с OPEN/PLANNED requests, а не
  числом приездов. Общая очередь повторных приездов может содержать несколько запросов
  одного заказа. Платежи и физическое выполнение остаются разными измерениями;
  сохранено пояснение, что суммы не являются бухгалтерской выручкой.
- Native CSS/SVG, отдельные scoped styles, desktop/mobile layouts, текстовые значения,
  клавиатурные ссылки и видимый focus; зависимости и глобальная навигация не меняются.
- Фоновое обновление сохраняет уже показанные панели, при временной ошибке доступен
  Retry; 401/403 убирают ранее показанные финансовые данные через существующий hook.

Изменение представления не означает пользовательскую приёмку M5–M8. Визуальные проверки
390/1280 px остаются BLOCKED существующим запретом browser tool; component tests не
считаются браузерной или физической проверкой устройства.


## 2026-10-27 / Tailwind для dashboard и login

По прямому запросу пользователя добавлен Tailwind CSS **4.3.3**, официальный
`@tailwindcss/postcss` **4.3.3** и PostCSS **8.5.32** как build dependencies web.
Метаданные npm проверены: stable releases, oxide требует Node >=20; закреплённый
Node 24.22.1 удовлетворяет этому ограничению. Прежние прямые версии Next/React/Nest/
TypeORM и остальных зависимостей не менялись. Один pnpm lockfile дополнен tooling и
его transitive/optional peer resolutions, в том числе jiti/lightningcss для Vite;
повторная offline frozen-установка проверяет согласованность.

Использована [официальная интеграция Next.js/PostCSS](https://tailwindcss.com/docs/installation/framework-guides/nextjs).
`app/tailwind.css` импортирует theme и utilities отдельно:
[Preflight не подключается](https://tailwindcss.com/docs/preflight#disabling-preflight),
чтобы не сбросить старые формы, календарь, canvas и прочие страницы. Префикс `tw:`
исключает коллизии с прежними semantic classes; utilities имеют `important`, как
[рекомендуется для существующего CSS](https://tailwindcss.com/docs/styling-with-utility-classes#using-the-important-flag),
поскольку прежние глобальные правила находятся вне CSS layers. Это выбор постепенного
переноса MVP, без массовой переработки каскада всего приложения.

Source detection ограничен явными app/components TS/TSX источниками через source(none)
и @source. Цвета, data variants, pseudo-elements и breakpoints заданы полными literal
utilities; нет конструирования имён классов из runtime значений. Динамическими остались
только ширины столбцов и CSS variable процента оплаты. Backend aggregate semantics,
integer cents, source API и защита финансов из предыдущего решения сохранены.

Dashboard целиком и login page/form перенесены на utilities, прежний `dashboard.css`
удалён. Рамка backoffice, navigation/user menu/main и её Sign out тоже перенесены.
LogoutButton принимает optional presentation className; crew default и существующая
логика logout остаются прежними. SessionProvider/LiveStatus/auth/CSRF не менялись.
Legacy auth-shell/auth-card CSS сохранён: его продолжает использовать SessionUnavailable.
Остальные orders/planning/crew формы этим запросом не переносились.

Component assertions не переписываются ради смены стилей. Проверки и browser ограничения
записаны отдельным фактическим run в PROGRESS. Программная генерация CSS не заменяет
браузерную проверку или приёмку пользователя.


## 2026-10-27 / Orders — таблица и быстрый просмотр

По запросу пользователя улучшено представление Orders. Прежний список заменён
семантической таблицей: клиент/город, услуга, отдельные work/payment badges, стоимость
и остаток, независимые issues/return/review flags. Одни и те же строки становятся
карточными grid rows <760 px, без дублирования desktop/mobile DOM. У таблицы сохранены
roles/column headings; строка не подменяет button role. Preview открывается pointer
кликом по фону строки либо настоящей keyboard-доступной кнопкой номера. Отдельный
Link Open сохраняет обычную навигацию и открытие полной карточки в новой вкладке.

Добавлены локальные адаптации [shadcn/ui Table](https://ui.shadcn.com/r/styles/new-york-v4/table.json),
[Sheet](https://ui.shadcn.com/r/styles/new-york-v4/sheet.json), Button, Badge, Input,
Native Select. Source snapshots/URLs/SHA сохранены в игнорируемом run, MIT notice —
`components/ui/LICENSE`. CLI не перезаписывал существующую тему/Tailwind setup.
Используются прежние prefix(tw), important utilities, без Preflight. Новые runtime
зависимости закреплены: @radix-ui/react-dialog **1.3.1** (peer React19), clsx **2.1.1**,
tailwind-merge **3.7.0**; остальных прямых версий это не меняет. cn настроен на `tw`.

Sheet использует [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog):
modal semantics, portal, focus trap, Escape/outside close и возврат фокуса. Preview
монтируется для одного order ID, читает прежний защищённый GET `/orders/:id` с runtime
response guard и existing resource coordinator. Нет подмены detail ответом списка.
Поздний ответ предыдущего заказа отбрасывается; 401/403/404 убирают удерживаемые данные.
Показываются контакты/адрес, active items с отдельными ordered/delivered/assembled,
суммы integer cents через существующий formatter и состояния. В preview нет изменений
данных, подписей, внутренних заметок, файлов или платёжных действий. Для действий
сохранена прежняя полная карточка.

Поиск/фильтрация/сортировка newest-first/pagination остаются серверными, без новой
табличной query-библиотеки или сортировки только загруженной страницы. Есть отдельный
контролируемый draft фильтров; Apply сбрасывает page1, Clear также сбрасывает форму.
Refetch того же query сохраняет таблицу, смена query не показывает старую страницу,
ошибки доступа очищают данные. Число matching orders не выдаётся за глобальный KPI,
суммы загруженной страницы не подставляются вместо dashboard aggregates.

Общие labels вынесены в lib/order-labels.ts, старые exports списка сохранены для
совместимости, циклический импорт preview/list исключён. Новые endpoint/migrations,
изменения auth/CSRF/DataSource/данных и бизнес-этапы не добавлялись. Фактические проверки,
включая один первоначальный сбой старого теста cleanup подписи и точечное исправление
его ожидания, записаны в PROGRESS. UI/физическая приёмка остаётся отдельной.


## 2026-10-27 / Компактные фильтры Orders

По запросу пользователя заменена большая постоянная форма: видны поиск и кнопка
Filters, четыре дополнительных параметра находятся в локально адаптированном
[shadcn Popover](https://ui.shadcn.com/docs/components/radix/popover). Добавлен только
@radix-ui/react-popover **1.3.1**, peer React19 проверен по metadata; прежние прямые pins
сохранены. Registry snapshot/URL/SHA в run, MIT attribution прежний `ui/LICENSE`.
Не менялись тема/префикс tw/noPreflight, API, авторизация и бизнес-модель.

Вынесен OrderFilters с отдельными search draft и advanced draft. Enter/Search применяет
поиск с уже подтверждёнными advanced criteria. Apply filters применяет четыре выбора
и текущий текст поиска; Escape/outside/Close отменяет неподтверждённые advanced choices.
Reset selection сбрасывает только выбор в открытой панели и сам API не вызывает.
Popover использует modal/focus/positioning/collision guards Radix, viewport width и
ограниченную высоту со scroll; простые Native Select сохраняют нативный выбор телефона.

Счётчик Filters учитывает четыре advanced conditions, отдельно видимый поиск в него
не входит. Все applied criteria показаны удаляемыми метками с полным текстом для
assistive technologies. Удаление одной не сбрасывает остальные, Clear очищает все
критерии/поиск. Эти действия возвращают page1. Per page перенесён к пагинации и меняется
сразу. Это настройка отображения, поэтому Clear теперь сохраняет выбранные 10/25/50.
Серверная query serialization и сортировка сохранены, клиентского среза данных нет.

При переносе form controls в Portal данные берутся из контролируемого состояния,
без предположения, что portal inputs входят в FormData внешней search form. Черновики
не сохраняются в browser storage; refetch не сбрасывает введённый поиск. Изменённые
сценарии тестов открывают реальный Popover, assertions параметров API/прав не ослаблены.
Пользовательская/браузерная приёмка по-прежнему отдельна от component tests.


## 2026-10-27 / Teams и полная карточка Orders

По прямому запросу пользователя доведён раздел Orders: команды в таблице/quick preview/
полной карточке, согласованные поля/иконки и навигация по рабочим модулям. Нового
бизнес-этапа нет. Заказ не получил поле единственного владельца: `assignedCrews`
содержит distinct `{id,code,name}` из ASSIGNED назначений SCHEDULED визитов. Завершённое
исполнение не меняет planning status, поэтому выполненная работа остаётся видимой.
CANCELLED визиты/назначения исключены; active=false исторической команды не скрывает её.
Порядок code/id стабилен. Колонка показывает два имени и +N, панели — все имена.

Это required public backoffice contract с runtime guard, без миграции. List получает
команды одним page-bounded DISTINCT-запросом, пустая страница не делает его. Detail
читает тот же helper внутри своей существующей транзакции. Финансовые/progress/count
запросы не получили JOIN к назначениям, единственный DataSource и права не менялись.
Crew endpoints не возвращают новую backoffice projection/финансы.
Для detail используется канонический UUID загруженного Order: PostgreSQL принимает
UUID в верхнем регистре, поэтому исходная строка URL не служит ключом Map результата.
Это покрыто service/HTTP integration assertions.

[shadcn Select](https://ui.shadcn.com/docs/components/radix/select) применяется в поиске/
фильтрах и размере страницы, с внутренним sentinel для пустого выбора и явным state
callback. В сложных формах заказа/платежа/визита сохранены реальные NativeSelect/HTML
input semantics и FormData, но поля/стрелки/ошибки/кнопки визуально согласованы. Lucide
**1.62.0** заменил рисованные вручную иконки, @radix-ui/react-select **2.4.1** и
@radix-ui/react-tabs **1.2.1** закреплены; metadata подтверждает peer React19. Другие
прямые pins прежние. Источники shadcn/их hashes сохранены в run, MIT notice сохранён.

Шесть [вкладок](https://ui.shadcn.com/docs/components/radix/tabs) контролируются страницей.
Panels forceMount + explicit hidden/data-state display:none: редакторы/operation keys/
receipts/canvas не размонтируются от смены вкладки. Frozen editingOrder/version прежние.
Visits/Payments закрыты во время Edit, Edit переключает Overview. key=id на page не даёт
редактору одного заказа оказаться в другом при смене маршрута. История — timeline с
раскрываемыми changes, без выдуманных имён авторов. Количества delivered/assembled
показаны отдельно, готовность/подписи/финальный Complete принадлежат прежним модулям.

Orders-only CSS обновляет presentation вложенных execution/evidence/planning/acceptance/
completion модулей. Opaque customer signing backdrop сохранён; его прозрачность не
уменьшалась ради оформления. Переписаны только presentation imports/tags/classes форм,
имена/limits/handlers/versions/idempotency не изменены. Tailwind prefix/important и
отсутствие глобального Preflight сохранены. aria-invalid border отображается в shared
controls. В jsdom добавлен только отсутствующий scrollIntoView для keyboard Select tests;
реальную геометрию/прокрутку он не проверяет. Браузерная/физическая приёмка остаётся
отдельной, полные фактические code gate результаты и первоначальные failures — PROGRESS.


## 2026-10-27 / Planning — календарь, фильтры и визит

По запросу пользователя обновлено представление существующего Planning, без нового
бизнес-этапа/endpoint/DTO/миграции. Tailwind prefix tw/noPreflight и текущая палитра
согласованы с Orders; используются имеющиеся shadcn Popover, Sheet, Select, Tabs,
Input, Button, Badge и Lucide. Прямые dependencies/lockfile не менялись.

Сохранён FullCalendar Standard **7.1.3** с уже установленными бесплатными timegrid/list/
daygrid. Проверены установленные типы и [официальный React API](https://fullcalendar.io/docs/react):
CalendarRef.getApi, changeView/gotoDate; v7 slotHeaderFormat/Interval и публичные class
hooks вместо v6 selectors или hashed internals. Month фиксирует шесть Monday-first
недель; API получает ровно [from,to)42 Rome-дня, включая предыдущий/следующий месяц.
Temporal/существующая зона Europe/Rome сохраняют DST и независимость timezone устройства.
Native date validation/навигация отвергают неполные даты и выход за допустимые границы.

Календарь и его resource больше не получают key по диапазону/reload. Calendar остаётся
смонтированным при loading/refetch/error и получает [] при смене диапазона или потере
доступа; hook продолжает abort/late-response guards и очистку при401/403/404. Refresh
читает прежние ресурсы без remount; RiskPanel получил optional refreshSignal вместо key.
Memo boundaries, стабильные callbacks/options, мемоизированные events/map и scrollTimeReset
сохраняют экземпляр/scroll. Переход даты внутри той же недели не повторяет GET и gotoDate.
Это ограничение конкретных лишних обновлений, не заявление об отсутствии React renders
или измеренных FPS: реальный performance profile требует браузера.

Range search и Popover drafts принадлежат маленьким компонентам; набор текста и поиск
команд не обновляют Calendar/API до submit/Apply. Диапазон/команды/Unassigned остаются
серверными фильтрами, а confirmation/attention/service/order progress и текст — явно
локальным срезом полного ответа диапазона. Пустое множество команд не означает All teams;
inactive исторические команды доступны. Source count/операционные показатели не подменены
количеством отфильтрованных строк. Weekends/grid step — только display settings; скрытые
выходные остаются в complete list/итогах. Полный список строит DOM только после раскрытия.

Event click открывает read-only Sheet по текущему проверенному calendar record, со
всеми командами/планом/буферами/отдельными actual/estimated временами; новая write/API
логика не добавлялась. Потеря доступа убирает preview. Modified click сохраняет обычную
ссылку. Полная карточка визита использует шесть force-mounted hidden tabs, memo workflow
wrappers/stable scopes и route key Order+Appointment. Существующие editors/versions/
receipts/tasks/confirmation/конкурентные ограничения и opaque customer signing backdrop
сохранены. Никакого изменения планового времени при показе фактического/прогноза нет.

Новые component/pure-model cases проверяют даты/month/DST, Apply/discard, отсутствие
REST/render при черновиках, сохранение Calendar на refresh/navigation, stale responses,
403 clearing, mounted drafts/canvas и исходную edit revision. Браузерные/физические
проверки и пользовательская приёмка M5–M8 остаются отдельными от этих программных результатов.


## 2026-10-27 / Teams — каталог, состав и карточка

По запросу пользователя обновлён backoffice Teams. Это UI существующих операций M2/M4,
без нового бизнес-этапа, endpoint/DTO/миграции. Используются прежние Tailwind4.3.3 с tw/
important/noPreflight, локальные shadcn Table/Sheet/Popover/Select/Tabs/Input/NativeSelect/
Textarea/Button/Badge и Lucide. Manifest/lockfile/dependencies не менялись.

Каталог читает прежний полный GET /crews (без pagination/take в существующем сервисе).
Поиск name/code/serviceArea и status/environment — явно локальные фильтры полного
ответа. Counts enabled/disabled/outdoor/total рассчитаны по этим summary rows; количество
участников/контактов не выдумывается и не загружается N+1. Таблица становится карточками
до900px, roles/labels и обычные ссылки деталей сохранены. Filters имеют отдельные
черновики с Apply/discard/chips/clear, ввод не запускает REST. Создание в Sheet сохраняет
прежний native FormData payload; pending не позволяет закрыть форму до результата.
SheetContent получил optional closeLabel/closeDisabled для этой формы, defaults для
Order/Visit preview прежние; focus возвращается Add a team.

TeamFields — локальные UI-поля с прежними names/defaults/required/limits/pattern,
crewFormValues остаётся источником сериализации. Overview/Members/Availability/Specialists
forceMount+hidden, route key=id не переносит draft на другую команду. Member search/filter
локальны; активное членство отдельно от активности аккаунта. Existing member candidates,
POST/PATCH/recovery конфликтов и запрет disabled options не ослаблялись. Memo availability
не обновляется от переключения вкладок. Native select сохранён для FormData, callback
Select используется для фильтров. Рабочие окна/буфер/недоступность/специалисты получили
согласованные controls; валидация, busy guards, expectedVersion, время и payloads прежние.

Обнаружен и воспроизведён узкий дефект существующего planning UI: независимый lastGood
поверх resource.data мог удерживать availability после401/403/404. До исправления
новые regression cases дали3FAIL/1PASS (503). Использован существующий useApiResource
с retainDataOnRefresh:true, независимый fallback удалён. Поэтому временный503 сохраняет
форму/исходную revision, а access-loss очищает все данные. Shared auth/hook/backend не
менялись. Фактические RED/GREEN/full-gate результаты сохранены в PROGRESS.

Все CSS ограничены team workspace; profile fields занимают полную grid row, служебные
summary/labels не маскируют доступ. Browser layout/focus/touch и общая пользовательская
приёмка остаются отдельными от component tests и production CSS generation.


## 2026-10-27 / TEAM-11 — различие Members и Specialists

По сообщению пользователя проверен существующий demo read-only: TEAM-11 имеет0
CrewMember,4 ExternalParticipant и0 свободных employee candidates. Это подтверждённые
разные типы записей, а не исчезновение сохранённых членств. Никакого автоматического
создания User/паролей, преобразования контактов или переноса сотрудников не выполнялось.

В UI добавлены отдельные счётчики вкладок (с прежними accessible tab names), пояснение
для команды с контактами без членов и переход View specialists. Empty candidates теперь
объясняет создание employee account администратором/освобождение прежнего членства;
Specialists явно объясняет отсутствие создания account/membership. Контракты и бизнес-
правило одного активного CrewMember, backend/auth/CSRF/данные остаются прежними.


## 2026-10-27 / Удаление видимого demo-баннера

Пользователь явно попросил убрать «DEMO — SYNTHETIC DATA» из интерфейса. RootLayout
больше не рисует banner; удалён только его неиспользуемый CSS. Это новое решение
пользователя заменяет прежнее требование визуальной метки M8. Исторические результаты
и исходный prompt сохранены. FD_DEMO_RUN/runtime isolation, DB/storage/run ownership,
приватные credentials, проверки доступа и CLI/manifest markers не менялись. Текущие
README/DEMO_RUNBOOK и существующие layout tests приведены к новому UI-требованию.


## 2026-10-27 / Accounts — каталог и редактор

По запросу пользователя обновлён backoffice Accounts, без новых backend-функций/
эндпойнтов/DTO/зависимостей. Сохранены SSR redirect, outer AccountsPanel ADMIN guard
до useApiResource и UsersController @Roles ADMIN. Не добавлены новые запреты менять
себя/последнего администратора; политики остаются у существующего backend.

Полный GET/users — единственный источник каталога и counts. Search(name/username),
role/status/membership — локально к полному ответу, без N+1 frontend requests. Фильтр
членства относится только к CREW_MEMBER; crewIds показывают активные членства, даже
у отключённого аккаунта. Unassigned не выдаётся за готовность к назначению: disabled
accounts отмечены отдельно. Ссылки конкретной команды строятся из разрешённых crewIds,
имена команд/last login/online stats не выдумываются. Таблица становится карточками900px.

Вместо множества закрытых форм со своим состоянием работает одна Sheet-форма. AccountForm
содержит прежнюю native FormData serialization POST/PATCH: immutable username в PATCH
не попадает, пустой edit password исключён, limits12–128 и username3–64 прежние. Очистка
password после success/созданиеreset/errorretain сохранены, busyref исключает double submit.
Pending не даёт закрыть drawer; focus возвращается trigger. Закрытие/сменаID очищает
редактор, поздний ответ unmounted формы не доставляется новому пользователю. Выбранный
base user фиксирован; refresh не перебазирует name/role/access/password draft. Есть
прежний DraftChangeNotice /users. Password не сохраняется вне input/FormData request.

Resource использует существующий retainDataOnRefresh:true: transient failure удерживает
последние данные, access loss очищает list и editor вместе с паролем. Target account из
mutation response не становится текущим пользователем SessionProvider; после сохранения
перечитывается/users. Прежние session revocation/self-rolechange/member deactivation
остаются на backend. Copy объясняет эти последствия и отдельное назначение Team member
черезTeams. Новые поля/автоназначения/пароли/смены реальных аккаунтов не добавлялись.

Использованы имеющиеся Tailwindtw/noPreflight/shadcn Table/Sheet/Popover/Select/Input/
NativeSelect/Button/Badge/Lucide. Новые form/filter modules — локальные UI-компоненты,
без библиотек/слоёв данных. Реальный browser/phone QA и приёмка сохраняются отдельно
от component tests и production CSS checks.


## 2026-10-27 / Issues — реестр, фильтры и детали

По запросу пользователя обновлён существующий backoffice Issues, без новых бизнес-операций,
эндпойнтов, контрактов или зависимостей. Используются прежние Tailwindtw/noPreflight,
локальные shadcn Table/Sheet/Popover/Select/Button/Badge и Lucide. Типы проблемы имеют
различимые декоративные иконки с текстовыми названиями; статус/visibility не зависят от цвета.
Таблица становится карточками до1000px; история и текст переносятся по ширине.

Фильтры status/type/pageSize и пагинация остаются серверными, прежний GET/issues.
Popover хранит отдельный draft до Apply; Escape/Close отменяет выбор. Chips/Clear
сбрасывают условия, сохраняя pageSize. Нового клиентского поиска по неполному срезу нет.
Matching issues — total API; Open/Resolved on this page — только полученные строки,
а не выдуманные глобальные метрики. GET деталей запускается только при выборе проблемы.

Одна Sheet загружает канонические GET/orders/:id и /evidence прежними runtime guards.
Форма появляется только при доступности обоих ресурсов и конкретного issue в evidence;
нет fallback к старой строке списка. После resolve строка может исчезнуть из OPEN-списка,
но сохранённая RESOLVED карточка остаётся открытой. Источник данных — API, не локальный
статус. Access loss401/403/404 любого ресурса очищает private DOM;503 сохраняет тот же
mounted редактор с исходной версией. Смена issue/order создаёт чистый редактор. Outer
role guard не запрашивает реестр для crew; существующие SSR/Nest права не менялись.

Экспортирован прежний IssueCard из EvidencePanel: оформление общее для Orders/crew/
Issues, мутации/receipt/operationKey/expectedVersion/review/retry/reopen acknowledgement
не продублированы и не изменены. В самостоятельной панели новый optional content mode
использует только прежний защищённый contentUrl действующего файла; withdrawn/неизвестные
ссылки не выдаются. В Order/crew сохранены якоря к существующей галерее, default mode прежний.
Shared CommandForm/Upload/FileCard business logic не менялась. Pending/unknown блокирует
закрытие/внешний клик/Escape и внутренние переходы из Sheet, сохраняя повтор команды.
После закрытия focus возвращается trigger или заголовку при исчезновении строки.

Resolve/reopen/note по-прежнему выполняет Nest. Разрешение проблемы не меняет количества,
FinishReport, ReturnRequest и не закрывает заказ. Повторное открытие сохраняет прежнее
явное подтверждение возможного переоткрытия завершённого Order. Проверки реальных
аккаунтов, фото, заказов и пользовательских данных агентом не выполнялись. Browser QA
и отложенная приёмка M5–M8 остаются отдельными от component tests/CSS generation.


## 2026-10-27 / Return requests — очередь и рабочая страница повторного приезда

По запросу пользователя обновлён только существующий UI повторных приездов M6.
Прежние Tailwindtw/noPreflight, локальные shadcn Table/Popover/Select/Input/NativeSelect/
Textarea/Button/Badge и Lucide, без новых зависимостей/контрактов/миграций/backend endpoints.

Очередь остаётся на GET/backoffice/return-requests со status/pageSize/page; default OPEN
и oldest-first сохранены. Popover хранит draft до Apply; Escape/Close discard, chips/Clear
сохраняют размер страницы. Поиск по неполной странице не добавлен. Matching requests —
серверный total, Awaiting planning/Ready for review on this page — только текущие строки.
Ready-to-resolve приходит с backend; UI не вычисляет его из количеств или наличия визита.
OPEN и PLANNED показаны как незакрытая потребность; RESOLVED требует прежнего действия
диспетчера. Ссылки на заказ/текущий или покрывающий визит строятся из разрешённой проекции.
Нет дополнительных GET на каждую строку. Таблица становится карточками до1100px.

Сложный planning/review workflow остаётся на полной странице детали с навигацией якорями:
Overview / Plan & review / Quantities / Attempt history / Source report. Секции и редакторы
не размонтируются от перехода по якорям. Причина и remainingWork отделены от текущих
накопленных количеств, неизменного исходного FinishReport и scope/исхода каждой попытки.
Не введены локальный автоматический resolve/изменение исходных фактов/новое закрытие Order.
Guard ADMIN/DISPATCHER предшествует ресурсам очереди и детали; прежние Nest/SSR права
сохранены. RequestId key создаёт новый scope при переходе на другой запрос;503 сохраняет
тот же редактор, access loss очищает ресурс без независимого cached fallback.

Планирование получило шесть визуальных групп и прежние native контролы через существующие
shadcn wrappers. Required carried tasks, failed-attempt absolute targets, baseline/version,
preview/confirmed, explicit new task reason, SlotFinder, reviewLatest, serialized payload
и frozen operationKey/Retry сохранены. Блок состояния/проверок/submit побайтово сравнен с
before-копией. Create/Resolve handlers не менялись; Resolve получил scoped CSS. Общий
SlotFinder не переписан; его оформление ограничено return-plan-workspace. Остальные
planning/execution/return coverage и auth/storage/realtime hooks не менялись.

Browser/телефон и отложенная пользовательская приёмка M5–M8 не заменяются component tests
или проверкой compiled CSS. Реальные запросы/заказы/аккаунты при UI-проверках не менялись.


## 2026-10-27 / Task templates — библиотека и единый редактор

По запросу пользователя обновлён только UI существующих TaskTemplates M4. Прежние
Tailwindtw/noPreflight, локальные shadcn Table/Sheet/Popover/Select/Input/NativeSelect/
Textarea/Button/Badge и Lucide. Backend/DTO/contracts/миграции/зависимости не менялись.

Каталог GET/task-templates полный, без pagination. Поиск name/code/description и фильтры
active/required/applicability/severity работают локально; нет дополнительных API на ввод
или N+1 counts. Applicability фильтрует настройку шаблона точно, не выводит совместимость
с выбранным сервисом: ALL («All-service templates») явно отличается от отсутствия фильтра.
Summary отражает полный каталог, Showing — локальный результат. Required&enabled считает
только оба флага. Порядок defaultPriority ASC/code ASC сохранён. Таблица становится
карточками до1000px. Текст/иконки отделяют доступность, обязательность, важность и сервис.

Вместо множества редакторов работает одна Sheet создания/редактирования. Форма содержит
прежние native FormData fields/trim/POST/PATCH/defaults/limits. Code readonly при edit и
не входит в PATCH. Base template фиксируется при открытии; key=create/ID сбрасывает
черновик при смене записи. Refetch того же ID не меняет ввод; DraftChangeNotice сохранён.
Busyref исключает double submit, Sheet/Close/Escape/outside/Cancel заблокированы pending,
late ответ unmounted формы игнорируется. После создания форма закрывается, повторное
открытие чистое; edit сохраняет контекст. Запись, исключённая локальным фильтром после
сохранения, остаётся в редакторе из полного каталога. Focus возвращается trigger/fallback.

Обнаружена и воспроизведена конкретная прежняя ошибка private UI cache: собственный
lastGood удерживал templates/forms после401/403/404, несмотря на очистку useApiResource.
До исправления regression дал3FAIL/1PASS(503). Удалён независимый fallback, использован
существующий retainDataOnRefresh:true. Поэтому503 сохраняет форму, access loss удаляет
каталог/drawer/draft. Shared hook/auth не менялись. Outer ADMIN/DISPATCHER guard до ресурса
добавлен в UI; прежние SSR/Nest роли/транзакции остаются источником прав.

У TaskTemplate нет optimistic version/idempotency key; новый контракт не придуман.
Сохранены прежний явный submit после ошибки, уникальный code, POST/PATCH и planning-changed
событие. Изменение/отключение шаблона влияет на будущие подходящие назначения и не
переписывает прежние задачи/историю. Return planning сохраняет свой явный scope M6.

Browser/телефон и отложенная пользовательская приёмка M5–M8 не подменены component tests
или compiled CSS. Реальные шаблоны/назначения/аккаунты/пароли агентом не изменялись.


## 2026-10-27 / Crew — мобильный список и рабочая страница визита

По запросу пользователя обновлён только Crew UI существующих M5–M8 операций. Использованы
прежние Tailwindtw/noPreflight, локальные shadcn Button/Badge/NativeSelect/Input/Textarea/
Sheet и Lucide, без новых зависимостей/контрактов/схемы/бизнес-операций.

Shell сохраняет прежние loadSession/SSR role redirects/SessionProvider/logout. Новая
My work/My team навигация отмечает активный раздел и остаётся доступной при прокрутке.
Карточки читают прежние view/page/pageSize: Today/Upcoming/Open/Completed и server
businessDate Europe/Rome. Counts относятся к выбранному API view. Статус, подтверждение,
плановое окно, команда/услуга и предупреждение о возможной задержке отделены; нет
вымышленных общих счётчиков, ETA, маршрутов, GPS или административных ссылок.

Деталь сохраняет отдельные planned/estimated/actual, contacts/access, accumulated OrderItem
quantities, checklist, immutable finish report, return requests, acceptance/evidence.
Навигация по разделам — обычные якоря, без unmount/tabs. В ходе статического review найден
UI-дефект нового sticky shell: offset20px мог прятать заголовок под навигацией≈66px.
Введён scoped --crew-navigation-offset90px для card/result/material anchors. Это вывод из
CSS, не выполненный браузерный scroll-тест.

Одна Sheet содержит task/item/finish editor с прежним structuredClone snapshot и key.
Editor живёт независимо от актуального списка задач/товаров. optional onBusyChange
сообщает command.locked (pending/unknown); stable parent setter блокирует Sheet close,
Escape/outside и сохраняет исходный Retry. ReadOnly после terminal не уничтожает draft;
новые запросы запрещены, исходный unknown может подтвердить прежний receipt. Access
loss очищает весь private DOM; новая assignmentId создаёт новый scope. Error/Retry
видны внутри Sheet, когда background становится aria-hidden. Focus возвращается trigger
или безопасному fallback.

Четыре useCommandAttempt blocks в forms сравнены с before после нормализации whitespace:
совпали. Сохранены allowedActions, expectedExecution/Appointment/Task/Fulfillment versions,
operation keys, absolute totals/correction reason, partial/blocked reason/remainingWork/
return flags и busyguards. Не выводить разрешённость действия из локального checklist
или количеств. Завершение команды не завершает другую команду или Order.

Main acceptance/evidence/canvas остаются mounted при открытии Sheet/refetch/якорях.
Исходники acceptance-panel/evidence-panel/signature-canvas/acceptance.css не менялись;
непрозрачный customer backdrop, белый dialog, canvas dimensions/touch-action и camera
accept/capture остаются прежними. Все чтения — Crew DTO /crew/assignments; root /orders,
финансовые/internal fields и публичные файлы не добавлены. Backend/auth/CSRF/DataSource/
receipts/realtime guards не менялись.

Новые component tests проверяют DOM retention/keyboard/драфты с синтетическими fixtures;
mock canvas retention не означает работу физической камеры/реального браузера. Browser
390/1280/phone/canvas и отложенная приёмка M5–M8 остаются отдельными проверками.


## 2026-10-28 / Crew My team — состав и контакты

По запросу пользователя обновлён только read-only интерфейс /crew/team. Сохранены GET
/crews и /crews/:id с существующими runtime guards. StaffTeams имеет outer CREW_MEMBER
guard до ресурсов; прежняя SSR-защита Crew layout и backend права не менялись. Список
команд определяется API, а не кешированными crewIds клиента. Деталь запрашивается только
для возвращённых сервером IDs. Отдельный запрос на каждого человека не добавлен.

Участники и внешние специалисты — разные карточки. Member displayName/username/You,
членство active/inactive и account disabled показаны отдельно. Телефона/email сотрудника
в PublicUser DTO нет, их не выдумываем. У ExternalContact только реальные непустые
phone/email создают tel/mailto. Кнопки48px, длинные значения переносятся. Отключённые
команды, членства, пользователи и контакты не скрываются автоматически: API отдавал их
ранее, UI сохраняет видимость и явно показывает статус. Counts не означают online/
доступность для назначения. Изменение состава/контактов по-прежнему только в backoffice.

Локальный поиск по разрешённой полной детали охватывает имена/username/specialty/phone/
email, без REST на ввод. Clear/Show everyone восстанавливают оба списка. Refresh my team
перечитывает список и детали: refreshId меняется только по явному refresh/focus fallback,
initial useRef предотвращает двойной GET при mount. Существующий realtime coordinator
использует прежние crews/crew-team topics; fallback focus действует только без него.

useApiResource retainDataOnRefresh:true — единственный кеш:503 сохраняет DOM и поиск,
401/403/404 убирают соответствующую карточку, потеря parent list убирает всех children.
Нет fallback к CrewSummary или lastGood. Удалённый crewId размонтирует старый detail,
абортирует запрос, поздний ответ не возвращает прежних людей. Role/member scope reset
SessionProvider сохранён. Backend/auth/CSRF/DataSource/contracts/зависимости не менялись.

Использованы прежние Tailwindtw/noPreflight, shadcn Input/Button/Badge и Lucide. Browser
390/1280/реальные tel/mail handlers и общая приёмка M5–M8 остаются отдельной проверкой.


## 2026-10-28 / Небольшие UI-правки login/status/dashboard

На login добавлен доступный Show/Hide password (Eye/EyeOff, type=button, aria-controls/
aria-pressed). Меняется type одного и того же input; value/autocomplete и прежний POST
не меняются, пароль не переносится в новый store. Во время submit поле снова маскируется,
переключатель блокируется вместе с вводом; ошибка сохраняет введённое значение. Label
связан с input через useId/htmlFor; кнопка не вложена в label другого control.

Публичный Service status получил Back (ArrowLeft): обычный router.back при наличии
истории, иначе /login с прежним переходом в workspace после проверки сессии. Health
запросы/индикаторы/Retry не менялись. На dashboard только custom refresh SVG заменён
на Lucide RotateCw; обработчик, pending и данные прежние. Backend/auth/deps не менялись.


## 2026-10-28 / Активный раздел Backoffice и один индикатор Planning

Единый клиентский BackofficeNavigation использует usePathname: Dashboard и Service
status совпадают только с точным URL, остальные разделы остаются активными на своих
вложенных страницах. Выбранная ссылка получает зелёные фон/рамку/маркер и aria-current,
остальные сохраняют focus-visible/hover. Ссылки остаются Next Link, меню переносится
на узком экране. Accounts по-прежнему только ADMIN; CREW_MEMBER административное меню
не получает. Серверные проверки сессии/ролей и logout не изменены.

На публичном Service status это же меню доступно вошедшим ADMIN/DISPATCHER.
Необязательный серверный ServiceStatusNavigation использует прежний loadSession под
отдельным Suspense: ожидание/отказ проверки сессии не блокирует health, Back и Sign in.
Anonymous/unavailable/crew не получают административные ссылки; redirect не добавлен.
Новых бизнес-запросов, session storage или дублирования прав на клиенте нет.

У Complete visit list оставлен один декоративный ChevronDown, поворачивающийся по
состоянию details[open]. Нативный marker скрыт, а унаследованный из orders-detail-theme
summary::after подавлен только для этого списка. Список остаётся нативным details с
прежней сортировкой/ленивым содержимым; раскрытие не вызывает запросы API или ререндер
календаря. Backend/данные/контракты/зависимости не менялись.
