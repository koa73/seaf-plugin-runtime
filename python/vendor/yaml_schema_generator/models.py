"""
Модели данных библиотеки парсинга YAML схем.
"""

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class PropertyDef:
    """Описание свойства из схемы."""
    name: str
    prop_type: str  # string, integer, number, boolean, array, object
    title: str = ""
    description: str = ""
    required: bool = False
    enum: Optional[list] = None
    minimum: Optional[int] = None
    minimum_exclusive: Optional[int] = None
    maximum: Optional[int] = None
    max_items: Optional[int] = None
    min_items: Optional[int] = None
    const: Optional[Any] = None
    items_ref: Optional[str] = None  # $ref для элементов массива
    items_anyof: Optional[list] = None  # anyOf для элементов массива
    properties: Optional[dict] = None  # вложенные свойства (для object)
    additional_properties: bool = True
    default: Any = None
    pattern: Optional[str] = None  # regex pattern для ключей


@dataclass
class OneOfBranch:
    """Ветвление oneOf в схеме."""
    title: str = ""
    discriminator_field: str = ""  # поле-дискриминатор (type, technology и т.д.)
    discriminator_value: Optional[Any] = None  # значение дискриминатора
    discriminator_values: Optional[list] = None  # несколько значений (enum)
    properties: dict = field(default_factory=dict)  # доп. свойства ветки
    required_fields: list = field(default_factory=list)
    all_of: Optional[list] = None  # вложенные allOf


@dataclass
class ResolvedEntity:
    """Полностью разрешённая структура сущности."""
    entity_name: str
    title: str = ""
    description: str = ""
    instance_pattern: str = ""  # regex для ключей экземпляров
    properties: dict = field(default_factory=dict)  # name -> PropertyDef
    required_fields: list = field(default_factory=list)
    oneof_branches: list = field(default_factory=list)  # список OneOfBranch
    additional_properties: bool = True

    def get_all_required(self) -> list:
        """Вернуть все обязательные поля (базовые + из oneOf)."""
        result = list(self.required_fields)
        for branch in self.oneof_branches:
            for f in branch.required_fields:
                if f not in result:
                    result.append(f)
        return result

    def get_all_properties(self) -> dict:
        """Вернуть все свойства (базовые)."""
        return dict(self.properties)
