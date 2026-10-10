# -*- mode: python ; coding: utf-8 -*-
# CPU-only PyInstaller configuration for the vision inspection backend.
# Build this spec only with the pinned CPU environment from requirements-cpu.txt.

import importlib.util
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files

block_cipher = None

torchvision_spec = importlib.util.find_spec("torchvision")
if torchvision_spec is None or not torchvision_spec.origin:
    raise RuntimeError("TorchVision is required to build the backend")
torchvision_dir = Path(torchvision_spec.origin).parent
# TorchVision loads these C++ operator libraries dynamically with torch.ops.load_library,
# so PyInstaller's Python import graph cannot discover them. Collect every package-level
# native extension, including the current _C_stable.pyd NMS/operator library.
torchvision_extensions = sorted(torchvision_dir.glob("*.pyd"))
if not any(path.name.startswith(("_C.", "_C_", "_C-")) for path in torchvision_extensions):
    raise RuntimeError(f"TorchVision native C++ operator extension was not found in {torchvision_dir}")

a = Analysis(
    ['backend/__main__.py'],
    pathex=[],
    binaries=[(str(path), "torchvision") for path in torchvision_extensions],
    datas=[('backend/*.py', 'backend'), *collect_data_files('torchvision')],
    hiddenimports=[
        'flask', 'flask_cors',
        'PIL', 'PIL.Image', 'PIL.ImageDraw', 'PIL.ImageFont',
        'torch', 'torchvision', 'torchvision.models',
        'torchvision.models.mobilenetv3', 'torchvision.transforms',
        'torchvision.datasets', 'numpy', 'psutil',
        'backend.server', 'backend.config', 'backend.logger',
        'backend.training', 'backend.mvs_camera', 'backend.mvs_camera_manager',
        'backend.inference_worker', 'backend.env_check',
        'backend.camera_config_manager', 'backend.plc_service',
        'backend.hardware.run_hidden', 'backend.lecpserver_launcher',
    ],
    hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[],
    win_no_prefer_redirects=False, win_private_assemblies=False,
    cipher=block_cipher, noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz, a.scripts, [], name='backend', debug=False,
    bootloader_ignore_signals=False, strip=False, upx=True,
    upx_exclude=[], runtime_tmpdir=None, console=False,
    disable_windowed_traceback=False, argv_emulation=False,
    target_arch=None, codesign_identity=None, entitlements_file=None,
    icon=None,
    uac_admin=True,
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, strip=False,
               upx=True, upx_exclude=[], name='backend')