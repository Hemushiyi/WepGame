// ===== 独立刮刮乐弹窗（老虎机式三图标匹配）=====
// 纯函数，不依赖 StoryMode。剧情和飞镖两边都可以调用。

export function showScratchOverlay(
  onEarn: (n: number) => void,
  onClose?: () => void,
  opts?: { luck?: number; valueMul?: number; tier?: number; angel?: boolean; demon?: boolean; autoClose?: boolean },
): void {
  document.getElementById('scratchOverlay')?.remove();

  const isAngel = opts?.angel;
  const isDemon = opts?.demon;
  const tier = opts?.tier ?? 0;
  // 铜3/银4/金5/钻石6/天使1 slot，全相同=中奖
  const slotCount = (isAngel || isDemon) ? 1 : tier === 0 ? 3 : tier === 1 ? 4 : tier === 2 ? 5 : 6;
  const basePrize = isAngel ? 10000 : isDemon ? 0 : tier === 0 ? 500 : tier === 1 ? 1500 : tier === 2 ? 5000 : 15000;
  const baseWin = isAngel ? 0.25 : isDemon ? 0.75 : tier === 0 ? 0.12 : tier === 1 ? 0.08 : tier === 2 ? 0.05 : 0.03;
  const luck = opts?.luck ?? 0;
  const valueMul = 1 + (opts?.valueMul ?? 0);

  const ANGEL_ICONS = ['👼', '👹'];
  const ALL_ICONS = ['🎯','💎','🍀','⭐','🔥','🎰','🪙','💫'];
  const tierIcons = (isAngel || isDemon) ? ANGEL_ICONS : ALL_ICONS;
  const rand = () => Math.floor(Math.random() * tierIcons.length);

  const win = Math.random() < baseWin + luck * 0.4;
  let slots: number[];
  if (win) {
    const idx = rand();
    slots = Array(slotCount).fill(idx);
  } else {
    do { slots = Array.from({ length: slotCount }, () => rand()); }
    while (new Set(slots).size === 1);
  }
  const allSame = new Set(slots).size === 1;
  const twoMatch = !allSame && slotCount > 1 && new Set(slots).size < slotCount;
  const prize = Math.round((allSame ? basePrize : twoMatch ? Math.round(basePrize * 0.1) : 0) * valueMul);

  const slotHtml = Array.from({ length: slotCount }, (_, i) =>
    `<span class="slot" id="slot${i}">?</span>`).join('');
  const overlay = document.createElement('div');
  overlay.id = 'scratchOverlay';
  overlay.className = 'scratch-overlay';
  overlay.innerHTML = `
    <div class="scratch-card" style="max-width:${Math.min(320, 180 + slotCount * 48)}px">
      <div class="scratch-title">${isAngel ? '👼 天使' : isDemon ? '👹 恶魔' : tier === 0 ? '🟤 铜票' : tier === 1 ? '⚪ 银票' : tier === 2 ? '🟡 金票' : '💎 钻石票'}</div>
      <div class="slot-row">
        ${slotHtml}
      </div>
      <button class="scratch-btn" id="scratchSpin">开 奖 🎰</button>
      <div class="scratch-msg" id="scratchMsg"></div>
      <button class="scratch-close" id="scratchClose">关闭 ✕</button>
    </div>
  `;
  overlay.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.appendChild(overlay);

  const spinBtn = overlay.querySelector('#scratchSpin')! as HTMLButtonElement;
  const msgEl = overlay.querySelector('#scratchMsg')!;
  let cancelled = false;

  spinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    spinBtn.disabled = true;
    spinBtn.textContent = '转动中…';

    const stops = Array.from({ length: slotCount }, (_, i) => 600 + i * 500);
    const started = performance.now();
    const finalSlots = [...slots];
    const revealed = Array(slotCount).fill(false);

    const interval = setInterval(() => {
      if (cancelled) { clearInterval(interval); return; }
      const elapsed = performance.now() - started;
      for (let i = 0; i < slotCount; i++) {
        if (revealed[i]) continue;
        const el = document.getElementById('slot' + i)!;
        if (elapsed >= stops[i]) {
          el.textContent = tierIcons[finalSlots[i]];
          el.classList.add('stopped');
          revealed[i] = true;
        } else {
          if (Math.floor(elapsed / 80) % 2 === 0) {
            el.textContent = tierIcons[rand()];
          }
        }
      }
      if (revealed.every(Boolean)) {
        clearInterval(interval);
        if (allSame) {
          msgEl.textContent = `🎉 全相同！+${prize} 🪙`;
          msgEl.className = 'scratch-msg win';
        } else if (twoMatch) {
          msgEl.textContent = `😯 部分相同，安慰奖 +${prize} 🪙`;
          msgEl.className = 'scratch-msg small';
        } else {
          msgEl.textContent = '😅 再接再厉！';
          msgEl.className = 'scratch-msg miss';
        }
        if (prize > 0) onEarn(prize);
        spinBtn.textContent = '已开奖';
        if (opts?.autoClose && (opts.angel || opts.demon)) {
          msgEl.textContent = opts.angel ? '👼 天使降临！' : '👹 恶魔觉醒！';
          msgEl.className = opts.angel ? 'scratch-msg win' : 'scratch-msg miss';
          setTimeout(() => {
            try {
              cancelled = true;
              clearInterval(interval);
              if (document.getElementById('scratchOverlay')) overlay.remove();
              onClose?.();
            } catch { /* ignore */ }
          }, 1500);
        }
      }
    }, 60);
  });

  const closeHandler = (e: Event) => {
    e.stopPropagation();
    cancelled = true;
    overlay.remove();
    onClose?.();
  };
  overlay.querySelector('#scratchClose')!.addEventListener('click', closeHandler);
}

// ===== 机器人快速结算（不弹窗，直接 earn）=====
export function robotSettle(opts?: { luck?: number; valueMul?: number; jackpot?: number; tier?: number }): number {
  const tier = opts?.tier ?? 0;
  const basePrize = tier === 0 ? 500 : tier === 1 ? 1500 : 5000;
  const baseWin = tier === 0 ? 0.12 : tier === 1 ? 0.08 : 0.04;
  const luck = opts?.luck ?? 0;
  const valueMul = 1 + (opts?.valueMul ?? 0);
  const jackpot = opts?.jackpot ?? 0;

  if (Math.random() < 0.01 + jackpot * 0.5) {
    return Math.round((basePrize * 5) * valueMul);
  }
  const r = Math.random();
  if (r < baseWin + luck * 0.4) return Math.round(basePrize * valueMul);
  if (r < 0.30 + luck * 0.3) return Math.round((basePrize * 0.08 + Math.random() * basePrize * 0.12) * valueMul);
  return Math.round((basePrize * 0.02 + Math.random() * basePrize * 0.06) * valueMul);
}
