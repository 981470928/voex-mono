#!/usr/bin/env python3
"""Download official complete fonts; convert only their container to WOFF2.
下载官方完整字体，仅将其容器格式转换为 WOFF2。
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
import argparse
import hashlib
import json
import logging
import re
import time
import urllib.request
import subprocess
import xml.sax.saxutils

logging.getLogger('fontTools').setLevel(logging.ERROR)


def git_sha(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + bytes([0]) + data).hexdigest()


def download(source, target):
    if target.is_file() and git_sha(target.read_bytes()) == source['gitSha']:
        return target.read_bytes()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + '.part')
    owner, repository, revision, path = source['url'].removeprefix('https://raw.githubusercontent.com/').split('/', 3)
    delivery = f'https://cdn.jsdelivr.net/gh/{owner}/{repository}@{revision}/{path}'
    subprocess.run(['curl', '--compressed', '--fail', '--location', '--silent', '--show-error',
                    '--retry', '2', '--connect-timeout', '15', '--max-time', '600',
                    '--output', str(temporary), delivery], check=True)
    data = temporary.read_bytes()
    if git_sha(data) != source['gitSha']:
        raise ValueError('Official Git blob checksum mismatch: ' + source['url'])
    temporary.replace(target)
    return data


def ranges(points):
    values = sorted(points)
    result = []
    start = previous = values[0]
    for value in values[1:]:
        if value == previous + 1:
            previous = value
            continue
        result.append(f'U+{start:X}' if start == previous else f'U+{start:X}-{previous:X}')
        start = previous = value
    result.append(f'U+{start:X}' if start == previous else f'U+{start:X}-{previous:X}')
    return ','.join(result)


def axes(face):
    return {a.axisTag: [a.minValue, a.defaultValue, a.maxValue] for a in face['fvar'].axes} if 'fvar' in face else {}


def make_preview(face, label):
    glyphs = face.getGlyphSet(location={'wght': 400} if 'wght' in axes(face) else None)
    cmap = face.getBestCmap()
    scale = 16 / face['head'].unitsPerEm
    result, x = [], 0
    for char in label:
        name = cmap.get(ord(char))
        if not name:
            raise ValueError('Missing preview character: ' + char)
        glyph = glyphs[name]
        pen = SVGPathPen(glyphs)
        glyph.draw(pen)
        result.append(f'<path transform="translate({x:.3f} 20) scale({scale:.7f} {-scale:.7f})" d="{pen.getCommands()}"/>')
        x += glyph.width * scale
    title = xml.sax.saxutils.escape(label)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="184" height="28" viewBox="0 0 184 28"><title>{title}</title>' + ''.join(result) + '</svg>'


def build(font, output, cache):
    target = output / font['id'] / font['version']
    target.mkdir(parents=True, exist_ok=True)
    if (target / 'SOURCE.json').is_file():
        existing = json.loads((target / 'SOURCE.json').read_text())
        expected = {source['gitSha'] for source in font['upstream']['sources']}
        if ({variant['sourceGitSha'] for variant in existing['variants']} == expected
                and all((target / variant['file']).is_file() and hashlib.sha256((target / variant['file']).read_bytes()).hexdigest() == variant['sha256'] for variant in existing['variants'])
                and all((target / name).is_file() for name in ['font.css', 'preview.svg', 'OFL.txt'])):
            print(font['id'], 'complete verified files reused', flush=True)
            return existing
    upstream = font['upstream']
    original = cache / font['id'] / upstream['commit']
    license_data = download(upstream['license'], original / 'OFL.txt')
    if 'SIL OPEN FONT LICENSE' not in license_data.decode():
        raise ValueError('Unexpected font license')
    (target / 'OFL.txt').write_bytes(license_data)
    css, variants = [], []
    for source in upstream['sources']:
        path = original / source['name']
        source_data = download(source, path)
        with TTFont(path, recalcBBoxes=False, recalcTimestamp=False) as face:
            cmap = face.getBestCmap()
            points = set(cmap)
            for table in face['cmap'].tables:
                if table.format == 14:
                    points.update(table.uvsDict)
            original_axes = axes(face)
            glyph_count = face['maxp'].numGlyphs
            # Container conversion invalidates/removes DSIG, never glyph/layout/variation data.
            # 容器格式转换会使 DSIG 失效或将其移除，但不会改动字形、布局或可变字体数据。
            tables = set(face.keys()) - {'DSIG'}
            if 'wght' in original_axes:
                minimum, _, maximum = original_axes['wght']
                weight = f'{minimum:g} {maximum:g}'
                filename = 'Variable.woff2'
                labels = [name for name, n in [('Regular', 400), ('Medium', 500), ('Bold', 700)] if minimum <= n <= maximum]
            else:
                n = int(face['OS/2'].usWeightClass)
                if source['weight'] is not None and source['weight'] != n:
                    raise ValueError('Official static weight mismatch')
                weight = str(n)
                labels = [{400: 'Regular', 500: 'Medium', 700: 'Bold'}.get(n, str(n))]
                filename = labels[0] + '.woff2'
            if not (target / 'preview.svg').exists() or 'Regular' in labels:
                (target / 'preview.svg').write_text(make_preview(face, font['label']))
            face.flavor = 'woff2'
            temporary = target / (filename + '.part')
            if not temporary.is_file():
                face.save(temporary)
            with TTFont(temporary) as converted:
                if (set(converted.getBestCmap()) != set(cmap) or converted['maxp'].numGlyphs != glyph_count
                        or axes(converted) != original_axes or not tables.issubset(set(converted.keys()))):
                    raise ValueError('Full font data changed during WOFF2 conversion')
            temporary.replace(target / filename)
            css.append("@font-face {\n" + f"  font-family: 'Voex {font['family']}';\n"
                       + "  font-style: normal;\n  font-display: swap;\n"
                       + f"  font-weight: {weight};\n  src: url('./{filename}') format('woff2');\n"
                       + f"  unicode-range: {ranges(points)};\n}}\n")
            data = (target / filename).read_bytes()
            variants.append({'file': filename, 'weights': labels, 'cssWeight': weight, 'bytes': len(data),
                             'characters': len(cmap), 'glyphs': glyph_count, 'axes': original_axes,
                             'sha256': hashlib.sha256(data).hexdigest(), 'source': source['url'],
                             'sourceGitSha': source['gitSha'], 'sourceSha256': hashlib.sha256(source_data).hexdigest()})
        print(font['id'], filename, len(data), 'bytes,', ','.join(labels), flush=True)
    (target / 'font.css').write_text('\n'.join(css))
    result = {key: value for key, value in font.items() if key != 'upstream'}
    result.update({'license': 'OFL-1.1', 'sourceCommit': upstream['commit'], 'variants': variants,
                   'woff2Files': len(variants), 'bytes': sum(v['bytes'] for v in variants)})
    (target / 'SOURCE.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    return result


def write_readme(output, manifest):
    counts = Counter(font['group'] for font in manifest)
    summary = '，'.join(f'{group} {count} 款' for group, count in counts.items())
    rows = ['# 编辑器完整字体资源', '', f'保留中文全部 4 款。当前{summary}，共 {len(manifest)} 款。', '',
            '来源为 Google Fonts / Noto 官方仓库固定提交中的完整 TTF/OTF 原版。仅转换为 WOFF2 容器，不合并切片、不裁切字形、不删除或实例化字重轴。转换后核对字符映射、字形数量、字重轴和 OpenType 表，保留原授权 OFL.txt。', '',
            'Variable.woff2 为官方可变字体的完整字库，一个文件支持实际范围内的 Regular / Medium / Bold。静态字重按官方实际文件分别保存；只有 Regular 的字体保留一种，不虚构 Large 版本。', '',
            '默认页面和展开列表只使用系统字体及 preview.svg 图片，不下载 WOFF2。选用或读取已设置字体的内容时才安装 font.css，浏览器按实际使用的字体/字重及必要语言回退加载完整文件。unicode-range 只声明这个完整文件支持哪些字符，不对应切片。', '',
            '| 字体 | 分组 | 完整字体文件数 | 字重 | 总体积 |', '| --- | --- | ---: | --- | ---: |']
    for font in manifest:
        weights = sorted({w for variant in font['variants'] for w in variant['weights']})
        rows.append(f"| {font['label']} | {font['group']} | {font['woff2Files']} | {', '.join(weights)} | {font['bytes']/1024/1024:.2f} MiB |")
    rows += ['', '站酷快乐体保留官方 Regular 完整版本。菜单和 AI 参数共用 font-catalog.json。', '',
             'SOURCE.json 与 manifest.json 保存官方完整文件 URL、Git blob SHA、原版及 WOFF2 的 SHA-256、体积和真实字重。', '',
             '生成脚本：web/script/sync-editor-fonts.py。原版 TTF 只留于服务器构建缓存，不对浏览器预加载。', '']
    (output / 'README.md').write_text('\n'.join(rows))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--web-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--catalog', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    web = args.web_root.resolve()
    output = (args.output or web / 'public/fonts').resolve()
    cache = web.parent / '.voex/cache/font-upstream/downloads'
    fonts = json.loads((args.catalog or web / 'packages/editor-schema/src/font-catalog.json').read_text())
    if len({font['id'] for font in fonts}) != len(fonts):
        raise ValueError('Duplicate font ID')
    for font in fonts:
        if not re.fullmatch(r'[a-z0-9-]+', font['id']) or not re.fullmatch(r'[a-z0-9.-]+', font['version']):
            raise ValueError('Invalid managed font path')
        for source in [font['upstream']['license'], *font['upstream']['sources']]:
            if (not source['url'].startswith(('https://raw.githubusercontent.com/google/fonts/', 'https://raw.githubusercontent.com/notofonts/noto-cjk/'))
                    or not re.fullmatch(r'[0-9a-f]{40}', source['gitSha'])):
                raise ValueError('Font sources must be pinned official Google Fonts or Noto files')
    output.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        manifest = list(pool.map(lambda f: build(f, output, cache), fonts))
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    write_readme(output, manifest)
    print('Full official fonts ready:', len(manifest), 'families,', sum(f['woff2Files'] for f in manifest),
          'WOFF2 files,', sum(f['bytes'] for f in manifest), 'bytes', flush=True)


if __name__ == '__main__':
    main()
