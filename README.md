# Furniture Delivery — M2

Тестовый проект доставки и сборки мебели. Реализованы M1 и M2: PostgreSQL/TypeORM,
health, серверные сессии, роли, аккаунты, команды, состав и внешние контакты.
Заказы, визиты, календарь, оплаты, загрузки и realtime относятся к следующим этапам.

```text
apps/
  web/                  Next.js App Router, порт 3000
  api/                  NestJS, порт 3001
packages/
  contracts/            Browser-safe health contract
docs/
prompts/
docker-compose.yml
pnpm-workspace.yaml
package.json
pnpm-lock.yaml
```

Нужны Node.js **24.22.1 LTS**, pnpm **10.34.8**, Docker Engine/Desktop с Compose v2.
Версии Node указаны в `.nvmrc` и `.node-version`; приложения работают отдельными процессами.

## Первый запуск

Из корня проекта:

```bash
nvm install
nvm use
npm install --global pnpm@10.34.8
pnpm install --frozen-lockfile
if [ ! -e .env ] && [ ! -L .env ]; then
  cp .env.example .env
fi
```

В `.env` замените оба password-placeholder на собственные локальные пароли.
Если `.env` уже существует, сохраните его настройки, не копируйте поверх него пример.
Все приложения и команды API читают один корневой `.env`; переменные процесса имеют
приоритет. Файл игнорируется Git. Пароли не нужны frontend-коду.

```bash
docker compose up -d --wait postgres
pnpm db:migrate
```

Перед первым seed задайте `SEED_PASSWORD` локально, без записи в историю терминала.
Например, в Bash (ввод скрыт):

```bash
read -r -s -p 'Local demo password (12–128 characters): ' SEED_PASSWORD
printf '\n'
export SEED_PASSWORD
pnpm db:seed
unset SEED_PASSWORD
pnpm db:seed
pnpm dev
```

Seed создаёт `demo.admin`, `demo.dispatcher` и сотрудников
`demo.crew01.member01` … `demo.crew10.member04`: 42 отдельных аккаунта,
по четыре сотрудника в каждой из десяти команд. Начальный пароль берётся только
из `SEED_PASSWORD`; у каждого аккаунта отдельная соль хеша. Повторный seed сохраняет
пароли, роли, disabled-состояния, ручные изменения и историю членства. Если все
аккаунты уже существуют, пароль не нужен. Изменение `SEED_PASSWORD` не сбрасывает
существующие пароли — для этого есть форма ADMIN.

Откройте [вход](http://127.0.0.1:3000/login). ADMIN и DISPATCHER получают
`/backoffice`; сотрудник — `/crew`. Только ADMIN управляет аккаунтами.
Диспетчер управляет командами, составом и внешними контактами без аккаунтов.
Команды, членство и контакты отключаются без удаления истории.

Откройте [frontend](http://127.0.0.1:3000). Прямой
[health API](http://127.0.0.1:3001/api/health) делает настоящий `SELECT 1`.
Успех — HTTP 200, недоступность БД — HTTP 503. API запускается и при выключенной БД.
Страница различает недоступный API и недоступную БД; кнопка Retry повторяет запрос.
Из Next.js браузер обращается к `/api/health`; server-side rewrite направляет запрос
на `API_ORIGIN`. Публичные CORS-разрешения не нужны. При изменении `API_ORIGIN`
перезапустите dev server или пересоберите production frontend.

Порт PostgreSQL и API по умолчанию привязаны к `127.0.0.1`. Порты 3000, 3001, 5432,
5433 должны быть свободны. `API_PORT` и `DATABASE_PORT` можно изменить в `.env`;
при изменении `API_PORT` также измените `API_ORIGIN`.

## Сессии и права M2

- Cookie `fd_session`: HttpOnly, SameSite=Lax, Path=/, без Domain. Secure по умолчанию
  включён при `NODE_ENV=production`, выключен в development/test. Production login
  предполагает HTTPS; для локальной проверки используйте `pnpm dev`.
- Cookie содержит случайный opaque token из 32 bytes. В PostgreSQL хранится только
  SHA-256-хеш; JSON API, SSR HTML и browser storage токен не получают.
- Абсолютный срок — 8 часов (`SESSION_TTL_SECONDS=28800`), без продления на запросах.
  Logout отзывает сессию в БД и очищает cookie; повтор старой cookie даёт 401.
- Каждый запрос проверяет актуальные User и CrewMember в БД. Отключение аккаунта,
  смена роли/пароля через ADMIN отзывает все его сессии. Повторное включение не
  возвращает старую сессию. Смена членства действует со следующего запроса без logout.
  Чужая или более недоступная команда возвращает 404; запрет административного действия — 403.
- Все POST/PATCH требуют точный `Origin`, совпадающий с `WEB_ORIGIN`, и
  `X-CSRF-Protection: 1`, включая login/logout. Отсутствующий/чужой Origin отклоняется.
  Открывайте локальный UI именно через настроенный origin (по умолчанию 127.0.0.1:3000).
- Next proxy `/api/:path*` передаёт Cookie, Set-Cookie и Origin. SSR layouts читают
  текущую сессию через API с no-store; Nest остаётся местом проверки всех прав.
  CORS не включён: браузер использует один origin. Нет доверия произвольному X-Forwarded-For.
- Login ограничен 10 попытками на аккаунт за 60 секунд и 100 на socket IP;
  429 содержит Retry-After. Лимитер ограничен по памяти и работает в одном процессе;
  после рестарта его счётчики сбрасываются. Сессии сохраняются в PostgreSQL.

Подробная политика и источники: [docs/DECISIONS.md](docs/DECISIONS.md).

## Проверки

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Интеграционные тесты требуют отдельный PostgreSQL. Compose предоставляет сервис
`postgres-test` с отдельным volume, портом 5433 и собственными credentials:

```bash
docker compose --profile test up -d --wait postgres-test
pnpm test:integration
```

Тесты требуют полный набор `TEST_DATABASE_*`, имя БД с суффиксом `_test`, отличное
от development database, и `NODE_ENV=test` (устанавливается скриптом). Они создают
случайную схему `m1_<uuid>` и удаляют только её. Проверяются миграция, её повторный
запуск, повторный/конкурентный seed, сохранение пользовательских изменений,
ограничения Crew, сохранность данных при новом соединении, настоящий HTTP 503 и
восстановление при разрыве PostgreSQL-соединения через TCP tunnel.

Ручной smoke test:

1. При запущенных сервисах страница показывает API Reachable и Database Connected.
2. Выполните `docker compose stop postgres`, нажмите Check again: API Reachable,
   Database Unavailable; прямой health возвращает 503.
3. Выполните `docker compose start postgres`, дождитесь healthcheck и нажмите Retry:
   снова Connected без перезапуска API.
4. Остановите только API: Retry показывает API Unavailable и Database Unknown.
5. Проверьте loading и retry, ширину телефона 390 px и отсутствие горизонтального скролла.

Проверка seed выполняется до проверки сохранности: повторный `pnpm db:seed`
должен оставить 10 команд на свежей БД и сохранить существующие значения.
В production seed запрещён. Схема изменяется только миграциями, `synchronize: false`.

Для проверки persistent volume используйте уже подготовленную development БД.
Выполняйте следующие блоки из корня проекта в одной отдельной Bash-сессии.
Не меняйте Compose project name, `.env`, compose-файл или данные команд во время проверки.
После контрольной правки и до её восстановления **не запускайте миграции и seed**:
они могли бы скрыть потерю данных. Снимки сохраняются в приватной игнорируемой `.tmp/`.

```bash
set -euo pipefail
umask 077
mkdir -p .tmp
m1_dir=$(mktemp -d .tmp/m1-persistence.XXXXXX)
printf 'Persistence snapshot: %s\n' "$m1_dir"

# Credentials берутся из окружения контейнера и не выводятся.
m1_psql() {
  docker compose exec -T postgres sh -c '
    PGPASSWORD="$POSTGRES_PASSWORD" PGOPTIONS="-c timezone=UTC" \
      exec psql -X -w -v ON_ERROR_STOP=1 \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
  ' sh "$@"
}

m1_snapshot() {
  m1_psql -qAt -c "SELECT to_jsonb(c) FROM public.crew AS c WHERE code = 'DEMO-01';"
}

m1_wait_postgres() {
  for ((m1_attempt = 0; m1_attempt < 30; m1_attempt++)); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q postgres)")" = healthy ]; then
      return 0
    fi
    sleep 2
  done
  printf '%s\n' 'PostgreSQL healthcheck did not become healthy.' >&2
  return 1
}

m1_volume_name() {
  docker inspect --format '{{range .Mounts}}{{if and (eq .Type "volume") (eq .Destination "/var/lib/postgresql/data")}}{{.Name}}{{end}}{{end}}' \
    "$(docker compose ps -q postgres)"
}

# Сохраняем UUID, исходное name и все остальные значения выбранной команды.
m1_snapshot > "$m1_dir/original.json"
test -s "$m1_dir/original.json"
m1_psql -qAt -c 'SELECT count(*) FROM public.crew;' > "$m1_dir/count.original.txt"

# Подтверждаем фактический named-volume mount нужного каталога данных.
m1_volume=$(m1_volume_name)
test -n "$m1_volume"
printf '%s\n' "$m1_volume" > "$m1_dir/volume-name.txt"
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}} {{.Name}} {{.Source}} -> {{.Destination}}{{end}}{{end}}' \
  "$(docker compose ps -q postgres)"
docker volume inspect --format '{{.Name}} {{.Mountpoint}}' "$m1_volume"

# Меняем только name, если строка всё ещё совпадает с исходным снимком.
m1_psql -qAt --set=original="$(cat "$m1_dir/original.json")" <<'SQL' > "$m1_dir/changed.json"
WITH original AS (SELECT :'original'::jsonb AS value)
UPDATE public.crew AS c
SET name = 'M1 persistence ' || substr(md5(clock_timestamp()::text), 1, 12)
FROM original
WHERE c.id = (original.value->>'id')::uuid
  AND to_jsonb(c) = original.value
RETURNING to_jsonb(c);
SQL
test -s "$m1_dir/changed.json"
```

Проверьте сохранение той же строки и всех её значений после обычного restart:

```bash
docker compose restart postgres
m1_wait_postgres
test "$(m1_volume_name)" = "$m1_volume"
m1_snapshot > "$m1_dir/after-restart.json"
cmp "$m1_dir/changed.json" "$m1_dir/after-restart.json"
m1_psql -qAt -c 'SELECT count(*) FROM public.crew;' > "$m1_dir/count.after-restart.txt"
cmp "$m1_dir/count.original.txt" "$m1_dir/count.after-restart.txt"
printf '%s\n' 'PASS: restart preserved the UUID, control name, all values and crew count.'
```

Затем пересоздайте только контейнер `postgres` с тем же существующим volume.
Сравнение container ID подтверждает пересоздание, сравнение volume name — повторное
подключение прежнего хранилища. Между командами ниже миграции и seed также не нужны:

```bash
m1_old_container=$(docker compose ps -q postgres)
docker compose up -d --no-deps --force-recreate --wait postgres
test "$(docker compose ps -q postgres)" != "$m1_old_container"
test "$(m1_volume_name)" = "$m1_volume"
docker volume inspect --format '{{.Name}} {{.Mountpoint}}' "$m1_volume"
m1_snapshot > "$m1_dir/after-recreate.json"
cmp "$m1_dir/changed.json" "$m1_dir/after-recreate.json"
m1_psql -qAt -c 'SELECT count(*) FROM public.crew;' > "$m1_dir/count.after-recreate.txt"
cmp "$m1_dir/count.original.txt" "$m1_dir/count.after-recreate.txt"
printf '%s\n' 'PASS: container recreation preserved the UUID, control name, all values and crew count.'
```

Восстановите исходное `name`. Проверка полного контрольного снимка предотвращает
перезапись параллельной пользовательской правки:

```bash
m1_psql -qAt --set=original="$(cat "$m1_dir/original.json")" \
  --set=changed="$(cat "$m1_dir/changed.json")" <<'SQL' > "$m1_dir/restored.json"
WITH original AS (SELECT :'original'::jsonb AS value),
     changed AS (SELECT :'changed'::jsonb AS value)
UPDATE public.crew AS c
SET name = original.value->>'name'
FROM original, changed
WHERE c.id = (original.value->>'id')::uuid
  AND to_jsonb(c) = changed.value
RETURNING to_jsonb(c);
SQL
test -s "$m1_dir/restored.json"
cmp "$m1_dir/original.json" "$m1_dir/restored.json"
printf '%s\n' 'PASS: original name and all original row values restored.'
```

Если команда или сравнение завершились ошибкой, остановите проверку и сохраните
путь к `.tmp/m1-persistence.XXXXXX`. Не создавайте новый исходный снимок поверх
контрольной правки. После восстановления доступности прежнего volume используйте
сохранённые `original.json` / `changed.json` для последнего блока восстановления;
при новой Bash-сессии снова определите `m1_psql` и установите `m1_dir` в сохранённый
путь. При несовпадении снимка выясните причину до изменения данных. Эта процедура
не удаляет volumes, базы, таблицы или записи.

## Сборка и остановка

После `pnpm build` запустите в двух терминалах:

```bash
pnpm --filter @furniture-delivery/api start
pnpm --filter @furniture-delivery/web start
```

Dev-процессы останавливаются `Ctrl+C`. PostgreSQL останавливается без удаления volume:

```bash
docker compose --profile test stop
```

Не удаляйте volume для повторного запуска. Изменение пароля в `.env` не меняет пароль
уже инициализированной PostgreSQL: используйте прежние локальные credentials либо
измените пароль штатной PostgreSQL-командой.

Фактические результаты проверок и ограничения окружения — в
[docs/PROGRESS.md](docs/PROGRESS.md), выбор версий — в
[docs/DECISIONS.md](docs/DECISIONS.md). M2 запускается только отдельным заданием.
