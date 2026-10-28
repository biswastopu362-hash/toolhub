'use client'

/* ================================================================== */
/* ToolHub Games — achievement catalog (D69)                           */
/*                                                                     */
/* Every game unlocks achievements by id through the shared scores     */
/* store. This catalog drives the Game Center badge wall.              */
/* ================================================================== */

export interface AchievementDef {
  id: string
  name: string
  desc: string
  emoji: string
  /** gameId group this belongs to (for grouping in the UI) */
  game: string
}

export const ACHIEVEMENTS: AchievementDef[] = [
  /* Sudoku */
  { id: 'sudoku-first-solve', name: 'First Grid', desc: 'Solve your first sudoku', emoji: '🧩', game: 'sudoku' },
  { id: 'sudoku-easy-solve', name: 'Warm-up', desc: 'Solve an Easy puzzle', emoji: '🟢', game: 'sudoku' },
  { id: 'sudoku-medium-solve', name: 'Getting Serious', desc: 'Solve a Medium puzzle', emoji: '🟡', game: 'sudoku' },
  { id: 'sudoku-hard-solve', name: 'Logic Master', desc: 'Solve a Hard puzzle', emoji: '🔴', game: 'sudoku' },
  { id: 'sudoku-hard-sub10', name: 'Speed Demon', desc: 'Hard puzzle under 10:00', emoji: '⚡', game: 'sudoku' },
  /* Minesweeper */
  { id: 'mines-first-win', name: 'Sapper', desc: 'Win your first Minesweeper game', emoji: '💣', game: 'minesweeper' },
  { id: 'mines-easy-win', name: 'Easy Sweep', desc: 'Clear the Easy field', emoji: '🟢', game: 'minesweeper' },
  { id: 'mines-medium-win', name: 'Field Officer', desc: 'Clear the Medium field', emoji: '🟡', game: 'minesweeper' },
  { id: 'mines-hard-win', name: 'Mine Whisperer', desc: 'Clear the Hard field', emoji: '🔴', game: 'minesweeper' },
  { id: 'mines-no-flag-win', name: 'Raw Memory', desc: 'Win without flagging a single mine', emoji: '🧠', game: 'minesweeper' },
  { id: 'mines-hard-sub5', name: 'Blitz Sweep', desc: 'Hard field under 5:00', emoji: '⚡', game: 'minesweeper' },
  { id: 'mines-first-loss', name: 'Boom.', desc: 'Lose your first game (it happens)', emoji: '💥', game: 'minesweeper' },
  /* Snake */
  { id: 'snake-first-meal', name: 'First Bite', desc: 'Eat your first apple', emoji: '🍎', game: 'snake' },
  { id: 'snake-100', name: 'Century Snake', desc: 'Score 100 points', emoji: '💯', game: 'snake' },
  { id: 'snake-250', name: 'Python Length', desc: 'Score 250 points', emoji: '🐍', game: 'snake' },
  { id: 'snake-500', name: 'Anaconda', desc: 'Score 500 points', emoji: '👑', game: 'snake' },
  /* Memory Match */
  { id: 'memory-first-finish', name: 'Sharp Mind', desc: 'Finish any Memory board', emoji: '🃏', game: 'memory' },
  { id: 'memory-large-finish', name: 'Big Board', desc: 'Clear the 6×6 board', emoji: '🏋️', game: 'memory' },
  { id: 'memory-perfect', name: 'Photographic', desc: 'Clear a board with zero misses', emoji: '📸', game: 'memory' },
  { id: 'memory-duo-win', name: 'House Champion', desc: 'Win a 2-player match', emoji: '🏆', game: 'memory' },
  { id: 'memory-duo-draw', name: 'Evenly Matched', desc: 'Tie a 2-player match', emoji: '🤝', game: 'memory' },
  /* Bangla Wordle */
  { id: 'wordle-first-win', name: 'শব্দ শিকারি', desc: 'Guess your first Bengali word', emoji: '🟩', game: 'wordle' },
  { id: 'wordle-under4', name: 'Word Wizard', desc: 'Win in 3 tries or fewer', emoji: '🔮', game: 'wordle' },
  { id: 'wordle-lucky', name: 'First Try!', desc: 'Win on the very first guess', emoji: '🍀', game: 'wordle' },
  { id: 'wordle-streak5', name: 'On Fire', desc: 'Win 5 games in a row', emoji: '🔥', game: 'wordle' },
  /* 2P Arcade */
  { id: 'ttt-first-win', name: 'Three in a Row', desc: 'Win a Tic-Tac-Toe round', emoji: '❌', game: 'arcade' },
  { id: 'ttt-beat-cpu', name: 'Machine Stumper', desc: 'Beat the unbeatable CPU (or draw… no — beat it!)', emoji: '🤖', game: 'arcade' },
  { id: 'c4-first-win', name: 'Connect Four', desc: 'Win a Connect-4 round', emoji: '🔴', game: 'arcade' },
  /* Solitaire */
  { id: 'solitaire-first-win', name: 'Patience Pays', desc: 'Win your first Klondike deal', emoji: '♠️', game: 'solitaire' },
  { id: 'solitaire-sub5', name: 'Fast Hands', desc: 'Win in under 5 minutes', emoji: '⏱️', game: 'solitaire' },
  { id: 'solitaire-noundo', name: 'No Regrets', desc: 'Win without a single undo', emoji: '🚫', game: 'solitaire' },
  /* Trivia */
  { id: 'trivia-first-quiz', name: 'Quiz Rookie', desc: 'Finish your first quiz', emoji: '🎓', game: 'trivia' },
  { id: 'trivia-perfect', name: 'Perfect Run', desc: 'Answer all 10 questions correctly', emoji: '🌟', game: 'trivia' },
  { id: 'trivia-streak5', name: 'Streaker', desc: 'Hit a 5-answer streak', emoji: '🔥', game: 'trivia' },
  { id: 'trivia-1500', name: 'High Scorer', desc: 'Score 1500+ in one quiz', emoji: '📈', game: 'trivia' },
  /* 2048 */
  { id: 'g2048-512', name: 'Halfway There', desc: 'Merge a 512 tile', emoji: '512️⃣', game: '2048' },
  { id: 'g2048-win', name: '2048!', desc: 'Create the 2048 tile', emoji: '🏅', game: '2048' },
]

export const ACHIEVEMENTS_BY_GAME: Record<string, AchievementDef[]> = ACHIEVEMENTS.reduce(
  (acc, a) => {
    ;(acc[a.game] ??= []).push(a)
    return acc
  },
  {} as Record<string, AchievementDef[]>
)
