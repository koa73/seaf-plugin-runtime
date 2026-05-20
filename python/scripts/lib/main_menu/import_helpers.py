"""Helpers for resolving P41 Import input targets."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List


@dataclass
class ImportInputTargets:
    """Resolved import source path and discovered YAML files."""

    source_path: str
    is_directory: bool
    yaml_files: List[str]


def resolve_input_targets(env: Dict[str, object]) -> ImportInputTargets:
    """Resolve inputSeafFile as YAML file or directory with recursive YAML scan."""
    raw = str(env.get("inputSeafFile") or "").strip()
    if not raw:
        raise ValueError("Не указан Input SEAF file. Откройте SEAF → Edit Config и задайте путь.")

    source = Path(raw).expanduser()
    if not source.exists():
        raise ValueError(f"Input SEAF path not found: {raw}")

    if source.is_file():
        suffix = source.suffix.lower()
        if suffix not in {".yaml", ".yml"}:
            raise ValueError(f"Input file must be YAML (.yaml/.yml): {source}")
        return ImportInputTargets(
            source_path=str(source.resolve()),
            is_directory=False,
            yaml_files=[str(source.resolve())],
        )

    if not source.is_dir():
        raise ValueError(f"Input SEAF path must be file or directory: {source}")

    found: List[str] = []
    for file_path in source.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() in {".yaml", ".yml"}:
            found.append(str(file_path.resolve()))
    found.sort()
    if not found:
        raise ValueError(f"No YAML files found in directory: {source}")

    return ImportInputTargets(
        source_path=str(source.resolve()),
        is_directory=True,
        yaml_files=found,
    )

