# Life Gauge 🛡️⚔️🏆

**Life Gauge** is an Obsidian plugin that transforms your productivity into an RPG experience. Track your life stats, level up through tasks, and master custom skills with a dynamic difficulty and penalty system.

## 🌟 Key Features

- **AI Companion (Mascot)**: [NEW] An interactive companion (like Paimon) that tracks your status and reacts to your progress.
- **Dynamic Personality**: The AI's behavior shifts based on your actual stats (e.g., confident if STR is high, silly if INT is low).
- **RPG-like Stats**: Track core attributes like Strength, Knowledge, Vitality, and more.
- **Custom Skills**: Award XP to specific skills (e.g., `#English`, `#Java`) using hashtags in your tasks.
- **Dynamic Titles**: Rise from a "Kẻ Lạc Lõng" to a legendary hero as you accumulate total XP.
- **Smart Task Parsing**: Automatically detects rewards, dates, times, and skills from your standard Markdown checklists.
- **Punishing Penalty System**: Earn less XP for overdue tasks. If you're late enough, points are even deducted!
- **Daily XP Tracking**: Monitor your progress with beautiful bar charts in the new Stats tab.
- **Shop System**: Spend your earned coins on custom rewards or status-restoring items.
- **Highly Configurable**: Customize every mascot name, stat, skill, and title directly in the settings.

## 🤖 AI Mascot Integration

Enable the **AI Companion** in settings to replace the traditional title system with a living mascot.

- **Interaction**: Click/Tap the mascot's avatar anytime to get a status check.
- **Triggers**: The mascot will automatically comment after you complete tasks or based on a configurable time interval.
- **Stat Awareness**: The mascot knows your current STR, INT, VIT, and DEX levels and will change its tone and personality accordingly.
- **Multi-Provider**: Choose between Google Gemini (Pro), OpenAI (GPT), or OpenRouter.

## 📝 Syntax Guide

To make your tasks count toward your progress, follow this syntax:

`- [ ] Read a book (+15 Knowledge) @{2026-03-21} @@{22:00} #reading`

- **Rewards**: `(+XP StatName)` (e.g., `+10 stamina`)
- **Deadline Date**: `@{YYYY-MM-DD}` (Mandatory)
- **Deadline Time**: `@@{HH:MM}` (Optional)
- **Skills**: `#skill-name` (e.g., `#react`, `#fitness`)

## 💀 Penalty Formula

`Final XP = Original Reward - (Minutes Late * Original Reward / 100) * PenaltyPoint`

- **Satiety (Hunger)**: Your mascot gets hungry over time! Low satiety leads to XP penalties and grumpy mascot reactions.

## 🚀 Getting Started

1.  Create a Markdown file for your tasks.
2.  Set the path to this file in **Life Gauge Settings**.
3.  (Optional) Enable **AI Companion** and add your API key.
4.  Open the **Life Gauge Dashboard** from the ribbon icon (gamepad 🎮).
5.  Start writing quests and watch your character grow!

---
*Transform your life, one quest at a time.* 🛡️⚔️🏆
