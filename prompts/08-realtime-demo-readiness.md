# M8 — Обновление интерфейсов, демонстрационные данные и подготовка к приёмке

## 0. Статус, разрешение и исходное состояние

Это задание для Codex, НЕ готовая реализация и НЕ независимое ревью исходников.
Выполнять только после отдельного разрешения пользователя на M8.

Основа: AGENTS.md, PROJECT_SPEC, DOMAIN_RULES, MILESTONES, актуальные DECISIONS,
PROGRESS, задания 04–07 и фактический код. Новые решения и числовые defaults ниже —
предлагаемые решения тестового MVP, а не новые требования работодателя.

По предоставленному отчёту M7 run `20261026T144556Z`: 416 unit/component, 190 integration,
production build и остальные программные проверки PASS. Добавлены две M7 миграции;
исторические ошибки и один DB timeout с неизвестной первоначальной причиной сохранены.
Эти результаты относятся к M7, а не к ещё не написанному M8.

M5 B/C, интерфейсы M6/M7, физический телефон/камера/canvas и приёмка пользователем
отложены. Разрешение на M8 не превращает их в ACCEPTED и не отменяет browser permission.
В этом задании НЕ открывать браузер, не запрашивать разрешения заново и не обходить
отказ другим origin, портом, HTTP/CLI или headless-инструментом.
Разрешённые автоматические сетевые тесты — только существующий изолированный test
harness, не запросы к запрещённому development-origin вместо браузерной проверки.

Сейчас довести M8 до программно проверенной версии для финальной пользовательской
приёмки. После него не добавлять M9 или новые бизнес-функции автоматически.

## 1. Цель и границы

Получить поведение:
изменение сотрудником или диспетчером → commit → уведомление разрешённому клиенту →
повторное чтение актуальных данных через обычный API → обновление второго интерфейса
без перезагрузки страницы и без потери открытой формы.

Включить:
- авторизованные realtime-сигналы, reconnect, ограниченное резервное обновление;
- сохранность drafts, исходных versions, подписного canvas и неизвестных mutation results;
- 30–50 вымышленных заказов разных стадий в отдельном демонстрационном окружении;
- воспроизводимые программные workflow tests и чистый локальный запуск;
- точечное улучшение состояний UI, инструкции демо и единый список финальной приёмки.

Не включать новую бизнес-логику, redesign, внешние интеграции, уведомления клиентам,
GPS, маршрутный оптимизатор, PWA/offline, PDF-экспорт, CRM, эквайринг, подписи внешнего
провайдера, Redis/Kafka, отдельный realtime-микросервис, CQRS, event sourcing или outbox.
Не менять правила M3–M7 ради удобства демонстрации.

Работать тремя последовательными частями: транспорт и права → frontend/черновики →
демо, workflow tests и инструкции. Кратко фиксировать результат частей и продолжать
M8 без промежуточной браузерной приёмки.

## 2. Сохранность проекта

Проверить Git status/diff, untracked файлы, текущий checkpoint и фактические версии.
HEAD может содержать только M1/M2: не считать untracked-модули M3–M7 лишними файлами.
Не выполнять reset/restore/clean/stash, staging, commit, push, deploy или публикацию.
Использовать имеющиеся checkpoint/delta; не строить новую систему резервирования.

Сохранить .env, пароли, данные, private storage, существующие миграции, один DataSource,
synchronize:false, auth/Origin/CSRF, ручной журнал платежей и signed snapshots.
Дополнительные schema changes допускаются только при конкретной необходимости через
новую миграцию; realtime сам по себе не требует таблицы уведомлений.

Сохранить закреплённые версии и lockfile. Предложенный транспорт использует Nest/RxJS
и браузерный API; не устанавливать новый state/query manager или брокер. Обнаруженную
недостающую прямую зависимость оформлять только после проверки установленной версии,
не обновлять весь стек. Не копировать API Nest 12 или TypeORM 1 в текущие Nest 11/TypeORM 0.3.

## 3. Транспорт: SSE как минимальное решение M8

Предлагаемый выбор — Server-Sent Events (SSE) в существующем NestJS, не WebSocket.
Все mutations остаются прежними HTTP-командами. SSE передаёт только сигнал «данные
изменились», не исполняет действия, не заменяет БД, version checks или idempotency.
Записать этот выбор и ограничения одного процесса в DECISIONS.

Использовать один аутентифицированный stream на активный authenticated layout/tab,
например `/api/realtime/events`; имя согласовать с conventions. Frontend обращается
через существующий same-origin Next proxy. Next не читает БД и не становится вторым
сервером бизнес-логики. Не открывать публичный direct-API origin ради SSE.

Требования:
- handshake до выдачи stream проверяет существующую HttpOnly session и актуального
  пользователя. Без сессии — 401, запрещённой роли — существующая политика отказа;
- не передавать session token в URL/query, JSON, localStorage или логах;
- native EventSource GET не требует добавления mutation-header. Не ослаблять защиты
  POST/PATCH и не освобождать весь `/api` от guard ради этого GET;
- при явно чужом Origin/Fetch Metadata отклонять stream по согласованной same-origin
  политике. Не требовать несуществующий browser header и не включать wildcard CORS;
- Content-Type text/event-stream, Cache-Control no-store/no-transform; поток не должен
  накапливаться в proxy/compression до закрытия соединения;
- короткие heartbeat/ready и ограниченные invalidation packets, без большого JSON;
- документированные ограничения connections/размера очереди, очистка при disconnect,
  abort во время setup, logout, shutdown и ошибке БД; не держать QueryRunner/transaction
  или выделенное DB-соединение на весь срок SSE;
- использовать cleanup установленной версии Nest и свои проверки утечек, не полагаться
  на произвольный пример из документации другой версии.

Проверить streaming через собранный Next proxy в разрешённом изолированном harness:
первый event виден до завершения ответа, последующий event — в том же соединении.
Проверка прямого Nest без proxy недостаточна. Недоступную проверку записать BLOCKED,
а не объявлять транспорт проверенным по наличию кода.

## 4. Commit, доставка и права на уведомления

### 4.1. Публикация

Уведомления отправляются только после успешного ВНЕШНЕГО commit бизнес-транзакции.
Не считать `save`, `afterUpdate`, HTTP 2xx или освобождение savepoint доказательством commit.
Изучить текущие QueryRunner/manager paths и добавить небольшой общий механизм
post-commit invalidation, без переписывания всех use cases в новую архитектуру.

Rollback, ошибка audit и непринятая mutation не публикуют сообщение об изменении.
Сбой доставки уведомления после commit не откатывает сохранённую работу и не превращает
успешную mutation в ложный FAIL. Не оставлять unhandled promise rejection.
Повтор idempotent command не повторяет бизнес-эффекты; лишний сигнал, если неизбежен,
должен быть безопасен и coalesced, не дублировать историю/платёж/подпись.

Однопроцессный in-memory hub допустим. Честно документировать best-effort доставку:
при остановке между commit и publish сигнал может потеряться. Reconnect, focus и
редкое контрольное refetch восстанавливают состояние. Не обещать exactly-once,
надёжный replay Last-Event-ID, межпроцессную доставку или работу нескольких replicas.
Не создавать durable event log и не переиспользовать ActivityLog как публичный stream.

### 4.2. Payload и адресаты

Использовать allowlist небольших тематических invalidations. Пример формы, не готовый API:
`{ eventId, topics, emittedAt }`. Нужные ID допускаются только после проверки конкретного
объекта; generic topic без ID предпочтительнее передачи лишних идентификаторов.

Никогда не передавать суммы, payment records, internalNotes, тексты клиента/адрес,
описания issues, private file metadata/paths, PNG/base64 подписей или полный Order.
Клиент повторно запрашивает данные через существующий авторизованный DTO.

Фильтрация обязательна, даже для коротких событий:
- ADMIN/DISPATCHER получают разрешённые backoffice-изменения;
- crew получает только изменения разрешённых ему назначений/заказов/команды;
- финансовая или только BACKOFFICE_ONLY правка не создаёт отдельный сигнал crew;
- чужой заказ и изменение private signature-review не раскрываются через topic или ID;
- смена назначений должна обновить списки прежней и новой команды. Прежней стороне
  можно отправить обезличенное «перечитать список», но не новые данные снятого заказа;
- shared данные нескольких команд одного Order уведомляют только имеющих разрешённый
  доступ участников. Сохранять правила чтения истории и disabled Crew из M5.

Перед каждой отправляемой группой событий проверять текущие session/user/role/membership
и область доступа, не доверять только состоянию handshake. Во время простоя проверять
доступ на heartbeat, целевой максимум интервала 30 s. Это предел обнаружения изменения
на простаивающем соединении, не обещание мгновенной очистки всех устройств.
Существующие HTTP-чтения продолжают проверять права на каждом запросе.

Logout/revocation/disabled user/expiry прекращают stream. Изменение membership/доступа
инициирует безопасный access-reset без чужих IDs: клиент отменяет старые reads, очищает
данные и приватные drafts, перечитывает session и разрешённый scope. Ошибка БД — fail
closed для данных, без передачи сигналов на основе устаревших прав.

Каналы/crewId/orderId из клиента не являются авторизацией. Не создавать `join any room`.

### 4.3. Покрытие существующих изменений

Зафиксировать небольшую карту mutation → разрешённые topics → активные read models:
- orders/items/payments/VOID → backoffice list/detail/dashboard; crew только при
  фактическом изменении разрешённых рабочих полей, не от финансового события;
- appointments/assignments/confirmation/cancel/tasks → planning, соответствующие
  crew work lists/details и затронутые readiness/order summaries;
- execution/tasks/quantities/estimate → crew shared data, backoffice execution/risk;
- notes/attachments/issues/returns → разрешённые evidence/issue/return views;
- snapshots/signature/absence/review/complete/reopen → разрешённые acceptance/readiness;
- users/membership/crews/availability/templates → разрешённые справочники, access reset
  и planning invalidation, без раскрытия закрытого admin endpoint сотрудникам.

Не вызывать полный refetch всех страниц на каждый event.

## 5. Frontend: обновления без потери работы

Расширить текущие resource hooks и session provider. Не мигрировать приложение на новую
query-библиотеку. Одна подписка/координатор на layout, не отдельный stream в каждой карточке.
Cleanup должен работать при StrictMode, смене route, смене user и закрытии вкладки.

Сигнал только помечает связанные ресурсы stale и инициирует их безопасное чтение.
Не обновлять progress/paid/readiness догадкой из payload и не запускать mutation из event.
Защищаться от повторных/поздних сигналов и late HTTP responses предыдущего пользователя.

Предлагаемые defaults (документировать фактические): coalesce около 250 ms, один read
в полёте на resource key и максимум один отложенный повтор, минимальный интервал около
2 s между автоматическими reads одного ресурса. Тяжёлый dashboard обновлять не чаще
примерно 5 s при потоке событий. Без бесконечно отодвигаемого debounce и без потери
последнего изменения. Ручной Refresh остаётся доступен; он не плодит дубли запросов.

При reconnect/возврате focus/visibility и после offline:
1. проверить session и актуальный scope;
2. перечитать активные разрешённые ресурсы;
3. только после успешного чтения обновить dataLastSyncedAt.
Не считать heartbeat или open SSE подтверждением свежести карточки.
При первичной загрузке закрыть race между подпиской и начальным GET повторной
инвалидацией, чтобы изменение на границе подключения не пропало навсегда.

Если stream недоступен, включить ограниченный fallback для видимых экранов: например,
один цикл refetch раз в 60 s с backoff на ошибки. Редкая контрольная синхронизация
нужна и при здоровом stream — восстановить потерянный сигнал после commit и пересчитать
риски/Today при течении времени без записи в БД. Скрытые вкладки не опрашивают тяжёлые
ресурсы; при возвращении сначала sync. Rome midnight не зависит от timezone устройства.

Reconnect не должен создавать два competing retry-loop. EventSource error не выдаёт
весь HTTP status: использовать существующую безопасную session revalidation; после
подтверждённого 401 закрыть stream и не стучать бесконечно. При недоступном API показывать
ошибку соединения, не выдавать её за доказанный logout. Ограничить backoff и память.

Показывать небольшое состояние Live / Reconnecting / Periodic refresh / Unavailable
и реальное время успешного обновления. Не обещать hard realtime или сохранение offline.

### Формы, canvas и права

Открытый черновик — отдельный снимок, не live query object.
- Refetch не сбрасывает поля, dirty-state, expectedVersion, idempotency key или frozen payload.
- При новых данных показать «данные изменились», сохранить ввод и предложить явное
  перечитывание/сопоставление. Не прикреплять свежую version к старому payload автоматически.
- Не делать router.refresh() всей страницы на каждое уведомление, размонтируя редакторы.
- Не уничтожать signature strokes/Blob при обычном фоне, но и не переносить рисунок
  на новую редакцию acceptance snapshot. При invalidation текущей редакции запретить
  submit, явно показать устаревание; новая подпись требует нового просмотра и действия.
- Pending/unknown mutation не переотправляется автоматически из события. Retry остаётся
  явным и использует исходный payload/key по правилам M3–M7.
- Потеря прав важнее сохранения черновика: очистить запрещённые данные, имена/PNG/Object
  URLs/подписной canvas, отменить старые reads до navigation. Поздний ответ не восстанавливает их.
- Смена страницы/фильтров сохраняет принятые guards от ответа предыдущего resource key.

## 6. Ограничение нагрузки и точечная проверка dashboard

M7 зафиксировал один dashboard Query read timeout, причина UNKNOWN; финальный suite
прошёл после узкого упрощения completedCount. Не объявлять это доказанным объяснением
timeout и не начинать массовый рефакторинг resolver только из-за длины SQL.

До финала измерить на изолированных 30–50 заказах реальные read durations и число reads
при серии mutations. Проверить отсутствие запроса полного dashboard на каждый heartbeat,
каждую строку checklist и каждый одновременно полученный event. Наблюдения — с указанием
данных/окружения, без заявления production capacity из небольшой fixture.

При воспроизводимом медленном запросе сохранить безопасный EXPLAIN/план на test-данных,
исправлять конкретный запрос/индекс с regression. Не повышать timeout или ослаблять
assertions ради зелёного результата; не вводить materialized views/кеш-сервис без необходимости.

## 7. Воспроизводимое демонстрационное окружение

Отдельная opt-in команда подготовки демо, ориентир 40 заказов (допустимо 30–50), 10
команд и 40 сотрудников плюс диспетчер/администратор. Не менять обычный db:seed в
массовое завершение прежних development-заказов. Не сбрасывать текущие пароли и данные.

Использовать существующие fixture/seed helpers; привести минимальные необходимые
helper/scripts в versioned source, чтобы демо не зависело от отсутствующего /private/tmp
или игнорируемого файла на компьютере автора. Не создавать параллельную бизнес-реализацию.

Demo target строго отделён от development/production: существующая выделенная test/demo
БД, собственные schema и private storage с owner marker/run ID. Явная проверка target
до записи; отсутствие fallback на development. Настройки передавать окружением процесса
и приватным run-state, не перезаписывать root .env. Origin не менять ради обхода разрешений.

Подготовка возвращает стабильные ссылки/номера выбранных сценариев в manifest.
Пароли случайные или явно переданные локально, не выводятся в log/README/чат; приватный
локальный credentials-файл 0600. В UI демонстрационного окружения явно показать
DEMO — SYNTHETIC DATA, без отключения guard или появления публичных аккаунтов.

Состояния данных должны быть согласованными: Inbox, неназначенные/назначенные визиты,
активная работа, задержка и следующий визит, partial + issue + return, follow-up,
ожидание подтверждений, COMPLETED/reopened; различные ручные оплаты независимо от работ.
Не устанавливать произвольные computed status вручную. Использовать domain operations
или согласованные test builders; проверять результат действующим resolver и readiness.
Синтетические PNG-подписи допустимы только как явно обозначенные demo fixtures, никогда
не переносить их в существующие заказы или выдавать за подписи реальных лиц.

baseDate — Rome local date; даты и IDs фиксируются в manifest запуска. Повтор для того
же run не двигает appointments, не перезаписывает ручные изменения, signatures, payments
или passwords. Для нового демонстрационного дня создавать новый отдельный run, а не
переписывать историю старого. Обычная БД не получает ни fake actual timestamps, ни фото.

Предусмотреть start/stop/cleanup только своего demo run; очистка отдельная явная команда
с проверкой ownership. Никаких down -v, prune, удаления чужих схем или общего reset.
Демонстрационные данные не смешивать с QA fixtures, автоматически удаляемыми тестами.
После текущего программного теста его ресурсы убрать; долгоживущее демо для пользователя
запускать по документированной отдельной команде, не оставлять неизвестные процессы.

## 8. Программные сценарии и чистый запуск

Добавить небольшие сквозные HTTP/workflow tests на реальных test PostgreSQL/storage,
без моков бизнес-API. Это не browser E2E, так и называть в отчёте.

Обязательные истории:
1. Создание → две команды → общие quantities/checklists → отдельные результаты →
   immutable snapshot/подписи → readiness → Complete. Финансы не дублируются.
2. Активная задержка → estimate → риск следующего визита → search/preview/apply →
   NEEDS_CONFIRMATION; затем partial/issue → return plan → остаточные задачи → finish →
   явный resolve → подписи фактических визитов → Complete при всех прочих условиях.
3. Issue после close → Reopen → старый complete replay не закрывает заказ; разрешение
   проблемы не вызывает скрытый auto-close. Чужие файлы/подписи/финансы недоступны.

Realtime проверяется двумя независимыми авторизованными test clients: mutation одного,
сигнал и новый canonical GET второго. Отдельный тест Next proxy streaming. Эти проверки
не записывать как «два настоящих браузера проверены». Browser E2E выполняется позже.

Свежую установку проверять из чистой копии ТЕКУЩИХ tracked + untracked исходников,
без .env, private files, .tmp, .next, dist и node_modules. Не клонировать старый HEAD M1/M2
и не называть это проверкой версии M8. Установка frozen-lockfile, build, свежие миграции
и opt-in demo prepare выполняются против отдельного target. Записать реальные результаты.

## 9. Минимальная матрица realtime/component/integration тестов

1. Commit → event; rollback/audit failure → event отсутствует. Publish failure после
   commit не отменяет mutation. No-op/replay не создают бизнес-дубли.
2. Два разрешённых клиента: изменение → refetch → актуальные данные без ручного reload.
3. Unauthenticated/revoked/expired/disabled session не получают stream; чужие темы,
   private documents, payment/private payloads не видны crew.
4. Смена membership/role, снятие назначения и отключение доступа во время stream:
   старый доступ не сохраняется; пустой поток переавторизуется в документированный срок.
5. Следующий assignment новой команды появляется в списке; снятый исчезает без утечки
   нового scope. Старые ответы предыдущей сессии не возвращают данные после logout.
6. Disconnect/restart/reconnect и пропущенное post-commit event восстанавливают state
   через canonical API; дубли/порядок hints не откатывают новые данные.
7. Event storm coalesced; один read на key в полёте; нет бесконечного starvation,
   listener/timer/connection leak после закрытия/StrictMode и роста очереди slow client.
8. Dirty order/payment/planning/finish/return forms сохраняют поля, version и key;
   чужое изменение не превращает stale draft в автоматически принятый запрос.
9. Signature canvas сохраняется при обычном refetch; invalidation не переносит подпись
   на новый snapshot; access loss стирает её, late response не восстанавливает.
10. Ready/heartbeat без успешного data GET не обновляет lastSyncedAt. 401 не смешивается
    с временным offline; fallback/error/Retry состояния и backoff проверяются fake clock.
11. Ночью в Europe/Rome и по истечении estimate риски/Today меняются без mutations;
    timezone устройства/процесса не меняет бизнес-день. Focus после sleep восстанавливает данные.
12. Настоящий streaming через Next proxy; cookies/auth не теряются, ответы не буферизуются
    до close, опасные заголовки/токены не добавлены. Test error paths завершают ресурсы.
13. Demo prepare/repeat не дублирует и не перезаписывает manual edits; target/ownership
    guards не дают очистить development или чужой fixture; seed/M7 PNG/history сохранены.
14. Финансовые aggregates и completedCount не меняются из-за новых JOIN/notifications;
    read-load ограничена, прежние concurrency/idempotency regressions M1–M7 проходят.

## 10. Инструкции и финальная очередь приёмки

Обновить README и DECISIONS; добавить два компактных файла:
- docs/DEMO_RUNBOOK.md — реальные команды fresh install, Compose PostgreSQL, миграций,
  demo prepare/start/stop, credentials path, выбранные истории и восстановление обычного dev;
- docs/FINAL_ACCEPTANCE.md — сводная матрица UI/устройств/безопасности из M5–M8 с местом
  для фактического результата, версии исходников, доказательств и оставшихся ошибок.

Минимального Docker demo runbook достаточно: существующий Compose для PostgreSQL +
документированный Next/Nest запуск. Не называть это полной контейнеризацией, если её нет;
не добавлять deployment-платформу. Cookie Secure/HTTPS production policy сохранить.
Локальный HTTP demo должен быть явно development/test, не скрытая отмена Secure в production.

В runbook описать сохранность БД И private file storage: PNG-подписи M7 в БД, фотографии
M5 отдельно. Backup/restore procedure не считать проверенной, если её не выполняли.

Указать ограничения: один API процесс, best-effort SSE, bounded polling, browser HTTP/1
connection limits, отсутствие offline, внешних интеграций/оптимизации маршрута, непроверенный
телефон/камера/canvas, юридическая проверка подписей вне MVP. Не заявлять production-ready.

FINAL_ACCEPTANCE сохраняет уже отложенные B/C и весь список M7 PROGRESS:
- M5 partial+issue/фото/return, документы/visibility/PDF20MiB/ошибки/retry/старые URLs;
- M6 estimate/risk/перенос/409, follow-up/cancel/retry/resolve;
- M7 реальные подписи, absence review, Complete/Reopen, приватность и старые Retry;
- M8 два разных сеанса/устройства, live/fallback/reconnect и drafts/canvas;
- 390/1280, клавиатура/labels, Rome vs Asia/Tokyo, настоящие камера/touch/rotation;
- чистая установка и показ трёх демонстрационных историй по runbook.

Исторический PASS A относится к прежней версии M5; не выдавать его за проверку нового
M8 UI. Программные проверки transport/components тоже не заменяют финальное UI наблюдение.

## 11. Завершение M8

В ходе разработки — targeted tests. На окончательном коде последовательно выполнить:
lint, format:check, typecheck, полный unit/component, integration, build, git diff --check;
проверить миграции/seed, demo repeat, workflow tests, proxy streaming и clean-run.
Сохранить безопасные stdout/stderr, команды, exit codes и связь с актуальными inputs.
Не ослаблять assertions/timeout, не повторять весь suite после каждого изменения текста.
Браузерные проверки пометить DEFERRED BY USER, реальные ограничения среды — BLOCKED.

Development не использовать для destructive QA. Новые необходимые dev migrations —
только после test-успеха, проверки target и сравнения прежних значений; без общего seed.
Сохранять исходный режим запуска, ownership процессов проверить перед остановкой.
Не оставлять fixture API/test Next случайно вместо обычного development.

Финальный отчёт: реализованное, изменения/решения, актуальные проверки, ограничения,
команды демонстрации, список финальной пользовательской проверки, процессы.
Не печатать реестр сотен hashes или credentials. Отдельные статусы:
M8 IMPLEMENTATION / CODE CHECKS / DEMO PREPARATION / UI VERIFICATION / USER ACCEPTANCE.
Не отмечать ACCEPTED автоматически. После M8 остановиться: финальная приёмка и
исправления по ней, не новые функции. Commit, push, deploy требуют отдельного разрешения.

## Справочные источники для транспортной части

Проверены при подготовке 26 октября 2026; перед использованием сверять с установленными
версиями. Эти источники не подтверждают выполнение проекта:
- NestJS v11 SSE: `https://docs.nestjs.com/v11/techniques/server-sent-events`
- MDN, Using server-sent events: `https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events`
- MDN, EventSource: `https://developer.mozilla.org/en-US/docs/Web/API/EventSource`
