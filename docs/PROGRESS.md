# Прогресс

## Этапы

| Этап | Состояние |
| --- | --- |
| M1 | ACCEPTED — подтверждено пользователем перед M2 |
| M2 | ACCEPTED — пользователь подтвердил приёмку перед M3 |
| M3 | ACCEPTED — пользователь подтвердил приёмку перед M4 |
| M4 | ACCEPTED — пользователь подтвердил приёмку перед M5 |
| M5 | Исторический code gate/A сохранены; B/C/телефон и пользовательская приёмка DEFERRED BY USER до конца разработки; не ACCEPTED |
| M6 | CODE CHECKS VERIFIED — реализация завершена; UI DEFERRED BY USER; USER ACCEPTANCE PENDING, не ACCEPTED |
| M7 | CODE CHECKS VERIFIED — реализован; UI DEFERRED BY USER; USER ACCEPTANCE PENDING, не ACCEPTED |
| M8 | IMPLEMENTED / CODE CHECKS VERIFIED / DEMO PREPARATION VERIFIED; UI DEFERRED BY USER, USER ACCEPTANCE PENDING |

## 2026-10-28 / Подготовка публичного репозитория для ревью работодателем

Пользователь разрешил публикацию кода в GitHub и выбрал публичный репозиторий
**komilolimov/furniture-delivery**. Подтверждена авторизация аккаунта komilolimov.
Проверены существующая история baseline и509 файлов текущего дерева: реальные значения
секретов из локального окружения/private demo credentials не найдены; .env, uploads,
private storage, PostgreSQL data, node_modules, сборки, логи и .tmp не включены.
.env.example содержит только placeholders; /storage/ дополнительно внесён в .gitignore.

Функциональные исходники совпадают с проверенным navigation-ui-20261028t075617z:
704 unit/component и production build PASS относятся к тому сохранённому запуску,
новый test/build gate для публикации не выполнялся. Локальный generated next-env.d.ts
с путями текущего demo сохранён на диске и исключён из нового commit; существующая
версия baseline остаётся в Git. Приложения/БД/пароли не менялись, Vercel deploy не запускался.
Отложенные browser/device проверки и пользовательская приёмка M5–M8 остаются PENDING.
Локальные manifest/проверки состава публикации: .tmp/github-publication/20261028T084049Z/.

## 2026-10-28 / Активная навигация Backoffice и стрелка Planning

Run **`navigation-ui-20261028t075617z`**. Прочитаны AGENTS и актуальные проектные
документы, проверены Git status/diff/staging и фактические layout/Planning/CSS.
Существующие изменения сохранены; targeted before-копии и hashes — в игнорируемом run.

- BackofficeNavigation отмечает текущий раздел зелёными фоном/рамкой/маркером и
  aria-current=page. Dashboard и Service status имеют точное совпадение пути;
  Orders/Planning/Issues/Return visits/Teams/Task templates/Accounts сохраняют выделение
  при переходе в свои детали. Меню использует Next Link и переносится на узком экране.
  Accounts остаётся ADMIN-only; прежние серверные role guards/logout сохранены.
- На Service status это же меню видно вошедшим ADMIN/DISPATCHER. Серверный необязательный
  ServiceStatusNavigation загружается под отдельным Suspense. Health/Back/Sign in
  доступны независимо от ожидания сессии; anonymous/unavailable/crew не получают
  backoffice menu. Бизнес-операции/health API/auth/CSRF не менялись.
- Complete visit list получил одну ChevronDown с поворотом при открытии. Убрана
  декоративная ListFilter, скрыт native marker и подавлен второй summary::after,
  приходивший из общего orders-detail-theme. Сохранены native details, сортировка и
  lazy list; раскрытие не вызывает дополнительных API-запросов/ререндеров календаря.
- Изменения только apps/web и документации, без backend/contracts/dependencies/schema.
  DECISIONS обновлён; реальные данные/аккаунты/пароли не изменялись.

### Фактические проверки

Node24.22.1/pnpm10.34.8. Последовательные stdout/stderr с redaction, команды/start/end/
child exit codes: **`.tmp/m8/navigation-ui-20261028t075617z/`**.

| Проверка | Результат |
| --- | --- |
| Focused navigation/status/layout/planning/health | **PASS, exit0,55/55**, `10-final-affected.log` |
| `pnpm lint` | **PASS, exit0**, `05-final-lint.log` |
| `pnpm format:check` + окончательный CSS | **PASS, exit0**, `06-final-format.log`, `11-final-style-format.log` |
| `pnpm typecheck` | **PASS, exit0**, `07-final-typecheck.log` |
| `pnpm test` | **PASS, exit0**, API175 + web529 = **704** unit/component, `08-final-tests.log` |
| Окончательный `pnpm build` | **PASS, exit0**, contracts/Nest/Next, `16-final-build.log` |
| Tailwind generation | **PASS, exit0**,976 literal utilities, missing=[], `12-css-generation.log` |
| Production CSS root + demo | **PASS, exit0**,24 assets в каждом; suppression второй стрелки подтверждён, `18-production-css-final.log` |
| Preservation | **PASS, exit0**,18 protected hashes/HEAD/staging/source inputs, `19-final-preservation.log` |

Добавлены27 cases:20 активная навигация (все destinations, вложенные пути, отсутствие
двойного Dashboard, client route change, prefix boundary/null, роли),5 status session
states/roles,1 публичный health при suspended menu,1 list disclosure/API/calendar boundary.
Полный unit/component запуск проверял окончательные TS/TSX; последующая CSS-правка
проверена повторным focused55, форматированием и окончательной сборкой/compiled CSS.
Component tests не доказывают фактический browser layout/keyboard/screen reader.

История неуспешных проверок сохранена: первый lint (`04-final-lint.log`,exit1) нашёл
unused iconClass после удаления иконки; константа удалена, lint повторён успешно.
Первая проверка CSS (`14-production-css.log`,exit1) показала устаревший root artifact:
его предыдущая сборка начала читать CSS до добавления scoped suppression. Demo artifact
уже содержал правило. Root production build повторён после правки (`16`), итоговый
CSS checker (`18`) проверил оба артефакта успешно. Assertions не ослаблялись, тесты
не отключались. Первые focused54/55 также PASS; они не подменяют финальный focused55.

Integration/proxy/migrations/seed **NOT RUN**: backend/schema не менялись. Browser390/1280
**NOT RUN / BLOCKED** при сохранённом ограничении инструмента; новых попыток/обхода нет.
Вручную проверить выделение всех разделов и вложенных деталей, Service status и Accounts
по ролям, перенос меню на390px и единственную стрелку/keyboard toggle списка Planning.
Отложенные M5–M8/телефон/камера/canvas/общая пользовательская приёмка остаются PENDING.

Source inputs**485**, SHA-256
**`0b6de346127265af5eaacbee1ae827321b187abf9435b0bdf8ed841d9dd31e67`**:
5 modified/5 added/0 removed относительно прошлого run; документы исключены из fingerprint.
Тот же demo accept1-20261027t075310 восстановлен с прежними schema/private storage:
API**57056/3001**, Next**57057/3000**, RUNNING (`17-demo-start-final.log`; foreground
процесс продолжается, exit code отсутствует). При сборках останавливали только проверенные
owned API/Next через demo:stop; обычный dev был и остался остановлен. PostgreSQL5432 и
postgres-test5433 healthy, не перезапускались. Seed/migrate/prepare/cleanup/staging/commit/
push/deploy не выполнялись. .env/manifests/lockfile/Compose/миграции сохранены.

## 2026-10-28 / Login, Service status и Refresh dashboard

Run **`login-status-ui-20261028t073330z`**. Проверены AGENTS/актуальные документы,
Git status/diff/staging и код;480 итоговых inputs сопоставлены с478 inputs My team.
Targeted before-копии и protected hashes сохранены в игнорируемом run. Прежние изменения
не перезаписывались.

- На login Eye/EyeOff переключает type одного input с корректными label/aria-controls/
  aria-pressed и type=button. Значение не сбрасывается, toggle не отправляет форму.
  Submit снова маскирует пароль и блокирует toggle pending; error сохраняет ввод,
  success очищает его как прежде. POST/валидация/redirect/autocomplete прежние, нового
  хранения пароля/токена нет; spellcheck/autocorrect выключены и при видимом пароле.
- Service status получил Back/ArrowLeft: browser history при length>1, иначе /login.
  Health/Retry/публичный доступ не менялись. На dashboard custom refresh SVG заменён
  на Lucide RotateCw, данные/обработчик/pending не менялись. Все3 правки только web UI,
  без backend/auth/CSRF/DataSource/contracts/deps/lockfile/schema. README/DECISIONS обновлены.

### Фактические проверки

Pinned Node24.22.1/pnpm10.34.8. Последовательные redacted logs с командами/start/end/
child exit codes/log SHA: **`.tmp/m8/login-status-ui-20261028t073330z/`**.

| Проверка | Результат |
| --- | --- |
| Login/back/health/dashboard focused | **PASS,exit0,21/21**, `01-focused-controls.log` |
| `pnpm lint` | **PASS,exit0**, `05-final-lint.log` |
| `pnpm format:check` | **PASS,exit0**, `06-final-format.log` |
| `pnpm typecheck` | **PASS,exit0**, `07-final-typecheck.log` |
| `pnpm test` | **PASS,exit0**, API175 + web502 = **677** unit/component tests, `08-final-tests.log` |
| `pnpm build` | **PASS,exit0**, contracts/Nest/Next, `09-final-build.log` |
| CSS generation / root+demo CSS | **PASS,exit0**,971 utilities/missing=[],24 assets/dist, `10-css-generation.log`, `12-production-css.log` |
| Preservation | **PASS,exit0**, `13-final-preservation.log` |
| Final README format / `git diff --check` | **PASS,exit0**, `14-readme-format.log`, `15-final-diff-check.log` |

Новых4 cases: toggle сохраняет тот же DOM/value/autocomplete/не делаетPOST; видимый
пароль маскируется при submit/сохраняется после401; Back history/fallback. Прежние
login/health/dashboard assertions сохранены. FAIL/timeout не было, assertions не ослаблялись.
Полный677/build относится к окончательному коду; последние изменения README проверены
отдельно. Integration/proxy/migrations/seed NOT RUN: backend/schema не менялись.

Browser QA BLOCKED / NOT RUN из-за сохранённого запрета инструмента (точный свежий
Chrome отказ сохранён в предыдущем My team run). Новых попыток/обхода/скриншотов здесь нет.
Вручную проверить Show/Hide мышью/клавиатурой/на телефоне и password manager; Back из
workspace/login и при прямом открытии; dashboard refresh. M5–M8/телефон/камера/canvas/
общая пользовательская приёмка остаются PENDING/NOT VERIFIED.

18 protected hashes (.env/manifests/lockfile/Compose/десять миграций/private credentials)
совпали; HEAD/staging сохранены. Source inputs**480**, SHA-256
**`e21e6cecf5b4de0ca28e578e8bd35c3adfa6f55f1290d782bd616fbbaa3ff06a`**,
4 modified/2 added/0 removed, только apps/web. Source fingerprint исключает документы.
API49616/Next49617 проверены поPID/startUTC/cwd и штатно остановлены (`04-demo-stop.log`,0).
Тот жеaccept1-20261027t075310 восстановлен (`11-demo-start.log`,ready/RUNNING, foreground
exitcode отсутствует): API**53461/3001**, Next**53462/3000**; прежние schema/private storage.
PostgreSQL5432/5433 healthy, не перезапускались; обычный dev остановлен. Данные/.env/
пароли/storage сохранены, seed/migrate/prepare/cleanup/staging/commit/push/deploy не выполнялись.

## 2026-10-28 / Crew My team — состав и контакты

Run **`my-team-ui-20261028t063117z`**. Прочитаны AGENTS/проектные документы и фактические
StaffTeams/API/DTO/guards. Git status/diff/staging проверены;474 inputs предыдущего
Crew run совпали. Targeted before-копии сохранены в игнорируемом run. Чужие изменения,
.env, данные и пароли сохранены; новый бизнес-этап не добавлен.

### Изменения

- Отдельные мобильные карточки участников и специалистов: initials/иконки, имя/username,
  You, Active/Inactive membership и Account disabled независимо. Для специалистов —
  specialty, Enabled/Disabled, реальные phone/email и крупные48px tel/mailto links.
  Неактивные записи/отключённая команда остаются читаемыми по прежним правам API.
  Employee phone/email отсутствуют в DTO и не выдумываются; null/empty не создают ссылки.
- Локальный поиск по разрешённой детали (name/username/specialty/phone/email) и clear,
  счётчики полных и найденных списков. Это не online/availability и не новые запросы
  на ввод. Team code/имена/контакты переносятся, поле поиска16px на телефоне.
- Только прежние GET/crews и GET/crews/:id; outer CREW_MEMBER guard до ресурсов и
  прежние SSR/Nest права. Нет edit/create/member mutation, /users или новых endpoints.
  Пустой список команд/членов/контактов и отсутствие результатов поиска различаются.
- Refresh my team обновляет parent+детали без двойного initial GET. Existing realtime
  crews/crew-team topics сохранены; focus fallback только без coordinator. RetainData
  сохраняет DOM/поиск при503; parent401/403/404 убирает children, detail401/403/404 убирает
  приватные сведения без summary/lastGood fallback. Старый detail GET после смены
  crewId абортируется; поздний ответ не возвращает прежних людей.
- Tailwindtw/noPreflight, прежние shadcn Input/Button/Badge и Lucide; новые локальные
  staff-team-cards/staff-teams.css. Backend/auth/CSRF/DataSource/contracts/deps/lockfile/
  migrations не менялись. README/DECISIONS обновлены, реальные состав/контакты не менялись.

### Проверки

Pinned **Node24.22.1/pnpm10.34.8**. Последовательные redacted stdout/stderr, команды,
start/end/child exit codes и log SHA: **`.tmp/m8/my-team-ui-20261028t063117z/`**.

| Проверка | Результат |
| --- | --- |
| Focused roster/cards/lifecycle/layout | **PASS,exit0,28/28**, `02-focused-final.log` |
| `pnpm lint` | **PASS,exit0**, `05-final-lint.log` |
| `pnpm format:check` | **PASS,exit0**, `06-final-format.log` |
| `pnpm typecheck` | **PASS,exit0**, contracts/API/web, `07-final-typecheck.log` |
| `pnpm test` | **PASS,exit0**, API175 + web498 = **673** unit/component tests, `08-final-tests.log` |
| `pnpm build` | **PASS,exit0**, contracts/Nest/Next production, `09-final-build.log` |
| PostCSS generation | **PASS,exit0**,970 utilities/missing=[], `10-css-generation.log` |
| Root/demo compiled CSS | **PASS,exit0**,24 assets/каждый dist, staff scopes присутствуют, `12-production-css.log` |
| Preservation | **PASS,exit0**, `13-final-preservation.log` |
| README format / `git diff --check` | **PASS,exit0**, `14-readme-format.log`, `15-final-diff-check.log` |

Добавлены15 cases: cards6 (You, independent statuses, tel/mailto/null, disabled history/
readonly whitelist), directory9 (ADMIN/DISPATCHER zeroGET, local search/noextraGET,
parent403, detail401/403/404,503 sameDOM/search, membership change/aborted late GET).
Прежние3 StaffTeams и10 layout cases сохранены. Первый focused также28PASS
(`01-focused-my-team.log`); последующий усилил abort/late-response assertions. Полный673
и build относятся к окончательному коду, включая последние косметические классы.
Не было FAIL/timeout, assertions/тесты не отключались.

Integration/proxy/migrations/seed **NOT RUN**: frontend-only изменения. Исторические
результаты не выданы за новые. По дополнительному запросу пользователя выполнена ровно
одна штатная попытка открыть Chrome через cua.createBrowserTab("chrome",.../crew/team).
**CHROME OPEN: BLOCKED**: `A saved user permission setting blocks this action`;
origin gate не разрешилhttp://127.0.0.1:3000. Точный новый отказ сохранён в
`chrome-open-denied.txt`. Это отказ разрешений инструмента, не сообщение о недоступном
сервере. Обход другим browser/origin/tool/OS command не выполнялся. Страница/видимые
элементы/скриншот не получены; **BROWSER QA390/1280: NOT RUN**.

Ручная проверка: CREW_MEMBER открывает /crew/team на390/1280; длинные имена/контакты,
You/неактивные статусы, live search/clear, refresh/empty/error, смена команды и фактические
phone/mail handlers. Телефон/камера/canvas и общая приёмка M5–M8 остаются PENDING/NOT VERIFIED.
Автоматического ACCEPTED нет.

18 protected hashes (.env/manifests/lockfile/Compose/десять миграций/private credentials)
совпали, HEAD/staging сохранены. Source inputs**478**, SHA-256
**`137d471aa6b5649e01274ce1a1f008d3cee1282b98f55d4f5835087486899021`**:
2 modified/4 added/0 removed, только apps/web, `source-inputs-final.json`. Изменения только
документов не требуют нового code gate. API27888/Next27889 идентифицированы поPID/startUTC/
cwd, штатно остановлены (`04-demo-stop.log`,exit0). Тот жеaccept1-20261027t075310 восстановлен
(`11-demo-start.log`,ready/RUNNING, foregroundexitcode отсутствует): API**49616/3001**,
Next**49617/3000**, прежние schema/private storage. Обычный dev остановлен; PostgreSQL5432/
5433 healthy, не перезапускались. Новыеfixtures/seed/migrate/prepare/cleanup и staging/
commit/push/deploy не выполнялись. После отчёта работа остановлена.

## 2026-10-27 / Crew — мобильный список и детали визита

По запросу пользователя обновлён только Crew UI. Run **`crew-ui-20261027t202149z`**.
Прочитаны AGENTS/проектные документы и фактические Crew API/DTO/guards/hooks/forms/
acceptance/evidence. Git status/diff/staging проверены;465 inputs предыдущего Templates
run совпали. Targeted before-копии исходников/tests/layouts/manifests/lockfile/docs
сохранены в игнорируемом run. Прежние изменения/данные сохранены.

### Реализовано

- Новый Crew shell с прежней SSR session/role защитой, displayName/Sign out, активной
  My work/My team навигацией и Service status. Навигация sticky, контейнеры переносят
  длинные тексты; нет административных ссылок/новых ролей/изменений logout.
- Карточки заданий с Lucide-иконками, реальными order/customer/city/crew/service,
  плановым окном Rome, исполнением и подтверждением клиента. Today/Upcoming/Open/
  Completed, page/pageSize10/25/50, businessDate и total берутся из прежнего API.
  Счётчик относится к выбранному view, не выдуманной общей загрузке. Empty/loading/
  error/Retry/503 retention/access clearing сохранены. Нет N+1 detail reads.
- Детали разделены на выполнение, контакт/доступ, товары/общие количества, checklist,
  сохранённый отчёт/returns, acceptance и evidence. Якоря не размонтируют main.
  Planned window, actual progress и estimate отделены. Delivery/assembly и immutable
  finish snapshot отделены от live accumulated totals. Контакты tel/mailto прежние.
- Одна Sheet для task/item/finish с исходными structuredClone snapshots/keys и всеми
  прежними readOnly flags. optional onBusyChange сообщает command.locked; pending/
  unknown блокируют close/Escape/outside/Discard, повтор использует original request.
  После terminal новый результат запрещён, draft остаётся для чтения и receipt retry.
  Ошибка/Retry видны внутри Sheet.503 сохраняет тот же editor,401/403/404 убирают private
  DOM; другая assignmentId создаёт новый scope, late old responses не попадают в него.
  Focus возвращается trigger или безопасному fallback.
- Формы получили shadcn native controls, понятные группы/иконки, крупные кнопки и
  мобильные поля16px. Все4 useCommandAttempt blocks сравнены с before после удаления
  whitespace — совпали. Версии/keys/absolute totals/correction reasons/partial outcome/
  remainingWork/return flag/allowedActions не менялись; разрешения вычисляет backend.
- Acceptance/Evidence/Canvas остаются mounted при Sheet/refresh/якорях. Их исходники,
  signature dimensions/touch-action, opaque customer backdrop/white dialog, image-only
  crew capture и protected file reads не менялись. Все чтения остаются Crew DTO, без
  root Order API/financial/internal fields. Реальные фото/подписи/визиты не создавались.
- В статическом review нового sticky shell обнаружено недостаточное offset20px при
  nav≈66px. Для card/result/material anchors задан scoped offset90px. Это исправление
  CSS по исходникам; фактическая браузерная прокрутка ещё не проверена. Backend/auth/
  CSRF/DataSource/contracts/schema/deps/lockfile сохранены. README/DECISIONS обновлены.

### Фактические проверки

Pinned **Node24.22.1 / pnpm10.34.8**. Последовательные запуски, redacted stdout/stderr,
start/end/child exit codes и log SHA — **`.tmp/m8/crew-ui-20261027t202149z/`**.

| Проверка | Результат |
| --- | --- |
| Focused Crew/actions/visit/layout + evidence/acceptance/canvas/guards | **PASS,exit0,101/101**, `02-focused-final.log` |
| `pnpm lint` | **PASS,exit0**, `05-final-lint.log` |
| `pnpm format:check` | **PASS,exit0**, `06-final-format.log` |
| `pnpm typecheck` | **PASS,exit0**, contracts/API/web, `07-final-typecheck.log` |
| `pnpm test` | **PASS,exit0**, API175 + web483 = **658** unit/component tests, `08-final-tests.log` |
| `pnpm build` | **PASS,exit0**, contracts/Nest/Next production, `09-final-build.log` |
| PostCSS generation | **PASS,exit0**,945 literal utilities/missing=[], `10-css-generation.log` |
| Root/demo production CSS | **PASS,exit0**,23 assets/каждый dist, Crew scopes/offset присутствуют, `12-production-css.log` |
| Preservation | **PASS,exit0**, `13-final-preservation.log` |
| README format / `git diff --check` | **PASS,exit0**, `14-readme-format.log`, `15-final-diff-check.log` |

Добавлены22 cases: actions8 (allowed steps/versions/native controls/quantity bounds/
lockedcallback pending+unknown/unmount/readOnly retry), visit8 (plan/actual/shared totals/
contact links, main mocked-canvas/evidence DOM retention,503 pinned version, unknown
same-key Sheet,403 clearing,otherID/lateGET,flags/privacy,focus), list2 (view total/DTO
only/N+1 absence,503/404), layouts4 (anonymous/ADMIN/DISPATCHER boundary и active nav).
Прежние Crew execution/work-view/return/evidence/acceptance/signature/guard cases сохранены.
Два чтения Saved finish report за открытой Sheet уточнены hidden:true: это проверка
сохранённого background DOM, не взаимодействие с недоступным фоном. Assertions/timeout
не ослаблялись, тесты не отключались. Mocked canvas retention не доказывает рисование.

Первый `01-focused-crew.log` **FAIL,exit1,47PASS/1FAIL из48**: новый list test ожидал
Needs client confirmation, но использовал исходную CONFIRMED fixture. В test setup
явно установлен NEEDS_CONFIRMATION; ожидаемый статус сохранён. Ошибки приложения в
этом case не подтверждены. Затем expanded101PASS и full658PASS на окончательном коде.

Integration/proxy/migrations/seed **NOT RUN**, backend/contracts/schema не менялись;
исторические integration результаты не являются новым запуском. Browser390/1280
**BLOCKED / NOT RUN** при сохранённом ограничении инструмента; новых попыток/обхода/
скриншотов нет. Полный пользовательский путь/scroll/touch/camera/canvas не объявлены PASS.

### Ручная проверка, процессы и сохранность

Войти CREW_MEMBER: на390/1280 проверить header/nav/cards/long names/пагинацию, переходы
всех work views, anchors под sticky nav, контактные ссылки, task/item/finish Sheet/
focus/Escape/unknown Retry. Проверить depart→arrive→start, quantities/checklist/partial
report/reload, смену permissions/terminal при dirty form, защищённые фото/PDF и актуальный
return context. Проверить сохранение реальных signature strokes/имени/consent при refresh
и редакторе, customer dialog/backdrop, реальную камеру/выбор файлов/мобильную клавиатуру.
Проверки требуют пользователя; M5–M8/физический телефон/камера/canvas/общая приёмка
остаются PENDING/NOT VERIFIED, автоматического ACCEPTED нет.

18 protected hashes (.env/manifests/lockfile/Compose/десять миграций/private credentials)
совпали; HEAD/staging сохранены. Source inputs**474**, SHA-256
**`045a65b7ae816fa1f7810c6046a69d99f4f07690eb7d5b4cc22d97b8af9cb7a4`**,
`source-inputs-final.json`:6 modified/9 added/0 removed, только apps/web. Изменения только
README/DECISIONS/PROGRESS не требуют повторного code gate.

Собственные demo API24346/Next24347 идентифицированы поPID/startUTC/cwd и штатно остановлены
(`04-demo-stop.log`,exit0). Тот же **accept1-20261027t075310** восстановлен через
`pnpm demo:start --run accept1-20261027t075310`: ready/RUNNING, `11-demo-start.log`,
foreground работает, конечного exit code нет. API**27888/3001**, Next**27889/3000**,
прежние schema/private storage. Обычный dev остановлен, PostgreSQL5432/5433 healthy и
не перезапускались. Новые fixtures не создавались; seed/migrate/prepare/cleanup, staging/
commit/push/deploy не выполнялись. Данные/.env/пароли/storage сохранены. После отчёта стоп.

## 2026-10-27 / Task templates — библиотека, создание и редактирование

По запросу пользователя обновлён существующий Task templates, без нового этапа.
Run **`templates-ui-20261027t195704z`**. Прочитаны AGENTS/проектные документы и реальные
Template API/DTO/guards/hooks/forms/tests. Git status/diff/staging проверены;458 inputs
предыдущего Return requests run совпали. Targeted before-копии исходников/tests/route/
manifests/lockfile/docs сохранены в игнорируемом run. Прежние изменения сохранены.

### Реализовано и исправлено

- Полный защищённый каталог в таблице/карточках до1000px: имя/code/описание, применимость,
  severity/priority, active/required и Edit. Lucide-иконки содержат текстовые labels;
  цвет не заменяет статус. Summary — реальные full-catalog total/enabled/required&enabled,
  Showing — локальный срез. Нет usage counts или иных выдуманных метрик.
- Поиск name/code/description и Popover filters status/required/applicability/severity
  локальны к полному GET/task-templates. Отдельные drafts/Search/Apply, Escape/Close
  discard, reset/chips/Clear. Exact applicability ALL («All-service templates») отличается
  от отсутствия фильтра. Порядок priority ASC/code ASC прежний, нет N+1/REST на ввод.
- Одна Sheet вместо множества форм: три группы с shadcn native controls и иконками.
  Прежние FormData names/trim/POST/PATCH/defaults/limits/code uniqueness сохранены; code
  readonly при edit и отсутствует в PATCH. Fixed base/key=create-or-ID удерживает draft
  при refetch, другой шаблон начинает чистый editor. DraftChangeNotice сохранён.
  Busyref/Sheet Close/Escape/outside/Cancel не допускают повторного save/закрытия pending.
  Late response unmounted формы игнорируется. Create закрывает/reset, edit сохраняет
  контекст, даже если сохранённая запись исчезла из локального фильтра. Focus fallback
  проверен. API не получил выдуманные version/idempotency keys.
- Обнаружен прежний конкретный дефект private cache: собственный lastGood показывал
  каталог и форму после401/403/404. До исправления новые regression cases дали3FAIL/1PASS
  (503). Удалён fallback, использован existing useApiResource retainDataOnRefresh:true:
  transient503 сохраняет mounted draft, access loss очищает list/drawer/form. Shared
  auth/hooks не менялись. После узкого исправления4/4PASS, затем финальные27/636PASS.
- Outer ADMIN/DISPATCHER guard до resource и прежние Nest/SSR права сохранены. Изменение
  template влияет на будущие подходящие назначения и не переписывает старые snapshots/
  историю. Return planning сохраняет отдельный explicit scope. Backend/contracts/schema/
  зависимости/lockfile/CSRF/DataSource не менялись. README/DECISIONS обновлены.
  Реальные шаблоны/заказы/назначения/аккаунты/пароли агентом не изменялись.

### Фактические проверки

Pinned **Node24.22.1 / pnpm10.34.8**. Последовательные команды, redacted stdout/stderr,
start/end/child exit codes и log SHA — **`.tmp/m8/templates-ui-20261027t195704z/`**.

| Проверка | Результат |
| --- | --- |
| Cache regression до исправления | **RED,exit1,3FAIL/1PASS из4**, `01-access-regression-before.log` |
| Cache regression после узкого исправления | **GREEN,exit0,4/4**, `02-access-regression-after.log` |
| Focused access/form/filters/directory/existing management | **PASS,exit0,27/27**, `04-focused-final.log` |
| `pnpm lint` | **PASS,exit0**, `06-final-lint.log` |
| `pnpm format:check` | **PASS,exit0**, `07-final-format.log` |
| `pnpm typecheck` | **PASS,exit0**, contracts/API/web, `08-final-typecheck.log` |
| `pnpm test` | **PASS,exit0**, API175 + web461 = **636** unit/component tests, `09-final-tests.log` |
| `pnpm build` | **PASS,exit0**, contracts/Nest/Next production, `10-final-build.log` |
| PostCSS generation | **PASS,exit0**,912 literal utilities/missing=[], `11-css-generation.log` |
| Root/demo production CSS | **PASS,exit0**,21 assets/каждый dist, templates scopes присутствуют, `13-production-css.log` |
| Preservation | **PASS,exit0**, `14-final-preservation.log` |
| README format / `git diff --check` | **PASS,exit0**, `15-readme-format.log`, `16-final-diff-check.log` |

Добавлены23 cases: access4 (401/403/404 clearing и503 retention), form8 (POST/PATCH/code/
limits/reset/error/busy/lateunmount/frozen draft), filters6 (independent Search/Apply/
discard/focus/reset/chips/drafts), directory5 (crew zero-GET, counts/local criteria,
selecteddraft/otherID, Sheet pending/Escape, saved-filtered record/fallbackfocus).
Прежние4 management cases сохранены: API payload assertions прежние, creation reset
проверяется повторным открытием чистой формы после нового Sheet workflow. Direct form
case также проверяет reset. Assertions/timeouts не ослаблялись, тесты не отключались.

Первый UI-focused `03-focused-workspace.log` **FAIL,exit1,24PASS/3FAIL из27**: два новых
query ожидали Cancel вместо существующего edit Close; прежний creation case пытался
найти label внутри уже размонтированной формы после успешного закрытия Sheet. Queries
уточнены к edit Close и повторному открытию create, исходные проверки сохранённых данных
и пустого нового ввода сохранены. Это отдельные test-workflow failures, не cache RED.
Финальные27/636/build относятся к окончательным исходникам.

Integration/proxy/migrations/seed **NOT RUN**, backend/contracts/schema неизменны;
исторические integration результаты не являются новым запуском. Browser390/1280
**BLOCKED / NOT RUN** при сохранённом ограничении инструмента; новых попыток/обхода/
скриншотов нет. Component tests/CSS generation не доказывают геометрию/scroll/touch.

### Ручная проверка, процессы и сохранность

На1280/390 проверить таблицу/карточки/длинные code/description, keyboard/focus, Search/
advanced Apply/chips, applicability ALL vs exact service, создание/редактирование/
logical disable. Проверить dirty form при realtime/refetch, потерю доступа, error/retry,
pending close guard и неизменность ранее назначенных tasks после template edit. Эти
UI-проверки требуют подтверждения пользователя; M5–M8/физический телефон/камера/canvas/
общая пользовательская приёмка остаются PENDING/NOT VERIFIED.

18 protected hashes (.env/manifests/lockfile/Compose/десять миграций/private credentials)
совпали; HEAD/staging сохранены. Source inputs**465**, SHA-256
**`716f911202bf870347869081196ab48f6093969ec8e0baf4d4414c17412ac985`**,
`source-inputs-final.json`:2 modified/7 added/0 removed, только apps/web. Изменения только
документов не требуют повторного code gate; fingerprint проверенного кода неизменен.

Собственные demo API21139/Next21140 проверены поPID/startUTC/cwd и штатно остановлены
(`05-demo-stop.log`,exit0). Тот же **accept1-20261027t075310** восстановлен через
`pnpm demo:start --run accept1-20261027t075310`: ready/RUNNING, `12-demo-start.log`,
foreground работает, конечного exit code нет. API**24346/3001**, Next**24347/3000**,
прежние schema/private storage. Обычный dev остановлен, PostgreSQL5432/5433 healthy и
не перезапускались. Новые fixtures не создавались; seed/migrate/prepare/cleanup, staging/
commit/push/deploy не выполнялись. Данные/.env/пароли/storage сохранены. После отчёта стоп.

## 2026-10-27 / Return requests — список, фильтры и повторный приезд

По запросу пользователя обновлён только существующий Return requests. Run
**`returns-ui-20261027t194128z`**. Прочитаны AGENTS/проектные документы и реальные
return/planning operations, guards, hooks, формы и tests. Проверены Git status/diff/
staging;449 inputs прежнего Issues run совпали. Targeted before-копии исходников,
tests/manifests/lockfile/docs сохранены в игнорируемом run. Прежние изменения сохранены.

### Реализовано

- Современная таблица с заказом/клиентом, remainingWork/reason, статусом, серверной
  готовностью к review, датой/revision и ссылками на детали, заказ и текущий/покрывающий
  визит. Карточки до1100px, длинные тексты переносятся; Lucide-иконки состояний и действий.
  Matching requests — total API; Awaiting planning/Ready for review on this page —
  только загруженные строки. Нет локального resolver или N+1 запросов деталей.
- Компактные Popover/Select filters status/pageSize с отдельными drafts, Apply,
  Escape/Close discard, reset/chips/Clear с сохранением pageSize. Прежние серверные
  status/page/pageSize, defaultOPEN и oldest-first сохранены. Изменение фильтра даётpage1.
  Loading/empty/error/Retry, сохранение списка при503 и очистка при403 проверены.
- Полная рабочая страница детали с якорями Overview / Plan & review / Quantities /
  Attempt history / Source report. Секции не размонтируют forms. Причина/remainingWork,
  live accumulated quantities, immutable source FinishReport, принятый scope и результаты
  каждой попытки показаны отдельно. ReadyToResolve и blockedReasons берутся с backend.
- Форма планирования получила6 групп с иконками, team cards и прежними shadcn/native
  контролами: команды/длительность, carried tasks, explicit new work, absolute item
  targets, поиск окна, reason/preview. Поиск не бронирует, сохранение — прежняя транзакция
  API. Required scope, failed targets, baseline/reviewLatest/version/confirmed/payload
  и frozen Retry не менялись. Блок состояния/проверок/submit побайтово совпал с before.
  Общий SlotFinder не переписан; новые стили ограничены return-plan-workspace.
- Create/Resolve handlers прежние; Resolve получил только scoped оформление. OPEN и
  PLANNED остаются незакрытой потребностью. Явный resolve не меняет исходный отчёт,
  количества/issues и не завершает Order. Нового автоматического закрытия/coverage нет.
- Outer ADMIN/DISPATCHER guards очереди и детали до запросов; прежние SSR/Nest права
  сохранены. Новый requestId key очищает предыдущую форму.503 сохраняет draft/revision,
  access loss очищает private DOM, поздний GET не возвращает старую запись. Backend,
  auth/CSRF, единственный DataSource, contracts, schema и зависимости не менялись.
  README/DECISIONS обновлены; реальные запросы/аккаунты/пароли/файлы агентом не изменялись.

### Фактические проверки

Pinned **Node24.22.1 / pnpm10.34.8**. Последовательные запуски, redacted stdout/stderr,
start/end/child exit codes и log SHA — **`.tmp/m8/returns-ui-20261027t194128z/`**.

| Проверка | Результат |
| --- | --- |
| Focused queue/filter/detail/plan + return/rescheduling regressions | **PASS,exit0,49/49**, `02-focused-return-workspace.log` |
| `pnpm lint` | **PASS,exit0**, `05-final-lint.log` |
| `pnpm format:check` | **PASS,exit0**, `06-final-format.log` |
| `pnpm typecheck` | **PASS,exit0**, contracts/API/web, `07-final-typecheck.log` |
| `pnpm test` | **PASS,exit0**, API175 + web438 = **613** unit/component tests, `08-final-tests.log` |
| `pnpm build` | **PASS,exit0**, contracts/Nest/Next production, `09-final-build.log` |
| PostCSS generation | **PASS,exit0**,896 literal utilities/missing=[], `10-css-generation.log` |
| Root/demo production CSS | **PASS,exit0**,20 assets/каждый dist, return scopes присутствуют, `12-production-css.log` |
| Preservation | **PASS,exit0**, `13-final-preservation.log` |
| README format / `git diff --check` | **PASS,exit0**, `14-readme-format.log`, `15-final-diff-check.log` |

Добавлены22 cases: queue6 (server counts/readiness, resolved vs planned, crew zero-GET,
503/403, explicit Apply/page reset, focus GET), filters6 (Apply/discard/focus/reset/chips/
refresh), detail7 (guard/loading/Retry/readiness/503 mounted draft/403 clear/otherrequest+
late GET/reviewversion), plan3 (groups/controls/limits, empty/newtask actions without
submit, preserved draft/baseline on refresh). Прежние27 return/rescheduling cases сохранены;
queue case адаптирован к реальному Radix Select через keyboard helper с прежними API
assertions. Остальные plan/retry/resolve assertions и timeouts не ослаблялись.

Первый `01-focused-queue.log` **FAIL,exit1,11PASS/1FAIL из12**: новый test искал текст
Resolved сразу во всём DOM, совпадали applied filter chip и status badge. Query уточнён
до Return request directory; проверка нужного статуса сохранена. Ошибки приложения в
этом запуске не подтверждены. Финальные49/613/build относятся к окончательным исходникам.

Integration/proxy/migrations/seed **NOT RUN**, backend/contracts/схема неизменны;
старые integration результаты не являются новым запуском. Browser390/1280 **BLOCKED /
NOT RUN** при сохранённом ограничении инструмента; новых попыток/обхода/скриншотов нет.
Component tests и CSS assets не доказывают реальную геометрию/scroll/touch.

### Ручная проверка, процессы и сохранность

На1280/390 проверить таблицу/карточки/длинные тексты, filters keyboard/Escape/focus,
пагинацию и page-only counts, ссылки current/covering visit. В деталях проверить якоря
без потери ввода, current vs frozen quantities, attempt scope/history, plan preview/
client confirmation,409 review/unknown Retry, explicit resolve и отсутствие автоматического
закрытия от одного планирования или issue resolve. Эти UI-проверки требуют пользователя;
M5–M8/физический телефон/камера/canvas/общая приёмка остаются PENDING/NOT VERIFIED.

18 protected hashes (.env/manifests/lockfile/Compose/десять миграций/private credentials)
совпали. HEAD/staging сохранены. Source inputs**458**, SHA-256
**`4d15d474be41e8e167cf9ad6c000576ebe06acaa9ebbf2366d6df4704c00d9bf`**,
`source-inputs-final.json`:4 modified/9 added/0 removed, только apps/web. Изменения только
README/DECISIONS/PROGRESS не меняют fingerprint проверенного кода/конфигураций.

Собственные demo API18198/Next18199 идентифицированы поPID/startUTC/cwd и штатно остановлены
(`04-demo-stop.log`,exit0). Тот же **accept1-20261027t075310** восстановлен через
`pnpm demo:start --run accept1-20261027t075310`: ready/RUNNING, `11-demo-start.log`,
foreground работает, конечного exit code нет. API**21139/3001**, Next**21140/3000**,
прежние schema/private storage; обычный dev остановлен. PostgreSQL5432/5433 healthy,
не перезапускались. Новые fixtures не создавались. Seed/migrate/prepare/cleanup, staging/
commit/push/deploy не выполнялись, данные/пароли/storage/.env сохранены. После отчёта стоп.

## 2026-10-27 / Issues — реестр, фильтры и детали

По запросу пользователя обновлён существующий Issues. Run **`issues-ui-20261027t192423z`**.
Прочитаны AGENTS/проектные документы и существующие issue/evidence hooks, операции,
контракты/guards/tests. Git status/diff/staging проверены; before-копии изменяемых
исходников/tests/manifests/lockfile/docs сохранены в игнорируемом run. Чужие изменения
не восстанавливались/не перезаписывались. Новый бизнес-этап не добавлялся.

### Реализовано

- Семантическая таблица проблем, мобильные карточки до1000px, различимые Lucide-иконки
  семи типов, статус/доступ, источник/дата, связанные материалы, ссылки на точный issue.
  Matching issues использует total API; Open/Resolved on this page — только строки
  текущей страницы. Нет вымышленных глобальных метрик или N+1 запросов деталей.
- Компактный shadcn Popover с Select status/type/pageSize. Отдельные drafts, Apply,
  Escape/Close discard, reset/chips/Clear с сохранением pageSize. При применении page1;
  прежние серверные фильтры/пагинация, loading/empty/error/Retry и явный Refresh.
- Одна Sheet по нажатию Details/описания: канонические order/evidence, заказ/клиент,
  связанные товары и визит, защищённые файлы, решение/история. Сохранённый RESOLVED
  issue остаётся в панели после исчезновения строки из OPEN-списка. Отсутствие записи
  не подменяется старой projection. Деталь доступна только при обоих разрешённых ресурсах.
- Прежний IssueCard используется в Sheet и Order/crew без дублирования мутаций. Обновлены
  только оформление/иконки и optional content mode для самостоятельных деталей.
  Default anchors к галерее прежние; в панели только действующие защищённые contentUrl,
  withdrawn/historical без ссылки. Shared CommandForm/upload/FileCard logic не менялась.
- Сохранены revision409/review, frozen operationKey/Retry, reopen acknowledgement и
  crew restrictions.503 сохраняет mounted draft/исходную revision;401/403/404 убирают
  private DOM. При смене issue/order чистый editor, поздний GET не возвращает старую запись.
  Pending/unknown блокирует Close/Escape/outside и внутренние переходы; focus возвращается
  trigger/fallback. Outer role guard не делает защищённые запросы для crew.
- Разрешение issue не меняет количества/FinishReport/ReturnRequest и не закрывает Order.
  SSR/Nest права, auth/CSRF, DataSource, backend/contracts/схема/зависимости сохранены.
  README/DECISIONS обновлены. Реальные issues/аккаунты/файлы агентом не изменялись.

### Фактические проверки

Pinned **Node24.22.1 / pnpm10.34.8**. Последовательные команды с redacted stdout/stderr,
start/end/child exit codes и log SHA: **`.tmp/m8/issues-ui-20261027t192423z/`**.

| Проверка | Результат |
| --- | --- |
| Focused directory/filter/card/evidence/detail | **PASS,exit0,38/38**, `03-focused-final.log` |
| `pnpm lint` | **PASS,exit0**, `05-final-lint.log` |
| `pnpm format:check` | **PASS,exit0**, `06-final-format.log` |
| `pnpm typecheck` | **PASS,exit0**, contracts/API/web, `07-final-typecheck.log` |
| `pnpm test` | **PASS,exit0**, API175 + web416 = **591** unit/component tests, `08-final-tests.log` |
| `pnpm build` | **PASS,exit0**, contracts/Nest/Next production, `09-final-build.log` |
| PostCSS generation | **PASS,exit0**,850 literal utilities/missing=[], `10-css-generation.log` |
| Root/demo production CSS | **PASS,exit0**,18 assets/каждый dist, Issues scopes присутствуют, `12-production-css.log` |
| Preservation | **PASS,exit0**, `13-final-preservation.log` |
| README format / `git diff --check` | **PASS,exit0**, `14-readme-format.log`, `15-final-diff-check.log` |

Добавлены24 cases: list+6 (server Apply/page reset, page-only counts, crew zero-GET,
on-demand details/focus,403 list+drawer clearing,503 retention, canonical resolve),
filters6 (Apply/discard/focus/reset/chips/refresh/drafts), card4 (presentation/protected
links/draftversion/crew), detail8 (canonical fetch,503/version, pending+unknown retry,
403 каждого ресурса,missing issue,otherissue reset,late old-order GET). Сохранены прежние
12 evidence cases. Не отключались assertions/timeout и не менялись общие auth/storage/hooks.

Первичный сохранённый focused `01-focused-directory.log` PASS30/30. Запуск
`02-focused-details.log` **FAIL,exit1,30PASS/8FAIL из38**: новый beforeEach возвращал
mock-функцию, которую Vitest использовал как cleanup и вызывал без path; все8 cases
заканчивались TypeError в test harness. Исправлен void-body beforeEach, assertions
сохранены. Также уточнён void-body act helper. Финальные38/591/build относятся к
окончательным исходникам. Agent detail focused16PASS сохранён отдельно в81-agent log;
он не заменяет финальный полный запуск. Ошибки тестовой обвязки не объявлены багом API.

Integration/proxy/migrations/seed **NOT RUN**: backend/contracts/схема не менялись;
исторические результаты не выданы за новый запуск. Browser QA390/1280 **BLOCKED / NOT RUN**
при сохранённом ограничении инструмента: новых попыток/обхода/скриншотов нет. Component
assertions/CSS generation не подтверждают реальную геометрию/scroll/touch/камеру.

### Ручная проверка, процессы и сохранность

На1280/390 проверить таблицу/карточки/перенос длинных текстов, Popover/Select клавиатурой,
Apply/chips/page navigation и focus после закрытия. Проверить детали с материалами,
withdrawn file, note/resolve/reopen с acknowledgement,409 review, unknown Retry, realtime
при dirty draft и доступ другого пользователя. Не считать разрешение issue завершением
работы/повторного приезда. Эти UI-проверки требуют подтверждения пользователя; отложенные
M5–M8/физический телефон/камера/canvas/общая пользовательская приёмка остаются PENDING/NOT VERIFIED.

18 protected hashes (.env/manifests/lockfile/Compose/десять миграций/private credentials)
совпали; HEAD/staging сохранены. Source inputs**449**, SHA-256
**`9d145dffd34bb296cf0eff70e3755c1ca9fff40139373a369d686c1ea05cfeb1`**,
`source-inputs-final.json`:3 modified/8 added/0 removed, только apps/web. Документы
из fingerprint исключены; изменения только отчётов не требуют повторного code gate.

Собственные demo API14894/Next14895 идентифицированы поPID/startUTC/cwd и штатно
остановлены (`04-demo-stop.log`,exit0). Тот же run **accept1-20261027t075310** восстановлен
через `pnpm demo:start --run accept1-20261027t075310`: ready/RUNNING,
`11-demo-start.log`, foreground ещё работает, конечного exit code нет. API**18198/3001**,
Next**18199/3000**, прежние schema/private storage. PostgreSQL5432/5433 healthy, не
перезапускались. Обычный dev остановлен, новые тестовые fixtures не создавались. Seed/
migrate/prepare/cleanup, staging/commit/push/deploy не выполнялись. Backend/storage/data/
.env/пароли сохранены. После отчёта разработка остановлена.

## 2026-10-27 / Accounts — список и создание/редактирование

По запросу пользователя обновлён существующий Accounts. Run
**`accounts-ui-20261027t185723z`**. Прочитаны AGENTS/проектные документы, проверены Git
status/diff/staging, фактические Users/API/auth/hooks и прежние tests.436 source inputs
предыдущего banner run совпали. Before-копии AccountsPanel/tests/realtime/route/shared
Sheet/manifests/lockfile/docs сохранены в игнорируемом run; прежние изменения сохранены.

### Реализовано

- Полный защищённый User directory: имя/username, роль, Enabled/Disabled, активные
  членства и ссылки разрешённых команд, You для текущего аккаунта. Семантическая таблица
  превращается в карточки до900px. Реальные summary counts из полного GET/users; Showing
  отражает локальный срез. Membership count не выдаётся за активность сессии/свободный слот,
  unassigned включает disabled accounts. Имена команд/last login/online metrics не выдуманы.
- Search(name/username) и Popover role/status/membership с отдельными drafts, Apply,
  Escape/Close discard, chips/Reset/Clear. Поиск и фильтры локальны к полному ответу;
  нет новых REST на ввод или N+1 frontend requests. Membership filter только для
  CREW_MEMBER; сохранённые членства отключённых аккаунтов показываются явно.
- Одна Sheet-форма вместо множества форм в строках. AccountForm — прежние native
  поля/POST/PATCH/валидация с Tailwind/shadcn, отдельными identity/access/password blocks.
  Username3–64 lowercase pattern при создании и read-only при редактировании; displayName
  до120; пароль12–128, edit blank password отсутствует в PATCH. После успеха password
  очищается, создание reset; ошибки сохраняют ввод. Busyref блокирует double submit,
  modal close/Escape/Cancel не прерывают pending. Focus возвращается trigger/fallback.
- Edit держит исходный выбранный аккаунт/draft независимо от обновления списка;
  сменаID/закрытие очищает форму, поздний ответ unmounted формы не открывает новый editor.
  Прежний DraftChangeNotice сохраняется. Ответ target account не меняет текущий
  SessionProvider user. Access loss убирает список/drawer/password вместе с ресурсом.
- Creation success закрывает форму, edit success сохраняет контекст и перечитывает список.
  Для активного Team member есть переход к назначению в Teams. Членство автоматически
  не создаётся; copy поясняет отдельный workflow, session revocation и собственный аккаунт.
- SSR redirect/outer ADMIN guard до users resource/UsersController ADMIN не менялись.
  Роли/отключение/пароль отзывают сессии прежним backend; display name — нет. Не введены
  новые запреты на себя/последнего администратора. Реальные accounts/passwords не менялись.
  Backend/contracts/auth/CSRF/DataSource/схема/dependencies/lockfile сохранены.
- Новые account-form/account-filters/accounts.css только для web UI, прежние pinned
  Tailwindtw/noPreflight/shadcn primitives/Lucide. README/DECISIONS обновлены; нет нового этапа.

### Фактические проверки

Pinned **Node24.22.1 / pnpm10.34.8**. Последовательные финальные проверки, redacted
stdout/stderr, команды/start/end/child exit codes и log SHA — **`.tmp/m8/accounts-ui-20261027t185723z/`**.

| Проверка | Результат |
| --- | --- |
| Focused form/filter/panel/realtime | **PASS,exit0,27/27**, `04-focused-tests.log` |
| `pnpm lint` | **PASS,exit0**, `10-final-lint.log` |
| `pnpm format:check` | **PASS,exit0**, `11-final-format.log` |
| `pnpm typecheck` | **PASS,exit0**, contracts/API/web, `12-final-typecheck.log` |
| `pnpm test` | **PASS,exit0**, API175 + web392 = **567** unit/component tests, `13-final-tests.log` |
| `pnpm build` | **PASS,exit0**, contracts/Nest/Next production, `14-final-build.log` |
| PostCSS generation | **PASS,exit0**,789 literal utilities/missing=[], `15-css-generation.log` |
| Root/demo production CSS | **PASS,exit0**,17 assets/каждый dist, accounts/table/scope rules присутствуют, `17-production-css.log` |
| README format / `git diff --check` | **PASS,exit0**, `19-readme-format.log`, `20-final-diff-check.log` |

Добавлены **18** cases: form8 (exact POST/PATCH/empty vs changed password/readonly username/
limits/inactive response/error retention/busy/refresh/late unmount), filters5 (Apply/
discard/focus/Reset/chips/draft retention), panel+5 (CREW_MEMBER guard, local filters/
counts, selected draft/otheraccount reset,403 private DOM clearing, pending close protection).
Сохранены dispatcher zero-GET/inactive creation проверки. Старый realtime account case
открывает реальный Edit drawer и сохраняет прежние name/password/DraftChangeNotice assertions;
password helper теперь aria-describedby и label сопоставляется по точному короткому имени.

Первичные focused запуски сохранены: `01-focused-forms.log` **FAIL,exit1,15PASS/5FAIL из20**,
`02-focused-workspace.log` **FAIL,exit1,22PASS/5FAIL из27**. Все пять failures были в новых
filter tests: getByLabelText('Search accounts') совпадал с input и search landmark,
имеющими это доступное имя. Tests уточнены до role=textbox+name, проверки callback/
criteria/drafts не ослаблялись. Формы/panel/realtime проходили. Финальные567PASS/build
относятся к исправленному окончательному коду; assertions/timeout не отключались.

Integration/proxy/migrations/seed **NOT RUN**: backend/contracts/схема не менялись;
прежние integration results не являются новым запуском. Новая Browser QA390/1280
**BLOCKED / NOT RUN** при сохранённом ограничении инструмента: попыток/обхода/скриншотов
нет. Component tests/CSS assets не доказывают реальную геометрию, focus/scroll/touch.

### Ручная проверка и сохранность

На1280/390 проверить каталог/карточки/поиск/Popover и локальные counters, клавиатуру/
Escape/возврат фокуса, creation inactive/400/409/unknown Retry, edit с пустым/новым паролем,
role/access и работу собственной сессии после отзыва. Проверить dirty drawer при realtime,
другого пользователя после закрытия, disabled membership и переход Teams→Members.
Проверки реальных accounts требуют действия пользователя; агент не использовал реальные
пароли/аккаунты. Отложенные M5–M8/телефон/общая пользовательская приёмка PENDING/NOT VERIFIED.

18 protected hashes (.env/manifests/lockfile/Compose/десять миграций/private demo credentials)
совпали. Source inputs**441**, SHA-256
**`704604b3ce62c14ac2886a3d50ace9d30c975496a7c4ba73fc4a2d6d9f3c55fc`**,
`source-inputs-final.json`:3 modified/5 added/0 removed, только apps/web. HEAD/staging
сохранены. Данные/пароли/storage/volumes не менялись; seed/migrate/prepare/cleanup не запускались.

Идентифицированные собственные demo-процессы штатно остановлены (`06-demo-stop.log`,exit0)
и восстановлены тем же `pnpm demo:start --run accept1-20261027t075310`: ready/RUNNING,
`16-demo-start.log`, конечного exit code нет. API**14894/3001**, Next**14895/3000**, прежние
schema/private storage, PostgreSQL5432/5433 healthy, не перезапускались. Обычный dev
остановлен, build/tests завершены. `18-preservation.log` и
`processes-and-preservation-final.json` подтверждают source/protected hashes/HEAD/staging,
PID/UTC start/cwd/listeners после старта. Просмотр **http://127.0.0.1:3000/backoffice/accounts**.
Commit/push/deploy/staging и автоматической пользовательской приёмки нет.

## 2026-10-27 / Удалён видимый demo-баннер

По прямому запросу пользователя удалена надпись «DEMO — SYNTHETIC DATA» из RootLayout
и её неиспользуемый CSS. Run **`banner-ui-20261027t184557z`**. Git status/staging и
контекст проверены, текущие436 inputs совпали с предыдущим run, затронутые файлы/
тест/документы сохранены в before. В README/DEMO_RUNBOOK актуализировано описание,
в DECISIONS зафиксировано новое решение пользователя поверх прежнего требования M8;
исторические записи/prompt сохранены. Runtime FD_DEMO_RUN, отдельные schema/storage,
owner checks, credentials, авторизация, CSRF и CLI/manifest markers не менялись.

Node24.22.1/pnpm10.34.8. Последовательные проверки с полными redacted логами/командами/
start/end/child exit codes и hashes в **`.tmp/m8/banner-ui-20261027t184557z/`**:

- `pnpm lint` — **PASS,exit0**, `02-lint.log`.
- `pnpm format:check` — **PASS,exit0**, `03-format.log`.
- `pnpm typecheck` — **PASS,exit0**, `04-typecheck.log`.
- Layout/workspace tests — **PASS,exit0,8/8**, `05-layout-tests.log`. Существующий
  banner test теперь проверяет требуемое отсутствие надписи в demo и ordinary mode,
  сохранение children и отсутствие private run marker в HTML. Проверки не отключались.
- `pnpm build` — **PASS,exit0**, contracts/Nest/Next production, `06-build.log`.

Полный unit/integration набор, migrations/seed **NOT RUN** для этой небольшой правки;
прошлый549PASS не записан как новый запуск. Browser QA **BLOCKED / NOT RUN** при прежнем
ограничении инструмента; новых попыток/обхода нет. Пользователю достаточно обновить
страницу; визуальные/phone/общая приёмка остаются в прежнем PENDING/NOT VERIFIED.

Три source files изменены (layout/globals.css/существующийtest), добавлений/удалений нет.
Source SHA-256 **`f3ea7ea376bcd58a7d50013a69f2eb3151a96d3d0a469c3b18dd256f3560c598`**,
`source-inputs-final.json`. 18 protected hashes/HEAD/staging сохраняются. Данные/.env/
пароли/dependencies/lockfile/миграции не менялись; DB/seed/prepare/cleanup не запускались.
Прежний собственный demo штатно остановлен (`01-demo-stop.log`,exit0), восстанавливается
тот же `accept1-20261027t075310` (`07-demo-start.log`) с собственным dist/прежними данными.
`07-demo-start.log` сообщил ready, **RUNNING**, конечного exit code нет. API**11370/3001**,
Next**11371/3000**, тот же schema/storage; PostgreSQL5432/5433 healthy. Build/tests
завершены, ordinary dev остановлен. `08-preservation.log` подтверждает18 hashes,
436 inputs/HEAD/staging и PID/start/cwd/listeners после старта. Итоговые README format
и `git diff --check` — **PASS,exit0**, `09-readme-format.log`, `10-diff-check.log`.
Commit/push/deploy/staging не выполнялись, пользовательская приёмка не объявлялась.

## 2026-10-27 / TEAM-11 — проверка Members и внешних контактов

Run **`members-fix-20261027t181726z`** по сообщению пользователя. AGENTS/контекст,
Git status/diff/staging и текущие операции состава прочитаны;436 inputs предыдущего
Teams run совпали. Точечные before-копии CrewEditor/tests/hook/coordinator/styles/docs
сохранены, .env и credentials не копировались.

**Фактическая причина:** read-only transaction через существующую DataSource factory
на проверенном прежнем demo schema показала TEAM-11: **0 memberships,0 active members,
4 external contacts**, свободных employee candidates**0**. Ни один контакт не является
CrewMember/User по существующей модели. Проверка `02-team-data.log`, exit0, без имён/
паролей/токенов; development БД не читалась и не менялась. После запуска повтор
`21-team-data-after.log`,exit0 подтвердил тот же Crew UUID,11 команд и те же количества.
Никакого автоматического назначения/преобразования/создания аккаунтов не выполнено.

В CrewEditor добавлены отдельные счётчики Members/Specialists с сохранёнными accessible
names вкладок; для контактов без членов — пояснение и View specialists. Пустые candidates
объясняют создание сотрудника администратором или освобождение прежнего членства.
Specialists явно описаны как контакты без создания аккаунта/членства. Доменное правило
одной активной команды и все API/права/платежи/данные прежние. README/DECISIONS уточнены.

Добавлен regression case для команды с четырьмя контактами и пустым составом:0/4,
отсутствие добавляемых кандидатов, переход к четырём сохранённым contacts, отсутствие
mutation requests. `03-focused-tests.log` — **PASS,exit0,16/16** с realtime regressions.

Все команды на pinned Node24.22.1/pnpm10.34.8, итоговые проверки последовательно.
Полные redacted логи, start/end/child exit codes и hashes — в указанном run:

| Проверка | Результат |
| --- | --- |
| `pnpm lint` | **PASS,exit0**, `10-final-lint.log` |
| `pnpm format:check` | **PASS,exit0**, `11-final-format.log` |
| `pnpm typecheck` | **PASS,exit0**, `12-final-typecheck.log` |
| `pnpm test` | **PASS,exit0**, API175 + web374 = **549**, `13-final-tests.log` |
| `pnpm build` | **PASS,exit0**, contracts/Nest/Next, `14-final-build.log` |
| CSS generation/production assets | **PASS,exit0**,776 literal utilities/missing=[], root/demo16 CSS assets, `15-css-generation.log`, `17-production-css.log` |
| README format / `git diff --check` | **PASS,exit0**, `19-readme-format.log`, `20-final-diff-check.log` |

Первая попытка диагностического helper `01-team-data.log` завершилась exit1 из-за
неверного относительного module path в игнорируемом .tmp; путь исправлен, это не сбой
приложения и не результат чтения БД. Исходники приложения из-за этой ошибки не менялись.
Integration/proxy/migrations/seed **NOT RUN**, backend/контракты/схема прежние. Новая
browser QA **BLOCKED / NOT RUN** при сохранённом ограничении инструмента; попыток/обхода
не было. Визуальные/phone/общие M5–M8 проверки остаются PENDING/NOT VERIFIED.

18 protected hashes, HEAD/staging и436 source inputs сохранены. Source SHA-256
**`7df65f44a465fe0c1ceb36eefab67b39ad1148be15d92fcff5c137a5dcfc3280`**:
только CrewEditor и его test изменены, source additions/removals отсутствуют.
Прежний demo штатно остановлен/восстановлен (`04-demo-stop.log`,exit0;
`16-demo-start.log`,ready/RUNNING без конечного exitcode). API**9065/3001**, Next**9066/3000**;
тот же demo schema/private storage, оба PostgreSQL5432/5433 healthy. Build/tests завершены.
`18-preservation.log` подтверждает PID/start/cwd/listeners и сохранность. Seed/migrate/
prepare/cleanup/commit/push/deploy/staging не выполнялись. Пароли и .env прежние.

Пользователю: четыре записи видны в Specialists; для Members администратор создаёт
учётную запись Team member в Accounts, затем сотрудник добавляется через Add employee.
Перевод существующего сотрудника требует сначала отключить его прежнее активное
членство. Это действие пользователя, автоматического перемещения сотрудников нет.

## 2026-10-27 / Teams — каталог, состав и детали команды

По запросу пользователя обновлён существующий backoffice Teams. Run
**`teams-ui-20261027t174718z`**. До изменений прочитаны AGENTS/проектные документы,
проверены Git status/diff/staging и код. Все428 source inputs предыдущего Planning run
совпали. Before-копии затронутых tracked/untracked UI-файлов/тестов/route/shared Sheet/
manifests/lockfile/документов сохранены в игнорируемом run. Работа M1–M8 сохранена.

### Реализовано

- Новый Teams directory с семантической таблицей и карточками до900px: код/название,
  среда, service area, активность и обычные ссылки деталей. Сводка total/enabled/disabled/
  outdoor из реального полного GET /crews; membership counts не выдумываются и не
  загружаются отдельным запросом на каждую строку. Showing отделён от totals каталога.
- Поиск по name/code/serviceArea и Popover Filters по status/environment — локально к
  полному ответу. Separate drafts, Search/Apply, Escape/Close discard, chips/Clear;
  ввод/выбор до Apply не вызывает REST. Loading/empty/error/Retry и403 clearing проверены.
- Add a team открывает Sheet с прежними code/name/environment/area/active. Native
  FormData/constraints/payload сохранены. Ошибка сохраняет ввод, pending блокирует
  close/Escape/Cancel до результата; focus возвращается Add a team. Shared SheetContent
  получил только optional closeLabel/closeDisabled, defaults существующих preview прежние.
- Полная карточка: summary и Overview / Members / Availability / Specialists. Все
  панели forceMount+hidden, рабочие окна/профиль/контактные формы сохраняются между
  вкладками; memo availability не перерисовывается от tab/member search. Route key=id
  открывает новый редактор другой команды. Права и APIопераций прежние.
- Состав: реальные active/inactive memberships, отдельный Account disabled badge,
  локальный поиск и membership filter; native candidate Select/FormData и POST/PATCH
  unchanged. Backend по-прежнему проверяет актуальность назначения/реактивации и409.
  Stable team code/created/updated показаны отдельно от редактируемого профиля.
- Рабочие окна, travel buffer, недоступность, затронутые визиты и внешние специалисты
  получили единые Tailwind/shadcn Input/NativeSelect/Textarea/Button/Badge, Lucide и
  адаптивные отступы. Имена/limits/validation/busy locks/expectedVersion/timezone/payloads
  сохранены. CSS ограничен Teams; поля профиля занимают целую grid row, mobile cell
  padding/borders учитывают important Tailwind utilities. Прямой detail route импортирует
  team styles независимо от предварительного посещения каталога.
- README/DECISIONS обновлены. Backend/contracts/auth/CSRF/единый DataSource/схема,
  manifests/lockfile/dependencies не менялись. Новых бизнес-функций/этапов нет.

### Подтверждённый дефект и точечное исправление

В существующем CrewPlanningEditor `resource.data ?? lastGood` удерживал доступность
после401/403/404, даже когда hook уже очистил данные. Четыре новые regression cases
запущены **до** исправления: `01-access-red.log`, **exit1,3FAIL/1PASS**. Удаление формы/
данных после401/403/404 воспроизводимо не выполнялось;503 case уже проходил.

Использован существующий `useApiResource(...,{retainDataOnRefresh:true})`, отдельный
lastGood state/effect/setter удалён; выводится только resource.data. Временный503
сохраняет форму/черновик/исходную revision, а access loss убирает все прежние данные,
включая скрытые формы и unavailability values. Auth/hook/backend не изменялись.
`02-access-green.log`: **PASS,exit0,18/18** (access4 + прежние planning5 + detail8 + list1).
`03-focused-tests.log`: **PASS,exit0,30/30**, шесть файлов включая realtime drafts.
Assertions не ослаблялись и timeouts не увеличивались.

### Фактические итоговые проверки

Pinned **Node24.22.1 / pnpm10.34.8**. Полные redacted stdout/stderr, команда/start/end,
child exit code и SHA — **`.tmp/m8/teams-ui-20261027t174718z/`**. Итоговые тяжёлые
проверки выполнялись последовательно на окончательном source hash ниже.

| Проверка | Результат |
| --- | --- |
| `pnpm lint` | **PASS,exit0**, `10-final-lint.log` |
| `pnpm format:check` | **PASS,exit0**, `11-final-format.log` |
| `pnpm typecheck` | **PASS,exit0**, contracts/API/web, `12-final-typecheck.log` |
| `pnpm test` | **PASS,exit0**, API**175** + web**373** = **548** unit/component tests, `13-final-tests.log` |
| `pnpm build` | **PASS,exit0**, contracts/Nest/Next production, `14-final-build.log` |
| PostCSS generation | **PASS,exit0**, **774** literal utilities, missing=[], `15-css-generation.log` |
| Root/demo production CSS | **PASS,exit0**,16 CSS assets/каждый dist, team/theme/window rules присутствуют, `17-production-css.log` |
| README format | **PASS,exit0**, `19-readme-format.log`; docs по прежней конфигурации исключены из Prettier |
| `git diff --check` | **PASS,exit0**, `20-final-diff-check.log` |

Добавлены **17** cases: directory5 (loading/error/Retry, local filters/noN+1/real counts,
400 draft recovery/pending close protection/403); team detail8 (profile payload, candidate/
add/deactivate/conflict, tabs/drafts/memo, roster filters,403, cross-team reset);
availability access4 (401/403/404 clearing и503 original revision). Прежние рабочие окна/
409/DST inputs/double-submit/absence и все прежние realtime/component/unit cases прошли.

Первичный `04-typecheck.log`: **FAIL,exit2** — в адаптированном старом list test добавлен
неподдерживаемый `exact` в ByRoleOptions. Удалён лишний test option; строковый `name`
остаётся точным сопоставлением по API Testing Library. Итоговый typecheck/full tests/build
выполнены после исправления. RED и этот неуспешный запуск не скрыты.

Integration/proxy/migrations/seed **NOT RUN**: backend/contracts/БД не изменены, проблема
кеша воспроизведена реальным frontend hook в component tests. Исторический integration213
PASS из Orders не является новым запуском. **Browser visual QA390/1280: BLOCKED / NOT RUN**
при сохранённом ограничении инструмента; новых попыток/обхода/скриншотов нет. Component
assertions/production CSS не доказывают фактическую геометрию, scroll/focus или touch.

### Ручная проверка и сохранность

На1280/390 проверить список/карточки, поиск, Select внутри Filters, Escape/chips/clear,
создание и ошибку формы без потери ввода. В детали: все четыре вкладки, save профиля,
поиск состава и add/deactivate/reactivate с конфликтом, inactive account badge; окна с
перерывом/выходным, buffer/409 reload, недоступность и существующий booking warning;
создание/правку внешнего контакта и сохранение draft при realtime/tab change. Проверить
отсутствие внешнего горизонтального скролла. Физические устройства и общая приёмка
M5–M8 по-прежнему **PENDING / NOT VERIFIED**, пользовательская приёмка не объявлялась.

18 protected hashes совпали: .env, все manifests/lockfile, Compose, десять миграций,
private credentials прежнего demo. Источники **436**, SHA-256
**`57563f6b089ff8ad3fb327a9a56936b46e85bbe1d988ae889f80b010d28e58e5`**,
`source-inputs-final.json`:7 modified/8 added/0 removed, только apps/web. HEAD/staging
сохранены. Development данные/пароли/storage/volumes не менялись; seed/migrate/prepare/
cleanup не запускались. Commit/push/deploy/staging не выполнялись.

Идентифицированные собственные demo-процессы штатно остановлены (`05-demo-stop.log`,exit0).
Тот же `pnpm demo:start --run accept1-20261027t075310` пересобрал собственный Next dist
и сообщил ready: `16-demo-start.log`, **RUNNING**, конечного exit code нет. Оставлены API
**6258/3001**, Next**6259/3000**, прежний demo schema/private storage на postgres-test5433.
Development PostgreSQL5432 и postgres-test5433 healthy, не перезапускались. Обычный dev
остаётся остановленным; build/tests завершены. `18-preservation.log` и
`processes-and-preservation-final.json` подтверждают UTC start/command/cwd/listeners,
18 protected hashes, HEAD/staging и436 inputs после финальных gates. Для просмотра
**http://127.0.0.1:3000/backoffice/crews**.

## 2026-10-27 / Planning — современный календарь и карточка визита

По запросу пользователя обновлён существующий раздел Planning с акцентом на календарь,
отступы и границы обновлений. Run **`planning-ui-20261027t170536z`**. Прочитаны инструкции/
проектные документы; проверены Git status/diff/staging и исходники. Относительно финального
Orders snapshot исходных изменений до начала не было. Before-копии затронутых файлов/
тестов/route/manifests/lockfile/документов сохранены в игнорируемом run. M1–M8 и данные сохранены.

### Реализовано

- Tailwind/shadcn workspace: мини-календарь на широком экране, понятная навигация по
  периоду, Today/Planning date, Day/Week/**Month**/List, кнопки с Lucide и единые controls.
  Month использует уже установленный бесплатный daygrid FullCalendar7.1.3; запрос
  ровно на шесть Monday-first недель ([from,to)42 Rome-дня) включает соседние даты.
- Читаемые event cards: стабильный цвет первой команды, одно событие на многокомандный
  визит, текущий день/now indicator, компактные строки и полный accessible title.
  Month +more, переход из дня в Day; полный24-часовой день, сетка15/30/60 и Show weekends.
  Скрытые выходные остаются в complete list/сводке. На телефоне исходно List.
- Teams & filters: Popover с поиском команд, All teams, отдельным Unassigned, историческими
  inactive-командами, Confirmation/Attention/Service/Work progress. Apply/discard,
  счётчик и удаляемые chips/Clear; Reset selection не вызывает запрос.
- Search применяется по submit к полному загруженному диапазону. Текст и четыре status/
  service-параметра явно локальные; диапазон/команды/Unassigned остаются серверными.
  Показывается Showing X of Y, показатели исходного выбранного диапазона не выданы
  за глобальные dashboard totals. Прежняя ошибка слишком плотного диапазона сохранена.
- Event click → read-only **Visit preview** с командами, plan/buffer и раздельными
  estimated/actual временами, flags и ссылками full visit/order. Modified click остаётся
  обычной ссылкой; закрытие возвращает фокус. Потеря доступа убирает preview/events.
- Полная карточка: плановая сводка, команды/задачи/фактические времена и шесть вкладок
  Overview / Execution / Acknowledgements / Reschedule / Files / History. Panels остаются
  смонтированными и hidden, frozen edit revision/Retry/canvas сохраняются. Memo wrappers
  и stable scopes/callbacks отделяют навигацию от вложенных workflow modules; route key
  Order+Appointment сбрасывает чужой draft при переходе. История читаемая и раскрываемая.
  Opaque customer signing backdrop сохранён; прежние операции/права/версии не менялись.
- Календарь больше не пересоздаётся из-за key по date/query/reload или background loading.
  CalendarWorkspace удерживает ресурс при same-query refresh; другой диапазон и403
  очищают события, hook по-прежнему abort/игнорирует поздний ответ. Навигация через
  подтверждённый v7 ref API, memo events/options/callbacks и scrollTimeReset=false.
  Date внутри текущей недели не повторяет GET/gotoDate/render календаря. Черновики поиска/
  фильтров и перелистывание mini-picker локальны. Complete list строит DOM лишь после
  раскрытия. RiskPanel обновляет ресурс по optional signal без key-remount.
- README/DECISIONS обновлены. Backend/contracts/auth/CSRF/DataSource/миграции/данные и
  dependencies/lockfile не менялись; новых premium/платных компонентов нет.

### Фактические программные проверки

Pinned **Node24.22.1 / pnpm10.34.8**. Последовательные команды, redacted stdout/stderr,
start/end, exit code проверяемого процесса и log SHA — **`.tmp/m8/planning-ui-20261027t170536z/`**.

| Проверка | Результат |
| --- | --- |
| `pnpm lint` | **PASS, exit0**, `10-final-lint.log` |
| `pnpm format:check` | **PASS, exit0**, `11-final-format.log` |
| `pnpm typecheck` | **PASS, exit0**, contracts/API/web, `12-final-typecheck.log` |
| `pnpm test` | **PASS, exit0**, API**175** + web**356** = **531** unit/component tests, `13-final-tests.log` |
| `pnpm build` | **PASS, exit0**, contracts/Nest/Next production, `14-final-build.log` |
| PostCSS generation | **PASS, exit0**, **753** literal utilities, missing=[], `15-css-generation.log` |
| Root/demo production CSS | **PASS, exit0**,13 assets/каждый dist: calendar/theme/sidebar/visit/Select/Tabs rules, `17-production-css.log` |
| README format | **PASS, exit0**, `19-readme-format.log`; docs по прежней конфигурации исключены из Prettier |
| `git diff --check` | **PASS, exit0**, `20-final-diff-check.log` |

Добавлены **25** cases: model8 (month/DST/device zone/date bounds/colour/planned instants),
filters5 (Apply/discard/focus/local search/IDs/chips/Retry), detail6 (mounted forms/canvas,
исходная revision, ограничение начатой работы, route reset,403/history), board+6
(mount retention, no draft requests/renders, local filters,42-day month,403 clearing,
выбор другого дня той же недели). Весь прежний unit/component набор прошёл.
Mocks FullCalendar проверяют ref/lifecycle/props и React boundaries, не фактическую геометрию
или FPS. Программные результаты не выдаются за проверку Google Calendar или двух браузеров.

Первичный `03-focused-tests.log`: **FAIL, exit1,29PASS/3FAIL из32** — Radix dialog
получал accessible name из customer SheetTitle, а не ожидаемого Visit preview. Исправлена
структура нового preview: SheetTitle Visit preview и отдельный customer heading.
Assertions full-visit link/teams/actual time/403 не ослаблялись. `04-focused-tests.log`:
**PASS, exit0,32/32**. После дополнительной memo boundary/регрессии same-week выбора
`06-calendar-performance.log`: **PASS, exit0,14/14**. Итоговые531/сборка выполнены после
последних исходных изменений. Первоначальный неуспешный запуск сохранён.

Integration/proxy/миграции/seed **NOT RUN**: изменено только представление web, существующий
backend/contracts и схема неизменны. Прежний integration213PASS из Orders — исторический,
не новый запуск. Новые реальные browser/UI/390/1280 проверки **BLOCKED / NOT RUN** при
сохранённом ограничении доступа инструмента, повторных попыток/обхода/скриншотов нет.
CSS generation и component tests не подтверждают реальную плавность/порталы/переполнения.

### Оставшаяся ручная проверка

На1280/390 проверить Day/Week/Month/List, Today/дату/мини-календарь, переходы через
DST, наложенные события/+more,15/30/60 grid, weekend toggle и отсутствие внешнего
горизонтального скролла. Проверить Teams & filters/Apply/Escape/focus и Search без потери
выбора; сравнить Showing/сводку с полным диапазоном. Открыть preview/full visit, проверить
все команды/buffer/план отдельно от факта/прогноза, формы, конфликт и stale revision,
сохранение draft/canvas между вкладками и после realtime refresh. Профиль реальных
render/layout/scroll под нагрузкой требует браузера; физический touch/camera/canvas —
телефона. Отложенные M5–M8 и пользовательская приёмка остаются **PENDING / NOT VERIFIED**.

### Сохранность и запуск

18 protected hashes совпали: .env, manifests, lockfile, Compose, десять миграций и private
credentials прежнего demo. Source inputs **428**, SHA-256
**`6eb6e4c426ea1512d840a5f92c9aa7df7b341991dee8a78ed5c66087f3c1a0d9`**,
`source-inputs-final.json`:6 modified/10 added/0 removed, все в apps/web. HEAD/staging
сохранены. Development PostgreSQL/.env/пароли/storage/volumes не менялись; prepare/
seed/migrate/cleanup не запускались. Commit/push/deploy/staging не выполнялись.

Прежние demo-процессы идентифицированы по PID/start time/cwd, штатно остановлены
(`01-demo-stop.log`,exit0). Тот же `pnpm demo:start --run accept1-20261027t075310`
пересобрал собственный Next dist и сообщил ready: `16-demo-start.log`, **RUNNING**,
конечного exit code нет. Оставлены API**2083/3001**, Next**2084/3000**, прежний demo schema/
private storage на postgres-test5433. Development PostgreSQL5432 и postgres-test5433
healthy, не перезапускались. Обычный dev остаётся остановленным; build/tests завершены.
`18-preservation.log` и `processes-and-preservation-final.json` подтверждают UTC start
всех собственных процессов/cwd/listeners,18 hashes, HEAD/staging и все428 исходных inputs
после финальных gates. Для просмотра **http://127.0.0.1:3000/backoffice/planning**.

## 2026-10-27 / Orders — команды, единые controls и полная карточка

По запросу пользователя обновлён весь существующий Orders. Run
**`orders-complete-20261027t154029z`**. Перед изменениями прочитаны инструкции/контекст,
проверены Git status/diff/staged/untracked; точечные before-копии затронутых файлов,
тестов, manifests/lockfile и документов сохранены в игнорируемом run. Прежняя работа
M1–M8 и пользовательские изменения сохранены, нового бизнес-этапа нет.

### Реализация

- API/contracts: required `assignedCrews: {id,code,name}[]` в backoffice list/detail,
  строгий browser guard. Distinct команды ASSIGNED назначений SCHEDULED визитов,
  включая законченное исполнение и inactive исторические команды; отменённые
  визиты/назначения исключены. Для страницы — один ограниченный DISTINCT-запрос,
  для пустой страницы — ни одного. Money/count/progress queries не объединялись
  с назначениями. Single DataSource/auth/CSRF/crew responses не менялись, миграции нет.
- Teams в таблице (два имени +N), все команды в quick view/полной карточке; пустое
  значение Not assigned. Это участие команд в визитах, а не один владелец заказа.
  Mobile/tablet card layout включается до 1000 px, колонкам заданы новые размеры.
- Lucide **1.62.0** вместо ручных иконок; закреплены Radix Select **2.4.1** и Tabs
  **1.2.1**, peers React19 проверены. shadcn source snapshots/URLs/hashes и MIT notice
  сохранены. Другие прямые pins не обновлялись; единственный lockfile обновлён.
- Поиск/фильтры/Per page — единый keyboard-accessible Select; Popover/chips/Apply/
  discard и query serialization прежние. Общие Input/Textarea/NativeSelect/Button
  согласованы по высоте, стрелкам, ошибкам и disabled states. В бизнес-формах сохранены
  native FormData, names/limits/handlers, версии и ключи идемпотентности.
- Детальная карточка: header/statuses, четыре финансовых показателя, Overview / Visits /
  Execution / Files / Payments / History; контакты, доступ, команды, notes и товары
  с отдельными ordered/delivered/assembled. История — timeline с раскрытием changes.
  Panels forceMount + explicit hidden: draft/revision/operation keys/canvas не теряются
  при переключении. Edit возвращает Overview, Visits/Payments закрыты до save/cancel;
  route key=id сбрасывает редактор при открытии другого заказа.
- Scoped orders-detail.css обновляет вложенные planning/execution/evidence/acceptance/
  completion modules, без изменения их операций. Opaque customer-signing backdrop
  сохранён. Tailwind prefix tw/important/noPreflight прежние. README/DECISIONS обновлены.
- Исправлен найденный крайний случай новой projection: detail использует канонический
  `order.id`, а не регистр UUID в URL. Service + HTTP integration assertions проверяют
  верхний регистр UUID и отсутствие crew/финансового раскрытия.

### Текущие проверки

Pinned **Node 24.22.1 / pnpm 10.34.8**. Полные redacted stdout/stderr, команды,
start/end, child exit code и SHA — **`.tmp/m8/orders-complete-20261027t154029z/`**.
Проверки запускались последовательно; финальные результаты относятся к source hash ниже.

| Проверка | Фактический результат |
| --- | --- |
| Установка новых pinned dependencies | **PASS, exit 0**, `01-install.log` |
| `pnpm install --frozen-lockfile --offline` | **PASS, exit 0**, `07-frozen-install.log` |
| `pnpm lint` | **PASS, exit 0**, `25-final-lint.log` |
| `pnpm format:check` | **PASS, exit 0**, `30-final-format.log`; итоговые docs проверяются отдельно |
| `pnpm typecheck` | **PASS, exit 0**, contracts/API/web, `31-final-typecheck.log` |
| `pnpm test` | **PASS, exit 0**, API **175** + web **331** = **506** unit/component tests, `32-final-tests.log` |
| `pnpm build` | **PASS, exit 0**, contracts/Nest/Next production, `33-final-build.log` |
| `pnpm test:integration` | **PASS, exit 0**, **213/213** tests, 23 files, `34-final-integration.log` |
| PostCSS generation | **PASS, exit 0**, **686** literal utilities, missing=[], `35-css-generation.log` |
| Root/demo production CSS | **PASS, exit 0**, table/card breakpoint, Select/Popover/Tabs/scoped styles присутствуют, `37-production-css.log` |
| Итоговый формат README | **PASS, exit 0**, `38-final-docs-format.log`; docs по прежней конфигурации исключены из Prettier |
| `git diff --check` | **PASS, exit 0**, `39-final-diff-check.log` |

Новые component cases проверяют реальные teams list→preview, отдельные quantities,
все шесть вкладок, сохранение input/canvas DOM и frozen edit revision при refresh,
403 clearing, cross-order draft reset, читаемую историю. Новые три PostgreSQL cases:
empty/batched/deduplicated projection, cancellation/inactive/completed participation,
pagination/финансы и backoffice/crew access. Старые workflow assertions сохранены;
тесты идут через новые реальные Tabs и keyboard Select. Для jsdom добавлен только
отсутствующий scrollIntoView; это не проверка реальной геометрии/скролла браузера.

### Сохранённые первоначальные неуспешные запуски

- `05-detail-tests`: exit 1, **7 PASS / 1 FAIL** — регистр подписи нового history test.
  `06-ui-tests`: exit 1, **36 PASS / 2 FAIL** — beforeEach ошибочно возвращал mock как
  cleanup и helper держал уже размонтированный pagination trigger. Исправлены тесты/
  keyboard helper: актуальный combobox повторно находится после запроса.
- `08-lint`: exit 1 — два unused bindings в адаптированном filter test, удалены bindings,
  ожидания dialog сохранены. `26-final-format`: exit 1 — формат README, исправлен Prettier.
- `15-tests`: exit 1, API175 PASS, web **329 PASS / 2 FAIL** — старые workflow tests
  обращались к теперь скрытым разделам. Добавлено открытие Execution/Payments.
  `16-workflow-tests`: exit 1, **19 PASS / 1 FAIL** — Unpaid стал присутствовать и в
  header badge, и в KPI; assertion ограничен прежним финансовым показателем. Assertions
  серверных параметров/конфликтов/revision/прав не ослаблялись. Итоговый 506 PASS — после правок.
- `21-integration`: exit 1, **210 PASS / 3 FAIL**. Два новых test cases имели неполную
  fixture: отсутствовала обязательная причина изменения команды, а следующий case
  зависел от состояния упавшего предыдущего. Добавлена причина и независимый context.
  Третий сбой — `QueryFailedError: Query read timeout` в существующем planning case
  «resets confirmation only for actual customer-condition edits…». Причина **UNKNOWN**.
  Post-run process/DB diagnostics сохранены в `21-timeout-diagnostic.json` и
  `21-timeout-post-run-db-diagnostic.txt`; это не снимок точного момента сбоя.
- Один диагностический повтор неизменённого planning case: **PASS, exit 0, 1 passed /
  18 skipped**, `23-planning-diagnostic.log`. Новые teams cases после исправлений:
  **PASS, exit 0, 3 passed**, `24-crews-integration.log`. Повтор не стирает первый timeout;
  timeouts/assertions не увеличивались/не отключались. Финальный полный повтор на
  окончательном коде — **213/213 PASS**, `34-final-integration.log`; причина первого
  timeout остаётся UNKNOWN, отдельный диагностический успех её не доказывает.

### Приёмка и сохранность

**Browser visual QA 390/1280: BLOCKED** существующим ограничением инструмента. Новых
попыток/обхода/скриншотов нет. Component tests и сгенерированные CSS не заменяют
проверку в браузере. Пользователю остаётся проверить команды в таблице/панелях,
Select внутри Filters, Escape/focus/scroll, мобильные карточки, все вкладки и формы,
читаемость вложенных визитов/результатов, отсутствие горизонтального скролла, а также
сохранение черновика/подписного canvas при смене вкладок и фоновом обновлении.
Отложенные M5–M8 browser/phone/camera/canvas/user acceptance остаются **PENDING / NOT VERIFIED**.

16 protected hashes совпали: .env, root/API/contracts manifests, Compose, десять миграций,
private demo credentials. Источники **418**, SHA-256
**`c4e732eaff9ce6417b7d2c93086c4b1779acfa92bf890d0aefdf71c7656573a6`**,
`source-inputs-final.json` (29 modified / 10 added / 0 removed против предыдущего filters run).
HEAD/staging сохранены. Development БД/volumes/storage/passwords не менялись;
prepare/seed/root migrations/cleanup не запускались. Интеграционные fixtures используют
собственные test schemas/private storage, без fallback на development.

Собственный прежний demo штатно остановлен (`02-demo-stop.log`, exit 0), затем тот же
`pnpm demo:start --run accept1-20261027t075310` пересобрал собственный Next dist и сообщил
ready: `36-demo-start.log`, **RUNNING**, конечного exit code нет. Оставлены API
**96454 / 3001**, Next **96455 / 3000** на прежнем demo schema/storage в test PostgreSQL
5433. Development PostgreSQL5432 и postgres-test5433 healthy, не пересоздавались.
Обычный dev остаётся остановленным; дублирующих Next с общим dist нет.
Открыть **http://127.0.0.1:3000/backoffice/orders** и обновить страницу.
`processes-and-preservation-final.json` подтверждает текущие PID/command/cwd/UTC start
time, healthy PostgreSQL, неизменность protected hashes/HEAD/staging и всех 418 source
inputs после финальных code gates. Build/tests завершены. Итоговые проверки формата README
и Git whitespace записаны отдельными логами после обновления этого отчёта.
Commit/push/deploy/staging не выполнялись, автоматической пользовательской приёмки нет.

## 2026-10-27 / Компактная панель фильтров Orders

По запросу пользователя уменьшена постоянная панель Orders. Run
**`filters-20261027t151537z`**. Инструкции/контекст прочитаны, Git status/diff/staging
проверены; до изменений сохранены точечные before-копии списка/тестов/manifests/lockfile/
документов. Прежние изменения M1–M8 и предыдущие UI-правки сохранены.

### Изменения

- Новые `order-filters.tsx` и `ui/popover.tsx`: верхняя строка поиска и Filters вместо
  постоянной большой формы. Четыре параметра в локальной адаптации shadcn Popover,
  счётчик advanced conditions, applied chips с удалением по одному и Clear filters.
- Enter/Search применяет поиск с подтверждёнными критериями. Apply подтверждает выбор
  и текущий текст, Close/Escape/outside отменяет неподтверждённый advanced draft.
  Reset selection сбрасывает только открытый выбор, без запроса. Контролируемое
  состояние не зависит от FormData внешней формы при portal rendering.
- `order-list.tsx` использует новый компонент; Per page перенесён в pagination footer,
  меняется сразу и возвращает page1. Очистка критериев сохраняет выбранный pageSize.
  Серверная query serialization, таблица, quick view, деньги/права/API сохранены.
- Закреплён только новый `@radix-ui/react-popover` **1.3.1**, peer React19 проверен;
  остальные прямые версии прежние. Source registry/URL/hash в `shadcn-sources.json`,
  MIT notice прежний `ui/LICENSE`. Prefix tw/important/noPreflight не менялись.
  README/DECISIONS обновлены; нового бизнес-этапа/endpoint/схемы нет.

### Фактические проверки

Pinned **Node 24.22.1 / pnpm 10.34.8**. Полные stdout/stderr, команды, start/end и
exit codes — **`.tmp/m8/filters-20261027t151537z/`**.

| Проверка | Результат |
| --- | --- |
| Установка pinned Popover | **PASS, exit 0**, `01-install.log` |
| `pnpm install --frozen-lockfile --offline` | **PASS, exit 0**, `05-frozen-install.log` |
| `pnpm lint` | **PASS, exit 0**, `06-lint.log` |
| `pnpm format:check` | **PASS, exit 0**, `07-format-check.log`; обновлённый README отдельно `14-readme-format.log` |
| `pnpm typecheck` | **PASS, exit 0**, все три пакета, `08-typecheck.log` |
| `pnpm test` | **PASS, exit 0**, API **174** + web **323** = **497** unit/component tests; `09-tests.log` |
| `pnpm build` | **PASS, exit 0**, contracts/Nest/Next production; `10-build.log` |
| PostCSS generation | **PASS, exit 0**, **614** literal utilities, missing=[]; `11-css-generation.log` |
| Root/demo production CSS | **PASS, exit 0**, table/preview/mobile/Popover width+height/prefix rules присутствуют; `13-production-css.log` |
| `git diff --check` | **PASS, exit 0**, `15-final-diff-check.log` |

Добавлены **6** component cases: исходная компактность, discard/Escape/focus и search
retention, поиск с applied criteria, confirm/count, удаление одной метки/Clear при
выбранном pageSize, фоновый rerender/Reset. Существующие Orders tests переведены на
открытие реального Popover; assertions серверных параметров/прав/preview сохранены.
Первичный focused `03-focused-tests.log` — **FAIL, exit 1, 30 PASS / 1 FAIL**: ещё один
старый тест пытался выбрать Work progress до открытия панели. В нём добавлен шаг
Filters; исходная проверка query осталась прежней. `04-focused-tests.log` — **31 PASS,
exit 0**. Это обновление тестового UI-пути, не скрытие ошибки приложения. Итоговый
полный набор и build выполнены после правки; source inputs после них не менялись.

Integration/proxy/миграции/seed **NOT RUN**, backend/contracts/схема не менялись.
**Browser visual QA 390/1280: BLOCKED** сохранённым ограничением инструмента; новой
попытки доступа/обхода/скриншотов нет. Component tests/CSS assets не заменяют визуальную
проверку: пользователю остаётся проверить открытие/размещение Popover, нативный выбор,
поиск, chips, Escape и Per page на обеих ширинах. Физические устройства и приёмка
M5–M8 остаются в прежнем PENDING/NOT VERIFIED состоянии.

### Процессы и сохранность

Старый собственный demo остановлен штатным CLI, **exit 0**, `02-demo-stop.log`, без
завершения посторонних процессов. Затем `pnpm demo:start --run accept1-20261027t075310`
пересобрал собственный Next dist и сообщил ready; **RUNNING**, без конечного exit code,
`12-demo-start.log`. Оставлены supervisor **89018**, API **89085 / 3001**, Next
**89086 / 3000**, их PID/start time/command/cwd перепроверены. Для просмотра обновить
**http://127.0.0.1:3000/backoffice/orders**. Тот же demo schema/private storage на
существующем test PostgreSQL 5433; ordinary dev остаётся остановленным. Development
БД/volumes/.env/credentials не менялись; prepare/seed/migrations/cleanup не запускались.
Build/tests завершены; дублирующих экземпляров Next нет.

16 protected hashes совпали (.env, root/API/contracts manifests, Compose, десять
миграций, private demo credentials). Web manifest/lockfile дополнены Popover и его
transitive dependencies. `source-inputs-final.json`: **408** code/config/license inputs,
SHA-256 **`64c3a3e6d421fc663abb64d22f16c9a69c058a84df55e14d00ec6b30323be3be`**.
Точный delta относительно предыдущего Orders run сохранён там же;
`processes-and-preservation-final.json` подтверждает protected hashes/HEAD/staging и
актуальность проверенного кода после запуска. Commit/push/deploy/staging не выполнялись.

## 2026-10-27 / Orders — таблица и боковой просмотр

По запросу пользователя улучшен существующий Orders. Run **`orders-ui-20261027t144856z`**.
Прочитаны инструкции/проектный контекст, проверены Git status/diff/staged/untracked,
сохранены точечные `before/` копии затронутых файлов/lockfile/документов в игнорируемом
run. Существующая реализация M1–M8, HEAD/staging, данные и аккаунты сохранены.

### Реализовано

- Orders теперь семантическая таблица: заказ/клиент/город, услуга, отдельные work/payment
  badges, стоимость/остаток и независимые issue/return/review flags. Один DOM, на <760 px
  строки расположены как карточки; доступные headings/roles и text values сохранены.
- Pointer click строки и настоящая кнопка номера открывают **Order preview**. Панель
  читает реальный защищённый `/orders/:id`, показывает контакты/адрес/описание, active
  товары с отдельными ordered/delivered/assembled, точные суммы/статусы. Escape/Close
  закрывает панель с возвратом фокуса. Неподтверждённые фильтры и текущая страница списка
  сохраняются. **Open / Open full order** ведёт в прежнюю полную карточку для действий.
- Поиск/фильтры/пагинация остаются на backend; Apply применяет draft и сбрасывает page1,
  Clear filters одновременно сбрасывает applied filters и видимые поля. Refetch того
  же query сохраняет список; 401/403/404 очищают данные. Detail не подменяется summary,
  запоздалый ответ другого заказа не показывается, есть loading/error/Retry/empty states.
- `order-list.tsx`, новый `order-quick-view.tsx`, новый `order-list.test.tsx`; общие labels
  в `lib/order-labels.ts` со старыми совместимыми exports, без цикла preview/list.
- Локальные адаптации shadcn/ui Table/Sheet/Button/Badge/Input/Native Select и cn helper
  в `components/ui` / `lib/utils.ts`. Источники получены из официального registry,
  snapshots/URLs/SHA — `shadcn-sources.json`, MIT attribution — `ui/LICENSE`.
  Tailwind prefix tw/important/noPreflight сохранён. Три новые runtime зависимости:
  Radix Dialog **1.3.1**, clsx **2.1.1**, tailwind-merge **3.7.0**; версии закреплены.
  Остальные прямые dependency pins не менялись. Нет CLI overwrite темы или новых
  API/схем/бизнес-операций. README и DECISIONS обновлены.

### Новые фактические проверки

Pinned **Node 24.22.1 / pnpm 10.34.8**. Полные stdout/stderr и metadata с командами,
временем и exit codes: **`.tmp/m8/orders-ui-20261027t144856z/`**.

| Проверка | Итог |
| --- | --- |
| Установка pinned UI dependencies | **PASS, exit 0**, `01-install.log` |
| `pnpm install --frozen-lockfile --offline` | **PASS, exit 0**, `04-frozen-install.log` |
| `pnpm lint` | **PASS, exit 0**, `11-final-lint.log` |
| `pnpm format:check` | **PASS, exit 0**, `12-final-format-check.log` |
| `pnpm typecheck` | **PASS, exit 0**, все три пакета, `13-final-typecheck.log` |
| `pnpm test` | **PASS, exit 0**, API **174** + web **317** = **491** unit/component tests; `14-final-tests.log` |
| `pnpm build` | **PASS, exit 0**, contracts/Nest/Next production; `15-final-build.log` |
| PostCSS generation | **PASS, exit 0**, **593** literal utilities, missing=[]; `16-css-generation.log` |
| Реальные root/demo production CSS | **PASS, exit 0**, table/Sheet/viewport/mobile/prefix styles присутствуют; `18-production-css.log` |
| `git diff --check` | **PASS, exit 0**, `19-diff-check.log`, после отчёта — `20-final-diff-check.log` |

Новые **8** regression tests проверяют независимые статусы/суммы и semantic row,
server filters/clear/page reset, actual detail GET/loading/read-only preview,
Escape/focus return, detail failure/Retry/Close, late-response isolation, очистку
preview/list при потере доступа и pointer click строки. Первичный focused run
orders+new cases — **25 PASS**, `03-focused-tests.log`; итоговый полный run включает их
после последних правок. Утверждения существующих Orders tests не ослаблялись.

**Первый полный run `08-tests.log` — FAIL, exit 1**, этот факт сохранён: API 174 PASS,
web 316 PASS / 1 FAIL. Старый тест `acceptance-panel.test.tsx` на строке 280 ожидал
немедленный revokeObjectURL после удаления customer modal из DOM; зарегистрировано
0 calls в момент assert. Один diagnostic repeat `10-signature-diagnostic.log` —
**1 PASS / 14 skipped, exit 0**, не полный набор. Исходник preview URL освобождает его
в passive useEffect cleanup. Проверка теперь ждёт тот же точный callback через
существующий waitFor; timeout/assertion не увеличены/не отключены. Это одна точечная
правка ожидания старого теста, production signature logic не менялась. Точная причина
планирования первого проявления отдельно не инструментировалась; успешный повтор не
стирает FAIL. После правки заново выполнены lint/format/typecheck/полный test/build из
таблицы. Итоговые исходники после этих проверок не менялись, кроме отчётов.

Integration/proxy/миграции/seed **NOT RUN** — backend/contracts/схема не менялись;
прежние результаты не выдаются за новый запуск. Browser QA **BLOCKED** действующим
сохранённым ограничением browser tool, новая попытка или обход не выполнялись.
Скриншотов нет; component tests и CSS assets не подтверждают визуальный вид на
390/1280 px, физические телефон/камера/canvas остаются NOT VERIFIED. Пользователю
осталось посмотреть таблицу/карточные строки, preview/scroll/keyboard close, Apply/
Clear/пагинацию и Open. Приёмка M5–M8 остаётся PENDING.

### Сохранность и процессы

Собственный demo supervisor и порты установлены повторно. Штатный
`pnpm demo:stop --run accept1-20261027t075310` — **PASS, exit 0**, `02-demo-stop.log`.
Тот же demo запущен через `pnpm demo:start --run accept1-20261027t075310`, свой Next dist
пересобран, CLI сообщил ready. **RUNNING**, без конечного exit code; `17-demo-start.log`.
Оставлены supervisor **86036**, API **86107 / 3001**, Next **86108 / 3000**; их PID/start
identity/command/cwd перепроверены. Для просмотра: **http://127.0.0.1:3000/backoffice/orders**.
Тот же private schema/storage на test PostgreSQL 5433. Development .env/БД/volumes,
пароли/аккаунты не менялись; seed/migrations/prepare/cleanup не запускались. Обычный dev
остаётся остановленным. Build/tests процессы завершились, новые дубликаты не оставлены.

16 protected hashes совпали (.env, root/API/contracts manifests, Compose, десять
миграций, private demo credentials). Из разрешённых manifests изменены только web и
lockfile для трёх UI dependencies. `source-inputs-final.json`: **405** выбранных code/
config/license inputs, SHA-256 **`12709f1fc58ccb64c9e4baabef63e671aa3c9229189fdc402c6b694ec11f6dec`**.
Точный delta к Tailwind run сохранён там же; `processes-and-preservation-final.json`
подтверждает unchanged protected hashes/HEAD/staging/проверенные исходники после старта.
Секреты в отчёты/команды не включались. Staging/commit/push/deploy не выполнялись.

## 2026-10-27 / Tailwind — dashboard, backoffice shell и login

По прямому запросу пользователя установлен **Tailwind CSS 4.3.3** с
**@tailwindcss/postcss 4.3.3 / PostCSS 8.5.32**, точные версии в web manifest и одном
lockfile. Использована официальная Next/PostCSS интеграция; npm metadata/Node engines
проверены, pinned Node **24.22.1 / pnpm 10.34.8**. Прежние прямые dependency pins сохранены.
Это перенос оформления существующего интерфейса, без новых бизнес-функций/этапов.

Run **`tailwind-20261027t142059z`**. Git status/staged/unstaged/untracked проверены до
изменений; сохранены точечные копии затронутых исходников/настроек/документов и прежнего
lockfile в игнорируемом `before/`. HEAD/staging и прежняя работа M1–M8 сохранены.

### Изменения

- Новые `apps/web/postcss.config.mjs`, `apps/web/app/tailwind.css`, импорт в root layout.
  Только theme/utilities, без Preflight; префикс `tw:` и important utilities защищают
  от коллизий с существующим unlayered CSS. Источники ограничены app/components TS/TSX.
- `order-dashboard.tsx`: все карточки, графики, loading/error/Retry, ссылки, responsive
  состояния и pseudo-elements используют literal utility strings. `dashboard.css`
  удалён после полного переноса. Динамическими остались только доли/ширины диаграмм.
- `app/login/page.tsx`, `login-form.tsx`: Tailwind для страницы/бренда/формы/полей/ошибок/
  кнопки. Сохранены session redirect, login POST, validation, autocomplete, pending и error.
- `app/backoffice/layout.tsx`: Tailwind для header/navigation/user menu/main. Права,
  SessionProvider и доступность ADMIN/crew не менялись. LogoutButton принимает optional
  className для backoffice; прежний crew default и logout event/router logic сохранены.
- Shared globals.css остался побайтно прежним: auth-shell/auth-card всё ещё нужны
  SessionUnavailable; формы других разделов и календарь этим запросом не переносились.
  API/DataSource/contracts/auth/CSRF/Origin/данные не менялись. README и DECISIONS обновлены.

### Новые фактические проверки

Полные redacted stdout/stderr, команды/start/end/exit codes:
**`.tmp/m8/tailwind-20261027t142059z/`**. Все нижеследующие результаты относятся к
окончательному коду этого run; исходники после проверок не менялись.

| Команда / проверка | Результат |
| --- | --- |
| Установка pinned Tailwind/PostCSS | **PASS, exit 0**, `01-install.log`, `02-postcss-version.log` |
| `pnpm install --frozen-lockfile --offline` | **PASS, exit 0**, `05-frozen-install.log` |
| PostCSS generation | **PASS, exit 0**, **435** literal utilities, missing=[], prefix/important/responsive/donut; `04-css-generation.log` |
| `pnpm lint` | **PASS, exit 0**, `06-lint.log` |
| `pnpm format:check` | **PASS, exit 0**, `07-format-check.log` |
| `pnpm typecheck` | **PASS, exit 0**, все три пакета, `08-typecheck.log` |
| `pnpm test` | **PASS, exit 0**, API **174** + web **309** = **483** unit/component tests; `09-tests.log` |
| `pnpm build` | **PASS, exit 0**, contracts/Nest/Next production, `10-build.log` |
| `git diff --check` | **PASS, exit 0**, `11-diff-check.log`; после отчёта — `14-final-diff-check.log` |
| Реальные root/demo production CSS assets | **PASS, exit 0**, prefixed rules/gradient/important/spacing/mobile breakpoint; `13-production-css.log` |

Прежние assertions тестов не изменялись. Новые тесты, повторяющие utility class names,
не добавлялись: проверено сохранённое поведение существующими тестами и реальная
генерация/Next build. Отдельный первый вспомогательный assert искал version/license
комментарий в production CSS и завершился exit 1: Next optimizer удаляет комментарии,
при этом нужные правила присутствовали. Это ошибка диагностического предположения,
не найденный дефект приложения. Версия подтверждена metadata, последующий checker
проверяет сами emitted rules; исходники ради этого не менялись. Детали:
`production-css-initial-diagnostic.json`, `production-css-check.json`.

Integration/proxy/миграции/seed **NOT RUN**: серверная реализация и схема не менялись;
старые M8 результаты не обозначаются новым PASS. Browser QA 390/1280 **BLOCKED** из-за
сохранённого ограничения browser tool, свежая попытка или обход не выполнялись.
Скриншотов/визуального подтверждения нет; физические телефон/камера/canvas NOT VERIFIED.
Пользователю остаётся посмотреть login/dashboard на 390/1280 px, keyboard focus,
ошибку входа/Retry и переходы по диаграммам. Приёмка M5–M8 остаётся PENDING.

### Запуск и сохранность

Перед сборкой повторно проверены принадлежность supervisor/process cwd и собственные
порты. `pnpm demo:stop --run accept1-20261027t075310` — **PASS, exit 0**,
`03-demo-stop.log`, без broad kill или остановки PostgreSQL. Затем обычный
`pnpm demo:start --run accept1-20261027t075310` пересобрал свой Next dist и сообщил ready.
Команда **RUNNING**, конечного exit code нет; `12-demo-start.log` не выдаётся за
завершённый PASS. Оставлены supervisor **81870**, API **81960 / 3001**, Next
**81961 / 3000**; PID/start time/command/cwd повторно проверены.

Для просмотра: **http://127.0.0.1:3000/login** и **http://127.0.0.1:3000/backoffice**,
обновить страницу. Тот же demo run/schema/private storage на test PostgreSQL 5433;
credentials сохранены. Обычный dev остаётся остановленным. Development PostgreSQL,
volumes и .env не трогались; db:migrate/db:seed/cleanup/смена паролей не выполнялись.

16 protected hashes совпали: .env, root/API/contracts manifests, Compose, десять
применённых migrations и private demo credentials. web manifest/lockfile изменены
только для разрешённой установки tooling. `source-inputs-final.json`: **394** выбранных
code/config inputs, SHA-256 **`61f214f7b51012b9379f889beea1a83f573067ae603750508ab171e7e14d2f4d`**.
`processes-and-preservation-final.json` содержит точный delta относительно предыдущего
dashboard run и подтверждает unchanged HEAD/staging/protected hashes/проверенный код.
Staging/commit/push/deploy не выполнялись.

## 2026-10-27 / Обновление backoffice dashboard

По запросу пользователя обновлено представление существующего dashboard, без новых
бизнес-функций или этапов. Run **`dashboard-20261027t134716z`**. Сначала проверены Git
status/diff/staging/untracked и совпадение прежних code inputs с историческим M8 gate;
сохранены копии затронутых файлов в игнорируемом `before/`, без полного нового snapshot.
Существующие изменения M1–M8 сохранены; HEAD/staging не изменялись.

### Изменения

- Новый адаптивный макет: четыре KPI, горизонтальная диаграмма восьми стадий заказов,
  круговая диаграмма записанных платежей, отдельные приоритеты issues/return orders/Inbox.
  Карточки ведут в существующие списки, progress filters и календарь.
- Только реальные агрегаты прежнего `/dashboard`, явно за всё время. Сумма восьми
  buckets — число заказов; issues — число проблем, return count — число заказов с
  OPEN/PLANNED requests. Временные ряды/тренды не выдумывались. Деньги остаются cents,
  пропорции используют BigInt, нулевые значения не создают NaN/Infinity/ложные проценты.
- Фоновое обновление сохраняет панели; loading/empty/error/Retry поддерживаются.
  При 401/403 финансовые данные убираются существующим hook. CSS/SVG без новых библиотек,
  видимые focus states и текстовые подписи, layout для узких экранов.
- Файлы: `apps/web/components/order-dashboard.tsx`, новый `dashboard.css`, новый
  `order-dashboard.test.tsx`. В `orders.test.tsx` три проверки прежних чисел теперь
  выбирают соответствующую Inbox-ссылку, поскольку числа повторяются в новых панелях.
  Уточнён текст Inbox: отменённый прошлый визит не означает отсутствия истории.
  Обновлены DECISIONS и эта запись; backend/contracts/auth/business logic не менялись.

### Новые фактические проверки

Закреплённые **Node 24.22.1 / pnpm 10.34.8**. Полные stdout/stderr и metadata с командой,
временем и exit code процесса: **`.tmp/m8/dashboard-20261027t134716z/`**.

| Команда | Результат / журнал |
| --- | --- |
| `pnpm lint` | **PASS, exit 0**, `09-final-lint.log` |
| `pnpm format:check` | **PASS, exit 0**, `11-final-format-check.log` |
| `pnpm typecheck` | **PASS, exit 0**, три пакета, `12-final-typecheck.log` |
| `pnpm --filter @furniture-delivery/web test` | **PASS, exit 0**, **309** tests / **42** files, `10-final-web-tests.log` |
| `pnpm build` | **PASS, exit 0**, contracts + Nest + Next production build, `13-final-build.log` |
| `git diff --check` | **PASS, exit 0**, `15-diff-check.log`; после записи отчёта — `16-final-diff-check.log` |

Добавлены **9** component tests: buckets/filters, точные денежные суммы включая safe
integer boundary, нулевые данные, loading/failure/Retry, сохранение панелей при фоне и
503, очистка финансов при 401/403. Первичный targeted run dashboard+orders: **26 PASS**,
`06-dashboard-tests.log`; после последней текстовой правки заново выполнены полный web
suite и итоговые checks/build из таблицы. Более ранние успешные запуски этого run не
подменяют итоговые. API/integration/proxy suite не перезапускался: сервер/контракты/
DB не менялись; прежние M8 результаты остаются историческими, не новым PASS.

**Browser QA 390/1280 px: BLOCKED** — действующий сохранённый отказ доступа browser tool.
Новая попытка/обход, screenshot или приёмка A–F не выполнялись. Адаптивный CSS и component
тесты не доказывают отсутствие горизонтального скролла в настоящем браузере. Пользователю
осталось посмотреть dashboard на обеих ширинах, переходы по диаграмме и обновление данных.
M5–M8 USER ACCEPTANCE остаётся PENDING; физические телефон/камера/canvas NOT VERIFIED.

### Процессы и сохранность

Первый `pnpm demo:stop --run accept1-20261027t075310` завершился **exit 1**:
«The PID no longer identifies this exact demo supervisor; no process was signalled.»
Supervisor предыдущего запуска отсутствовал; его два сервера оказались orphan-процессами.
После проверки PID + UTC start time + полного command + cwd по private state и PPID=1
остановлены только собственные API 64030/Next 64031, SIGTERM без широкого kill. Разовый
helper вне repo, `04-owned-orphan-stop.log`, **exit 0**; owned state помечен STOPPED,
сгенерированный next-env восстановлен только при совпадении сохранённого hash. Исходники
demo lifecycle не менялись; БД/credentials при этой операции не затрагивались.

`pnpm demo:start --run accept1-20261027t075310` пересобрал собственный isolated Next dist
и сообщил startup ready. **RUNNING**, а не завершённый PASS/exit 0: `14-demo-start.log`.
Оставлены supervisor **77912**, API **77977 / 3001**, Next **77978 / 3000**; принадлежность
повторно проверена. Тот же demo schema на test 5433, тот же private storage и аккаунты.
Для просмотра: **http://127.0.0.1:3000/backoffice**, обновить страницу
и войти backoffice-пользователем. Обычный dev остаётся остановленным; Compose postgres
5432 и postgres-test 5433 running/healthy, их процессы/volumes не перезапускались.

18 protected hashes совпали: .env, manifests, lockfile, Compose, все десять миграций
и private demo credentials. Миграции/seed не запускались; development-данные не менялись.
393 выбранных code/config inputs зафиксированы в `source-inputs-final.json`, canonical
SHA-256 `fdf37e4bda69ba5560cb7219ce7b778401f3773cda060547816a51820544eba0`.
В прежних 392 M8 inputs изменились только dashboard и его старые component selectors;
добавлены CSS и новый component test. Это отдельная выборка, её count не сравнивает
полные snapshots. `processes-and-preservation-final.json` подтверждает совпадение
проверенного кода после запуска демо, protected hashes, HEAD/staging. Секреты не включены
в журналы/отчёт. Staging/commit/push/deploy и новые бизнес-этапы не выполнялись.

## 2026-10-27 / Учётные данные текущего демо

По прямому запросу пользователя изменены логины и пароли **42** существующих аккаунтов
только demo run `accept1-20261027t075310`. ADMIN теперь `admin`, DISPATCHER `dispatcher`,
сотрудники `crewmember01`–`crewmember40`; сотрудникам задан общий тестовый пароль
по запросу пользователя. Пароли дополнены последовательными цифрами до действующего
минимума 12 символов. Значения хранятся только в private `credentials.local.json`,
в документацию/команды/журнал не включены; правила auth/валидации не ослаблялись.

Применена разовая локальная maintenance-операция через существующую DataSource factory:
проверены owner/target/schema/storage guards (test 5433), общий demo advisory lock и
User locks по UUID. У всех 42 хешей отдельная свежая соль. Учётные данные обновлены
в транзакции; private-файл атомарно заменён с правами 0600. **PASS, exit 0:** 42 сохранённых
хеша проверены штатным verifyPassword. UUID/роли/active/displayName и членства сохранены;
counts/digests остальных **31** таблицы совпали, changedDomainTables=[]. Активных сессий
при операции было **0**; для их отзыва выполнен штатный по смыслу UPDATE revoked_at
только для ещё не отозванных сессий этих аккаунтов. Старые revoked timestamps не менялись.

Секретов нет в результате `.tmp/final-acceptance/accept1-20261027t075310/accounts-update-20261027T132602Z.json`. Private credentials:
`.demo-runs/accept1-20261027t075310/credentials.local.json`. Development/пароли development,
проектный код, зависимости, миграции, .env и browser permissions не изменялись.
Полный test/build и браузерный login не запускались: проверены сохранённые credentials,
а не UI-путь. Исторический M8 gate и PENDING пользовательской приёмки сохранены;
запрет браузера не обходился, demo-процессы не перезапускались.

## 2026-10-27 / Финальная приёмка — первый проход BLOCKED

Пользователь разрешил только первый UI-проход обычного заказа с двумя командами,
фото, настоящими canvas-подтверждениями, явным Complete и обновлением между сеансами.
Новых функций/этапов нет. **USER ACCEPTANCE M5–M8 остаётся PENDING**.

Run **`accept1-20261027t075310`**, Rome baseDate **2026-10-27**. Прочитаны AGENTS,
DOMAIN_RULES, актуальные PROGRESS/DECISIONS, DEMO_RUNBOOK и FINAL_ACCEPTANCE; спецификация
и milestones сохранены как контекст. Git status/staged/unstaged/untracked проверены.
Все 392 code/config inputs совпали с M8 `source-inputs-post-reports.json`, canonical
SHA-256 `45194704889d24ef98fbf18787e2e2c4dc5dfef22575076ada774a0a6c499a49`. HEAD `3dd16a1`/staging сохранены.
474 unit/component, 210 integration, 2 proxy/build PASS — **исторический** M8 run
`20261026T192023Z`, не новый запуск. Полный gate и новые snapshots не создавались.

### Подготовка демо — выполнено

Текущие PID/cwd/start-time/process group проверены повторно, прежние отчётные PID
не использовались без проверки. Только project dev-группа 56354 с Next 56459/API 56453
штатно остановлена SIGINT; порты 3000/3001 освободились. Development PostgreSQL 5432
и postgres-test 5433 остались healthy; volumes не останавливались/не удалялись.

- `pnpm demo:prepare --run accept1-20261027t075310` — **PASS, exit 0**; новый run, не повтор старого.
- `pnpm demo:start --run accept1-20261027t075310` — **RUNNING**, CLI startup ready;
  final exit code отсутствует, пока процесс работает. Не обозначается как завершившаяся команда.
- 40 вымышленных orders / 10 crews / 40 employees + ADMIN/DISPATCHER. Своя schema
  `fd_demo_accept1_20261027t075310_7651fe56`, local postgres-test 5433 / отдельная `_test` БД, свой private storage
  `.demo-runs/accept1-20261027t075310/storage`. Origin/CSRF/auth/file limits не ослаблялись.
- Next PID **64031 / 3000**, demo API PID **64030 / 3001**, cwd этого проекта;
  compiled `.next-demo/accept1-20261027t075310` proxy указывает own API 3001. CLI runConfig/owner guards
  привязали API к этой demo schema/storage, без development fallback.
- Корневой .env, четыре manifests, lockfile, Compose и десять migrations совпали с
  preflight hashes. Development seed/migrations/пароли/аккаунты/файлы не менялись.
  Root db:migrate/db:seed не запускались. Нужные contracts/isolated Next builds внутри
  существующего demo CLI не выдаются за повтор полного программного gate.

### Браузер — BLOCKED; A–F — NOT RUN

Прежнее указание не открывать браузер заменено разрешённой попыткой приёмки, но saved
origin denial не считался снятым. Поиск ранее показанной вкладки вернул `Tab not found
in browser 2` без доступа к странице. Затем выполнена одна штатная попытка открыть
`http://127.0.0.1:3000/login`; инструмент отказал:

> Browser Use rejected this action due to browser security policy. Reason: A saved user permission setting blocks this action.
> The origin approval gate did not grant access for http://127.0.0.1:3000. A saved permission or managed policy denies access.

После отказа browser/API бизнес-шаги не выполнялись, другие origin/порт/браузер/HTTP/CLI
для обхода не использовались. Нет повторяющейся диагностики или нового recovery-отчёта.

| Пункт | Фактический статус |
| --- | --- |
| A — новый заказ qty2, €1000/€300, две команды/Rome Today/confirmation | **NOT RUN** |
| B — команда A Depart/Arrive/Start, checklist, totals1/1, фото, own finish | **NOT RUN** |
| C — команда B/остаток, totals2/2 после reload, неизменный FinishReport A | **NOT RUN** |
| D — общий документ и customer/staff A/staff B через настоящий canvas | **NOT RUN** |
| E — reload/signatures/readiness/явный Complete, независимый долг €700 | **NOT RUN** |
| F — независимые сеансы, карточка DP без reload, наблюдение Live/fallback | **NOT RUN** |
| 390/1280 px | **NOT RUN** |
| Физическая камера/touch/canvas | **NOT VERIFIED** |

Скриншотов нет: страница не была доступна инструменту. Новые бизнес-IDs этого прохода
отсутствуют; готовые demo orders/signatures не подставлялись вместо UI-пути. Подготовка
40 cases не означает PASS M7-1/M8-1/UI-1 или всей матрицы. Issues/returns/reopen,
failures/privacy/reconnect, реальные устройства и backup/restore остаются открытыми.

Результаты вне cleanup run: **`.tmp/final-acceptance/accept1-20261027t075310/`** — `results.json`, `browser-access.json`
с полным точным отказом, `preflight.json`, `isolation-and-startup.json`, process/Git
observations. Command stdout/stderr и metadata: **`.tmp/m8/accept1-20261027t075310/`**. Пароли/cookies/tokens/
PNG/base64 не включены. Private credentials только **`.demo-runs/accept1-20261027t075310/credentials.local.json`**, права 0600.

По прямому указанию пользователя demo **оставлено RUNNING** на
**http://127.0.0.1:3000/login**; cleanup не выполнялся. Обычный dev сейчас остановлен,
порты заняты только этим демо; PostgreSQL продолжает работать. Для возврата:

```bash
pnpm demo:stop --run accept1-20261027t075310
pnpm dev
```

FINAL_ACCEPTANCE обновлён фактическим блокером/NOT RUN и связью с проверенным кодом.
Staging/commit/push/deploy не выполнялись. После отчёта первого прохода работа остановлена.

## 2026-10-26 / M8 — разрешение, сохранность и начало

Разрешён только M8 по prompt08. Результаты M7 run `20261026T144556Z`
(416 unit/component, 190 integration, build PASS) остаются историческими. M5/M6/M7
не ACCEPTED; B/C, интерфейсы, физические телефон/камера/canvas и общая приёмка
DEFERRED BY USER. Браузер/его origin не открывается и не обходится.

Run M8: `20261026T192023Z`. Git status/diff и пустой staging проверены. Все 356
проверенных M7 code/config/lock inputs совпали. Актуальный delta сохранён вне repo в
`/Users/komilolimov/Desktop/furniture-delivery-checkpoints/m8-preflight-delta-20261026T192023Z`:
97 изменённых/новых файлов из 376 source/config/docs inputs со ссылкой на прежнюю
цепочку checkpoint и SHA-256. Env, credentials, storage, БД, сборки и зависимости
не копировались, symlinks не обходились. HEAD `3dd16a1`/staging сохранены.

Принадлежность Next/Nest и всей dev-группы `39750` проверена по PID/cwd; она штатно
остановлена до правок. PostgreSQL development/test не останавливались. Лог `01` сохранил
counts/digests всех 32 текущих development-таблиц, exit 0. `.env`, lockfile, Compose,
M5_RECOVERY и десять migrations защищены hashes; dependency pins сохранены отдельно.
Новый этап не требует таблицы уведомлений или нового DataSource.

Порядок: post-commit/authenticated SSE → frontend/coalesced reads/drafts → изолированное
demo/workflows/clean-run и итоговый gate. На момент preflight новые результаты M8 были PENDING; итоговые результаты приведены ниже.

## 2026-10-26 / M8 — реализация

1. В прежнем Nest/DataSource добавлены явные transactional hints и subscriber внешнего
   commit. Вложенный savepoint/rollback не публикует несохранённое; доставка best effort
   не участвует в результате mutation. Авторизованный SSE отправляет только короткие
   topics, проверяет текущие права/сессии/назначения и ограничивает connections/очереди/
   packets/backpressure. На disconnect/setup abort/shutdown освобождаются ресурсы.
   Финансовые/private hints не адресуются crew; accounts остаётся ADMIN-only.
2. Прежние hooks подключены к одному coordinator в SessionProvider: canonical refetch,
   coalesce, один flight/pending на key, backoff/reconnect/auth-first resume, control sync,
   Live/Reconnecting/Periodic refresh/Unavailable и честное время data read. Фоновое
   чтение не перебазирует revisions/keys/frozen payloads и не стирает формы/canvas/Blob;
   verified scope loss очищает private UI и отклоняет late responses. В формах есть notice
   о новой серверной редакции; Today/риски восстанавливаются без mutation.
3. Добавлен отдельный demo CLI: 40 заказов на восьми стадиях, 10 команд, 40 сотрудников
   и два BO-аккаунта. Статусы получены существующими domain operations/readiness, материалы
   и подписи синтетические. Свои test schema/storage/owner markers, private credentials
   0600, стабильные IDs/Rome baseDate, nondestructive repeat и явный lifecycle/cleanup.
   Три HTTP workflow, production proxy streaming и реальная серия HTTP/SSE/coordinator
   дополняют component/PG regressions. Это не два настоящих браузера.

Новых миграций, таблицы уведомлений, зависимостей или второго независимого DataSource
нет. Десять прежних migrations и обычный db:seed сохранены. Исправлен выявленный fresh
runtime defect: root dev/test/integration и demo/proxy/load предварительно собирают
contracts, чтобы runtime main/dist не расходился с src types. Точечно сохранены исходные
cause в трёх cleanup/ownership error paths; timeout/assertions не ослаблены.

Дополнительное ревью нашло лишний DP `crews` hint при изменении BO-аккаунта без команды
и пропущенный hint для исторического roster. Две новые PG/HTTP regressions сначала
воспроизвели оба дефекта (`58`: 2 FAIL / 12 skipped, exit 1), затем узкий UsersService
filter исправлен. `59`: полный realtime файл — 14 PASS, exit 0. Правки ролей/членства
по-прежнему сериализуются существующим User lock, session revocation не менялся.

README/DECISIONS обновлены; `DEMO_RUNBOOK.md` и `FINAL_ACCEPTANCE.md` добавлены.
Последний сохраняет M5 B/C, M6/M7 и добавляет M8, 390/1280, Rome/Tokyo, физические
камеру/touch/canvas и backup/restore. На этом месте окончательный gate ещё выполнялся;
его фактические результаты фиксируются отдельной записью ниже.

## 2026-10-26 / M8 — окончательный программный gate

Run `20261026T192023Z`, Node **24.22.1**, pnpm **10.34.8**. Команды выполнены
последовательно; каждая имеет полный редактируемый от секретов stdout/stderr и JSON
с command/cwd/start/end/PID/exitCode/duration/log SHA-256 в `.tmp/m8/20261026T192023Z/`.
Проверяется exit code самой команды, без tee. Ниже новый прогон после последней
правки UsersService и двух regressions, а не исторический M7 или промежуточный M8.

| Команда | Фактический результат | Exit | Лог |
| --- | --- | --- | --- |
| `pnpm lint` | PASS | 0 | `60-final-lint.log` |
| `pnpm format:check` | PASS | 0 | `61-final-format.log` |
| `pnpm typecheck` | PASS: contracts/API/web | 0 | `62-final-typecheck.log` |
| `pnpm test` | **474 PASS: API 174 + web 300**, 58 files | 0 | `63-final-unit.log` |
| `pnpm test:integration` | **210 PASS**, 22 files | 0 | `64-final-integration.log` |
| `pnpm build` | PASS: contracts/Nest/production Next | 0 | `65-final-build.log` |
| `git diff --check` | PASS | 0 | `66-final-diff.log` |

Format использует прежнее исключение docs; отчёты проверяются прочтением и diff check.
Перед этим gate зафиксированы 392 code/config/tests/lock inputs, manifest
`source-inputs-final-ready.json`, canonical SHA-256
`45194704889d24ef98fbf18787e2e2c4dc5dfef22575076ada774a0a6c499a49`.
Специализированные повторы proxy/load/clean-run и завершающая сверка сохранности
на момент этой записи ещё выполнялись; их итог фиксируется следующей записью.

### Миграции, seed и regression scope

Новых M8 migrations нет. Полный integration проверил fresh **10**, repeat **0**;
два обычных полных seed сохраняют пользовательские изменения/роли/пароли,
M5 execution/evidence, M6 return coverage и M7 snapshots/PNG/exception/completion/
reopen history. Прежние M1–M7 конкурентные/idempotency/financial regressions входят
в полный набор. Target — Compose postgres-test, обязательные TEST_DATABASE_*, отдельная
`_test` БД, случайные own schemas и private storage без development fallback.
Ни root db:migrate, ни root db:seed против development в M8 не запускались.

M8 добавил 24 API unit + 5 demo unit, 27 frontend realtime/component + 2 banner tests;
14 HTTP/SSE PG cases, 3 domain workflows и 3 demo ownership cases. Stream cases проверяют
commit/savepoints/rollback/audit failure, failure после commit, fresh rights/logout/expiry/
role/membership/assignment, приватность и очистку ресурсов. Workflow проходит три истории
из prompt08 на реальном PostgreSQL/storage через HTTP, без бизнес-API mocks. Это не
проверка настоящего браузера, физического ввода или разрешение пользовательской приёмки.

### Сохранённая история ошибок M8

- `04` typecheck exit 2: readonly fake QueryRunner state в тесте; исправлен test double.
- `11` integration exit 1: required reason отсутствовал в PATCH fixture; assertion 200
  сохранён, test payload исправлен. Последующие проверки этого сценария PASS.
- `22` web typecheck exit 2: test ByRole option/mock generic types; исправлены тестовые типы.
- `25` web unit exit 1: **287 PASS / 11 FAIL**, 111 runtime errors из-за старого contracts
  dist. Исправлен реальный fresh dev/test prerequisite (contracts build), плюс один
  password accessible-label тест. Assertions/allowlist не ослаблены.
- `50` lint exit 1: 7 cause/unused-expression/unused-parameter ошибок; точечно исправлены.
- `51–57` дали 474/208/build PASS, затем ревью выявило два узких дефекта адресации;
  этот gate не выдаётся за проверку следующей правки.
- `58` intentional regression RED: **2 FAIL / 12 skipped**, exit 1; `59` full realtime
  **14 PASS**, exit 0. Окончательный общий gate после исправления — таблица выше.

Неуспешные журналы сохранены. В M8 не увеличивались DB/Vitest timeouts и не отключались
assertions/tests. Исторический M7 dashboard timeout остаётся с причиной **UNKNOWN**;
успешные M8 прогоны не устанавливают его первоначальный триггер.

## 2026-10-26 / M8 — proxy, load, чистый запуск и завершение

**M8 IMPLEMENTATION: COMPLETE. CODE CHECKS: VERIFIED. DEMO PREPARATION: VERIFIED.**
**UI VERIFICATION: DEFERRED BY USER. PHYSICAL PHONE/CAMERA/CANVAS: NOT VERIFIED.**
**USER ACCEPTANCE M5/M6/M7/M8: PENDING.** Это не ACCEPTED и не проверка двух браузеров.

| Команда / проверка | Фактический результат | Exit | Лог / результат |
| --- | --- | --- | --- |
| `pnpm test:proxy` | **2 PASS**, настоящий production Next → isolated test API; ready/invalidate до close, cookie/Origin/logout | 0 | `67-final-proxy.log`; `.tmp/m8-proxy/proxy_ae8dd4608bc047b78e0798c6423071d9/` |
| `pnpm test:load --run m8-load-final-20261026t192023z` | PASS: real HTTP/SSE → настоящий coordinator → canonical GET, 40 orders / 20 mutations | 0 | `68-final-load.log` |
| clean `pnpm install --frozen-lockfile --store-dir <existing-local-store>` | PASS, новые node_modules, pins/lock неизменны; package store повторно использован | 0 | `72-clean-frozen-install.log` |
| clean `pnpm build` | PASS, без прежних .next/dist/node_modules перед install | 0 | `73-clean-cold-build.log` |
| clean `pnpm demo:verify --run m8-cold-20261026t192023z` | PASS: fresh migrations, 40 orders / 10 crews / 40 employees + 2 BO, repeat сохраняет manual edit и все domain/file digests | 0 | `74-clean-demo-cold-verify.log` |
| clean `pnpm demo:start --run m8-cold-20261026t192023z` | PASS штатного CLI startup/readiness, затем штатный stop; не browser QA | 0 после stop | `75-clean-demo-start.log`, `clean-start-observed.json` |
| clean `pnpm demo:stop ...` / `pnpm demo:cleanup ...` | PASS; только own schema/storage/credentials/processes/build | 0 / 0 | `76-clean-demo-stop.log`, `77-clean-demo-cleanup.log` |
| readonly development comparison | 32 прежние таблицы: counts/digests совпали, **changedTables=[]** | 0 | `78-development-preservation.log` |
| `docker compose config --quiet` | PASS, раскрытый config/секреты не выводились | 0 | `79-compose-config.log` |

Load measurement: после initial settlement — **dashboard 1 / orders 2 / evidence 2**
reads на 20 последовательных mutations; session read 1. Dashboard automatic start
intervals 5001/5000 ms. Три dashboard HTTP durations (initial + measurement):
187/138/120 ms; measurement 7130 ms; SSE ready 1, invalidate 5, access reset/failures 0.
Canonical version и notes выросли ровно на 20; financial sums/completedCount не изменились.
Owned load fixture очищен. Это наблюдение одного synthetic run, не production SLA и
не объяснение старого timeout. Control/heartbeat не создавали dashboard запрос на строку.

### Проверочная копия и актуальность

Чистая копия текущих tracked **и untracked** source/config/docs (413 файлов) создана в
`/Users/komilolimov/Desktop/furniture-delivery-checkpoints/m8-clean-run-20261026T192023Z/source`.
Она не является clone старого HEAD, новым исходным baseline M5 или заменой checkpoint.
Реальные env/credentials/storage/.git/builds/caches/dependencies не копировались,
symlinks не обходились. Первые 42–45 install/build/verify/cleanup сохранены исторически.
После lint/privacy fix синхронизированы точные source deltas; 69–71 проверены отдельно.
Перед финальными 72–74 удалены **только собственные generated dependencies/builds**
этой проверочной копии, предварительный synthetic run очищен; `.env` и private runs
отсутствовали. Это зафиксировано в `clean-final-reset.json`.

Код копии совпал со всеми 392 final-ready inputs. Test credentials переданы лишь
окружением дочернего процесса из обязательных TEST_DATABASE_*; env-файл не создавался,
пароли в argv/stdout/документы не попали. Применяются прежние target/ownership guards.
Сохранены `source-manifest-clean-tested.json`, исходные manifests и checkpoint chain.
Start использовал собственные Next 55995 / API 55994, cwd проверочной копии и отдельный
`.next-demo/m8-cold-20261026t192023z`; compiled proxy указывает его test API 3001.
Эти PID уже остановлены. Отредактированный child log сохранён как
`clean-demo-application.log` до cleanup private run-log. API health/login CLI readiness
не выдаются за UI, camera, canvas или ручную пользовательскую историю.

Final-ready и final-after-checks manifests идентичны: 392 inputs, SHA-256
`45194704889d24ef98fbf18787e2e2c4dc5dfef22575076ada774a0a6c499a49`.
После gate менялись только отчёты. `final-integrity.json` подтверждает 14 protected
files без изменений (.env, lock, Compose, RECOVERY, десять migrations), прежние pins/
packageManager/engines всех четырёх manifests, HEAD `3dd16a1` и пустой staging.
M3–M7 dirty/untracked исходники сохранены, old inputs не исчезли. Секреты в сохранённых
M8 logs не обнаружены. Development comparison выполнен до возврата dev; seed/migrations,
private файлы development и volumes не изменялись. Backup/restore **NOT VERIFIED**.

### Процессы и оставшаяся приёмка

Восстановлен обычный **`pnpm dev`** (`80-development-start.log`, статус RUNNING,
exit code не выдумывается для работающего процесса). Next **PID 56459 / 3000**, API
**PID 56453 / 3001**, cwd исходного проекта. Read-only PID/cwd/startup-log observation
записан в `dev-restored.json`; первое предположение наблюдателя о Nest default logger
уточнено по существующему startup message, без ошибки приложения или правок исходников.
PostgreSQL development **5432** и postgres-test **5433** healthy, volumes сохранены.
M8 test/proxy/load/demo приложения закрыты, собственные temporary schemas/storage
очищены; `.demo-runs` оригинала и проверочной копии пусты. Чужие fixtures не очищались.

Актуальных FAIL/BLOCKED в обязательных программных проверках M8 нет. Браузер не открывался,
разрешения повторно не запрашивались, запрет origin не обходился. Финальная UI очередь
в `FINAL_ACCEPTANCE.md`: M5 B/C и повтор после поздних изменений, M6 estimate/return,
M7 настоящие подписи/absence/Complete/Reopen/privacy, M8 два сеанса/reconnect/drafts,
390/1280, Rome/Tokyo/DST, physical camera/touch/rotation/canvas, три demo narratives.
Исторический A не считается новым browser PASS. Backup restore и юридическая оценка
подписи не подтверждены. Runbook даёт команды prepare/start/stop/cleanup и путь к
private credentials, не раскрывая пароли. После M8 — общая приёмка и её исправления.
Staging/commit/push/deploy и новые функциональные этапы не выполнялись.

## 2026-10-26 / M7 — разрешение и контрольная точка

Пользователь разрешил только M7. M5/M6 не ACCEPTED: B/C, UI M6, физический телефон,
камера и общая пользовательская приёмка остаются отложенными до конца разработки.
Браузер в M7 не открывается, прежний запрет не обходится. M8 не начат.

Run M7: `20261026T144556Z`. Git status/diff и staged diff проверены. 308 inputs
совпали с проверенным M6 manifest run `20261026T102822Z`; это исторический gate,
не результаты M7. До правок сохранён актуальный delta к checkpoint M5:
`/Users/komilolimov/Desktop/furniture-delivery-checkpoints/m7-preflight-delta-20261026T144556Z`.
В нём 86 изменённых/новых файлов из 327 source/config/docs inputs, SHA-256 и ссылка
на исходный checkpoint. Реальные env/credentials/storage/БД/node_modules/сборки/кеши
не копировались; .env.example проверен на placeholders. Symlinks не обходились.
HEAD/staging не изменялись, reset/restore/clean/stash/commit/push/deploy не выполнялись.

Node 24.22.1 / pnpm 10.34.8 доступны на прежнем runtime. Проверены принадлежность
Next/Nest проекту и их process group; временно штатно остановлена dev-группа 26809.
PostgreSQL development 5432 и test 5433 healthy и не останавливались. Команда `01`
сохранила контрольные counts/digests 26 development-таблиц (старые колонки), exit 0.
Файлы .env, manifests, lockfile, Compose, RECOVERY и восемь migrations защищены
контрольными hashes в `.tmp/m7/20261026T144556Z/`. Development seed не запускался.

Порядок M7: сначала immutable snapshot/signature/absence/review, затем единая readiness
и complete/reopen с PG-конкуренцией, затем UI/component tests и полный программный gate.
На момент preflight проверки M7 были PENDING; их окончательные результаты приведены ниже. Старые 357/151/build не выдаются за проверку нового кода.

## 2026-10-26 / M7 — реализация и окончательные программные проверки

Реализованы immutable результаты визитов, customer/own-crew подписи и отсутствие
подписи с отдельным review. Подписи относятся к snapshot ID/hash/version, не меняют
физическую работу/количества/issues/return needs. Общий документ доступен после
терминального результата всех команд. Частичный/blocked результат тоже можно
подтвердить; повторный визит требует своего документа. Старые отчёты/количества
не суммируются и не переписываются. Invalidate явно сохраняет историю и требует
новой редакции с новыми подтверждениями.

Добавлены `CreateAcceptance1792886406000` и `CreateCompletion1792886406100`
через прежний DataSource: snapshots/slots/confirmations/exception reviews,
completion records/reopen events и nullable `Order.currentCompletionId`.
Ни одна из восьми прежних миграций не переписана. Dependencies/lockfile не менялись.
PNG bytea ограничен/декодируется/re-encodes без metadata, запись/audit/receipt атомарны;
image GET проверяет текущие права каждый раз. DTO не содержат PNG/финансы/private поля
для crew. Это решение тестового MVP, без проверки личности/юридических обещаний.

Readiness использует прежнее M6 resolved coverage и показывает physical/confirmation
условия отдельно для каждого реального визита. Complete — явное решение диспетчера
под Order lock, с fresh rights/version/readiness; долг остаётся независимым. Reopen
снимает только active marker, сохраняет факты/подписи/историю. Новый/reopened issue и
invalidation после close атомарно reopen; новое планирование требует явного reopen.
Старые successful Retry не восстанавливают старый marker/document. Согласованы
list/detail/dashboard/calendar/crew summaries без финансовых JOIN с новыми таблицами.

UI расширяет существующие страницы: preview, Canvas Pointer Events, client modal,
own crew slot, absence/review/history, blockers, явный Complete/Reopen. Draft/key/Blob
в памяти, старые version при 409 не подменяются. Logout/access loss очищает имена,
редактор/preview/Object URLs до navigation; component regression использует router spy
без unmount. Mock canvas/DOM подтверждает логику компонентов, не реальное устройство.

**CODE CHECKS: VERIFIED.** Run `20261026T144556Z`, Node 24.22.1 / pnpm 10.34.8.
Финальные проверки выполнялись последовательно. Все команды имеют отдельные полные
stdout/stderr и JSON command/start/end/PID/exitCode/log hash в `.tmp/m7/20261026T144556Z/`.
Ниже результаты окончательных исходников, не прежнего M6 или раннего M7 gate.
`format:check` использует прежний .prettierignore (docs исключены); текст отчётов
проверен прочтением и финальным `git diff --check`, без переформатирования истории.

| Команда | Результат | Exit code | Лог |
| --- | --- | --- | --- |
| `pnpm lint` | PASS | 0 | `50-final-lint.log` |
| `pnpm format:check` | PASS | 0 | `51-final-format.log` |
| `pnpm typecheck` | PASS, contracts/API/web | 0 | `52-final-typecheck.log` |
| `pnpm test` | **416 PASS: API 145 + web 271** | 0 | `53-final-unit.log` |
| `pnpm test:integration` | **190 PASS, 19 files** | 0 | `54-final-integration.log` |
| `pnpm build` | PASS, contracts/Nest/production Next | 0 | `55-final-build.log` |
| `git diff --check` | PASS | 0 | `56-final-diff.log` |

Проверенные code/config/tests/lock inputs: 356 файлов, canonical SHA-256
`29f9f773d750c03c727f7ff785c06c41cd61b4a596de329a88253c2c68aa3c6e`; manifests `source-inputs-final-before.json` и
`source-inputs-final-after.json` совпали. Только отчёты обновлены после gate.
`.env`, четыре manifests, lockfile, Compose, M5_RECOVERY и восемь прежних migrations
совпали с 16 preflight hashes. HEAD `3dd16a1`, staging пуст; прежние M3–M6 изменения
и untracked файлы сохранены. Исторический M5_RECOVERY не изменялся.

### Миграции, seed и сохранность

В полном integration suite проверены fresh 10 migrations, repeat 0, upgrade реальных
M6 rows на две M7 migrations с digest всех прежних колонок, два обычных полных seed.
Seed сохраняет пользовательские правки/роли/пароли, execution/evidence/return coverage,
immutable документы/PNG bytes/approved absence, invalidation и complete/reopen/reclose
историю. Синтетические подписи — только test fixtures. Эти случаи находятся в
`completion-migration.integration.test.ts`, прежние migration/seed regressions тоже PASS.

Test использует существующий Compose postgres-test 5433, обязательные TEST_DATABASE_*,
отдельную `_test` БД без development fallback, случайные схемы/private test storage.
Cleanup только своих fixture ресурсов существующими helpers. После suite M7 schema
остатков 0. Development seed не запускался, чужие fixtures/volumes не очищались.

После test-успеха и отдельной проверки target разрешённо применены dev migrations:
`58-development-migrate` — 2, `59-development-migrate-repeat` — 0, exit 0.
Сравнение `60-development-preservation` — все 26 старых таблиц/старых колонок/rows
совпали по count/digest, changedTables=[]; exit 0. Данные/пароли/файлы/volumes сохранены.

### Найденные ошибки и история запусков

- `06`/`16`: typecheck FAIL из-за duplicate local hook variable и generic inference
  prepare UI; точечно исправлены, окончательный typecheck PASS. `20`/`21` lint и `23`
  format FAIL сохранены; const/format исправлены без изменения assertions.
- `09` — 33 PASS / 2 FAIL, затем `11` — 17 PASS / 1 FAIL. Исправлена ошибочная test
  table reference; genuine seed fixture усилен. Диагностический `12` доказал реальный
  defect: двойной save Order при reopen терял hidden nullable seedKey. Helper теперь
  меняет marker в памяти; caller сохраняет Order один раз вместе с revision в той же
  транзакции. `13` — 18 PASS; финальный полный gate включает row/PNG/history/seed-key
  regression. FAIL не удалены и не выданы за успешные запуски.
- После первого полного `33/34/35` (415 unit / 187 integration / build PASS) добавлены
  logout regression и прямые PG races RETURN PLAN/complete, manual reopen/new complete,
  old complete replay/reopen в обоих наблюдаемых порядках; approval как последний blocker
  и смена роли после ожидания. `37` — 15 UI PASS, `38` — 19 completion integration PASS.
- `44` — **189 PASS / 1 FAIL из 190**: DB `Query read timeout` в dashboard, прежние
  query/statement_timeout=2000 ms. Без изменения timeouts выполнен один diagnostic `48`:
  planning 19 PASS; safe EXPLAIN и durations сохранены в `dashboard-diagnostic-*.json`.
  В повторе 70 185 chars/8 recursive occurrences, 77/83 ms, JIT отсутствует в планах;
  `47` сохранил post-failure wait snapshot, не состояние исходного запроса.
  **Первоначальный триггер timeout UNKNOWN.** Успешный повтор не стирает FAIL.
  Устранено лишнее восьмое вычисление большого resolver: completedCount считает точную
  первую ветку `current_completion_id IS NOT NULL`. Regression проверяет active marker
  после complete/reopen/reclose без роста исторических records в counts/денег.
  Это не доказательство причины исходного timeout; финальный полный suite после
  локальной правки приведён выше. Assertions/caps не ослаблялись.

### Отложенная финальная пользовательская проверка

Браузер в M7 не открывался, разрешения/origin/HTTP обходы не использовались.
Программные HTTP tests выполнялись только на изолированных synthetic fixtures.
M5 B/C и пользовательская приёмка M5/M6 отложены по решению пользователя, не ACCEPTED.
Сохранить в общей финальной очереди:

1. M5 B: partial 2/1/0, фото/issue, исходный отчёт/remainingWork/return need после reload
   и resolve issue без изменения фактов, запрет переноса начавшегося визита. C — private/
   crew-visible document/file chooser/неверный формат/oversized, lost response/Retry без
   дублей, остановка только test API и восстановление, 409 двух вкладок, logout/старый file
   URL по prompt05; Today/Upcoming при timezone устройства Asia/Tokyo, реальная камера.
2. M6: estimate/risk/search/preview/explicit apply и NEEDS_CONFIRMATION; план/оценка/факт,
   conflict после поиска окна, partial follow-up/resolve, cancel/неудачная повторная попытка.
3. M7 обычный/многокомандный визит: настоящие штрихи мышью/пальцем, own staff/customer
   slots, reload, явный Complete; первая команда не подтверждает чужую.
4. Partial/issue → подписи честного partial без close → follow-up с остатком → resolve
   → отдельные подписи обоих фактических визитов → Complete с сохранением старого отчёта.
5. Refusal/absence → pending/rejected/approved exception одного slot, остальные blockers
   не обходятся; неподписанная фактическая работа сохраняется.
6. Issue после close → atomic reopen с прежними PNG/history → resolve без auto-close;
   manual reopen/reclose, invalidation/новый document и старые Retry.
7. 390/1280, настоящий Next proxy upload/content (включая 411 unknown/chunked restriction),
   mouse/touch/rotation/DPR/canvas, loading/error/409/unknown/Retry, logout/перевод и
   protected image, отсутствие финансов/private данных в crew/client presentation.

**M5 B/C + M6/M7 UI: DEFERRED BY USER.**
**PHYSICAL PHONE/CAMERA/CANVAS: NOT VERIFIED.**
**USER ACCEPTANCE M5/M6/M7: PENDING.** M8 NOT_STARTED.

### Процессы после проверки

Next PID 39819, port 3000, cwd `/Users/komilolimov/Desktop/furniture-delivery-codex-start/apps/web`; Nest PID 39818, port 3001, cwd `/Users/komilolimov/Desktop/furniture-delivery-codex-start/apps/api`.
Compose postgres 5432 и postgres-test 5433 healthy/running; оба сервиса оставлены запущенными.

Build/test процессы завершены, браузер не запускался. Обычный development восстановлен
из-за его работы перед проверкой; startup/listeners — не browser PASS. Логи startup
`64-development-restored.log`, PID/cwd/ports в `processes-after.json`. PostgreSQL/volumes
не перезапускались и не удалялись. Commit/push/deploy не выполнялись. Работа M7 завершена; M8 не начат.

## 2026-10-26 / M6 — разрешение продолжить и сохранность

Пользователь прямо разрешил M6 и перенёс оставшиеся M5 B/C, физический телефон/камеру
и пользовательскую приёмку на конец разработки. Это **не принятие M5**. Исторические
code run `20261026T073659Z` (303 unit / 102 integration / build), A
`20261026T081245Z` и заблокированный B сохранены ниже; после изменений M6 они не
объявляются проверкой нового состояния. Браузерные разрешения не запрашиваются,
браузер/его HTTP/CLI обходы не используются. Новые UI-сценарии M6 будут добавлены
в общий список финальной проверки.

Run M6: `20261026T102822Z`. Перед правками проверены Git status/diff/index и
существующий checkpoint `m5-verification-20261026T073659Z`: 269 canonical inputs
совпали с проверенным M5. Повторная полная копия не создавалась; только актуальный
PROGRESS и новый prompt06 сохранены в
`/Users/komilolimov/Desktop/furniture-delivery-checkpoints/m6-preflight-delta-20261026T102822Z`
со ссылкой на прежний checkpoint и SHA-256. HEAD `3dd16a1` и index сохранены.
Приватные контрольные hashes `.env`, manifests, lockfile, Compose и RECOVERY хранятся
в игнорируемой `.tmp/m6/20261026T102822Z/`, без значений secrets.

## 2026-10-26 / M6 — реализация и итоговый gate

Реализованы отдельная версия оценки окончания, risk board, ограниченный поиск окон,
явный preview/apply переноса и жизненный цикл повторных визитов. Визиты после старта
не переписываются. План/оценка/факт раздельны. Общая availability-проверка используется
M4 и M6; неизвестное освобождение блокирует предложения, ранний выезд уже занимает
команду, вчерашняя активная работа не исчезает с сегодняшней панели.

Новый follow-up принадлежит тому же Order, получает новые назначения/задачи и
NEEDS_CONFIRMATION. Immutable scope, sourceTaskId и returnScopeKey сохраняют остаток
без старых DONE/optional SKIPPED, без дублей количеств. OPEN/PLANNED оба означают
незакрытую потребность; отмена/неудача возвращают OPEN, успешное выполнение требует
явного resolve. Uncovered optional/PENDING остаётся для следующей попытки и явного
SKIPPED с причиной. RESOLVED-цепочка покрывает старую partial/blocked работу для
AWAITING_REVIEW, не изменяя исходные отчёты и не скрывая другие blockers.

Добавлены `CreateEstimates1792886405000` и `CreateReturnVisits1792886405100` через
прежний DataSource. Дополнительные dependencies и lockfile изменения M6 не потребовались.
Frontend: формы оценки crew/диспетчера, Risks, SlotFinder, перенос с подтверждением,
return queue/detail/явный scope/attempt history/resolve и безопасный crew context.

**CODE CHECKS: VERIFIED.** Финальный последовательный gate на закреплённых Node
24.22.1 / pnpm 10.34.8 завершён. Это новые запуски, без переноса старого M5 PASS.
Все команды ниже имеют отдельные полные stdout/stderr и JSON command/start/end/PID/
exitCode в `.tmp/m6/20261026T102822Z/`.

| Команда | Результат | Exit code | Лог |
| --- | --- | --- | --- |
| `pnpm lint` | PASS | 0 | `50-final-lint.log` |
| `pnpm format:check` | PASS | 0 | `51-final-format.log` |
| `pnpm typecheck` | PASS, contracts/API/web | 0 | `52-final-typecheck.log` |
| `pnpm test` | **357 PASS: API 130 + web 227** | 0 | `53-final-unit.log` |
| `pnpm test:integration` | **151 PASS, 16 files** | 0 | `54-final-integration.log` |
| `pnpm build` | PASS, contracts + Nest + production Next | 0 | `55-final-build.log` |
| `git diff --check` | PASS | 0 | `56-final-diff.log` |

`48` — сохранённый первый полный integration FAIL: 149 PASS / 2 FAIL в m4-defaults
из-за старого ожидаемого списка из шести миграций. Первый assert остановил seed,
второй тест получил пустую таблицу Crew. Список дополнен двумя M6 names, прежние
assertions сохранены. `49` targeted — оба PASS; окончательный `54` — **151/151 PASS**.
Первый FAIL не удалён и не переименован в PASS.

Проверены fresh 8 migrations и повтор без новых изменений, upgrade поверх реальных
M5 rows с digest старых колонок, два полных seed на test с сохранением пользовательских
ролей/правок, платежей, estimate, cancelled/current attempts, scope/tasks, execution,
metadata и bytes защищённого файла. Эти случаи входят в `return-migration.integration.test.ts`
и финальный полный набор. Нет development fallback: TEST_DATABASE_* обязательны,
отдельная test БД заканчивается `_test`, уникальные schema и private storage; cleanup
через существующие helpers только для своих ресурсов. Development seed не запускался.

308 исходных/config/lockfile inputs зафиксированы в `source-inputs-final.json`, SHA-256
`e83b25240aefebea0963307965d20e07d9e49987877e55b51c5cb865166ece38`.
После всех проверок `source-inputs-after-checks.json` и `source-consistency.json`
подтвердили отсутствие изменений проверенного кода. Только отчёты дополнены после gate.
Машиночитаемый итог команд и процессов — `verification-summary.json`.

Промежуточные FAIL сохранены: `20` lint — лишнее неиспользуемое присваивание в test helper;
`22` web typecheck — две старые fixture execution формы без nullable estimate metadata;
`23`/`24` — beforeEach возвращал mock-функцию, вызываемую Vitest как cleanup после 409;
`42` — неподдерживаемая TypeScript option exact у getByRole в новом regression test,
заменена точным regex имени кнопки. Assertions не ослаблены. `25` targeted UI — 28 PASS.
Повторные финальные commands относятся к исправленным исходникам. Timeout в M6 не было.
ResourceNotice Retry получил type=button и отдельную проверку: повтор поиска внутри
внешней формы не должен отправлять return plan. Остальные точечные исправления:
ранняя active занятость, потеря вчерашнего риска, перенос недостигнутых targets и
uncovered source, fresh session после ожидания lock перед receipt replay.

### Development и сохранность

После успешного test gate проверен ожидаемый development target (`57`, exit 0),
добавочно применены ровно две M6 migration (`58`, exit 0), повтор применил 0 (`59`, exit 0).
Сравнение 25 прежних таблиц по количеству строк и SHA-256 всех старых колонок до/после
показало **changedTables: []** (`60`, exit 0; `dev-preservation-before/after.json`).
Не выполнялись seed, очистка, сброс паролей, изменение бизнес-данных или storage development.
Схема расширена, прежние значения/IDs сохранены. PostgreSQL development не останавливался.

`.env`, четыре manifests, lockfile, Compose и M5_RECOVERY побайтно сохранены; шесть
прежних migrations совпали с checkpoint. HEAD `3dd16a1` неизменен, staged diff пуст как
на старте; байтовый hash служебного `.git/index` изменился после Git refresh, поэтому
он не выдаётся за идентичный. Staging-операции/commit/push/deploy не выполнялись.
Существующий checkpoint и preflight delta сохранены, полная новая копия не создавалась.

Development был запущен до проверки и восстановлен `pnpm dev` после build/migrations.
Оставлены **Next PID 26871 / 3000**, **Nest PID 26870 / 3001**; cwd каждого проверен
в этом проекте. Compose postgres **5432** и postgres-test **5433** healthy.
Родитель pnpm PID 26810 и logger продолжают писать `61-development-restored.log`;
exit code этого намеренно работающего процесса остаётся null, а не PASS 0.
Тесты, build и browser fixture завершены/не работают. Test schema/storage своих
запусков очищены teardown; чужие fixtures/volumes не трогались. Проверены только
listeners/startup, это не UI/HTTP browser PASS. Повторный diff после отчёта — `62`.

### Финальная UI-проверка, DEFERRED BY USER

- Сохранить M5 B/C: partial 2/1/0, item photo + issue, immutable report/remainingWork/
  return request после reload, независимое resolve issue, запрет обычного переноса;
  protected/PDF 20 MiB/oversized/retry случаи C и оставшийся дополнительный scrollWidth A.
- M5 физический телефон и камера: **NOT VERIFIED**; эмуляция и прежние фото не доказывают
  работу физической камеры, HEIC или системного выбора файлов телефона.
- M6 390/1280 и Day/Week/List: estimate → risk → выбор времени/команды → preview →
  явный перенос с историей и NEEDS_CONFIRMATION; поздний факт сохраняет старый план.
- M6 partial → OPEN request → новый follow-up с остаточным scope → выполнение →
  явный dispatcher resolve → AWAITING_REVIEW при остальных выполненных условиях,
  без изменения исходного отчёта/количеств и без финального Order.COMPLETED.
- Слот занят после поиска: 409, исходная бронь и draft/reason/version сохранены.
- Отмена неначатого follow-up и повторная неудача: тот же request OPEN, новый ID
  следующей попытки, полная история; первая команда не закрывает остальных.

Браузер/его разрешения в этом M6 run не использовались. **M5 и M6 USER ACCEPTANCE PENDING**.
M7/M8, подписи, realtime, оптимизатор, GPS, уведомления, commit/push/deploy не выполнялись.

## 2026-10-26 / M6 — промежуточные программные проверки

Только новые запуски run `20261026T102822Z`, логи/метаданные каждой команды в
`.tmp/m6/20261026T102822Z/`. В JSON записаны команда, UTC start/end, PID и exit code
проверяемого дочернего процесса; stdout/stderr сохраняются с маскированием secrets.
Тяжёлые проверки выполняются последовательно.

- `01`, `05`, `10`: API typecheck — exit 0.
- `02`: release/predicate unit — 16 PASS, exit 0.
- `03`: существующий Compose postgres-test healthy, exit 0; отдельная test БД,
  уникальные schema и private storage через существующие helpers, без development fallback.
- `04`: estimate/risk/search integration — 18 PASS, exit 0.
- `06`: apply integration — 8 PASS, exit 0.
- `07`: return lifecycle integration — 14 PASS, exit 0.
- `08`: M5 execution/evidence-cross/legacy migration regressions — 32 PASS, exit 0.
- `09`: return lifecycle + M6 migration/seed — 17 PASS, exit 0. Включены fresh 8
  migrations/repeat, реальный upgrade поверх шести M5 migrations с digest старых колонок,
  двойной полный seed с сохранением estimate, lifecycle, scope/tasks, файла, execution,
  ролей и платежей. Последующие точечные изменения войдут в итоговый gate отдельно.
- `11`: exit 1 — в команде ошибочно указан несуществующий `return-visits.dto.test.ts`,
  тесты не запускались (`No test files found`). Лог сохранён. `12` с фактическим
  `return-visits.test.ts`: 8 unit PASS, exit 0. Это исправление имени запуска, не тестов.

До проверки сохранены приватные digests всех прежних колонок 25 development-таблиц;
приложения штатно остановлены отдельно проверенной project-only группой. Development
PostgreSQL не останавливался, seed/очистка development не выполнялись. Общий итоговый
gate и восстановление запуска ещё PENDING на момент этой записи.

## 2026-10-26 / M5 — browser scenario B, заблокирован до старта

Run ID: **20261026T092953Z**. Прочитаны AGENTS, исходный сценарий B, связанные
domain rules и текущие PROGRESS. Git status/staging проверены; SHA-256 всех 269
канонических входных файлов совпадают с проверенным code run `20261026T073659Z`,
новых canonical source files нет. Новая полная копия, test/build gate и исправления
приложения не выполнялись. A (`20261026T081245Z`) остаётся PASS, правками не затронут.

Прежний отказ browser access не считался отменённым новым текстовым заданием или
изменением filesystem permissions. После чтения документации инструмента сделан
один новый запрос через штатный origin-gate: создать вкладку того же IAB-браузера
на том же `http://127.0.0.1:3000/login`. Gate отклонил действие: сохранённая настройка
пользователя либо managed policy не предоставляет authority для network egress к
этому origin. Новое разрешение **не получено**. Автоматическая проверка остановлена.
Другой origin/порт/браузер, HTTP/CLI, headless или скрытые browser API для обхода
не использовались. Нового наблюдения страницы или бизнес-данных B нет.

| Обязательный шаг B | Статус этого run |
| --- | --- |
| Подготовка документов, Git/hash comparison | PASS |
| Получение нового разрешения origin | BLOCKED — saved permission / managed policy |
| Изолированная test schema/storage, проверка proxy | NOT RUN |
| Создание заказа/товара/визита и подтверждение клиента | NOT RUN |
| Crew Depart/Arrive/Start | NOT RUN |
| Частичные delivered/assembled, фото именно товара | NOT RUN |
| Issue с правильными item/photo связями | NOT RUN |
| PARTIALLY_COMPLETED, причина/remainingWork/return request | NOT RUN |
| Reload: quantities/issue/photo/actuals/report/return | NOT RUN |
| Dispatcher resolve issue и независимость остальных результатов | NOT RUN |
| Обычный перенос, серверный отказ, сохранность draft/IDs/плана/задач | NOT RUN — ни UI-запрет, ни серверный отказ здесь не наблюдались |
| 390/1280 и читаемость reason/remainingWork | NOT RUN |

Фактические quantities, issue status, return request и order progress этого
сценария — **UNKNOWN / NOT RUN**, а не значения из A или из исходников. Ожидаемый
пример для ручной проверки: quantity 2, delivered 1, assembled 0; issue OPEN →
RESOLVED, неизменный immutable report, return request остаётся OPEN, Order остаётся
PARTIALLY_COMPLETED без подписи/Order.COMPLETED. Это ожидания, не результаты run.

Безопасные результаты находятся в `.tmp/m5-browser/20261026T092953Z/`:
`steps.json`, `result.json`, `permission-denied.txt`, `processes.json` и
`manual-checklist.md`. Скриншотов B нет: browser access не был предоставлен.
Ручной checklist описывает новый test fixture, корректную связь item/photo/issue,
partial finish без фиктивных DONE, resolve invariants, перенос через доступный UI
с сохранением draft и проверку 390/1280. Если UI заранее блокирует Edit/Save,
нельзя считать это проверкой серверного 409.

Fixture B не создавался; удалять schema/storage и восстанавливать процессы не
потребовалось. Development БД, аккаунты/пароли, `.env`, файлы и старые fixtures не
менялись. Процессы не запускались и не останавливались: проверены listeners Next
**3000 / PID 14286**, Nest **3001 / PID 14285**, Docker PostgreSQL **5432/5433**.
Application/DB HTTP-проверки для сценария после отказа не выполнялись. HEAD/staging,
RECOVERY, история A и code checks сохранены. M6/commit/push/deploy не выполнялись.

- **BROWSER A: PASS** — прежний run, не затронут.
- **BROWSER B: BLOCKED** — новый origin access не предоставлен.
- **BROWSER C: PENDING**.
- **PHYSICAL PHONE/CAMERA: NOT VERIFIED**.
- **USER ACCEPTANCE: PENDING**.

## 2026-10-26 / M5 — browser scenario A

Run ID: **20261026T081245Z**, только сценарий A. Перед запуском прочитаны AGENTS,
задание A, текущие PROGRESS/RECOVERY и действующие правила. SHA-256 269 проверенных
входных файлов совпали с code run `20261026T073659Z`; новых source-файлов вне
игнорируемых test helpers нет. Полный набор проверок и новая полная контрольная
копия не запускались. Прежний checkpoint сохранён. HEAD/index не изменились.
Исправлений приложения не потребовалось; code PASS 303/102/build выше остаются
результатами предыдущего отдельного gate, а не новыми запусками этого browser run.

### Изоляция и настоящий UI

Временно штатно остановлена заново проверенная dev-группа 8967. Development
PostgreSQL, `.env`, существующие аккаунты, пароли и файлы не изменялись. Использован
существующий browser-server helper с отдельным artifact root для этого run:
`.tmp/m5-fixtures/20261026T081245Z/`. Это копия игнорируемого test helper с новым
путём metadata и обычной test auth policy без повышения login limit; код приложения
и guards не менялись. Новые пользователи, 10 команд и planning defaults подготовлены
только в новой случайной schema существующей test-БД и private mkdtemp storage.
Заказ, визит, execution, checklist, quantities, фото и finish вводились через UI.
Моков API и прямой записи результатов исполнения в БД не было.

Одновременно работал один Next `start` на 3000 и test fixture Nest на 3001.
Фактический production `routes-manifest.json` содержит rewrite
`/api/:path* → http://127.0.0.1:3001/api/:path*`. Порт 3001 принадлежал только новой
fixture API; helper проверил test database/schema owner/storage marker до старта.
Вход нового fixture-only диспетчера и пустой dashboard подтверждены в браузере.
`isolation-proof.json` фиксирует это без credentials. Auth, Origin, CSRF и file limits
сохранены. Root development migrate/seed не выполнялись.

Chrome использовался пользователем, поэтому credentialed сценарий выполнен в отдельном
IAB-контексте задачи. Между диспетчером/A/B были явные logout/login. В Chrome fixture
credentials не вводились. Созданное ранее incognito-окно не использовалось для этого
пути; его закрытие после запрета дальнейшего browser access не подтверждалось.

### Наблюдаемые результаты A

Артефакты: `.tmp/m5-browser/20261026T081245Z/`. В таблице номера соответствуют
префиксам screenshot/TXT; полный список — `screenshots.json`, шаги — `steps.json`,
итог — `result.json`. Canonical screenshots имеют расширение **`.jpg`**:
браузер вернул JPEG/JFIF bytes, первоначальные имена `.png` сохранены как исходные
артефакты, рядом записаны корректно названные копии без изменения пикселей.

| Шаг | Статус | Реальное наблюдение и доказательство |
| --- | --- | --- |
| Диспетчер создаёт заказ и подтверждённый визит | PASS | ORD-1, DELIVERY_AND_ASSEMBLY, один товар quantity 2 со сборкой; сегодня 26 Oct 2026 09:00–11:00 Rome; Aurora/Birch, по 4 required + Clear area каждой команде; Client confirmed (`01`, `02`) |
| A получает только свою работу | PASS | Today показывает одно назначение Aurora. Пять собственных PENDING задач; внутренние order/appointment маркеры и финансовые поля отсутствуют в crew HTML (`03`, UI observations) |
| A: Depart → Arrive → Start | PASS | Последовательно ON_THE_WAY/ARRIVED/IN_PROGRESS; actual departed/arrived/start записаны 09:32 Rome, план остался 09:00–11:00 (`04`, `05`, `09`, BO audit) |
| A: checklist и частичные общие quantities | PASS | Пять задач DONE; явно сохранены delivered 1/2 и assembled 1/2 (`08`, `09`) |
| Фото через UI и повторное открытие | PASS | Один небольшой допустимый PNG выбран через file chooser, Upload files показал All 1 files are saved; gallery IMAGE/shared/delivery. Ссылка protected content открыта браузером, отрисован image document 640×480 (`06`, `07`) |
| Finish A не завершает B/Order | PASS | A Team's visit completed после reload; один immutable report со snapshot 1/2 + 1/2 и одним known photo. Backoffice: 1 completed, 1 not started, required 4/8, B пять PENDING, Order Partially completed (`09`, `10`) |
| B получает отдельные задачи и общие результаты | PASS | Только Birch assignment; пять PENDING/ноль DONE, totals уже 1/2 + 1/2 и фото A доступны через разрешённый scope (`11`, `12`) |
| B проходит состояния и выполняет остаток | PASS | Depart/Arrive/Start в 09:43; пять собственных DONE. Сначала delivered 2/2 при assembled 1/2: delivery/checklist не довыполнили assembly автоматически. Затем явная коррекция assembled до 2/2 (`13`, `14`) |
| Finish B и reload без удвоения | PASS | B completed, actual finish 09:44; после reload 2 delivered / 2 assembled, а не 4; frozen report B 2/2 (`14`, `15`) |
| A после завершения B | PASS | Живые totals A тоже 2/2, но frozen report A по-прежнему 1/2 + 1/2 (`16`) |
| Итог backoffice после reload | PASS | Обе команды completed, 8/8 required, Ready for review / AWAITING_REVIEW, 0 issues/return requests. Стоимость €1000, paid €0, balance €1000, Unpaid; суммы не удвоились. Нет финального Order.COMPLETED/подписей (`17`) |
| Размеры 390 / 1280 | PASS | Сохранены 390×844 и 1280×900. На crew 390 дважды clientWidth=scrollWidth=390; длинные имя/адрес и интерфейс доступны. Примерные proof paths ниже |
| Дополнительный финальный desktop scrollWidth / ещё одно открытие фото из BO | BLOCKED | После обязательных шагов origin approval http://127.0.0.1:3000 был отклонён пользователем. Новых browser/HTTP/alternate-surface обходов не было (`browser-authority-block.json`) |
| Дополнительные Tokyo/keyboard/error/Retry/draft проверки | NOT RUN | Это не выполненные здесь дополнительные пункты общей browser QA; PASS им не присваивается |
| Сценарии B/C, PDF 20 MiB | NOT RUN | Не запрашивались в этом запуске; 20 MiB/private document/oversized/lost response относятся к C |
| Физический телефон / камера | NOT VERIFIED | File chooser и 390 px не подтверждают физическую съёмку |

Примеры screenshot paths относительно run directory:

- `03-crew-a-today-390.jpg`, `09-a-finished-reloaded-390.jpg` — 390×844.
- `10-backoffice-a-only-1280.jpg`, `12-b-independent-before-start-1280.jpg` — 1280×900.
- `07-protected-photo-opened-1280.jpg` — 1280×720; прежнее имя с `390.png` не означает
  проверку открытия image document на 390 px.
- `14-b-finished-reloaded-1280.jpg`, `16-a-frozen-report-confirmed-1280.jpg`,
  `17-backoffice-both-finished-reloaded-1280.jpg` — 1280×900.
- `15-b-finished-reloaded-390.jpg` — 390×274, частичный кадр; полный mobile proof —
  предыдущие 390×844 кадры и сохранённые TXT/DOM-наблюдения.

Технические ограничения инструмента не скрыты: popup selectOption не поддержал
выбор, использован штатный native UI select; одна попытка file chooser успешно
завершилась, но provider call занял 95.473 s при заданных 3–5 s API waits. Новых
попыток выбора файла не было. Один большой batch получил tool timeout/kernel reset;
после него перечитано фактическое состояние, execution mutations не повторялись.
Дополнительный BO photo reopen не требовался для уже подтверждённого открытия фото A.
Эти ограничения не объявляются ошибками приложения и не закрывают общую browser QA.

### Завершение и оставшиеся ресурсы

После отказа origin access больше не было browser actions, включая ручной UI logout
и viewport reset. Тестовые сессии стали недействительны при cleanup только этого
fixture. Его API PID 11626 и Next PID 11673 штатно остановлены (оба runner exit 0).
`03-cleanup.log` / JSON: exit 0, проверены owner markers, удалены только новая schema,
её private storage и credentials/state текущего run. Старые `.tmp/m5` fixtures и
volumes не очищались. Сохранённые безопасные results/screenshots остаются.

Обычный `pnpm dev` восстановлен: API **3001 / PID 14285**, Next **3000 / PID 14286**;
готовность подтверждена startup logs и listening ports, без нового HTTP/browser
запроса после запрета. Лог — `04-development-restored.log`. Существующие Compose
postgres 5432 и postgres-test 5433 оставлены работающими; test/browser серверов этого
run больше нет. Исходники/конфиги/lockfile, `.env`, RECOVERY, HEAD и staging сохранены.
Из неигнорируемых файлов изменён только PROGRESS. Исправлений приложения нет, поэтому
code gate не повторялся. Commit/push/deploy и M6 не выполнялись.

- **BROWSER A: PASS** — перечисленные обязательные шаги завершены до отказа доступа.
- **BROWSER B/C: PENDING**.
- **PHYSICAL PHONE/CAMERA: NOT VERIFIED**.
- **USER ACCEPTANCE: PENDING**.

## 2026-10-26 / M5 — завершающая проверка кода

Продолжена существующая реализация по отдельному разрешению пользователя. Браузер
не открывался, сценарии A/B/C и физическая камера не проверялись. Функциональность,
зависимости, auth/CSRF, миграции и архитектура не изменялись. Воспроизводимых ошибок
в текущем gate не обнаружено; исправления исходников и новые regression tests не
потребовались. `docs/M5_RECOVERY.md` сохранён побайтно как исторический снимок.

### Новая контрольная копия и изоляция

Перед проверками создан **новый snapshot**, не baseline начала M5:
`/Users/komilolimov/Desktop/furniture-delivery-checkpoints/m5-verification-20261026T073659Z`.
Он находится вне репозитория и `/private/tmp`, содержит 283 tracked/untracked файла
исходников, тестов, конфигураций, manifests/lockfile и документов. Реальные env,
credentials, `.tmp`, uploads/storage, PostgreSQL data, node_modules, сборки и кеши
исключены; `.env.example` проверен на placeholders. Символические ссылки не обходились.
Содержимое копий сверено по SHA-256; `source-sha256.json`, `SHA256SUMS` и `snapshot.json`
находятся в корне snapshot. HEAD остался `3dd16a1`, index/staging не изменялись.

PID и cwd dev-процессов проверены заново. Только их группа 2663 штатно получила SIGINT
до работы с общим `.next`; development PostgreSQL не останавливался и не пересоздавался.
Запущен существующий `docker compose --profile test up -d --wait postgres-test`.
Runtime preflight подтвердил: Node 24.22.1 / pnpm 10.34.8; отдельные test database,
user, credentials и volume; фактическое соответствие test-конфига Compose-контейнеру;
loopback test port и отдельный случайный private test storage. Секретные значения
не выводились. Integration требует TEST_DATABASE_*, `_test` и `NODE_ENV=test`,
не имеет fallback на development; suites создают свои случайные schemas/storage
и очищают только их. Неизвестные остатки прежних fixtures не удалялись.

### Реальные запуски этого gate

Run ID: **20261026T073659Z**. Все перечисленные команды выполнялись последовательно,
без параллельных тяжёлых проверок; для workspace-команд установлена concurrency 1
(подтверждена `pnpm config get workspace-concurrency`). Полные объединённые stdout/stderr
и отдельные JSON metadata сохранены в:
`.tmp/m5-verification/20261026T073659Z/`.
Каждый JSON содержит command, start/end UTC, PID, **exit code дочернего pnpm/git/curl**,
duration и SHA-256 лога. Это не exit code tee. Credential values редактируются до
записи; проверка сохранённых логов не обнаружила раскрытых secrets или пропущенных тестов.

| Команда | Exit code | Результат текущего запуска | Лог в run directory |
| --- | --- | --- | --- |
| Runtime isolation preflight | 0 | Все фактические проверки изоляции true | `00-preflight.log` |
| `pnpm lint` | 0 | PASS | `01-lint.log` |
| `pnpm format:check` | 0 | PASS | `02-format-check.log` |
| `pnpm typecheck` | 0 | PASS, все пакеты | `03-typecheck.log` |
| `pnpm test` | 0 | **303 PASS: API 105 / 10 files + web 198 / 27 files** | `04-test.log` |
| `pnpm test:integration` | 0 | **102 PASS / 12 files**, Vitest 111.97 s, полный процесс 113.736 s | `05-test-integration.log` |
| `pnpm build` | 0 | PASS, contracts → Nest → Next production build, полный процесс 15.789 s | `06-build.log` |
| `git diff --check` | 0 | PASS | `07-git-diff-check.log` |
| `pnpm typecheck` после восстановления dev | 0 | PASS для актуальных generated typings | `09-typecheck-restored.log` |
| Read-only health через Next proxy | 0 | API up, database up | `10-restored-health.log` |
| `git diff --check` после первого оформления отчёта | 2 | FAIL — три Markdown hard breaks с trailing whitespace; исправлено только в отчёте | `11-git-diff-check-final.log` |
| Финальный повтор `git diff --check` | 0 | PASS после удаления пробелов | `12-git-diff-check-corrected.log` |

Проверки приложения прошли с первого запуска, новых timeout не было. При оформлении
этого отчёта git diff --check выявил три trailing whitespace строки (exit 2);
пробелы удалены, повтор завершился exit 0. Неуспешный лог сохранён. Незакрытых
FAIL/BLOCKED в проверках кода нет. Исторические timeout 101/102 и последующее
сообщение о 102/102 из RECOVERY не стираются и не подменяются этим запуском. Причина
старого timeout остаётся неустановленной. Новые 303 и 102 взяты из свежих полных логов,
а не из старого сообщения или файлового кеша.

### Миграции и повторный seed — PASS на test PostgreSQL

Отдельные дублирующие процедуры не запускались: необходимые assertions уже существуют
и прошли внутри полного integration suite без skip:

- `apps/api/test/foundation.integration.test.ts:77`: все шесть миграций на новой
  случайной схеме, повтор — 0; недеструктивный seed и чтение новым соединением.
- `execution-migration.integration.test.ts:132`: M5 применяется поверх реальных
  M1–M4 fixture rows, сохраняет прежние business fields/confirmation/payments/snapshots,
  добавляет исходные execution defaults; повтор миграций — 0.
- `execution-migration.integration.test.ts:181`: полный seed и два повтора сохраняют
  DONE, accumulated quantities, PARTIALLY_COMPLETED, immutable report, return request,
  credentials и историю по точным digests/canonical detail.
- `evidence-cross.integration.test.ts:328`: повтор полного seed сохраняет notes,
  issue resolution, attachments/withdrawal, report/return/receipts; проверены и строки,
  и неизменность доступных bytes файла.
- Прежние пользовательские правки, disabled users/membership/password hashes,
  M3 payments и M4 planning defaults покрыты соответствующими seed-regression suites.

Root `db:migrate`/`db:seed` против development **не запускались**. `.env` не редактировался,
development данные не очищались, старые миграции и test timeouts не менялись.

### Актуальность исходников и процессы

`verified-build-source-sha256.json` в run directory фиксирует 269 проверенных файлов
кода/тестов/config/manifests/lockfile; отчёты/prompts исключены, Next-generated
`next-env.d.ts` учитывается отдельно. SHA-256 набора:
`b86b78a2893cf366fe05fca73dcc2bd145fe5eb7d8ccb1d050578ed8ba576be2`.
Сравнение с новым snapshot не нашло изменений этих входных файлов. После build
восстановлен обычный `pnpm dev`; Next автоматически переключил generated typings
для development, поэтому общий typecheck выполнен ещё раз и прошёл. Финальные
`verified-final-source-sha256.json` и `verification-summary.json` фиксируют актуальный
набор, generated hash, сохранность RECOVERY, HEAD/index и результаты всех запусков.
Изменения только этого отчёта не требуют повторного unit/integration/build.

Оставлены работающими обычные development API **127.0.0.1:3001** (PID 9031) и Next
**127.0.0.1:3000** (PID 9032), запуск/лог — `08-dev-restore.log` (длительно работающий
процесс, exit code пока отсутствует). Compose `postgres` **5432** и `postgres-test`
**5433** оставлены running/healthy с прежними volumes. Build/test-процессы закончились;
browser fixture не запускался. Commit/push/deploy и M6 не выполнялись.

- **CODE CHECKS: VERIFIED**
- **BROWSER A/B/C: PENDING**
- **PHYSICAL PHONE/CAMERA: NOT VERIFIED**
- **USER ACCEPTANCE: PENDING**

## 2026-10-25 / M5 — начало работы

Пользователь подтвердил приёмку M4 и разрешил только M5. Проверены фактический код,
Git status/diff и документы. HEAD остаётся `3dd16a1`; текущие M3/M4 tracked/untracked
изменения сохранены без stash/reset/commit. Безопасная копия 207 source files с hashes —
`/private/tmp/furniture-delivery-m5-baseline`; `.env` в копию не включён.

Перед новой миграцией сохранены metadata старых колонок и digests/counts development
строк: Crew 10, User 43, CrewMember 40, ExternalParticipant 0, Order 11, OrderItem 22,
Payment 11, ActivityLog 46, Appointment 1, CrewAssignment 1, TaskTemplate 6, Task 6,
CrewPlanningConfig 10, CrewUnavailability 0. Это включает пользовательскую M4-бронь.
`docker compose config --quiet` прошёл; postgres/postgres-test healthy; Node 24.22.1.
Dev API/web временно остановлены на период изменения схемы; volumes/данные сохранены.
Результаты проверок M4 ниже являются историей, не новыми запусками M5.

Фаза 1 выполнена: core execution unit 10 PASS; core integration 24 PASS (реальные PG
барьеры); legacy migration/full seed 2 PASS; новый полный API unit run 89 PASS / 8 files.
API typecheck и целевой lint прошли. Это промежуточный gate перед evidence и UI, не
итоговая проверка M5. Один первый shared-return assertion запуск использовал module,
импортированный до правки: fresh targeted и последующий полный core24 прошли.

В фазе 2 обнаружен реальный лимит существующего Next rewrite: синтетические 20 MiB
до исправления дошли только как 10 485 498 bytes, incomplete. В установленном Next
проверены clone/proxy API; `experimental.proxyClientMaxBodySize` установлен в 22 MiB
для PDF 20 MiB и multipart overhead. Повторная изолированная HTTP диагностика — все
20 971 520 bytes, complete. Это диагностика transport, ещё не доказательство сохранения
реального вложения через Nest/storage. Отдельные probe процессы 3100/3101 остановлены.

2026-10-26: полный API integration gate после evidence — 100 PASS / 12 files,
110.85s, на отдельной test PostgreSQL и уникальных storage roots. Включены M1–M4
регрессии, core execution, notes/issues/privacy и storage/quota/COMMIT recovery.
Это промежуточный запуск до UI и узких final hardening patches; итоговые команды M5
будут выполнены после всех изменений. Чужие schemas/файлы/development не очищались.

### 2026-10-26 — запуск для ручной проверки пользователя

По запросу пользователя открыта страница `/login` в Google Chrome и запущен обычный
`pnpm dev` с Node 24.22.1 / pnpm 10.34.8 на development БД из существующего Compose.
Docker Engine первоначально был остановлен; после запуска Docker Desktop сервис
`postgres` healthy. `docker compose config --quiet` и `pnpm db:migrate` прошли,
повторная миграция применила 0 изменений. Health через Next proxy: API up, database up.

Прежний временный файл начального M2 demo-пароля отсутствует. Существующие пароли
не сбрасывались. Для запрошенной ручной проверки добавлены три отдельные локальные
учётные записи `manual.admin.c52bf5`, `manual.dispatcher.c52bf5`,
`manual.crew01.c52bf5` с ролями ADMIN / DISPATCHER / CREW_MEMBER соответственно;
последняя связана с текущей активной командой DEMO-01. Старые аккаунты, заказы,
назначения, `.env` и seed не изменялись. Пароли в документацию и исходники не записаны.

Для каждой новой роли реально проверены login 200, me 200, рабочий API 200
(`/api/dashboard` либо `/api/crew/assignments`) и logout 200 через Next proxy.
Это подготовка ручной проверки, не полный повтор gate M5 и не пользовательская
приёмка. API 3001, frontend 3000 и development PostgreSQL оставлены работающими.

## 2026-10-25 / M4

Пользователь прямо подтвердил M3 и разрешил только M4. Перед изменениями прочитаны
задание и документы, проверены Git status/diff. HEAD остаётся `3dd16a1`: M3 уже находился
в рабочих tracked/untracked файлах. Его не коммитили, не сбрасывали и не перезаписывали.
162 исходных неигнорируемых файла сохранены с контрольными суммами отдельно в
`/private/tmp/furniture-delivery-m4-baseline`; `.env` в эту копию не включался.
Работа шла последовательно: модель/сервер/конкурентные проверки, затем формы/календарь/browser.

### Реализовано

- Шесть M4 entities: Appointment, CrewAssignment, TaskTemplate, Task,
  CrewPlanningConfig, CrewUnavailability; миграция `1792886403000-CreatePlanning.ts`.
  Прежний DatabaseService и единственная фабрика DataSource расширены, `synchronize: false`.
  M1–M3 migrations и существующие auth/session/Origin/CSRF правила сохранены.
- Несколько визитов заказа, unassigned и несколько команд одного визита. Создание
  идемпотентно по order/key и fingerprint нормализованного запроса; replay после отмены
  возвращает CANCELLED, не создавая визит/задачи/историю повторно.
- Серверные транзакции READ COMMITTED: Order → Appointment → объединение старых/новых
  Crew по отсортированным UUID. После ожидания Crew lock перечитываются резервы и
  доступность. Один конфликт откатывает многокомандную операцию целиком.
- Собственная Appointment.version, перенос с причиной, отдельное подтверждение клиента
  и отмена с причиной. Перенос сохраняет ID/назначения/снимки задач и историю; изменение
  времени сбрасывает confirmation. Повтор отмены не добавляет вторую запись истории.
- Шаблоны задач с required/applicability/severity/priority и неизменяемыми по отношению
  к каталогу snapshots. Optional задачи снимаются логически; required снять нельзя.
  Снятые назначения сохраняются, повторное добавление команды создаёт новое назначение.
- Europe/Rome: строгий local input, UTC instants, отклонение DST gap/fold, местные
  дневные/недельные границы. Полуоткрытый резерв `[start, end + storedBuffer)` учитывает
  буфер обоих визитов и целиком помещается в одно рабочее окно одной местной даты.
  Окна с перерывами/выходными, buffer 0–180 и недоступность редактируются диспетчером.
  Изменение доступности/disable сохраняет бронь и вычисляет Needs attention.
- Изменение согласованных полей адреса/услуги/товаров/доступа заказа сбрасывает
  confirmation активных визитов с audit, без переноса/перегенерации задач. Точный набор
  полей записан в DECISIONS. Цена/платёж/VOID не меняют Appointment.version/confirmation.
- Серверные INBOX/PLANNED/ASSIGNED в detail/list/dashboard, progress-фильтр и ссылки.
  Финансовые агрегаты по-прежнему вычисляются отдельно от appointments/assignments/tasks.
- Только ADMIN/DISPATCHER: endpoints визитов, календаря, доступности и каталога задач.
  Вложенные IDs/runtime payload проверяются сервером; CREW_MEMBER сохраняет M2 UI и 403.
  Полный список маршрутов и числовые лимиты зафиксированы в DECISIONS.
- `/backoffice/planning`: Day/Week/List, Today/дата/переходы, All teams/выбор команд,
  независимый Unassigned, одно событие многокомандного визита, полный дополнительный
  список наложений/буферов. Источник — отдельный bounded endpoint, максимум 42 Rome-дня
  и 1000 визитов с явной ошибкой вместо усечения. На 390 px исходно List, DnD выключен.
- Appointments в Order, карточка визита, доступность в Crew и `/backoffice/task-templates`.
  Loading/empty/error/Retry, исходные версии/drafts при 409, frozen create key/payload
  при неизвестном результате, canonical refetch, Refresh/focus, защита от поздних ответов.

### Зависимости, данные и seed

Добавлены только закреплённые MIT dependencies: API `luxon` 3.7.2 и dev
`@types/luxon` 3.7.6; web `@fullcalendar/react` 7.1.3 Standard и обязательный peer
`temporal-polyfill` 1.0.1. Официальная документация проверена для v7/React 19/named zone;
Premium/trial/v6 timezone plugins не использовались. Единственный lockfile обновлён.
Проверка manifests относительно сохранённого M3 подтвердила: прежние версии не изменены.
Контрольные суммы `.env`, root/contracts manifests и Compose остались прежними.

До development migration сохранены только counts/digests строк. После новой миграции,
повторной миграции и двух seed точное сравнение подтвердило прежние значения и counts:
10 Crew, 43 User, 40 CrewMember, 0 ExternalParticipant, 11 Order, 22 OrderItem,
11 Payment и 45 ActivityLog. Это включает пользовательские изменения при приёмке M3.
Development rows не удалялись и не использовались для destructive QA. Новых PostgreSQL
установок/volumes не создавали, существующий `.env` не перезаписывали.

Обычный seed создаёт только отсутствующие configs и шесть редактируемых task templates.
Он не планирует старые M3-заказы, не сбрасывает окна/buffer/недоступность/disabled templates
и прежние пароли/ручные данные. Отдельный demo-planning seed не добавлялся: browser fixtures
жили исключительно в изолированной test schema. Прежний приватный demo-password-файл
не читался; временные credentials созданы случайно, использовались приватно и удалены.

### Новые проверки агента M4

Итоговые запуски: Node **24.22.1**, pnpm **10.34.8**, Compose PostgreSQL **17.11**.
Результаты M1–M3 ниже сохранены как история и не подменяют новые запуски.

| Команда / сценарий | Фактический результат M4 |
| --- | --- |
| `docker compose config --quiet` | **PASS**, без раскрытия secrets; оба postgres healthy |
| `pnpm install --frozen-lockfile --offline` | **PASS**, lockfile соответствует manifests |
| `pnpm lint` | **PASS** |
| `pnpm format:check` | **PASS** после форматирования новых файлов |
| `pnpm typecheck` | **PASS**, contracts/API/web |
| `pnpm test` | **PASS**, API 79 + web 120 = **199**, 26 files |
| `pnpm test:integration` | **PASS**, **48 tests / 7 files**, отдельная Compose test-БД |
| `pnpm build` | **PASS**, contracts/Nest/Next production build |
| `pnpm db:migrate`, повтор | **PASS**, **1 / 0** на существующей development-БД |
| `pnpm db:seed`, повтор | **PASS**, оба запуска; точные прежние row digests/counts сохранены |
| Реальный Next proxy → Nest → test PostgreSQL | **PASS**, browser сценарий ниже |
| Browser 390/1280 и Chrome Asia/Tokyo | **PASS**, без горизонтального overflow |
| Client build scan локальных environment secrets | **PASS**, 29 static files, 0 вхождений |
| `.env`/Compose/прежние dependency pins | **PASS**, контрольные суммы/сравнение manifests |
| `git diff --check`, исключения Git | **PASS**; index пуст, HEAD прежний; приватные файлы/сборки игнорируются |
| Восстановленный обычный `pnpm dev` | **PASS**, login 200, health напрямую/через proxy 200, database up |

Интеграционные сценарии используют отдельные соединения, удерживаемые row locks и
наблюдаемую очередь PostgreSQL, с ограниченными ожиданиями. Подтверждены:

- два разных Order одновременно бронируют Crew: один успех, второй 409;
- create против переноса и два переноса в общий слот: двойной брони нет;
- обратный порядок нескольких Crew не вызывает deadlock; одинаковая version даёт один успех;
- конфликт одной команды полностью откатывает визит/задачи/версию/audit;
- буфер с обеих сторон, 11:29 конфликт / 11:30 допустимо, buffer 0 и точное касание;
- рабочие окна, перерыв, выходные, full-buffer недоступность, disabled Crew;
- availability/disable против booking в обоих порядках: согласованный результат/attention;
- повтор/конкурентное создание и replay после CANCELLED/default changes — один aggregate;
- неудачный перенос сохраняет старое окно, confirmation, IDs/задачи/историю;
- сброс confirmation при времени/согласованных условиях, независимость от платежей/VOID;
- snapshots/required/applicability и старые назначения, ownership, CSRF, disabled sessions,
  403 на каждый новый backoffice endpoint для crew, rollback при ошибке audit;
- согласованность progress и неизменность financial totals при множестве дочерних записей;
- повторная миграция и повторный/конкурентный seed сохраняют M1–M4 ручные данные.

Весь набор включает регрессии M1–M3: health recovery, сессии/роли/членство/CSRF,
конкурентные платежи и стоимость, VOID/replay, guards/формы/поиск/пагинацию/финансы.
Unit отдельно проверяет DST gap/fold, дни 23/25 часов, другие TZ процесса,
stale responses и сохранение input/draft/version/key при ошибках.
После последнего уточнения текста формы повторно прошли весь web suite (120),
lint, format:check, typecheck, production build и client secret scan; development
login/proxy health вновь вернули 200.

Промежуточные запуски выявили старое ожидание списка миграций, разницу limits DTO/БД,
избыточный итоговый task snapshot set и риск потери draft от завершившегося действия;
исправления проверены повторно. Один integration run завис на инфраструктурном ожидании
и не засчитан как PASS; HTTP helper получил bounded AbortSignal, итоговый полный run —
48 PASS. Один unit timeout при параллельной тяжёлой подготовке БД не скрывали изменением
password-кода: итоговый обычный полный run — 199 PASS. Случайный запуск build системным
Node 25 был отклонён engines guard; последующий build на закреплённом Node 24 — PASS.

### Browser smoke агента

Живые Next → Nest → Compose **test** PostgreSQL, отдельная случайная schema и четыре
вымышленных заказа. Диспетчер создал визит с Aurora/Birch и десятью задачами; Day/Week/List
и OR-фильтры каждой/обеих команд показали одно событие. Параллельная Cedar и Unassigned
были видны. Конфликт Aurora другого заказа сохранил draft; 11:00 после конца 10:30+30
успешно сохранилось. После Confirm перенос с причиной сохранил Appointment ID и задачи,
а reload показал Needs confirmation и историю. Buffer default 30→60 не изменил сохранённые
30-minute snapshots. Новая недоступность дала Needs attention без снятия визита.
Cancel сохранил историю и позволил забронировать освобождённую Birch другим заказом.
Редактируемость каталога проверена созданием вымышленного шаблона.

Реальная приостановка test API дала ошибку/Retry; после возобновления того же процесса
Retry восстановил crews/calendar. Loading/empty дополнительно проверены UI tests.
На 390/1280 px горизонтального overflow нет, мобильный старт — List. Employee остался
на M2 crew layout; прямой planning page вернул в `/crew`, calendar API — безопасный 403.
Браузер выявил расхождение DOM/React state для date/time input: добавлен onInput рядом
с onChange, регрессии и повторный реальный create подтвердили исправление. Независимый
финальный review не нашёл новых критических проблем; текст формы/README уточнён:
Unassigned не хранит задачи без назначения, optional добавляются после назначения команды.

Дополнительно в отдельном Chrome incognito через DevTools Sensors выбран **Asia/Tokyo**.
На Rome-дате 2030-01-07 сохранились те же 09:00/11:00/13:00/14:00 визиты и выбранный день.
Timezone override возвращён в No override, DevTools закрыт. Тестовые пользователи вышли,
viewport восстановлен, временные вкладка/IAB и incognito window закрыты.
Скриншоты в игнорируемой `.tmp/m4`: `calendar-week-1280.png`, `calendar-list-390.png`,
`visit-390.png`, `chrome-tokyo.png`. Browser fixture остановлен; проверено 0 оставшихся
`m4_browser_*` schemas, удалён только его test fixture, volumes/development сохранены.

### Приёмка пользователя, ограничения и процессы

Обязательные агентские проверки доступны и выполнены, **BLOCKED нет**. Пользовательская
приёмка M4 остаётся **PENDING**: пройти сценарий README на обычной development-БД,
подтвердить удобство Day/Week/List, редактирования доступности/задач и форм на телефоне.
Это отдельное подтверждение пользователя, не автоматическая приёмка по тестам.

M4 ограничен визитами одной Rome-даты и ручным планированием; каталог defaults — допущения
MVP. Календарь требует сузить диапазон при превышении limits. Realtime нет: Refresh/focus
перечитывают данные; снимок другого диспетчера может устареть, сервер проверяет commit.
Старые ограничения M2/M3 остаются. Crew execution, рекомендации слотов, issues, фотографии,
подписи и realtime не реализованы; **M5 не начинался**.

Для ручной проверки восстановлен обычный `pnpm dev` на существующей development-БД:
frontend `127.0.0.1:3000`, API `127.0.0.1:3001`. Compose postgres и postgres-test оставлены
запущенными. Browser fixture/API и отдельные smoke-процессы остановлены.
Commit, push и deploy не выполнялись.

## 2026-10-25 / M3

Пользователь прямо подтвердил приёмку M2 и разрешил M3. Git status/diff перед
изменениями были чистыми, HEAD — baseline `3dd16a1`. Реализован только M3;
M4–M8, календарь, визиты, назначения, файлы, подписи, issues и realtime не начинались.

### Реализовано

- `orders` module NestJS: Order/OrderItem/Payment/ActivityLog, отдельная миграция,
  явные browser-safe request/response contracts и строгая runtime validation.
  Используется прежний DatabaseService/DataSource; auth/CSRF/Origin не заменялись.
- Заказ со снимком клиента/адреса, неизвестными nullable условиями доступа,
  услугой/длительностью, внутренними и crew notes, ручной стоимостью и версией.
  Серверный UNIQUE номер из PostgreSQL sequence. Progress только read-only INBOX.
- Атомарный заказ с товарами, контроль принадлежности ID, логическое снятие позиций,
  история с автором/действием/временем/минимальным changes в той же транзакции.
- Integer EUR cents с пределом 2 000 000 000 на сумму, безопасный SQL SUM,
  вычисленные paid/balance/status. Запрет переплаты, дробных/отрицательных сумм и
  total ниже paid. Frontend decimal string parser без floating point округления.
- Неизменяемый журнал оплат, unique order/key, fingerprint нормализованного payload,
  replay до проверки остатка, 409 при другом payload, replay после VOID возвращает VOIDED.
  VOID с причиной сохраняет исходную запись и не означает денежный возврат.
- Все изменения блокируют Order в READ COMMITTED; PATCH проверяет expectedVersion
  под блокировкой. Replay не меняет версию и историю. Чтение REPEATABLE READ.
- ADMIN/DISPATCHER API и dashboard; CREW_MEMBER не получает новых заказов, финансов,
  внутренних заметок или истории. Существующий crew-интерфейс M2 сохранён.
- Dashboard всего набора и отдельный фильтруемый список с поиском/пагинацией.
  `/backoffice/orders`, `/new`, `/[id]`, прежние Teams теперь `/backoffice/crews`.
  Формы, loading/empty/error/Retry/409, подтверждение VOID, layout 390/1280 px.
- Платёжная попытка хранит неизменяемый payload/ключ только в памяти и повторяет
  их после сетевой ошибки. Новый ключ после неизвестного результата требует чтения журнала.
  Черновик заказа сохраняет свою исходную версию; платёжные действия скрыты при редактировании.
- Отдельный seed 10 вымышленных Inbox-заказов, 20 товаров, 8 RECORDED и 1 VOIDED.
  Unique seedKey и транзакция пропускают существующий aggregate целиком, без сброса
  ручных сумм, удалённых позиций, VOIDED, истории, паролей и disabled-состояний.

### Сохранность и миграции

Существующий `.env`, manifests, lockfile, Compose и закреплённые версии проверены
по контрольным суммам и не менялись. M1/M2 migrations не редактировались.
Новая `CreateOrders1792886402000` применена на development PostgreSQL: 1 миграция,
повторно — 0. `synchronize: false`, новых зависимостей и PostgreSQL-инсталляций нет.

Перед миграцией сохранены только counts/digests существующих development rows.
После миграции и двух seed точное сравнение подтвердило сохранность значений:
10 Crew, 43 User (включая ручной аккаунт), 40 CrewMember, 0 ExternalParticipant.
Пароли и приватный seed-password-файл для M3 не читались и не копировались из переписки;
DB credentials использовались существующей конфигурацией без вывода.
Локальные контрольные файлы/скриншоты находятся в игнорируемой `.tmp/m3`.
В PostgreSQL добавлены только M3 demo aggregates; development-данные не очищались.

### Новые проверки агента

Node **24.22.1**, pnpm **10.34.8**, Compose PostgreSQL **17.11**.
`docker compose config --quiet` прошёл без раскрытия секретов; postgres и postgres-test
работали healthy. Integration и browser smoke использовали только test-БД с отдельными
случайными схемами, без fallback на development. Старые результаты M1/M2 ниже — история.

| Команда / сценарий | Фактический результат M3 |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | **PASS**, версии/lockfile сохранены |
| `pnpm lint` | **PASS** |
| `pnpm format:check` | **PASS** |
| `pnpm typecheck` | **PASS**, contracts/API/web |
| `pnpm test` | **PASS**, API 61 + web 81 = 142 unit tests |
| `pnpm test:integration` | **PASS**, 27 tests / 5 files на выделенной Compose test-БД |
| `pnpm build` | **PASS**, contracts/API/Next production build |
| `pnpm db:migrate`, повтор | **PASS**, 1 / 0 на существующей development БД |
| `pnpm db:seed`, повтор | **PASS**, 10 orders / 20 items / 8 RECORDED + 1 VOIDED; прежние rows сохранены |
| Реальный Next proxy | **PASS**, login/me, protected SSR, dispatcher API200, crew API403 и redirect |
| Browser smoke 390/1280 | **PASS**, сценарий ниже, горизонтального overflow нет |
| Повтор smoke на `next start` после финальных UI-исправлений | **PASS**, edit draft guard и платёж/reload, 390/1280 без overflow |
| Финальный client bundle / локальные environment secrets | **PASS**, 0 вхождений; приватный seed-password-файл не читался |
| `git diff --check` | **PASS**; commit/push/deploy не выполнялись |

Конкурентные тесты удерживают настоящую строку Order отдельным QueryRunner,
запускают два независимых operation connections и проверяют цепочку `pg_blocking_pids`
до снятия барьера. Подтверждено реальное перекрытие транзакций, без последовательной имитации:

- два одинаковых платежа — одна Payment и одна PAYMENT_RECORDED;
- total=100000, два разных платежа по 60000 — один успех, один 409, paid=60000;
- платёж одновременно с уменьшением total — только совместимый результат, paid <= total;
- две формы с одной версией — одна сохраняется, другая 409;
- два VOID — одна история/изменение баланса; replay исходного ключа после VOID не возрождает платёж;
- конкурентный seed наблюдает два INSERT-соединения, ожидающих блокировку, и не дублирует aggregate.

Дополнительно проверены ownership товаров/платежей, protected/unknown fields, все статусы
оплаты, SQL limits, свежие роли/disabled account, CSRF, чтение новым соединением,
атомарность при ошибке второй позиции PostgreSQL и rollback при невозможности ActivityLog.
Seed-тест сохраняет ручные M1/M2/M3 поля, хеши паролей, роли, disabled membership,
логически снятые items, VOIDED и историю после повторного/конкурентного запуска.

Первый полный integration run выявил устаревшее ожидание ровно двух миграций в M1 test:
оно заменено точным списком M1/M2/M3; все прежние проверки Crew сохранены, повторный
полный run — 27 PASS. В конкурентном helper уточнён поиск транзитивной очереди блокировок;
это исправление наблюдения теста, а не обход бизнес-конфликта. Lint/format замечания
новых файлов исправлены. Финальный review выявил риск потери edit draft от завершившейся
оплаты; форма теперь хранит исходный снимок/версию, добавлена регрессия.
Независимый review нашёл потерю последнего цента при форматировании очень большого
допустимого dashboard aggregate через Number/100. Formatter заменён на BigInt
quotient/remainder и Intl parts; тесты проверяют оба предельных значения и отсутствие округления.

### Browser smoke агента

Разрешённый IAB, живые Next proxy → Nest → Compose test PostgreSQL.
Для browser fixture создана отдельная test schema и случайные временные credentials;
приватный прежний demo-password-файл не использовался.
Диспетчер создал заказ €650,50 с двумя товарами и длинными именем/адресом, записал
€200,50, после reload увидел paid €200,50 / balance €450,00; VOID с причиной вернул
paid €0 / balance €650,50 и добавил историю. Изменение города/количества сохранилось.
Поиск Milano нашёл заказ, фильтр Paid дал корректный пустой список; dashboard показал
один Inbox и полные итоги независимо от фильтра. Наблюдались loading и пустые состояния.
Test API реально приостанавливался: UI показал ошибку и Retry; после возобновления
того же процесса Retry восстановил данные. На 390 и 1280 px scrollWidth равен viewport.
Сотрудник сохранил свой crew layout; прямой `/backoffice/orders` вернул в `/crew`,
прямой `/api/orders` показал 403 без финансовых данных.

Скриншоты: `.tmp/m3/payments-390.png`, `order-1280.png`, `dashboard-1280.png`.
После финальных исправлений на собранном Next (`next start`) повторно проверены
390/1280 px, скрытие финансовых mutation controls при редактировании, отмена формы,
платёж и сохранённый после reload остаток. Снимки: `final-order-390.png`, `final-order-1280.png`.
Тестовые сессии завершены logout, viewport восстановлен, временная вкладка закрыта.
Browser fixture остановлен, удалена только его изолированная test schema; volumes и
development rows не удалялись. Сгенерированный файл credentials fixture удалён.
Обычный `pnpm dev` восстановлен на development-БД: frontend 3000 и API 3001 оставлены
запущенными для пользовательской приёмки. Compose postgres/postgres-test работают;
тестовые API и production Next smoke-процессы остановлены.

### Приёмка пользователя и ограничения

Обязательные проверки M3 доступны и выполнены; итоговая пользовательская приёмка
**не объявлена**. Пользователю проверить обычный development UI по сценарию README:
создать/изменить заказ, записать и аннулировать платёж, проверить поиск/фильтры/страницы,
затем войти сотрудником и подтвердить отсутствие финансового интерфейса.
Это отдельная проверка пользователя, а не замена агентских тестов или BLOCKED.

Деньги вводятся вручную, бухгалтерии/возвратов/эквайринга нет. Offset pagination может
сдвигаться при конкурентных новых заказах. История/журнал в карточке пока без собственной
пагинации; UI рассчитан на тестовый MVP. Production security/operations и ограничения M2
остаются прежними. M4 запускается только отдельным запросом. Commit/push/deploy запрещены
и в этом этапе не выполнялись.

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
