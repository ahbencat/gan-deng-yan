# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

干瞪眼（look_at_it）：局域网多人纯浏览器扑克，中文 UI，登录制（**注册关闭**，账号由脚本写入），对局状态落库、刷新/重启可恢复。玩法规则、素材规格（`docs/ASSETS.md`）、通用部署说明在 `README.md`（面向 GitHub，不含本机运维细节）；本文件补内部口径；最初需求原文在 `look_look.txt`。

## 常用命令

```bash
npm run dev:server   # 验证主形态：tsx watch 服务端（3002 托管 dist/，server/ 改动自动重启）
npm test             # vitest 157 用例（规则 + 状态机 + 快照隐私 + 1000 局 fuzz + 全自动 fuzz + 记牌 + 2/3 级大脑）
npx vitest run src/game/__tests__/rules.test.ts   # 单个测试文件；-t "名称" 按用例名过滤
npm run typecheck    # vue-tsc -b
npm run build        # vue-tsc && vite build
npm start            # 无 watch 单进程形态（PORT 环境变量改端口）
npm run user -- add <用户名> <密码> [昵称]   # 唯一建号入口（无注册接口）；passwd 改密
```

**改了 `src/` 后看效果**：3002 托管的是 `dist/`（express.static）——改前端必须 `npm run build` 再刷新 http://localhost:3002；改 `server/` 由 tsx watch 自动重启。**Vite 5174（`npm run dev`/`dev:all`）热更流程后续不再使用。** e2e 同样读 dist，跑前必须 build（且需 3002 空闲）。

## 测试（temp/ 下 e2e，gitignore）

- 自管理服务模式：脚本自己 spawn tsx 服务 → cleanDb → 断言 → 整组杀进程；**运行前 3002 必须空闲**——runner 只在 browser 段结束后 kill 端口，**开头不清残留**：残留的 dev:server 会让 browser 段的 `npm start` 绑不上端口、健康检查探到旧进程的内存态（症状：登录直接落进残留房间、莫名超时）
- `e2e_layout` 等依赖 fresh DB（脚本内不 clean，由 runner 先清）——手动单跑前先执行 runner 同款 DELETE
- Playwright 不在本仓库：用本机另一项目的 playwright 安装（脚本头 createRequire 写死路径；本机路径见 `CLAUDE.local.md`）
- `temp/run_regressions.sh`：bots_browser / layout / browser / mobile 四项回归；专项脚本按前缀枚举 temp/ 即可（`e2e_*` 协议/流程、`verify_*` UI 冒烟、`ws_*` 集成），README 测试节只留公开可见的 vitest 清单

## 架构

- **栈**：Node 24 + Express 5 + ws + node:sqlite（WAL），tsx 直跑 TS，**零额外运行时依赖**（scrypt/HMAC 用 node:crypto）；Vue 3 + Vite + TS，单 `reactive()` store（无 router/pinia）
- **共享纯函数引擎 `src/game/`**：规则、状态机、计分前后端同一份；`src/types.ts` 是唯一类型源。**服务端是信任边界** —— 全部校验在 `server/ws/dispatch.ts`，客户端只做展示与本地选牌
- **WS 协议**：信封 `{v, type, seq, payload}` → dispatch 路由 → `pushRoomState`/`pushLobby` 广播；错误统一 `sendError`。前端 `store.ts` 单文件消费全部消息，`App.vue` 按 `store.phase`（login/boot/lobby/room/game）切视图
- **对局生命周期**（`server/gameSession.ts`）：`startGame` 记 `sessionStartedAt`/`sessionEndsAt`（本场预算，首局开局起算）→ 每局结束 `INTERMISSION_MS=8s` 洗牌动画自动续局 → `armSessionExpiry` 只在等待态计时、**到点不打断进行中的对局** → `finalizeSession` 幂等结算并广播 `session.final`；房主 `session.extend` 运行时加时（15/30/45/60 累加，同步 `room.sessionEndsAt` 与进行中 `game.state.endsAt`）。**局末结算弹窗房主可决定去留**：「再来一局」= `room.start`（抢占 8s 自动连开、不重置本场预算）；「解散房间」= `room.dissolve`（host-only + waiting-only：广播 `room.closed` → `rooms.dissolve` 删 `room_players` 行 + `closeRoom` 清定时器/锚点、电脑回池 → `pushLobby`）
- **计分**：`settleGame` 每局零和 delta（剩牌 × 累计倍率 × 关瞪瞪 2）→ `recordGameResult` 写 `game_players` + `users.score += delta`；本场总分是**读侧 SQL 聚合**（`[sessionStartedAt, now]` 区间内的 games），不落冗余表
- **持久化/恢复**：`games.state_json` 含 `STATE_VERSION=1`，重启恢复房间/对局/本场剩余，过期回合补一步自动动作（`applyAutoMove`，不级联），版本不符的对局作废不计分；旧档缺字段由 `normalizeSeenRanks` 补齐（含长度修复）；`rooms.session_ends_at` 存本场截止
- **电脑与托管**：固定 7 人 NPC 花名册（`server/npc.ts`：`npc_1`~`npc_7`，昵称「xx xx的 xx」，`is_bot=1` 不可登录，启动时幂等补齐）；`addBot(roomId, level)`（level 必填，dispatch 的 `sanitizeBotLevel` 是协议缺省 2 的唯一来源）只按花名册顺序取空闲者（`current_room_id` 空 + 交叉 `getByUser`），占满报错不造人；**难度 `level:1|2|3` 房主添加时选定、绑定座位（内存态；重启后无难度 → 花名册 `brainId`= smart 保持中级；真人托管/未知 id 仍 basic）**；`users.is_bot` 只增不删；`game.delegate` 为内存态（重启重置），托管中 ~700ms 服务器代打并拒绝手动出牌
- **电脑大脑（BotBrain）**：`src/game/brain.ts` 定义 `BotBrain {id, decide(ctx)}`，`ctx` 含公开信息 + 自己手牌（`hand/prev/log/multiplier/handCounts/seat/wildCount/seenRanks`）；三级大脑：`basic`(1级)/`smart`(2级 出牌策略+竞跑拦截)/`expert`(3级 +记牌 `seenRanks` 推算)，共享 `brains/strategy.ts`（领出候选/完胜/拦截竞跑闸）与 `brains/counting.ts`（未现牌估计，牌堆构成取自 `cards.buildDeck`）。**合法压牌枚举的唯一源是 `rules.enumerateBeats`**（含百搭补对/纯王炸弹，`pickBeatingPlay` 是其首项薄包装=最省压法）——改压牌语义只动 rules 层，smart/expert 与 basic 自动同步。`registerBrain`/`getBrain`（未知 id 回退 `basic`）。`applyAutoMove(state, now, brain = basicBrain)` 第 3 参可选，大脑输出**不受信**——仍经 `applyPlay`/`applyPass` 校验，非法决策兜底（跟牌过、领出最小合法牌）。服务端自动步唯一入口 `npc.brainForSeat(player)`：`botLevel → BRAIN_ID_BY_LEVEL → getBrain`，无难度才走花名册缓存路径。扩展：`src/game/brains/<id>.ts` → `brain.ts` 注册 → `npc.ts` 的 `BRAIN_ID_BY_LEVEL` 挂级别
- **管理页 /admin**：独立 `gdy_admin` 会话（2 小时），密码读 `.env` 的 `admin_password`（环境变量 `ADMIN_PASSWORD` 优先），与游戏账号/WS 完全隔离，独立限速

## 前端约定

- **断点两档** `≤640px`（手机）/ `≤500px`（矮屏横屏），`src/media.ts` 的 `useIsMobile`/`useIsShort` 与 CSS `@media` 镜像。**每档内尺寸恒定 = 零跳变纪律**：`e2e_layout`/`e2e_mobile` 断言关键元素宽高不许被状态变化（日志增长/徽标出现/倒计时）撑动——固定高度 + `overflow:hidden`，不许内容驱动布局
- 手牌重叠：桌面 `n≤8` 不重叠；移动端 `ResizeObserver` 实测自适应铺满（相邻可见边 ≥14px）。卡片尺寸走 `--card-w/--card-h` 变量，`Card.vue` 的 `small` 变体例外（写死 44×64 / 40×58，现仅 ResultDialog 用）
- **本场积分集中条**（TrickArea `.scores`）：从 `players[].sessionDelta` 派生，不散在各座位（PlayerSeat 无积分）；统一单行横滚（`safe center`：适配居中、超宽可滚不裁内容），各断点只改高度/字号不改机制
- **河牌（`.stage`）尺寸**：基线 `--card-w/h` 44×64，仅 `(min-width:641px) and (min-height:501px)` 升 58×84，≤640 降到 40×58——正向规则表达，不要写「基线大、再打补丁调回」的回补媒体查询
- **`GameView` 的 `TRICK_HALF_W/H`** 是环形布局自检对面板占位的预测常量，与 TrickArea 实际渲染尺寸（topbar+scores+stage+log+gaps）耦合——改 TrickArea 任何一块高度必须同步改它，否则环形座位会压面板（ringFits 自检用的是这组常量，不是实测 rect）
- **图片素材** `public/images/`：牌背/纹理用 CSS 多重背景（图片在上、原渐变垫底，404 自动回退）；`<img>` 一律挂 `@error` 隐藏兜底；徽标图标用 CSS mask（`.icon` + `--i` 指 svg 路径，颜色继承 `currentColor`，因 `<img>` 内的 currentColor 不继承页面）。占位素材由 `python3 temp/gen_placeholders.py` 生成，正式素材同名覆盖即可
- `color-scheme: light` + 牌面显式 `color: #111`：**不要改回 `light dark`** —— 系统暗色下 UA 默认文字变白，白底牌面会整副隐形（大王是图片所以可见，曾被误报为 CSS 丢失）

## 部署纪律（用户确认制）

- **修改验证用 dev 形式（3002）**：`npm run dev:server`（tsx watch）→ 浏览器直接 http://localhost:3002；前端 `src/` 改动先 `npm run build` 再刷新；e2e 回归自管理 3002（读 dist，跑前 build，且先停 dev:server 保持端口空闲）；**5174/Vite dev 流程不再使用**
- 其他正式部署动作 —— 配置常驻/自启动服务、迁移到其他机器、对外暴露等 —— 同样**必须先确认**
- 部署与运维细节（路径、端口、启停、同步命令等）一律不在本文件：**需要时先读取 `CLAUDE.local.md`**（gitignore，不入库）

## 硬约束

- git 管理仓库 → **不建 `.bak` 备份**；实验一律进 `temp/`（已 gitignore）
- 不新增运行时依赖；`STATE_VERSION` 保持 1；`server/gameSession.ts` 的 `applyTimeout` **字节级不动**
- `.env` 已 gitignore（`admin_password` 在内，勿打印外传）；`.secret` 跨重启维持登录，勿删
- 运维细节（路径、命令、测试账号等）不入本文件：需要时读取 `CLAUDE.local.md`（gitignore，不入库）
