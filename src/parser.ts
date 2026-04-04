import { Stat } from "./data";

export interface TaskReward {
    statId: string;
    amount: number;
    earnedAmount?: number;
}

export interface LifeGaugeTask {
    originalLine: number;
    text: string;
    completed: boolean;
    rewards: TaskReward[];
    skills: string[];
    date?: string;
    time?: string;
    isArchived: boolean;
    isProcessed: boolean;
    occurrenceIndex: number;
    earnedCoins?: number;
}
export function getTaskKey(task: LifeGaugeTask): string {
    const statsKey = (task.rewards || [])
        .map(r => r.statId)
        .sort()
        .join(',');
    return `${task.text}:${statsKey}:${task.date || ''}:${task.time || ''}:${task.occurrenceIndex}`;
}

export function parseTasks(content: string, stats: Stat[], requireDeadline: boolean = true): LifeGaugeTask[] {
    const lines = content.split('\n');
    const tasks: LifeGaugeTask[] = [];
    
    // Regex components
    const taskRegex = /^\s*-\s*\[([ x])\]\s*(.+?)\s*$/;
    const rewardSectionRegex = /\(([^)]+)\)/;
    const rewardRegex = /\+([0-9]+)\s+([a-zA-Z0-9-]+)/g;
    const dateRegex = /@\{([^}]+)\}/;
    const timeRegex = /@@\{([^}]+)\}/;
    const skillRegex = /#([a-zA-Z0-9\u00C0-\u1EF9-]+)/g; // Supports accented characters for Vietnamese

    let isArchivedSection = false;
    const occurrenceMap = new Map<string, number>();

    lines.forEach((line, index) => {
        // Detect Archive section
        if (line.trim().toLowerCase().startsWith('## archive')) {
            isArchivedSection = true;
            return;
        }

        const match = taskRegex.exec(line);
        if (match) {
            const isProcessed = line.trim().endsWith('(done)');
            const completed = match[1] === 'x';
            let remainingText = match[2];

            if (isProcessed) {
                remainingText = remainingText.replace(/\s*\(done\)$/, '').trim();
            }

            // 1. Extract Stats from (Stat1, Stat2)
            const rewards: TaskReward[] = [];
            const statMatch = rewardSectionRegex.exec(remainingText);
            if (statMatch) {
                const statsRaw = statMatch[1];
                const statNames = statsRaw.split(',').map(s => s.trim().toLowerCase());
                
                statNames.forEach(name => {
                    const stat = stats.find(s => s.name.toLowerCase() === name || s.id.toLowerCase() === name);
                    if (stat) {
                        rewards.push({ statId: stat.id, amount: 0 }); // Amount is now dynamic
                    }
                });
                remainingText = remainingText.replace(rewardSectionRegex, '').trim();
            }

            // 2. Extract Date
            let date;
            const dMatch = dateRegex.exec(remainingText);
            if (dMatch) {
                date = dMatch[1];
                remainingText = remainingText.replace(dateRegex, '').trim();
            }

            // 3. Extract Time
            let time;
            const tMatch = timeRegex.exec(remainingText);
            if (tMatch) {
                time = tMatch[1];
                remainingText = remainingText.replace(timeRegex, '').trim();
            }

            // 4. Extract Skill Hashtags
            const skills: string[] = [];
            let sMatch;
            while ((sMatch = skillRegex.exec(remainingText)) !== null) {
                skills.push(sMatch[1].toLowerCase());
            }
            remainingText = remainingText.replace(skillRegex, '').trim();

            // Mandatory deadline check: Skip tasks that don't have a date or time if required
            if (requireDeadline && !date && !time) return;

            // Calculate occurrence index for duplicate detection
            const baseKey = `${remainingText}:${rewards.map(r => r.statId).sort().join(',')}:${date || ''}:${time || ''}`;
            const occurrenceIndex = occurrenceMap.get(baseKey) || 0;
            occurrenceMap.set(baseKey, occurrenceIndex + 1);

            // Store task
            const task: LifeGaugeTask = {
                originalLine: index,
                text: remainingText,
                completed: completed,
                rewards: rewards,
                skills: skills,
                date: date,
                time: time,
                isArchived: isArchivedSection,
                isProcessed: isProcessed,
                occurrenceIndex: occurrenceIndex
            };

            // 5. Look ahead for rewards if processed
            if (isProcessed && index + 1 < lines.length) {
                const nextLine = lines[index + 1];
                const coinMatch = /\+💰\s*(\d+)/.exec(nextLine);
                if (coinMatch) {
                    task.earnedCoins = parseInt(coinMatch[1]);
                }
                
                task.rewards.forEach(r => {
                    const stat = stats.find(s => s.id === r.statId);
                    if (stat) {
                        const xpRegex = new RegExp(`\\+([\\d.]+)\\s+${stat.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
                        const xpMatch = xpRegex.exec(nextLine);
                        if (xpMatch) {
                            r.earnedAmount = parseFloat(xpMatch[1]);
                        }
                    }
                });
            }

            tasks.push(task);
        }
    });

    return tasks;
}

export function updateTaskInContent(content: string, lineIndex: number, completed: boolean, addDone: boolean = false, rewardText?: string): string {
    const lines = content.split('\n');
    if (lineIndex >= 0 && lineIndex < lines.length) {
        if (addDone) {
            lines[lineIndex] = lines[lineIndex].replace(/\[[ x]\]/, `[x]`);
            if (!lines[lineIndex].trim().endsWith('(done)')) {
                lines[lineIndex] = lines[lineIndex].trimEnd() + ' (done)';
            }
            if (rewardText) {
                // Get indentation of the task line
                const indentMatch = lines[lineIndex].match(/^(\s*)/);
                const indent = indentMatch ? indentMatch[1] : '';
                // Append reward on a new line with double indentation
                lines[lineIndex] = lines[lineIndex] + `\n${indent}  ${rewardText}`;
            }
        } else {
            const char = completed ? 'x' : ' ';
            lines[lineIndex] = lines[lineIndex].replace(/\[[ x]\]/, `[${char}]`);
        }
    }
    return lines.join('\n');
}
