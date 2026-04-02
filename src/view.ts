import { ItemView, WorkspaceLeaf, TFile, normalizePath, Notice } from 'obsidian';
import { Stat, Title, getTotalXp, getCurrentTitle, getNextTitle, calculateLevel, getRequiredXp, formatDate } from './data';
import { parseTasks, updateTaskInContent, LifeGaugeTask, getTaskKey } from './parser';
import LifeGaugePlugin from '../main';

export const VIEW_TYPE_LIFE_GAUGE = 'life-gauge-view';

export class LifeGaugeView extends ItemView {
    plugin: LifeGaugePlugin;
    tasks: LifeGaugeTask[] = [];
    isUpdating = false;
    activeTab: 'main' | 'shop' | 'stats' = 'main';

    constructor(leaf: WorkspaceLeaf, plugin: LifeGaugePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_LIFE_GAUGE;
    }

    getDisplayText() {
        return 'Life Gauge';
    }

    getIcon() {
        return 'gamepad';
    }

    async onOpen() {
        this.update();
    }

    async update() {
        if (this.isUpdating) return;
        this.isUpdating = true;

        try {
            // 1. Prepare data (async)
            await this.loadTasks();

            // Filter out archived tasks for the main display
            const visibleTasks = this.tasks.filter(t => !t.isArchived);

            const totalXp = getTotalXp(this.plugin.settings.stats);
            const title = getCurrentTitle(totalXp, this.plugin.settings.titles);
            const nextTitle = getNextTitle(totalXp, this.plugin.settings.titles);

            // 2. Render (sync) - Clear only right before rendering
            const { contentEl } = this;
            contentEl.empty();
            contentEl.addClass('life-gauge-dashboard');

            this.renderHeader(contentEl, title, nextTitle, totalXp);

            // Tab rendering
            if (this.activeTab === 'shop') {
                this.renderShop(contentEl);
            } else if (this.activeTab === 'stats') {
                this.renderStatsTab(contentEl);
            } else {
                // Main / Dashboard tab
                this.renderStats(contentEl);
                if (this.plugin.settings.skills.length > 0) {
                    this.renderSkills(contentEl);
                }
                this.renderQuests(contentEl, visibleTasks);
            }
        } catch (e) {
            console.error('Life Gauge: Update failed', e);
        } finally {
            this.isUpdating = false;
        }
    }

    async loadTasks() {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.taskFilePath);
        if (file instanceof TFile) {
            const content = await this.app.vault.read(file);
            this.tasks = parseTasks(content, this.plugin.settings.stats);
        } else {
            this.tasks = [];
        }
    }

    renderHeader(parent: HTMLElement, title: Title, nextTitle: Title | null, totalXp: number) {
        const header = parent.createEl('div', { cls: 'lg-header' });

        // --- Top Bar (Satiety, Coins, Shop, Settings) ---
        const topBar = header.createEl('div', { cls: 'lg-header-top-bar' });
        
        // Satiety Bar
        this.renderSatiety(topBar);

        // Coins & Settings
        const coinsSettingsGroup = topBar.createEl('div', { cls: 'lg-coins-shop-group' });
        const coinContainer = coinsSettingsGroup.createEl('div', { cls: 'lg-coin-container' });
        coinContainer.createEl('span', { text: `💰 ${Math.floor(this.plugin.settings.coins)}`, cls: 'lg-coin-text' });

        // Settings icon
        const settingsIcon = coinsSettingsGroup.createEl('div', { cls: 'lg-settings-icon', text: '⚙️' });
        settingsIcon.addEventListener('click', () => {
            (this.app as any).setting.open();
            (this.app as any).setting.openTabById(this.plugin.manifest.id);
        });

        // --- Tab Navigation ---
        const tabNav = header.createEl('div', { cls: 'lg-tab-nav' });
        
        const tabs: {id: typeof LifeGaugeView.prototype.activeTab, name: string, icon: string}[] = [
            { id: 'main', name: 'Dashboard', icon: '🏠' },
            { id: 'shop', name: 'Shop', icon: '🏪' },
            { id: 'stats', name: 'Stats', icon: '📊' }
        ];

        tabs.forEach(t => {
            const tabBtn = tabNav.createEl('button', { cls: `lg-tab-btn ${this.activeTab === t.id ? 'is-active' : ''}` });
            tabBtn.createEl('span', { text: t.icon, cls: 'lg-tab-icon' });
            tabBtn.createEl('span', { text: t.name, cls: 'lg-tab-name' });
            tabBtn.addEventListener('click', () => {
                this.activeTab = t.id;
                this.update();
            });
        });

        // --- Main Info (Avatar + Nickname) ---
        const mainInfo = header.createEl('div', { cls: 'lg-header-main' });

        // Avatar
        const avatarContainer = mainInfo.createEl('div', { cls: 'lg-avatar-container' });
        const avatar = avatarContainer.createEl('img', {
            cls: 'lg-avatar',
            attr: { 
                src: this.app.vault.adapter.getResourcePath(this.plugin.settings.avatarPath),
                title: this.plugin.settings.ai.enabled ? `Click to talk to ${this.plugin.settings.ai.name}` : ""
            }
        });

        if (this.plugin.settings.ai.enabled) {
            avatar.addEventListener('click', async () => {
                new Notice(`${this.plugin.settings.ai.name} is thinking...`);
                await this.plugin.triggerAiAnalysis("I'm checking in on you!");
                new Notice(`${this.plugin.settings.ai.name} has spoken!`);
                this.update(); // Refresh view to show new response
            });
        }

        // Info
        const info = mainInfo.createEl('div', { cls: 'lg-info' });
        
        let displayName = `${title.icon} ${title.name.toUpperCase()} ${title.icon}`;
        let displayDesc = title.description;

        if (this.plugin.settings.ai.enabled) {
            displayName = this.plugin.settings.ai.name.toUpperCase();
            displayDesc = this.plugin.settings.lastAiResponse;
        }

        info.createEl('div', { cls: 'lg-nickname', text: displayName });
        const descEl = info.createEl('div', { cls: 'lg-description' });
        
        if (this.plugin.settings.ai.enabled && this.plugin.settings.ai.newResponse) {
            this.runTypewriter(descEl, displayDesc);
            this.plugin.settings.ai.newResponse = false;
            this.plugin.saveSettings();
        } else {
            descEl.textContent = displayDesc;
        }
        if (this.plugin.settings.ai.enabled) {
            return; // Skip rank info if AI is enabled
        }

        if (nextTitle) {
            const neededForNext = nextTitle.threshold - totalXp;
            info.createEl('div', { cls: 'lg-next-rank', text: `🔜 ${neededForNext} XP to become ${nextTitle.name}` });
        } else {
            info.createEl('div', { cls: 'lg-next-rank', text: `🏆 You have reached the pinnacle of glory!` });
        }
    }

    private async runTypewriter(el: HTMLElement, text: string, speed: number = 25) {
        el.textContent = "";
        for (let i = 0; i < text.length; i++) {
            el.textContent += text.charAt(i);
            await new Promise(resolve => setTimeout(resolve, speed));
        }
    }

    renderSatiety(parent: HTMLElement) {
        const hunger = this.plugin.settings.hunger;
        const maxHunger = this.plugin.settings.maxHunger;
        const percent = (hunger / maxHunger) * 100;

        const container = parent.createEl('div', { cls: 'lg-satiety-container' });
        container.createEl('div', { text: '🍖 Satiety', cls: 'lg-satiety-label' });

        const barContainer = container.createEl('div', { cls: 'lg-bar-container satiety' });
        const bar = barContainer.createEl('div', { cls: 'lg-bar-fill' });
        bar.style.width = `${Math.min(100, percent)}%`;
        
        // Color coding
        if (percent >= 70) {
            bar.style.backgroundColor = '#4dff88'; // Green
        } else if (percent >= 30) {
            bar.style.backgroundColor = '#ffcc00'; // Yellow
        } else {
            bar.style.backgroundColor = '#ff4d4d'; // Red
        }

        container.createEl('div', { text: `${Math.floor(hunger)} / ${maxHunger}`, cls: 'lg-satiety-value' });
    }

    purchasedItemIds = new Set<string>();

    renderShop(parent: HTMLElement) {
        const shopContainer = parent.createEl('div', { cls: 'lg-shop-container' });
        shopContainer.createEl('h3', { text: '🏪 Food Shop', cls: 'lg-section-title' });

        const shopGrid = shopContainer.createEl('div', { cls: 'lg-shop-grid' });

        const items = [
            { icon: '🍒', name: 'Cherry', boost: 5, cost: 10 },
            { icon: '🍌', name: 'Banana', boost: 7, cost: 14 },
            { icon: '🍞', name: 'Bread', boost: 15, cost: 24 },
            { icon: '🍱', name: 'Meal', boost: 25, cost: 40 },
        ];

        items.forEach(item => {
            const card = shopGrid.createEl('div', { cls: 'lg-shop-card' });
            card.createEl('div', { text: item.icon, cls: 'lg-shop-item-icon' });
            card.createEl('div', { text: item.name, cls: 'lg-shop-item-name' });
            card.createEl('div', { text: `+${item.boost} Satiety`, cls: 'lg-shop-item-boost' });
            
            const buyBtn = card.createEl('button', { 
                text: `${item.cost} 💰 Buy`, 
                cls: 'lg-buy-btn' 
            });
            
            if (this.plugin.settings.coins < item.cost) {
                buyBtn.setAttr('disabled', true);
                buyBtn.addClass('is-disabled');
            }

            buyBtn.addEventListener('click', async () => {
                if (this.plugin.settings.coins >= item.cost) {
                    this.plugin.settings.coins -= item.cost;
                    this.plugin.settings.hunger = Math.min(this.plugin.settings.maxHunger, this.plugin.settings.hunger + item.boost);
                    new Notice(`Consumed ${item.name}! +${item.boost} Satiety.`);
                    
                    const aiPrompt = `I just bought and consumed ${item.name} for ${item.cost} coins. My satiety increased by ${item.boost} points! Mmm, delicious.`;
                    await this.plugin.triggerAiAnalysis(aiPrompt);
                    
                    await this.plugin.saveSettings();
                    this.update();
                }
            });
        });

        // --- Custom Rewards Section ---
        const customHeader = shopContainer.createEl('div', { cls: 'lg-shop-section-header' });
        customHeader.createEl('h3', { text: '🎁 Custom Rewards', cls: 'lg-shop-section-title' });
        
        const addBtn = customHeader.createEl('button', { text: '➕', cls: 'lg-add-reward-btn' });
        addBtn.setAttr('title', 'Add new reward');
        addBtn.addEventListener('click', () => {
            // We'll call a method on the plugin to show the modal
            (this.plugin as any).showAddRewardModal();
        });

        if (this.plugin.settings.customShopItems.length > 0) {
            const customGrid = shopContainer.createEl('div', { cls: 'lg-shop-grid' });

            this.plugin.settings.customShopItems.forEach(item => {
                const isPurchased = this.purchasedItemIds.has(item.id);
                const card = customGrid.createEl('div', { cls: `lg-shop-card custom-reward ${isPurchased ? 'lg-purchased-item' : ''}` });
                
                if (isPurchased) {
                    card.createEl('div', { text: '✅ Received', cls: 'lg-purchased-badge' });
                }

                card.createEl('div', { text: item.icon || '🎁', cls: 'lg-shop-item-icon' });
                card.createEl('div', { text: item.name, cls: 'lg-shop-item-name' });
                card.createEl('div', { text: item.description, cls: 'lg-shop-item-desc' });
                
                const buyBtn = card.createEl('button', { 
                    text: isPurchased ? 'Get more' : `${item.cost} 💰 Claim`, 
                    cls: `lg-buy-btn ${isPurchased ? 'is-purchased' : ''}` 
                });
                
                if (this.plugin.settings.coins < item.cost) {
                    buyBtn.setAttr('disabled', true);
                    buyBtn.addClass('is-disabled');
                }

                buyBtn.addEventListener('click', async () => {
                    if (this.plugin.settings.coins >= item.cost) {
                        this.plugin.settings.coins -= item.cost;
                        this.purchasedItemIds.add(item.id);
                        new Notice(`🎉 Congratulations! You have received the reward: ${item.name}`);
                        
                        const aiPrompt = `I spent ${item.cost} coins to claim a custom reward: "${item.name}". I've earned this through my hard work!`;
                        await this.plugin.triggerAiAnalysis(aiPrompt);
                        
                        await this.plugin.saveSettings();
                        this.update();
                    }
                });
            });
        } else {
            shopContainer.createEl('div', { text: 'No custom items yet. Click + to add!', cls: 'lg-no-items' });
        }
    }

    renderStats(parent: HTMLElement) {
        const statsContainer = parent.createEl('div', { cls: 'lg-stats-container' });
        this.plugin.settings.stats.forEach(stat => this.renderProgressBar(statsContainer, stat));
    }

    renderSkills(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Your skills', cls: 'lg-section-title' });
        const skillsGrid = parent.createEl('div', { cls: 'lg-skills-grid' });
        this.plugin.settings.skills.forEach(skill => this.renderSkillCard(skillsGrid, skill));
    }

    renderSkillCard(parent: HTMLElement, skill: Stat) {
        const card = parent.createEl('div', { cls: 'lg-skill-card' });
        const { level, remainingXp, requiredXp } = calculateLevel(skill.currentXp, skill.baseXp, skill.xpIncrement);
        const percent = Math.min(100, (remainingXp / requiredXp) * 100);

        card.createEl('span', { text: `${skill.icon} ${skill.name}`, cls: 'lg-stat-label' });

        const barContainer = card.createEl('div', { cls: 'lg-bar-container' });
        const bar = barContainer.createEl('div', { cls: 'lg-bar-fill' });
        bar.style.width = `${percent}%`;
        bar.style.backgroundColor = skill.color;
        bar.style.boxShadow = `0 0 10px ${skill.color}`;

        const subText = card.createEl('div', { cls: 'lg-stat-values' });
        subText.createEl('span', { text: `${Math.floor(remainingXp)} / ${requiredXp}`, cls: 'lg-xp-text' });
        subText.createEl('span', { text: `Lv.${level}`, cls: 'lg-level-text' });
    }

    renderProgressBar(parent: HTMLElement, stat: Stat) {
        const { level, remainingXp, requiredXp } = calculateLevel(stat.currentXp, stat.baseXp, stat.xpIncrement);
        const percent = Math.min(100, (remainingXp / requiredXp) * 100);

        const statRow = parent.createEl('div', { cls: 'lg-stat-row' });
        statRow.createEl('span', { text: `${stat.icon} ${stat.name}`, cls: 'lg-stat-label' });

        const barContainer = statRow.createEl('div', { cls: 'lg-bar-container' });
        const bar = barContainer.createEl('div', { cls: 'lg-bar-fill' });
        bar.style.width = `${percent}%`;
        bar.style.backgroundColor = stat.color;

        const subText = statRow.createEl('div', { cls: 'lg-stat-values' });
        subText.createEl('span', { text: `${Math.floor(remainingXp)} / ${requiredXp}`, cls: 'lg-xp-text' });
        subText.createEl('span', { text: `Lv.${level}`, cls: 'lg-level-text' });
    }

    renderQuests(parent: HTMLElement, tasks: LifeGaugeTask[]) {
        parent.createEl('h3', { text: 'Today\'s Quest', cls: 'lg-section-title' });

        const questHeader = parent.createEl('div', { cls: 'lg-quest-header' });
        // const refreshBtn = questHeader.createEl('button', { text: '🔄', cls: 'lg-refresh-btn' });
        // refreshBtn.addEventListener('click', () => {
        //     this.update();
        //     new Notice('Dashboard đã được cập nhật!');
        // });

        const questList = parent.createEl('div', { cls: 'lg-quest-list' });

        if (tasks.length === 0) {
            questList.createEl('div', { cls: 'lg-no-tasks', text: 'No quests for today.' });
            return;
        }

        tasks.forEach(task => {
            const item = questList.createEl('div', { cls: `lg-quest-item ${task.completed ? 'is-completed' : ''}` });

            const checkbox = item.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            checkbox.checked = task.completed;
            checkbox.disabled = task.isProcessed;
            if (!task.isProcessed) {
                checkbox.addEventListener('change', () => this.handleTaskToggle(task, checkbox.checked));
            }

            const textContainer = item.createEl('div', { cls: 'lg-quest-text-container' });
            textContainer.createEl('span', { text: task.text, cls: 'lg-quest-title' });

            if (task.rewards.length > 0 || task.skills.length > 0 || task.date || task.time) {
                const meta = textContainer.createEl('div', { cls: 'lg-quest-meta' });

                // Rewards
                if (task.rewards.length > 0) {
                    let rewardsText = task.rewards.map(r => {
                        const stat = this.plugin.settings.stats.find(s => s.id === r.statId);
                        const label = stat ? stat.name : r.statId;
                        if (task.isProcessed && r.earnedAmount !== undefined) {
                            return `+${r.earnedAmount} ${label}`;
                        }
                        return label;
                    }).join(', ');

                    if (task.isProcessed && task.earnedCoins !== undefined) {
                        rewardsText += ` +💰 ${task.earnedCoins} coin`;
                    }
                    meta.createEl('span', { text: `(${rewardsText})`, cls: 'lg-reward-text' });
                }

                // Date/Time
                if (task.date || task.time) {
                    const dateTimeText = `${task.date || ''} ${task.time || ''}`.trim();
                    meta.createEl('span', { text: ` 📅 ${dateTimeText}`, cls: 'lg-date-text' });
                }

                // Skills
                if (task.skills.length > 0) {
                    const skillsText = task.skills.map(s => `#${s}`).join(' ');
                    meta.createEl('span', { text: ` ${skillsText}`, cls: 'lg-skill-tag' });
                }
            }
        });
    }

    renderStatsTab(parent: HTMLElement) {
        const statsTab = parent.createEl('div', { cls: 'lg-stats-tab' });
        statsTab.createEl('h3', { text: '📊 XP Statistics', cls: 'lg-section-title' });

        // --- Bar Chart ---
        const chartContainer = statsTab.createEl('div', { cls: 'lg-chart-container' });
        const daysToShow = 14;
        const data = [];
        let maxDailyXp = 50; // Minimum scale height

        for (let i = daysToShow - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = formatDate(date);
            const dayLogs = this.plugin.settings.dailyXpLogs[dateStr] || {};
            
            let dailyTotal = 0;
            Object.values(dayLogs).forEach(val => dailyTotal += val);
            
            data.push({
                label: i === 0 ? 'Today' : date.getDate(),
                totalXp: dailyTotal,
                dateStr: dateStr
            });
            maxDailyXp = Math.max(maxDailyXp, Math.abs(dailyTotal));
        }

        const chartBody = chartContainer.createEl('div', { cls: 'lg-chart-body' });
        
        data.forEach(d => {
            const barWrap = chartBody.createEl('div', { cls: 'lg-bar-wrap' });
            const percent = (Math.abs(d.totalXp) / maxDailyXp) * 100;
            
            const bar = barWrap.createEl('div', { 
                cls: `lg-bar ${d.totalXp >= 0 ? 'is-positive' : 'is-negative'}`,
                attr: { title: `${d.dateStr}: ${Math.round(d.totalXp * 10) / 10} XP` }
            });
            bar.style.height = `${Math.max(2, percent)}%`;
            
            barWrap.createEl('div', { text: d.label.toString(), cls: 'lg-bar-label' });
        });

        // --- Detailed History (Current renderingStatistics logic) ---
        statsTab.createEl('h3', { text: '📋 Recent History', cls: 'lg-section-title' });
        this.renderStatistics(statsTab);
    }

    renderStatistics(parent: HTMLElement) {
        const statsSection = parent.createEl('div', { cls: 'lg-statistics-section' });
        statsSection.createEl('h3', { text: '📊 Daily Progress (Last 7 Days)', cls: 'lg-section-title' });

        const statsGrid = statsSection.createEl('div', { cls: 'lg-stats-grid-daily' });

        // Get last 7 days
        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = formatDate(date);
            const dayLogs = this.plugin.settings.dailyXpLogs[dateStr] || {};
            
            let dailyTotal = 0;
            Object.values(dayLogs).forEach(val => dailyTotal += val);

            const dayCard = statsGrid.createEl('div', { cls: 'lg-daily-stat-card' });
            const dayLabel = i === 0 ? "Today" : i === 1 ? "Yesterday" : dateStr;
            dayCard.createEl('div', { text: dayLabel, cls: 'lg-daily-date' });
            
            const totalXp = Math.round(dailyTotal * 10) / 10;
            const xpText = dayCard.createEl('div', { text: `${totalXp > 0 ? '+' : ''}${totalXp} XP`, cls: 'lg-daily-xp' });
            
            if (totalXp > 0) {
                xpText.addClass('xp-positive');
            } else if (totalXp < 0) {
                xpText.addClass('xp-negative');
            }

            // Detail view (mini)
            if (Object.keys(dayLogs).length > 0) {
                const details = dayCard.createEl('div', { cls: 'lg-daily-details' });
                Object.entries(dayLogs).forEach(([id, amount]) => {
                    if (Math.abs(amount) < 0.1) return;
                    const stat = this.plugin.settings.stats.find(s => s.id === id) || 
                                 this.plugin.settings.skills.find(s => s.id === id || s.name === id);
                    const name = stat ? stat.name : id;
                    const roundedAmount = Math.round(amount * 10) / 10;
                    details.createEl('div', { text: `${name}: ${roundedAmount > 0 ? '+' : ''}${roundedAmount}`, cls: 'lg-daily-stat-item' });
                });
            }
        }
    }

    async handleTaskToggle(task: LifeGaugeTask, completed: boolean) {
        if (task.isProcessed) return;

        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.taskFilePath);
        if (!(file instanceof TFile)) return;

        this.plugin.isInternalChange = true;
        try {
            // 2. Capture old state for rank up check
            const oldTotalXp = getTotalXp(this.plugin.settings.stats);
            const currentTitle = getCurrentTitle(oldTotalXp, this.plugin.settings.titles);

            // 3. Update stats and tracking using plugin helpers
            const taskId = getTaskKey(task);
            const now = new Date();
            const penaltyInfo = this.plugin.getPenaltyInfo(task, now);

            let rewardString = "";
            if (completed) {
                const coins = this.plugin.applyReward(task, penaltyInfo);
                task.earnedCoins = coins;
                this.plugin.settings.completedTasks.push(taskId);
                rewardString = this.plugin.getRewardString(task, coins);
                
                const rewardsList = task.rewards.map(r => {
                    const stat = this.plugin.settings.stats.find(s => s.id === r.statId);
                    const finalAmount = r.earnedAmount || 0;
                    return `${finalAmount > 0 ? '+' : ''}${finalAmount} ${stat ? stat.name : r.statId}`;
                }).join(', ');
                let rewardMsg = rewardsList ? ` (${rewardsList})` : '';
                rewardMsg += ` +💰 ${coins} coin`;

                if (penaltyInfo.isLate) {
                    const reductionPercent = Math.round((1 - penaltyInfo.multiplier) * 100);
                    const statusMsg = penaltyInfo.multiplier < 0 ? `${-Math.round(penaltyInfo.multiplier * 100)}% points deducted` : `${reductionPercent}% points reduced`;
                    new Notice(`⚠️ Completed Late: ${task.text}${rewardMsg}\n${statusMsg} due to delay of ${penaltyInfo.minutesLate} minutes.`, 5000);
                    
                    const aiPrompt = `I finished the task: "${task.text}". Rewards: ${rewardMsg}. Note: It was LATE by ${penaltyInfo.minutesLate} minutes, so I received a penalty: ${statusMsg}.`;
                    await this.plugin.triggerAiAnalysis(aiPrompt);
                } else {
                    new Notice(`✅ Mission Accomplished: ${task.text}${rewardMsg}`);
                    const aiPrompt = `I just finished the mission: "${task.text}"! I earned: ${rewardMsg}. I'm feeling productive!`;
                    await this.plugin.triggerAiAnalysis(aiPrompt);
                }
                this.update(); // Refresh view to show AI's reaction
            } else {
                this.plugin.applyUnreward(task);
                const index = this.plugin.settings.completedTasks.indexOf(taskId);
                if (index > -1) {
                    this.plugin.settings.completedTasks.splice(index, 1);
                }
            }

            // 1. Update file content
            const content = await this.app.vault.read(file);
            const newContent = updateTaskInContent(content, task.originalLine, completed, completed, rewardString);
            await this.app.vault.modify(file, newContent);
            this.plugin.lastKnownContent = newContent;

            await this.plugin.saveSettings(); // This will call refreshViews() and thus update()

            // 4. Check for rank up notification
            const newTotalXp = getTotalXp(this.plugin.settings.stats);
            const newTitle = getCurrentTitle(newTotalXp, this.plugin.settings.titles);

            if (completed && newTitle.name !== currentTitle.name) {
                new Notice(`🎉 CONGRATULATIONS! 🎉\nYou have reached a new title: ${newTitle.name}!`, 5000);
                await this.plugin.saveSettings();
            }
        } finally {
            this.plugin.isInternalChange = false;
        }

        // Removed redundant this.update() call as saveSettings() triggers it.
    }
}
