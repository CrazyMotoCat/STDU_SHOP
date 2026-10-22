# R1-002 — матрица полномочий

**Статус: PROPOSED. Версия: 0.1.0-proposed.**

Машиночитаемый источник: [R1-002-rbac-matrix.json](R1-002-rbac-matrix.json). Требования ADM-01/03, решения №16,49,50,55; ADR-003. Роль — данные, её имя не участвует в allow/deny. Матрица не регистрирует права будущих модулей.

| Permission                    | Действие                                                                                  | bootstrap-admin | access-admin | seller-maintainer | audit-reader |
| ----------------------------- | ----------------------------------------------------------------------------------------- | --------------- | ------------ | ----------------- | ------------ |
| staff.users.read              | List employees and current role ids; no credentials/sessions.                             | да              | да           | —                 | —            |
| staff.users.create            | Create active employee with initial secret and forced password change; no roles implicit. | да              | да           | —                 | —            |
| staff.users.status.write      | Block/unblock another employee; no self state changes.                                    | да              | да           | —                 | —            |
| staff.sessions.revoke         | Revoke all sessions of another employee.                                                  | да              | да           | —                 | —            |
| staff.roles.read              | Read role definitions and permission registry.                                            | да              | да           | —                 | —            |
| staff.roles.write             | Create/rename/archive roles; no permission or assignment implicit.                        | да              | да           | —                 | —            |
| staff.roles.permissions.write | Replace permission set of a role not assigned to the caller; delegation ceiling applies.  | да              | да           | —                 | —            |
| staff.roles.assign            | Assign/remove another employee role; delegation ceiling applies.                          | да              | да           | —                 | —            |
| sellers.read                  | Read our own seller directory; no customer data.                                          | да              | —            | да                | —            |
| sellers.write                 | Create/edit/transition own seller directory; no quote/tax-calculation authority.          | да              | —            | да                | —            |
| audit.read                    | Read sanitized global security/admin audit.                                               | да              | —            | —                 | да           |
| files.metadata.read           | Read authorized file metadata only; no download authority.                                | да              | —            | —                 | —            |

## Обязательные проверки

1. Templates are mutable ordinary role records, not special names, enums or wildcard bypasses. Only bootstrap-admin instantiated initially; others optional explicit admin actions.
2. Effective permissions = distinct union of registered codes in ACTIVE roles assigned to ACTIVE user. Blocked/expired/revoked/stale-version sessions grant none.
3. No self assignment/removal or self block/unblock; no permission-set edits of any role assigned to caller.
4. Grant ceiling: added permissions and every permission of newly assigned role must be subset of current actor effective permissions; staff.roles.assign distinct from staff.roles.permissions.write.
5. Сохраняются оба инварианта: хотя бы один пригодный ACTIVE control-admin с union всех восьми `controlAdminRequiredPermissions` и хотя бы один пригодный ACTIVE full-admin с union всех 12 `fullAdminProtectedPermissions`. Union вычисляется отдельно для каждого сотрудника по его ACTIVE ролям; нельзя объединять права разных сотрудников. Пригодность: валидный Argon2id hash по политике и passwordChangeRequired=false; действующая сессия не требуется. Один full-admin удовлетворяет обоим инвариантам. Имя роли не даёт полномочий.
6. All access is GLOBAL to one internal seller business in B; future customer memberships and seller scopes must be introduced explicitly. No trust in caller-supplied seller ownership.
7. File metadata: files.metadata.read AND (owner is caller OR (visibility=INTERNAL AND a typed seller link exists AND caller has sellers.read)); PRIVATE always owner-only. Unknown/forbidden object returns 404 after action permission passes.
8. No engineering/quote/price/catalog permissions registered or inherited here.
9. Auth/me/logout/CSRF and forced own password change require session policy, not an administrator permission.

Шаблон `access-admin` (прежнее предлагаемое имя `access-operator`) — полноценный администратор управления доступом со всеми восемью staff actions. Он не является полнофункциональным администратором R1-002 без оставшихся четырёх действий в собственном effective union. Шаблоны остаются обычными изменяемыми ролями.

Защищённый первоначальный набор зафиксирован явно: `staff.users.read`, `staff.users.create`, `staff.users.status.write`, `staff.sessions.revoke`, `staff.roles.read`, `staff.roles.write`, `staff.roles.permissions.write`, `staff.roles.assign`, `sellers.read`, `sellers.write`, `audit.read`, `files.metadata.read`. Это не вычисляемый список всех когда-либо зарегистрированных permissions.

## Транзакции, отзыв и гонки

Сначала валидная сессия/ACTIVE + passwordChangeRequired policy; затем именованное действие; затем object policy; затем expectedVersion и инварианты. Anonymous -> 401 AUTH_REQUIRED, без action -> 403 FORBIDDEN, объект недоступен/не существует -> одинаковый 404 NOT_FOUND. Проверка права выполняется до lookup для предотвращения enumeration. Состояние сотрудников/ролей не принимается от клиента как факт.

Смена UserRole, RolePermission, состояния роли/пользователя, пароль/recovery: pg_advisory_xact_lock(1398031445, 2), actor revalidation под lock, строки пользователей по UUID, роли по UUID, затем сессии; использовать READ COMMITTED и взять advisory lock до чтения actor/invariant state, выполнить mutation, пересчитать оба набора пригодных администраторов по результирующим данным и вставить SUCCESS AuditEvent только после успешной проверки в той же транзакции. Все writers UserRole/RolePermission, статуса StaffUser/Role, passwordHash/passwordChangeRequired и будущих изменений registry используют этот же lock; обычный rehash тоже не обходит его. Обе проверки обязательны для block, снятия назначения, замены permissions, изменения состояния роли и любого другого изменения прав/пригодности. На отказе409 LAST_ADMIN_REQUIRED откатываются бизнес-строки, версии/authVersion и изменения сессий; SUCCESS audit отсутствует. Обязательный DENIED audit с тем же requestId и причиной LAST_ADMIN_REQUIRED пишется отдельно после rollback; его сбой ->503, не ложный успех. Конкурентный writer ждёт lock и читает уже committed state предшественника, поэтому две транзакции не могут совместно убрать обоих full-admin. У Role archive нет назначений; снять назначения отдельными явными действиями. Матрица меняется только RolePermission command, не через role PATCH.

Для каждого затронутого пользователя увеличить authVersion и отозвать ВСЕ его активные StaffSession в той же транзакции. При назначении/снятии роли затронут target; при замене permissions — все UserRole этой роли; при block/unblock/password — пользователь. Новая сессия после обычного login имеет новый токен; прежняя не восстанавливается при unblock. Никаких кешированных положительных разрешений в Redis/UI. Смена имени роли не меняет полномочий и не отзывает сессии. Сессия вызывающего не сохраняется, если она попала в затронутый набор; self-edit restrictions снижают этот риск, но не заменяют invalidate.

Новый сотрудник passwordChangeRequired=true не считается ни пригодным control-admin, ни full-admin, пока не сменит пароль. Единственный действующий admin не может снять свой статус/роль или редактировать собственный bundle. Чтобы изменить его bundle через API, создать второго сотрудника, выдать ему все 12 защищённых прав (допустимо несколькими ролями), сменить им первоначальный пароль; затем менять первого при сохранении второго full-admin. Одних восьми staff прав недостаточно. Это предлагаемый административный safety gate, а не независимое инженерное/финансовое согласование. Восстановление пароля через CLI не выдаёт новых permissions и не обходит status/last-admin checks.

Назначение роли не требует прав на изменение её состава; изменение состава не даёт права назначать. Оба требуют grant ceiling. Удаление из чужой роли снижает права, но тоже запрещено для bundle, назначенного actor, и обязано сохранять обоих администраторов; отсутствие удаляемого разрешения у actor не позволяет удалить его у последнего full-admin; право edit role не подразумевает права audit/seller/files. Ошибки: 409 LAST_ADMIN_REQUIRED, 403 SELF_PRIVILEGE_CHANGE_FORBIDDEN/GRANT_CEILING_EXCEEDED, 409 ROLE_IN_USE, 409 VERSION_CONFLICT. Вся поверхность/DTO/точные ответы — OpenAPI.

## Расширение

Позднее register permission code + отказ по умолчанию + object policy + negative tests + явное изменение роли. Добавление будущих catalog/engineering/quote actions не расширяет защищённый набор автоматически; включение в fullAdminProtectedPermissions требует осознанного версионированного изменения контракта с утверждением владельцем. Никаких wildcard staff.*, isAdmin bypass, автоматического включения engineering.approve/quote.approve/catalog.publish. Собственные ООО/ИП — один внутренний бизнес в B; разграничение отдельных сотрудников по seller сейчас не заявляется. В будущем scope хранится на назначении/членстве и проверяется сервером целиком, нельзя смешивать seller и permission из разных назначений. Это потребует отдельного утверждённого изменения схемы.

## Приватность ответов команд

Все не-auth мутации возвращают только id/version acknowledgment (MutationResponse в OpenAPI). Отдельное право записи не выдаёт email/displayName/roleIds, состав роли или реквизиты продавца; полный DTO только по соответствующему read endpoint с read permission. Self Me и собственная password rotation могут вернуть свою Me.
