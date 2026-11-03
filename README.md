# dsh-local-installer

**DSH 本地插件安装器** —— 从本机文件夹或 zip 压缩包直接安装 DSH 插件，纯本地运行，全程不走网络。

<p align="center">
  <b>作者</b> LiXiao1949 &nbsp;·&nbsp;
  <b>GitHub</b> <a href="https://github.com/LiXiao1949">github.com/LiXiao1949</a> &nbsp;·&nbsp;
  <b>QQ</b> 1640444672
</p>

| 项目信息 | |
| --- | --- |
| 项目名 | `dsh-local-installer` |
| 包名 | `@local/dsh-local-install` |
| 版本 | 1.0.0 |
| 作者 | **LiXiao1949** |
| GitHub | <https://github.com/LiXiao1949> |
| 仓库 | <https://github.com/LiXiao1949/dsh-local-installer> |
| QQ | **1640444672** |
| 反馈 | [Issues](https://github.com/LiXiao1949/dsh-local-installer/issues) · QQ 1640444672 |
| 许可证 | MIT |

---

## 这个插件干什么

它给 DSH 补上一个**离线安装入口**：从**本机文件夹**或 **zip 压缩包**安装插件，选路径、解压/复制、交给 profile 的插件管理器，全程不经过任何插件市场或 registry。

界面与「插件市场」同位置：侧边栏面板（`sidebar.panellist` + `main`）和设置里的分区（`settings.section`，排在市场旁边）。打开插件页就能看到作者信息（LiXiao1949 · GitHub · QQ 1640444672）。

## 它做了什么

1. 浏览本机目录（`/dsh-local-install/api/list`），文件夹和 `.zip` 都能选；
2. 选中来源后复制/解压到 `<profile>/local-plugins/<name>@<version>`，源文件（下载目录、临时目录）之后删掉也不影响；
3. 用 profile 自己的 `pluginManager.inspect()` 校验，再 `installBundle()` 装成 `link:` 依赖并默认启用；
4. 页面里实时显示 pnpm 日志、注册的行、警告和失败原因。

## 为什么先复制到 local-plugins

`pnpm add <本地目录>` 写入的是 `link:` 依赖，profile 只是指向源目录的符号链接。若直接链接下载目录，源目录一删插件就坏；先把它固化到 profile 内的 `local-plugins/` 才能让「本地安装」和「从市场安装」一样稳定。安装完成后 `node_modules/<包名>` 指向 `local-plugins/<名字>@<版本>`，`<profile>/package.json` 里留下 `"<包名>": "link:<绝对路径>"` 这条记录。

## 目录结构

```
dsh-local-installer/
├── package.json          dsh.bundle.patch + dsh.client.platform=web + author 信息
├── cordis.patch.yml      插入 dsh-local-install 这一行 loader entry
├── assets/logo.svg       插件页图标
├── lib/
│   ├── index.js          host 半：等 webServer 就位后挂路由
│   ├── routes.js         /dsh-local-install/api/* 的 JSON 路由与来源校验（含 /info 的 author 字段）
│   ├── http.js           同源/回环校验、JSON 收发
│   ├── sources.js        列目录、判断「是不是插件」、读 zip 里的 package.json
│   ├── zip.js            无依赖的 zip 读取（central directory + 解压）
│   ├── install.js        安装流水线（暂存 → 校验 → 安装）与日志聚合
│   └── client.js         浏览器半：页面 + 三个 slot 注册 + 作者卡片
└── scripts/
    └── smoke-client.cjs  无浏览器的自测：跑一遍 apply()、注册与渲染
```

## 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/info` | profile 位置、插件存放目录、快捷根目录、默认目录、**作者信息（author）** |
| GET | `/list?path=` | 列出目录下的文件夹与 zip，附带「是不是插件」 |
| GET | `/inspect?path=` | 单个文件夹/zip 的插件信息 |
| POST | `/install` `{path}` | 开始安装，返回 `jobId` |
| GET | `/job?id=` | 任务状态、步骤、pnpm 日志、结果 |
| POST | `/cancel` `{id}` | 取消正在进行的安装 |
| GET | `/installed` | profile 里的 `link:` 依赖及其启用状态 |

所有接口只接受同源请求：先问 host 自己的 `connection.requestRejection()`（就是 /api 用的那道闸，含浏览器登录 cookie），再自己校一遍 `Host`（回环或 `--trusted-host` 声明过的地址）、`sec-fetch-site: cross-site`（直接拒）和 `Origin`（存在时必须与 `Host` 同主机名）。

`/info` 会附带作者信息，前端照此渲染作者卡片，例如：

```json
{
  "author": {
    "name": "LiXiao1949",
    "github": "https://github.com/LiXiao1949",
    "repo": "https://github.com/LiXiao1949/dsh-local-installer",
    "qq": "1640444672"
  }
}
```

## 安装它自己

它就是这么装的，也正是本插件安装任何东西的产物形态：源目录 → `<profile>/local-plugins/<name>@<version>`，profile 的 `package.json` 里记一条 `link:` 依赖，`node_modules/<name>` 只是指向它的一根符号链接。

```bash
# 1. 取回源码
git clone https://github.com/LiXiao1949/dsh-local-installer.git
cd dsh-local-installer

# 2. 固化到 profile 的 local-plugins
cd ~/.dsh/profiles/web
cp -a /path/to/dsh-local-installer "local-plugins/local-dsh-local-install@1.0.0"   # 换版本就换目录名
ln -sfn "../../local-plugins/local-dsh-local-install@1.0.0" node_modules/@local/dsh-local-install
# package.json 的 dependencies 里加：
#   "@local/dsh-local-install": "link:<profile>/local-plugins/local-dsh-local-install@1.0.0"
# dsh.profile.bundles 里也要有 "@local/dsh-local-install"
```

**为什么必须是 `link:` 依赖，而不是往 `node_modules` 里拷一份**：`pnpm` 安装时会清理「不在 lockfile 里」的包——手拷进 `node_modules` 的插件，会在下一次任何 pnpm 安装（插件市场的安装、本插件的安装都算）之后消失，包括它自己。实测：`node_modules/@local/handplaced` 在一次 `pnpm add` 之后就被删掉了。写成 `link:` 依赖后它和普通依赖一样被 pnpm 保留。同理，卸载时删掉 `local-plugins` 里的目录和 `package.json` 里那两条记录即可，别只删 `node_modules` 里的链接。

host 半新增的路由在**进程启动时**才会加载（浏览器半是热更新的），所以装好或改动 `lib/*.js` 后需要重启一次 DSH；只改 `lib/client.js` 则刷新页面即可。
之后侧边栏（与插件市场并排）和「设置」里都会出现「本地安装」。

## 自测

```bash
node scripts/smoke-client.cjs   # 或 npm test
```

在 Node 里用假的 `window.__ModuleLoader__` / `react` / `document` 跑一遍：`apply()` 是否正常返回 disposer、三个 slot 是否按预期注册（`main` 键、`sidebar.panellist` id、`settings.section` id），以及「空状态」和「有目录/有安装任务」两种数据下页面能不能渲染出内容（含作者卡片 LiXiao1949 · GitHub · QQ 1640444672）。

## 排错

**`ERR_PNPM_UNEXPECTED_STORE`（Unexpected store location）**：profile 的 `node_modules` 是用某个指定的 store 装的（本机是 `/opt/dshbox-cache/pnpm-store/v11`），而 pnpm 默认会去 `~/.local/share/pnpm/store` 找，于是拒绝写入。`.npmrc` 里的 `store-dir` 在 pnpm 12 已经不被读取，要写进 `pnpm-workspace.yaml`：

```yaml
storeDir: /opt/dshbox-cache/pnpm-store
```

写完之后 `pnpm store path` 和安装都会指向同一个 store。这个毛病会让**所有** pnpm 安装失败（插件市场也一样），不只是本插件。

**安装流程走通了长什么样**（实测一个 380 B 的探针 zip）：解压 3 个文件 → `local-plugins/<name>@<version>` → `inspect` 通过 → pnpm 7 秒写完（`downloaded 0`，本地包不联网）→ 页面显示「已安装并启用」，profile 里多出 `"<name>": "link:.../local-plugins/<name>@<version>"` 与 `node_modules/<name>` 符号链接。

## 已知边界

- 只认 `dsh.bundle.patch` 声明过的包：没有这一项的包不是可加载的 DSH 插件，会明确报错而不是硬装；
- zip 只支持 stored / deflate 两种压缩方式（所有常见打包工具都在这两种内），不处理加密条目；
- 文件夹来源会整份复制，超过 200 MB 或 2 万个文件会拒绝并提示改打 zip；
- 插件若自身还有未打包的 npm 依赖，pnpm 会照常去 registry 取——那不是本页发起的网络请求，但确实需要网络。

## 联系作者

- **作者**：LiXiao1949
- **GitHub**：<https://github.com/LiXiao1949>
- **项目仓库**：<https://github.com/LiXiao1949/dsh-local-installer>
- **QQ**：**1640444672**
- **问题反馈**：[开 Issue](https://github.com/LiXiao1949/dsh-local-installer/issues) 或直接 QQ 找我

## 许可证

MIT © LiXiao1949
