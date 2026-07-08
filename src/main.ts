import './style.css';
import { GameState } from './shared/state';
import { buildApp } from './ui';

const state = new GameState();
const game = buildApp(state);
// 飞镖循环不在此启动：app 默认停在「关卡选择」主页，进入飞镖关卡时才 start()。

// 暴露到 window 方便调试
(window as unknown as { __game: unknown; __state: unknown }).__game = game;
(window as unknown as { __game: unknown; __state: unknown }).__state = state;
