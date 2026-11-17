# 圆环漏球 · Circle Leak Web

纯 HTML / CSS / JavaScript 复刻 [circle-leak-sim](https://github.com/baisedegy/circle-leak-sim)，无需框架、npm、CDN、数据库或后端。

## 直接运行

解压压缩包后，**双击 `index.html`**，即可以 Chrome / Edge / Firefox 等现代浏览器打开。离线可运行，无需部署。

也可以通过本地 HTTP 服务运行，浏览器在支持时自动启用 `OffscreenCanvas` + `Web Worker` 把模拟搬到后台线程（双击文件时自动改用主线程）：

```sh
# 在解压的 circle-leak-web 目录下
python -m http.server 8080
```

打开 http://localhost:8080/ 。也可用 VS Code Live Server。

## 玩法

- 选择 **无重力** 或 **重力** 模式开始。
- 点击圆环内部生成小球；按住鼠标 / 手指可以连续生成。
- 小球触壁反弹，底部的 80px 缺口允许小球漏出。
- 每漏出一颗「真实」小球，就在圆环上半部补充 N 颗（默认为 2，可改 2–10）。
- 达到开局设定的 **50 万–500 万**通关目标即结算。
- 模拟最多 90,000 个粒子实体，超过上限采用**权重合并**，真实数量计数保持守恒。
- 右侧实时查看 FPS、增长速度、累计漏球、模拟粒子及两张统计曲线。

### 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `1` / `2` | 菜单内选择无重力 / 重力 |
| `←` / `→` | 菜单内调整目标，每步 50 万 |
| `[` / `]`，`-` / `=` | 变更漏一补 N |
| `R` | 重新开始当前模式 |
| `M` | 返回菜单 |
| `H` | 查看 / 关闭玩法说明 |
| `Esc` | 关闭玩法说明；结算画面返回菜单 |

## GitHub Pages 部署

这是纯静态项目，适合直接发布 GitHub Pages。

1. 新建一个 GitHub 仓库（例如 `circle-leak-web`）。
2. 上传本目录的**全部文件**，注意让 `index.html` 位于仓库根目录。
3. 打开仓库 **Settings → Pages**，在 **Build and deployment → Source** 选择 **Deploy from a branch**。
4. Branch 选择 **main**，目录选择 **/(root)**，保存。
5. 等 GitHub Pages 发布后访问 `https://<你的用户名>.github.io/circle-leak-web/`。

不需要 GitHub Actions、不需要 CI 编译步骤、没有绝对路径依赖。

## 文件结构

```
index.html          页面与全部控件
style.css           响应式深色 UI
engine.js           物理、粒子压缩、像素渲染和统计数据
engine-worker.js    可选的 Worker 加速层
app.js              UI 交互、事件、统计图与线程调度
favicon.svg         自定义站点图标
LICENSE             Apache 2.0 许可证
NOTICE              原项目版权与改编说明
```

## 实现细节

- 逻辑画布 `1000×800`，圆心 `(500,365)`，半径 `320`。
- 向量式粒子更新采用 TypedArray；默认固定物理步长 `1/60 秒`。
- Canvas2D ImageData 直接写像素，球体为 2×2 色点，静态背景预生成。
- 模拟实体最多 `90,000`，落出画布的显示粒子最多 `6,000`；发生性能压力时主动压缩模拟实体（权重守恒）。
- 重力模式采用重力加速度与弹性损失；无重力模式使用恒速直线运动与圆周反弹。
- 主要对齐原项目的游戏规则、参数及核心交互；浏览器端的视觉排版、物理积分细节与原 Python/NumPy 版并非逐帧完全相同。

## 许可

本项目基于 [circle-leak-sim](https://github.com/baisedegy/circle-leak-sim) 改编，原项目版权归 sxc (2026) 所有，遵循 Apache License 2.0。详见 `LICENSE`、`NOTICE`。
