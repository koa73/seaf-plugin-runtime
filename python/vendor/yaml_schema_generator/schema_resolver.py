"""
Резолвер YAML схем.
Разрешает $ref, allOf, oneOf, anyOf, $defs и формирует полную структуру сущности.
"""

import re
import copy
from typing import Any, Dict, Optional, Tuple

from .models import PropertyDef, ResolvedEntity, OneOfBranch
from .schema_loader import SchemaLoader


class SchemaResolver:
    """Резолвер схем SEAF. Преобразует JSON-Schema-подобные определения
    в плоскую структуру ResolvedEntity с полным каталогом свойств."""

    def __init__(self, schema_loader: SchemaLoader):
        self.loader = schema_loader

    def resolve_entity(self, entity_name: str) -> Optional[ResolvedEntity]:
        """Полностью разрешить сущность в ResolvedEntity.

        Args:
            entity_name: Имя сущности (например, 'seaf.company.ta.services.dcs').

        Returns:
            ResolvedEntity или None, если сущность не найдена.
        """
        entity_def = self.loader.get_schema(entity_name)
        if entity_def is None:
            return None

        schema = entity_def.get("schema", {})
        title = entity_def.get("title", "")
        description = entity_def.get("description", "")

        # Собираем все $defs из схемы сущности + $defs из base_entity
        all_defs = self._collect_defs(entity_name, schema)

        # Извлекаем patternProperties
        instance_pattern = ""
        instance_schema = None
        pattern_props = schema.get("patternProperties", {})
        for pattern, p_schema in pattern_props.items():
            instance_pattern = pattern
            instance_schema = p_schema
            break

        if instance_schema is None:
            # Нет patternProperties — возможно, простая сущность
            return ResolvedEntity(
                entity_name=entity_name,
                title=title,
                description=description,
                properties={},
                required_fields=[],
            )

        additional_props = schema.get("additionalProperties", True)

        # Обрабатываем allOf на уровне экземпляра
        all_of = instance_schema.get("allOf", [])
        properties = {}
        required = []
        oneof_branches = []

        # 1. Разрешаем все allOf
        for item in all_of:
            resolved = self._resolve_ref(item, all_defs)
            if resolved is None:
                continue
            merged_props, merged_req = self._extract_properties(resolved, all_defs)
            properties.update(merged_props)
            required.extend(merged_req)

        # 2. Извлекаем свойства из patternProperties-схемы
        direct_props, direct_req = self._extract_properties(instance_schema, all_defs)
        properties.update(direct_props)
        required.extend(direct_req)

        # Убираем дубликаты из required
        required = list(dict.fromkeys(required))

        # Обновляем флаг required для свойств
        for prop_name in properties:
            if prop_name in required:
                properties[prop_name].required = True

        # 3. Обрабатываем oneOf
        oneof = instance_schema.get("oneOf", [])
        if oneof:
            oneof_branches = self._resolve_oneof(oneof, all_defs)
            # Добавляем свойства из oneOf (опциональные)
            for branch in oneof_branches:
                for pname, pdef in branch.properties.items():
                    if pname not in properties:
                        properties[pname] = pdef
                    # Если свойство уже есть, обновляем enum/const из ветки
                    elif pname == branch.discriminator_field:
                        existing = properties[pname]
                        if branch.discriminator_values:
                            if existing.enum is None:
                                existing.enum = []
                            existing.enum.extend(branch.discriminator_values)
                            existing.enum = list(dict.fromkeys(existing.enum))
                        elif branch.discriminator_value is not None:
                            if existing.enum is None:
                                existing.enum = []
                            existing.enum.append(branch.discriminator_value)
                            existing.enum = list(dict.fromkeys(existing.enum))

        return ResolvedEntity(
            entity_name=entity_name,
            title=title,
            description=description,
            instance_pattern=instance_pattern,
            properties=properties,
            required_fields=required,
            oneof_branches=oneof_branches,
            additional_properties=additional_props,
        )

    def _collect_defs(self, entity_name: str, schema: dict) -> dict:
        """Собрать все $defs из схемы сущности и из схемы base_entity.

        Args:
            entity_name: Имя сущности.
            schema: Схема сущности.

        Returns:
            Объединённый словарь $defs.
        """
        defs = {}

        # $defs из текущей схемы
        schema_defs = schema.get("$defs", {})
        if isinstance(schema_defs, dict):
            defs.update(schema_defs)

        # Ищем base_entity в allOf экземпляра
        pattern_props = schema.get("patternProperties", {})
        for _, p_schema in pattern_props.items():
            all_of = p_schema.get("allOf", [])
            for item in all_of:
                ref = item.get("$ref", "") if isinstance(item, dict) else ""
                if "base.entity" in ref:
                    base_name = ref.split("/")[-1]
                    base_def = defs.get(base_name, {})
                    if not base_def:
                        # Ищем в файлах схемы
                        base_entity_def = self.loader.get_schema("seaf.company.ta.services.entity")
                        if base_entity_def:
                            base_schema = base_entity_def.get("schema", {})
                            base_defs = base_schema.get("$defs", {})
                            defs.update(base_defs)

        return defs

    def _resolve_ref(self, ref_target: Any, defs: dict) -> Optional[dict]:
        """Разрешить $ref ссылку на определение.

        Args:
            ref_target: Может быть строкой ($ref) или словарём с $ref.
            defs: Словарь определений.

        Returns:
            Разрешённое определение или None.
        """
        if ref_target is None:
            return None

        ref_str = ""
        if isinstance(ref_target, str):
            ref_str = ref_target
        elif isinstance(ref_target, dict):
            ref_str = ref_target.get("$ref", "")

        if not ref_str:
            return ref_target if isinstance(ref_target, dict) else None

        # Разрешаем локальные $defs
        if ref_str.startswith("#/$defs/"):
            def_name = ref_str[len("#/$defs/"):]
            # Прямой поиск
            if def_name in defs:
                return defs[def_name]
            # Поиск с учётом иерархии (например, network/wan -> network -> defs)
            parts = def_name.split("/")
            for i in range(len(parts), 0, -1):
                partial = "/".join(parts[:i])
                if partial in defs:
                    result = defs[partial]
                    # Если есть остаток пути, идём глубже
                    remaining = "/".join(parts[i:])
                    if remaining and isinstance(result, dict):
                        result = self._navigate_path(result, remaining)
                    return result
            return None

        # $rels ссылки — возвращаем только метаданные (это строковые ссылки)
        if ref_str.startswith("#/$rels/"):
            return {"$ref": ref_str, "_is_rel": True}

        return None

    def _navigate_path(self, obj: dict, path: str) -> Optional[dict]:
        """Навигация по вложенному пути в словаре."""
        parts = path.strip("/").split("/")
        current = obj
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                return None
        return current if isinstance(current, dict) else None

    def _extract_properties(self, schema: dict, defs: dict) -> Tuple[dict, list]:
        """Извлечь свойства и required-поля из схемы.

        Returns:
            (properties_dict, required_list)
        """
        properties = {}
        required = []

        if schema is None or not isinstance(schema, dict):
            return properties, required

        # Рекурсивно обрабатываем вложенные allOf
        if "allOf" in schema:
            for item in schema["allOf"]:
                resolved = self._resolve_ref(item, defs)
                if resolved is None:
                    continue
                sub_props, sub_req = self._extract_properties(resolved, defs)
                properties.update(sub_props)
                required.extend(sub_req)

        # Извлекаем properties
        props = schema.get("properties", {})
        if isinstance(props, dict):
            for prop_name, prop_def in props.items():
                pdef = self._parse_property_def(prop_name, prop_def, defs)
                properties[prop_name] = pdef

        # Извлекаем required
        req = schema.get("required", [])
        if isinstance(req, list):
            required.extend(req)

        return properties, required

    def _parse_property_def(self, name: str, prop_def: dict, defs: dict) -> PropertyDef:
        """Парсинг определения свойства в PropertyDef."""
        if prop_def is None or not isinstance(prop_def, dict):
            return PropertyDef(name=name, prop_type="string")

        # Если есть $ref — это ссылка на другую сущность
        ref = prop_def.get("$ref", "")
        if ref.startswith("#/$rels/"):
            return PropertyDef(
                name=name,
                prop_type="ref",
                title=prop_def.get("title", ""),
                description=prop_def.get("description", ""),
                items_ref=ref,
            )

        # Если есть $ref на $defs
        if ref.startswith("#/$defs/"):
            resolved = self._resolve_ref(prop_def, defs)
            if resolved:
                return self._parse_property_def(name, resolved, defs)

        prop_type = prop_def.get("type", "string")
        title = prop_def.get("title", "")
        description = prop_def.get("description", "")

        pdef = PropertyDef(
            name=name,
            prop_type=prop_type,
            title=title,
            description=description,
            enum=prop_def.get("enum"),
            minimum=prop_def.get("minimum"),
            maximum=prop_def.get("maximum"),
            max_items=prop_def.get("maxItems"),
            min_items=prop_def.get("minItems"),
            const=prop_def.get("const"),
            default=prop_def.get("default"),
            additional_properties=prop_def.get("additionalProperties", True),
        )

        # Обработка items (для массивов)
        items = prop_def.get("items")
        if items and isinstance(items, dict):
            items_ref = items.get("$ref", "")
            if items_ref.startswith("#/$rels/"):
                pdef.items_ref = items_ref
            elif items_ref.startswith("#/$defs/"):
                pdef.items_ref = items_ref
            elif "anyOf" in items:
                anyof_refs = []
                for opt in items["anyOf"]:
                    if isinstance(opt, dict) and opt.get("$ref", "").startswith("#/$rels/"):
                        anyof_refs.append(opt["$ref"])
                if anyof_refs:
                    pdef.items_anyof = anyof_refs
                else:
                    # anyOf с объектами — проверяем properties
                    pdef.properties = items.get("properties", {})
                    pdef.additional_properties = items.get("additionalProperties", True)
            elif items.get("type") == "object":
                # Массив объектов с вложенными свойствами
                nested_props = {}
                for pn, pd in items.get("properties", {}).items():
                    nested_props[pn] = self._parse_property_def(pn, pd, defs)
                pdef.properties = nested_props
                pdef.additional_properties = items.get("additionalProperties", True)
                # Рекурсивно обрабатываем вложенные объекты (resources/limits)
                for pn, pd in items.get("properties", {}).items():
                    if isinstance(pd, dict) and pd.get("type") == "object":
                        nested2 = {}
                        for pn2, pd2 in pd.get("properties", {}).items():
                            nested2[pn2] = self._parse_property_def(pn2, pd2, defs)
                        if nested2:
                            # Сохраняем как вложенную структуру
                            if pdef.properties is None:
                                pdef.properties = {}
                            # Оборачиваем в специальный маркер для вложенных объектов
                            pdef.properties[pn] = PropertyDef(
                                name=pn,
                                prop_type="object",
                                properties=nested2,
                                title=pd.get("title", ""),
                                additional_properties=pd.get("additionalProperties", True),
                            )

        # Обработка вложенных properties (для object)
        if prop_type == "object" and "properties" in prop_def and pdef.properties is None:
            nested_props = {}
            for pn, pd in prop_def["properties"].items():
                nested_props[pn] = self._parse_property_def(pn, pd, defs)
            pdef.properties = nested_props

        # Обработка anyOf на верхнем уровне
        if "anyOf" in prop_def:
            anyof_refs = []
            for opt in prop_def["anyOf"]:
                if isinstance(opt, dict):
                    ref = opt.get("$ref", "")
                    if ref.startswith("#/$rels/"):
                        anyof_refs.append(ref)
            if anyof_refs:
                pdef.items_anyof = anyof_refs

        return pdef

    def _resolve_oneof(self, oneof_list: list, defs: dict) -> list:
        """Разрешить oneOf ветвления.

        Args:
            oneof_list: Список вариантов oneOf.
            defs: Словарь определений.

        Returns:
            Список OneOfBranch.
        """
        branches = []

        for i, variant in enumerate(oneof_list):
            if not isinstance(variant, dict):
                continue

            # Разрешаем $ref
            resolved = self._resolve_ref(variant, defs)
            if resolved is None:
                resolved = variant

            title = resolved.get("title", f"Branch {i}")

            # Извлекаем свойства
            props, req = self._extract_properties(resolved, defs)

            # Определяем дискриминатор
            discriminator_field, discriminator_values = self._find_discriminator(props)

            branch = OneOfBranch(
                title=title,
                discriminator_field=discriminator_field,
                discriminator_values=discriminator_values,
                discriminator_value=discriminator_values[0] if discriminator_values and len(discriminator_values) == 1 else None,
                properties=props,
                required_fields=req,
            )
            branches.append(branch)

        return branches

    def _find_discriminator(self, properties: dict) -> Tuple[str, list]:
        """Найти поле-дискриминатор среди свойств ветки.

        Ищет поле с enum или const — именно оно определяет выбор ветки.

        Returns:
            (field_name, list_of_values)
        """
        for prop_name, pdef in properties.items():
            if pdef.enum:
                return prop_name, list(pdef.enum)
            if pdef.const is not None:
                return prop_name, [pdef.const]

        # Также проверяем вложенные allOf
        return "", []
