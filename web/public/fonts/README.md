# 编辑器完整字体资源

保留中文全部 4 款。当前中文 4 款，English 2 款，日本語 2 款，한국어 2 款，共 10 款。

来源为 Google Fonts / Noto 官方仓库固定提交中的完整 TTF/OTF 原版。仅转换为 WOFF2 容器，不合并切片、不裁切字形、不删除或实例化字重轴。转换后核对字符映射、字形数量、字重轴和 OpenType 表，保留原授权 OFL.txt。

Variable.woff2 为官方可变字体的完整字库，一个文件支持实际范围内的 Regular / Medium / Bold。静态字重按官方实际文件分别保存；只有 Regular 的字体保留一种，不虚构 Large 版本。

默认页面和展开列表只使用系统字体及 preview.svg 图片，不下载 WOFF2。选用或读取已设置字体的内容时才安装 font.css，浏览器按实际使用的字体/字重及必要语言回退加载完整文件。unicode-range 只声明这个完整文件支持哪些字符，不对应切片。

| 字体 | 分组 | 完整字体文件数 | 字重 | 总体积 |
| --- | --- | ---: | --- | ---: |
| 思源黑体 | 中文 | 1 | Bold, Medium, Regular | 7.42 MiB |
| 思源宋体 | 中文 | 3 | Bold, Medium, Regular | 24.85 MiB |
| 霞鶩文楷 TC | 中文 | 2 | Bold, Regular | 9.83 MiB |
| 站酷快乐体 | 中文 | 1 | Regular | 0.83 MiB |
| Inter | English | 1 | Bold, Medium, Regular | 0.33 MiB |
| Roboto Mono | English | 1 | Bold, Medium, Regular | 0.10 MiB |
| Noto Sans 日本語 | 日本語 | 1 | Bold, Medium, Regular | 4.15 MiB |
| M PLUS Rounded 1c | 日本語 | 3 | Bold, Medium, Regular | 3.01 MiB |
| Noto Sans 한국어 | 한국어 | 1 | Bold, Medium, Regular | 3.73 MiB |
| Gowun Dodum | 한국어 | 1 | Regular | 0.42 MiB |

站酷快乐体保留官方 Regular 完整版本。菜单和 AI 参数共用 font-catalog.json。

SOURCE.json 与 manifest.json 保存官方完整文件 URL、Git blob SHA、原版及 WOFF2 的 SHA-256、体积和真实字重。

生成脚本：web/script/sync-editor-fonts.py。原版 TTF 只留于服务器构建缓存，不对浏览器预加载。
