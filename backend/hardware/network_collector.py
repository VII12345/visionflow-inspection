"""网络硬件信息采集。"""

from .run_hidden import run_hidden


def _collect_wifi_rates():
    """Windows netsh 获取 WiFi 真实协商速率。"""
    wifi_rates = {}
    try:
        result = run_hidden(
            ["netsh", "wlan", "show", "interfaces"],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=5,
        )
        current_name = None
        for line in result.stdout.split("\n"):
            stripped = line.strip()
            if "名称" in stripped and ":" in stripped:
                current_name = stripped.split(":", 1)[1].strip()
            elif "接收速率" in stripped and ":" in stripped:
                value = stripped.split(":", 1)[1].strip().split()[0]
                if current_name and value.isdigit():
                    wifi_rates.setdefault(current_name.lower(), {})["rx_mbps"] = int(value)
            elif "传输速率" in stripped and ":" in stripped:
                value = stripped.split(":", 1)[1].strip().split()[0]
                if current_name and value.isdigit():
                    wifi_rates.setdefault(current_name.lower(), {})["tx_mbps"] = int(value)
    except Exception:
        pass
    return wifi_rates


def _collect_ethernet_speeds():
    """Windows PowerShell 获取以太网真实链路速率。"""
    eth_speeds = {}
    try:
        result = run_hidden(
            ["powershell", "-Command", "Get-NetAdapter | Select-Object Name,LinkSpeed | ConvertTo-Json -Compress"],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=5,
        )
        import json

        adapters = json.loads(result.stdout.strip())
        if isinstance(adapters, dict):
            adapters = [adapters]
        for adapter in adapters:
            name = adapter.get("Name", "")
            speed = adapter.get("LinkSpeed", 0)
            if name and speed:
                eth_speeds[name.lower()] = round(speed / 1_000_000)
    except Exception:
        pass
    return eth_speeds


def _classify_interface(name, normalized):
    """根据名称推断网络接口类型。"""
    if "wi" in normalized or "wlan" in normalized or "无线" in name:
        return "WiFi"
    if "蓝牙" in name or "bluetooth" in normalized:
        return "蓝牙"
    if (
        "虚拟" in name
        or "virtual" in normalized
        or "vmware" in normalized
        or "vethernet" in normalized
        or "hyper" in normalized
    ):
        return "虚拟"
    if "tailscale" in normalized or "vpn" in normalized or "tun" in normalized:
        return "VPN"
    return "以太网"


def collect_network_info(system_name):
    """采集各网络接口的状态、速率和 IPv4 地址。"""
    network = []
    try:
        import psutil

        if_addrs = psutil.net_if_addrs()
        if_stats = psutil.net_if_stats()
        wifi_rates = _collect_wifi_rates() if system_name == "Windows" else {}
        eth_speeds = _collect_ethernet_speeds() if system_name == "Windows" else {}

        for name, stats in if_stats.items():
            normalized = name.lower()
            if normalized.startswith("loopback"):
                continue

            addrs = if_addrs.get(name, [])
            ipv4_list = [addr.address for addr in addrs if addr.family.name == "AF_INET"]
            if_type = _classify_interface(name, normalized)

            base_speed = stats.speed if stats.speed and stats.speed > 0 else None
            rx_mbps = None
            tx_mbps = None
            if if_type == "WiFi" and normalized in wifi_rates:
                rx_mbps = wifi_rates[normalized].get("rx_mbps")
                tx_mbps = wifi_rates[normalized].get("tx_mbps")
                if rx_mbps or tx_mbps:
                    base_speed = rx_mbps or tx_mbps
            if if_type == "以太网" and normalized in eth_speeds:
                base_speed = eth_speeds[normalized]

            entry = {
                "name": name,
                "type": if_type,
                "up": stats.isup,
                "speed_mbps": base_speed,
                "ipv4": ipv4_list,
            }
            if rx_mbps is not None or tx_mbps is not None:
                entry["speed_rx_mbps"] = rx_mbps
                entry["speed_tx_mbps"] = tx_mbps
            network.append(entry)
    except ImportError:
        pass
    return network
