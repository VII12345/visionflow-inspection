# 项目待办清单（代码审计 / 解耦 / 功能完善 / 文档）

> 更新日期：2026-08-01
> 规则：每完成一个点 → 单独测试 → 中文 commit → **不 push**。
> 约束：`backend/training.py` 不动；前端只改前端、不改变后端业务/API 行为；`view/src-tauri` 既有改动不提交。
> 当前状态：2.1、2.2、3.1-3.4、4.x、5 均已完成并提交。

---

## 一、已完成并提交（main 分支，ahead 26，未 push）

| 提交 | 内容 | 说明 |
| --- | --- | --- |
| 1297e1e | 文档：更新 README 与使用/详细文档 | 鉴权/模型管理/照片导出章节 |
| 0a982b5 | 功能：照片分页筛选与导出报表 | photo_routes 分页/导出/趋势 + PhotoBrowser/TrendChart |
| 9078b8d | 功能：模型重命名删除与删除保护 | model DELETE/PATCH + version + 引用检查 |
| 163b549 | 功能：后端登录鉴权与密码哈希 | auth_routes/user_repository + token + 401 |
| 483e78f | 功能：网页版支持本地目录选择 | pickDirectoryWeb（File System Access API） |
| 8e8245d | 重构：拆分公共模态框为独立组件 | modals/ 目录 + ModalRouter |
| ec6809c | 重构：拆分目录管理页为产品/线体表格组件 | useCatalog/useCatalogEdit + LineTable/ProductTable |
| 43ca31d | 重构：拆分主应用为健康检查/快捷键/页签路由 | useHealthChecks/useKeyboardShortcuts/TabRouter |
| adf733a | 重构：拆相机详情页为照片/统计/保存设置卡片 | useSaveSettings/useCameraPhotos + 卡片组件 |
| 0e0811a | 重构：拆分运行页为控制栏/相机网格组件 | useRunControl/useRunModelSync + RunHeader/LineGrid |
| 2fe1246 | 重构：拆分设置页为训练/产品/线体分区 | useTrainingPanel/useProductLearningSync + 分区组件 |
| 526b102 | 重构：拆分布局面板为硬件信息卡片组件 | hardware/ 卡片 + useHardwareInfo/hardwareFormat |
| 0d8fe28 | 重构：拆分PLC服务与照片保存服务 | plc_config/plc_client + photo_storage/save_queue |
| 9449252 | 重构：拆分离线模型加载与推理队列模块 | model_loader / inference_worker 分离 |
| b3c285d | 重构：拆分环境检测为类别检查器 | env_checkers 分类 |
| 38c9a00 | 重构：拆分MVS相机驱动为设备取流控制模块 | mvs_device / acquisition / controls |
| 5d1319c | 重构：硬件采集器按类别拆分 | backend/hardware 采集器 |
| f944374 | 重构：拆分服务器启动与相机运行服务 | server.py 瘦身 + camera_run_service / server_bootstrap |
| dc1ca86 | 重构：拆分后端模型管理模块 | 模型仓库与路由分离 |
| 6f5965c | 修复：拒绝不存在的模型配置 | 防御性校验 |
| 6f81349 | 重构：拆分运行页布局交互 | 运行页逻辑抽到 hooks |
| ed542ec | 清理：彻底移除模拟相机模式 | 删除 mock_camera / simulate_stability_test |
| 883f99a | 重构：拆分照片管理与异步存盘模块 | capture/photo 分离 |
| bcbbc3b | 重构：拆分模型训练接口模块 | training_routes 独立 |
| 3fc7b49 | 重构：拆分离线模型测试接口 | model_test_routes 独立 |
| a7c3d86 | 重构：拆分MVS相机管理器 | mvs_camera_manager 独立 |
| aed5efd | 重构：拆分硬件信息采集与评估模块 | hardware_collectors / hardware_checks 独立 |
| 41640b4 | 重构：拆分离线测试页面 | TestTab → useModelTest + TestResultPanel |

> 验证记录：2.1.1-2.1.6 每次均通过 Python 单测 + `compileall`；2.2 每次 tsc + vite build 通过；3.2/3.3/3.4 新增 test_auth/test_models/test_photos 后总计 60 项单测全过；最终验证（第 5 节）全部通过。

---

## 二、代码解耦（待办，按序执行，每个完成后单独测试 + commit）

### 2.1 后端拆分

#### 2.1.1 拆分 backend/server.py（614 行）【已完成】

现状结构（逐函数）：
- 60 行 `initialize_camera_manager()`：创建 MVSCameraManager 并初始化相机状态
- 87 行 `_stop_camera(cam_id)`：停止取流/断开/更新状态
- 103 行 `_start_camera(cam_id, cam_config, available_cameras)`：按 IP 匹配设备、配置、启动线程
- 159 行 `start_system()`：/api/start 启动系统路由（线体数量、相机-产品映射、线路筛选）
- 254 行 `set_line_enabled(cam_id)`：/api/lines/<id> 单线路启停
- 311 行 `stop_system()`：/api/stop
- 330 行 `get_status()`：/api/status 轮询
- 363 行 `get_frame(cam_id)`：/api/frame 帧图
- 382 行 `get_result(cam_id)`：/api/result
- 392/398 行 `get_stats()` / `reset_stats()`：统计
- 411 行 `camera_worker(cam_id)`：相机工作线程（触发→抓帧→推理→PLC→存盘）
- 526 行 `run_server()`：启动编排（配置加载/环境检测/预加载/启动 worker/定时清理）

拆分方案：
- [x] 新建 `backend/camera_run_service.py`：`initialize_camera_manager`、`start_camera`、`stop_camera`、`camera_worker`
  - 依赖：config / logger / mvs_camera_manager / inference_worker / plc_service / runtime_state / capture_service / model_repository
  - 保留原函数体逐行不变，仅去掉下划线前缀并保持返回语义 (`(ok, error_msg)`)
- [x] 新建 `backend/server_bootstrap.py`：`run_server()` + `_cleanup_loop()`
  - 依赖：config / logger / server.app / camera_run_service / inference_worker / env_check / capture_service / runtime_state / system_routes / settings_repository
  - 从 `.server import app`；server.py 不反向 import（避免循环依赖）
- [x] server.py 瘦身为：Flask app + 蓝图注册 + 8 个 API 路由（约 260 行）
  - 保留 `run_server()` 兼容壳：`def run_server(): from .server_bootstrap import run_server as _r; _r()`
  - 删除不再使用的 import：datetime/timedelta/Path/queue/os/json、plc 相关（已移入 worker）、settings_repository 各别名等
- [x] 测试与提交
  - 命令：`unittest discover`、`compileall`
  - 验证：`backend.__main__` 可正常 import；`python -c "from backend.server import run_server, app"`
  - commit：`重构：拆分服务器启动与相机运行服务`

#### 2.1.2 拆分 backend/hardware_collectors.py（402 行）【已完成】

现状结构：
- `collect_system_info()`(8)、`_detect_cpu_model`(19)、`collect_cpu_info`(95)、`_detect_memory_speed`(125)、`collect_memory_info`(181)、`collect_disk_info`(204)、`_collect_wifi_rates`(238)、`_collect_ethernet_speeds`(267)、`_classify_interface`(293)、`collect_network_info`(312)、`collect_gpu_info`(359)

拆分方案：
- [x] 新建 `backend/hardware/cpu_collector.py`、`memory_collector.py`、`disk_collector.py`、`network_collector.py`、`gpu_collector.py`（或一个 `hardware/__init__.py` 聚合导出）
- [x] 原文件保留为聚合入口：`collect_system_info()` 组合各采集器
- [x] 测试与提交

#### 2.1.3 拆分 backend/mvs_camera.py（378 行）【已完成】

现状结构：`MVSCamera` 类含 connect(76)/disconnect(124)/start_grabbing(137)/stop_grabbing(202)/grab_frame(216)/set_exposure_time(286)/set_gain(303)/set_trigger_delay(316)/set_line_debouncer(331)/set_strobe(345)/get_info(370)

拆分方案：
- [x] 按 SDK 操作分组：`mvs_device.py`（connect/disconnect/get_info）、`mvs_acquisition.py`（start/stop/grab）、`mvs_controls.py`（曝光/增益/触发/去抖/strobe）
- [x] MVSCamera 保留为门面类组合上述能力（或在 manager 层组合）
- [x] 测试与提交

#### 2.1.4 拆分 backend/env_check.py（273 行）【已完成】

现状结构：`EnvCheckResult`(20)、`EnvironmentChecker`(31) 含 run_all(42)/_check_python_arch(68)/_check_mvs_paths(80)/_check_import(148)/_check_sdk_init(190)/to_dict(233)/can_proceed(258)、`run_environment_check()`(269)

拆分方案：
- [x] 检查器按类别拆分：`env_checkers/python_checker.py`、`mvs_checker.py`、`sdk_checker.py`
- [x] `EnvironmentChecker` 保留为编排器；`run_environment_check()` 入口不变
- [x] 测试与提交

#### 2.1.5 拆分 backend/inference_worker.py（270 行）【已完成】

现状结构：`set_camera_product`(29)/`warmup_model`(38)/`preload_all_models`(56)/`load_model`(79)/`get_model_for_product`(130)/`reload_all_models`(138)/`_unpack_inference_item`(162)/`inference_worker`(169)/`start_inference_worker`(243)/`submit_inference`(250)/`get_inference_result`(263)

拆分方案：
- [x] 拆出 `model_loader.py`：load_model / warmup / preload / reload / camera_product_map 与模型缓存
- [x] `inference_worker.py` 保留队列/线程与提交/获取接口
- [x] 测试与提交

#### 2.1.6 检查后端其余文件【已完成】

- [x] `backend/plc_service.py`（211 行）：可拆 `plc_config.py`（配置读写）+ `plc_client.py`（写节点）
- [x] `backend/capture_service.py`（210 行）：可拆 `photo_storage.py`（目录/清理）+ `save_queue.py`（worker/队列）
- [x] 每次拆分后跑 unittest + compileall 再提交

### 2.2 前端拆分（每个文件拆完：tsc + vite build → commit）

#### 2.2.1 HardwarePanel.tsx（304 行）【已完成】

现状：`HardwarePanel`(5) 整体；`formatSpeed`(269) 等辅助函数
- [x] 拆为子组件：`HardwareCpuCard`、`HardwareMemoryCard`、`HardwareGpuCard`、`HardwareDiskCard`、`HardwareNetworkCard`
- [x] 数据加载逻辑抽 `useHardwareInfo.ts` hook
- [x] 辅助函数抽 `hardwareFormat.ts`（formatSpeed / hasRxTx 判断）

#### 2.2.2 SettingsTab.tsx（296 行）【已完成】

现状：`SettingsTab`(13) 内含产品/训练状态轮询(36-66)、saveLineCount(70)、训练逻辑 startLearning(95)/confirmLearning(103)/pollTraining(140)/stopLearning(174)
- [x] 训练相关全部抽 `useTrainingPanel.ts`（start/confirm/poll/stop + 状态）
- [x] 产品与学习状态同步逻辑抽 `useProductLearningSync.ts`（refresh 轮询）
- [x] JSX 分区：`LineCountSection`、`TrainingSection`、`ProductSection` 子组件

#### 2.2.3 RunTab.tsx（284 行）【已完成】

现状：`RunTab`(14)，已有 useRunLayout/useSystemPolling/useFrameUpdater 等 hooks；内含 startSystem(104)/syncModelStatus(82)/handlePopout(64)
- [x] 启动/停止逻辑抽 `useRunControl.ts`（startSystem/stopSystem/线路启停）
- [x] 模型状态同步抽 `useRunModelSync.ts`（syncModelStatus）
- [x] 弹窗/弹出相机逻辑抽 `useCameraPopout.ts`（handlePopout/togglePopout）
- [x] 渲染分区：`RunHeader`、`LineGrid`（告警覆盖层为 App 级 SystemAlarm，见运行页 raiseAlarm 逻辑保留在 useRunControl）

#### 2.2.4 CameraDetailTab.tsx（243 行）【已完成】

现状：`CameraDetailTab`(14) 内含 updateSaveSettings(81)/toggleSaveGood(96)/toggleSaveBad(101)/resetStats(106)/handleRightClick(120)
- [x] 保存设置逻辑抽 `useSaveSettings.ts`
- [x] 照片右键/上下文菜单抽 `PhotoContextMenu.tsx`
- [x] 渲染分区：`SaveSettingsCard`、`StatsCard`、`PhotoListCard`

#### 2.2.5 App.tsx（226 行）【已完成】

现状：`MainApp`(28) 内含 checkEnvironment(67)/checkHealth(108)/键盘快捷键(145)/renderTabContent(156)；`App`(221)
- [x] 环境/健康检查抽 `useHealthChecks.ts`
- [x] 快捷键处理抽 `useKeyboardShortcuts.ts`
- [x] renderTabContent 的分页内容抽为 `TabRouter.tsx`（含权限跳转）

#### 2.2.6 FileTab.tsx（223 行）【已完成】

现状：`FileTab`(10) 内含 loadCatalog(26)/refresh(31)/saveProductName(67)/saveLineName(82)/assignProduct(97)/checkProduct(115)
- [x] 目录加载与刷新抽 `useCatalog.ts`
- [x] 产品/线体编辑逻辑抽 `useCatalogEdit.ts`
- [x] 渲染分区：`ProductTable`、`LineTable`、`EmptyState`

#### 2.2.7 Modals.tsx（212 行）【已完成】

现状：`LoginModal`(12)/`ChangePwdModal`(60)/`AddProductModal`(114)/`LearnConfirmModal`(163)
- [x] 按模态框拆文件：`LoginModal.tsx`、`ChangePwdModal.tsx`、`AddProductModal.tsx`、`LearnConfirmModal.tsx`，目录 `components/common/modals/`
- [x] 公共部分（输入框样式/字段组件）抽 `modalFields.tsx`
- [x] `Modals.tsx` 改为聚合转发（`ModalRouter` 按 modal 类型渲染）

---

## 三、功能完善（已全部完成，每项独立测试 + commit）

### 3.1 Web 端本地目录选择【已完成】

- 现状：网页版点"选择本地目录"只提示"请使用选择后端目录"
- 方案：
  - [x] `view/src/services/native.ts`：`isTauri()` 分支外新增 `pickDirectoryWeb()`，用 File System Access API `showDirectoryPicker`；不支持时抛错
  - [x] 使用位置：TestTab（类别根目录/测试图片目录）、LearnConfirmModal 统一走 `pickDirectory` 封装
  - [x] 前端降级提示 + 后端目录兜底保持不变
- 测试：tsc + vite build；Chrome 手动验证选择目录后路径回填（浏览器仅能回填目录名称）
- commit：`功能：网页版支持本地目录选择`

### 3.2 后端登录 / 权限校验 / 密码哈希【已完成】

- 现状：登录只在前端 localStorage（`storage.getUsers()`），后端无鉴权，任何人可直接调 API
- 方案：
  - [x] 后端 `auth_routes.py`：POST /api/auth/login（校验用户名+密码，返回 token）；密码用 `werkzeug.security.generate_password_hash` 存储，校验用 `check_password_hash`
  - [x] 用户存储：`backend/user_repository.py`（JSON 文件，首次启动初始化默认管理员，密码随机生成并提示）
  - [x] 鉴权中间件：除 login/health/静态资源外校验 `Authorization: Bearer <token>`；本地模式下可用配置开关 `AUTH_ENABLED=False` 默认关闭（兼容现有局域网无鉴权部署）
  - [x] 前端：`api.ts` 拦截器附带 token；401 时跳登录；Modals 登录逻辑接后端（登录/改密）
- 测试：新增 `tests/test_auth.py`（登录成功/失败/token 过期/无 token 401/开关关闭时放行/改密）
- commit：`功能：后端登录鉴权与密码哈希`

### 3.3 模型管理完善（删除/重命名/版本/删除保护）【已完成】

- 现状：只有模型列表与选择；无法删除/重命名
- 方案：
  - [x] 后端 `model_routes.py`：新增 DELETE /api/models/<name>、PATCH /api/models/<name>
  - [x] 删除保护：`model_repository.py` 检查模型是否被相机配置/引用登记引用，被引用返回 409 及引用列表（前端再叠加本地产品/线体检查）
  - [x] 版本展示：模型目录读取训练元数据（训练时间/准确率/设备），列表返回 version 字段
  - [x] 前端 `ModelSettingsTab.tsx`：模型卡片增加"重命名/删除"按钮与确认弹窗
- 测试：`tests/test_models.py` 新增删除保护/重命名/引用同步用例
- commit：`功能：模型重命名删除与删除保护`

### 3.4 照片管理完善（分页/筛选/批量导出/报表/趋势）【已完成】

- 现状：`FileTab.tsx` 是产品/线体目录管理；照片浏览在 CameraDetailTab，无分页筛选
- 方案：
  - [x] 后端 `photo_routes.py`：GET /api/photos 支持 `page/page_size/camera_id/start/end/category` 参数，返回 `{total, items}`
  - [x] 批量导出：POST /api/photos/export 生成 zip（`io.BytesIO` + `zipfile`），前端下载
  - [x] CSV 报表：GET /api/photos/report.csv（按时间/类别统计）
  - [x] 良率趋势：GET /api/photos/trend 返回按天/按小时的良率序列，前端用原生 canvas 折线图（不引重依赖）
  - [x] 前端：`FileTab.tsx` 增加"照片浏览"子页，含分页器、筛选条件、导出按钮、趋势图
- 测试：新增 `tests/test_photos.py`（分页/相机/类别/时间筛选/导出/趋势/报表）
- commit：`功能：照片分页筛选与导出报表`

---

## 四、文档更新（已完成）

### 4.1 README.md【已完成】

- [x] 更新项目结构树：补 server.py 拆分后模块（camera_run_service / server_bootstrap）与已有新模块
- [x] 更新启动说明（python -m backend、前端 npm run web:dev、Tauri 构建）
- [x] 功能列表更新（新增鉴权/模型管理/照片导出）
- [x] 环境要求与 requirements 说明核对

### 4.2 docs/用户使用说明书.md【已完成】

- [x] 默认账户改为随机密码说明
- [x] 同步设置页/测试页/运行页的 UI 变化（含照片浏览子页）
- [x] 补登录鉴权/模型重命名删除/照片导出章节

### 4.3 docs/项目详细文档.md【已完成】

- [x] 架构图/模块清单补充：model_repository / model_routes / photo_routes / capture_service / training_routes / model_test_routes / mvs_camera_manager / hardware_collectors / hardware_checks / camera_run_service / server_bootstrap 等
- [x] 全文查漏：mock_camera、simulate_stability_test、模拟相机 残留描述（无残留）
- [x] API 表格核对（新增鉴权/模型删除重命名/照片分页导出趋势）
- [x] 环境变量与数据目录补充（VISION_AUTH_ENABLED、users.json、model_refs.json）

---

## 五、最终验证与交付（已完成）

- [x] `.venv\Scripts\python.exe -m unittest discover -s tests -v` 全部通过（60 项）
- [x] `.venv\Scripts\python.exe -m compileall -q backend tests` 通过
- [x] `node.exe view\node_modules\typescript\bin\tsc --project view\tsconfig.json` 通过
- [x] `node.exe node_modules\vite\bin\vite.js build`（cwd=view）通过
- [x] `git diff --check` 无空白错误
- [x] `git diff --quiet -- backend/training.py` 确认无改动
- [x] 生成最终提交清单（全部未 push）
- [x] 输出"未实现 / 可增加功能"清单给用户（见本会话最终交付说明）

---

## 六、环境与注意事项

- 普通 shell 报 `CreateProcessAsUserW failed: 1920`：命令需 `require_escalated`，超时重试一次
- Node REPL（mcp__node_repl__js）无需审批：可读写文件、可 execFile 跑 unittest
- `view/src/components/test/` 下新文件被 .gitignore 忽略 → `git add -f`
- `view/src-tauri` 的 Cargo.toml / gen/schemas 改动为既有未提交文件：不要动、不要提交
- 写 JSX 用字符串拼接避免模板字面量转义踩坑；写完后回读文件确认编码/内容
