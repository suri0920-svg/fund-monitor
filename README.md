# Fund Monitor

个人基金持仓监控小工具,提供两套独立的使用方式:

- 🌐 **网页版**(Next.js + TypeScript):可视化大盘 + AI 截图识别导入
- 🐍 **命令行版**(`fund_monitor.py`):轻量终端工具,实时抓估值 + 策略诊断

## 功能速览

### 网页版
- **📈 估值大盘 Tab**:总资产卡 / SVG 趋势线 / 渠道分组(支付宝·招行)/ 10 列持仓明细表
- **📸 截图导入 Tab**:拖拽上传持仓截图 → AI 自动识别基金名称/代码/份额/成本 → 名称反查校验代码 → 可编辑校正表单 → 一键导入
- **每日快照**:自动记录每日总资产到 `localStorage`(最多 90 天),生成趋势线
- **多渠道独立记账**:支付宝、招商银行分开统计

### 命令行版
- 多渠道持仓管理(支付宝/招行)
- 实时抓取天天基金估值接口(`fundgz.1234567.com.cn`)
- **稳健型止盈止损策略**:
  - 累计收益率 ≥ 15% 后,从最高净值回落 ≥ 3% → 移动止盈触发
  - 未达目标时,从最高净值回撤 ≥ 2.5% → 建议止损
- 历史最高净值自动维护,支持手动校准
- 内置 9 个单元测试,无第三方依赖

---

## 网页版使用

### 环境要求
Node.js 18+ 与 npm。

### 配置 AI 凭证(用于截图识别)
项目根目录创建 `.env.local`:

```bash
# 方式一:官方 Anthropic API
ANTHROPIC_API_KEY=sk-ant-xxx

# 方式二:走代理(如 z.ai 等)
ANTHROPIC_BASE_URL=https://your-proxy.com
ANTHROPIC_AUTH_TOKEN=your-token
```

不配也能跑,只是「截图导入」Tab 的 AI 解析会返回 500。

### 启动
```bash
npm install      # 首次安装依赖
npm run dev      # 开发模式,访问 http://localhost:3000
npm run build    # 生产构建
npm run start    # 生产模式启动
```

### 数据存储
持仓与每日快照存在浏览器 `localStorage`,**不跨设备、不上传服务器**。清浏览器数据会丢失。

---

## 命令行版使用

### 环境要求
Python 3.8+,只用标准库,**无需 pip install**。

### 命令一览

```bash
# 添加持仓(自动抓取基金名称)
python3 fund_monitor.py add --code 008087 --shares 1000 --cost 1.5 --channel alipay

# 列出所有持仓(按渠道分组)
python3 fund_monitor.py list

# 抓取实时估值 + 策略诊断(主命令)
python3 fund_monitor.py refresh

# 单只基金详情
python3 fund_monitor.py status --code 008087 --channel alipay

# 手动校准历史最高净值(策略判断用)
python3 fund_monitor.py set-peak --code 008087 --channel alipay --value 3.5

# 删除持仓
python3 fund_monitor.py remove --code 008087 --channel alipay

# 运行内置单元测试
python3 fund_monitor.py test
```

`--channel` 取值:`alipay`(支付宝)或 `cmb`(招商银行)。同 code 不同 channel 视为两条独立持仓。

### 数据存储
持仓数据持久化在 `~/.fund_monitor.json`,直接编辑也行。

---

## 项目结构

```
fund-monitor/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── parse-fund/    # AI 截图解析(Claude Vision)
│   │   │   ├── fund-search/   # 名称→代码反查(天天基金)
│   │   │   └── fund-quote/    # 实时净值
│   │   ├── page.tsx           # 双 Tab 主页
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ValuationDashboard.tsx   # Tab 1:估值大盘
│   │   └── ScreenshotImport.tsx     # Tab 2:截图导入
│   ├── lib/
│   │   ├── types.ts           # 共享类型 + 派生计算
│   │   └── mock-data.ts       # 演示数据
│   └── utils/
│       ├── finance.ts         # 稳健型策略算法
│       └── finance.test.ts    # 单元测试(npx tsx --test 运行)
├── fund_monitor.py            # Python CLI 工具(独立,零依赖)
├── package.json
└── README.md
```

---

## 策略算法

两版工具共用同一套**稳健型止盈止损策略**:

| 状态 | 触发条件 |
|------|---------|
| 🛑 移动止盈触发 | 累计收益率曾 ≥ 15%,**且**从历史最高净值回落 ≥ 3% |
| ⚠️ 建议止损 | 未达 15% 目标,**且**从历史最高净值回撤 ≥ 2.5% |
| ✅ 正常持有 | 其余情况 |

`peak_nav`(历史最高净值)是策略核心。
- CLI 版:每次 `refresh` 自动把 `peak_nav` 推高;首次添加持仓时用成本价作起点
- 用户可用 `set-peak` 手动校准真实历史峰值(程序无法知道买入以来的真实最高值)

---

## 数据源

- **基金估值**:天天基金 `fundgz.1234567.com.cn`(免费、免 key、盘中实时)
- **基金搜索**:天天基金 `fundsuggest.eastmoney.com`
- **AI 解析**:Anthropic Claude Sonnet 4(走 `ANTHROPIC_*` 环境变量)

> 所有数据源都是公开免费接口,无需注册。估值接口在非交易时段可能返回最近一个交易日的数据。
