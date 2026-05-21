"""
Модуль анализа сетевого оборудования и топологии
"""
import re
import json
import sys
from pathlib import Path
from typing import List, Dict, Any, Tuple, Set, Union
import ipaddress
from collections import Counter
from .pattern_validator import PatternValidator


class VendorPatternLoader:
    """Загрузчик шаблонов распознавания вендоров из JSON-файлов."""

    def __init__(self, patterns_dir: Union[str, Path], validate: bool = True):
        self.patterns_dir = Path(patterns_dir).resolve()
        self.patterns: List[Dict[str, Any]] = []
        self.validator: PatternValidator = None
        
        # Инициализация валидатора если включена валидация
        if validate:
            schema_path = self.patterns_dir.parent / "schema.json"
            if schema_path.exists():
                self.validator = PatternValidator(str(schema_path))

    def load_patterns(self) -> List[Dict[str, Any]]:
        """Загружает все шаблоны из каталога с опциональной валидацией."""
        if not self.patterns_dir.exists():
            sys.stderr.write(f"❌ Каталог шаблонов не найден: {self.patterns_dir}\n")
            sys.exit(1)

        self.patterns = []
        errors_found = False
        
        for filepath in self.patterns_dir.glob("*.json"):
            try:
                with open(filepath, 'r', encoding='utf-8-sig') as f:
                    pattern = json.load(f)
                
                # Валидация шаблона
                if self.validator:
                    is_valid, validation_errors = self.validator.validate(pattern)
                    if not is_valid:
                        sys.stderr.write(f"❌ Ошибки валидации в {filepath.name}:\n")
                        for error in validation_errors:
                            sys.stderr.write(f"   • {error}\n")
                        errors_found = True
                        continue
                
                pattern['_source_file'] = filepath.name
                self.patterns.append(pattern)
                status = "✅" if not self.validator else "✅✓"
                print(
                    f"{status} Загружен шаблон: {filepath.name} "
                    f"(версия {pattern.get('version', 'unknown')})"
                )
            except json.JSONDecodeError as e:
                sys.stderr.write(f"❌ Ошибка JSON в файле {filepath.name}: {e}\n")
                errors_found = True
            except Exception as e:
                sys.stderr.write(f"❌ Ошибка в файле {filepath.name}: {e}\n")
                errors_found = True

        if not self.patterns:
            sys.stderr.write(f"⚠️  В каталоге {self.patterns_dir} не найдено корректных шаблонов (*.json)\n")
            sys.exit(1)
        
        if errors_found:
            sys.stderr.write("\n⚠️  Некоторые шаблоны не загружены из-за ошибок\n")

        return self.patterns


class NetworkDevice:
    """Представление сетевого устройства с методами анализа конфигурации."""

    def __init__(self, filepath: Union[str, Path], vendor_patterns: List[Dict[str, Any]]):
        self.filepath = Path(filepath).resolve()
        self.filename = self.filepath.name
        self.vendor_patterns = vendor_patterns
        self.content: str = ""
        self.content_lines: List[str] = []
        self.content_lower: str = ""
        self.vendor: str = "unknown"
        self.device_name: str = "unknown"
        self.model: str = "unknown"
        self.device_type: str = "unknown"
        self.routing_networks: List[Dict[str, str]] = []
        self.total_vlans: int = 0
        self.active_vlans: List[int] = []
        self.all_vlans: List[int] = []

    def load_content(self) -> bool:
        """Загружает содержимое конфигурационного файла."""
        try:
            with open(self.filepath, 'r', encoding='utf-8', errors='ignore') as f:
                self.content = f.read()
            self.content_lines = [line.rstrip() for line in self.content.splitlines() if line.strip()]
            self.content_lower = self.content.lower()
            return True
        except Exception as e:
            sys.stderr.write(f"❌ Ошибка чтения файла {self.filename}: {e}\n")
            return False

    def _match_patterns(self, patterns: List[str], case_insensitive: bool = True) -> bool:
        """Проверяет совпадение любого паттерна с содержимым файла."""
        flags = re.IGNORECASE if case_insensitive else 0
        for line in self.content_lines:
            for pattern in patterns:
                if re.search(pattern, line, flags):
                    return True
        return False

    def _extract_with_pattern(self, patterns: List[Dict]) -> str:
        """Извлекает значение по списку паттернов."""
        for p in patterns:
            if p.get("multiline", False):
                match = re.search(p["pattern"], self.content, re.IGNORECASE | re.DOTALL)
            else:
                match = None
                for line in self.content_lines:
                    match = re.search(p["pattern"], line, re.IGNORECASE)
                    if match:
                        break

            if match:
                value = match.group(p.get("group", 1)).strip()
                if p.get("clean", True):
                    value = re.sub(r'[^\w.\-_]', '', value).strip()
                if not value and p.get("fallback", False):
                    value = match.group(p.get("group", 1)).strip()
                return value
        return "unknown"

    def _extract_model_with_fallback(self, patterns: List[Dict], vendor: str) -> str:
        """Извлекает модель с fallback-логикой из шаблона JSON."""
        model = self._extract_with_pattern(patterns)

        # Если модель извлечена паттернами, нормализуем и возвращаем её
        if model != "unknown":
            normalized_model = self._normalize_model_name(model)
            return normalized_model

        # Fallback-логика применяется только если модель не была извлечена паттернами
        # Ищем шаблон для текущего вендора и применяем fallback-правила
        vendor_pattern = next((p for p in self.vendor_patterns if p["vendor"] == vendor), None)
        if vendor_pattern and "model_fallback_rules" in vendor_pattern:
            for rule in vendor_pattern["model_fallback_rules"]:
                conditions = rule.get("conditions", {})
                matched = False

                # Проверка условия "all" (все паттерны должны совпасть)
                if "all" in conditions:
                    matched = all(self._check_condition_pattern(pat) for pat in conditions["all"])

                # Проверка условия "any" (хотя бы один паттерн должен совпасть)
                if "any" in conditions:
                    any_matched = any(self._check_condition_pattern(pat) for pat in conditions["any"])
                    matched = matched and any_matched if "all" in conditions else any_matched

                # Если условий нет, считаем правило неприменимым
                if not conditions:
                    continue

                if matched:
                    return rule.get("model", "unknown")

        return "unknown"

    def _check_condition_pattern(self, pattern: str) -> bool:
        """
        Проверяет условие паттерна.
        
        Если паттерн содержит regex-символы (.*, +, ?, ^, $), используется regex-поиск.
        Иначе используется простой поиск подстроки.
        """
        # Символы, указывающие на regex-паттерн
        regex_chars = ['.*', '.+', '+', '?', '^', '$', '\\d', '\\w', '\\s', '[', ']', '(', ')']
        
        is_regex = any(rc in pattern for rc in regex_chars)
        
        if is_regex:
            # Используем regex-поиск по всему содержимому
            try:
                return bool(re.search(pattern, self.content, re.IGNORECASE))
            except re.error:
                # Если паттерн некорректен, пробуем простой поиск
                return pattern.lower() in self.content_lower
        else:
            # Простой поиск подстроки
            return pattern.lower() in self.content_lower

    def _normalize_model_name(self, model: str) -> str:
        """
        Нормализует имя модели, преобразуя имена образов IOS в названия моделей.
        
        Например:
        - cat4500e-lanbase-mz → Catalyst 4500-E
        - cat3750-lanbase → Catalyst 3750
        - CISCO2951/K9 → Cisco 2951
        - CISCO1941/K9 → Cisco 1941
        """
        if model == "unknown":
            return model
            
        model_lower = model.lower()
        
        # Словарь преобразований имен образов в модели
        ios_image_to_model = {
            "cat4500e": "Catalyst 4500-E",
            "cat4500": "Catalyst 4500",
            "cat3750": "Catalyst 3750",
            "cat3650": "Catalyst 3650",
            "cat3560": "Catalyst 3560",
            "cat2960": "Catalyst 2960",
            "cat9300": "Catalyst 9300",
            "cat9200": "Catalyst 9200",
        }
        
        # Проверяем, начинается ли имя модели с известного префикса
        for image_prefix, model_name in ios_image_to_model.items():
            if model_lower.startswith(image_prefix):
                return model_name
        
        # Нормализация моделей ISR (CISCO2951/K9 → Cisco 2951, CISCO2951K → Cisco 2951, CISCO861-PCI-K9 → Cisco 861)
        isar_match = re.match(r'^cisco(\d+)(?:[/-]?k9|[a-z\-]*-k9|k)?$', model_lower)
        if isar_match:
            return f"Cisco {isar_match.group(1)}"
        
        # Нормализация моделей из boot system (c2800, c2801, c3800 и т.д.)
        boot_match = re.match(r'^c(\d+)$', model_lower)
        if boot_match:
            num = boot_match.group(1)
            if num.startswith('28') or num.startswith('38'):
                return f"Cisco {num[0]}800 ISR"
            elif num.startswith('29') or num.startswith('39'):
                return f"Cisco {num[0]}900 ISR"
            elif num.startswith('8'):
                return f"Cisco {num} Series"
            elif num.startswith('19') or num.startswith('29') or num.startswith('39'):
                return f"Cisco {num} ISR"
        
        # Нормализация моделей ASA (Ethernet0/0 → ASA 5505, GigabitEthernet0/0 → ASA 5500-X)
        if model_lower.startswith('ethernet'):
            return "ASA 5505"
        if model_lower.startswith('gigabitethernet'):
            return "ASA 5500-X"
                
        return model

    def _infer_type_by_features(self, type_rules: List[Dict]) -> str:
        """
        Определяет тип устройства по наличию функций.
        
        Поддерживает два формата правил:
        1. Старый формат (type_inference): {"any": [...], "type": "...", "score": N}
        2. Новый формат (type_rules): {"any"/"all"/"not": [...], "type": "...", "score": N}
        """
        best_type = "unknown"
        best_score = -1
        
        for rule in type_rules:
            score = rule.get("score", 1)
            matched = self._check_type_conditions(rule)
            
            if matched and score > best_score:
                best_score = score
                best_type = rule["type"]
        
        return best_type

    def _check_type_conditions(self, rule: Dict) -> bool:
        """
        Проверяет условия правила для определения типа устройства.
        
        Args:
            rule: Правило с условиями (any, all, not)
            
        Returns:
            True если все условия выполнены
        """
        matched = False
        
        # Проверка условия "any" (хотя бы один паттерн)
        if "any" in rule:
            matched = any(pat.lower() in self.content_lower for pat in rule["any"])
        
        # Проверка условия "all" (все паттерны)
        if "all" in rule:
            all_matched = all(pat.lower() in self.content_lower for pat in rule["all"])
            matched = matched and all_matched if "any" in rule else all_matched
        
        # Проверка условия "not" (ни один паттерн не должен совпасть)
        if "not" in rule:
            not_matched = not any(pat.lower() in self.content_lower for pat in rule["not"])
            matched = matched and not_matched
        
        return matched

    def _extract_networks_and_vlans(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает сети и VLAN согласно правилам шаблона.
        
        Использует универсальный метод _extract_interfaces() для извлечения сетей,
        что исключает дублирование логики с _extract_all_ip_interfaces().
        """
        result = {
            "routing_networks": [],
            "total_vlans": 0,
            "active_vlans": [],
            "all_vlans": []
        }

        # Извлечение интерфейсов с IP через универсальный метод
        # Это заменяет сложную логику с определением формата (MikroTik/однострочный/многострочный)
        routing_networks, _ = self._extract_interfaces(extract_all=False)
        result["routing_networks"] = routing_networks

        # Извлечение VLAN
        if "vlans" in rules:
            vlan_set = set()
            active_set = set()

            for line in self.content_lines:
                if "all_pattern" in rules["vlans"]:
                    for match in re.finditer(rules["vlans"]["all_pattern"], line, re.IGNORECASE):
                        try:
                            vid = int(match.group(1))
                            vlan_set.add(vid)
                        except (ValueError, IndexError):
                            pass

                if "active_pattern" in rules["vlans"]:
                    for match in re.finditer(rules["vlans"]["active_pattern"], line, re.IGNORECASE):
                        try:
                            vid = int(match.group(1))
                            active_set.add(vid)
                            vlan_set.add(vid)
                        except (ValueError, IndexError):
                            pass

            result["all_vlans"] = sorted(vlan_set)
            result["active_vlans"] = sorted(active_set)
            result["total_vlans"] = len(vlan_set)

        return result

    def analyze(self) -> bool:
        """Выполняет полный анализ конфигурации устройства."""
        if not self.load_content():
            return False

        # Этап 1: Определение вендора
        vendor_scores = Counter()
        for pattern in self.vendor_patterns:
            vendor = pattern["vendor"]
            signatures = pattern.get("vendor_signatures", [])
            if signatures:
                score = sum(
                    any(re.search(sig, line, re.IGNORECASE) for line in self.content_lines)
                    for sig in signatures
                )
                if score > 0:
                    vendor_scores[vendor] = score

        if not vendor_scores:
            for pattern in self.vendor_patterns:
                if self._match_patterns(pattern.get("detect_patterns", [])):
                    vendor_scores[pattern["vendor"]] = 1
                    break

        if not vendor_scores:
            return False

        self.vendor = vendor_scores.most_common(1)[0][0]
        pattern = next(p for p in self.vendor_patterns if p["vendor"] == self.vendor)

        # Этап 2: Извлечение данных
        self.device_name = self._extract_with_pattern(pattern.get("name_patterns", []))
        
        # Fallback: если имя не извлечено, используем имя файла без расширения
        if self.device_name == "unknown":
            self.device_name = self.filename.rsplit('.', 1)[0]
        
        self.model = self._extract_model_with_fallback(pattern.get("model_patterns", []), self.vendor)

        # Этап 3: Определение типа
        # Приоритет: type_rules (новый формат) > type_inference (старый формат)
        type_rules = pattern.get("type_rules") or pattern.get("type_inference")
        if type_rules:
            self.device_type = self._infer_type_by_features(type_rules)
        if self.device_type == "unknown":
            self.device_type = pattern.get("default_device_type", "unknown")

        # Этап 4: Извлечение сетей и VLAN
        rules = pattern.get("network_extraction_rules", {})
        network_info = self._extract_networks_and_vlans(rules)
        self.routing_networks = network_info["routing_networks"]
        self.total_vlans = network_info["total_vlans"]
        self.active_vlans = network_info["active_vlans"]
        self.all_vlans = network_info["all_vlans"]
        
        # Дополнительное извлечение всех IP интерфейсов для b4com
        self.all_ip_interfaces = self._extract_all_ip_interfaces()

        # Этап 5: Извлечение дополнительной информации (BGP, Port-Channel, VXLAN, Management)
        bgp_rules = pattern.get("bgp_extraction_rules", {})
        if bgp_rules.get("enabled"):
            self.bgp_info = self._extract_bgp_info(bgp_rules)
        else:
            self.bgp_info = {}
        
        pc_rules = pattern.get("port_channel_extraction_rules", {})
        if pc_rules.get("enabled"):
            self.port_channels = self._extract_port_channels(pc_rules)
        else:
            self.port_channels = []
        
        vxlan_rules = pattern.get("vxlan_extraction_rules", {})
        if vxlan_rules.get("enabled"):
            self.vxlan_info = self._extract_vxlan_info(vxlan_rules)
        else:
            self.vxlan_info = {}
        
        mgmt_rules = pattern.get("management_extraction_rules", {})
        if mgmt_rules.get("enabled"):
            self.management_info = self._extract_management_info(mgmt_rules)
        else:
            self.management_info = {}

        # Этап 6: Извлечение маршрутов (routing extraction)
        routing_rules = pattern.get("routing_extraction_rules", {})
        if routing_rules.get("enabled"):
            self.routing_paths = self._extract_routing_paths(routing_rules)
        else:
            self.routing_paths = []

        # Этап 7: Извлечение VRF информации
        vrf_rules = pattern.get("vrf_extraction_rules", {})
        if vrf_rules.get("enabled"):
            self.vrf_info = self._extract_vrf_info(vrf_rules)
        else:
            self.vrf_info = {}

        # Этап 8: Извлечение OSPF информации
        ospf_rules = pattern.get("ospf_extraction_rules", {})
        if ospf_rules.get("enabled"):
            self.ospf_info = self._extract_ospf_info(ospf_rules)
        else:
            self.ospf_info = {}

        # Этап 9: Извлечение LLDP информации
        lldp_rules = pattern.get("lldp_extraction_rules", {})
        if lldp_rules.get("enabled"):
            self.lldp_info = self._extract_lldp_info(lldp_rules)
        else:
            self.lldp_info = {}

        # Этап 10: Извлечение статуса интерфейсов
        intf_status_rules = pattern.get("interface_status_rules", {})
        if intf_status_rules.get("enabled"):
            self.interface_status = self._extract_interface_status(intf_status_rules)
        else:
            self.interface_status = {}

        # Этап 11: Извлечение StackWise информации
        stackwise_rules = pattern.get("stackwise_extraction_rules", {})
        if stackwise_rules.get("enabled"):
            self.stackwise_info = self._extract_stackwise_info(stackwise_rules)
        else:
            self.stackwise_info = {}

        # Этап 12: Извлечение QoS информации
        qos_rules = pattern.get("qos_extraction_rules", {})
        if qos_rules.get("enabled"):
            self.qos_info = self._extract_qos_info(qos_rules)
        else:
            self.qos_info = {}

        # Этап 13: Извлечение Power информации
        power_rules = pattern.get("power_extraction_rules", {})
        if power_rules.get("enabled"):
            self.power_info = self._extract_power_info(power_rules)
        else:
            self.power_info = {}

        # Этап 14: Извлечение UDLD информации
        udld_rules = pattern.get("udld_extraction_rules", {})
        if udld_rules.get("enabled"):
            self.udld_info = self._extract_udld_info(udld_rules)
        else:
            self.udld_info = {}

        # Этап 15: Добавление BGP local адресов в routing_networks
        if hasattr(self, 'bgp_info') and self.bgp_info.get('local_addresses'):
            for local_ip in self.bgp_info['local_addresses']:
                # Добавляем как /32 сеть
                self.routing_networks.append({
                    "interface": "BGP",
                    "network": f"{local_ip}/32"
                })

        return True

    def _extract_bgp_info(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает информацию о BGP конфигурации."""
        result = {
            "enabled": False,
            "asn": None,
            "router_id": None,
            "neighbors": [],
            "evpn_neighbors": [],
            "address_families": [],
            "local_addresses": []
        }

        neighbor_descriptions = {}

        for line in self.content_lines:
            # ASN
            if rules.get("asn_pattern"):
                match = re.search(rules["asn_pattern"], line, re.IGNORECASE)
                if match:
                    result["enabled"] = True
                    result["asn"] = match.group(1)

            # Router ID
            if rules.get("router_id_pattern"):
                match = re.search(rules["router_id_pattern"], line, re.IGNORECASE)
                if match:
                    result["router_id"] = match.group(1)

            # Local address (MikroTik BGP local.address)
            if rules.get("local_address_pattern"):
                match = re.search(rules["local_address_pattern"], line, re.IGNORECASE)
                if match:
                    local_addr = match.group(1)
                    if local_addr not in result["local_addresses"]:
                        result["local_addresses"].append(local_addr)

            # Neighbor с remote-as
            if rules.get("neighbor_pattern"):
                match = re.search(rules["neighbor_pattern"], line, re.IGNORECASE)
                if match:
                    neighbor_ip = match.group(1)
                    neighbor_as = match.group(2)
                    # Проверяем, есть ли уже такой сосед
                    existing = next((n for n in result["neighbors"] if n["ip"] == neighbor_ip), None)
                    if existing:
                        existing["remote_as"] = neighbor_as
                    else:
                        result["neighbors"].append({
                            "ip": neighbor_ip,
                            "remote_as": neighbor_as,
                            "description": neighbor_descriptions.get(neighbor_ip, ""),
                            "evpn_enabled": False
                        })

            # Neighbor description
            if rules.get("neighbor_desc_pattern"):
                match = re.search(rules["neighbor_desc_pattern"], line, re.IGNORECASE)
                if match:
                    neighbor_ip = match.group(1)
                    description = match.group(2)
                    neighbor_descriptions[neighbor_ip] = description
                    # Обновляем существующего соседа
                    existing = next((n for n in result["neighbors"] if n["ip"] == neighbor_ip), None)
                    if existing:
                        existing["description"] = description

            # Address-family
            if rules.get("address_family_pattern"):
                match = re.search(rules["address_family_pattern"], line, re.IGNORECASE)
                if match:
                    af = f"{match.group(1)} {match.group(2)}"
                    if af not in result["address_families"]:
                        result["address_families"].append(af)
            
            # EVPN neighbor activate
            if rules.get("evpn_neighbors_pattern"):
                match = re.search(rules["evpn_neighbors_pattern"], line, re.IGNORECASE)
                if match:
                    neighbor_ip = match.group(1)
                    existing = next((n for n in result["neighbors"] if n["ip"] == neighbor_ip), None)
                    if existing:
                        existing["evpn_enabled"] = True
                    result["evpn_neighbors"].append(neighbor_ip)
        
        # Применяем описания ко всем соседям
        for neighbor in result["neighbors"]:
            if not neighbor["description"]:
                neighbor["description"] = neighbor_descriptions.get(neighbor["ip"], "")
        
        return result

    def _extract_port_channels(self, rules: Dict) -> List[Dict[str, Any]]:
        """Извлекает информацию о Port-Channel интерфейсах."""
        port_channels = []
        current_pc = None
        
        for line in self.content_lines:
            # Новый Port-Channel
            if rules.get("port_channel_pattern"):
                match = re.search(rules["port_channel_pattern"], line, re.IGNORECASE)
                if match:
                    if current_pc:
                        port_channels.append(current_pc)
                    current_pc = {
                        "name": match.group(1),
                        "description": "",
                        "members": [],
                        "mode": "",
                        "vlans": "",
                        "shutdown": False
                    }
                    continue
            
            if current_pc:
                # Description
                if rules.get("port_channel_desc_pattern"):
                    match = re.search(rules["port_channel_desc_pattern"], line, re.IGNORECASE)
                    if match:
                        current_pc["description"] = match.group(1).strip()
                
                # Channel-group members
                if rules.get("port_channel_members_pattern"):
                    match = re.search(rules["port_channel_members_pattern"], line, re.IGNORECASE)
                    if match:
                        current_pc["members"].append({
                            "group": match.group(1),
                            "mode": match.group(2)
                        })
                
                # VLANs
                if rules.get("port_channel_vlans_pattern"):
                    match = re.search(rules["port_channel_vlans_pattern"], line, re.IGNORECASE)
                    if match:
                        current_pc["vlans"] = match.group(1)
                
                # Shutdown status
                if re.search(r"^\s*shutdown\s*$", line, re.IGNORECASE):
                    current_pc["shutdown"] = True
        
        if current_pc:
            port_channels.append(current_pc)
        
        return port_channels

    def _extract_vxlan_info(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает информацию о VXLAN конфигурации."""
        result = {
            "enabled": False,
            "vtep_ip": None,
            "vnis": [],
            "anycast_mac": None,
            "mac_vrfs": []
        }
        
        current_mac_vrf = None
        in_mac_vrf = False
        
        for line in self.content_lines:
            # VTEP IP
            if rules.get("vtep_ip_pattern"):
                match = re.search(rules["vtep_ip_pattern"], line, re.IGNORECASE)
                if match:
                    result["enabled"] = True
                    result["vtep_ip"] = match.group(1)
            
            # VNI
            if rules.get("vni_pattern"):
                match = re.search(rules["vni_pattern"], line, re.IGNORECASE)
                if match:
                    vni_id = match.group(1)
                    bridge_vlan = match.group(2)
                    result["vnis"].append({
                        "vni": vni_id,
                        "bridge_vlan": bridge_vlan,
                        "name": ""
                    })
            
            # VNI name
            if rules.get("vni_name_pattern"):
                match = re.search(rules["vni_name_pattern"], line, re.IGNORECASE)
                if match:
                    if result["vnis"]:
                        result["vnis"][-1]["name"] = match.group(1)
            
            # Anycast gateway MAC
            if rules.get("evpn_irb_mac_pattern"):
                match = re.search(rules["evpn_irb_mac_pattern"], line, re.IGNORECASE)
                if match:
                    result["anycast_mac"] = match.group(1)
            
            # MAC VRF start - проверяем начало секции
            if rules.get("mac_vrf_pattern"):
                match = re.search(rules["mac_vrf_pattern"], line, re.IGNORECASE)
                if match:
                    if current_mac_vrf:
                        result["mac_vrfs"].append(current_mac_vrf)
                    current_mac_vrf = {
                        "name": match.group(1),
                        "rd": "",
                        "route_target": "",
                        "description": ""
                    }
                    in_mac_vrf = True
                    continue
            
            if in_mac_vrf and current_mac_vrf:
                # RD
                if rules.get("mac_vrf_rd_pattern"):
                    match = re.search(rules["mac_vrf_rd_pattern"], line, re.IGNORECASE)
                    if match:
                        current_mac_vrf["rd"] = match.group(1)
                
                # Route-target
                if rules.get("mac_vrf_rt_pattern"):
                    match = re.search(rules["mac_vrf_rt_pattern"], line, re.IGNORECASE)
                    if match:
                        current_mac_vrf["route_target"] = match.group(1)
                
                # Description
                if rules.get("mac_vrf_desc_pattern"):
                    match = re.search(rules["mac_vrf_desc_pattern"], line, re.IGNORECASE)
                    if match:
                        current_mac_vrf["description"] = match.group(1)
                
                # Выход из секции MAC VRF - новая секция или конец
                if re.search(r"^mac vrf\s+\S+", line, re.IGNORECASE) and current_mac_vrf["name"] != line.split()[-1]:
                    pass  # Обработано выше
                elif re.search(r"^evpn irb-forwarding", line, re.IGNORECASE):
                    in_mac_vrf = False
        
        if current_mac_vrf:
            result["mac_vrfs"].append(current_mac_vrf)
        
        return result

    def _extract_management_info(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает информацию об управлении."""
        result = {
            "mgmt_interface": None,
            "mgmt_ip": None,
            "mgmt_mask": None,
            "mgmt_vrf": None,
            "default_gateway": None,
            "default_gateway_iface": None
        }
        
        in_mgmt_interface = False
        
        for line in self.content_lines:
            # Management interface
            if rules.get("mgmt_interface_pattern"):
                match = re.search(rules["mgmt_interface_pattern"], line, re.IGNORECASE)
                if match:
                    result["mgmt_interface"] = match.group(1)
                    in_mgmt_interface = True
                    continue
            
            if in_mgmt_interface:
                # Management VRF
                if rules.get("mgmt_vrf_pattern"):
                    match = re.search(rules["mgmt_vrf_pattern"], line, re.IGNORECASE)
                    if match:
                        result["mgmt_vrf"] = match.group(1)
                
                # Management IP - CIDR формат (10.7.8.1/24) или с маской
                if rules.get("mgmt_ip_pattern"):
                    # CIDR формат
                    cidr_match = re.search(r"ip address\s+(\S+)/(\d+)", line, re.IGNORECASE)
                    if cidr_match:
                        result["mgmt_ip"] = cidr_match.group(1)
                        result["mgmt_mask"] = cidr_match.group(2)
                    else:
                        match = re.search(rules["mgmt_ip_pattern"], line, re.IGNORECASE)
                        if match:
                            result["mgmt_ip"] = match.group(1)
                            result["mgmt_mask"] = match.group(2)
                
                # Выход из секции интерфейса
                if re.search(r"^interface\s+", line, re.IGNORECASE) and not re.search(r"^interface\s+(eth0|mgmt)", line, re.IGNORECASE):
                    in_mgmt_interface = False
            
            # Default route
            if rules.get("default_route_pattern"):
                match = re.search(rules["default_route_pattern"], line, re.IGNORECASE)
                if match:
                    result["mgmt_vrf"] = match.group(1)
                    result["default_gateway"] = match.group(2)
                    # Пытаемся извлечь интерфейс из следующей строки или из gateway
                    gw_parts = result["default_gateway"].split()
                    if len(gw_parts) > 1:
                        result["default_gateway"] = gw_parts[0]
                        result["default_gateway_iface"] = gw_parts[1]

        return result

    def _extract_vrf_info(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает информацию о VRF (Virtual Routing and Forwarding)."""
        result = {
            "enabled": False,
            "vrfs": []
        }

        current_vrf = None

        for line in self.content_lines:
            # Определение VRF
            if rules.get("vrf_definition_pattern"):
                match = re.search(rules["vrf_definition_pattern"], line, re.IGNORECASE)
                if match:
                    vrf_name = match.group(1)
                    if vrf_name.lower() != "management":  # Исключаем management VRF
                        current_vrf = {
                            "name": vrf_name,
                            "description": None,
                            "interfaces": []
                        }
                        result["enabled"] = True
                        result["vrfs"].append(current_vrf)
                    continue

            # Описание VRF
            if current_vrf and rules.get("vrf_description_pattern"):
                match = re.search(rules["vrf_description_pattern"], line, re.IGNORECASE)
                if match:
                    current_vrf["description"] = match.group(1).strip()

            # Интерфейсы в VRF
            if rules.get("vrf_forwarding_pattern"):
                match = re.search(rules["vrf_forwarding_pattern"], line, re.IGNORECASE)
                if match:
                    vrf_name = match.group(1)
                    if vrf_name.lower() != "management":
                        # Ищем существующий VRF или создаём новый
                        existing_vrf = next((v for v in result["vrfs"] if v["name"] == vrf_name), None)
                        if not existing_vrf:
                            existing_vrf = {
                                "name": vrf_name,
                                "description": None,
                                "interfaces": []
                            }
                            result["vrfs"].append(existing_vrf)
                            result["enabled"] = True

        return result

    def _extract_ospf_info(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает информацию об OSPF конфигурации."""
        result = {
            "enabled": False,
            "process_id": None,
            "vrf": None,
            "router_id": None,
            "areas": [],
            "networks": []
        }

        current_area = None

        for line in self.content_lines:
            # OSPF процесс
            if rules.get("process_pattern"):
                match = re.search(rules["process_pattern"], line, re.IGNORECASE)
                if match:
                    result["enabled"] = True
                    result["process_id"] = match.group(1)
                    if match.lastindex >= 2 and match.group(2):
                        result["vrf"] = match.group(2)
                    continue

            # Router ID
            if result["enabled"] and rules.get("router_id_pattern"):
                match = re.search(rules["router_id_pattern"], line, re.IGNORECASE)
                if match:
                    result["router_id"] = match.group(1)

            # OSPF Area с authentication
            if result["enabled"] and rules.get("area_pattern"):
                match = re.search(rules["area_pattern"], line, re.IGNORECASE)
                if match:
                    current_area = match.group(1)
                    auth_type = match.group(2)
                    if current_area not in result["areas"]:
                        result["areas"].append({
                            "area_id": current_area,
                            "authentication": auth_type
                        })

            # OSPF Network
            if result["enabled"] and rules.get("network_pattern"):
                match = re.search(rules["network_pattern"], line, re.IGNORECASE)
                if match:
                    network = match.group(1)
                    area = match.group(2)
                    result["networks"].append({
                        "network": network,
                        "area": area
                    })

        return result

    def _extract_lldp_info(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает информацию о LLDP конфигурации и соседях."""
        result = {
            "enabled": False,
            "lldp_run": False,
            "neighbors": []
        }

        current_interface = None
        in_lldp_agent = False

        for line in self.content_lines:
            # Проверка глобального включения LLDP
            if rules.get("lldp_run_pattern"):
                match = re.search(rules["lldp_run_pattern"], line, re.IGNORECASE)
                if match:
                    result["lldp_run"] = True
                    result["enabled"] = True

            # Определение интерфейса
            intf_match = re.search(r"^interface\s+(\S+)", line, re.IGNORECASE)
            if intf_match:
                current_interface = intf_match.group(1)
                in_lldp_agent = False
                continue

            # LLDP agent секция
            if current_interface and rules.get("lldp_agent_pattern"):
                match = re.search(rules["lldp_agent_pattern"], line, re.IGNORECASE)
                if match:
                    in_lldp_agent = True
                    continue

            if in_lldp_agent and current_interface:
                # Chassis ID
                if rules.get("chassis_id_pattern"):
                    match = re.search(rules["chassis_id_pattern"], line, re.IGNORECASE)
                    if match:
                        # Ищем существующего соседа или создаём нового
                        neighbor = next((n for n in result["neighbors"] if n["interface"] == current_interface), None)
                        if not neighbor:
                            neighbor = {
                                "interface": current_interface,
                                "chassis_id": None,
                                "port_id": None,
                                "description": None
                            }
                            result["neighbors"].append(neighbor)
                        neighbor["chassis_id"] = match.group(1)

                # Port ID
                if rules.get("port_id_pattern"):
                    match = re.search(rules["port_id_pattern"], line, re.IGNORECASE)
                    if match:
                        neighbor = next((n for n in result["neighbors"] if n["interface"] == current_interface), None)
                        if not neighbor:
                            neighbor = {
                                "interface": current_interface,
                                "chassis_id": None,
                                "port_id": None,
                                "description": None
                            }
                            result["neighbors"].append(neighbor)
                        neighbor["port_id"] = match.group(1)

                # Выход из LLDP agent секции
                if re.search(r"^\s*exit\s*$", line, re.IGNORECASE):
                    in_lldp_agent = False

            # Description (сосед)
            if current_interface and rules.get("neighbor_description_pattern"):
                match = re.search(rules["neighbor_description_pattern"], line, re.IGNORECASE)
                if match:
                    neighbor = next((n for n in result["neighbors"] if n["interface"] == current_interface), None)
                    if not neighbor:
                        neighbor = {
                            "interface": current_interface,
                            "chassis_id": None,
                            "port_id": None,
                            "description": None
                        }
                        result["neighbors"].append(neighbor)
                    neighbor["description"] = match.group(1).strip()

        return result

    def _extract_interface_status(self, rules: Dict) -> Dict[str, str]:
        """Извлекает статус интерфейсов (up/down)."""
        result = {}
        current_interface = None
        is_shutdown = False

        for line in self.content_lines:
            # Определение интерфейса
            intf_match = re.search(r"^interface\s+(\S+)", line, re.IGNORECASE)
            if intf_match:
                # Сохраняем статус предыдущего интерфейса
                if current_interface:
                    result[current_interface] = "down" if is_shutdown else "up"

                current_interface = intf_match.group(1)
                is_shutdown = False
                continue

            if current_interface:
                # Shutdown
                if rules.get("shutdown_pattern"):
                    match = re.search(rules["shutdown_pattern"], line, re.IGNORECASE)
                    if match:
                        is_shutdown = True

                # No shutdown
                if rules.get("no_shutdown_pattern"):
                    match = re.search(rules["no_shutdown_pattern"], line, re.IGNORECASE)
                    if match:
                        is_shutdown = False

        # Последний интерфейс
        if current_interface:
            result[current_interface] = "down" if is_shutdown else "up"

        return result

    def _extract_stackwise_info(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает информацию о StackWise конфигурации."""
        result = {
            "enabled": False,
            "members": [],
            "system_mtu": None
        }

        for line in self.content_lines:
            # Switch provision
            if rules.get("switch_provision_pattern"):
                match = re.search(rules["switch_provision_pattern"], line, re.IGNORECASE)
                if match:
                    result["enabled"] = True
                    switch_num = match.group(1)
                    model = match.group(2)
                    result["members"].append({
                        "switch_number": switch_num,
                        "model": model
                    })

            # System MTU
            if rules.get("system_mtu_pattern"):
                match = re.search(rules["system_mtu_pattern"], line, re.IGNORECASE)
                if match:
                    result["system_mtu"] = match.group(1)

        return result

    def _extract_qos_info(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает информацию о QoS конфигурации."""
        result = {
            "enabled": False,
            "mls_qos": False,
            "control_packets": False,
            "queue_config": []
        }

        for line in self.content_lines:
            # MLS QoS
            if rules.get("mls_qos_pattern"):
                match = re.search(rules["mls_qos_pattern"], line, re.IGNORECASE)
                if match:
                    result["enabled"] = True
                    result["mls_qos"] = True

            # QoS control packets
            if rules.get("qos_control_packets_pattern"):
                match = re.search(rules["qos_control_packets_pattern"], line, re.IGNORECASE)
                if match:
                    result["enabled"] = True
                    result["control_packets"] = True

        return result

    def _extract_power_info(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает информацию о питании (PoE, redundancy)."""
        result = {
            "enabled": False,
            "redundancy_mode": None,
            "inline_power": []
        }

        for line in self.content_lines:
            # Power redundancy
            if rules.get("power_redundancy_pattern"):
                match = re.search(rules["power_redundancy_pattern"], line, re.IGNORECASE)
                if match:
                    result["enabled"] = True
                    result["redundancy_mode"] = match.group(1)

        return result

    def _extract_udld_info(self, rules: Dict) -> Dict[str, Any]:
        """Извлекает информацию о UDLD конфигурации."""
        result = {
            "enabled": False,
            "aggressive": False,
            "errdisable_recovery": False
        }

        for line in self.content_lines:
            # UDLD aggressive
            if rules.get("udld_aggressive_pattern"):
                match = re.search(rules["udld_aggressive_pattern"], line, re.IGNORECASE)
                if match:
                    result["enabled"] = True
                    result["aggressive"] = True

            # Errdisable recovery UDLD
            if rules.get("errdisable_udld_pattern"):
                match = re.search(rules["errdisable_udld_pattern"], line, re.IGNORECASE)
                if match:
                    result["enabled"] = True
                    result["errdisable_recovery"] = True

        return result

    def _extract_routing_paths(self, rules: Dict) -> List[Dict[str, Any]]:
        """Извлекает маршруты из конфигурации на основе правил из шаблона.
        
        Поддерживает форматы:
        - MikroTik: секционный формат с /ip route и add dst-address=X gateway=Y
        - Cisco/Huawei: статические маршруты в формате ip route X Y Z
        """
        routes = []
        
        # Получаем правила из шаблона
        section_pattern = rules.get("section_pattern")
        route_pattern = rules.get("route_pattern")
        dst_pattern = rules.get("dst_pattern", r"dst-address=([^\s]+)")
        gateway_pattern = rules.get("gateway_pattern", r"(?<!check-)gateway=\s*([^\s]+)")
        comment_pattern = rules.get("comment_pattern", r"comment=([^\s]+)")
        disabled_pattern = rules.get("disabled_pattern", r"disabled=(yes|no)")
        static_route_pattern = rules.get("static_route_pattern")  # Для Cisco/Huawei
        
        # Определяем формат по наличию section_pattern (MikroTik) или static_route_pattern (Cisco/Huawei)
        is_mikrotik_format = section_pattern is not None
        is_static_route_format = static_route_pattern is not None
        
        if is_mikrotik_format:
            # MikroTik формат: /ip route ... add dst-address=X gateway=Y
            routes.extend(self._extract_mikrotik_routes(
                section_pattern=section_pattern,
                dst_pattern=dst_pattern,
                gateway_pattern=gateway_pattern,
                comment_pattern=comment_pattern,
                disabled_pattern=disabled_pattern
            ))
        elif is_static_route_format:
            # Cisco/Huawei формат: ip route X Y Z
            routes.extend(self._extract_static_routes(static_route_pattern))
        else:
            # Fallback: пытаемся определить формат автоматически
            if any(line.strip() == "/ip route" for line in self.content_lines):
                routes.extend(self._extract_mikrotik_routes(
                    section_pattern=r"^/ip route$",
                    dst_pattern=dst_pattern,
                    gateway_pattern=gateway_pattern,
                    comment_pattern=comment_pattern,
                    disabled_pattern=disabled_pattern
                ))
        
        return routes

    def _extract_mikrotik_routes(self, section_pattern: str, dst_pattern: str,
                                  gateway_pattern: str, comment_pattern: str,
                                  disabled_pattern: str) -> List[Dict[str, Any]]:
        """Извлекает маршруты в формате MikroTik."""
        routes = []
        in_route_section = False

        # Объединяем многострочные команды (с продолжением \)
        joined_lines = []
        current_line = ""

        for line in self.content_lines:
            if current_line:
                current_line += " " + line.lstrip()
            else:
                current_line = line

            if current_line.rstrip().endswith("\\"):
                current_line = current_line.rstrip()[:-1]
            else:
                joined_lines.append(current_line)
                current_line = ""

        if current_line:
            joined_lines.append(current_line)

        for line in joined_lines:
            if re.search(section_pattern, line, re.IGNORECASE):
                in_route_section = True
                continue

            if in_route_section and line.startswith("/"):
                in_route_section = False
                continue

            if not in_route_section:
                continue

            if not line.strip().startswith("add"):
                continue

            dst_match = re.search(dst_pattern, line)
            gateway_match = re.search(gateway_pattern, line)
            comment_match = re.search(comment_pattern, line) if comment_pattern else None
            disabled_match = re.search(disabled_pattern, line) if disabled_pattern else None

            if dst_match and gateway_match:
                dst_address = dst_match.group(1)
                gateway = gateway_match.group(1)
                comment = comment_match.group(1).strip('"') if comment_match and comment_match.group(1) else ""
                disabled = disabled_match.group(1) == "yes" if disabled_match and disabled_match.group(1) else False

                interface = None
                if not re.match(r"^\d+\.\d+\.\d+\.\d+$", gateway):
                    interface = gateway
                else:
                    vrf_intf_match = re.search(r"vrf-interface=([^\s]+)", line)
                    if vrf_intf_match:
                        interface = vrf_intf_match.group(1)

                routes.append({
                    "dst_address": dst_address,
                    "gateway": gateway,
                    "interface": interface,
                    "comment": comment,
                    "disabled": disabled
                })

        return routes

    def _extract_static_routes(self, static_route_pattern: str) -> List[Dict[str, Any]]:
        """Извлекает статические маршруты в формате Cisco/Huawei."""
        routes = []
        
        for line in self.content_lines:
            match = re.search(static_route_pattern, line, re.IGNORECASE)
            if match:
                groups = match.groups()
                route_data = {
                    "dst_address": groups[0] if len(groups) > 0 else "",
                    "gateway": groups[1] if len(groups) > 1 else "",
                    "interface": groups[2] if len(groups) > 2 else None,
                    "comment": "",
                    "disabled": False
                }
                routes.append(route_data)
        
        return routes

    def _extract_interfaces(self, extract_all: bool = True) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
        """
        Универсальный метод извлечения интерфейсов с IP адресами.
        
        Args:
            extract_all: Если True, извлекает все интерфейсы для all_ip_interfaces.
                        Если False, извлекает только routing networks.
        
        Returns:
            Кортеж (routing_networks, all_ip_interfaces)
        """
        routing_networks = []
        all_interfaces = []
        current_interface = None
        is_shutdown = False

        # Определение формата конфигурации
        is_mikrotik = any(line.startswith("/ip address") for line in self.content_lines)

        if is_mikrotik:
            # Обработка формата MikroTik (секционный: /ip address ... add address=X interface=Y)
            in_section = False

            for line in self.content_lines:
                # Проверка на заголовок секции
                if line.strip() == "/ip address":
                    in_section = True
                    continue

                # Если в другой секции - пропускаем
                if in_section and line.startswith("/"):
                    in_section = False
                    continue

                if not in_section:
                    continue

                # Проверка на строку добавления адреса
                if not line.startswith("add"):
                    continue

                # Проверка на отключённый интерфейс
                if "disabled=yes" in line:
                    continue

                # Извлечение address=X и interface=Y
                addr_match = re.search(r"address=([^\s]+)", line)
                intf_match = re.search(r"interface=([^\s]+)", line)

                if addr_match and intf_match:
                    address = addr_match.group(1)
                    interface = intf_match.group(1)

                    # Разбор address=IP/mask
                    if "/" in address:
                        ip, mask = address.split("/", 1)
                    else:
                        ip = address
                        mask = "32"

                    # Извлечение description если есть
                    desc_match = re.search(r"comment=([^\s]+)", line)
                    description = desc_match.group(1).strip('"') if desc_match else ""

                    intf_data = {
                        'interface': interface,
                        'ip': ip,
                        'mask': mask,
                        'description': description
                    }

                    if extract_all:
                        all_interfaces.append(intf_data)
                    
                    # Для routing networks используем те же данные
                    routing_networks.append({
                        'interface': interface,
                        'network': f"{ip}/{mask}"
                    })
        else:
            # Стандартный формат (Cisco/Huawei: interface X ... ip address Y)
            for line in self.content_lines:
                # Проверка на интерфейс
                intf_match = re.search(r"^interface\s+(\S+)", line, re.IGNORECASE)
                if intf_match:
                    # Сохраняем предыдущий интерфейс если был IP
                    if current_interface and not is_shutdown and current_interface.get('ip'):
                        intf_data = {
                            'interface': current_interface['name'],
                            'ip': current_interface['ip'],
                            'mask': current_interface['mask'],
                            'description': current_interface.get('description', '')
                        }
                        
                        if extract_all:
                            all_interfaces.append(intf_data)
                        
                        routing_networks.append({
                            'interface': current_interface['name'],
                            'network': f"{current_interface['ip']}/{current_interface['mask']}"
                        })

                    current_interface = {
                        'name': intf_match.group(1),
                        'ip': None,
                        'mask': None,
                        'description': ''
                    }
                    is_shutdown = False
                    continue

                if current_interface:
                    # IP адрес в формате CIDR (10.7.0.0/31) или с маской (10.7.0.0 255.255.255.254)
                    ip_cidr_match = re.search(r"ip address\s+(\S+)/(\d+)", line, re.IGNORECASE)
                    if ip_cidr_match:
                        current_interface['ip'] = ip_cidr_match.group(1)
                        current_interface['mask'] = ip_cidr_match.group(2)  # CIDR префикс
                    else:
                        ip_mask_match = re.search(r"ip address\s+(\S+)\s+(\S+)", line, re.IGNORECASE)
                        if ip_mask_match:
                            current_interface['ip'] = ip_mask_match.group(1)
                            current_interface['mask'] = ip_mask_match.group(2)

                    # Description
                    desc_match = re.search(r"description\s+(.+)", line, re.IGNORECASE)
                    if desc_match:
                        current_interface['description'] = desc_match.group(1).strip()

                    # Shutdown
                    if re.search(r"^\s*shutdown\s*$", line, re.IGNORECASE):
                        is_shutdown = True

            # Последний интерфейс
            if current_interface and not is_shutdown and current_interface.get('ip'):
                intf_data = {
                    'interface': current_interface['name'],
                    'ip': current_interface['ip'],
                    'mask': current_interface['mask'],
                    'description': current_interface.get('description', '')
                }
                
                if extract_all:
                    all_interfaces.append(intf_data)
                
                routing_networks.append({
                    'interface': current_interface['name'],
                    'network': f"{current_interface['ip']}/{current_interface['mask']}"
                })

        return routing_networks, all_interfaces

    def _extract_all_ip_interfaces(self) -> List[Dict[str, str]]:
        """Извлекает все интерфейсы с IP адресами из конфигурации (обратная совместимость)."""
        _, all_interfaces = self._extract_interfaces(extract_all=True)
        return all_interfaces

    def to_dict(self) -> Dict[str, Any]:
        """Возвращает результаты анализа в виде словаря."""
        return {
            "filename": self.filename,
            "vendor": self.vendor,
            "device_name": self.device_name,
            "model": self.model,
            "device_type": self.device_type,
            "routing_networks": self.routing_networks,
            "total_vlans": self.total_vlans,
            "active_vlans": self.active_vlans,
            "all_vlans": self.all_vlans,
            "bgp_info": getattr(self, 'bgp_info', {}),
            "port_channels": getattr(self, 'port_channels', []),
            "vxlan_info": getattr(self, 'vxlan_info', {}),
            "management_info": getattr(self, 'management_info', {}),
            "all_ip_interfaces": getattr(self, 'all_ip_interfaces', []),
            "routing_paths": getattr(self, 'routing_paths', []),
            "vrf_info": getattr(self, 'vrf_info', {}),
            "ospf_info": getattr(self, 'ospf_info', {}),
            "lldp_info": getattr(self, 'lldp_info', {}),
            "interface_status": getattr(self, 'interface_status', {}),
            "stackwise_info": getattr(self, 'stackwise_info', {}),
            "qos_info": getattr(self, 'qos_info', {}),
            "power_info": getattr(self, 'power_info', {}),
            "udld_info": getattr(self, 'udld_info', {})
        }


class NetworkTopologyAnalyzer:
    """Анализатор сетевой топологии на основе данных об устройствах."""

    @staticmethod
    def netmask_to_prefix(netmask: str) -> int:
        """Преобразует маску из dotted-decimal в префикс."""
        try:
            # Обработка CIDR нотации (например, "31", "30")
            if netmask_str := netmask.strip():
                if netmask_str.isdigit():
                    return int(netmask_str)
            return ipaddress.IPv4Network(f"0.0.0.0/{netmask}").prefixlen
        except ValueError as e:
            raise ValueError(f"Некорректная маска '{netmask}': {e}")

    @staticmethod
    def calculate_network_address(ip_str: str, netmask_str: str) -> str:
        """Вычисляет сетевой адрес в CIDR формате."""
        prefix = NetworkTopologyAnalyzer.netmask_to_prefix(netmask_str)
        network = ipaddress.IPv4Network(f"{ip_str}/{prefix}", strict=False)
        return str(network)

    @staticmethod
    def parse_interface_network(network_entry: str) -> Dict[str, Any]:
        """Парсит запись сети интерфейса."""
        # Обработка формата "ip/mask" или "ip mask" или "ip/secondary"
        parts = network_entry.replace('secondary', '').strip().split()
        if len(parts) >= 1:
            network_str = parts[0]
            if '/' in network_str:
                ip_str, netmask_str = network_str.split('/', 1)
            else:
                ip_str = network_str
                netmask_str = '32'  # Default to host route
            
            # Обработка CIDR нотации
            if netmask_str.isdigit():
                prefix = int(netmask_str)
            else:
                try:
                    prefix = NetworkTopologyAnalyzer.netmask_to_prefix(netmask_str)
                except ValueError:
                    prefix = 32
            
            # Вычисляем реальный адрес сети (network address)
            try:
                network = ipaddress.IPv4Network(f'{ip_str}/{prefix}', strict=False)
                network_cidr = str(network)
            except ValueError:
                network_cidr = f"{ip_str}/{prefix}"
            
            return {
                'ip': ip_str,
                'prefix': prefix,
                'network_cidr': network_cidr,
                'is_loopback': prefix == 32,
                'is_mgmt_network': prefix in (24, 23, 22),
                'is_p2p': prefix in (31, 30)
            }
        
        return {
            'ip': network_entry,
            'prefix': 32,
            'network_cidr': f"{network_entry}/32",
            'is_loopback': False,
            'is_mgmt_network': False,
            'is_p2p': False
        }

    @staticmethod
    def is_physical_interface(interface_name: str) -> bool:
        """Определяет физический интерфейс."""
        non_physical = ('MEth', 'Vbdif', 'Vlanif', 'LoopBack', 'NULL')
        return not any(interface_name.startswith(prefix) for prefix in non_physical)

    @staticmethod
    def is_mgmt_interface(interface_name: str, is_mgmt_network: bool) -> bool:
        """Определяет управленческий интерфейс."""
        mgmt_indicators = ('MEth', 'Vbdif1360837')
        return (any(interface_name.startswith(prefix) for prefix in mgmt_indicators) or
                (is_mgmt_network and interface_name.startswith('Vbdif')))

    @staticmethod
    def extract_interface_number(interface_name: str) -> Tuple[str, List[int]]:
        """Извлекает базовое имя интерфейса и номера подынтерфейсов."""
        match = re.match(r'^([^\d]*[\d/]+)(?:\.(\d+))?$', interface_name)
        if not match:
            return interface_name, []
        base = match.group(1)
        subif = [int(match.group(2))] if match.group(2) else []
        return base, subif

    @staticmethod
    def extract_device_interfaces(device: Dict[str, Any], filter_type: str = 'all') -> List[Dict[str, Any]]:
        """Извлекает интерфейсы устройства с фильтрацией по типу."""
        interfaces = []
        device_name = device.get('device_name', 'unknown')
        processed_networks = set()
        
        # 1. Все IP интерфейсы из all_ip_interfaces (для b4com)
        for intf_entry in device.get('all_ip_interfaces', []):
            interface_name = intf_entry.get('interface', '')
            ip = intf_entry.get('ip')
            mask = intf_entry.get('mask', '32')
            description = intf_entry.get('description', '')
            
            if interface_name and ip:
                # Преобразуем маску
                if mask.isdigit():
                    prefix = int(mask)
                else:
                    try:
                        prefix = NetworkTopologyAnalyzer.netmask_to_prefix(mask)
                    except ValueError:
                        prefix = 32
                
                # Вычисляем реальный адрес сети
                try:
                    network = ipaddress.IPv4Network(f'{ip}/{prefix}', strict=False)
                    network_cidr = str(network)
                except ValueError:
                    network_cidr = f"{ip}/{prefix}"

                # Пропускаем дубликаты и loopback
                if network_cidr in processed_networks:
                    continue
                processed_networks.add(network_cidr)
                
                base_intf, subif_numbers = NetworkTopologyAnalyzer.extract_interface_number(interface_name)
                
                intf_data = {
                    'interface': interface_name,
                    'base_interface': base_intf,
                    'subif_numbers': subif_numbers,
                    'ip': ip,
                    'prefix': prefix,
                    'network_cidr': network_cidr,
                    'description': description,
                    'is_physical': NetworkTopologyAnalyzer.is_physical_interface(interface_name),
                    'is_mgmt': NetworkTopologyAnalyzer.is_mgmt_interface(interface_name, prefix in (24, 23, 22)),
                    'is_loopback': interface_name.lower().startswith('lo'),
                    'is_p2p': prefix in (31, 30),
                    'source': 'all_ip'
                }
                
                # Фильтрация
                if filter_type == 'physical':
                    if not (intf_data['is_physical'] and intf_data['is_p2p'] and not intf_data['is_loopback']):
                        continue
                elif filter_type == 'mgmt':
                    if not (intf_data['is_mgmt'] and not intf_data['is_loopback']):
                        continue
                elif filter_type == 'logical':
                    if (intf_data['is_loopback'] or
                            intf_data['is_mgmt'] or
                            (intf_data['is_physical'] and intf_data['is_p2p'])):
                        continue
                
                interfaces.append(intf_data)
        
        # 2. Management interface из management_info (если ещё не добавлен)
        if filter_type in ('all', 'mgmt'):
            mgmt_info = device.get('management_info', {})
            if mgmt_info.get('mgmt_interface') and mgmt_info.get('mgmt_ip'):
                mgmt_ip = mgmt_info['mgmt_ip']
                mgmt_mask = mgmt_info.get('mgmt_mask', '24')
                mgmt_intf = mgmt_info['mgmt_interface']
                
                # Проверяем, не добавлен ли уже
                already_added = any(
                    intf['interface'] == mgmt_intf and intf['ip'] == mgmt_ip 
                    for intf in interfaces
                )
                
                if not already_added:
                    # Преобразуем маску если нужно
                    if mgmt_mask.isdigit():
                        prefix = int(mgmt_mask)
                    else:
                        try:
                            prefix = NetworkTopologyAnalyzer.netmask_to_prefix(mgmt_mask)
                        except ValueError:
                            prefix = 24
                    
                    interfaces.append({
                        'interface': mgmt_intf,
                        'base_interface': mgmt_intf,
                        'subif_numbers': [],
                        'ip': mgmt_ip,
                        'prefix': prefix,
                        'network_cidr': f"{mgmt_ip}/{prefix}",
                        'is_physical': True,
                        'is_mgmt': True,
                        'is_loopback': False,
                        'is_p2p': False,
                        'source': 'management'
                    })
        
        return interfaces

    @staticmethod
    def find_physical_links(devices_data: List[Dict[str, Any]]) -> List[List[Any]]:
        """Выявляет физические P2P связи через /31 и /30 сети с указанием вендора и типа."""
        # Маппинг имени → метаданные
        device_metadata: Dict[str, Dict[str, str]] = {
            device['device_name']: {
                'vendor': device['vendor'],
                'device_type': device['device_type']
            }
            for device in devices_data if device['device_name'] != 'unknown'
        }

        # Сбор физических интерфейсов
        device_interfaces: Dict[str, List[Dict[str, Any]]] = {}
        for device in devices_data:
            device_name = device['device_name']
            if device_name != 'unknown':
                device_interfaces[device_name] = NetworkTopologyAnalyzer.extract_device_interfaces(
                    device, filter_type='physical'
                )

        # Индексация сетей
        network_index: Dict[str, List[Tuple[str, Dict[str, Any]]]] = {}
        for device_name, interfaces in device_interfaces.items():
            for intf in interfaces:
                net = intf['network_cidr']
                network_index.setdefault(net, []).append((device_name, intf))

        # Формирование связей
        links = []
        processed_pairs: Set[Tuple[str, str, str]] = set()

        for network_cidr, endpoints in network_index.items():
            if len(endpoints) != 2:
                continue

            dev1_name, intf1 = endpoints[0]
            dev2_name, intf2 = endpoints[1]

            pair_key = tuple(sorted([dev1_name, dev2_name]) + [network_cidr])
            if pair_key in processed_pairs:
                continue

            processed_pairs.add(pair_key)

            dev1_meta = device_metadata.get(dev1_name, {'vendor': 'N/A', 'device_type': 'N/A'})
            dev2_meta = device_metadata.get(dev2_name, {'vendor': 'N/A', 'device_type': 'N/A'})

            links.append([
                dev1_name,
                dev1_meta['vendor'],
                dev1_meta['device_type'],
                intf1['interface'],
                intf1['ip'],
                dev2_name,
                dev2_meta['vendor'],
                dev2_meta['device_type'],
                intf2['interface'],
                intf2['ip'],
                network_cidr
            ])

        return links

    @staticmethod
    def find_mgmt_interfaces(devices_data: List[Dict[str, Any]]) -> List[List[str]]:
        """Извлекает управленческие интерфейсы."""
        mgmt_interfaces = []
        for device in devices_data:
            device_name = device['device_name']
            if device_name == 'unknown':
                continue
            mgmt_ifs = NetworkTopologyAnalyzer.extract_device_interfaces(device, filter_type='mgmt')
            for intf in mgmt_ifs:
                mgmt_interfaces.append([
                    device_name,
                    device.get('vendor', 'unknown'),  # Add vendor
                    device.get('device_type', 'unknown'),  # Add type
                    intf['interface'],
                    intf['ip'],
                    intf['network_cidr']
                ])

            # Если mgmt интерфейсы не найдены, но есть routing_networks, добавляем их как mgmt
            # Это нужно для одиночных устройств типа MikroTik
            if not mgmt_ifs and device.get('routing_networks'):
                for routing_net in device['routing_networks']:
                    interface = routing_net.get('interface', '')
                    network = routing_net.get('network', '')

                    # Разбор network=IP/mask
                    if "/" in network:
                        ip, mask = network.split("/", 1)
                        prefix = int(mask) if mask.isdigit() else 24
                    else:
                        ip = network
                        prefix = 24

                    # Вычисляем network_cidr
                    try:
                        network_obj = ipaddress.IPv4Network(f"{ip}/{prefix}", strict=False)
                        network_cidr = str(network_obj)
                    except ValueError:
                        network_cidr = f"{ip}/{prefix}"

                    mgmt_interfaces.append([
                        device_name,
                        device.get('vendor', 'unknown'),
                        device.get('device_type', 'unknown'),
                        interface,
                        ip,
                        network_cidr
                    ])

        mgmt_interfaces.sort(key=lambda x: (x[5], x[0]))  # Sort by network_cidr then device_name
        return mgmt_interfaces

    @staticmethod
    def find_logical_links(devices_data: List[Dict[str, Any]]) -> List[List[str]]:
        """Выявляет логические связи (сервисные сети, VXLAN, логические P2P)."""
        logical_links = []
        processed_networks: Set[str] = set()
        processed_vni_pairs: Set[Tuple[str, str, int]] = set()

        # Создание маппинга имени устройства к его вендору и типу
        device_metadata: Dict[str, Dict[str, str]] = {
            device['device_name']: {
                'vendor': device['vendor'],
                'device_type': device['device_type']
            }
            for device in devices_data
            if device['device_name'] != 'unknown'
        }

        # Сбор всех интерфейсов
        all_interfaces: Dict[str, List[Dict[str, Any]]] = {}
        for device in devices_data:
            device_name = device['device_name']
            if device_name != 'unknown':
                all_interfaces[device_name] = NetworkTopologyAnalyzer.extract_device_interfaces(
                    device, filter_type='all'
                )

        # 1. Сервисные сети (VBDIF/Vlanif)
        network_to_devices: Dict[str, List[Tuple[str, Dict[str, Any]]]] = {}
        for device_name, interfaces in all_interfaces.items():
            for intf in interfaces:
                if (intf['interface'].startswith(('Vbdif', 'Vlanif')) and
                        24 <= intf['prefix'] <= 28 and
                        not intf['is_loopback']):
                    net = intf['network_cidr']
                    network_to_devices.setdefault(net, []).append((device_name, intf))

        for network_cidr, endpoints in network_to_devices.items():
            if len(endpoints) < 2 or network_cidr in processed_networks:
                continue
            processed_networks.add(network_cidr)
            for i in range(len(endpoints)):
                for j in range(i + 1, len(endpoints)):
                    dev1_name, intf1 = endpoints[i]
                    dev2_name, intf2 = endpoints[j]

                    # Получаем метаданные устройств
                    dev1_meta = device_metadata.get(dev1_name, {'vendor': 'N/A', 'device_type': 'N/A'})
                    dev2_meta = device_metadata.get(dev2_name, {'vendor': 'N/A', 'device_type': 'N/A'})

                    logical_links.append([
                        dev1_name,
                        dev1_meta['vendor'],
                        dev1_meta['device_type'],
                        f"{intf1['interface']}/{intf1['ip']}",
                        dev2_name,
                        dev2_meta['vendor'],
                        dev2_meta['device_type'],
                        f"{intf2['interface']}/{intf2['ip']}",
                        f"Service Network: {network_cidr}"
                    ])

        # 2. VXLAN overlay (подынтерфейсы с номерами VNI)
        vni_map: Dict[int, List[Tuple[str, Dict[str, Any]]]] = {}
        for device_name, interfaces in all_interfaces.items():
            for intf in interfaces:
                if intf['subif_numbers'] and intf['base_interface'].startswith(('100GE', '40GE', '10GE')):
                    vni = intf['subif_numbers'][0]
                    if 1000 <= vni <= 16777215:
                        vni_map.setdefault(vni, []).append((device_name, intf))

        for vni, endpoints in vni_map.items():
            if len(endpoints) < 2:
                continue
            base_intf_groups: Dict[str, List[Tuple[str, Dict[str, Any]]]] = {}
            for dev_name, intf in endpoints:
                base_intf_groups.setdefault(intf['base_interface'], []).append((dev_name, intf))
            for group_endpoints in base_intf_groups.values():
                if len(group_endpoints) < 2:
                    continue
                for i in range(len(group_endpoints)):
                    for j in range(i + 1, len(group_endpoints)):
                        dev1_name, intf1 = group_endpoints[i]
                        dev2_name, intf2 = group_endpoints[j]
                        pair_key = (min(dev1_name, dev2_name), max(dev1_name, dev2_name), vni)
                        if pair_key in processed_vni_pairs:
                            continue
                        processed_vni_pairs.add(pair_key)
                        # Получаем метаданные устройств
                        dev1_meta = device_metadata.get(dev1_name, {'vendor': 'N/A', 'device_type': 'N/A'})
                        dev2_meta = device_metadata.get(dev2_name, {'vendor': 'N/A', 'device_type': 'N/A'})

                        logical_links.append([
                            dev1_name,
                            dev1_meta['vendor'],
                            dev1_meta['device_type'],
                            f"{intf1['interface']}/{intf1['ip']}",
                            dev2_name,
                            dev2_meta['vendor'],
                            dev2_meta['device_type'],
                            f"{intf2['interface']}/{intf2['ip']}",
                            f"VXLAN VNI {vni} (Overlay)"
                        ])

        # 3. Логические P2P через /30
        p2p30_networks: Dict[str, List[Tuple[str, Dict[str, Any]]]] = {}
        for device_name, interfaces in all_interfaces.items():
            for intf in interfaces:
                if (intf['prefix'] == 30 and
                        not intf['is_loopback'] and
                        not (intf['is_physical'] and intf['interface'].startswith(('100GE', '40GE')))):
                    net = intf['network_cidr']
                    p2p30_networks.setdefault(net, []).append((device_name, intf))

        for network_cidr, endpoints in p2p30_networks.items():
            if len(endpoints) != 2 or network_cidr in processed_networks:
                continue
            processed_networks.add(network_cidr)
            dev1_name, intf1 = endpoints[0]
            dev2_name, intf2 = endpoints[1]
            # Получаем метаданные устройств
            dev1_meta = device_metadata.get(dev1_name, {'vendor': 'N/A', 'device_type': 'N/A'})
            dev2_meta = device_metadata.get(dev2_name, {'vendor': 'N/A', 'device_type': 'N/A'})

            logical_links.append([
                dev1_name,
                dev1_meta['vendor'],
                dev1_meta['device_type'],
                f"{intf1['interface']}/{intf1['ip']}",
                dev2_name,
                dev2_meta['vendor'],
                dev2_meta['device_type'],
                f"{intf2['interface']}/{intf2['ip']}",
                f"Logical P2P: {network_cidr}"
            ])

        return logical_links

    @staticmethod
    def analyze_topology(devices_data: List[Dict[str, Any]]) -> Dict[str, List[List[str]]]:
        """Полный анализ сетевой топологии."""
        return {
            "physical_links": NetworkTopologyAnalyzer.find_physical_links(devices_data),
            "mgmt_networks": NetworkTopologyAnalyzer.find_mgmt_interfaces(devices_data),
            "logical_links": NetworkTopologyAnalyzer.find_logical_links(devices_data)
        }


class ReportGenerator:
    """Генератор отчётов по результатам анализа."""

    @staticmethod
    def print_short_report(results: List[Dict[str, Any]]) -> None:
        """Печатает краткий отчёт в виде таблицы."""
        headers = ["Файл", "Вендор", "Имя", "Модель", "Тип", "VLAN", "Сети"]
        rows = []

        for r in results:
            filename = r["filename"]
            if len(filename) > 35:
                filename = filename[:32] + "..."

            rows.append([
                filename,
                r["vendor"],
                r["device_name"] if r["device_name"] != "unknown" else "—",
                r["model"] if r["model"] != "unknown" else "—",
                r["device_type"],
                str(r["total_vlans"]),
                str(len(r["routing_networks"]))
            ])

        col_widths = [
            max(len(str(row[i])) for row in [headers] + rows)
            for i in range(len(headers))
        ]

        def format_row(row_data):
            return "   ".join(str(item).ljust(col_widths[i]) for i, item in enumerate(row_data))

        total_width = sum(col_widths) + 3 * (len(col_widths) - 1)
        print("\n" + "=" * total_width)
        print(format_row(headers))
        print("-" * total_width)
        for row in rows:
            print(format_row(row))
        print("=" * total_width + "\n")

    @staticmethod
    def print_topology_analysis(result: Dict[str, List[List[str]]]) -> None:
        """Печатает анализ топологии."""
        # Физические связи
        links = result.get("physical_links", [])
        print("\n" + "=" * 150)
        print("🔗 ФИЗИЧЕСКИЕ СВЯЗИ (Physical P2P Links)")
        print("=" * 150)
        if links:
            print(f"{'Устройство 1':<25} | {'Интерфейс':<18} | {'IP':<16} | "
                  f"{'Устройство 2':<25} | {'Интерфейс':<18} | {'IP':<16} | {'Сеть':<20}")
            print("-" * 150)
            for link in links:
                dev1, vendor1, type1, intf1, ip1, dev2, vendor2, type2, intf2, ip2, net = link
                print(f"{dev1:<25} | {intf1:<18} | {ip1:<16} | "
                      f"{dev2:<25} | {intf2:<18} | {ip2:<16} | {net:<20}")
            print(f"\n✅ Всего физических связей: {len(links)}")
        else:
            print("⚠️  Физические связи не обнаружены")

        # Управленческие сети
        mgmt = result.get("mgmt_networks", [])
        print("\n" + "=" * 110)
        print("🖥️  УПРАВЛЕНЧЕСКИЕ ИНТЕРФЕЙСЫ (Management Networks)")
        print("=" * 110)
        if mgmt:
            print(f"{'Устройство':<25} |  {'Интерфейс':<18} | {'IP адрес':<16} | {'Сеть':<20}")
            print("-" * 110)
            for entry in mgmt:
                if len(entry) >= 6:
                    dev, vendor, dev_type, intf, ip, net = entry
                    print(f"{dev:<25} |  {intf:<18} | {ip:<16} | {net:<20}")
                else:
                    # Fallback for backward compatibility
                    dev, intf, ip, net = entry
                    print(f"{dev:<25} |  {intf:<18} | {ip:<16} | {net:<20}")
            print(f"\n✅ Всего управленческих интерфейсов: {len(mgmt)}")

            networks = {}
            for entry in mgmt:
                if len(entry) >= 6:
                    net = entry[5]
                    networks.setdefault(net, []).append(f"{entry[0]} ({entry[4]})")
                else:
                    net = entry[3]
                    networks.setdefault(net, []).append(f"{entry[0]} ({entry[2]})")

            print("\nГруппировка по сетям управления:")
            for net, devices in sorted(networks.items()):
                print(f"  • {net}: {', '.join(devices)}")
        else:
            print("⚠️  Управленческие интерфейсы не обнаружены")

        # Логические связи
        logical = result.get("logical_links", [])
        print("\n" + "=" * 160)
        print("🌐 ЛОГИЧЕСКИЕ СВЯЗИ (Logical Links: VXLAN Overlay, Service Networks)")
        print("=" * 160)
        if logical:
            print(f"{'Устройство 1':<25} | {'Интерфейс/IP':<25}    | {'Устройство 2':<25} | {'Интерфейс/IP':<25}    | {'Тип связи':<35}")
            print("-" * 160)
            for link in logical:
                if len(link) >= 9:
                    dev1, vendor1, type1, intf_ip1, dev2, vendor2, type2, intf_ip2, desc = link
                    print(f"{dev1:<25} |  {intf_ip1:<25} | {dev2:<25} |  {intf_ip2:<25} | {desc:<35}")
                else:
                    # Fallback for backward compatibility
                    dev1, intf_ip1, dev2, intf_ip2, desc = link
                    print(f"{dev1:<25} |  {intf_ip1:<25} | {dev2:<25} |  {intf_ip2:<25} | {desc:<35}")
            print(f"\n✅ Всего логических связей: {len(logical)}")

            # Calculate statistics considering the new structure
            vxlan_count = 0
            service_count = 0
            p2p_count = 0
            for l in logical:
                if len(l) >= 9:
                    desc = l[8]  # Description is at index 8 in new structure
                else:
                    desc = l[4]  # Description is at index 4 in old structure
                if 'VXLAN' in desc:
                    vxlan_count += 1
                if 'Service Network' in desc:
                    service_count += 1
                if 'Logical P2P' in desc:
                    p2p_count += 1

            print("\nСтатистика логических связей:")
            if vxlan_count:
                print(f"  • VXLAN Overlay (VNI): {vxlan_count}")
            if service_count:
                print(f"  • Сервисные сети (L3): {service_count}")
            if p2p_count:
                print(f"  • Логические P2P (/30): {p2p_count}")
        else:
            print("ℹ️  Логические связи не обнаружены (требуется дополнительная информация о конфигурации тоннелей)")

        print("=" * 130 + "\n")

    @staticmethod
    def write_detailed_report(results: List[Dict[str, Any]],
                              output_file: str,
                              links_result: Dict[str, List[List[str]]],
                              conf_dir: str) -> None:
        """Записывает подробный отчёт в файл."""
        from datetime import datetime

        with open(output_file, "w", encoding='utf-8') as f:
            f.write(f"Анализ сетевого оборудования - {len(results)} устройств\n")
            f.write(f"Дата: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write("=" * 80 + "\n\n")

            for r in results:
                f.write(f"{'=' * 40}\n")
                f.write(f"Устройство: {r['filename']}\n")
                f.write(f"{'=' * 40}\n")
                f.write(f"Vendor: {r['vendor']}\n")
                f.write(f"Device Name: {r['device_name']}\n")
                f.write(f"Model: {r['model']}\n")
                f.write(f"Type: {r['device_type']}\n")
                f.write(f"Total VLANs: {r['total_vlans']}\n")
                f.write(
                    f"Active VLANs: {', '.join(str(vlan) for vlan in r['active_vlans']) if r['active_vlans'] else 'None'}\n")
                f.write(f"Routing Networks Count: {len(r['routing_networks'])}\n")

                if r['routing_networks']:
                    f.write("\nRouting Networks:\n")
                    for i, net in enumerate(r["routing_networks"], 1):
                        if 'interface' in net:
                            f.write(f"  {i}. Interface: {net['interface']}, Network: {net['network']}\n")
                        elif 'route' in net:
                            f.write(f"  {i}. Static Route: {net['route']}\n")

                f.write("\nConfiguration snippet:\n")
                try:
                    with open(Path(conf_dir) / r['filename'], 'r', encoding='utf-8', errors='ignore') as config_file:
                        lines = config_file.readlines()
                        for line in lines[:10]:
                            f.write(f"  {line.rstrip()}\n")
                except Exception as e:
                    f.write(f"  ⚠️ Не удалось прочитать конфигурацию: {str(e)}\n")

                # VRF информация
                vrf_info = r.get('vrf_info', {})
                if vrf_info and vrf_info.get('enabled') and vrf_info.get('vrfs'):
                    f.write("\nVRF (Virtual Routing and Forwarding):\n")
                    for vrf in vrf_info['vrfs']:
                        f.write(f"  • VRF: {vrf['name']}\n")
                        if vrf.get('description'):
                            f.write(f"    Description: {vrf['description']}\n")

                # OSPF информация
                ospf_info = r.get('ospf_info', {})
                if ospf_info and ospf_info.get('enabled'):
                    f.write("\nOSPF Configuration:\n")
                    f.write(f"  • Process ID: {ospf_info.get('process_id', 'N/A')}\n")
                    if ospf_info.get('vrf'):
                        f.write(f"  • VRF: {ospf_info['vrf']}\n")
                    if ospf_info.get('router_id'):
                        f.write(f"  • Router ID: {ospf_info['router_id']}\n")
                    if ospf_info.get('areas'):
                        f.write("  • Areas:\n")
                        for area in ospf_info['areas']:
                            area_id = area.get('area_id', 'N/A')
                            auth = area.get('authentication', 'N/A')
                            f.write(f"    - Area {area_id}: Authentication = {auth}\n")
                    if ospf_info.get('networks'):
                        f.write("  • Networks:\n")
                        for net in ospf_info['networks'][:10]:  # Ограничим вывод
                            f.write(f"    - {net['network']} → Area {net['area']}\n")
                        if len(ospf_info['networks']) > 10:
                            f.write(f"    ... и ещё {len(ospf_info['networks']) - 10} сетей\n")

                # LLDP информация
                lldp_info = r.get('lldp_info', {})
                if lldp_info and lldp_info.get('enabled') and lldp_info.get('lldp_run'):
                    f.write("\nLLDP Configuration:\n")
                    f.write("  • LLDP: Enabled\n")
                    if lldp_info.get('neighbors'):
                        f.write(f"  • Neighbors: {len(lldp_info['neighbors'])} обнаружено\n")
                        for neighbor in lldp_info['neighbors'][:10]:  # Ограничим вывод
                            intf = neighbor.get('interface', 'N/A')
                            desc = neighbor.get('description', 'N/A')
                            chassis = neighbor.get('chassis_id', 'N/A')
                            port = neighbor.get('port_id', 'N/A')
                            f.write(f"    - {intf}: {desc}")
                            if chassis != 'N/A' or port != 'N/A':
                                f.write(f" (Chassis: {chassis}, Port: {port})")
                            f.write("\n")
                        if len(lldp_info['neighbors']) > 10:
                            f.write(f"    ... и ещё {len(lldp_info['neighbors']) - 10} соседей\n")

                # Статус интерфейсов
                interface_status = r.get('interface_status', {})
                if interface_status:
                    up_count = sum(1 for s in interface_status.values() if s == 'up')
                    down_count = sum(1 for s in interface_status.values() if s == 'down')
                    f.write(f"\nInterface Status: {up_count} up, {down_count} down\n")
                    # Показываем только интерфейсы в состоянии down
                    down_interfaces = [intf for intf, status in interface_status.items() if status == 'down']
                    if down_interfaces:
                        f.write("  • Down interfaces:\n")
                        for intf in down_interfaces[:10]:
                            f.write(f"    - {intf}: DOWN\n")
                        if len(down_interfaces) > 10:
                            f.write(f"    ... и ещё {len(down_interfaces) - 10} интерфейсов\n")

                f.write("\n")

            links = links_result.get("physical_links", [])
            if not links:
                f.write("⚠️  Физические связи не обнаружены\n")
            else:
                f.write("### Таблица связей между устройствами\n")
                f.write("\n" + "=" * 150 + "\n")
                f.write(f"{'Устройство 1':<25} | {'Интерфейс':<18} | {'IP':<16} | "
                        f"{'Устройство 2':<25} | {'Интерфейс':<18} | {'IP':<16} | {'Сеть':<20}\n")
                f.write("=" * 150 + "\n")

                for link in links:
                    dev1, vendor1, type1, intf1, ip1, dev2, vendor2, type2, intf2, ip2, net = link
                    f.write(f"{dev1:<25} | {intf1:<18} | {ip1:<16} | "
                            f"{dev2:<25} | {intf2:<18} | {ip2:<16} | {net:<20}\n")

                f.write("=" * 150 + "\n")
                f.write(f"Всего обнаружено физических связей: {len(links)}\n")

            # Управленческие сети
            mgmt = links_result.get("mgmt_networks", [])
            f.write("\n" + "=" * 130 + "\n")
            f.write(" 🖥️  УПРАВЛЕНЧЕСКИЕ ИНТЕРФЕЙСЫ (Management Networks)\n")
            f.write("=" * 130 + "\n")
            if mgmt:
                f.write(f"{'Устройство':<25} | {'Вендор':<15} | {'Тип':<15} | {'Интерфейс':<18} | {'IP адрес':<16} | {'Сеть':<20}\n")
                f.write("-" * 130 + "\n")
                for entry in mgmt:
                    if len(entry) >= 6:
                        dev, vendor, dev_type, intf, ip, net = entry
                        f.write(f"{dev:<25} | {vendor:<15} | {dev_type:<15} | {intf:<18} | {ip:<16} | {net:<20}\n")
                    else:
                        # Fallback for backward compatibility
                        dev, intf, ip, net = entry
                        f.write(f"{dev:<25} | {'':<15} | {'':<15} | {intf:<18} | {ip:<16} | {net:<20}\n")
                f.write(f"\n✅ Всего управленческих интерфейсов: {len(mgmt)}\n")

                networks = {}
                for entry in mgmt:
                    if len(entry) >= 6:
                        net = entry[5]
                        networks.setdefault(net, []).append(f"{entry[0]} ({entry[4]})")
                    else:
                        net = entry[3]
                        networks.setdefault(net, []).append(f"{entry[0]} ({entry[2]})")

                f.write("\nГруппировка по сетям управления:\n")
                for net, devices in sorted(networks.items()):
                    f.write(f"  • {net}: {', '.join(devices)}\n")
            else:
                f.write("⚠️  Управленческие интерфейсы не обнаружены\n")

            # Логические связи
            logical = links_result.get("logical_links", [])
            f.write("\n" + "=" * 160 + "\n")
            f.write(" 🌐 ЛОГИЧЕСКИЕ СВЯЗИ (Logical Links: VXLAN Overlay, Service Networks)\n")
            f.write("=" * 160 + "\n")
            if logical:
                f.write(f"{'Устройство 1':<25} | {'Вендор':<12} | {'Тип':<15} | {'Интерфейс/IP':<25} | {'Устройство 2':<25} | {'Вендор':<12} | {'Тип':<15} | {'Интерфейс/IP':<25} | {'Тип связи':<35}\n")
                f.write("-" * 160 + "\n")
                for link in logical:
                    if len(link) >= 9:
                        dev1, vendor1, type1, intf_ip1, dev2, vendor2, type2, intf_ip2, desc = link
                        f.write(f"{dev1:<25} | {vendor1:<12} | {type1:<15} | {intf_ip1:<25} | {dev2:<25} | {vendor2:<12} | {type2:<15} | {intf_ip2:<25} | {desc:<35}\n")
                    else:
                        # Fallback for backward compatibility
                        dev1, intf_ip1, dev2, intf_ip2, desc = link
                        f.write(f"{dev1:<25} | {'':<12} | {'':<15} | {intf_ip1:<25} | {dev2:<25} | {'':<12} | {'':<15} | {intf_ip2:<25} | {desc:<35}\n")
                f.write(f"\n✅ Всего логических связей: {len(logical)}\n")

                # Calculate statistics considering the new structure
                vxlan_count = 0
                service_count = 0
                p2p_count = 0
                for l in logical:
                    if len(l) >= 9:
                        desc = l[8]  # Description is at index 8 in new structure
                    else:
                        desc = l[4]  # Description is at index 4 in old structure
                    if 'VXLAN' in desc:
                        vxlan_count += 1
                    if 'Service Network' in desc:
                        service_count += 1
                    if 'Logical P2P' in desc:
                        p2p_count += 1

                f.write("\nСтатистика логических связей:\n")
                if vxlan_count:
                    f.write(f"  • VXLAN Overlay (VNI): {vxlan_count}\n")
                if service_count:
                    f.write(f"  • Сервисные сети (L3): {service_count}\n")
                if p2p_count:
                    f.write(f"  • Логические P2P (/30): {p2p_count}\n")
            else:
                f.write("ℹ️  Логические связи не обнаружены (требуется дополнительная информация о конфигурации тоннелей)\n")

            f.write(f"\n✅ Детальная информация сохранена в файл: {output_file}\n")

        print(f"✅ Детальная информация сохранена в файл: \033[32m{output_file}\033[0m\n\n")

    @staticmethod
    def draw_topology_ascii(results: List[Dict[str, Any]], 
                            links_result: Dict[str, List[List[str]]],
                            output_file: str) -> None:
        """Генерирует текстовую ASCII-диаграмму топологии и расширенную информацию."""
        from datetime import datetime

        with open(output_file, "a", encoding='utf-8') as f:
            # Заголовок секции топологии
            f.write("\n" + "=" * 130 + "\n")
            f.write(" 📊 ТЕКСТОВАЯ КАРТА ТОПОЛОГИИ СЕТИ\n")
            f.write("=" * 130 + "\n\n")

            # === СПИСЕК УСТРОЙСТВ ПО РОЛЯМ ===
            f.write("┌" + "─" * 128 + "┐\n")
            f.write("│" + " СПИСОК УСТРОЙСТВ ПО РОЛЯМ ".center(128) + "│\n")
            f.write("└" + "─" * 128 + "┘\n\n")

            spine_devices = [r for r in results if 'spn' in r['device_name'].lower()]
            leaf_devices = [r for r in results if 'lf' in r['device_name'].lower() and 'brl' not in r['device_name'].lower()]
            border_devices = [r for r in results if 'brl' in r['device_name'].lower()]

            f.write("  Spine (Ядро):\n")
            for dev in spine_devices:
                vxlan_ip = dev.get('vxlan_info', {}).get('vtep_ip', 'N/A')
                bgp_asn = dev.get('bgp_info', {}).get('asn', 'N/A')
                f.write(f"    ├── {dev['device_name']:<25} VTEP: {vxlan_ip:<15} ASN: {bgp_asn}\n")
            f.write("\n")

            f.write("  Leaf (Доступ):\n")
            for dev in leaf_devices:
                vxlan_ip = dev.get('vxlan_info', {}).get('vtep_ip', 'N/A')
                bgp_asn = dev.get('bgp_info', {}).get('asn', 'N/A')
                vlan_count = dev.get('total_vlans', 0)
                f.write(f"    ├── {dev['device_name']:<25} VTEP: {vxlan_ip:<15} ASN: {bgp_asn}  VLANs: {vlan_count}\n")
            f.write("\n")

            f.write("  Border Leaf (Граница):\n")
            for dev in border_devices:
                vxlan_ip = dev.get('vxlan_info', {}).get('vtep_ip', 'N/A')
                bgp_asn = dev.get('bgp_info', {}).get('asn', 'N/A')
                vlan_count = dev.get('total_vlans', 0)
                f.write(f"    ├── {dev['device_name']:<25} VTEP: {vxlan_ip:<15} ASN: {bgp_asn}  VLANs: {vlan_count}\n")
            f.write("\n")

            # === BGP ТОПОЛОГИЯ ===
            f.write("┌" + "─" * 128 + "┐\n")
            f.write("│" + " BGP ТОПОЛОГИЯ (EVPN) ".center(128) + "│\n")
            f.write("└" + "─" * 128 + "┘\n\n")

            # ASCII схема BGP
            f.write("                          ASN 65100 (Spine)\n")
            f.write("              ┌────────────┬────────────┬────────────┐\n")
            for dev in spine_devices:
                bgp_info = dev.get('bgp_info', {})
                router_id = bgp_info.get('router_id', 'N/A')
                f.write(f"          {dev['device_name']:<18} (RID: {router_id})\n")
            f.write("              │            │            │\n")
            f.write("     ─────────┴────────────┴────────────┴─────────\n")
            f.write("     │              │                  │         │\n")
            
            for dev in leaf_devices:
                bgp_info = dev.get('bgp_info', {})
                asn = bgp_info.get('asn', 'N/A')
                f.write(f"  ASN {asn:<5}         ASN {asn:<5}\n")
                f.write(f"  {dev['device_name']:<18}\n")
            
            for dev in border_devices:
                bgp_info = dev.get('bgp_info', {})
                asn = bgp_info.get('asn', 'N/A')
                f.write(f"          ASN {asn:<5}         ASN {asn:<5}\n")
                f.write(f"          {dev['device_name']:<18}\n")
            f.write("\n")

            # Детали BGP сессий
            f.write("  BGP Соседи:\n")
            for dev in results:
                bgp_info = dev.get('bgp_info', {})
                if bgp_info.get('enabled'):
                    f.write(f"\n    {dev['device_name']} (ASN {bgp_info.get('asn', 'N/A')}):\n")
                    neighbors = bgp_info.get('neighbors', [])[:5]  # Первые 5 соседей
                    for n in neighbors:
                        evpn_status = "✓ EVPN" if n.get('evpn_enabled') else ""
                        f.write(f"      ├── {n['ip']:<15} → AS {n['remote_as']:<6} {n.get('description', ''):<20} {evpn_status}\n")
                    if len(bgp_info.get('neighbors', [])) > 5:
                        f.write(f"      ... и ещё {len(bgp_info.get('neighbors', [])) - 5} соседей\n")
            f.write("\n")

            # === VXLAN ИНФОРМАЦИЯ ===
            f.write("┌" + "─" * 128 + "┐\n")
            f.write("│" + " VXLAN / EVPN КОНФИГУРАЦИЯ ".center(128) + "│\n")
            f.write("└" + "─" * 128 + "┘\n\n")

            f.write("  VTEP IP адреса:\n")
            for dev in results:
                vxlan_info = dev.get('vxlan_info', {})
                if vxlan_info.get('enabled'):
                    f.write(f"    ├── {dev['device_name']:<25} → {vxlan_info.get('vtep_ip', 'N/A')}\n")
            f.write("\n")

            anycast_mac = None
            for dev in results:
                vxlan_info = dev.get('vxlan_info', {})
                if vxlan_info.get('anycast_mac'):
                    anycast_mac = vxlan_info['anycast_mac']
                    break
            if anycast_mac:
                f.write(f"  Anycast Gateway MAC: {anycast_mac}\n\n")

            # VNI список - все устройства
            f.write("  VNI (VXLAN Network Identifier):\n")
            # Ширина колонок: VNI=12, Bridge VLAN=13, VNI Name=12, Device=25
            col1, col2, col3, col4 = 12, 13, 12, 25
            f.write("    ┌" + "─" * col1 + "┬" + "─" * col2 + "┬" + "─" * col3 + "┬" + "─" * col4 + "┐\n")
            f.write("    │" + "VNI".center(col1) + "│" + "Bridge VLAN".center(col2) + "│" + "VNI Name".center(col3) + "│" + "Device".center(col4) + "│\n")
            f.write("    ├" + "─" * col1 + "┼" + "─" * col2 + "┼" + "─" * col3 + "┼" + "─" * col4 + "┤\n")
            
            vni_count = 0
            for dev in results:
                vxlan_info = dev.get('vxlan_info', {})
                vnis = vxlan_info.get('vnis', [])
                device_name = dev.get('device_name', 'unknown')
                for vni in vnis:
                    vni_id = str(vni.get('vni', 'N/A'))[:col1]
                    bridge_vlan = str(vni.get('bridge_vlan', 'N/A'))[:col2]
                    vni_name = str(vni.get('name', 'N/A'))[:col3]
                    dev_name = device_name[:col4]
                    f.write(f"    │{vni_id:^{col1}}│{bridge_vlan:^{col2}}│{vni_name:^{col3}}│{dev_name:^{col4}}│\n")
                    vni_count += 1
            
            if vni_count == 0:
                total_width = col1 + col2 + col3 + col4 + 5  # +5 для рамок ┌┬┬┬┐
                f.write("    │" + "Нет данных".center(total_width) + "│\n")
            f.write("    └" + "─" * col1 + "┴" + "─" * col2 + "┴" + "─" * col3 + "┴" + "─" * col4 + "┘\n")
            f.write(f"\n    Всего VNI: {vni_count}\n")
            f.write("\n")

            # MAC VRF (EVPN Route Targets) - все устройства
            f.write("  MAC VRF (EVPN Route Targets):\n")
            # Ширина колонок: VRF Name=12, RD=14, Route Target=16, Desc=12, Device=25
            col1, col2, col3, col4, col5 = 12, 14, 16, 12, 25
            f.write("    ┌" + "─" * col1 + "┬" + "─" * col2 + "┬" + "─" * col3 + "┬" + "─" * col4 + "┬" + "─" * col5 + "┐\n")
            f.write("    │" + "VRF Name".center(col1) + "│" + "RD".center(col2) + "│" + "Route Target".center(col3) + "│" + "Desc".center(col4) + "│" + "Device".center(col5) + "│\n")
            f.write("    ├" + "─" * col1 + "┼" + "─" * col2 + "┼" + "─" * col3 + "┼" + "─" * col4 + "┼" + "─" * col5 + "┤\n")
            
            mac_vrf_count = 0
            for dev in results:
                vxlan_info = dev.get('vxlan_info', {})
                mac_vrfs = vxlan_info.get('mac_vrfs', [])
                device_name = dev.get('device_name', 'unknown')
                for vrf in mac_vrfs:
                    name = str(vrf.get('name', 'N/A'))[:col1]
                    rd = str(vrf.get('rd', 'N/A'))[:col2]
                    rt = str(vrf.get('route_target', 'N/A'))[:col3]
                    desc = str(vrf.get('description', 'N/A'))[:col4]
                    dev_name = device_name[:col5]
                    f.write(f"    │{name:^{col1}}│{rd:^{col2}}│{rt:^{col3}}│{desc:^{col4}}│{dev_name:^{col5}}│\n")
                    mac_vrf_count += 1
            
            if mac_vrf_count == 0:
                total_width = col1 + col2 + col3 + col4 + col5 + 7  # +7 для рамок ┌┬┬┬┬┐
                f.write("    │" + "Нет данных".center(total_width) + "│\n")
            f.write("    └" + "─" * col1 + "┴" + "─" * col2 + "┴" + "─" * col3 + "┴" + "─" * col4 + "┴" + "─" * col5 + "┘\n")
            f.write(f"\n    Всего MAC VRF: {mac_vrf_count}\n")
            f.write("\n")

            # === PORT-CHANNEL (LACP) ===
            f.write("┌" + "─" * 128 + "┐\n")
            f.write("│" + " PORT-CHANNEL (LACP) ".center(128) + "│\n")
            f.write("└" + "─" * 128 + "┘\n\n")

            for dev in results:
                port_channels = dev.get('port_channels', [])
                if port_channels:
                    f.write(f"  {dev['device_name']}:\n")
                    for pc in port_channels:
                        status = "▼ DOWN" if pc.get('shutdown') else "▲ UP"
                        members = ", ".join([f"grp{m['group']}({m['mode']})" for m in pc.get('members', [])])
                        f.write(f"    ├── {pc['name']:<10} {pc.get('description', ''):<35} VLANs: {pc.get('vlans', 'N/A'):<20} {status}\n")
                        if members:
                            f.write(f"    │            Members: {members}\n")
            f.write("\n")

            # === СЕТЬ УПРАВЛЕНИЯ ===
            f.write("┌" + "─" * 128 + "┐\n")
            f.write("│" + " СЕТЬ УПРАВЛЕНИЯ (Management OOB) ".center(128) + "│\n")
            f.write("└" + "─" * 128 + "┘\n\n")

            mgmt_network = None
            for dev in results:
                mgmt_info = dev.get('management_info', {})
                if mgmt_info.get('mgmt_ip'):
                    if not mgmt_network:
                        mgmt_network = f"10.7.8.0/{mgmt_info.get('mgmt_mask', '24')}"
                    f.write(f"    ├── {dev['device_name']:<25} → {mgmt_info.get('mgmt_interface', 'eth0')}: "
                           f"{mgmt_info.get('mgmt_ip')}/{mgmt_info.get('mgmt_mask', '24')} "
                           f"(GW: {mgmt_info.get('default_gateway', 'N/A')})\n")
            if mgmt_network:
                f.write(f"\n  Management Network: {mgmt_network}\n")
            f.write("\n")

            # === ASCII СХЕМА ТОПОЛОГИИ ===
            f.write("┌" + "─" * 128 + "┐\n")
            f.write("│" + " ФИЗИЧЕСКАЯ ТОПОЛОГИЯ (CLOS Architecture) ".center(128) + "│\n")
            f.write("└" + "─" * 128 + "┘\n\n")

            # Рисуем схему CLOS
            f.write("                              ╔════════════════════════════════════════╗\n")
            f.write("                              ║         SPINE LAYER (ASN 65100)        ║\n")
            f.write("                              ╚════════════════════════════════════════╝\n")
            f.write("                                       │        │        │\n")
            
            # Spine устройства
            spine_names = [d['device_name'] for d in spine_devices]
            f.write(f"                              {'  '.join([f'{s:<15}' for s in spine_names])}\n")
            f.write(f"                              {'  '.join(['│' * len(spine_names)])}\n")
            
            # Листья
            f.write("\n")
            f.write("    ╔════════════════════════════════════════════════════════════════════════════╗\n")
            f.write("    ║                    LEAF LAYER (Доступ/Граница)                             ║\n")
            f.write("    ╚════════════════════════════════════════════════════════════════════════════╝\n")
            
            all_leaf = leaf_devices + border_devices
            for dev in all_leaf:
                bgp_info = dev.get('bgp_info', {})
                vxlan_info = dev.get('vxlan_info', {})
                f.write(f"\n      {dev['device_name']:<20} ASN:{bgp_info.get('asn', 'N/A'):<6} VTEP:{vxlan_info.get('vtep_ip', 'N/A'):<15}\n")
                f.write(f"         │\\\n         ├─────────── подключено ко всем Spine (ECMP)\n         │/\n")
            
            f.write("\n")
            f.write("  Условные обозначения:\n")
            f.write("    ├── VTEP: VXLAN Tunnel End Point IP\n")
            f.write("    ├── ASN:  BGP Autonomous System Number\n")
            f.write("    ├── ECMP: Equal-Cost Multi-Path routing\n")
            f.write("    └── EVPN: Ethernet VPN (BGP control plane)\n")
            f.write("\n")

            # Итоговая статистика
            f.write("┌" + "─" * 128 + "┐\n")
            f.write("│" + " ИТОГОВАЯ СТАТИСТИКА ".center(128) + "│\n")
            f.write("└" + "─" * 128 + "┘\n\n")

            total_devices = len(results)
            total_spine = len(spine_devices)
            total_leaf = len(leaf_devices)
            total_border = len(border_devices)
            total_vlans = sum(r.get('total_vlans', 0) for r in results)
            total_vnis = sum(len(r.get('vxlan_info', {}).get('vnis', [])) for r in results)
            total_port_channels = sum(len(r.get('port_channels', [])) for r in results)
            total_bgp_sessions = sum(len(r.get('bgp_info', {}).get('neighbors', [])) for r in results)
            
            # LLDP статистика
            total_lldp_neighbors = sum(len(r.get('lldp_info', {}).get('neighbors', [])) for r in results)
            lldp_enabled_devices = sum(1 for r in results if r.get('lldp_info', {}).get('lldp_run'))
            
            # Статус интерфейсов
            total_interfaces_up = sum(
                sum(1 for s in r.get('interface_status', {}).values() if s == 'up')
                for r in results
            )
            total_interfaces_down = sum(
                sum(1 for s in r.get('interface_status', {}).values() if s == 'down')
                for r in results
            )

            f.write(f"    Общее количество устройств:     {total_devices}\n")
            f.write(f"      ├── Spine:                    {total_spine}\n")
            f.write(f"      ├── Leaf:                     {total_leaf}\n")
            f.write(f"      └── Border Leaf:              {total_border}\n")
            f.write(f"\n")
            f.write(f"    VLAN (всего):                   {total_vlans}\n")
            f.write(f"    VXLAN VNI (всего):              {total_vnis}\n")
            f.write(f"    Port-Channel интерфейсов:       {total_port_channels}\n")
            f.write(f"    BGP сессий (всего):             {total_bgp_sessions}\n")
            f.write(f"    LLDP соседей (всего):           {total_lldp_neighbors} (на {lldp_enabled_devices} устройствах)\n")
            f.write(f"    Интерфейсов:                    {total_interfaces_up} up, {total_interfaces_down} down\n")
            f.write(f"\n")

            # Физические связи из links_result
            physical_links = links_result.get("physical_links", [])
            if physical_links:
                f.write(f"    Физических связей (P2P /31):    {len(physical_links)}\n")
            
            mgmt_networks = links_result.get("mgmt_networks", [])
            if mgmt_networks:
                f.write(f"    Управленческих интерфейсов:   {len(mgmt_networks)}\n")
            
            logical_links = links_result.get("logical_links", [])
            if logical_links:
                f.write(f"    Логических связей (Overlay):  {len(logical_links)}\n")
            
            f.write("\n" + "=" * 130 + "\n")
            f.write(f" Дата генерации отчёта: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write("=" * 130 + "\n")