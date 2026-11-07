# WB-LAB-01 — подготовка стенда VIS-CAT-02C

Статус **E0A_CLOSED / E0B_READY_FOR_OWNER_DECISION**. Владелец принял E0a Runtime на `6637080541348b95623641464f4de1add07f0fb4`: E0A_RUNTIME_PASS, Quality PASS, FAST/FULL SUCCESS, cleanup CONFIRMED. Основа — [план #52](https://github.com/CrazyMotoCat/STDU_SHOP/pull/52) и [mock-модель #53](https://github.com/CrazyMotoCat/STDU_SHOP/pull/53). PR #54 остаётся Draft, merge не разрешён. E0b–E5 NOT_RUN; VDS_equivalence NOT_PROVEN. Повторять E0a не требуется.

Результаты и ограничения E0a — в [RUNTIME-E0A.md](RUNTIME-E0A.md); подготовка PostgreSQL-проверки — в [RUNTIME-E0B.md](RUNTIME-E0B.md). В текущей задаче E0b на WB не запускается.

## Отклонения и бюджет

WB заменяет отдельную VM с отдельным 4 GiB ext4-устройством. Root и /mnt/data разделяют устройство eMMC. Новые Docker local volumes на этом устройстве дают разделение путей и владения, а не отдельную границу I/O или ёмкости. Успех на WB относится к этому ядру, mount options, драйверу и eMMC. Будущий VDS остаётся NOT_PROVEN. Метаданные монтирования, cache/flush и сопоставимость с VDS измеряются отдельно.

| Сервис     |     RAM |  CPU | PID | Назначение                                                   |
| ---------- | ------: | ---: | --: | ------------------------------------------------------------ |
| PostgreSQL | 192 MiB | 0.50 |  32 | Новая синтетическая БД, 6 connections, shared_buffers 24 MB  |
| Controller |  64 MiB | 0.25 |  16 | Будущий coordinator, сейчас команда проверки образа          |
| Worker     | 128 MiB | 0.75 |  16 | Один decode job, 8 MiB scratch                               |
| Verifier   | 128 MiB | 0.75 |  16 | Отдельный UID и отдельный запуск после worker, 8 MiB scratch |

Текущий E0a Compose содержит только PostgreSQL и controller с суммарным потолком 256 MiB. Для будущей схемы сумма четырёх потолков составляет 512 MiB. При последовательной работе worker/verifier активный потолок 384 MiB, оставшиеся 128 MiB служат резервом для хостовой части запуска и мониторинга. Измерения накладных расходов Docker и cgroup peak на WB ещё нужны. Для всех контейнеров memory-swap равен memory. Concurrency 1. Порог запуска и остановки — MemAvailable 768 MiB и 4 GiB свободного места. Предлагаемый предел записи на серию — PG 128 MiB, media 64 MiB и evidence 32 MiB. Docker logs до 2 MiB на контейнер. Предельные размеры каталогов проверять отдельно от общего watermark. Изображения в локальном registry/cache и их скачивание измерять до серии отдельно.

Потолок 128 MiB для кодека выбран как стартовый профиль на основании x86-64 измерений 02B, где worker достигал 85 MiB RSS. RSS на x86-64 не подтверждает cgroup peak на ARM64. Первый декод — маленький синтетический fixture из 02B. Превышение ресурсов останавливает серию. Worker и verifier используют тот же кодек в отдельных процессах. Разнообразие декодеров остаётся NOT_PROVEN.

## Host preflight — описание принятой проверки

Выполнить из checkout PR на подтверждённой локальной консоли WB. Владелец подтвердил режим 0700 для каталога `/mnt/data/stdu-wb-lab-01`. Preflight также проверяет владельца, пустоту каталога и фактические параметры монтирования.

```sh
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY \
  python3 -B experiments/wb-lab-01/preflight.py be35948b-8382-4d17-b83e-9f4ab90b9954
```

Preflight сверяет подтверждённый daemon ID по `GET /info` через `/var/run/docker.sock`. Признаки MemoryLimit, SwapLimit, CpuCfsQuota, CpuCfsPeriod и PidsLimit берутся из Engine API. У Docker CLI template на WB нет CPU CFS полей. Запрос использует timeout сокета 5 секунд и ограничение ответа 1 MiB. Неуспешный ответ, отсутствующий признак и несовпадение версий Engine 29.9.2 или Compose 5.6.1 дают BLOCKED.

Принятый JSON сохранён в приватном evidence. Для будущего отдельного этапа агент выполняет свежий preflight самостоятельно после сохранения предыдущего evidence. `E0A_HOST_METADATA_PASS` подтверждает метаданные хоста и заявленную Docker поддержку лимитов. Сам host-collector оставляет `resource_ownership`, `container_cgroup_limits` и `E0b` как `NOT_RUN`: фактические runtime-утверждения E0a доказаны отдельным принятым запуском, а не метаданными хоста. Compose в этом пакете используется для рендера и статической проверки. В нём доступны только PostgreSQL и controller. Валидатор отклоняет добавление decoder-сервисов. Для будущего запуска декодеров предусмотрен controller с одним слотом, удерживаемым до подтверждённого удаления предыдущего контейнера. E0b–E5 ожидают Quality PASS и отдельного разрешения.

ARM64 codec build определён в Dockerfile.codec. Для будущей сборки использовать отдельный каталог wheels с wheel Pillow из requirements, полученным по HTTPS и сверенным с SHA-256. Запускать сборку из корня репозитория с `docker build --network none --platform linux/arm64 --build-context wheels=<путь> -f experiments/wb-lab-01/Dockerfile.codec -t stdu-wb-lab-codec:arm64 .`. Перед workload ledger должен закрепить локальный image ID и подтвердить Architecture. Native build и boot PostgreSQL под UID 999 на WB остаются NOT_RUN.

## Поэтапное исполнение

Каждый запуск получает UUID, Compose project `wb-lab-01-<UUID>` и label `stdu.wb-lab-01.run=<UUID>`. Эксперимент использует новый run directory с отдельными results и локальным PG secret. Secret доступен только PostgreSQL через read-only mount. Controller получает в отдельной стадии ограниченные лабораторные credentials, без bootstrap прав. Профиль E0 не содержит запускаемых decoder-сервисов. Сеть БД — private internal, без ports. В будущем worker/verifier запускаются по одному через ограниченный stdin/stdout, с network none и без mounted volumes и secrets.

| Этап   | Отдельное действие и критерий                                                                                                                                                                            | Evidence                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| E0a    | Проверить runtime, лимиты, точные новые names/labels и ID, source каждого mount и его устройство. Использовать явный локальный Docker socket. Отклонить любой уже существующий объект с ожидаемым именем | Redacted inspect, ledger, cgroup v2, mount identity           |
| E0b    | После E0a инициализировать только подтверждённые тома. Проверить уникальные media/DB sentinels, имя БД, экспериментальную схему и ограниченную роль                                                      | Sentinel hashes, SQL identity, readiness timing               |
| E1     | До 4 коротких попыток эксклюзивной записи, sync и no-replace promotion в одном устройстве                                                                                                                | Порядок операций, device/inode, hashes, latency               |
| E2     | До 6 последовательных попыток CAS/generation и expiry по clock_timestamp под row lock, включая потерю ответа COMMIT                                                                                      | Lock/statement duration, commit status, hashes                |
| E3/E3b | До 10 коротких попыток с управляемым прерыванием процесса и имитацией отказов I/O/БД. Проверить отсутствие неверных ссылок и сохранность чужих объектов                                                  | Barrier events, process exit, recovery timing, DB snapshots   |
| E4a    | До 8 коротких canary probes, включая positive control. Проверить отсутствие IPv4/IPv6 TCP/UDP/DNS egress и чужих mounts                                                                                  | Namespace, routes, packet/receive evidence, независимое ревью |
| E5     | Отдельное решение после измерений E0–E4a. Оценить ресурсный запас и лимит серии, сохраняя concurrency 1 до согласования                                                                                  | RSS/cgroup peak, CPU, I/O, latency, PG locks                  |

Для будущего запуска controller проверяет пороги до работы, а внешний watchdog опрашивает их не реже раза в секунду. На каждый workload действует общий deadline 30 секунд, на подтверждение остановки — 10 секунд. При низкой памяти/диске, OOM, неизвестном Docker state или ownership серия останавливается. Наблюдение и остановка должны идти по закреплённому ID с проверкой метки и подтверждением inspect, как в 02B-FIX. Без реализованного watchdog запуск заблокирован. Сохранять RSS, cgroup memory.peak/cpu.stat/io.stat, host MemAvailable/disk free, monotonic latency, PostgreSQL locks и recovery events в run-specific results.

Cleanup использует только записанные IDs и точные volume names текущего run, с повторной сверкой label/ledger и подтверждением отсутствия писателя. При неопределённости выдаётся CLEANUP_UNCONFIRMED, ресурс и evidence остаются для расследования. OPS-TEST-02 и чужие mounts исключены. Host formatting, реальный ENOSPC, power loss, reboot, изменение firewall и E4b находятся вне профиля.

The [E0a runtime package](RUNTIME-E0A.md) describes the separate, owner-gated container/volume probe and its evidence contract.
