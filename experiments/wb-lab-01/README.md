# WB-LAB-01 — подготовка стенда VIS-CAT-02C

Статус **BLOCKED для исполнения**. Профиль основан на [плане #52](https://github.com/CrazyMotoCat/STDU_SHOP/pull/52) и [mock-модели #53](https://github.com/CrazyMotoCat/STDU_SHOP/pull/53). Подтверждена доступность ARM64-манифестов PostgreSQL и Python. Compose отрендерен локально. На WB preflight ещё не запускался.

## Отклонения и бюджет

WB заменяет отдельную VM с отдельным 4 GiB ext4-устройством. Root и /mnt/data разделяют устройство eMMC. Новые Docker local volumes на этом устройстве дают разделение путей и владения, а не отдельную границу I/O или ёмкости. Успех на WB относится к этому ядру, mount options, драйверу и eMMC. Будущий VDS остаётся NOT_PROVEN. Метаданные монтирования, cache/flush и сопоставимость с VDS измеряются отдельно.

| Сервис     |     RAM |  CPU | PID | Назначение                                                   |
| ---------- | ------: | ---: | --: | ------------------------------------------------------------ |
| PostgreSQL | 192 MiB | 0.50 |  32 | Новая синтетическая БД, 6 connections, shared_buffers 24 MB  |
| Controller |  64 MiB | 0.25 |  16 | Будущий coordinator, сейчас команда проверки образа          |
| Worker     | 128 MiB | 0.75 |  16 | Один decode job, 8 MiB scratch                               |
| Verifier   | 128 MiB | 0.75 |  16 | Отдельный UID и отдельный запуск после worker, 8 MiB scratch |

Сумма потолков контейнеров 512 MiB. При последовательной работе worker/verifier активный потолок 384 MiB, оставшиеся 128 MiB служат резервом для хостовой части запуска и мониторинга. Измерения накладных расходов Docker и cgroup peak на WB ещё нужны. Для всех контейнеров memory-swap равен memory. Concurrency 1. Порог запуска и остановки — MemAvailable 768 MiB и 4 GiB свободного места. Предлагаемый предел записи на серию — PG 128 MiB, media 64 MiB и evidence 32 MiB. Docker logs до 2 MiB на контейнер. Предельные размеры каталогов проверять отдельно от общего watermark. Изображения в локальном registry/cache и их скачивание измерять до серии отдельно.

Потолок 128 MiB для кодека выбран как стартовый профиль на основании x86-64 измерений 02B, где worker достигал 85 MiB RSS. RSS на x86-64 не подтверждает cgroup peak на ARM64. Первый декод — маленький синтетический fixture из 02B. Превышение ресурсов останавливает серию. Worker и verifier используют тот же кодек в отдельных процессах. Разнообразие декодеров остаётся NOT_PROVEN.

## Первый пакет владельцу

Открыть локальную консоль WB и сверить отпечаток ключа. При последней попытке SSH к ранее известному адресу предъявленный ключ отличался от known_hosts. Подтверждать его можно только после сверки с локальной консолью:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub
uname -rm
cat /etc/os-release
docker --host unix:///var/run/docker.sock version
docker --host unix:///var/run/docker.sock compose version
docker --host unix:///var/run/docker.sock info --format '{{.ID}} {{.OSType}} {{.Architecture}} {{.CgroupVersion}} {{.DockerRootDir}}'
findmnt -T /mnt/data -o TARGET,FSTYPE,MAJ:MIN,OPTIONS
```

На подтверждённом WB из checkout этой ветки выполнить read-only preflight. `EXPECTED_DAEMON_ID` берётся из вывода подтверждённой локальной консоли. Для следующей команды требуется заранее выделенный пустой каталог `/mnt/data/stdu-wb-lab-01`, принадлежащий оператору и имеющий режим 0700. Если каталог ещё не выделен, вернуть read-only вывод выше и BLOCKED.

```sh
python3 -B experiments/wb-lab-01/preflight.py "$EXPECTED_DAEMON_ID"
```

Передать JSON preflight. Он не включает secrets. После HOST_PREFLIGHT_PASS и получения фактических данных Docker следующий пакет будет ограничен E0a/E0b, с точными IDs и подтверждением ownership. В этой ревизии Compose — проверяемая конфигурация и заготовка профиля. Автоматический provisioning, E0b SQL и runtime watchdog ещё не реализованы.

ARM64 codec build определён в Dockerfile.codec. Для будущей сборки использовать отдельный каталог wheels с wheel Pillow из requirements, полученным по HTTPS и сверенным с SHA-256. Запускать сборку из корня репозитория с `docker build --network none --platform linux/arm64 --build-context wheels=<путь> -f experiments/wb-lab-01/Dockerfile.codec -t stdu-wb-lab-codec:arm64 .`. Перед workload ledger должен закрепить локальный image ID и подтвердить Architecture. Native build и boot PostgreSQL под UID 999 на WB остаются NOT_RUN.

## Поэтапное исполнение

Каждый запуск получает UUID, Compose project `wb-lab-01-<UUID>` и label `stdu.wb-lab-01.run=<UUID>`. Эксперимент использует новый run directory с отдельными results и локальным PG secret. Secret доступен только PostgreSQL через read-only mount. Controller получает в отдельной стадии ограниченные лабораторные credentials, без bootstrap прав. Профиль decode не стартует вместе с E0. Сеть БД — private internal, без ports. Worker/verifier работают через ограниченный stdin/stdout, с network none и без mounted volumes и secrets.

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
