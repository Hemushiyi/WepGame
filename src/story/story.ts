// ===== 剧情模式：多章节 RPG 底部对话框（刮刮乐复用 scratch.ts）=====
// 纯 DOM 渲染，无需 canvas 或独立技能树。

import { showScratchOverlay } from './scratch';

interface Chapter {
  dialogues: string[];
  endLabel: string;
  endAction: () => void;
}

export class StoryMode {
  private el: HTMLElement;
  private goDart: () => void;
  private showToast: (msg: string) => void;
  private onEarn: (n: number) => void;
  private onUnlock?: () => void;

  private chapter = 0;
  private dialogueIdx = 0;

  private chapters: Chapter[] = [
    {
      // 第0章：吐槽飞镖 → 飞镖场
      dialogues: [
        '这地方到处挂着飞镖靶……',
        '难道就没别的娱乐项目了？',
        '怪物横行、危机四伏，\n结果大家的解决方案是——扔飞镖？',
        '算了，入乡随俗吧。\n先去飞镖场练练手，看看这飞镖能干啥。',
      ],
      endLabel: '前往飞镖场 🎯',
      endAction: () => this.goDart(),
    },
    {
      // 第1章：发现彩票 → 刮刮乐
      dialogues: [
        '嘿！这是什么？',
        '一张彩票掉在地上了……',
        '刮刮乐！手气好的话\n能赚一大笔金币。',
        '刮开看看？',
      ],
      endLabel: '刮开彩票 🎰',
      endAction: () => showScratchOverlay(this.onEarn, () => this.goDart()),
    },
    {
      // 第2章：10张彩票后触发 → 介绍彩票技能树
      dialogues: [
        '你已经刮了不少彩票了……',
        '效率太低了，对吧？',
        '拿着这个——\n彩票技能手册！',
        '学了它，刮彩票更快更赚。\n还有机器人帮你自动刮！',
      ],
      endLabel: '打开技能树 📖',
      endAction: () => {
        this.onUnlock?.();
        this.showToast('去技能树看看彩票分支吧！🤖');
        this.goDart();
      },
    },
    {
      // 第3章：天使线（终极彩票中天使）
      dialogues: [
        '这是…天使的光芒？',
        '从没见过这种彩票……',
        '也许这就是隐藏要素！',
        '恭喜！使命完成！',
      ],
      endLabel: '返回飞镖场 ✨',
      endAction: () => {
        this.onAchievement?.();
        this.showToast('🏆 最终成就达成！');
        this.goDart();
      },
    },
    {
      // 第4章：恶魔线（终极彩票中恶魔）
      dialogues: [
        '这是…恶魔的气息？',
        '以前从没见过这种彩票……',
        '也许是隐藏要素？',
        '恶魔的诅咒降临了！',
        '飞镖盘被诅咒环绕……',
        '但这也许不是终点。',
      ],
      endLabel: '面对诅咒 👹',
      endAction: () => {
        this.showToast('👹 无尽诅咒循环…');
        this.goDart();
      },
    },
    {
      // 第5章：购买终极大奖后触发
      dialogues: [
        '这是什么……',
        '天使与恶魔，同时出现在一张票上？',
        '我有预感，这是最后的秘密了。',
        '从飞镖到彩票，从诅咒到救赎……',
        '也许这一切，都是像素世界的命运。',
        '感谢你，冒险者。',
      ],
      endLabel: '继续旅程 ✨',
      endAction: () => {
        this.showToast('🌌 前方还有更多冒险…');
        this.goDart();
      },
    },
  ];

  private onAchievement?: () => void;

  constructor(
    el: HTMLElement,
    goDart: () => void,
    showToast: (msg: string) => void,
    onEarn: (n: number) => void,
    onUnlock?: () => void,
    onAchievement?: () => void,
  ) {
    this.el = el;
    this.goDart = goDart;
    this.showToast = showToast;
    this.onEarn = onEarn;
    this.onUnlock = onUnlock;
    this.onAchievement = onAchievement;
  }

  /** 从指定章节开始播放 */
  startChapter(n: number): void {
    this.chapter = Math.min(n, this.chapters.length - 1);
    this.dialogueIdx = 0;
  }

  enter(): void {
    this.render();
  }

  leave(): void {
    // 移除可能残留的刮刮乐 overlay
    document.getElementById('scratchOverlay')?.remove();
  }

  // ---- 对话渲染 ----
  private render(): void {
    const ch = this.chapters[this.chapter];
    if (!ch) return;

    if (this.dialogueIdx < ch.dialogues.length) {
      this.el.innerHTML = `
        <div class="story-dialog" id="storyDialog">
          <div class="story-dialog-text">${ch.dialogues[this.dialogueIdx]}</div>
          <div class="story-dialog-hint">▼</div>
        </div>
      `;
      this.el.querySelector('#storyDialog')!.addEventListener('click', () => {
        this.dialogueIdx++;
        this.render();
      });
    } else {
      this.el.innerHTML = `
        <div class="story-dialog">
          <div class="story-dialog-text">那就试试吧！</div>
          <button class="story-btn" id="storyEndBtn">${ch.endLabel}</button>
        </div>
      `;
      this.el.querySelector('#storyEndBtn')!.addEventListener('click', () => {
        ch.endAction();
      });
    }
  }
}
