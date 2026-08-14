# DeepSeek Harness Skin | DSH 换肤系统

<div align="center">

**跑 agent 的地方，也该是你喜欢的样子。**

21 套内置皮肤，外加一条「传一张图就生成一整套配色」的自定义通道。装进 DSH 源码，换肤就是设置面板里的一次点击，随时切回原生界面。

*Reskin the DeepSeek Harness web UI. 21 built-in skins plus one-image custom themes, with contrast-preserving color derivation.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.5-4D6BFE)
![Skins](https://img.shields.io/badge/skins-21%20%2B%20custom-c8447e)
![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)

[快速开始](#快速开始) · [它长这样](#它长这样) · [做你自己的皮肤](#用一张图做你自己的皮肤) · [内置 21 套](#内置-21-套皮肤) · [使用须知](#使用须知都是实话) · [English](README.en.md)

**幕后文章**：[DeepSeek 刚开源的 DSH 已经 5 万星，我给它做了 21 套皮肤](https://mp.weixin.qq.com/s/o6HdY5zi-e3gCkB_-HUKMA)

出品：公众号「黑哥Ai」 · 短视频「问问黑哥」 · 更多开源见 [HeiGeAi 组织主页](https://github.com/HeiGeAi)

</div>

![皮肤选择器与版本条](docs/images/skin-center.webp)

*真机截图：设置面板里的皮肤区。第一项永远是「自定义（选图）」，每个色卡都是这套皮肤的真实缩略图，底下一行显示皮肤系统版本和宿主版本，右边一颗「检查更新」。*

## 它长这样

下面全部是真机截图，侧栏、输入框、会话列表都是 DSH 原生控件，功能一点没动。

| QQ 2008 · 粉 | QQ 2007 |
| --- | --- |
| ![QQ 2008 粉色皮肤](docs/images/qq2008.webp) | ![QQ 2007 皮肤](docs/images/qq2007.webp) |

| 原神 · 璃月夜 | 鸣潮 · 黑青 |
| --- | --- |
| ![原神璃月夜皮肤](docs/images/genshin-dark.webp) | ![鸣潮黑青皮肤](docs/images/waves-1.webp) |

| 初音未来 | DeepSeek 娘 · Q 版 |
| --- | --- |
| ![初音未来皮肤](docs/images/miku.webp) | ![DeepSeek 娘 Q 版皮肤](docs/images/deepseek-nv-q.webp) |

| 内测大佬 | 峰哥骑鲸 |
| --- | --- |
| ![内测大佬皮肤](docs/images/neice-dalao.webp) | ![峰哥骑鲸皮肤](docs/images/fengge.webp) |

## 快速开始

前置条件：一份 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 源码检出（版本 `0.1.0-rc.5`）、Node.js 22.19 以上、pnpm。从 npm 直接跑的 `npx @deepseek-ai/dsh` 装不了，因为这套皮肤要跟着前端一起构建。

```bash
git clone https://github.com/HeiGeAi/deepseek-harness-skin.git
cd deepseek-harness-skin
bash scripts/install.sh /path/to/deepseek-harness
```

脚本会先把要覆盖的文件整份备份到 `~/.dsh-skin-backups/<时间戳>/`，再写入皮肤包、打宿主集成补丁。然后按提示重建一次：

```bash
cd /path/to/deepseek-harness && pnpm install && pnpm run build && pnpm dsh web
```

浏览器打开 `http://127.0.0.1:3080`，左下角**设置 → 通用设置 → 皮肤**，点一下就换。

想退回原样：

```bash
bash scripts/uninstall.sh /path/to/deepseek-harness
```

## 用一张图做你自己的皮肤

![自定义皮肤入口](docs/images/custom-picker.webp)

皮肤选择器的第一项就是「自定义（选图）」，点开选一张 PNG、JPG 或 WebP，剩下的全自动：

1. 浏览器本地解码一次，按 96px 采样取色，同时按 1920px 长边重编码成 WebP。
2. 从图里提取主色、副色、底色、文字色四个色种，判断这张图是浅色还是深色。
3. 按画面明暗自动调蒙版浓度，保证文字在任何一张图上都读得清。
4. 图片按内容哈希存进 `~/.dsh/skins/`，Host 加了一条只读静态路由供前端取用。

**原图不出本机。** 上传走的是同一台机器上的 DSH Host，压缩后的 WebP 落在 `~/.dsh/skins/`，同一张图重复选也只存一份。

![自定义皮肤效果](docs/images/custom.webp)

*真机截图：随手扔一张风景图进去，整套界面配色跟着图走，蒙版浓度自动压到文字可读。*

## 内置 21 套皮肤

| # | 皮肤 | 外观 | 边框风格 |
| --- | --- | --- | --- |
| 1 | QQ 2007 | 浅色 | flat |
| 2 | QQ 2008 · 粉 | 浅色 | glass |
| 3 | 初音未来 | 浅色 | neon |
| 4 | 原神 · 蒙德 | 浅色 | glass |
| 5 | 原神 · 璃月夜 | 深色 | neon |
| 6 | 恋与深空 · 星海 | 浅色 | glass |
| 7 | 恋与深空 · 星际 | 深色 | neon |
| 8 | 火影 · 鸣人 | 深色 | glass |
| 9 | 火影 · 佐助 | 深色 | neon |
| 10 | 鸣潮 · 黑青 | 深色 | neon |
| 11 | 鸣潮 · 深紫 | 深色 | glass |
| 12 | 龙珠 · 筋斗云 | 浅色 | glass |
| 13 | 龙珠 · 超赛 | 浅色 | neon |
| 14 | 大佬 · 烟灰 | 深色 | glass |
| 15 | DeepSeek 娘 · 深海 | 深色 | neon |
| 16 | DeepSeek 娘 · Q 版 | 浅色 | glass |
| 17 | DeepSeek 青春版 | 浅色 | glass |
| 18 | 内测大佬 | 深色 | neon |
| 19 | 别影响 AGI | 浅色 | glass |
| 20 | 峰哥骑鲸 | 浅色 | flat |
| 21 | 梁圣 · 静音 | 浅色 | glass |

QQ 2007 和 QQ 2008 两套是**纯配色皮肤**，一张位图都不带，整套界面由四个色种在构建期推导出来。其余 19 套各配一张背景图。

## 皮肤是怎么实现的

一套皮肤等于一份 JSON。这是全部内容：

```json
{
  "id": "qq-2008",
  "name": { "zh": "QQ 2008·粉", "en": "QQ 2008 Pink" },
  "order": 20,
  "appearance": "light",
  "chrome": "glass",
  "seeds": {
    "accent": "#c8447e",
    "secondary": "#d98bb0",
    "surface": "#f6e2ec",
    "text": "#2b1020"
  },
  "glyph": "🐧",
  "showBadge": true
}
```

围绕这份 JSON 的四条设计决定：

**保对比度推导，不是换色。** DSH 原生色板是 73 级绝对色阶加 89 个语义别名。从四个色种推导整条色阶时，程序会保持每一级与原生色板相同的对比度关系，所以按钮、边框、禁用态之间的层次感不会塌掉。计算在 OKLab 空间做，落在 sRGB 色域外的颜色用色度二分法拉回来。

**可读性在构建期确定性校验。** 21 套皮肤 × 8 项对比度契约，全部在构建期跑一遍，不达标直接构建失败。自己改完 JSON 跑这条命令复现：

```bash
pnpm --filter @deepseek-ai/dsh-client-ui-theme run check:skins
```

**作用域收口在 body 属性上。** 所有规则挂在 `body[data-dsh-skin="<id>"]` 和 `body[data-skin-chrome="<flat|glass|neon>"]` 下面，不改任何全局 CSS 变量。切回「默认」时属性一摘，界面立刻回到原生外观，没有残留。

**背景层固定在视口上。** 背景图挂在独立的固定层，不跟着会话容器缩放。开会话、滚长对话、开合侧栏，背景都待在原地。

想加一套自己的皮肤，往 `src/styles/skins/themes/` 扔一份 JSON，跑一次 `pnpm --filter @deepseek-ai/dsh-client-ui-theme run build:skins` 就有了。

## 版本与更新检查

设置面板底部显示「皮肤系统 v1.0.0 · DSH 0.1.0-rc.5」，右边一颗「检查更新」。

点它之后，请求由 **DSH Host 侧代理**发往 GitHub Releases，浏览器不直连第三方，3 秒超时、64KB 响应上限、60 秒内缓存。网络不通时显示「暂时无法检查」，按钮保持可点，不会卡住界面。

## 使用须知（都是实话）

- 这是**源码级改动**，走 `install.sh` 覆盖 `packages/client/ui-theme` 并打一个 8 文件的宿主补丁，需要重新 `pnpm run build`。不是运行时注入，也不劫持任何进程。
- 基线版本是 `0.1.0-rc.5`。DSH 还在 developer preview，上游改动界面结构时补丁可能打不上，脚本会明确报错而不是装出一半。
- 装完之后 DSH 全量测试仍然是绿的：811 个测试文件、13548 个用例通过，覆盖率 100%（语句 / 分支 / 函数 / 行四项全满），逐文件阈值。
- 自定义皮肤只在**本机**流转，压缩后的图存 `~/.dsh/skins/`，卸载脚本不动它，不要可以自己删。
- 上传路由只认 WebP 魔数，超过 4MB 的请求会被直接掐断而不是缓存进内存。
- 内置皮肤的背景图来源与再分发状态逐文件登记在 [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md)，发布边界见 [NOTICE.md](NOTICE.md)。

## 作者与同系项目

由 [黑哥AI（HeiGeAi）](https://github.com/HeiGeAi) 打造。公众号「黑哥Ai」写 AI 落地深度文章，短视频账号「问问黑哥」在抖音、B站、视频号、小红书讲人话 AI 科普。

这套皮肤从想法到发布的完整过程，写在这篇里：[DeepSeek 刚开源的 DSH 已经 5 万星，我给它做了 21 套皮肤](https://mp.weixin.qq.com/s/o6HdY5zi-e3gCkB_-HUKMA)

同系换肤项目：[HeiGe Codex Skin Studio](https://github.com/HeiGeAi/heige-codex-skin-studio)，给 Codex Desktop 和腾讯 WorkBuddy 换肤，本项目的 12 张背景图与它共用同一份素材库。更多开源见 [HeiGeAi 组织主页](https://github.com/HeiGeAi)。

## 许可证与素材

代码使用 [MIT License](LICENSE)。该许可只覆盖软件代码，不授权角色、商标或第三方视觉素材。逐文件来源与授权状态见 [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md)，发布边界见 [NOTICE.md](NOTICE.md)，上游代码许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

**素材风险提示**：免责声明与非商业用途声明不能替代转载、再分发或商标使用许可。来源或授权无法核实的素材在 provenance 表中标为未验证，分发者应自行取得许可或替换。素材权利问题可提交 [Issue](https://github.com/HeiGeAi/deepseek-harness-skin/issues)。

本项目与 DeepSeek 官方无隶属关系。

---

**觉得不错就点个 Star。换好了皮肤，来 [Discussions](https://github.com/HeiGeAi/deepseek-harness-skin/discussions) 贴一张。**
