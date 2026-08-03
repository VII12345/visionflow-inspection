"""
环境检测模块
在系统启动时检测 MVS SDK、Python 环境等是否满足运行要求
"""

from .config import Config
from .env_checkers.mvs_checker import MVSChecker
from .env_checkers.python_checker import PythonChecker
from .env_checkers.sdk_checker import SDKChecker
from .logger import logger


if Config.IS_WINDOWS:
    Config.prepare_mvs_runtime_paths()


class EnvCheckResult:
    """单条检测结果"""

    def __init__(self, name, passed, level, message, detail=""):
        self.name = name  # 检测项名称
        self.passed = passed  # 是否通过
        self.level = level  # 'error' | 'warning' | 'ok'
        self.message = message  # 简短消息
        self.detail = detail  # 详细信息（修复建议）


class EnvironmentChecker:
    """环境检测器 — 启动时运行，收集所有环境问题"""

    def __init__(self):
        self.results = []

    def _add(self, name, passed, level, message, detail=""):
        self.results.append(EnvCheckResult(name, passed, level, message, detail))
        status = "OK" if passed else "FAIL"
        logger.info(f"  [{status}] {name}: {message}")

    def run_all(self):
        """运行所有检测项，返回结果列表"""
        logger.info("=" * 50)
        logger.info("开始环境检测...")
        logger.info("=" * 50)

        self.results = []
        PythonChecker(self._add).check()
        MVSChecker(self._add).check()
        SDKChecker(self._add).check()

        # 汇总
        errors = sum(1 for r in self.results if r.level == "error" and not r.passed)
        warnings = sum(1 for r in self.results if r.level == "warning" and not r.passed)
        all_ok = errors == 0

        logger.info("=" * 50)
        if all_ok:
            logger.info("环境检测通过 ✓")
        else:
            logger.warning(f"环境检测发现 {errors} 个错误, {warnings} 个警告")
        logger.info("=" * 50)

        return self.to_dict()

    def to_dict(self):
        """转为前端可用的字典"""
        errors = [r for r in self.results if r.level == "error" and not r.passed]
        warnings = [r for r in self.results if r.level == "warning" and not r.passed]
        all_passed = len(errors) == 0

        return {
            "passed": all_passed,
            "errorCount": len(errors),
            "warningCount": len(warnings),
            "summary": "环境检测通过"
            if all_passed
            else f"发现 {len(errors)} 个问题需要解决",
            "results": [
                {
                    "name": r.name,
                    "passed": r.passed,
                    "level": r.level,
                    "message": r.message,
                    "detail": r.detail,
                }
                for r in self.results
            ],
        }


# ========== 便捷函数 ==========


def run_environment_check():
    """运行环境检测并返回结果字典"""
    checker = EnvironmentChecker()
    return checker.run_all()
