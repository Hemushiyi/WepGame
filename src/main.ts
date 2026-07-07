import './style.css';
import { GameState } from './state';
import { buildApp } from './ui';

const state = new GameState();
const game = buildApp(state);
game.start();

// 暴露到 window 方便调试
(window as unknown as { __game: unknown; __state: unknown }).__game = game;
(window as unknown as { __game: unknown; __state: unknown }).__state = state;
