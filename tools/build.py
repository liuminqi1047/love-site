#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
站点构建脚本（不引入任何依赖，python3 标准库即可）

做两件事：
  1) 把 site/partials/{nav,footer}.html 同步进每个页面 —— 导航和页脚只有一份源，
     改一次跑一次就全站生效，不用再逐个页面复制粘贴；
  2) 重算 assets 下 js/css 的 ?v=<hash> —— 改完样式脚本不用再手工 md5 替换，
     也不会出现"改了 css 忘了改版本号 → 老访客还在用缓存"。

用法：
  python3 tools/build.py --site /var/www/love            # 同步 + 刷版本号
  python3 tools/build.py --site /var/www/love --init     # 首次：从首页抽取 partial
  python3 tools/build.py --site /var/www/love --check    # 只检查，不写文件（退出码 1 = 有差异）

约定：页面里的 <nav id="nav">…</nav> 与 <footer>…</footer> 视为生成内容，
      不要直接在页面里改（改 partials，然后跑本脚本）。
"""
import argparse
import hashlib
import io
import os
import re
import sys

NAV_RE = re.compile(r'( *)(<nav id="nav">.*?</nav>)', re.S)
FOOT_RE = re.compile(r'( *)(<footer>.*?</footer>)', re.S)
# src="assets/x.js?v=abc12345" / href="assets/x.css?v=abc12345"
ASSET_RE = re.compile(r'((?:src|href)=")(assets/[^"?]+\.(?:js|css))(\?v=)([0-9a-zA-Z]+)(")')


def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def shift(block, remove, add):
    """去掉 block 每行开头 remove 个空格，再加 add 个空格（用于 partial 的缩进对齐）"""
    out = []
    for line in block.split("\n"):
        if remove and line.startswith(" " * remove):
            line = line[remove:]
        out.append((" " * add + line) if line.strip() else line)
    return "\n".join(out)


def md5_8(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:8]


def pages(site):
    return sorted(
        os.path.join(site, n) for n in os.listdir(site)
        if n.endswith(".html") and os.path.isfile(os.path.join(site, n))
    )


def extract_partials(site):
    """从首页抽导航与页脚，写成 partial（只跑一次；之后以 partial 为准）"""
    home = os.path.join(site, "home.html")
    src = read(home)
    nav = NAV_RE.search(src)
    foot = FOOT_RE.search(src)
    if not nav or not foot:
        sys.exit("找不到 <nav id=\"nav\"> 或 <footer>，--init 中止")
    pdir = os.path.join(site, "partials")
    if not os.path.isdir(pdir):
        os.makedirs(pdir)
    write(os.path.join(pdir, "nav.html"), shift(nav.group(2), len(nav.group(1)), 0))
    write(os.path.join(pdir, "footer.html"), shift(foot.group(2), len(foot.group(1)), 0))
    print("已抽取 partials/nav.html（%d 行）、partials/footer.html（%d 行）"
          % (nav.group(2).count("\n") + 1, foot.group(2).count("\n") + 1))


def sync_partial(text, regex, partial, name, page, check):
    m = regex.search(text)
    if not m:
        return text, 0
    indent = m.group(1)
    # 按目标页面的缩进重排 partial，避免排版错位
    block = shift(partial, 0, len(indent))
    # 注意：要把「缩进 + 标签」整段一起比对/替换，否则缩进会被叠加两次
    if text[m.start(1):m.end(2)] == block:
        return text, 0
    print("  %-22s %s 更新" % (os.path.basename(page), name))
    return text[:m.start(1)] + block + text[m.end(2):], 1


def bump_versions(text, site, page, check):
    changed = 0

    def repl(m):
        nonlocal changed
        prefix, rel, sep, old, quote = m.groups()
        path = os.path.join(site, rel)
        if not os.path.isfile(path):
            return m.group(0)
        new = md5_8(path)
        if new != old:
            changed += 1
            return prefix + rel + sep + new + quote
        return m.group(0)

    out = ASSET_RE.sub(repl, text)
    if changed:
        print("  %-22s 版本号更新 %d 处" % (os.path.basename(page), changed))
    return out, changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", required=True, help="站点根目录，例如 /var/www/love")
    ap.add_argument("--init", action="store_true", help="从首页抽取 partials")
    ap.add_argument("--check", action="store_true", help="只检查不写")
    args = ap.parse_args()

    site = os.path.abspath(args.site)
    if not os.path.isdir(site):
        sys.exit("站点目录不存在：%s" % site)

    if args.init:
        extract_partials(site)

    pdir = os.path.join(site, "partials")
    nav = read(os.path.join(pdir, "nav.html")) if os.path.isfile(os.path.join(pdir, "nav.html")) else None
    foot = read(os.path.join(pdir, "footer.html")) if os.path.isfile(os.path.join(pdir, "footer.html")) else None
    if nav is None or foot is None:
        sys.exit("缺少 partials/nav.html 或 partials/footer.html，先跑 --init")

    total_page = total_part = total_ver = 0
    for page in pages(site):
        text = read(page)
        orig = text
        if NAV_RE.search(text):
            total_page += 1
            text, n1 = sync_partial(text, NAV_RE, nav, "导航", page, args.check)
        text, n2 = sync_partial(text, FOOT_RE, foot, "页脚", page, args.check) if FOOT_RE.search(text) else (text, 0)
        total_part += n1 + n2
        text, n3 = bump_versions(text, site, page, args.check)
        total_ver += n3
        if text != orig:
            if args.check:
                print("  %-22s 与 partials/版本号不一致" % os.path.basename(page))
            else:
                write(page, text)

    if args.check:
        bad = total_part + total_ver
        print("检查完成：%d 个页面，%d 处不一致" % (total_page, bad))
        sys.exit(1 if bad else 0)

    print("完成：%d 个页面，同步 %d 处，版本号 %d 处" % (total_page, total_part, total_ver))


if __name__ == "__main__":
    main()
