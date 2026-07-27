# Подготовка планировок МКД2 для сайта

## Назначение

Процесс создаёт внутри workspace полный комплект из 388 новых AI и PNG
для корпусов 2.1, 2.2 и 2.3. Исходные AI и PNG в `LIBRARY` используются
только для чтения. Каталог `Коммерческие ОН`, вложенные AI и варианты без
мебели не входят в обработку.

Экшен `Сайт квартиры.aia` не используется. Commit и push процесс не
выполняет.

## Зафиксированный стандарт

- итоговый AI имеет `document.rulerUnits === RulerUnits.Pixels`;
- ровно одна монтажная область `1200×1200 px`;
- PNG24 имеет точный размер `1200×1200 px`, alpha-канал и прозрачный фон;
- все доступные обводки нормализуются до `0.75 px`;
- для DOM Illustrator при 72 ppi используется соответствие
  `1 px = 1 pt`;
- все корневые объекты масштабируются одним общим преобразованием;
- в `PageItem.resize()` передаётся `changeLineWidths=100.0`;
- центр итоговых `visibleBounds` совмещается с `(600, 600)`;
- порядок, иерархия, имена, видимость и блокировка слоёв и объектов
  сохраняются.

Единицы AI подтверждаются только после закрытия и повторного открытия
результата в Illustrator. Размер PNG сам по себе не считается
подтверждением единиц документа.

## Выбор масштаба

Непрерывный коэффициент рассчитывается по исходным `visibleBounds`:

```text
s_raw = min(
  sqrt(777500 / (bbox_width × bbox_height)),
  1070 / max(bbox_width, bbox_height)
)
```

Автоматически допустимы только `100`, `110`, `120`, `150`, `170` и
`200%`. Выбирается ближайшее значение; при точном равенстве — меньшее.
`140%` допустим только как обоснованная запись в `scale_overrides.csv`.

Контрольное распределение:

| Корпус | 100% | 110% | 120% | 150% | 170% | 200% | Всего |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2.1 | 0 | 3 | 17 | 12 | 87 | 38 | 157 |
| 2.2 | 0 | 3 | 11 | 2 | 27 | 10 | 53 |
| 2.3 | 2 | 11 | 18 | 29 | 44 | 74 | 178 |
| Всего | 2 | 17 | 46 | 43 | 158 | 122 | 388 |

## Этапы полного прогона

1. `analyze_full_mkd2.ps1` и `presale_site_analyze.jsx` создают
   read-only preflight, исходные SHA-256 и стабильный manifest.
2. `orchestrate_preflight_mkd2.ps1` проверяет все 388 исходников и
   контрольное распределение масштабов.
3. `orchestrate_processing_mkd2.ps1` обрабатывает manifest пакетами.
4. `presale_site_prepare.jsx` создаёт pixel-native AI и PNG во staging,
   повторно открывает AI и публикует единственную пару результата только
   после внутренних проверок.
5. `verify_full_mkd2.ps1` и `presale_site_verify.jsx` выполняют отдельный
   read-only verify исходника и результата.
6. `reprocess_legacy_pilot_geometry.ps1` повторно обрабатывает семь
   ранних пилотных файлов, для которых старый audit содержал строковый
   маркер вместо фактического per-item geometry comparison.
7. `orchestrate_enhanced_reverify_mkd2.ps1` повторяет verify всех 388 AI
   с полной сигнатурой родительской иерархии и sibling-позиций объектов.
8. `verify_png_acceptance.ps1` независимо декодирует все 388 PNG,
   проверяет alpha, непустое содержимое, прозрачную рамку 16 px,
   отсутствие белой прямоугольной подложки и SHA-256.
9. `create_contact_sheets.ps1` создаёт семь контактных листов из 25
   риск-ориентированных пар и обзор всех 388 PNG.
10. После визуального просмотра `finalize_full_mkd2.ps1` выполняет
   агрегатную приёмку manifest, process/verify-аудитов, PID Illustrator,
   результатов, хешей, PNG и контактных листов.

## Один сеанс Illustrator

Перед запуском Illustrator открывается один раз. Все PowerShell-этапы
подключаются к уже работающему COM-сеансу и контролируют один и тот же
PID. Документы внутри сеанса закрываются и повторно открываются для
проверки, но приложение между пакетами не перезапускается и `Quit()` не
вызывается.

## Запуск

Пример для существующего `run_id`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run_full_mkd2.ps1 `
  -RunId 20260727_full_mkd2 -Stage Initialize

powershell -NoProfile -ExecutionPolicy Bypass -File .\orchestrate_preflight_mkd2.ps1 `
  -RunId 20260727_full_mkd2

powershell -NoProfile -ExecutionPolicy Bypass -File .\orchestrate_processing_mkd2.ps1 `
  -RunId 20260727_full_mkd2 -BatchSize 5 -MaxAttempts 3

powershell -NoProfile -ExecutionPolicy Bypass -File .\reprocess_legacy_pilot_geometry.ps1 `
  -RunId 20260727_full_mkd2

powershell -NoProfile -ExecutionPolicy Bypass -File .\orchestrate_enhanced_reverify_mkd2.ps1 `
  -RunId 20260727_full_mkd2 -BatchSize 25

powershell -NoProfile -ExecutionPolicy Bypass -File .\verify_png_acceptance.ps1 `
  -RunId 20260727_full_mkd2

powershell -NoProfile -ExecutionPolicy Bypass -File .\create_contact_sheets.ps1 `
  -RunId 20260727_full_mkd2

powershell -NoProfile -ExecutionPolicy Bypass -File .\finalize_full_mkd2.ps1 `
  -RunId 20260727_full_mkd2
```

## Возобновление

Manifest является источником состояния. Валидная пара текущего `run_id`
не получает суффиксы `_v2` или `_v3`. Счётчики попыток хранятся в
manifest, а каждая попытка — в отдельном process/verify-аудите. `OK`
пропускается лишь после read-only проверки существующей пары; `ERROR` и
`VERIFY_ERROR` получают новую контролируемую попытку.

Исходный SHA-256 проверяется до каждой операции и в итоговой приёмке.
Любой `SOURCE_HASH_MISMATCH` останавливает прогон.

## Результаты

```text
09_outputs/
  _diagnostics/
    full_<run_id>/
      manifest.csv
      report.csv
      verify_report.csv
      preflight_summary.json
      processing_progress.json
      legacy_geometry_reprocess.json
      enhanced_reverify_progress.json
      png_acceptance.csv
      png_acceptance.json
      visual_review.json
      final_acceptance.json
      details/
      verify_details/
      contact_sheets/
  _full_wip/
    <run_id>/
      Корпус 2.1/
      Корпус 2.2/
      Корпус 2.3/
```

Полный набор считается готовым только при `388 OK`, `388 AI`,
`388 PNG`, нуле ошибок, совпавших исходных SHA-256, принятом
`enhanced_reverify`, принятой PNG-проверке и
`final_acceptance.accepted = true`.

## Ручная проверка единиц

1. `Ctrl+R` — показать линейки.
2. Правый клик по линейке → `Пиксели`.
3. `Shift+O` — инструмент «Монтажная область».
4. В `W` и `H` должны отображаться `1200 px`.

Полное техническое ТЗ находится в `FULL_MKD2_INSTRUCTION.md`.
