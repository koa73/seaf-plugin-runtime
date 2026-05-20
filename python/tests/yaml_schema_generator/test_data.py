# -*- coding: utf-8 -*-
"""
Тестовые данные — плоские словари, извлечённые из примеров GitHub:
https://github.com/koa73/SEAF2DrawIO/tree/v-1.8/data/example

Каждый словарь представляет один YAML файл, преобразованный в линейный формат
{ключ: значение} без сохранения иерархии (для верификации работы генератора).

Используется разделитель '|' между ключом экземпляра и путём к полю.
"""

import os
import yaml

# Корневой каталог пакета yaml_schema_generator/
# __file__ = yaml_schema_generator/tests/test_data.py
# dirname x1 = yaml_schema_generator/tests/
# dirname x2 = yaml_schema_generator/  ← корень пакета, здесь лежат schemas/ и examples/
_PACKAGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Путь к примеру GitHub
EXAMPLES_DIR = os.path.join(_PACKAGE_DIR, "examples")

# Путь к схемам
SCHEMAS_DIR = os.path.join(_PACKAGE_DIR, "schemas")


def load_example_flat(filepath: str) -> dict:
    """Загрузить YAML файл примера и преобразовать в плоский словарь.

    Args:
        filepath: Путь к YAML файлу.

    Returns:
        Плоский словарь {ключ: значение}.
    """
    from yaml_schema_generator.flat_dict_utils import flatten_yaml

    with open(filepath, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    return flatten_yaml(data, separator="|")


def load_example_original(filepath: str) -> dict:
    """Загрузить оригинальный YAML файл примера."""
    with open(filepath, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def get_example_files() -> dict:
    """Получить словарь {имя_файла: путь} для всех файлов примеров."""
    files = {}
    if os.path.isdir(EXAMPLES_DIR):
        for fname in sorted(os.listdir(EXAMPLES_DIR)):
            if fname.endswith((".yaml", ".yml")) and not fname.startswith("_"):
                files[fname] = os.path.join(EXAMPLES_DIR, fname)
    return files


# ==========================================================================
# Подготовленные тестовые данные — плоские словари для верификации
# ==========================================================================

TEST_DATA_DC_REGION = {
    "entity_type": "seaf.company.ta.services.dc_regions",
    "jupiter.dc_region.russia|title": "Регион Россия",
    "jupiter.dc_region.russia|description": "Регион присутствия ЦОДов и офисов Jupiter",
    "jupiter.dc_region.russia|external_id": "dc_region.russia",
}

TEST_DATA_DC_AZ = {
    "entity_type": "seaf.company.ta.services.dc_azs",
    "jupiter.dc_az.moscow|title": "AZ Москва",
    "jupiter.dc_az.moscow|description": "Основная зона доступности Jupiter в Москве",
    "jupiter.dc_az.moscow|external_id": "dc_az.moscow",
    "jupiter.dc_az.moscow|region": "jupiter.dc_region.russia",
    "jupiter.dc_az.moscow|vendor": "Jupiter IT",
    "jupiter.dc_az.moscow_dr|title": "AZ резервный (DR)",
    "jupiter.dc_az.moscow_dr|description": "Резервная зона доступности в другом ЦОД",
    "jupiter.dc_az.moscow_dr|external_id": "dc_az.moscow_dr",
    "jupiter.dc_az.moscow_dr|region": "jupiter.dc_region.russia",
    "jupiter.dc_az.moscow_dr|vendor": "Jupiter IT",
}

TEST_DATA_DC = {
    "entity_type": "seaf.company.ta.services.dcs",
    "jupiter.dc.moscow_dc01|title": "Sber Cloud DC",
    "jupiter.dc.moscow_dc01|description": "Sber Cloud Advanced",
    "jupiter.dc.moscow_dc01|vendor": "Sber",
    "jupiter.dc.moscow_dc01|ownership": "Собственный",
    "jupiter.dc.moscow_dc01|type": "Основной",
    "jupiter.dc.moscow_dc01|address": "Москва, ул. Промышленная 10",
    "jupiter.dc.moscow_dc01|rack_qty": 5,
    "jupiter.dc.moscow_dc01|tier": "3",
    "jupiter.dc.moscow_dc01|availabilityzone": "jupiter.dc_az.moscow",
    "jupiter.dc.moscow_dc02|title": "VK DC",
    "jupiter.dc.moscow_dc02|description": "VK Cloud",
    "jupiter.dc.moscow_dc02|vendor": "VK",
    "jupiter.dc.moscow_dc02|ownership": "Собственный",
    "jupiter.dc.moscow_dc02|type": "Резервный",
    "jupiter.dc.moscow_dc02|address": "Москва, ул. Южная 5",
    "jupiter.dc.moscow_dc02|rack_qty": 0,
    "jupiter.dc.moscow_dc02|tier": "3",
    "jupiter.dc.moscow_dc02|availabilityzone": "jupiter.dc_az.moscow",
}

TEST_DATA_DC_OFFICE = {
    "entity_type": "seaf.company.ta.services.dc_offices",
    "jupiter.dc_office.hq|title": "Головной офис",
    "jupiter.dc_office.hq|description": "Головная площадка обслуживания пользователей Jupiter",
    "jupiter.dc_office.hq|address": "Москва, Берёзовый бульвар, д. 14",
    "jupiter.dc_office.hq|region": "jupiter.dc_region.russia",
    "jupiter.dc_office.hq|external_id": "office.hq",
}

TEST_DATA_ENVIRONMENT = {
    "entity_type": "seaf.company.ta.services.environments",
    "jupiter.environment.dev|external_id": "environment.dev",
    "jupiter.environment.dev|title": "Окружение для разработки",
    "jupiter.environment.prod|external_id": "environment.prod",
    "jupiter.environment.prod|title": "Окружение для продакшена",
    "jupiter.environment.test|external_id": "environment.test",
    "jupiter.environment.test|title": "Окружение для тестирования",
}

TEST_DATA_STAND = {
    "entity_type": "seaf.company.ta.services.stands",
    "jupiter.stand.prod|description": "Стенд для продакшена",
    "jupiter.stand.prod|env": "jupiter.environment.prod",
    "jupiter.stand.prod|external_id": "jupiter.environment.prod",
    "jupiter.stand.prod|title": "stand.prod",
}

TEST_DATA_NETWORK_SEGMENT = {
    "entity_type": "seaf.company.ta.services.network_segments",
    "jupiter.network_segment.dc.dmz|title": "DMZ",
    "jupiter.network_segment.dc.dmz|location": "jupiter.dc.moscow_dc01",
    "jupiter.network_segment.dc.dmz|zone": "DMZ",
    "jupiter.network_segment.dc.ext_wan_edge|title": "EXT WAN-EDGE",
    "jupiter.network_segment.dc.ext_wan_edge|location": "jupiter.dc.moscow_dc01",
    "jupiter.network_segment.dc.ext_wan_edge|zone": "EXT-WAN-EDGE",
    "jupiter.network_segment.dc02.dmz|title": "DMZ DC02",
    "jupiter.network_segment.dc02.dmz|location": "jupiter.dc.moscow_dc02",
    "jupiter.network_segment.dc02.dmz|zone": "DMZ",
    "jupiter.network_segment.office.access|title": "УС уровня доступа",
    "jupiter.network_segment.office.access|location": "jupiter.dc_office.hq",
    "jupiter.network_segment.office.access|zone": "DMZ",
}

TEST_DATA_NETWORK_LINK = {
    "entity_type": "seaf.company.ta.services.network_links",
    "jupiter.link.hq_to_dc01|description": "VPN туннель между головным офисом и ЦОД Sber",
    "jupiter.link.hq_to_dc01|encapsulation": "GRE",
    "jupiter.link.hq_to_dc01|encryption": "ipsec",
    "jupiter.link.hq_to_dc01|network_connection|0": "jupiter.network.lan.office.ext.lan",
    "jupiter.link.hq_to_dc01|network_connection|1": "jupiter.network.lan.dc01.int.test",
    "jupiter.link.hq_to_dc01|routing": "bgpevpn",
    "jupiter.link.hq_to_dc01|sla": "provider",
    "jupiter.link.hq_to_dc01|technology": "s2svpn",
    "jupiter.link.hq_to_dc01|title": "Канал связи Офис - ЦОД-01",
    "jupiter.link.hq_to_dc01|typeL1": "Ethernet(over Dark Fiber)",
    "jupiter.link.hq_to_dc01|typeL2": "MPLS",
}

TEST_DATA_CLUSTER_VIRTUALIZATION = {
    "entity_type": "seaf.company.ta.services.cluster_virtualizations",
    "jupiter.cluster_virtualization.esx.cloudru|title": "Кластер виртуализации ESX в Cloud.ru",
    "jupiter.cluster_virtualization.esx.cloudru|description": "Кластер виртуализации на базе ESX в ЦОД Cloud.ru",
    "jupiter.cluster_virtualization.esx.cloudru|hypervisor": "VMware vSphere",
    "jupiter.cluster_virtualization.esx.cloudru|oversubscription_rate": 1,
    "jupiter.cluster_virtualization.esx.cloudru|drs_support": True,
    "jupiter.cluster_virtualization.esx.cloudru|sdrs_support": True,
    "jupiter.cluster_virtualization.esx.cloudru|availabilityzone|0": "jupiter.dc_az.moscow",
    "jupiter.cluster_virtualization.esx.cloudru|location|0": "jupiter.dc.moscow_dc01",
    "jupiter.cluster_virtualization.esx.cloudru|network_connection|0": "jupiter.network.lan.192.168.101.0",
}

TEST_DATA_K8S = {
    "entity_type": "seaf.company.ta.services.k8s",
    "jupiter.k8s.01|title": "K8s кластер",
    "jupiter.k8s.01|description": "K8s кластер в az.moscow",
    "jupiter.k8s.01|external_id": "k8s.01",
    "jupiter.k8s.01|is_own": True,
    "jupiter.k8s.01|software": "Kubernetes 1.28",
    "jupiter.k8s.01|cni": "Calico",
    "jupiter.k8s.01|service_mesh": "Istio",
    "jupiter.k8s.01|cluster_autoscaler": True,
    "jupiter.k8s.01|availabilityzone|0": "jupiter.dc_az.moscow",
    "jupiter.k8s.01|availabilityzone|1": "jupiter.dc_az.moscow_dr",
    "jupiter.k8s.01|location|0": "jupiter.dc.moscow_dc01",
    "jupiter.k8s.01|location|1": "jupiter.dc.moscow_dc02",
    "jupiter.k8s.01|network_connection|0": "jupiter.network.lan.192.168.101.0",
    "jupiter.k8s.01|network_connection|1": "jupiter.network.lan.192.168.2.0",
    "jupiter.k8s.01|registries|0": "jupiter.kb.registry.harbor",
    "jupiter.k8s.01|registries|1": "jupiter.kb.repo.corp",
}

TEST_DATA_K8S_NAMESPACE = {
    "entity_type": "seaf.company.ta.components.k8s_namespaces",
    "jupiter.ns.efs|title": "EFS Namespace",
    "jupiter.ns.efs|description": "Namespace для компонентов АС \"Единый Фронт Сотрудника\"",
    "jupiter.ns.efs|cluster": "jupiter.k8s.01",
    "jupiter.ns.efs|labels|0": "app=efs",
    "jupiter.ns.llm_apps|title": "LLM Apps Namespace",
    "jupiter.ns.llm_apps|description": "Namespace для LLM приложений",
    "jupiter.ns.llm_apps|cluster": "jupiter.k8s.llm.01",
    "jupiter.ns.llm_apps|labels|0": "domain=llm-services",
}

TEST_DATA_K8S_DEPLOYMENT = {
    "entity_type": "seaf.company.ta.services.k8s_deployments",
    "jupiter.k8s.deployment.efs_webapp|title": "EFS WebApp Deployment",
    "jupiter.k8s.deployment.efs_webapp|description": "Развёртывание EFS WebApp",
    "jupiter.k8s.deployment.efs_webapp|cluster": "jupiter.k8s.01",
    "jupiter.k8s.deployment.efs_webapp|namespace": "jupiter.ns.efs",
    "jupiter.k8s.deployment.efs_webapp|labels|0": "app=efs-webapp",
    "jupiter.k8s.deployment.efs_webapp|labels|1": "domain=efs",
    "jupiter.k8s.deployment.efs_webapp|containers|0|name": "efs-webapp",
    "jupiter.k8s.deployment.efs_webapp|containers|0|image": "repo.jupiter.ru/containers/efs-webapp:1.0.0",
    "jupiter.k8s.deployment.efs_webapp|containers|0|resources|limits|cpu": "500m",
    "jupiter.k8s.deployment.efs_webapp|containers|0|resources|limits|ram": "512Mi",
}

TEST_DATA_K8S_HPA = {
    "entity_type": "seaf.company.ta.components.k8s_hpa",
    "jupiter.k8s.hpa.efs_webapp|title": "HPA for EFS WebApp",
    "jupiter.k8s.hpa.efs_webapp|cluster": "jupiter.k8s.01",
    "jupiter.k8s.hpa.efs_webapp|min": 2,
    "jupiter.k8s.hpa.efs_webapp|max": 6,
    "jupiter.k8s.hpa.efs_webapp|target": "jupiter.k8s.deployment.efs_webapp",
}

TEST_DATA_BACKUP = {
    "entity_type": "seaf.company.ta.services.backups",
    "jupiter.backup.cyberbackup|title": "Cyberbackup",
    "jupiter.backup.cyberbackup|description": "Резервное копирование Cyberbackup",
    "jupiter.backup.cyberbackup|path": "/mnt/backup",
    "jupiter.backup.cyberbackup|replication": True,
    "jupiter.backup.cyberbackup|availabilityzone|0": "jupiter.dc_az.moscow",
    "jupiter.backup.cyberbackup|location|0": "jupiter.dc.moscow_dc01",
    "jupiter.backup.cyberbackup|location|1": "jupiter.dc.moscow_dc02",
    "jupiter.backup.cyberbackup|network_connection|0": "jupiter.network.lan.dc01.int.it.services",
    "jupiter.backup.cyberbackup|network_connection|1": "jupiter.network.lan.dc02.int.it.services",
    "jupiter.backup.cyberbackup|backed_up_services|0": "jupiter.server_virtual.ad01",
    "jupiter.backup.cyberbackup|backed_up_services|1": "jupiter.monitoring.elk",
    "jupiter.backup.cyberbackup|backed_up_services|2": "jupiter.k8s.01",
}

TEST_DATA_MONITORING = {
    "entity_type": "seaf.company.ta.services.monitorings",
    "jupiter.monitoring.elk|title": "ELK Stack",
    "jupiter.monitoring.elk|description": "Логирование и мониторинг ELK",
    "jupiter.monitoring.elk|name": "Elastic Stack",
    "jupiter.monitoring.elk|role|0": "Логирование",
    "jupiter.monitoring.elk|ha": True,
    "jupiter.monitoring.elk|availabilityzone|0": "jupiter.dc_az.moscow",
    "jupiter.monitoring.elk|location|0": "jupiter.dc.moscow_dc01",
    "jupiter.monitoring.elk|network_connection|0": "jupiter.network.lan.192.168.101.0",
    "jupiter.monitoring.elk|monitored_services|0": "jupiter.k8s.01",
    "jupiter.monitoring.elk|monitored_services|1": "jupiter.k8s.02",
}

TEST_DATA_KB = {
    "entity_type": "seaf.company.ta.services.kbs",
    "jupiter.kb.2|title": "Межсетевое экранирование S2",
    "jupiter.kb.2|description": "Межсетевой экран S2",
    "jupiter.kb.2|technology": "Межсетевое экранирование",
    "jupiter.kb.2|software_name": "S2",
    "jupiter.kb.2|tag": "FW",
    "jupiter.kb.2|status": "Используется",
    "jupiter.kb.2|network_connection|0": "jupiter.network.lan.dc01.int.prod",
    "jupiter.kb.2|protected_services|0": "jupiter.k8s.01",
}

TEST_DATA_STORAGE_SDS = {
    "entity_type": "seaf.company.ta.services.storages",
    "jupiter.sw_storage.01|title": "Storage CEPH",
    "jupiter.sw_storage.01|description": "SDS Storage",
    "jupiter.sw_storage.01|type": "Software Defined Storage",
    "jupiter.sw_storage.01|software": "CEPH",
    "jupiter.sw_storage.01|volume": 1000,
    "jupiter.sw_storage.01|disk_type": "SSD",
    "jupiter.sw_storage.01|erasure_coding": 2,
    "jupiter.sw_storage.01|protocols": "SMB, S3",
    "jupiter.sw_storage.01|availabilityzone|0": "jupiter.dc_az.moscow",
    "jupiter.sw_storage.01|location|0": "jupiter.dc.moscow_dc01",
    "jupiter.sw_storage.01|location|1": "jupiter.dc.moscow_dc02",
    "jupiter.sw_storage.01|network_connection|0": "jupiter.network.lan.192.168.101.0",
}

TEST_DATA_STORAGE_S3 = {
    "entity_type": "seaf.company.ta.services.storages",
    "jupiter.obj_storage.cloud_s3|title": "S3 Storage in Sber",
    "jupiter.obj_storage.cloud_s3|description": "S3 Storage in Sber Cloud",
    "jupiter.obj_storage.cloud_s3|type": "Simple Storage Service",
    "jupiter.obj_storage.cloud_s3|sla": 99,
    "jupiter.obj_storage.cloud_s3|availabilityzone|0": "jupiter.dc_az.moscow",
    "jupiter.obj_storage.cloud_s3|network_connection|0": "jupiter.network.lan.dc01.int.it.services",
}

TEST_DATA_USER_DEVICE = {
    "entity_type": "seaf.company.ta.components.user_devices",
    "jupiter.user_device.pc|title": "Ноутбуки сотрудников",
    "jupiter.user_device.pc|description": "Клиентский ПК сотрудника",
    "jupiter.user_device.pc|device_type": "АРМ",
    "jupiter.user_device.pc|location|0": "jupiter.dc_office.hq",
    "jupiter.user_device.pc|network_connection|0": "jupiter.network.lan.office.int.lan",
}

TEST_DATA_LOGICAL_LINK = {
    "entity_type": "seaf.company.ta.services.logical_links",
    "jupiter.link.fw_to_servers|title": "Связь NGFW с серверами",
    "jupiter.link.fw_to_servers|description": "Логическая связь от NGFW к серверам в ЦОД Sber",
    "jupiter.link.fw_to_servers|source": "jupiter.network_device.dc.fw.01",
    "jupiter.link.fw_to_servers|target|0": "jupiter.compute_service.ad",
    "jupiter.link.fw_to_servers|target|1": "jupiter.compute_service.mail",
    "jupiter.link.fw_to_servers|direction": "<==>",
}

# ==========================================================================
# Словарь всех тестовых данных для итерации
# ==========================================================================

ALL_TEST_DATA = {
    "dc_region": TEST_DATA_DC_REGION,
    "dc_az": TEST_DATA_DC_AZ,
    "dc": TEST_DATA_DC,
    "dc_office": TEST_DATA_DC_OFFICE,
    "environment": TEST_DATA_ENVIRONMENT,
    "stand": TEST_DATA_STAND,
    "network_segment": TEST_DATA_NETWORK_SEGMENT,
    "network_link": TEST_DATA_NETWORK_LINK,
    "cluster_virtualization": TEST_DATA_CLUSTER_VIRTUALIZATION,
    "k8s": TEST_DATA_K8S,
    "k8s_namespace": TEST_DATA_K8S_NAMESPACE,
    "k8s_deployment": TEST_DATA_K8S_DEPLOYMENT,
    "k8s_hpa": TEST_DATA_K8S_HPA,
    "backup": TEST_DATA_BACKUP,
    "monitoring": TEST_DATA_MONITORING,
    "kb": TEST_DATA_KB,
    "storage_sds": TEST_DATA_STORAGE_SDS,
    "storage_s3": TEST_DATA_STORAGE_S3,
    "user_device": TEST_DATA_USER_DEVICE,
    "logical_link": TEST_DATA_LOGICAL_LINK,
}
