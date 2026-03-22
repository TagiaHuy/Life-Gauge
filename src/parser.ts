import { Stat } from "./data";

export interface TaskReward {
    statId: string;
    amount: number;
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
}
export function getTaskKey(task: LifeGaugeTask): string {
    const rewardsKey = (task.rewards || [])
        .map(r => `${r.statId}${r.amount}`)
        .sort()
        .join(',');
    return `${task.text}:${rewardsKey}:${task.date || ''}:${task.time || ''}:${task.occurrenceIndex}`;
}

export function parseTasks(content: string, stats: Stat[]): LifeGaugeTask[] {
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

            // 1. Extract Rewards
            const rewards: TaskReward[] = [];
            const rewardMatch = rewardSectionRegex.exec(remainingText);
            if (rewardMatch) {
                const rewardsRaw = rewardMatch[1];
                let rMatch;
                while ((rMatch = rewardRegex.exec(rewardsRaw)) !== null) {
                    const amount = parseInt(rMatch[1]);
                    const statName = rMatch[2].toLowerCase();
                    const stat = stats.find(s => s.name.toLowerCase() === statName || s.id.toLowerCase() === statName);
                    if (stat) {
                        rewards.push({ statId: stat.id, amount });
                    }
                }
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

            // Mandatory deadline check: Skip tasks that don't have a date or time
            if (!date && !time) return;

            // Calculate occurrence index for duplicate detection
            const baseKey = `${remainingText}:${rewards.map(r => `${r.statId}${r.amount}`).sort().join(',')}:${date || ''}:${time || ''}`;
            const occurrenceIndex = occurrenceMap.get(baseKey) || 0;
            occurrenceMap.set(baseKey, occurrenceIndex + 1);

            // Store task
            tasks.push({
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
            });
        }
    });

    return tasks;
}

export function updateTaskInContent(content: string, lineIndex: number, completed: boolean, addDone: boolean = false): string {
    const lines = content.split('\n');
    if (lineIndex >= 0 && lineIndex < lines.length) {
        if (addDone) {
            lines[lineIndex] = lines[lineIndex].replace(/\[[ x]\]/, `[x]`);
            if (!lines[lineIndex].trim().endsWith('(done)')) {
                lines[lineIndex] = lines[lineIndex].trimEnd() + ' (done)';
            }
        } else {
            const char = completed ? 'x' : ' ';
            lines[lineIndex] = lines[lineIndex].replace(/\[[ x]\]/, `[${char}]`);
        }
    }
    return lines.join('\n');
}
