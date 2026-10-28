# M5 — состояние после прерывания

Диагностика 2026-10-26, снимок около 07:14–07:18 UTC (08:14–08:18 Europe/Rome).
**M5 не принят. Разработка не возобновлялась.** В этом запросе изменён только этот
файл. Приложения, браузер, build, тесты, миграции и seed не запускались; процессы не
завершались. Агент не изменял БД, storage, `.env`, зависимости и lockfile.

Прочитаны AGENTS, задание M5, README, DECISIONS и PROGRESS; выполнен ограниченный
просмотр исходников/тестов M5, Git, процессов и существующих артефактов. Это не полный
аудит M1–M4. Наличие реализации и тестов ниже не означает проверенного поведения.

## Git и сохранность

- Корень Git — текущая папка проекта. HEAD: `3dd16a1`, baseline M1/M2.
- До создания отчёта: **29 tracked-файлов с unstaged изменениями, 153 untracked-файла,
  staged — 0**. После создания отчёта добавлен один untracked-файл — этот документ.
- `/private/tmp/furniture-delivery-m5-baseline` **отсутствует**. Точное сравнение
  содержимого с началом M5 невозможно; ничего из копий не восстанавливалось.
- M3/M4 уже существовали поверх HEAD: `apps/api/src/orders/`,
  `apps/api/src/planning/`, миграции `1792886402000-CreateOrders.ts` и
  `1792886403000-CreatePlanning.ts`, соответствующие backoffice страницы,
  order/planning contracts и тесты. Их untracked-статус не означает, что это новые M5.
- По назначению к M5 относятся `apps/api/src/execution/`, `apps/api/src/evidence/`,
  миграции `1792886404000-CreateExecution.ts`, `1792886404100-CreateEvidence.ts`,
  execution/evidence contracts, crew assignment UI, evidence/issues/backoffice
  execution UI и их новые тесты. Существующие OrderItem/Assignment/Task и M3/M4
  mutation paths расширены M5; целиком приписывать эти файлы одному этапу нельзя.
- Общие diff также затрагивают auth decorators/public API, DataSource/app modules,
  config, frontend API/resource hooks, manifests, lockfile и документацию.
  Luxon/FullCalendar относятся к M4; Sharp 0.35.5, scoped Multer 2.5.0 override,
  storage-команда и proxy body limit 22 MiB — к M5. Это атрибуция по коду/документам,
  а не восстановленная история каждого изменения без baseline.
- `.env`, `node_modules`, `.tmp`, API dist и Next output исключены Git.
  Reset/restore/clean/stash/checkout/staging/commit/push/deploy не выполнялись.

Сравнение SHA-256 всех 282 tracked/untracked файлов снимка начала диагностики с её
концом подтвердило: добавлен только `docs/M5_RECOVERY.md`, прежние файлы не изменились;
HEAD прежний, staged по-прежнему 0. Игнорируемые секреты в этот снимок не включались.

PROGRESS сохраняет промежуточный статус M5 IN_PROGRESS и отдельную запись о последующей
подготовке ручного доступа: три новых development-аккаунта, один связан с DEMO-01.
По той записи прежние пароли не сбрасывались. Содержимое БД здесь не перечитывалось.
Пароли, cookies, tokens и переменные окружения в этот отчёт не включены.

## Оставшиеся процессы

Проверены PID/parent/cwd и слушающие TCP-порты; полные argv и env не публиковались.

| Процесс | PID | Порт | Окружение / состояние |
| --- | --- | --- | --- |
| `pnpm dev`, координаторы | 2663 → 2664 → 2678 | нет | Обычный development запуск, не browser fixture |
| API watcher | 2695 | нет | `apps/api`, tsx watch |
| Nest API | 2723 | 127.0.0.1:3001 | Development, дочерний watcher; служебный esbuild PID 2725 |
| Next launcher / server | 2712 / 2726 | 127.0.0.1:3000 | Development Next 16.4.3, `apps/web` |
| Compose `postgres` | Docker backend PID 2355 на хосте | 127.0.0.1:5432 | running, healthy; development сервис |
| Compose `postgres-test` | — | не слушает | exited; отдельный test сервис сейчас остановлен |
| Build / Vitest / отдельный browser fixture API | не обнаружены | 3100/3101/5433 не слушают | Активного прогона M5 не обнаружено |

Служебные node_repl/CUA/kernel процессы инструментария не являются приложением или
доказательством продолжающегося browser smoke. Браузер в этом запросе не открывался
и не инспектировался. Сохранённые fixture state/credentials-файлы в `.tmp/m5` остаются;
их секретное содержимое не читалось, очистка не выполнялась. Существование старой
test schema и файлов fixture в storage сейчас **UNKNOWN**, БД/storage не проверялись.
Все перечисленные процессы оставлены как обнаружены.

## Что можно восстановить о проверках

Все результаты в этом разделе исторические. Новых запусков проверок нет.

| Проверка / артефакт | Что действительно доступно | Вывод |
| --- | --- | --- |
| Последний `pnpm build` | API `dist/main.js` 06:10:25 UTC; Next `BUILD_ID` и `trace-build` 06:10:29; diagnostics: `static-generation` | Артефакты сборки есть. Итог всего `pnpm build` и его exit code по сохранённому журналу **UNKNOWN** |
| Сообщение о завершении build | В восстановленном контексте предыдущей сессии последний build указан как успешный, exit 0, tool session 26341 | Сырой вывод сейчас недоступен: чтение session вернуло Unknown process id. Это историческое сообщение, не восстановленный PASS текущего checkout |
| API Vitest cache | `apps/api/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`, 06:09:26 UTC; 22 файловых записи, 12 integration + 10 unit, все `failed:false` | Сохранён положительный файловый кеш. Число отдельных тестов и exit code он не содержит |
| Web Vitest cache | Аналогичный `apps/web/node_modules/.vite/vitest/.../results.json`, 06:00:09 UTC; 27 файлов, все `failed:false` | Те же ограничения; кеш может объединять разные запуски |
| Unit aggregate | В контексте предыдущей сессии сообщалось API 105 + web 194 = 299, затем добавлены четыре UI regression cases | Полный итог текущего набора **UNKNOWN**; автоматически объявлять 303 PASS нельзя |
| Lint / format / typecheck | Исторические сообщения об успехе, отдельные финальные logs в `.tmp` не найдены | Последний общий gate по сохранённым журналам **UNKNOWN** |
| Миграции / seed | В контексте прошлой сессии сообщались migration 2/0, двойной seed и сохранение прежних digests; текущий PROGRESS дополнительно записал поздний migration 0 и HTTP role checks | Здесь не повторялись; новый результат и текущее состояние данных не утверждаются |

### Integration timeout и последующее 102/102

Это отдельные события, которые нельзя заменять одним зелёным итогом:

1. В PROGRESS сохранён более ранний промежуточный запуск **100 PASS / 12 files**,
   110.85 s. Он предшествовал последним уточнениям и не является итоговым gate.
2. В контексте прерванной сессии зафиксирован позднейший неуспешный общий запуск:
   **101/102, один timeout** в проверке disabled Crew, около 610 s общего времени.
   Тест: `allows a disabled crew to document started work, but never permits a new
   departure or a disabled user` в `execution.integration.test.ts:579`.
   Точный exit code по доступным файлам **UNKNOWN**. Этот запуск не считается PASS.
3. Затем сообщался успешный отдельный повтор этого теста и полный повтор
   **102/102, 12 files, 114.99 s**, exit 0 со слов агента. Сообщалось также о wrapper
   с монитором времени и caffeinate. Сохранённые terminal/monitor logs сейчас
   отсутствуют; файловый Vitest cache согласуется с успехом, но самостоятельно
   не доказывает именно 102/102. Это **заявленный исторический успех**, не новый run.

**Причина первоначального timeout не установлена.** Предположение о паузе хоста или
процесса не доказано и здесь не принимается как объяснение.

### Изменения после проверок

`crew-execution-forms.tsx` имеет mtime 05:58:13 UTC, его тест — 06:00:04. В текущем
тесте есть три terminal-refresh readOnly cases и отдельный unknown-finish Retry case
(`crew-execution.test.tsx:412,461`), добавленные после сообщавшегося aggregate 299.
По истории сессии после этой правки был ещё build, но его полный log не сохранился.

По текущим mtimes бизнес-исходники API/web/contracts и тесты не новее указанных кешей
и production build. После build изменились автоматически генерируемый
`apps/web/next-env.d.ts` (06:35:36) и PROGRESS (06:38:08). Это только metadata файлов:
без hashes проверенного checkout нельзя доказать полное соответствие исходников
последнему успешному запуску. Текущий dev output также не равен чистой production
сборке. Содержимое файлов этим диагностическим запросом не исправлялось.

## Browser smoke: PARTIAL, не завершён

По восстановленной истории инструментальных действий завершились только подготовительные
шаги сценария A на отдельной test fixture: вход диспетчера; пустой dashboard; создание
заказа DELIVERY_AND_ASSEMBLY с товаром quantity 2; визит 09:00–11:00 Europe/Rome с двумя
командами Aurora/Birch и задачами; подтверждение клиентского согласования. Это наблюдения
прошлой сессии, без отдельного сохранённого smoke-report или скриншотов этих шагов.

Следующий вызов ожидания file chooser для PDF 20 MiB был прерван пользователем после
173.9 s. Успешный выбор/отправка/сохранение файла **не подтверждены**. Сценарий A до
crew execution/finish не доведён; сценарии B/C не подтверждены. Нельзя отмечать их PASS.

Единственный сохранённый M5 screenshot — `.tmp/m5/manual-login-chrome.png`
(06:38:17 UTC, 22 725 bytes): более позднее открытие login в Chrome для ручной проверки,
а не сквозное исполнение. `chooser/*.png/jpg/pdf` — синтетические входные файлы, не
результаты QA. Скриншоты `.tmp/m3` и `.tmp/m4` относятся к прежним этапам.
Обычный dev log содержит GET 200 backoffice страниц при последующей ручной работе;
это не доказательство crew-сценариев, upload, mutation или успешного browser smoke.

Не подтверждены в M5: два crew workflow, shared quantities после reload, фото/issues/
partial/finish/return, visibility и старый URL после logout, lost-response Retry,
409 двух вкладок, restart persistence, 390/1280 без overflow и Asia/Tokyo.
Физический телефон и камера **NOT VERIFIED**: эмуляция/выбор файла это не подтверждают.

## Соответствие файлов основным требованиям

Статусы ниже оценивают **наличие реализации в исходниках**, не runtime PASS.
`IMPLEMENTED` не заменяет отсутствующую сквозную проверку; весь M5 остаётся незавершённым
по верификации. В ограниченном просмотре целиком MISSING групп не обнаружено.

| Группа | Код | Основные файлы | Существующие тесты, не запущенные здесь | Что осталось проверить |
| --- | --- | --- | --- | --- |
| Today / Upcoming / Open / Completed | IMPLEMENTED | `apps/api/src/execution/execution.service.ts:54`; `apps/web/components/crew-work-list.tsx`; `/crew`, `/crew/assignments` | `execution.integration.test.ts:1649`, `execution.test.ts`, `crew-work-list.test.tsx` | Все вкладки/пагинация с живыми данными, Rome vs Asia/Tokyo, loading/empty/error/Retry, 390/1280 |
| Свои назначения, переходы, actual times | IMPLEMENTED | `execution.controller.ts`, `execution-access.ts`, `execution.service.ts:167`, `crew-assignment-detail.tsx`; миграция `1792886404000` | `execution.integration.test.ts:360,424,446,525,579,620,658,779,818,1299,1723` | Реальный crew путь; актуальные права после смены членства/disable; позднее окончание отдельно от плана |
| Checklist и delivered/assembled | IMPLEMENTED | `execution.service.ts:266,336`, `execution.dto.ts`, `crew-execution-forms.tsx`; отдельные task/item versions и durable receipts | `execution.integration.test.ts:851,928,1014,1119,1862`; `crew-execution.test.tsx`, `execution-guards.test.ts` | Две команды и два сотрудника, общие absolute totals после reload, 409/drafts, Retry без удвоения |
| Ограничения начатого визита | IMPLEMENTED | `planning.service.ts:435,595`, `orders.service.ts:245`; запреты после depart внутри транзакций | `execution.integration.test.ts:714,1299,1344` | Живой отказ переноса/отмены/материальной правки с сохранением draft/истории; отсутствие потери начатой работы |
| Заметки, защищённые фото и документы | IMPLEMENTED | `evidence.service.ts:98`, `attachments.controller.ts`, `attachments.service.ts`, `private-storage.ts`, `evidence-panel.tsx`; миграция `1792886404100` | `evidence.integration.test.ts`, `attachment-storage.integration.test.ts`, `private-storage.test.ts`, `evidence-panel.test.tsx` | Настоящий Next→Nest→storage upload, PDF 20 MiB, неверные/oversized файлы, потерянный ответ, withdrawal, restart и повторное чтение; телефон отдельно |
| Issues и разрешение | IMPLEMENTED | `evidence.service.ts:157,311,384`, `evidence.controller.ts`, issue/event entities; `evidence-panel.tsx`, `/backoffice/issues` | `evidence.integration.test.ts:181,233,317,362,427`, `evidence.test.ts`, `issues-list.test.tsx` | Сценарий B: item+photo issue, partial, BO resolve/reopen; независимость quantities/return/report |
| Finish report и повторный приезд | IMPLEMENTED | `execution.service.ts:428`, `finish-report.entity.ts`, `return-visit-request.entity.ts`; `crew-assignment-detail.tsx:275,319` | `execution.integration.test.ts:1188,1235,1782`; `execution-migration.integration.test.ts`; `crew-execution.test.tsx` | Finish A не завершает B/Order; immutable snapshot vs live totals; partial/blocked/reasons; resolve issue не снимает return |
| Результаты в backoffice | IMPLEMENTED | `execution-state.ts`, `execution-projection.ts`, `backoffice-execution-panel.tsx`, order/appointment detail, `planning-board.tsx`, dashboard/list | `execution.test.ts`, `execution.integration.test.ts:1463,1782`, `backoffice-execution.test.tsx`, `evidence-cross.integration.test.ts:469` | Crew→BO/calendar/dashboard на одних сохранённых данных; независимость финансовых сумм и issue/return counters |
| Финансовые/внутренние данные скрыты от crew | IMPLEMENTED как явные проекции и проверки | `execution-projection.ts`, `execution-access.ts`, `evidence-access.ts`, `evidence-projection.ts`, `attachments.service.ts:283`, web execution guards | `execution.integration.test.ts:360,424,1723`; `evidence-cross.integration.test.ts`; `execution-guards.test.ts` | Живые crew JSON/SSR/mutation/replay/error/download; private document, logout/смена членства и старый URL |

Пути API без префикса в таблице относятся к `apps/api/src/{execution,planning,orders,evidence}`;
тесты API — `apps/api/test`, UI — `apps/web/components`, guards — `apps/web/lib`.
Отдельный crew API, explicit allowlist, повторная авторизация под locks, один DataSource
factory и `synchronize:false` присутствуют. Их наличие не доказывает отсутствие всех ошибок.

Согласованные ограничения: PDF только backoffice, header/EOF без AV/CDR; HEIC не обещан;
storage локальный private. Return request только фиксируется, его обработка — M6.
Подписи и финальное Order.COMPLETED не реализуются в M5 и не считаются пропуском.

## Что осталось для закрытия M5 — только после отдельного продолжения

1. Сохранить доказуемую связь исходников и результатов: hashes/revision, полные logs и
   exit codes. По ним подтвердить или повторить lint, format:check, typecheck, unit,
   integration и build; не переносить старые численные результаты на новый запуск.
2. Подтвердить migration/repeat и seed/repeat с сохранностью M1–M4 и M5-результатов;
   использовать snapshots, отдельную test БД/storage и не очищать development данные.
3. Завершить browser A/B/C из задания, включая uploads через proxy, races/Retry,
   privacy, restart без seed, 390/1280 и Asia/Tokyo; сохранить результаты и скриншоты.
4. Отдельно проверить реальный телефон/камеру либо явно оставить эту проверку открытой.
5. Сверить README/DECISIONS/PROGRESS с фактическими итогами. Сейчас PROGRESS содержит
   промежуточные результаты, а формулировка README «реализованы M1–M5» не означает
   завершённые проверки или пользовательскую приёмку. Эти документы здесь не менялись.
6. Получить отдельную пользовательскую приёмку M5. M6 не начинать автоматически.

Диагностика завершена. Автоматического исправления, очистки fixture или продолжения
проверок после этого отчёта не предусмотрено.
