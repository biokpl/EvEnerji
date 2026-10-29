// ECharts sarmalayıcı: tema renkleri CSS değişkenlerinden okunur
const instances = new Set();

export function colors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    text: v('--text'), muted: v('--muted'), faint: v('--faint'), line: v('--line'), card: v('--card-solid'),
    hi: v('--card-hi'), accent: v('--accent'), accent2: v('--accent2'), ev: v('--ev'), home: v('--home'),
    good: v('--good'), mid: v('--mid'), bad: v('--bad'),
  };
}

export function mount(el, option) {
  if (!el || typeof echarts === 'undefined') return null;
  const ch = echarts.init(el, null, { renderer: 'canvas' });
  const c = colors();
  ch.setOption({
    textStyle: { fontFamily: 'Manrope, system-ui, sans-serif', color: c.text },
    animationDuration: 800, animationEasing: 'cubicOut',
    tooltip: {
      backgroundColor: c.card, borderColor: c.line, borderWidth: 1, padding: [8, 12], confine: true,
      textStyle: { color: c.text, fontSize: 12 }, extraCssText: 'border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);',
    },
    ...option,
  });
  instances.add(ch);
  return ch;
}

export function disposeAll() {
  instances.forEach((ch) => ch.dispose());
  instances.clear();
}

let rt;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => instances.forEach((ch) => ch.resize()), 120);
});

export function axisStyle(c) {
  return {
    axisLine: { lineStyle: { color: c.line } },
    axisTick: { show: false },
    axisLabel: { color: c.muted, fontSize: 11, fontWeight: 600 },
    splitLine: { lineStyle: { color: c.line } },
  };
}

// İki serili (Togg + ev) yığılı çubuk: 2 px boşluk, üstte 4 px yuvarlak uç
export function stackedBars(c, cats, ev, home, { evName = 'Togg', homeName = 'Ev (diğer)', tip } = {}) {
  const ax = axisStyle(c);
  return {
    grid: { left: 38, right: 6, top: 14, bottom: 24 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: c.hi } }, formatter: tip },
    xAxis: { type: 'category', data: cats, ...ax, axisLabel: { ...ax.axisLabel, hideOverlap: true } },
    yAxis: { type: 'value', ...ax, axisLine: { show: false }, splitNumber: 4 },
    series: [
      { name: homeName, type: 'bar', stack: 's', data: home, barMaxWidth: 22,
        itemStyle: { color: c.home, borderColor: c.card, borderWidth: 1 } },
      { name: evName, type: 'bar', stack: 's', data: ev, barMaxWidth: 22,
        itemStyle: { color: c.ev, borderRadius: [4, 4, 0, 0], borderColor: c.card, borderWidth: 1 } },
    ],
  };
}
