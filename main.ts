import { Plugin, PluginSettingTab, App, Setting, normalizePath, TFile, Notice, Modal } from 'obsidian';
import { LifeGaugeSettings, DEFAULT_SETTINGS, Stat, DEFAULT_STATS, getCurrentTitle, calculateLevel, formatDate } from './src/data';
import { LifeGaugeView, VIEW_TYPE_LIFE_GAUGE } from './src/view';
import { parseTasks, getTaskKey, updateTaskInContent } from './src/parser';
import { AIService } from './src/ai';

export default class LifeGaugePlugin extends Plugin {
    settings!: LifeGaugeSettings;
    isInternalChange = false;
    isSyncing = false;
    pendingSync = false;
    lastKnownContent = "";

    async onload() {
        await this.loadSettings();
        this.updateHunger();
        await this.saveSettings();

        this.registerView(
            VIEW_TYPE_LIFE_GAUGE,
            (leaf) => new LifeGaugeView(leaf, this)
        );

        this.addRibbonIcon('gamepad', 'Open Life Gauge', () => {
            this.activateView();
        });

        this.addSettingTab(new LifeGaugeSettingTab(this.app, this));

        // Start daily/periodic timer
        this.registerInterval(
            window.setInterval(async () => {
                this.updateHunger();

                // AI Interval Trigger
                if (this.settings.ai.enabled) {
                    const now = Date.now();
                    const intervalMs = this.settings.ai.interval * 60 * 1000;
                    if (now - this.settings.lastAiTriggerTime >= intervalMs) {
                        await this.triggerAiAnalysis("It's been a while! How are things going?");
                    }
                }

                this.saveSettings();
            }, 60 * 1000) // Every minute
        );

        // Register event to refresh view when task file changes
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (this.isInternalChange) return;
                if (file instanceof TFile && file.path === this.settings.taskFilePath) {
                    await this.syncTasksFromFile(file);
                }
            })
        );
    }

    applyReward(task: any, penaltyInfo: { multiplier: number }) {
        const hungerMultiplier = this.getHungerMultiplier();
        const finalMultiplier = penaltyInfo.multiplier * hungerMultiplier;
        let totalXpAwarded = 0;

        task.rewards.forEach((reward: any) => {
            const stat = this.settings.stats.find(s => s.id === reward.statId);
            if (stat) {
                // Formula: random(1, 15) + (requiredXp - 100) / 10
                const { requiredXp } = calculateLevel(stat.currentXp, stat.baseXp, stat.xpIncrement);
                const baseXP = Math.floor(Math.random() * 15) + 1;
                const bonusXP = (requiredXp - 100) / 10;
                const finalReward = (baseXP + bonusXP) * finalMultiplier;

                stat.currentXp += finalReward;
                totalXpAwarded += finalReward;
                reward.earnedAmount = Math.round(finalReward * 10) / 10; // For notice
                if (stat.currentXp < 0) stat.currentXp = 0;
            }
        });

        task.skills.forEach((skillName: string) => {
            const skill = this.settings.skills.find(s => s.name.toLowerCase() === skillName || s.id.toLowerCase() === skillName);
            if (skill) {
                const { requiredXp } = calculateLevel(skill.currentXp, skill.baseXp, skill.xpIncrement);
                const baseXP = Math.floor(Math.random() * 15) + 1;
                const bonusXP = (requiredXp - 100) / 10;
                const finalReward = (baseXP + bonusXP) * finalMultiplier;

                skill.currentXp += finalReward;
                if (skill.currentXp < 0) skill.currentXp = 0;
            }
        });

        // Award Coins
        const coins = this.getCoinReward();
        this.settings.coins += coins;

        // Log XP
        task.rewards.forEach((r: any) => {
            if (r.earnedAmount) this.logXp(r.statId, r.earnedAmount);
        });

        return coins; // Return for notification
    }

    logXp(id: string, amount: number) {
        const dateStr = formatDate(new Date());
        if (!this.settings.dailyXpLogs[dateStr]) {
            this.settings.dailyXpLogs[dateStr] = {};
        }
        if (!this.settings.dailyXpLogs[dateStr][id]) {
            this.settings.dailyXpLogs[dateStr][id] = 0;
        }
        this.settings.dailyXpLogs[dateStr][id] += amount;
    }

    getHungerMultiplier(): number {
        if (this.settings.hunger >= this.settings.maxHunger) return 1.2; // 20% Bonus if full
        if (this.settings.hunger >= 70) return 1.0;
        if (this.settings.hunger >= 30) {
            // Scale from 1.0 at 70% to 0.3 at 30%? No, user said "càng thấp giảm càng nhiều"
            // Let's use hunger/100 but capped at 1.0
            return Math.max(0.1, this.settings.hunger / 100);
        }
        return 0.1; // Minimum rewards in red zone
    }

    getCoinReward(): number {
        const r = Math.random() * 100;
        if (r < 80) return Math.floor(Math.random() * 10) + 1; // 1-10 (80%)
        if (r < 90) return Math.floor(Math.random() * 10) + 11; // 11-20 (10%)
        if (r < 95) return Math.floor(Math.random() * 10) + 21; // 21-30 (5%)
        if (r < 98) return Math.floor(Math.random() * 10) + 31; // 31-40 (3%)
        return Math.floor(Math.random() * 10) + 41; // 41-50 (2%)
    }

    updateHunger() {
        const now = Date.now();
        const elapsedMinutes = (now - this.settings.lastHungerUpdate) / (1000 * 60);
        if (elapsedMinutes <= 0) return;

        // Base rate: 1 point per 30 mins per 100 max hunger
        // depletionRate = (maxHunger / 100) * (1 / 30) * penaltyPoint points per minute
        const depletionRate = (this.settings.maxHunger / 100) * (1 / 30) * this.settings.penaltyPoint;
        const hungerLost = elapsedMinutes * depletionRate;

        this.settings.hunger = Math.max(0, this.settings.hunger - hungerLost);
        this.settings.lastHungerUpdate = now;

        // Red zone penalty (below 30% of max hunger)
        const threshold = this.settings.maxHunger * 0.3;
        if (this.settings.hunger < threshold) {
            const intervalsElapsed = elapsedMinutes / 30; // Base time unit: 30 minutes

            // Adjusted Formula: xpLoss (per 30m) = penaltyPoint * (threshold - satiety) / 4
            const xpLoss = intervalsElapsed * this.settings.penaltyPoint * (threshold - this.settings.hunger) / 4;

            this.settings.stats.forEach(stat => {
                stat.currentXp = Math.max(0, stat.currentXp - xpLoss);
                this.logXp(stat.id, -xpLoss);
            });
            this.settings.skills.forEach(skill => {
                skill.currentXp = Math.max(0, skill.currentXp - xpLoss);
                this.logXp(skill.id, -xpLoss);
            });
        }
    }

    applyUnreward(task: any) {
        task.rewards.forEach((reward: any) => {
            const stat = this.settings.stats.find(s => s.id === reward.statId);
            if (stat) {
                stat.currentXp = Math.max(0, stat.currentXp - reward.amount);
                this.logXp(stat.id, -reward.amount);
            }
        });
        task.skills.forEach((skillName: string) => {
            const skill = this.settings.skills.find(s => s.name.toLowerCase() === skillName || s.id.toLowerCase() === skillName);
            if (skill) {
                const totalReward = task.rewards.reduce((sum: number, r: any) => sum + r.amount, 0) || 10;
                skill.currentXp = Math.max(0, skill.currentXp - totalReward);
                this.logXp(skill.id, -totalReward);
            }
        });
    }

    getRewardString(task: any, coins: number): string {
        const rewardsList = task.rewards.map((r: any) => {
            const stat = this.settings.stats.find(s => s.id === r.statId);
            const finalAmount = r.earnedAmount || 0;
            return `${finalAmount > 0 ? '+' : ''}${finalAmount} ${stat ? stat.name : r.statId}`;
        }).join(' ');

        return `${rewardsList} +💰 ${coins} coin`.trim();
    }

    showRewardNotice(task: any, penaltyInfo: { multiplier: number, isLate: boolean, minutesLate: number }) {
        const rewardsList = task.rewards.map((r: any) => {
            const stat = this.settings.stats.find(s => s.id === r.statId);
            const finalAmount = r.earnedAmount || 0;
            return `${finalAmount > 0 ? '+' : ''}${finalAmount} ${stat ? stat.name : r.statId}`;
        }).join(', ');

        let rewardMsg = rewardsList ? ` (${rewardsList})` : '';
        if (task.earnedCoins) {
            rewardMsg += ` +💰 ${task.earnedCoins} coin`;
        }

        if (penaltyInfo.isLate) {
            const reductionPercent = Math.round((1 - penaltyInfo.multiplier) * 100);
            const statusMsg = penaltyInfo.multiplier < 0 ? `${-Math.round(penaltyInfo.multiplier * 100)}% points deducted` : `${reductionPercent}% points reduced`;
            new Notice(`⚠️ Completed Late: ${task.text}${rewardMsg}\n${statusMsg} due to delay of ${penaltyInfo.minutesLate} minutes.`, 5000);
        } else {
            new Notice(`✅ Mission Accomplished: ${task.text}${rewardMsg}`);
        }
    }

    async syncTasksFromFile(file: TFile) {
        if (this.isSyncing) {
            this.pendingSync = true;
            return;
        }

        this.isSyncing = true;
        try {
            const content = await this.app.vault.read(file);
            if (content === this.lastKnownContent) return;

            const oldTasks = this.lastKnownContent ? parseTasks(this.lastKnownContent, this.settings.stats) : [];
            const newTasks = parseTasks(content, this.settings.stats);

            const now = new Date();
            let changed = false;
            let fileContentChanged = false;
            let currentContent = content;

            // 1. Scan for newly completed tasks (including those present at startup)
            // They are [x] but don't have (done) yet.
            const newlyCompleted = newTasks.filter(t => t.completed && !t.isProcessed);

            for (const task of newlyCompleted) {
                const key = getTaskKey(task);
                let rewardString = "";
                if (!this.settings.completedTasks.includes(key)) {
                    const penaltyInfo = this.getPenaltyInfo(task, now);
                    const oldTotalXp = this.settings.stats.reduce((acc, s) => acc + s.currentXp, 0);
                    const oldTitle = getCurrentTitle(oldTotalXp, this.settings.titles);

                    const coins = this.applyReward(task, penaltyInfo);
                    task.earnedCoins = coins; // Store for notice and file logging

                    this.settings.completedTasks.push(key);
                    this.showRewardNotice(task, penaltyInfo);
                    rewardString = this.getRewardString(task, coins);

                    const newTotalXp = this.settings.stats.reduce((acc, s) => acc + s.currentXp, 0);
                    const newTitle = getCurrentTitle(newTotalXp, this.settings.titles);
                    if (newTitle.name !== oldTitle.name) {
                        new Notice(`🎉 CONGRATULATIONS! 🎉\nYou have reached a new title: ${newTitle.name}!`, 5000);
                    }

                    changed = true;

                    // AI Trigger on completion
                    if (this.settings.ai.enabled) {
                        await this.triggerAiAnalysis(`I just completed a task: ${task.text}. I earned ${rewardString}.`);
                    }
                }

                // ALWAYS ensure (done) is added to the file
                currentContent = updateTaskInContent(currentContent, task.originalLine, true, true, rewardString);
                fileContentChanged = true;
            }

            // 2. Scan for un-checked tasks (only those that were [x] but NOT (done))
            // Tasks with (done) are ignored as per user request.
            const unprocessedOld = oldTasks.filter(t => t.completed && !t.isProcessed);
            for (const oldTask of unprocessedOld) {
                const stillChecked = newTasks.some(nt => nt.originalLine === oldTask.originalLine && nt.completed);
                if (!stillChecked) {
                    const key = getTaskKey(oldTask);
                    if (this.settings.completedTasks.includes(key)) {
                        this.applyUnreward(oldTask);
                        const idx = this.settings.completedTasks.indexOf(key);
                        if (idx > -1) this.settings.completedTasks.splice(idx, 1);
                        changed = true;
                    }
                }
            }

            if (fileContentChanged && currentContent !== content) {
                this.isInternalChange = true;
                await this.app.vault.modify(file, currentContent);
                this.lastKnownContent = currentContent;
                this.isInternalChange = false;
            } else {
                this.lastKnownContent = content;
            }

            if (changed) {
                await this.saveSettings();
            } else {
                this.refreshViews();
            }

            // Check for title unlock after potential changed
            if (changed) {
                const totalXp = this.settings.stats.reduce((acc, s) => acc + s.currentXp, 0);
                // We'll need to check if the title changed here as well if sync happens via file modify
            }
        } finally {
            this.isSyncing = false;
            if (this.pendingSync) {
                this.pendingSync = false;
                const file = this.app.vault.getAbstractFileByPath(this.settings.taskFilePath);
                if (file instanceof TFile) {
                    await this.syncTasksFromFile(file);
                }
            }
        }
    }

    getPenaltyInfo(task: any, now: Date): { multiplier: number, isLate: boolean, minutesLate: number } {
        if (!task.date && !task.time) return { multiplier: 1, isLate: false, minutesLate: 0 };

        let deadline: Date;
        if (task.date && task.time) {
            deadline = new Date(`${task.date}T${task.time}`);
        } else if (task.date) {
            deadline = new Date(`${task.date}T23:59:59`);
        } else {
            const today = now.toISOString().split('T')[0];
            deadline = new Date(`${today}T${task.time}`);
        }

        if (now <= deadline) return { multiplier: 1, isLate: false, minutesLate: 0 };

        const minutesLate = Math.floor((now.getTime() - deadline.getTime()) / (1000 * 60));
        // New Formula: Points - (Minutes Late * Points / 100) * penaltyPoint
        // multiplier = 1 - (minutesLate * penaltyPoint / 100)
        const multiplier = 1 - (minutesLate * this.settings.penaltyPoint / 100);

        return { multiplier, isLate: true, minutesLate };
    }

    private AI_BEHAVIORS = [
        "Review: Thorough analysis of my productivity.",
        "Compare: Compare me to yesterday or goals.",
        "Complain: Complain about me neglecting my duties or letting the food run out.",
        "Sadness: Feeling disappointed if I underperform.",
        "Encouragement: Inspire and motivate strongly.",
        "Crazy: Humorously teasing about my habits.",
        "Anxious: Shows anxiety if I have a lot of overdue tasks.",
        "Excited: Shout with excitement when I achieve new achievements.",
        "Philosophy: Deep reflections on discipline and life.",
        "Curious: Ask about what I'm working on."
    ];

    async triggerAiAnalysis(triggerPrompt: string) {
        if (!this.settings.ai.enabled || !this.settings.ai.apiKey) return;

        const totalXp = this.settings.stats.reduce((acc, s) => acc + s.currentXp, 0);
        const title = getCurrentTitle(totalXp, this.settings.titles);

        const behaviorIdx = Math.floor(Math.random() * this.AI_BEHAVIORS.length);
        const currentBehavior = this.AI_BEHAVIORS[behaviorIdx];

        // Format stats for context
        const statsInfo = this.settings.stats.map(s => {
            const { level, progress } = calculateLevel(s.currentXp, s.baseXp, s.xpIncrement);
            return `- ${s.name} (${s.id}): Level ${level} (${Math.floor(progress)}%)`;
        }).join('\n');

        const context = `
You are ${this.settings.ai.name}, a helpful and cheeky companion for the user in a life-gamification plugin.
Current Status:
- Satiety (Hunger): ${Math.floor(this.settings.hunger)}/${this.settings.maxHunger}
- Current Rank: ${title.name}
- Total Coins: ${this.settings.coins}
- Trigger Context: ${triggerPrompt}
- Primary Behavioral Trait for this response: ${currentBehavior}

Current Player Stats:
${statsInfo}

Personality Guidelines based on Stats:
1. If "Strength" (STR) is high (Level 5+), be confident, bold, and energetic.
2. If "Knowledge/Intelligence" (INT) is low (Level 1-2), be slightly confused, silly, or include a "goofy action" or a "dumb mistake" in your speech.
3. If "Vitality" (VIT) is high, be overly healthy and enthusiastic about physical well-being.
4. If "Dexterity" (DEX) is low, mention being clumsy or dropping something.
5. If Satiety is low, act hungry or weak regardless of other stats.

Rules:
1. Speak as ${this.settings.ai.name}. Be brief (max 2 sentences).
2. Based on the rules above, react to the user current status and the trigger context.
3. Blend the "Primary Behavioral Trait" with the "Personality Guidelines" above.
4. Output ONLY the speech of the character.
`;

        const response = await AIService.generateResponse(this.settings, context);
        this.settings.lastAiResponse = response;
        this.settings.lastAiTriggerTime = Date.now();
        this.saveSettings();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        // Initialize lastKnownContent
        const file = this.app.vault.getAbstractFileByPath(this.settings.taskFilePath);
        if (file instanceof TFile) {
            this.lastKnownContent = await this.app.vault.read(file);
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.refreshViews();
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf = workspace.getLeavesOfType(VIEW_TYPE_LIFE_GAUGE)[0];

        if (!leaf) {
            leaf = workspace.getRightLeaf(false)!;
            await leaf.setViewState({
                type: VIEW_TYPE_LIFE_GAUGE,
                active: true,
            });
        }

        workspace.revealLeaf(leaf);
    }

    refreshViews() {
        this.app.workspace.getLeavesOfType(VIEW_TYPE_LIFE_GAUGE).forEach((leaf) => {
            if (leaf.view instanceof LifeGaugeView) {
                leaf.view.update();
            }
        });
    }

    showAddRewardModal() {
        new AddRewardModal(this.app, this).open();
    }
}

class AddRewardModal extends Modal {
    plugin: LifeGaugePlugin;
    name: string = "New Reward";
    icon: string = "🎁";
    description: string = "";
    cost: number = 50;

    constructor(app: App, plugin: LifeGaugePlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Add Custom Reward" });

        new Setting(contentEl)
            .setName("Reward Name")
            .addText((text) =>
                text.setValue(this.name).onChange((value) => {
                    this.name = value;
                })
            );

        new Setting(contentEl)
            .setName("Icon")
            .addText((text) =>
                text.setValue(this.icon).onChange((value) => {
                    this.icon = value || "🎁";
                })
            );

        new Setting(contentEl)
            .setName("Description")
            .addText((text) =>
                text.setValue(this.description).onChange((value) => {
                    this.description = value;
                })
            );

        new Setting(contentEl)
            .setName("Cost (Coins)")
            .addText((text) =>
                text.setValue(this.cost.toString()).onChange((value) => {
                    const val = parseInt(value);
                    if (!isNaN(val)) this.cost = val;
                })
            );

        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText("Add to Shop")
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.customShopItems.push({
                        id: `item-${Date.now()}`,
                        name: this.name,
                        icon: this.icon,
                        description: this.description,
                        cost: this.cost,
                    });
                    await this.plugin.saveSettings();
                    this.close();
                })
        );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class LifeGaugeSettingTab extends PluginSettingTab {
    plugin: LifeGaugePlugin;

    constructor(app: App, plugin: LifeGaugePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Life Gauge Settings' });

        // --- AI Settings Section ---
        containerEl.createEl('h3', { text: '🤖 AI Companion (Mascot)' });

        new Setting(containerEl)
            .setName('Enable AI Companion')
            .setDesc('Turn on your AI companion. This will replace the Title system in the header.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.ai.enabled)
                .onChange(async (value) => {
                    this.plugin.settings.ai.enabled = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide other AI settings
                }));

        if (this.plugin.settings.ai.enabled) {
            new Setting(containerEl)
                .setName('Companion Name')
                .setDesc('How should your companion be called? (e.g. Paimon)')
                .addText(text => text
                    .setValue(this.plugin.settings.ai.name)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.name = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('AI Provider')
                .addDropdown(dropdown => dropdown
                    .addOption('openai', 'OpenAI')
                    .addOption('gemini', 'Google Gemini')
                    .addOption('openrouter', 'OpenRouter')
                    .setValue(this.plugin.settings.ai.provider)
                    .onChange(async (value: any) => {
                        this.plugin.settings.ai.provider = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('API Key')
                .addText(text => text
                    .setPlaceholder('Enter your API key')
                    .setValue(this.plugin.settings.ai.apiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.apiKey = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Model')
                .setDesc('e.g. gpt-3.5-turbo, gemini-pro, etc.')
                .addText(text => text
                    .setValue(this.plugin.settings.ai.model)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.model = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Trigger Interval (Minutes)')
                .setDesc('How often should the AI speak to you automatically?')
                .addSlider(slider => slider
                    .setLimits(5, 720, 5)
                    .setValue(this.plugin.settings.ai.interval)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.ai.interval = value;
                        await this.plugin.saveSettings();
                    }));
        }

        containerEl.createEl('h3', { text: '📁 Task Configuration' });

        new Setting(containerEl)
            .setName('Avatar Path')
            .setDesc('Path to your avatar image in the vault.')
            .addText(text => text
                .setValue(this.plugin.settings.avatarPath)
                .onChange(async (value) => {
                    this.plugin.settings.avatarPath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Task File Path')
            .setDesc('Path to the Markdown file containing your tasks.')
            .addText(text => text
                .setValue(this.plugin.settings.taskFilePath)
                .onChange(async (value) => {
                    this.plugin.settings.taskFilePath = value;
                    const file = this.app.vault.getAbstractFileByPath(value);
                    if (file instanceof TFile) {
                        this.plugin.lastKnownContent = await this.app.vault.read(file);
                    } else {
                        this.plugin.lastKnownContent = "";
                    }
                    await this.plugin.saveSettings();
                }));


        containerEl.createEl('h3', { text: '💀 Penalty Configuration' });
        new Setting(containerEl)
            .setName('Penalty Multiplier (Penalty Point)')
            .setDesc('Multiplier for all penalties. Higher values result in more XP lost for late tasks and hunger. \nFormula for late tasks: Points - (Min Late * Points / 100) * PenaltyPoint. \nFormula for hunger (per 30m): PenaltyPoint * (MaxSatiety * 0.3 - Satiety) / 4.')
            .addText(text => text
                .setPlaceholder('1')
                .setValue(this.plugin.settings.penaltyPoint.toString())
                .onChange(async (value) => {
                    const val = parseFloat(value);
                    if (!isNaN(val)) {
                        this.plugin.settings.penaltyPoint = val;
                        await this.plugin.saveSettings();
                    }
                }));

        const statsDetails = containerEl.createEl('details', { cls: 'lg-settings-details' });
        const statsSummary = statsDetails.createEl('summary');
        statsSummary.createEl('h3', { text: 'Stats Configuration', cls: 'lg-settings-summary-title' });

        this.plugin.settings.stats.forEach((stat, index) => {
            const statHeader = statsDetails.createEl('div', { cls: 'lg-setting-stat-header' });
            statHeader.style.display = 'flex';
            statHeader.style.justifyContent = 'space-between';
            statHeader.style.alignItems = 'center';

            const titleEl = statHeader.createEl('h4', { text: stat.name });
            titleEl.style.margin = '0';

            const deleteBtn = statHeader.createEl('button', { text: 'Delete', cls: 'mod-warning' });
            deleteBtn.addEventListener('click', async () => {
                this.plugin.settings.stats.splice(index, 1);
                await this.plugin.saveSettings();
                this.display();
            });

            new Setting(statsDetails)
                .setName('Stat Name')
                .addText(text => text
                    .setValue(stat.name)
                    .onChange(async (value) => {
                        this.plugin.settings.stats[index].name = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(statsDetails)
                .setName('Stat Icon')
                .addText(text => text
                    .setValue(stat.icon)
                    .onChange(async (value) => {
                        this.plugin.settings.stats[index].icon = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(statsDetails)
                .setName(`${stat.name} Color`)
                .setDesc(`Color for the ${stat.name} progress bar.`)
                .addColorPicker(color => color
                    .setValue(stat.color)
                    .onChange(async (value) => {
                        this.plugin.settings.stats[index].color = value;
                        await this.plugin.saveSettings();
                    }));

            statsDetails.createEl('hr');
        });

        new Setting(statsDetails)
            .setName('Add New Stat')
            .setDesc('Create a new attribute to track.')
            .addButton(btn => btn
                .setButtonText('Add Stat')
                .onClick(async () => {
                    this.plugin.settings.stats.push({
                        id: `stat-${Date.now()}`,
                        name: 'New Stat',
                        icon: '⭐',
                        currentXp: 0,
                        level: 1,
                        color: '#cccccc',
                        baseXp: 100,
                        xpIncrement: 50
                    });
                    await this.plugin.saveSettings();
                    this.display();
                }));

        const skillsDetails = containerEl.createEl('details', { cls: 'lg-settings-details' });
        const skillsSummary = skillsDetails.createEl('summary');
        skillsSummary.createEl('h3', { text: 'Skills Configuration', cls: 'lg-settings-summary-title' });

        this.plugin.settings.skills.forEach((skill, index) => {
            const skillHeader = skillsDetails.createEl('div', { cls: 'lg-setting-stat-header' });
            skillHeader.style.display = 'flex';
            skillHeader.style.justifyContent = 'space-between';
            skillHeader.style.alignItems = 'center';

            const titleEl = skillHeader.createEl('h4', { text: skill.name });
            titleEl.style.margin = '0';

            const deleteBtn = skillHeader.createEl('button', { text: 'Delete', cls: 'mod-warning' });
            deleteBtn.addEventListener('click', async () => {
                this.plugin.settings.skills.splice(index, 1);
                await this.plugin.saveSettings();
                this.display();
            });

            new Setting(skillsDetails)
                .setName('Skill Name')
                .addText(text => text
                    .setValue(skill.name)
                    .onChange(async (value) => {
                        this.plugin.settings.skills[index].name = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(skillsDetails)
                .setName('Skill Icon')
                .addText(text => text
                    .setValue(skill.icon)
                    .onChange(async (value) => {
                        this.plugin.settings.skills[index].icon = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(skillsDetails)
                .setName(`${skill.name} Color`)
                .addColorPicker(color => color
                    .setValue(skill.color)
                    .onChange(async (value) => {
                        this.plugin.settings.skills[index].color = value;
                        await this.plugin.saveSettings();
                    }));

            skillsDetails.createEl('hr');
        });

        new Setting(skillsDetails)
            .setName('Create New Skill')
            .setDesc('Skills track your real-world progress (e.g., English, Java).')
            .addButton(btn => btn
                .setButtonText('Add Skill')
                .onClick(async () => {
                    this.plugin.settings.skills.push({
                        id: `skill-${Date.now()}`,
                        name: 'New Skill',
                        icon: '🎯',
                        currentXp: 0,
                        level: 1,
                        color: '#8e44ad',
                        baseXp: 100,
                        xpIncrement: 50
                    });
                    await this.plugin.saveSettings();
                    this.display();
                }));

        const titlesDetails = containerEl.createEl('details', { cls: 'lg-settings-details' });
        const titlesSummary = titlesDetails.createEl('summary');
        titlesSummary.createEl('h3', { text: '🏆 Titles configuration', cls: 'lg-settings-summary-title' });

        this.plugin.settings.titles.forEach((title, index) => {
            const titleHeader = titlesDetails.createEl('div', { cls: 'lg-setting-stat-header' });
            titleHeader.style.display = 'flex';
            titleHeader.style.justifyContent = 'space-between';
            titleHeader.style.alignItems = 'center';

            const titleLabel = titleHeader.createEl('h4', { text: title.name });
            titleLabel.style.margin = '0';

            const deleteBtn = titleHeader.createEl('button', { text: 'Delete', cls: 'mod-warning' });
            deleteBtn.addEventListener('click', async () => {
                this.plugin.settings.titles.splice(index, 1);
                await this.plugin.saveSettings();
                this.display();
            });

            new Setting(titlesDetails)
                .setName('Title Name')
                .addText(text => text
                    .setValue(title.name)
                    .onChange(async (value) => {
                        this.plugin.settings.titles[index].name = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(titlesDetails)
                .setName('Icon')
                .addText(text => text
                    .setValue(title.icon)
                    .onChange(async (value) => {
                        this.plugin.settings.titles[index].icon = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(titlesDetails)
                .setName('XP Threshold')
                .setDesc('The amount of XP required to receive this title.')
                .addText(text => text
                    .setValue(title.threshold.toString())
                    .onChange(async (value) => {
                        const val = parseInt(value);
                        if (!isNaN(val)) {
                            this.plugin.settings.titles[index].threshold = val;
                            await this.plugin.saveSettings();
                        }
                    }));

            new Setting(titlesDetails)
                .setName('Description')
                .addTextArea(text => text
                    .setValue(title.description)
                    .onChange(async (value) => {
                        this.plugin.settings.titles[index].description = value;
                        await this.plugin.saveSettings();
                    }));

            titlesDetails.createEl('hr');
        });

        new Setting(titlesDetails)
            .setName('Add New Title')
            .addButton(btn => btn
                .setButtonText('Add Title')
                .onClick(async () => {
                    this.plugin.settings.titles.push({
                        threshold: 0,
                        name: 'New Title',
                        icon: '🆕',
                        description: 'Description for this title...'
                    });
                    await this.plugin.saveSettings();
                    this.display();
                }));

        const customShopItemsDetails = containerEl.createEl('details', { cls: 'lg-settings-details' });
        const customShopItemsSummary = customShopItemsDetails.createEl('summary');
        customShopItemsSummary.createEl('h3', { text: '🎁 Custom Reward Shop', cls: 'lg-settings-summary-title' });

        this.plugin.settings.customShopItems.forEach((item, index) => {
            const itemHeader = customShopItemsDetails.createEl('div', { cls: 'lg-setting-stat-header' });
            itemHeader.style.display = 'flex';
            itemHeader.style.justifyContent = 'space-between';
            itemHeader.style.alignItems = 'center';

            const itemTitle = itemHeader.createEl('h4', { text: item.name });
            itemTitle.style.margin = '0';

            const deleteBtn = itemHeader.createEl('button', { text: 'Delete', cls: 'mod-warning' });
            deleteBtn.addEventListener('click', async () => {
                this.plugin.settings.customShopItems.splice(index, 1);
                await this.plugin.saveSettings();
                this.display();
            });

            new Setting(customShopItemsDetails)
                .setName('Item Name')
                .addText(text => text
                    .setValue(item.name)
                    .onChange(async (value) => {
                        this.plugin.settings.customShopItems[index].name = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(customShopItemsDetails)
                .setName('Icon')
                .addText(text => text
                    .setValue(item.icon)
                    .setPlaceholder('🎁')
                    .onChange(async (value) => {
                        this.plugin.settings.customShopItems[index].icon = value || '🎁';
                        await this.plugin.saveSettings();
                    }));

            new Setting(customShopItemsDetails)
                .setName('Description')
                .addText(text => text
                    .setValue(item.description)
                    .onChange(async (value) => {
                        this.plugin.settings.customShopItems[index].description = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(customShopItemsDetails)
                .setName('Cost (Coins)')
                .addText(text => text
                    .setValue(item.cost.toString())
                    .onChange(async (value) => {
                        const val = parseInt(value);
                        if (!isNaN(val)) {
                            this.plugin.settings.customShopItems[index].cost = val;
                            await this.plugin.saveSettings();
                        }
                    }));

            customShopItemsDetails.createEl('hr');
        });

        new Setting(customShopItemsDetails)
            .setName('Add New Item')
            .addButton(btn => btn
                .setButtonText('Add Item')
                .onClick(async () => {
                    this.plugin.settings.customShopItems.push({
                        id: `item-${Date.now()}`,
                        name: 'New Reward',
                        icon: '🎁',
                        description: 'Reward description...',
                        cost: 50
                    });
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }
}
