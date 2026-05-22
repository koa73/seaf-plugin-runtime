#!/usr/bin/env python3
"""
NetConf_Parser entry for SEAF plugin (interactive TTY).
Paths from SEAF_ENV_* / payload env; seaf_converter block removed.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _seaf_env_var_name(key: str) -> str:
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in str(key or ""))
    return cleaned.strip("_").upper()


def _read_env_path(key: str, default: str = "") -> str:
    upper = _seaf_env_var_name(key)
    for name in (f"SEAF_ENV_{upper}", key, upper):
        raw = os.environ.get(name)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    return default


_SKIP_TOPOLOGY_FILENAMES = frozenset({
    "cdp",
    "cdp.old",
    "version",
    "version.old",
    "inventory",
})


def _select_topology_config_files(config_dir: Path) -> tuple[list[Path], int, int]:
    """Pick config files for topology: skip aux dumps; prefer running.current over running.* snapshots."""
    all_files = [
        f for f in config_dir.iterdir()
        if f.is_file() and not f.name.startswith(".")
    ]
    if not all_files:
        return [], 0, 0

    selected: list[Path] = []
    skipped = 0
    running_current = config_dir / "running.current"
    has_running_current = running_current.is_file()

    for config_file in all_files:
        name = config_file.name
        if name in _SKIP_TOPOLOGY_FILENAMES:
            skipped += 1
            continue
        if has_running_current and name.startswith("running.") and name != "running.current":
            skipped += 1
            continue
        selected.append(config_file)

    return selected, skipped, len(all_files)


def _resolve_paths(vendor_root: Path) -> tuple[Path, Path, Path, str]:
    """patterns_dir is fixed under vendored package: python/vendor/netconf_parser/patterns/."""
    data_dir = _read_env_path("netconfDataDir", "./data")
    output_dir = _read_env_path("netconfOutputDir", ".")
    default_layout = _read_env_path("netconfDefaultLayout", "spine_leaf")
    patterns_dir = (vendor_root / "patterns").resolve()
    return (
        Path(data_dir).expanduser().resolve(),
        patterns_dir,
        Path(output_dir).expanduser().resolve(),
        default_layout,
    )


def main() -> int:
    vendor_root = Path(__file__).resolve().parent
    if str(vendor_root) not in sys.path:
        sys.path.insert(0, str(vendor_root))

    from lib.device_analyzer import (  # noqa: WPS433
        NetworkDevice,
        NetworkTopologyAnalyzer,
        ReportGenerator,
        VendorPatternLoader,
    )
    from lib.network_visualizer import NetworkVisualizer  # noqa: WPS433

    config_dir, patterns_dir, output_dir, default_layout = _resolve_paths(vendor_root)
    if not patterns_dir.is_dir():
        print(f"Каталог шаблонов не найден: {patterns_dir}", file=sys.stderr)
        return 1
    patterns_devices = patterns_dir / "devices"
    drawio_templates = patterns_dir / "drawio"
    stencil_templates = drawio_templates / "templates"
    report_name = "network_details.txt"
    diagram_name = "network_diagram.drawio"

    output_dir.mkdir(parents=True, exist_ok=True)
    os.chdir(output_dir)

    pattern_loader = VendorPatternLoader(str(patterns_devices))
    vendor_patterns = pattern_loader.load_patterns()

    if not config_dir.exists():
        print(f"Каталог конфигураций не найден: {config_dir}", file=sys.stderr)
        return 1

    config_files, skipped_files, total_files = _select_topology_config_files(config_dir)
    if not config_files:
        print(f"В каталоге '{config_dir}' нет файлов для анализа.", file=sys.stderr)
        return 1

    if skipped_files:
        print(
            f"ℹ️  Для топологии использовано {len(config_files)} из {total_files} файлов "
            f"(пропущено вспомогательных/дублей running.*: {skipped_files})",
            file=sys.stderr,
        )

    devices = []
    for config_file in config_files:
        device = NetworkDevice(str(config_file), vendor_patterns)
        if device.analyze():
            devices.append(device.to_dict())

    topology = NetworkTopologyAnalyzer()
    links_result = topology.analyze_topology(devices)

    ReportGenerator.print_short_report(devices)
    ReportGenerator.print_topology_analysis(links_result)
    ReportGenerator.write_detailed_report(devices, report_name, links_result, str(config_dir))
    ReportGenerator.draw_topology_ascii(devices, links_result, report_name)

    if not links_result:
        print("Нет связей для построения диаграммы.")
        return 0

    print("Создаю диаграмму...")
    viz = NetworkVisualizer(
        pattern_dir=str(drawio_templates),
        drawio_template=str(drawio_templates / "base.drawio"),
        drawio_stencil_templates=str(stencil_templates),
    )

    print("Выберите алгоритм размещения объектов на диаграмме:")
    print("1. Круговой алгоритм")
    print("2. Сеточный алгоритм")
    print("3. Силовой алгоритм")
    print("4. Кластерный алгоритм")
    print("5. Spine-Leaf-Border Leaf (оптимально для CLOS архитектуры)")
    print(f"\nEnter — алгоритм по умолчанию ({default_layout})\n")

    choice = input("Введите номер алгоритма (1-5) или нажмите Enter: ").strip()
    algorithm_map = {
        "1": "circular",
        "2": "grid",
        "3": "force_directed",
        "4": "clustered",
        "5": "spine_leaf",
    }
    layout_algorithm = algorithm_map.get(choice, default_layout or "spine_leaf")

    objects = viz.prepare_stencils(links_result, devices, layout_algorithm=layout_algorithm)
    viz.create_drawio_diagram(objects)

    diagram_path = (output_dir / diagram_name).resolve()
    page_name = "netconf_perser"
    if diagram_path.is_file():
        ready_payload = {
            "diagramPath": str(diagram_path),
            "pageName": page_name,
        }
        print(f"SEAF_NETCONF_DIAGRAM_READY {json.dumps(ready_payload, ensure_ascii=False)}")

    print("\n" + "=" * 60)
    print(f"Готово. Отчёт: {output_dir / report_name}, диаграмма: {output_dir / diagram_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
