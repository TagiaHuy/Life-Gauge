import { Plugin, PluginSettingTab, App, Setting, normalizePath, TFile, Notice } from 'obsidian';
import { LifeGaugeSettings, DEFAULT_SETTINGS, Stat, DEFAULT_STATS } from './src/data';
import { LifeGaugeView, VIEW_TYPE_LIFE_GAUGE } from './src/view';
import { parseTasks } from './src/parser';

export default class LifeGaugePlugin extends Plugin {
    settings!: LifeGaugeSettings;
    isInternalChange = false;

    async onload() {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_LIFE_GAUGE,
            (leaf) => new LifeGaugeView(leaf, this)
        );

        this.addRibbonIcon('gamepad', 'Open Life Gauge', () => {
			this.activateView();
		});

        this.addSettingTab(new LifeGaugeSettingTab(this.app, this));

        // Register event to refresh view when task file changes
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (this.isInternalChange) return;
                if (file instanceof TFile && file.path === this.settings.taskFilePath) {
                    await this.syncTasksFromFile(file);
                    this.refreshViews();
                }
            })
        );
    }

    async syncTasksFromFile(file: TFile) {
        const content = await this.app.vault.read(file);
        const tasks = parseTasks(content, this.settings.stats);
        const now = new Date();
        let changed = false;
        
        tasks.forEach(task => {
            const taskId = `${task.text}:${task.rewards.map(r => `${r.statId}${r.amount}`).join(',')}`;
            const wasCompleted = this.settings.completedTasks.includes(taskId);
            
            if (task.completed && !wasCompleted) {
                // Newly completed
                const penaltyInfo = this.getPenaltyInfo(task, now);
                
                task.rewards.forEach(reward => {
                    const stat = this.settings.stats.find(s => s.id === reward.statId);
                    if (stat) {
                        const finalReward = reward.amount * penaltyInfo.multiplier;
                        stat.currentXp += finalReward;
                        if (stat.currentXp < 0) stat.currentXp = 0; // Still cap total XP at 0, but reward can be negative
                    }
                });
                
                task.skills.forEach(skillName => {
                    const skill = this.settings.skills.find(s => s.name.toLowerCase() === skillName || s.id.toLowerCase() === skillName);
                    if (skill) {
                        const totalReward = task.rewards.reduce((sum, r) => sum + r.amount, 0) || 10;
                        const finalReward = totalReward * penaltyInfo.multiplier;
                        skill.currentXp += finalReward;
                        if (skill.currentXp < 0) skill.currentXp = 0;
                    }
                });

                const rewardsList = task.rewards.map(r => {
                    const stat = this.settings.stats.find(s => s.id === r.statId);
                    const finalAmount = Math.round(r.amount * penaltyInfo.multiplier * 10) / 10;
                    return `${finalAmount > 0 ? '+' : ''}${finalAmount} ${stat ? stat.name : r.statId}`;
                }).join(', ');
                const rewardMsg = rewardsList ? ` (${rewardsList})` : '';

                if (penaltyInfo.isLate) {
                    const reductionPercent = Math.round((1 - penaltyInfo.multiplier) * 100);
                    const statusMsg = penaltyInfo.multiplier < 0 ? `Bị trừ ${-Math.round(penaltyInfo.multiplier * 100)}% điểm` : `Giảm ${reductionPercent}% điểm`;
                    new Notice(`⚠️ Hoàn thành trễ: ${task.text}${rewardMsg}\n${statusMsg} do trễ ${penaltyInfo.minutesLate} phút.`, 5000);
                } else {
                    new Notice(`✅ Nhiệm vụ hoàn thành: ${task.text}${rewardMsg}`);
                }

                this.settings.completedTasks.push(taskId);
                changed = true;
            } else if (!task.completed && wasCompleted) {
                // Newly unchecked - subtract reward (not handled by penalty formula for simplicity, just remove what was earned)
                // Actually, to be fair, we should probably subtract the penalty reward if it was late.
                // But since we don't store the exact amount awarded per task instance, let's just use current multiplier.
                // Or better: for unchecking, we just revert. 
                // But we don't know what the multiplier was when it was checked.
                // For now, let's just subtract the full reward or the penalized reward.
                const penaltyInfo = this.getPenaltyInfo(task, now);

                task.rewards.forEach(reward => {
                    const stat = this.settings.stats.find(s => s.id === reward.statId);
                    if (stat) stat.currentXp = Math.max(0, stat.currentXp - reward.amount);
                });
                task.skills.forEach(skillName => {
                    const skill = this.settings.skills.find(s => s.name.toLowerCase() === skillName || s.id.toLowerCase() === skillName);
                    if (skill) {
                        const totalReward = task.rewards.reduce((sum, r) => sum + r.amount, 0) || 10;
                        skill.currentXp = Math.max(0, skill.currentXp - totalReward);
                    }
                });
                this.settings.completedTasks = this.settings.completedTasks.filter(id => id !== taskId);
                changed = true;
            }
        });

        if (changed) {
            await this.saveData(this.settings);
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

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
                    await this.plugin.saveSettings();
                }));


        containerEl.createEl('h3', { text: '💀 Cấu hình hình phạt' });
        new Setting(containerEl)
            .setName('Hệ số hình phạt (Penalty Point)')
            .setDesc('Số điểm càng cao, hình phạt trễ hạn càng nặng. Công thức: Points - (Phút trễ * Points / 100) * PenaltyPoint')
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
                .setName('Tên danh hiệu')
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
                .setName('Mốc XP (Threshold)')
                .setDesc('Lượng XP cần đạt để nhận danh hiệu này.')
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
                .setName('Mô tả')
                .addTextArea(text => text
                    .setValue(title.description)
                    .onChange(async (value) => {
                        this.plugin.settings.titles[index].description = value;
                        await this.plugin.saveSettings();
                    }));
            
            titlesDetails.createEl('hr');
        });

        new Setting(titlesDetails)
            .setName('Thêm Danh hiệu mới')
            .addButton(btn => btn
                .setButtonText('Thêm Danh hiệu')
                .onClick(async () => {
                    this.plugin.settings.titles.push({
                        threshold: 0,
                        name: 'Danh hiệu mới',
                        icon: '🆕',
                        description: 'Mô tả về danh hiệu này...'
                    });
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }
}
