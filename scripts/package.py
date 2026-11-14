#!/usr/bin/env python3
"""检查并打包 Mizu；仅使用 Python 标准库和 Node.js。"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]


def check(tag=None):
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    version = manifest['version']
    if not re.fullmatch(r'(0|[1-9]\d*)(\.(0|[1-9]\d*)){1,3}', version):
        raise ValueError('manifest.json 中的版本号无效')
    if any(int(part) > 65535 for part in version.split('.')):
        raise ValueError('版本号的各段必须小于等于 65535')
    if tag is not None and tag != 'v' + version:
        raise ValueError('标签 {} 与扩展版本 v{} 不一致'.format(tag, version))
    if manifest['manifest_version'] != 3:
        raise ValueError('项目需要 Manifest V3')
    references = list(manifest['icons'].values()) + [
        manifest['chrome_url_overrides']['newtab'],
        manifest['action']['default_popup'],
    ]
    for reference in references:
        if not (ROOT / reference).is_file():
            raise ValueError('缺少扩展文件：' + reference)
    for path in sorted((ROOT / 'js').glob('*.js')):
        subprocess.run(
            ['node', '--input-type=module', '--check'],
            input=path.read_text(), text=True, check=True,
        )
    # 检查页面和样式中引用的本地静态文件。
    for path in [*ROOT.glob('*.html'), *(ROOT / 'css').glob('*.css')]:
        content = path.read_text()
        references = re.findall(r'(?:src|href)=["\']([^"\']+)', content)
        references += re.findall(r'url\(["\']?([^\)"\']+)', content)
        for reference in references:
            if reference.startswith(('#', 'data:', 'http:', 'https:', '//')):
                continue
            local_path = reference.split('#')[0].split('?')[0]
            if not (path.parent / local_path).is_file():
                raise ValueError('缺少静态资源：{} → {}'.format(path.name, reference))
    for name in ['README.md', 'README.en.md', 'PRIVACY.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']:
        if not (ROOT / name).is_file():
            raise ValueError('缺少说明文件：' + name)
    print('检查通过：版本 {}、Manifest、JavaScript 语法和静态资源。'.format(version))
    return version


def package(version):
    # 使用明确的文件清单，排除截图、Git 元数据、脚本和开发资料。
    files = [ROOT / name for name in (
        'manifest.json', 'newtab.html', 'popup.html',
        'LICENSE', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md',
    )]
    files += list((ROOT / 'js').glob('*.js'))
    files += list((ROOT / 'css').glob('*.css'))
    files += [p for p in (ROOT / 'assets').rglob('*')
              if p.is_file() and p.suffix.lower() in {'.png', '.svg', '.jpg', '.jpeg', '.webp', '.ico'}]
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    archive = output / ('mizu-start-v' + version + '.zip')
    with ZipFile(archive, 'w', ZIP_DEFLATED) as bundle:
        for path in sorted(files):
            bundle.write(path, 'mizu-start/' + path.relative_to(ROOT).as_posix())
    with ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise ValueError('ZIP 校验失败')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = archive.with_suffix('.zip.sha256')
    checksum.write_text('{}  {}\n'.format(digest, archive.name))
    print('已生成：{}\n已生成：{}'.format(archive, checksum))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='仅检查，不打包')
    parser.add_argument('--tag', help='核对发布标签是否等于 v + manifest 版本')
    args = parser.parse_args()
    version = check(args.tag)
    if not args.check:
        package(version)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print('失败：{}'.format(error), file=sys.stderr)
        sys.exit(1)
