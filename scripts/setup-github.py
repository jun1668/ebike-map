#!/usr/bin/env python3
"""
一键把当前仓库推到你的 GitHub。

凭据只从本地文件读，脚本不会把 token 打印出来，也不会写进 .git/config 之外的地方
（推完会把 remote 里的 token 抹掉）。

token 存放位置（任选其一，脚本会依次找）：
  ~/.github-token
  /sdcard/Download/github-token.txt
  /sdcard/Download/token.txt
或者环境变量 GH_TOKEN

token 需要勾选 repo 权限：GitHub → Settings → Developer settings
→ Personal access tokens → Tokens (classic) → Generate new token (classic) → 勾 repo

用法：
  python3 scripts/setup-github.py              # 默认仓库名 ebike-map，公开
  python3 scripts/setup-github.py 我的仓库名    # 自定义仓库名
  python3 scripts/setup-github.py 名字 private  # 私有仓库
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

TOKEN_CANDIDATES = [
    os.path.expanduser("~/.github-token"),
    "/sdcard/Download/github-token.txt",
    "/sdcard/Download/token.txt",
]

API = "https://api.github.com"


def find_token():
    env = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if env and env.strip():
        return env.strip()
    for p in TOKEN_CANDIDATES:
        if os.path.isfile(p):
            with open(p, encoding="utf-8", errors="ignore") as f:
                t = f.read().strip()
            if t:
                return t
    return None


def api(path, token, method="GET", payload=None):
    url = API + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "ebike-map-setup")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode()
            return r.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="ignore")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"message": body[:300]}
    except urllib.error.URLError as e:
        return 0, {"message": str(e)}


def git(*args, sensitive=False):
    r = subprocess.run(["git"] + list(args), capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip()
    if sensitive:
        out = out.replace("x-access-token", "***")
    return r.returncode, out


def main():
    repo = sys.argv[1] if len(sys.argv) > 1 else "ebike-map"
    visibility = "private" if len(sys.argv) > 2 and sys.argv[2] == "private" else "public"

    token = find_token()
    if not token:
        print("没找到 GitHub token。请把 token 存成下面任一个文件：")
        for p in TOKEN_CANDIDATES:
            print("  " + p)
        print("\ntoken 在 GitHub → Settings → Developer settings → Personal access tokens")
        print("→ Tokens (classic) → Generate new token，勾选 repo 权限。")
        sys.exit(1)

    code, me = api("/user", token)
    if code != 200:
        print("token 验证失败（HTTP %s）：%s" % (code, me.get("message", "")))
        sys.exit(1)
    login = me.get("login")
    print("已认证：" + login)

    code, created = api(
        "/user/repos",
        token,
        method="POST",
        payload={
            "name": repo,
            "description": "共享电动车地图 —— 用户共建的共享电单车点位索引（微信小程序 + 云开发）",
            "private": visibility == "private",
            "has_issues": True,
            "has_wiki": False,
            "auto_init": False,
        },
    )
    if code == 201:
        print("已创建仓库：%s/%s（%s）" % (login, repo, visibility))
        full = created.get("full_name")
    elif code == 422:
        print("仓库 %s/%s 已存在，直接推送" % (login, repo))
        full = "%s/%s" % (login, repo)
    else:
        print("创建仓库失败（HTTP %s）：%s" % (code, created.get("message", "")))
        sys.exit(1)

    clone_url = "https://x-access-token:%s@github.com/%s.git" % (token, full)

    git("config", "user.name", login)
    git("config", "user.email", "%s@users.noreply.github.com" % login)
    # 首次提交的作者信息对齐到本人
    code2, _ = git("log", "-1", "--format=%an")
    if code2 == 0:
        git("commit", "--amend", "--reset-author", "--no-edit")

    git("remote", "remove", "origin")
    code3, out = git("remote", "add", "origin", clone_url, sensitive=True)
    if code3 != 0:
        print("配置 remote 失败：" + out)
        sys.exit(1)

    print("推送中…")
    code4, out4 = git("push", "-u", "origin", "main", sensitive=True)
    # 无论成败，都把 token 从 .git/config 里抹掉
    git("remote", "set-url", "origin", "https://github.com/%s.git" % full)

    if code4 != 0:
        print("推送失败：")
        print(out4[-1500:])
        print("\n如果提示 non-fast-forward，说明远程仓库不是空的。")
        print("把仓库删掉重来，或者手动：git pull --rebase origin main")
        sys.exit(1)

    print("\n推送完成：https://github.com/" + full)
    print("仓库地址：" + full)
    print("\n下一步（可选）：在这个仓库的 Settings → Secrets and variables → Actions 里加")
    print("  WX_APPID       你的小程序 AppID")
    print("  WX_PRIVATE_KEY 小程序代码上传密钥的内容")
    print("配好之后推 v* 标签就会自动上传体验版。")
    print("\n安全提示：token 已经从 git remote 配置里移除，但明文仍在你保存的那个文件里，")
    print("用完建议删掉：" + " ".join(TOKEN_CANDIDATES))


if __name__ == "__main__":
    main()
