"""
Загрузчик YAML схем.
Загружает все файлы схем из каталога и индексирует их по имени сущности.
"""

import os
import yaml
from typing import Dict, Optional


class SchemaLoader:
    """Загрузчик YAML-схем SEAF из каталога."""

    def __init__(self, schema_dir: str):
        """
        Args:
            schema_dir: Путь к корневому каталогу со схемами.
                        Ожидается структура: schema_dir/{module}/_{root}.yaml и файлы схем.
        """
        self.schema_dir = schema_dir
        self._schemas: Dict[str, dict] = {}  # entity_name -> schema dict
        self._all_files: Dict[str, dict] = {}  # filepath -> yaml content
        self._entity_to_file: Dict[str, str] = {}  # entity_name -> filepath
        self._loaded = False

    def load_all(self) -> "SchemaLoader":
        """Загрузить все YAML-файлы из каталога схем."""
        if self._loaded:
            return self

        for root, dirs, files in os.walk(self.schema_dir):
            for fname in files:
                if fname.endswith((".yaml", ".yml")) and not fname.startswith("."):
                    fpath = os.path.join(root, fname)
                    self._load_file(fpath)

        self._loaded = True
        return self

    def _load_file(self, fpath: str):
        """Загрузить один YAML-файл и индексировать его сущности."""
        with open(fpath, "r", encoding="utf-8") as f:
            content = yaml.safe_load(f) or {}

        self._all_files[fpath] = content

        # Обработка imports
        if "imports" in content:
            base_dir = os.path.dirname(fpath)
            for imp in content["imports"]:
                imp_path = os.path.join(base_dir, imp)
                if imp_path not in self._all_files:
                    self._load_file(imp_path)

        # Индексация сущностей
        if "entities" in content and isinstance(content["entities"], dict):
            for entity_name, entity_def in content["entities"].items():
                self._schemas[entity_name] = entity_def
                self._entity_to_file[entity_name] = fpath

    def get_schema(self, entity_name: str) -> Optional[dict]:
        """Получить определение сущности по имени.

        Args:
            entity_name: Полное имя сущности (например, 'seaf.company.ta.services.dcs').

        Returns:
            Словарь с определением сущности или None, если не найдено.
        """
        return self._schemas.get(entity_name)

    def get_schema_file(self, entity_name: str) -> Optional[str]:
        """Получить путь к файлу схемы для сущности."""
        return self._entity_to_file.get(entity_name)

    def list_entities(self) -> list:
        """Получить список всех загруженных имён сущностей."""
        return sorted(self._schemas.keys())

    def list_entities_by_module(self, module: str) -> list:
        """Получить список сущностей для модуля (services/components)."""
        prefix = f"seaf.company.ta.{module}."
        return sorted([k for k in self._schemas if k.startswith(prefix)])

    @property
    def schemas(self) -> Dict[str, dict]:
        """Все загруженные схемы."""
        return dict(self._schemas)

    def has_entity(self, entity_name: str) -> bool:
        """Проверить наличие сущности."""
        return entity_name in self._schemas
