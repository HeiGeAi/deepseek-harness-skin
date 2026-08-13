# deepseek-harness-skin

DSH Web GUI 的视觉皮肤层。皮肤由数据源生成，不手写 CSS：一份
`themes/<id>.json` 声明四个种子色和一点元数据，`scripts/build-skins.mjs`
把它编译成 `generated/<id>.css` 加一条清单条目。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `themes/*.json` | 唯一真相源，一皮肤一份，格式见 `themes/_schema.json` |
| `assets/*.webp` | 背景大图，建议宽度 ≥ 1536px |
| `_chrome.css` | 全部皮肤共用的组件骨架，`flat` / `glass` / `neon` 三档预设 |
| `generated/` | 生成产物，**别手改**，改了下次生成就没了 |
| `scripts/build-skins.mjs` | 生成器兼可读性体检 |

## 加一个新皮肤

1. 往 `assets/` 放一张背景图（可选）。
2. 复制一份 `themes/*.json` 改成 `themes/<id>.json`，填 4 个种子色。
3. 跑生成器：

   ```bash
   pnpm --filter @deepseek-ai/dsh-client-ui-theme build:skins
   ```

4. 重新构建包：`pnpm --filter @deepseek-ai/dsh-client-ui-theme bundle`

没有第 5 步。`theme-settings.ts` 的皮肤列表、`locales.ts` 的显示名、
`web/src/base.css` 的样式引入、设置页的缩略图，全部从生成的清单里读，
不用再逐处登记。

## 生成器在算什么

上游 `design-platform.css` 是两层结构：73 个绝对色阶
（`--dsw-static-*`）加 89 个语义 token（`--dsw-alias-*` / `--dsw-specific-*`），
后者几乎全是指向前者的 `var()` 引用，浅色深色的区别只在于每个语义 token
指向哪一阶。所以皮肤只需要重述色阶，整个语义层自动跟着走，两种配色都成立，
上游改语义映射时也不会失配。

中性色阶按**对比度**而不是明度重建：每一阶在皮肤自己的背景上，复现该阶在
上游背景上的对比度，色相和彩度取自皮肤种子。这是可读性契约能成立的原因，
上游自己的色阶过 WCAG AA，那么在另一块背景上打到同样比值的色阶也过。
强调色是例外，种子本身就是重点，所以按种子重新居中，钉住主阶并保持顺序。

生成器每次跑都会打一张体检表，16 个皮肤 × 8 项对比度契约，任何一项不达标
直接退出码 1。CI 里用 `check:skins` 校验工作区和生成结果一致。

## 背景图只画一次

背景图挂在 `[data-app-frame]` 上，那就是整个窗口，尺寸只跟窗口走。会话面板
和详情栏往上叠遮罩，不重画图。**别在可滚动容器上再画一层 `cover` 背景**：
那样背景的定位区域是可滚动内容区而不是元素框，聊天记录越长图被撑得越大，
开一个长会话能放大十几倍。旧版 11 份手写皮肤每份都踩了这条。

叠加用 `--skin-veil-over`，它是按 `--skin-veil-soft` 预合成过的，压出来的
底色和直接刷一层 `--skin-veil` 完全一致，所以可读性体检的数值仍然作数。

## 皮肤可用的 DOM 钩子

组件只为皮肤挂了稳定的 data 属性，皮肤不得按 hash 类名选元素：

- `[data-frame-titlebar]`：AppFrame 顶栏（皮肤显隐，默认外观不显示）。
- `[data-frame-titlebar-brand]` / `[data-frame-titlebar-title]` /
  `[data-frame-titlebar-id]` / `[data-frame-titlebar-controls]` /
  `[data-frame-titlebar-button]`：顶栏内容。
- `[data-composer-card]`：会话输入卡片。
- `[data-message-bubble]`：用户消息气泡。
- `[data-app-frame]`：铺背景图的容器，整窗一张，只有这里画。
- `[data-conversation-panel]`：会话面板，皮肤把它自带的不透明底换成遮罩，
  背景图才透得出来。
- `[data-qq-show]`：右侧详情栏，自带一张独立构图的背景。
- `[data-skin-primary-button]` / `[data-skin-tab]`：主按钮与视图页签。

这些钩子只在 `_chrome.css` 里用一次。皮肤自身的 CSS 只有变量，没有选择器。

## 作用域

- `body[data-dsh-skin="<id>"]`：该皮肤的色板。
- `body[data-skin-chrome="<preset>"]`：共用组件骨架。两个属性同写同删。
- `[data-skin-preview="<id>"]`：设置页缩略图，只带 `--skin-*` 变量，
  不激活皮肤也能预览。

皮肤选择持久化在 `ui-theme` settings 的 `skin` 字段，设置 → 外观 → 皮肤
一行切换；Host 端 bootstrap 在首屏前注入这两个属性。

## 深浅配色

皮肤在 `appearance` 字段声明自己是 `light` 还是 `dark`，生成器就按那一套
配色推色阶，`ThemeRuntime` 也按它解析实际生效的配色方案，所以标了 `dark`
的皮肤走的是真正的深色语义层。`none` 是原厂外观，也是唯一跟随
`light/dark/system` 偏好的选项。
