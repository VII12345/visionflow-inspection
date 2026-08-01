# -*- mode: python ; coding: utf-8 -*-
# CPU-only PyInstaller configuration for the vision inspection backend.
# Build this spec only with the CPU PyTorch environment created by
# build_portable_cpu.ps1; do not use the GPU .venv.

block_cipher = None

a = Analysis(
    ['backend/__main__.py'],
    pathex=[],
    binaries=[],
    datas=[('backend/*.py', 'backend')],
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
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, strip=False,
               upx=True, upx_exclude=[], name='backend')