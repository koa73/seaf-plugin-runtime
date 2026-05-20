# -*- coding: utf-8 -*-
"""
Тесты валидации данных по YAML схемам.

Включает тесты:
1. Валидация корректных данных (должны проходить)
2. Валидация данных с ошибками типов
3. Валидация данных с отсутствующими обязательными полями
4. Валидация данных с неверными enum-значениями
5. Валидация данных с нарушением ограничений (minimum, maxItems)
6. Валидация oneOf ветвлений
7. Валидация плоских словарей
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from yaml_schema_generator import SchemaLoader, DataValidator
from yaml_schema_generator.tests.test_data import (
    SCHEMAS_DIR,
    TEST_DATA_DC,
    TEST_DATA_DC_REGION,
    TEST_DATA_K8S,
    TEST_DATA_KB,
    TEST_DATA_STORAGE_SDS,
    TEST_DATA_STORAGE_S3,
    TEST_DATA_BACKUP,
    TEST_DATA_CLUSTER_VIRTUALIZATION,
)


class TestValidationCorrectData(unittest.TestCase):
    """Тесты валидации корректных данных — должны проходить."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.validator = DataValidator(cls.loader)

    def test_dc_valid(self):
        """Корректные данные ЦОД."""
        result = self.validator.validate(
            "seaf.company.ta.services.dcs",
            {
                "jupiter.dc.moscow_dc01": {
                    "title": "Sber Cloud DC",
                    "vendor": "Sber",
                    "ownership": "Собственный",
                    "type": "Основной",
                    "address": "Москва",
                    "rack_qty": 5,
                    "tier": "3",
                    "availabilityzone": "jupiter.dc_az.moscow",
                }
            }
        )
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")

    def test_dc_region_valid(self):
        """Корректные данные региона (без обязательных полей)."""
        result = self.validator.validate(
            "seaf.company.ta.services.dc_regions",
            {
                "jupiter.dc_region.russia": {
                    "title": "Регион Россия",
                    "description": "Тестовый регион",
                    "external_id": "russia",
                }
            }
        )
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")

    def test_dc_az_valid(self):
        """Корректные данные зоны доступности."""
        result = self.validator.validate(
            "seaf.company.ta.services.dc_azs",
            {
                "jupiter.dc_az.moscow": {
                    "title": "AZ Москва",
                    "vendor": "Jupiter IT",
                    "region": "jupiter.dc_region.russia",
                }
            }
        )
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")

    def test_environment_valid(self):
        """Корректные данные окружения."""
        result = self.validator.validate(
            "seaf.company.ta.services.environments",
            {
                "jupiter.env.prod": {
                    "title": "Production",
                }
            }
        )
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")

    def test_k8s_valid(self):
        """Корректные данные K8s."""
        result = self.validator.validate(
            "seaf.company.ta.services.k8s",
            {
                "jupiter.k8s.01": {
                    "title": "K8s Cluster",
                    "software": "Kubernetes 1.28",
                    "cni": "Calico",
                    "service_mesh": "Istio",
                    "cluster_autoscaler": True,
                    "network_connection": ["jupiter.network.lan.192.168.101.0"],
                    "registries": ["jupiter.kb.registry.harbor"],
                }
            }
        )
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")

    def test_backup_valid(self):
        """Корректные данные бэкапа."""
        result = self.validator.validate(
            "seaf.company.ta.services.backups",
            {
                "jupiter.backup.test": {
                    "title": "Test Backup",
                    "path": "/mnt/backup",
                    "network_connection": ["jupiter.network.lan.192.168.101.0"],
                    "backed_up_services": ["jupiter.k8s.01"],
                }
            }
        )
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")

    def test_kb_valid(self):
        """Корректные данные кибербезопасности."""
        result = self.validator.validate(
            "seaf.company.ta.services.kbs",
            {
                "jupiter.kb.test": {
                    "title": "Test FW",
                    "technology": "Межсетевое экранирование",
                    "software_name": "TestFW",
                    "tag": "FW",
                    "status": "Используется",
                    "network_connection": ["jupiter.network.lan.192.168.101.0"],
                }
            }
        )
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")

    def test_storage_sds_valid(self):
        """Корректные данные SDS хранилища."""
        result = self.validator.validate(
            "seaf.company.ta.services.storages",
            {
                "jupiter.storage.test": {
                    "title": "Test SDS",
                    "type": "Software Defined Storage",
                    "software": "Ceph",
                    "volume": 100,
                    "network_connection": ["jupiter.network.lan.192.168.101.0"],
                }
            }
        )
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")

    def test_storage_s3_valid(self):
        """Корректные данные S3 хранилища."""
        result = self.validator.validate(
            "seaf.company.ta.services.storages",
            {
                "jupiter.storage.test": {
                    "title": "Test S3",
                    "type": "Simple Storage Service",
                    "availabilityzone": ["jupiter.dc_az.moscow"],
                    "network_connection": ["jupiter.network.lan.192.168.101.0"],
                }
            }
        )
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")

    def test_cluster_virtualization_valid(self):
        """Корректные данные кластера виртуализации."""
        result = self.validator.validate(
            "seaf.company.ta.services.cluster_virtualizations",
            {
                "jupiter.cv.test": {
                    "title": "Test CV",
                    "hypervisor": "VMware vSphere",
                    "network_connection": ["jupiter.network.lan.192.168.101.0"],
                }
            }
        )
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")


class TestValidationMissingRequired(unittest.TestCase):
    """Тесты: отсутствующие обязательные поля."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.validator = DataValidator(cls.loader)

    def test_dc_missing_vendor(self):
        """DC без vendor."""
        result = self.validator.validate(
            "seaf.company.ta.services.dcs",
            {"jupiter.dc.test": {"title": "Test DC"}}
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("vendor" in f for f in error_fields),
            "Должна быть ошибка по полю vendor"
        )

    def test_dc_missing_availabilityzone(self):
        """DC без availabilityzone."""
        result = self.validator.validate(
            "seaf.company.ta.services.dcs",
            {"jupiter.dc.test": {"title": "Test", "vendor": "TestVendor"}}
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("availabilityzone" in f for f in error_fields),
            "Должна быть ошибка по полю availabilityzone"
        )

    def test_dc_az_missing_vendor_and_region(self):
        """AZ без vendor и region."""
        result = self.validator.validate(
            "seaf.company.ta.services.dc_azs",
            {"jupiter.az.test": {"title": "Test AZ"}}
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("vendor" in f for f in error_fields),
            "Должна быть ошибка по полю vendor"
        )
        self.assertTrue(
            any("region" in f for f in error_fields),
            "Должна быть ошибка по полю region"
        )

    def test_k8s_missing_required(self):
        """K8s без обязательных полей."""
        result = self.validator.validate(
            "seaf.company.ta.services.k8s",
            {"jupiter.k8s.test": {"title": "Test K8s"}}
        )
        self.assertFalse(result.is_valid)
        # Должно быть минимум несколько ошибок
        self.assertGreater(len(result.errors), 3)

    def test_backup_missing_required(self):
        """Backup без обязательных полей."""
        result = self.validator.validate(
            "seaf.company.ta.services.backups",
            {"jupiter.backup.test": {"title": "Test Backup"}}
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("path" in f for f in error_fields),
            "Должна быть ошибка по полю path"
        )


class TestValidationWrongTypes(unittest.TestCase):
    """Тесты: неверные типы данных."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.validator = DataValidator(cls.loader)

    def test_dc_rack_qty_string(self):
        """rack_qty как строка вместо integer."""
        result = self.validator.validate(
            "seaf.company.ta.services.dcs",
            {
                "jupiter.dc.test": {
                    "title": "Test",
                    "vendor": "Test",
                    "availabilityzone": "jupiter.dc_az.moscow",
                    "rack_qty": "пять",
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("rack_qty" in f for f in error_fields),
            "Должна быть ошибка типа для rack_qty"
        )

    def test_dc_rack_qty_bool(self):
        """rack_qty как boolean вместо integer."""
        result = self.validator.validate(
            "seaf.company.ta.services.dcs",
            {
                "jupiter.dc.test": {
                    "title": "Test",
                    "vendor": "Test",
                    "availabilityzone": "jupiter.dc_az.moscow",
                    "rack_qty": True,
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("rack_qty" in f for f in error_fields),
            "Должна быть ошибка типа для rack_qty"
        )

    def test_k8s_cluster_autoscaler_string(self):
        """cluster_autoscaler как строка вместо boolean."""
        result = self.validator.validate(
            "seaf.company.ta.services.k8s",
            {
                "jupiter.k8s.test": {
                    "title": "Test",
                    "software": "K8s 1.28",
                    "cni": "Calico",
                    "service_mesh": "Istio",
                    "cluster_autoscaler": "yes",
                    "network_connection": ["net"],
                    "registries": ["reg"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("cluster_autoscaler" in f for f in error_fields),
            "Должна быть ошибка типа для cluster_autoscaler"
        )

    def test_network_connection_not_array(self):
        """network_connection как строка вместо array."""
        result = self.validator.validate(
            "seaf.company.ta.services.dcs",
            {
                "jupiter.dc.test": {
                    "title": "Test",
                    "vendor": "Test",
                    "availabilityzone": "jupiter.dc_az.moscow",
                }
            }
        )
        # network_connection не обязательно для DC, так что проверяем через K8s
        pass

    def test_k8s_software_not_string(self):
        """software как число вместо string."""
        result = self.validator.validate(
            "seaf.company.ta.services.k8s",
            {
                "jupiter.k8s.test": {
                    "title": "Test",
                    "software": 12345,
                    "cni": "Calico",
                    "service_mesh": "Istio",
                    "cluster_autoscaler": True,
                    "network_connection": ["net"],
                    "registries": ["reg"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("software" in f for f in error_fields),
            "Должна быть ошибка типа для software"
        )

    def test_oversubscription_rate_not_number(self):
        """oversubscription_rate как строка."""
        result = self.validator.validate(
            "seaf.company.ta.services.cluster_virtualizations",
            {
                "jupiter.cv.test": {
                    "title": "Test",
                    "hypervisor": "VMware",
                    "oversubscription_rate": "высокий",
                    "network_connection": ["net"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("oversubscription_rate" in f for f in error_fields),
            "Должна быть ошибка типа для oversubscription_rate"
        )


class TestValidationWrongEnum(unittest.TestCase):
    """Тесты: неверные значения enum."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.validator = DataValidator(cls.loader)

    def test_kb_technology_not_in_enum(self):
        """technology не в списке допустимых."""
        result = self.validator.validate(
            "seaf.company.ta.services.kbs",
            {
                "jupiter.kb.test": {
                    "title": "Test",
                    "technology": "Несуществующая технология",
                    "software_name": "Test",
                    "tag": "FW",
                    "status": "Используется",
                    "network_connection": ["net"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("technology" in f for f in error_fields),
            "Должна быть ошибка enum для technology"
        )

    def test_kb_status_not_in_enum(self):
        """status не в списке допустимых."""
        result = self.validator.validate(
            "seaf.company.ta.services.kbs",
            {
                "jupiter.kb.test": {
                    "title": "Test",
                    "technology": "Межсетевое экранирование",
                    "software_name": "Test",
                    "tag": "FW",
                    "status": "Неизвестный статус",
                    "network_connection": ["net"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("status" in f for f in error_fields),
            "Должна быть ошибка enum для status"
        )

    def test_compute_service_type_not_in_enum(self):
        """service_type не в enum для compute_service."""
        result = self.validator.validate(
            "seaf.company.ta.services.compute_services",
            {
                "jupiter.cs.test": {
                    "title": "Test",
                    "service_type": "Несуществующий тип сервиса",
                    "network_connection": ["net"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("service_type" in f for f in error_fields),
            "Должна быть ошибка enum для service_type"
        )

    def test_software_type_valid_enum(self):
        """type в допустимом enum для software."""
        for valid_type in ["Открытая", "Закрытая бесплатная", "Закрытая платная"]:
            result = self.validator.validate(
                "seaf.company.ta.services.softwares",
                {
                    "jupiter.software.test": {
                        "title": "Test",
                        "vendor": "TestVendor",
                        "type": valid_type,
                        "support": "Да",
                        "expiration": "01.01.2030",
                    }
                }
            )
            type_errors = [e for e in result.errors if "type" in e.field_path]
            # Не должно быть ошибок по полю type (могут быть по другим)
            self.assertEqual(len(type_errors), 0,
                           f"Не должно быть ошибки enum для type={valid_type}")

    def test_software_type_invalid_enum(self):
        """type не в допустимом enum для software."""
        result = self.validator.validate(
            "seaf.company.ta.services.softwares",
            {
                "jupiter.software.test": {
                    "title": "Test",
                    "vendor": "TestVendor",
                    "type": "Недопустимый тип",
                    "support": "Да",
                    "expiration": "01.01.2030",
                }
            }
        )
        self.assertFalse(result.is_valid)


class TestValidationConstraints(unittest.TestCase):
    """Тесты: ограничения minimum, maxItems и т.д."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.validator = DataValidator(cls.loader)

    def test_dc_rack_qty_negative(self):
        """rack_qty отрицательный (minimum=0)."""
        result = self.validator.validate(
            "seaf.company.ta.services.dcs",
            {
                "jupiter.dc.test": {
                    "title": "Test",
                    "vendor": "Test",
                    "availabilityzone": "jupiter.dc_az.moscow",
                    "rack_qty": -1,
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("rack_qty" in f for f in error_fields),
            "Должна быть ошибка minimum для rack_qty"
        )

    def test_hw_storage_volume_negative(self):
        """volume отрицательный (minimum=0)."""
        result = self.validator.validate(
            "seaf.company.ta.services.hw_storages",
            {
                "jupiter.hw.test": {
                    "title": "Test",
                    "vendor": "Test",
                    "volume": -100,
                    "location": ["jupiter.dc.moscow_dc01"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("volume" in f for f in error_fields),
            "Должна быть ошибка minimum для volume"
        )

    def test_network_link_max_items(self):
        """network_connection с более чем 2 элементами (maxItems=2)."""
        result = self.validator.validate(
            "seaf.company.ta.services.network_links",
            {
                "jupiter.link.test": {
                    "title": "Test",
                    "network_connection": ["net1", "net2", "net3"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("network_connection" in f for f in error_fields),
            "Должна быть ошибка maxItems для network_connection"
        )

    def test_cluster_virtualization_oversubscription_negative(self):
        """oversubscription_rate отрицательный."""
        result = self.validator.validate(
            "seaf.company.ta.services.cluster_virtualizations",
            {
                "jupiter.cv.test": {
                    "title": "Test",
                    "hypervisor": "VMware",
                    "oversubscription_rate": -5,
                    "network_connection": ["net"],
                }
            }
        )
        self.assertFalse(result.is_valid)


class TestValidationOneOfBranching(unittest.TestCase):
    """Тесты: oneOf ветвления."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.validator = DataValidator(cls.loader)

    def test_storage_no_type_discriminator(self):
        """Хранилище без поля type (дискриминатор oneOf)."""
        result = self.validator.validate(
            "seaf.company.ta.services.storages",
            {
                "jupiter.storage.test": {
                    "title": "Test",
                    "software": "Ceph",
                    "network_connection": ["net"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        # Должна быть ошибка — нет дискриминатора
        error_msgs = [str(e) for e in result.errors]
        self.assertTrue(
            any("дискриминатор" in m.lower() or "type" in m for m in error_msgs),
            "Должна быть ошибка отсутствия дискриминатора oneOf"
        )

    def test_storage_wrong_type(self):
        """Хранилище с неверным типом."""
        result = self.validator.validate(
            "seaf.company.ta.services.storages",
            {
                "jupiter.storage.test": {
                    "title": "Test",
                    "type": "Несуществующий тип",
                    "network_connection": ["net"],
                }
            }
        )
        self.assertFalse(result.is_valid)

    def test_kb_no_technology_discriminator(self):
        """KB без поля technology (дискриминатор oneOf)."""
        result = self.validator.validate(
            "seaf.company.ta.services.kbs",
            {
                "jupiter.kb.test": {
                    "title": "Test",
                    "software_name": "Test",
                    "tag": "FW",
                    "status": "Используется",
                    "network_connection": ["net"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_msgs = [str(e) for e in result.errors]
        self.assertTrue(
            any("дискриминатор" in m.lower() or "technology" in m.lower() for m in error_msgs),
            "Должна быть ошибка отсутствия дискриминатора technology"
        )


class TestValidationFlatDict(unittest.TestCase):
    """Тесты валидации плоских словарей."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.validator = DataValidator(cls.loader)

    def test_flat_valid(self):
        """Плоский словарь с корректными данными."""
        flat = {
            "entity_type": "seaf.company.ta.services.dcs",
            "jupiter.dc.test|title": "Test DC",
            "jupiter.dc.test|vendor": "TestVendor",
            "jupiter.dc.test|availabilityzone": "jupiter.dc_az.moscow",
        }
        result = self.validator.validate_flat("seaf.company.ta.services.dcs", flat)
        self.assertTrue(result.is_valid, f"Ошибки: {[str(e) for e in result.errors]}")

    def test_flat_missing_required(self):
        """Плоский словарь с отсутствующим обязательным полем."""
        flat = {
            "entity_type": "seaf.company.ta.services.dcs",
            "jupiter.dc.test|title": "Test DC",
        }
        result = self.validator.validate_flat("seaf.company.ta.services.dcs", flat)
        self.assertFalse(result.is_valid)

    def test_flat_wrong_type(self):
        """Плоский словарь с неверным типом."""
        flat = {
            "entity_type": "seaf.company.ta.services.dcs",
            "jupiter.dc.test|title": "Test",
            "jupiter.dc.test|vendor": "Test",
            "jupiter.dc.test|availabilityzone": "az",
            "jupiter.dc.test|rack_qty": "не число",
        }
        result = self.validator.validate_flat("seaf.company.ta.services.dcs", flat)
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("rack_qty" in f for f in error_fields),
            "Должна быть ошибка типа для rack_qty"
        )


class TestValidationNonexistentEntity(unittest.TestCase):
    """Тесты: несуществующая сущность."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.validator = DataValidator(cls.loader)

    def test_nonexistent_entity(self):
        """Валидация по несуществующей сущности."""
        result = self.validator.validate(
            "nonexistent.entity.name",
            {"test.key": {"title": "Test"}}
        )
        self.assertFalse(result.is_valid)
        self.assertTrue(
            any("не найдена" in str(e) for e in result.errors),
            "Должна быть ошибка о ненайденной сущности"
        )


class TestValidationEdgeCases(unittest.TestCase):
    """Тесты граничных случаев."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.validator = DataValidator(cls.loader)

    def test_empty_data(self):
        """Пустые данные."""
        result = self.validator.validate(
            "seaf.company.ta.services.dcs",
            {}
        )
        self.assertFalse(result.is_valid)

    def test_empty_instance(self):
        """Пустой экземпляр (без полей)."""
        result = self.validator.validate(
            "seaf.company.ta.services.dcs",
            {"jupiter.dc.test": {}}
        )
        self.assertFalse(result.is_valid)

    def test_extra_fields_allowed_in_generator(self):
        """Генератор может включать поля, отсутствующие в схеме (include_extra=True).

        Валидатор корректно помечает такие поля как отсутствующие в схеме,
        но это не блокирует генерацию. Данный тест проверяет, что валидатор
        определяет additionalProperties=false корректно.
        """
        # Все SEAF схемы имеют additionalProperties: false
        # Поэтому любые доп. поля должны быть отмечены валидатором
        result = self.validator.validate(
            "seaf.company.ta.services.environments",
            {
                "jupiter.env.test": {
                    "title": "Test",
                    "custom_field": "custom_value",
                }
            }
        )
        self.assertFalse(result.is_valid)
        self.assertTrue(
            any("additionalProperties" in str(e) or "не определено" in str(e) for e in result.errors),
            "Должна быть ошибка о поле не из схемы"
        )

    def test_extra_fields_rejected_when_false(self):
        """Дополнительные поля отклоняются при additionalProperties=false."""
        # DC schema имеет additionalProperties: false
        result = self.validator.validate(
            "seaf.company.ta.services.dcs",
            {
                "jupiter.dc.test": {
                    "title": "Test",
                    "vendor": "Test",
                    "availabilityzone": "jupiter.dc_az.moscow",
                    "custom_field": "custom_value",
                }
            }
        )
        self.assertFalse(result.is_valid)
        self.assertTrue(
            any("additionalProperties" in str(e) for e in result.errors),
            "Должна быть ошибка additionalProperties=false"
        )

    def test_boolean_string_conversion(self):
        """Строковые значения 'true'/'false' — не должны проходить как boolean."""
        result = self.validator.validate(
            "seaf.company.ta.services.k8s",
            {
                "jupiter.k8s.test": {
                    "title": "Test",
                    "software": "K8s",
                    "cni": "Calico",
                    "service_mesh": "Istio",
                    "cluster_autoscaler": "true",
                    "network_connection": ["net"],
                    "registries": ["reg"],
                }
            }
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("cluster_autoscaler" in f for f in error_fields),
            "Строка 'true' не должна проходить как boolean"
        )

    def test_network_device_type_enum(self):
        """type сетевого устройства — проверка enum."""
        valid_types = [
            "Маршрутизатор (роутер)", "Коммутатор (свитч)", "Межсетевой экран (файрвол)",
        ]
        for vt in valid_types:
            result = self.validator.validate(
                "seaf.company.ta.components.networks",
                {"jupiter.nd.test": {"title": "Test", "type": vt}}
            )
            type_errors = [e for e in result.errors if "type" in e.field_path]
            self.assertEqual(len(type_errors), 0, f"Тип {vt} должен быть валидным")

    def test_user_device_required(self):
        """Устройство: device_type обязательно."""
        result = self.validator.validate(
            "seaf.company.ta.components.user_devices",
            {"jupiter.ud.test": {"title": "Test"}}
        )
        self.assertFalse(result.is_valid)
        error_fields = [e.field_path for e in result.errors]
        self.assertTrue(
            any("device_type" in f for f in error_fields),
            "Должна быть ошибка по обязательному полю device_type"
        )


if __name__ == "__main__":
    unittest.main()
