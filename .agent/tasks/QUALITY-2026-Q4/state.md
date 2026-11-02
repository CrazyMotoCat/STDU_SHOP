# QUALITY-2026-Q4 — состояние

**Дата:** 2 ноября 2026 (Asia/Vladivostok)

**Текущий этап:** Q0-01 завершён как owner-review package; Playwright acceptance, independent focused re-review, local gates и exact-head hosted CI прошли. PR #30 остаётся Draft. Далее — отдельный Q0-03 worktree от свежего `origin/main`.
**Статус:** `REVIEW_REQUIRED`

## Репозиторий и доставка

- Исторический снимок аудита: `55281be07e8d6938c8b1a6ba6988e188b7fc642b`.
- Текущий `origin/main` после свежего fetch: `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`; совпадает с базой перепроверки 30 октября.
- Рабочая ветка: `codex/quality-q0-01-supplier-idempotency`, создана от `origin/main` в изолированном worktree `C:\Users\mvideo\.codex\worktrees\quality-q0-01-supplier-idempotency\SHOP STDU`.
- Режим доставки: `REVIEW_REQUIRED`; merge запрещён задачей. Production и миграции не затрагивались.
- PR: [#30](https://github.com/CrazyMotoCat/STDU_SHOP/pull/30), base `main` (`336ec8ed`), head `codex/quality-q0-01-supplier-idempotency`; PR создан как Draft. Проверять только актуальные проверки последнего SHA PR HEAD.
- Исходный checkout `codex/r1-006b-catalog-import` оставлен без изменений. PR #28 и его worktree не редактировались.

## Перепроверка

Все AUD-001…AUD-035 перепроверены по текущему `main`. Их актуальные статусы, evidence, ограничения доказательств и минимальные DoD находятся в `findings-registry.md`. Новых подтверждённых P0/P1 в этой группе не найдено. Важно не считать статические/синтетические результаты доказательством production-инцидента.

## Q0-01

- Root cause подтверждён: `SupplierWorkspace` создавал новый `Idempotency-Key` на каждый mutation request; submit создания поставщика не удерживал ключ и тело между повторами.
- Browser acceptance выявила связанный UI-дефект: после входа оставался login-bound CSRF token, непригодный для staff-bound supplier mutation. После успешного входа UI теперь запрашивает session-bound CSRF token; API/auth contracts и backend не менялись.
- При начавшемся запросе без подтверждённого результата UI показывает явное предупреждение неопределённого исхода и сохраняет ключ/хэш для same-body retry. Определённый клиентский отказ (<500, кроме `IDEMPOTENCY_KEY_REUSED`) очищает попытку.
- Изменение ограничено Staff UI и регрессионной проверкой runtime API. OpenAPI, DTO, RBAC, схема/миграции, серверный алгоритм idempotency, audit и security boundaries не менялись.
- Клиент хранит в `sessionStorage`, привязанном к ID сотрудника, только случайный ключ и SHA-256 отпечаток тела; исходное тело поставщика не сохраняется.
- При повторе того же тела повторно используется тот же ключ. При изменённом теле незавершённой операции пользователь должен явно подтвердить новую операцию.
- RED зафиксирован до исправления: 2 из 4 новых helper-тестов падали на повторе ключа и тихой замене операции. После исправления все 4 проходят.
- Runtime acceptance использует disposable PostgreSQL, реальный Next.js Staff UI и реальный API. Playwright `route.fetch()` получает фактический upstream 201/body после commit, затем `route.abort('connectionreset')`; browser фиксирует `requestfailed` и не получает HTTP success response. После reload и повторного входа тот же ключ/тело воспроизводят прежнюю запись. Отдельный сценарий проверяет double-click, changed-body cancel/confirm и новый ключ.
- `pnpm test:r1-007b`: PASS 14/14 в двух последовательных запусках (12 API/PostgreSQL сценариев + 2 browser acceptance); disposable DB sentinel сохранён в обоих.
- `pnpm typecheck`, `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm supplier:contract:check`, `pnpm contract:check`, `git diff --check`: PASS на Q0-01 code commit `36abf7d738299e0db74e4974112b75b1fd883107`.
- Hosted exact-head CI: PASS, run [#41427550204](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41427550204), check `quality-and-integration`, SHA `36abf7d738299e0db74e4974112b75b1fd883107`. PR remains Draft and unmerged.
- Первый независимый review выявил P2 mismatch в тестовом proxy; исправлено на реальный upstream response + client-side connection abort. Focused re-review: PASS, замечание закрыто, иных замечаний нет.

## Следующие действия

1. Зафиксировать checkpoint Q0-01 и проверить documentation commit на точном HEAD CI.
2. Начать отдельный Q0-03 worktree/branch от заново подтверждённого `origin/main`.
3. Оставить оба PR в Draft; merge и production не выполнять.
