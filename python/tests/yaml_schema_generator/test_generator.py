# -*- coding: utf-8 -*-
"""
Тесты верификации генератора YAML.

Для каждого тестового словаря:
1. Загружаем оригинальный пример YAML с GitHub
2. Преобразуем в плоский словарь
3. Через генератор создаём YAML из плоского словаря
4. Сравниваем результаты
"""

import os
import sys
import unittest
import yaml

# Добавляем родительский каталог в путь
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from yaml_schema_generator import (
    SchemaLoader,
    SchemaResolver,
    YAMLGenerator,
    flatten_yaml,
    unflatten_dict,
    compare_flat_dicts,
)
from yaml_schema_generator.tests.test_data import (
    SCHEMAS_DIR,
    EXAMPLES_DIR,
    ALL_TEST_DATA,
    TEST_DATA_DC_REGION,
    TEST_DATA_DC,
    TEST_DATA_K8S,
    TEST_DATA_K8S_DEPLOYMENT,
    TEST_DATA_BACKUP,
    TEST_DATA_KB,
    TEST_DATA_STORAGE_SDS,
    TEST_DATA_STORAGE_S3,
    TEST_DATA_CLUSTER_VIRTUALIZATION,
    TEST_DATA_USER_DEVICE,
    TEST_DATA_LOGICAL_LINK,
    TEST_DATA_NETWORK_SEGMENT,
    TEST_DATA_NETWORK_LINK,
    TEST_DATA_DC_AZ,
    TEST_DATA_DC_OFFICE,
    TEST_DATA_ENVIRONMENT,
    TEST_DATA_STAND,
    TEST_DATA_K8S_NAMESPACE,
    TEST_DATA_K8S_HPA,
    TEST_DATA_MONITORING,
)


class TestSchemaLoading(unittest.TestCase):
    """Тесты загрузки схем."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()

    def test_loader_loads_all_schemas(self):
        """Загрузчик находит все схемы."""
        entities = self.loader.list_entities()
        self.assertGreater(len(entities), 20, "Должно быть загружено более 20 схем")

    def test_loader_finds_services(self):
        """Загрузчик находит схемы сервисов."""
        services = self.loader.list_entities_by_module("services")
        self.assertIn("seaf.company.ta.services.dcs", services)
        self.assertIn("seaf.company.ta.services.k8s", services)
        self.assertIn("seaf.company.ta.services.backups", services)

    def test_loader_finds_components(self):
        """Загрузчик находит схемы компонентов."""
        components = self.loader.list_entities_by_module("components")
        self.assertIn("seaf.company.ta.components.servers", components)
        self.assertIn("seaf.company.ta.components.hw_storages", components)

    def test_has_base_entity(self):
        """Базовая сущность загружена."""
        self.assertTrue(self.loader.has_entity("seaf.company.ta.services.entity"))

    def test_schema_has_required_structure(self):
        """Схема DC имеет корректную структуру."""
        schema = self.loader.get_schema("seaf.company.ta.services.dcs")
        self.assertIsNotNone(schema)
        self.assertIn("schema", schema)
        self.assertIn("title", schema)
        self.assertIn("patternProperties", schema["schema"])


class TestSchemaResolution(unittest.TestCase):
    """Тесты разрешения схем."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.resolver = SchemaResolver(cls.loader)

    def test_resolve_dc(self):
        """Разрешение схемы ЦОД."""
        entity = self.resolver.resolve_entity("seaf.company.ta.services.dcs")
        self.assertIsNotNone(entity)
        self.assertEqual(entity.entity_name, "seaf.company.ta.services.dcs")
        self.assertIn("vendor", entity.properties)
        self.assertIn("availabilityzone", entity.properties)
        self.assertIn("vendor", entity.required_fields)
        self.assertIn("availabilityzone", entity.required_fields)

    def test_resolve_dc_az(self):
        """Разрешение схемы зоны доступности."""
        entity = self.resolver.resolve_entity("seaf.company.ta.services.dc_azs")
        self.assertIsNotNone(entity)
        self.assertIn("vendor", entity.properties)
        self.assertIn("region", entity.properties)
        self.assertIn("vendor", entity.required_fields)

    def test_resolve_base_entity_fields_in_dc(self):
        """Базовая сущность встраивается в DC (title, description)."""
        entity = self.resolver.resolve_entity("seaf.company.ta.services.dcs")
        self.assertIn("title", entity.properties)
        self.assertIn("description", entity.properties)

    def test_resolve_k8s_required(self):
        """Разрешение схемы K8s — обязательные поля."""
        entity = self.resolver.resolve_entity("seaf.company.ta.services.k8s")
        self.assertIsNotNone(entity)
        self.assertIn("software", entity.required_fields)
        self.assertIn("cni", entity.required_fields)
        self.assertIn("service_mesh", entity.required_fields)
        self.assertIn("network_connection", entity.required_fields)

    def test_resolve_network_oneof(self):
        """Разрешение oneOf для сети (WAN/LAN)."""
        entity = self.resolver.resolve_entity("seaf.company.ta.services.networks")
        self.assertIsNotNone(entity)
        self.assertGreater(len(entity.oneof_branches), 0)
        # Дискриминатор — поле 'type'
        disc_fields = [b.discriminator_field for b in entity.oneof_branches if b.discriminator_field]
        self.assertIn("type", disc_fields)

    def test_resolve_storage_oneof(self):
        """Разрешение oneOf для хранилища (SDS/S3)."""
        entity = self.resolver.resolve_entity("seaf.company.ta.services.storages")
        self.assertIsNotNone(entity)
        self.assertGreater(len(entity.oneof_branches), 0)

    def test_resolve_kb_oneof(self):
        """Разрешение oneOf для кибербезопасности."""
        entity = self.resolver.resolve_entity("seaf.company.ta.services.kbs")
        self.assertIsNotNone(entity)
        self.assertGreater(len(entity.oneof_branches), 10, "Должно быть множество oneOf веток для KB")

    def test_resolve_cluster_virtualization(self):
        """Разрешение схемы кластера виртуализации."""
        entity = self.resolver.resolve_entity("seaf.company.ta.services.cluster_virtualizations")
        self.assertIsNotNone(entity)
        self.assertIn("hypervisor", entity.properties)
        self.assertIn("network_connection", entity.properties)
        self.assertIn("oversubscription_rate", entity.properties)
        self.assertIn("hypervisor", entity.required_fields)

    def test_resolve_server_oneof(self):
        """Разрешение oneOf для серверов (физический/виртуальный)."""
        entity = self.resolver.resolve_entity("seaf.company.ta.components.servers")
        self.assertIsNotNone(entity)
        # Серверы имеют сложную структуру с вложенными allOf + oneOf
        self.assertIn("type", entity.properties)


class TestYAMLGeneration(unittest.TestCase):
    """Тесты генерации YAML."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.generator = YAMLGenerator(cls.loader)

    def _generate_and_compare(self, test_name, test_data, expected_keys=None):
        """Генерация YAML из плоского словаря и проверка ключей."""
        entity_type = test_data["entity_type"]
        result = self.generator.generate(entity_type, test_data)

        self.assertIsNotNone(result, f"Генерация не удалась для {test_name}")
        self.assertIn(entity_type, result)

        instances = result[entity_type]
        self.assertGreater(len(instances), 0, f"Нет экземпляров в результате для {test_name}")

        # Проверяем наличие ключей
        if expected_keys:
            for inst_key in expected_keys:
                self.assertIn(inst_key, instances, f"Отсутствует экземпляр {inst_key}")

        return result

    def test_generate_dc_region(self):
        """Генерация YAML для региона."""
        result = self._generate_and_compare(
            "dc_region", TEST_DATA_DC_REGION,
            expected_keys=["jupiter.dc_region.russia"]
        )
        inst = result["seaf.company.ta.services.dc_regions"]["jupiter.dc_region.russia"]
        self.assertEqual(inst["title"], "Регион Россия")
        self.assertEqual(inst["external_id"], "dc_region.russia")

    def test_generate_dc_az(self):
        """Генерация YAML для зон доступности."""
        result = self._generate_and_compare(
            "dc_az", TEST_DATA_DC_AZ,
            expected_keys=["jupiter.dc_az.moscow", "jupiter.dc_az.moscow_dr"]
        )
        inst = result["seaf.company.ta.services.dc_azs"]["jupiter.dc_az.moscow"]
        self.assertEqual(inst["vendor"], "Jupiter IT")
        self.assertEqual(inst["region"], "jupiter.dc_region.russia")

    def test_generate_dc(self):
        """Генерация YAML для ЦОД."""
        result = self._generate_and_compare(
            "dc", TEST_DATA_DC,
            expected_keys=["jupiter.dc.moscow_dc01", "jupiter.dc.moscow_dc02"]
        )
        inst1 = result["seaf.company.ta.services.dcs"]["jupiter.dc.moscow_dc01"]
        self.assertEqual(inst1["vendor"], "Sber")
        self.assertEqual(inst1["rack_qty"], 5)
        self.assertEqual(inst1["availabilityzone"], "jupiter.dc_az.moscow")

    def test_generate_environment(self):
        """Генерация YAML для окружений."""
        result = self._generate_and_compare(
            "environment", TEST_DATA_ENVIRONMENT,
            expected_keys=["jupiter.environment.dev", "jupiter.environment.prod"]
        )

    def test_generate_stand(self):
        """Генерация YAML для стендов."""
        result = self._generate_and_compare(
            "stand", TEST_DATA_STAND,
            expected_keys=["jupiter.stand.prod"]
        )
        inst = result["seaf.company.ta.services.stands"]["jupiter.stand.prod"]
        self.assertEqual(inst["env"], "jupiter.environment.prod")

    def test_generate_network_segment(self):
        """Генерация YAML для сетевых сегментов."""
        result = self._generate_and_compare(
            "network_segment", TEST_DATA_NETWORK_SEGMENT,
            expected_keys=["jupiter.network_segment.dc.dmz"]
        )
        inst = result["seaf.company.ta.services.network_segments"]["jupiter.network_segment.dc.dmz"]
        self.assertEqual(inst["location"], "jupiter.dc.moscow_dc01")
        self.assertEqual(inst["zone"], "DMZ")

    def test_generate_network_link(self):
        """Генерация YAML для сетевых связанностей."""
        result = self._generate_and_compare(
            "network_link", TEST_DATA_NETWORK_LINK,
            expected_keys=["jupiter.link.hq_to_dc01"]
        )
        inst = result["seaf.company.ta.services.network_links"]["jupiter.link.hq_to_dc01"]
        self.assertEqual(inst["technology"], "s2svpn")
        self.assertEqual(inst["encryption"], "ipsec")
        self.assertIsInstance(inst["network_connection"], list)
        self.assertEqual(len(inst["network_connection"]), 2)

    def test_generate_cluster_virtualization(self):
        """Генерация YAML для кластера виртуализации."""
        result = self._generate_and_compare(
            "cluster_virtualization", TEST_DATA_CLUSTER_VIRTUALIZATION,
            expected_keys=["jupiter.cluster_virtualization.esx.cloudru"]
        )
        inst = result["seaf.company.ta.services.cluster_virtualizations"]["jupiter.cluster_virtualization.esx.cloudru"]
        self.assertEqual(inst["hypervisor"], "VMware vSphere")
        self.assertEqual(inst["drs_support"], True)
        self.assertEqual(inst["oversubscription_rate"], 1)

    def test_generate_k8s(self):
        """Генерация YAML для K8s."""
        result = self._generate_and_compare(
            "k8s", TEST_DATA_K8S,
            expected_keys=["jupiter.k8s.01"]
        )
        inst = result["seaf.company.ta.services.k8s"]["jupiter.k8s.01"]
        self.assertEqual(inst["software"], "Kubernetes 1.28")
        self.assertEqual(inst["service_mesh"], "Istio")
        self.assertEqual(inst["cluster_autoscaler"], True)
        self.assertIsInstance(inst["network_connection"], list)

    def test_generate_k8s_namespace(self):
        """Генерация YAML для K8s namespace."""
        result = self._generate_and_compare(
            "k8s_namespace", TEST_DATA_K8S_NAMESPACE,
            expected_keys=["jupiter.ns.efs"]
        )
        inst = result["seaf.company.ta.components.k8s_namespaces"]["jupiter.ns.efs"]
        self.assertEqual(inst["cluster"], "jupiter.k8s.01")

    def test_generate_k8s_deployment(self):
        """Генерация YAML для K8s deployment."""
        result = self._generate_and_compare(
            "k8s_deployment", TEST_DATA_K8S_DEPLOYMENT,
            expected_keys=["jupiter.k8s.deployment.efs_webapp"]
        )
        inst = result["seaf.company.ta.services.k8s_deployments"]["jupiter.k8s.deployment.efs_webapp"]
        self.assertEqual(inst["cluster"], "jupiter.k8s.01")
        self.assertEqual(inst["namespace"], "jupiter.ns.efs")
        self.assertIsInstance(inst["containers"], list)
        self.assertEqual(inst["containers"][0]["name"], "efs-webapp")

    def test_generate_k8s_hpa(self):
        """Генерация YAML для K8s HPA."""
        result = self._generate_and_compare(
            "k8s_hpa", TEST_DATA_K8S_HPA,
            expected_keys=["jupiter.k8s.hpa.efs_webapp"]
        )
        inst = result["seaf.company.ta.components.k8s_hpa"]["jupiter.k8s.hpa.efs_webapp"]
        self.assertEqual(inst["min"], 2)
        self.assertEqual(inst["max"], 6)

    def test_generate_backup(self):
        """Генерация YAML для бэкапа."""
        result = self._generate_and_compare(
            "backup", TEST_DATA_BACKUP,
            expected_keys=["jupiter.backup.cyberbackup"]
        )
        inst = result["seaf.company.ta.services.backups"]["jupiter.backup.cyberbackup"]
        self.assertEqual(inst["path"], "/mnt/backup")
        self.assertEqual(inst["replication"], True)
        self.assertIsInstance(inst["backed_up_services"], list)

    def test_generate_monitoring(self):
        """Генерация YAML для мониторинга."""
        result = self._generate_and_compare(
            "monitoring", TEST_DATA_MONITORING,
            expected_keys=["jupiter.monitoring.elk"]
        )
        inst = result["seaf.company.ta.services.monitorings"]["jupiter.monitoring.elk"]
        self.assertEqual(inst["ha"], True)

    def test_generate_kb(self):
        """Генерация YAML для сервиса кибербезопасности."""
        result = self._generate_and_compare(
            "kb", TEST_DATA_KB,
            expected_keys=["jupiter.kb.2"]
        )
        inst = result["seaf.company.ta.services.kbs"]["jupiter.kb.2"]
        self.assertEqual(inst["technology"], "Межсетевое экранирование")
        self.assertEqual(inst["tag"], "FW")

    def test_generate_storage_sds(self):
        """Генерация YAML для SDS хранилища (oneOf)."""
        result = self._generate_and_compare(
            "storage_sds", TEST_DATA_STORAGE_SDS,
            expected_keys=["jupiter.sw_storage.01"]
        )
        inst = result["seaf.company.ta.services.storages"]["jupiter.sw_storage.01"]
        self.assertEqual(inst["type"], "Software Defined Storage")

    def test_generate_storage_s3(self):
        """Генерация YAML для S3 хранилища (oneOf)."""
        result = self._generate_and_compare(
            "storage_s3", TEST_DATA_STORAGE_S3,
            expected_keys=["jupiter.obj_storage.cloud_s3"]
        )
        inst = result["seaf.company.ta.services.storages"]["jupiter.obj_storage.cloud_s3"]
        self.assertEqual(inst["type"], "Simple Storage Service")

    def test_generate_user_device(self):
        """Генерация YAML для пользовательского устройства."""
        result = self._generate_and_compare(
            "user_device", TEST_DATA_USER_DEVICE,
            expected_keys=["jupiter.user_device.pc"]
        )
        inst = result["seaf.company.ta.components.user_devices"]["jupiter.user_device.pc"]
        self.assertEqual(inst["device_type"], "АРМ")

    def test_generate_logical_link(self):
        """Генерация YAML для логической связи."""
        result = self._generate_and_compare(
            "logical_link", TEST_DATA_LOGICAL_LINK,
            expected_keys=["jupiter.link.fw_to_servers"]
        )
        inst = result["seaf.company.ta.services.logical_links"]["jupiter.link.fw_to_servers"]
        self.assertEqual(inst["direction"], "<==>")
        self.assertIsInstance(inst["target"], list)


class TestRoundTripConversion(unittest.TestCase):
    """Тесты цикла: плоский словарь → YAML → плоский словарь → сравнение."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.generator = YAMLGenerator(cls.loader)

    def _round_trip_test(self, test_name, test_data):
        """Полный цикл: плоский словарь → генерация YAML → плоский словарь → сравнение."""
        entity_type = test_data["entity_type"]

        # Генерируем YAML
        generated = self.generator.generate(entity_type, test_data)
        self.assertIsNotNone(generated, f"Генерация не удалась для {test_name}")

        # Превращаем обратно в плоский словарь
        generated_flat = flatten_yaml(generated, separator="|")

        # Сравниваем ключи из тестовых данных с результатом
        # Сравниваем только ключи, которые были во входных данных
        comparison = compare_flat_dicts(test_data, generated_flat)

        # Все входные ключи должны присутствовать в результате
        for key in test_data:
            if key == "entity_type":
                continue
            self.assertIn(key, generated_flat,
                          f"Ключ {key} отсутствует в результате для {test_name}")

            # Значения должны совпадать
            expected_val = test_data[key]
            actual_val = generated_flat.get(key)
            self.assertEqual(expected_val, actual_val,
                           f"Значение для ключа {key} не совпадает: "
                           f"ожидалось {expected_val!r}, получено {actual_val!r}")

    def test_roundtrip_dc_region(self):
        self._round_trip_test("dc_region", TEST_DATA_DC_REGION)

    def test_roundtrip_dc(self):
        self._round_trip_test("dc", TEST_DATA_DC)

    def test_roundtrip_dc_az(self):
        self._round_trip_test("dc_az", TEST_DATA_DC_AZ)

    def test_roundtrip_dc_office(self):
        self._round_trip_test("dc_office", TEST_DATA_DC_OFFICE)

    def test_roundtrip_environment(self):
        self._round_trip_test("environment", TEST_DATA_ENVIRONMENT)

    def test_roundtrip_stand(self):
        self._round_trip_test("stand", TEST_DATA_STAND)

    def test_roundtrip_network_segment(self):
        self._round_trip_test("network_segment", TEST_DATA_NETWORK_SEGMENT)

    def test_roundtrip_k8s(self):
        self._round_trip_test("k8s", TEST_DATA_K8S)

    def test_roundtrip_k8s_namespace(self):
        self._round_trip_test("k8s_namespace", TEST_DATA_K8S_NAMESPACE)

    def test_roundtrip_backup(self):
        self._round_trip_test("backup", TEST_DATA_BACKUP)

    def test_roundtrip_kb(self):
        self._round_trip_test("kb", TEST_DATA_KB)

    def test_roundtrip_storage_sds(self):
        self._round_trip_test("storage_sds", TEST_DATA_STORAGE_SDS)

    def test_roundtrip_storage_s3(self):
        self._round_trip_test("storage_s3", TEST_DATA_STORAGE_S3)

    def test_roundtrip_user_device(self):
        self._round_trip_test("user_device", TEST_DATA_USER_DEVICE)

    def test_roundtrip_logical_link(self):
        self._round_trip_test("logical_link", TEST_DATA_LOGICAL_LINK)

    def test_roundtrip_cluster_virtualization(self):
        self._round_trip_test("cluster_virtualization", TEST_DATA_CLUSTER_VIRTUALIZATION)


class TestFlatDictUtils(unittest.TestCase):
    """Тесты утилит преобразования плоских словарей."""

    def test_flatten_simple(self):
        """Flatten простого объекта."""
        data = {
            "seaf.company.ta.services.dcs": {
                "jupiter.dc.moscow": {
                    "title": "Test",
                    "vendor": "TestVendor",
                }
            }
        }
        flat = flatten_yaml(data)
        self.assertEqual(flat["entity_type"], "seaf.company.ta.services.dcs")
        self.assertEqual(flat["jupiter.dc.moscow|title"], "Test")
        self.assertEqual(flat["jupiter.dc.moscow|vendor"], "TestVendor")

    def test_unflatten_simple(self):
        """Unflatten простого словаря."""
        flat = {
            "entity_type": "seaf.company.ta.services.dcs",
            "jupiter.dc.moscow|title": "Test",
            "jupiter.dc.moscow|vendor": "TestVendor",
        }
        result = unflatten_dict(flat)
        self.assertIn("seaf.company.ta.services.dcs", result)
        self.assertIn("jupiter.dc.moscow", result["seaf.company.ta.services.dcs"])
        self.assertEqual(
            result["seaf.company.ta.services.dcs"]["jupiter.dc.moscow"]["title"],
            "Test"
        )

    def test_flatten_unflatten_roundtrip(self):
        """Цикл flatten → unflatten."""
        original = {
            "seaf.company.ta.services.dcs": {
                "jupiter.dc.moscow": {
                    "title": "DC Moscow",
                    "vendor": "Sber",
                    "rack_qty": 10,
                    "location": ["loc1", "loc2"],
                }
            }
        }
        flat = flatten_yaml(original)
        restored = unflatten_dict(flat)
        self.assertEqual(
            restored["seaf.company.ta.services.dcs"]["jupiter.dc.moscow"]["title"],
            "DC Moscow"
        )
        self.assertEqual(
            restored["seaf.company.ta.services.dcs"]["jupiter.dc.moscow"]["rack_qty"],
            10
        )

    def test_compare_flat_dicts_match(self):
        """Сравнение совпадающих словарей."""
        d1 = {"entity_type": "test", "a|b": 1, "a|c": 2}
        d2 = {"entity_type": "test", "a|b": 1, "a|c": 2}
        result = compare_flat_dicts(d1, d2)
        self.assertTrue(result["match"])

    def test_compare_flat_dicts_mismatch(self):
        """Сравнение различающихся словарей."""
        d1 = {"entity_type": "test", "a|b": 1}
        d2 = {"entity_type": "test", "a|b": 2}
        result = compare_flat_dicts(d1, d2)
        self.assertFalse(result["match"])
        self.assertIn("a|b", result["different_values"])


class TestYAMLStringOutput(unittest.TestCase):
    """Тесты строкового вывода YAML."""

    @classmethod
    def setUpClass(cls):
        cls.loader = SchemaLoader(SCHEMAS_DIR).load_all()
        cls.generator = YAMLGenerator(cls.loader)

    def test_yaml_string_is_valid(self):
        """Сгенерированная YAML-строка валидна."""
        yaml_str = self.generator.generate_yaml_string(
            "seaf.company.ta.services.dcs", TEST_DATA_DC
        )
        self.assertIsNotNone(yaml_str)
        parsed = yaml.safe_load(yaml_str)
        self.assertIsInstance(parsed, dict)
        self.assertIn("seaf.company.ta.services.dcs", parsed)

    def test_yaml_string_unicode(self):
        """YAML-строка содержит Unicode (кириллица)."""
        yaml_str = self.generator.generate_yaml_string(
            "seaf.company.ta.services.dc_regions", TEST_DATA_DC_REGION
        )
        self.assertIn("Регион", yaml_str)


class TestLauncherIntegration(unittest.TestCase):
    """Интеграционные тесты лаунчера."""

    @classmethod
    def setUpClass(cls):
        cls.launcher = __import__(
            "yaml_schema_generator.launcher",
            fromlist=["Launcher"]
        ).Launcher(SCHEMAS_DIR)

    def test_launcher_run_hierarchical(self):
        """Лаунчер: иерархический формат."""
        result = self.launcher.run({
            "entity_type": "seaf.company.ta.services.dc_regions",
            "jupiter.dc_region.russia": {
                "title": "Регион Россия",
                "description": "Тест",
                "external_id": "test.1",
            }
        })
        self.assertTrue(result["success"])
        self.assertIsNotNone(result["yaml_string"])

    def test_launcher_run_flat(self):
        """Лаунчер: плоский формат."""
        result = self.launcher.run(TEST_DATA_DC)
        self.assertTrue(result["success"])
        self.assertIsNotNone(result["yaml_string"])

    def test_launcher_unknown_entity(self):
        """Лаунчер: неизвестная сущность."""
        result = self.launcher.run({
            "entity_type": "nonexistent.entity",
            "test.key": {"title": "Test"}
        })
        self.assertFalse(result["success"])
        self.assertIsNotNone(result["error"])

    def test_launcher_no_entity_type(self):
        """Лаунчер: нет entity_type."""
        result = self.launcher.run({
            "test.key": {"title": "Test"}
        })
        self.assertFalse(result["success"])


if __name__ == "__main__":
    unittest.main()
