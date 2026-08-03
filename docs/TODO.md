# 视界智检 V2.0 — 代码审查 TODO

> 生成时间：2026-08-03。基于对 `backend/`、`view/src/`、`view/src-tauri/`、构建脚本、测试与文档的全面通读。
>
> 验证基线：后端 `python -m unittest discover -s tests` 88 项全部通过；前端 `npx tsc --noEmit` 无错误；git 仓库干净（190 个文件，无 `data/`、打包产物、`.pth` 入库）。
>
> 项目定位：本地/局域网部署的机器视觉检测系统，非公网多租户。因此"鉴权默认关闭、CSP 为 null、口令硬编码"等项按**可接受但需知晓**处理，不按公网标准要求。
>
> 优先级：🔴 高（功能性损坏 / 明确 bug，建议尽快修）→ 🟠 中（重复与耦合，重构收益大）→ 🟡 低（清理 / 健壮性）。

---

## 完成状态（2026-08-03 更新）

| 项 | 状态 | 提交 |
| --- | --- | --- |
| B1 result_queues 越界 | ✅ | `1d34b65`（含回归单测） |
| B2 帧链路类型矛盾 | ✅ | `1db119c`（含 D15 竞态） |
| B3 弹窗硬编码类别 | ✅ | `1e79463` |
| B4 删 training.main() | ✅ | `f34a825` |
| B5 抽离 config torch | ✅ | `497aeb2` |
| D1 设备配置校验收敛 | ✅ | `401335c` |
| D2/D3 扩展名与默认类别 | ✅ | `7342031` |
| D4 相机状态字典 | ✅ | `3169977` |
| D5 模型路径/元数据 | ✅ | `4586fbd`（顺带修 get_active_model_path 回退隐患） |
| D6 照片遍历生成器 | ✅ | `f55e3d1` |
| D7 GigE 解析 | ✅ | `a7c6de6` |
| D8/D11 PLC 工厂+锁 | ✅ | `8d7a6bb` |
| D9 MVS 星号导入 | ✅ | `6d635fd` |
| D10 再导出死代码 | ✅ | `d9ee05c` |
| D12 构建脚本 | ◐ | `cf898dd` 只收敛 GPU-DLL 检查；整体编排合并需打包实测，暂保留 |
| D13/D14 usePolling+learned 同步 | ✅ | `12a420f` |
| D16/D17 引用推导+产品名解析 | ✅ | `b0a3ba8` |
| D18 CSS 类常量 | ✅ | `2a17eb7` |
| D19 目录选择 | ✅ | `4aabd39` |
| D20 Modal/Button/Badge 拆分 | ✅ | `a18e39c` |
| 死代码清理 | ✅ | `ab312b8` |
| 健壮性修复 | ✅ | `3d59fa7` |
| 文档环境变量表 | ✅ | 见 `docs/项目详细文档.md §8.1` |

其他提交：`9c056e1` 新增本 TODO 文档、`085f99f` gitignore 的 `test/` 根锚定修复。

---

## 一、🔴 高优先级：功能性 Bug

### B1. 线体数 >4 时第 5+ 路相机推理必然失败（后端）✅
- 位置：[inference_worker.py:19](backend/inference_worker.py) `result_queues` 创建于**模块导入时**（此时 `Config.CAMERA_COUNT` 是默认 4）。
- 现象：线体数改到 5–16 后第 5+ 路 `get_inference_result` / worker 写入 `result_queues[cam_id]` 抛 `KeyError`。
- 修复：访问处改 `setdefault` 惰性创建；补回归单测 `tests/test_inference_worker.py`。

### B2. 运行页实时画面损坏：帧接口类型自相矛盾（前端）✅
- 位置：[services/api.ts](view/src/services/api.ts) `getFrame` 声明返回 `ArrayBuffer`，实际 `apiClient` 返回 Blob。
- 现象：[useSystem.ts](view/src/hooks/useSystem.ts) 对 Blob 做 `new Uint8Array()` 得空字节 → 运行页画面全坏。
- 修复：`getFrame` 返回类型改 Blob，`useFrameUpdater` 改用 `URL.createObjectURL` 并在轮询间 revoke；加 in-flight 互斥防竞态。

### B3. CameraPopoutPage 硬编码类别名判断 OK/NG（前端）✅
- 修复：去掉 `label === '类别A'` 判断，改为仅按相机状态着色。

### B4. `training.main()` 调用未定义的 `classify_batch`（后端死代码）✅
- 修复：删除 `main()` 及仅被其使用的 `time`/`ThreadPoolExecutor` 导入。

### B5. `config.py` 在类体内 `import torch`，污染整个依赖分层（后端）✅
- 修复：`_LazyDevice` 描述符首次访问时探测设备；删除同块死代码 `Config.load_device_config`。

---

## 二、🟠 中优先级：重复与耦合（重构）

### 后端

#### D1. 设备配置加载逻辑收敛 ✅
- `Config.load_device_config`（死代码）删除；`server_bootstrap` 与 `system_routes` 重复的 `valid_devices` 拼装收敛到 `settings_repository.available_devices()`。

#### D2. 图片扩展名集合统一 ✅
- 6 处副本收敛到 `config.IMAGE_EXTENSIONS`；`photo_service` 缺 tif/tiff/webp 的问题一并修正。

#### D3. 默认类别统一 ✅
- 5 处 `["类别1","类别2"]` 统一引用 `model_repository.DEFAULT_CATEGORIES`。

#### D4. 相机默认状态字典统一 ✅
- `runtime_state.DEFAULT_CAMERA_STATE` 作为单一来源，`camera_run_service` / `system_routes` 复用。

#### D5. 模型路径解析 / 元数据读取去重 ✅
- `resolve_model_path` 委托 `Config.get_active_model_path`（并修复指定模型缺失时错误回退的隐患）；`model_loader` 复用 `read_model_metadata`。

#### D6. 照片遍历逻辑去重 ✅
- 抽公共生成器 `iter_photo_records`，`list_camera_photos` 与 `_iter_all_photos` 复用。

#### D7. GigE 相机信息解析去重 ✅
- `mvs_sdk.parse_gige_info` 统一型号/序列号/IP 解析，两处复用。

#### D8. PLC 客户端构造去重 ✅
- `test_plc_write` 统一走 `plc_service.with_base_url()`，移除直接 `new PlcService`。

#### D9. MVS 星号导入收敛 ✅
- `mvs_sdk` 显式命名导入所需符号 + 缺失占位值；各模块改用命名导入，`mvs_controls` 去除 SDK 导入；ctypes 符号显式导入。已验证有/无 SDK 两种环境。

#### D10. `inference_worker` 底部再导出死代码 ✅
- 删除无调用方的向后兼容再导出块。

#### D11. PLC 写入锁与配置读取 ✅
- 锁升级为模块级全局（`with_base_url` 新建实例导致实例锁失效）；`with_base_url` 支持传入已读配置避免重复读盘。

#### D12. 构建脚本去重 ◐（部分）
- CPU-only 两个脚本的 GPU-DLL 检查收敛到 `build-common.Assert-NoGpuDll`。
- **暂保留**：4 个脚本整体编排（venv 准备/PyInstaller/资源整理）仍重复，完整参数化合并需在打包环境实测，避免未经验证地破坏发布流水线。

### 前端

#### D13. "learned 状态同步"三份重复 ✅
- 收敛为 `storage.syncProductsLearningStatus()`，`useRunModelSync` / `useCatalog` / `useProductLearningSync` 三处复用。

#### D14. 轮询样板重复 ✅
- 新增 `hooks/usePolling.ts`（in-flight 互斥 + 卸载清理），迁移运行页/文件/照片/用户等 6 处轮询。`useHealthChecks`（启动延时）、`useFrameUpdater`（对象 URL）、`useTrainingPanel`（自动停止）为特例保留。

#### D15. `useFrameUpdater` 轮询竞态 ✅（并入 B2）
- in-flight 互斥 + 旧 URL revoke。

#### D16. 模型引用推导去重 ✅
- `ModelSettingsTab` 复用 `deriveModelReferences`。

#### D17. "model→产品显示名"解析去重 ✅
- 新增 `utils/productLabel.resolveProductLabel`，统一 5 处调用。

#### D18. CSS 类常量去重 ✅
- 收敛到 `common/uiClasses.ts`（含紧凑变体），`settingsStyles`/`fileStyles` 改为转发。

#### D19. 本地目录选择去重 ✅
- 新增 `hooks/useLocalFolderPicker`，`useModelTest` 与 `LearnConfirmModal` 复用。

#### D20. 通用 UI 原子组件拆分 ✅
- `Modal.tsx` 只保留 Modal；`Button.tsx`、`Badge.tsx` 独立，26 处引用方按需导入。

---

## 三、🟡 低优先级：清理与健壮性（本轮已完成）

- **死代码**：`api.getAllCameraConfigs`/`testRejectSignal`/`getStats` 及对应类型、`permissions.canEditSettings`/`canManageUsers`、`native.closeCameraPopout`、`TestModelResponse.class_a_*/class_b_*`、`env_check.can_proceed`、`camera_routes` plcUrl 重复赋值、`training.py` 的 `"vision"` logger。
- **logger 名称统一**：`training.py` 改用全局 `vision_system` logger，info 日志正常落文件。
- **PhotoBrowser 竞态**：加载加请求序号。
- **ProductTable DOM id 耦合**：select 改受控，`assignProduct` 显式传线体号。
- **useRunLayout 渲染期写 ref**：改到 useEffect。
- **useTrainingPanel 非空断言**：改用 `selectedModelRef` + 守卫。
- **列表 key**：TestResultPanel/HardwareNetworkCard/EnvCheckModal 改稳定标识。
- **App.tsx 重复 getStorageInfo**：收敛为一次。
- **gitignore `test/` 根锚定**：修复误忽略 `view/src/components/test`。
- **文档环境变量表**：补 `VISION_FLASK_PORT`、`VISION_WEB_DIST`。

### 遗留（需现场/打包环境验证，暂不处理）
- D12 构建脚本整体编排合并（见上）。
- `photo_storage.list_image_directories_data` 对 `DATA_DIR` 全量 `rglob` 扫描在照片极多时偏慢（低优先）。
- `users.json` 读改写无锁（低概率丢更新，LAN 单机可接受）。
- `model_loader` 的 `models` 字典在训练后 `clear()` 与推理线程无锁共享（训练与运行并发时才可能触发，低风险）。

---

## 四、本地/局域网部署的安全提示（按"知悉即可"处理）

1. **Tauri "加密存储"实为可逆混淆**：`src-tauri/src/lib.rs:19-20` 加密口令与盐硬编码在二进制中。文档建议改称"本地混淆存储"。
2. **`tauri.conf.json` 的 `csp: null`**：WebView 无内容安全策略。
3. **鉴权开关默认关闭**（`VISION_AUTH_ENABLED=0`）；默认监听 `0.0.0.0`。不可信网络禁止直连。

---

## 五、后续实施顺序（已全部完成，除 D12 与"遗留"）

全部按「每项修复 → 测试确认 → 单独 commit」执行，后端每次改动后跑 `unittest`（现 91 项全过）、前端跑 `npx tsc --noEmit` + `npm run build`。
