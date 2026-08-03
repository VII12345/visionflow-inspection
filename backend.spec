# -*- mode: python ; coding: utf-8 -*-
# 视界智检 — PyInstaller 打包配置
# 生成独立的 backend.exe（Flask 服务 + AI 推理）

block_cipher = None

a = Analysis(
    ['backend/__main__.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('backend/*.py', 'backend'),
    ],
    hiddenimports=[
        'flask',
        'flask_cors',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'PIL.ImageFont',
        'torch',
        'torchvision',
        'torchvision.models',
        'torchvision.models.mobilenetv3',
        'torchvision.transforms',
        'torchvision.datasets',
        'torch.cuda',
        'torch.cuda.amp',
        'numpy',
        'psutil',
        'backend.server',
        'backend.config',
        'backend.logger',
        'backend.training',
        'backend.mvs_camera',
        'backend.mvs_camera_manager',
        'backend.inference_worker',
        'backend.env_check',
        'backend.camera_config_manager',
        'backend.plc_service',
        'backend.hardware.run_hidden',
        'backend.lecpserver_launcher',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    name='backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
    uac_admin=True,
)

# 使用 onedir 模式：DLL 独立存放，便于精简
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='backend',
)
