# Life Gauge 🛡️⚔️🏆

**Life Gauge** is an Obsidian plugin that transforms your productivity into an RPG experience. Track your life stats, level up through tasks, and master custom skills with a dynamic difficulty and penalty system.

## 🌟 Key Features

- **RPG-like Stats**: Track core attributes like Knowledge, Stamina, and more.
- **Custom Skills**: Award XP to specific skills (e.g., `#English`, `#Java`) using hashtags in your tasks.
- **Dynamic Titles**: Rise from a "Kẻ Lạc Lõng" to a legendary hero as you accumulate total XP.
- **Smart Task Parsing**: Automatically detects rewards, dates, times, and skills from your standard Markdown checklists.
- **Punishing Penalty System**: Earn less XP for overdue tasks. If you're late enough, points are even deducted from your stats!
- **Beautiful Dashboard**: A dedicated view to monitor your progress, current rank, and upcoming quests.
- **Highly Configurable**: Customize every stat, skill, and title directly in the settings.

## 📝 Syntax Guide

To make your tasks count toward your progress, follow this syntax in your designated task file:

### Basic Quest
`- [ ] Read a book (+15 Knowledge) @{2026-03-21} @@{22:00}`

- **Rewards**: `(+XP StatName)` (e.g., `+10 stamina`)
- **Deadline Date**: `@{YYYY-MM-DD}` (Mandatory)
- **Deadline Time**: `@@{HH:MM}` (Optional, defaults to end of day)
- **Skills**: `#skill-name` (e.g., `#react`, `#cooking`)

### Example Multi-XP Task
`- [ ] Gym Session (+20 Stamina, +5 Willpower) @{2026-03-21} @@{18:00} #fitness`

## 💀 Penalty Formula

Don't let your tasks expire! Life Gauge enforces a strict penalty for late completion:

`Final XP = Original Reward - (Minutes Late * Original Reward / 100) * PenaltyPoint`

- **Penalty Point**: A multiplier set in settings (default is 1).
- **Negative XP**: If you are extremely late, you will **lose points** upon checking the task.
- **No Deadline**: Tasks without a date or time will be ignored by the dashboard.

## ⚙️ Settings

The plugin settings tab is organized into collapsible sections for easy management:

1.  **General**: Configure your avatar path and task file location.
2.  **Penalty Configuration**: Adjust the `Penalty Point` multiplier to change the game's difficulty.
3.  **Stats Configuration**: Add, edit, or delete the attributes you want to track.
4.  **Skills Configuration**: Manage your specific life skills and their XP growth.
5.  **Titles Configuration**: Define your own ranking system with custom XP thresholds and descriptions.

## 🚀 Getting Started

1.  Create a Markdown file for your tasks (e.g., `Daily/Quests.md`).
2.  Set the path to this file in the **Life Gauge Settings**.
3.  Open the **Life Gauge Dashboard** from the ribbon icon (gamepad 🎮).
4.  Start writing quests and watch your character grow!

---
*Transform your life, one quest at a time.* 🛡️⚔️🏆
