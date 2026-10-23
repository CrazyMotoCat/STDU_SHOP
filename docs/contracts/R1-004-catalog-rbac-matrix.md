# R1-004 — матрица полномочий каталога

**Статус: PROPOSED. Версия: 0.1.0-proposed.** Машиночитаемый реестр: [R1-004-catalog-rbac-matrix.json](R1-004-catalog-rbac-matrix.json). R1-002 RBAC 1.0.0 и 12 защищённых полномочий остаются FROZEN без изменений.

| Permission                         | Область доступа                                      | Типичное назначение               |
| ---------------------------------- | ---------------------------------------------------- | --------------------------------- |
| `catalog.references.read`          | Активные бренды, категории, определения атрибутов    | чтение справочников               |
| `catalog.products.read`            | Внутренние product roots и история редакций          | редактор/ревьюер                  |
| `catalog.products.write`           | Создание продукта и append-only draft revisions      | редактор                          |
| `catalog.products.submit`          | Отправка одной draft revision на проверку            | редактор                          |
| `catalog.products.publish`         | Публикация, возврат или отказ одной pending revision | уполномоченный reviewer           |
| `catalog.products.archive`         | Архивирование продукта с отзывом публичного pointer  | уполномоченный редактор           |
| `catalog.categories.write`         | Категории: создание, изменение дерева, архив         | менеджер справочника              |
| `catalog.brands.write`             | Бренды: создание, изменение, архив                   | менеджер справочника              |
| `catalog.attributes.write`         | Типизированные определения атрибутов                 | менеджер справочника              |
| `catalog.products.relations.write` | Ручные accessory/compatible relations                | редактор                          |
| `catalog.products.media.write`     | Метаданные медиа на draft revision                   | редактор с доступом к FileVersion |
| `catalog.products.documents.write` | Метаданные документов на draft revision              | редактор с доступом к FileVersion |

Точные пары HTTP method/path для каждого permission закреплены в JSON `actions` и сверяются с OpenAPI. Для справочников доступны GET коллекции и записи; для продуктов — список, карточка и чтение метаданных связей/файлов. Архивирование оформлено отдельным POST под соответствующим write permission.

Разрешения разделены по действиям; `catalog.admin`, wildcard и проверка имени роли отсутствуют. Создание/редактирование продукта не выдаёт право submit/publish/archive. Право submit не публикует автоматически; publish проверяется на каждом решении отдельным серверным permission.

Для чтения или привязки `FileVersion` нужны одновременно permission каталога и существующие `files.metadata.read` с object-level policy R1-002. Ссылка FK не передаёт доступ; публичный URL/download не создаётся.

## Первое предоставление новых разрешений

В R1-002 ни одна роль не содержит catalog permissions. R1-004 migration добавляет только строки `Permission`; `RolePermission` не засеивается и шаблоны `bootstrap-admin`, `access-admin`, `seller-maintainer`, `audit-reader` не расширяются автоматически. Все новые операции закрыты default deny.

Предлагается один локальный операторский запуск `catalog:permissions:initialize`, только после отдельного утверждения владельца вне приложения. Он принимает UUID целевого сотрудника, обязательную ссылку на решение владельца и метку оператора; ссылка — внешний ticket/reference label длиной 1..80 по шаблону `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$`, без секретов и персональных данных. Формат только проверяет запись; команда не разрешает ссылку и не доказывает одобрение. Целевой сотрудник должен быть ACTIVE, иметь пригодный пароль без forced-change и уже обладать четырьмя RBAC-management actions (`staff.roles.read/write/permissions.write/assign`). Команда в одной транзакции создаёт обычную роль без специальной семантики имени и назначает её одному этому сотруднику. Она назначает ровно pinned набор из 12 `catalogPermissionCodes` в JSON контракта 0.1.0-proposed и завершается fail-closed, если Permission registry отличается; будущие codes не попадут в роль автоматически, а изменённый набор потребует утверждённого обновления контракта. Команда пишет `catalog.permissions.initialized` как OPERATOR audit. Ни роль bootstrap-admin, ни access-admin не меняется.

Команда выполняется не больше одного раза: сериализуется существующим `pg_advisory_xact_lock(1398031445, 2)`, проверяет оба frozen last-admin инварианта до/после, и повторно не запускается при наличии успешного action в append-only audit. Она не доступна по HTTP, не входит в migration/startup/CI и не является повторяемым обходом. После неё дальнейшее назначение и делегирование выполняются обычным R1-002 RBAC API с неизменённым grant ceiling. Ни один из 12 protected permission автоматически не попадает в новые защищённые наборы.

Audit actorKind — `OPERATOR`, `operatorLabel` и `approvalReference` являются отметкой ручного процесса, не криптографическим доказательством личности или одобрения. Производственное выполнение команды требует отдельного операционного разрешения и не следует из одобрения/merge кода.

## Audit registry extension

Новый [R1-004 audit registry](R1-004-catalog-audit-registry.json) дополняет допустимые action/entity codes отдельным append-only артефактом. В будущей migration меняется PostgreSQL validation function/allowlist добавлением каталожных значений, но `docs/contracts/R1-002-audit-registry.json`, R1-002 OpenAPI/data/RBAC fixtures и исторические actions не редактируются и не удаляются. События несут ID, actor, requestId, revision IDs и список полей; полный текст карточки, файлы, секреты, поставщик и закупочные данные не копируются в changes JSON.

## Вопрос владельцу

Пакет OD-004A-04/05 просит подтвердить именно полный набор permissions, одноразовую операторскую процедуру, требования к target user и то, что она не ослабляет обычный grant ceiling и frozen last-admin проверки. Если начальная роль затем потеряет все catalog permissions, это потребует новой отдельно утверждённой recovery-процедуры; автоматическое повторное provision запрещено.
