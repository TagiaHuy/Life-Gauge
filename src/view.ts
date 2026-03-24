import { ItemView, WorkspaceLeaf, TFile, normalizePath, Notice } from 'obsidian';
import { Stat, Title, getTotalXp, getCurrentTitle, getNextTitle, calculateLevel, getRequiredXp } from './data';
import { parseTasks, updateTaskInContent, LifeGaugeTask, getTaskKey } from './parser';
import LifeGaugePlugin from '../main';

export const VIEW_TYPE_LIFE_GAUGE = 'life-gauge-view';

export class LifeGaugeView extends ItemView {
    plugin: LifeGaugePlugin;
    tasks: LifeGaugeTask[] = [];
    isUpdating = false;

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

            if (this.showShop) {
                this.renderShop(contentEl);
                return;
            }

            // Stats section
            this.renderStats(contentEl);

            // Skills section (New)
            if (this.plugin.settings.skills.length > 0) {
                this.renderSkills(contentEl);
            }

            // Quests section
            this.renderQuests(contentEl, visibleTasks);
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

        // Coins & Shop
        const coinsShopGroup = topBar.createEl('div', { cls: 'lg-coins-shop-group' });
        const coinContainer = coinsShopGroup.createEl('div', { cls: 'lg-coin-container' });
        coinContainer.createEl('span', { text: `💰 ${Math.floor(this.plugin.settings.coins)}`, cls: 'lg-coin-text' });

        const shopBtn = coinsShopGroup.createEl('button', { text: '🏪 Shop', cls: 'lg-shop-btn' });
        shopBtn.addEventListener('click', () => this.toggleShop());

        // Settings icon
        const settingsIcon = topBar.createEl('div', { cls: 'lg-settings-icon', text: '⚙️' });
        settingsIcon.addEventListener('click', () => {
            (this.app as any).setting.open();
            (this.app as any).setting.openTabById(this.plugin.manifest.id);
        });

        // --- Main Info (Avatar + Nickname) ---
        const mainInfo = header.createEl('div', { cls: 'lg-header-main' });

        // Avatar
        const avatarContainer = mainInfo.createEl('div', { cls: 'lg-avatar-container' });
        const avatar = avatarContainer.createEl('img', {
            cls: 'lg-avatar',
            attr: { src: this.app.vault.adapter.getResourcePath(this.plugin.settings.avatarPath) }
        });

        // Info
        const info = mainInfo.createEl('div', { cls: 'lg-info' });
        info.createEl('div', { cls: 'lg-nickname', text: `${title.icon} ${title.name.toUpperCase()} ${title.icon}` });
        info.createEl('div', { cls: 'lg-description', text: title.description });

        if (nextTitle) {
            const neededForNext = nextTitle.threshold - totalXp;
            info.createEl('div', { cls: 'lg-next-rank', text: `🔜 ${neededForNext} XP to become ${nextTitle.name}` });
        } else {
            info.createEl('div', { cls: 'lg-next-rank', text: `🏆 You have reached the pinnacle of glory!` });
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

    showShop = false;
    purchasedItemIds = new Set<string>();

    toggleShop() {
        this.showShop = !this.showShop;
        if (!this.showShop) {
            this.purchasedItemIds.clear();
        }
        this.update();
    }

    renderShop(parent: HTMLElement) {
        const shopContainer = parent.createEl('div', { cls: 'lg-shop-container' });
        shopContainer.createEl('h3', { text: '🏪 Food Shop', cls: 'lg-section-title' });

        const backBtn = shopContainer.createEl('button', { text: '⬅️ Back to Dashboard', cls: 'lg-back-btn' });
        backBtn.addEventListener('click', () => this.toggleShop());

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
                } else {
                    new Notice(`✅ Mission Accomplished: ${task.text}${rewardMsg}`);
                }
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
                this.plugin.settings.maxHunger += 50;
                this.plugin.settings.hunger += 50;
                new Notice(`🎉 CONGRATULATIONS! 🎉\nYou have reached a new title: ${newTitle.name}!\nMax Satiety +50!`, 5000);
                await this.plugin.saveSettings();
            }
        } finally {
            this.plugin.isInternalChange = false;
        }

        // Removed redundant this.update() call as saveSettings() triggers it.
    }
}
