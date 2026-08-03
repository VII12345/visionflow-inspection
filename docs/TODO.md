# 视界智检 V2.0 — 代码审查 TODO

> 生成时间：2026-08-03。基于对 `backend/`、`view/src/`、`view/src-tauri/`、构建脚本、测试与文档的全面通读。
>
> **验证基线**：后端 `python -m unittest discover -s tests` 88 项全部通过；前端 `npx tsc --noEmit` 无错误；git 仓库干净（190 个文件，无 `data/`、打包产物、`.pth` 入库）。
>
> 项目定位：本地/局域网部署的机器视觉检测系统，非公网多租户。因此"鉴权默认关闭、CSP 为 null、口令硬编码"等项按**可接受但需知晓**处理，不按公网标准要求。
>
> 优先级：🔴 高（功能性损坏 / 明确 bug，建议尽快修）→ 🟠 中（重复与耦合，重构收益大）→ 🟡 低（清理 / 健壮性）。

---

## 一、🔴 高优先级：功能性 Bug

### B1. 线体数 >4 时第 5+ 路相机推理必然失败（后端）
- 位置：[inference_worker.py:19](backend/inference_worker.py) `result_queues = {i: queue.Queue() for i in range(1, Config.CAMERA_COUNT + 1)}`，创建于**模块导入时**（此时 `Config.CAMERA_COUNT` 是默认 4）。
- 现象：`server_bootstrap.run_server` 运行时把线体数改成 5–16（`system_routes.apply_line_count` 只改 `Config.CAMERA_COUNT`，从不重建 `result_queues`）。第 5+ 路相机启动后，`get_inference_result(cam_id)`（[inference_worker.py:126](backend/inference_worker.py)）与 worker 写结果（[:95](backend/inference_worker.py)）都对 `result_queues[cam_id]` 抛 `KeyError`，该路相机进入 error 状态、推理永不返回。
- 建议：`get_inference_result` / worker 写入处改用 `result_queues.setdefault(cam_id, Queue())` 惰性创建（最小改动），或在 `apply_line_count` 中同步扩容。

### B2. 运行页实时画面损坏：帧接口类型自相矛盾（前端）
- 位置：[services/api.ts:39](view/src/services/api.ts) `getFrame` 声明返回 `ArrayBuffer`，但 [apiClient.ts:39](view/src/services/apiClient.ts) 在 `responseType==='blob'` 分支实际 `return res.blob()`，运行时是 **Blob**。
- 现象：[hooks/useSystem.ts:46](view/src/hooks/useSystem.ts) `new Uint8Array(buffer as unknown as ArrayBuffer)` 对 Blob 取不到 `length` → 静默生成**空字节** → `data:image/jpeg;base64,` 空串 → 运行页每张 CAM 图都是坏图，且"等待相机信号"占位被图片覆盖。
- 对比：[CameraPopoutPage.tsx:23-25](view/src/components/camera/CameraPopoutPage.tsx) 对同一接口按 `Blob` + `instanceof Blob` 正确处理（说明弹窗是好的，运行页链路从未真正工作过）。
- 建议：统一按 Blob 处理——`api.getFrame` 返回类型改为 `Blob`，`useFrameUpdater` 改用 `URL.createObjectURL`（参考 CameraPopoutPage 并记得 `revokeObjectURL`）。

### B3. CameraPopoutPage 硬编码类别名判断 OK/NG（前端）
- 位置：[CameraPopoutPage.tsx:61](view/src/components/camera/CameraPopoutPage.tsx) `const isOk = camera.result?.label === '类别A'`。
- 现象：类别名来自训练子目录名称（可自定义），硬编码必然与实际不匹配，弹窗徽标颜色与 OK/NG 判断错误。
- 建议：去掉 OK/NG 判定，仅按 `state==='error'` 显示错误、其余显示标签；或从模型元数据读取类别列表后判断。

### B4. `training.main()` 调用未定义的 `classify_batch`（后端死代码）
- 位置：[training.py:675](backend/training.py) `results, ms = classify_batch(model, str_paths)`，全文无此函数定义。
- 现象：直接 `python backend/training.py` 会 `NameError`。仅 `__main__` 路径，不影响服务，但属明确死代码。
- 建议：删除 `main()`（及其 90 行 CLI 逻辑），或补上实现。

### B5. `config.py` 在类体内 `import torch`，污染整个依赖分层（后端）
- 位置：[config.py:53](backend/config.py) 类体内 `import torch`，随后用 `torch.cuda.is_available()` 算 `DEVICE`。
- 现象：所有导入 `config` 的模块（含纯照片/PLC/目录/鉴权服务）都被迫依赖 torch；只用 `requirements.txt`（无 torch）无法启动任何部分，与"通用依赖"分层矛盾。且每次 import 都拉一次 torch（约 1–2s）。
- 建议：把 `import torch` 与 `DEVICE/TRAINING_DEVICE` 计算移到使用处（`model_loader` / `training` / `settings_repository`），`config.py` 只保留纯常量。

---

## 二、🟠 中优先级：重复与耦合（重构）

### 后端

#### D1. 设备配置加载逻辑三处重复 + 一处死代码
- [config.py:59](backend/config.py) `Config.load_device_config()`（**从未被调用，死代码**）；
- [server_bootstrap.py:42-64](backend/server_bootstrap.py) 手动读 `settings_repository.load_device_config()` 再校验；
- [system_routes.py:124-152](backend/system_routes.py) `update_device_config` 又实现一遍"valid_devices 校验 + 写回 Config + 同步 training/推理设备"。
- 建议：统一收敛到 `settings_repository`，提供 `load_device_config()` + `apply_device_config()`，三处共用；删除 `Config.load_device_config`。

#### D2. 图片扩展名集合重复 6 处且不一致
- 相同集合各写一遍：`training.py` `_find_category_dirs`(:143) 与 `_image_files`(:159)、`training_routes.py:224`、`model_test_routes.py:33`、`photo_storage.py:12`（`IMAGE_EXTENSIONS`）；
- **不一致**：`photo_service.py:8` `PHOTO_EXTENSIONS = {jpg,jpeg,png,bmp}` 缺 `tif/tiff/webp`（照片列表/清理看不到这些格式）。
- 建议：统一为一个公共常量（如 `photo_storage.IMAGE_EXTENSIONS` 或新 `common.py`），所有扫描/校验引用它。

#### D3. 默认类别 `["类别1", "类别2"]` 重复 5 处
- `model_loader.py:97`、`model_repository.py:15`（`DEFAULT_CATEGORIES`）、`model_test_routes.py:72`、`training.py:220`、`training.py:581`。
- 建议：统一引用 `model_repository.DEFAULT_CATEGORIES`。

#### D4. 相机默认状态 dict 重复 3 处
- `runtime_state.py:11` 已定义常量 `DEFAULT_CAMERA_STATE`，但 [camera_run_service.py:38-48](backend/camera_run_service.py) 和 [system_routes.py:72-82](backend/system_routes.py) 又各手写一份同样的 dict。
- 建议：统一 `dict(DEFAULT_CAMERA_STATE)`。

#### D5. 模型路径解析 / 元数据读取重复
- 路径解析：`Config.get_active_model_path`（config.py:103）与 `model_repository.resolve_model_path`（:26）都是"glob `*_classifier_*.pth` + 按名匹配"。
- 元数据读取：`model_loader.load_model`（:97-111）与 `model_repository.read_model_metadata`（:37）都做"读 .json 的 categories"。
- 建议：以 `model_repository` 为模型元数据单一来源，`model_loader` 复用之。

#### D6. 照片遍历逻辑重复
- [photo_routes.py:117](backend/photo_routes.py) `_iter_all_photos` 与 [photo_service.py:26](backend/photo_service.py) `list_camera_photos` 几乎相同（遍历 subdir、按 reject_labels 算 `NG/OK/--`、按扩展名过滤、按 mtime 排序、拼照片 dict）。
- 建议：`_iter_all_photos` 改由 `list_camera_photos` 扩展（补 camId 字段），或抽公共生成器。

#### D7. GigE 相机信息解析重复
- [mvs_device.py:26-53](backend/mvs_device.py) 与 [mvs_camera_manager.py:65-109](backend/mvs_camera_manager.py) `enumerate_cameras` 中 `chModelName`/`chSerialNumber`/`nCurrentIp` 的逐字节解析逻辑完全相同。
- 建议：抽公共函数（如 `mvs_sdk._parse_gige_info(gige_info)`），两处复用。

#### D8. PLC 客户端构造重复
- [camera_routes.py:170](backend/camera_routes.py) `test_plc_write` 直接 `PlcService(base_url=..., proxy_url=..., node_prefix=..., timeout_seconds=...)` 现拼配置，与 `plc_service.with_base_url()`（plc_client.py:34）重复。
- 建议：统一走 `plc_service` 工厂方法。

#### D9. MVS 层 `from .mvs_sdk import *` 星号导入泛滥
- [mvs_sdk.py](backend/mvs_sdk.py) 导符号后，`mvs_device`/`mvs_acquisition`/`mvs_controls`/`mvs_camera`/`mvs_camera_manager` 各 `from .mvs_sdk import *`，符号来源无法追踪；[mvs_device.py:73](backend/mvs_device.py) 甚至用 `"MV_ACCESS_ExclusiveWithSwitch" in dir()` 探测符号是否存在。
- 建议：`mvs_sdk` 显式导出所需 SDK 符号（`__all__` 或命名 import），去掉星号导入链。

#### D10. `inference_worker.py` 底部再导出块是死代码
- [inference_worker.py:132-144](backend/inference_worker.py) `from .model_loader import (models, model_categories, ...)` 标注"向后兼容"，但全库无 `from .inference_worker import models` 之类引用（已验证）。
- 建议：删除该块，消除这种"半循环"式的隐式耦合。

#### D11. PLC 写入的重复配置读取与锁失效
- `plc_service.with_base_url()` 每次调用都重新 `get_plc_config()` 读盘；[camera_run_service.py:178](backend/camera_run_service.py) 每帧剔除都调用一次。
- `PlcService._lock` 是**实例级**，而 camera_worker 每相机各建一个 `with_base_url` 新实例 → 多相机并发写 PLC 实际未串行化。
- 建议：配置进程内缓存（改动时失效）；锁提升为模块级/单例级。

#### D12. 4 个 PowerShell 构建脚本大量重复
- `build_portable_tauri.ps1` / `build_portable_tauri_full.ps1` / `build_installer_cpu.ps1` / `build_installer_tauri_full.ps1` 前半段（venv 准备、PyInstaller、GPU DLL 检查、dist 拷贝、资源整理）逐字重复，仅 venv/spec/产物名不同。
- 建议：把公共阶段参数化收进 `scripts/build-common.ps1`（如 `New-InstallStep`），四脚本只留差异化配置。

### 前端

#### D13. "learned 状态同步"三份重复
- `useRunModelSync.ts:17-35`（10s）、`useCatalog.ts:22-39`（5s，运行中）、`useProductLearningSync.ts:10-26`（10s）几乎逐字相同：`getModels` → `new Set(models.map(m=>m.name))` → 改写 `p.learned` → `storage.saveProducts`。仅间隔/触发条件不同。
- 建议：抽一个 `useLearnedSync` hook（挂载一次），或并入统一的状态轮询。

#### D14. 轮询样板重复 8+ 处，无公共 hook
- `useSystem.ts:17-30,40-61`（500ms/1000ms）、`useHealthChecks.ts:86-95`（5s）、`useCameraPhotos.ts:72-79`（2s）、`useRunModelSync.ts:36`（10s）、`useProductLearningSync.ts:30-33`（10s）、`useCatalog.ts:48-56`（5s）、`useTrainingPanel.ts:35-67`（500ms）、`UserTab.tsx:49-52`（10s）、`CameraPopoutPage.tsx:31,48`。
- 注意：运行页 500ms(/api/status) + 1000ms(/api/frame) 与训练面板 500ms(/api/training/status) 并存，对后端请求偏频繁。
- 建议：抽 `usePolling(fn, ms, enabled)`（内含 interval 管理 + in-flight 互斥 + cleanup），各调用方收敛。

#### D15. `useFrameUpdater` 轮询竞态
- [useSystem.ts:40-61](view/src/hooks/useSystem.ts)：`updateFrames` 为 async 且逐相机 `await`（最多 16 个串行请求），interval 固定 1000ms 无互斥 → 慢速时多次轮询叠加、响应乱序，`setFrames(prev=>({...prev,...newFrames}))` 旧帧覆盖新帧。
- 建议：加 in-flight 标志（上一轮未完成则跳过本轮）+ 请求序号/AbortController。

#### D16. 模型引用推导重复
- [useModelRefSync.ts:7-21](view/src/hooks/useModelRefSync.ts) `deriveModelReferences` 与 [ModelSettingsTab.tsx:32-44](view/src/components/settings/ModelSettingsTab.tsx) `findLocalReferences` 重复实现"遍历 products/line_config 拼引用标签"（文案 `产品「」/线体「」` 也一致）。
- 建议：`ModelSettingsTab` 复用 `deriveModelReferences`。

#### D17. "model→产品显示名"解析重复 5 处
- `LineGrid.tsx:62`、`LineTable.tsx:41`、`useModelTest.ts:66-69`、`useTrainingPanel.ts:108`、`App.tsx:74` 各自 `products.find(...)` + `?.name || model` 兜底。
- 建议：抽 `resolveProductLabel(products, modelOrId)` 公共函数。

#### D18. CSS 类常量复制 7+ 份
- 同一份 `inputClass`/`labelClass`/`thClass` 字符串出现在 `modalFields.tsx:4-7`、`settingsStyles.ts:3-7`、`fileStyles.ts:3-7`、`UserTab.tsx:9-11`、`PhotoBrowser.tsx:8-9`、`CameraConfigModal.tsx:26-27`、`PlcTab.tsx:8-9`、`TestTab.tsx:8`，且 `settingsStyles`/`fileStyles` 内容几乎相同。
- 建议：合并到一个公共样式常量文件（如 `common/uiClasses.ts`）。

#### D19. 本地目录选择 + 网页版提示重复
- `useModelTest.ts:71-82` `browseLocalFolder` 与 `LearnConfirmModal.tsx:15-27` `browseLocalFolder` 几乎相同（`pickDirectory()` + 非 Tauri 时弹"仅能获取目录名称"）。
- 建议：抽公共 hook/工具（可并入 `native.ts`）。

#### D20. 通用 UI 原子组件被塞进 Modal.tsx
- [Modal.tsx](view/src/components/common/Modal.tsx) 同时导出 `Modal`、`Button`（:53）、`Badge`（:84）三个全项目通用组件，各业务组件 `import { Button, Badge } from '../common/Modal'`，文件名与内容不符。
- 建议：拆为 `Modal.tsx` + `Button.tsx` + `Badge.tsx`（或 `ui/` 目录）。

---

## 三、🟡 低优先级：清理与健壮性

### 死代码（前端）
- `services/api.ts` 三个端点全项目无引用：`getAllCameraConfigs`(:41)、`testRejectSignal`(:43)、`getStats`(:53)；对应类型 `AllCameraConfigsResponse`/`TestRejectSignalResponse`/`StatsResponse`（types/api.ts:11/13/32）。
- `services/permissions.ts` `canEditSettings`/`canManageUsers`（:10-11）从未使用（各处权限判断手写 `user.level !== 'operator'`，也没复用这两个函数）。
- `services/native.ts` `closeCameraPopout`（:84-88）无调用方。
- `hooks/useModelRefSync.ts` `deriveModelReferences` 被 export 但仅本文件用，可去掉导出。
- `types/api.ts` `TestModelResponse` 的 `class_a_total/class_b_total/class_a_correct/class_a_accuracy/class_b_correct/class_b_accuracy` 6 个字段后端从不返回、前端从不使用。

### 健壮性 / 一致性
- **logger 名不一致**：`training.py` 用 `logging.getLogger("vision")`（:46/238/413），而 `logger.py` 配置的是 `"vision_system"` → training 的 info/debug 日志不落文件、只经 lastResort 打到 stderr。统一 logger 名。
- **`useRunControl.lineEnabled` 仅挂载时初始化**（useRunControl.ts:16-18），不随 lineCount 变化 reconcile（当前靠 Tab 重挂载规避）。
- **`PhotoBrowser` 请求竞态无防护**（PhotoBrowser.tsx:36-49）：快速翻页/切筛选时旧请求晚到覆盖新列表。建议请求序号。
- **`useCatalogEdit.assignProduct` 经 DOM id 跨组件取值**（useCatalogEdit.ts:53 `document.getElementById('prod-line-${productId}')`），与 ProductTable 的 select 强耦合。
- **`useTrainingPanel.ts:98`** `selectedModel!.model` 非空断言 + 经 store 回调触发的闭包捕获旧值，与同文件 `selectedModelRef`（:30-32）的设计不一致。
- **`useRunLayout.ts:94`** `swapRef.current = swapCamPosition` 渲染期间写 ref（React 反模式），靠 `// eslint-disable-next-line react-hooks/exhaustive-deps` 空依赖压制。
- **列表以 index 作 key**：`TestResultPanel.tsx:96`、`HardwareNetworkCard.tsx:30`、`EnvCheckModal.tsx:33`。
- **类型小瑕疵**：`types/api.ts:38` `PhotosResponse.photos` 缺 `subdir` 字段但 `useCameraPhotos.ts:47` 访问它；`useSystem.ts:13` 对已类型化结果冗余 `as unknown as SystemStatus`。
- **`App.tsx:39` 与 `:62`** 两次 `storage.getStorageInfo()` 渲染同一存储路径信息。
- **`env_check.py` 的 `can_proceed()` 未被使用**（server_bootstrap 直接用 `env_check_result["passed"]`）。
- **`camera_routes.py:88/102`** `camera_config["plcUrl"] = plc_url.rstrip("/")` 重复赋值。
- **`photo_storage.list_image_directories_data`** 对 `DATA_DIR`（含 captures 数千张照片）做 `root.rglob("*")` 全量递归扫描，目录多时该接口偏慢。可限制层级或仅扫图片根目录。

### 测试
- `test_web_static.py` 有 `ResourceWarning: unclosed file`（读 dist 文件未 close），顺手清理。
- 覆盖缺口：`plc_config/plc_client/plc_service`、`inference_worker`、`model_loader`、`camera_run_service.camera_worker`、`env_check` 无直接单测；B1 正是这类缺口会漏掉的 bug 典型。

### 文档
- 环境变量表（docs/项目详细文档.md §8.1）缺 `VISION_FLASK_PORT`（config.py 实际读取），用户说明书 1.2 却提到了它；`VISION_WEB_DIST`（server.py 读取）也未记录。

---

## 四、本地/局域网部署的安全提示（按"知悉即可"处理）

1. **Tauri "加密存储"实为可逆混淆**：`src-tauri/src/lib.rs:19-20` 加密口令与盐硬编码在二进制中，任何拿到 exe 的人可解密 `*.enc`（内含 authToken）。本地/局域网受信任场景可接受，但建议：
   - 文档从"加密封装"改称"本地混淆存储"，避免误导；
   - 若 AUTH_ENABLED=1 且暴露内网，可考虑 token 短时效已缓解（12h），但不要宣传为强加密。
2. **`tauri.conf.json` 的 `csp: null`**：WebView 无内容安全策略。局域网受信任场景可接受；若未来接入不可信页面/第三方 iframe 需补 CSP。
3. **`users.json` 读-改-写无锁**（user_repository.py 的 `update_user_password`/`create_user`/`delete_user` 各自重读重写）：多请求并发有丢更新风险（低概率，LAN 单机可接受）。
4. **鉴权开关默认关闭**（`VISION_AUTH_ENABLED=0`）：符合现有部署；文档已提醒"不可信网络禁止直连"。若要在内网更安全，可把默认 Flask host 从 `0.0.0.0` 改为 `127.0.0.1` 并只在需要局域网访问时显式放开。
5. **`model_loader` 的 `models`/`model_categories` 字典无锁**：训练完成时 `training_routes._run_training` 执行 `models.clear()` + `load_model`（training_routes.py:174-176）与推理 worker 共享，理论上并发读有竞态。可加读写锁或让 worker 通过函数访问。

---

## 五、建议实施顺序

结合项目"每项修复单独测试 → 单独 commit"的惯例，按以下顺序推进（每项独立、可回滚）：

| 阶段 | 项目 | 说明 |
| --- | --- | --- |
| 1 | **B1** result_queues 扩容 | 一行级修复，先补 `inference_worker` 单测覆盖 >4 路场景 |
| 2 | **B2 + B3** 帧链路修复 + 弹窗硬编码 | 前端功能性修复，改完用打包版实际验证运行页画面 |
| 3 | **B4** 删 `training.main`、**B5** 抽离 torch | 后端清理，跑通全部单测 |
| 4 | **D1–D12** 后端去重（每次一项） | 从 D2 扩展名常量、D4 状态常量开始（低风险） |
| 5 | **D13–D15** 前端轮询/同步去重 | 先抽 `usePolling`，再合并三份 learned 同步 |
| 6 | **D16–D20** 前端复用 | 每项独立提交 |
| 7 | 低优先级清理 + 文档补齐 | 死代码删除、logger 统一、环境变量表补全 |

> 风险提示：B1 与 B2 涉及运行时行为，改动后务必在打包 exe（或本机 dev 模式）下实测；B2 修复会改变运行页画面渲染路径，需同时核对 `CameraCard` 的图片显示与"等待相机信号"占位逻辑。
