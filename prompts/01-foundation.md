Прочитай AGENTS.md, docs/PROJECT_SPEC.md, docs/DOMAIN_RULES.md,
docs/MILESTONES.md, docs/DECISIONS.md и docs/PROGRESS.md.

Реализуй только M1 — запускаемую основу проекта доставки и сборки мебели.
Не останавливайся на предложении архитектуры: создай файлы, установи зависимости,
выполни доступные проверки и исправь обнаруженные ошибки. Не переходи к M2.

Сначала осмотри рабочую папку и Git status. Сохрани существующие пользовательские изменения.
Проверь версии инструментов и актуальную совместимость зависимостей по официальным
источникам/метаданным. Выбери поддерживаемый Node.js LTS, совместимые стабильные версии
Next.js, NestJS, TypeORM и pnpm, зафиксируй версии и lockfile. Не выбирай prerelease автоматически.

Нужно получить:

1. pnpm monorepo с apps/web (Next.js App Router), apps/api (NestJS),
   packages/contracts (browser-safe contracts). TypeScript strict.
   Достаточно pnpm workspaces, без Turborepo, микросервисов и лишних пакетов.
2. Docker Compose для PostgreSQL с persistent volume и healthcheck.
   Порт БД и API по умолчанию доступны только локально; secrets не коммитятся.
   Frontend локально на 3000, backend на 3001, если порты свободны.
3. TypeORM DataSource и миграции, synchronize:false.
   Первая сущность Crew: UUID id, unique stable code, name, active,
   workEnvironment INDOOR/OUTDOOR, serviceArea, createdAt, updatedAt.
   Миграция с ограничениями и отдельный идемпотентный seed 10 вымышленных команд.
   Seed не сбрасывает данные при повторном запуске и не работает в production.
   Бизнес-CRUD и пользователей пока НЕ реализовывать.
4. GET /api/health с реальной проверкой SELECT 1.
   HTTP 200 при доступности БД, HTTP 503 при недоступности; без секретов и stack traces в ответе.
   Проверка недоступности должна работать, пока процесс API жив, а не имитироваться мок-ответом.
5. Базовую responsive-страницу Next.js с названием проекта и состоянием backend/DB,
   полученным через API. Loading, error и retry обязательны. Не показывать fake success.
   Настрой корректные API origin, dev proxy/CORS и env loading для обоих приложений.
   Приватные переменные не должны попадать в client bundle.
6. Контракт health в packages/contracts, реально используемый web и api.
   Не создавать DTO и entities всех будущих модулей заранее.
7. Настройки lint, formatting, typecheck, unit tests и отдельный integration test
   на выделенной тестовой PostgreSQL БД. Не очищать основную development БД для теста.
   Проверить миграцию и повторяемость seed. Проверить health: success и DB unavailable.
8. Корневые команды: pnpm dev, pnpm lint, pnpm typecheck, pnpm test,
   pnpm test:integration, pnpm build, pnpm db:migrate, pnpm db:seed.
   Команды должны выполнять настоящую работу, без echo/passWithNoTests для имитации успеха.
9. .env.example без рабочих секретов, .gitignore и README с точной последовательностью
   локального запуска, применением миграций, seed, проверками и остановкой сервисов.
   Загрузка env должна одинаково работать в сервере, migration CLI, seed и тестах.

Не добавлять сейчас: auth, пользователей, orders, payments, appointments,
календарь, WebSockets, uploads, подписи, production deploy.

Проверь установку, lint, typecheck, unit tests, integration tests и build.
Запусти приложение и проверь frontend→API→DB, если среда позволяет.
Если Docker/сеть/браузер недоступны, явно укажи BLOCKED, не подменяй БД на SQLite
и не утверждай, что проверки прошли. Дай точные команды локальной проверки.

Обнови docs/PROGRESS.md фактическими результатами и docs/DECISIONS.md выбранными версиями.
В финальном ответе по-русски покажи структуру, ключевые изменения, команды и результаты,
известные ограничения и порядок запуска. Не объявляй M1 полностью принятым при BLOCKED-проверках.
Не выполняй commit/push/deploy автоматически.
