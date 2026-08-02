"""无窗口执行外部命令的辅助工具。

后端打包为窗口化 exe（console=False）时，直接调用 subprocess.run 会让每个子进程
弹出一个一闪而过的控制台窗口。这里统一加上 CREATE_NO_WINDOW 消除该现象。
"""

import os
import subprocess


def run_hidden(args, **kwargs):
    """以不弹出控制台窗口的方式执行外部命令；其余参数透传 subprocess.run。"""
    if os.name == "nt":
        kwargs.setdefault("creationflags", subprocess.CREATE_NO_WINDOW)
    return subprocess.run(args, **kwargs)
