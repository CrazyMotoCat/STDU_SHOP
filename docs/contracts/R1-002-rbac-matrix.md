# R1-002 — матрица полномочий

**Статус: PROPOSED. Версия: 0.1.0-proposed.**

Машиночитаемый источник: [R1-002-rbac-matrix.json](R1-002-rbac-matrix.json). Требования ADM-01/03, решения №16,49,50,55; ADR-003. Роль — данные, её имя не участвует в allow/deny. Матрица не регистрирует права будущих модулей.

| Permission                    | Действие                                                                                  | bootstrap-admin | access-operator | seller-maintainer | audit-reader |
| ----------------------------- | ----------------------------------------------------------------------------------------- | --------------- | --------------- | ----------------- | ------------ |
| staff.users.read              | List employees and current role ids; no credentials/sessions.                             | да              | да              | —                 | —            |
| staff.users.create            | Create active employee with initial secret and forced password change; no roles implicit. | да              | да              | —                 | —            |
| staff.users.status.write      | Block/unblock another employee; no self state changes.                                    | да              | да              | —                 | —            |
| staff.sessions.revoke         | Revoke all sessions of another employee.                                                  | да              | да              | —                 | —            |
| staff.roles.read              | Read role definitions and permission registry.                                            | да              | да              | —                 | —            |
| staff.roles.write             | Create/rename/archive roles; no permission or assignment implicit.                        | да              | да              | —                 | —            |
| staff.roles.permissions.write | Replace permission set of a role not assigned to the caller; delegation ceiling applies.  | да              | да              | —                 | —            |
| staff.roles.assign            | Assign/remove another employee role; delegation ceiling applies.                          | да              | да              | —                 | —            |
| sellers.read                  | Read our own seller directory; no customer data.                                          | да              | —               | да                | —            |
| sellers.write                 | Create/edit/transition own seller directory; no quote/tax-calculation authority.          | да              | —               | да                | —            |
| audit.read                    | Read sanitized global security/admin audit.                                               | да              | —               | —                 | да           |
| files.metadata.read           | Read authorized file metadata only; no download authority.                                | да              | —               | —                 | —            |

## Обязательные проверки

1. Templates are mutable ordinary role records, not special names, enums or wildcard bypasses. Only bootstrap-admin instantiated initially; others optional explicit admin actions.
2. Effective permissions = distinct union of registered codes in ACTIVE roles assigned to ACTIVE user. Blocked/expired/revoked/stale-version sessions grant none.
3. No self assignment/removal or self block/unblock; no permission-set edits of any role assigned to caller.
4. Grant ceiling: added permissions and every permission of newly assigned role must be subset of current actor effective permissions; staff.roles.assign distinct from staff.roles.permissions.write.
5. Last control administrator = ACTIVE user with passwordChangeRequired=false whose ACTIVE role union contains all controlAdminRequiredPermissions. At least one must remain after every relevant transaction.
6. All access is GLOBAL to one internal seller business in B; future customer memberships and seller scopes must be introduced explicitly. No trust in caller-supplied seller ownership.
7. File metadata: files.metadata.read AND (owner is caller OR (visibility=INTERNAL AND a typed seller link exists AND caller has sellers.read)); PRIVATE always owner-only. Unknown/forbidden object returns 404 after action permission passes.
8. No engineering/quote/price/catalog permissions registered or inherited here.
9. Auth/me/logout/CSRF and forced own password change require session policy, not an administrator permission.

## Транзакции, отзыв и гонки

Сначала валидная сессия/ACTIVE + passwordChangeRequired policy; затем именованное действие; затем object policy; затем expectedVersion и инварианты. Anonymous -> 401 AUTH_REQUIRED, без action -> 403 FORBIDDEN, объект недоступен/не существует -> одинаковый 404 NOT_FOUND. Проверка права выполняется до lookup для предотвращения enumeration. Состояние сотрудников/ролей не принимается от клиента как факт.

Смена UserRole, RolePermission, состояния роли/пользователя, пароль/recovery: pg_advisory_xact_lock(1398031445, 2), actor revalidation под lock, строки пользователей по UUID, роли по UUID, затем сессии; выполнить mutation, проверить существование хотя бы одного control-admin и вставить AuditEvent в той же транзакции. На отказе transaction rollback; DENIED audit отдельно без изменения бизнес-строк. У Role archive нет назначений; снять назначения отдельными явными действиями. Матрица меняется только RolePermission command, не через role PATCH.

Для каждого затронутого пользователя увеличить authVersion и отозвать ВСЕ его активные StaffSession в той же транзакции. При назначении/снятии роли затронут target; при замене permissions — все UserRole этой роли; при block/unblock/password — пользователь. Новая сессия после обычного login имеет новый токен; прежняя не восстанавливается при unblock. Никаких кешированных положительных разрешений в Redis/UI. Смена имени роли не меняет полномочий и не отзывает сессии. Сессия вызывающего не сохраняется, если она попала в затронутый набор; self-edit restrictions снижают этот риск, но не заменяют invalidate.

Новый сотрудник passwordChangeRequired=true не считается последним control-admin, пока не сменит пароль. Единственный действующий admin не может снять свой статус/роль или редактировать собственный bundle. Чтобы изменить его bundle через API, создать второго сотрудника, выдать только необходимые существующие права, сменить им первоначальный пароль; затем второй admin изменяет первого. Это предлагаемый административный safety gate, а не независимое инженерное/финансовое согласование. Восстановление пароля через CLI не выдаёт новых permissions и не обходит status/last-admin checks.

Назначение роли не требует прав на изменение её состава; изменение состава не даёт права назначать. Оба требуют grant ceiling. Удаление из чужой роли снижает права, но тоже запрещено для bundle, назначенного actor; право edit role не подразумевает права audit/seller/files. Ошибки: 409 LAST_ADMIN_REQUIRED, 403 SELF_PRIVILEGE_CHANGE_FORBIDDEN/GRANT_CEILING_EXCEEDED, 409 ROLE_IN_USE, 409 VERSION_CONFLICT. Вся поверхность/DTO/точные ответы — OpenAPI.

## Расширение

Позднее register permission code + отказ по умолчанию + object policy + negative tests + явное изменение роли. Никаких wildcard staff.*, isAdmin bypass, автоматического включения engineering.approve/quote.approve/catalog.publish. Собственные ООО/ИП — один внутренний бизнес в B; разграничение отдельных сотрудников по seller сейчас не заявляется. В будущем scope хранится на назначении/членстве и проверяется сервером целиком, нельзя смешивать seller и permission из разных назначений. Это потребует отдельного утверждённого изменения схемы.

## Приватность ответов команд

Все не-auth мутации возвращают только id/version acknowledgment (MutationResponse в OpenAPI). Отдельное право записи не выдаёт email/displayName/roleIds, состав роли или реквизиты продавца; полный DTO только по соответствующему read endpoint с read permission. Self Me и собственная password rotation могут вернуть свою Me.
