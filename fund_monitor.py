#!/usr/bin/env python3
"""
fund_monitor.py - 基金监控命令行小工具

功能：
1. 多渠道持仓管理（支付宝 / 招商银行）
2. 实时抓取天天基金估值接口（fundgz.1234567.com.cn）
3. 稳健型止盈止损策略：
     - 累计收益率 ≥ 15% 后，从历史最高净值回落 ≥ 3% → 移动止盈触发
     - 未达 15% 时，从历史最高净值回撤 ≥ 2.5%   → 建议止损
     - 其他 → 正常持有

数据存储：~/.fund_monitor.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

# ============ 数据模型 ============

Channel = Literal["alipay", "cmb"]


@dataclass
class Position:
    code: str            # 6 位基金代码
    name: str            # 基金名称
    shares: float        # 持有份额
    cost_price: float    # 成本净值（每份）
    channel: Channel     # 渠道：alipay / cmb
    peak_nav: float = 0.0  # 历史最高净值（策略用，0 表示未设置）


@dataclass
class Quote:
    code: str
    name: str
    dwjz: float    # 昨日收盘净值
    gsz: float     # 今日估算净值
    gszzl: float   # 估算涨幅 %
    gztime: str    # 估值时间


@dataclass
class Strategy:
    target_profit_rate: float = 0.15       # 目标收益率 15%
    take_profit_drawdown: float = 0.03     # 达目标后，从峰值回落 3% 触发止盈
    stop_loss_drawdown: float = 0.025      # 未达目标时，从峰值回撤 2.5% 触发止损


DEFAULT_STRATEGY = Strategy()


@dataclass
class CalcResult:
    today_profit: float
    market_value: float
    total_profit: float
    total_profit_rate: float
    peak_nav_used: float
    drawdown_from_peak: float
    hit_target: bool
    status: Literal["正常持有", "建议止损", "移动止盈触发"]


# ============ 收益 + 策略计算（与 src/utils/finance.ts 同源）============

def calculate(position: Position, quote: Quote,
              strategy: Strategy = DEFAULT_STRATEGY) -> CalcResult:
    today_profit = position.shares * (quote.gsz - quote.dwjz)
    market_value = position.shares * quote.gsz
    cost_basis = position.shares * position.cost_price
    total_profit = market_value - cost_basis
    total_profit_rate = (total_profit / cost_basis) if cost_basis > 0 else 0.0

    peak = (position.peak_nav if position.peak_nav > 0
            else max(position.cost_price, quote.gsz))
    drawdown = (peak - quote.gsz) / peak if peak > 0 else 0.0
    peak_rate = ((peak - position.cost_price) / position.cost_price
                 if position.cost_price > 0 else 0.0)
    hit_target = peak_rate >= strategy.target_profit_rate

    if hit_target:
        status = "移动止盈触发" if drawdown >= strategy.take_profit_drawdown else "正常持有"
    else:
        status = "建议止损" if drawdown >= strategy.stop_loss_drawdown else "正常持有"

    return CalcResult(
        today_profit=today_profit,
        market_value=market_value,
        total_profit=total_profit,
        total_profit_rate=total_profit_rate,
        peak_nav_used=peak,
        drawdown_from_peak=drawdown,
        hit_target=hit_target,
        status=status,
    )


# ============ 网络抓取（天天基金估值接口）============

QUOTE_URL = "http://fundgz.1234567.com.cn/js/{code}.js"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def fetch_quote(code: str, timeout: float = 5.0) -> Optional[Quote]:
    """从天天基金抓取实时估值。失败返回 None。"""
    code = code.strip()
    if not re.fullmatch(r"\d{6}", code):
        return None
    url = QUOTE_URL.format(code=code)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Referer": "https://fund.eastmoney.com/"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, OSError):
        return None
    # 格式：jsonpgz({...});
    m = re.search(r"jsonpgz\((.+?)\);?\s*$", raw, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
        return Quote(
            code=str(data["fundcode"]),
            name=str(data["name"]),
            dwjz=float(data["dwjz"]),
            gsz=float(data["gsz"]),
            gszzl=float(data.get("gszzl", 0) or 0),
            gztime=str(data.get("gztime", "")),
        )
    except (KeyError, ValueError, TypeError):
        return None


# ============ 存储（~/.fund_monitor.json）============

STORE_PATH = Path.home() / ".fund_monitor.json"


def load_store() -> dict:
    if not STORE_PATH.exists():
        return {"positions": []}
    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        data.setdefault("positions", [])
        return data
    except (json.JSONDecodeError, OSError):
        return {"positions": []}


def save_store(data: dict) -> None:
    try:
        STORE_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError as e:
        print(f"{C.RED}保存失败：{e}{C.END}", file=sys.stderr)


def load_positions(data: dict) -> list[Position]:
    result = []
    for p in data.get("positions", []):
        try:
            result.append(Position(
                code=str(p["code"]),
                name=str(p["name"]),
                shares=float(p["shares"]),
                cost_price=float(p["cost_price"]),
                channel=p["channel"],
                peak_nav=float(p.get("peak_nav", 0) or 0),
            ))
        except (KeyError, ValueError, TypeError):
            continue
    return result


def save_positions(data: dict, positions: list[Position]) -> None:
    data["positions"] = [asdict(p) for p in positions]
    save_store(data)


# ============ 终端颜色 / 格式化 ============

class C:
    RED = "\033[91m"     # 盈利（中国市场红涨）
    GREEN = "\033[92m"   # 亏损
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
    GRAY = "\033[90m"
    BOLD = "\033[1m"
    END = "\033[0m"


def color_for(v: float) -> str:
    if v > 1e-9:
        return C.RED
    if v < -1e-9:
        return C.GREEN
    return C.GRAY


def fmt_money(v: float) -> str:
    return f"{v:,.2f}"


def fmt_pct(v: float) -> str:
    """小数 → 百分比，如 0.15 → '+15.00%'"""
    return f"{'+' if v > 0 else ''}{v * 100:.2f}%"


def fmt_signed_money(v: float) -> str:
    """带正负号 + 货币，如 +20.00 / -10.00"""
    sign = "+" if v > 0 else ("-" if v < 0 else "")
    return f"{sign}¥{fmt_money(abs(v))}"


# 用于表格内列宽修正：中文按 2 个显示宽度计
def _disp_width(s: str) -> int:
    w = 0
    for ch in s:
        w += 2 if ord(ch) > 0x2E80 else 1
    return w


def _pad(s: str, target: int, align: str = "left") -> str:
    pad = max(0, target - _disp_width(s))
    if align == "right":
        return " " * pad + s
    return s + " " * pad


# ============ CLI 命令 ============

def cmd_add(args):
    data = load_store()
    positions = load_positions(data)
    for p in positions:
        if p.code == args.code and p.channel == args.channel:
            print(f"{C.YELLOW}⚠ 已存在相同持仓：{args.code} [{args.channel}]{C.END}")
            return
    q = fetch_quote(args.code)
    name = args.name or (q.name if q else "未知基金")
    # 用成本价作为初始峰值起点：真实"买入以来最高净值"程序无法知道，
    # 后续 refresh 会自动把 peak_nav 推高，或用户用 set-peak 手动校准
    initial_peak = args.cost
    pos = Position(
        code=args.code, name=name, shares=args.shares,
        cost_price=args.cost, channel=args.channel,
        peak_nav=initial_peak,
    )
    positions.append(pos)
    save_positions(data, positions)
    print(f"{C.GREEN}✓ 添加成功{C.END}  {name} ({args.code}) [{args.channel}]")
    print(f"  份额 {pos.shares}   成本净值 {pos.cost_price:.4f}   初始峰值 {pos.peak_nav:.4f}")


def cmd_list(args):
    data = load_store()
    positions = load_positions(data)
    if not positions:
        print(f"{C.GRAY}(暂无持仓，使用 add 添加){C.END}")
        return
    by_channel = {"alipay": [], "cmb": []}
    for p in positions:
        by_channel[p.channel].append(p)
    for ch in ("alipay", "cmb"):
        items = by_channel[ch]
        if not items:
            continue
        label = "🅰️ 支付宝" if ch == "alipay" else "🏦 招商银行"
        print(f"\n{C.BOLD}{label}{C.END}  ({len(items)} 只)")
        for i, p in enumerate(items, 1):
            print(f"  {i}. {p.name} ({p.code})  "
                  f"份额 {p.shares}   成本 {p.cost_price:.4f}   峰值 {p.peak_nav:.4f}")


def cmd_remove(args):
    data = load_store()
    positions = load_positions(data)
    before = len(positions)
    positions = [p for p in positions
                 if not (p.code == args.code and p.channel == args.channel)]
    if len(positions) == before:
        print(f"{C.YELLOW}⚠ 未找到 {args.code} [{args.channel}]{C.END}")
        return
    save_positions(data, positions)
    print(f"{C.GREEN}✓ 已删除 {args.code} [{args.channel}]{C.END}")


def cmd_refresh(args):
    data = load_store()
    positions = load_positions(data)
    if not positions:
        print(f"{C.GRAY}(暂无持仓){C.END}")
        return

    # 抓取（同 code 只抓一次）
    quotes: dict[str, Optional[Quote]] = {}
    for p in positions:
        if p.code not in quotes:
            quotes[p.code] = fetch_quote(p.code)

    # 自动维护 peak_nav：每次刷新把峰值推高
    updated = False
    for p in positions:
        q = quotes.get(p.code)
        if q and q.gsz > p.peak_nav:
            p.peak_nav = q.gsz
            updated = True
    if updated:
        save_positions(data, positions)

    status_color = {
        "正常持有": C.GRAY,
        "建议止损": C.YELLOW,
        "移动止盈触发": C.RED + C.BOLD,
    }

    print(f"\n{C.BOLD}📊 基金实时监控{C.END}  "
          f"{C.GRAY}{datetime.now().strftime('%Y-%m-%d %H:%M')}{C.END}")
    print("─" * 108)
    header = (
        f"{_pad('基金', 22)}{'渠道':<6}"
        f"{_pad('市值', 12, 'right')}"
        f"{_pad('今日收益', 12, 'right')}"
        f"{_pad('累计收益', 12, 'right')}"
        f"{_pad('累计收益率', 11, 'right')}   状态"
    )
    print(header)
    print("─" * 108)

    total_mv = total_today = total_cum = 0.0
    by_ch = {"alipay": {"mv": 0.0, "today": 0.0},
             "cmb": {"mv": 0.0, "today": 0.0}}

    for ch in ("alipay", "cmb"):
        items = [p for p in positions if p.channel == ch]
        ch_label = "支付宝" if ch == "alipay" else "招行"
        for p in items:
            q = quotes.get(p.code)
            if not q:
                print(f"{_pad(p.name[:11], 22)}{ch_label:<6}"
                      f"{C.GRAY}{_pad('抓取失败', 12, 'right')}{C.END}")
                continue
            r = calculate(p, q)
            name_col = f"{p.name[:11]}({p.code})"
            line = (
                f"{_pad(name_col, 22)}{ch_label:<6}"
                f"{C.BOLD}{_pad(fmt_money(r.market_value), 12, 'right')}{C.END} "
                f"{color_for(r.today_profit)}"
                f"{_pad(fmt_signed_money(r.today_profit), 12, 'right')}{C.END} "
                f"{color_for(r.total_profit)}"
                f"{_pad(fmt_signed_money(r.total_profit), 12, 'right')}{C.END} "
                f"{color_for(r.total_profit_rate)}"
                f"{_pad(fmt_pct(r.total_profit_rate), 11, 'right')}{C.END} "
                f"{status_color[r.status]}{r.status}{C.END}"
            )
            print(line)
            total_mv += r.market_value
            total_today += r.today_profit
            total_cum += r.total_profit
            by_ch[ch]["mv"] += r.market_value
            by_ch[ch]["today"] += r.today_profit

    print("─" * 108)
    print(f"{C.BOLD}合计{C.END}  市值 ¥{fmt_money(total_mv)}   "
          f"今日 {color_for(total_today)}{fmt_signed_money(total_today)}{C.END}   "
          f"累计 {color_for(total_cum)}{fmt_signed_money(total_cum)}{C.END}")

    if total_mv > 0:
        print()
        for ch in ("alipay", "cmb"):
            mv = by_ch[ch]["mv"]
            if mv == 0:
                continue
            ratio = mv / total_mv * 100
            label = "支付宝" if ch == "alipay" else "招行"
            today = by_ch[ch]["today"]
            print(f"  {label}  ¥{fmt_money(mv)}   "
                  f"占比 {ratio:.1f}%   "
                  f"今日 {color_for(today)}{fmt_signed_money(today)}{C.END}")


def cmd_status(args):
    data = load_store()
    positions = load_positions(data)
    matched = [p for p in positions
               if p.code == args.code and p.channel == args.channel]
    if not matched:
        print(f"{C.YELLOW}⚠ 未找到 {args.code} [{args.channel}]{C.END}")
        return
    p = matched[0]
    q = fetch_quote(p.code)
    if not q:
        print(f"{C.RED}✗ 抓取 {p.code} 实时数据失败{C.END}")
        return
    r = calculate(p, q)
    sc = {"正常持有": C.GRAY,
          "建议止损": C.YELLOW,
          "移动止盈触发": C.RED + C.BOLD}[r.status]
    print(f"\n{C.BOLD}{p.name}{C.END} ({p.code})")
    print(f"  渠道       {'支付宝' if p.channel == 'alipay' else '招商银行'}")
    print(f"  ───────────────────────────")
    print(f"  持有份额   {p.shares}")
    print(f"  成本净值   {p.cost_price:.4f}")
    print(f"  昨日净值   {q.dwjz:.4f}")
    print(f"  实时估值   {q.gsz:.4f}   ({fmt_pct(q.gszzl / 100)})   {C.GRAY}{q.gztime}{C.END}")
    print(f"  历史峰值   {r.peak_nav_used:.4f}")
    print(f"  ───────────────────────────")
    print(f"  当前市值   ¥{fmt_money(r.market_value)}")
    print(f"  今日收益   {color_for(r.today_profit)}{fmt_signed_money(r.today_profit)}{C.END}")
    print(f"  累计收益   {color_for(r.total_profit)}{fmt_signed_money(r.total_profit)}"
          f"   ({fmt_pct(r.total_profit_rate)}){C.END}")
    print(f"  峰值回撤   {r.drawdown_from_peak * 100:.2f}%")
    print(f"  是否达目标 {'是 ✓' if r.hit_target else '否'}")
    print(f"  ───────────────────────────")
    print(f"  策略建议   {sc}{r.status}{C.END}")


def cmd_set_peak(args):
    data = load_store()
    positions = load_positions(data)
    for p in positions:
        if p.code == args.code and p.channel == args.channel:
            p.peak_nav = args.value
            save_positions(data, positions)
            print(f"{C.GREEN}✓ {p.code} peak_nav 已设为 {args.value}{C.END}")
            return
    print(f"{C.YELLOW}⚠ 未找到 {args.code} [{args.channel}]{C.END}")


# ============ 内置单元测试 ============

def test_basic_profit():
    p = Position(code="000171", name="X", shares=1000, cost_price=1.0,
                 channel="alipay", peak_nav=1.2)
    q = Quote(code="000171", name="X", dwjz=1.1, gsz=1.12, gszzl=1.8, gztime="")
    r = calculate(p, q)
    assert abs(r.today_profit - 20.0) < 1e-6, f"today_profit={r.today_profit}"
    assert abs(r.market_value - 1120.0) < 1e-6, f"market_value={r.market_value}"


def test_default_peak():
    p = Position(code="X", name="X", shares=1000, cost_price=1.0,
                 channel="alipay", peak_nav=0)
    q = Quote(code="X", name="X", dwjz=1.1, gsz=1.12, gszzl=0, gztime="")
    r = calculate(p, q)
    assert abs(r.peak_nav_used - 1.12) < 1e-9
    assert abs(r.drawdown_from_peak) < 1e-9


def test_status_normal():
    p = Position(code="X", name="X", shares=1000, cost_price=1.0,
                 channel="alipay", peak_nav=1.12)
    q = Quote(code="X", name="X", dwjz=1.1, gsz=1.12, gszzl=0, gztime="")
    r = calculate(p, q)
    assert r.hit_target is False
    assert r.status == "正常持有"


def test_stop_loss():
    # peak 1.05 (peakRate 5% < 15%), gsz 1.02 → 回撤 2.857% ≥ 2.5%
    p = Position(code="X", name="X", shares=1000, cost_price=1.0,
                 channel="alipay", peak_nav=1.05)
    q = Quote(code="X", name="X", dwjz=1.05, gsz=1.02, gszzl=0, gztime="")
    r = calculate(p, q)
    assert r.hit_target is False
    assert r.drawdown_from_peak >= 0.025
    assert r.status == "建议止损"


def test_take_profit():
    # peak 1.20 (peakRate 20% ≥ 15%), gsz 1.16 → 回撤 3.33% ≥ 3%
    p = Position(code="X", name="X", shares=1000, cost_price=1.0,
                 channel="alipay", peak_nav=1.20)
    q = Quote(code="X", name="X", dwjz=1.20, gsz=1.16, gszzl=0, gztime="")
    r = calculate(p, q)
    assert r.hit_target is True
    assert r.drawdown_from_peak >= 0.03
    assert r.status == "移动止盈触发"


def test_hit_target_no_drawdown():
    p = Position(code="X", name="X", shares=1000, cost_price=1.0,
                 channel="alipay", peak_nav=1.20)
    q = Quote(code="X", name="X", dwjz=1.18, gsz=1.20, gszzl=0, gztime="")
    r = calculate(p, q)
    assert r.hit_target is True
    assert r.drawdown_from_peak < 0.03
    assert r.status == "正常持有"


def test_custom_strategy():
    s = Strategy(target_profit_rate=0.10,
                 take_profit_drawdown=0.015,
                 stop_loss_drawdown=0.02)
    # peak 1.20 (20% ≥ 10%), gsz 1.176 → 回撤 2%，>= 1.5% → 触发
    p = Position(code="X", name="X", shares=1000, cost_price=1.0,
                 channel="alipay", peak_nav=1.20)
    q = Quote(code="X", name="X", dwjz=1.20, gsz=1.176, gszzl=0, gztime="")
    r = calculate(p, q, s)
    assert r.hit_target is True
    assert r.status == "移动止盈触发"


def test_edge_zero_shares():
    p = Position(code="X", name="X", shares=0, cost_price=1.0,
                 channel="alipay", peak_nav=1.1)
    q = Quote(code="X", name="X", dwjz=1.0, gsz=1.1, gszzl=0, gztime="")
    r = calculate(p, q)
    assert r.market_value == 0
    assert r.today_profit == 0
    assert r.status == "正常持有"


def test_edge_zero_cost():
    p = Position(code="X", name="X", shares=1000, cost_price=0,
                 channel="alipay", peak_nav=1.2)
    q = Quote(code="X", name="X", dwjz=1.1, gsz=1.2, gszzl=0, gztime="")
    r = calculate(p, q)
    assert r.total_profit_rate == 0
    assert r.hit_target is False


TESTS = [
    test_basic_profit,
    test_default_peak,
    test_status_normal,
    test_stop_loss,
    test_take_profit,
    test_hit_target_no_drawdown,
    test_custom_strategy,
    test_edge_zero_shares,
    test_edge_zero_cost,
]


def cmd_test(args):
    print(f"{C.BOLD}🧪 运行内置单元测试{C.END}\n")
    passed = failed = 0
    for t in TESTS:
        try:
            t()
            print(f"  {C.GREEN}✓ {t.__name__}{C.END}")
            passed += 1
        except AssertionError as e:
            print(f"  {C.RED}✗ {t.__name__}: {e}{C.END}")
            failed += 1
    print(f"\n{C.BOLD}结果：{C.GREEN}{passed} passed{C.END}, "
          f"{C.RED if failed else C.GREEN}{failed} failed{C.END}")
    sys.exit(0 if failed == 0 else 1)


# ============ 入口 ============

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fund_monitor",
        description="基金监控 - 多渠道持仓 + 实时估值 + 稳健型止盈止损",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_add = sub.add_parser("add", help="添加持仓")
    p_add.add_argument("--code", required=True, help="6 位基金代码")
    p_add.add_argument("--shares", type=float, required=True, help="持有份额")
    p_add.add_argument("--cost", type=float, required=True, help="成本净值")
    p_add.add_argument("--channel", choices=["alipay", "cmb"], required=True)
    p_add.add_argument("--name", default=None, help="基金名称（可选，不填自动抓取）")
    p_add.set_defaults(func=cmd_add)

    p_list = sub.add_parser("list", help="列出所有持仓")
    p_list.set_defaults(func=cmd_list)

    p_rm = sub.add_parser("remove", help="删除持仓")
    p_rm.add_argument("--code", required=True)
    p_rm.add_argument("--channel", choices=["alipay", "cmb"], required=True)
    p_rm.set_defaults(func=cmd_remove)

    p_rf = sub.add_parser("refresh", help="抓取实时估值 + 策略诊断")
    p_rf.set_defaults(func=cmd_refresh)

    p_st = sub.add_parser("status", help="单只基金详情")
    p_st.add_argument("--code", required=True)
    p_st.add_argument("--channel", choices=["alipay", "cmb"], required=True)
    p_st.set_defaults(func=cmd_status)

    p_pk = sub.add_parser("set-peak", help="手动设置历史最高净值（用于策略）")
    p_pk.add_argument("--code", required=True)
    p_pk.add_argument("--channel", choices=["alipay", "cmb"], required=True)
    p_pk.add_argument("--value", type=float, required=True)
    p_pk.set_defaults(func=cmd_set_peak)

    p_t = sub.add_parser("test", help="运行内置单元测试")
    p_t.set_defaults(func=cmd_test)

    return parser


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
