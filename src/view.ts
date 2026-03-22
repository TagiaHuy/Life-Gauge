import { ItemView, WorkspaceLeaf, TFile, normalizePath, Notice } from 'obsidian';
import { Stat, Title, getTotalXp, getCurrentTitle, getNextTitle, calculateLevel, getRequiredXp } from './data';
import { parseTasks, updateTaskInContent, LifeGaugeTask } from './parser';
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

        // Avatar
        const avatarContainer = header.createEl('div', { cls: 'lg-avatar-container' });
        const avatar = avatarContainer.createEl('img', {
            cls: 'lg-avatar',
            attr: { src: this.app.vault.adapter.getResourcePath(this.plugin.settings.avatarPath) }
        });

        // Info
        const info = header.createEl('div', { cls: 'lg-info' });
        info.createEl('div', { cls: 'lg-nickname', text: `${title.icon} ${title.name.toUpperCase()} ${title.icon}` });
        info.createEl('div', { cls: 'lg-description', text: title.description });

        if (nextTitle) {
            const neededForNext = nextTitle.threshold - totalXp;
            info.createEl('div', { cls: 'lg-next-rank', text: `🔜 ${neededForNext} XP để trở thành ${nextTitle.name}` });
        } else {
            info.createEl('div', { cls: 'lg-next-rank', text: `🏆 Bạn đã đạt đỉnh vinh quang!` });
        }

        // Settings icon
        const settingsIcon = header.createEl('div', { cls: 'lg-settings-icon', text: '⚙️' });
        settingsIcon.addEventListener('click', () => {
            (this.app as any).setting.open();
            (this.app as any).setting.openTabById(this.plugin.manifest.id);
        });
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
        parent.createEl('h3', { text: 'Today quest', cls: 'lg-section-title' });

        const questHeader = parent.createEl('div', { cls: 'lg-quest-header' });
        // const refreshBtn = questHeader.createEl('button', { text: '🔄', cls: 'lg-refresh-btn' });
        // refreshBtn.addEventListener('click', () => {
        //     this.update();
        //     new Notice('Dashboard đã được cập nhật!');
        // });

        const questList = parent.createEl('div', { cls: 'lg-quest-list' });

        if (tasks.length === 0) {
            questList.createEl('div', { cls: 'lg-no-tasks', text: 'Không có nhiệm vụ nào hôm nay.' });
            return;
        }

        tasks.forEach(task => {
            const item = questList.createEl('div', { cls: `lg-quest-item ${task.completed ? 'is-completed' : ''}` });

            const checkbox = item.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            checkbox.checked = task.completed;
            checkbox.addEventListener('change', () => this.handleTaskToggle(task, checkbox.checked));

            const textContainer = item.createEl('div', { cls: 'lg-quest-text-container' });
            textContainer.createEl('span', { text: task.text, cls: 'lg-quest-title' });

            if (task.rewards.length > 0 || task.skills.length > 0 || task.date || task.time) {
                const meta = textContainer.createEl('div', { cls: 'lg-quest-meta' });

                // Rewards
                if (task.rewards.length > 0) {
                    const rewardsText = task.rewards.map(r => {
                        const stat = this.plugin.settings.stats.find(s => s.id === r.statId);
                        return `+${r.amount} ${stat ? stat.name : r.statId}`;
                    }).join(', ');
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
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.taskFilePath);
        if (!(file instanceof TFile)) return;

        this.plugin.isInternalChange = true;
        try {
            // 1. Update file content
            const content = await this.app.vault.read(file);
            const newContent = updateTaskInContent(content, task.originalLine, completed);
            await this.app.vault.modify(file, newContent);
            this.plugin.lastKnownContent = newContent;

            // 2. Capture old state for rank up check
            const oldTotalXp = getTotalXp(this.plugin.settings.stats);
            const currentTitle = getCurrentTitle(oldTotalXp, this.plugin.settings.titles);

            // 3. Update stats and tracking
            const taskId = `${task.text}:${task.rewards.map(r => `${r.statId}${r.amount}`).join(',')}`;
            const now = new Date();
            const penaltyInfo = this.plugin.getPenaltyInfo(task, now);

            task.rewards.forEach(reward => {
                const stat = this.plugin.settings.stats.find(s => s.id === reward.statId);
                if (stat) {
                    if (completed) {
                        const finalReward = reward.amount * penaltyInfo.multiplier;
                        stat.currentXp += finalReward;
                        if (stat.currentXp < 0) stat.currentXp = 0;
                    } else {
                        stat.currentXp = Math.max(0, stat.currentXp - reward.amount);
                    }
                }
            });

            // Award/Subtract Skill XP
            task.skills.forEach(skillName => {
                const skill = this.plugin.settings.skills.find(s => s.name.toLowerCase() === skillName || s.id.toLowerCase() === skillName);
                if (skill) {
                    const totalReward = task.rewards.reduce((sum, r) => sum + r.amount, 0) || 10;
                    if (completed) {
                        const finalReward = totalReward * penaltyInfo.multiplier;
                        skill.currentXp += finalReward;
                        if (skill.currentXp < 0) skill.currentXp = 0;
                    } else {
                        skill.currentXp = Math.max(0, skill.currentXp - totalReward);
                    }
                }
            });

            const rewardsList = task.rewards.map(r => {
                const stat = this.plugin.settings.stats.find(s => s.id === r.statId);
                const finalAmount = Math.round(r.amount * penaltyInfo.multiplier * 10) / 10;
                return `${finalAmount > 0 ? '+' : ''}${finalAmount} ${stat ? stat.name : r.statId}`;
            }).join(', ');
            const rewardMsg = rewardsList ? ` (${rewardsList})` : '';

            if (completed && penaltyInfo.isLate) {
                const reductionPercent = Math.round((1 - penaltyInfo.multiplier) * 100);
                const statusMsg = penaltyInfo.multiplier < 0 ? `Bị trừ ${-Math.round(penaltyInfo.multiplier * 100)}% điểm` : `Giảm ${reductionPercent}% điểm`;
                new Notice(`⚠️ Hoàn thành trễ: ${task.text}${rewardMsg}\n${statusMsg} do trễ ${penaltyInfo.minutesLate} phút.`, 5000);
            } else if (completed) {
                new Notice(`✅ Nhiệm vụ hoàn thành: ${task.text}${rewardMsg}`);
            }

            if (completed) {
                if (!this.plugin.settings.completedTasks.includes(taskId)) {
                    this.plugin.settings.completedTasks.push(taskId);
                }
            } else {
                this.plugin.settings.completedTasks = this.plugin.settings.completedTasks.filter(id => id !== taskId);
            }

            await this.plugin.saveSettings(); // This will call refreshViews() and thus update()

            // 4. Check for rank up notification
            const newTotalXp = getTotalXp(this.plugin.settings.stats);
            const newTitle = getCurrentTitle(newTotalXp, this.plugin.settings.titles);

            if (completed && newTitle.name !== currentTitle.name) {
                new Notice(`🎉 CHÚC MỪNG! 🎉\nBạn đã đạt cấp độ mới: ${newTitle.name}!`, 5000);
            }
        } finally {
            this.plugin.isInternalChange = false;
        }

        // Removed redundant this.update() call as saveSettings() triggers it.
    }
}
